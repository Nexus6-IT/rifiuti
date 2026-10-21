# Fase 0, piano D: esercizio (error tracking, backup, deploy) — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** gli errori del backend arrivano davvero a Bugsink, ogni backup è verificato (marcatore di fine dump e restore di prova) e allarma via mail se fallisce, il deploy fa un backup verificato prima delle migration e si ferma se non riesce, l'anno di registro e progressivi è quello italiano, e i log dei container hanno una rotazione.

**Architettura:** un test "guardiano" Jest (`infrastruttura-prod.guard.spec.ts`) legge `docker-compose.prod.yml`, `deploy.yml` e i sorgenti del backend e fallisce quando una variabile letta dal codice non arriva al container, quando il deploy migra senza backup, quando manca `TZ` o la rotazione dei log. Gira nel gate `quality` di `deploy.yml` (dentro `npm run test:cov`), quindi blocca il rilascio. La verifica dei backup sta in una libreria bash (`ops/lib/backup-verifica.sh`) usata da `ops/backup-offsite.sh` sia di notte sia prima delle migration, con un test bash che gira anche contro il PostgreSQL effimero del job `test-postgres`. L'anno italiano è una funzione pura, indipendente dal fuso del processo; `TZ=Europe/Rome` copre il resto del codice che usa `getFullYear()` e `new Date(anno, 0, 1)`.

**Tech Stack:** NestJS 10, `@sentry/node` 10, Jest 29 + ts-jest, Docker Compose v2, bash, PostgreSQL 16 (`postgres:16-alpine`), Gitea Actions (`appleboy/ssh-action@v1`), msmtp sul VPS.

**Spec:**
- `C:\Progetti\winwaste\docs\confronto-con-rifiuti.md` §4 punto 8, §7 Fase 0 ("Bugsink collegato; backup verificato")
- `C:\Progetti\winwaste\docs\confronto-rifiuti\04-piattaforma-e-migrazione.md` §1.9 Backup, §1.10 Osservabilità, §1.11 Aggiornamenti, §1.12 Fuso orario, §6 raccomandazioni R1 (solo log `max-size`), R2, R3, R4(c)
- Pattern infrastrutturali di Graziano (`C:\Users\manzo\.claude\CLAUDE.md`): Bugsink (DSN con chiave a 32 hex senza trattini, `http://<chiave>@bugsink:8000/<id>`), backup Fast Selling (dump accettato solo dopo un restore di prova in un DB temporaneo, mail se fallisce), lezione Gitea del 16/09 (dump troncato ma gzip valido, marcatore `PostgreSQL database dump complete`, `set -e` che salta la pulizia), log json-file (`max-size: "50m"`, `max-file: "3"`, mai logrotate/copytruncate).

## Decisioni prese in questo piano (da confermare con Graziano)

