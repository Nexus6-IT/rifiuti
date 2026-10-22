# Fase 0, piano R: rimedio alla confutazione dopo l'esecuzione (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** correggere il codice già scritto dei piani D, C e A (Task 1-5) secondo l'esito della confutazione dopo l'esecuzione, e applicare le quattro decisioni di Graziano del 2026-10-22 (C-W-01 peso a destino per verso, C-W-02 progressivo iniziale configurabile, C-W-03 più movimenti dallo stesso FIR secondo WinWaste, A-W-10 flag "MUD non dovuto"), prima di riprendere il Task 6 del piano A.

**Architettura:** tre ondate nell'ordine D, C, A, un task per area con il proprio ciclo di test. Le correzioni restano dentro i moduli che le hanno introdotte (`ops/`, `core/monitoring`, `core/time`, `application/registro`, `infrastructure/persistence`, `application/mud`). Due migration additive: `registro_progressivi_iniziali` (C-W-02) e `waste_movements.ricopia_chiave` (C-W-03); una terza, sempre additiva, aggiunge le colonne del flag MUD a `tenants` (A-W-10). Il ruolo che conta per le azioni riservate del MUD si ricava dall'azienda selezionata (`MembershipService.ruoloEffettivo`), non dal solo ruolo globale del JWT.

**Tech Stack:** bash (script `ops/`), NestJS 10, Prisma 5, PostgreSQL 16, Jest 29 + ts-jest, Angular 17 + PrimeNG 17 + Karma.

**Spec:**
- `docs/superpowers/plans/confutazione-fase0/esecuzione/esito.md` (sezione 1, sezione 3 e "Decisioni di Graziano"): **autorità** di questo piano.
- Evidenze e correzioni proposte, stessa cartella: `D-codice.md`, `D-documento-winwaste.md`, `C-codice.md`, `C-documento-winwaste.md`, `A-codice.md`, `A-documento-winwaste.md`, `C-W-03-winwaste.md`.
- Piani già eseguiti: `docs/superpowers/plans/2026-10-21-fase0-d-esercizio.md`, `2026-10-21-fase0-c-integrita-registro-fir.md`, `2026-10-21-fase0-a-mud.md` (Task 1-5). La sezione 2 dell'esito (Task 6-10 di A) è applicata direttamente nel documento del piano A, non qui.

## Decisioni prese in questo piano

1. **`restore.sh` ripristina in un database nuovo e scambia i nomi solo a ripristino riuscito** (D-C-01, scelta "meglio ancora" del rapporto). Il database di produzione non viene mai eliminato: dopo lo scambio resta come `<DB>_prima_del_ripristino_<AAAAMMGG_HHMMSS>`, da eliminare a mano dopo la verifica. Il `trap` riavvia il backend su **ogni** uscita (esito, D-C-02); il `migrate deploy` gira con l'immagine `RIPRISTINO_TAG` obbligatoria e un suo fallimento fa uscire lo script con codice diverso da zero (D-C-03, D-W-01).
2. **Freschezza del backup** (D-C-06, D-W-03): uno script separato, lanciato dal cron ogni 30 minuti, guarda l'età dell'ultimo dump **verificato** e manda una mail solo ai cambi di stato, come `fastselling-salute`. L'installazione del cron è un passo [SERVER] che richiede l'approvazione di Graziano.
3. **Job RENTRI** (D-C-05): il corpo del giro diventa un metodo pubblico che rilancia l'errore generale e restituisce il conteggio dei tenant falliti; l'handler `@Cron` lo chiama e inghiotte (con `segnalaErroreJob`). Il rilancio manuale registra `fallito` o `parziale`.
4. **Giacenza impossibile per unità non di massa** (C-C-01): si segnala solo se in quella unità esiste almeno un carico (bilancio confrontabile). Uno scarico in `M3` o in litri senza carichi nella stessa unità non è un'anomalia: è il caso della Decisione 4 del piano C (il registro lo accetta).
5. **Scarico in kg di un CER con carichi non di massa** (C-C-02): se il saldo di massa non copre lo scarico **e** il CER ha carichi in unità non di massa, lo scarico si registra con un avviso, senza proporre un "Altro carico". Con soli carichi di massa resta il blocco di oggi, con il suo rimedio.
6. **FIR annullato nel frattempo** (C-C-03): se sotto il `FOR UPDATE` di `salvaCon` la riga ha `status = 'CANCELLED'` e l'aggregate no, il salvataggio si ferma con `FirAnnullatoNelFrattempoError`; la sync RENTRI lo registra come esito non ritentabile e scrive nel log che sull'ente esiste un formulario per un FIR annullato in locale.
7. **C-W-01 peso a destino per verso** (decisione di Graziano): nella ricopia, CARICO del destinatario = `pesoEffettivo` del FIR se presente, nella stessa unità del FIR (la tolleranza del 10% del dominio confronta valori nella stessa unità, `fir.aggregate.ts` `confermaConsegna`); SCARICO del produttore = quantità dichiarata, sempre. Il peso verificato resta sul FIR come esito.
8. **C-W-02 progressivo iniziale** (decisione di Graziano): tabella `registro_progressivi_iniziali` (una riga per azienda e anno), impostabile **una sola volta** e solo finché l'anno non ha movimenti, sotto lo **stesso** advisory lock della numerazione (`<tenantId>-<anno>`). La numerazione diventa `max(MAX(progressive_number) + 1, primo_progressivo)`. Si possono impostare solo l'anno italiano corrente e il successivo. Riga in `ActivityLog` (`REGISTRO_PROGRESSIVO_INIZIALE`).
9. **C-W-03 più movimenti dallo stesso FIR** (decisione di Graziano: "vedi cosa fa WinWaste e adegua"; ruling del controller): in Fase 0 si adattano schema e regole, **non** i flussi dei gestori. Colonna `ricopia_chiave` NOT NULL DEFAULT `''`, indice unico `(tenant_id, fir_id_ricopia, type, ricopia_chiave)`. La ricopia ordinaria passa sempre `''`: per i produttori il comportamento del piano C non cambia. Le chiavi riservate (`prod:<unitaLocaleId>`, `cer:<cer>`, `dett:<n>`) sono solo documentate. L'aggregazione MUD raggruppa i doppi per `(firId, type, ricopiaChiave)`. Lo stesso numero di FIR su un FIR diverso resta un avviso, come in WinWaste.
10. **ATECO e comune del dichiarante** (A-W-01, A-C-02, A-C-01): una sola risoluzione nell'aggregazione, usata anche dall'export. ATECO = `normalizeAteco` (senza punti né spazi), bloccante `DICHIARANTE_ATECO_NON_VALIDO` se non sono 6 cifre. Il comune si cerca solo con città **e** provincia; senza provincia il comune non è risolto e scatta `DICHIARANTE_SENZA_COMUNE_ISTAT`.
11. **Scarico senza destinatario** (A-W-07, A-C-04): diventa `DESTINATARIO_NON_INDICATO` **BLOCCANTE** con l'integrazione `DESTINATARIO_MOVIMENTO` (ragione sociale e CF per il movimento `anno/numero`); con l'integrazione il DR esiste e il BA torna coerente ("consegnato a terzi" = Σ DR).
12. **TE** (A-W-08): un TE con CF vuoto è il bloccante `TRASPORTATORE_SENZA_CF` con l'integrazione `CF_TRASPORTATORE`; un FIR collegabile senza trasportatore dà l'avviso `TRASPORTATORE_NON_INDICATO`; `SCARICO_SENZA_FIR` dice anche che manca il modulo TE. Escludere il trasporto in proprio dal TE resta un follow-up.
13. **Giacenze al 31/12** (A-W-06): il campo del file resta a zero (DG-32), ma l'avviso è quantificato con il saldo del registro al 31/12 per CER (kg, sole unità di massa) e compare solo se il saldo è positivo. I suoi kg contano come "kg in meno", quindi l'avviso richiede un amministratore.
14. **Ripartizione R/D** (A-C-14): `OPERAZIONE_NON_INDICATA` e `OPERAZIONE_DEDOTTA_DAL_FIR` rendono vero `riepilogo.cambianoQuantita`. La regola dei 403 diventa una funzione unica del catalogo (`avvisiCambianoQuantita`), riusata dalla segnatura e, attraverso `riepilogo.cambianoQuantita`, dal frontend.
15. **Ruolo effettivo** (A-C-06): `MembershipService.ruoloEffettivo(utente, tenantId)`. I `@Roles` di `RolesGuard` girano **prima** del `TenantSwitchInterceptor` (che è un interceptor globale), quindi non conoscono l'azienda selezionata: il controllo del ruolo effettivo si fa nel controller, dopo `requireRequestTenantId`.
16. **A-W-10 MUD non dovuto** (decisione di Graziano): flag per azienda (`tenants.mud_non_dovuto` con motivo, chi e quando), impostato da un amministratore (ruolo effettivo) dalla pagina MUD (`PUT mud/obbligo`), con riga in `ActivityLog`. L'aggregazione lo riporta (`mudNonDovuto`) e aggiunge l'avviso informativo `MUD_NON_DOVUTO`; lo scadenzario lo salta (Task 7 del piano A, emendato).

## Global Constraints

