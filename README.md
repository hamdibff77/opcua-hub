# OPCUA Hub

Application web **autonome** (Node.js + interface navigateur) issue de [FUXA-OPCUA-PostgreSQL-main](../../Downloads/FUXA-OPCUA-PostgreSQL-main), composée de deux briques :

1. **Connecteurs** — driver OPC UA de FUXA adapté **et** connecteur base de données multi-SGBD inspiré du driver PostgreSQL de FUXA : PostgreSQL, MySQL/MariaDB, SQL Server, SQLite. Navigation bases → schémas/tables → colonnes, lecture de la dernière ligne (`ORDER BY … DESC LIMIT 1`), copie des adresses/nodeIds dans le presse-papiers.
2. **Générateur OPC UA externe** — pilotage de l'application `app.exe` (`C:\Users\hamdi\Downloads\opcua-generateur\opcua-generateur`) : démarrage/arrêt du processus, démarrage/arrêt de son serveur OPC UA via son API HTTP, synchronisation de `data/config.json` et `data/settings.json`, import Excel des variables.

Les sections *Historiques*, *Journaux*, *Tags* et l'ancien outil *OPC UA → PostgreSQL* ont été retirées.

---

## Démarrage rapide

```powershell
cd "C:\Users\hamdi\Documents\Projet par défaut\opcua-hub"
npm install
npm start
```

Ouvrir **http://localhost:1882**.

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `1882` | Port de l'interface web |
| `HUB_USER` / `HUB_PASSWORD` | aucun | Active l'authentification HTTP Basic |
| `OPCUA_GENERATOR_DIR` | `C:\Users\hamdi\Downloads\opcua-generateur\opcua-generateur` | Dossier de `app.exe` |
| `OPCUA_GENERATOR_EXE` | `app.exe` | Nom de l'exécutable |
| `OPCUA_GENERATOR_API` | `http://127.0.0.1:3301` | API de `app.exe` |
| `OPCUA_GENERATOR_UI` | `http://localhost:3300` | Interface propre de `app.exe` (indicative) |

Node.js **≥ 22.5** est requis.

---

## Pilotage de app.exe

`app.exe` expose une interface web sur **3300** et une API sur **3301** : `GET /api/health`, `GET/POST /api/settings`, `GET/POST /api/tags`, `DELETE /api/tags/:index`, `POST /api/tags/import`, `POST /api/server/start`, `POST /api/server/stop`.

Le module `server/generator/service.js` :

- lance le binaire s'il n'est pas déjà actif, puis attend son API ;
- appelle `POST /api/server/start` pour démarrer le serveur OPC UA ;
- récupère l'endpoint réel depuis `/api/health` (ex. `opc.tcp://CHB41TN:4000/example`) et teste l'ouverture du port ;
- arrête le serveur OPC UA via l'API puis termine le processus (`taskkill /T /F` sous Windows) ;
- réécrit `data/config.json` et `data/settings.json` à chaque modification et redémarre l'application si elle était active.

Les variables sont exposées avec des NodeId **`ns=2;s=<identifiant>`**.

Format Excel (documentation PDF fournie) : ligne d'en-tête contenant `nom` et `type`, puis `description`, `group`, `identifiant` (optionnel). Types acceptés : `Boolean`, `Int16`, `Int32`, `Int64`, `Float`, `Double`, `String`. Le nom doit commencer par une lettre ou `_` et ne contenir que lettres, chiffres et `_`.

### Démarrer depuis un fichier Excel

L'onglet *Générateur app.exe* propose une carte **Démarrer depuis un fichier Excel** :

1. cliquez sur **Choisir un .xlsx et démarrer** ;
2. le fichier est envoyé directement à l'API de `app.exe` (`POST /api/tags/import`) — les types du PDF sont conservés tels quels (`Double`, `Int64`, etc.) ;
3. le serveur OPC UA est arrêté puis redémarré avec les variables importées ;
4. le fichier est mémorisé dans `data/generator-tags.xlsx` : le bouton **Démarrer depuis le dernier Excel** permet de rejouer l'import à tout moment.

Exemple conforme au PDF :

