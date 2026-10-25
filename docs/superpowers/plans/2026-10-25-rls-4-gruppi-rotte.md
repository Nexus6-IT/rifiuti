# RLS pezzo 4: ultimi buchi, lettura per i controlli, audit del super admin (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans. I passi hanno caselle (`- [ ]`).

**Obiettivo:** chiudere la Fase 1 lato RLS. Dopo questo pezzo:
- anche `role_permissions` è protetta dal database;
- il ruolo di sola lettura dei controlli di testing-umano legge di nuovo i dati, solo in lettura e in modo esplicito;
- non restano punti dell'applicazione che leggono tabelle con RLS senza azienda, né letture di `tenants` senza filtro;
- le azioni del super admin senza azienda selezionata finiscono nell'audit, attribuite all'azienda tecnica "piattaforma";
- gruppi, cambio azienda e rotte pubbliche sono provati col ruolo `wasteflow_app`.

**Stato di partenza (25/10):** RLS accesa in produzione (`sha-866a0f0` + variabili nel `.env`): l'app gira come `wasteflow_app`/`wasteflow_sistema`. Policy `isolamento_azienda` ENABLE+FORCE su 29 tabelle. Analisi del 25/10 (agente Explore, sintesi nel ledger): gruppi, consulenti e rotte pubbliche già sul client giusto; rotto solo `rifiuti_testing`; latenti `role_permissions`, audit del super admin, `findExpiringSoon`, job vuoti, `tenants` senza RLS.

**Decisioni di Graziano (25/10):**
- `rifiuti_testing`: **policy di sola lettura dedicata**, versionata in una migration, non `BYPASSRLS`.
- Audit del super admin senza azienda: **azienda "piattaforma" fittizia** con id fisso, nessun cambio di schema dell'audit, catena di hash per azienda invariata.

**Tech Stack:** NestJS 10, Prisma 5.22, PostgreSQL 16, Jest.

## Global Constraints

- **Branch e worktree:** `feat/rls-4-gruppi-rotte` in `C:\Progetti\rifiuti-wt-rls`, da `master` @ `866a0f0`.
- **Migration:** SQL a mano con commento in testa in italiano (modello `20261025130000_rls_policy_aziende`), cartella `YYYYMMDDHHMMSS_snake_case` con orario tondo; `prisma migrate diff` senza differenze dovute al pezzo (restano note pgcrypto e default di `notifications.expires_at`). Nessun GRANT a `wasteflow_app`/`wasteflow_sistema` nelle migration (li fa `ops/db-ruoli.sh`).
- **Policy esistente invariata:** `isolamento_azienda`, testo identico, su tutte le 29 tabelle.
- **Dentro `TenantContext.run`** sempre `await` dentro la callback. Il client di sistema solo nei file di `punti-di-sistema.spec.ts`, con la regola del 2b: una lettura di sistema è legata all'utente autenticato, a una capacità pubblica o al ruolo super admin, mai a un tenant preso dalla richiesta.
- **Riservatezza:** niente id di azienda o utente in nuovi messaggi verso l'utente.
- **TDD obbligatorio.** Gli spec Postgres girano come `wasteflow_app`/`wasteflow_sistema` quando provano la RLS (helper `infrastructure/database/client-come-ruolo.ts`).
- **Database di test:** `wasteflow-pg-test` 127.0.0.1:55432. Agenti in parallelo usano **database separati** sullo stesso container (`CREATE DATABASE wasteflow_ci_<task>` + `prisma migrate deploy` + `ops/db-ruoli.sh` con `PG_DB`/URL adeguati), mai lo stesso database.
- **Comandi:** come nel piano del pezzo 3 (unit, Postgres, `tsc`, lint CI `npx eslint "{src,test}/**/*.ts" --quiet` con 0 errori); prima del merge `ci.yml` a mano sul branch.
- **Commit:** in italiano, senza attribuzione AI; mai `git add -A`; con agenti paralleli `git commit -m … -- <file>`.

## Review Focus

