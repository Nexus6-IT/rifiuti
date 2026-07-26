# API Surface Audit — rifiuti / WasteFlow backend

- **Data**: 2026-07-25
- **Branch**: develop
- **Global prefix**: `api/v1` (da `main.ts`, `app.setGlobalPrefix(process.env.API_PREFIX || 'api/v1', { exclude: ['metrics'] })`). Solo `metrics` è escluso dal prefix — `health` **non** è escluso, nonostante due controller distinti rispondano entrambi su `health` (vedi nota sotto).
- **Nessun guard di autenticazione globale**: l'unico `APP_GUARD` in `app.module.ts` è `ThrottlerGuard` (rate limiting). L'autenticazione (`JwtAuthGuard`) e l'autorizzazione (`RolesGuard`, `@Roles`, `PermissionGuard`/`@RequirePermission`) dipendono **sempre** da decoratori espliciti sul controller/handler. Un controller senza `@UseGuards` è di fatto pubblico.
- **`PermissionGuard`/`@RequirePermission`** (RBAC fine-grained, IAM) è cablato in `PermissionsModule` ma **usato da zero controller effettivamente registrati**: gli unici controller che lo userebbero (`RoleController`, `UserRoleController`, `AuditController` in `api/permissions/`, `ConsultantController`, `TemporaryPermissionController`) sono orfani (vedi sezione dedicata) — commento esplicito in `permissions.module.ts` spiega che i loro handler CQRS iniettano repository per interfaccia senza `@Inject(...)` esplicito, quindi il bootstrap Nest fallirebbe se registrati. **Nessun endpoint reale nell'app usa `@RequirePermission`.**
- Sono stati trovati **12 controller su 36** elencati (33%) che **non risultano cablati in nessun modulo importato da `AppModule`** — di fatto codice morto, mai raggiungibile in produzione. Inoltre il controller FIR effettivamente attivo (`FIRControllerV2`, `apps/backend/src/api/fir/fir.controller.v2.ts`) **non era nell'elenco dei 36 file forniti**: il file realmente cablato da `FIRModule` non è `api/fir/fir.controller.ts` (quello è l'orfano) ma un file `.v2.ts` separato.
- **100 endpoint HTTP raggiungibili** in totale su 25 controller cablati (incluso il duplicato `health`): **54 READ** (GET), **46 WRITE** (POST/PUT/PATCH/DELETE).

## Nota: collisione di path `GET /api/v1/health`

Due controller distinti rispondono entrambi su `GET /api/v1/health` (nessuno dei due escluso dal prefix, perché solo `metrics` lo è):

- `HealthController` (`apps/backend/src/api/health/health.controller.ts:10`) — registrato **direttamente** in `controllers: [HealthController]` di `AppModule`.
- `HealthCheckController` (`apps/backend/src/infrastructure/monitoring/health-check.controller.ts:15`) — registrato tramite `MonitoringModule`, importato in `AppModule.imports`.

Entrambi definiscono `@Get()` sulla root `health`. Quale dei due gestisce effettivamente la richiesta dipende dall'ordine di inizializzazione dei moduli Nest/Express (tipicamente i controller dei moduli in `imports` vengono registrati prima di quelli dichiarati direttamente sul modulo radice, quindi `HealthCheckController` vincerebbe la route, ma il comportamento non è garantito da documentare come contratto). Il secondo controller espone anche `GET /health/db` e `GET /health/detailed`, che restano raggiungibili senza collisione.

## Tabella endpoint (99 totali, ordinati per modulo poi path)

