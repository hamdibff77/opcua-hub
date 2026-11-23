'use strict';

const postgres = require('./postgres');
const mysql = require('./mysql');
const mssql = require('./mssql');
const sqlite = require('./sqlite');

const DIALECTS = {
    POSTGRESQL: postgres,
    MYSQL: mysql,
    MSSQL: mssql,
    SQLITE: sqlite
};

function get(type) { return DIALECTS[String(type || '').toUpperCase()] || postgres; }
function list() {
    return Object.values(DIALECTS).map(d => ({ key: d.key, label: d.label, defaultPort: d.defaultPort, defaultDatabase: d.defaultDatabase }));
}
function isDatabaseType(type) { return Object.prototype.hasOwnProperty.call(DIALECTS, String(type || '').toUpperCase()); }

module.exports = { DIALECTS, get, list, isDatabaseType };
