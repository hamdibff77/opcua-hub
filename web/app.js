'use strict';

/* ============================================================
   OPCUA Hub - interface web (vanilla JS, aucun build requis)
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const state = {
    view: 'dashboard', connectors: [], generator: null, system: null, dialects: [],
    selectedConnector: null, browseNodes: [], browsePath: 'i=85'
};

const TITLES = {
    dashboard: ['Tableau de bord', "Vue d'ensemble des connecteurs et du générateur"],
    connectors: ['Connecteurs', 'OPC UA et bases de données (PostgreSQL, MySQL, SQL Server, SQLite)'],
    generator: ['Générateur OPC UA', 'Pilotage de l’application externe app.exe']
};

/* ------------------------------- API ---------------------------------- */

async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' } };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    let res, data;
    try {
        res = await fetch('/api/' + path, init);
        data = await res.json();
    } catch (err) {
        throw new Error('Serveur injoignable: ' + err.message);
    }
    if (!res.ok || data.ok === false) throw new Error(data.error || 'Erreur HTTP ' + res.status);
    return data;
}
const get = p => api(p);
const post = (p, b) => api(p, { method: 'POST', body: b === undefined ? {} : b });
const put = (p, b) => api(p, { method: 'PUT', body: b === undefined ? {} : b });
const del = p => api(p, { method: 'DELETE' });

function toast(message, type = 'ok') {
    const el = $('#toast');
    el.textContent = message;
    el.className = 'toast ' + type;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), 3800);
}
function fail(err) { toast(err.message || String(err), 'error'); }
function busy(btn) { btn.disabled = true; const old = btn.innerHTML; btn.innerHTML = '<span class="dot warn"></span> ...'; return () => { btn.disabled = false; btn.innerHTML = old; }; }

function showModal(html) {
    const m = $('#modal');
    m.innerHTML = '<div class="modal-box">' + html + '</div>';
    m.classList.remove('hidden');
}
function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

