# RLS pezzo 2a: tenant impostato su ogni operazione del database (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** il client Prisma unico dell'applicazione esegue `set_config('app.tenant_id', <tenant>, true)` prima di ogni operazione, nella stessa transazione, quando il `TenantContext` ha un tenant. In questo modo le policy del pezzo 3 potranno filtrare su `current_setting('app.tenant_id', true)`.

Il pezzo non attiva policy e non cambia i risultati delle query. Le transazioni esplicite già presenti nel codice (11 punti) ricevono il `set_config` come prima istruzione **senza modificare quei file**, perché il `$transaction` del client viene esteso.

**Architettura.**
- Il `PrismaService` iniettato diventa il client esteso. A livello top-level `query.$allOperations` copre modelli e query raw.
  - Fuori da una transazione, con un tenant nel contesto, ogni operazione gira in `$transaction([set_config, operazione])` sul client base.
  - Dentro una transazione esplicita l'operazione passa così com'è.
- Il client espone un `$transaction` esteso:
  - forma interattiva: apre la transazione base, esegue `set_config` come primo statement e poi esegue `fn(tx)` dentro un AsyncLocalStorage con `inTransazione: true`. Le operazioni del `tx` non vengono riavvolte;
  - forma batch: aggiunge il `set_config` in testa all'array.
- Senza tenant nel contesto (job, seed, rotte pubbliche) non si fa nessun `set_config`. Il comportamento resta quello di oggi e quei chiamanti verranno sistemati nei pezzi 2b e 2c.
- L'estensione di filtro per tenant (`prisma-rls.extension.ts`, getter `db`) resta com'è. Il meccanismo nuovo sta in un file separato.

**Tech Stack:** NestJS, Prisma 5.22 (`@prisma/client ^5.8.0` in `apps/backend/package.json:44`), PostgreSQL 16, Jest (unit e `*.postgres.spec.ts`).

**Spec:**
- Decisioni di Graziano del 2026-10-24 (`C:\Progetti\winwaste\docs\confronto-con-rifiuti.md`, ultima sezione):
  - meccanismo automatico sul client unico;
  - divisione in 2a, 2b e 2c;
  - il super admin senza azienda usa il client di sistema (2b).
- Decisioni RLS del 2026-10-23: un tenant alla volta; ruolo di sistema per i job cross-tenant.
- Analisi del codice del 2026-10-24: è nel ledger di questo piano, voce "Analisi iniziale". Copiarla dalla risposta dell'agente di analisi.

## Global Constraints

