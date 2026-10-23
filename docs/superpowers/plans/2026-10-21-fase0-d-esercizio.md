# Fase 0, piano D: esercizio (error tracking, backup, deploy) — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** gli errori del backend (5xx delle richieste HTTP **e** eccezioni dei job schedulati) arrivano davvero a Bugsink, ogni backup è verificato (marcatore di fine dump e restore di prova, con controllo dello spazio libero) e allarma via mail se fallisce, il deploy fa un backup verificato prima delle migration e si ferma se non riesce, lo smoke test controlla davvero il database, l'anno di registro e la data "di oggi" sono quelli italiani, e i log dei container hanno una rotazione.

**Architettura:** un test "guardiano" Jest (`infrastruttura-prod.guard.spec.ts`) legge `docker-compose.prod.yml`, `deploy.yml` e i sorgenti del backend e fallisce quando una variabile letta dal codice non arriva al container, quando il deploy migra senza backup, quando qualcuno imposta `TZ` o toglie la rotazione dei log. Gira nel gate `quality` di `deploy.yml` (dentro `npm run test:cov`), quindi blocca il rilascio. La verifica dei backup sta in una libreria bash (`ops/lib/backup-verifica.sh`) usata da `ops/backup-offsite.sh` sia di notte sia prima delle migration, con un test bash che gira anche contro il PostgreSQL effimero del job `test-postgres`. Il tempo italiano vive in **un solo modulo**, `apps/backend/src/core/time/anno-italiano.ts`, creato qui per primo e importato dai piani C e A: funzioni pure, indipendenti dal fuso del processo. **Nessun `TZ` globale** (né sul backend né su PostgreSQL): i punti che dipendono dal giorno italiano usano esplicitamente quel modulo.

**Tech Stack:** NestJS 10, `@sentry/node` 10, Jest 29 + ts-jest, Docker Compose v2, bash, PostgreSQL 16 (`postgres:16-alpine`), Gitea Actions (`appleboy/ssh-action@v1`), msmtp sul VPS.

**Spec:**
- `C:\Progetti\winwaste\docs\confronto-con-rifiuti.md` §4 punto 8, §7 Fase 0 ("Bugsink collegato; backup verificato")
- `C:\Progetti\winwaste\docs\confronto-rifiuti\04-piattaforma-e-migrazione.md` §1.9 Backup, §1.10 Osservabilità, §1.11 Aggiornamenti, §1.12 Fuso orario, §6 raccomandazioni R1 (solo log `max-size`), R2, R3, R4(c)
- Pattern infrastrutturali di Graziano (`C:\Users\manzo\.claude\CLAUDE.md`): Bugsink (DSN con chiave a 32 hex senza trattini, `http://<chiave>@bugsink:8000/<id>`), backup Fast Selling (dump accettato solo dopo un restore di prova in un DB temporaneo, mail se fallisce), lezione Gitea del 16/09 (dump troncato ma gzip valido, marcatore `PostgreSQL database dump complete`, `set -e` che salta la pulizia), log json-file (`max-size: "50m"`, `max-file: "3"`, mai logrotate/copytruncate).
- Esito dei giri di revisione: `docs/superpowers/plans/confutazione-fase0/giro-1-esito.md`, `docs/superpowers/plans/confutazione-fase0/giro-2-esito.md`, `docs/superpowers/plans/confutazione-fase0/giro-3-esito.md`; decisioni aperte consolidate in `docs/superpowers/plans/confutazione-fase0/decisioni-per-graziano.md`

## Decisioni prese in questo piano (da confermare con Graziano)