1. **Elenco esplicito invece di "passa tutto".** Ogni variabile letta dal codice deve stare nel blocco `environment:` del backend **oppure** nell'elenco `NON_PASSATE` del test guardiano, con il motivo scritto. Passarle tutte vuote sarebbe peggio: `${X}` non impostata arriva come stringa vuota e scavalca il default del codice (`config.get('JWT_ACCESS_TOKEN_EXPIRATION', '15m')` diventerebbe `''`).
2. **Variabili aggiunte al compose** (oltre a `SENTRY_DSN`): `APP_VERSION` (dal tag dell'immagine), `PUBLIC_URL` (oggi i link nelle mail di notifica puntano a `https://wasteflow.app`), `PERMISSION_CACHE_HMAC_SECRET` **obbligatoria** (oggi la produzione firma la cache dei permessi con il default `change-me-in-production`), `LOG_LEVEL`, `TZ`.
3. **Restano fuori, con motivo**: RENTRI globale (oggi vale il default demo), QES/TSA (nessun contratto QTSP), Stripe (billing non attivo), SAML della `KeycloakSamlStrategy` (non registrata in alcun modulo), alias SPID e chiavi SP, `SWAGGER_ENABLED`, `SPID_STRICT_LEVEL_CHECK`, default JWT/Redis. Passare ciascuna di queste è una decisione a sé, non una correzione.
4. **I 5xx vanno a Bugsink dal filtro globale.** Con il solo `Sentry.init` di `@sentry/node` un'eccezione in un controller non arriva mai a Bugsink: la intercetta `HttpExceptionFilter` e risponde 500. Si chiama `Sentry.captureException` dal filtro, solo per status ≥ 500. I 4xx restano fuori, altrimenti Bugsink si riempie di 401 e 404.
5. **Niente tracing verso Bugsink.** Si toglie `tracesSampleRate: 1.0`: Bugsink raccoglie errori, non transaction, e il tracing attiva la strumentazione OpenTelemetry senza utilità.
6. **Backup pre-deploy = dump + verifica del marcatore, senza restore di prova.** Il restore di prova gira ogni notte sulla stessa pipeline. Prima delle migration conta avere in pochi secondi un file completo da cui ripartire. Nessun interruttore per saltare il backup: se fallisce, il deploy si ferma e la produzione resta sulla versione precedente.
7. **Lo script legge solo `DB_NAME` e `DB_USER` da `/opt/rifiuti/.env`, senza `source`.** Il cron suggerito oggi (`source /opt/rifiuti/.env && …`) non funziona: cron usa `/bin/sh` (dash), dove `source` non esiste. E il `.env` è sintassi compose, non shell. `DB_PASSWORD` non serve: `pg_dump` gira dentro il container, dove l'immagine ufficiale accetta le connessioni locali in `trust`.
8. **Percorso del compose = `/opt/rifiuti/site/docker-compose.prod.yml`**, quello che usa il deploy (`deploy.yml:275`, `:281`). Oggi lo script punta a `/opt/rifiuti/docker-compose.prod.yml`, che il deploy non tocca mai.
9. **Anno italiano senza librerie:** `annoSolareItaliano(d) = anno UTC di (d + 1 h)`. Al passaggio d'anno l'Italia è sempre in UTC+1 (l'ora legale va da fine marzo a fine ottobre), quindi la formula è esatta per ogni istante. È la stessa scelta del piano A (`limitiAnnoMud`, decisione 8).
10. **`TZ` solo sul backend, mai su PostgreSQL.** Le 48 colonne con `@default(now())` sono `timestamp` senza fuso: con `TZ` sul container del DB, `CURRENT_TIMESTAMP` scriverebbe l'ora italiana accanto ai valori UTC scritti da Prisma.
11. **Rotazione log con `x-logging` comune a tutti e quattro i servizi.** Il primo deploy dopo questa modifica **ricrea anche `postgres` e `redis`** (cambia la loro configurazione): pochi secondi di fermo. I dati stanno nei volumi, e Redis salva l'RDB allo stop. Il backup pre-deploy del Task 4 viene preso prima.

## Global Constraints

- **TDD obbligatorio** (regola di progetto): prima il test, poi guardarlo fallire.
- **Memoria della macchina (16 GB):** mai la suite intera. Backend: `cd apps/backend && npx jest --runInBand <percorso spec>`.
- **Nessuna nuova dipendenza npm.** Il backend ha due lockfile (radice e `apps/backend/package-lock.json`, usato da `Dockerfile.prod`): un `package.json` disallineato rompe `npm ci` nella build dell'immagine, che gira solo dopo il merge. Il guardiano legge YAML con un parser a righe scritto nel test.
- **Lingua:** commenti, log e messaggi in italiano; termini tecnici in inglese (deploy, backup, container, job, dump, log).
- **Stile TypeScript:** prettier `semi: false`, `singleQuote: true`, `printWidth: 100`, `trailingComma: es5`, `arrowParens: avoid`. Lint: `cd apps/backend && npx eslint <file>`, zero errori.
- **Bash:** `set -euo pipefail` negli script eseguibili, **mai** nelle funzioni di libreria. Le funzioni che devono fare pulizia controllano gli esiti in modo esplicito (`if …; then`), perché `set -e` uscirebbe prima della pulizia (lezione Gitea 16/09).
- **Nessun server toccato durante l'implementazione.** Ogni passo che tocca `/opt/rifiuti`, il VPS o Bugsink è nel Task 7 ed è marcato **[SERVER — serve l'approvazione di Graziano]**. Anche il **merge su `master` è un'azione sul server**, perché fa partire il deploy in produzione.
- **Ordine obbligato:** il Task 1 rende `PERMISSION_CACHE_HMAC_SECRET` obbligatoria. Il merge su `master` avviene **solo dopo** il passo 7.2 (variabile scritta in `/opt/rifiuti/.env`), altrimenti `docker compose` rifiuta l'interpolazione e il deploy si ferma (la produzione resta sulla versione precedente, ma il rilascio fallisce).
- **Commit:** `fix(ops): …`, `feat(ops): …`, `test(ops): …`, `fix(registro): …` in italiano, **senza righe `Co-Authored-By` né altre attribuzioni**.
- **Coordinamento con gli altri piani della Fase 0:**
  - Il **piano C** (`2026-10-21-fase0-c-integrita-registro-fir.md`) definisce la stessa funzione, con lo stesso nome e la stessa formula, in `apps/backend/src/domain/fir/numero-fir.ts` (suo Task 7), e riscrive `registra-movimento.use-case.ts:116-147` (lock e giacenza dentro la transaction) lasciando l'anno a `getFullYear()`. Qui la funzione vive in `apps/backend/src/core/time/anno-italiano.ts`, perché serve a registro, FIR e MUD. **Se il piano C è già stato eseguito:** spostare la sua `annoSolareItaliano` in `core/time/anno-italiano.ts`, importarla da lì in `numero-fir.ts` (togliendo la copia) e cambiare soltanto il calcolo di `anno` dentro la transaction riscritta. **Se si esegue prima questo piano:** chi esegue il piano C importa `annoSolareItaliano` da `core/time/anno-italiano.ts` invece di crearla.
  - Il piano A (`limitiAnnoMud`) usa la stessa regola (UTC+1 a Capodanno). Riunire le due funzioni è un follow-up, non va fatto qui.
  - La numerazione FIR (`emetti-fir.use-case.ts:65`, `fir-prisma.repository.ts:385-386`) resta al piano C. Fino ad allora la copre `TZ=Europe/Rome`.

## Review Focus

1. **Variabile passata vuota che scavalca il default del codice** (`JWT_ISSUER: ${JWT_ISSUER}` senza `.env`): atteso che il guardiano fallisca e indichi la variabile. Test: Task 1, `non passa nuda una variabile che il codice legge con un default`.
2. **Dump troncato ma gzip valido** (lo stream si interrompe a metà, come su Gitea il 16/09): atteso che il file venga rifiutato, rinominato `.scartato`, non ruotato come buono e segnalato via mail. Test: Task 3, `rifiuta un gzip valido senza marcatore finale`.
3. **Restore di prova che fallisce a metà** (istruzione SQL rotta dentro un dump con marcatore): attesi esito non zero **e** database temporaneo eliminato comunque. Test: Task 3, `ripristino fallito: il database temporaneo viene eliminato` (contro il PostgreSQL del job `test-postgres`).
4. **Backup pre-deploy impossibile** (container `postgres` fermo, disco pieno): atteso che `prisma migrate deploy` non parta. Test: Task 3, `predeploy: esce non zero se il dump fallisce` (con `PG_EXEC=false`); Task 4, `il deploy esegue il backup prima delle migration`.
5. **Registrazione alle 00:30 del 1° gennaio con il processo in UTC** (`2025-12-31T23:30:00Z`): atteso progressivo dell'anno 2026 e lock `<tenant>-2026`; alle `2025-12-31T22:59:59.999Z` resta 2025. Test: Task 5, `attribuisce al 2026 un movimento registrato alle 00:30 del 1° gennaio, anche con il processo in UTC`.

---

## File Structure

| File | Responsabilità |
|---|---|
| `apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts` (nuovo) | Guardiano: variabili lette dal codice ↔ compose, `TZ`, rotazione log, ordine backup/migration nel deploy. Contiene il parser a righe del compose e l'elenco `NON_PASSATE`. |
| `docker-compose.prod.yml` (modifica) | Nuove variabili del backend, `TZ`, ancora `x-logging` su tutti i servizi |
| `apps/backend/src/core/filters/http-exception.filter.ts` (modifica) + `.spec.ts` (nuovo) | Invio a Bugsink dei 5xx |
| `apps/backend/src/main.ts:15-23` (modifica) | `Sentry.init` senza tracing |
| `ops/lib/backup-verifica.sh` (nuovo) | Funzioni bash: lettura `.env`, verifica di completezza, restore di prova, notifica |
| `ops/test/backup-verifica.test.sh` (nuovo) | Test bash della libreria (senza DB, e con DB se `PG_EXEC` è impostata) |
| `ops/backup-offsite.sh` (modifica) | Modalità `notturno`/`predeploy`, file `.parziale`, verifica, restore di prova, mail, rotazione |
| `ops/README.md` (modifica) | Cron corretto, verifica dei backup, Bugsink |
| `.gitea/workflows/ci.yml`, `.gitea/workflows/deploy.yml` (modifica) | Test bash nei gate; backup prima delle migration; smoke su `/api/v1/health` |
| `apps/backend/src/core/time/anno-italiano.ts` (nuovo) + `.spec.ts` | `annoSolareItaliano(istante: Date): number` |
| `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts:129` (modifica) + spec | Anno del progressivo nel fuso italiano |
| `apps/backend/Dockerfile.prod:33` (modifica) | `tzdata` nell'immagine runtime |

---

### Task 1: guardiano delle variabili d'ambiente e variabili mancanti nel compose

**Files:**
- Create: `apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts`
- Modify: `docker-compose.prod.yml:56-119` (blocco `environment:` del backend)

**Interfaces:**
- Produces (funzioni locali al file di spec, riusate dai Task 4, 5 e 6 nello stesso file):
  - `RADICE_REPO = path.resolve(__dirname, '../../../../..')`, `SRC_BACKEND = path.resolve(__dirname, '../..')`
  - `leggiFile(relativo: string): string` (relativo alla radice del repo; normalizza `\r\n` in `\n`, perché su Windows il checkout può avere CRLF e le regex dei Task 4 e 6 cercano `\n`)
  - `ambienteServizio(compose: string, servizio: string): Map<string, string>` — chiave → valore grezzo (es. `'${SENTRY_DSN:-}'`) del blocco `environment:` del servizio. Lancia un errore se il servizio o il blocco non si trovano, o se il blocco è in forma lista (`- KEY=val`).
  - `bloccoServizio(compose: string, servizio: string): string[]` — righe del servizio (indentazione 2 → fino al servizio successivo)
  - `variabiliLetteDalCodice(): Map<string, string[]>` — nome → file che la leggono
  - `variabiliConDefaultNelCodice(): Set<string>`
  - `NON_PASSATE: Record<string, string>` — nome → motivo

- [ ] **Step 1: scrivere il test guardiano (parte variabili)**

Algoritmi che test e firma non determinano:
- `variabiliLetteDalCodice`: visita ricorsiva di `SRC_BACKEND`, solo `*.ts` che **non** finiscono in `.spec.ts`. Raccoglie i nomi da `/\.(?:get|getOrThrow)\s*(?:<[^>()]*>)?\(\s*['"`]([A-Z][A-Z0-9_]+)['"`]/g` e da `/process\.env(?:\.([A-Z][A-Z0-9_]+)|\[\s*['"`]([A-Z][A-Z0-9_]+)['"`]\s*\])/g`. Aggiunge `DATABASE_URL` se `apps/backend/prisma/schema.prisma` contiene `env("DATABASE_URL")`.
- `variabiliConDefaultNelCodice`: stessa visita, regex `/\.get\s*(?:<[^>()]*>)?\(\s*['"`]([A-Z][A-Z0-9_]+)['"`]\s*,/g`.
- `ambienteServizio`: trova la riga `^  <servizio>:$`, poi la riga `^    environment:$` dentro il servizio, poi raccoglie le righe `^      ([A-Z][A-Z0-9_]*):\s*(.*)$` saltando commenti e righe vuote, fino alla prima riga con indentazione ≤ 4. Toglie le virgolette esterne dal valore.

```ts
const NON_PASSATE: Record<string, string> = {
  API_PREFIX: "l'nginx del frontend e l'healthcheck dell'immagine presuppongono api/v1",
  CURRENT_TENANT_ID: 'solo job CLI e test (tenant-context.ts)',
  HOSTNAME: 'la imposta Docker',
  JWT_ACCESS_TOKEN_EXPIRATION: 'default nel codice (15m); passata vuota lo scavalcherebbe',
  JWT_REFRESH_TOKEN_EXPIRATION: 'default nel codice; passata vuota lo scavalcherebbe',
  JWT_AUDIENCE: 'default nel codice (wasteflow-api)',
  JWT_ISSUER: 'default nel codice (wasteflow.it)',
  REDIS_DB: 'default 0',
  REDIS_MODE: 'Redis standalone in produzione',
  REFDATA_SEED_ON_BOOT: 'default: seed se vuoto',
  SWAGGER_ENABLED: 'spento in produzione di proposito, si accende solo per diagnosi',
  SPID_STRICT_LEVEL_CHECK: 'Keycloak non è un IdP SPID: il controllo stretto bloccherebbe il login',
  SPID_ENTRY_POINT: 'alias di SPID_IDP_ENTRY_POINT, già passata',
  SPID_ISSUER: 'alias di SPID_ENTITY_ID, già passata',
  SPID_PRIVATE_KEY: 'richieste SAML verso Keycloak non firmate',
  SPID_PUBLIC_CERT: 'richieste SAML verso Keycloak non firmate',
  SAML_CALLBACK_URL: 'KeycloakSamlStrategy non registrata in alcun modulo',
  SAML_CERT: 'KeycloakSamlStrategy non registrata in alcun modulo',
  SAML_ISSUER: 'KeycloakSamlStrategy non registrata in alcun modulo',
  QES_QTSP_ENDPOINT: 'nessun contratto QTSP: da passare con SIGNATURE_PROVIDER=qes',
  QES_CLIENT_CERT: 'nessun contratto QTSP: da passare con SIGNATURE_PROVIDER=qes',
  QES_CLIENT_KEY: 'nessun contratto QTSP: da passare con SIGNATURE_PROVIDER=qes',
  TSA_URL: 'nessuna TSA accreditata: da passare con TSA_PROVIDER=rfc3161',
  STRIPE_SECRET_KEY: 'billing non attivo in produzione',
  STRIPE_WEBHOOK_SECRET: 'billing non attivo in produzione',
  STRIPE_PRICE_ID_PROFESSIONAL: 'billing non attivo in produzione',
  STRIPE_PRICE_ID_ENTERPRISE: 'billing non attivo in produzione',
  RENTRI_API_URL: "oggi vale il default demo; il passaggio all'ente reale è una decisione",
  // …stessa voce per RENTRI_AUDIENCE, RENTRI_CERTIFICATE_PEM, RENTRI_CLIENT_ID,
  // RENTRI_JWT_ALG, RENTRI_JWT_TTL_SECONDS, RENTRI_PRIVATE_KEY_PEM,
  // RENTRI_SIGNATURE_AUDIENCE, RENTRI_SYNC_CONCURRENCY
}

describe('docker-compose.prod.yml: variabili del backend', () => {
  const env = ambienteServizio(leggiFile('docker-compose.prod.yml'), 'backend')
  it('passa al container ogni variabile letta dal codice, o ne dichiara il motivo', () => {
    // mancanti = lette dal codice, assenti dal compose e da NON_PASSATE
    // expect(mancanti).toEqual([]) — il messaggio elenca "NOME (file1, file2)"
  })
  it('NON_PASSATE non contiene variabili già nel compose né variabili che il codice non legge più', () => {})
  it('non passa nuda una variabile che il codice legge con un default', () => {
    // per ogni nome in variabiliConDefaultNelCodice() presente nel compose:
    // il valore non deve essere esattamente `${NOME}` (serve `${NOME:-…}`, `${NOME:?…}` o un letterale)
  })
  it('passa SENTRY_DSN e APP_VERSION', () => {
    expect(env.get('SENTRY_DSN')).toBe('${SENTRY_DSN:-}')
    expect(env.get('APP_VERSION')).toBe('${TAG:-latest}')
  })
  it('rende obbligatoria PERMISSION_CACHE_HMAC_SECRET', () => {
    expect(env.get('PERMISSION_CACHE_HMAC_SECRET')).toMatch(/^\$\{PERMISSION_CACHE_HMAC_SECRET:\?/)
  })
})
```

- [ ] **Step 2: eseguire e vederlo fallire**

Run: `cd apps/backend && npx jest --runInBand src/core/config/infrastruttura-prod.guard.spec.ts`
Expected: FAIL. Il primo test elenca almeno `SENTRY_DSN (src/main.ts, …)`, `APP_VERSION`, `PUBLIC_URL`, `PERMISSION_CACHE_HMAC_SECRET`, `LOG_LEVEL`.

- [ ] **Step 3: aggiungere le variabili al blocco `environment:` del backend**, dopo `DEFAULT_TENANT_ID`, ciascuna con un commento di una riga sul perché:

```yaml
      # Error tracking (Bugsink, progetto wasteflow). Vuota = SDK spento.
      SENTRY_DSN: ${SENTRY_DSN:-}
      # Release su Bugsink e nella pagina "Stato del sistema": il tag dell'immagine.
      APP_VERSION: ${TAG:-latest}
      # Base dei link nelle mail di notifica (senza: https://wasteflow.app).
      PUBLIC_URL: ${PUBLIC_URL:-https://rifiuti.ignicraft.com}
      # Firma HMAC della cache permessi: senza, il codice usa 'change-me-in-production'.
      PERMISSION_CACHE_HMAC_SECRET: ${PERMISSION_CACHE_HMAC_SECRET:?PERMISSION_CACHE_HMAC_SECRET richiesta}
      LOG_LEVEL: ${LOG_LEVEL:-info}
```

Sopra il blocco, un commento che rimanda al guardiano: "ogni variabile letta dal codice deve stare qui o in `NON_PASSATE` di `infrastruttura-prod.guard.spec.ts`".

- [ ] **Step 4: eseguire e vederlo passare**

Run: `cd apps/backend && npx jest --runInBand src/core/config/infrastruttura-prod.guard.spec.ts`
Expected: PASS (5 test). Il terzo test passa già sulle voci esistenti: le variabili lette con un default (`NODE_ENV`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_CLUSTER_NODES`, `PERMISSION_CACHE_HMAC_SECRET`) sono nel compose come letterali o con `:-`/`:?`. Se il primo test segnala una variabile non prevista dalle tabelle sopra, classificarla (compose o `NON_PASSATE` con motivo) e annotarla nel rapporto finale.

- [ ] **Step 5: verificare che il compose resti valido**

Run (dalla radice, Docker in WSL acceso):
`DB_PASSWORD=x REDIS_PASSWORD=x JWT_SECRET=x JWT_REFRESH_SECRET=x RENTRI_CREDENTIAL_ENC_KEY=x SIGNATURE_PROVIDER=sandbox TSA_PROVIDER=mock PERMISSION_CACHE_HMAC_SECRET=x docker compose -p rifiuti-verifica -f docker-compose.prod.yml config -q`
Expected: exit 0, nessun output. Rifarlo senza `PERMISSION_CACHE_HMAC_SECRET=x`: atteso errore `PERMISSION_CACHE_HMAC_SECRET richiesta`.

- [ ] **Step 6: lint e commit**

Run: `cd apps/backend && npx eslint src/core/config/infrastruttura-prod.guard.spec.ts` → zero errori.

```bash
git add apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts docker-compose.prod.yml
git commit -m "fix(ops): il compose passa SENTRY_DSN e le variabili mancanti, con un test che lo impone"
```

---

### Task 2: i 5xx arrivano a Bugsink

**Files:**
- Modify: `apps/backend/src/core/filters/http-exception.filter.ts` (dopo il blocco "Log the error", prima della risposta)
- Create: `apps/backend/src/core/filters/http-exception.filter.spec.ts`
- Modify: `apps/backend/src/main.ts:15-23`
- Modify: `ops/README.md`, sezione "Error tracking (Bugsink)"

**Interfaces:**
- Consumes: `SENTRY_DSN`, `APP_VERSION` nel container (Task 1).
- Produces: nessuna interfaccia nuova. Il filtro chiama `Sentry.captureException(exception, { tags: { correlationId, statusCode: String(statusCode) }, user: userId ? { id: userId } : undefined, extra: { tenantId, path: request.url, method: request.method } })`.

- [ ] **Step 1: scrivere il test del filtro**

`jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))`. Costruire il filtro con un `LoggerService` finto (`setContext`, `error`) e un `ArgumentsHost` finto (`switchToHttp().getRequest()` con `method`, `url`, `correlationId: 'corr-1'`, `tenantId: 't-1'`, `user: { userId: 'u-1' }`; `getResponse()` con `status().json()` concatenabili).

```ts
it('invia a Bugsink un errore imprevisto (500)', () => {
  filter.catch(new Error('boom'), host)
  expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({
      tags: { correlationId: 'corr-1', statusCode: '500' },
      user: { id: 'u-1' },
    })
  )
})
it('invia a Bugsink una HttpException 503', () => { /* new ServiceUnavailableException() → 1 chiamata */ })
it('non invia a Bugsink i 4xx', () => {
  filter.catch(new NotFoundException(), host)
  filter.catch(new BadRequestException('x'), host)
  expect(Sentry.captureException).not.toHaveBeenCalled()
})
it('risponde al client come prima anche se Sentry lancia', () => {
  ;(Sentry.captureException as jest.Mock).mockImplementationOnce(() => { throw new Error('rete') })
  filter.catch(new Error('boom'), host)
  expect(response.status).toHaveBeenCalledWith(500)
})
```

- [ ] **Step 2: eseguire e vederlo fallire**

Run: `cd apps/backend && npx jest --runInBand src/core/filters/http-exception.filter.spec.ts`
Expected: FAIL su `invia a Bugsink un errore imprevisto (500)` e sul 503 (`captureException` mai chiamata).

- [ ] **Step 3: implementare nel filtro** `import * as Sentry from '@sentry/node'` e, se `statusCode >= 500`, la chiamata descritta in Interfaces dentro `try { … } catch { /* Bugsink irraggiungibile: la risposta al client non deve cambiare */ }`. Commento: senza un DSN l'SDK non è inizializzato e la chiamata non fa nulla.

- [ ] **Step 4: in `main.ts` togliere `tracesSampleRate: 1.0`** e il commento sul campionamento; al suo posto il commento della decisione 5 (Bugsink raccoglie errori, non transaction). Restano `dsn`, `environment`, `release`.

- [ ] **Step 5: eseguire e vederlo passare**

Run: `cd apps/backend && npx jest --runInBand src/core/filters/http-exception.filter.spec.ts`
Expected: PASS (4 test).

- [ ] **Step 6: aggiornare `ops/README.md`, sezione Bugsink**: la variabile ora arriva al container perché è nel compose (prima no, come le SMTP); va **ricreato** il backend (`up -d backend`, non `restart`); si inviano solo i 5xx; il progetto si crea con `docker exec bugsink bugsink-manage shell` (`from projects.models import Project`), chiave senza trattini; prova d'invio come nel passo 7.4.

- [ ] **Step 7: lint e commit**

Run: `cd apps/backend && npx eslint src/core/filters/http-exception.filter.ts src/core/filters/http-exception.filter.spec.ts src/main.ts` → zero errori.

```bash
git add apps/backend/src/core/filters/http-exception.filter.ts apps/backend/src/core/filters/http-exception.filter.spec.ts apps/backend/src/main.ts ops/README.md
git commit -m "fix(ops): gli errori 5xx del backend arrivano a Bugsink"
```

---

### Task 3: backup verificato (marcatore, restore di prova, allarme)

**Files:**
- Create: `ops/lib/backup-verifica.sh`
- Create: `ops/test/backup-verifica.test.sh`
- Modify: `ops/backup-offsite.sh` (intero flusso, righe 21-117)
- Modify: `.gitea/workflows/ci.yml` (job `backend` dopo "Test (Jest + coverage)"; job `test-postgres` dopo "Test integrazione Postgres")
- Modify: `.gitea/workflows/deploy.yml` (job `quality`, dopo "Test unitari backend")
- Modify: `ops/README.md`, sezione "Backup off-site"

**Interfaces:**
- Produces (`ops/lib/backup-verifica.sh`, da usare con `source`; nessuna funzione chiama `exit`):
  - `MARCATORE_DUMP='-- PostgreSQL database dump complete'`
  - `leggi_env FILE CHIAVE [DEFAULT]` → stampa il valore dell'ultima riga `^CHIAVE=` del file, senza virgolette esterne; stampa `DEFAULT` se manca. Non esegue nulla del file.
  - `pg_exec ARGS…` → esegue `$PG_EXEC ARGS…` (word splitting voluto: `PG_EXEC` è un prefisso di comando, es. `docker compose -p rifiuti … exec -T postgres` oppure `docker exec -i -e PGPORT=55432 postgres-ci-123`).
  - `verifica_completezza_dump FILE` → 0 se `gzip -t` passa **e** una delle ultime 20 righe decompresse è `MARCATORE_DUMP`; altrimenti 1 con il motivo su stderr (`file vuoto`, `gzip corrotto`, `marcatore finale assente: dump troncato`).
  - `ripristino_di_prova FILE DB_USER DB_SORGENTE` → crea `wasteflow_verifica_<epoch>_<pid>`, ripristina con `psql -v ON_ERROR_STOP=1 -q`, confronta, **elimina sempre** il DB temporaneo (`DROP DATABASE IF EXISTS … WITH (FORCE)`), ritorna 0 solo se ripristino e confronti sono riusciti. Confronti: numero di tabelle in `public` uguale fra sorgente e copia; righe di `_prisma_migrations` uguali; righe di `waste_movements` della copia ≤ sorgente e > 0 se la sorgente ne ha (la sorgente può aver ricevuto scritture dopo il dump).
  - `notifica_fallimento OGGETTO TESTO` → se `msmtp` esiste, invia `Subject: OGGETTO` a `${BACKUP_ALERT_EMAIL:-root}` (sul VPS `root` è inoltrato a Gmail via `/etc/aliases`); altrimenti scrive su stderr. Ritorna sempre 0.
- Produces (`ops/backup-offsite.sh`): variabili d'ingresso `BACKUP_MODALITA=notturno|predeploy` (default `notturno`), `WASTEFLOW_ENV_FILE` (default `/opt/rifiuti/.env`), `WASTEFLOW_COMPOSE_FILE` (default `/opt/rifiuti/site/docker-compose.prod.yml`), `BACKUP_STAGING_DIR` (default `/opt/rifiuti/backups`), `PG_EXEC` (default `docker compose -p rifiuti --env-file $WASTEFLOW_ENV_FILE -f $WASTEFLOW_COMPOSE_FILE exec -T postgres`). Nomi `WASTEFLOW_*` e non `COMPOSE_FILE`: `COMPOSE_FILE` è letta anche da `docker compose`. Exit 0 solo con un file verificato al nome finale.

- [ ] **Step 1: scrivere `ops/test/backup-verifica.test.sh`**

Struttura: `set -uo pipefail` (niente `-e`), cartella temporanea con `mktemp -d` e `trap` di pulizia, `source` della libreria, una funzione `verifica NOME ESITO_ATTESO COMANDO…` che conta riusciti/falliti e stampa `OK`/`FALLITO: NOME`. Alla fine `echo "Test riusciti: N, falliti: M"` ed exit 1 se `M > 0`.

Fixture costruite nel test: `completo.sql.gz` (alcune righe SQL + `MARCATORE_DUMP` + una riga vuota, gzip), `troncato.sql.gz` (le stesse righe **senza** marcatore, gzip valido), `corrotto.sql.gz` (i primi 20 byte di `completo.sql.gz`), `vuoto.sql.gz` (file di 0 byte).

Test senza database (sempre):
- `accetta un dump completo` → 0
- `rifiuta un gzip valido senza marcatore finale` → 1
- `rifiuta un gzip corrotto` → 1
- `rifiuta un file vuoto` → 1
- `leggi_env legge il valore e toglie le virgolette` (file con `DB_NAME="wf_prod"` → `wf_prod`)
- `leggi_env usa l'ultima occorrenza e il default` (due righe `DB_USER=`; chiave assente → default)
- `leggi_env non esegue il file` (riga `X=$(touch $TMP/eseguito)` → il file `eseguito` non esiste)
- `predeploy: esce non zero se il dump fallisce`: `PG_EXEC=false BACKUP_MODALITA=predeploy WASTEFLOW_ENV_FILE=<.env finto> BACKUP_STAGING_DIR=$TMP/staging bash ops/backup-offsite.sh` → esito ≠ 0, e in `$TMP/staging` nessun `*.sql.gz` al nome finale.

