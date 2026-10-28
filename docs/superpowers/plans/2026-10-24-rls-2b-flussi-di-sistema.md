# RLS pezzo 2b: i flussi che lavorano su più aziende passano dal client di sistema (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** prima che il pezzo 3 attivi le policy, ogni operazione che per natura vede più aziende deve usare `PrismaSistemaService` (ruolo `wasteflow_sistema`, `BYPASSRLS`), e non il client dell'applicazione. Sono:
- i cron;
- la ricerca dell'utente al login e alla validazione del token;
- la verifica pubblica di un FIR;
- i cruscotti del super admin;
- i seed.

Le operazioni di una sola azienda dentro un cron girano in `TenantContext.run({ tenantId })` col client normale.

**Cosa cambia in produzione:** nulla. Senza `DATABASE_URL_SISTEMA`, `PrismaSistemaService` usa la stessa connessione dell'applicazione (pezzo 1), e oggi le policy non esistono. Il pezzo prepara soltanto i confini, così il pezzo 3 non trova vuoti.

**Architettura:**
- Nei punti elencati sotto si sostituisce l'iniezione di `PrismaService` con `PrismaSistemaService`, oppure gli si affianca, solo per le operazioni che attraversano le aziende.
- Le operazioni per una singola azienda restano sul client normale, dentro un contesto con quel tenant.
- Un test statico fissa l'elenco dei file autorizzati a iniettare `PrismaSistemaService`. Chi lo usa altrove lo fa per scelta esplicita, aggiornando l'elenco e il README.

**Tech Stack:** NestJS 10, Prisma 5.22, PostgreSQL 16, Jest.

**Spec:**
- Decisioni di Graziano del 2026-10-23 e 2026-10-24 (`C:\Progetti\winwaste\docs\confronto-con-rifiuti.md`, ultime sezioni):
  - ruolo di sistema per i job cross-tenant;
  - un tenant alla volta;
  - il super admin senza azienda usa il client di sistema;
  - divisione 2a, 2b, 2c.
- Pezzo 2a in `master` (`0eb3a68`): `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md`.
- Mappa dei punti nell'analisi del 2026-10-24, sezioni 3 e 4. Le righe citate sotto vengono da lì: vanno riverificate sul codice, non prese per buone.

## Global Constraints

- **Branch e worktree:** `feat/rls-2b-flussi-sistema` in `C:\Progetti\rifiuti-wt-rls`, partito da `master` @ `f038c01`.
- **Nessuna policy e nessun cambio di risultato:** i test esistenti devono restare verdi senza modifiche alle loro asserzioni.
- **Criterio per il client di sistema:** lo si usa solo per le operazioni che non hanno, o non possono avere, un'azienda nota. Sono di due tipi:
  - elenco o scansione di tutte le aziende;
  - ricerca di un'entità prima di sapere a quale azienda appartiene: utente al login, FIR pubblico, membership.

  Appena l'azienda è nota, il lavoro successivo torna sul client normale dentro `TenantContext.run({ tenantId })`. Ogni uso del client di sistema ha accanto un commento di una riga che dice perché.
