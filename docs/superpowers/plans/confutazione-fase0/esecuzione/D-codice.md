# Confutazione del codice — Piano D (esercizio)

Oggetto: commit `ddac487` e `e50afb9..c9b10dd` del branch `fix/fase0-confronto-winwaste` (worktree `C:\Progetti\rifiuti-wt-fase0`), escluso `docs/`.
Data: 2026-10-22. Lavoro in sola lettura sul repository; nessun accesso al VPS.

Verifiche eseguite in locale:

- `bash ops/test/backup-verifica.test.sh` senza database: 32 riusciti, 0 falliti (permessi saltati su NTFS).
- Postgres `postgres:16-alpine` usa e getta (16.15, container `pgD-confuta`, poi rimosso), `prisma migrate deploy` delle 47 migration, poi `PG_EXEC="docker exec -i pgD-confuta" bash ops/test/backup-verifica.test.sh`: **38 riusciti, 2 falliti** (v. D-C-04).
- Jest (`JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod TZ=UTC npx jest --forceExit --runInBand` su `src/core`, `nessuna-shell-esposta`, `deadline-checker`, `infrastructure/jobs`, `reference-data`, `registra-movimento`, `infrastructure/monitoring`): 22 suite, 218 test, tutti verdi.

---

## Obiezioni

### D-C-01 — Critica — `restore.sh` cancella il database e poi dichiara riuscito un ripristino fallito

- **File:** `ops/restore.sh:61-98` (in particolare `:70`, `:80-87`, `:94`).
- **Tesi:** lo script fa `DROP DATABASE` **prima** di sapere se il file è ripristinabile, e il `psql` del ripristino gira senza `-v ON_ERROR_STOP=1`. `psql` esce con 0 anche se tutte le istruzioni falliscono, quindi con `pipefail` la pipeline risulta riuscita. Poi `prisma migrate deploy` ricostruisce lo schema **vuoto** e il backend riparte. La libreria che sa verificare un dump (`verifica_completezza_dump`) è inclusa con `source`, ma `restore.sh` non la chiama.
- **Scenario:** l'operatore ripristina un `wasteflow_..._.sql.gz.non-verificato`, che il README indica come file che "può servire" (`ops/README.md`, tabella degli stati). Il nome non finisce con `.gz`, quindi si va nel ramo `< "${BACKUP_FILE}"` (`:86`) e `psql` riceve byte gzip. Oppure un dump troncato (rsync interrotto, disco pieno): stesso esito. Risultato: database di produzione vuoto (o a metà), backend avviato, log `Ripristino completato`.
- **Evidenza** (Postgres 16.15 locale, un DB vuoto `prova_restore`):
  ```
  cat dump.sql.gz | docker exec -i pgD-confuta psql -U wasteflow -d prova_restore   -> psql exit=0
     ERROR:  invalid byte sequence for encoding "UTF8": 0x8b ...
  gzip -dc dump.sql.gz | head -c 4000 | psql ... -d prova_restore                    -> truncated exit=0
  SELECT count(*) FROM information_schema.tables WHERE table_schema='public'         -> 0
  ```
- **Correzione:** prima di `stop backend`: rifiutare i suffissi diversi da `.sql.gz`/`.sql`, chiamare `verifica_completezza_dump` (per `.sql` controllare il marcatore in coda), e uscire se manca. Ripristino con `psql -v ON_ERROR_STOP=1 -1` (una sola transazione). Meglio ancora: ripristinare in un DB temporaneo con `ripristino_di_prova`, e scambiare i nomi con `ALTER DATABASE … RENAME` solo dopo l'esito positivo, così il DB di produzione non viene toccato finché la copia non è valida. Aggiungere un test bash: un file troncato o `.non-verificato` deve far uscire lo script con codice diverso da 0, **senza** `DROP`.

### D-C-02 — Importante — `restore.sh` lascia la produzione ferma se un passo fallisce (la lezione Gitea del 16/09 ripetuta)

