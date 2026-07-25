# Audit UAT 2026-07-25 — Frontend Flow Mapper (WasteFlow)

Branch: develop. Frontend Angular 17 standalone + PrimeNG, `apps/frontend/src/app`.
Nessun file di codice è stato modificato per produrre questo audit.

## 1. Tabella rotte

Unica route table: `app.routes.ts` (nessun `loadChildren`/routing modulare per
feature: tutte le feature sono `loadComponent` lazy montate come figlie di un
unico `LayoutComponent` protetto da `authGuard`). Non esistono guard di ruolo o
permesso a livello di `canActivate` — TUTTO il gating per ruolo/feature-flag è
lato **UI (menu)** e lato **backend**, non lato router. Questo è un gap di
difesa-in-profondità da segnalare (vedi §3).

| Path | Componente | Guard | Ruoli (enforcement) | Feature flag | File |
|---|---|---|---|---|---|
| `/login` | LoginComponent | — (pubblica) | — | — | features/auth/login.component.ts |
| `/richiedi-accesso` | AccessRequestComponent | — (pubblica) | — | — | features/auth/signup/signup.component.ts |
| `/signup` | redirect → `/richiedi-accesso` | — | — | — | app.routes.ts |
| `/auth/callback` | AuthCallbackComponent | — (pubblica) | — | — | features/auth/auth-callback.component.ts |
| `/legal/termini` | LegalPageComponent | — (pubblica) | — | — | features/legal/legal-page.component.ts |
| `/legal/privacy` | LegalPageComponent | — (pubblica) | — | — | features/legal/legal-page.component.ts |
| `/legal/dpa` | LegalPageComponent | — (pubblica) | — | — | features/legal/legal-page.component.ts |
| `/` (layout shell) | LayoutComponent | `authGuard` | tutti gli utenti autenticati | — | shared/components/layout.component.ts |
| `/` → `/dashboard` | redirect | (ereditato) | — | — | app.routes.ts |
| `/dashboard` | DashboardPageComponent | (ereditato) | tutti | sempre visibile (no gate) | features/dashboard/dashboard-page/ |
| `/fir` | FirListComponent | (ereditato) | tutti (scrittura RBAC lato componente/backend) | `fir` (solo voce menu) | features/fir/fir-list.component.ts |
| `/cer` | CerSearchComponent | (ereditato) | tutti | `cer` (solo voce menu) | features/cer/cer-search.component.ts |
| `/produttori` | ProduttoriListComponent | (ereditato) | tutti | `anagrafiche` (sezione menu) | features/registry/produttori-list.component.ts |
| `/trasportatori` | TrasportatoriListComponent | (ereditato) | tutti | `anagrafiche` | features/registry/trasportatori-list.component.ts |
| `/destinatari` | DestinatariListComponent | (ereditato) | tutti | `anagrafiche` | features/registry/destinatari-list.component.ts |
| `/notifications` | NotificationsPageComponent | (ereditato) | tutti | — (non in navMain, raggiungibile solo da campanella) | features/notifications/notifications-page/ |
| `/mud` | MudComponent | (ereditato) | tutti | `mud` | features/mud/mud.component.ts |
| `/esg` | EsgComponent | (ereditato) | tutti | `esg` | features/esg/esg.component.ts |
| `/giacenze` | GiacenzeComponent | (ereditato) | tutti | `giacenze` | features/giacenze/giacenze.component.ts |
| `/registro` | RegistroComponent | (ereditato) | tutti | `registro` | features/registro/registro.component.ts |
| `/anomalie` | AnomalyComponent | (ereditato) | tutti | `anomalie` | features/anomaly/anomaly.component.ts |
| `/contratti` | ContractsListComponent | (ereditato) | tutti | `contratti` | features/contracts/contracts-list.component.ts |
| `/reference-data` | ReferenceDataComponent | (ereditato) | tutti (reseed presumibilmente admin-gated lato backend) | `reference_data` | features/reference-data/reference-data.component.ts |
| `/abbonamento` | BillingPageComponent | (ereditato) | tutti (sempre in menu, "Account") | — (nessuna) | features/billing/billing-page.component.ts |
| `/admin/tenants` | TenantAdminComponent | (ereditato) | SUPER_ADMIN / ADMIN (solo UI+backend, NO route guard) | — | features/admin/tenants/tenant-admin.component.ts |
| `/admin/utenti` | UserAdminComponent | (ereditato) | SUPER_ADMIN / ADMIN (solo UI+backend, NO route guard) | — | features/admin/users/user-admin.component.ts |
| `/rentri/certificato` | RentriCredentialComponent | (ereditato) | solo admin (voce menu `adminOnly`, backend risponde 403) | `rentri` | features/rentri/rentri-credential.component.ts |
| `/permissions/roles` | RoleManagementComponent | (ereditato) | (da verificare lato backend) | — | features/permissions/pages/role-management/ |
| `/permissions/roles/create` | CustomRoleBuilderComponent | (ereditato) | — | — | features/permissions/pages/custom-role-builder/ |
| `/permissions/roles/edit/:id` | CustomRoleBuilderComponent | (ereditato) | — | — | features/permissions/pages/custom-role-builder/ |
| `/permissions/my-permissions` | PermissionDiscoveryComponent | (ereditato) | tutti (self-service) | — | features/permissions/pages/permission-discovery/ |
| `/permissions/audit` | AuditTrailViewerComponent | (ereditato) | presumibilmente admin (da verificare) | — | features/permissions/pages/audit-trail-viewer/ |
| `/permissions/consultant-dashboard` | ConsultantDashboardComponent | (ereditato) | CONSULTANT (da verificare) | — | features/permissions/pages/consultant-dashboard/ |
| `/permissions/my-grants` | MyGrantsComponent | (ereditato) | tutti | — | features/permissions/pages/my-grants/ |
| `/permissions/pending-grants` | PendingGrantsComponent | (ereditato) | admin/approvatore (da verificare) | — | features/permissions/pages/pending-grants/ |
| `/permissions/my-assignments` | MyAssignmentsComponent | (ereditato) | operatore/autista (da verificare) | — | features/permissions/pages/my-assignments/ |
| `/permissions/denied` | PermissionDeniedComponent | (ereditato) | tutti (pagina di errore 403) | — | features/permissions/pages/permission-denied/ |
| `**` | redirect → `/dashboard` | — | — | — | app.routes.ts |

