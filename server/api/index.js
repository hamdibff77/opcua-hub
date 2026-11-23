'use strict';

/** Surface REST de l'application autonome. */
const express = require('express');
const { uid } = require('../core/store');
const utils = require('../core/opcua-utils');
const dialects = require('../connector/dialects');

function createApi(ctx) {
    const { logger, manager, generator } = ctx;
    const api = express.Router();
    const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(err => {
        logger.error(`[api] ${req.method} ${req.originalUrl}: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    });

    /* ----------------------------- Connecteurs ---------------------------- */
    api.get('/connectors', wrap((req, res) => res.json({ connectors: manager.list() })));
    api.post('/connectors', wrap((req, res) => {
        const cfg = { ...req.body };
        if (!cfg.id) cfg.id = uid('conn');
        cfg.type = cfg.type || 'OPCUA';
        cfg.polling = Number(cfg.polling) || 1000;
        if (dialects.isDatabaseType(cfg.type)) {
            const dialect = dialects.get(cfg.type);
            cfg.property = { ...(cfg.property || {}) };
            cfg.property.address = cfg.property.address || (cfg.type === 'SQLITE' ? 'local.db' : 'localhost');
            cfg.property.port = Number(cfg.property.port) || dialect.defaultPort;
            cfg.property.database = cfg.property.database || dialect.defaultDatabase;
            cfg.property.orderBy = cfg.property.orderBy || '';
            delete cfg.endpointUrl;
        } else {
            cfg.endpointUrl = cfg.endpointUrl || 'opc.tcp://127.0.0.1:4000/example';
            delete cfg.property;
        }
        res.json({ ok: true, connector: manager.create(cfg) });
    }));
    api.post('/connectors/endpoints', wrap(async (req, res) => {
        res.json({ ok: true, endpoints: await manager.getEndPoints(req.body.endpointUrl) });
    }));
    api.get('/connectors/:id', wrap((req, res) => {
        const driver = manager.get(req.params.id);
        res.json(driver ? { ok: true, connector: driver.info() } : { ok: false, error: 'Introuvable' });
    }));
    api.put('/connectors/:id', wrap(async (req, res) => {
        delete req.body.id;
        res.json({ ok: true, connector: await manager.update(req.params.id, req.body) });
    }));
    api.delete('/connectors/:id', wrap(async (req, res) => {
        res.json({ ok: await manager.remove(req.params.id) });
    }));
    api.post('/connectors/:id/connect', wrap(async (req, res) => {
        res.json({ ok: true, connector: await manager.connect(req.params.id) });
    }));
    api.post('/connectors/:id/disconnect', wrap(async (req, res) => {
        res.json({ ok: true, connector: await manager.disconnect(req.params.id) });
    }));
    api.post('/connectors/:id/browse', wrap(async (req, res) => {
        res.json({ ok: true, nodes: await manager.browse(req.params.id, req.body.nodeId) });
    }));
    api.post('/connectors/:id/browseAll', wrap(async (req, res) => {
        res.json({ ok: true, ...(await manager.browseAll(req.params.id, req.body.options)) });
    }));
    api.post('/connectors/:id/read', wrap(async (req, res) => {
        res.json({ ok: true, values: await manager.read(req.params.id, req.body.nodeIds) });
    }));
    api.post('/connectors/:id/attribute', wrap(async (req, res) => {
        res.json({ ok: true, attribute: await manager.readAttribute(req.params.id, req.body.nodeId) });
    }));
    api.post('/connectors/:id/write', wrap(async (req, res) => {
        const ok = await manager.write(req.params.id, req.body.tagId, req.body.value);
        res.json({ ok });
    }));
    api.get('/connectors/:id/distinct', wrap(async (req, res) => {
        res.json({ ok: true, values: await manager.distinct(req.params.id, req.query.tagId) });
    }));
    api.get('/dialects', wrap((req, res) => res.json({ ok: true, dialects: dialects.list() })));

    /* ----------------------------- Generateur ----------------------------- */
    api.get('/generator', wrap(async (req, res) => res.json({
        ok: true, config: generator.config(), status: await generator.status()
    })));
    api.put('/generator/settings', wrap(async (req, res) => {
        const cfg = generator.config();
        cfg.settings = { ...cfg.settings, ...req.body };
        const result = await generator.saveConfig(cfg);
        res.json({ ok: true, settings: cfg.settings, ...result, status: await generator.status() });
    }));
    api.post('/generator/tags', wrap(async (req, res) => {
        const r = await generator.addTag(req.body);
        res.json(r);
    }));
    api.put('/generator/tags/:index', wrap(async (req, res) => {
        const r = await generator.updateTag(Number(req.params.index), req.body);
        res.json(r);
    }));
    api.delete('/generator/tags/:index', wrap(async (req, res) => {
        res.json(await generator.removeTag(Number(req.params.index)));
    }));
    api.post('/generator/importExcel', wrap(async (req, res) => {
        const result = generator.importExcel(req.body.data);
        const cfg = generator.config();
        cfg.tags = result.tags;
        const saved = await generator.saveConfig(cfg);
        res.json({ ok: true, ...result, ...saved, config: cfg });
    }));
    api.post('/generator/start', wrap(async (req, res) => {
        const r = await generator.start();
        res.json({ ok: r.ok, ready: r.ready, running: r.running, endpoint: r.endpoint, count: r.count });
    }));
    api.post('/generator/startFromExcel', wrap(async (req, res) => {
        const r = await generator.startFromExcel(req.body.data, req.body.name);
        res.json({ ok: r.ok, imported: r.imported, excel: r.excel, running: r.running, endpoint: r.endpoint, count: r.count });
    }));
    api.post('/generator/startFromSavedExcel', wrap(async (req, res) => {
        const r = await generator.startFromSavedExcel();
        res.json({ ok: r.ok, imported: r.imported, excel: r.excel, running: r.running, endpoint: r.endpoint, count: r.count });
    }));
    api.post('/generator/stop', wrap(async (req, res) => res.json(await generator.stop())));
    api.post('/generator/sync', wrap(async (req, res) => res.json(await generator.sync())));

    /* ------------------------------- Divers ------------------------------- */
    api.get('/system', wrap(async (req, res) => res.json({
        ok: true,
        node: process.version,
        uptime: Math.round(process.uptime()),
        nodeOpcua: utils.available(),
        connectors: manager.list().length,
        generator: await generator.status(),
        dialects: dialects.list()
    })));

    return api;
}

module.exports = { createApi };