- **Ambiente dei test backend:** `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`. Senza `JWT_SECRET` le spec dei moduli falliscono e restano appese a una connessione Redis.
- **`deadline-checker.service.spec.ts`** gira con `TZ=UTC` (come in CI): in Europe/Rome 10 test preesistenti falliscono intorno al cambio d'ora del 25 ottobre.
- **Test Postgres:** container dedicato `wasteflow-pg-test` su `127.0.0.1:55432`, `DATABASE_URL=postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public` impostata esplicitamente, prima `npx prisma migrate deploy`, poi `npm run test:postgres -- <pattern>`. Mai toccare `neat-postgres-local` (5432), `neat-redis-local` (6379) né altri container `neat-*`.
- **Memoria della macchina:** mai la suite intera. Frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=<spec>`.
- **TDD obbligatorio:** prima il test, poi vederlo fallire. Un test già verde sul codice di oggi non dimostra nulla.
- **`node_modules` locali nel worktree** (piano C, Task 0). Una reinstallazione si fa con `HUSKY=0 npm ci` alla radice, poi `npx prisma generate` in `apps/backend`. Dopo ogni migration di questo piano: `npx prisma generate`.
- **Commit:** `HUSKY=0 git commit …`; messaggi in italiano nello stile `fix(ops): …`, `fix(registro): …`, `fix(mud): …`, `feat(mud): …`, **senza righe `Co-Authored-By` né altre attribuzioni**. Staging esplicito per percorso: **mai** `git add -A`, `git add .` o `git commit -a` (i rapporti non tracciati di `docs/superpowers/plans/confutazione-fase0/esecuzione/` non devono entrare nei commit dei task). Nessun push.
- **Mai caratteri di controllo letterali** nel sorgente (NUL ecc.): sempre gli escape (`\u0000`). Un NUL letterale fa trattare il file come binario da git.
- **CER solo da `apps/backend/src/domain/waste-movement/cer-registro.ts`:** raggruppare e confrontare con `chiaveConfrontoCer`, mostrare con `cerCanonico`, `cerSoloCifre` solo come parametro SQL. Mai una regex di cifre nuova.
- **Numeri:** backend con `formattaQuantita` (`apps/backend/src/core/format/formatta-quantita.ts`); frontend con `apps/frontend/src/app/shared/format/formatta-quantita.ts`, mai la pipe `number` con `'it'` (locale non registrato: crash a runtime). Date italiane con `core/time/anno-italiano.ts`.
- **Lingua e stile:** commenti, messaggi ed errori in italiano; i termini tecnici non si traducono. Prettier `semi: false`, `singleQuote: true`, `printWidth: 100`, `trailingComma: es5`, `arrowParens: avoid`.
- **Isolamento:** ogni query Prisma e ogni SQL raw porta `tenantId`/`tenant_id`.
- **Ogni scrittura di `MUDReport.reportData`** passa da `aggiornaReportData` (`application/mud/mud-report-data.ts`).
- **Messaggi dei controlli MUD:** il testo è quello esatto scritto qui; i test lo confrontano carattere per carattere.
- **Codice per nome, non per riga:** i numeri di riga citati sono quelli di HEAD `f6ac73b` e possono slittare.
- **Le eccezioni HTTP** portano i dati strutturati in `details` (il filtro globale copia solo `message`, `error`, `details`).
- **Passi [SERVER]:** nessuno si esegue senza l'approvazione esplicita di Graziano; il VPS è condiviso fra nove stack, si lavora in modo additivo con baseline prima e dopo.

## Review Focus

1. **Ripristino di un file sbagliato** (un `.sql.gz.non-verificato`, un dump troncato, un `.age`): atteso uscita ≠ 0 **prima** di fermare il backend e senza toccare il database di produzione. Test: Task 1, `restore: rifiuta un .non-verificato senza fermare il backend` e `restore: dump troncato, nessuno stop`.
2. **Ripristino con un'istruzione SQL rotta a metà dump**: atteso uscita ≠ 0, database di produzione intatto (stesso numero di tabelle), nessun database temporaneo rimasto, backend riavviato. Test: Task 1, `restore: istruzione rotta, produzione intatta e backend riavviato`.
3. **Un consulente ADMIN del proprio studio, associato all'azienda cliente come CONSULTANT**, che scarica un MUD con avvisi che tolgono kg: atteso 403 `MUD_CONFERMA_RISERVATA_AMMINISTRATORI`. Test: Task 18, `un consulente con ruolo di sola consultazione nell'azienda selezionata riceve 403`.
4. **Progressivo iniziale impostato mentre un altro utente registra il primo movimento dell'anno**: atteso che vinca uno solo (o il movimento prende il numero iniziale, o l'impostazione è rifiutata perché l'anno ha già movimenti), mai un movimento n. 1 seguito da un salto. Test: Task 11, `impostazione e primo movimento concorrenti non producono numeri incoerenti` (Postgres reale).
5. **FIR annullato mentre la sync attende l'esito RENTRI**: atteso che la riga resti `CANCELLED` e che la sync termini con un esito non ritentabile e un log d'errore. Test: Task 9, `un save stantio non riporta in vita un FIR annullato` (Postgres reale) e `la sync segnala il FIR annullato nel frattempo`.
6. **Tenant con `province` vuota e città valorizzata**: atteso `DICHIARANTE_SENZA_COMUNE_ISTAT` e nessun file con `000;000`. Test: Task 13, `senza provincia il comune non si risolve e il file non esce`.

---

## File Structure

| File | Responsabilità |
|---|---|
| `ops/restore.sh` (riscritto), `ops/lib/backup-verifica.sh` (modifica), `ops/test/backup-verifica.test.sh` (modifica), `ops/test/finto-dc.sh` (nuovo) | Ripristino sicuro in database nuovo, test con compose finto |
| `ops/backup-offsite.sh` (modifica) | Fattori di spazio validati, confronto senza aritmetica a 64 bit |
| `ops/controllo-freschezza-backup.sh` (nuovo), `ops/README.md` (modifica) | Allarme se l'ultimo dump verificato ha più di 26 h |
| `apps/backend/src/infrastructure/jobs/rentri-riconciliazione.job.ts`, `rentri-certificato-scadenza.job.ts`, `application/admin/system-health/job-actions.service.ts` | Esito vero del rilancio manuale |
| `apps/backend/src/core/monitoring/opzioni-sentry.ts` | Ripulitura del testo delle eccezioni |
| `apps/backend/src/core/time/anno-italiano.ts`, `infrastructure/pdf/pdf.service.ts` | Date e ore del PDF in ora italiana |
| `apps/backend/src/application/anomaly/anomaly-detection.service.ts` | Giacenza impossibile solo per bilanci confrontabili |
| `apps/backend/src/application/registro/giacenza-disponibile.ts`, `use-cases/registra-movimento.use-case.ts` | Avviso per carichi non di massa; progressivo iniziale; chiave di ricopia |
| `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts`, `core/domain/errors.ts`, `application/rentri/sync-fir-to-rentri.use-case.ts` | FIR annullato nel frattempo |
| `apps/frontend/src/app/features/registro/registro-fir.ts`, `registro.component.ts`, `registro.service.ts` | Quantità della ricopia per verso; progressivo iniziale |
| `apps/backend/prisma/schema.prisma` + 3 migration | `registro_progressivi_iniziali`, `ricopia_chiave`, colonne MUD di `tenants` |
| `apps/backend/src/application/registro/progressivo-iniziale.service.ts` (nuovo), `api/registro/registro.controller.ts`, `api/registro/dtos/progressivo-iniziale.dto.ts` (nuovo) | Impostazione del progressivo iniziale |
| `apps/backend/src/application/mud/aggregazione/*`, `export/mud-export.service.ts` | Correzioni A-C-01…A-C-14, A-W-01…A-W-11 |
| `apps/backend/src/api/me/membership.service.ts`, `api/mud/mud.controller.ts`, `application/mud/mud.module.ts` | Ruolo effettivo nell'azienda selezionata |
| `apps/backend/src/application/mud/mud-obbligo.service.ts` (nuovo), `api/mud/dtos/obbligo-mud.dto.ts` (nuovo) | Flag "MUD non dovuto" |

---

## Ondata D (esercizio)

### Task 1: `restore.sh` verifica prima, ripristina in un database nuovo, non lascia il backend spento (D-C-01, D-W-01, D-C-02, D-C-03)

**Files:**
- Modify (riscrittura del flusso): `ops/restore.sh`
- Modify: `ops/lib/backup-verifica.sh` (nuova `verifica_completezza_sql`)
- Create: `ops/test/finto-dc.sh` (compose finto per i test)
- Modify: `ops/test/backup-verifica.test.sh`, `ops/README.md` (sezioni "Ripristino" e "Rollback")

**Interfaces:**
- Produces (`backup-verifica.sh`): `verifica_completezza_sql FILE` → 0 se il file non è vuoto e una delle ultime 20 righe è `$MARCATORE_DUMP`, altrimenti 1 con il motivo su stderr (stessa forma di `verifica_completezza_dump`).
- Produces (`restore.sh`), variabili:
  - `RIPRISTINO_TAG` **obbligatoria** (es. `sha-1a2b3c4`): esportata come `TAG` prima di ogni `docker compose`; senza, `die "RIPRISTINO_TAG obbligatoria: il tag dell'immagine del backend coerente con il dump (es. sha-1a2b3c4)"`.
  - `WASTEFLOW_DC` (facoltativa): prefisso di comando che sostituisce `docker compose -p rifiuti --env-file … -f …` (word splitting voluto, come `PG_EXEC`); solo per i test.
  - `PG_EXEC` (facoltativa, default `"${DC[*]} exec -T postgres"`): come in `backup-offsite.sh`.
  - `BACKUP_DATI_DIR` (default `/var/lib/docker`), `RIPRISTINO_FATTORE_SPAZIO` (default `2`, validato `^[1-9][0-9]{0,6}$`).

Flusso di `restore.sh`, nell'ordine (ogni `die` prima del punto 5 lascia il backend acceso e il database intatto):
1. argomento: estensione ammessa solo `*.sql.gz` o `*.sql`; altrimenti `die "Formato non ammesso: ${BACKUP_FILE}. Si ripristinano solo file .sql.gz verificati o .sql già decifrati (mai .non-verificato, .scartato, .parziale, .age)."`;
2. `verifica_completezza_dump` (`.sql.gz`) o `verifica_completezza_sql` (`.sql`); se fallisce `die "Dump non utilizzabile: <motivo>"`;
3. `RIPRISTINO_TAG` obbligatoria (sopra), poi `export TAG="${RIPRISTINO_TAG}"`;
4. spazio: `verifica_spazio_libero "${BACKUP_DATI_DIR}" "$(awk -v d="$DIM" -v f="$RIPRISTINO_FATTORE_SPAZIO" 'BEGIN{printf "%.0f", d*f}')"` con `DIM = dimensione_db` del database di produzione;
5. conferma interattiva (come oggi), poi `stop backend` e `trap ripristino_alla_fine EXIT`: il trap, se il backend è stato fermato, esegue `start backend` (un fallimento si scrive nel log con `ATTENZIONE`) e, con esito ≠ 0, stampa `Ripristino NON riuscito (esito N): il database di produzione è <stato>.` dove `<stato>` è `intatto` prima dello scambio dei nomi oppure `quello ripristinato; il precedente è <nome>` dopo;
6. `CREATE DATABASE "<DB>_ripristino_<epoch>_<pid>"`; ripristino con `psql -v ON_ERROR_STOP=1 -1 -q`, controllando `PIPESTATUS` di `gunzip` e `psql` come in `ripristino_di_prova`; se fallisce: `DROP DATABASE … WITH (FORCE)` del temporaneo e `die`;
7. controlli sul temporaneo con `_conta`: almeno una tabella in `public` e la tabella `_prisma_migrations` leggibile; se no, drop del temporaneo e `die`;
8. scambio: `pg_terminate_backend` delle sessioni sul database di produzione, `ALTER DATABASE "<DB>" RENAME TO "<DB>_prima_del_ripristino_<AAAAMMGG_HHMMSS>"`, `ALTER DATABASE "<temp>" RENAME TO "<DB>"` (ognuno con `ON_ERROR_STOP=1`; se la seconda rinomina fallisce, si rinomina indietro la prima e si esce ≠ 0);
9. `"${DC[@]}" run --rm backend npx prisma migrate deploy`; se fallisce `die "prisma migrate deploy fallito con l'immagine ${TAG}: il database ripristinato resta in uso, il precedente è <nome>"` (niente `|| log` che inghiotte);
10. log finale `Ripristino completato con l'immagine ${TAG}. Il database precedente è <nome>: eliminarlo a mano dopo la verifica (DROP DATABASE "<nome>").` Il backend lo riavvia il trap.

