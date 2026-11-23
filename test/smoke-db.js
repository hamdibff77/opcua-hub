'use strict';

/** Test des connecteurs base de donnees FUXA (PostgreSQL + SQLite). */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:1882';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

async function api(p, method = 'GET', body) {
    const res = await fetch(BASE + '/api/' + p, {
        method, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(p + ': ' + (data.error || res.status));
    return data;
}

(async () => {
    const pg = (await api('connectors', 'POST', {
        name: 'PG test', type: 'POSTGRESQL', polling: 500,
        property: { address: '127.0.0.1', port: 55432, database: 'opcua_test', orderBy: 'id' },
        user: 'postgres', password: 'postgres'
    })).connector;
    await api('connectors/' + pg.id + '/connect', 'POST');
    const dbs = await api('connectors/' + pg.id + '/browse', 'POST', { nodeId: '' });
    console.log('1. Bases PG:', dbs.nodes.map(n => n.name).join(', '));
    const tables = await api('connectors/' + pg.id + '/browse', 'POST', { nodeId: 'opcua_test' });
    console.log('2. Tables:', tables.nodes.map(n => n.name).join(', '));
    const cols = await api('connectors/' + pg.id + '/browse', 'POST', { nodeId: 'opcua_test|public|readings' });
    console.log('3. Colonnes:', cols.nodes.map(n => n.name).join(', '));
    await api('connectors/' + pg.id + '/disconnect', 'POST');
    await api('connectors/' + pg.id, 'DELETE');

    const dbFile = path.join(__dirname, '..', 'data', 'test.sqlite');
    const db = new DatabaseSync(dbFile);
    db.exec('DROP TABLE IF EXISTS readings; CREATE TABLE readings (id INTEGER PRIMARY KEY, temperature REAL);');
    db.prepare('INSERT INTO readings (temperature) VALUES (?)').run(18.3);
    db.close();

    const sl = (await api('connectors', 'POST', {
        name: 'SQLite test', type: 'SQLITE', polling: 500,
        property: { address: 'test.sqlite', database: 'test.sqlite', orderBy: 'id' }
    })).connector;
    await api('connectors/' + sl.id + '/connect', 'POST');
    const slTables = await api('connectors/' + sl.id + '/browse', 'POST', { nodeId: '' });
    console.log('4. Bases SQLite:', slTables.nodes.map(n => n.name).join(', '));
    const slCols = await api('connectors/' + sl.id + '/browse', 'POST', { nodeId: 'test.sqlite|main|readings' });
    console.log('5. Colonnes SQLite:', slCols.nodes.map(n => n.name).join(', '));
    await api('connectors/' + sl.id + '/disconnect', 'POST');
    await api('connectors/' + sl.id, 'DELETE');
    console.log('OK - connecteurs PostgreSQL et SQLite valides');
})().catch(err => { console.error('ECHEC:', err.message); process.exitCode = 1; });