**Totale rotte configurate: 34** (incluse redirect `/signup` e wildcard).

**Guard esistenti ma NON collegati ad alcuna rotta in `app.routes.ts`:**
- `OfflineHighRiskGuard` (`core/guards/offline-high-risk.guard.ts`) — pensato per
  bloccare operazioni ad alto rischio (delete/approve/signature/revoke) quando
  offline (FR-041), ma nessuna route lo referenzia oggi. Debito da segnalare.
- `SpidLevelGuard` (class-based, deprecato, dentro `auth.guard.ts`) — pensato per
  richiedere SPID livello 2+ prima della firma digitale, mai agganciato a rotte.

**Componenti "orfani" (esistono ma non sono raggiungibili da nessuna rotta):**
- `features/verify/verify-signatures/verify-signatures.component.ts` — nessuna
  route, nessun import altrove. Verificare se è dead code o se manca il wiring
  (funzione "verifica firme digitali" potenzialmente non raggiungibile in UAT).
- `features/task-assignment/components/driver-assignment-dialog/...` — non è una
  route, ma un dialog aperto da altrove (verificare punto di invocazione, non
  trovato tra i risultati grep — solo il servizio `TaskAssignmentApiService` è
  referenziato da `my-assignments.component.ts`).

## 2. Aree funzionali — flusso utente e API

Per ciascuna, elenco file service, endpoint principali osservati (da
`this.http.get/post/put/patch/delete`) e flusso utente sintetico.

### Auth (`features/auth/`)
- Componenti: `login.component.ts`, `auth-callback.component.ts`,
  `signup/signup.component.ts` (+ `signup.service.ts`), `spid-login/`,
  `spid-callback/`, `components/spid-reauth-modal/`.
- Flusso: utente su `/login` clicca "Accedi" → `AuthService.loginWithSPID()` →
  redirect browser a `${apiUrl}/auth/spid/login?provider=spid` (fuori Angular,
  full page redirect verso Keycloak/SAML IdP) → al ritorno l'IdP fa POST verso
  il backend che genera i token e reindirizza a `/auth/callback#accessToken=...
  &refreshToken=...` → `AuthCallbackComponent` legge il fragment, chiama
  `AuthService.completeSpidLogin()` (salva token in `localStorage`, poi
  `GET /auth/profile`), pulisce l'URL (`history.replaceState`) e naviga a
  `/dashboard`.