- **Branch e worktree:** `feat/rls-2-tenant-transazione` in `C:\Progetti\rifiuti-wt-rls`, partito da `master` @ `bec2049`.
- **Nome del parametro:** `app.tenant_id`, sempre con `set_config(..., true)`, cioè locale alla transazione. Mai `false`, perché la connessione tornerebbe al pool con il tenant impostato. Il valore passa come parametro della query, mai concatenato nel testo SQL.
- **Nessuna policy:** niente `ENABLE ROW LEVEL SECURITY` e niente `CREATE POLICY`. I risultati delle query restano identici a oggi.
- **Fonte del tenant:** `TenantContext.getTenantId()`. Non si usa il fallback `CURRENT_TENANT_ID`: il meccanismo legge solo lo store dell'AsyncLocalStorage. `getTenantId()` resta invariato; il fallback lo sistema il pezzo 2c.
- **Interfacce invariate:** chi oggi inietta `PrismaService` (circa 96 file) continua a compilare senza modifiche. Restano disponibili `this.prisma.<model>`, `this.prisma.db.<model>`, `$queryRaw`, `$executeRaw`, gli `*Unsafe`, `$transaction` in entrambe le forme e `cleanDatabase()`.
- **TDD obbligatorio:** prima il test, eseguito e visto fallire, poi il codice.
- **Comandi:**
  - `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - Postgres: `npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>` con `DATABASE_URL=postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public` (container `wasteflow-pg-test`, già migrato);
  - `npx tsc --noEmit -p apps/backend/tsconfig.json`;
  - lint della CI in `apps/backend`: `npx eslint "{src,test}/**/*.ts" --quiet`, che deve dare 0 errori.
- **Commit:** in italiano, senza attribuzione AI; mai `git add -A`.

## Review Focus

1. **Nessuna fuga fra tenant sulle connessioni riusate.** Con `connection_limit=1` nell'URL di test, un'operazione del tenant A seguita da una del tenant B e poi da una senza contesto vede in `current_setting('app.tenant_id', true)` rispettivamente A, B e vuoto.
2. **Transazione interattiva con advisory lock.** In una `$transaction(async tx => …)` con `pg_advisory_xact_lock`, `set_config` gira nella stessa transazione prima del lock. Le query del `tx` vedono il tenant e non aprono transazioni annidate. Il caso reale è `registra-movimento.use-case.ts:202`.
3. **Forma batch** `$transaction([op1, op2])` (`rentri-unita-locale.service.ts:194`): il tenant è visibile in entrambe le operazioni.
4. **Senza tenant nel contesto** nessun `set_config` e nessuna transazione aggiunta: job e seed si comportano come oggi.
5. **Raw query fuori transazione**, per esempio `raccogli-andamento-mensile.use-case.ts:78`: anche `$queryRaw` riceve il `set_config`.

---

### Task 1: prova del meccanismo su Prisma 5.22 e Postgres reale

Questo task è un test che resta nel repository, non un prototipo da buttare. Fissa ciò su cui il Task 2 si appoggia.

**Files:**
- Create: `apps/backend/src/infrastructure/persistence/prisma-tenant-transazione.ts`, con:
  - `estensioneTenantTransazione(base: PrismaClient)`: restituisce gli argomenti di `$extends` con `query.$allOperations` top-level e `client.$transaction` esteso, come da Architettura;
  - un `AsyncLocalStorage<{ inTransazione: true }>` interno al modulo, non esportato;
  - `impostaTenant(tx, tenantId)`: esegue `SELECT set_config('app.tenant_id', $1, true)` ed è esportato per i test e per il Task 2.
- Create: `apps/backend/src/infrastructure/persistence/prisma-tenant-transazione.postgres.spec.ts`. Usa un `PrismaClient` con `connection_limit=1` aggiunto al `DATABASE_URL` di test, esteso con `estensioneTenantTransazione`, e `TenantContext.run`.

**Interfaces:**
- Produces: `estensioneTenantTransazione(base: PrismaClient)`, con un tipo esportato del client esteso, e `impostaTenant(tx: Prisma.TransactionClient, tenantId: string): Promise<void>`.

- [ ] **Step 1: test che falliscono.**
  - `'operazione su modello con tenant nel contesto: current_setting vede il tenant'`. Usa un'operazione che restituisca il valore di `current_setting('app.tenant_id', true)` nella stessa transazione: si osserva con un `$queryRaw` che legge il setting.
  - `'raw query fuori transazione: set_config applicato'`.
  - `'connessione riusata: A poi B poi senza contesto → A, B, vuoto'`.
  - `'senza tenant nel contesto: nessuna transazione aggiunta'`. Si verifica con il log delle query di Prisma (`$on('query')`): non compaiono `BEGIN` né `set_config`.
  - `'transazione interattiva: set_config primo statement, operazioni del tx senza transazioni annidate, advisory lock nella stessa transazione'`. L'advisory lock si verifica da una seconda connessione: con `pg_try_advisory_xact_lock` mentre la prima transazione lo tiene, oppure leggendo `pg_locks`.
  - `'transazione batch: tenant visibile in tutte le operazioni'`.
  - `'transazione interattiva con errore: rollback e nessun tenant rimasto sulla connessione'`.
- [ ] **Step 2:** esegui. Atteso: FAIL, perché il modulo non esiste.
- [ ] **Step 3: implementa.** Se un caso risulta impossibile con l'API pubblica di Prisma 5.22, per esempio un'operazione che non si riesce ad avvolgere, fermati e riporta NEEDS_CONTEXT con la prova, invece di aggirarlo con API interne non documentate.
- [ ] **Step 4:** esegui lo spec. Atteso: PASS. Lancialo due volte per escludere un risultato dipendente dall'ordine.
- [ ] **Step 5: commit** `feat(db): estensione Prisma che imposta il tenant in ogni transazione, con prova su Postgres`.

### Task 2: il PrismaService iniettato usa l'estensione

**Files:**
- Modify: `apps/backend/src/infrastructure/persistence/prisma.service.ts`. L'istanza fornita da Nest con il token `PrismaService` è il client base esteso con `estensioneTenantTransazione`. Restano:
  - il getter `db`, cioè l'estensione di filtro composta sopra quella nuova, perché anche le query di `.db` devono passare dal `set_config`;
  - `cleanDatabase()`;
  - `onModuleInit` e `onModuleDestroy`.
  La tecnica è a scelta dell'implementatore (factory provider che restituisce il client esteso, oppure costruttore che restituisce `this.$extends(...)` con i metodi spostati in `client:`), a tre condizioni: `tsc` pulito senza `any` nei 96 consumatori, nessuna modifica ai consumatori, test statico `prisma-unico.spec.ts` verde. La scelta va scritta nel report.
- Modify: `apps/backend/src/infrastructure/persistence/prisma.module.ts`, se il provider cambia forma.
- Test:
  - `apps/backend/src/infrastructure/persistence/prisma-service-tenant.postgres.spec.ts` (nuovo). Avvia il `PrismaModule` reale con `Test.createTestingModule`, prende `PrismaService` dal container e ripete tre casi del Task 1: modello, `.db` e transazione interattiva;
  - gli spec esistenti `prisma-service-rls.spec.ts`, `prisma-unico.spec.ts` e `prisma-sistema.service.spec.ts` restano verdi.
- `PrismaSistemaService` **non** riceve l'estensione: lavora col ruolo di sistema, senza tenant.

- [ ] **Step 1: test che falliscono.**
  - `'PrismaService dal container: set_config su operazione di modello'`;
  - `'PrismaService.db: set_config e filtro tenant insieme'`;
  - `'PrismaService.$transaction interattiva: tenant al primo statement'`;
  - `'PrismaSistemaService: nessun set_config'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui gli spec nuovi ed esistenti di `persistence`, `tsc` e lint. Poi esegui la suite postgres intera (`npm run test:postgres`): deve restare verde, perché i risultati delle query non cambiano. Atteso: PASS.