1. `role_permissions`: col ruolo app e contesto A si vedono e si scrivono solo righe di ruoli di A; seed dei ruoli in `createTenant`, `jwt.strategy.resolvePermissions`, `role.controller` funzionano.
2. Lettura per i controlli: un membro di `wasteflow_lettura` vede tutte le righe delle 29 tabelle e di `role_permissions` **solo in SELECT** (INSERT/UPDATE/DELETE rifiutati); `wasteflow_app` non è membro e non vede di più.
3. Catalogo: ogni tabella con `tenant_id` ha esattamente `isolamento_azienda` (ALL, public) e `sola_lettura` (SELECT, `{wasteflow_lettura}`), entrambe PERMISSIVE; nessun'altra policy.
4. Azienda piattaforma: esiste una sola volta, id fisso; non compare in elenchi, conteggi, cron, fatturazione, cruscotti; l'audit del super admin senza azienda vi finisce con catena di hash valida; nessun utente normale la vede.
5. Nessuna operazione su tabelle con RLS fuori contesto col client app; nessun `tenant.findMany` senza `where` sul client app.
6. Percorsi col ruolo app: vista di gruppo, `switch-tenant` e `X-Tenant-ID` verso una figlia, `verify` pubblica, `access-request`, webhook Stripe, callback SPID/SAML, handler `signature-audit`.

---

### Task 1: policy su `role_permissions` tramite `roles`

**Files:**
- Create: `apps/backend/prisma/migrations/20261026090000_rls_role_permissions/migration.sql`: `ENABLE` + `FORCE` + `CREATE POLICY isolamento_via_ruolo ON role_permissions USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id)) WITH CHECK (stessa)`. La subquery su `roles` è filtrata dalla policy di `roles`. Commento in testa: perché non `tenant_id` (tabella ponte, l'azienda è quella del ruolo).
- Modify: `rls-catalogo.postgres.spec.ts`: `role_permissions` esce dalle esclusioni e ha il suo controllo (RLS, FORCE, una sola policy `isolamento_via_ruolo` col testo atteso).
- Modify: README `README-tenant-transazione.md`, sezione Policy.
- Test: spec Postgres col ruolo app: lettura di righe di ruoli di B con contesto A → 0; INSERT di una riga per un ruolo di B con contesto A → rifiutata; il seed dei ruoli di `tenant.service.createTenant` (o `system-roles.ts`), `jwt.strategy.resolvePermissions` e la lettura di `role.controller` funzionano col ruolo app nel contesto giusto. Verificare i seed (`prisma/seeds/roles.seed.ts`, `seed-test-user.ts`) e gli helper dei test Postgres che scrivono `role_permissions` come owner (owner superuser: nessun effetto).

- [x] Step 1: test che falliscono (`'role_permissions: righe di un ruolo di un altra azienda invisibili'`, `'role_permissions: scrittura per un ruolo di un altra azienda rifiutata'`, `'createTenant col ruolo app: permessi dei ruoli creati'`, catalogo).
- [x] Step 2: esegui, FAIL. Step 3: migration e README. Step 4: spec toccati, suite Postgres intera, `migrate diff`, `tsc`, lint.
- [x] Step 5: commit `feat(rls): role_permissions protetta tramite il ruolo dell azienda`.

### Task 2: lettura completa per i controlli (`wasteflow_lettura`)

Dopo il Task 1 (stessi file: catalogo e README).

**Files:**
- Create: `apps/backend/prisma/migrations/20261026100000_rls_sola_lettura_controlli/migration.sql`:
  - `DO $$ … IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wasteflow_lettura') THEN CREATE ROLE wasteflow_lettura NOLOGIN NOBYPASSRLS; END IF; $$` (ruolo di gruppo, cluster-wide, senza password);
  - per ognuna delle 29 tabelle con `tenant_id` e per `role_permissions`: `CREATE POLICY sola_lettura ON <t> FOR SELECT TO wasteflow_lettura USING (true)`;
  - commento in testa: a cosa serve, che è solo lettura, che i diritti SELECT restano quelli già dati da chi usa il ruolo (oggi `rifiuti_testing` ha SELECT dai default privileges), e che per abilitare un utente si fa `GRANT wasteflow_lettura TO <utente>` fuori dalle migration.
- Modify: `ops/db-ruoli.sh` / `prisma/sql/ruoli-db.sql` solo se serve che `wasteflow_lettura` esista prima del migrate in CI o nel restore (verifica `ops/restore.sh`: un dump con policy `TO wasteflow_lettura` va ripristinato su un cluster dove il ruolo esiste). Non dare nessun privilegio a `wasteflow_app`/`wasteflow_sistema`.
- Modify: `rls-catalogo.postgres.spec.ts`: per ogni tabella esattamente due policy, `isolamento_azienda` (ALL, `{public}`) e `sola_lettura` (SELECT, `{wasteflow_lettura}`, qual `true`, with_check null), entrambe PERMISSIVE; `role_permissions` con `isolamento_via_ruolo` + `sola_lettura`. Un'altra policy qualunque fa fallire.
- Modify: README sezione Policy, e una sezione "Controlli di sola lettura (testing-umano)" con il GRANT da fare a mano sul server e il rientro (`REVOKE wasteflow_lettura FROM rifiuti_testing`).
- Test: spec Postgres che crea un ruolo di prova LOGIN membro di `wasteflow_lettura` (con SELECT sulle tabelle), si collega con quel ruolo: vede righe di A e B senza contesto; INSERT/UPDATE/DELETE rifiutati (dalla mancanza di privilegi o dalla RLS: verificare e asserire il motivo); `wasteflow_app` non è membro (`pg_has_role`). Pulizia: `DROP OWNED BY` + `DROP ROLE` del ruolo di prova.
- Fuori repo (lo fa l'orchestratore dopo il deploy, con l'ok di Graziano): `GRANT wasteflow_lettura TO rifiuti_testing` sul database di produzione; nota in `C:\Progetti\testing-umano\docs\pilota-rifiuti.md` e in `testing/init/ruolo.sql` del pilota se esiste.

- [x] Step 1-5 come sopra. Commit `feat(rls): ruolo di sola lettura per i controlli, con policy dedicata`.

### Task 3: niente letture fuori contesto e niente `tenants` senza filtro

Indipendente dai Task 1-2 (file diversi): può andare in parallelo con un database separato.

**Files:**
- `apps/backend/src/infrastructure/persistence/consultant-tenant-association.repository.ts:~178` `findExpiringSoon`: nessun chiamante. Rimuoverlo da repository e interfaccia (preferito) oppure portarlo sul client di sistema con il file in `punti-di-sistema.spec.ts`; motivare nel report.
- `infrastructure/jobs/archive-audit-logs.job.ts` e `warm-permission-cache.job.ts` (vuoti, TODO): commento in italiano che quando verranno scritti dovranno usare il client di sistema o un `TenantContext.run` per azienda; se sono registrati come cron che non fanno nulla, lasciarli invariati.
- Nuovo test statico `apps/backend/src/infrastructure/persistence/letture-tenants.spec.ts` (stile `punti-di-sistema.spec.ts`): fallisce se nel codice applicativo (esclusi spec, seed, file di sistema ammessi) compare `tenant.findMany(` o `tenant.findFirst(` senza `where`, o con `where` vuoto. Elenca le eccezioni motivate.
- `auth/strategies/keycloak-saml.strategy.ts` e `api/auth/auth.controller.ts` (SAML): leggere e verificare che le letture di `users` e delle tabelle con RLS stiano sul client di sistema o nel contesto; correggere se no (test prima).
- `application/signatures/signature-audit.handler.ts:~43,~96` (`@OnEvent`): verificare che l'evento sia sincrono o che il contesto si propaghi; se `async: true` perde il contesto, test e correzione (`TenantContext.run` con il tenant dell'evento).