- **File:** `ops/restore.sh:24` (`set -euo pipefail`), `:61` (`stop backend`), `:66-74`, `:98` (`start backend`).
- **Tesi:** dopo `stop backend` non c'è un `trap` che riaccende il backend. Qualsiasi errore fra `:66` e `:98` (DROP rifiutato, CREATE fallito, `exec` che non trova il container) fa uscire lo script con il backend spento e, a seconda del punto, con il database già eliminato.
- **Scenario:** il ripristino parte alle 03:31 mentre il backup notturno conta le righe di `waste_movements` sul DB sorgente (`_conta`, `backup-verifica.sh`). `pg_terminate_backend` (`:66`) chiude quella sessione, ma il backup ne apre subito un'altra per `_prisma_migrations`: `DROP DATABASE` senza `WITH (FORCE)` fallisce con "is being accessed by other users", `set -e` esce, il backend resta spento. È esattamente lo schema dell'incidente Gitea citato nell'intestazione di `backup-verifica.sh`.
- **Evidenza:** `restore.sh` non contiene `trap`; il commento della libreria (`backup-verifica.sh:5-8`) descrive il rischio ma lo applica solo a `ripristino_di_prova`.
- **Correzione:** `trap` su EXIT che, se il backend è stato fermato e lo script non è arrivato in fondo, stampa lo stato e lo riavvia (o almeno lo dice con chiarezza e manda la mail). `DROP DATABASE … WITH (FORCE)`. Prendere lo stesso lock del backup (v. D-C-08).

### D-C-03 — Importante — Il ripristino del backup `predeploy` riapplica la migration da cui ci si voleva salvare

- **File:** `ops/restore.sh:91-98`; `ops/README.md`, sezione Rollback ("Il ripristino dal backup `wasteflow_predeploy_*` con `restore.sh` si fa solo se una migration ha alterato dati").
- **Tesi:** dopo il ripristino lo script esegue sempre `prisma migrate deploy` con l'immagine del backend in uso, cioè quella **nuova**, e poi riavvia lo stesso backend nuovo (`start backend`). Il README prevede il ripristino del dump `predeploy` proprio quando una migration ha danneggiato i dati: lo script la rieseguirà subito dopo il ripristino.
- **Scenario:** il rilascio N applica una migration che corrompe una colonna. Si ripristina `wasteflow_predeploy_…` → `migrate deploy` (immagine N) riapplica la stessa migration → dati di nuovo corrotti, con il codice N di nuovo su. Inoltre `|| log "ATTENZIONE…"` (`:94`) inghiotte il fallimento e il backend riparte comunque.
- **Correzione:** opzione esplicita `SALTA_MIGRATE=1` (o il default al contrario per i file `predeploy`), più la richiesta di un `TAG` dell'immagine precedente da usare per `run`/`up`; far fallire lo script se `migrate deploy` fallisce, invece di avviare il backend. Correggere il README di conseguenza.

### D-C-04 — Importante — Il test "notturno senza spazio" fallisce contro un database reale (overflow aritmetico di bash), quindi il job `test-postgres` della CI è rosso

- **File:** `ops/test/backup-verifica.test.sh:229-240`; `ops/backup-offsite.sh:144`.
- **Tesi:** il test forza la mancanza di spazio con `BACKUP_FATTORE_SPAZIO_RIPRISTINO=1000000000000`. Lo script calcola `$((DIM * BACKUP_FATTORE_SPAZIO_RIPRISTINO))` con interi a 64 bit: oltre 9.223.372 byte di database il prodotto va in overflow e diventa negativo, quindi `verifica_spazio_libero` lo accetta e il ripristino di prova viene eseguito.
- **Scenario:** nel job `test-postgres` il database ha le 47 migration e i dati delle suite `*.postgres.spec.ts` (più di 10 MB). I due casi falliscono. Il CI di `ci.yml` è rosso, oppure il passo non sta girando come si crede. Il gate di `deploy.yml` esegue solo la parte senza database, quindi non lo vede.
- **Evidenza:**
  ```
  pg_database_size dopo le 47 migration: 10386455 byte
  echo $((10386455 * 1000000000000))            -> -8060289073709551616
  PG_EXEC="docker exec -i pgD-confuta" bash ops/test/backup-verifica.test.sh
    FALLITO: notturno senza spazio: esce non zero (exit 1, atteso 0)
    FALLITO: notturno senza spazio: nessun file al nome finale, uno .non-verificato (exit 1, atteso 0)
    Test riusciti: 38, falliti: 2
  backup-offsite.sh con lo stesso fattore: "Ripristino di prova riuscito" ... "Backup verificato", exit=0
  ```
