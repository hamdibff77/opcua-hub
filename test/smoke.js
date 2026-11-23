'use strict';

/** Test de bout en bout: generateur app.exe -> connecteur OPC UA -> navigation. */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:1882';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, method = 'GET', body) {
    const res = await fetch(BASE + '/api/' + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || data.ok === false) throw new Error(path + ': ' + (data.error || res.status));
    return data;
}

(async () => {
    console.log('1. Systeme:', (await api('system')).node);
    const started = await api('generator/start', 'POST');
    console.log('2. Generateur:', started.running ? 'actif' : 'inactif', started.endpoint);
    await sleep(1000);

    const connector = (await api('connectors', 'POST', {
        name: 'Test smoke', endpointUrl: 'opc.tcp://127.0.0.1:4000/example',
        polling: 500, securityMode: 'None', type: 'OPCUA'
    })).connector;
    console.log('3. Connecteur cree:', connector.id);
    console.log('4. Connexion:', (await api('connectors/' + connector.id + '/connect', 'POST')).connector.status);

    const browse = await api('connectors/' + connector.id + '/browseAll', 'POST', { options: { maxDepth: 6, maxNodes: 500 } });
    console.log('5. Variables browsees:', browse.variables.length);
    console.log('6. Exemple:', browse.variables.slice(0, 2).map(v => `${v.name}=${v.nodeId}`).join(', '));

    console.log('7. Deconnexion:', (await api('connectors/' + connector.id + '/disconnect', 'POST')).connector.status);
    console.log('8. Arret generateur:', (await api('generator/stop', 'POST')).ok);
    console.log('9. Nettoyage:', (await api('connectors/' + connector.id, 'DELETE')).ok);
    console.log('OK - test OPC UA valide');
})().catch(err => { console.error('ECHEC:', err.message); process.exitCode = 1; });
