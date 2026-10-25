# RLS pezzo 2c: worker per azienda nel contesto, niente tenant da variabile d'ambiente, cambio azienda provato end-to-end (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** chiudere gli ultimi punti in cui un'operazione sul database gira senza l'azienda giusta nel `TenantContext`, prima che il pezzo 3 attivi le policy. Sono tre:
- i worker BullMQ che lavorano per una singola azienda;
- il fallback `CURRENT_TENANT_ID`, che in produzione darebbe a tutti i job senza contesto la stessa azienda;
- la catena middleware → guard → interceptor di cambio azienda → handler, provata davvero su Postgres.

**Cosa cambia in produzione:** il worker `rentri-sync` e quello di `audit-logging` girano nel contesto dell'azienda del job. `CURRENT_TENANT_ID` viene ignorata fuori dai test. Tutto il resto resta com'è: nessuna policy.

**Architettura:**
- All'ingresso di ogni job dei due worker si fa `TenantContext.run({ tenantId: job.data.tenantId }, async () => await …)`.
- Un job senza `tenantId` fallisce in modo definitivo (non ritentato), con un log. Non si lavora mai senza azienda.
- In `TenantContext.getTenantId()` il fallback d'ambiente vale solo con `NODE_ENV=test`.
- Un test Postgres con un'app Nest reale (middleware, guard, interceptor e un controller di prova) prova che una richiesta con `X-Tenant-ID` valido arriva all'handler con `app.tenant_id` uguale all'azienda scelta.

**Tech Stack:** NestJS 10, BullMQ, Prisma 5.22, PostgreSQL 16, Jest.

**Spec:**
- Decisioni di Graziano del 2026-10-23 e 2026-10-24 (`C:\Progetti\winwaste\docs\confronto-con-rifiuti.md`, ultime sezioni).
- Sezione "Cosa resta" di `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md`.
- Analisi del 2026-10-24, sezioni 3 e 8:
  - punto 9 sul codice fire-and-forget;
  - punto 10 su `CURRENT_TENANT_ID`;
  - punto 11 su `RENTRISyncLogRepository`.

## Global Constraints

- **Branch e worktree:** `feat/rls-2c-worker-contesto` in `C:\Progetti\rifiuti-wt-rls`, partito da `master` @ `996ba57`.
- **Dentro `TenantContext.run`** si fa sempre `await` dentro la callback: le PrismaPromise sono lazy.
- **Nessuna policy.** I risultati delle query restano uguali. L'unico cambio di comportamento voluto è quello dei Task 1 e 2, e va scritto nel report.
- **Riservatezza:** niente id di azienda o utente in nuovi messaggi verso l'utente. Nei log si segue il pattern esistente.
- **TDD obbligatorio:** prima il test, eseguito e visto fallire, poi il codice.
- **Comandi:**
  - `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - Postgres: `npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`, con `DATABASE_URL=postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public`;
  - `npx tsc --noEmit -p apps/backend/tsconfig.json`;
  - lint della CI in `apps/backend`: `npx eslint "{src,test}/**/*.ts" --quiet`, che deve dare 0 errori;
  - prima del merge si lancia a mano il workflow `ci.yml` sul branch.
- **Commit:** in italiano, senza attribuzione AI; mai `git add -A`.

## Review Focus

1. **Job `rentri-sync` di un'azienda:** use case, repository e log di sincronizzazione (`RENTRISyncLogRepository`, che usa `TenantContext.requireTenantId()`) vedono quell'azienda. Prima va verificato cosa succede oggi a quel log nel worker: se lancia, o se ripiega su `CURRENT_TENANT_ID`.
2. **Due job di aziende diverse in parallelo nello stesso worker** (concorrenza 5): ognuno vede la propria azienda.
3. **Job senza `tenantId`:** fallisce in modo definitivo, senza toccare il database e senza ritentativi.
4. **`CURRENT_TENANT_ID` impostata con `NODE_ENV=production`:** `getTenantId()` restituisce `null` e un avviso compare una volta sola.
5. **Richiesta reale con `X-Tenant-ID`** di un'azienda a cui l'utente ha accesso: l'handler legge con `app.tenant_id` uguale a quell'azienda. Senza accesso la richiesta viene rifiutata prima dell'handler.

---

### Task 1: il worker `rentri-sync` nel contesto dell'azienda del job

**Files:**
- Modify: `apps/backend/src/infrastructure/queue/jobs/rentri-sync.job.ts`. `processJob` (riga ~78) esegue il lavoro dentro `TenantContext.run({ tenantId }, async () => await …)`, e vale sia per il singolo sia per il batch. Senza `tenantId` (o con valore vuoto) il job fallisce con un errore non ritentabile: si usa il meccanismo che il file usa già per gli esiti definitivi (`UnrecoverableError` di BullMQ o equivalente; verifica cosa c'è). Il fallimento viene loggato senza dati sensibili.
- Il mittente dei job deve sempre mettere `tenantId` nel `job.data`. Lo si verifica in `apps/backend/src/infrastructure/queue/rentri-sync.queue.ts`, in tutti i punti che accodano (`addSyncJob` e il batch). Se un punto non lo passa, va corretto e annotato nel report.
- Test:
  - lo spec esistente del job, aggiornato;
  - un nuovo spec con `TenantContext` reale che cattura `TenantContext.getStoreTenantId()` dentro lo use case simulato.

- [ ] **Step 1: test che falliscono.**
  - `'rentri-sync: il lavoro del job gira nel contesto dell'azienda del job'`;
  - `'rentri-sync: due job di aziende diverse in parallelo vedono ciascuno la propria azienda'`;
  - `'rentri-sync: job senza tenantId fallisce in modo definitivo e non tocca il database'`;
  - `'rentri-sync batch: ogni FIR del batch nel contesto dell'azienda'`.
