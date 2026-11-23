'use strict';

/** Dialecte SQLite (module natif node:sqlite, sans dependance supplementaire). */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('../../core/store');

const dbs = new Map();
const quoteIdent = name => '[' + String(name).replace(/]/g, ']]') + ']';

function resolveFile(cfg, database) {
    const prop = cfg.property || {};
    const raw = prop.address || cfg.file || database || 'local.db';
    return path.isAbsolute(raw) ? raw : path.resolve(DATA_DIR, raw);
}

async function createPool(cfg, database) {
    const file = resolveFile(cfg, database);
    if (!dbs.has(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        dbs.set(file, new DatabaseSync(file));
    }
    const db = dbs.get(file);
    return {
        query: async (statement, params = []) => {
            if (/^\s*(select|with|pragma)\b/i.test(statement)) return { rows: db.prepare(statement).all(...params) };
            return { rows: [], changes: db.prepare(statement).run(...params).changes };
        },
        end: async () => { try { db.close(); } catch (_) { } dbs.delete(file); }
    };
}

async function databases(pool, cfg) {
    const prop = cfg.property || {};
    return [path.basename(resolveFile(cfg, prop.address || prop.database || cfg.file || cfg.database))];
}

async function tables(pool) {
    const r = await pool.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    return r.rows.map(x => ({ schema: 'main', name: x.name }));
}

async function columns(pool, schema, table) {
    const r = await pool.query(`PRAGMA table_info(${quoteIdent(table)})`);
    return r.rows.map(x => ({ name: x.name, type: x.type || 'TEXT' }));
}

async function readLatest(pool, parts, orderBy, isObject) {
    const [, schema, table, column] = parts;
    const select = isObject ? '*' : `${quoteIdent(column)} AS value`;
    const order = orderBy ? ` ORDER BY ${quoteIdent(orderBy)} DESC` : ' ORDER BY rowid DESC';
    const r = await pool.query(`SELECT ${select} FROM ${quoteIdent(table)}${order} LIMIT 1`);
    return isObject ? (r.rows[0] || null) : (r.rows.length ? r.rows[0].value : null);
}

async function distinct(pool, parts, limit) {
    const [, schema, table, column] = parts;
    const r = await pool.query(`SELECT DISTINCT ${quoteIdent(column)} AS value FROM ${quoteIdent(table)}
        WHERE ${quoteIdent(column)} IS NOT NULL ORDER BY ${quoteIdent(column)} LIMIT ${Number(limit) || 1000}`);
    return r.rows.map(x => x.value);
}

module.exports = { key: 'SQLITE', label: 'SQLite (fichier local)', defaultPort: 0, defaultDatabase: 'local.db',
    createPool, quoteIdent, databases, tables, columns, readLatest, distinct };