Test con database (solo se `PG_EXEC` è impostata; altrimenti stampa `salto i test con PostgreSQL: PG_EXEC non impostata`), con `DB_USER=${PG_TEST_USER:-wasteflow}` e `DB=${PG_TEST_DB:-wasteflow_ci}`:
- `dump reale completo e ripristino di prova riuscito`: `pg_exec pg_dump -U $DB_USER $DB | gzip > reale.sql.gz`, poi `verifica_completezza_dump` → 0 e `ripristino_di_prova reale.sql.gz $DB_USER $DB` → 0.
- `ripristino fallito: il database temporaneo viene eliminato`: copia di `reale.sql.gz` con una riga `SELECT * FROM tabella_che_non_esiste;` inserita prima del marcatore → `ripristino_di_prova` → 1, e `pg_exec psql -U $DB_USER -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'wasteflow_verifica_%'"` → `0`.
- `notturno con PG_EXEC reale produce un file verificato`: `BACKUP_MODALITA=notturno OFFSITE_MODE=disabled BACKUP_ALERT_EMAIL=nessuno` con `.env` finto che punta a `$DB` → exit 0, un `wasteflow_<DB>_*.sql.gz` in staging, nessun `.parziale`.

- [ ] **Step 2: eseguire e vederlo fallire**