| Metodo | Path | Modulo | Guards | Ruoli/Permessi | Tipo (R/W) | Distruttivo | File:riga |
|---|---|---|---|---|---|---|---|
| POST | api/v1/auth/access-request | access-request | @Public | — | W | NO | api/access-request/access-request.controller.ts:22 |
| GET | api/v1/admin/access-requests | admin-access-requests | JwtAuthGuard, RolesGuard | SUPER_ADMIN | R | NO | api/admin/access-request-admin.controller.ts:39 |
| PATCH | api/v1/admin/access-requests/:id | admin-access-requests | JwtAuthGuard, RolesGuard | SUPER_ADMIN | W | NO | api/admin/access-request-admin.controller.ts:52 |
| GET | api/v1/admin/tenants | admin-tenants | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | R | NO | api/admin/tenant.controller.ts:46 |
| GET | api/v1/admin/tenants/:id | admin-tenants | JwtAuthGuard, RolesGuard | SUPER_ADMIN | R | NO | api/admin/tenant.controller.ts:56 |
| POST | api/v1/admin/tenants | admin-tenants | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO | api/admin/tenant.controller.ts:67 |
| PUT | api/v1/admin/tenants/:id | admin-tenants | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO | api/admin/tenant.controller.ts:79 |
| PATCH | api/v1/admin/tenants/:id/status | admin-tenants | JwtAuthGuard, RolesGuard | SUPER_ADMIN | W | SI - sospende/riattiva un intero tenant, blocca l'accesso a tutti i suoi utenti | api/admin/tenant.controller.ts:94 |
| GET | api/v1/admin/users | admin-users | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | R | NO | api/admin/user-admin.controller.ts:54 |
| POST | api/v1/admin/users | admin-users | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO | api/admin/user-admin.controller.ts:64 |
| PATCH | api/v1/admin/users/:id/role | admin-users | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO | api/admin/user-admin.controller.ts:76 |
| PATCH | api/v1/admin/users/:id/status | admin-users | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO | api/admin/user-admin.controller.ts:90 |
| PATCH | api/v1/admin/users/:id/company-limit | admin-users | JwtAuthGuard, RolesGuard | SUPER_ADMIN | W | NO | api/admin/user-admin.controller.ts:105 |
| POST | api/v1/admin/users/:id/impersonate | admin-users | JwtAuthGuard, RolesGuard | SUPER_ADMIN | W | NO (sensibile: impersonificazione, non perdita dati) | api/admin/user-admin.controller.ts:121 |
| GET | api/v1/anomaly | anomaly | JwtAuthGuard | — | R | NO | application/anomaly/anomaly.controller.ts:17 |
| GET | api/v1/auth/spid/login | auth | @Public, AuthGuard('spid') | — | R | NO | auth/controllers/auth.controller.ts:41 |
| POST | api/v1/auth/spid/callback | auth | @Public, AuthGuard('spid') | — | W | NO | auth/controllers/auth.controller.ts:53 |
| POST | api/v1/auth/dev/login | auth | @Public | — | W | NO (ma vedi Endpoint pubblici: bypass SPID) | auth/controllers/auth.controller.ts:107 |
| POST | api/v1/auth/refresh | auth | @Public | — | W | NO | auth/controllers/auth.controller.ts:172 |
| POST | api/v1/auth/logout | auth | JwtAuthGuard | — | W | NO | auth/controllers/auth.controller.ts:221 |
| GET | api/v1/auth/profile | auth | JwtAuthGuard | — | R | NO | auth/controllers/auth.controller.ts:241 |
| POST | api/v1/backup/create | backup | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO | api/backup/backup.controller.ts:21 |
| GET | api/v1/backup/list | backup | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | R | NO | api/backup/backup.controller.ts:29 |
| POST | api/v1/backup/restore | backup | JwtAuthGuard, RolesGuard | SUPER_ADMIN | W | **SI - ripristina il DB da backup, sovrascrive lo stato corrente** | api/backup/backup.controller.ts:36 |
| DELETE | api/v1/backup/cleanup | backup | JwtAuthGuard, RolesGuard | SUPER_ADMIN | W | **SI - elimina definitivamente i backup >30gg (purge irreversibile)** | api/backup/backup.controller.ts:45 |
| GET | api/v1/billing/status | billing | JwtAuthGuard | — | R | NO | application/billing/billing.controller.ts:60 |
| POST | api/v1/billing/checkout | billing | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO | application/billing/billing.controller.ts:73 |
| POST | api/v1/billing/portal | billing | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO | application/billing/billing.controller.ts:99 |
| POST | api/v1/billing/webhook | billing | nessuno (firma HMAC Stripe verificata nel body) | — | W | NO | application/billing/billing.controller.ts:122 |
| GET | api/v1/cer | cer | nessuno | — | R | NO | api/cer/cer.controller.ts:38 |
| GET | api/v1/cer/search | cer | nessuno | — | R | NO | api/cer/cer.controller.ts:84 |
| GET | api/v1/cer/code/:code | cer | nessuno | — | R | NO | api/cer/cer.controller.ts:127 |
| GET | api/v1/cer/statistics | cer | nessuno | — | R | NO | api/cer/cer.controller.ts:165 |
| POST | api/v1/contracts | contracts | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | application/contracts/contract.controller.ts:31 |
| GET | api/v1/contracts | contracts | JwtAuthGuard, RolesGuard | — | R | NO | application/contracts/contract.controller.ts:44 |
| GET | api/v1/contracts/auto-fill | contracts | JwtAuthGuard, RolesGuard | — | R | NO | application/contracts/contract.controller.ts:51 |
| GET | api/v1/contracts/:id | contracts | JwtAuthGuard, RolesGuard | — | R | NO | application/contracts/contract.controller.ts:65 |
| PATCH | api/v1/contracts/:id/status | contracts | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | application/contracts/contract.controller.ts:72 |
| GET | api/v1/dashboard | dashboard | JwtAuthGuard | — | R | NO | api/dashboard/dashboard.controller.ts:38 |
| GET | api/v1/dashboard/export | dashboard | JwtAuthGuard | — | R | NO | api/dashboard/dashboard.controller.ts:146 |
| GET | api/v1/esg/report | esg | JwtAuthGuard | — | R | NO | application/esg/esg.controller.ts:17 |
| POST | api/v1/fir | fir | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/fir/fir.controller.v2.ts:115 |
| GET | api/v1/fir | fir | JwtAuthGuard, RolesGuard | — | R | NO | api/fir/fir.controller.v2.ts:152 |
| GET | api/v1/fir/:id | fir | JwtAuthGuard, RolesGuard | — | R | NO | api/fir/fir.controller.v2.ts:212 |
| POST | api/v1/fir/:id/emetti | fir | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO (workflow forward-only, non distrugge dati) | api/fir/fir.controller.v2.ts:240 |
| POST | api/v1/fir/:id/presa-in-carico | fir | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/fir/fir.controller.v2.ts:270 |
| POST | api/v1/fir/:id/conferma-consegna | fir | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/fir/fir.controller.v2.ts:304 |
| POST | api/v1/fir/:id/annulla | fir | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | **SI - annulla irreversibilmente un documento legale (FIR), stato terminale ANNULLATO** | api/fir/fir.controller.v2.ts:346 |
| POST | api/v1/fir/:firId/sign | signatures | JwtAuthGuard, RolesGuard, SpidLevelGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/signatures/signatures.controller.ts:71 |
| GET | api/v1/fir/:firId/verify | signatures | nessuno (pubblico by design, per QR code) | — | R | NO | api/signatures/signatures.controller.ts:150 |
| GET | api/v1/fir/:firId/verify-url | signatures | nessuno (pubblico by design) | — | R | NO | api/signatures/signatures.controller.ts:192 |
| GET | api/v1/giacenze | giacenze | JwtAuthGuard | — | R | NO | application/giacenze/giacenze.controller.ts:17 |
| GET | api/v1/giacenze/deposito-temporaneo/alerts | giacenze | JwtAuthGuard | — | R | NO | application/giacenze/giacenze.controller.ts:25 |
| GET | api/v1/health | health | nessuno | — | R | NO | api/health/health.controller.ts:10 |
| GET | api/v1/health | health-monitoring | nessuno | — | R | NO (collisione path con la riga precedente) | infrastructure/monitoring/health-check.controller.ts:15 |
| GET | api/v1/health/db | health-monitoring | nessuno | — | R | NO | infrastructure/monitoring/health-check.controller.ts:26 |
| GET | api/v1/health/detailed | health-monitoring | nessuno | — | R | NO | infrastructure/monitoring/health-check.controller.ts:37 |
| GET | api/v1/me/tenants | me | JwtAuthGuard | — | R | NO | api/me/membership.controller.ts:25 |
| GET | api/v1/me/company | me | JwtAuthGuard | — | R | NO | api/me/membership.controller.ts:38 |
| POST | api/v1/me/switch-tenant | me | JwtAuthGuard | — | W | NO | api/me/membership.controller.ts:47 |
| GET | api/v1/me/features | me | JwtAuthGuard | — | R | NO | api/me/me-features.controller.ts:26 |
| GET | api/v1/mud/generate | mud | JwtAuthGuard | — | R | NO | api/mud/mud.controller.ts:24 |
| GET | api/v1/mud/export | mud | JwtAuthGuard | — | R | NO | api/mud/mud.controller.ts:34 |
| GET | api/v1/mud/export/versions | mud | JwtAuthGuard | — | R | NO | api/mud/mud.controller.ts:57 |
| GET | api/v1/mud/years | mud | JwtAuthGuard | — | R | NO | api/mud/mud.controller.ts:77 |
| GET | api/v1/notifications | notifications | JwtAuthGuard | — | R | NO | api/notifications/notifications.controller.ts:24 |
| GET | api/v1/notifications/unread-count | notifications | JwtAuthGuard | — | R | NO | api/notifications/notifications.controller.ts:40 |
| POST | api/v1/notifications/:id/mark-read | notifications | JwtAuthGuard | — | W | NO | api/notifications/notifications.controller.ts:47 |
| POST | api/v1/notifications/mark-all-read | notifications | JwtAuthGuard | — | W | NO | api/notifications/notifications.controller.ts:55 |
| DELETE | api/v1/notifications/:id | notifications | JwtAuthGuard | — | W | NO (cancellazione di una singola notifica propria, basso raggio) | api/notifications/notifications.controller.ts:63 |
| GET | api/v1/pdf/fir/:id | pdf | JwtAuthGuard | — | R | NO | api/pdf/pdf.controller.ts:35 |
| GET | api/v1/pdf/mud/:year | pdf | JwtAuthGuard | — | R | NO | api/pdf/pdf.controller.ts:65 |
| GET | api/v1/permissions/my-permissions | permissions | JwtAuthGuard, TenantIsolationGuard | — | R | NO | api/permissions/permission.controller.ts:28 |
| GET | api/v1/permissions/me | permissions | JwtAuthGuard, TenantIsolationGuard | — | R | NO | api/permissions/permission.controller.ts:52 |
| GET | api/v1/reference-data/status | reference-data | JwtAuthGuard | — | R | NO | application/reference-data/reference-data.controller.ts:23 |
| GET | api/v1/reference-data/comuni | reference-data | JwtAuthGuard | — | R | NO | application/reference-data/reference-data.controller.ts:29 |
| GET | api/v1/reference-data/ateco | reference-data | JwtAuthGuard | — | R | NO | application/reference-data/reference-data.controller.ts:36 |
| GET | api/v1/reference-data/nazioni | reference-data | JwtAuthGuard | — | R | NO | application/reference-data/reference-data.controller.ts:43 |
| POST | api/v1/reference-data/reseed | reference-data | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | **SI - ripopola/sovrascrive i dataset di riferimento condivisi dalle sorgenti** | application/reference-data/reference-data.controller.ts:50 |
| POST | api/v1/registro | registro | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/registro/registro.controller.ts:46 |
| GET | api/v1/registro | registro | JwtAuthGuard, RolesGuard | — | R | NO | api/registro/registro.controller.ts:102 |
| POST | api/v1/registry/produttori | registry | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/registry/registry.controller.ts:72 |
| POST | api/v1/registry/trasportatori | registry | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/registry/registry.controller.ts:90 |
| POST | api/v1/registry/destinatari | registry | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/registry/registry.controller.ts:109 |
| GET | api/v1/registry/produttori | registry | JwtAuthGuard, RolesGuard | — | R | NO | api/registry/registry.controller.ts:130 |
| GET | api/v1/registry/produttori/:id | registry | JwtAuthGuard, RolesGuard | — | R | NO | api/registry/registry.controller.ts:155 |
| PUT | api/v1/registry/produttori/:id | registry | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/registry/registry.controller.ts:174 |
| DELETE | api/v1/registry/produttori/:id | registry | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | **SI - elimina anagrafica produttore, potenzialmente referenziata da FIR** | api/registry/registry.controller.ts:197 |
| GET | api/v1/registry/trasportatori | registry | JwtAuthGuard, RolesGuard | — | R | NO | api/registry/registry.controller.ts:210 |
| GET | api/v1/registry/trasportatori/:id | registry | JwtAuthGuard, RolesGuard | — | R | NO | api/registry/registry.controller.ts:232 |
| PUT | api/v1/registry/trasportatori/:id | registry | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/registry/registry.controller.ts:252 |
| DELETE | api/v1/registry/trasportatori/:id | registry | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | **SI - elimina anagrafica trasportatore, potenzialmente referenziata da FIR** | api/registry/registry.controller.ts:276 |
| GET | api/v1/registry/destinatari | registry | JwtAuthGuard, RolesGuard | — | R | NO | api/registry/registry.controller.ts:289 |
| GET | api/v1/registry/destinatari/:id | registry | JwtAuthGuard, RolesGuard | — | R | NO | api/registry/registry.controller.ts:311 |
| PUT | api/v1/registry/destinatari/:id | registry | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | NO | api/registry/registry.controller.ts:331 |
| DELETE | api/v1/registry/destinatari/:id | registry | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN, OPERATOR | W | **SI - elimina anagrafica destinatario, potenzialmente referenziata da FIR** | api/registry/registry.controller.ts:355 |
| POST | api/v1/rentri/codifiche/allinea | rentri-codifiche | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO — upsert additivo, marca `presenteInRentri=false` invece di cancellare (mai `DELETE`); v. `rentri-cer-sync.service.ts` | api/rentri/rentri-codifiche.controller.ts:50 |
| PUT | api/v1/rentri/credential | rentri-credential | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | NO | api/rentri/rentri-credential.controller.ts:57 |
| GET | api/v1/rentri/credential | rentri-credential | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | R | NO | api/rentri/rentri-credential.controller.ts:108 |
| DELETE | api/v1/rentri/credential | rentri-credential | JwtAuthGuard, RolesGuard | SUPER_ADMIN, ADMIN | W | **SI - rimuove la credenziale RENTRI del tenant, interrompe la sincronizzazione finché non ricaricata** | api/rentri/rentri-credential.controller.ts:130 |

