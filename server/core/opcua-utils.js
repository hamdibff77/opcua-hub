'use strict';

/** Utilitaires OPC UA partages entre le connecteur et le generateur externe. */

let opcua = null;
function lib() {
    if (!opcua) {
        try { opcua = require('node-opcua'); } catch (err) {
            console.error('[opcua] node-opcua indisponible:', err.message);
        }
    }
    return opcua;
}
function available() { return !!lib(); }

function unwrapVariant(value) {
    if (value === undefined || value === null) return null;
    if (Object.prototype.hasOwnProperty.call(value, 'value') &&
        (value.dataType !== undefined || value.arrayType !== undefined)) {
        return value.value === undefined ? null : value.value;
    }
    return value;
}

/** Conversion d'une valeur OPC UA vers un type de colonne PostgreSQL. */
function convertValue(value, dataType) {
    if (value === undefined || value === null) return null;
    const type = String(dataType || '').toLowerCase();
    if (type.includes('timestamp') || type === 'date') return new Date(value);
    if (type.includes('numeric') || type.includes('int') || type.includes('double') ||
        type.includes('real') || type.includes('decimal') || type.includes('float')) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    if (type === 'boolean') return Boolean(value);
    if (type === 'json' || type === 'jsonb') return JSON.stringify(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function isVariable(nodeClass) {
    return Number(nodeClass) === 2 || String(nodeClass).toLowerCase().includes('variable');
}

function isNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'bigint') return true;
    if (typeof value === 'string' && value.trim() !== '') return Number.isFinite(Number(value));
    return false;
}

/** Types du generateur (noms simples) -> DataType node-opcua. */
function generatorDataType(type) {
    const o = lib();
    if (!o) return null;
    switch (String(type || '').toLowerCase()) {
        case 'boolean': return o.DataType.Boolean;
        case 'int': case 'int32': case 'integer': return o.DataType.Int32;
        case 'float': case 'double': case 'real': return o.DataType.Double;
        default: return o.DataType.String;
    }
}

/** Type declare dans un tag FUXA -> DataType node-opcua (driver). */
function toDataType(type) {
    const o = lib();
    if (!o) return null;
    const map = {
        Boolean: o.DataType.Boolean, SByte: o.DataType.SByte, Byte: o.DataType.Byte,
        Int16: o.DataType.Int16, UInt16: o.DataType.UInt16, Int32: o.DataType.Int32,
        UInt32: o.DataType.UInt32, Int64: o.DataType.Int64, UInt64: o.DataType.UInt64,
        Float: o.DataType.Float, Double: o.DataType.Double, String: o.DataType.String,
        DateTime: o.DataType.DateTime, Guid: o.DataType.Guid, ByteString: o.DataType.ByteString
    };
    return map[String(type)] || o.DataType.String;
}

function toValue(type, value) {
    const o = lib();
    if (!o) return value;
    switch (type) {
        case o.DataType.Boolean:
            if (typeof value === 'boolean') return value;
            if (typeof value === 'string') return ['true', '1'].includes(value.toLowerCase());
            if (typeof value === 'number') return value === 1;
            return false;
        case o.DataType.SByte: case o.DataType.Byte: case o.DataType.Int16: case o.DataType.UInt16:
        case o.DataType.Int32: case o.DataType.UInt32: case o.DataType.Int64: case o.DataType.UInt64:
            return parseInt(value, 10);
        case o.DataType.Float: case o.DataType.Double:
            return parseFloat(value);
        default:
            return value;
    }
}

function messageSecurityMode(name) {
    const o = lib();
    if (!o) return undefined;
    if (name === 'SignAndEncrypt') return o.MessageSecurityMode.SignAndEncrypt;
    if (name === 'Sign') return o.MessageSecurityMode.Sign;
    return o.MessageSecurityMode.None;
}

function securityPolicy(name) {
    const o = lib();
    if (!o || !name || name === 'None') return o ? o.SecurityPolicy.None : undefined;
    return o.SecurityPolicy[name] || o.SecurityPolicy.None;
}

/** Construit une URL opc.tcp a partir des reglages du generateur. */
function endpointUrl(settings) {
    let rp = (settings && settings.resourcePath) || '/example';
    if (!rp.startsWith('/')) rp = '/' + rp;
    return `opc.tcp://${(settings && settings.ip) || '127.0.0.1'}:${(settings && settings.port) || 4000}${rp}`;
}

/** NodeId lisible et stable pour les variables du generateur integre. */
function generatorNodeId(group, nom) {
    const clean = s => String(s || '').trim().replace(/[^a-zA-Z0-9_.\-]/g, '_');
    return `ns=1;s=${clean(group || 'default')}.${clean(nom)}`;
}

module.exports = {
    lib, available, unwrapVariant, convertValue, isVariable, isNumber,
    generatorDataType, toDataType, toValue, messageSecurityMode, securityPolicy,
    endpointUrl, generatorNodeId
};