`ops/test/finto-dc.sh`: script che appende a `$FINTO_DC_LOG` una riga `TAG=${TAG:-} $*` e esce 1 se `$*` contiene `run` e `FINTO_DC_RUN_FALLISCE=1`, altrimenti 0.

- [ ] **Step 1: scrivere i test che falliscono** in `ops/test/backup-verifica.test.sh`, con `WASTEFLOW_DC="$RADICE/ops/test/finto-dc.sh"`, `FINTO_DC_LOG="$TMP/dc.log"`, `RIPRISTINO_CONFERMATO=YES`, `WASTEFLOW_ENV_FILE="$TMP/env-db"`.
  Senza database:
  - `restore: rifiuta un .non-verificato senza fermare il backend`: `cp completo.sql.gz x.sql.gz.non-verificato`, esito ≠ 0 e `! grep -q 'stop backend' "$FINTO_DC_LOG"`;
  - `restore: dump troncato, nessuno stop`: `troncato.sql.gz`, esito ≠ 0, nessuno `stop backend`;
  - `restore: .sql senza marcatore rifiutato`: file `.sql` con il solo `SQL_BASE`, esito ≠ 0;
  - `restore: senza RIPRISTINO_TAG non parte`: `completo.sql.gz` senza la variabile, esito ≠ 0, nessuno `stop backend`;
  - `verifica_completezza_sql accetta un .sql completo` (0) e `… rifiuta un .sql vuoto` (1).
  Con `PG_EXEC` (dentro il blocco esistente `if [ -n "${PG_EXEC:-}" ]`), su un database di prova `prova_restore` creato dal test con una tabella e una riga:
  - `restore: istruzione rotta, produzione intatta e backend riavviato`: dump gzip con `CREATE TABLE a(id int); SELEC 1;` e il marcatore → esito ≠ 0, `prova_restore` ha ancora la sua tabella, `SELECT count(*) FROM pg_database WHERE datname LIKE 'prova_restore_ripristino_%'` = 0, `grep -q 'start backend' "$FINTO_DC_LOG"`;
  - `restore: dump valido, scambio dei nomi e migrate con il tag`: dump reale di `prova_restore` (`pg_dump`) → esito 0, esiste `prova_restore_prima_del_ripristino_%`, `grep -q 'TAG=sha-prova run --rm backend npx prisma migrate deploy' "$FINTO_DC_LOG"`;
  - `restore: migrate fallito esce non zero e riavvia il backend`: come sopra con `FINTO_DC_RUN_FALLISCE=1` → esito ≠ 0 e `start backend` nel log.
  A fine blocco il test elimina `prova_restore%`.

- [ ] **Step 2: vederli fallire.** Run: `bash ops/test/backup-verifica.test.sh` e `PG_EXEC="docker exec -i wasteflow-pg-test" bash ops/test/backup-verifica.test.sh` (con `DB_USER=wasteflow` nell'`env-db` del test). Expected: i casi nuovi `FALLITO`.

- [ ] **Step 3: implementare** `verifica_completezza_sql`, `finto-dc.sh` (eseguibile, `git update-index --chmod=+x`) e il flusso di `restore.sh` sopra. `DC=(${WASTEFLOW_DC})` se la variabile è impostata, altrimenti l'array di oggi.

- [ ] **Step 4: aggiornare `ops/README.md`**: sezione "Ripristino" con il flusso nuovo (nessun `DROP` del database di produzione, `RIPRISTINO_TAG` obbligatoria, database precedente da eliminare a mano); sezione "Rollback": il ripristino di un dump `wasteflow_predeploy_*` si fa con `RIPRISTINO_TAG` = tag del rilascio **precedente**, dopo il `git revert` e la pipeline, altrimenti `migrate deploy` riapplica la migration che si voleva annullare.

- [ ] **Step 5: vederli passare.** Stessi due comandi. Expected: `Test riusciti: N, falliti: 0` in entrambi.

- [ ] **Step 6: commit**

```bash
git add ops/restore.sh ops/lib/backup-verifica.sh ops/test/finto-dc.sh ops/test/backup-verifica.test.sh ops/README.md
HUSKY=0 git commit -m "fix(ops): il ripristino verifica il dump prima di tutto, ripristina in un database nuovo e non lascia il backend spento"
```

---

### Task 2: fattori di spazio senza overflow (D-C-04)

**Files:**
- Modify: `ops/backup-offsite.sh` (righe 59-60 e i due `$((DIM * …))`, `:127`, `:144`)
- Modify: `ops/test/backup-verifica.test.sh` (caso "notturno senza spazio", `:229-240`)

**Interfaces:**
- Produces: all'avvio, dopo la lettura delle variabili, `BACKUP_FATTORE_SPAZIO_DUMP` e `BACKUP_FATTORE_SPAZIO_RIPRISTINO` devono soddisfare `^[1-9][0-9]{0,6}$`, altrimenti `die "BACKUP_FATTORE_SPAZIO_DUMP non valido: '<valore>' (intero da 1 a 9999999)"` (stesso testo per l'altro). I byte richiesti si calcolano con `awk -v d="$DIM" -v f="$F" 'BEGIN{printf "%.0f", d*f}'`.

- [ ] **Step 1: test che falliscono.** (a) Senza database: `BACKUP_FATTORE_SPAZIO_DUMP=abc` con `PG_EXEC=false` → `bash -c '… bash ops/backup-offsite.sh 2>&1 | grep -q "BACKUP_FATTORE_SPAZIO_DUMP non valido"'` riesce. (b) Nel caso esistente "notturno senza spazio" il fattore passa da `1000000000000` a `1000000`.
- [ ] **Step 2: vederli fallire.** `bash ops/test/backup-verifica.test.sh` (a) rosso; con `PG_EXEC="docker exec -i wasteflow-pg-test"` il caso (b) è rosso se il database supera ~9 MB oppure verde per caso: verificare il caso (a) rosso.
- [ ] **Step 3: implementare** validazione e calcolo con `awk`.
- [ ] **Step 4: vederli passare**, con e senza `PG_EXEC`. Expected: falliti 0.
- [ ] **Step 5: commit** `git add ops/backup-offsite.sh ops/test/backup-verifica.test.sh` + `HUSKY=0 git commit -m "fix(ops): spazio richiesto calcolato senza overflow e fattori validati all'avvio"`

---

### Task 3: allarme di freschezza del backup (D-C-06, D-W-03)

**Files:**
- Create: `ops/controllo-freschezza-backup.sh`
- Modify: `ops/test/backup-verifica.test.sh`, `ops/README.md` (cron e spiegazione)

**Interfaces:**
- Produces: `controllo-freschezza-backup.sh` con `source lib/backup-verifica.sh`, `set -euo pipefail`. Variabili: `WASTEFLOW_ENV_FILE`, `BACKUP_STAGING_DIR` (default `/opt/rifiuti/backups`), `BACKUP_FRESCHEZZA_ORE` (default `26`), `BACKUP_STATO_FILE` (default `/var/lib/wasteflow-backup/freschezza.stato`), `BACKUP_ALERT_EMAIL`, `ORA_EPOCH` (solo test: sostituisce `date +%s`).
  - Ultimo dump verificato = file più recente fra `wasteflow_${DB_NAME}_*.sql.gz` e `wasteflow_${DB_NAME}_*.sql.gz.age` (esclusi `predeploy`, `.scartato`, `.non-verificato`, `.parziale`), età da `stat -c %Y`.
  - Stato `OK` se età ≤ soglia, `GUASTO` altrimenti o se nessun file. Lo stato precedente si legge da `BACKUP_STATO_FILE` (assente = `OK`).
  - Mail **solo ai cambi**: `OK → GUASTO` con oggetto `ATTENZIONE backup WasteFlow fermo da <N> ore` (o `ATTENZIONE backup WasteFlow: nessun dump verificato`), `GUASTO → OK` con oggetto `Backup WasteFlow di nuovo regolare`. Scrive il nuovo stato; esce 0 se OK, 1 se GUASTO.

- [ ] **Step 1: test che falliscono** (senza database), con uno stub `msmtp` in un `PATH` del test che appende a `$TMP/mail.log`:
  - `freschezza: dump di 2 ore, stato OK, nessuna mail`;
  - `freschezza: dump di 30 ore, GUASTO e una mail` (`touch -d '30 hours ago'`), esito 1;
  - `freschezza: seconda esecuzione in GUASTO, nessuna nuova mail` (righe di `mail.log` invariate);
  - `freschezza: un dump nuovo riporta a OK con la mail di ripristino`;
  - `freschezza: i .non-verificato non contano` (solo un `.non-verificato` recente → GUASTO).
