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
(29) sono attive `ENABLE` e `FORCE ROW LEVEL SECURITY` e c'e' la policy `isolamento_azienda`, uguale
per tutte e senza clausola `TO` (vale per ogni ruolo; `wasteflow` superuser e `wasteflow_sistema`
BYPASSRLS la ignorano):

```sql
USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
```

Senza `app.tenant_id` non si vede e non si scrive nulla (fail-closed).

- **Coperte (29):** `activity_logs`, `autorizzazioni_impianto`, `autorizzazioni_impianto_discariche`,
  `company_templates`, `consultant_tenant_associations`, `contracts`, `destinatari`,
  `fir_allegati_rentri`, `fir_signatures`, `fir_transporters`, `firs`, `mud_reports`, `notifications`,
  `permission_audit_logs`, `permission_requests`, `produttori`, `registro_progressivi_iniziali`,
  `rentri_credentials`, `rentri_numeri_vidimati`, `rentri_sync_logs`, `rentri_unita_locali`,
  `resource_ownership`, `role_change_history`, `roles`, `temporary_permission_grants`,
  `trasportatori`, `user_role_assignments`, `users`, `waste_movements`.
- **Escluse di proposito:**
  - `role_permissions` (senza `tenant_id`): le letture sono filtrate solo per le query che fanno
    join con `roles`; una lettura diretta per `role_id` di un'altra azienda non e' filtrata, e le
    scritture (INSERT/DELETE con il `role_id` di un'altra azienda) sono protette solo dall'applicazione. Seguito possibile: policy `USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id))`.
  - `tenants` e `access_requests` (si leggono prima di conoscere l'azienda). `tenants` resta
    leggibile e scrivibile da `wasteflow_app` per scelta: un `tenant.findMany` senza filtro col client
    dell'app esporrebbe i dati di tutte le aziende.
  - Tabelle globali: `permissions`, `permission_policies`, `abac_policies`, `backup_schedules`,
    `backup_histories`, `cer_codes`, `ateco_codes`, `istat_comuni`, `istat_nazioni`, `istat_province`,
    `rentri_codifiche_semplici`, `rentri_comuni`, `rentri_nazioni`, `rentri_province`, `_prisma_migrations`.
- **Indici:** aggiunti `tenant_id` su `temporary_permission_grants` e `permission_requests`.
- **Controllo:** `rls-catalogo.postgres.spec.ts` ricava le tabelle dal catalogo; una tabella futura con
  `tenant_id` e senza policy fa fallire il test.

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
    log `debug`. **Fuori ambito:** l'audit di un super admin che opera su piu' aziende non viene registrato.
  - La coda `audit-logging` ha `removeOnFail: { age: 604800 }` (7 giorni, come la coda RENTRI) fra le
    opzioni di default (`infrastructure/jobs/audit-queue.options.ts`).
- **3: fatto in questo pezzo.** Policy `ENABLE` e `FORCE` sulle 29 tabelle con `tenant_id` (sezione "Policy").
  In produzione e' dormiente finche' l'app si collega col superuser: si accende con la sezione
  "Accensione in produzione".
- **4: resta.** Gruppi e consulenti, rotte pubbliche, policy su `role_permissions` via `roles`,
  audit cross-tenant (l'audit di un super admin che opera su piu' aziende oggi non si registra).

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