- [x] Commit `fix(rls): nessuna lettura fuori contesto, test sulle letture di tenants`.

### Task 4: azienda "piattaforma" per l'audit del super admin

Indipendente dai Task 1-3 per i file applicativi; la migration ha un orario suo. Database separato se gira in parallelo.

**Files:**
- Create: migration `20261026110000_azienda_piattaforma/migration.sql`: `INSERT INTO tenants (id, …campi obbligatori…) VALUES ('00000000-0000-4000-8000-000000000001', 'Piattaforma (tecnica)', …) ON CONFLICT (id) DO NOTHING`. Ricavare i campi NOT NULL senza default da `schema.prisma` (modello `Tenant`); valori neutri che non attivino fatturazione, RENTRI, MUD o notifiche (es. `mud_non_dovuto = true`, nessun piano a pagamento). Commento in testa.
- Create: costante condivisa (es. `core/context/azienda-piattaforma.ts`: `AZIENDA_PIATTAFORMA_ID`) usata ovunque.
- Modify: `api/guards/permission.guard.ts:~327`: con `tenantId` vuoto e utente SUPER_ADMIN si accoda l'evento con `tenantId = AZIENDA_PIATTAFORMA_ID` (non più saltato); per un non super admin con tenant vuoto resta il comportamento di oggi (salta, log debug). `assign-role`/`revoke-role` invariati (hanno sempre il tenant del comando).
- Esclusione dalla vista applicativa: ogni lettura o iterazione di `tenants` (elenco: `tenant.service` lista super admin e ADMIN, `get-aggregated-dashboard`, `deadline-checker.service`, `rentri-certificato-scadenza.job`, `rentri-riconciliazione.job`, `rentri-rifornimento-scorta.job`, `evidenze-db.service`, `billing.service`, `membership.service`, `ruolo-effettivo.service`, e ogni altro trovato con grep) deve escludere l'azienda piattaforma, tranne la lettura dell'audit da parte del super admin. Preferire un unico punto (helper `escludiPiattaforma(where)` o filtro comune) e un test statico o di integrazione che lo verifichi.
- Lettura dell'audit: il super admin deve poter leggere l'audit dell'azienda piattaforma (rotta audit esistente con `X-Tenant-ID` = piattaforma, o lettura dedicata sul client di sistema): scegliere la via più piccola coerente con la regola del 2b e scriverla nel report.
- Test: unit sul guard (super admin senza azienda → accodato con id piattaforma; utente normale senza azienda → saltato); Postgres: il job `audit-logging` scrive la riga nell'azienda piattaforma col ruolo app nel contesto, catena di hash valida (`getLatestLog`); l'azienda piattaforma non compare nell'elenco aziende del super admin né nei cron (test su almeno elenco super admin e `deadline-checker`).