- [ ] **Step 2:** esegui. Atteso: FAIL. Nel report scrivi cosa succede oggi al log di `RENTRISyncLogRepository` nel worker (Review Focus 1), con la prova.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui lo spec del job, quello della coda, gli spec di `sync-fir-to-rentri.use-case` e `rentri-sync-log.repository`, poi `tsc` e lint. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rls): il worker rentri-sync lavora nel contesto dell'azienda del job`.

### Task 2: `audit-logging` nel contesto e `CURRENT_TENANT_ID` solo nei test

**Files:**
- Modify: `apps/backend/src/infrastructure/jobs/audit-logging.job.ts` (`process`, riga ~38). Ogni job gira in `TenantContext.run({ tenantId: data.tenantId }, async () => await …)`. Senza `tenantId` vale la stessa regola del Task 1.
- Gli altri processor non cambiano:
  - `archive-audit-logs.job.ts` e `warm-permission-cache.job.ts`: hanno solo TODO e log;
  - `expire-temp-permissions.job.ts` e `cleanup-old-permission-requests.job.ts`: già sistemati nel 2b.
  - Va verificato e scritto nel report.
- Modify: `apps/backend/src/core/context/tenant-context.ts`, in `getTenantId()` (riga ~58-66). Il fallback `process.env.CURRENT_TENANT_ID` vale solo con `NODE_ENV === 'test'`. In ogni altro ambiente si ignora; se la variabile è impostata, il logger (o `console.warn`, se il contesto non ha accesso al Logger di Nest) avvisa una volta sola che viene ignorata. Si aggiorna anche il commento di testa (riga ~38).
- Va verificato che nessuno script o CLI in `apps/backend` (fuori dai test) si appoggi a `CURRENT_TENANT_ID`: grep su `src`, `prisma`, `scripts` e `package.json`. Se qualcuno lo fa, scrivilo nel report e decidi la correzione minima.
- Test:
  - lo spec di `tenant-context` (crealo se manca);
  - lo spec del job `audit-logging`.

