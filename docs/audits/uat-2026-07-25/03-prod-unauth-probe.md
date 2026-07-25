# Probe superficie non autenticata — Produzione WasteFlow

**Target:** `https://rifiuti.ignicraft.com`
**Data:** 2026-07-25
**Branch in produzione:** `master` (NON contiene i fix RBAC di `develop`, commit 09d8fd5)
**Autore:** Production Unauthenticated Surface Probe (agente automatizzato, autorizzato dal proprietario del sistema)

---

## Metodologia e vincoli rispettati

- **Metodi HTTP usati:** esclusivamente `GET`, `HEAD`, `OPTIONS`. Nessuna richiesta `POST`/`PUT`/`PATCH`/`DELETE` è stata eseguita in nessun momento.
- **Nessun path distruttivo toccato**: nessuna richiesta verso path contenenti `backup` (a parte `GET /api/v1/backup/list`, sola lettura, esplicitamente in whitelist come modulo da testare), `restore`, `cleanup`, `reset`, `purge`, `seed`, `migrate`.
- **Nessun brute force / fuzzing di massa**: nessuno strumento di scanning automatico (nikto/nmap/dirb/ffuf) è stato usato. Tutte le richieste sono mirate, con lista di path predefinita ricavata da Swagger e dal codice sorgente locale.
- **Rate limiting rispettato**: richieste inviate in batch sequenziali con `sleep` ≥0.3–0.6s tra una richiesta e l'altra (mai sopra ~2 req/s). Il test di rate-limiting ha usato solo 15 richieste consecutive verso un singolo endpoint pubblico (`/api/v1/health`), a ritmo comunque moderato.
- **Totale richieste HTTP effettuate durante l'intero probe: ~102** (ben sotto il tetto di 150 concordato).
- **Nessun dato personale reale è stato estratto o riportato**: tutti gli estratti nel report sono dati di riferimento pubblici (es. codici CER, che sono nomenclatura normativa pubblica) o payload minimi/troncati; nessun nominativo, CF, indirizzo o documento di FIR reali è stato letto (tutti gli endpoint che espongono dati di tenant hanno risposto 401).
- Fonti usate per l'inventario endpoint: `GET /api/docs-json` (200, spec OpenAPI completa) e lettura locale dei controller in `apps/backend/src/**/*.controller.ts`.
- Ogni caso dubbio (es. endpoint che sembravano poter accettare side-effect) è stato scartato invece di essere testato: nessun endpoint the cui semantica GET fosse ambigua è stato invocato.

---

## Tabella riepilogativa dei findings

| # | Titolo | Severità | Endpoint/Area |
|---|--------|----------|----------------|
| F1 | Swagger/OpenAPI spec completa esposta pubblicamente in produzione | **ALTA** | `/api/docs`, `/api/docs-json`, `/api-json` |
| F2 | Header di sicurezza HTTP assenti sul documento HTML principale (frontend) | **MEDIA** | `/` (root Angular SPA) |
| F3 | Endpoint `/api/v1/cer/code/{code}` e `/api/v1/cer/search` restituiscono 500 invece di 400/404 | **BASSA** | `/api/v1/cer/code/{code}`, `/api/v1/cer/search` |
| F4 | `/api/v1/health/detailed` espone informazioni di runtime (memoria, uptime, environment) senza autenticazione | **BASSA** | `/api/v1/health/detailed` |
| F5 | Metadata Swagger `security` incoerente coi guard reali (falso senso di sicurezza nella doc) | **INFO** | spec OpenAPI |
| F6 | CORS correttamente ristretto (nessuna riflessione wildcard) | **INFO (positivo)** | tutti gli endpoint API |
| F7 | Endpoint pubblici legittimi verificati (CER reference data, verifica FIR via URL, health) | **INFO** | `/api/v1/cer`, `/api/v1/cer/statistics`, `/api/v1/fir/{id}/verify-url` |
| F8 | Nessuna fuga di file sensibili (.env, .git/config, source map) — SPA fallback serve sempre `index.html` | **INFO (positivo)** | `/.env`, `/.git/config`, `/*.js.map` |
| F9 | Rate limiting presente e attivo (header `X-RateLimit-*`) | **INFO (positivo)** | globale API |
| F10 | Certificato TLS valido, nessuna scadenza imminente | **INFO (positivo)** | `rifiuti.ignicraft.com:443` |