- [ ] **Step 2: vederli fallire.** `bash ops/test/backup-verifica.test.sh`. Expected: i nuovi `FALLITO` (script inesistente).
- [ ] **Step 3: implementare** lo script e, in `ops/README.md`, il cron `*/30 * * * * root bash /opt/rifiuti/site/ops/controllo-freschezza-backup.sh >> /var/log/wasteflow-backup-freschezza.log 2>&1` con la spiegazione (il backup allarma quando fallisce, questo controllo quando non parte).
- [ ] **Step 4: vederli passare.** Expected: falliti 0.
- [ ] **Step 5: commit** `git add ops/controllo-freschezza-backup.sh ops/test/backup-verifica.test.sh ops/README.md` + `HUSKY=0 git commit -m "feat(ops): allarme se l'ultimo backup verificato ha più di 26 ore"`
- [ ] **Step 6 [SERVER, solo con l'approvazione di Graziano, al rilascio]:** installare `/etc/cron.d/wasteflow-backup-freschezza` con la riga del README; prova con `BACKUP_FRESCHEZZA_ORE=0` (attesa una mail), poi ripristino della soglia.

---

### Task 4: il rilancio manuale dei job RENTRI registra il vero esito (D-C-05)

**Files:**
- Modify: `apps/backend/src/infrastructure/jobs/rentri-riconciliazione.job.ts`, `rentri-certificato-scadenza.job.ts`
- Modify: `apps/backend/src/application/admin/system-health/job-actions.service.ts` (`azioni`, `avvia`)
- Test: `rentri-riconciliazione.job.spec.ts`, `rentri-certificato-scadenza.job.spec.ts`, `job-actions.service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EsitoGiroRentri { tenantTotali: number; tenantConErrore: number }
  // RentriRiconciliazioneJob
  riconcilia(): Promise<EsitoGiroRentri>          // corpo di oggi; l'errore generale (es. tenant.findMany) si rilancia dopo log e segnalaErroreJob
  @Cron(EVERY_6_HOURS) eseguiRiconciliazione(): Promise<void> // try { await this.riconcilia() } catch (e) { segnalaErroreJob('eseguiRiconciliazione', e) } — mai rilancia
  // RentriCertificatoScadenzaJob
  controllaScadenze(): Promise<EsitoGiroRentri>
  @Cron(EVERY_DAY_AT_3AM) eseguiControlloScadenza(): Promise<void>
  ```
  `segnalaErroreJob` dell'errore generale si chiama **una sola volta** (nell'handler `@Cron`, non anche in `riconcilia`); quello per tenant resta dentro il giro. Il guardiano `segnala-errore-job.spec.ts` deve restare verde (l'handler `@Cron` contiene ancora `segnalaErroreJob`).
- `JobActionsService`: `esegui: () => Promise<EsitoGiroRentri | void>`; le due voci RENTRI chiamano `riconcilia()` e `controllaScadenze()`. In `avvia`: con un esito che ha `tenantConErrore > 0`, `registra(…, 'parziale', \`${descrizione}: completato con errori su ${n} aziende su ${tot}\`)`; altrimenti `completato`; promise rifiutata → `fallito` come oggi.

- [ ] **Step 1: test che falliscono.**
  - Job: `riconcilia rilancia se la lettura dei tenant fallisce` (`tenant.findMany` rifiutata → `rejects.toThrow`), `eseguiRiconciliazione non rilancia e segnala una volta` (`Sentry.captureException` chiamato 1 volta), `riconcilia restituisce i tenant con errore` (un tenant su due fallisce → `{ tenantTotali: 2, tenantConErrore: 1 }`). Stessi tre per il certificato.
  - `job-actions.service.spec.ts`: i mock passano a `riconcilia`/`controllaScadenze`; nuovi `un giro con un errore generale finisce nell'audit come fallito` (mock rifiutato → `metadata.esito === 'fallito'`) e `un giro con tenant falliti finisce come parziale` (`{ tenantTotali: 3, tenantConErrore: 1 }` → `esito: 'parziale'`, descrizione `Riconciliazione periodica RENTRI: completato con errori su 1 aziende su 3`).
- [ ] **Step 2: vederli fallire.** `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit src/infrastructure/jobs/rentri-riconciliazione.job.spec.ts src/infrastructure/jobs/rentri-certificato-scadenza.job.spec.ts src/application/admin/system-health/job-actions.service.spec.ts`
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare**, più `src/core/monitoring/segnala-errore-job.spec.ts`.
- [ ] **Step 5: commit** dei cinque file + spec, `HUSKY=0 git commit -m "fix(jobs): il rilancio manuale dei job RENTRI registra fallito o parziale invece di completato"`

---

### Task 5: niente dati personali nel testo delle eccezioni inviate a Bugsink (D-C-07, D-W-08)

**Files:**
- Modify: `apps/backend/src/core/monitoring/opzioni-sentry.ts`
- Test: `apps/backend/src/core/monitoring/opzioni-sentry.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function mascheraDatiPersonali(testo: string): string
  // nell'ordine: `Key (…)=(…)` → `Key (…)=(***)`; `Failing row contains (…)` → `Failing row contains (***)`;
  // email → `***@***`; CF di persona /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi → `***CF***`;
  // 11 cifre consecutive /\b\d{11}\b/g → `***PIVA***`
  export function ripulisciEventoSentry(evento: Sentry.ErrorEvent, hint?: Sentry.EventHint): Sentry.ErrorEvent
  ```
  In più rispetto a oggi: per ogni `evento.exception.values[]`, se `type` comincia con `PrismaClient` il `value` diventa `` `${type}${code ? ' ' + code : ''}` `` con `code` da `(hint?.originalException as { code?: string })?.code`; altrimenti `value = mascheraDatiPersonali(value)`. `breadcrumbs[].message` e i valori stringa di `evento.extra` passano da `mascheraDatiPersonali`. Ogni blocco nel suo `try`, come oggi.

- [ ] **Step 1: test che falliscono:** `un errore Prisma P2010 arriva senza il testo di Postgres` (evento con `exception.values: [{ type: 'PrismaClientKnownRequestError', value: 'Raw query failed ... Key (codice_fiscale)=(RSSMRA80A01H501U) already exists' }]`, hint con `{ code: 'P2010' }` → `value === 'PrismaClientKnownRequestError P2010'`); `RentriApiError con un CF nel messaggio viene mascherato` (`value` con `RSSMRA80A01H501U` e `12345678903` → contiene `***CF***` e `***PIVA***`, nessuno dei due valori); `messaggio dei breadcrumb e extra mascherati`; `un evento senza exception non lancia`.
- [ ] **Step 2: vederli fallire.** `… npx jest … src/core/monitoring/opzioni-sentry.spec.ts`
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare.**
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(monitoring): il testo delle eccezioni arriva a Bugsink senza codici fiscali, partite IVA ed email"`

---

### Task 6: date e ore del PDF del FIR in ora italiana (D-W-05)

**Files:**
- Modify: `apps/backend/src/core/time/anno-italiano.ts`, `apps/backend/src/infrastructure/pdf/pdf.service.ts` (`:57`, `:146`, `:238`, `:257`)
- Test: `apps/backend/src/core/time/anno-italiano.spec.ts`, `apps/backend/src/infrastructure/pdf/pdf.service.fir.spec.ts`

**Interfaces:**
- Produces: `export function formattaDataOraItaliana(istante: Date): string` → `'GG/MM/AAAA HH:MM'` con `Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`, ricomposta dai `formatToParts` (indipendente dalla punteggiatura di ICU).
- Le righe `:57`, `:146`, `:238` usano `formattaDataItaliana`; `:257` usa `formattaDataOraItaliana`.

- [ ] **Step 1: test che falliscono:** `formattaDataOraItaliana in ora legale` (`2026-07-10T08:12:00Z` → `'10/07/2026 10:12'`), `… in ora solare` (`2026-01-10T23:30:00Z` → `'11/01/2026 00:30'`); in `pdf.service.fir.spec.ts` `la firma estiva si stampa in ora italiana` (firma `signedAt: '2026-07-10T08:12:00Z'` → il contenuto contiene `10/07/2026 10:12`, non `08:12`).
- [ ] **Step 2: vederli fallire.** `… npx jest … src/core/time/anno-italiano.spec.ts src/infrastructure/pdf/pdf.service.fir.spec.ts`
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare.**
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(pdf): date e ore del FIR stampate in ora italiana"`

---

## Ondata C (integrità registro e FIR)

### Task 7: "Giacenza impossibile" solo per bilanci confrontabili (C-C-01)

**Files:**
- Modify: `apps/backend/src/application/anomaly/anomaly-detection.service.ts` (`giacenzeImpossibili`, `:135-177`)
- Test: `apps/backend/src/application/anomaly/anomaly-detection.service.spec.ts` (`le unità non di massa si valutano a parte…`, `:146-167`)

Regola: per la famiglia di massa (`KG`) resta quella di oggi. Per un'unità non di massa si segnala solo se `carico > 0` in quella unità e `scarico > carico + 1e-9`.

- [ ] **Step 1: riscrivere il test** con: carico 500 `L`, scarico 700 `l` → segnalato (`700 L` nel messaggio); scarico 3 `M3` **senza** carichi in `M3` → **non** segnalato; scarico 100 `kg` con soli carichi in litri → segnalato in kg come oggi. Attesi 2 anomalie, nessun messaggio con `M3`.
- [ ] **Step 2: vederlo fallire.** `… npx jest … src/application/anomaly/anomaly-detection.service.spec.ts`
- [ ] **Step 3: implementare** (`if (unita !== 'KG' && carico <= 0) continue` prima del confronto).
- [ ] **Step 4: vederlo passare.**
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(anomalie): uno scarico non di massa senza carichi nella stessa unità non è una giacenza impossibile"`

---

### Task 8: scarico in kg di un CER caricato in unità non di massa: avviso, non blocco (C-C-02)

**Files:**
- Modify: `apps/backend/src/application/registro/giacenza-disponibile.ts`
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts` (`verificaGiacenza`)
- Test: `giacenza-disponibile.postgres.spec.ts`, `registra-movimento.use-case.spec.ts`, `registra-movimento.use-case.postgres.spec.ts`

**Interfaces:**
- Produces: `GiacenzaDisponibile.unitaNonDiMassaCaricate: string[]` — unità (normalizzate con `upper(btrim(unit))`, ordinate, distinte) dei **carichi** dello stesso CER del tenant che non sono né alias di kg, né di t, né vuote; una sola query aggiuntiva nello stesso `$queryRaw` (sottoquery `array_agg(DISTINCT …)`), stesso filtro di CER e tenant.
- In `verificaGiacenza`, se `saldoComplessivoKg + 1e-9 < richiestoKg` **e** `unitaNonDiMassaCaricate.length > 0`: nessuna eccezione; si restituisce (e si logga con `warn`) l'avviso esatto:
  `Il CER ${cerCode} ha carichi registrati in ${elenco} che non si possono confrontare con i kg: lo scarico è registrato, ma la giacenza va verificata a mano (i carichi in kg o tonnellate coprono ${formattaQuantita(Math.max(0, g.saldoComplessivoKg) / fattore)} ${um}).`
  con `elenco` = unità separate da `, `. Il messaggio non propone nessun carico. Senza unità non di massa il blocco con `RIMEDIO_CARICO_MANCANTE` resta com'è.

- [ ] **Step 1: test che falliscono:** postgres di `giacenzaDisponibileAl`: `riporta le unità non di massa dei carichi` (carico 5000 `LITRI` → `['LITRI']`); unitario dello use case: `scarico in kg con carichi solo in litri: registrato con avviso` (mock di giacenza `{ saldoComplessivoKg: 0, …, unitaNonDiMassaCaricate: ['LITRI'] }` → successo e `avvisi` con il testo esatto, nessun `Altro carico`); postgres dello use case: `carico 5.000 L e scarico 4.800 kg dello stesso CER: registrato con avviso`.
- [ ] **Step 2: vederli fallire.** Unitari con il comando jest; postgres: `DATABASE_URL=… npx prisma migrate deploy && DATABASE_URL=… JWT_SECRET=… npm run test:postgres -- giacenza-disponibile registra-movimento`.
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare.**
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(registro): scarico in kg di un CER caricato in litri o m³ registrato con un avviso, senza proporre un carico fittizio"`

---

### Task 9: un salvataggio stantio non riporta in vita un FIR annullato (C-C-03)

**Files:**
- Modify: `apps/backend/src/core/domain/errors.ts` (nuovo errore)
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts` (`conservaAnnullamentoEnte`, `:272-283`)
- Modify: `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts` (`save` dopo l'esito, `:192`; `catch (apiError)`, `:242`)
- Test: `fir-prisma.repository.postgres.spec.ts`, `fir-prisma.repository.spec.ts`, `application/rentri/sync-fir-to-rentri.use-case.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export class FirAnnullatoNelFrattempoError extends DomainError {
    constructor(firId: string) // `Il FIR ${firId} è stato annullato mentre era in corso un'altra operazione: il salvataggio non viene eseguito`
  }
  ```
- `conservaAnnullamentoEnte(client, firId, scalars)`: la `SELECT … FOR UPDATE` legge anche `status::text AS status`. Se la riga ha `status === 'CANCELLED'` e `scalars.status !== 'CANCELLED'` → `throw new FirAnnullatoNelFrattempoError(firId)`. Il ramo `'Annullato'` dell'ente resta com'è.
- Sync: il `save` della riga 192 si avvolge in `try/catch`; con `FirAnnullatoNelFrattempoError` si salva il log di sincronizzazione riuscito (l'ente ha il formulario), si scrive `logger.error('FIR annullato in locale durante la trasmissione: sull'ente esiste il formulario', { firId, protocolNumber: numeroFir })` e si restituisce `{ success: false, error: e.message, willRetry: false, attempts }`. Nel `catch (apiError)` la prima riga è `if (apiError instanceof FirAnnullatoNelFrattempoError) throw apiError` (niente secondo `save`).

- [ ] **Step 1: test che falliscono:** postgres `un save stantio non riporta in vita un FIR annullato` (FIR emesso caricato in un aggregate; un secondo aggregate lo annulla e salva; il `save` del primo → `rejects.toBeInstanceOf(FirAnnullatoNelFrattempoError)` e la riga resta `CANCELLED`); unitario della sync `la sync segnala il FIR annullato nel frattempo` (`firRepository.save` rifiutato con l'errore → risultato `{ success: false, willRetry: false }`, `logger.error` chiamato, `save` chiamato una volta sola).
- [ ] **Step 2: vederli fallire** (jest unitario + `npm run test:postgres -- fir-prisma`).
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare**, più `src/infrastructure/persistence/fir-prisma.repository.spec.ts`.
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(fir): un salvataggio con dati vecchi non riporta in vita un FIR annullato nel frattempo"`

---

### Task 10: peso a destino secondo il verso (C-W-01)

**Files:**
- Modify: `apps/frontend/src/app/features/registro/registro-fir.ts`, `registro.component.ts` (`onFirSelect`, patch di `quantity`/`unit`, `:1284-1293`)
- Test: `apps/frontend/src/app/features/registro/registro-fir.spec.ts`

**Interfaces:**
- Produces (`registro-fir.ts`):
  ```ts
  export function quantitaDaFir(fir: FIR, tipo: TipoMovimento, ruolo: RuoloFir | null):
    { quantita: number; unita: string; suggerimento: string | null }
  ```
  `unita = (fir.rifiuto.unitaMisura || 'KG').toUpperCase()`. Se `tipo === 'CARICO'`, `ruolo === 'DESTINATARIO'` e `fir.pesoEffettivo > 0`: `quantita = fir.pesoEffettivo`, `suggerimento = \`Quantità dal peso verificato a destino (${formattaQuantita(peso)} ${unita}); il FIR dichiarava ${formattaQuantita(dichiarata)} ${unita}.\``. In ogni altro caso `quantita = fir.rifiuto.quantita`, `suggerimento = null` (lo SCARICO del produttore riporta sempre la quantità di partenza; il peso verificato resta sul FIR come esito). `RuoloFir` è il tipo già restituito da `determinaRuolo` (se non è esportato, esportarlo dal punto in cui è definito).
- `onFirSelect` usa `quantitaDaFir` e aggiunge `suggerimento` in coda all'hint del ruolo, come già fa con `suggerimentoData`.

- [ ] **Step 1: test che falliscono:** `CARICO del destinatario con peso verificato usa il peso a destino`; `SCARICO del produttore usa la quantità dichiarata anche con il peso verificato`; `CARICO senza peso verificato usa la dichiarata`; `CARICO di ruolo non determinato usa la dichiarata`.
- [ ] **Step 2: vederli fallire.** `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/registro/registro-fir.spec.ts`
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare**, poi `npx tsc --noEmit -p tsconfig.app.json`.
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(registro): nella ricopia il carico del destinatario prende il peso verificato a destino, lo scarico del produttore la quantità di partenza"`

---

### Task 11: progressivo iniziale per azienda e anno (C-W-02)

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`; Create: `apps/backend/prisma/migrations/20261022100000_registro_progressivo_iniziale/migration.sql`
- Create: `apps/backend/src/application/registro/progressivo-iniziale.service.ts` (+ `.spec.ts`, `.postgres.spec.ts`)
- Create: `apps/backend/src/api/registro/dtos/progressivo-iniziale.dto.ts`
- Modify: `apps/backend/src/api/registro/registro.controller.ts`, `registro.module.ts`, `application/registro/use-cases/registra-movimento.use-case.ts` (calcolo di `nextProgressivo`)
- Modify: `apps/frontend/src/app/features/registro/registro.service.ts`, `registro.component.ts`; Test: `registro.service.spec.ts` (nuovo)

**Interfaces:**
- Schema (additivo):
  ```prisma
  model RegistroProgressivoIniziale {
    id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
    tenantId         String   @map("tenant_id") @db.Uuid
    anno             Int
    primoProgressivo Int      @map("primo_progressivo")
    motivo           String   @db.VarChar(500)
    impostatoDa      String   @map("impostato_da") @db.Uuid
    impostatoIl      DateTime @default(now()) @map("impostato_il")
    tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
    @@unique([tenantId, anno])
    @@map("registro_progressivi_iniziali")
  }
  ```
  con `registroProgressiviIniziali RegistroProgressivoIniziale[]` su `Tenant`; la migration aggiunge anche `CHECK (primo_progressivo >= 1)`.
- `ProgressivoInizialeService`:
  ```ts
  leggi(tenantId: string, anno: number): Promise<{ anno: number; primoProgressivo: number | null; impostatoIl: Date | null }>
  imposta(tenantId: string, anno: number, primoProgressivo: number, motivo: string, userId: string): Promise<{ anno: number; primoProgressivo: number }>
  ```
  `imposta`, in una `$transaction`: (1) `anno` deve essere `annoSolareItaliano(new Date())` o il successivo, altrimenti `BadRequestException('Il progressivo iniziale si imposta solo per l'anno in corso o per il prossimo.')`; (2) `pg_advisory_xact_lock(hashtext(${tenantId + '-' + anno}))`, **la stessa chiave** della numerazione; (3) se esiste già la riga: `ConflictException('Il progressivo iniziale del ${anno} è già stato impostato (${n}): non si può modificare.')`; (4) se esiste un movimento con `progressive_year = anno`: `ConflictException('Il registro del ${anno} ha già movimenti: il progressivo iniziale si imposta solo prima del primo movimento dell'anno.')`; (5) `create` + `activityLog.create({ action: 'REGISTRO_PROGRESSIVO_INIZIALE', description: \`Progressivo iniziale del registro ${anno} impostato a ${n}: ${motivo}\`, metadata: { anno, primoProgressivo, motivo } })`.
- DTO: `primoProgressivo` `@IsInt() @Min(1) @Max(9999999)`, `motivo` `@IsString() @Length(5, 500)`.
- Controller: `GET registro/progressivo-iniziale/:anno` e `PUT registro/progressivo-iniziale/:anno` (`@Roles('SUPER_ADMIN', 'ADMIN')`, `ParseIntPipe`), tenant con `requireRequestTenantId(req)`.
- Use case: dopo la `SELECT MAX(...)`, `const iniziale = await tx.registroProgressivoIniziale.findUnique({ where: { tenantId_anno: { tenantId, anno } }, select: { primoProgressivo: true } })`; `nextProgressivo = Math.max((row.max_num ?? 0) + 1, iniziale?.primoProgressivo ?? 1)`. Sotto lo stesso lock, quindi nessuna corsa con `imposta`.
- Frontend: `getProgressivoIniziale(anno)` (GET) e `impostaProgressivoIniziale(anno, primoProgressivo, motivo)` (PUT `{ primoProgressivo, motivo }`). Nel registro, solo per `ADMIN`/`SUPER_ADMIN` e solo se l'anno in corso non ha movimenti e non ha un iniziale: pulsante `Imposta il primo numero dell'anno` che apre un dialogo con il testo fisso `Serve solo a chi arriva da un altro programma a metà anno: il primo movimento registrato qui prenderà questo numero. Si imposta una volta sola.` e i campi `Primo numero` e `Motivo`.

- [ ] **Step 1: test che falliscono:** unitari del servizio (anno passato rifiutato, secondo tentativo 409, anno con movimenti 409, log scritto); postgres `primo movimento dopo l'impostazione prende il numero iniziale` (impostato 812 → primo movimento 812, secondo 813); postgres `impostazione e primo movimento concorrenti non producono numeri incoerenti` (`Promise.allSettled` su `imposta(…, 500, …)` e `execute(movimento)`, 5 giri su anni puliti: o il movimento è 500 e l'impostazione è riuscita, o il movimento è 1 e l'impostazione è stata rifiutata con 409); postgres della migration `le righe esistenti non cambiano`; unitario dello use case `senza progressivo iniziale la numerazione è quella di oggi`; frontend `registro.service.spec.ts` per GET e PUT.
- [ ] **Step 2: vederli fallire** (prima `npx prisma migrate deploy` sul DB di prova e `npx prisma generate`).
- [ ] **Step 3: implementare** schema, migration, servizio, DTO, controller, modulo, use case, frontend.
- [ ] **Step 4: vederli passare**, più `npx tsc --noEmit -p tsconfig.json` (backend) e `npx tsc --noEmit -p tsconfig.app.json` (frontend).
- [ ] **Step 5: commit** (schema, migration, file del servizio e spec, DTO, controller, modulo, use case, file frontend) `HUSKY=0 git commit -m "feat(registro): progressivo iniziale per azienda e anno, impostabile una volta prima del primo movimento"`

---

### Task 12: C-W-03 più movimenti dallo stesso FIR

Ruling del controller sulla ricerca `C-W-03-winwaste.md`: in Fase 0 si adattano schema e regole; i flussi dei gestori (produttori percentuali, microraccolta, spurghi multiluogo, carichi dopo trattamento) **non** si costruiscono, perché quei profili non sono ancora supportati.

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (`WasteMovement`, `:1743` e `:1758`); Create: `apps/backend/prisma/migrations/20261022110000_registro_ricopia_chiave/migration.sql`
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts` (`ricopiaEsistente` `:327-347`, create con `firIdRicopia` `:272`, gestione P2002 `:363-371`)
- Modify: `apps/backend/src/application/mud/aggregazione/mud-aggregazione.service.ts` (select dei movimenti e gruppo dei doppi)
- Test: `registra-movimento.use-case.postgres.spec.ts`, `registra-movimento.use-case.spec.ts`, `mud-aggregazione.service.spec.ts`

**Interfaces:**
- Schema: `ricopiaChiave String @default("") @map("ricopia_chiave") @db.VarChar(100)`; `@@unique([tenantId, firIdRicopia, type])` diventa `@@unique([tenantId, firIdRicopia, type, ricopiaChiave])`.
- Migration (additiva): `ALTER TABLE "waste_movements" ADD COLUMN "ricopia_chiave" VARCHAR(100) NOT NULL DEFAULT '';` poi `DROP INDEX "waste_movements_tenant_id_fir_id_ricopia_type_key";` e `CREATE UNIQUE INDEX "waste_movements_tenant_id_fir_id_ricopia_type_ricopia_chiave_key" ON "waste_movements"("tenant_id", "fir_id_ricopia", "type", "ricopia_chiave");`, con un commento che dice perché non può fallire (tutte le righe ricevono `''` e il vecchio indice garantiva già l'unicità).
- Use case: `export const RICOPIA_ORDINARIA = ''` con il commento sullo schema delle chiavi riservate (`''` ricopia ordinaria; `prod:<unitaLocaleId>` quota di un produttore percentuale; `cer:<cer>` carico generato da trattamento; `dett:<n>` dettaglio senza altra chiave; la chiave la impone il flusso, mai l'utente, e oggi nessun flusso ne usa una diversa da `''`). La ricerca idempotente diventa `where: { tenantId, firId, type, ricopiaChiave: RICOPIA_ORDINARIA }`, la create scrive `ricopiaChiave: RICOPIA_ORDINARIA`, la rilettura dopo P2002 aggiunge la stessa condizione. `giaRegistrato` e `FirGiaRegistratoError` restano identici.
- Aggregazione MUD: `ricopiaChiave` nella select; il gruppo dei doppi (oggi `` `${m.firId}|${m.type}` ``) diventa `` `${m.firId}|${m.type}|${m.ricopiaChiave}` `` (il Task 14 lo estende con il ruolo); `avviatiPerFir` (`FIR_SCARICATO_PIU_VOLTE`) resta per FIR.
- Lo stesso numero di FIR su un altro `firId` resta un avviso come oggi: nessun cambiamento.

- [ ] **Step 1: test che falliscono:** postgres `la migration lascia le righe esistenti con chiave vuota`; postgres `il retry idempotente della ricopia è invariato` (due `execute` uguali → un solo movimento, il secondo `giaRegistrato`; con dati diversi `FirGiaRegistratoError`); postgres `due movimenti dello stesso FIR e tipo con chiavi diverse sono ammessi dal database` (insert diretto con `ricopiaChiave: 'prod:a'` e `'prod:b'`, nessun P2002); aggregazione `due quote uguali con chiavi diverse contano entrambe` (due scarichi identici, stesso `firId`, `ricopiaChiave` `'prod:a'` e `'prod:b'` → `smaltimentoKg` doppio, nessun `FIR_DOPPIO_IDENTICO`).
- [ ] **Step 2: vederli fallire.**
- [ ] **Step 3: implementare**, poi `npx prisma generate`.
- [ ] **Step 4: vederli passare**, più `src/application/mud` e `src/application/registro` unitari.
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "feat(registro): chiave di ricopia nell'indice unico, per ammettere in futuro più movimenti dello stesso FIR senza cambiare la regola dei produttori"`

---

## Ondata A (MUD, Task 1-5)

### Task 13: ATECO a 6 cifre e una sola risoluzione del comune del dichiarante (A-W-01, A-C-02, A-C-01)

**Files:**
- Modify: `apps/backend/src/application/mud/aggregazione/mud-controlli.ts`, `mud-aggregazione.service.ts` (`:197-203`, `:416-419`), `export/mud-export.service.ts` (`:136-160`)
- Test: `mud-controlli.spec.ts`, `mud-aggregazione.service.spec.ts`, `export/mud-export.service.spec.ts`

**Interfaces:**
- `MudAggregato` aggiunge `dichiarante: { atecoNormalizzato: string | null; comuneCode: string | null }`.
- Aggregazione: `comune = tenant.city?.trim() && tenant.province?.trim() ? findComuneByName(city, province) : undefined`; `comuneCode = /^\d{6}$/.test(comune?.code ?? '') ? comune.code : null`; senza `comuneCode` → `dichiaranteSenzaComuneIstat(city, province)`. `atecoNormalizzato = atecoCode?.trim() ? normalizeAteco(atecoCode) : null`; vuoto → `dichiaranteSenzaAteco()`; non `/^\d{6}$/` → nuovo `dichiaranteAtecoNonValido(atecoCode)`.
- Catalogo: codice `DICHIARANTE_ATECO_NON_VALIDO`, BLOCCANTE, messaggio esatto:
  `Codice ATECO dell'azienda non valido ("{valore}"): nel MUD servono 6 cifre, senza punti (per esempio 381100). Correggerlo nell'anagrafica dell'azienda (Amministrazione > Aziende; se la voce non è visibile, chiederlo all'amministratore della piattaforma).`
- Export: `comuneCode: aggregato.dichiarante.comuneCode ?? undefined`, `atecoCode: aggregato.dichiarante.atecoNormalizzato ?? undefined`; la `findComuneByName` dell'export si toglie.

- [ ] **Step 1: test che falliscono:** catalogo (testo esatto); aggregazione `senza provincia il comune non si risolve e il file non esce` (`province: null` → `findComuneByName` non chiamato, `DICHIARANTE_SENZA_COMUNE_ISTAT`), `ATECO con i punti è normalizzato` (`'38.11.00'` → `atecoNormalizzato: '381100'`, nessun bloccante), `ATECO di 4 cifre blocca` (`'38.11'` → `DICHIARANTE_ATECO_NON_VALIDO`); export `il record AA porta l'ATECO senza punti` (aggregato con `atecoNormalizzato: '381100'` → AA contiene `;381100;`) e `l'export non rifà la ricerca del comune`.
- [ ] **Step 2: vederli fallire.** `… npx jest … src/application/mud`
- [ ] **Step 3: implementare**; aggiornare i mock di `aggrega` negli spec dell'export con `dichiarante`.
- [ ] **Step 4: vederli passare** (`src/application/mud` e `src/api/mud`).
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(mud): ATECO a 6 cifre senza punti e una sola risoluzione del comune del dichiarante, bloccante se incompleto"`

---

### Task 14: doppi dopo la classificazione e anche fuori dalla finestra dell'anno (A-C-03, A-C-05)

**Files:**
- Modify: `apps/backend/src/application/mud/aggregazione/mud-aggregazione.service.ts` (passo 0, `:235-258`; nuova query), `mud-controlli.ts`
- Test: `mud-aggregazione.service.spec.ts`, `mud-controlli.spec.ts`

**Interfaces:**
- Passo 0: si calcola prima `ruolo = classificaMovimento(type, causale)`; partecipano ai doppi solo i movimenti con `firId` e ruolo `PRODOTTO` o `AVVIATO`; gruppo `` `${firId}|${type}|${ricopiaChiave}|${ruolo}` `` (estende il gruppo del Task 12).
- Nuova query, solo se `firIds` non è vuoto: `prisma.wasteMovement.findMany({ where: { tenantId, firId: { in: firIds }, movementDate: { lt: inizio } }, select: <stessa select dei movimenti>, orderBy: [{ movementDate: 'asc' }, { progressiveNumber: 'asc' }] })`.
- Per ogni movimento dell'anno che partecipa ai doppi e non è già un doppio, i precedenti dello stesso gruppo (stesso ruolo calcolato):
  - se uno è uguale (`stessiDatiRicopia`, o senza data se entrambi hanno `firIdRicopia` nullo): il movimento dell'anno è **escluso** con `firDoppioAnnoPrecedente(fir, precedente, corrente)`;
  - altrimenti, se ce n'è almeno uno: il movimento resta incluso con `firScaricatoAncheAnnoPrecedente(fir, precedenti, corrente)`.
- Catalogo (AVVISO entrambi; `movimenti` contiene **solo** il movimento dell'anno, così i kg degli anni precedenti non entrano nel riepilogo):
  - `firDoppioAnnoPrecedente(fir: string, precedente: RifMovimento, m: RifMovimento)` → codice `FIR_DOPPIO_ANNO_PRECEDENTE`, `[m]` `incluso: false`, messaggio: `Il FIR {fir} risulta già scaricato con gli stessi dati nel movimento n. {p.n}/{p.anno}{ del GG/MM/AAAA}: il movimento n. {m.n}/{m.anno}{ del GG/MM/AAAA} è un doppio ed è escluso da questo MUD.`
  - `firScaricatoAncheAnnoPrecedente(fir: string, precedenti: RifMovimento[], m: RifMovimento)` → codice `FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE`, `[m]` `incluso: true`, messaggio: `Il FIR {fir} risulta scaricato anche in anni precedenti (n. {elenco precedenti}): il movimento n. {m.n}/{m.anno} è nel MUD. Verificare che non sia lo stesso conferimento dichiarato due volte.`
  (`{ del GG/MM/AAAA}` come in `firDoppioIdentico`: solo se `movementDate` c'è.)

- [ ] **Step 1: test che falliscono:** `una causale sbagliata e il conferimento sullo stesso FIR non sono doppi` (n.1 `ALTRO_SCARICO` 100 kg del 01/03, n.2 `CONFERIMENTO_TRASPORTATORE` 100 kg del 05/03, stesso FIR → `smaltimentoKg 100`, un `CAUSALE_ESCLUSA`, nessun `FIR_DOPPIO_IDENTICO`); `un doppio pre-piano C nell'anno dopo è escluso` (precedente n.812/2025 del 30/12/2025, corrente n.4/2026 del 03/01/2026, stessi dati, `firIdRicopia` nulli → MUD 2026 senza i 100 kg, `FIR_DOPPIO_ANNO_PRECEDENTE` con il movimento 4 `incluso: false`); `stesso FIR scaricato in due anni con dati diversi avvisa` (`FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE`, quantità inclusa); `la query dei precedenti porta tenantId e il limite dell'anno`; testi esatti nel catalogo.
- [ ] **Step 2: vederli fallire.**
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare** (`src/application/mud`).
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(mud): doppi cercati fra movimenti con lo stesso ruolo e anche negli anni precedenti"`

---

### Task 15: destinatario e trasportatore mancanti si completano nelle integrazioni (A-W-07, A-C-04, A-W-08)

**Files:**
- Modify: `apps/backend/src/application/mud/aggregazione/mud-integrazioni.ts`, `mud-controlli.ts`, `mud-aggregazione.service.ts` (`aggiungiDestinatario`, `completaRighe`)
- Test: `mud-integrazioni.spec.ts`, `mud-controlli.spec.ts`, `mud-aggregazione.service.spec.ts`

**Interfaces:**
- `IntegrazioniMud` aggiunge:
  ```ts
  destinatariMovimento: Record<string, { ragioneSociale: string; codiceFiscale: string }> // chiave = `${anno}/${numero}` del movimento
  trasportatori: Record<string, { ragioneSociale: string; codiceFiscale: string }>         // chiave = chiaveDestinatario(ragioneSociale)
  ```
  `INTEGRAZIONI_VUOTE` e `leggiIntegrazioni` (difensiva, stesse regole dei `destinatari`) di conseguenza; `export function chiaveMovimento(anno: number, numero: number): string`.
- `IntegrazioneRichiesta` aggiunge `{ tipo: 'DESTINATARIO_MOVIMENTO'; chiave: string; numero: number; anno: number }` e `{ tipo: 'CF_TRASPORTATORE'; chiave: string; ragioneSociale: string }`.
- Catalogo:
  - `destinatarioNonIndicato(m, anno)` diventa **BLOCCANTE**, `[m]` `incluso: true`, `integrazione: { tipo: 'DESTINATARIO_MOVIMENTO', chiave: chiaveMovimento(m.progressiveYear, m.progressiveNumber), numero, anno }`, messaggio: `Movimento n. {n}/{anno} (scarico CER {cer}, {q} {u}): né FIR né destinatario nel registro, e il modulo DR è obbligatorio. Inserire destinatario e codice fiscale in MUD > Integrazioni {annoDati}, riga "Movimento n. {n}/{anno}".`
  - nuovo `trasportatoreSenzaCf(ragioneSociale: string, fir: string, anno: number)`: codice `TRASPORTATORE_SENZA_CF`, BLOCCANTE, `integrazione: { tipo: 'CF_TRASPORTATORE', chiave: chiaveDestinatario(ragioneSociale), ragioneSociale }`, messaggio: `Trasportatore "{ragioneSociale}" (FIR {fir}): manca il codice fiscale o la partita IVA, obbligatori nel modulo TE. Inserirlo in MUD > Integrazioni {anno}, riga "{ragioneSociale}".`
  - nuovo `trasportatoreNonIndicato(m, fir: string)`: codice `TRASPORTATORE_NON_INDICATO`, AVVISO, `[m]` `incluso: true`, messaggio: `Movimento n. {n}/{anno} (CER {cer}): il FIR {fir} non indica il trasportatore, quindi per questo conferimento manca il modulo TE.`
  - `scaricoSenzaFir(m)`: il messaggio diventa `Movimento n. {n}/{anno} (scarico CER {cer}, {q} {u}): nessun FIR collegato; per il modulo DR si usa il destinatario scritto nel registro, e manca il modulo TE del trasportatore.`
- Aggregazione: senza FIR e senza `counterpartName`, se `integrazioni.destinatariMovimento[chiaveMovimento(…)]` c'è, il DR si crea da lì (`origine: ORIGINE_REGISTRO`, CF valorizzato, poi fuso per CF come gli altri); altrimenti `destinatarioNonIndicato`. TE: con FIR, `ragioneSociale = fir.carrierName?.trim() || \`trasportatore del FIR ${etichetta}\``; con CF vuoto si cerca `integrazioni.trasportatori[chiaveDestinatario(ragioneSociale)]`, altrimenti `trasportatoreSenzaCf` (uno per ragione sociale); FIR collegabile senza `carrierId`, `carrierPartitaIva` né `carrierName` → `trasportatoreNonIndicato`.

- [ ] **Step 1: test che falliscono:** `scarico senza destinatario blocca con la voce del movimento` (test 19 di oggi: atteso il bloccante con `integrazione` e nessun DR); `con il destinatario del movimento nelle integrazioni il BA è coerente` (stesso caso più `destinatariMovimento['2025/5']` → `dr` con il CF e `Σ dr.quantitaKg === smaltimentoKg + recuperoKg`); `TE senza CF blocca, con le integrazioni si completa`; `FIR senza trasportatore avvisa`; testi esatti del catalogo; `leggiIntegrazioni` con le due mappe nuove.
- [ ] **Step 2: vederli fallire.**
- [ ] **Step 3: implementare**; aggiornare le attese esistenti che usano `scaricoSenzaFir`/`destinatarioNonIndicato` (test di catalogo e aggregazione, test 19).
- [ ] **Step 4: vederli passare** (`src/application/mud`, `src/api/mud`).
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(mud): destinatario o trasportatore mancanti sono dati da integrare, così BA, DR e TE restano coerenti"`

---

### Task 16: giacenze al 31/12 quantificate e ripartizione R/D fra gli avvisi che cambiano le quantità (A-W-06, A-C-14)

**Files:**
- Modify: `apps/backend/src/application/mud/aggregazione/mud-controlli.ts` (`giacenzeNonCalcolate`, `riepilogaAvvisi`, nuova `avvisiCambianoQuantita`), `mud-aggregazione.service.ts` (`:397`), `export/mud-export.service.ts` (togliere la funzione locale `:40-49`)
- Test: `mud-controlli.spec.ts`, `mud-aggregazione.service.spec.ts`, `export/mud-export.service.spec.ts`

**Interfaces:**
- `MudEsitoControllo` aggiunge `kgNonDichiarati?: number`.
- `giacenzeNonCalcolate(anno: number, saldi: Array<{ cerCode6: string; kg: number }>)`: AVVISO, `kgNonDichiarati = Σ kg` arrotondato al grammo, messaggio: `Secondo il registro, al 31/12/{anno} risultano in deposito {totale} kg ({CER cerCanonico(cer6): kg}, separati da "; ") che il file non dichiara: le giacenze di fine anno nel file risultano zero.`
- Aggregazione: `prisma.wasteMovement.groupBy({ by: ['cerCode', 'type', 'unit'], where: { tenantId, movementDate: { lt: fine } }, _sum: { quantity: true } })`; per `chiaveConfrontoCer`, solo unità di massa (`normalizzaUnitaRegistro`, `convertiInKg`), carichi meno scarichi; l'avviso si aggiunge solo con almeno un CER a saldo `> 0.0005` (i soli CER positivi nell'elenco, ordinati per CER). Senza saldi positivi **nessun** avviso delle giacenze.
- `riepilogaAvvisi`: per voce, `kgEsclusi += Σ kgNonDichiarati`; `kgInMeno += Σ kgNonDichiarati` (senza deduplica: non sono movimenti). `RiepilogoAvvisi` aggiunge `cambianoQuantita: boolean` = una voce con `kgEsclusi > 0` o `kgAggiunti > 0`, o un AVVISO con un movimento `incluso: false`, o un AVVISO con codice in `CODICI_RIPARTIZIONE_RD = ['OPERAZIONE_NON_INDICATA', 'OPERAZIONE_DEDOTTA_DAL_FIR']` (esportata). Se `kgInMeno = kgInPiu = 0` e c'è un codice R/D, `testo` = `Il file dichiara le stesse quantità del registro, ma per alcuni scarichi il recupero o lo smaltimento non è indicato nel registro: verificare la ripartizione elencata sotto.`
- `export function avvisiCambianoQuantita(controlli: MudEsitoControllo[]): boolean` = `riepilogaAvvisi(controlli).cambianoQuantita`; l'export la importa (stessa regola dei 403, ruling del Task 5 del piano A).

- [ ] **Step 1: test che falliscono:** catalogo `le giacenze quantificate contano come kg in meno` (`giacenzeNonCalcolate(2025, [{ cerCode6: '170405', kg: 120 }])` → `riepilogaAvvisi` con `kgInMeno: 120`, `cambianoQuantita: true`); `gli avvisi R/D cambiano le quantità` (`operazioneNonIndicata(m)` da solo → `cambianoQuantita: true` e il testo esatto); `solo informativi: cambianoQuantita falso` (`scaricoSenzaFir`); aggregazione `saldo al 31/12 dal registro` (carico 200 + scarico 80 nel 2025 e carico 50 nel 2026 → avviso con 120 kg; `groupBy` chiamato con `tenantId` e `movementDate: { lt: fine }`) e `saldo zero: nessun avviso delle giacenze`; export `un avviso R/D riserva il file agli amministratori` (VIEWER → 403). Il test esistente `con avvisi solo informativi anche un VIEWER genera il file` passa a usare `scaricoSenzaFir` invece delle giacenze; ogni chiamata `giacenzeNonCalcolate(anno)` negli spec prende il secondo argomento.
- [ ] **Step 2: vederli fallire.**
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare** (`src/application/mud`, `src/api/mud`).
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(mud): giacenze al 31/12 quantificate dal registro e ripartizione R/D fra gli avvisi che cambiano le quantità"`

---

### Task 17: stato fisico dal registro (A-W-11)

**Files:**
- Modify: `apps/backend/src/application/mud/aggregazione/mud-aggregazione.service.ts` (select `wastePhysicalState`, accumulo per riga), `mud-controlli.ts`, `mud-regole.ts`
- Test: `mud-regole.spec.ts`, `mud-aggregazione.service.spec.ts`, `mud-controlli.spec.ts`

**Interfaces:**
- `mud-regole.ts`: `export function statoFisicoMud(valore: string | null | undefined): StatoFisico | null` — confronto senza maiuscole e spazi: `solido` → `SOLIDO_NON_POLVERULENTO`, `polvere`/`polverulento` → `SOLIDO_POLVERULENTO`, `fangoso` → `FANGOSO_PALABILE`, `liquido` → `LIQUIDO`, `gassoso` → `AERIFORME`, `misto` → `ALTRO`; altro o vuoto → `null`.
- Per riga: insieme degli stati non nulli dei movimenti **inclusi**. Uno solo → `riga.statoFisico`; nessuno → non valorizzato (default del tracciato, come oggi); più di uno → non valorizzato e avviso `statoFisicoNonUnivoco(cerCode6, stati)`: codice `STATO_FISICO_NON_UNIVOCO`, AVVISO, nessun movimento, messaggio `Il rifiuto CER {cerCode6} è registrato con stati fisici diversi ({stati separati da ", "}): il file indica "solido non polverulento". La divisione in più schede RIF non è ancora supportata.`
- `hashAggregato` non cambia: copre l'intera riga canonica (`mud-regole.ts`), quindi anche `statoFisico`; un cambio di stato fisico dopo la presentazione risulta come dato modificato, ed è corretto perché cambia il file.

- [ ] **Step 1: test che falliscono:** mappa di `statoFisicoMud` (`it.each`); `un CER tutto liquido esce liquido` (20 03 04 con peso specifico e `wastePhysicalState: 'Liquido'` → `statoFisico: 'LIQUIDO'`); `stati diversi avvisano`; testo esatto del catalogo.
- [ ] **Step 2: vederli fallire.**
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare.**
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(mud): stato fisico della scheda RIF preso dal registro, con un avviso se non è univoco"`

---

### Task 18: il ruolo che conta è quello nell'azienda selezionata (A-C-06)

**Files:**
- Modify: `apps/backend/src/api/me/membership.service.ts`, `apps/backend/src/api/mud/mud.controller.ts`, `apps/backend/src/application/mud/mud.module.ts` (import di `MeModule`)
- Test: `apps/backend/src/api/me/membership.service.spec.ts`, `apps/backend/src/api/mud/mud.controller.export.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type RuoloApplicativo = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER'
  // MembershipService
  ruoloEffettivo(utente: { id: string; role: string; tenantId?: string | null }, tenantId: string): Promise<RuoloApplicativo>
  ```
  Risoluzione, nello stesso ordine di `checkAccess`:
  1. `utente.role === 'SUPER_ADMIN'` → `'SUPER_ADMIN'`;
  2. `tenantId === utente.tenantId` (tenant primario) → `utente.role`;
  3. tenant di proprietà (`tenant.findFirst({ where: { id: tenantId, ownerUserId: utente.id } })`) → `utente.role`;
  4. associazione consulente valida (`associazioneValida(utente.id, tenantId)`, `select: { role: { select: { name: true } } }`) → `ADMIN` se `role.name === 'ADMIN'`, `OPERATOR` se `'OPERATOR'`, `VIEWER` per ogni altro nome (`CONSULTANT`, `COMPLIANCE_OFFICER`, ruoli personalizzati);
  5. discesa gerarchica: se il tenant ha `parentTenantId`, il ruolo effettivo sulla madre (un solo passo, come `checkAccess`);
  6. altrimenti `'VIEWER'` (fail-closed; non dovrebbe accadere, perché il `TenantSwitchInterceptor` scarta un header non autorizzato).
  Un valore di `utente.role` fuori da `RuoloApplicativo` vale `'VIEWER'`.
- Controller: `MudController` riceve `MembershipService` come **ultimo** parametro del costruttore; in `exportTelematico`, `const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)` e il servizio riceve `{ id: req.user.id, role: ruolo }` (firma del servizio invariata). Perché qui e non in un guard: `RolesGuard` gira prima del `TenantSwitchInterceptor` globale e non vede l'azienda selezionata.
- Follow-up di sicurezza (non in questo task): elencare nella PR, sezione "Fuori ambito", gli endpoint con `@Roles(` (`git grep -n "@Roles(" -- apps/backend/src/api`) che decidono sul ruolo globale, e i controller che usano `user.tenantId` invece di `requireRequestTenantId` (per esempio `registro.controller.ts`, `registra` e `lista`).

- [ ] **Step 1: test che falliscono:** `membership.service.spec.ts`, un caso per ciascun punto 1-6 (in particolare `consulente ADMIN del proprio studio associato come CONSULTANT vale VIEWER`, `associazione ADMIN vale ADMIN anche per un utente globale VIEWER`, `figlia di un'azienda associata: ruolo della madre`); controller `un consulente con ruolo di sola consultazione nell'azienda selezionata riceve 403` (membership finto che restituisce `'VIEWER'`, servizio reale con un aggregato che ha avvisi quantitativi → `ForbiddenException`) e `passa al servizio il ruolo effettivo, non quello del token`.
- [ ] **Step 2: vederli fallire.** `… npx jest … src/api/me/membership.service.spec.ts src/api/mud`
- [ ] **Step 3: implementare**; aggiornare le costruzioni di `MudController` negli spec con un ultimo argomento.
- [ ] **Step 4: vederli passare**, più `src/application/mud/mud.module.spec.ts` (il modulo deve risolvere `MembershipService`) e `npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "fix(mud): la conferma degli avvisi dipende dal ruolo nell'azienda selezionata, anche per i consulenti"`

---

### Task 19: flag "MUD non dovuto" per azienda (A-W-10)

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (`Tenant`); Create: `apps/backend/prisma/migrations/20261022120000_tenant_mud_non_dovuto/migration.sql`
- Create: `apps/backend/src/application/mud/mud-obbligo.service.ts` (+ `.spec.ts`), `apps/backend/src/api/mud/dtos/obbligo-mud.dto.ts`
- Modify: `apps/backend/src/api/mud/mud.controller.ts`, `application/mud/mud.module.ts`, `aggregazione/mud-aggregazione.service.ts`, `aggregazione/mud-controlli.ts`
- Test: `apps/backend/src/api/mud/mud.controller.obbligo.spec.ts` (nuovo), `mud-aggregazione.service.spec.ts`, `mud-controlli.spec.ts`

**Interfaces:**
- Schema (additivo): su `Tenant` `mudNonDovuto Boolean @default(false) @map("mud_non_dovuto")`, `mudNonDovutoMotivo String? @map("mud_non_dovuto_motivo") @db.VarChar(500)`, `mudNonDovutoIl DateTime? @map("mud_non_dovuto_il")`, `mudNonDovutoDa String? @map("mud_non_dovuto_da") @db.Uuid`.
- `MudObbligoService`:
  ```ts
  export interface ObbligoMud { mudNonDovuto: boolean; motivo: string | null; impostatoIl: Date | null; impostatoDa: string | null }
  leggi(tenantId: string): Promise<ObbligoMud>
  imposta(tenantId: string, userId: string, mudNonDovuto: boolean, motivo: string | null): Promise<ObbligoMud>
  ```
  `imposta`: con `mudNonDovuto: true` il motivo è obbligatorio (5-500 caratteri, `BadRequestException('Indicare il motivo per cui l'azienda non è tenuta al MUD.')`); con `false` motivo, data e utente tornano `null`. Aggiorna il tenant (`where: { id: tenantId }`) e scrive `activityLog.create({ action: 'MUD_OBBLIGO_MODIFICATO', description: mudNonDovuto ? \`Azienda segnata come non tenuta al MUD: ${motivo}\` : 'Azienda di nuovo tenuta al MUD', metadata: { prima, dopo } })` nella stessa `$transaction`.
- DTO: `@IsBoolean() mudNonDovuto`, `@IsOptional() @IsString() @MaxLength(500) motivo?`.
- Controller: `MudObbligoService` è il quarto parametro del costruttore, dopo `MembershipService` (ordine finale dopo questo piano: `mudGenerator`, `mudExport`, `membership`, `obbligo`; i Task 8 e 10 del piano A aggiungono in coda `presentazione` e `integrazioni`). `GET mud/obbligo` → `leggi`; `PUT mud/obbligo` → solo se `membership.ruoloEffettivo(req.user, tenantId)` è `ADMIN` o `SUPER_ADMIN`, altrimenti `ForbiddenException({ message: 'Solo un amministratore dell\'azienda può modificare l\'obbligo del MUD.', error: 'MUD_OBBLIGO_RISERVATO_AMMINISTRATORI' })` (Task 18).
- Aggregazione: `tenant.findUnique` seleziona anche `mudNonDovuto` e `mudNonDovutoMotivo`; `MudAggregato.mudNonDovuto: boolean`; con il flag, avviso `mudNonDovuto(motivo)`: codice `MUD_NON_DOVUTO`, AVVISO, nessun movimento, messaggio `L'azienda è segnata come non tenuta alla presentazione del MUD ({motivo}): il file si può generare comunque, ma promemoria e scadenze del MUD sono disattivati.`
- Promemoria e scadenze: li sopprime il Task 7 del piano A (emendato con questo flag). Pagina MUD (tag e interruttore): Task 9 del piano A, emendato.

- [ ] **Step 1: test che falliscono:** servizio (motivo obbligatorio, log con prima e dopo, `false` azzera); controller (`un OPERATOR riceve 403`, `un ADMIN imposta il flag`, `GET aperto a tutti`); aggregazione (`azienda non tenuta: avviso e mudNonDovuto true`); testo esatto del catalogo; migration applicata sul DB di prova senza cambiare le righe esistenti (`mud_non_dovuto` falso per tutte).
- [ ] **Step 2: vederli fallire** (dopo `npx prisma migrate deploy` e `npx prisma generate`).
- [ ] **Step 3: implementare.**
- [ ] **Step 4: vederli passare** (`src/application/mud`, `src/api/mud`, `mud.module.spec.ts`, `tsc`).
- [ ] **Step 5: commit** `HUSKY=0 git commit -m "feat(mud): flag per azienda «MUD non dovuto», impostato da un amministratore e tracciato"`

---

## Verifica finale (dopo il Task 19)

- [ ] `bash ops/test/backup-verifica.test.sh` e `PG_EXEC="docker exec -i wasteflow-pg-test" bash ops/test/backup-verifica.test.sh`: falliti 0.
- [ ] Backend: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit src/application/mud src/api/mud src/api/me src/application/registro src/application/anomaly src/infrastructure/jobs src/application/admin/system-health src/core/monitoring src/core/time src/infrastructure/pdf src/infrastructure/persistence/fir-prisma.repository.spec.ts src/application/rentri`: PASS.
- [ ] `TZ=UTC` … `src/application/notifications/deadline-checker.service.spec.ts`: PASS.
- [ ] Postgres: `npx prisma migrate deploy` poi `npm run test:postgres -- registra-movimento giacenza-disponibile fir-prisma progressivo-iniziale mud-report-data`: PASS.
- [ ] `npx tsc --noEmit -p tsconfig.json` (backend) e, nel frontend, `npx tsc --noEmit -p tsconfig.app.json` più Karma su `registro-fir.spec.ts` e `registro.service.spec.ts`: PASS.
- [ ] `git grep -n "toLocaleString('it-IT')\|toLocaleDateString('it-IT')" -- apps/backend/src/infrastructure/pdf/pdf.service.ts`: restano solo le righe dei numeri del PDF MUD (riscritte dal Task 6 del piano A).
- [ ] `grep -n "DROP DATABASE" ops/restore.sh`: compare solo il drop del database temporaneo `*_ripristino_*`, mai quello di produzione.
- [ ] Poi si riprende il piano A dal Task 6, nel testo emendato.

## Cosa vede l'utente (da unire al riepilogo della PR)

- Il registro di un impianto propone come quantità del carico il peso verificato a destino; il produttore continua a scaricare la quantità di partenza.
- Chi arriva da un altro programma a metà anno può impostare, una sola volta e prima del primo movimento, il numero da cui riparte il registro.
- Uno scarico in kg di un rifiuto caricato in litri o m³ si registra con un avviso invece di essere bloccato.
- Nel MUD: ATECO a 6 cifre, destinatario e trasportatore mancanti da completare nelle integrazioni, giacenze di fine anno quantificate, stato fisico dal registro, conferma riservata a chi è amministratore nell'azienda selezionata, possibilità di segnare l'azienda come non tenuta al MUD.

## Fuori ambito (follow-up espliciti)

- **Flussi dei gestori dei rifiuti** (C-W-03): produttori percentuali (quote `prod:<unitaLocaleId>`), microraccolta master/dettagli, spurghi multiluogo, carichi dopo trattamento (`cer:<cer>`), con master e dettagli nella stessa transazione e `movimentoPadreId`, `ricopiaTipo` (`ORDINARIA | QUOTA_PRODUTTORE | DETTAGLIO | TOTALE`) ed esclusione del totale dal MUD, `Idempotency-Key` del client per le registrazioni multiple, `FIR_SCARICATO_PIU_VOLTE` per chiave.
- **Punti aperti della ricerca C-W-03** (`C-W-03-winwaste.md` §3, "Incognite"): se la ricopia F6 di WinWaste esclude i FIR già `C7 = 'R'`; la query di "Cerca formulari duplicati"; il significato di TIP+OPE 52 e del ricarico `($$PARTENZA$$)`; se le percentuali devono sommare 100; quantità e trattamento MUD dei dettagli spurgo (`QCAT` `Z3`); cosa succede ai dettagli quando si modifica o cancella il master.
- **Ruolo globale negli altri endpoint** (A-C-06): `@Roles` e `user.tenantId` nei controller elencati nella PR.
- D-W-04 (conservazione oltre 30 giorni) e D-W-06 (backup di Keycloak): da decidere con il piano infrastruttura.
- Tutte le obiezioni medie e minori non elencate nella sezione 1 dell'esito, con il loro id, nella sezione "Fuori ambito" della PR (D-C-08…D-C-18, D-W-02, D-W-07, D-W-09, D-W-10, C-C-04…C-C-10, C-W-04…C-W-11, A-C-08…A-C-13, A-W-14…A-W-18).
- Esclusione dal TE del trasporto in proprio (A-W-08 punto a), da far confermare a un consulente.
