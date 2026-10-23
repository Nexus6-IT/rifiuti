# RLS pezzo 1: un solo PrismaService e ruoli database separati (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** preparare il terreno per la Row Level Security PostgreSQL senza ancora attivare policy. Alla fine del pezzo:
- l'applicazione usa un solo `PrismaService`, quindi un solo pool;
- esistono tre ruoli database con compiti distinti:
  - `wasteflow` (owner e migrazioni);
  - `wasteflow_app` (applicazione: non owner, `NOSUPERUSER NOBYPASSRLS`);
  - `wasteflow_sistema` (job e flussi di sistema, `BYPASSRLS`);
- esiste un client Prisma di sistema separato, pronto per i job;
- dove le nuove variabili non sono configurate, tutto resta come oggi.

**Architettura:**
- Il `PrismaService` di `infrastructure/database` diventa un alias di quello di `infrastructure/persistence`: stessa classe, stesso provider, stessa istanza. In alternativa lo si toglie, aggiornando i 19 import.
- I ruoli e i GRANT stanno in uno script SQL idempotente, `apps/backend/prisma/sql/ruoli-db.sql`. Lo esegue l'owner:
  - nel container di sviluppo all'init;
  - in CI prima dei test;
  - al deploy prima di `migrate deploy`.
  Le password arrivano come variabili `psql` (`-v`) e non sono mai scritte nel file.
- `ALTER DEFAULT PRIVILEGES FOR ROLE wasteflow` dà gli stessi diritti sulle tabelle create dalle migration future.
- Un `PrismaSistemaService` si collega con `DATABASE_URL_SISTEMA`. Se manca, ricade su `DATABASE_URL` con un warn logged una volta sola.

**Tech Stack:** NestJS, Prisma 5, PostgreSQL 16, Jest (unit e `*.postgres.spec.ts`), Gitea Actions.

**Spec:** decisioni di Graziano del 2026-10-23 in `C:\Progetti\winwaste\docs\confronto-con-rifiuti.md` §10 ("RLS, …"). Le basi sono:
- ruolo DB di sistema `BYPASSRLS` su connessione separata per job e flussi di sistema;
- un tenant alla volta;
- 4 pezzi, di cui questo è il primo.

L'analisi dello stato attuale è nel ledger di questo piano, voce "Analisi iniziale".

## Global Constraints