1. **Elenco esplicito invece di "passa tutto".** Ogni variabile letta dal codice deve stare nel blocco `environment:` del backend **oppure** nell'elenco `NON_PASSATE` del test guardiano, con il motivo scritto. Passarle tutte vuote sarebbe peggio: `${X}` non impostata arriva come stringa vuota e scavalca il default del codice (`config.get('JWT_ACCESS_TOKEN_EXPIRATION', '15m')` diventerebbe `''`).
2. **Variabili aggiunte al compose** (oltre a `SENTRY_DSN`): `APP_VERSION` (dal tag dell'immagine), `PUBLIC_URL` (oggi i link nelle mail di notifica puntano a `https://wasteflow.app`), `PERMISSION_CACHE_HMAC_SECRET` **obbligatoria** (oggi la produzione firma la cache dei permessi con il default `change-me-in-production`), `LOG_LEVEL`. **Non** `TZ` (Decisione 10).
3. **Restano fuori, con motivo**: RENTRI globale (oggi vale il default demo), QES/TSA (nessun contratto QTSP), Stripe (billing non attivo), SAML della `KeycloakSamlStrategy` (non registrata in alcun modulo), alias SPID e chiavi SP, `SWAGGER_ENABLED`, `SPID_STRICT_LEVEL_CHECK`, default JWT/Redis. Passare ciascuna di queste è una decisione a sé, non una correzione.
4. **I 5xx vanno a Bugsink dal filtro globale, gli errori dei job da un helper comune.** Con il solo `Sentry.init` di `@sentry/node` un'eccezione in un controller non arriva mai a Bugsink: la intercetta `HttpExceptionFilter` e risponde 500. Si chiama `Sentry.captureException` dal filtro, solo per status ≥ 500. I 4xx restano fuori, altrimenti Bugsink si riempie di 401 e 404. L'utente si legge da `request.user.id` (lo popola `JwtStrategy.validate`; `userId` non esiste, quindi oggi l'utente non arriva né a Bugsink né ai log), con `userId` come ripiego. Il path si manda **senza query string** (i filtri di ricerca contengono CF, partite IVA e ragioni sociali). **Eccezione:** i 503 delle rotte `/health` non vanno a Bugsink (scelta predefinita adottata, da confermare): `/health/db` è pubblica e lo smoke test del deploy la interroga fino a 30 volte, quindi con il database giù ogni chiamata diventerebbe un evento su un Bugsink condiviso da nove stack, accanto all'errore vero del DB che arriva comunque dalle altre richieste. Gli **11** handler `@Cron` (`git grep "@Cron(" -- apps/backend/src ':!*.spec.ts'`) non passano dal filtro e spesso catturano e loggano da soli (`deadline-checker.service.ts:187-189`): ogni `catch` più esterno di un handler chiama `segnalaErroreJob(nomeJob, errore)` (nuovo, `core/monitoring/segnala-errore-job.ts`), che invia a Bugsink con il tag `job`. Gli handler senza `try/catch` esterno (i tre job RENTRI e `scheduledRefresh` di `reference-data-seeder.service.ts`) ne ricevono uno che logga, segnala e non rilancia; `safe()` dello stesso servizio, che inghiotte l'errore di ogni dataset, chiama anche lui `segnalaErroreJob('seedDatiDiRiferimento', e, { dataset })`; i `catch` per utente di `checkMudDeadlines` (invio delle mail) restano solo nel log, perché un guasto SMTP produrrebbe un evento per destinatario, e `ops/README.md` lo dice; `allineamentoSchedulato` (`rentri-codifiche-sync.service.ts`), che oggi rilancia gli errori diversi da `AllineamentoRentriGiaInCorsoError` senza loggarli, smette di rilanciare e fa come gli altri. I job RENTRI intercettano gli errori **tenant per tenant** (`rentri-riconciliazione.job.ts`, `rentri-rifornimento-scorta.job.ts`, `rentri-certificato-scadenza.job.ts`), e sono proprio i guasti che contano (certificato scaduto, 401): anche quei `catch` interni chiamano `segnalaErroreJob` con il tag `tenantId`. Un test guardiano fallisce se un metodo `@Cron` dei sorgenti non chiama `segnalaErroreJob`.
5. **Niente tracing verso Bugsink, e niente dati personali negli eventi** **(scelta predefinita adottata, da confermare).** Si toglie `tracesSampleRate: 1.0`: Bugsink raccoglie errori, non transaction, e il tracing attiva la strumentazione OpenTelemetry senza utilità. Togliere la query string dal path che il filtro manda **non basta**: con `@sentry/node` 10.62 (versione installata) l'integrazione HTTP e `requestDataIntegration`, attive di default, allegano a ogni evento catturato durante una richiesta URL con query string, header (compreso `Authorization`), cookie e, con `maxIncomingRequestBodySize: 'medium'` (default), il corpo della richiesta: CF, ragioni sociali e indirizzi dei POST su FIR e registro finirebbero su un Bugsink condiviso da nove stack. Le opzioni di `Sentry.init` stanno in una funzione pura, `opzioniSentry(env)` (`core/monitoring/opzioni-sentry.ts`), testabile: `sendDefaultPii: false`; `Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })`; `Sentry.requestDataIntegration({ include: { cookies: false, data: false, headers: false, ip: false, query_string: false, url: true } })` (le integrazioni passate con lo stesso nome sostituiscono quelle di default); `beforeSend: ripulisciEventoSentry`, che è la rete di sicurezza indipendente dalla versione dell'SDK: toglie `request.data`, `request.cookies`, `request.query_string`, `request.headers`, la query da `request.url` e da `breadcrumbs[].data.url`, e da `user` tiene solo `id`. Il passo 7.5 legge un evento vero su Bugsink per verificarlo.
6. **Backup pre-deploy = dump + verifica del marcatore, senza restore di prova.** Il restore di prova gira ogni notte sulla stessa pipeline. Prima delle migration conta avere in pochi secondi un file completo da cui ripartire. Nessun interruttore per saltare il backup: se fallisce, il deploy si ferma e la produzione resta sulla versione precedente.
7. **Lo script legge solo `DB_NAME` e `DB_USER` da `/opt/rifiuti/.env`, senza `source`.** Il cron suggerito oggi (`source /opt/rifiuti/.env && …`) non funziona: cron usa `/bin/sh` (dash), dove `source` non esiste. E il `.env` è sintassi compose, non shell. `DB_PASSWORD` non serve: `pg_dump` gira dentro il container, dove l'immagine ufficiale accetta le connessioni locali in `trust`.
8. **Percorso del compose = `/opt/rifiuti/site/docker-compose.prod.yml`**, quello che usa il deploy (`deploy.yml:275`, `:281`), sia in `ops/backup-offsite.sh` sia in `ops/restore.sh` (`:26`), che oggi puntano entrambi a `/opt/rifiuti/docker-compose.prod.yml`, che il deploy non tocca mai: lo script di ripristino sarebbe rotto proprio quando serve. Anche `restore.sh` legge `DB_NAME`/`DB_USER` con `leggi_env`, senza `source` e senza `DB_PASSWORD` obbligatoria.
9. **Tempo italiano senza librerie e senza `TZ`, in un solo modulo** (`core/time/anno-italiano.ts`):
   - `annoSolareItaliano(d) = anno UTC di (d + 1 h)`. Al passaggio d'anno l'Italia è sempre in UTC+1 (l'ora legale va da fine marzo a fine ottobre), quindi la formula è esatta per ogni istante.
   - `giornoItaliano(d)` = data di calendario a Roma (`'AAAA-MM-GG'`), con `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })`: le build ufficiali di Node includono l'ICU completo, quindi non servono né `tzdata` né `TZ`.
   - `formattaDataItaliana(d)` = `'GG/MM/AAAA'` del giorno italiano, per i messaggi.
   - `limitiAnnoMud` del piano A si costruisce su questa stessa regola e la importa da qui. **I piani C e A importano da questo file e non ridefiniscono nessuna di queste funzioni.**
10. **Nessun `TZ` globale, né sul backend né su PostgreSQL.** Il primo giro di revisione ha mostrato che `TZ=Europe/Rome` sposterebbe di 1-2 ore gli 11 `@Cron` (`deadline-checker.service.ts:47,197,232,640,806`, `rentri-certificato-scadenza.job.ts:38`, i job mensili) e cambierebbe il significato di `setDate(getDate()…)` e `new Date(y, m, d)` in vari punti (`raccogli-attenzione.use-case.ts:191,230,268`, `deadline-checker.service.ts:240,871`, `consultant-tenant-association.repository.ts:173`), mentre le date salvate sono a mezzanotte UTC: errori di un giorno su "scade fra N giorni". Su PostgreSQL, poi, le 48 colonne `@default(now())` sono `timestamp` senza fuso. Si corregge invece, puntualmente, il difetto reale di mezzanotte: il controllo "data nel futuro" di `registra-movimento.use-case.ts:88-99` rifiuta la data **di oggi** fra le 00:00 e l'01:00 (le 02:00 in ora legale) italiane, perché il frontend manda `AAAA-MM-GG` letto come mezzanotte UTC. Gli orari dei job restano in UTC: `ops/README.md` lo scrive (08:00 UTC = 09:00 o 10:00 italiane). Il censimento dei punti elencati sopra è un follow-up (Decisioni aperte, 8).
11. **Rotazione log con `x-logging` comune a tutti e quattro i servizi.** Il primo deploy dopo questa modifica **ricrea anche `postgres` e `redis`** (cambia la loro configurazione): pochi secondi di fermo. I dati stanno nei volumi, e Redis salva l'RDB allo stop. Il backup pre-deploy del Task 4 viene preso prima.
12. **`GET /health/db` risponde 503 quando il database non risponde** (oggi 200 con `status: 'error'`), e lo smoke test del deploy interroga quella rotta. `GET /health` resta com'è: è il contratto dell'healthcheck Docker e il suo commento dice di non alterarlo.
13. **Via i bind mount `./backups:/backups`** da `backend` e `postgres` (`docker-compose.prod.yml:30,129`). Servivano agli endpoint `/backup`, già rimossi in `ddac487`; `backup-offsite.sh` fa `pg_dump` su stdout e `restore.sh` ripristina da stdin (verificato: nessun altro uso di `/backups` in `ops/`, nel compose o nel codice). Togliere il mount non cancella i file sull'host.
14. **Spazio libero prima di dump e restore di prova.** Il VPS è condiviso fra nove stack e a settembre il disco era al 95%. Prima del dump si chiede in staging almeno 2× `pg_database_size`, prima del restore di prova almeno 3× sul filesystem dei dati Docker (`BACKUP_DATI_DIR`, default `/var/lib/docker`). Se manca, lo script si ferma con esito ≠ 0 e manda la mail: un collaudo altrui che cade per disco pieno costa più di un backup non verificato una notte.

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
- **Ordine di merge della Fase 0: D → C → A, un solo merge per piano.** Motivi: (1) oggi il deploy migra **senza** backup (`deploy.yml:283`) e il piano C porta la prima migration nuova, quindi D deve essere in produzione prima; (2) `core/time/anno-italiano.ts` nasce qui ed è importato da C e A; (3) il piano A importa da C i moduli delle unità di misura (`domain/waste-movement/unita-misura-registro.ts`) e degli stati del FIR (`domain/fir/stati-fir.ts`) e si appoggia al controllo di collegamento ai FIR; (4) un A parziale (Task 5 senza i Task 9 e 10) mostrerebbe la 422 come errore generico e non offrirebbe il modo di correggere i bloccanti. Ogni piano si esegue sul branch che contiene già il merge del precedente. **I revert vanno solo in ordine inverso (A → C → D):** C importa `core/time` da D e A importa da C, quindi revertire D con C già in `master` rompe la build. Per rilasciare di nuovo un piano revertito serve il revert del revert (git non riapplica un merge annullato).
- **Coordinamento con gli altri piani della Fase 0:**
  - Il **piano C** (`2026-10-21-fase0-c-integrita-registro-fir.md`) riscrive in `registra-movimento.use-case.ts` i blocchi "1. Validazione preventiva giacenza" e "2. Assegnazione numero progressivo" (lock e giacenza dentro la transaction) partendo dal codice lasciato da questo piano: `anno = annoSolareItaliano(command.registrationDate)` e il controllo "data nel futuro" sul giorno italiano. Il suo `numero-fir.ts` importa `annoSolareItaliano` da `core/time/anno-italiano.ts`, non la ridefinisce; il suo Task 10 fissa la data di registrazione lato server con l'istante reale (`new Date()`) e confronta i giorni con `giornoItaliano` (Task 5 qui).
  - Il **piano A** costruisce `limitiAnnoMud` sulla stessa regola e importa da qui.
  - La numerazione FIR (`emetti-fir.use-case.ts:65`, `fir-prisma.repository.ts:385-386`) passa all'anno italiano nel piano C (Task 8-9). Fino ad allora resta in UTC: un FIR emesso fra le 00:00 e l'01:00 del 1° gennaio prende il numero dell'anno prima, come oggi.

## Review Focus

1. **Variabile passata vuota che scavalca il default del codice** (`JWT_ISSUER: ${JWT_ISSUER}` senza `.env`): atteso che il guardiano fallisca e indichi la variabile. Test: Task 1, `non passa nuda una variabile che il codice legge con un default`.
2. **Dump troncato ma gzip valido** (lo stream si interrompe a metà, come su Gitea il 16/09): atteso che il file venga rifiutato, rinominato `.scartato`, non ruotato come buono e segnalato via mail. Test: Task 3, `rifiuta un gzip valido senza marcatore finale`.
3. **Restore di prova che fallisce a metà** (istruzione SQL rotta dentro un dump con marcatore): attesi esito non zero **e** database temporaneo eliminato comunque. Test: Task 3, `ripristino fallito: il database temporaneo viene eliminato` (contro il PostgreSQL del job `test-postgres`).
4. **Backup pre-deploy impossibile** (container `postgres` fermo, disco pieno): atteso che `prisma migrate deploy` non parta. Test: Task 3, `predeploy: esce non zero se il dump fallisce` (con `PG_EXEC=false`); Task 4, `il deploy esegue il backup prima delle migration`.
5. **Registrazione della data di oggi subito dopo mezzanotte italiana** (adesso = `2026-03-10T23:30:00Z`, cioè 00:30 dell'11/03 a Roma; `movementDate` = `2026-03-11T00:00:00Z`, come lo manda il frontend): atteso che il movimento si registri; il giorno dopo (`2026-03-12T00:00:00Z`) resta rifiutato. E alle 00:30 del 1° gennaio (`2025-12-31T23:30:00Z`) progressivo e lock dell'anno 2026. Test: Task 5, `accetta la data di oggi registrata fra le 00:00 e l'01:00 italiane` e `attribuisce al 2026 un movimento registrato alle 00:30 del 1° gennaio, anche con il processo in UTC`.
6. **Errore dentro un job schedulato, anche per un solo tenant** (la query di `checkMudDeadlines` fallisce; la riconciliazione RENTRI fallisce per il tenant `t2` con un certificato scaduto e riesce per `t1`; un nuovo `@Cron` aggiunto senza segnalazione): atteso un evento su Bugsink con il tag `job` (e `tenantId` per il caso per tenant), senza che il job rilanci; il guardiano fallisce sul `@Cron` nuovo. Test: Task 2, `un errore del job delle scadenze MUD arriva a Bugsink`, `un errore di un solo tenant della riconciliazione arriva a Bugsink con il tenant` e `ogni metodo @Cron dei sorgenti chiama segnalaErroreJob`.
7. **Database giù durante lo smoke test** (`/health/db` risponde 503 per 30 tentativi): atteso il fallimento del deploy **senza** 30 eventi su Bugsink. Test: Task 2, `non invia a Bugsink i 503 delle rotte di health`.
8. **Errore 500 durante un `POST /api/v1/fir` con CF nel corpo, `Authorization` e query `?search=RSSMRA80A01H501U`**: atteso un evento su Bugsink senza corpo, header, cookie, query string né CF, con `user` ridotto all'`id`. Test: Task 2, `ripulisciEventoSentry toglie corpo, header, cookie e query` e `opzioniSentry spegne i dati personali e il tracing`; passo 7.5 (lettura di un evento vero).
9. **`@Cron` con opzioni** (`@Cron('0 3 * * *', { name: 'x', timeZone: 'UTC' })`) **o handler senza `try/catch` come `scheduledRefresh`**: atteso che il guardiano trovi il corpo del metodo e non quello delle opzioni, e che `scheduledRefresh` segnali. Test: Task 2, `il guardiano trova il corpo del metodo anche con un @Cron con opzioni` e `scheduledRefresh segnala a Bugsink un errore del refresh`.

---

## File Structure

| File | Responsabilità |
|---|---|
| `apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts` (nuovo) | Guardiano: variabili lette dal codice ↔ compose, assenza di `TZ`, assenza di `./backups`, rotazione log, ordine backup/migration nel deploy. Contiene il parser a righe del compose e l'elenco `NON_PASSATE`. |
| `docker-compose.prod.yml` (modifica) | Nuove variabili del backend, via i bind mount `./backups`, ancora `x-logging` su tutti i servizi |
| `apps/backend/src/core/filters/http-exception.filter.ts` (modifica) + `.spec.ts` (nuovo) | Invio a Bugsink dei 5xx, utente da `req.user.id` |
| `apps/backend/src/core/monitoring/segnala-errore-job.ts` (nuovo) + `.spec.ts` | `segnalaErroreJob(job, errore, tag?)` per i `@Cron`; guardiano che ogni `@Cron` la chiami |
| Gli 11 handler `@Cron` (`deadline-checker.service.ts`, `notification-escalation.service.ts`, `reference-data-seeder.service.ts`, `rentri-codifiche-sync.service.ts`, `infrastructure/jobs/rentri-*.job.ts`) (modifica) | Errori dei job a Bugsink, anche quelli intercettati per tenant |
| `apps/backend/src/core/monitoring/opzioni-sentry.ts` (nuovo) + `.spec.ts` | `opzioniSentry(env)` e `ripulisciEventoSentry(evento)`: niente tracing, niente dati personali negli eventi |
| `apps/backend/src/main.ts:15-23` (modifica) | `Sentry.init(opzioniSentry(process.env))` |
| `apps/backend/src/infrastructure/monitoring/health-check.controller.ts` (modifica) + spec | `/health/db` risponde 503 se il DB non risponde |
| `ops/lib/backup-verifica.sh` (nuovo) | Funzioni bash: lettura `.env`, spazio libero, verifica di completezza, restore di prova, notifica |
| `ops/test/backup-verifica.test.sh` (nuovo) | Test bash della libreria e di `restore.sh` (senza DB, e con DB se `PG_EXEC` è impostata) |
| `ops/backup-offsite.sh` (modifica) | Modalità `notturno`/`predeploy`, file `.parziale`, spazio, verifica, restore di prova, mail, rotazione |
| `ops/restore.sh` (modifica) | Percorso del compose del deploy, `leggi_env`, niente `DB_PASSWORD` |
| `ops/README.md` (modifica) | Cron corretto, verifica dei backup, Bugsink, orari dei job in UTC, rollback |
| `.gitea/workflows/ci.yml`, `.gitea/workflows/deploy.yml` (modifica) | Test bash nei gate; backup prima delle migration; smoke su `/api/v1/health/db` |
| `apps/backend/src/core/time/anno-italiano.ts` (nuovo) + `.spec.ts` | `annoSolareItaliano`, `giornoItaliano`, `formattaDataItaliana` (unica sede, importata da C e A; `dataDelGiornoItaliano` non serve più: il piano C salva l'istante reale della registrazione) |
| `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts:88-99,129` (modifica) + spec | "Data nel futuro" sul giorno italiano; anno del progressivo italiano |

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
  it.each(['backend', 'postgres'])('%s non monta più ./backups (endpoint /backup rimossi in ddac487)', servizio => {
    expect(bloccoServizio(leggiFile('docker-compose.prod.yml'), servizio).join('\n')).not.toContain('./backups')
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

Togliere le righe `- ./backups:/backups` da `postgres` (`:30`) e `backend` (`:129`) (Decisione 13); se il blocco `volumes:` del backend resta vuoto, togliere anche la chiave.

- [ ] **Step 4: eseguire e vederlo passare**

Run: `cd apps/backend && npx jest --runInBand src/core/config/infrastruttura-prod.guard.spec.ts`
Expected: PASS (7 test). Il terzo test passa già sulle voci esistenti: le variabili lette con un default (`NODE_ENV`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_CLUSTER_NODES`, `PERMISSION_CACHE_HMAC_SECRET`) sono nel compose come letterali o con `:-`/`:?`. Se il primo test segnala una variabile non prevista dalle tabelle sopra, classificarla (compose o `NON_PASSATE` con motivo) e annotarla nel rapporto finale.

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

### Task 2: i 5xx e gli errori dei job arrivano a Bugsink

**Files:**
- Modify: `apps/backend/src/core/filters/http-exception.filter.ts` (riga 49 `userId`; dopo il blocco "Log the error", prima della risposta)
- Create: `apps/backend/src/core/filters/http-exception.filter.spec.ts`
- Create: `apps/backend/src/core/monitoring/segnala-errore-job.ts`, `apps/backend/src/core/monitoring/segnala-errore-job.spec.ts`
- Modify: gli 11 handler `@Cron`: `deadline-checker.service.ts:47,197,232,640,806`, `notification-escalation.service.ts:35`, `reference-data-seeder.service.ts:74` (`scheduledRefresh`, senza `try/catch`) e `:255-262` (`safe`), `rentri-codifiche-sync.service.ts:108` (`allineamentoSchedulato`), `infrastructure/jobs/rentri-certificato-scadenza.job.ts:38` (`eseguiControlloScadenza`), `rentri-riconciliazione.job.ts:37` (`eseguiRiconciliazione`), `rentri-rifornimento-scorta.job.ts:44` (`eseguiRifornimento`); nei tre job RENTRI anche il `catch` per tenant
- Modify: `apps/backend/src/application/notifications/deadline-checker.service.spec.ts` (un test nuovo), `apps/backend/src/infrastructure/jobs/rentri-riconciliazione.job.spec.ts` (un test nuovo), `apps/backend/src/application/reference-data/rentri-codifiche-sync.service.spec.ts` (un test nuovo), `apps/backend/src/application/reference-data/reference-data-seeder.service.spec.ts` (due test nuovi)
- Create: `apps/backend/src/core/monitoring/opzioni-sentry.ts`, `apps/backend/src/core/monitoring/opzioni-sentry.spec.ts`
- Modify: `apps/backend/src/main.ts:15-23`
- Modify: `ops/README.md`, sezione "Error tracking (Bugsink)"

**Interfaces:**
- Consumes: `SENTRY_DSN`, `APP_VERSION` nel container (Task 1).
- Produces:
  - Il filtro legge `const userId = request.user?.id ?? request.user?.userId` (usato anche nei metadati del log) e, se `statusCode >= 500` e il percorso **non** è una rotta di health (`!/\/health(\/|$)/.test(percorsoSenzaQuery)`), chiama `Sentry.captureException(exception, { tags: { correlationId, statusCode: String(statusCode) }, user: userId ? { id: userId } : undefined, extra: { tenantId, path: percorsoSenzaQuery, method: request.method } })`, con `percorsoSenzaQuery = request.url.split('?')[0]`.
  - `export function segnalaErroreJob(job: string, errore: unknown, tag: Record<string, string> = {}): void` — `Sentry.captureException(errore instanceof Error ? errore : new Error(String(errore)), { tags: { job, ...tag } })` dentro `try/catch` (Bugsink irraggiungibile non deve far cadere il job). Senza DSN l'SDK non è inizializzato e la chiamata non fa nulla. Nomi dei job: il nome del metodo (`checkMudDeadlines`, `eseguiRiconciliazione`, …). Nei `catch` per tenant dei job RENTRI: `segnalaErroreJob('<nomeMetodo>', error, { tenantId: tenant.id })` (per `rentri-certificato-scadenza.job.ts`, il `tenantId` della credenziale).
  - `core/monitoring/opzioni-sentry.ts`:
    - `export function opzioniSentry(env: NodeJS.ProcessEnv): Sentry.NodeOptions` — `{ dsn: env.SENTRY_DSN, environment: env.NODE_ENV ?? 'development', release: env.APP_VERSION, sendDefaultPii: false, integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }), Sentry.requestDataIntegration({ include: { cookies: false, data: false, headers: false, ip: false, query_string: false, url: true } })], beforeSend: ripulisciEventoSentry }`, senza `tracesSampleRate` (Decisione 5). Nomi delle opzioni verificati sui tipi di `@sentry/node` 10.62.0 (`build/types/integrations/http.d.ts`, `RequestDataIncludeOptions` di `@sentry/core`).
    - `export function ripulisciEventoSentry(evento: Sentry.ErrorEvent): Sentry.ErrorEvent` — restituisce l'evento senza `request.data`, `request.cookies`, `request.query_string`, `request.headers`; `request.url` e ogni `breadcrumbs[].data.url` tagliati al primo `?`; `user` ridotto a `{ id }` (o assente se manca l'`id`). Non lancia mai: su un evento di forma inattesa restituisce l'evento con le sole chiavi che riesce a togliere.
  - Guardiano: `function corpoMetodoDopoCron(sorgente: string, indiceCron: number): { nome: string; corpo: string }` (locale allo spec). Dall'indice di `@Cron(` conta le parentesi tonde fino a quella che chiude la chiamata (saltando stringhe e template literal, così le graffe di un oggetto di opzioni non contano), salta eventuali altri decoratori, legge il nome del metodo (`/(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/`), salta la lista dei parametri contando le tonde, e prende come corpo il blocco dalla prima `{` successiva fino alla `}` che la chiude, contando le graffe.

- [ ] **Step 1: scrivere i test del filtro e dei job**

`jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))`. Costruire il filtro con un `LoggerService` finto (`setContext`, `error`) e un `ArgumentsHost` finto (`switchToHttp().getRequest()` con `method`, `url: '/api/v1/fir?search=RSSMRA80A01H501U'`, `correlationId: 'corr-1'`, `tenantId: 't-1'`, `user: { id: 'u-1' }` — la forma che restituisce `JwtStrategy.validate`; `getResponse()` con `status().json()` concatenabili).

```ts
it('invia a Bugsink un errore imprevisto (500) con l utente e il path senza query', () => {
  filter.catch(new Error('boom'), host)
  expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  expect(Sentry.captureException).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({
      tags: { correlationId: 'corr-1', statusCode: '500' },
      user: { id: 'u-1' },
      extra: expect.objectContaining({ path: '/api/v1/fir' }),
    })
  )
})
it('registra nel log l utente letto da req.user.id', () => {
  filter.catch(new Error('boom'), host)
  expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ userId: 'u-1' }))
})
it('invia a Bugsink una HttpException 503', () => { /* new ServiceUnavailableException() su /api/v1/fir → 1 chiamata */ })
it('non invia a Bugsink i 503 delle rotte di health', () => {
  // host con url '/api/v1/health/db': new ServiceUnavailableException() → captureException mai chiamata,
  // la risposta resta 503 e logger.error viene chiamato come per ogni 5xx
})
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

`segnala-errore-job.spec.ts` (stesso `jest.mock`):

```ts
it('invia l errore con il tag del job', () => {
  segnalaErroreJob('checkMudDeadlines', new Error('db giù'))
  expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { job: 'checkMudDeadlines' } })
})
it('accetta anche un valore che non è un Error e non lancia se Sentry lancia', () => {
  ;(Sentry.captureException as jest.Mock).mockImplementationOnce(() => { throw new Error('rete') })
  expect(() => segnalaErroreJob('x', 'stringa')).not.toThrow()
})
it('aggiunge i tag passati, come il tenant', () => {
  segnalaErroreJob('eseguiRiconciliazione', new Error('401'), { tenantId: 't2' })
  expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { job: 'eseguiRiconciliazione', tenantId: 't2' } })
})
it('il guardiano trova il corpo del metodo anche con un @Cron con opzioni', () => {
  const sorgente = "class X {\n  @Cron('0 3 * * *', { name: 'x', timeZone: 'UTC' })\n  async lavora(a: string): Promise<void> {\n    if (a) { segnalaErroreJob('lavora', a) }\n  }\n}"
  const r = corpoMetodoDopoCron(sorgente, sorgente.indexOf('@Cron('))
  expect(r.nome).toBe('lavora')
  expect(r.corpo).toContain("segnalaErroreJob('lavora', a)")
  expect(r.corpo).not.toContain('timeZone')
})
it('ogni metodo @Cron dei sorgenti chiama segnalaErroreJob', () => {
  // guardiano: visita ricorsiva di src/ (solo *.ts non .spec.ts, stesso schema del guardiano del Task 1);
  // per ogni occorrenza di '@Cron(' usa corpoMetodoDopoCron e verifica che il corpo contenga 'segnalaErroreJob('.
  // Eccezioni solo in CRON_SENZA_SEGNALAZIONE: Record<string, string> (file#metodo → motivo), oggi vuoto.
  // Limite noto (scritto anche in ops/README.md): il guardiano è testuale e non vede gli errori che un catch
  // interno inghiotte (safe() è coperto a mano, i catch per utente di checkMudDeadlines restano nel log).
  // expect(mancanti).toEqual([]) con il messaggio "file#metodo"; expect(trovati).toBeGreaterThanOrEqual(11)
})
```

`opzioni-sentry.spec.ts`:

```ts
it('opzioniSentry spegne i dati personali e il tracing', () => {
  const o = opzioniSentry({ SENTRY_DSN: 'http://k@bugsink:8000/9', APP_VERSION: 'sha-1', NODE_ENV: 'production' })
  expect(o).toMatchObject({ dsn: 'http://k@bugsink:8000/9', release: 'sha-1', environment: 'production', sendDefaultPii: false })
  expect(o.tracesSampleRate).toBeUndefined()
  expect(o.beforeSend).toBe(ripulisciEventoSentry)
  expect((o.integrations as Array<{ name: string }>).map(i => i.name).sort()).toEqual(['Http', 'RequestData'])
})
it('ripulisciEventoSentry toglie corpo, header, cookie e query', () => {
  const evento: any = {
    request: { url: '/api/v1/fir?search=RSSMRA80A01H501U', query_string: 'search=RSSMRA80A01H501U', data: '{"cf":"RSSMRA80A01H501U"}',
      cookies: { s: '1' }, headers: { authorization: 'Bearer x', cookie: 's=1' }, method: 'POST' },
    user: { id: 'u-1', email: 'a@b.it', ip_address: '1.2.3.4' },
    breadcrumbs: [{ category: 'http', data: { url: 'https://api.rentri.gov.it/x?cf=RSSMRA80A01H501U' } }],
  }
  const r = ripulisciEventoSentry(evento)
  expect(JSON.stringify(r)).not.toContain('RSSMRA80A01H501U')
  expect(JSON.stringify(r)).not.toMatch(/authorization|Bearer|a@b\.it|1\.2\.3\.4/)
  expect(r.request).toEqual({ url: '/api/v1/fir', method: 'POST' })
  expect(r.user).toEqual({ id: 'u-1' })
  expect(r.breadcrumbs![0].data!.url).toBe('https://api.rentri.gov.it/x')
})
it('ripulisciEventoSentry non lancia su un evento senza request né user', () => {
  expect(() => ripulisciEventoSentry({ type: undefined } as any)).not.toThrow()
})
```

`reference-data-seeder.service.spec.ts` (stesso `jest.mock('@sentry/node', …)`):

```ts
it('scheduledRefresh segnala a Bugsink un errore del refresh', async () => {
  jest.spyOn(service, 'reseedAll').mockRejectedValue(new Error('rete'))
  await expect(service.scheduledRefresh()).resolves.toBeUndefined()
  expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { job: 'scheduledRefresh' } })
})
it('un dataset che fallisce dentro safe() arriva a Bugsink con il nome del dataset', async () => {
  // fetch/seed del dataset 'comuni' che rifiuta (stesso stub degli altri test del file)
  // expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { job: 'seedDatiDiRiferimento', dataset: 'comuni' } })
})
```

`rentri-riconciliazione.job.spec.ts` (stesso `jest.mock('@sentry/node', …)`):

```ts
it('un errore di un solo tenant della riconciliazione arriva a Bugsink con il tenant', async () => {
  // tenant.findMany → [{ id: 't1' }, { id: 't2' }]; riconciliaStatoRentri.execute riesce per t1, rifiuta per t2
  await expect(job.eseguiRiconciliazione()).resolves.toBeUndefined()
  expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { job: 'eseguiRiconciliazione', tenantId: 't2' } })
})
```

`rentri-codifiche-sync.service.spec.ts`:

```ts
it('allineamentoSchedulato non rilancia un errore generico: lo logga e lo segnala', async () => {
  // allineaTutto rifiuta con new Error('rete')
  await expect(service.allineamentoSchedulato()).resolves.toBeUndefined()
  expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { job: 'allineamentoSchedulato' } })
})
```

(Il test esistente "Test C", lock già in corso → warning e nessuna eccezione, resta com'è e non deve segnalare a Bugsink.)

`deadline-checker.service.spec.ts`, nello stesso file e con lo stesso `jest.mock('@sentry/node', …)` in testa:

```ts
it('un errore del job delle scadenze MUD arriva a Bugsink', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 3, 29)) // giorno di invio con la scadenza di oggi
  ;(mockPrisma.tenant.findMany as jest.Mock).mockRejectedValue(new Error('db giù'))
  await expect(service.checkMudDeadlines()).resolves.toBeUndefined()
  expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { job: 'checkMudDeadlines' } })
})
```

(Il giorno va scelto perché il metodo arrivi alla query: con il codice di oggi è il 29/04, il giorno prima del 30 aprile. Il piano A, Task 7, cambia la scadenza e aggiorna questa data.)

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/core/filters/http-exception.filter.spec.ts src/core/monitoring src/application/notifications/deadline-checker.service.spec.ts src/infrastructure/jobs/rentri-riconciliazione.job.spec.ts src/application/reference-data/rentri-codifiche-sync.service.spec.ts src/application/reference-data/reference-data-seeder.service.spec.ts -t "Bugsink|utente|job|tenant|@Cron|allineamentoSchedulato|scheduledRefresh|safe|opzioniSentry|ripulisciEventoSentry"`
Expected: FAIL: `captureException` mai chiamata dal filtro e dai job; il log riporta `userId: undefined`; `segnala-errore-job` e `opzioni-sentry` non esistono; `allineamentoSchedulato` e `scheduledRefresh` rilanciano; il guardiano elenca gli 11 metodi `@Cron`.

- [ ] **Step 3: implementare nel filtro** `import * as Sentry from '@sentry/node'`, la riga di `userId` corretta e, se `statusCode >= 500` e il percorso non è una rotta di health, la chiamata descritta in Interfaces dentro `try { … } catch { /* Bugsink irraggiungibile: la risposta al client non deve cambiare */ }`. Commento: senza un DSN l'SDK non è inizializzato e la chiamata non fa nulla; i 503 di `/health` restano fuori (Decisione 4).

- [ ] **Step 4: implementare `segnalaErroreJob` e collegarlo agli 11 handler `@Cron`.** In ogni handler, nel `catch` più esterno che oggi chiama `logger.error(...)`, aggiungere `segnalaErroreJob('<nomeMetodo>', error)` dopo il log; gli handler senza `try/catch` esterno (i tre job RENTRI e `scheduledRefresh`) ricevono `try { …corpo… } catch (error) { this.logger.error('<messaggio esistente o "Job <nome> fallito">', error as Error); segnalaErroreJob('<nomeMetodo>', error) }`; nei loro `catch` per tenant si aggiunge `segnalaErroreJob('<nomeMetodo>', error, { tenantId })` dopo il log esistente. In `safe()` di `reference-data-seeder.service.ts`, dopo il `logger.error` esistente, `segnalaErroreJob('seedDatiDiRiferimento', e, { dataset: name })` (vale anche per il seed all'avvio: un dataset che non si carica è un guasto da vedere). In `allineamentoSchedulato` il ramo `throw e` diventa `this.logger.error('Allineamento schedulato delle codifiche RENTRI fallito', e as Error); segnalaErroreJob('allineamentoSchedulato', e)`, senza rilancio. Nessun handler rilancia (oggi lo `ScheduleModule` si limita a loggare). Il guardiano `ogni metodo @Cron dei sorgenti chiama segnalaErroreJob` è la verifica.

- [ ] **Step 5: implementare `opzioni-sentry.ts` e usarlo in `main.ts`**: `Sentry.init(opzioniSentry(process.env))` dentro l'`if (process.env.SENTRY_DSN)` esistente, al posto dell'oggetto scritto sul posto (sparisce `tracesSampleRate: 1.0` con il suo commento); commento con il rimando alla Decisione 5 (niente tracing, niente dati personali).

- [ ] **Step 6: eseguire e vederli passare**

Run: lo stesso comando dello Step 2, senza `-t`, più gli spec dei job toccati: `cd apps/backend && npx jest --runInBand src/application/notifications src/application/reference-data src/infrastructure/jobs`
Expected: PASS (filtro 6 test, `segnala-errore-job` 5 test, `opzioni-sentry` 3 test, i cinque test nuovi dei job, e nessuna regressione negli spec dei job).

- [ ] **Step 7: aggiornare `ops/README.md`, sezione Bugsink**: la variabile ora arriva al container perché è nel compose (prima no, come le SMTP); va **ricreato** il backend (`up -d backend`, non `restart`); si inviano i 5xx (tranne i 503 delle rotte `/health`, Decisione 4) e gli errori dei job (tag `job`, e `tenantId` per gli errori per tenant dei job RENTRI); il progetto si crea con `docker exec bugsink bugsink-manage shell` (`from projects.models import Project`), chiave senza trattini; prova d'invio come nel passo 7.5; **dati personali**: gli eventi non portano corpo, header, cookie né query string (Decisione 5, `opzioni-sentry.ts`), e ogni aggiornamento dell'SDK va seguito dalla lettura di un evento vero come al passo 7.5; **limite del guardiano**: è testuale e non vede gli errori inghiottiti da un `catch` interno (i `catch` per utente di `checkMudDeadlines` restano solo nel log). Aggiungere una riga sugli orari dei job: sono in UTC (`EVERY_DAY_AT_8AM` = 09:00 italiane d'inverno, 10:00 d'estate), perché il backend non ha `TZ` (Decisione 10).

- [ ] **Step 8: lint e commit**

Run: `cd apps/backend && npx eslint src/core/filters src/core/monitoring src/main.ts src/application/notifications src/application/reference-data src/infrastructure/jobs` → zero errori.

```bash
git add apps/backend/src/core/filters apps/backend/src/core/monitoring apps/backend/src/main.ts apps/backend/src/application/notifications apps/backend/src/application/reference-data apps/backend/src/infrastructure/jobs ops/README.md
git commit -m "fix(ops): errori 5xx e dei job schedulati a Bugsink, con l'utente corretto e senza dati personali"
```

---

### Task 3: backup verificato (marcatore, restore di prova, allarme)

**Files:**
- Create: `ops/lib/backup-verifica.sh`
- Create: `ops/test/backup-verifica.test.sh`
- Modify: `ops/backup-offsite.sh` (intero flusso, righe 21-117)
- Modify: `ops/restore.sh:21-27` (configurazione) e `:41-42` (conferma)
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
  - `spazio_libero_byte DIR` → stampa i byte liberi del filesystem di `DIR` (`df -Pk DIR | awk 'NR==2 {print $4 * 1024}'`).
  - `verifica_spazio_libero DIR BYTE_RICHIESTI` → 0 se `spazio_libero_byte DIR` ≥ `BYTE_RICHIESTI`, altrimenti 1 con `spazio insufficiente in DIR: liberi X, richiesti Y` su stderr.
  - `dimensione_db DB_USER DB` → stampa `pg_database_size` in byte (`pg_exec psql -U … -d … -Atc "SELECT pg_database_size(current_database())"`).
  - `notifica_fallimento OGGETTO TESTO` → se `msmtp` esiste, invia `Subject: OGGETTO` a `${BACKUP_ALERT_EMAIL:-root}` (sul VPS `root` è inoltrato a Gmail via `/etc/aliases`); altrimenti scrive su stderr. Ritorna sempre 0.
- Produces (`ops/backup-offsite.sh`): variabili d'ingresso `BACKUP_MODALITA=notturno|predeploy` (default `notturno`), `WASTEFLOW_ENV_FILE` (default `/opt/rifiuti/.env`), `WASTEFLOW_COMPOSE_FILE` (default `/opt/rifiuti/site/docker-compose.prod.yml`), `BACKUP_STAGING_DIR` (default `/opt/rifiuti/backups`), `PG_EXEC` (default `docker compose -p rifiuti --env-file $WASTEFLOW_ENV_FILE -f $WASTEFLOW_COMPOSE_FILE exec -T postgres`), `BACKUP_DATI_DIR` (default `/var/lib/docker`), `BACKUP_FATTORE_SPAZIO_DUMP` (default `2`), `BACKUP_FATTORE_SPAZIO_RIPRISTINO` (default `3`). Nomi `WASTEFLOW_*` e non `COMPOSE_FILE`: `COMPOSE_FILE` è letta anche da `docker compose`. Exit 0 solo con un file verificato al nome finale.
- Produces (`ops/restore.sh`): stessi default `WASTEFLOW_ENV_FILE` e `WASTEFLOW_COMPOSE_FILE` di `backup-offsite.sh`, `DB_NAME`/`DB_USER` da `leggi_env` (con `source` della libreria), nessuna `DB_PASSWORD` obbligatoria, conferma interattiva saltata solo con `RIPRISTINO_CONFERMATO=YES`. Il resto del flusso (stop del backend, drop, restore, `migrate deploy`, start) non cambia.

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
- `verifica_spazio_libero accetta 1 byte e rifiuta un'enormità`: `verifica_spazio_libero $TMP 1` → 0; `verifica_spazio_libero $TMP 999999999999999999` → 1.
- `restore.sh: sintassi valida` → `bash -n ops/restore.sh` esce 0.
- `restore.sh usa il compose del deploy e non fa source del .env`: `grep -q '/opt/rifiuti/site/docker-compose.prod.yml' ops/restore.sh` → 0; `grep -Eq '^[^#]*(source|\. )[^#]*\.env' ops/restore.sh` → 1; `grep -q 'DB_PASSWORD:?' ops/restore.sh` → 1.

Test con database (solo se `PG_EXEC` è impostata; altrimenti stampa `salto i test con PostgreSQL: PG_EXEC non impostata`), con `DB_USER=${PG_TEST_USER:-wasteflow}` e `DB=${PG_TEST_DB:-wasteflow_ci}`:
- `dump reale completo e ripristino di prova riuscito`: `pg_exec pg_dump -U $DB_USER $DB | gzip > reale.sql.gz`, poi `verifica_completezza_dump` → 0 e `ripristino_di_prova reale.sql.gz $DB_USER $DB` → 0.
- `ripristino fallito: il database temporaneo viene eliminato`: copia di `reale.sql.gz` con una riga `SELECT * FROM tabella_che_non_esiste;` inserita prima del marcatore → `ripristino_di_prova` → 1, e `pg_exec psql -U $DB_USER -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'wasteflow_verifica_%'"` → `0`.
- `notturno con PG_EXEC reale produce un file verificato`: `BACKUP_MODALITA=notturno OFFSITE_MODE=disabled BACKUP_ALERT_EMAIL=nessuno BACKUP_DATI_DIR=$TMP` con `.env` finto che punta a `$DB` → exit 0, un `wasteflow_<DB>_*.sql.gz` in staging, nessun `.parziale`.
- `notturno senza spazio per il restore di prova si ferma`: come sopra con `BACKUP_FATTORE_SPAZIO_RIPRISTINO=1000000000000` → esito ≠ 0, nessun `wasteflow_<DB>_*.sql.gz` al nome finale nato in questa esecuzione, un `*.non-verificato` in staging, e nessun database `wasteflow_verifica_%`.

- [ ] **Step 2: eseguire e vederlo fallire**

Run: `bash ops/test/backup-verifica.test.sh`
Expected: errore su `source`: `ops/lib/backup-verifica.sh` non esiste.

- [ ] **Step 3: implementare `ops/lib/backup-verifica.sh`** secondo le Interfaces. In `ripristino_di_prova` ogni passo è controllato con `if`; il `DROP` gira in ogni caso, anche dopo un fallimento, e il suo errore viene solo registrato. Commento in testa: niente `set -e` qui, per la lezione Gitea del 16/09.

- [ ] **Step 4: riscrivere `ops/backup-offsite.sh`** con questo flusso:
  1. `set -euo pipefail`; `source "$(dirname "$0")/lib/backup-verifica.sh"`.
  2. `DB_NAME`/`DB_USER` da `leggi_env` (default `wasteflow_prod`/`wasteflow`); togliere `DB_PASSWORD` obbligatoria e ogni `source` del `.env`. `OFFSITE_MODE`, `RSYNC_TARGET`, `RSYNC_SSH_KEY`, `RCLONE_REMOTE`, `ENCRYPT_BACKUP`, `AGE_RECIPIENT`, `BACKUP_RETENTION_DAYS`, `BACKUP_ALERT_EMAIL` dall'ambiente se impostati, altrimenti da `leggi_env`.
  3. Prefisso del file: `wasteflow_${DB_NAME}_` di notte, `wasteflow_predeploy_${DB_NAME}_` prima del deploy. Il dump si scrive in `<nome>.sql.gz.parziale`.
  4. `mkdir -p "$BACKUP_STAGING_DIR"` (con `df` su una cartella inesistente il controllo dello spazio fallirebbe e il primo backup pre-deploy si fermerebbe); poi `dim=$(dimensione_db "$DB_USER" "$DB_NAME")`; `verifica_spazio_libero "$BACKUP_STAGING_DIR" $((dim * BACKUP_FATTORE_SPAZIO_DUMP))`, altrimenti uscita con 1 (la mail parte dal `trap`). Poi `pg_exec pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$parziale"`.
  5. `verifica_completezza_dump`; se fallisce, rinominare in `.scartato` e uscire con 1.
  6. Solo in `notturno`: `verifica_spazio_libero "$BACKUP_DATI_DIR" $((dim * BACKUP_FATTORE_SPAZIO_RIPRISTINO))`; se fallisce, rinominare il dump in `.non-verificato` (completo ma senza restore di prova: può servire) e uscire con 1 con oggetto `ATTENZIONE backup WasteFlow non verificato: spazio insufficiente`. Poi `ripristino_di_prova "$parziale" "$DB_USER" "$DB_NAME"`; se fallisce, rinominare in `.scartato` e uscire con 1.
  7. `mv` del `.parziale` al nome finale. Poi cifratura e copia off-site come oggi; in `predeploy` copia off-site sempre saltata.
  8. Rotazione: in `notturno` `find … -name "wasteflow_${DB_NAME}_*.sql.gz" -o -name "wasteflow_${DB_NAME}_*.sql.gz.age"` più vecchi di `RETENTION_DAYS`, più i `.scartato` e `.non-verificato` oltre 7 giorni; in `predeploy` tenere i 10 `wasteflow_predeploy_*` più recenti.
  9. `trap` su `ERR` ed `EXIT` con esito ≠ 0: in `notturno` chiama `notifica_fallimento "ATTENZIONE backup WasteFlow fallito" "<ultime righe del log, host, modalità, file>"`; in `predeploy` niente mail, lo segnala il job di deploy.
  10. Ultima riga di log: `Backup verificato: <file> (<dimensione>)`.

  Aggiornare l'intestazione: uso manuale `bash /opt/rifiuti/site/ops/backup-offsite.sh`; il cron come nel passo 7.8.

- [ ] **Step 4b: correggere `ops/restore.sh`** secondo le Interfaces: `source "$(dirname "$0")/lib/backup-verifica.sh"`, `ENV_FILE="${WASTEFLOW_ENV_FILE:-/opt/rifiuti/.env}"`, `COMPOSE_FILE="${WASTEFLOW_COMPOSE_FILE:-/opt/rifiuti/site/docker-compose.prod.yml}"`, `DB_NAME`/`DB_USER` da `leggi_env "$ENV_FILE" …` con i default di oggi, riga `DB_PASSWORD` tolta, conferma saltata se `RIPRISTINO_CONFERMATO=YES`. Intestazione: uso `bash /opt/rifiuti/site/ops/restore.sh <file>`.

- [ ] **Step 5: eseguire i test senza database e vederli passare**

Run: `bash ops/test/backup-verifica.test.sh`
Expected: `salto i test con PostgreSQL…`, poi `Test riusciti: 12, falliti: 0`, exit 0. Su Windows va eseguito in Git Bash (servono `gzip` e `mktemp`).

- [ ] **Step 6: eseguire i test con database contro un PostgreSQL locale**

Run (Docker in WSL acceso):
```bash
docker run -d --rm --name pg-backup-prova -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=x -e POSTGRES_DB=wasteflow_ci postgres:16-alpine
# attendere che pg_isready risponda, poi creare due tabelle e _prisma_migrations con una riga ciascuna
PG_EXEC="docker exec -i pg-backup-prova" bash ops/test/backup-verifica.test.sh
docker rm -f pg-backup-prova
```
Expected: `Test riusciti: 16, falliti: 0`.

- [ ] **Step 7: collegare i test ai workflow**
  - `ci.yml`, job `backend`: passo `Test script di backup (bash)` con `working-directory: ${{ github.workspace }}` e `run: bash ops/test/backup-verifica.test.sh`.
  - `ci.yml`, job `test-postgres`: passo `Test backup e ripristino di prova (PostgreSQL reale)` con `working-directory: ${{ github.workspace }}`, `env: PG_EXEC: "docker exec -i -e PGPORT=55432 ${{ env.POSTGRES_CI_CONTAINER }}"` e lo stesso `run`. `PGPORT` serve perché nel job Postgres ascolta sulla 55432 anche dentro il container (`-c port=55432`).
  - `deploy.yml`, job `quality`: lo stesso passo del job `backend` (senza DB), così una libreria rotta blocca il rilascio.

  Verifica sintattica: `npx js-yaml .gitea/workflows/ci.yml > /dev/null && npx js-yaml .gitea/workflows/deploy.yml > /dev/null` → exit 0.

- [ ] **Step 8: aggiornare `ops/README.md`, sezione Backup**: cron senza `source`; verifica e restore di prova; controllo dello spazio (Decisione 14); file `.parziale`/`.scartato`/`.non-verificato`; mail a `root`; modalità `predeploy`; `OFFSITE_MODE=disabled` finché la destinazione off-site non è decisa; `restore.sh` con il percorso giusto. Dire che `scripts/backup.sh` (percorsi `/opt/wasteflow`) **non** è lo script in uso. Nuova sezione **Rollback**: se lo smoke test fallisce dopo `migrate` e `up -d`, i container nuovi restano su. Il workflow di deploy **non** può rilasciare un tag precedente: `workflow_dispatch` non ha input, e lo script fa sempre `git reset --hard origin/master` e rilascia l'immagine di `github.sha` (`deploy.yml:35`, `:274-286`). Il rollback reale è quindi `git revert -m 1 <commit di merge>` su `master` e la pipeline intera (build delle immagini di 30-40 minuti sul runner condiviso, più il deploy), possibile solo se le migration del rilascio sono additive (per la Fase 0 lo sono: il piano C aggiunge una colonna nullable e un indice, ignorati dal codice vecchio; vedere nel piano C il caso limite di Capodanno). Il ripristino dal backup `wasteflow_predeploy_*` con `restore.sh` si fa solo se una migration ha alterato dati, ed è distruttivo per le scritture successive al backup. Aggiungere a `deploy.yml` un input `tag` che salti la build è una decisione aperta (Decisioni aperte, 9). Tre righe in più nella stessa sezione: (a) i revert dei piani della Fase 0 vanno **solo in ordine inverso** (A, poi C, poi D), perché C importa da D e A da C; (b) per rilasciare di nuovo un piano revertito serve il **revert del revert**, non un nuovo merge del branch; (c) dopo un revert di A le chiavi scritte in `MUDReport.reportData` (`integrazioni`, `esportazioni`, `annullamenti`, …) restano e il codice vecchio le ignora.

- [ ] **Step 9: commit**

```bash
git add ops/lib/backup-verifica.sh ops/test/backup-verifica.test.sh ops/backup-offsite.sh ops/restore.sh ops/README.md .gitea/workflows/ci.yml .gitea/workflows/deploy.yml
git commit -m "feat(ops): backup accettato solo con dump completo e ripristino di prova, mail se fallisce"
```

---

### Task 4: backup prima delle migration e smoke test sul backend e sul database

**Files:**
- Modify: `.gitea/workflows/deploy.yml:272-288` (script SSH del job `deploy`)
- Modify: `apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts` (nuovo `describe`)
- Modify: `apps/backend/src/infrastructure/monitoring/health-check.controller.ts:36-58` + `health-check.controller.spec.ts:66-85`

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
  it('lo smoke test interroga /api/v1/health/db, che fallisce se il database non risponde', () => {
    expect(deploy).toContain('curl -fsS http://127.0.0.1:3017/api/v1/health/db')
  })
})
```

In `health-check.controller.spec.ts`, il test esistente sul DB irraggiungibile diventa:

```ts
it('GET /health/db risponde 503 se il database non risponde', async () => {
  prisma.$queryRaw.mockRejectedValue(new Error('connection refused'))
  await expect(controller.databaseHealth()).rejects.toBeInstanceOf(ServiceUnavailableException)
})
it('GET /health/detailed resta unhealthy senza lanciare se il database non risponde', async () => {
  prisma.$queryRaw.mockRejectedValue(new Error('connection refused'))
  expect((await controller.detailedHealth()).status).toBe('unhealthy')
})
```

- [ ] **Step 2: eseguire e vederlo fallire**

Run: `cd apps/backend && npx jest --runInBand src/core/config/infrastruttura-prod.guard.spec.ts src/infrastructure/monitoring/health-check.controller.spec.ts -t "deploy.yml|health"`
Expected: FAIL su `il deploy esegue il backup prima delle migration`, su `/api/v1/health/db` e su `risponde 503`.

- [ ] **Step 2b: implementare il 503.** Estrarre `private async statoDb(): Promise<{ status: 'ok' | 'error'; database: string; error?: string }>` con il corpo attuale di `databaseHealth` (senza esporre `error.message` nella rotta pubblica: lo tiene solo `detailed`); `databaseHealth()` restituisce `{ status: 'ok', database: 'connected' }` oppure lancia `new ServiceUnavailableException({ message: 'Database non raggiungibile', error: 'SERVICE_UNAVAILABLE' })`; `detailedHealth()` usa `statoDb()`. `GET /health` non cambia.

- [ ] **Step 3: modificare lo script SSH** di `deploy.yml`:
  - dopo `$COMPOSE pull`, la riga `BACKUP` esatta del test, preceduta dal commento: backup verificato prima delle migration (forward-only); se fallisce `set -e` ferma tutto e la produzione resta sulla versione precedente;
  - lasciare invariata la riga della migration;
  - sostituire `sleep 12` e il `curl` finale con un ciclo di 30 tentativi a 3 secondi che esce con successo solo quando rispondono **sia** `curl -fsS http://127.0.0.1:3017/api/v1/health/db` (503 = database giù, quindi `-f` fallisce) **sia** `curl -fsS http://127.0.0.1:3017/`. Al fallimento: `$COMPOSE ps`, `$COMPOSE logs --since 5m backend` (non `--tail`: su questo VPS `--tail` può restare appeso) ed `exit 1`.