- Endpoint: `POST /auth/dev/login` (login legacy email-only, probabilmente solo
  dev), `POST /auth/access-request` (richiesta accesso pubblica),
  `GET /auth/spid/login`, `POST /auth/callback` (SAML legacy),
  `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/profile`,
  `GET /auth/spid-status`.
- UAT critico: intero ciclo login → deep-link su rotta protetta senza sessione →
  redirect a `/login?returnUrl=...` → dopo login torna alla rotta originale.

### Dashboard (`features/dashboard/`)
- Due componenti: `dashboard.component.ts` (legacy?) e
  `dashboard-page/dashboard-page.component.ts` (quello effettivamente montato
  su `/dashboard`). Verificare se il primo è dead code.
- Service: `core/services/dashboard.service.ts`.
- Flusso: prima pagina post-login, sempre raggiungibile (nessun feature-flag),
  presumibilmente KPI/riepilogo cross-modulo.

### FIR (`features/fir/`)
- Service: `fir.service.ts`, `services/rentri-sync.service.ts`.
- Componenti: `fir-list.component.ts` (list + dialog crea/consegna, NON pagine
  di dettaglio separate — tutto in dialog PrimeNG), `fir-list-enhanced.component.ts`
  (variante, verificare quale è quella attiva — solo `fir-list.component.ts` è
  routata), `signature-dialog/`, `signature-status/`,
  `components/rentri-sync-badge/`, `components/rentri-sync-logs/`.
- Flusso: lista FIR paginata → "Nuovo FIR" apre dialog di creazione (con
  sub-dialog per creare/modificare anagrafiche produttore/trasportatore/
  destinatario al volo) → azioni sul FIR: emetti, presa-in-carico,
  conferma-consegna, annulla, firma digitale, sync RENTRI.
- Endpoint: `GET /fir` (paginato), `GET /fir/:id`, `POST /fir`,
  `POST /fir/:id/emetti`, `POST /fir/:id/presa-in-carico`,
  `POST /fir/:id/conferma-consegna`, `POST /fir/:id/annulla`,
  `POST /rentri-sync/fir/:id`, `POST /rentri-sync/batch`,
  `GET /rentri-sync/status/:jobId`, `GET /rentri-sync/logs`,
  `GET /rentri-sync/metrics`.
- UAT critico: ciclo di vita completo BOZZA→EMESSO→IN_TRANSITO→CONSEGNATO
  (già noto da memoria progetto come area con bug corretti in 09d8fd5 — priorità
  di re-test).

### Registro C/S (`features/registro/`)
- Service: `registro.service.ts`. Endpoint: `POST /registro-carico-scarico`
  (crea movimento), `GET /registro-carico-scarico` (paginato).
- Flusso: registro cronologico art. 190 D.Lgs 152/2006, form inserimento
  movimento + elenco filtrato.

### Registry / Anagrafiche (`features/registry/`)
- Service: `registry.service.ts` (CRUD completo produttori/trasportatori/
  destinatari + ricerca). Endpoint: `GET/POST/PUT/DELETE /produttori[/:id]`,
  stesso pattern per `/trasportatori`, `/destinatari`, più `/*/search`.
- Componenti: 3 liste (`produttori-list.component.ts`, +
  `produttori-list-enhanced.component.ts` variante da verificare),
  `trasportatori-list.component.ts`, `destinatari-list.component.ts`,
  `anagrafica-form-dialog.component.ts` (dialog condiviso, riusato anche da FIR).
- Flusso: 3 sezioni "Anagrafiche" nel menu (gated da feature `anagrafiche`),
  CRUD standard su ciascuna entità via dialog.

### CER (`features/cer/`)
- Service: `cer.service.ts`. Endpoint: `GET /cer` (paginato), `GET /cer/:code`,
  `GET /cer/search`, `GET /cer/categories`.
- Componenti: `cer-search.component.ts` (routata su `/cer`),
  `cer-select.component.ts` (probabilmente un picker riusato in altri form, es.
  FIR/registro — verificare uso).
- Flusso: ricerca/consultazione catalogo codici CER, sola lettura.

