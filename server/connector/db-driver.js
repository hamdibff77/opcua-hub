'use strict';

/**
 * Connecteur base de donnees multi-SGBD, extrait et generalise du driver PostgreSQL de FUXA
 * (server/runtime/devices/postgres/index.js).
 * - browse: bases -> schemas/tables -> colonnes
 * - polling: SELECT ... ORDER BY <orderBy> DESC LIMIT 1 par tag (lecture seule)
 * - evenements values/daq/status identiques au driver OPC UA (historique reutilise tel quel)
 */
const { EventEmitter } = require('events');
const dialects = require('./dialects');
const tagUtils = require('../core/tag-utils');

const decodeAddress = address => String(address || '').split('|').map(p => {
    try { return decodeURIComponent(p); } catch (_) { return p; }
});

class DatabaseConnector extends EventEmitter {
    constructor(config, logger) {
        super();
        this.config = JSON.parse(JSON.stringify(config || {}));
        this.logger = logger;
        this.id = this.config.id;
        this.name = this.config.name || this.id;
        this.type = String(this.config.type || 'POSTGRESQL').toUpperCase();
        this.dialect = dialects.get(this.type);
        this.pools = new Set();
        this.values = {};
        this.connected = false;
        this.working = false;
        this.status = 'connect-off';
        this.lastRead = null;
        this.pollTimer = null;
        this.warnedObjectDaq = new Set();
        this.setMaxListeners(50);
    }

    _property() { return this.config.property || {}; }

    async _pool(database) {
        const key = database || this._property().database || this.dialect.defaultDatabase;
        let pool = this.pools.get ? this.pools.get(key) : null;
        if (!pool) {
            pool = await this.dialect.createPool(this.config, key);
            if (!this.pools.set) this.pools = new Map();
            this.pools.set(key, pool);
        }
        return pool;
    }

    async connect() {
        if (this.connected) return { ok: true, already: true };
        const address = this._property().address;
        if (!address) throw new Error('Adresse du serveur de base de donnees requise');
        try {
            const pool = await this._pool();
            await pool.query('SELECT 1');
            this.connected = true;
            this._emitStatus('connect-ok');
            this.logger.ok(`[${this.name}] connecte a ${this.dialect.label} (${address})`);
            const rate = Math.max(200, Number(this.config.polling) || 1000);
            this.pollTimer = setInterval(() => this.poll().catch(() => {}), rate);
            return { ok: true };
        } catch (err) {
            this.connected = false;
            this._emitStatus('connect-error');
            this.logger.error(`[${this.name}] connexion ${this.dialect.label}: ${err.message}`);
            throw err;
        }
    }

    async disconnect() {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
        this.connected = false;
        for (const pool of this.pools.values ? this.pools.values() : []) {
            await pool.end().catch(() => {});
        }
        if (this.pools.clear) this.pools.clear();
        this.values = {};
        this._emitStatus('connect-off');
        this.logger.info(`[${this.name}] deconnecte`);
        return { ok: true };
    }

    setTags(tags) {
        this.tags = (tags || []).map(t => ({ ...t }));
        for (const id of Object.keys(this.values)) {
            if (!this.tags.some(t => t.id === id)) delete this.values[id];
        }
    }

    async updateConfig(patch) {
        const wasConnected = this.connected;
        if (wasConnected) await this.disconnect();
        this.config = { ...this.config, ...patch };
        delete this.config.tags;
        this.type = String(this.config.type || 'POSTGRESQL').toUpperCase();
        this.dialect = dialects.get(this.type);
        if (wasConnected || patch.autoConnect) await this.connect();
        return { ok: true, restarted: wasConnected };
    }

