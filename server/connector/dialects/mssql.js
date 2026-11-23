'use strict';

/** Dialecte Microsoft SQL Server. */
const sql = require('mssql');

const pools = new Map();
const quoteIdent = name => '[' + String(name).replace(/]/g, ']]') + ']';

async function createPool(cfg, database) {
    const prop = cfg.property || {};
    const host = prop.address || cfg.host || 'localhost';
    const port = Number(prop.port || cfg.port) || 1433;
    const key = JSON.stringify([host, port, cfg.user, cfg.password, database]);
    if (!pools.has(key)) {
        const pool = new sql.ConnectionPool({
            server: host,
            port,
            user: cfg.user,
            password: cfg.password,
            database: database || 'master',
            options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
            pool: { max: 2, min: 0, idleTimeoutMillis: 30000 }
        });
        pools.set(key, pool.connect());
    }
    const pool = await pools.get(key);
    return {
        query: async (statement, params) => {
            const request = pool.request();
            (params || []).forEach((p, i) => request.input('p' + i, p));
            const result = await request.query(statement);
            return { rows: result.recordset || [] };
        },
        end: async () => { await pool.close(); pools.delete(key); }
    };
}

async function databases(pool) {
    const r = await pool.query('SELECT name FROM sys.databases ORDER BY name');
    return r.rows.map(x => x.name);
}

async function tables(pool) {
    const r = await pool.query(`SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS name
        FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_SCHEMA, TABLE_NAME`);
    return r.rows;
}

async function columns(pool, schema, table) {
    const r = await pool.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS type
        FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@p0 AND TABLE_NAME=@p1 ORDER BY ORDINAL_POSITION`,
        [schema, table]);
    return r.rows;
}

async function readLatest(pool, parts, orderBy, isObject) {
    const [, schema, table, column] = parts;
    const select = isObject ? '*' : `TOP (1) ${quoteIdent(column)} AS value`;
    const order = orderBy ? ` ORDER BY ${quoteIdent(orderBy)} DESC` : '';
    const statement = isObject
        ? `SELECT TOP (1) * FROM ${quoteIdent(schema)}.${quoteIdent(table)}${order}`
        : `SELECT ${select} FROM ${quoteIdent(schema)}.${quoteIdent(table)}${order}`;
    const r = await pool.query(statement);
    return isObject ? (r.rows[0] || null) : (r.rows.length ? r.rows[0].value : null);
}

async function distinct(pool, parts, limit) {
    const [, schema, table, column] = parts;
    const r = await pool.query(`SELECT DISTINCT TOP (${Number(limit) || 1000}) ${quoteIdent(column)} AS value
        FROM ${quoteIdent(schema)}.${quoteIdent(table)} WHERE ${quoteIdent(column)} IS NOT NULL ORDER BY ${quoteIdent(column)}`);
    return r.rows.map(x => x.value);
}

module.exports = { key: 'MSSQL', label: 'SQL Server', defaultPort: 1433, defaultDatabase: 'master',
    createPool, quoteIdent, databases, tables, columns, readLatest, distinct };
