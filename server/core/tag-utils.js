'use strict';

/** Regles de mise en forme, deadband, echelle et historisation des tags (adapte de device-utils.js de FUXA). */
const { isNumber } = require('./opcua-utils');

function tagValueCompose(value, oldValue, tag) {
    try {
        if (tag && tag.scaleReadFunction) {
            // Les scripts FUXA ne sont pas embarques: la transformation est faite cote client si besoin.
        }
        const type = tag && tag.type;
        const isCollection = Array.isArray(value) || ArrayBuffer.isView(value);
        if (!isCollection && !(type === 'String' || type === 'ByteString' || type === 'string') && isNumber(value)) {
            value = Number(value);
            if (tag && tag.deadband && tag.deadband.value && oldValue !== undefined && oldValue !== null) {
                if (Math.abs(value - Number(oldValue)) <= Number(tag.deadband.value)) value = oldValue;
            }
            if (tag && tag.scale && tag.scale.mode === 'linear') {
                const s = tag.scale;
                const denom = Number(s.rawHigh) - Number(s.rawLow);
                if (denom !== 0 && [s.rawLow, s.rawHigh, s.scaledLow, s.scaledHigh].every(isNumber)) {
                    value = (Number(s.scaledHigh) - Number(s.scaledLow)) * (value - Number(s.rawLow)) / denom + Number(s.scaledLow);
                }
            }
            if (tag && tag.format && value !== null && value !== undefined) {
                value = Number(Number(value).toFixed(Number(tag.format)));
            }
        }
    } catch (err) {
        console.error('[tag-utils] compose:', err.message);
    }
    return value;
}

function tagRawCalculator(value, tag) {
    try {
        if (isNumber(value) && tag && tag.scale && tag.scale.mode === 'linear') {
            const s = tag.scale;
            const denom = Number(s.scaledHigh) - Number(s.scaledLow);
            if (denom !== 0 && [s.rawLow, s.rawHigh, s.scaledLow, s.scaledHigh].every(isNumber)) {
                value = Number(s.rawLow) + ((Number(s.rawHigh) - Number(s.rawLow)) * (value - Number(s.scaledLow))) / denom;
            }
        }
    } catch (err) {
        console.error('[tag-utils] raw:', err.message);
    }
    return value;
}

/** Decide si la valeur doit etre enregistree dans l'historique (regle DAQ de FUXA). */
function tagDaqToSave(tag, timestamp) {
    if (tag.daq && (tag.daq.enabled || tag.daq.restored)) {
        tag.timestamp = timestamp;
        if (tag.changed && (tag.daq.changed || tag.daq.restored)) return true;
        if (!tag.daq.lastDaqSaved || (tag.daq.interval && timestamp - Number(tag.daq.interval) * 1000 > tag.daq.lastDaqSaved)) {
            tag.daq.lastDaqSaved = timestamp;
            return true;
        }
    }
    return false;
}

function parseValue(value, type) {
    if (type === 'number') return parseFloat(value);
    if (type === 'boolean') {
        if (value === null || value === undefined || value === '') return false;
        if (typeof value === 'string') return ['true', '1'].includes(value.toLowerCase().trim());
        return Boolean(value);
    }
    if (type === 'string') return value;
    let val = parseFloat(value);
    if (Number.isNaN(val)) {
        val = Number(value);
        if (Number.isNaN(val)) val = value;
    } else {
        val = parseFloat(val.toFixed(5));
    }
    return val;
}

module.exports = { tagValueCompose, tagRawCalculator, tagDaqToSave, parseValue };
