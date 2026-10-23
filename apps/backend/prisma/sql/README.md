# Script SQL di amministrazione

## ruoli-db.sql

Crea (o riallinea, se esistono) i due ruoli applicativi e i loro GRANT minimi:

- `wasteflow_app`: applicazione, `NOBYPASSRLS`; CRUD sulle tabelle di `public`.
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

```
psql -v ON_ERROR_STOP=1 -v app_password=... -v sistema_password=... -f ruoli-db.sql
```

Variabili: `app_password`, `sistema_password` (obbligatorie, non vuote). Vengono
passate al blocco `DO` con `set_config`, perche' psql non interpola le variabili
dentro i dollar-quoted string. Il test `ruoli-db.postgres.spec.ts` esegue questo
stesso file senza psql, sostituendo i due `:'...'` con letterali.

## Come si esegue (un solo punto d'ingresso: `ops/db-ruoli.sh`)

Lo script `ops/db-ruoli.sh` esegue `ruoli-db.sql` con `psql` DENTRO il container
postgres (sull'host non serve psql), come owner. Le password le legge dall'ambiente
del container e non compaiono mai nella riga di comando ne' nei log; se mancano
stampa `ruoli DB non configurati: salto` ed esce con 0. Lo usano deploy, restore e CI.

- **Sviluppo** (password `wasteflow_app_dev` / `wasteflow_sistema_dev`), dopo
  `prisma migrate deploy`, con il container `wasteflow-postgres` acceso:

  ```
  cd apps/backend && npm run db:ruoli
  ```

  Vale anche per un volume gia' esistente: e' idempotente, rilanciarlo non rompe
  nulla. NON e' in `docker-entrypoint-initdb.d`: quella cartella gira prima delle
  migration e lo script si fermerebbe.
- **Produzione**: aggiungere a `/opt/rifiuti/.env` `DB_APP_PASSWORD`,
  `DB_SISTEMA_PASSWORD` (casuali, esadecimali) e `DB_APP_USER=wasteflow_app`
  (obbligatoria insieme alla password: senza, `docker compose` si ferma con un
  errore prima di toccare qualcosa). Il deploy successivo crea i ruoli e passa
  `DATABASE_URL` al ruolo non owner. Le migration girano sempre con
  `DATABASE_URL_MIGRAZIONI` (owner).
- **CI** (`test-postgres`): stesso script, dopo le migration, con
  `PG_EXEC="docker exec -i -e PGPORT=55432 -e DB_APP_PASSWORD -e DB_SISTEMA_PASSWORD <container>"`.
- **Altro container**: `PG_EXEC="docker exec -i -e DB_APP_PASSWORD -e DB_SISTEMA_PASSWORD <nome>" bash ops/db-ruoli.sh`
  con le due variabili esportate.

Nota sul restore: `pg_dump` (in `ops/backup-offsite.sh`) non usa `--no-privileges`,
quindi il dump contiene i GRANT ai due ruoli. Su un cluster nuovo, dove i ruoli non
esistono ancora, il caricamento del dump fallirebbe (`ON_ERROR_STOP`): caso NON
coperto da questo pezzo, da gestire a parte (creare i ruoli a mano prima del restore).