### MUD (`features/mud/`)
- Service: `mud.service.ts`. Endpoint: `GET /mud/export/versions`,
  `GET /mud/generate?year=`, `GET /mud/export`.
- Flusso: selezione anno → generazione file MUD → download export versionato
  (nota progetto: V6.04/24 rifiuti speciali).

### ESG / CO2 (`features/esg/`)
- Service: `esg.service.ts`. Endpoint: `GET /esg/report`.
- Flusso: dashboard/report parametrico (filtri periodo presumibili via `params`).

### Giacenze (`features/giacenze/`)
- Service: `giacenze.service.ts`. Endpoint: `GET /giacenze`,
  `GET /giacenze/deposito-temporaneo/alerts`.
- Flusso: stato giacenze + alert deposito temporaneo (limiti tempo/quantità
  art. 185-bis).

### Contratti (`features/contracts/`)
- Service: `contracts.service.ts`. Endpoint: `GET /contratti` (paginato),
  `GET /contratti/:id`, `POST /contratti`, `PATCH /contratti/:id/status`,
  `GET /contratti/auto-fill`.
- Flusso: gestione contratti con trasportatori/destinatari, cambio stato,
  autocompletamento da FIR.

### Anomalie (`features/anomaly/`)
- Service: `anomaly.service.ts`. Endpoint: `GET /anomalie` (o simile, un solo
  GET osservato).
- Flusso: elenco anomalie rilevate (probabile sola lettura/triage).

### Reference data (`features/reference-data/`)
- Service: `reference-data.service.ts`. Endpoint: `GET /reference-data/status`,
  `GET /reference-data/comuni?q=`, `GET /reference-data/ateco?q=`,
  `POST /reference-data/.../reseed` (azione presumibilmente riservata ad
  admin — verificare in UAT che un OPERATOR non veda/possa invocare il reseed:
  nessun gate lato route, solo eventuale gate lato componente/backend).
- Flusso: stato dati di riferimento ISTAT/ATECO + ricerca comuni/ATECO
  (autocomplete, riusato presumibilmente in form anagrafica).

### Billing / Abbonamento (`features/billing/`)
- Service: `core/services/billing-api.service.ts`.
- Flusso: pagina "Abbonamento" — piano SaaS, upgrade, Stripe Billing Portal.
  Sempre in menu ("Account"), nessun feature-flag: verificare se questo è
  intenzionale (accessibile anche a tenant TRIAL/scaduti).

### Legal (`features/legal/`)
- `legal-page.component.ts` con `data: { page: 'termini'|'privacy'|'dpa' }` —
  pagine pubbliche statiche, nessuna chiamata API prevista.

### Verify (`features/verify/`)
- `verify-signatures/verify-signatures.component.ts` — **non routato, non
  importato altrove**. Da chiarire con il team se è una feature dismessa o un
  wiring mancante (funzione di verifica firme digitali sui documenti/FIR).

### Notifications (`features/notifications/`)
- Componente unico con chiamate HTTP dirette (non un service dedicato):
  `GET ${apiUrl}/user` (elenco notifiche utente), `PATCH ${apiUrl}/:id/read`,
  `POST ${apiUrl}/mark-all-read`.
- Raggiungibile solo dalla campanella (`NotificationBellComponent`) in topbar,
  non presente nel menu laterale — verificare se `/notifications` è comunque
  navigabile via URL diretto (sì, è una route valida sotto il layout protetto).

### Permissions / RBAC (`features/permissions/`)
- Area più ricca: 9 pagine, 9 componenti, 3 direttive (`has-permission`,
  `permission-tooltip`, `require-permission` — usate per gating UI a grana fine
  nei template di altre feature), 3 pipe, 5 service
  (`audit-api`, `permission-api`, `role-api`, `temporary-permission-api`,
  `tenant-switch`).