    async poll() {
        if (!this.connected || this.working) return;
        this.working = true;
        try {
            const changed = {};
            const orderBy = this._property().orderBy;
            for (const tag of this.tags || []) {
                if (!tag.address) continue;
                const parts = decodeAddress(tag.address);
                if (parts.length !== 3 && parts.length !== 4) {
                    this.logger.error(`[${this.name}] adresse SQL invalide pour ${tag.id}`);
                    continue;
                }
                const isObject = parts.length === 3;
                try {
                    const pool = await this._pool(parts[0]);
                    const raw = await this.dialect.readLatest(pool, parts, orderBy, isObject);
                    const previous = this.values[tag.id] ? this.values[tag.id].value : null;
                    const parsed = isObject || raw === null || raw === undefined
                        ? raw
                        : tagUtils.tagValueCompose(tagUtils.parseValue(raw, tag.type), previous, tag);
                    const current = {
                        id: tag.id, name: tag.name || tag.label || tag.id, type: tag.type,
                        rawValue: raw, value: parsed, daq: tag.daq, changed: previous !== parsed,
                        timestamp: Date.now(), ts: new Date().toISOString(),
                        quality: raw === null || raw === undefined ? 'bad' : 'good',
                        connectorId: this.id
                    };
                    this.values[tag.id] = current;
                    if (isObject && tag.daq && tag.daq.enabled && !this.warnedObjectDaq.has(tag.id)) {
                        this.logger.error(`[${this.name}] le tag objet ${tag.id} ne peut pas etre historise`);
                        this.warnedObjectDaq.add(tag.id);
                    } else if (!isObject && current.value !== null && current.value !== undefined &&
                        tagUtils.tagDaqToSave(current, current.timestamp)) {
                        changed[tag.id] = current;
                    }
                } catch (err) {
                    this.logger.error(`[${this.name}] lecture SQL ${parts.join('.')}: ${err.message}`);
                }
            }
            this.lastRead = Date.now();
            this.emit('values', { connectorId: this.id, values: this.values });
            if (Object.keys(changed).length) this.emit('daq', { connectorId: this.id, values: changed });
        } catch (err) {
            this.logger.error(`[${this.name}] polling SQL: ${err.message}`);
        } finally {
            this.working = false;
        }
    }

    async browse(nodeId) {
        const parts = nodeId ? decodeAddress(nodeId) : [];
        if (parts.length === 0) {
            const pool = await this._pool();
            const values = await this.dialect.databases(pool, this.config);
            return values.map(name => ({
                id: encodeParts([name]), name, class: 'Object'
            }));
        }
        if (parts.length === 1) {
            const pool = await this._pool(parts[0]);
            const rows = await this.dialect.tables(pool, parts[0]);
            return rows.map(row => ({
                id: encodeParts([parts[0], row.schema, row.name]),
                name: `${row.schema}.${row.name}`, class: 'Object', type: 'object'
            }));
        }
        if (parts.length === 3) {
            const pool = await this._pool(parts[0]);
            const rows = await this.dialect.columns(pool, parts[1], parts[2]);
            return rows.map(row => ({
                id: encodeParts([parts[0], parts[1], parts[2], row.name]),
                name: row.name, class: 'Variable',
                type: /^(smallint|integer|bigint|numeric|decimal|real|double|float|int|bit|boolean)$/i.test(row.type || '')
                    ? (/^(bit|boolean)$/i.test(row.type) ? 'boolean' : 'number') : 'string'
            }));
        }
        if (parts.length === 4) return [];
        throw new Error('Chemin de navigation SQL invalide');
    }

    async distinctValues(tagId) {
        const tag = (this.tags || []).find(t => t.id === tagId);
        if (!tag) throw new Error('Tag introuvable');
        const parts = decodeAddress(tag.address);
        if (parts.length !== 4) throw new Error('Adresse de colonne requise');
        const pool = await this._pool(parts[0]);
        const values = await this.dialect.distinct(pool, parts, 1000);
        return values.map(v => v !== null && typeof v === 'object' ? (JSON.stringify(v) || String(v)) : String(v));
    }

    setValue() { return Promise.resolve(false); }

    _emitStatus(status) {
        this.status = status;
        this.emit('status', { connectorId: this.id, status });
    }

    info() {
        const p = this._property();
        return {
            id: this.id, name: this.name, type: this.type,
            dialectLabel: this.dialect.label,
            endpointUrl: `${p.address || ''}${p.port ? ':' + p.port : ''}${p.database ? '/' + p.database : ''}`,
            property: p,
            status: this.status, connected: this.connected, polling: this.config.polling,
            tagCount: (this.tags || []).length, lastRead: this.lastRead, values: this.values
        };
    }
}

function encodeParts(parts) { return parts.map(p => encodeURIComponent(String(p))).join('|'); }

module.exports = { DatabaseConnector, decodeAddress, encodeParts };
