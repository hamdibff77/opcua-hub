'use strict';

/** Dialecte PostgreSQL (adapte du driver PostgreSQL de FUXA). */
const { Pool } = require('pg');

const pools = new Map();
const quoteIdent = name => '"' + String(name).replace(/"/g, '""') + '"';

async function createPool(cfg, database) {
    const prop = cfg.property || {};
    const host = prop.address || cfg.host || 'localhost';
    const port = Number(prop.port || cfg.port) || 5432;
    const key = JSON.stringify([host, port, cfg.user, cfg.password, cfg.ssl, database]);
    if (!pools.has(key)) {
        const pool = new Pool({
            host,
            port,
            user: cfg.user,
            password: cfg.password,
            database: database || 'postgres',
            max: 2,
            idleTimeoutMillis: 30000,
            ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined
        });
        pool.on('error', err => console.error('[postgres] pool:', err.message));
        pools.set(key, pool);
    }
    return {
        query: async (sql, params) => ({ rows: (await pools.get(key).query(sql, params)).rows }),
        end: async () => { await pools.get(key).end(); pools.delete(key); }
    };
}

async function databases(pool) {
    const r = await pool.query('SELECT datname FROM pg_database WHERE datistemplate=false AND datallowconn ORDER BY datname');
    return r.rows.map(x => x.datname);
}

async function tables(pool) {
    const r = await pool.query(`SELECT table_schema AS schema, table_name AS name
        FROM information_schema.tables WHERE table_type='BASE TABLE'
        AND table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name`);
    return r.rows;
}

async function columns(pool, schema, table) {
    const r = await pool.query(`SELECT column_name AS name, data_type AS type
        FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
        [schema, table]);
    return r.rows;
}

async function readLatest(pool, parts, orderBy, isObject) {
    const [, schema, table, column] = parts;
    const select = isObject ? '*' : `${quoteIdent(column)} AS value`;
    const order = orderBy ? ` ORDER BY ${quoteIdent(orderBy)} DESC` : '';
    const r = await pool.query(`SELECT ${select} FROM ${quoteIdent(schema)}.${quoteIdent(table)}${order} LIMIT 1`);
    return isObject ? (r.rows[0] || null) : (r.rows.length ? r.rows[0].value : null);
}

async function distinct(pool, parts, limit) {
    const [, schema, table, column] = parts;
    const r = await pool.query(`SELECT DISTINCT ${quoteIdent(column)} AS value FROM ${quoteIdent(schema)}.${quoteIdent(table)}
        WHERE ${quoteIdent(column)} IS NOT NULL ORDER BY ${quoteIdent(column)} LIMIT $1`, [limit]);
    return r.rows.map(x => x.value);
}

module.exports = { key: 'POSTGRESQL', label: 'PostgreSQL', defaultPort: 5432, defaultDatabase: 'postgres',
    createPool, quoteIdent, databases, tables, columns, readLatest, distinct };