- [ ] **Step 1: test che falliscono.**
  - `'audit-logging: ogni job nel contesto della sua azienda'`;
  - `'audit-logging: job senza tenantId fallisce in modo definitivo'`;
  - `'getTenantId: CURRENT_TENANT_ID ignorata con NODE_ENV=production, un solo avviso'`;
  - `'getTenantId: CURRENT_TENANT_ID usata con NODE_ENV=test'`;
  - `'getTenantId: lo store vince sulla variabile'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui gli spec toccati e, una volta sola, la suite unitaria intera, per vedere se qualche spec dipendeva dal fallback fuori da `NODE_ENV=test`. In locale i 10 test di `deadline-checker` sono rossi anche su `master`: riporta solo le differenze. Poi `tsc` e lint. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rls): audit-logging nel contesto dell'azienda, CURRENT_TENANT_ID solo nei test`.

### Task 3: cambio azienda provato su Postgres con un'app Nest reale

**Files:**
- Create: `apps/backend/src/core/interceptors/tenant-switch.postgres.spec.ts`, o un percorso equivalente vicino agli spec dell'interceptor. Il test:
  - avvia `Test.createTestingModule` con il `PrismaModule` reale, `TenantContextMiddleware`, i guard JWT del progetto (o la strategia JWT reale con un token firmato da `JWT_SECRET` di test) e `TenantSwitchInterceptor`;
  - monta un controller di prova che esegue una lettura su un modello con `tenant_id`. La lettura deve far osservare `current_setting('app.tenant_id', true)`: per esempio un `$queryRaw` dentro la stessa operazione, oppure il trigger di appoggio usato nei test del 2a.
  - Fa le richieste con `supertest`: usa `createNestApplication`, verifica che `supertest` sia già una dipendenza; se non c'è, usa il client HTTP già presente nei test e2e.
- Casi di prova:
  1. utente normale senza `X-Tenant-ID`: l'handler vede l'azienda del token;
  2. consulente con `X-Tenant-ID` di un'azienda associata: l'handler vede quell'azienda;
  3. `X-Tenant-ID` di un'azienda senza associazione: la richiesta viene rifiutata (403) prima dell'handler, che non viene chiamato;
  4. super admin con `X-Tenant-ID`: l'handler vede quell'azienda.
- Dati: aziende, utenti e associazioni creati dal test con id unici per esecuzione; la pulizia tocca solo quelli. Il modello da seguire è `isolamento-sorelle.postgres.spec.ts`.
- Modify: nessun file applicativo, salvo che il test scopra un difetto; in quel caso correggilo e scrivilo nel report.

- [ ] **Step 1:** scrivi il test e mostra che è significativo: disattiva per un momento l'interceptor, oppure fai fare la lettura all'handler fuori contesto, e verifica che il caso 2 fallisca; poi ripristina.
- [ ] **Step 2:** esegui. Atteso: PASS; se un caso fallisce, è un difetto da correggere in questo task.
- [ ] **Step 3:** esegui la suite postgres intera, poi `tsc` e lint. Atteso: PASS.
- [ ] **Step 4: commit** `test(rls): cambio azienda provato su Postgres dal middleware all'handler`.

### Task 4: documentazione

**Files:**
- Modify: `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md`:
  - "Cosa resta" segna il 2c come fatto;
  - si aggiunge una riga sui worker ("ogni job nel contesto dell'azienda del job, senza azienda il job fallisce");
  - si aggiunge una riga su `CURRENT_TENANT_ID` (solo nei test);
  - la lista "Da riguardare prima del 3" resta aggiornata.
- Modify: `apps/backend/.env.example`. Se cita `CURRENT_TENANT_ID`, va aggiunta una riga che dice che vale solo nei test.

- [ ] **Step 1:** applica.
- [ ] **Step 2:** `tsc` e lint. Atteso: PASS.
- [ ] **Step 3: commit** `docs(rls): worker e CURRENT_TENANT_ID nel README del tenant per transazione`.

## Dopo il pezzo

**Pezzo 3:** policy `ENABLE` e `FORCE` sulle 25 tabelle. Prima vanno chiusi i punti "Da riguardare prima del 3" del README:
- `verify/dettaglio` autenticato;
- pool di connessioni con due client;
- `Promise.all` per azienda nel cruscotto di gruppo e nella lista per l'ADMIN.