- [ ] **Step 5: commit** `feat(db): il PrismaService dell'applicazione imposta il tenant in ogni transazione`.

### Task 3: i punti critici del codice esistente, provati sul percorso reale

**Files:**
- Test: `apps/backend/src/infrastructure/persistence/tenant-transazione-casi-reali.postgres.spec.ts` (nuovo). Esegue use case e repository reali dentro `TenantContext.run({ tenantId })`, con un `$on('query')` o una tabella di appoggio che registra `current_setting('app.tenant_id', true)`, e verifica il tenant:
  - `RegistraMovimentoUseCase` (transazione interattiva con advisory lock, `registra-movimento.use-case.ts:202`);
  - `FIRPrismaRepository.save` e l'emissione con numerazione (`fir-prisma.repository.ts:301`, `:606`);
  - `RentriUnitaLocaleService`, nella forma interattiva (`:93`) e in quella batch (`:194`);
  - una delle transazioni MUD (`mud-presentazione.service.ts:186`);
  - `RentriScortaRepository.consumaProssimoDisponibile` (raw `FOR UPDATE SKIP LOCKED` fuori transazione, `rentri-scorta.repository.ts:147`).
  Per costruire i servizi parti dagli spec postgres già esistenti di questi file: per esempio `registra-movimento.use-case.postgres.spec.ts` e `fir-prisma.repository.postgres.spec.ts`.
- Modify: **nessun file applicativo**, salvo che un test scopra un caso non coperto dall'estensione. In quel caso correggi il punto e scrivilo nel report.

- [ ] **Step 1:** scrivi i test. Devono passare con il codice dei Task 1 e 2. Mostra che sono significativi eseguendoli una volta con l'estensione disattivata: fallendo, provano di misurare davvero il `set_config`.
- [ ] **Step 2:** esegui. Atteso: PASS. Lancia anche la suite postgres intera.
- [ ] **Step 3: commit** `test(db): tenant impostato nelle transazioni reali di registro, FIR, unita' locali, MUD e scorta`.

### Task 4: costo e documentazione

**Files:**
- Create: `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md`. Spiega in poche righe:
  - come funziona il meccanismo e perché `true` e non `false`;
  - cosa succede senza tenant;
  - come si scrive una nuova transazione;
  - cosa resta ai pezzi 2b, 2c e 3.
- Misura: uno script o spec di sola misura, non in CI (nome `*.misura.ts` o con skip esplicito), che confronta il tempo medio di 500 `findFirst` su `fir` con e senza estensione su `wasteflow-pg-test`. I numeri vanno nel report e nel README.
- Modify: `apps/backend/.env.example` e il commento del `DATABASE_URL` in `docker-compose.prod.yml`. Nota su `connection_limit`: con una transazione per operazione la concorrenza tiene connessioni più a lungo, quindi si indica il valore attuale (default di Prisma) e quando alzarlo. Nessun cambio di valore in questo pezzo.

- [ ] **Step 1:** scrivi README e misura, ed esegui la misura.
- [ ] **Step 2:** `tsc` e lint. Atteso: PASS.
- [ ] **Step 3: commit** `docs(db): tenant per transazione, costo misurato e note sul pool`.

## Dopo il pezzo

- **2b:** cron cross-tenant, lookup di login e refresh, verifica pubblica del FIR, cruscotti super admin, impersonificazione, membership dei consulenti e seed passano su `PrismaSistemaService`.
- **2c:** worker per singolo tenant (`rentri-sync`, `audit-logging`) dentro `TenantContext.run({ tenantId })`; `CURRENT_TENANT_ID` limitata a `NODE_ENV=test`; `TenantSwitchInterceptor` e `checkAccess` verificati sul contesto giusto.
- **3:** policy `ENABLE` e `FORCE` sulle 25 tabelle con `USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`.
