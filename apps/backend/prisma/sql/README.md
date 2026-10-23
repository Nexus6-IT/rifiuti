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
