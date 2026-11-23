'use strict';

/**
 * OPCUA Hub - point d'entree.
 * Application web autonome extraite de FUXA :
 *   1. Connecteurs OPC UA et base de donnees (PostgreSQL, MySQL, SQL Server, SQLite)
 *   2. Pilotage du generateur OPC UA externe (app.exe)
 *   3. Gestion des tags
 */
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const { store } = require('./core/store');
const logger = require('./core/logger');
const utils = require('./core/opcua-utils');
const { ConnectorManager } = require('./connector/manager');
const generator = require('./generator/service');
const { createApi } = require('./api');

const PORT = Number(process.env.PORT) || 1882;
const WEB_DIR = path.join(__dirname, '..', 'web');

const app = express();

/* Authentification basique optionnelle (HUB_USER / HUB_PASSWORD). */
if (process.env.HUB_USER && process.env.HUB_PASSWORD) {
    app.use((req, res, next) => {
        const header = req.headers.authorization || '';
        if (header.startsWith('Basic ')) {
            const decoded = Buffer.from(header.slice(6), 'base64').toString();
            const sep = decoded.indexOf(':');
            const user = decoded.slice(0, sep);
            const pass = decoded.slice(sep + 1);
            if (user === process.env.HUB_USER && pass === process.env.HUB_PASSWORD) return next();
        }
        res.set('WWW-Authenticate', 'Basic realm="OPCUA Hub"');
        return res.status(401).send('Authentification requise');
    });
}

app.use(bodyParser.json({ limit: '25mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '25mb' }));

/* ---------------------------- Initialisation ---------------------------- */
const manager = new ConnectorManager(store, logger);

app.use('/api', createApi({ store, logger, manager, generator }));

/* ------------------------------ Interface web --------------------------- */
app.use(express.static(WEB_DIR));
app.get('/opcua2pg', (req, res) => res.redirect('/#generator'));
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Route inconnue' });
    res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
    logger.error(`[http] ${err.message}`);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ ok: false, error: err.message });
});

/* ------------------------------- Demarrage ------------------------------ */
const server = app.listen(PORT, () => {
    console.log('');
    console.log('  OPCUA HUB  --  Connecteurs / Generateur externe / Tags');
    console.log(' ------------------------------------------------------------');
    console.log(`  Interface web    : http://localhost:${PORT}`);
    console.log(`  Generateur externe: ${generator.EXE_PATH} (${fs.existsSync(generator.EXE_PATH) ? 'present' : 'ABSENT'})`);
    console.log(`  Endpoint OPC UA  : ${generator.endpoint()}`);
    console.log(`  node-opcua       : ${utils.available() ? 'charge' : 'MANQUANT (npm install)'}`);
    console.log(`  Connecteurs      : ${manager.list().length}`);
    console.log('');
    if (!utils.available()) logger.error('node-opcua est introuvable: lancez "npm install" dans le dossier opcua-hub');
});

async function shutdown() {
    logger.info('Arret de l’application...');
    await generator.stop().catch(() => {});
    await manager.shutdown().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', err => logger.error(`Exception non capturee: ${err.message}`));
