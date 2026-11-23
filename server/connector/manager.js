'use strict';

/** Registre des connecteurs: cycle de vie, synchronisation des tags, evenements. */
const { EventEmitter } = require('events');
const { OpcUaDriver, getEndPoints } = require('./opcua-driver');
const { DatabaseConnector } = require('./db-driver');
const dialects = require('./dialects');

class ConnectorManager extends EventEmitter {
    constructor(store, logger) {
        super();
        this.store = store;
        this.logger = logger;
        this.drivers = new Map();
        this.latest = {};
        this.setMaxListeners(50);
        for (const cfg of store.get('connectors') || []) this._register(cfg);
    }

    _register(cfg) {
        const Driver = dialects.isDatabaseType(cfg.type) ? DatabaseConnector : OpcUaDriver;
        const driver = new Driver(cfg, this.logger);
        driver.on('values', payload => {
            Object.assign(this.latest, payload.values);
            this.emit('values', payload);
        });
        driver.on('daq', payload => this.emit('daq', payload));
        driver.on('status', payload => this.emit('status', payload));
        this.drivers.set(cfg.id, driver);
        return driver;
    }

    _persist() {
        const configs = Array.from(this.drivers.values()).map(d => d.config);
        this.store.set('connectors', configs);
    }

    list() {
        return Array.from(this.drivers.values()).map(d => d.info());
    }

    get(id) { return this.drivers.get(id); }

    create(cfg) {
        const driver = this._register(cfg);
        this._persist();
        return driver.info();
    }

    async remove(id) {
        const driver = this.drivers.get(id);
        if (!driver) return false;
        if (driver.connected) await driver.disconnect();
        this.drivers.delete(id);
        for (const key of Object.keys(this.latest)) {
            if (this.latest[key] && this.latest[key].connectorId === id) delete this.latest[key];
        }
        this._persist();
        return true;
    }

    async update(id, patch) {
        const driver = this.drivers.get(id);
        if (!driver) return null;
        await driver.updateConfig(patch);
        this._persist();
        return driver.info();
    }

    async connect(id) {
        const driver = this.drivers.get(id);
        if (!driver) throw new Error('Connecteur introuvable');
        await driver.connect();
        return driver.info();
    }

    async disconnect(id) {
        const driver = this.drivers.get(id);
        if (!driver) throw new Error('Connecteur introuvable');
        await driver.disconnect();
        return driver.info();
    }

    browse(id, nodeId) {
        const driver = this.drivers.get(id);
        if (!driver) throw new Error('Connecteur introuvable');
        return driver.browse(nodeId);
    }

    browseAll(id, options) {
        const driver = this.drivers.get(id);
        if (!driver) throw new Error('Connecteur introuvable');
        return driver.browseAll(options);
    }

    read(id, nodeIds) {
        const driver = this.drivers.get(id);
        if (!driver) throw new Error('Connecteur introuvable');
        return driver.readNodes(nodeIds);
    }

    readAttribute(id, nodeId) {
        const driver = this.drivers.get(id);
        if (!driver) throw new Error('Connecteur introuvable');
        return driver.readAttribute(nodeId);
    }

    write(id, tagId, value) {
        const driver = this.drivers.get(id);
        if (!driver) throw new Error('Connecteur introuvable');
        return driver.write(tagId, value);
    }

    distinct(id, tagId) {
        const driver = this.drivers.get(id);
        if (!driver || !driver.distinctValues) throw new Error('Connecteur sans valeurs distinctes');
        return driver.distinctValues(tagId);
    }

    getEndPoints(endpointUrl) { return getEndPoints(endpointUrl); }

    async shutdown() {
        for (const driver of this.drivers.values()) await driver.disconnect().catch(() => {});
    }
}

module.exports = { ConnectorManager };