- Flussi principali:
  - **Role management** (`/permissions/roles`): elenco ruoli custom, creazione/
    modifica via `custom-role-builder` (`POST/PUT /roles`), assegnazione utente-
    ruolo (`POST /user-roles/assign`, `DELETE /user-roles/:id`).
  - **My permissions** (`/permissions/my-permissions`): self-service discovery
    (`GET /permissions/my-permissions`) — QUESTA pagina ha già `data-testid`
    ricchi (vedi §3), buon esempio da replicare altrove.
  - **Audit trail** (`/permissions/audit`): `GET /audit/permissions`,
    `GET /audit/permissions/export`, `GET /audit/role-changes`,
    `POST /audit/reconstruct`, `GET /audit/stats`, `POST /audit/validate-chain`.
  - **Temporary grants**: richiesta (`POST /temporary-permissions/request`),
    approvazione/rifiuto/revoca (`POST .../approve|reject|revoke`), elenco
    pending (`GET .../pending`) e propri grant (`GET .../my-grants`) — pagine
    `pending-grants` e `my-grants`.
  - **Consultant dashboard** (`/permissions/consultant-dashboard`): usa
    `GET /api/v1/consultant/dashboard` e
    `POST /api/v1/consultant/tenants/:id/retry-rentri-sync` (endpoint scritto
    con path assoluto `/api/v1/...` invece che via `environment.apiUrl` — DA
    VERIFICARE se questo rompe il deploy dietro un path diverso o in ambienti
    dove `apiUrl` non è la root `/api/v1`; stesso pattern in
    `tenant-selector.component.ts` con `GET /api/v1/consultant/tenants`).
  - **My assignments** (`/permissions/my-assignments`): usa
    `TaskAssignmentApiService` (`GET .../my-assignments`,
    `GET .../:firId/qualified-drivers`, `POST .../:firId/assign`,
    `PUT .../:firId/reassign`) — collega Permissions con Task Assignment.
  - **Permission denied** (`/permissions/denied`): pagina 403 friendly con CTA
    "torna indietro" / "richiedi accesso".

### Task assignment (`features/task-assignment/`)
- Nessuna route dedicata: raggiunto solo tramite
  `my-assignments.component.ts` (sotto `/permissions/my-assignments`) e il
  dialog `driver-assignment-dialog` (punto di apertura non individuato via
  grep — probabile invocazione da FIR list o da un componente non ancora
  ispezionato in dettaglio; segnalare per verifica mirata in UAT).

### RENTRI (`features/rentri/`)
- Service: `rentri-credential.service.ts`. Endpoint: `GET/PUT/DELETE` su un
  unico `API_URL` (verosimilmente `/rentri/credenziali` o simile).
- Flusso: pagina "Certificato RENTRI" (solo menu admin) — upload/gestione
  certificato digitale per integrazione RENTRI, eliminazione credenziale.

### Admin — Tenants (`features/admin/tenants/`)
- Service: `tenant-admin.service.ts`. Endpoint: `GET/POST /admin/tenants`,
  `GET/PUT /admin/tenants/:id`, `PATCH /admin/tenants/:id/status`.
- Flusso: gestione piattaforma tenant — SUPER_ADMIN vede tutti, ADMIN vede/
  gestisce "le mie aziende" (stessa route, label dinamica in base al ruolo,
  enforcement query lato backend).

### Admin — Users (`features/admin/users/`)
- Service: `user-admin.service.ts`. Endpoint: `GET/POST /admin/users`,
  `PATCH /admin/users/:id/role`, `PATCH /admin/users/:id/status`,
  `PATCH /admin/users/:id/company-limit`, `GET /admin/tenants` (per dropdown),
  `POST /admin/users/:id/impersonate` — **funzione di impersonificazione**,
  collegata al banner globale in `LayoutComponent` (vedi `wf_impersonator_*` in
  localStorage). UAT critico: avvio impersonificazione → banner visibile →
  azioni come utente impersonato → "Torna al tuo account" ripristina token
  originali senza richiedere nuovo login.

## 3. Gating per ruolo e feature flag

- **Meccanismo feature flag**: `FeatureFlagsService.load()` chiama
  `GET /me/features` una sola volta all'avvio del layout (`ngOnInit`), cache in
  memoria (signal), fail-closed silenzioso su errore (nessuna voce opzionale
  visibile, ma la Dashboard resta sempre raggiungibile). Il layout switch tenant
  fa `window.location.reload()` per ricaricare le feature del nuovo contesto.
- **Voci di menu gated da feature** (`navMain` in `layout.component.ts`): FIR
  (`fir`), Registro C/S (`registro`), CER (`cer`), MUD (`mud`), Giacenze
  (`giacenze`), Contratti (`contratti`), ESG/CO2 (`esg`), Anomalie (`anomalie`).
  Dashboard non ha `feature` → sempre visibile.