Run: `bash ops/test/backup-verifica.test.sh`
Expected: errore su `source`: `ops/lib/backup-verifica.sh` non esiste.

- [ ] **Step 3: implementare `ops/lib/backup-verifica.sh`** secondo le Interfaces. In `ripristino_di_prova` ogni passo è controllato con `if`; il `DROP` gira in ogni caso, anche dopo un fallimento, e il suo errore viene solo registrato. Commento in testa: niente `set -e` qui, per la lezione Gitea del 16/09.

- [ ] **Step 4: riscrivere `ops/backup-offsite.sh`** con questo flusso:
  1. `set -euo pipefail`; `source "$(dirname "$0")/lib/backup-verifica.sh"`.
  2. `DB_NAME`/`DB_USER` da `leggi_env` (default `wasteflow_prod`/`wasteflow`); togliere `DB_PASSWORD` obbligatoria e ogni `source` del `.env`. `OFFSITE_MODE`, `RSYNC_TARGET`, `RSYNC_SSH_KEY`, `RCLONE_REMOTE`, `ENCRYPT_BACKUP`, `AGE_RECIPIENT`, `BACKUP_RETENTION_DAYS`, `BACKUP_ALERT_EMAIL` dall'ambiente se impostati, altrimenti da `leggi_env`.
  3. Prefisso del file: `wasteflow_${DB_NAME}_` di notte, `wasteflow_predeploy_${DB_NAME}_` prima del deploy. Il dump si scrive in `<nome>.sql.gz.parziale`.
  4. `pg_exec pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$parziale"`.
  5. `verifica_completezza_dump`; se fallisce, rinominare in `.scartato` e uscire con 1.
  6. Solo in `notturno`: `ripristino_di_prova "$parziale" "$DB_USER" "$DB_NAME"`; se fallisce, rinominare in `.scartato` e uscire con 1.
  7. `mv` del `.parziale` al nome finale. Poi cifratura e copia off-site come oggi; in `predeploy` copia off-site sempre saltata.
  8. Rotazione: in `notturno` `find … -name "wasteflow_${DB_NAME}_*.sql.gz" -o -name "wasteflow_${DB_NAME}_*.sql.gz.age"` più vecchi di `RETENTION_DAYS`, più i `.scartato` oltre 7 giorni; in `predeploy` tenere i 10 `wasteflow_predeploy_*` più recenti.
  9. `trap` su `ERR` ed `EXIT` con esito ≠ 0: in `notturno` chiama `notifica_fallimento "ATTENZIONE backup WasteFlow fallito" "<ultime righe del log, host, modalità, file>"`; in `predeploy` niente mail, lo segnala il job di deploy.
  10. Ultima riga di log: `Backup verificato: <file> (<dimensione>)`.

  Aggiornare l'intestazione: uso manuale `bash /opt/rifiuti/site/ops/backup-offsite.sh`; il cron come nel passo 7.5.