- **Per un job su tutte le aziende,** il contesto non deve ereditare quello della richiesta. Quando un super admin lo lancia a mano (`job-actions.service.ts`), il job gira fuori dal suo AsyncLocalStorage: niente `X-Tenant-ID` ereditato.
- **Dentro `TenantContext.run`** fai sempre `await` delle operazioni all'interno della callback, perché le PrismaPromise sono lazy (vedi il README del 2a).
- **Riservatezza:** niente id di azienda o di utente in nuovi messaggi d'errore verso l'utente. I log restano come oggi.
- **TDD obbligatorio:** prima il test, eseguito e visto fallire, poi il codice.
- **Comandi:**
  - `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - Postgres: `npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`, con `DATABASE_URL=postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public`;
  - `npx tsc --noEmit -p apps/backend/tsconfig.json`;
  - lint della CI in `apps/backend`: `npx eslint "{src,test}/**/*.ts" --quiet`, che deve dare 0 errori.
- **Commit:** in italiano, senza attribuzione AI; mai `git add -A`.

## Review Focus

1. **Cron lanciato a mano** da un super admin con `X-Tenant-ID`: non eredita quell'azienda, legge tutte le aziende dal client di sistema, e lavora ciascuna azienda nel suo contesto.
2. **Login SPID** per codice fiscale e **refresh**: l'utente si trova anche senza contesto. Dopo il lookup, ciò che riguarda l'azienda dell'utente gira con quell'azienda.
3. **Validazione del token di un super admin** con `X-Tenant-ID` di un'altra azienda: il suo utente si trova lo stesso. Oggi `jwt.strategy.ts` lo cerca col tenant dell'header.
4. **Verifica pubblica di un FIR** (`GET fir/:firId/verify`) senza token: trova il FIR e le firme.
5. **Elenco statico dei punti di sistema:** un nuovo file che inietta `PrismaSistemaService` fa fallire il test finché non viene aggiunto all'elenco.

---

### Task 1: cron e job su tutte le aziende

**Files** (Modify; righe da riverificare):
- `apps/backend/src/application/notifications/deadline-checker.service.ts`. I quattro cron attivi:
  - `checkMudDeadlines` (riga ~51);
  - `checkAuthorizationExpirations` (~257);
  - `checkRentriCertificateExpiration` (~666);
  - `cleanupOldNotifications` (~833).

  Le scansioni su tutte le aziende vanno sul client di sistema. Le scritture per azienda (`notification.create`, `mUDReport.upsert`) vanno nel contesto dell'azienda, oppure restano sul client di sistema con il `tenantId` esplicito nel `data`. La scelta va motivata nel report. Il default è il contesto dell'azienda, perché al pezzo 3 anche le scritture saranno controllate dalle policy.
- `apps/backend/src/application/notifications/notification-escalation.service.ts` (~36).
- `apps/backend/src/infrastructure/jobs/rentri-certificato-scadenza.job.ts` (~41).
- `apps/backend/src/infrastructure/jobs/rentri-riconciliazione.job.ts` (~42): l'elenco delle aziende passa sul client di sistema. Il giro per azienda c'è già (`riconcilia-stato-rentri.use-case.ts:102`).
- `apps/backend/src/infrastructure/jobs/rentri-rifornimento-scorta.job.ts` (~47): elenco sul client di sistema; ogni azienda dentro `TenantContext.run({ tenantId })`, che oggi manca.
- `apps/backend/src/infrastructure/jobs/rentri-trasmissioni-sospese.job.ts` (~40), insieme a `FIRPrismaRepository.elencaTrasmissioniRentriSospese` (`fir-prisma.repository.ts:~258`, raw su tutte le aziende), che passa sul client di sistema.
- `apps/backend/src/infrastructure/jobs/expire-temp-permissions.job.ts` e `cleanup-old-permission-requests.job.ts`, con i metodi di repository che scansionano tutte le aziende (`TemporaryPermissionGrantRepository.findGrantsNeedingExpiration` e il `findMany` alla riga ~48).
- `apps/backend/src/application/admin/system-health/job-actions.service.ts`: l'esecuzione manuale dei job avviene fuori dal contesto della richiesta. Usa `TenantContext.run({}, …)` o un'API equivalente che azzeri lo store; se `run` non permette uno store vuoto, aggiungi in `tenant-context.ts` un `runSenzaTenant(fn)`.
- Non cambiano i cron che toccano solo tabelle globali (`reference-data-seeder`, `rentri-codifiche-sync`). Scrivilo nel report.
- Test: gli spec esistenti dei job (`*.job.spec.ts`, `deadline-checker.service.spec.ts`, `notification-escalation.service.spec.ts`) aggiornati con un mock di `PrismaSistemaService`, più uno spec nuovo per `job-actions.service`.

- [ ] **Step 1: test che falliscono.**
  - Per ciascun job: `'<job>: elenco delle aziende dal client di sistema'`.
  - Per ciascun job che scrive per azienda: `'<job>: lavoro di ogni azienda nel suo contesto'`, che verifica `TenantContext.getStoreTenantId()` dentro il mock della scrittura.
  - `'job-actions: il job lanciato a mano non eredita il tenant della richiesta'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui gli spec toccati, `tsc` e lint. Gli spec di `deadline-checker` falliscono già in locale (10 test, problema d'ambiente noto): confronta con lo stato di `master` e riporta solo le differenze. Atteso: PASS sul resto.
- [ ] **Step 5: commit** `fix(rls): cron e job su tutte le aziende dal client di sistema, ogni azienda nel suo contesto`.

### Task 2: identità, login e cambio azienda

**Files** (Modify; righe da riverificare):
- `apps/backend/src/auth/strategies/spid.strategy.ts` (~99): ricerca per codice fiscale su tutte le aziende, sul client di sistema.
- `apps/backend/src/auth/controllers/auth.controller.ts`: `spid/callback` (~71) e `refresh` (~140) cercano l'utente sul client di sistema. Il lavoro sull'azienda che segue (`ruoloEffettivo`, ~126-135) gira con l'azienda dell'utente o con quella richiesta.
- `apps/backend/src/auth/strategies/jwt.strategy.ts` (~68): il lookup dell'utente per id va sul client di sistema. `userRoleAssignment` (~113) resta col `tenantId` esplicito, sul client normale nel contesto.
- `apps/backend/src/auth/controllers/dev-auth.controller.ts` (~37-46): client di sistema; è solo per lo sviluppo.
- `apps/backend/src/application/admin/impersonation.service.ts` (~41): l'utente da impersonare appartiene a un'altra azienda, quindi client di sistema.
- `apps/backend/src/api/me/membership.service.ts` (~59-135) e il controllo di `tenant-switch.interceptor.ts` (`checkAccess`, ~102-108). Le associazioni consulente-azienda e la verifica di accesso girano prima di conoscere l'azienda di destinazione: client di sistema, limitato alle letture di `tenant` e `consultantTenantAssociation`.
- `apps/backend/src/api/me/ruolo-effettivo.service.ts`: va valutato. Se legge dati di un'azienda diversa da quella del contesto, quelle letture passano sul client di sistema; altrimenti resta com'è. Motiva la scelta nel report.
- Test: gli spec esistenti di questi file aggiornati, più i casi del Review Focus 2 e 3.

- [ ] **Step 1: test che falliscono.**
  - `'spid: utente trovato per codice fiscale dal client di sistema, senza contesto'`;
  - `'refresh: utente dal client di sistema'`;
  - `'jwt: super admin con X-Tenant-ID di un'altra azienda → utente trovato'`;
  - `'impersonation: utente di un'altra azienda trovato'`;
  - `'tenant-switch: checkAccess sul client di sistema prima del cambio'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui gli spec toccati e gli e2e di autenticazione, se girano in locale (`apps/backend/test`); se non girano, scrivi perché nel report. Poi `tsc` e lint. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rls): ricerca dell'utente e cambio azienda dal client di sistema`.

### Task 3: accessi pubblici e cruscotti del super admin

**Files** (Modify; righe da riverificare):
- `apps/backend/src/infrastructure/signatures/signature-fir.repository.ts` (~60) e `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts` (~119), entrambi in `findByIdPublic`: client di sistema, con commento sul perché. È una rotta pubblica e il tenant si conosce solo dopo la lettura.
- `apps/backend/src/application/admin/system-health/evidenze-db.service.ts`: tutte le letture su più aziende passano sul client di sistema. Il commento di testa va riallineato.
- `apps/backend/src/application/admin/tenant.service.ts` e `user-admin.service.ts`: per il super admin **senza** azienda selezionata, gli elenchi su tutte le aziende passano sul client di sistema. Con un'azienda selezionata resta il client normale nel contesto. La decisione di Graziano del 2026-10-24 è questa: il super admin senza azienda usa il client di sistema.
- Non cambia il webhook Stripe: `tenants` non ha `tenant_id` e non è nelle 25 tabelle. Scrivilo nel report come punto da rivedere se un giorno si proteggerà `tenants`.
- Test: spec di `verify-signatures.use-case`, `evidenze-db.service`, `tenant.service`, `user-admin.service`, più il caso del Review Focus 4.

- [ ] **Step 1: test che falliscono.**
  - `'verifica pubblica FIR: lettura dal client di sistema'`;
  - `'evidenze: letture dal client di sistema'`;
  - `'super admin senza azienda: elenchi dal client di sistema; con azienda: client normale'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui gli spec toccati, `tsc` e lint. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rls): verifica pubblica e cruscotti del super admin dal client di sistema`.

### Task 4: seed, elenco dei punti di sistema e documentazione

**Files:**
- Modify: `apps/backend/prisma/seed-test-user.ts` e `apps/backend/prisma/seeds/roles.seed.ts`, che lavorano su tutte le aziende. Si collegano con `DATABASE_URL_SISTEMA` se c'è, altrimenti con `DATABASE_URL` e un avviso. `prisma/seed.ts` tocca solo `cERCode`, che è globale, quindi non cambia.
- Create: `apps/backend/src/infrastructure/persistence/punti-di-sistema.spec.ts`. È un test statico come `prisma-unico.spec.ts`: elenca i file sotto `src/` che importano o iniettano `PrismaSistemaService` e li confronta con un elenco esplicito nel test, con una riga di motivo per ciascuno.
- Modify: `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md`, con una sezione "Quando usare il client di sistema" che riprende il criterio dei Global Constraints e rimanda al test statico.

- [ ] **Step 1: test che falliscono.**
  - `'punti di sistema: i file che usano PrismaSistemaService sono esattamente quelli dell'elenco'`. Fallisce finché l'elenco non contiene i file dei Task 1-3.
  - `'seed: usa DATABASE_URL_SISTEMA quando presente'`. Estrai la scelta dell'URL in una funzione testabile.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui gli spec, `tsc`, lint e la suite postgres intera (`npm run test:postgres`). Atteso: PASS.
- [ ] **Step 5: commit** `test(rls): elenco esplicito dei punti che usano il client di sistema, seed e documentazione`.

## Dopo il pezzo

- **2c:**
  - i worker per singola azienda (`rentri-sync.job.ts`, `audit-logging.job.ts`) dentro `TenantContext.run({ tenantId })`;
  - `CURRENT_TENANT_ID` limitato a `NODE_ENV=test`;
  - `RENTRISyncLogRepository.requireTenantId()` nel worker.
- **3:** le policy.
