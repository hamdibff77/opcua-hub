'use strict';

/**
 * Connecteur OPC UA - extrait et adapte de server/runtime/devices/opcua/index.js de FUXA.
 * Suppression des dependances au runtime FUXA (plugin manager, scripts, evenements internes) :
 * le driver et desormais autonome, base sur EventEmitter et node-opcua installe localement.
 */
const { EventEmitter } = require('events');
const utils = require('../core/opcua-utils');
const tagUtils = require('../core/tag-utils');

class OpcUaDriver extends EventEmitter {
    constructor(config, logger) {
        super();
        this.config = JSON.parse(JSON.stringify(config || {}));
        this.logger = logger;
        this.id = this.config.id;
        this.name = this.config.name || this.id;
        this.client = null;
        this.session = null;
        this.subscription = null;
        this.monitoredItems = [];
        this.connected = false;
        this.monitored = false;
        this.working = false;
        this.status = 'connect-off';
        this.values = {};
        this.tags = (this.config.tags || []).map(t => ({ ...t }));
        this.tagIdByNodeId = {};
        this.lastRead = null;
        this.pollTimer = null;
        this.setMaxListeners(50);
    }

    /* --------------------------- cycle de vie --------------------------- */

    async connect() {
        const o = utils.lib();
        if (!o) throw new Error('node-opcua est indisponible (npm install)');
        if (this.working || this.connected) return { ok: true, already: true };
        this.working = true;
        try {
            const cfg = this.config;
            const opts = {
                endpointMustExist: false,
                keepSessionAlive: true,
                connectionStrategy: { maxRetry: 1, initialDelay: 100, maxDelay: 500 }
            };
            if (cfg.securityMode && cfg.securityMode !== 'None') opts.securityMode = utils.messageSecurityMode(cfg.securityMode);
            if (cfg.securityPolicy && cfg.securityPolicy !== 'None') opts.securityPolicy = utils.securityPolicy(cfg.securityPolicy);

            this.client = o.OPCUAClient.create(opts);
            this.client.on('connection_lost', () => {
                this.logger.error(`[${this.name}] connexion perdue`);
                this.disconnect().catch(() => {});
            });
            this.client.on('backoff', (retry) => this.logger.warn(`[${this.name}] nouvelle tentative ${retry}`));

            await this.client.connect(cfg.endpointUrl);
            const identity = cfg.user ? { userName: cfg.user, password: cfg.password || '' } : {};
            this.session = await this.client.createSession(identity);
            this.session.on('session_closed', () => this.logger.warn(`[${this.name}] session fermee`));
            this.session.on('keepalive_failure', () => {
                this.logger.error(`[${this.name}] echec keepalive`);
                this.disconnect().catch(() => {});
            });
            await this._createSubscription();

            this.connected = true;
            this.monitored = false;
            this._emitStatus('connect-ok');
            this.logger.ok(`[${this.name}] connecte a ${cfg.endpointUrl}`);

            const rate = Math.max(100, Number(cfg.polling) || 1000);
            this.pollTimer = setInterval(() => this.poll().catch(() => {}), rate);
            return { ok: true, endpointUrl: cfg.endpointUrl };
        } catch (err) {
            this.logger.error(`[${this.name}] echec connexion: ${err.message}`);
            this._emitStatus('connect-error');
            await this._cleanupSession();
            throw err;
        } finally {
            this.working = false;
        }
    }

    async disconnect() {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        await this._cleanupSession();
        this.connected = false;
        this.monitored = false;
        this.values = {};
        this._emitStatus('connect-off');
        this.logger.info(`[${this.name}] deconnecte`);
        return { ok: true };
    }

    async _cleanupSession() {
        try {
            if (this.subscription) { await this.subscription.terminate().catch(() => {}); this.subscription = null; }
            if (this.session) { await this.session.close().catch(() => {}); this.session = null; }
            if (this.client) { await this.client.disconnect().catch(() => {}); this.client = null; }
        } catch (_) { /* ignore */ }
        this.monitoredItems = [];
    }

    async _createSubscription() {
        const o = utils.lib();
        if (!this.session || !o) return;
        const interval = Math.max(50, Number(this.config.polling) || 500);
        const parameters = {
            requestedPublishingInterval: interval,
            requestedLifetimeCount: 600,
            requestedMaxKeepAliveCount: 10,
            maxNotificationsPerPublish: 0,
            publishingEnabled: true,
            priority: 0
        };
        this.subscription = this.session.createSubscription2
            ? await this.session.createSubscription2(parameters)
            : await this.session.createSubscription(parameters);
        this.monitoredItems = [];
        this.monitored = false;
    }

    async _resetSubscription() {
        if (this.subscription) {
            try { await this.subscription.terminate(); } catch (_) { }
        }
        await this._createSubscription();
    }