- [ ] **Step 5: eseguire i test senza database e vederli passare**

Run: `bash ops/test/backup-verifica.test.sh`
Expected: `salto i test con PostgreSQL…`, poi `Test riusciti: 8, falliti: 0`, exit 0. Su Windows va eseguito in Git Bash (servono `gzip` e `mktemp`).

- [ ] **Step 6: eseguire i test con database contro un PostgreSQL locale**

Run (Docker in WSL acceso):
```bash
docker run -d --rm --name pg-backup-prova -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=x -e POSTGRES_DB=wasteflow_ci postgres:16-alpine
# attendere che pg_isready risponda, poi creare due tabelle e _prisma_migrations con una riga ciascuna
PG_EXEC="docker exec -i pg-backup-prova" bash ops/test/backup-verifica.test.sh
docker rm -f pg-backup-prova
```
Expected: `Test riusciti: 11, falliti: 0`.

- [ ] **Step 7: collegare i test ai workflow**
  - `ci.yml`, job `backend`: passo `Test script di backup (bash)` con `working-directory: ${{ github.workspace }}` e `run: bash ops/test/backup-verifica.test.sh`.
  - `ci.yml`, job `test-postgres`: passo `Test backup e ripristino di prova (PostgreSQL reale)` con `working-directory: ${{ github.workspace }}`, `env: PG_EXEC: "docker exec -i -e PGPORT=55432 ${{ env.POSTGRES_CI_CONTAINER }}"` e lo stesso `run`. `PGPORT` serve perché nel job Postgres ascolta sulla 55432 anche dentro il container (`-c port=55432`).
  - `deploy.yml`, job `quality`: lo stesso passo del job `backend` (senza DB), così una libreria rotta blocca il rilascio.

  Verifica sintattica: `npx js-yaml .gitea/workflows/ci.yml > /dev/null && npx js-yaml .gitea/workflows/deploy.yml > /dev/null` → exit 0.