- **Correzione:** nel test usare un `BACKUP_DATI_DIR` su un filesystem piccolo, oppure un fattore che non vada in overflow (es. `1000000`). Nello script, fare il confronto in `awk` (virgola mobile) e validare che i fattori siano interi positivi piccoli. Controllare l'ultimo esito reale del job `test-postgres` su Gitea.

### D-C-05 — Importante — Il rilancio manuale dalla pagina "Stato del sistema" registra "completato" anche quando il job fallisce

- **File:** `apps/backend/src/infrastructure/jobs/rentri-riconciliazione.job.ts:86-93`, `rentri-certificato-scadenza.job.ts:89-96`; consumatore `apps/backend/src/application/admin/system-health/job-actions.service.ts:77,81,137-148`.
- **Tesi:** `JobActionsService.avvia` scrive `fallito` nell'audit solo se la promise di `esegui()` viene rifiutata (`.then(completato).catch(fallito)`). Il piano D ha aggiunto ai due job RENTRI un `try/catch` esterno che logga, segnala e **non rilancia**. Ora `eseguiRiconciliazione()` ed `eseguiControlloScadenza()` si risolvono sempre.
- **Scenario:** il database non risponde, oppure `tenant.findMany` fallisce. L'operatore clicca "Riconciliazione periodica RENTRI": l'audit dice `Riconciliazione periodica RENTRI: completato`. È la pagina che dovrebbe dire che qualcosa non va.
- **Evidenza:** `job-actions.service.ts:137-148` (`.then(() => this.registra(…'completato'…)).catch(…'fallito'…)`); nei due job la `catch` più esterna termina con `segnalaErroreJob(...)` senza `throw`. Nessuno spec di `job-actions` usa i job veri.
- **Correzione:** separare il corpo (metodo pubblico che rilancia, usato dalla pagina) dall'handler `@Cron` (che cattura e segnala), oppure fare restituire al job un esito (`{ falliti, totali }`) che `avvia` trasforma in `fallito`/`parziale`. Aggiungere un test: job che fallisce → audit `fallito`.

### D-C-06 — Importante — Il backup che non parte non avvisa nessuno

- **File:** `ops/backup-offsite.sh` (la mail esiste solo in `alla_fine`, cioè quando lo script gira e fallisce); `apps/backend/src/application/admin/system-health/evidenze-db.service.ts:134-169`; `ops/README.md` ("Cron suggerito").
- **Tesi:** il cron si installa a mano (passo 7.8 del piano). Se manca, se punta al percorso vecchio (`/opt/rifiuti/ops/…` della versione precedente), se cron è fermo o lo script è stato rinominato, non parte nessuna mail: per chi riceve le mail, silenzio vuol dire "tutto bene". La misura "Ultimo backup riuscito" della pagina Stato del sistema legge `backup_schedules`/`backup_history`, tabelle che **nessun codice scrive** (né prima né dopo la rimozione di `BackupService`), quindi mostra "spenta" o un valore fermo, mai il backup vero.
- **Scenario:** il vecchio cron con `source …` (che sotto dash non ha mai funzionato) resta installato, il nuovo non viene aggiunto. Nessun backup notturno per settimane, nessun avviso. La pagina dello stato è verde perché nessuna pianificazione è attiva.
- **Evidenza:** `git grep -n "backupHistory\|backupSchedule" c9b10dd -- apps ':!*.spec.ts'` → solo letture (`evidenze-db.service.ts:135,158`) e la pulizia dei test.
- **Correzione:** a fine backup riuscito, scrivere un heartbeat (file `/var/lib/wasteflow-backup/ultimo-ok` con il timestamp e la riga in `backup_history` via `psql`) e aggiungere un controllo esterno all'evento: freschezza > 26 h → mail (come `fastselling-salute` o la sezione "backup freshness" di `security-report.sh`). Oppure creare una `BackupSchedule` DAILY attiva così che la pagina misuri davvero.

### D-C-07 — Importante — Il messaggio dell'eccezione arriva a Bugsink senza ripulitura

