# Script SQL di amministrazione

## ruoli-db.sql

Crea (o riallinea, se esistono) i due ruoli applicativi e i loro GRANT minimi:

- `wasteflow_app`: applicazione, `NOBYPASSRLS`; CRUD sulle tabelle di `public`, tranne le
  tabelle globali in sola lettura (elenco `v_sola_lettura` nello script, oggi `causali_registro`:
  solo `SELECT`, con una `REVOKE` esplicita a ogni esecuzione; una nuova tabella globale va
  aggiunta all'elenco, i default privileges restano CRUD).
- `wasteflow_sistema`: job di sistema, `BYPASSRLS`; stessi diritti.

Entrambi: `CONNECT` sul database, `USAGE` su `public`, `USAGE, SELECT` sulle
sequence, solo `SELECT` su `_prisma_migrations`, nessun `TRUNCATE`, nessun
`CREATE`. I diritti sulle tabelle future sono dati con `ALTER DEFAULT
PRIVILEGES` per l'utente che esegue lo script. Nessuna policy RLS.

Chi lo esegue: l'owner delle tabelle (`wasteflow`), che deve essere anche
**superuser** (in PostgreSQL 16 serve per assegnare `BYPASSRLS`); altrimenti lo
script si ferma con un errore.

**Ordine**: sempre DOPO `prisma migrate deploy` (dev, CI, deploy, restore). Se
`_prisma_migrations` non esiste lo script fallisce con un errore esplicito,
perche' i diritti di default darebbero CRUD completo a quella tabella.

"Nessun `CREATE`" riguarda lo schema `public`: `PUBLIC` mantiene `TEMP` sul
database, quindi i ruoli possono creare tabelle temporanee.

Idempotente: rilanciarlo aggiorna le password.

Si esegue con `ops/db-ruoli.sh` (vedi sotto), che passa le password sullo stdin di
psql come righe `\set` prima del file, cosi' non stanno in nessun argv:

```
\set app_password '...'
\set sistema_password '...'
<contenuto di ruoli-db.sql>
```

Variabili psql: `app_password`, `sistema_password` (obbligatorie, non vuote). Vengono
passate al blocco `DO` con `set_config`, perche' psql non interpola le variabili
dentro i dollar-quoted string. Il test `ruoli-db.postgres.spec.ts` esegue questo
stesso file senza psql, sostituendo i due `:'...'` con letterali.

## Come si esegue (un solo punto d'ingresso: `ops/db-ruoli.sh`)

Lo script `ops/db-ruoli.sh [NOME_DATABASE]` esegue `ruoli-db.sql` con `psql`
DENTRO il container postgres (sull'host non serve psql), come owner. Lo usano
deploy, restore e CI.

- **Password fuori da ogni argv e dai log**: arrivano a psql come righe `\set`
  sullo stdin, costruite col `printf` builtin di bash, seguite dal file SQL. Non
  stanno nella riga di comando (niente `/proc/<pid>/cmdline`, niente log del
  runner). Password: almeno 16 caratteri, solo `A-Za-z0-9 _ . -` (altrimenti compose
  costruirebbe URL non validi); generarle con `openssl rand -hex 32`.
  psql gira con `VERBOSITY=terse`, `SHOW_CONTEXT=never` e `-o /dev/null`, e il blocco
  SQL non riporta lo statement negli errori.
- **Da dove le prende**: dall'ambiente; per quelle mancanti dal file indicato da
  `RUOLI_ENV_FILE` (letto, non eseguito: deploy e restore passano
  `/opt/rifiuti/.env`).
- **Esito**: nessuna password -> `ruoli DB non configurati: salto`, exit 0.
  Configurazione a meta' (una sola password, `DB_APP_USER` diverso da
  `wasteflow_app`, `DB_SISTEMA_USER` diverso da `wasteflow_sistema`, user senza
  password) -> errore, exit 1.

- **Sviluppo** (password `wasteflow_app_dev` / `wasteflow_sistema_dev`), dopo
  `prisma migrate deploy`, con il container `wasteflow-postgres` acceso:

  ```
  cd apps/backend && npm run db:ruoli
  ```

  Vale anche per un volume gia' esistente: e' idempotente. NON e' in
  `docker-entrypoint-initdb.d`: quella cartella gira prima delle migration e lo
  script si fermerebbe.
- **Produzione**: in `/opt/rifiuti/.env` si impostano TUTTE E TRE `DB_APP_USER=wasteflow_app`,
  `DB_APP_PASSWORD`, `DB_SISTEMA_PASSWORD` (password casuali), oppure nessuna.
  Una configurazione a meta' fa fallire `docker compose` (gia' al `pull`, prima di
  backup e migration) e lo script. Le migration girano sempre con
  `DATABASE_URL_MIGRAZIONI` (owner). Rollback: togliere le tre variabili e rifare il
  deploy; i ruoli possono restare.
- **CI** (`test-postgres`): stesso script dopo le migration, con
  `PG_EXEC="docker exec -i -e PGPORT=55432 <container>"` e le password nell'env del job.
- **Altro container**: `DB_APP_PASSWORD=... DB_SISTEMA_PASSWORD=... PG_EXEC="docker exec -i <nome>" bash ops/db-ruoli.sh [database]`.

## Restore su un cluster nuovo

`pg_dump` (in `ops/backup-offsite.sh`) non usa `--no-privileges`, quindi il dump
contiene i GRANT a `wasteflow_app` e `wasteflow_sistema`, ma i ruoli sono del
cluster e non stanno nel dump. `ops/restore.sh` li crea `NOLOGIN`, senza password,
se mancano, PRIMA di caricare il dump (no-op se esistono); LOGIN, password e diritti
li da' poi `ops/db-ruoli.sh` dopo le migration. Nessun intervento a mano.