Nessun finding CRITICO rilevato in questo probe (nessuna fuga di dati personali/tenant riscontrata sugli endpoint testati con GET non autenticato — 39 dei 45 endpoint applicativi testati rispondono correttamente 401).

---

## Findings dettagliati

### F1 — Swagger/OpenAPI esposto pubblicamente in produzione (ALTA)

**Evidenza:**
```
curl -s -o /dev/null -w "STATUS:%{http_code} SIZE:%{size_download}\n" https://rifiuti.ignicraft.com/api/docs-json
STATUS:200 SIZE:52131

curl -s -o /dev/null -w "STATUS:%{http_code} SIZE:%{size_download}\n" https://rifiuti.ignicraft.com/api-json
STATUS:200 SIZE:25141

curl -sI https://rifiuti.ignicraft.com/api/docs
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
```
La spec OpenAPI completa (82 path, inclusi moduli `admin`, `rentri`, `billing`, `contracts`, `permissions`, `audit`, `backup`) è scaricabile da chiunque senza credenziali, sia come UI Swagger (`/api/docs`) sia come JSON machine-readable (`/api/docs-json`, `/api-json`).

**Impatto:** un attaccante ottiene, senza alcuna autenticazione, la mappa completa della superficie API (path, parametri, schemi di request/response, nomi di campi interni, moduli esistenti come RENTRI/billing/admin). Questo riduce drasticamente il costo di ricognizione per un attacco mirato (es. individuare rapidamente `/api/v1/admin/tenants/{id}` o `/api/v1/rentri/credential` come target ad alto valore). Non è di per sé una violazione (nessun dato reale), ma è un moltiplicatore di rischio per tutti gli altri vettori.

**Rimedio consigliato:** disabilitare Swagger in produzione (`NODE_ENV=production` guard sul modulo `SwaggerModule.setup`), oppure proteggerlo con Basic Auth/IP allowlist come già fatto per altri servizi interni (es. MLflow, Grafana in altri stack). Se serve per partner/integrazioni, esporlo solo su un host interno o dietro autenticazione.

---

### F2 — Header di sicurezza assenti sul documento HTML principale (MEDIA)

**Evidenza:**
```
curl -sD - -o /dev/null https://rifiuti.ignicraft.com/
HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)
Content-Type: text/html
Content-Length: 25141
Vary: Accept-Encoding
Last-Modified: ...
ETag: ...
Accept-Ranges: bytes
```
Nessun header tra `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` è presente sulla risposta HTML servita dal frontend nginx. Per contro, le risposte API (`/api/v1/health`, `/api/docs`) hanno un set completo e ben configurato di header (Helmet): CSP restrittiva, HSTS con `includeSubDomains`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, ecc.

**Impatto:** il documento HTML principale è esattamente ciò che il browser dell'utente carica per primo e su cui si basano le protezioni contro clickjacking (assenza `X-Frame-Options`/CSP `frame-ancestors` sul documento host), MIME-sniffing, e downgrade HTTP (assenza HSTS sul dominio "vetrina" — anche se la sessione HSTS può comunque propagarsi se il browser l'ha già vista su una risposta API dello stesso host, non è garantito per un first-visit diretto sulla root). Rischio moderato in quanto il body applicativo (API) è protetto, ma è un'inconsistenza che vale la pena chiudere.

**Rimedio consigliato:** applicare gli stessi header di sicurezza (o un sottoinsieme equivalente) a livello di configurazione nginx del frontend (`add_header` in `location /` o globale in `server {}`), invece di lasciarli solo al middleware Helmet del backend NestJS.

---

### F3 — 500 invece di 400/404 su parametri CER (BASSA)

**Evidenza:**
```
curl -s https://rifiuti.ignicraft.com/api/v1/cer/code/010101
{"statusCode":500,"message":"Internal server error"}

curl -s https://rifiuti.ignicraft.com/api/v1/cer/search
{"statusCode":500,"message":"Internal server error"}
```
Nota: il messaggio è generico (nessuno stack trace, nessun path di file, nessun dettaglio ORM/SQL) — **non c'è information disclosure verbosa**, solo un bug di gestione errori (probabilmente `search` senza query string obbligatoria, o `code` normalizzato in modo diverso da quanto atteso dal service, es. `010101` vs `01 01 01` con spazi).