- [ ] **Step 8: aggiornare `ops/README.md`, sezione Backup**: cron senza `source`; verifica e restore di prova; file `.parziale`/`.scartato`; mail a `root`; modalità `predeploy`; `OFFSITE_MODE=disabled` finché la destinazione off-site non è decisa. Dire che `scripts/backup.sh` (percorsi `/opt/wasteflow`) **non** è lo script in uso.

- [ ] **Step 9: commit**

```bash
git add ops/lib/backup-verifica.sh ops/test/backup-verifica.test.sh ops/backup-offsite.sh ops/README.md .gitea/workflows/ci.yml .gitea/workflows/deploy.yml
git commit -m "feat(ops): backup accettato solo con dump completo e ripristino di prova, mail se fallisce"
```

---

### Task 4: backup prima delle migration e smoke test sul backend

**Files:**
- Modify: `.gitea/workflows/deploy.yml:272-288` (script SSH del job `deploy`)
- Modify: `apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts` (nuovo `describe`)

**Interfaces:**
- Consumes: `ops/backup-offsite.sh` con `BACKUP_MODALITA=predeploy`, `WASTEFLOW_COMPOSE_FILE` (Task 3); `leggiFile` (Task 1).

- [ ] **Step 1: scrivere i test nel guardiano**

```ts
describe('deploy.yml: rilascio in produzione', () => {
  const deploy = leggiFile('.gitea/workflows/deploy.yml')
  const BACKUP = 'BACKUP_MODALITA=predeploy WASTEFLOW_COMPOSE_FILE="$PWD/docker-compose.prod.yml" bash ops/backup-offsite.sh'
  it('il deploy esegue il backup prima delle migration', () => {
    const iReset = deploy.indexOf('git reset --hard origin/master')
    const iBackup = deploy.indexOf(BACKUP)
    const iMigrate = deploy.indexOf('npx prisma migrate deploy')
    expect(iReset).toBeGreaterThan(-1)
    expect(iBackup).toBeGreaterThan(iReset)
    expect(iMigrate).toBeGreaterThan(iBackup)
  })
  it('un passo fallito ferma lo script remoto', () => {
    expect(deploy).toContain('script_stop: true')
    expect(deploy).toMatch(/script: \|\n\s+set -e\n/)
  })
  it('lo smoke test interroga anche /api/v1/health', () => {
    expect(deploy).toContain('http://127.0.0.1:3017/api/v1/health')
  })
})
```

- [ ] **Step 2: eseguire e vederlo fallire**

Run: `cd apps/backend && npx jest --runInBand src/core/config/infrastruttura-prod.guard.spec.ts -t "deploy.yml"`
Expected: FAIL su `il deploy esegue il backup prima delle migration` e su `/api/v1/health`.

- [ ] **Step 3: modificare lo script SSH** di `deploy.yml`:
  - dopo `$COMPOSE pull`, la riga `BACKUP` esatta del test, preceduta dal commento: backup verificato prima delle migration (forward-only); se fallisce `set -e` ferma tutto e la produzione resta sulla versione precedente;
  - lasciare invariata la riga della migration;
  - sostituire `sleep 12` e il `curl` finale con un ciclo di 30 tentativi a 3 secondi che esce con successo solo quando rispondono **sia** `curl -fsS http://127.0.0.1:3017/api/v1/health` **sia** `curl -fsS http://127.0.0.1:3017/`. Al fallimento: `$COMPOSE ps`, `$COMPOSE logs --since 5m backend` (non `--tail`: su questo VPS `--tail` può restare appeso) ed `exit 1`.

- [ ] **Step 4: eseguire e vederlo passare**

Run: `cd apps/backend && npx jest --runInBand src/core/config/infrastruttura-prod.guard.spec.ts`
Expected: PASS su tutti i `describe` del file.

Run: `npx js-yaml .gitea/workflows/deploy.yml > /dev/null` → exit 0.

- [ ] **Step 5: commit**

```bash
git add .gitea/workflows/deploy.yml apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts
git commit -m "fix(ops): il deploy fa un backup verificato prima delle migration e controlla /api/v1/health"
```

---

### Task 5: fuso orario italiano (anno del registro)