- **File:** `apps/backend/src/core/monitoring/opzioni-sentry.ts:14-51` (`ripulisciEventoSentry`); `apps/backend/src/core/filters/http-exception.filter.ts:118-129`, `:185-190` (default di `mapPrismaKnownError` → 500); `core/monitoring/segnala-errore-job.ts`.
- **Tesi:** la Decisione 5 ("nessun dato personale") è applicata a richiesta, breadcrumb e utente, ma non a `event.exception.values[].value` né a `extra`. Tutti i 500 vengono inviati con l'eccezione originale: `PrismaClientUnknownRequestError`, `P2010` (raw query fallita) e gli altri codici non mappati portano il testo dell'errore di PostgreSQL. Per i vincoli violati questo testo contiene i valori (`Key (…)=(…)`, `Failing row contains (…)`), cioè ragioni sociali, CF, indirizzi. Lo stesso vale per i job: un errore RENTRI o SMTP che riporta il destinatario finisce nel `value`. Bugsink è condiviso da nove stack.
- **Scenario:** una `$queryRaw` (23 punti nel backend) viola un vincolo di unicità o un check su una riga anagrafica → P2010 → 500 → evento con la riga intera nel messaggio.
- **Evidenza:** `ripulisciEventoSentry` tocca solo `request`, `breadcrumbs[].data`, `user`. Non ho riprodotto il testo esatto di Prisma per ogni codice: la parte certa è che il messaggio non viene filtrato.
- **Correzione:** in `beforeSend`, per le eccezioni Prisma sostituire `value` con `code` e nome della classe; per tutte le altre applicare una redazione per pattern (email, CF, P.IVA, `Key (…)=(…)`, `Failing row contains`). Test con un `PrismaClientKnownRequestError` P2010 il cui messaggio contiene un CF.

### D-C-08 — Minore — Backup notturno e deploy possono girare insieme (manca un lock)

- **File:** `ops/backup-offsite.sh` (nessun `flock`); `.gitea/workflows/deploy.yml:285-296`.
- **Tesi:** un push su `master` verso le 03:30 fa partire il deploy durante il ripristino di prova. Il primo `up -d` dopo questo piano ricrea anche `postgres` (cambia `logging`, lo dice il compose), quindi il ripristino si interrompe: `.scartato`, mail di fallimento, e forse un `wasteflow_verifica_*` rimasto. Inoltre `migrate deploy` resta in attesa dei lock `ACCESS SHARE` presi da `pg_dump`, e il confronto di `_prisma_migrations` fra sorgente e copia può dare un falso "scartato".
- **Correzione:** `exec 9>/run/lock/wasteflow-backup.lock; flock -w 600 9` sia in `predeploy` sia in `notturno` (e in `restore.sh`).

### D-C-09 — Minore — Il test "predeploy: esce non zero se il dump fallisce" non prova `pg_dump`

- **File:** `ops/test/backup-verifica.test.sh:71-77`.
- **Tesi:** con `PG_EXEC=false` lo script si ferma già su `dimensione_db` ("Postgres non raggiungibile?"), prima del dump. Il ramo predeploy con `pg_dump` fallito a metà (rinomina in `.scartato`, nessun file al nome finale, exit ≠ 0) non è coperto. Lo stub `FAKE_DUMP_FAIL` viene usato solo in modalità notturna.
- **Correzione:** ripetere `staging-dumpko` con `BACKUP_MODALITA=predeploy` e lo stub.

### D-C-10 — Minore — `Sentry.init` dopo gli `import` (manca `instrument.ts`)

- **File:** `apps/backend/src/main.ts:6-19`.
- **Tesi:** con `@sentry/node` ^10 (OpenTelemetry) la documentazione chiede di inizializzare l'SDK prima di caricare `http`/`express`. Qui `AppModule` e Nest sono importati prima, con gli `import` portati in cima dal compilatore. L'isolamento per richiesta e la strumentazione di Express possono risultare parziali: breadcrumb (chiamate HTTP verso RENTRI/Keycloak, console) di richieste e tenant diversi possono finire nello stesso evento. Non verificato a runtime: va guardato al passo 7.5, con due richieste concorrenti di tenant diversi.
- **Correzione:** `src/instrument.ts` con `Sentry.init(opzioniSentry(process.env))`, importato come primo modulo di `main.ts` (o `node --import`).

### D-C-11 — Minore — L'esclusione delle rotte health toglie tutti i 5xx, non solo i 503

- **File:** `apps/backend/src/core/filters/http-exception.filter.ts:118-119`.
- **Tesi:** `!/\/health(\/|$)/.test(path)` esclude qualunque 5xx sotto `/health`, compreso un 500 vero di `/health/detailed` (rotta autenticata). La Decisione 4 parla dei 503.
- **Correzione:** `statusCode >= 500 && !(statusCode === 503 && /\/health(\/|$)/.test(…))`.