function selectOptions(items, selected, valueKey, labelKey) {
    return items.map(i => {
        const v = typeof i === 'object' ? i[valueKey || 'id'] : i;
        const l = typeof i === 'object' ? (i[labelKey || 'name'] || i[valueKey || 'id']) : i;
        return `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('');
}
function formVal(name, root) { const el = $(`[name="${name}"]`, root); return el ? el.value : undefined; }
function formChecked(name, root) { const el = $(`[name="${name}"]`, root); return !!(el && el.checked); }

/* ---------------------------- Rafraichissement ------------------------- */

async function refreshBase() {
    const [c, sys, gen] = await Promise.all([
        get('connectors'), get('system'), get('generator')
    ]);
    state.connectors = c.connectors || [];
    state.system = sys;
    state.generator = gen;
    state.dialects = sys.dialects || [];
    updateChrome();
}

function updateChrome() {
    const s = state.system || {};
    const badgeO = $('#badgeOpcua');
    badgeO.textContent = s.nodeOpcua ? 'node-opcua ✓' : 'node-opcua ✗';
    badgeO.className = 'badge ' + (s.nodeOpcua ? 'ok' : 'err');
    const badgeT = $('#badgeTransfer');
    const running = s.generator && s.generator.running;
    badgeT.textContent = running ? `Générateur #${s.generator.pid}` : 'Générateur arrêté';
    badgeT.className = 'badge ' + (running ? 'ok' : '');
    $('#footInfo').textContent = `${s.connectors || 0} connecteurs`;
    $('#apiState').textContent = 'Serveur connecté';
    $('#apiDot').className = 'dot ok';
}

/* -------------------------------- Routeur ------------------------------ */

function navigate(view) { location.hash = view; }

async function render() {
    const view = (location.hash || '#dashboard').slice(1) || 'dashboard';
    state.view = TITLES[view] ? view : 'dashboard';
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    $('#viewTitle').textContent = TITLES[state.view][0];
    $('#viewSubtitle').textContent = TITLES[state.view][1];
    try {
        await refreshBase();
    } catch (err) {
        $('#apiState').textContent = err.message;
        $('#apiDot').className = 'dot err';
    }
    // Remplace le noeud de contenu pour eviter l'accumulation d'ecouteurs entre les vues.
    const previous = $('#content');
    const c = previous.cloneNode(false);
    previous.replaceWith(c);
    try {
        ({ dashboard: viewDashboard, connectors: viewConnectors,
            generator: viewGenerator })[state.view](c);
    } catch (err) {
        c.innerHTML = `<div class="card"><div class="card-body"><p class="muted">Erreur d'affichage: ${esc(err.message)}</p></div></div>`;
        fail(err);
    }
}

$('#nav').addEventListener('click', e => {
    const item = e.target.closest('.nav-item');
    if (item) navigate(item.dataset.view);
});
window.addEventListener('hashchange', render);

setInterval(() => {
    $('#clock').textContent = new Date().toLocaleTimeString('fr-FR');
    if (state.view === 'dashboard') render().catch(fail);
    else updateChrome();
}, 3000);
$('#clock').textContent = new Date().toLocaleTimeString('fr-FR');

/* ------------------------------- VUES ---------------------------------- */

/* ---------- Tableau de bord ---------- */
function viewDashboard(c) {
    const s = state.system || {};
    const gen = state.generator;
    c.innerHTML = `
    <div class="stack">
      <div class="grid cols-3">
        <div class="card stat"><div class="stat-label">Connecteurs</div><div class="stat-value">${s.connectors || 0}</div><div class="stat-sub">${state.connectors.filter(x => x.connected).length} connecté(s)</div></div>
        <div class="card stat"><div class="stat-label">Dialectes SQL</div><div class="stat-value">${state.dialects.length}</div><div class="stat-sub">PostgreSQL, MySQL, SQL Server, SQLite</div></div>
        <div class="card stat"><div class="stat-label">Générateur app.exe</div><div class="stat-value" style="color:${gen && gen.status.running ? 'var(--ok)' : 'var(--muted)'}">${gen && gen.status.running ? 'ACTIF' : 'ARRÊTÉ'}</div><div class="stat-sub">${gen && gen.status.pid ? 'PID ' + gen.status.pid : (gen && gen.status.portOpen ? 'endpoint joignable' : 'endpoint indisponible')}</div></div>
      </div>
      <div class="grid cols-2">
        <div class="card">
          <div class="card-head"><h2>Connecteurs</h2><button class="btn sm" data-go="connectors">Gérer →</button></div>
          <div class="card-body">${state.connectors.length ? state.connectors.map(cfg => `
            <div class="list-item"><div><strong>${esc(cfg.name)}</strong><small class="mono">${esc(cfg.endpointUrl || (cfg.property ? cfg.property.address : ''))}</small></div>
              <span class="badge ${cfg.connected ? 'ok' : ''}">${esc(cfg.status)}</span></div>`).join('')
              : '<div class="empty">Aucun connecteur. Créez-en un dans l’onglet Connecteurs.</div>'}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Générateur OPC UA</h2><button class="btn sm" data-go="generator">Configurer →</button></div>
          <div class="card-body stack">
            <div class="row spread"><div><div class="stat-label">État</div><div style="font-weight:600">${gen && gen.status.running ? 'En cours d’exécution' : 'Arrêté'}</div></div>
              <span class="badge ${gen && gen.status.running ? 'ok' : ''}">${gen ? gen.status.count : 0} variables</span></div>
            <div class="mono hint">${esc(gen ? gen.status.url : '')}</div>
            <div class="hint mono">${esc(gen ? gen.status.exe : '')}</div>
            <div class="row"><button class="btn ${gen && gen.status.running ? 'danger' : 'primary'}" data-gen-toggle>${gen && gen.status.running ? 'Arrêter' : 'Démarrer'}</button>
              <button class="btn" data-go="generator">Piloter l’application →</button></div>
          </div>
        </div>
      </div>
    </div>`;
    c.addEventListener('click', e => {
        const go = e.target.closest('[data-go]');
        if (go) navigate(go.dataset.go);
        if (e.target.closest('[data-gen-toggle]')) {
            const running = gen && gen.status.running;
            post('generator/' + (running ? 'stop' : 'start')).then(() => { toast(running ? 'Générateur arrêté' : 'Générateur démarré'); render(); }).catch(fail);
        }
    });
}

/* ---------- Connecteurs (OPC UA + bases de données) ---------- */
function isDbType(type) { return ['POSTGRESQL', 'MYSQL', 'MSSQL', 'SQLITE'].includes(String(type || '')); }
function dialectInfo(key) {
    return state.dialects.find(d => d.key === key) || { key, label: key, defaultPort: 0, defaultDatabase: '' };
}
function connectorTypeOptions(selected) {
    const items = [{ key: 'OPCUA', label: 'OPC UA' }, ...state.dialects];
    return items.map(i => `<option value="${esc(i.key)}" ${i.key === selected ? 'selected' : ''}>${esc(i.label)}</option>`).join('');
}
function opcFieldsHtml(cfg) {
    return `<div class="form-grid three">
      <label class="field"><span>Endpoint OPC UA</span><input name="endpointUrl" class="mono-input" value="${esc(cfg.endpointUrl || 'opc.tcp://127.0.0.1:4000/example')}"></label>
      <label class="field"><span>Mode de sécurité</span><select name="securityMode">${selectOptions(['None', 'Sign', 'SignAndEncrypt'], cfg.securityMode || 'None')}</select></label>
      <label class="field"><span>Security policy</span><select name="securityPolicy">${selectOptions(['None', 'Basic128Rsa15', 'Basic256', 'Basic256Sha256', 'Aes128_Sha256_RsaOaep'], cfg.securityPolicy || 'None')}</select></label>
      <label class="field"><span>Utilisateur (optionnel)</span><input name="user" value="${esc(cfg.user || '')}"></label>
      <label class="field"><span>Mot de passe</span><input name="password" type="password" value="${esc(cfg.password || '')}"></label>
    </div>`;
}
function dbFieldsHtml(type, p) {
    const d = dialectInfo(type);
    const sqlite = type === 'SQLITE';
    return `<div class="form-grid four">
      <label class="field"><span>${sqlite ? 'Fichier .db (chemin)' : 'Hôte / adresse'}</span><input name="address" class="mono-input" value="${esc(p.address || (sqlite ? 'local.db' : 'localhost'))}"></label>
      ${sqlite ? '' : `<label class="field"><span>Port</span><input name="port" type="number" value="${esc(p.port || d.defaultPort)}"></label>`}
      <label class="field"><span>Base par défaut</span><input name="database" value="${esc(p.database || d.defaultDatabase)}"></label>
      <label class="field"><span>Colonne de tri (ORDER BY … DESC)</span><input name="orderBy" class="mono-input" value="${esc(p.orderBy || '')}" placeholder="ex: Date et heure"></label>
      ${sqlite ? '' : `
      <label class="field"><span>Utilisateur</span><input name="user" value="${esc(p.user || '')}"></label>
      <label class="field"><span>Mot de passe</span><input name="password" type="password" value="${esc(p.password || '')}"></label>`}
      ${type === 'POSTGRESQL' ? `<label class="field"><span class="row"><input type="checkbox" name="ssl" ${p.ssl ? 'checked' : ''}> SSL</span></label>` : ''}
    </div><div class="hint" style="margin-top:8px">Lecture seule. Adresse des tags : <span class="mono">base|schéma|table|colonne</span> (ou 3 parties pour un tag objet). La colonne de tri est appliquée à toutes les lectures.</div>`;
}
function connectorFieldsHtml(cfg) {
    const type = cfg.type || 'OPCUA';
    return `<div class="form-grid three">
      <label class="field"><span>Nom</span><input name="name" value="${esc(cfg.name || '')}"></label>
      <label class="field"><span>Type de connecteur</span><select name="type" data-type-select>${connectorTypeOptions(type)}</select></label>
      <label class="field"><span>Polling (ms)</span><input name="polling" type="number" min="200" value="${esc(cfg.polling || 1000)}"></label>
    </div><div id="typeFields" style="margin-top:12px">${isDbType(type)
        ? dbFieldsHtml(type, { ...(cfg.property || {}), user: cfg.user, password: cfg.password, ssl: cfg.ssl })
        : opcFieldsHtml(cfg)}</div>`;
}
function bindTypeSelect(root) {
    const sel = $('[data-type-select]', root);
    if (!sel) return;
    sel.onchange = () => {
        const holder = $('#typeFields', root);
        holder.innerHTML = isDbType(sel.value) ? dbFieldsHtml(sel.value, {}) : opcFieldsHtml({});
    };
}
function collectConnectorForm(f) {
    const type = formVal('type', f) || 'OPCUA';
    const payload = { name: formVal('name', f), polling: Number(formVal('polling', f)) || 1000, type };
    if (isDbType(type)) {
        payload.property = {
            address: formVal('address', f), port: Number(formVal('port', f)) || 0,
            database: formVal('database', f) || dialectInfo(type).defaultDatabase,
            orderBy: formVal('orderBy', f) || ''
        };
        payload.user = formVal('user', f);
        payload.password = formVal('password', f);
        payload.ssl = formChecked('ssl', f);
    } else {
        payload.endpointUrl = formVal('endpointUrl', f);
        payload.securityMode = formVal('securityMode', f);
        payload.securityPolicy = formVal('securityPolicy', f);
        payload.user = formVal('user', f);
        payload.password = formVal('password', f);
    }
    return payload;
}

function viewConnectors(c) {
    c.innerHTML = `<div class="grid" style="grid-template-columns:310px minmax(0,1fr)">
      <div class="card"><div class="card-head"><h2>Connecteurs</h2><button class="btn primary sm" data-act="new">+ Nouveau</button></div>
        <div class="card-body" id="connList">${connectorListHtml()}</div></div>
      <div id="connDetail"></div>
    </div>`;
    const selected = state.connectors.find(x => x.id === state.selectedConnector) || state.connectors[0];
    state.selectedConnector = selected ? selected.id : null;
    renderConnectorDetail(selected);

    c.addEventListener('click', async e => {
        const item = e.target.closest('[data-conn]');
        if (item) { state.selectedConnector = item.dataset.conn; renderConnectorDetail(state.connectors.find(x => x.id === state.selectedConnector)); return; }
        if (e.target.closest('[data-act="new"]')) return openConnectorModal();
        const btn = e.target.closest('[data-cact]');
        if (!btn) return;
        const cfg = state.connectors.find(x => x.id === state.selectedConnector);
        if (!cfg) return;
        const action = btn.dataset.cact;
        const stop = busy(btn);
        try {
            if (action === 'save') {
                await put('connectors/' + cfg.id, collectConnectorForm($('#connForm')));
                toast('Connecteur enregistré');
            } else if (action === 'delete') {
                if (!confirm('Supprimer ce connecteur ?')) return stop();
                await del('connectors/' + cfg.id); state.selectedConnector = null; toast('Connecteur supprimé');
            } else if (action === 'connect' || action === 'disconnect') {
                await post('connectors/' + cfg.id + '/' + action);
                toast(action === 'connect' ? 'Connexion établie' : 'Déconnecté');
            } else if (action === 'endpoints') {
                const r = await post('connectors/endpoints', { endpointUrl: formVal('endpointUrl', $('#connForm')) });
                return showEndpoints(r.endpoints);
            } else if (action === 'browse') {
                await doBrowse(cfg.id, formVal('browseNode', $('#connDetail')) || (isDbType(cfg.type) ? '' : 'i=85'));
                return;
            } else if (action === 'browseAll') {
                const r = await post('connectors/' + cfg.id + '/browseAll', { options: { maxDepth: 6, maxNodes: 3000 } });
                return showBrowseResults(r.variables || []);
            }
            await render();
        } catch (err) { fail(err); } finally { stop(); }
    });
}

function connectorListHtml() {
    if (!state.connectors.length) return '<div class="empty">Aucun connecteur. Créez-en un pour commencer.</div>';
    return state.connectors.map(cfg => `
      <div class="list-item ${cfg.id === state.selectedConnector ? 'active' : ''}" data-conn="${esc(cfg.id)}">
        <div><strong>${esc(cfg.name)}</strong><small class="mono">${esc(cfg.endpointUrl || (cfg.property ? cfg.property.address + (cfg.property.database ? '/' + cfg.property.database : '') : ''))}</small></div>
        <span class="dot ${cfg.connected ? 'ok' : 'err'}" title="${esc(cfg.status)}"></span>
      </div>`).join('');
}

function renderConnectorDetail(cfg) {
    const el = $('#connDetail');
    if (!cfg) {
        el.innerHTML = '<div class="card"><div class="empty">Sélectionnez ou créez un connecteur.</div></div>';
        return;
    }
    const db = isDbType(cfg.type);
    el.innerHTML = `
    <div class="stack">
      <div class="card"><div class="card-head"><h2>${esc(cfg.name)}</h2>
        <span class="badge ${cfg.connected ? 'ok' : 'err'}">${esc(cfg.status)}</span></div>
        <div class="card-body">
          <div id="connForm">${connectorFieldsHtml(cfg)}</div>
          <div class="divider"></div>
          <div class="row">
            <button class="btn primary" data-cact="save">Enregistrer</button>
            <button class="btn ${cfg.connected ? '' : 'ok'}" data-cact="${cfg.connected ? 'disconnect' : 'connect'}">${cfg.connected ? 'Déconnecter' : 'Connecter'}</button>
            ${db ? '' : '<button class="btn" data-cact="endpoints">Endpoints…</button>'}
            <button class="btn danger" data-cact="delete">Supprimer</button>
          </div>
          <div class="hint" style="margin-top:8px">${esc(cfg.dialectLabel || (db ? cfg.type : 'OPC UA'))} · ${esc(cfg.tagCount)} tag(s) · dernier balayage: ${cfg.lastRead ? esc(new Date(cfg.lastRead).toLocaleTimeString('fr-FR')) : '—'}</div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Navigation ${db ? 'SQL' : 'OPC UA'}</h2><span class="hint">Cliquez sur un dossier pour l'explorer</span></div>
        <div class="card-body stack">
          <div class="row"><input name="browseNode" style="flex:1" class="mono-input" value="${esc(db ? '' : state.browsePath)}" placeholder="${db ? 'vide = liste des bases' : 'i=85'}">
            <button class="btn" data-cact="browse">Parcourir</button>${db ? '' : '<button class="btn" data-cact="browseAll">Toutes les variables</button>'}</div>
          <div id="browseResult" class="check-list"><div class="empty">Connectez-vous puis parcourez l'arborescence.</div></div>
        </div>
      </div>
    </div>`;
    bindTypeSelect(el);
}

function openConnectorModal() {
    const cfg = { type: 'OPCUA', name: 'Serveur OPC UA', polling: 1000 };
    showModal(`<div class="modal-head"><h3>Nouveau connecteur</h3><button class="btn ghost sm" data-close>✕</button></div>
      <form id="newConnForm"><div class="modal-body">${connectorFieldsHtml(cfg)}</div>
      <div class="modal-foot"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary" type="submit">Créer</button></div></form>`);
    $$('#modal [data-close]').forEach(b => b.onclick = closeModal);
    bindTypeSelect($('#modal'));
    $('#newConnForm').onsubmit = async e => {
        e.preventDefault();
        try {
            await post('connectors', collectConnectorForm(e.target));
            closeModal(); toast('Connecteur créé'); render();
        } catch (err) { fail(err); }
    };
}

function showEndpoints(endpoints) {
    showModal(`<div class="modal-head"><h3>Endpoints disponibles</h3><button class="btn ghost sm" data-close>✕</button></div>
      <div class="modal-body">${endpoints.length ? endpoints.map(e => `<div class="list-item"><div><strong>${esc(e.securityMode)}</strong>
        <small class="mono">${esc(e.endpointUrl)} · ${esc(e.securityPolicy)}</small></div>
        <button class="btn sm" data-endpoint="${esc(e.endpointUrl)}" data-mode="${esc(e.securityMode)}" data-policy="${esc(e.securityPolicy)}">Utiliser</button></div>`).join('') : '<div class="empty">Aucun endpoint</div>'}</div>`);
    $$('#modal [data-close]').forEach(b => b.onclick = closeModal);
    $$('#modal [data-endpoint]').forEach(b => b.onclick = () => {
        const f = $('#connForm');
        $('[name="endpointUrl"]', f).value = b.dataset.endpoint;
        $('[name="securityMode"]', f).value = b.dataset.mode === 'SignAndEncrypt' ? 'SignAndEncrypt' : b.dataset.mode === 'Sign' ? 'Sign' : 'None';
        $('[name="securityPolicy"]', f).value = b.dataset.policy.includes('Basic256Sha256') ? 'Basic256Sha256' : 'None';
        closeModal(); toast('Endpoint appliqué — n’oubliez pas d’enregistrer');
    });
}

async function doBrowse(connectorId, nodeId) {
    state.browsePath = nodeId;
    const box = $('#browseResult');
    if (!box) return;
    box.innerHTML = '<div class="empty">Lecture…</div>';
    try {
        const r = await post('connectors/' + connectorId + '/browse', { nodeId });
        state.browseNodes = r.nodes || [];
        box.innerHTML = state.browseNodes.length ? state.browseNodes.map(n => `
          <div class="tree-node">
            <span class="dot ${n.isVariable ? '' : 'warn'}"></span>
            <span class="tree-name ${n.isVariable ? 'var-name' : ''}">${esc(n.name)}</span>
            <span class="mono hint" style="max-width:45%;overflow:hidden;text-overflow:ellipsis">${esc(n.id)}</span>
            ${n.isVariable
                ? `<button class="btn sm" data-copy="${esc(n.id)}">Copier</button>`
                : `<button class="btn sm" data-open="${esc(n.id)}">Ouvrir</button>`}
          </div>`).join('') : '<div class="empty">Aucun enfant</div>';
        box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
            $('[name="browseNode"]', $('#connDetail')).value = b.dataset.open;
            doBrowse(connectorId, b.dataset.open);
        });
        box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
            navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Adresse copiée')).catch(() => toast(b.dataset.copy));
        });
    } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