- **Branch e worktree:** `feat/rls-1-prisma-ruoli` nel worktree `C:\Progetti\rifiuti-wt-rls`, partito da `origin/develop` dopo il merge della catena RENTRI (PR #2–#9).
- **Nessuna policy in questo pezzo:** niente `ENABLE ROW LEVEL SECURITY` e niente `CREATE POLICY`. Il comportamento visibile dell'applicazione non cambia.
- **Compatibilità all'indietro:** senza `DB_APP_PASSWORD` e `DB_SISTEMA_PASSWORD` l'app si collega come oggi, col ruolo owner. Deploy, CI e sviluppo esistenti non si rompono.
- **Segreti:** nessuna password nei file versionati, salvo quelle di sviluppo e CI già presenti nello stesso stile (`wasteflow123`, `wasteflow_ci`). Mai password nei log.
- **TDD obbligatorio:** prima il test, eseguito e visto fallire, poi il codice.
- **Comandi:**
  - `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - per i `*.postgres.spec.ts`: `npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>` con `DATABASE_URL` sul Postgres di test `wasteflow-pg-test` (porta 55432; va ricreato se manca, come nei pezzi RENTRI);
  - `npx tsc --noEmit -p apps/backend`;
  - mai la suite intera.
- **Commit:** in italiano, senza attribuzione AI; mai `git add -A`.

## Review Focus

1. **Un solo pool:** dopo il pezzo, `Test.createTestingModule` con `AppModule` risolve una sola istanza di `PrismaService`, sia dal token di `database` sia da quello di `persistence`.
2. **Ruolo app non owner:**
   - `wasteflow_app` fa SELECT, INSERT, UPDATE e DELETE su tutte le tabelle e usa le sequence;
   - non può fare `CREATE TABLE`, `ALTER TABLE`, `DROP` né `TRUNCATE`;
   - `rolbypassrls` è false e non possiede nessuna tabella.
3. **Tabelle future:** una tabella creata dopo lo script dall'owner, come fa una migration, è subito accessibile a `wasteflow_app` e `wasteflow_sistema` senza rieseguire lo script.
4. **Idempotenza:** lo script eseguito due volte non dà errori. Rieseguito con una password diversa la aggiorna.
5. **Deploy senza nuove variabili:** `docker-compose.prod.yml` e `deploy.yml` producono gli stessi comandi e gli stessi URL di oggi.

---

### Task 1: un solo PrismaService

**Files:**
- Modify: `apps/backend/src/infrastructure/database/prisma.service.ts` e `prisma.module.ts`. Il service ri-esporta la classe di `infrastructure/persistence/prisma.service.ts`. Il modulo diventa un re-export del `PrismaModule` di `persistence`, oppure lo si rimuove aggiornando gli import.
  - Scegli la strada col diff più piccolo che garantisca una sola istanza, e scrivi la scelta nel report.
  - Se `persistence/prisma.module.ts` non è `@Global()` e il modulo `database` lo era, il risultato deve restare globale per chi oggi non importa nulla.
- Test: `apps/backend/src/infrastructure/database/prisma-unico.spec.ts` (nuovo).

- [ ] **Step 1: test che falliscono.**
  - `'PrismaService di database e di persistence sono la stessa classe'`;
  - `'un modulo che importa entrambi i PrismaModule riceve la stessa istanza'`, con `Test.createTestingModule` e `$connect` stubbato.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui il test, gli spec dei service che importano `database/prisma.service` (per esempio `analytics.service`, `contract.service`, `deadline-checker.service`, `anomaly-detection.service`) e `tsc`. Atteso: PASS.
- [ ] **Step 5: commit** `refactor(db): un solo PrismaService e un solo pool di connessioni`.

### Task 2: ruoli database e GRANT

**Files:**
- Create: `apps/backend/prisma/sql/ruoli-db.sql`, idempotente, eseguito dall'owner con `psql -v ON_ERROR_STOP=1 -v app_password=... -v sistema_password=...`:
  - crea, oppure aggiorna con `ALTER ROLE ... PASSWORD`, `wasteflow_app` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`) e `wasteflow_sistema` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS`). Per l'idempotenza usa un blocco `DO` con `format()`, o `\gexec`;
  - `GRANT CONNECT` sul database corrente e `USAGE` sullo schema `public`;
  - `SELECT, INSERT, UPDATE, DELETE` su tutte le tabelle e `USAGE, SELECT` su tutte le sequence di `public`, a entrambi;
  - `ALTER DEFAULT PRIVILEGES FOR ROLE <owner corrente> IN SCHEMA public`, con gli stessi diritti, per tabelle e sequence future;
  - nessun `TRUNCATE`, nessun `CREATE` sullo schema, nessun GRANT su `_prisma_migrations` oltre al SELECT.
- Create: `apps/backend/prisma/sql/README.md`, poche righe: cosa fa lo script, chi lo esegue, quali variabili servono.
- Test: `apps/backend/src/infrastructure/database/ruoli-db.postgres.spec.ts` (nuovo). Esegue lo script sul Postgres di test con password di prova e verifica come ciascun ruolo, con connessioni dedicate (`pg` o `PrismaClient` con URL del ruolo).

- [ ] **Step 1: test che falliscono.**
  - `'wasteflow_app: CRUD su una tabella esistente, nessun CREATE/ALTER/TRUNCATE, rolbypassrls false, nessuna tabella posseduta'`;
  - `'wasteflow_sistema: rolbypassrls true, CRUD, nessun CREATE'`;
  - `'tabella creata dall'owner dopo lo script: accessibile ai due ruoli'`;
  - `'script eseguito due volte: nessun errore; seconda password valida, prima no'`.
- [ ] **Step 2:** esegui. Atteso: FAIL, perché lo script non esiste.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui lo spec. Atteso: PASS.
- [ ] **Step 5: commit** `feat(db): ruoli wasteflow_app e wasteflow_sistema con GRANT minimi`.

### Task 3: client di sistema e collegamento a sviluppo, CI e deploy