### D-C-12 — Minore — La guardia "nessuna shell" copre solo l'`import` statico, e l'app parla a Postgres come superuser

- **File:** `apps/backend/src/api/nessuna-shell-esposta.spec.ts:61-72`; `docker-compose.prod.yml` (`DATABASE_URL` con `DB_USER` = `POSTGRES_USER`).
- **Tesi:** `await import('child_process')`, `require` con una stringa composta, `worker_threads`/`process.binding` o una dipendenza che esegue processi passano la guardia. Rimane poi un percorso verso la shell: il backend si connette con l'utente creato da `POSTGRES_USER`, che è superuser. Qualunque SQL injection futura (c'è un `$executeRawUnsafe`, oggi limitato a `NODE_ENV=test`) diventa `COPY … TO PROGRAM` nel container postgres.
- **Correzione:** estendere la regex a `import(` dinamico e `node:child_process`; nel medio termine un ruolo applicativo non superuser (`NOSUPERUSER`, proprietario dello schema), lasciando il superuser a migration e backup.

### D-C-13 — Minore — rsync/rclone senza timeout

- **File:** `ops/backup-offsite.sh` (ramo `rsync`, `rclone`).
- **Tesi:** `ssh` senza `-o BatchMode=yes -o ConnectTimeout=…` e `rsync` senza `--timeout`. Una destinazione appesa blocca il cron per sempre, senza nessuna mail. Oggi non succede perché `OFFSITE_MODE=disabled` (DG-46), ma succederà appena si attiva la copia.
- **Correzione:** `-e "ssh -i … -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15"`, `rsync --timeout=300`, `timeout 3600 rclone …`.

### D-C-14 — Minore — Valori non numerici nel `.env` producono un "backup fallito" dopo un backup riuscito

- **File:** `ops/backup-offsite.sh` (`RETENTION_DAYS`, `BACKUP_FATTORE_*`).
- **Tesi:** `BACKUP_RETENTION_DAYS=30gg` fa fallire `find -mtime +30gg` **dopo** che il dump è stato verificato e messo al nome finale: `set -e` esce, arriva la mail "backup WasteFlow fallito" su un backup buono. Un fattore scritto come nome di variabile viene valutato da `$((…))`.
- **Correzione:** validare all'avvio con `[[ $X =~ ^[0-9]+$ ]] || die`.

### D-C-15 — Minore — Restano anni calcolati nel fuso del processo

- **File:** `apps/backend/src/application/contracts/contract.service.ts:151` (`CTR-<anno>-` suggerito), `api/mud/mud.controller.ts:101` (anni MUD disponibili), `api/pdf/pdf.controller.ts:106`, `deadline-checker.service.ts:54`.
- **Tesi:** con il processo in UTC, fra le 00:00 e l'01:00 italiane del 1° gennaio questi punti restituiscono ancora l'anno precedente. Registro e FIR usano `annoSolareItaliano`, gli altri no. Il censimento è già un follow-up (Decisione 10), ma `nextContractNumber` è un progressivo annuale come quello del registro.
- **Correzione:** `annoSolareItaliano(now)` in `nextContractNumber` e in `getAvailableYears`.

### D-C-16 — Minore — Gli handler `@OnEvent` e i `@Processor` BullMQ non arrivano a Bugsink

- **File:** `application/signatures/signature-audit.handler.ts:43,96` (`FIR_SIGNED`, `FIR_COMPLETED`); `infrastructure/jobs/*.job.ts` con `@Processor`.
- **Tesi:** il guardiano controlla solo `@Cron(`. Un errore nell'audit della firma (con `suppressErrors` di EventEmitter2 attivo di default) resta solo nel log.
- **Correzione:** estendere `segnalaErroreJob` (e il guardiano) a `@OnEvent` e ai processor, o documentare l'esclusione.

### D-C-17 — Minore — Il guardiano del fuso controlla solo `environment` di backend e postgres

- **File:** `apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts` (describe "fuso orario").
- **Tesi:** un `ENV TZ=Europe/Rome` nel `Dockerfile.prod`, un `env_file:` o un `TZ` in `frontend`/`redis` passano il test.
- **Correzione:** cercare `TZ` anche in `apps/backend/Dockerfile.prod` e vietare `env_file:` nel servizio backend.

