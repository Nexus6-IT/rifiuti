# Tenant per transazione (RLS pezzo 2a)

## Come funziona

Il `PrismaService` iniettato da Nest e' un client esteso con `estensioneTenantTransazione`
(`prisma-tenant-transazione.ts`, factory `creaPrismaServiceApplicativo`). Con un tenant nello
store del `TenantContext`, ogni operazione gira in una transazione che inizia con
`set_config('app.tenant_id', <tenant>, true)`. La policy del pezzo 3 leggera' quel valore.

Il terzo argomento e' `true` (locale alla transazione), non `false` (di sessione): a COMMIT o
ROLLBACK il valore sparisce e la connessione torna al pool pulita. Con `false` il tenant
resterebbe sulla connessione e la richiesta successiva, magari di un altro tenant, lo erediterebbe.
Il tenant e' sempre un parametro della query, mai concatenato nell'SQL.

Si legge solo lo store dell'AsyncLocalStorage, non il fallback `CURRENT_TENANT_ID`.

## Senza tenant

Nessuna transazione aggiunta: la query parte come prima e `app.tenant_id` non e' impostato.
Quando il pezzo 3 attivera' `FORCE` questo significa zero righe: per questo job, login, cron e
seed passano su `PrismaSistemaService` (pezzo 2b) o in `TenantContext.run` (pezzo 2c).

## Scrivere una nuova transazione

```ts
await this.prisma.$transaction(async (tx) => {
  await tx.fIR.update(...) // SEMPRE tx, mai this.prisma
})
```

Dentro `fn` usare solo `tx`: il client esterno aprirebbe una transazione propria su un'altra
connessione, fuori dall'atomicita'. Il `set_config` e' gia' il primo statement. Per il client
filtrato usare `this.prisma.db.$transaction`. Il batch `$transaction([a, b])` e' supportato.

Avvertenze (dettagli nei commenti del codice):
- `await` dentro `TenantContext.run`: il tenant e' letto quando la PrismaPromise viene eseguita,
  non quando e' creata (attenzione alle promise memoizzate fra richieste);
- con un tenant ogni operazione sta in una transazione: VACUUM, `CREATE INDEX CONCURRENTLY` e
  simili falliscono, vanno lanciati senza contesto;
- `$on` e `$use` sono tipizzati ma assenti sul client esteso.

## Costo misurato

500 `findFirst` su `fir`, `wasteflow-pg-test` (127.0.0.1:55432, via relay WSL, quindi
pessimistico rispetto alla produzione dove backend e Postgres condividono la rete Docker).
Tre esecuzioni, millisecondi per operazione (media / p95):

| Scenario | Esec. 1 | Esec. 2 | Esec. 3 |
|---|---|---|---|
| A nudo, senza tenant | 1,29 / 1,67 | 1,34 / 1,64 | 1,33 / 1,62 |
| B esteso, senza tenant | 1,74 / 2,66 | 1,29 / 1,60 | 1,27 / 1,46 |
| C nudo, con tenant (nessuna transazione) | 1,18 / 1,42 | 1,22 / 1,49 | 1,28 / 1,50 |
| D esteso, con tenant | 1,27 / 1,67 | 1,34 / 1,69 | 1,26 / 1,49 |

Il sovraccosto di D su C va da -0,01 a +0,12 ms per operazione, cioe' nel rumore. Non e'
stato verificato perche' sia cosi' basso. La misura e' sequenziale (una operazione alla volta)
e non dice nulla sulla contesa del pool sotto concorrenza. Query reali piu' pesanti di un `findFirst` indicizzato ne sono
dominate. Rieseguire, DA `apps/backend` (lo script sta in `scripts/`, fuori da build e CI):

```
DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public" \
  npx ts-node -P tsconfig.json scripts/tenant-transazione.misura.ts [N]
```

## Pool

Una transazione per operazione tiene la connessione un po' piu' a lungo. Oggi `connection_limit`
e' il default di Prisma (num_cpus * 2 + 1) e non e' impostato. Alzarlo (parametro nell'URL di
`DATABASE_URL`) se compaiono timeout `Timed out fetching a new connection from the connection pool`
sotto carico. Le transazioni interattive mantengono il `maxWait` di default di Prisma (2 s):
la pressione sul pool si vede quindi per prima come errore P2028 o P2024. In questo pezzo non cambia nessun valore.