## Buchi RBAC sospetti

Endpoint WRITE con guard di autenticazione (`JwtAuthGuard`) ma **nessun** `@Roles`/`@RequirePermission`:

- `POST /api/v1/me/switch-tenant` — `api/me/membership.controller.ts:47`. Nessun ruolo richiesto: qualunque utente autenticato (incluso VIEWER) può cambiare la propria azienda attiva. **Severità bassa**: l'azione è self-scoped (cambia solo la sessione del chiamante) e il service sottostante dovrebbe validare la membership — verificare che `MembershipService.switchTenant` rifiuti tenant a cui l'utente non appartiene.
- `POST /api/v1/notifications/:id/mark-read` — `api/notifications/notifications.controller.ts:47`. Nessun ruolo. **Severità bassa**: opera solo sulle notifiche dell'utente stesso (filtrate per `req.user.id` nel service) — comportamento atteso, ma da verificare che il service non permetta di marcare notifiche altrui passando un `id` arbitrario.
- `POST /api/v1/notifications/mark-all-read` — `api/notifications/notifications.controller.ts:55`. Stesso pattern, stessa nota.
- `DELETE /api/v1/notifications/:id` — `api/notifications/notifications.controller.ts:63`. Stesso pattern: verificare che `deleteNotification` in `NotificationService` scoperi l'owner (`userId`) prima di cancellare e non solo l'`id` della notifica.