### D-C-18 — Minore — Con `ENCRYPT_BACKUP=true` anche il dump pre-deploy viene cifrato e il chiaro cancellato

- **File:** `ops/backup-offsite.sh` (blocco "Cifratura opzionale con age", eseguito anche in `predeploy`).
- **Tesi:** il backup per il rollback rapido diventa leggibile solo con la chiave privata age, che il README colloca fuori dal VPS (`~/.age/key.txt` sulla postazione). Il rollback di emergenza richiede di recuperarla prima.
- **Correzione:** cifrare solo in modalità `notturno` (il predeploy non esce comunque dal VPS) oppure dirlo nel README.

---

## Cosa ho verificato e regge

- **Marcatore finale con PostgreSQL 16.15** (dump con `\restrict`/`\unrestrict` in coda): `verifica_completezza_dump` guarda le ultime 20 righe e trova il marcatore. Il ripristino di prova via `psql` della stessa versione funziona (test "dump reale completo e ripristino di prova riuscito" verde).
- **`ripristino_di_prova` elimina sempre il DB temporaneo**, anche dopo un ripristino fallito (verificato su Postgres reale: 0 `wasteflow_verifica_%`). Il codice 2 (DROP fallito dopo un ripristino riuscito) accetta il dump e manda la mail (test con stub).
- **Un solo `trap` su EXIT**, quindi una sola mail. `MAIL_GIA_INVIATA` evita il doppio invio sul ramo "spazio insufficiente".
- **`leggi_env` non esegue il `.env`** (test con `$(touch …)`). Ogni `docker compose` di `ops/` passa `--env-file` (test awk sulle righe logiche).
- **`umask 077`**: i dump nascono 600 e la cartella creata dallo script 700. La rinomina in `.scartato`/`.non-verificato` conserva i permessi. `rsync --no-perms` applica la umask remota ai bit del sorgente, quindi i file restano 600.
- **`.parziale`**: un dump fallito o troncato non resta mai al nome finale. I parziali vecchi vengono ruotati dopo 7 giorni.
- **`pipefail` dentro `if ! pg_exec pg_dump … | gzip`**: un `pg_dump` fallito fa fallire la condizione (test `FAKE_DUMP_FAIL`).
- **Deploy**: con `set -e`, un backup pre-deploy fallito ferma tutto prima di `migrate deploy`. Lo smoke test interroga `/api/v1/health/db` attraverso l'nginx del frontend (`location /api/` → `backend:3000`), che risponde 503 se il DB è giù. Senza JWT globale la rotta è pubblica.
- **Compose**: `x-logging` 50m×3 su tutti e quattro i servizi. `SENTRY_DSN` vuota = SDK spento. Il backend è nella rete `monitoring`, quindi raggiunge `bugsink:8000`. Rendere obbligatoria `PERMISSION_CACHE_HMAC_SECRET` non rompe le sessioni: le voci firmate con la chiave vecchia vengono invalidate e ricaricate (`permission-cache.service.ts:142-155`).
- **Tempo italiano**: `annoSolareItaliano` è esatto al cambio d'anno (a gennaio l'Italia è in UTC+1) e coincide con `giornoItaliano(...).slice(0,4)` in ogni istante. `giornoItaliano` usa `Intl` con `Europe/Rome`, quindi gestisce l'ora legale (`node:20-alpine` ha l'ICU completo). La data di registrazione la assegna il server (`registro.controller.ts:68`), quindi il progressivo segue l'anno italiano dell'istante di scrittura. Il controllo "data nel futuro" non respinge più la data di oggi fra le 00:00 e le 02:00. La numerazione FIR usa lo stesso modulo.
- **Bugsink**: utente da `request.user.id` (con `userId` come ripiego), path senza query, `sendDefaultPii: false`, corpo/header/cookie/IP esclusi, query e fragment tolti anche dai breadcrumb, `captureException` dentro `try`. I 4xx restano fuori. Gli 11 `@Cron` chiamano `segnalaErroreJob` (guardiano verde). I `catch` per tenant dei tre job RENTRI segnalano con il tag `tenantId`.
- **Endpoint `/backup`**: nessun controller raggiungibile da `AppModule` sotto `/backup`. Nessun `child_process` nei sorgenti di produzione. Il frontend non chiama più `/backup`. Il bind mount `./backups` è stato tolto da entrambi i servizi.