### Dimensionare `connection_limit` con due client

Con `DATABASE_URL_SISTEMA` attivo i client Prisma sono due, ognuno con il proprio pool, e ogni processo
(web, worker) ne apre una copia. Il totale delle connessioni e':

`processi x (connection_limit di DATABASE_URL + connection_limit di DATABASE_URL_SISTEMA)`

e deve restare sotto `max_connections` di Postgres, lasciando un margine (circa 10) per migration,
backup e accesso manuale. Si imposta nel parametro dell'URL di ciascuno dei due:

```
DATABASE_URL="postgresql://wasteflow_app:...@host:5432/wasteflow?schema=public&connection_limit=15"
DATABASE_URL_SISTEMA="postgresql://wasteflow_sistema:...@host:5432/wasteflow?schema=public&connection_limit=5"
```

Il client di sistema serve poco (login, cron, verifica pubblica): un limite basso basta, il resto va
all'applicativo. Per leggere `max_connections` sul server:

```
echo "SHOW max_connections;" | $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
```

Le letture per azienda del cruscotto di gruppo e della lista ADMIN sono limitate a 4 insieme proprio per
non occupare l'intero pool di una sola richiesta. In questo pezzo nessun valore cambia.

## Quando usare il client di sistema

`PrismaSistemaService` (ruolo DB `wasteflow_sistema`, BYPASSRLS) si usa **solo** quando l'azienda
non e' nota: scansione di tutte le aziende, oppure ricerca di un'entita' prima di sapere a chi appartiene
(utente al login, FIR pubblico, membership).

- **Azienda nota:** appena la si conosce, il lavoro successivo torna sul client normale dentro
  `TenantContext.run({ tenantId })`, con `await` delle operazioni dentro la callback (le PrismaPromise sono lazy).
- **Lettura col client di sistema:** va vincolata a cio' a cui chi chiama ha diritto (id dell'utente
  autenticato, capability pubblica come l'id di un FIR), **mai** a un `tenantId` preso dalla sola richiesta.
- **SUPER_ADMIN:** si sceglie in base all'ambito della query. Tutte le aziende: client di sistema.
  Un'azienda specifica Y: client normale in `run({ tenantId: Y })`. I passi successivi alla creazione di
  un'azienda girano nel contesto della nuova azienda.
- **Commento:** ogni uso ha accanto un commento di una riga che dice perche' serve il client di sistema.
- **Elenco statico:** i file che lo usano sono elencati in `punti-di-sistema.spec.ts`, ciascuno con un
  motivo. Un file nuovo fa fallire il test finche' non lo si aggiunge (o lo si toglie, se smette di usarlo).
- **Seed cross-tenant** (`seed-test-user.ts`, `seeds/roles.seed.ts`): si collegano con
  `DATABASE_URL_SISTEMA`, altrimenti con `DATABASE_URL` e un avviso (`url-sistema.ts`).

## Policy

Migration `20261025130000_rls_policy_aziende`: su ogni tabella di `public` con colonna `tenant_id`
(44) sono attive `ENABLE` e `FORCE ROW LEVEL SECURITY` e c'e' la policy `isolamento_azienda`, uguale
per tutte e senza clausola `TO` (vale per ogni ruolo; `wasteflow` superuser e `wasteflow_sistema`
BYPASSRLS la ignorano):

```sql
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
```

Senza `app.tenant_id` non si vede e non si scrive nulla (fail-closed).