    setTags(tags) {
        this.tags = (tags || []).map(t => ({ ...t }));
        this.tagIdByNodeId = {};
        for (const tag of this.tags) if (tag.address) this.tagIdByNodeId[String(tag.address)] = tag.id;
        if (this.connected) this._resetSubscription().catch(err => this.logger.error(`[${this.name}] re-abonnement: ${err.message}`));
    }

    async updateConfig(patch) {
        const wasConnected = this.connected;
        const connectionKeys = ['endpointUrl', 'user', 'password', 'securityMode', 'securityPolicy', 'polling'];
        const connectionChanged = connectionKeys.some(k => k in patch && patch[k] !== this.config[k]);
        this.config = { ...this.config, ...patch };
        if (!connectionChanged) {
            this.setTags(this.config.tags || this.tags);
            return { ok: true, restarted: false };
        }
        if (wasConnected) await this.disconnect();
        if (wasConnected || patch.autoConnect) await this.connect();
        return { ok: true, restarted: wasConnected };
    }

    /* ------------------------------ lecture ----------------------------- */

    async _startMonitor() {
        const o = utils.lib();
        if (!this.session || !this.subscription || !o) throw new Error('Session OPC UA indisponible');
        this.tagIdByNodeId = {};
        for (const tag of this.tags) {
            if (!tag.address) continue;
            const nodeId = String(tag.address);
            this.tagIdByNodeId[nodeId] = tag.id;
            try {
                const item = await this.subscription.monitor(
                    { nodeId, attributeId: o.AttributeIds.Value },
                    { samplingInterval: Math.max(100, Number(this.config.polling) || 1000), discardOldest: true, queueSize: 1 },
                    o.TimestampsToReturn.Both
                );
                item.on('changed', (dataValue) => this._onValueChanged(nodeId, dataValue));
                this.monitoredItems.push(item);
            } catch (err) {
                this.logger.error(`[${this.name}] monitoring ${nodeId}: ${err.message}`);
            }
        }
        this.monitored = true;
    }

    _onValueChanged(nodeId, dataValue) {
        const o = utils.lib();
        if (!dataValue || !dataValue.value) return;
        const id = this.tagIdByNodeId[nodeId];
        const tag = this.tags.find(t => t.id === id);
        if (!tag) return;
        let raw = dataValue.value.value;
        if (o && dataValue.value.arrayType === o.VariantArrayType.Scalar && Array.isArray(raw) && raw.length) {
            raw = raw[raw.length - 1]; // Int64/UInt64 en paire de mots
        }
        tag.rawValue = raw;
        tag.dataType = dataValue.value.dataType;
        tag.serverTimestamp = dataValue.serverTimestamp ? dataValue.serverTimestamp.toString() : null;
        tag.sourceTimestamp = dataValue.sourceTimestamp ? dataValue.sourceTimestamp.toString() : null;
        tag.timestamp = Date.now();
        tag.changed = true;
    }

    async poll() {
        if (!this.connected || this.working) return;
        this.working = true;
        try {
            if (!this.monitored) {
                await this._startMonitor();
                return;
            }
            if (!this.session) return;
            const timestamp = Date.now();
            const changed = {};
            for (const tag of this.tags) {
                const previous = this.values[tag.id] ? this.values[tag.id].value : null;
                const value = tagUtils.tagValueCompose(tag.rawValue, previous, tag);
                const entry = {
                    id: tag.id, name: tag.name || tag.label || tag.id, type: tag.type,
                    value, rawValue: tag.rawValue, dataType: tag.dataType,
                    ts: tag.sourceTimestamp || new Date(timestamp).toISOString(),
                    quality: tag.rawValue === undefined ? 'bad' : 'good',
                    connectorId: this.id
                };
                this.values[tag.id] = entry;
                if (value !== undefined && value !== null && tagUtils.tagDaqToSave(tag, timestamp)) changed[tag.id] = entry;
                tag.changed = false;
            }
            this.lastRead = timestamp;
            this.emit('values', { connectorId: this.id, values: this.values });
            if (Object.keys(changed).length) this.emit('daq', { connectorId: this.id, values: changed });
        } catch (err) {
            this.logger.error(`[${this.name}] polling: ${err.message}`);
        } finally {
            this.working = false;
        }
    }

    async readNodes(nodeIds) {
        if (!this.session) throw new Error('Connecteur non connecte');
        const nodes = (nodeIds || []).map(nodeId => ({ nodeId }));
        if (!nodes.length) return [];
        const values = await this.session.read(nodes);
        return values.map((v, i) => ({
            nodeId: String(nodes[i].nodeId),
            value: utils.unwrapVariant(v && v.value),
            good: !!(v && v.statusCode && v.statusCode.isGood ? v.statusCode.isGood() : true),
            time: v && v.sourceTimestamp ? v.sourceTimestamp.toISOString() : null,
            dataType: v && v.value ? v.value.dataType : null
        }));
    }

    /* ------------------------------ navigation --------------------------- */

