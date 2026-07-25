# Operations Runbook - WasteFlow Roles & Permissions System

**T238: Phase 10 - Operations Documentation**

For complete runbook, see deployment checklist and monitoring documentation.

## Quick Reference

### Common Commands

```bash
# Check permission for user
redis-cli GET "permissions:tenant-id:user-id"

# Clear user cache
redis-cli DEL "permissions:tenant-id:user-id"

# Check metrics
curl http://localhost:3000/metrics | grep permission

# Backup database
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
```

### Emergency Procedures

1. **High Latency**: Clear cache, check database connections
2. **Permission Denial**: Check audit logs, verify role assignments
3. **Security Incident**: Revoke user access, check audit trail

## Applicare i seed di permessi e ruoli in produzione (P5 Task 1)

### Contesto

Il catalogo permessi/ruoli (`apps/backend/prisma/seeds/permissions.seed.ts` e
`roles.seed.ts`) va riapplicato ogni volta che il catalogo cambia (es. la
pipeline P4 ha aggiunto i permessi `role:*`, `audit:*`, `consultant:manage`
assegnati ad ADMIN). Senza riapplicare il seed in produzione, quelle pagine
rispondono 403 anche agli ADMIN perché il permesso non esiste ancora nel DB
o non è assegnato al ruolo.

**Il vecchio comando documentato `node dist/prisma/seeds/permissions.seed.js`
NON funzionava**: `apps/backend/tsconfig.json` compila solo `src/**/*`, quindi
`dist/prisma/seeds/` non esisteva nell'immagine di produzione, e `ts-node`
non è installato nel runtime (immagine lean, solo dipendenze di produzione).

**Fix**: un tsconfig dedicato (`apps/backend/tsconfig.seeds.json`) compila
`prisma/seeds/*.ts` (+ la loro unica dipendenza in `src/`,
`system-roles.ts`) in `dist/prisma/seeds/*.js`, eseguito automaticamente
come hook `postbuild` di `npm run build` — quindi la build Docker esistente
(`npm run build` nello stage `builder`) produce già tutto il necessario,
nessuna modifica al Dockerfile.

Entrambi gli script (`permissions.seed.ts` e `roles.seed.ts`) sono
**idempotenti** (upsert su chiave naturale: `resource:action:scope` per i
permessi, `tenantId:name` per i ruoli, `roleId:permissionId` per le
assegnazioni) — eseguirli più volte non duplica righe né perde assegnazioni
esistenti.

### Procedura di applicazione

```bash
# 1. Collegarsi al container backend in produzione.
#    ATTENZIONE alla collisione di project-name Docker Compose: la dir di
#    checkout è /opt/rifiuti/site, quindi `docker compose` SENZA -p colpisce
#    il project di default "site" — che su questo host è condiviso con altri
#    stack (es. IgniCraft) e può risolvere ai container SBAGLIATI (successo
#    durante questa sessione: un comando `docker compose ps` ha risposto con
#    i container di IgniCraft invece di quelli di Rifiuti).
#    Usare SEMPRE -p rifiuti, oppure agire sul container per nome.
cd /opt/rifiuti/site
docker compose -p rifiuti exec backend npm run seed:rbac

# In alternativa, per nome container (non serve essere nella dir giusta):
docker exec rifiuti-backend-1 npm run seed:rbac
```

`seed:rbac` esegue in sequenza (l'ordine è obbligatorio: i ruoli referenziano
i permessi per chiave):

1. `seed:permissions` → `node dist/prisma/seeds/permissions.seed.js`
   (upsert del catalogo permessi)
2. `seed:roles` → `node dist/prisma/seeds/roles.seed.js`
   (upsert dei 5 ruoli di sistema per ogni tenant esistente + assegnazione
   permessi via upsert su `RolePermission`)

Verifica rapida post-seed (conta permessi/ruoli attesi):

```bash
docker exec rifiuti-backend-1 node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.permission.count().then(n => console.log('permessi:', n))
  .finally(() => p.\$disconnect());
"
```

### Verifica eseguita (2026-07-25)

- Build immagine `Dockerfile.prod`: **nessuna crescita significativa**
  (script di seed sono poche decine di KB di JS compilato copiati insieme a
  `dist/`, già presente nell'immagine).
- `docker run --rm <image> ls dist/prisma/seeds/` → elenca
  `permissions.seed.js` e `roles.seed.js` (verificato nell'immagine reale,
  non dedotto).
- Idempotenza: `npm run seed:rbac` eseguito due volte di seguito contro lo
  stesso database → stesso conteggio permessi/ruoli/assegnazioni dopo la
  seconda esecuzione (upsert, nessun duplicato, nessuna assegnazione persa).

**Last Updated**: 2026-07-25

## Follow-up: test frontend fuori dai gate CI (2026-07-25)

I 20 test Angular (Karma + ChromeHeadless) **non sono eseguiti da nessun gate
CI**. Motivo verificato: l'immagine del runner self-hosted
(`catthehacker/ubuntu:act-latest`) non contiene alcun browser, e l'azione di
terze parti `browser-actions/setup-chrome` non funziona su Gitea Actions. È
questa la ragione per cui `ci.yml` risultava rosso da mesi e veniva ignorato.

Sono verdi e vanno eseguiti in locale prima di un rilascio che tocchi il
frontend:

```bash
cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless
```

**Per riportarli nel gate** serve un browser nell'immagine del runner. Due
strade: costruire un'immagine runner derivata con `chromium` preinstallato, o
aggiungere al job un passo di installazione da repository della distribuzione
(più lento a ogni esecuzione). Finché non è fatto, il gate verifica del
frontend solo lint e build, che non richiedono browser.