- **Sezione intera gated**: "Anagrafiche" (produttori/trasportatori/destinatari)
  dietro singola feature `anagrafiche`.
- **Impostazioni** (`navImpostazioni`): "Certificato RENTRI" (feature `rentri`
  + `adminOnly: true` → richiede ANCHE ruolo SUPER_ADMIN/ADMIN), "Dati di
  riferimento" (feature `reference_data`, nessun gate di ruolo in UI nonostante
  il reseed sia un'azione sensibile).
- **Gating per ruolo (solo UI, `computed()` su `authService.currentUser()?.role`)**:
  - `isSuperAdmin` → tenant switcher "reale" con dropdown tenant.
  - `canSeeAdminSection` (`SUPER_ADMIN`|`ADMIN`) → intera sezione
    "Amministrazione" nel menu (Tenants + Utenti).
  - `canSeeTenants` (`SUPER_ADMIN`|`ADMIN`) → voce Tenants/aziende, con label
    dinamica ("Tenant" vs "Le mie aziende").
- **IMPORTANTE — nessun `canActivate` per ruolo/permesso su `app.routes.ts`**:
  tutte le rotte admin (`/admin/tenants`, `/admin/utenti`,
  `/rentri/certificato`, tutte le `/permissions/*`) sono raggiungibili da
  QUALUNQUE utente autenticato via URL diretto — il nascondimento è solo nel
  menu. L'enforcement reale è delegato al backend (403 atteso). **Scenario UAT
  obbligatorio**: loggato come OPERATOR/VIEWER, navigare manualmente a
  `/admin/tenants`, `/admin/utenti`, `/rentri/certificato`,
  `/permissions/roles/create` e verificare che il componente gestisca
  correttamente il 403 (redirect a `/permissions/denied`? messaggio? pagina
  vuota rotta?) — comportamento da osservare empiricamente, non deducibile dal
  solo routing.
- **Direttive permission-based** (`has-permission`, `require-permission`,
  `permission-tooltip` in `features/permissions/directives/`) — usate
  presumibilmente dentro i template delle altre feature per nascondere/disabled
  singoli bottoni (create/edit/delete) in base al permesso puntuale, non solo
  al ruolo grezzo. Verificare in UAT con un utente VIEWER che i bottoni di
  scrittura in FIR/Registro/Anagrafiche/Contratti risultino effettivamente
  disabilitati o nascosti (coerente con l'audit RBAC già chiuso in 09d8fd5, ma
  utile ri-verificare qui dal lato UI puro).

## 4. Testabilità: selettori disponibili / mancanti

**Stato complessivo**: su 54 componenti feature, `data-testid`/`data-cy` sono
presenti in sole **6 aree** (copertura ~10%):
- `features/auth/spid-login/spid-login.component.ts` (`spid-button`,
  `cie-button`) — MA questo componente non risulta montato da nessuna route
  attiva (login attuale usa solo `onSPIDLogin()` via un bottone senza
  `data-cy`/`data-testid`) — verificare se `spid-login` è un residuo di UI
  precedente.
- `core/layout/tenant-selector/tenant-selector.component.ts` (`tenant-selector`,
  `tenant-option`) — MA il layout attivo (`shared/components/layout.component.ts`)
  usa un **markup diverso e inline** (dropdown `p-dropdown` senza `data-cy`) per
  il tenant switcher — probabile componente legacy non più usato dal layout
  corrente. Verificare quale codice è davvero live.
- `core/layout/header/header.component.ts` (`spid-level-badge`,
  `can-sign-indicator`, `user-menu`, `user-fiscal-code`, `user-email`,
  `spid-level`, `logout-button`) — stesso dubbio: il layout attivo ha un proprio
  markup per user-card/logout SENZA questi attributi. `header.component.ts`
  sembra non essere importato da `layout.component.ts` (che non lo referenzia
  negli `imports`). Probabile componente orfano/dead code.
- `features/permissions/pages/my-assignments/` — buona copertura
  (`sort-select`, `assignment-{firId}`, `status-{status}`,
  `view-details-{firId}`, `start-pickup-{firId}`).
- `features/permissions/pages/permission-denied/` (`go-back-button`,
  `request-access-button`).