| nom | type | description | group | identifiant |
|---|---|---|---|---|
| nom_tag1 | Boolean | tag1 description | nom_group1 | 1000 |
| nom_tag2 | Double | tag2 description | nom_group1 | 1001 |
| nom_tag3 | Int64 | tag3 description | nom_group2 | 1002 |

---

## Connecteur base de données (FUXA généralisé)

| Type | Pilote | Port par défaut |
|---|---|---|
| `POSTGRESQL` | `pg` | 5432 |
| `MYSQL` | `mysql2` | 3306 |
| `MSSQL` | `mssql` | 1433 |
| `SQLITE` | `node:sqlite` | — |

Champs : hôte/adresse (ou fichier SQLite), port, base par défaut, **colonne de tri** (`ORDER BY <colonne> DESC`), utilisateur et mot de passe. Le panneau *Parcourir* liste les bases, tables et colonnes. Le connecteur est en lecture seule.

---

## API REST

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/system` | État, compteurs, dialectes disponibles |
| GET | `/api/dialects` | Liste des SGBD supportés |
| GET/POST | `/api/connectors` | Liste / création |
| PUT/DELETE | `/api/connectors/:id` | Mise à jour / suppression |
| POST | `/api/connectors/:id/connect\|disconnect\|browse\|browseAll\|read\|write` | Opérations du connecteur |
| GET | `/api/connectors/:id/distinct?tagId=` | Valeurs distinctes d'une colonne SQL |
| POST | `/api/connectors/endpoints` | Découverte des endpoints OPC UA |
| GET | `/api/generator` | Configuration + statut réel |
| POST | `/api/generator/start\|stop\|sync` | Pilotage et synchronisation |
| POST | `/api/generator/startFromExcel` | Importe un `.xlsx` (base64) et démarre avec ses variables |
| POST | `/api/generator/startFromSavedExcel` | Rejoue le dernier fichier Excel importé |
| PUT | `/api/generator/settings` | Paramètres du serveur OPC UA |
| POST/DELETE | `/api/generator/tags`, `/api/generator/tags/:index` | Variables de app.exe |
| POST | `/api/generator/importExcel` | Import Excel |

---

## Architecture

| Brique | Fichiers de l'application | Origine FUXA / fork |
|---|---|---|
| Serveur / API | `server/main.js`, `server/api/index.js` | `server/fuxa.js`, `server/api/index.js` |
| Connecteur OPC UA | `server/connector/opcua-driver.js` | `server/runtime/devices/opcua/index.js` |
| Connecteur SQL | `server/connector/db-driver.js`, `server/connector/dialects/*` | `server/runtime/devices/postgres/index.js` |
| Utilitaires | `server/core/*` | `server/runtime/devices/device-utils.js` |
| Générateur externe | `server/generator/service.js` | application `opcua-generateur/app.exe` |
| Interface web | `web/index.html`, `styles.css`, `app.js` | interface du fork FUXA |

Données générées (non versionnées) : `data/config.json`.

---

## Tests

```powershell
node test\smoke.js     # app.exe -> connecteur OPC UA -> navigation
node test\smoke-db.js  # connecteurs PostgreSQL (port 55432) et SQLite
```

Le test PostgreSQL utilise une instance temporaire :

```powershell
$pg='C:\Program Files\PostgreSQL\17\bin'; $data="$env:TEMP\opencode\pgtest"
& "$pg\initdb.exe" -D $data -A trust -U postgres --no-instructions
& "$pg\pg_ctl.exe" -D $data -o "-p 55432 -h 127.0.0.1" -l "$data\server.log" start
& "$pg\createdb.exe" -h 127.0.0.1 -p 55432 -U postgres opcua_test
& "$pg\psql.exe" -h 127.0.0.1 -p 55432 -U postgres -d opcua_test -f test\fixture.sql
# ... tests ...
& "$pg\pg_ctl.exe" -D $data stop
```

## Limites

- MySQL et SQL Server sont implémentés mais non testés ici ; PostgreSQL et SQLite sont validés.
- Le connecteur SQL est en lecture seule.
- `app.exe` doit rester lancé pour que le connecteur OPC UA puisse naviguer sur son espace d'adressage.
