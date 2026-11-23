'use strict';

/**
 * Persistance JSON de la configuration (connecteurs, tags, generateur externe).
 * Remplace le stockage localStorage du fork FUXA par un stockage cote serveur.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function defaults() {
    return {
        connectors: [],
        generator: {
            settings: { ip: '127.0.0.1', port: 4000, resourcePath: '/example', rootFolderName: 'example' },
            tags: [
                { nom: 'Temperature', type: 'Float', description: 'Temperature atelier', group: 'Process', identifiant: '1', source: '' },
                { nom: 'Pression', type: 'Float', description: 'Pression ligne 1', group: 'Process', identifiant: '2', source: '' },
                { nom: 'Moteur_1', type: 'Boolean', description: 'Etat moteur', group: 'Automatisme', identifiant: '3', source: '' },
                { nom: 'Vanne_1', type: 'String', description: 'Position vanne', group: 'Automatisme', identifiant: '4', source: '' }
            ]
        },
        settings: {}
    };
}

function merge(base, loaded) {
    if (!loaded || typeof loaded !== 'object') return base;
    for (const key of Object.keys(base)) {
        if (!(key in loaded)) continue;
        const b = base[key];
        const l = loaded[key];
        if (Array.isArray(b)) {
            base[key] = Array.isArray(l) ? l : b;
        } else if (b && typeof b === 'object') {
            base[key] = merge(b, l);
        } else if (l !== undefined && l !== null) {
            base[key] = l;
        }
    }
    // conserve les cles supplementaires (ex: champs ajoutes par l'utilisateur)
    for (const key of Object.keys(loaded)) {
        if (!(key in base)) base[key] = loaded[key];
    }
    return base;
}

class Store {
    constructor() {
        this.data = defaults();
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                this.data = merge(defaults(), JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
            }
        } catch (err) {
            console.error('[store] lecture config impossible:', err.message);
        }
        return this.data;
    }

    save() {
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            const tmp = CONFIG_FILE + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
            fs.renameSync(tmp, CONFIG_FILE);
            return true;
        } catch (err) {
            console.error('[store] ecriture config impossible:', err.message);
            return false;
        }
    }

    get(key) { return this.data[key]; }

    set(key, value) {
        this.data[key] = value;
        return this.save();
    }

    update(fn) {
        const result = fn(this.data);
        this.save();
        return result === undefined ? this.data : result;
    }
}

function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

module.exports = { store: new Store(), uid, DATA_DIR, CONFIG_FILE };