- **Coperte (44, con `ditte` e `sedi_ditte` di F2-10, `abbinamenti_carico_scarico` di 4.6 e `movimenti_trasmissione_rentri` di F2-9, piu' le 7 tabelle delle pese (8a); l'elenco che segue e' anteriore ai pezzi 1 e 5 e a F2-10):** `abbinamenti_carico_scarico`, `activity_logs`, `autorizzazioni_impianto`, `autorizzazioni_impianto_discariche`,
  `causali_registro_azienda`, `company_templates`, `consultant_tenant_associations`, `contracts`, `destinatari`, `ditte`, `sedi_ditte`,
  `fir_allegati_rentri`, `fir_signatures`, `fir_transporters`, `firs`, `giacenze_iniziali`, `movimenti_trasmissione_rentri`, `mud_reports`, `notifications`,
  `permission_audit_logs`, `permission_requests`, `produttori`, `registri_rifiuti`, `registro_progressivi_iniziali`,
  `rentri_credentials`, `rentri_numeri_vidimati`, `rentri_sync_logs`, `rentri_unita_locali`,
  `resource_ownership`, `role_change_history`, `roles`, `soglie_deposito_temporaneo`, `temporary_permission_grants`,
  `trasportatori`, `user_role_assignments`, `users`, `waste_movements`; pese (8a): `strumenti_pesa`, `automezzi`,
  `accessi_pesa`, `pesate`, `rettifiche_peso`, `allegati_pesa`, `collegamenti_accesso`.
- **`role_permissions` (pezzo 4, migration `20261026090000_rls_role_permissions`):** tabella ponte senza
  `tenant_id`, con `ENABLE` + `FORCE` e la policy `isolamento_via_ruolo` (`USING` e `WITH CHECK`:
  `EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id)`). La subquery su `roles` e' filtrata
  dalla policy di `roles`, quindi col ruolo app si vedono e si scrivono solo righe di ruoli dell'azienda del
  contesto (senza contesto nessuna). Non ha `isolamento_azienda`: non ha la colonna.
- **`sola_lettura` (pezzo 4, migration `20261026100000_rls_sola_lettura_controlli`):** su tutte le 44 tabelle e
  su `role_permissions` c'e' anche `CREATE POLICY sola_lettura ... FOR SELECT TO wasteflow_lettura USING (true)`.
  `wasteflow_lettura` e' un ruolo di gruppo NOLOGIN senza password e senza BYPASSRLS: chi ne e' membro legge
  le righe di tutte le aziende senza contesto, ma non scrive (nessuna policy per INSERT/UPDATE/DELETE).
  Non assegna privilegi: i SELECT restano quelli che il membro ha gia'. `wasteflow_app` e `wasteflow_sistema`
  non ne sono membri. Ogni tabella ha quindi esattamente due policy (il catalogo lo verifica).
- **Escluse di proposito:**
  - `tenants` e `access_requests` (si leggono prima di conoscere l'azienda). `tenants` resta
    leggibile e scrivibile da `wasteflow_app` per scelta: un `tenant.findMany` senza filtro col client
    dell'app esporrebbe i dati di tutte le aziende.
  - Tabelle globali: `permissions`, `permission_policies`, `abac_policies`, `backup_schedules`,
    `backup_histories`, `cer_codes`, `ateco_codes`, `istat_comuni`, `istat_nazioni`, `istat_province`,
    `rentri_codifiche_semplici`, `rentri_comuni`, `rentri_nazioni`, `rentri_province`, `_prisma_migrations`.
- **Indici:** aggiunti `tenant_id` su `temporary_permission_grants` e `permission_requests`.
- **Controllo:** `rls-catalogo.postgres.spec.ts` ricava le tabelle dal catalogo; una tabella futura con
  `tenant_id` e senza policy fa fallire il test.

## Controlli di sola lettura (testing-umano)

Il ruolo `rifiuti_testing` (controlli esterni di testing-umano) legge il database di tutte le aziende; con la
RLS accesa, senza contesto vedeva zero righe. Si abilita con l'appartenenza a `wasteflow_lettura` (NOLOGIN,
NOBYPASSRLS, policy `sola_lettura`: vedi sezione "Policy"), **fuori dalle migration**, da un superuser sul
database di produzione e solo con l'ok di Graziano:

```sql
GRANT wasteflow_lettura TO rifiuti_testing;   -- abilita
REVOKE wasteflow_lettura FROM rifiuti_testing; -- rientro: torna a non vedere nulla
```

Verifica: `SELECT pg_has_role('rifiuti_testing', 'wasteflow_lettura', 'member');` (true dopo il GRANT) e
`SELECT pg_has_role('wasteflow_app', 'wasteflow_lettura', 'member');` (deve restare false). Il ruolo e' del
cluster: la migration lo crea se manca e `ops/restore.sh` lo ricrea prima di caricare un dump che contiene
le policy `TO wasteflow_lettura`. L'appartenenza (GRANT di ruolo) e' del cluster e non sta nel dump del database:
dopo un ripristino su un cluster nuovo va rifatto il GRANT. I dump di produzione contengono anche GRANT e default
privileges verso `rifiuti_testing`: `ops/restore.sh` crea anche questo ruolo (NOLOGIN, senza password) se manca; LOGIN,
password e `GRANT wasteflow_lettura TO rifiuti_testing` si rifanno a mano.

## Cosa resta

- **2a e 2b: fatti.** Cron cross-tenant, lookup di login e refresh, verifica pubblica del FIR,
  cruscotti del super admin, impersonificazione, membership e rotte dei consulenti
  (`consultant/tenants`, `consultant/switch-tenant`), vista di gruppo (ogni figlia nel proprio
  contesto) e seed passano su `PrismaSistemaService` o in `TenantContext.run`.
- **2c: fatto.**
  - **Worker:** ogni job (`rentri-sync`, `audit-logging`) gira nel contesto dell'azienda del job;
    senza azienda il job fallisce in modo definitivo (`UnrecoverableError`), senza toccare il database.
  - **`CURRENT_TENANT_ID`:** vale solo con `NODE_ENV=test`; altrove e' ignorata, con un avviso una volta sola.
  - **Cambio azienda end-to-end:** `core/interceptors/tenant-switch.postgres.spec.ts` (app Nest reale:
    middleware, strategy e guard JWT, `TenantSwitchInterceptor`, `MembershipService`, `PrismaService`;
    solo `RedisService` e' finto) prova che l'azienda scelta arriva al handler e che un `X-Tenant-ID`
    non associato viene rifiutato (403) prima del handler.
- **Prerequisiti del 3: fatti.**
  - `GET fir/:firId/verify/dettaglio` (con azienda) legge il FIR col client normale in
    `TenantContext.run({ tenantId })`; la verifica pubblica senza azienda resta sul client di sistema.
  - Cruscotto di gruppo e lista per l'ADMIN leggono al massimo 4 aziende insieme
    (`core/utils/map-con-limite.ts`), con lo stesso risultato e lo stesso ordine di prima.
  - `permission.guard` non accoda l'audit se il `tenantId` e' vuoto (super admin senza azienda), con un
    log `debug`. Il caso del super admin senza azienda e' stato chiuso nel pezzo 4 (sezione "Azienda piattaforma").
  - La coda `audit-logging` ha `removeOnFail: { age: 604800 }` (7 giorni, come la coda RENTRI) fra le
    opzioni di default (`infrastructure/jobs/audit-queue.options.ts`).
- **3: fatto in questo pezzo.** Policy `ENABLE` e `FORCE` sulle 29 tabelle con `tenant_id` (sezione "Policy").
  In produzione e' dormiente finche' l'app si collega col superuser: si accende con la sezione
  "Accensione in produzione".
- **4: fatto.** Gruppi e consulenti, rotte pubbliche (percorsi verificati col ruolo app in
  `rls-gruppi-rotte.postgres.spec.ts`), `role_permissions`, ruolo di sola lettura per i controlli, audit del
  super admin senza azienda (azienda piattaforma). Restano facoltativi:
  - RLS, o una funzione mirata, su `tenants`;
  - una funzione SECURITY DEFINER per la vista di gruppo.
- **Seguiti emersi dal pezzo 4:**
  - consulenti su un'azienda cliente nel `PermissionGuard`: il guard gira prima di `TenantSwitchInterceptor` e
    il ruolo del consulente sull'azienda cliente sta in `consultant_tenant_associations.role_id`, quindi oggi
    per loro vale l'azienda del token e l'header e' ignorato;
  - race sulla catena di hash dell'audit con concorrenza 10;
  - rotte del super admin che usano solo `RolesGuard` e non scrivono audit;
  - codice SAML morto da cancellare: `infrastructure/keycloak/keycloak-saml.strategy.ts`,
    `application/auth/handle-spid-callback.use-case.ts`, `api/auth/auth.controller.ts`;
  - cruscotto di gruppo e `listTenants` non chiamano `escludiPiattaforma`: oggi la piattaforma resta fuori
    perche' non ha madre ne' associazioni, e un test lo verifica (se questo cambia, aggiungere l'helper);
  - `sola_lettura` copre anche `rentri_credentials` e `users`: da valutare con il minimo privilegio.
  - con `X-Tenant-ID` = piattaforma un SUPER_ADMIN raggiunge ancora scritture nel contesto della richiesta (`billing.service`, `mud-obbligo.service`, `rentri-modalita-legame.service`): `assertNonPiattaforma` copre solo tenant e creazione utenti.
  - il guard non controlla che l'azienda di `X-Tenant-ID` esista: un SUPER_ADMIN puo' mandare righe di audit verso un UUID inesistente (`permission_audit_logs.tenant_id` non ha FK).
  - middleware e guard leggono il ruolo SUPER_ADMIN da fonti diverse (token e database): differenza al massimo per la durata del token.
  - `@Roles(...)` controlla il ruolo del TOKEN (quello nell'azienda di casa), non quello nell'azienda
    selezionata: un consulente ADMIN nel proprio studio e CONSULTANT in un cliente passa il guard. Oggi e'
    controllato col ruolo effettivo (`RuoloEffettivoService`, helper `api/me/richiedi-ruolo-effettivo.ts`)
    solo dove scrivere su un'azienda cliente era diventato possibile: `rentri-sync`, `rentri-fir-lifecycle`,
    `audit.controller`. Gli altri controller con `@Roles` restano da rivedere.
  - `api/audit/audit.controller.ts` non e' montato in nessun modulo: l'`AuditController` attivo e'
    `api/permissions/audit.controller.ts` (con `TenantIsolationGuard`), non toccato in questo giro.
  - `task-assignment.controller.ts` e `fir.controller.example.ts` leggono `user.userId`, che il token non ha.

## Azienda selezionata nei controller (26/10)

Branch `fix/tenant-selezionato-controller`. Difetti veri corretti:

- `audit.controller` (`api/audit`) leggeva l'azienda del token;
- registry: fail-open senza azienda;
- `@TenantId()` (`core/decorators`) leggeva il tenant del token invece dell'azienda selezionata;
- `CurrentUser` di `api/decorators` restituiva l'azienda del token (ora e' un ri-export di quello di
  `auth/decorators`);
- giacenze, nel F2-1.

Billing, contratti, ESG, anomalie, FIR e i controller RENTRI ricevevano gia' l'azienda attiva: i loro test sono
una guardia contro regressioni, non la prova di un difetto.

**Guardia statica** (`api/controller-tenant-selezionato.spec.ts`): ogni file `.ts` non di test sotto `src` che
contiene `@Controller(` non puo' leggere `user.tenantId` (anche `req['user'].tenantId`, `user?.['tenantId']`,
destrutturazione) salvo voci motivate in elenco; commenti e stringhe sono ignorati. Limite: gli alias
(`const u = req.user; u.tenantId`) non si vedono.

**Header `X-Tenant-ID` del SUPER_ADMIN:** il middleware lo copia in `req.tenantId` senza verifica di
membership (non ha limiti di azienda); dal 26/10 rifiuta con 403 un valore che non e' un UUID invece di lasciarlo
arrivare a Prisma (P2023, 500).

## Azienda piattaforma

Migration `20261026110000_azienda_piattaforma`: azienda tecnica con id fisso
`00000000-0000-4000-8000-000000000001` (`AZIENDA_PIATTAFORMA_ID` in `core/context/azienda-piattaforma.ts`),
`subscription_status = SUSPENDED`. Esiste perche' le righe di `permission_audit_logs` sono per azienda, con
catena di hash per azienda: le azioni del super admin senza azienda scelta hanno cosi' un posto dove essere
registrate. Non e' un cliente: niente utenti, dati o credenziali RENTRI. Non cancellare la riga in migration
future (il `TRUNCATE ... CASCADE` dei test la elimina: tollerato).

- **Esclusione:** ogni lettura o iterazione di `tenants` usa `escludiPiattaforma` (o `escludiPiattaformaDaId`
  sugli elenchi di id); un test statico (`azienda-piattaforma-esclusione.spec.ts`) fa fallire una scansione
  nuova che non lo usa. Lo stato SUSPENDED e' solo una seconda difesa.
- **Protezione:** `assertNonPiattaforma` rifiuta (400) la piattaforma come madre di un gruppo, la modifica,
  la sospensione/riattivazione/cancellazione e la creazione di utenti al suo interno (`tenant.service`,
  `user-admin.service`).
- **Regola del guard** (`permission.guard.ts`): un SUPER_ADMIN con `X-Tenant-ID` (UUID valido) viene registrato
  nell'azienda scelta; senza header, nell'azienda piattaforma. I permessi invece si caricano sempre
  nell'azienda di casa, perche' le sue assegnazioni di ruolo stanno li' e con la RLS nel contesto di un'altra
  azienda tornerebbero vuote. Consulenti e utenti normali: azienda del token, header ignorato.
- **`sessionId`:** nel payload dell'utente (`JwtStrategy`) e' l'hash `sha256` di `sub:iat`, primi 32 caratteri
  esadecimali; il guard lo salva in `permission_audit_logs.session_id`. L'hash dell'entry copre solo i campi
  salvati.
- **Lettura:** `GET /api/v1/admin/audit/piattaforma` (`?pagina=&perPagina=`), solo SUPER_ADMIN, dal client di
  sistema con l'azienda fissa (nessun id preso dalla richiesta); ogni riga riporta `hashValido`.

## Prima del merge

**Il merge su `master` E' il deploy in produzione delle migration**: `deploy.yml` parte a ogni push su
`master`. Tutto cio' che segue va quindi fatto PRIMA del merge, non al momento dell'accensione. Fra
`migrate deploy` e `up -d` il vecchio backend gira ancora per qualche secondo: i suoi inserimenti di firme,
trasportatori e allegati senza `tenant_id` fallirebbero per il NOT NULL appena introdotto; per questo serve
una finestra tranquilla (nessuno che emette o firma FIR).

Nota del 2026-10-25: il controllo sotto e' gia' stato eseguito sulla produzione, 4 righe, nomi uguali.

La `20261025120000_tenant_id_tabelle_figlie` fa `DROP CONSTRAINT`
di 4 chiavi esterne; se un nome in produzione e' diverso la migration fallisce. Controllo (stringhe con
dollar-quoting, cosi' non servono apici dentro il comando):
```
$COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT conrelid::regclass AS tabella, conname FROM pg_constraint
WHERE conname IN ($$fir_signatures_fir_id_fkey$$, $$fir_transporters_fir_id_fkey$$,
  $$fir_allegati_rentri_fir_id_fkey$$, $$autorizzazioni_impianto_discariche_autorizzazione_id_fkey$$);
SQL
```
Devono uscire 4 righe: con meno, fermarsi e allineare la migration. La `20261025130000_rls_policy_aziende`
prende lock ACCESS EXCLUSIVE su 29 tabelle (ENABLE/FORCE e CREATE POLICY) e crea 2 indici piccoli
(`temporary_permission_grants`, `permission_requests`) senza `CONCURRENTLY`: durata breve, ma fare il merge
in una finestra tranquilla.

Le migration passano al primo deploy anche con le variabili dei ruoli ancora spente.

## Accensione in produzione

Stack in `/opt/rifiuti`, compose `docker-compose.prod.yml`, env `/opt/rifiuti/.env`, project `rifiuti`.
Servizi: `postgres`, `redis`, `backend` (web e worker BullMQ nello stesso processo), `frontend`.
Sul VPS, da `/opt/rifiuti/site`:
`COMPOSE="docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml"`.

Cosa fa il codice (in questo pezzo non cambia nulla):
- `DATABASE_URL` nel compose e' `postgresql://<DB_APP_USER>:<DB_APP_PASSWORD>@postgres:5432/<DB_NAME>` se le
  variabili ci sono, altrimenti l'owner (`DB_USER`/`DB_PASSWORD`, default `wasteflow`). `DATABASE_URL_SISTEMA` e'
  `wasteflow_sistema:<DB_SISTEMA_PASSWORD>` quando c'e' `DB_APP_USER`, altrimenti vuota e `PrismaSistemaService`
  ripiega su `DATABASE_URL`. `DATABASE_URL_MIGRAZIONI` e' sempre l'owner.
- La configurazione a meta' (una o due delle tre variabili) fa fallire compose a ogni comando, quindi gia'
  al `pull` del deploy, prima di backup e migration.
- Il deploy (`.gitea/workflows/deploy.yml`) esegue, nell'ordine: `pull`, backup predeploy
  (`ops/backup-offsite.sh`), `prisma migrate deploy` come owner, `ops/db-ruoli.sh` (legge le password dal `.env`
  senza eseguirlo, le passa a psql sullo stdin, crea o aggiorna `wasteflow_app` e `wasteflow_sistema`; senza
  password stampa "salto"), `up -d`, smoke test su `127.0.0.1:3017`.

1. **Backup verificato** (dopo il merge, prima di accendere). Il deploy ne fa uno predeploy, ma prima di accendere verificare a mano che l'ultimo
   backup (offsite e locale) sia fresco e ripristinabile (`ops/backup-offsite.sh`, `ops/restore.sh`,
   `ops/controllo-freschezza-backup.sh`; vedi `ops/README.md`).
2. **Connessioni.** `echo "SHOW max_connections;" | $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'`.
   Scegliere `connection_limit` per i due URL con la formula di "Dimensionare `connection_limit` con due client"
   (processi x (app + sistema), margine circa 10; oggi il processo e' uno solo, `backend`). Il compose non ha
   un parametro per questo: va aggiunto `?connection_limit=N` in fondo agli URL in `docker-compose.prod.yml`
   (commit separato; gli URL non hanno altra query string, quindi `?` e non `&`, es.
   `...@postgres:5432/${DB_NAME:-wasteflow_prod}?connection_limit=15`), oppure si lascia il default di Prisma (num_cpus * 2 + 1 per client) se il totale sta comodamente
   sotto `max_connections`.
3. **Variabili in `/opt/rifiuti/.env`** (`chmod 600`), tutte e tre insieme:
   ```
   DB_APP_USER=wasteflow_app
   DB_APP_PASSWORD=<output di openssl rand -hex 32>
   DB_SISTEMA_PASSWORD=<output di openssl rand -hex 32>
   ```
   Minimo 16 caratteri, solo `A-Za-z0-9_.-` (`openssl rand -hex 32` va bene): altrimenti `db-ruoli.sh` rifiuta
   e gli URL si rompono. Nessun passo manuale sui ruoli: li crea o aggiorna il deploy con `ops/db-ruoli.sh`.
   Mai password nei commit, nei log o in chat.
4. **Deploy.** Push su `master` o rilancio del workflow. Atteso nel log: migration applicate, ruoli creati,
   `Deploy OK`. Se compose segnala "ruoli DB incompleti", manca una delle tre variabili.
5. **Controlli dopo il deploy.**
   - L'app e' sul ruolo giusto (attesi `wasteflow_app` e `wasteflow_sistema`, nessuna connessione dell'owner dall'app):
     ```
     echo "SELECT usename, count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() GROUP BY 1;" \
       | $COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'
     ```
   - Da browser: login, elenco FIR, registro (nuovo movimento), salvataggio ed emissione di un FIR.
   - Log: `$COMPOSE logs --since 15m backend` senza errori `P2028`/`P2024`, `permission denied` o
     `row-level security`; job RENTRI (`rentri-sync`) e scadenzario eseguiti senza `UnrecoverableError`.
   - Bugsink (`https://error.ignicraft.com`, progetto wasteflow) senza errori nuovi dal deploy.
6. **Rientro.** Togliere le tre variabili da `/opt/rifiuti/.env` e rifare il deploy, oppure a mano
   `TAG=sha-<tag attualmente in produzione> $COMPOSE up -d backend`: mai `up -d` senza `TAG`, che ripiegherebbe
   su `latest`. Il tag in uso si legge prima di toccare il `.env`, con
   `docker inspect -f '{{.Config.Image}}' $($COMPOSE ps -q backend)` (immagine `...rifiuti-backend:<tag>`;
   `deploy.yml` imposta `TAG` dal tag della build e il compose lo usa anche per `APP_VERSION`).
   L'app torna sull'owner, che ignora la RLS (superuser): le policy restano nel database ma non filtrano. Le
   migration sono forward-only e non vanno annullate; i ruoli `wasteflow_app` e `wasteflow_sistema` restano e
   sono innocui.