    async browse(nodeId) {
        const o = utils.lib();
        if (!this.session || !o) throw new Error('Connecteur non connecte');
        let current = nodeId || 'i=85';
        const nodes = [];
        let continuation = null;
        do {
            let result;
            if (continuation) {
                const request = new o.BrowseNextRequest({ continuationPoints: [continuation] });
                const response = await this.session.performMessageTransaction(request);
                result = response && response.results && response.results[0];
            } else {
                result = await this.session.browse(current);
            }
            if (!result) break;
            for (const ref of result.references || []) {
                nodes.push({
                    id: ref.nodeId.toString(),
                    name: ref.displayName && ref.displayName.text ? ref.displayName.text : String(ref.browseName || ''),
                    browseName: ref.browseName ? ref.browseName.toString() : '',
                    class: ref.nodeClass,
                    isVariable: utils.isVariable(ref.nodeClass)
                });
            }
            continuation = result.continuationPoint || null;
        } while (continuation);
        return nodes;
    }

    async browseAll(options) {
        if (!this.session) throw new Error('Connecteur non connecte');
        const maxDepth = Number(options && options.maxDepth) || 6;
        const maxNodes = Number(options && options.maxNodes) || 3000;
        const visited = new Set();
        const variables = [];
        const queue = [{ nodeId: 'i=85', depth: 0 }];
        while (queue.length && visited.size < maxNodes) {
            const cur = queue.shift();
            if (visited.has(cur.nodeId)) continue;
            visited.add(cur.nodeId);
            let refs;
            try { refs = await this.browse(cur.nodeId); } catch (_) { continue; }
            for (const ref of refs) {
                if (visited.has(ref.id)) continue;
                if (ref.isVariable) variables.push({ nodeId: ref.id, name: ref.name });
                else if (cur.depth < maxDepth) queue.push({ nodeId: ref.id, depth: cur.depth + 1 });
            }
        }
        return { variables, visited: visited.size };
    }

    async readAttribute(nodeId) {
        const o = utils.lib();
        if (!this.session || !o) throw new Error('Connecteur non connecte');
        const attrs = ['DataType', 'AccessLevel', 'UserAccessLevel'];
        const toRead = attrs.map(a => ({ nodeId, attributeId: o.AttributeIds[a] }));
        const dataValues = await this.session.read(toRead);
        const result = {};
        dataValues.forEach((dv, i) => {
            const raw = dv && dv.value && dv.value.value;
            if (attrs[i] === 'DataType') {
                result.dataType = raw !== undefined && raw !== null ? (o.DataType[raw.value] || o.DataType[raw] || String(raw)) : null;
            } else {
                let level = '';
                if (raw & 1) level += 'R';
                if (raw & 2) level += 'W';
                result[attrs[i]] = level;
            }
        });
        return result;
    }

    /* ------------------------------ ecriture ----------------------------- */

    async write(tagId, value) {
        const o = utils.lib();
        const tag = this.tags.find(t => t.id === tagId);
        if (!this.session || !tag || !tag.address || !o) return false;
        let type = tag.dataType !== undefined ? tag.dataType : utils.toDataType(tag.type);
        let out = tagUtils.tagRawCalculator(value, tag);
        if (type === o.DataType.String || type === o.DataType.ByteString) out = String(out);
        try {
            const codes = await this.session.write([{
                nodeId: tag.address,
                attributeId: o.AttributeIds.Value,
                value: { value: { dataType: type, value: utils.toValue(type, out) } }
            }]);
            const ok = codes.length === 1 && codes[0].isGood();
            if (!ok) this.logger.error(`[${this.name}] ecriture ${tagId} refusee: ${codes.join(', ')}`);
            return ok;
        } catch (err) {
            this.logger.error(`[${this.name}] ecriture ${tagId}: ${err.message}`);
            return false;
        }
    }

    /* ------------------------------- etat -------------------------------- */

    _emitStatus(status) {
        this.status = status;
        this.emit('status', { connectorId: this.id, status });
    }

    info() {
        return {
            id: this.id,
            name: this.name,
            endpointUrl: this.config.endpointUrl,
            polling: this.config.polling,
            status: this.status,
            connected: this.connected,
            monitored: this.monitored,
            tagCount: this.tags.length,
            lastRead: this.lastRead,
            values: this.values
        };
    }
}

/** Discovery des endpoints OPC UA d'un serveur (adapte de getEndPoints de FUXA). */
async function getEndPoints(endpointUrl) {
    const o = utils.lib();
    if (!o) throw new Error('node-opcua est indisponible');
    const client = o.OPCUAClient.create({ connectionStrategy: { maxRetry: 1 } });
    try {
        await client.connect(endpointUrl);
        const endpoints = await client.getEndpoints();
        return endpoints.map(e => ({
            endpointUrl: e.endpointUrl,
            securityMode: e.securityMode.toString(),
            securityPolicy: e.securityPolicyUri.toString()
        }));
    } finally {
        await client.disconnect().catch(() => {});
    }
}

module.exports = { OpcUaDriver, getEndPoints };