- `features/permissions/pages/permission-discovery/` — ottima copertura
  (`role-badge`, `permission-accordion`, `category-header`,
  `category-content-{key}`, `permission-item-{raw}`, `permission-icon`,
  `permission-status`, `help-icon`, `permission-grid`).

**GAP DI TESTABILITÀ (debito da segnalare)**: le 13 feature con più valore di
business — FIR, Registro, CER, MUD, Giacenze, Contratti, ESG, Anomalie,
Registry/Anagrafiche, Admin Tenants/Utenti, RENTRI, Billing, Reference-data —
**non hanno NESSUN `data-testid`/`data-cy`**. Per queste, i selettori Playwright
dovranno appoggiarsi a:
- **Ruoli ARIA + testo accessibile** (il layout usa buoni `aria-label`/
  `role`/`aria-current` — es. `getByRole('link', { name: 'FIR' })`,
  `getByRole('navigation', { name: 'Navigazione principale' })`).
- **Testo visibile dei bottoni PrimeNG** (`label="Nuovo FIR"` →
  `getByRole('button', { name: 'Nuovo FIR' })`), fragile a cambi di copy IT.
- **Classi CSS semantiche stabili** (`.fir-dialog`, `.nav-item--active`) come
  ultima risorsa — sconsigliato per Playwright ma unica àncora in alcuni dialog.
- **Placeholder/label di form** (`p-dropdown` con `inputId`/`label for=` sono
  presenti in modo consistente nel layout — buon aggancio per
  `getByLabel(...)`).

**Raccomandazione esplicita per il team dev** (da riportare come follow-up, non
eseguita qui essendo un audit read-only): aggiungere `data-testid` sistematici
almeno su: bottoni "Nuovo/Crea" di ogni lista, righe tabella (id business),
bottoni azione per riga (emetti/consegna/annulla/elimina), stato/badge FIR,
dialog di conferma, messaggi toast di successo/errore.

## 5. Flusso di autenticazione (dettaglio)

1. **Avvio login**: `/login` mostra un solo bottone "Accedi" (SPID/CIE separati
   predisposti in `AuthService.loginWithSPID()`/`loginWithCIE()` ma il
   componente attuale chiama solo `onSPIDLogin()`) → **full-page redirect**
   (`window.location.href`, non un `router.navigate`) a
   `${apiUrl}/auth/spid/login?provider=spid&returnUrl=...` → esce dalla SPA,
   entra nel flusso Keycloak/SAML esterno.
2. **Ritorno dall'IdP**: il backend, dopo aver validato l'IdP, reindirizza il
   browser a `/auth/callback#accessToken=...&refreshToken=...&expiresIn=...`
   (token nel **fragment URL**, mai in query string → non finiscono nei log
   server). `AuthCallbackComponent.ngOnInit()` fa `URLSearchParams` sul
   fragment, se mancano i token torna a `/login`, altrimenti chiama
   `completeSpidLogin()`.
3. **Persistenza token**: `localStorage.setItem('accessToken'|'refreshToken')`
   — NON sessionStorage, NON cookie httpOnly — i token sono quindi leggibili da
   qualunque script lato client (superficie XSS, non modificabile in questo
   audit ma da segnalare come nota di sicurezza).
4. **Pulizia URL**: `history.replaceState(null, '', pathname)` rimuove il
   fragment con i token subito dopo averli letti, poi `router.navigate(['/dashboard'])`.
5. **Bootstrap sessione ad ogni reload** (`AuthService.initializeAuth()`,
   chiamato dal costruttore, quindi ad OGNI istanziazione — praticamente al
   load app): se c'è un `accessToken` in localStorage:
   - se il JWT (claim `exp`) non è scaduto → `isAuthenticated` = true
     OTTIMISTICAMENTE (decodifica payload lato client, nessuna verifica
     firma), popolando anche `currentUser` dai claim del token (id/email/nome/
     ruolo) — questo garantisce che l'`authGuard` non fallisca prima che
     `/auth/profile` risponda (comportamento pensato apposta per i deep-link).
   - in parallelo chiama `GET /auth/profile` per idratare la sessione "vera";
     su 401 tenta un refresh (`POST /auth/refresh`) UNA volta, se anche quello
     fallisce → `clearSession()` (rimuove tutte le chiavi incluse quelle di
     impersonificazione) SENZA `localStorage.clear()` totale.
   - su errori non-401 (rete/5xx transitori) NON tocca la sessione — i token
     restano, retry al giro successivo.