**Perché:** il progressivo del registro di carico e scarico riparte ogni anno, e il MUD si dichiara per anno solare italiano. Con il processo in UTC (oggi: nessun `TZ` nel compose, nessun `tzdata` nell'immagine), una registrazione fra le 00:00 e l'01:00 del 1° gennaio finisce nella numerazione dell'anno prima, e il registro di quell'anno guadagna un movimento che non gli appartiene.

**Files:**
- Create: `apps/backend/src/core/time/anno-italiano.ts`, `apps/backend/src/core/time/anno-italiano.spec.ts`
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts:129`
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.spec.ts` (nuovo `describe` in fondo)
- Modify: `docker-compose.prod.yml` (backend: `TZ: Europe/Rome`)
- Modify: `apps/backend/Dockerfile.prod:33` (`apk add --no-cache dumb-init openssl libc6-compat tzdata`)
- Modify: `apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts`

**Interfaces:**
- Produces: `export function annoSolareItaliano(istante: Date): number` — anno solare italiano dell'istante, indipendente dal fuso del processo. Corpo: `new Date(istante.getTime() + 60 * 60 * 1000).getUTCFullYear()`, con il commento della decisione 9.

- [ ] **Step 1: scrivere i test**

`anno-italiano.spec.ts`:
```ts
it.each([
  ['2025-12-31T22:59:59.999Z', 2025], // 23:59:59 del 31/12 in Italia
  ['2025-12-31T23:00:00.000Z', 2026], // mezzanotte del 1/1 in Italia
  ['2025-12-31T23:30:00.000Z', 2026],
  ['2026-07-01T10:00:00.000Z', 2026], // ora legale: nessun effetto a metà anno
  ['2026-12-31T22:59:59.999Z', 2026],
])('annoSolareItaliano(%s) = %i', (iso, anno) => {
  expect(annoSolareItaliano(new Date(iso))).toBe(anno)
})
```

Nel guardiano:
```ts
it('il backend gira in Europe/Rome e PostgreSQL no', () => {
  const compose = leggiFile('docker-compose.prod.yml')
  expect(ambienteServizio(compose, 'backend').get('TZ')).toBe('Europe/Rome')
  expect(ambienteServizio(compose, 'postgres').has('TZ')).toBe(false)
})
it("l'immagine runtime del backend installa tzdata", () => {
  // nell'ultimo stage di apps/backend/Dockerfile.prod (dopo l'ultimo FROM) c'è una riga `apk add` con `tzdata`
})
```

In `registra-movimento.use-case.spec.ts`, `describe('anno del progressivo nel fuso italiano')`: in `beforeAll` salvare `process.env.TZ` e impostarlo a `'UTC'`, in `afterAll` ripristinarlo. Con il mock di transazione del test "assegna progressivo 1" (catturando `args.data` di `wasteMovement.create` e gli argomenti di `$executeRaw`) e un comando con `registrationDate` e `movementDate` uguali:
- `attribuisce al 2026 un movimento registrato alle 00:30 del 1° gennaio, anche con il processo in UTC`: `2025-12-31T23:30:00.000Z` → `capturedData.progressiveYear === 2026` e la chiave del lock contiene `${TENANT}-2026`;
- `lascia al 2025 un movimento registrato alle 23:59 del 31 dicembre`: `2025-12-31T22:59:59.999Z` → `2025`.

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/core/time/anno-italiano.spec.ts src/application/registro/use-cases/registra-movimento.use-case.spec.ts src/core/config/infrastruttura-prod.guard.spec.ts`
Expected: FAIL. `anno-italiano` non esiste; il caso 00:30 dà `2025`; mancano `TZ` e `tzdata`.

- [ ] **Step 3: implementare**
  - `anno-italiano.ts` come in Interfaces;
  - `registra-movimento.use-case.ts:129`: `const anno = annoSolareItaliano(command.registrationDate)`, con un commento che rimanda al fuso italiano;
  - compose, backend: `TZ: Europe/Rome` con il commento "anno di registro e MUD nel fuso italiano; MAI su postgres: `@default(now())` scrive timestamp senza fuso";
  - `Dockerfile.prod:33`: aggiungere `tzdata`.

- [ ] **Step 4: eseguire e vederli passare**

Run: lo stesso comando dello Step 2.
Expected: PASS, compresi i test già esistenti di `registra-movimento.use-case.spec.ts`.

- [ ] **Step 5: verificare che Node nell'immagine onori `TZ`** (senza buildare l'immagine)

Run: `docker run --rm -e TZ=Europe/Rome node:20-alpine node -e "console.log(new Date('2025-12-31T23:30:00Z').getFullYear(), Intl.DateTimeFormat().resolvedOptions().timeZone)"`
Expected: `2026 Europe/Rome`. Con `tzdata` aggiunto il risultato non cambia: il pacchetto serve a `date` e agli strumenti di sistema nel container.

- [ ] **Step 6: lint e commit**

Run: `cd apps/backend && npx eslint src/core/time/anno-italiano.ts src/core/time/anno-italiano.spec.ts src/application/registro/use-cases/registra-movimento.use-case.ts` → zero errori.

```bash
git add apps/backend/src/core/time apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts apps/backend/src/application/registro/use-cases/registra-movimento.use-case.spec.ts docker-compose.prod.yml apps/backend/Dockerfile.prod apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts
git commit -m "fix(registro): anno del progressivo nel fuso italiano e TZ=Europe/Rome sul backend"
```

---

### Task 6: rotazione dei log dei container

**Files:**
- Modify: `docker-compose.prod.yml` (blocco `x-logging` in testa, `logging: *logging` su `postgres`, `redis`, `backend`, `frontend`)
- Modify: `apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts`

**Interfaces:**
- Consumes: `bloccoServizio`, `leggiFile` (Task 1).

- [ ] **Step 1: scrivere il test nel guardiano**

```ts
describe('docker-compose.prod.yml: log', () => {
  const compose = leggiFile('docker-compose.prod.yml')
  it('definisce una rotazione json-file da 50m x 3', () => {
    expect(compose).toMatch(/^x-logging: &logging\n  driver: json-file\n  options:\n    max-size: "50m"\n    max-file: "3"$/m)
  })
  it.each(['postgres', 'redis', 'backend', 'frontend'])('%s usa la rotazione comune', servizio => {
    expect(bloccoServizio(compose, servizio)).toContain('    logging: *logging')
  })
})
```

- [ ] **Step 2: eseguire e vederlo fallire**

Run: `cd apps/backend && npx jest --runInBand src/core/config/infrastruttura-prod.guard.spec.ts -t "log"`
Expected: FAIL (5 test).

- [ ] **Step 3: aggiungere a `docker-compose.prod.yml`**, sopra `services:`, il blocco esatto del test con un commento: senza `max-size` i log json-file crescono senza limite (plausible e cadvisor erano arrivati a 5-6 GB); mai logrotate/`copytruncate`, che blocca `docker logs --tail`. Il primo `up -d` dopo questa modifica ricrea anche postgres e redis. Poi `logging: *logging` in ogni servizio, dopo `restart: always`.

- [ ] **Step 4: eseguire e vederlo passare; compose ancora valido**

Run: `cd apps/backend && npx jest --runInBand src/core/config/infrastruttura-prod.guard.spec.ts` → PASS.
Run: il comando `docker compose … config -q` del Task 1 Step 5 → exit 0. Poi lo stesso con `config --format json | grep -c '"max-size": "50m"'` → `4`.

- [ ] **Step 5: commit**

```bash
git add docker-compose.prod.yml apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts
git commit -m "fix(ops): rotazione dei log json-file per tutti i servizi di produzione"
```

---

### Task 7: attività sul server (manuali)

**Ogni passo di questo task è [SERVER — serve l'approvazione di Graziano].** Va eseguito solo dopo un suo via libera esplicito, passo per passo, con lo stato registrato prima e dopo. Il VPS è condiviso fra nove stack: solo interventi additivi, e mai `restart` o `up` di stack diversi da `rifiuti`. SSH: `ssh -i ~/.ssh/id_ed25519_contabo root@38.242.246.95`.

**Prima del merge**

- [ ] **7.1 Ricognizione in sola lettura.** `ls -la /opt/rifiuti /opt/rifiuti/site/ops /opt/rifiuti/backups /opt/rifiuti/site/backups`; `ls /etc/cron.d | grep -i -E "rifiuti|wasteflow"`; `grep -E "^(SENTRY_DSN|PERMISSION_CACHE_HMAC_SECRET|PUBLIC_URL|OFFSITE_MODE|RSYNC_TARGET|ENCRYPT_BACKUP)=" /opt/rifiuti/.env | cut -d= -f1` (solo i nomi, mai i valori); `ls -la /opt/rifiuti/docker-compose.prod.yml` (esiste come copia o link?); `command -v msmtp`; `df -h /`. Atteso: capire se esiste già un cron di backup e dove scrive. Riportare l'esito a Graziano prima di andare avanti.
- [ ] **7.2 Variabili nel `.env`** (dopo un backup del file: `cp -p /opt/rifiuti/.env /opt/rifiuti/.env.bak-<data>-fase0d`): aggiungere `PERMISSION_CACHE_HMAC_SECRET=<openssl rand -hex 32>` (**obbligatoria prima del merge**), `PUBLIC_URL=https://rifiuti.ignicraft.com`, `OFFSITE_MODE=disabled` (finché Graziano non sceglie la destinazione, vedi Decisioni aperte). Verifica: `stat -c %a /opt/rifiuti/.env` → `600`.
- [ ] **7.3 Progetto Bugsink `wasteflow`.** `docker exec -it bugsink bugsink-manage shell`, creare il `Project` (nome `wasteflow`), leggerne `id` e `sentry_key`, togliere i trattini dalla chiave. Scrivere in `/opt/rifiuti/.env`: `SENTRY_DSN=http://<32hex>@bugsink:8000/<id>`. Annotare l'id nella memoria globale (elenco "Clienti attivi" di Bugsink).

**Merge e deploy**

- [ ] **7.4 Merge su `master`** (fa partire il deploy). Seguire il run in Gitea. Atteso nel log del job `deploy`: `Backup verificato: /opt/rifiuti/backups/wasteflow_predeploy_…sql.gz`, poi le migration, poi il successo dello smoke test. Il job `Esito rilascio` deve essere verde.

**Dopo il deploy (sola lettura, salvo dove indicato)**

- [ ] **7.5 Controlli sul container.**
  - `docker exec rifiuti-backend-1 node -e "console.log(new Date('2025-12-31T23:30:00Z').getFullYear(), Intl.DateTimeFormat().resolvedOptions().timeZone, process.env.APP_VERSION, Boolean(process.env.SENTRY_DSN))"` → `2026 Europe/Rome sha-xxxxxxx true`;
  - `for c in $(docker compose -p rifiuti ps -q); do docker inspect -f '{{.Name}} {{json .HostConfig.LogConfig}}' $c; done` → quattro righe con `max-size: 50m`, `max-file: 3`;
  - `docker logs --since 10m rifiuti-backend-1 2>&1 | grep -c "Using default HMAC secret"` → `0`;
  - prova d'invio a Bugsink: `docker exec rifiuti-backend-1 node -e "const S=require('@sentry/node');S.init({dsn:process.env.SENTRY_DSN});S.captureException(new Error('prova Fase 0 D'));S.flush(5000).then(()=>process.exit(0))"` → l'evento compare su `https://error.ignicraft.com` nel progetto `wasteflow`.
- [ ] **7.6 Primo backup notturno manuale** (scrive in `/opt/rifiuti/backups`, crea e cancella un DB temporaneo nel postgres di rifiuti): `bash /opt/rifiuti/site/ops/backup-offsite.sh 2>&1 | tail -20` → ultima riga `Backup verificato: …`. Poi `docker compose -p rifiuti --env-file /opt/rifiuti/.env -f /opt/rifiuti/site/docker-compose.prod.yml exec -T postgres psql -U wasteflow -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'wasteflow_verifica_%'"` → `0`.
- [ ] **7.7 Prova dell'allarme**: lanciare lo script con `WASTEFLOW_COMPOSE_FILE=/inesistente.yml` → esito ≠ 0 e una mail `ATTENZIONE backup WasteFlow fallito` in casella. Controllare che sia arrivata davvero.
- [ ] **7.8 Installare il cron** `/etc/cron.d/wasteflow-backup` (se 7.1 ne ha trovato uno vecchio, sostituirlo dopo averne salvato una copia `.bak-<data>`):
  ```
  30 3 * * * root /bin/bash /opt/rifiuti/site/ops/backup-offsite.sh >> /var/log/wasteflow-backup.log 2>&1
  ```
  03:30 non si sovrappone agli altri backup notturni (Fast Selling 02:15, Gitea 02:30, Neat Progetti 02:45, Zammad 03:00). Il mattino dopo: `tail -5 /var/log/wasteflow-backup.log` → `Backup verificato`.
- [ ] **7.9 Note:** aggiornare in `C:\Users\manzo\.claude\CLAUDE.md` la riga di Bugsink (`rifiuti` → progetto `wasteflow` con il suo id), aggiungere `/etc/cron.d/wasteflow-backup` all'elenco dei cron e correggere la riga della porta 3017 se 7.1 ha chiarito il percorso.

---

## Decisioni aperte per Graziano (fuori da questo piano)

1. **Destinazione off-site** dei backup e **cifratura age obbligatoria** (R2). Fino ad allora `OFFSITE_MODE=disabled`: i backup stanno sullo stesso VPS del database. Il modello già in uso è il prelievo dalla VM Gitea via Tailscale con chiave `restrict,command=` (Fast Selling).
2. **Endpoint di backup nell'app** (`apps/backend/src/api/backup/backup.controller.ts`, `infrastructure/backup/backup.service.ts`): l'immagine non contiene `pg_dump`/`pg_restore`, quindi non funzionano. In più `POST /api/v1/backup/restore?filename=…` passa `filename` a una shell (`exec`) senza alcun controllo: è un'iniezione di comandi, protetta solo dal ruolo `SUPER_ADMIN`. Consiglio di togliere modulo e controller in un commit dedicato.
3. **`scripts/backup.sh`** e le procedure in `docs/deployment/PRODUCTION_DEPLOYMENT.md` puntano a `/opt/wasteflow` e non sono quelli in uso: da cancellare o archiviare.
4. **Configurazione RENTRI globale, QES/TSA, Stripe:** quando si attivano, le variabili vanno aggiunte al compose e tolte da `NON_PASSATE` (il guardiano lo impone).
5. **Runtime fuori supporto (follow-up, fuori scope):** Node 20 (EOL 30/04/2026) → Node 22 LTS in `Dockerfile.prod:12,30` e nei workflow (`NODE_VERSION`); Angular 17/PrimeNG 17 → una versione supportata; `passport-saml` → `@node-saml/passport-saml`; NestJS 10 e Prisma 5.8 da aggiornare. Insieme, l'aggiornamento di Keycloak 26.0.8 → 26.7.x già annotato.
6. **Ambiente di produzione dedicato (follow-up, fuori scope, R1):** oggi la "produzione" di rifiuti sta su un VPS che le note stesse classificano di sviluppo e collaudo, condiviso e compromesso due volte nel 2026. Con l'host dedicato vanno fatti anche l'hardening dei container (read-only dove possibile, `cap_drop`, `no-new-privileges`, limiti) e i gate `test:postgres`/E2E nel deploy (R9).
7. **Sessione singola dopo il riavvio di Redis:** il primo deploy di questo piano ricrea il container Redis. L'RDB si salva allo stop, ma la sessione singola oggi è fail-open se l'epoca manca (R11): conviene controllare dopo il deploy che un secondo login invalidi ancora il primo.
