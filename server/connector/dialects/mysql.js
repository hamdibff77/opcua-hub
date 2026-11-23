'use strict';

/** Dialecte MySQL / MariaDB. */
const mysql = require('mysql2/promise');

const pools = new Map();
const quoteIdent = name => '`' + String(name).replace(/`/g, '``') + '`';

async function createPool(cfg, database) {
    const prop = cfg.property || {};
    const host = prop.address || cfg.host || 'localhost';
    const port = Number(prop.port || cfg.port) || 3306;
    const key = JSON.stringify([host, port, cfg.user, cfg.password, database]);
    if (!pools.has(key)) {
        pools.set(key, mysql.createPool({
            host,
            port,
            user: cfg.user,
            password: cfg.password,
            database: database || 'mysql',
            waitForConnections: true,
            connectionLimit: 2,
            idleTimeout: 30000
        }));
    }
    const pool = pools.get(key);
    return {
        query: async (sql, params) => {
            const [rows] = await pool.query(sql, params || []);
            return { rows };
        },
        end: async () => { await pool.end(); pools.delete(key); }
    };
}

async function databases(pool) {
    const r = await pool.query('SHOW DATABASES');
    return r.rows.map(x => Object.values(x)[0]);
}

async function tables(pool) {
    const r = await pool.query(`SELECT table_schema AS schema, table_name AS name
        FROM information_schema.tables WHERE table_type='BASE TABLE'
        AND table_schema NOT IN ('mysql','information_schema','performance_schema','sys')
        ORDER BY table_schema, table_name`);
    return r.rows;
}

async function columns(pool, schema, table) {
    const r = await pool.query(`SELECT column_name AS name, data_type AS type
        FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position`,
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
        WHERE ${quoteIdent(column)} IS NOT NULL ORDER BY ${quoteIdent(column)} LIMIT ${Number(limit) || 1000}`);
    return r.rows.map(x => x.value);
}

module.exports = { key: 'MYSQL', label: 'MySQL / MariaDB', defaultPort: 3306, defaultDatabase: 'mysql',
    createPool, quoteIdent, databases, tables, columns, readLatest, distinct };
