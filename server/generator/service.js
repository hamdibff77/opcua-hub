'use strict';

/**
 * Pilotage de l'application OPC UA Generateur externe (app.exe).
 * Remplace le generateur integre du fork FUXA : l'application demarre/arrete le binaire,
 * synchronise ses fichiers data/config.json et data/settings.json avec l'interface web,
 * et verifie la disponibilite du serveur OPC UA via son endpoint TCP.
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, execFile } = require('child_process');
const APP_API = process.env.OPCUA_GENERATOR_API || 'http://127.0.0.1:3301';
const APP_UI = process.env.OPCUA_GENERATOR_UI || 'http://localhost:3300';
const XLSX = require('xlsx');
const utils = require('../core/opcua-utils');
const { store, DATA_DIR: HUB_DATA_DIR } = require('../core/store');
const logger = require('../core/logger');

const APP_DIR = process.env.OPCUA_GENERATOR_DIR ||
    'C:\\Users\\hamdi\\Downloads\\opcua-generateur\\opcua-generateur';
const EXE = process.env.OPCUA_GENERATOR_EXE || 'app.exe';
const EXE_PATH = path.join(APP_DIR, EXE);
const DATA_DIR = path.join(APP_DIR, 'data');
const APP_CONFIG = path.join(DATA_DIR, 'config.json');
const APP_SETTINGS = path.join(DATA_DIR, 'settings.json');
const EXCEL_FILE = path.join(HUB_DATA_DIR, 'generator-tags.xlsx');

const state = { child: null, pid: null, running: false, startedAt: null, lastExit: null, output: [] };

/* ---------- API HTTP de app.exe (frontend 3300 / backend 3301) ---------- */
async function appGet(route, timeout = 1800) {
    try {
        const res = await fetch(APP_API + route, { signal: AbortSignal.timeout(timeout) });
        if (!res.ok) return null;
        return await res.json();
    } catch (_) { return null; }
}
async function appPost(route, body) {
    const res = await fetch(APP_API + route, {
        method: 'POST', signal: AbortSignal.timeout(5000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status} sur ${route}`);
    return data;
}
/** Envoie le fichier Excel a l'API de app.exe (champ multipart "file"). */
async function appImportExcel(buffer, fileName) {
    const form = new FormData();
    form.append('file', new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }), fileName || 'tags.xlsx');
    const res = await fetch(APP_API + '/api/tags/import', {
        method: 'POST', body: form, signal: AbortSignal.timeout(20000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status} sur /api/tags/import`);
    if (data.errors && data.errors.length) throw new Error(data.errors.join('; '));
    return data;
}

async function appHealth() { return appGet('/api/health'); }

async function waitForAppApi(timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await appHealth()) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

function config() { return store.get('generator'); }
function settings() { return config().settings || {}; }
function endpoint() { return utils.endpointUrl(settings()); }

/** Premiere execution : recupere la configuration de l'application externe si elle existe. */
function importFromAppIfNeeded() {
    const cfg = config();
    if (cfg.importedFromApp) return;
    try {
        if (fs.existsSync(APP_CONFIG)) {
            const appCfg = JSON.parse(fs.readFileSync(APP_CONFIG, 'utf8'));
            if (Array.isArray(appCfg.tags) && appCfg.tags.length) cfg.tags = appCfg.tags;
        }
        if (fs.existsSync(APP_SETTINGS)) {
            cfg.settings = { ...cfg.settings, ...JSON.parse(fs.readFileSync(APP_SETTINGS, 'utf8')) };
        }
        cfg.importedFromApp = true;
        store.set('generator', cfg);
        logger.info(`[generateur] configuration importee de ${DATA_DIR} (${(cfg.tags || []).length} tags)`);
    } catch (err) {
        logger.warn(`[generateur] import config initial impossible: ${err.message}`);
    }
}

/** Ecrit la configuration de notre application dans le dossier data de app.exe. */
function syncToApp() {
    const cfg = config();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(APP_CONFIG, JSON.stringify({ tags: cfg.tags || [] }, null, 2), 'utf8');
    fs.writeFileSync(APP_SETTINGS, JSON.stringify(cfg.settings || {}, null, 2), 'utf8');
    return { config: APP_CONFIG, settings: APP_SETTINGS };
}

function probePort(hostArg, portArg) {
    const s = settings();
    const port = Number(portArg || s.port) || 4000;
    const host = hostArg || s.ip || '127.0.0.1';
    return new Promise(resolve => {
        const socket = new net.Socket();
        let done = false;
        const finish = ok => { if (!done) { done = true; socket.destroy(); resolve(ok); } };
        socket.setTimeout(900);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(port, host);
    });
}

async function waitForPort(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await probePort()) return true;
        if (!state.running) return false;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

function pushOutput(text, kind) {
    const line = String(text).trim();
    if (!line) return;
    state.output.push({ ts: new Date().toISOString(), kind, line });
    if (state.output.length > 100) state.output.shift();
    if (kind === 'err') logger.warn(`[generateur] ${line}`);
    else logger.info(`[generateur] ${line}`);
}

/** Demarre le processus app.exe si son API n'est pas deja joignable. */
async function ensureAppRunning() {
    if (await appHealth()) return true;
    if (!fs.existsSync(EXE_PATH)) throw new Error(`app.exe introuvable: ${EXE_PATH}`);
    syncToApp();
    try {
        const child = spawn(EXE_PATH, [], {
            cwd: APP_DIR, windowsHide: true, detached: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        state.child = child;
        state.pid = child.pid;
        state.running = true;
        state.startedAt = Date.now();
        state.output = [];
        child.stdout.on('data', d => pushOutput(d.toString(), 'out'));
        child.stderr.on('data', d => pushOutput(d.toString(), 'err'));
        child.on('exit', (code, signal) => {
            state.running = false;
            state.child = null;
            state.lastExit = { code, signal, at: Date.now() };
            logger.warn(`[generateur] app.exe termine (code ${code})`);
        });
        child.on('error', err => {
            state.running = false;
            logger.error(`[generateur] lancement: ${err.message}`);
        });
        logger.ok(`[generateur] app.exe demarre (PID ${child.pid})`);
        if (!await waitForAppApi()) logger.warn('[generateur] API de app.exe injoignable apres 25s');
        return true;
    } catch (err) {
        state.running = false;
        logger.error(`[generateur] lancement: ${err.message}`);
        throw err;
    }
}

async function start() {
    await ensureAppRunning();
    // Demarrage du serveur OPC UA via l'API de app.exe (le binaire ne le demarre pas seul).
    try {
        const r = await appPost('/api/server/start', {});
        logger.ok(`[generateur] serveur OPC UA demarre: ${r.endpoint || endpoint()}`);
    } catch (err) {
        if (!String(err.message).toLowerCase().includes('running')) {
            logger.warn(`[generateur] server/start: ${err.message}`);
        }
    }
    const health = await appHealth();
    const port = health && health.opcua ? health.opcua.port : settings().port;
    const host = (health && health.opcua && health.opcua.ip) || settings().ip;
    const ready = await probePort(host, port);
    if (!ready) logger.warn(`[generateur] endpoint OPC UA pas encore joignable`);
    return { ok: true, ready, ...(await fullStatus()) };
}

async function stop() {
    const health = await appHealth();
    if (health) {
        try { await appPost('/api/server/stop', {}); } catch (err) {
            logger.warn(`[generateur] server/stop: ${err.message}`);
        }
    }
    if (!state.child) {
        state.running = false;
        logger.info('[generateur] serveur OPC UA arrete (app.exe laisse en cours)');
        return { ok: true, processKilled: false };
    }
    return new Promise(resolve => {
        const pid = state.pid;
        const done = () => {
            state.running = false;
            state.child = null;
            state.pid = null;
            logger.info('[generateur] app.exe arrete');
            resolve({ ok: true, processKilled: true, pid });
        };
        if (process.platform === 'win32') {
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => done());
        } else {
            try { process.kill(pid, 'SIGTERM'); } catch (_) { }
            setTimeout(done, 800);
        }
    });
}

/**
 * Demarre le generateur a partir d'un fichier Excel (format du PDF) :
 * arret du serveur OPC UA courant -> import via l'API de app.exe -> redemarrage.
 */
async function startFromExcel(dataUrl, fileName) {
    const clean = String(dataUrl || '').replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(clean, 'base64');
    if (!buffer.length) throw new Error('Fichier Excel vide');
    await ensureAppRunning();

    const health = await appHealth();
    if (health && health.opcua && health.opcua.running) {
        await appPost('/api/server/stop', {});
        logger.info('[generateur] serveur OPC UA arrete avant import Excel');
    }
    const imported = await appImportExcel(buffer, fileName || 'tags.xlsx');
    const tags = imported.tags || [];
    if (!tags.length) throw new Error('Aucune variable importee du fichier Excel');

    const cfg = config();
    cfg.tags = tags;
    cfg.excel = { name: fileName || 'tags.xlsx', importedAt: new Date().toISOString(), count: tags.length };
    store.set('generator', cfg);
    syncToApp();
    fs.mkdirSync(HUB_DATA_DIR, { recursive: true });
    fs.writeFileSync(EXCEL_FILE, buffer);

    await appPost('/api/server/start', {});
    logger.ok(`[generateur] ${tags.length} variables importees depuis ${fileName || 'tags.xlsx'}`);
    return { ok: true, imported: tags.length, excel: cfg.excel, ...(await fullStatus()) };
}

/** Relance depuis le dernier fichier Excel importe. */
async function startFromSavedExcel() {
    if (!fs.existsSync(EXCEL_FILE)) throw new Error('Aucun fichier Excel importe auparavant');
    const name = (config().excel && config().excel.name) || 'tags.xlsx';
    return startFromExcel(fs.readFileSync(EXCEL_FILE).toString('base64'), name);
}

function status() {
    return {
        ok: true,
        running: false,
        apiReachable: false,
        processRunning: !!state.child,
        pid: state.pid,
        startedAt: state.startedAt,
        lastExit: state.lastExit,
        portOpen: false,
        count: (config().tags || []).length,
        excel: config().excel || null,
        excelFile: fs.existsSync(EXCEL_FILE),
        url: endpoint(),
        frontendUrl: APP_UI,
        appDir: APP_DIR,
        exe: EXE_PATH,
        exeExists: fs.existsSync(EXE_PATH),
        output: state.output.slice(-20)
    };
}

async function fullStatus() {
    const s = status();
    const health = await appHealth();
    s.apiReachable = !!health;
    if (health) {
        const o = health.opcua || {};
        s.processRunning = true;
        s.running = !!o.running;
        s.endpoint = o.endpoint || endpoint();
        s.url = s.endpoint;
        const port = Number(o.port) || Number(settings().port) || 4000;
        let host = o.ip || settings().ip || '127.0.0.1';
        const match = /opc\.tcp:\/\/([^:/]+)/.exec(String(s.endpoint));
        if (match && match[1]) host = match[1];
        s.portOpen = await probePort(host, port);
        const tags = await appGet('/api/tags');
        if (tags && Array.isArray(tags.tags)) s.count = tags.tags.length;
    } else {
        s.portOpen = await probePort();
    }
    return s;
}

/* ---------------------- configuration et tags ---------------------- */

async function saveConfig(next, restartIfRunning = true) {
    const health = await appHealth();
    const wasRunning = state.running || !!(health && health.opcua && health.opcua.running);
    if (wasRunning && restartIfRunning) await stop();
    store.set('generator', next);
    syncToApp();
    if (wasRunning && restartIfRunning) await start();
    return { ok: true, restarted: wasRunning && restartIfRunning };
}

async function addTag(tag) {
    const cfg = config();
    cfg.tags.push({
        nom: String(tag.nom || 'Variable'), type: tag.type || 'Float',
        description: tag.description || '', group: tag.group || 'default',
        identifiant: String(tag.identifiant || ''), source: tag.source || ''
    });
    await saveConfig(cfg);
    return { ok: true, count: cfg.tags.length };
}

async function updateTag(index, patch) {
    const cfg = config();
    if (!cfg.tags[index]) return { ok: false, error: 'Index de tag invalide' };
    cfg.tags[index] = { ...cfg.tags[index], ...patch };
    await saveConfig(cfg);
    return { ok: true, tag: cfg.tags[index] };
}

async function removeTag(index) {
    const cfg = config();
    if (!cfg.tags[index]) return { ok: false, error: 'Index de tag invalide' };
    cfg.tags.splice(index, 1);
    await saveConfig(cfg);
    return { ok: true };
}

/** Import Excel: colonnes nom, type, description, group, identifiant. */
function importExcel(base64) {
    const buffer = Buffer.from(String(base64 || '').replace(/^data:[^;]+;base64,/, ''), 'base64');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('Aucune feuille trouvee');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    let headerIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const cells = rows[i].map(c => String(c).trim().toLowerCase());
        if (cells.includes('nom') && cells.includes('type')) { headerIndex = i; break; }
    }
    if (headerIndex < 0) throw new Error('Ligne d’en-tete avec les colonnes "nom" et "type" introuvable');
    const header = rows[headerIndex].map(c => String(c).trim().toLowerCase());
    const col = name => header.findIndex(h => h.replace(/\s|\(.*\)/g, '').includes(name));
    const iNom = col('nom'), iType = col('type'), iDesc = col('description'), iGroup = col('group');
    const iId = header.findIndex(h => h.startsWith('identifiant'));
    // Types declares dans le PDF : Boolean, Int16, Int32, Int64, Float, Double, String.
    const normalizeType = raw => {
        const t = String(raw || '').toLowerCase().replace(/\s/g, '');
        if (t === 'boolean' || t === 'bool') return 'Boolean';
        if (t === 'int16' || t === 'smallint') return 'Int16';
        if (t === 'int32' || t === 'integer' || t === 'int') return 'Int32';
        if (t === 'int64' || t === 'bigint') return 'Int64';
        if (t === 'float' || t === 'real' || t === 'single') return 'Float';
        if (['double', 'numeric', 'decimal', 'number'].includes(t)) return 'Double';
        if (['string', 'text', 'char', 'varchar'].includes(t)) return 'String';
        return 'String';
    };
    const tags = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
        const r = rows[i];
        const nom = r[iNom] !== undefined ? String(r[iNom]).trim() : '';
        if (!nom) continue;
        tags.push({
            nom, type: normalizeType(r[iType]),
            description: iDesc >= 0 ? String(r[iDesc] || '').trim() : '',
            group: iGroup >= 0 ? String(r[iGroup] || '').trim() : 'default',
            identifiant: iId >= 0 && r[iId] !== undefined ? String(r[iId]).trim() : '',
            source: ''
        });
    }
    if (!tags.length) throw new Error('Aucune ligne de tag trouvee');
    return { tags, count: tags.length, sheet: wb.SheetNames[0] };
}

importFromAppIfNeeded();

/** Reecrit les fichiers data de app.exe avec notre configuration (utile apres une edition externe). */
async function sync() {
    const files = syncToApp();
    return { ok: true, files, config: config() };
}

module.exports = {
    config, settings, endpoint, start, stop, status: fullStatus,
    saveConfig, addTag, updateTag, removeTag, importExcel, syncToApp, sync,
    startFromExcel, startFromSavedExcel, APP_DIR, EXE_PATH, EXCEL_FILE
};