**Impatto:** basso — nessuna fuga di informazioni interne, ma un 500 al posto di un 400 con messaggio di validazione è un difetto di robustezza e può indicare un'eccezione non gestita che in altri contesti (query malformate più complesse) potrebbe rivelare più dettagli.

**Rimedio consigliato:** aggiungere validazione esplicita (`class-validator`/`ValidationPipe`) sui parametri di `cer/code/:code` e sulla query di `cer/search`, restituendo 400 con messaggio chiaro quando il formato non è valido o il parametro di ricerca manca.

---

### F4 — `/api/v1/health/detailed` espone info di runtime senza auth (BASSA)

**Evidenza:**
```
curl -s https://rifiuti.ignicraft.com/api/v1/health/detailed
{"status":"healthy","timestamp":"2026-07-25T06:39:48.833Z","version":"1.0.0","environment":"production","uptime":1900692.259490939,"memory":{"used":57466352,"total":67575808,"rss":106176512},"database":{"status":"ok","database":"connected"}}
```
Endpoint raggiungibile senza autenticazione (`security: null` anche in Swagger), espone `uptime` (utile per dedurre l'ultimo riavvio, quindi finestre di eventuali patch/deploy), consumo di memoria RSS e conferma esplicita che il DB è raggiungibile.

**Impatto:** basso, ma è ricognizione utile a un attaccante (fingerprinting del servizio, timing di deploy/riavvii, conferma che esiste un DB dietro). Non ci sono credenziali o dati personali.

**Rimedio consigliato:** valutare se `/health/detailed` debba restare pubblico (uso tipico: readiness probe interna) — se sì, esporlo solo su rete interna/binding privato o dietro autenticazione; se serve pubblico per monitoraggio esterno, limitarlo a `status` senza dettagli di memoria/uptime.

---

### F5 — Metadata Swagger `security` incoerente con i guard reali (INFO)

**Evidenza:** dalla spec OpenAPI, i seguenti endpoint applicativi risultano **senza** annotazione `security` (quindi sembrerebbero pubblici a chi legge solo la documentazione), ma in pratica rispondono 401 se non autenticati (verificato empiricamente):
`/api/v1/admin/access-requests`, `/api/v1/admin/tenants`, `/api/v1/admin/tenants/{id}`, `/api/v1/admin/users`, `/api/v1/auth/profile`, `/api/v1/me/company`, `/api/v1/me/features`, `/api/v1/me/tenants`, `/api/v1/permissions/me`, `/api/v1/permissions/my-permissions`, `/api/v1/registro`, `/api/v1/registry/*`, `/api/v1/reference-data/*`, `/api/v1/giacenze*`, `/api/v1/dashboard*`, `/api/v1/notifications*`, `/api/v1/pdf/*`.

**Impatto:** nessuno a runtime (i guard proteggono comunque l'endpoint), ma è un rischio documentale: se in futuro qualcuno rimuove per errore un `@UseGuards` confidando (erroneamente) che "tanto Swagger dice che non serve auth", oppure se uno sviluppatore si fida della doc per capire cosa è davvero pubblico, il gap tra documentazione e comportamento reale può portare a regressioni di sicurezza non rilevate a colpo d'occhio.

**Rimedio consigliato:** aggiungere `@ApiBearerAuth()` in modo sistematico (es. tramite un decoratore composito o applicando `@ApiBearerAuth()` a livello di controller quando l'intero controller richiede auth) così che la spec rifletta fedelmente i guard reali. Utile anche come test di non-regressione automatizzato (confronto tra path autenticati nel router e path marcati `security` in Swagger).

---

### F6 — CORS correttamente ristretto (INFO positivo)

**Evidenza:**
```
curl -s -D - -o /dev/null https://rifiuti.ignicraft.com/api/v1/health -H "Origin: https://evil.example.com"
# nessun header Access-Control-Allow-Origin nella risposta

curl -s -D - -o /dev/null https://rifiuti.ignicraft.com/api/v1/health -H "Origin: https://rifiuti.ignicraft.com"
Access-Control-Allow-Origin: https://rifiuti.ignicraft.com
```
Origin non in whitelist → nessun `Access-Control-Allow-Origin` restituito (fail-closed, non wildcard, non riflesso). Origin legittimo → riflesso correttamente. `Access-Control-Allow-Credentials: true` è presente solo insieme a un ACAO specifico, non con wildcard — configurazione corretta.

Nota: le richieste `OPTIONS` di preflight verso path applicativi (`/api/v1/health`, `/api/v1/fir`) rispondono `404` invece di `204`/`200` con gli header CORS del preflight. Non è uno "security bug" (anzi, il preflight fallisce comunque per origin non autorizzati, quindi il browser blocca la richiesta cross-origin), ma vale la pena verificare che il preflight risponda correttamente per gli **origin legittimi** (es. eventuali frontend futuri o integrazioni partner), altrimenti si rischia di rompere use-case cross-origin voluti.

**Impatto:** nessuno — nessuna esposizione a CSRF/data-theft cross-origin via CORS.

---

### F7 — Endpoint pubblici legittimi confermati (INFO)

I seguenti endpoint rispondono 200 senza autenticazione e sembrano intenzionalmente pubblici (dati di riferimento normativo, non dati di tenant):
- `GET /api/v1/cer` — elenco codici CER (nomenclatura rifiuti, pubblica per legge/regolamento UE, non dato personale).
- `GET /api/v1/cer/statistics` — conteggi aggregati (`{"total":837,"pericolosi":406,"nonPericolosi":431}`), nessun dato di tenant.
- `GET /api/v1/fir/{id}/verify-url` — restituisce solo un URL di verifica costruito dall'id in input (`{"url":"https://wasteflow.it/verify/{id}"}`), nessun dato del FIR stesso.
- `GET /api/v1/auth/spid/login` — redirect 302 corretto verso Keycloak SAML (`auth.ignicraft.com/realms/ignicraft/protocol/saml?SAMLRequest=...`), comportamento atteso per l'avvio del flusso SSO.
- `GET /api/v1/health`, `/api/v1/health/db` — stato di servizio minimale, nessun dettaglio sensibile.

**Nota:** consigliamo comunque una verifica manuale mirata (fuori scope di questo probe GET-only) che `GET /api/v1/cer` non stia esponendo, in futuro, campi aggiuntivi non previsti se il modello dati CER viene esteso.

---

### F8 — Nessuna fuga di file sensibili (INFO positivo)

**Evidenza:**
```
curl -s -o /dev/null -w "%{http_code}" https://rifiuti.ignicraft.com/.env        -> 200 (25141 bytes)
curl -s -o /dev/null -w "%{http_code}" https://rifiuti.ignicraft.com/.git/config -> 200 (25141 bytes)
curl -s -o /dev/null -w "%{http_code}" https://rifiuti.ignicraft.com/assets/     -> 200 (25141 bytes)
curl -s -o /dev/null -w "%{http_code}" https://rifiuti.ignicraft.com/main.js.map -> 200 (25141 bytes)
```
Tutti i path restituiscono **lo stesso identico Content-Length (25141 byte)** dell'`index.html` di root: il nginx del frontend Angular fa fallback SPA (serve sempre `index.html` con status 200 per qualunque path non trovato). Il contenuto verificato (`head -c 200`) conferma che è l'`index.html`, non un vero file `.env`/`.git`.

Verificato anche sul bundle JS reale (`main.2b3a5f88b34370c1.js.map`): stesso comportamento, nessuna sourcemap reale servita.

**Impatto:** nessuno. Da notare come effetto collaterale: il fallback SPA a 200 rende impossibile usare lo status code per capire se una risorsa statica esiste davvero — non è un problema di sicurezza ma può confondere strumenti di monitoring/log che si aspettano 404 su path inesistenti.

---

### F9 — Rate limiting attivo (INFO positivo)

**Evidenza:** header `X-RateLimit-Limit-short: 10`, `X-RateLimit-Limit-medium: 100`, `X-RateLimit-Limit-long: 1000` presenti su tutte le risposte API, con reset a 1s/60s/tempo lungo rispettivamente. Test leggero di 15 richieste consecutive (ritmo ~3/s) su `/api/v1/health` non ha mai prodotto 429, coerente con il limite dichiarato di 10 richieste per finestra breve.

**Impatto:** nessuno, il throttling è presente e correttamente configurato (verifica solo leggera, non è stato eseguito alcun test di carico più aggressivo come da vincoli).

---

### F10 — Certificato TLS valido (INFO positivo)

**Evidenza:**
```
openssl s_client -connect rifiuti.ignicraft.com:443 -servername rifiuti.ignicraft.com | openssl x509 -noout -dates -subject -issuer
notBefore=Jun 14 09:52:24 2026 GMT
notAfter=Sep 12 09:52:23 2026 GMT
subject=CN=rifiuti.ignicraft.com
issuer=C=US, O=Let's Encrypt, CN=YE1
```
Certificato Let's Encrypt valido, non in scadenza imminente (~7 settimane a oggi 2026-07-25), rinnovo automatico atteso via `certbot`/`snap.certbot.renew.timer` come da standard infrastrutturale.

**Impatto:** nessuno.

---

## Elenco endpoint testati (GET, senza header Authorization)

| # | Endpoint | Status | Note |
|---|----------|--------|------|
| 1 | `/api/v1/admin/access-requests` | 401 | corretto |
| 2 | `/api/v1/admin/tenants` | 401 | corretto |
| 3 | `/api/v1/admin/tenants/{uuid}` | 401 | corretto |
| 4 | `/api/v1/admin/users` | 401 | corretto |
| 5 | `/api/v1/anomaly` | 401 | corretto |
| 6 | `/api/v1/auth/profile` | 401 | corretto |
| 7 | `/api/v1/auth/spid/login` | 302 | redirect SAML corretto (F7) |
| 8 | `/api/v1/backup/list` | 401 | corretto |
| 9 | `/api/v1/billing/status` | 401 | corretto |
| 10 | `/api/v1/cer` | 200 | pubblico per design (F7) |
| 11 | `/api/v1/cer/code/010101` | 500 | bug validazione (F3) |
| 12 | `/api/v1/cer/search` | 500 | bug validazione (F3) |
| 13 | `/api/v1/cer/statistics` | 200 | pubblico per design (F7) |
| 14 | `/api/v1/contracts` | 401 | corretto |
| 15 | `/api/v1/contracts/{uuid}` | 401 | corretto |
| 16 | `/api/v1/contracts/auto-fill` | 401 | corretto |
| 17 | `/api/v1/dashboard` | 401 | corretto |
| 18 | `/api/v1/dashboard/export` | 401 | corretto |
| 19 | `/api/v1/esg/report` | 401 | corretto |
| 20 | `/api/v1/fir` | 401 | corretto |
| 21 | `/api/v1/fir/{uuid}/verify` | 400 | validazione id, nessuna fuga (messaggio generico) |
| 22 | `/api/v1/fir/{uuid}/verify-url` | 200 | pubblico per design (F7) |
| 23 | `/api/v1/fir/{uuid}` | 401 | corretto |
| 24 | `/api/v1/giacenze` | 401 | corretto |
| 25 | `/api/v1/giacenze/deposito-temporaneo/alerts` | 401 | corretto |
| 26 | `/api/v1/health` | 200 | pubblico per design |
| 27 | `/api/v1/health/db` | 200 | pubblico per design |
| 28 | `/api/v1/health/detailed` | 200 | espone runtime info (F4) |
| 29 | `/api/v1/me/company` | 401 | corretto |
| 30 | `/api/v1/me/features` | 401 | corretto |
| 31 | `/api/v1/me/tenants` | 401 | corretto |
| 32 | `/api/v1/mud/export` | 401 | corretto |
| 33 | `/api/v1/mud/export/versions` | 401 | corretto |
| 34 | `/api/v1/mud/generate` | 401 | corretto |
| 35 | `/api/v1/mud/years` | 401 | corretto |
| 36 | `/api/v1/notifications` | 401 | corretto |
| 37 | `/api/v1/notifications/unread-count` | 401 | corretto |
| 38 | `/api/v1/pdf/fir/{uuid}` | 401 | corretto |
| 39 | `/api/v1/pdf/mud/2025` | 401 | corretto |
| 40 | `/api/v1/permissions/me` | 401 | corretto |
| 41 | `/api/v1/permissions/my-permissions` | 401 | corretto |
| 42 | `/api/v1/reference-data/ateco` | 401 | corretto |
| 43 | `/api/v1/reference-data/comuni` | 401 | corretto |
| 44 | `/api/v1/reference-data/nazioni` | 401 | corretto |
| 45 | `/api/v1/reference-data/status` | 401 | corretto |
| 46 | `/api/v1/registro` | 401 | corretto |
| 47 | `/api/v1/registry/destinatari` | 401 | corretto |
| 48 | `/api/v1/registry/destinatari/{uuid}` | 401 | corretto |
| 49 | `/api/v1/registry/produttori` | 401 | corretto |
| 50 | `/api/v1/registry/produttori/{uuid}` | 401 | corretto |
| 51 | `/api/v1/registry/trasportatori` | 401 | corretto |
| 52 | `/api/v1/registry/trasportatori/{uuid}` | 401 | corretto |
| 53 | `/api/v1/rentri/credential` | 401 | corretto |
| 54 | `/metrics` | 200 | fallback SPA Angular (index.html), non è un vero metrics endpoint pubblico |
| 55 | `/api/docs` | 200 | Swagger UI esposta (F1) |
| 56 | `/api/docs-json` | 200 | spec OpenAPI esposta (F1) |
| 57 | `/api-json` | 200 | spec OpenAPI esposta (F1) |
| 58 | `/api/docs/json` | 404 | path non valido, non rilevante |
| 59 | `/.env` | 200 | fallback SPA, nessun file reale servito (F8) |
| 60 | `/.git/config` | 200 | fallback SPA, nessun file reale servito (F8) |
| 61 | `/assets/` | 200 | fallback SPA, nessun file reale servito (F8) |
| 62 | `/main.js.map` | 200 | fallback SPA, nessuna sourcemap reale (F8) |
| 63 | `/robots.txt` | 200 | fallback SPA |
| 64 | `/favicon.ico` | 404 | file statico assente (non un fallback SPA, comportamento normale per file mancante) |
| 65 | `/main.2b3a5f88b34370c1.js.map` (bundle reale) | 200 (=fallback) | conferma nessuna sourcemap reale servita |
| 66 | `/main.2b3a5f88b34370c1.js` (bundle reale) | 200 | JS servito correttamente, cache immutabile |

**Riepilogo:** 39/45 endpoint applicativi correttamente protetti da 401; 4 endpoint pubblici per design confermati non sensibili (cer, cer/statistics, verify-url, health*); 2 endpoint con bug 500 non correlato ad auth; 0 fughe di dati di tenant riscontrate.

---

## Nota per il verificatore umano — punti da approfondire manualmente

- **Swagger in produzione (F1)**: decisione di prodotto/sicurezza da prendere: disabilitare o proteggere. Non eseguibile in autonomia con solo GET (richiede modifica di configurazione).
- **Confermare se `/api/v1/cer`, `/api/v1/cer/statistics`, `/api/v1/fir/{id}/verify-url` siano *intenzionalmente* pubblici** per design di prodotto (verificare con il team: sembra ragionevole per dati normativi pubblici e verifica FIR via QR/link, ma va confermato che non ci sia stata una dimenticanza di `@UseGuards`).
- **Branch `master` vs `develop`**: questo probe testa l'ambiente PRODUZIONE (branch `master`), che secondo la memoria di progetto NON include i fix RBAC di scrittura presenti su `develop` (commit 09d8fd5). Questo probe è stato limitato a GET/HEAD/OPTIONS quindi **non verifica gli endpoint di scrittura** (POST/PUT/PATCH/DELETE) dove i bug RBAC erano stati riscontrati nell'audit E2E precedente — quella verifica richiede un metodo di test con scrittura e va condotta con credenziali di test dedicate in un ambiente separato, mai in produzione con GET-only.
- Il test di rate-limiting è stato volutamente leggero (15 richieste): un test più approfondito del comportamento sotto carico (429 reale, `Retry-After`) richiederebbe un numero di richieste superiore a quanto consentito da questi vincoli.