function showBrowseResults(variables) {
    showModal(`<div class="modal-head"><h3>Variables trouvées (${variables.length})</h3><button class="btn ghost sm" data-close>✕</button></div>
      <div class="modal-body"><input id="varFilter" placeholder="Filtrer…" style="margin-bottom:10px">
      <div class="check-list" id="varList">${variables.map(v => `<div class="tree-node" data-varname="${esc((v.name || '').toLowerCase())}"><span class="tree-name var-name">${esc(v.name)}</span>
        <span class="mono hint">${esc(v.nodeId)}</span><button class="btn sm" data-copy="${esc(v.nodeId)}">Copier</button></div>`).join('') || '<div class="empty">Aucune variable</div>'}</div></div>`);
    $$('#modal [data-close]').forEach(b => b.onclick = closeModal);
    $('#varFilter').oninput = e => {
        const q = e.target.value.toLowerCase();
        $$('#varList .tree-node').forEach(n => n.style.display = n.dataset.varname.includes(q) ? '' : 'none');
    };
    $$('#modal [data-copy]').forEach(b => b.onclick = () => {
        navigator.clipboard.writeText(b.dataset.copy).then(() => toast('NodeId copié')).catch(() => toast(b.dataset.copy));
    });
}

/* ---------- Générateur ---------- */
function viewGenerator(c) {
    const cfg = state.generator.config;
    const st = state.generator.status;
    c.innerHTML = `<div class="stack">
      <div class="card"><div class="card-head"><h2>Application OPC UA Generateur (app.exe)</h2>
        <span class="badge ${st.running ? 'ok' : ''}">${st.running ? 'EN COURS · PID ' + st.pid : 'ARRÊTÉ'}</span></div>
        <div class="card-body stack">
          <div class="grid cols-3">
            <div class="stat"><div class="stat-label">Exécutable</div><div class="hint mono" style="margin-top:6px;word-break:break-all">${esc(st.exe)}</div>
              <div class="stat-sub">${st.exeExists ? 'présent' : 'INTROUVABLE — vérifiez OPCUA_GENERATOR_DIR'}</div></div>
            <div class="stat"><div class="stat-label">Endpoint OPC UA</div><div class="mono" style="margin-top:6px">${esc(st.url)}</div>
              <div class="stat-sub">port ${st.portOpen ? 'joignable' : 'non joignable'}</div></div>
            <div class="stat"><div class="stat-label">Variables</div><div class="stat-value">${st.count}</div>
              <div class="stat-sub">${st.startedAt ? 'depuis ' + esc(new Date(st.startedAt).toLocaleTimeString('fr-FR')) : 'jamais démarré'}</div></div>
          </div>
          <div class="row">
            <button class="btn ${st.running ? 'danger' : 'primary'}" data-gact="${st.running ? 'stop' : 'start'}">${st.running ? 'Arrêter app.exe' : 'Démarrer app.exe'}</button>
            <button class="btn" data-gact="makeConnector">Créer un connecteur OPC UA pour cet endpoint</button>
            <span class="hint">Configuration synchronisée avec <span class="mono">${esc(st.appDir)}\\data</span></span>
          </div>
          ${st.output && st.output.length ? `<div class="logbox" style="height:120px;margin-top:12px">${st.output.map(o =>
              `<div class="log-line"><span class="time">${esc(o.ts.slice(11, 19))}</span>${esc(o.line)}</div>`).join('')}</div>` : ''}
        </div></div>

      <div class="card"><div class="card-head"><h2>Démarrer depuis un fichier Excel</h2>
        <span class="badge">format du PDF</span></div>
        <div class="card-body stack">
          <div class="hint">En-tête : <span class="mono">nom | type | description | group | identifiant(optionnel)</span>. Types : <span class="mono">Boolean, Int16, Int32, Int64, Float, Double, String</span>. Le nom commence par une lettre ou <span class="mono">_</span> et ne contient que lettres, chiffres et <span class="mono">_</span>.</div>
          <div class="row">
            <label class="btn primary">Choisir un .xlsx et démarrer<input type="file" id="excelStartFile" accept=".xlsx,.xls" hidden></label>
            <button class="btn" data-gact="excelRestart" ${st.excelFile ? '' : 'disabled'}>Démarrer depuis le dernier Excel</button>
          </div>
          ${st.excel
              ? `<div class="hint">Dernier import : <span class="mono">${esc(st.excel.name)}</span> · ${st.excel.count} variables · ${esc(new Date(st.excel.importedAt).toLocaleString('fr-FR'))}</div>`
              : '<div class="hint">Aucun fichier Excel importé pour le moment.</div>'}
        </div></div>

      <div class="card"><div class="card-head"><h2>Paramètres du serveur OPC UA</h2>
        <button class="btn primary sm" data-gact="saveSettings">Enregistrer</button></div>
        <div class="card-body"><div class="form-grid four" id="genSettings">
          <label class="field"><span>IP</span><input name="ip" value="${esc(cfg.settings.ip)}"></label>
          <label class="field"><span>Port</span><input name="port" type="number" value="${esc(cfg.settings.port)}"></label>
          <label class="field"><span>Chemin ressource</span><input name="resourcePath" value="${esc(cfg.settings.resourcePath)}"></label>
          <label class="field"><span>Dossier racine</span><input name="rootFolderName" value="${esc(cfg.settings.rootFolderName)}"></label>
        </div><div class="hint" style="margin-top:8px">Toute modification enregistrée redémarre app.exe s'il est en cours d'exécution.</div></div></div>

      <div class="card"><div class="card-head"><h2>Variables exposées (${(cfg.tags || []).length})</h2>
        <div class="row"><button class="btn primary sm" data-gact="addTag">+ Ajouter</button></div></div>
        <div class="table-wrap"><table><thead><tr><th>Nom</th><th>Type</th><th>Groupe</th><th>Identifiant</th><th>NodeId OPC UA</th><th>Description</th><th></th></tr></thead>
          <tbody>${(cfg.tags || []).map((t, i) => `<tr data-row="${i}">
            <td><input data-field="nom" value="${esc(t.nom)}"></td>
            <td><select data-field="type">${selectOptions(['Boolean', 'Int16', 'Int32', 'Int64', 'Float', 'Double', 'String'], t.type)}</select></td>
            <td><input data-field="group" value="${esc(t.group)}"></td>
            <td><input data-field="identifiant" value="${esc(t.identifiant)}"></td>
            <td class="mono hint">ns=2;s=${esc(t.identifiant)}</td>
            <td><input data-field="description" value="${esc(t.description)}"></td>
            <td class="row"><button class="btn sm" data-gact="saveTag" data-index="${i}">✓</button>
              <button class="btn sm danger" data-gact="delTag" data-index="${i}">✕</button></td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Aucune variable</div></td></tr>'}</tbody></table></div>
        <div class="card-body hint">Ces variables peuvent aussi être remplacées en une fois depuis un fichier Excel (voir carte ci-dessus).</div>
      </div>
    </div>`;

    c.addEventListener('click', async e => {
        const btn = e.target.closest('[data-gact]');
        if (!btn) return;
        const a = btn.dataset.gact;
        const stop = busy(btn);
        try {
            if (a === 'start' || a === 'stop') {
                await post('generator/' + a);
                toast(a === 'start' ? 'app.exe démarré' : 'app.exe arrêté');
            } else if (a === 'excelRestart') {
                const r = await post('generator/startFromSavedExcel');
                toast(`${r.imported} variables reimportées — serveur OPC UA démarré`);
            } else if (a === 'saveSettings') {
                const f = $('#genSettings');
                const r = await put('generator/settings', {
                    ip: formVal('ip', f), port: Number(formVal('port', f)),
                    resourcePath: formVal('resourcePath', f), rootFolderName: formVal('rootFolderName', f)
                });
                toast(r.restarted ? 'Paramètres enregistrés — app.exe redémarré' : 'Paramètres enregistrés');
            } else if (a === 'makeConnector') {
                await post('connectors', { name: 'Générateur externe', endpointUrl: st.url, polling: 500, securityMode: 'None', type: 'OPCUA' });
                toast('Connecteur OPC UA créé'); navigate('connectors'); return;
            } else if (a === 'addTag') {
                await post('generator/tags', { nom: 'NouvelleVariable', type: 'Float', group: 'default', identifiant: String(cfg.tags.length + 1) });
                toast('Variable ajoutée');
            } else if (a === 'saveTag') {
                const row = $(`[data-row="${btn.dataset.index}"]`);
                const body = {};
                $$('[data-field]', row).forEach(inp => body[inp.dataset.field] = inp.value);
                const r = await put('generator/tags/' + btn.dataset.index, body);
                toast(r.restarted ? 'Variable enregistrée — app.exe redémarré' : 'Variable enregistrée');
            } else if (a === 'delTag') {
                if (!confirm('Supprimer cette variable ?')) return stop();
                await del('generator/tags/' + btn.dataset.index);
                toast('Variable supprimée');
            }
            await render();
        } catch (err) { fail(err); } finally { stop(); }
    });

    $('#excelStartFile').onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const r = await post('generator/startFromExcel', { data: reader.result, name: file.name });
                toast(`${r.imported} variables importées depuis ${file.name} — serveur OPC UA démarré`);
                render();
            } catch (err) { fail(err); }
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };
}

render();
