'use strict';

/** Journal applicatif minimal : sortie console + evenement 'log' (aucune persistance). */
const { EventEmitter } = require('events');

class Logger extends EventEmitter {
    _push(level, message) {
        const entry = { level: String(level), message: String(message), ts: new Date().toISOString() };
        const time = entry.ts.slice(11, 19);
        console.log(`[${time}] ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`);
        this.emit('log', entry);
        return entry;
    }

    info(message) { return this._push('info', message); }
    ok(message) { return this._push('ok', message); }
    warn(message) { return this._push('warn', message); }
    error(message) { return this._push('error', message); }
    debug(message) { return this._push('debug', message); }
}

module.exports = new Logger();