- [ ] **Step 4: eseguire e vederlo passare**

Run: `cd apps/backend && npx jest --runInBand src/core/config/infrastruttura-prod.guard.spec.ts src/infrastructure/monitoring/health-check.controller.spec.ts`
Expected: PASS su tutti i `describe` dei due file.

Run: `npx js-yaml .gitea/workflows/deploy.yml > /dev/null` → exit 0.

- [ ] **Step 5: commit**

```bash
git add .gitea/workflows/deploy.yml apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts apps/backend/src/infrastructure/monitoring/health-check.controller.ts apps/backend/src/infrastructure/monitoring/health-check.controller.spec.ts
git commit -m "fix(ops): backup verificato prima delle migration e smoke test che interroga il database"
```

---

### Task 5: tempo italiano (anno del registro e "data nel futuro"), senza `TZ`

**Perché:** il progressivo del registro di carico e scarico riparte ogni anno, e il MUD si dichiara per anno solare italiano. Con il processo in UTC una registrazione fra le 00:00 e l'01:00 del 1° gennaio finisce nella numerazione dell'anno prima (colpisce i client API: il frontend manda date senza ora). Il difetto che colpisce tutti, invece, è il controllo "data nel futuro" (`registra-movimento.use-case.ts:88-99`): il frontend manda `AAAA-MM-GG`, che il backend legge come mezzanotte UTC, cioè l'01:00 o le 02:00 italiane; fra le 00:00 e quell'ora la data di **oggi** è "nel futuro" e il movimento viene rifiutato. Decisioni 9 e 10: nessun `TZ` globale, un solo modulo di tempo italiano.