**Files:**
- Create: `apps/backend/src/infrastructure/persistence/prisma-sistema.service.ts`. È un `PrismaSistemaService extends PrismaClient`, con `datasources: { db: { url } }` da `DATABASE_URL_SISTEMA`. Se manca, usa `DATABASE_URL` e logga un warn una volta sola: "DATABASE_URL_SISTEMA assente: il client di sistema usa la connessione dell'applicazione". Il valore dell'URL non va mai nel log.
  - Va fornito ed esportato dal `PrismaModule` globale.
  - In questo pezzo **nessun chiamante**: i job ci passano nel pezzo 2.
- Modify:
  - **`docker/postgres/init-databases.sql`, o un nuovo file di init montato dopo:** in sviluppo esegue `ruoli-db.sql` con password di sviluppo `wasteflow_app_dev` e `wasteflow_sistema_dev`. Vale solo per i volumi nuovi; nel README scrivi il comando per un volume già esistente.
  - **`docker-compose.prod.yml`:**
    - il backend ha `DATABASE_URL` che usa `DB_APP_USER`/`DB_APP_PASSWORD` quando ci sono e altrimenti `DB_USER`/`DB_PASSWORD`, con default annidati di compose;
    - `DATABASE_URL_SISTEMA`, allo stesso modo con `DB_SISTEMA_*`;
    - `DATABASE_URL_MIGRAZIONI`, sempre owner.
  - **`.gitea/workflows/deploy.yml`, prima di `migrate deploy`:**
    - se il `.env` del server ha `DB_APP_PASSWORD` e `DB_SISTEMA_PASSWORD`, esegue `ruoli-db.sql` nel container postgres come owner; altrimenti stampa "ruoli DB non configurati: salto" e prosegue;
    - `migrate deploy` gira con `DATABASE_URL="$DATABASE_URL_MIGRAZIONI"`.
    - Le password non devono comparire nei log del job.
  - **`ops/restore.sh`:**
    - il suo `prisma migrate deploy` (riga ~257) gira con `DATABASE_URL_MIGRAZIONI`, come il deploy;
    - dopo il ripristino riesegue `ruoli-db.sql` se le password ci sono, perché il dump potrebbe non portare i GRANT;
    - si controlla come `ops/backup-offsite.sh` invoca `pg_dump`. Se usa `--no-privileges` o `-x`, lo si scrive nel report.
  - **`.gitea/workflows/ci.yml`, job `test-postgres`:** dopo le migrazioni esegue `ruoli-db.sql` con password CI, così lo spec del Task 2 gira in CI. I test esistenti restano sull'owner, perché `cleanDatabase` usa `TRUNCATE`. Il passaggio al ruolo app avviene nel pezzo 3.
  - **`.env.example` (radice e `apps/backend`):** `DB_APP_USER`, `DB_APP_PASSWORD`, `DB_SISTEMA_USER`, `DB_SISTEMA_PASSWORD`, `DATABASE_URL_SISTEMA` vuoti, con un commento.
- Test: `prisma-sistema.service.spec.ts` (nuovo).

- [ ] **Step 1: test che falliscono.**
  - `'con DATABASE_URL_SISTEMA usa quell'URL'`;
  - `'senza DATABASE_URL_SISTEMA usa DATABASE_URL e logga un solo warn senza URL'`;
  - `'PrismaModule esporta PrismaSistemaService'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa, compresi compose, workflow ed env.
- [ ] **Step 4:** esegui i test, poi `tsc`. Poi `docker compose -f docker-compose.prod.yml config` con un `.env` di prova:
  - con `DB_APP_*` presenti, il backend riceve l'URL app;
  - senza, riceve l'URL owner di oggi.
  Atteso: PASS. Le due configurazioni risultanti vanno nel report, con le password mascherate.
- [ ] **Step 5: commit** `feat(db): client di sistema e ruoli DB collegati a sviluppo, CI e deploy`.

## Dopo il pezzo (a Graziano, non al codice)

- **Sul server** aggiungere a `/opt/rifiuti/.env` `DB_APP_PASSWORD` e `DB_SISTEMA_PASSWORD`, generate casuali. Il deploy successivo crea i ruoli e l'app passa al ruolo non owner.