- [x] Commit `feat(audit): azioni del super admin senza azienda registrate nell azienda piattaforma`.

### Task 5: percorsi col ruolo app per gruppi, cambio azienda e rotte pubbliche

Dopo i Task 1-4.

**Files:**
- Create: `apps/backend/src/infrastructure/persistence/rls-gruppi-rotte.postgres.spec.ts`, con `creaPrismaServiceApplicativo` come `wasteflow_app` e `PrismaSistemaService` come `wasteflow_sistema` (come `rls-percorsi-reali`):
  - cruscotto di gruppo (`get-aggregated-dashboard.handler`) per una madre con due figlie: dati di entrambe, nessun dato di un'azienda estranea;
  - consulente: `membership.service.listTenants`/`checkAccess`, `switch-tenant` (handler) e lettura con `X-Tenant-ID` verso una figlia (middleware + contesto): vede la figlia, non un'azienda non associata;
  - `verify` pubblica di un FIR (use case senza tenant);
  - `access-request` pubblica;
  - webhook Stripe (`billing.service` con evento simulato, `findTenantByCustomerId`);
  - callback SPID (lookup utente sul sistema) e il percorso SAML verificato nel Task 3;
  - `signature-audit.handler` su `FIR_SIGNED`.
- Se un percorso fallisce col ruolo app è un difetto da correggere qui (test prima); se la correzione supera ~30 righe o cambia un comportamento, fermarsi e riportare.

- [x] Commit `test(rls): gruppi, cambio azienda e rotte pubbliche col ruolo dell applicazione`.

### Task 6: README e procedura

- Modify: README: "Cosa resta" (pezzo 4 fatto; restano facoltativi: RLS o funzione mirata su `tenants`, funzione SECURITY DEFINER per la vista di gruppo), sezione "Controlli di sola lettura", nota sull'azienda piattaforma.
- Modify: questo piano, sezione "Dopo il pezzo".

- [x] Commit `docs(rls): pezzo 4, controlli di sola lettura e azienda piattaforma`.

## Parallelismo

- Ondata 1: Task 1 e Task 3 e Task 4 in parallelo (tre agenti, tre database di test separati, commit con `-- <file>`). Task 1 e Task 4 hanno migration con orari diversi; `schema.prisma` è toccato al più dal Task 4 (nessun modello nuovo previsto): se serve, coordinare.
- Ondata 2: Task 2 (dopo il Task 1).
- Ondata 3: Task 5, poi Task 6.

## Dopo il pezzo (a Graziano)

1. Merge = deploy delle migration (la RLS è già accesa: le nuove policy valgono subito per `role_permissions`).
2. Con il tuo ok: `GRANT wasteflow_lettura TO rifiuti_testing` sul database di produzione, poi un giro dei controlli di testing-umano per vedere che non passino a vuoto.
3. Controllo che l'azienda piattaforma non compaia nelle schermate (elenchi, cruscotti); l'audit del super admin senza azienda si legge con `GET /api/v1/admin/audit/piattaforma`.
4. Seguiti elencati in README "Cosa resta" (consulenti nel guard, race sulla catena di hash, rotte super admin senza audit, SAML morto).