**Files:**
- Create: `apps/backend/src/core/time/anno-italiano.ts`, `apps/backend/src/core/time/anno-italiano.spec.ts`
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts:88-99` (data nel futuro), `:129` (anno)
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.spec.ts` (nuovo `describe` in fondo)
- Modify: `apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts`

**Interfaces:**
- Produces (`core/time/anno-italiano.ts`, **unica sede**: i piani C e A importano da qui e non ridefiniscono):
  - `export function annoSolareItaliano(istante: Date): number` — corpo `new Date(istante.getTime() + 60 * 60 * 1000).getUTCFullYear()`, con il commento della decisione 9.
  - `export function giornoItaliano(istante: Date): string` — `'AAAA-MM-GG'` del calendario di Roma, con `new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(istante)` (formatter creato una volta a livello di modulo).
  - `export function formattaDataItaliana(istante: Date): string` — `'GG/MM/AAAA'` dello stesso giorno (riordino di `giornoItaliano`).
  - Nessuna funzione "giorno italiano come mezzanotte UTC": il piano C (Task 10) salva la data di registrazione come istante reale e confronta i giorni con `giornoItaliano` (rilievo G3-D-16).
- Regola "nel futuro" in `RegistraMovimentoUseCase`: rifiuta solo se `giornoItaliano(data) > giornoItaliano(new Date())` (confronto fra stringhe `AAAA-MM-GG`). Una data senza ora (mezzanotte UTC) ha come giorno italiano lo stesso giorno di calendario; un istante con ora conta per il suo giorno a Roma. I messaggi d'errore esistenti restano, con la data scritta da `formattaDataItaliana`.

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
it.each([
  ['2026-03-10T23:30:00.000Z', '2026-03-11'], // 00:30 dell'11/03, ora solare
  ['2026-07-10T22:30:00.000Z', '2026-07-11'], // 00:30 dell'11/07, ora legale
  ['2026-07-10T21:30:00.000Z', '2026-07-10'], // 23:30 del 10/07
  ['2026-03-11T00:00:00.000Z', '2026-03-11'], // data senza ora inviata dal frontend
])('giornoItaliano(%s) = %s', (iso, giorno) => {
  expect(giornoItaliano(new Date(iso))).toBe(giorno)
})
it('formattaDataItaliana', () => {
  expect(formattaDataItaliana(new Date('2026-03-05T00:00:00Z'))).toBe('05/03/2026')
})
```

Nel guardiano (sostituisce l'idea di imporre `TZ`):
```ts
it('nessun servizio di produzione imposta TZ (il tempo italiano sta in core/time)', () => {
  const compose = leggiFile('docker-compose.prod.yml')
  for (const s of ['backend', 'postgres']) expect(ambienteServizio(compose, s).has('TZ')).toBe(false)
})
```

In `registra-movimento.use-case.spec.ts`, `describe('tempo italiano')`: in `beforeAll` salvare `process.env.TZ` e impostarlo a `'UTC'`, in `afterAll` ripristinarlo; `jest.useFakeTimers()` con `setSystemTime` per test e `useRealTimers` in `afterEach`. Con il mock di transazione del test "assegna progressivo 1" (catturando `args.data` di `wasteMovement.create` e gli argomenti di `$executeRaw`) e un CARICO senza `firId`:
- `attribuisce al 2026 un movimento registrato alle 00:30 del 1° gennaio, anche con il processo in UTC`: adesso `2025-12-31T23:40:00.000Z`, `registrationDate` = `movementDate` = `2025-12-31T23:30:00.000Z` → `capturedData.progressiveYear === 2026` e la chiave del lock contiene `${TENANT}-2026`;
- `lascia al 2025 un movimento registrato alle 23:59 del 31 dicembre`: `2025-12-31T22:59:59.999Z` → `2025`;
- `accetta la data di oggi registrata fra le 00:00 e l'01:00 italiane`: adesso `2026-03-10T23:30:00.000Z`, `movementDate` = `registrationDate` = `2026-03-11T00:00:00.000Z` → `isSuccess === true`;
- `accetta la data di oggi alle 00:30 anche in ora legale`: adesso `2026-07-10T22:30:00.000Z`, date `2026-07-11T00:00:00.000Z` → successo;
- `rifiuta la data di domani`: adesso `2026-03-10T23:30:00.000Z`, `movementDate` `2026-03-12T00:00:00.000Z` → `isFailure` e `error` contiene `nel futuro: 12/03/2026`.

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/core/time/anno-italiano.spec.ts src/application/registro/use-cases/registra-movimento.use-case.spec.ts src/core/config/infrastruttura-prod.guard.spec.ts`
Expected: FAIL. `anno-italiano` non esiste; il caso 00:30 dà `2025`; i due casi "di oggi" sono rifiutati come "nel futuro"; il messaggio di domani ha la data `2026-03-12`. Il test del guardiano su `TZ` passa già (nessun `TZ` oggi): è una protezione per il futuro, non la prova di questo task.

- [ ] **Step 3: implementare**
  - `anno-italiano.ts` come in Interfaces;
  - `registra-movimento.use-case.ts:88-99`: i due confronti diventano `giornoItaliano(command.movementDate) > giornoItaliano(now)` e lo stesso per `registrationDate`; nel messaggio `formattaDataItaliana(...)` al posto di `toISOString().slice(0, 10)`; commento sul frontend che manda date senza ora;
  - `registra-movimento.use-case.ts:129`: `const anno = annoSolareItaliano(command.registrationDate)`, con un commento che rimanda al fuso italiano.
  Nessuna modifica a compose e `Dockerfile.prod`.

- [ ] **Step 4: eseguire e vederli passare**

Run: lo stesso comando dello Step 2.
Expected: PASS, compresi i test già esistenti di `registra-movimento.use-case.spec.ts` (se uno di essi confronta il vecchio formato `AAAA-MM-GG` nel messaggio "nel futuro", aggiornarlo a `GG/MM/AAAA`).

- [ ] **Step 5: lint e commit**

Run: `cd apps/backend && npx eslint src/core/time src/application/registro/use-cases/registra-movimento.use-case.ts` → zero errori.

```bash
git add apps/backend/src/core/time apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts apps/backend/src/application/registro/use-cases/registra-movimento.use-case.spec.ts apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts
git commit -m "fix(registro): anno del progressivo e data di oggi nel calendario italiano, senza TZ globale"
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
Run: il comando `docker compose … config -q` del Task 1 Step 5 → exit 0. Poi lo stesso con `config --format json | node -e "const c=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(Object.values(c.services).filter(s=>s.logging&&s.logging.options&&s.logging.options['max-size']==='50m').length)"` → `4` (si contano i servizi, non le occorrenze del testo: l'estensione `x-logging` può comparire anche lei nell'output, a seconda della versione di compose).