Nessun altro endpoint WRITE cablato risulta privo di `@Roles`. Da notare che **`@RequirePermission`/`PermissionGuard` non è usato da nessun endpoint effettivamente raggiungibile** — l'intero sottosistema IAM/ABAC granulare (`PermissionsModule`) è cablato ma i controller che lo consumerebbero (role/user-role/consultant/temporary-permission/audit) sono orfani (vedi sotto). Tutta l'autorizzazione realmente attiva oggi è basata sui ruoli grezzi (`SUPER_ADMIN`/`ADMIN`/`OPERATOR`/`VIEWER`) via `@Roles`, non sul modello a permessi granulari.

## Endpoint pubblici

Endpoint senza alcun guard di autenticazione (o con `@Public()` esplicito):

- `GET /api/v1/auth/spid/login` — redirect all'IdP SPID. **Legittimo** (avvio flusso di login).
- `POST /api/v1/auth/spid/callback` — riceve l'assertion SAML da Keycloak. **Legittimo** (deve essere raggiungibile senza JWT, è il punto in cui il JWT viene emesso).
- `POST /api/v1/auth/dev/login` — bypassa completamente SPID, restituisce token validi per un utente esistente. **Attenzione**: la protezione è **solo runtime** (`if (nodeEnv === 'production') throw ...` dentro l'handler), non un guard/flag di build né un'esclusione di route in produzione. Se `NODE_ENV` non fosse impostato correttamente in un ambiente esposto, questo endpoint diventerebbe un bypass di autenticazione completo. Verificare che `NODE_ENV=production` sia garantito in ogni deploy.
- `POST /api/v1/auth/refresh` — **legittimo per design** (serve un token valido, non una sessione).
- `POST /api/v1/auth/access-request` — form pubblico "richiedi accesso" (lead capture), rate-limited 5/min. **Legittimo**.
- `POST /api/v1/billing/webhook` — nessun `JwtAuthGuard` (arriva da Stripe, non dal browser), sicurezza delegata alla verifica della firma HMAC (`stripe-signature`). **Legittimo**, pattern corretto per webhook esterni.
- `GET /api/v1/cer`, `/cer/search`, `/cer/code/:code`, `/cer/statistics` — **l'intero catalogo CER è pubblico**, nessun guard a livello di classe né di handler. Dati non sensibili (codici EER standard, non tenant-scoped) — probabilmente intenzionale, ma è l'unico modulo dati "di dominio" completamente non autenticato: verificare che sia una scelta consapevole e non un guard dimenticato.
- `GET /api/v1/health` (`api/health/health.controller.ts`) — healthcheck base. **Legittimo**.
- `GET /api/v1/health`, `/health/db`, `/health/detailed` (`infrastructure/monitoring/health-check.controller.ts`) — **legittimo** per uso ops, ma `/health/detailed` espone `NODE_ENV`, versione app, uptime e memoria di processo senza autenticazione: informazione a basso rischio ma da valutare se esporre pubblicamente o dietro rete interna (nginx/Prometheus scraper).
- `GET /api/v1/fir/:firId/verify`, `/fir/:firId/verify-url` — **pubblici by design**, per la verifica firma via QR code su copia cartacea del FIR (terzi senza account).

## BLACKLIST distruttivi — non invocare mai su produzione

- `POST /api/v1/backup/restore` — sovrascrive il database corrente con un backup, nessun modo di annullare l'operazione una volta eseguita.
- `DELETE /api/v1/backup/cleanup` — elimina in modo permanente i file di backup più vecchi di 30 giorni.
- `PATCH /api/v1/admin/tenants/:id/status` (verso `SUSPENDED`) — sospende un intero tenant, disabilitando l'accesso per tutti i suoi utenti fino a riattivazione manuale.
- `POST /api/v1/reference-data/reseed` — ripopola (sovrascrive) i dataset di riferimento condivisi (comuni/ATECO/nazioni/province) dalle sorgenti esterne.
- `POST /api/v1/fir/:id/annulla` — annulla in modo irreversibile un FIR (documento legale), transizione terminale a `ANNULLATO`.
- `DELETE /api/v1/registry/produttori/:id` — elimina anagrafica produttore, master data potenzialmente referenziata da FIR esistenti.
- `DELETE /api/v1/registry/trasportatori/:id` — elimina anagrafica trasportatore, master data potenzialmente referenziata da FIR esistenti.
- `DELETE /api/v1/registry/destinatari/:id` — elimina anagrafica destinatario, master data potenzialmente referenziata da FIR esistenti.
- `DELETE /api/v1/rentri/credential` — rimuove il certificato/chiave RENTRI del tenant, interrompendo l'interoperabilità RENTRI finché non viene ricaricata una nuova credenziale.

`POST /api/v1/rentri/codifiche/allinea` (R4 Task 6) **non** è in questa blacklist, a differenza di `reseed`: `reseed` sovrascrive incondizionatamente con la fonte CSV, senza distinguere "scomparso" da "mai esistito"; l'allineamento RENTRI marca soltanto (`presenteInRentri`/`rimossoDaRentriAl`), non cancella né sovrascrive l'identità del codice — per questo non è classificato come distruttivo.

## Controller orfani / moduli non cablati

**12 controller su 36** non sono registrati in nessun modulo importato (direttamente o transitivamente) da `AppModule` — codice presente nel repository ma **irraggiungibile in produzione**:

| Controller | File | @Controller path (mai montato) | Endpoint definiti (non raggiungibili) | Nota |
|---|---|---|---|---|
| `AuditController` | `apps/backend/src/api/audit/audit.controller.ts` | `audit` | GET permissions, GET permissions/export, GET role-changes, POST reconstruct, GET stats, POST validate-chain | Nessun `AuditModule`; non importato da nessuno |
| `AuthController` (duplicato) | `apps/backend/src/api/auth/auth.controller.ts` | `auth` | GET login, POST callback, POST refresh, POST logout, GET session, GET spid-status | Duplica il path `auth` del controller realmente attivo (`auth/controllers/auth.controller.ts`) — se venisse cablato per errore, collisione di route |
| `MetricsController` | `apps/backend/src/api/monitoring/metrics.controller.ts` | `` (root) | GET metrics | Non confondere con l'endpoint `/metrics` reale, servito da `PrometheusModule` (libreria esterna, non questo controller) |
| `PoliciesController` | `apps/backend/src/api/policies/policies.controller.ts` | `policies` | POST, GET, GET:id, PATCH:id/deactivate, PATCH:id/activate, DELETE:id | Nessun modulo dedicato |
| `TaskAssignmentController` | `apps/backend/src/api/task-assignment/task-assignment.controller.ts` | `tasks` | POST:firId/assign, PUT:firId/reassign, GET:firId/qualified-drivers, GET my-assignments | Nessun modulo dedicato |
| `FIRController` | `apps/backend/src/api/fir/fir.controller.ts` | `fir` | POST, GET | **Il vero FIR controller attivo è un altro file**: `FIRModule` monta `FIRControllerV2` da `api/fir/fir.controller.v2.ts` (non incluso nell'elenco originale dei 36 file). Questo file è vecchio codice sostituito, mai rimosso |
| `AuditController` (permissions) | `apps/backend/src/api/permissions/audit.controller.ts` | `audit` | GET permissions, GET permissions/:userId, GET permissions/resource/:resourceType/:resourceId, GET permissions/export, GET role-changes, POST reconstruct-permissions, GET statistics, GET chain-integrity | Escluso esplicitamente da `permissions.module.ts` (commento: dipendenze CQRS senza `@Inject` esplicito) |
| `ConsultantController` | `apps/backend/src/api/permissions/consultant.controller.ts` | `consultant` | GET tenants, POST switch-tenant, GET dashboard, POST associate, DELETE associations/:id | Escluso esplicitamente, stesso motivo |
| `RoleController` | `apps/backend/src/api/permissions/role.controller.ts` | `roles` | GET, GET:id, POST, PUT:id, DELETE:id, POST:id/permissions, DELETE:id/permissions/:permissionId | Escluso esplicitamente, stesso motivo |
| `TemporaryPermissionController` | `apps/backend/src/api/permissions/temporary-permission.controller.ts` | `permissions` | POST request, GET pending, POST:id/approve, POST:id/reject, POST:id/revoke, GET my-grants | Escluso esplicitamente, stesso motivo |
| `UserRoleController` | `apps/backend/src/api/permissions/user-role.controller.ts` | `user-roles` | POST assign, DELETE:id, GET user/:userId | Escluso esplicitamente, stesso motivo |
| `RENTRISyncController` | `apps/backend/src/api/rentri/rentri-sync.controller.ts` | `rentri/sync` | POST fir/:id, POST batch, GET status/:jobId, GET logs, GET metrics | Nessun modulo lo registra; `RentriModule` monta solo `RentriCredentialController`. Funzionalità di sync RENTRI batch/queue presente nel codice ma mai esposta via HTTP |

**Impatto pratico**: l'intero sottosistema di gestione ruoli/permessi granulari lato API (assegnazione ruoli custom, permessi temporanei, audit trail dei cambi ruolo, associazioni consulente) **non è raggiungibile da nessun client**, nonostante il backend (servizi, use case, repository, guard) sia completamente implementato e testato. Allo stesso modo la sincronizzazione batch RENTRI (`RENTRISyncController`) non è esposta. Questi vanno considerati nel piano UAT come "funzionalità non testabili via API perché non montate", non come bug applicativi in senso stretto — ma vale la pena decidere esplicitamente se cablarli o rimuoverli (codice morto che genera falso senso di copertura).