6. **Interceptor `authInterceptor`** (`core/interceptors/auth.interceptor.ts`):
   allega `Authorization: Bearer <accessToken>` a tutte le richieste tranne una
   lista di endpoint pubblici (`/auth/spid`, `/auth/callback`, `/auth/refresh`,
   `/health`, `/auth/access-request`). Su 401: se non c'è refresh token → logout
   e redirect a login con `returnUrl`; altrimenti tenta un refresh (UNA sola
   chiamata condivisa via `shareReplay` anche sotto burst di richieste
   concorrenti) e ritenta la richiesta originale col nuovo token; se anche il
   refresh fallisce → stesso logout+redirect.
7. **Interceptor `tenantInterceptor`**: se `AdminTenantContextService` ha un
   tenant selezionato (super admin / utente multi-azienda), aggiunge header
   `X-Tenant-ID` a ogni richiesta verso `environment.apiUrl` (NON a chiamate con
   path assoluto hardcoded come `/api/v1/consultant/...` viste in
   `consultant-dashboard`/`tenant-selector` — possibile inconsistenza: quelle
   chiamate potrebbero non ricevere l'header tenant se `environment.apiUrl` non
   è la stringa `/api/v1` esatta — DA VERIFICARE IN UAT con uno switch tenant
   attivo).
8. **Logout**: `POST /auth/logout` (best-effort, anche su errore fa comunque
   `clearSession()` + redirect) rimuove `accessToken`, `refreshToken`, e le 4
   chiavi di impersonificazione (`wf_impersonator_token`,
   `wf_impersonator_refresh`, `wf_impersonating_name`, `wf_admin_tenant`).
9. **Deep-link su rotta protetta senza sessione**: `authGuard` verifica
   `isTokenValid()` (solo presenza + `exp` non scaduto, nessuna verifica
   server-side sincrona) → se invalido, `clearSession()` + redirect a
   `/login?returnUrl=<url originale>` → dopo login, `LoginComponent` legge
   `returnUrl` da query params e naviga lì (ma questo path esiste solo nel
   flusso `onLogin()` legacy email — il flusso reale via SPID passa per
   `AuthCallbackComponent` che naviga SEMPRE a `/dashboard` fisso, **ignorando
   `returnUrl`** — POSSIBILE BUG/GAP: un deep-link a `/fir/123` da utente non
   loggato, dopo il login SPID, atterra su `/dashboard` invece che tornare a
   `/fir`). Da verificare/confermare in UAT — impatto medio su UX.

## 5 flussi utente più critici da coprire in UAT

1. **Login SPID/Keycloak completo + deep-link**: `/login` → redirect esterno →
   `/auth/callback` con token in fragment → sessione idratata → verificare se
   `returnUrl` viene rispettato o si perde (sospetto bug, vedi §5.9).
2. **Ciclo di vita FIR completo**: crea (con eventuale creazione anagrafica al
   volo) → emetti → presa in carico → conferma consegna / annulla → firma
   digitale → sync RENTRI — area con più bug storici (audit E2E 09d8fd5),
   priorità massima di re-test.
3. **Gating per ruolo su rotte admin senza guard**: login come OPERATOR/VIEWER
   → navigazione diretta via URL a `/admin/tenants`, `/admin/utenti`,
   `/rentri/certificato`, `/permissions/roles/create` → verificare 403/handling
   coerente (nessun `canActivate` di ruolo protegge queste rotte lato router).
4. **Impersonificazione SUPER_ADMIN → utente**: avvio da `/admin/utenti` →
   banner globale visibile e persistente su ogni pagina → operazioni come
   utente impersonato → uscita ("Torna al tuo account") → verifica ripristino
   pulito del token originale senza re-login.
5. **Tenant switch (SUPER_ADMIN e utente multi-azienda)**: cambio tenant da
   dropdown → reload pagina → feature-flag e menu ricalcolati per il nuovo
   tenant → verificare che l'header `X-Tenant-ID` raggiunga TUTTE le chiamate
   incluse quelle con path assoluto hardcoded (`consultant-dashboard`,
   `tenant-selector`) che potrebbero bypassare l'interceptor.