- [ ] **Step 5: commit**

```bash
git add docker-compose.prod.yml apps/backend/src/core/config/infrastruttura-prod.guard.spec.ts
git commit -m "fix(ops): rotazione dei log json-file per tutti i servizi di produzione"
```

---

### Task 7: attività sul server (manuali)

**Ogni passo di questo task è [SERVER — serve l'approvazione di Graziano].** Va eseguito solo dopo un suo via libera esplicito, passo per passo, con lo stato registrato prima e dopo. Il VPS è condiviso fra nove stack: solo interventi additivi, e mai `restart` o `up` di stack diversi da `rifiuti`. SSH: `ssh -i ~/.ssh/id_ed25519_contabo root@38.242.246.95`.

**Prima del merge**

- [ ] **7.1 Ricognizione in sola lettura.** `ls -la /opt/rifiuti /opt/rifiuti/site/ops /opt/rifiuti/backups /opt/rifiuti/site/backups`; `ls /etc/cron.d | grep -i -E "rifiuti|wasteflow"`; `grep -E "^(SENTRY_DSN|PERMISSION_CACHE_HMAC_SECRET|PUBLIC_URL|OFFSITE_MODE|RSYNC_TARGET|ENCRYPT_BACKUP)=" /opt/rifiuti/.env | cut -d= -f1` (solo i nomi, mai i valori); `ls -la /opt/rifiuti/docker-compose.prod.yml` (esiste come copia o link?); `command -v msmtp`; `df -h / /var/lib/docker`; `timedatectl | grep -i "time zone"` (fuso dell'host, che decide l'orario del cron del 7.8); dimensione del DB (`docker compose -p rifiuti --env-file /opt/rifiuti/.env -f /opt/rifiuti/site/docker-compose.prod.yml exec -T postgres psql -U wasteflow -d postgres -Atc "SELECT pg_size_pretty(pg_database_size('wasteflow_prod'))"`). Inventario di `/opt/rifiuti/site/backups` (`ls -la --time-style=long-iso`; `du -sh`): togliendo il bind mount (Decisione 13) quei file, dump con dati personali, non li ruota più nessuno; Graziano decide se spostarli in `/opt/rifiuti/backups` o cancellarli. Atteso: capire se esiste già un cron di backup e dove scrive. Riportare l'esito a Graziano prima di andare avanti.
- [ ] **7.1b Cartella di staging dei backup** (prima del primo deploy di questo piano, perché il backup pre-deploy ci scrive): `mkdir -p /opt/rifiuti/backups && chmod 700 /opt/rifiuti/backups && ls -ld /opt/rifiuti/backups` → `drwx------ root root`. Lo script la crea comunque (Task 3 Step 4, passo 4), ma averla con i permessi giusti prima evita che nasca con l'umask di default. **[SERVER — serve l'approvazione di Graziano]**
- [ ] **7.2 Variabili nel `.env`** (dopo un backup del file: `cp -p /opt/rifiuti/.env /opt/rifiuti/.env.bak-<data>-fase0d`): aggiungere `PERMISSION_CACHE_HMAC_SECRET=<openssl rand -hex 32>` (**obbligatoria prima del merge**), `PUBLIC_URL=https://rifiuti.ignicraft.com`, `OFFSITE_MODE=disabled` (finché Graziano non sceglie la destinazione, vedi Decisioni aperte). Verifica: `stat -c %a /opt/rifiuti/.env` → `600`.
- [ ] **7.3 Progetto Bugsink `wasteflow`.** `docker exec -it bugsink bugsink-manage shell`, creare il `Project` (nome `wasteflow`), leggerne `id` e `sentry_key`, togliere i trattini dalla chiave. Scrivere in `/opt/rifiuti/.env`: `SENTRY_DSN=http://<32hex>@bugsink:8000/<id>`. Annotare l'id nella memoria globale (elenco "Clienti attivi" di Bugsink).

**Merge e deploy**

- [ ] **7.4 Merge su `master`** (fa partire il deploy). Seguire il run in Gitea. Atteso nel log del job `deploy`: `Backup verificato: /opt/rifiuti/backups/wasteflow_predeploy_…sql.gz`, poi le migration, poi il successo dello smoke test. Il job `Esito rilascio` deve essere verde.

**Dopo il deploy (sola lettura, salvo dove indicato)**

- [ ] **7.5 Controlli sul container.**
  - `docker exec rifiuti-backend-1 node -e "console.log(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome'}).format(new Date('2026-03-10T23:30:00Z')), process.env.TZ, process.env.APP_VERSION, Boolean(process.env.SENTRY_DSN))"` → `2026-03-11 undefined sha-xxxxxxx true` (l'ICU dell'immagine conosce Europe/Rome; nessun `TZ`);
  - `curl -fsS http://127.0.0.1:3017/api/v1/health/db` → `{"status":"ok","database":"connected"}`;
  - `for c in $(docker compose -p rifiuti ps -q); do docker inspect -f '{{.Name}} {{json .HostConfig.LogConfig}}' $c; done` → quattro righe con `max-size: 50m`, `max-file: 3`;
  - `docker logs --since 10m rifiuti-backend-1 2>&1 | grep -c "Using default HMAC secret"` → `0`. **Effetto atteso, non un attacco:** per circa 5 minuti (TTL della cache dei permessi) il log riporta `Invalid signature … possible tampering attempt` per gli utenti attivi, perché le voci in cache erano firmate con il vecchio secret; poi sparisce. Se continua oltre 10 minuti, fermarsi e indagare;
  - prova d'invio a Bugsink **con le opzioni vere** e con dati personali finti nella richiesta: trovare il file compilato (`docker exec rifiuti-backend-1 find dist -name opzioni-sentry.js`), poi `docker exec rifiuti-backend-1 node -e "const S=require('@sentry/node');const {opzioniSentry}=require('./<percorso trovato>');S.init(opzioniSentry(process.env));S.getIsolationScope().setSDKProcessingMetadata({normalizedRequest:{url:'/api/v1/fir?search=RSSMRA80A01H501U',query_string:'search=RSSMRA80A01H501U',headers:{authorization:'Bearer prova',cookie:'s=1'},data:'{\"cf\":\"RSSMRA80A01H501U\"}',method:'POST'}});S.captureException(new Error('prova Fase 0 D'));S.flush(5000).then(()=>process.exit(0))"` → l'evento compare su `https://error.ignicraft.com` nel progetto `wasteflow`;
  - **lettura del JSON dell'evento** (non basta vederlo nell'elenco): aprire l'evento su Bugsink e leggerne i dati grezzi, oppure `docker exec -it bugsink bugsink-manage shell` e stampare i dati dell'ultimo evento del progetto `wasteflow` (modello `Event` dell'app `events`; leggere i nomi dei campi con `Event._meta.get_fields()` prima di filtrare). Atteso: nessuna occorrenza di `RSSMRA80A01H501U`, `authorization`, `Bearer`, `cookie`; `request.url` = `/api/v1/fir`. Se compare uno di questi, **fermarsi**: togliere `SENTRY_DSN` da `/opt/rifiuti/.env`, ricreare il backend e correggere `ripulisciEventoSentry` prima di riattivarlo. Ripetere la stessa lettura sul primo evento reale di un 5xx, quando arriva.
- [ ] **7.6 Primo backup notturno manuale** (scrive in `/opt/rifiuti/backups`, crea e cancella un DB temporaneo nel postgres di rifiuti): `bash /opt/rifiuti/site/ops/backup-offsite.sh 2>&1 | tail -20` → ultima riga `Backup verificato: …`. Poi `docker compose -p rifiuti --env-file /opt/rifiuti/.env -f /opt/rifiuti/site/docker-compose.prod.yml exec -T postgres psql -U wasteflow -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'wasteflow_verifica_%'"` → `0`.
- [ ] **7.7 Prova dell'allarme**: lanciare lo script con `WASTEFLOW_COMPOSE_FILE=/inesistente.yml` → esito ≠ 0 e una mail `ATTENZIONE backup WasteFlow fallito` in casella. Controllare che sia arrivata davvero.
- [ ] **7.8 Installare il cron** `/etc/cron.d/wasteflow-backup` (se 7.1 ne ha trovato uno vecchio, sostituirlo dopo averne salvato una copia `.bak-<data>`):
  ```
  30 3 * * * root /bin/bash /opt/rifiuti/site/ops/backup-offsite.sh >> /var/log/wasteflow-backup.log 2>&1
  ```
  L'orario segue il fuso dell'host letto al 7.1: scriverlo nel file di cron e in `ops/README.md` **in UTC e in ora italiana** (es. "03:30 UTC = 04:30/05:30 italiane" se l'host è in UTC). Va scelto in modo da non sovrapporsi agli altri backup notturni (Fast Selling 02:15, Neat Progetti 02:45, Zammad 03:00 — cron dell'host, stesso fuso; Gitea 02:30 sta su un'altra macchina e non pesa sul disco del VPS). Il mattino dopo: `tail -5 /var/log/wasteflow-backup.log` → `Backup verificato`.
- [ ] **7.8b Verifica a secco di `restore.sh`** (nessun ripristino reale: lo script ferma il backend di produzione): `bash -n /opt/rifiuti/site/ops/restore.sh && grep -n "WASTEFLOW_COMPOSE_FILE" /opt/rifiuti/site/ops/restore.sh` → la riga con il default `/opt/rifiuti/site/docker-compose.prod.yml`. La prova di ripristino vera è quella notturna di `ripristino_di_prova`.
- [ ] **7.9 Note:** aggiornare in `C:\Users\manzo\.claude\CLAUDE.md` la riga di Bugsink (`rifiuti` → progetto `wasteflow` con il suo id), aggiungere `/etc/cron.d/wasteflow-backup` all'elenco dei cron e correggere la riga della porta 3017 se 7.1 ha chiarito il percorso.

---

## Decisioni aperte per Graziano (fuori da questo piano)

1. **Destinazione off-site** dei backup e **cifratura age obbligatoria** (R2). Fino ad allora `OFFSITE_MODE=disabled`: i backup stanno sullo stesso VPS del database. Il modello già in uso è il prelievo dalla VM Gitea via Tailscale con chiave `restrict,command=` (Fast Selling).
2. ~~Endpoint di backup nell'app~~: **già rimossi in `ddac487`** (controller, servizio e modulo, con il test `api/nessuna-shell-esposta.spec.ts`). Questo piano toglie solo i bind mount `./backups` rimasti (Decisione 13).
3. **`scripts/backup.sh`** e le procedure in `docs/deployment/PRODUCTION_DEPLOYMENT.md` puntano a `/opt/wasteflow` e non sono quelli in uso: da cancellare o archiviare.
4. **Configurazione RENTRI globale, QES/TSA, Stripe:** quando si attivano, le variabili vanno aggiunte al compose e tolte da `NON_PASSATE` (il guardiano lo impone).
5. **Runtime fuori supporto (follow-up, fuori scope):** Node 20 (EOL 30/04/2026) → Node 22 LTS in `Dockerfile.prod:12,30` e nei workflow (`NODE_VERSION`); Angular 17/PrimeNG 17 → una versione supportata; `passport-saml` → `@node-saml/passport-saml`; NestJS 10 e Prisma 5.8 da aggiornare. Insieme, l'aggiornamento di Keycloak 26.0.8 → 26.7.x già annotato.
6. **Ambiente di produzione dedicato (follow-up, fuori scope, R1):** oggi la "produzione" di rifiuti sta su un VPS che le note stesse classificano di sviluppo e collaudo, condiviso e compromesso due volte nel 2026. Con l'host dedicato vanno fatti anche l'hardening dei container (read-only dove possibile, `cap_drop`, `no-new-privileges`, limiti) e i gate `test:postgres`/E2E nel deploy (R9).
7. **Sessione singola dopo il riavvio di Redis:** il primo deploy di questo piano ricrea il container Redis. L'RDB si salva allo stop, ma la sessione singola oggi è fail-open se l'epoca manca (R11): conviene controllare dopo il deploy che un secondo login invalidi ancora il primo.
8. **Date "a N giorni" nel fuso del processo (follow-up, fuori scope):** `raccogli-attenzione.use-case.ts:191,230,268`, `deadline-checker.service.ts:240,871`, `consultant-tenant-association.repository.ts:173` usano `setDate(getDate()…)` o `new Date(y, m, d)` in UTC, mentre l'utente ragiona in giorni italiani: errori di un giorno possibili vicino alla mezzanotte. Vanno portati su `core/time/anno-italiano.ts` uno alla volta, con test, invece di cambiare il fuso dell'intero processo (Decisione 10).
   La numerazione dei FIR (`fir-prisma.repository.ts`, `generateNumeroProgressivo`) non è più in questo elenco: la toglie il piano C.
9. **Input `tag` nel workflow di deploy** (decisione per Graziano). Oggi il rollback è `git revert` più la pipeline intera, 30-40 minuti di build sul runner condiviso (Task 3 Step 8, sezione Rollback di `ops/README.md`). Un input `tag` di `workflow_dispatch` che salti la build e rilasci l'immagine indicata con il compose del commit corrispondente ridurrebbe il rollback a pochi minuti, ma è una modifica al workflow di rilascio da valutare a parte (quale compose usare, come impedire un tag con migration non compatibili).
10. **Errori RENTRI di credenziali e certificato su Bugsink** (rilievo G3-D-18, decisione che può aspettare). Oggi il piano li manda come errori: un certificato scaduto fa fallire la riconciliazione 4 volte al giorno e il rifornimento della scorta finché il cliente non interviene, e le issue restano aperte accanto ai bug veri. Alternativa: `level: 'warning'` e `fingerprint` `[job, tenantId, tipo]` per i 401/403 e gli errori di certificato, oppure niente Bugsink se `rentri-certificato-scadenza.job.ts` li notifica già al cliente.
11. **Merge su `master` = rilascio in produzione.** Vale per tutti e tre i piani della Fase 0: il merge lo fa Graziano o lo approva esplicitamente (Global Constraints). Per D non serve una comunicazione ai clienti, solo la finestra di manutenzione (pochi secondi di fermo di postgres e redis, circa 5 minuti di cache dei permessi ricalcolata).
