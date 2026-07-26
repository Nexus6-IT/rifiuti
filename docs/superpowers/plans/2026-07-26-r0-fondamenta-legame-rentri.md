# R0 — Fondamenta del legame FIR ↔ RENTRI: piano di implementazione

> **Per agenti esecutori:** SUB-SKILL RICHIESTA: `superpowers:subagent-driven-development`. I passi usano checkbox (`- [ ]`).

**Obiettivo:** rendere possibile ciò che oggi non lo è — che un formulario di WasteFlow sia legato al corrispondente formulario su RENTRI — costruendo il modello dati che manca e collegando il sottosistema già scritto e mai cablato.

**Architettura:** nessuna funzionalità nuova visibile all'utente in questa fase. R0 posa le fondamenta: campi dati, metodi di dominio, persistenza reale, cablaggio DI. Alla fine gli endpoint oggi a 404 rispondono, e il ciclo di trasmissione è percorribile end-to-end contro l'oracolo.

**Stack:** NestJS 10, Prisma, BullMQ, Jest.

## Vincoli globali

- **Italiano** in messaggi utente, commenti e documentazione; identificatori di codice in inglese, **salvo i termini di dominio RENTRI** (`numero_fir`, `transazione_id`, `num_iscr_sito`), che restano identici alla specifica.
- **Prettier** sui file toccati prima di ogni commit: un solo errore di formattazione blocca il gate di rilascio (successo tre volte il 2026-07-25).
- Suite backend: baseline **101 suite / 911 test verdi** (più 3 suite / 7 test `test:oracolo`). Non deve calare.
- Commit in italiano, **senza attribuzione ad AI**.
- **Nessuna dichiarazione di conformità** che l'oracolo non possa sostenere: la fake accetta qualunque corpo, quindi i modelli dati di scrittura restano non validati (vedi `docs/contracts/rentri/FEDELTA.md`).

## Stato di partenza accertato (verificato, 2026-07-26)

**Otto pezzi del sottosistema sono orfani** — nessuno registrato in alcun `@Module`:
`SyncFIRToRENTRIUseCase`, `TriggerBatchSyncUseCase`, `GetSyncStatusUseCase`, `RENTRISyncQueue`, `RENTRISyncJobProcessor`, `RENTRISyncLogRepository`, `FIRConsegnatoHandler`, `RENTRISyncController` (5 endpoint → 404).

**Lo use case non può funzionare così com'è:**
- dichiara tre dipendenze come `any` con il commento «will be injected» (`sync-fir-to-rentri.use-case.ts:37-43`);
- invoca **otto metodi che non esistono** sull'aggregate FIR: `canSyncToRENTRI`, `startRENTRISync`, `markRENTRISynced`, `markRENTRISyncFailed`, `needsRENTRIRetry`, `getNextRENTRIRetryAt`, più `getDomainEvents`/`clearDomainEvents`.

**La persistenza non esiste:**
- `rentri-sync-log.repository.ts` ha **tutte le chiamate Prisma commentate**: è uno stub;
- nello schema **non esiste alcun modello** per i log di sincronizzazione;
- `fir-prisma.repository.ts` **non tocca nessuno** dei sei campi `rentri*` del FIR;
- **nessuno in tutto il codice scrive `rentriProtocolNumber`**, che per giunta conterrebbe il `transazione_id` e non il numero ufficiale.

**Ciò che invece funziona e va riusato:** `RENTRIApiClient` è conforme al contratto, validato contro l'oracolo (pipeline P2) ed è **già fornito** da `RentriModule`, importato in `app.module`. Espone `creaFormulario(...)` → `{ transazioneId, urlStato }` e `attendiEsito(...)` → `{ errore, validazione }`.

---

### Task 1: Il modello dati del legame

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/<timestamp>_legame_rentri/migration.sql`

**Interfaces:**
- Produce sul modello `FIR`: `rentriNumeroFir` (String?, il **numero ufficiale** assegnato dall'ente, chiave stabile del legame), `rentriTransazioneId` (String?, identificativo tecnico dell'ultima trasmissione), `rentriOrigineLegame` (enum).
- Produce sul modello `Tenant`: `rentriModalitaLegame` (enum, default da decidere nello Step 2).
- Produce il modello `RentriSyncLog`.

- [ ] **Step 1: Leggere prima di scrivere**

Esamina come sono dichiarati gli altri enum e le altre relazioni nello schema, e le convenzioni di `@map` (snake_case sul DB, camelCase in TypeScript). **Segui quelle convenzioni**, non introdurne di nuove.

Verifica anche cosa si aspetta `rentri-sync-log.repository.ts` nelle sue chiamate commentate: i campi del modello devono soddisfare quel repository, altrimenti al Task 3 non potrai de-stubbarlo.

- [ ] **Step 2: Decidere il default della modalità per tenant, e motivarlo**

Le tre modalità decise dal committente sono **automatica**, **ibrida** (trasmissione automatica, aggancio confermato dall'utente) e **manuale**. Devi scegliere il **default per un tenant nuovo** e motivarlo nel report.

Considera che si tratta di un adempimento normativo con conseguenze legali, che nessun tenant ha oggi un certificato RENTRI valido configurato, e che una trasmissione automatica verso l'ente da parte di un'azienda che non se l'aspetta è peggio di una mancata trasmissione. **Non scegliere il default più comodo: scegli quello più difendibile.**

- [ ] **Step 3: Definire `rentriOrigineLegame`**

Deve distinguere almeno: legame nato da una **nostra trasmissione**, da **acquisizione di un formulario altrui**, da **aggancio manuale** dell'operatore. Serve perché cambia cosa l'utente può fare dopo e conta in caso di contestazione.

- [ ] **Step 4: Generare la migrazione e leggerla**

```bash
cd apps/backend && npx prisma migrate dev --name legame_rentri --create-only
```

**Leggi il SQL generato riga per riga** prima di applicarlo: nessun `DROP`, nessun `TRUNCATE`, nessuna colonna resa obbligatoria su tabelle che contengono già dati in produzione. Se Prisma propone qualcosa di distruttivo, fermati e segnalalo. Incolla il SQL nel report.

- [ ] **Step 5: Applicare e verificare su database reale**

```bash
docker compose up -d postgres
cd apps/backend && npx prisma migrate deploy && npx prisma generate
```

Verifica con una query che le colonne esistano e che i dati preesistenti siano intatti.

- [ ] **Step 6: Commit**

---

### Task 2: I metodi di dominio sull'aggregate FIR

**Files:**
- Modify: l'aggregate FIR del ciclo di vita — `apps/backend/src/domain/fir/aggregates/fir.aggregate.ts`
- Test: la spec corrispondente

**Attenzione, nodo architetturale noto:** esistono **due aggregate FIR paralleli** (vedi `docs/superpowers/plans/2026-07-25-p3-firma.md`). Quello del ciclo di vita è `domain/fir/aggregates/fir.aggregate.ts` ed è il tuo bersaglio. Non toccare `domain/fir/fir.aggregate.ts` (sottosistema crittografico) e **non unificarli**: è un refactoring di natura diversa.

**Interfaces:** implementa i metodi che `sync-fir-to-rentri.use-case.ts` già invoca — leggilo per ricavarne le firme esatte e la semantica attesa:
`canSyncToRENTRI()`, `startRENTRISync()`, `markRENTRISynced(...)`, `markRENTRISyncFailed(...)`, `needsRENTRIRetry()`, `getNextRENTRIRetryAt()`.

- [ ] **Step 1: Scrivere i test che falliscono**

Un test per ciascuna regola, e le regole vanno **decise e motivate**, non improvvisate:
- quando un FIR **può** essere trasmesso (quale stato del ciclo di vita? un FIR in bozza non deve poter finire su RENTRI);
- cosa succede se si tenta di trasmettere due volte;
- come si comporta il conteggio dei tentativi e il calcolo del prossimo ritentativo (backoff), coerente con quanto già fa il client per il 429;
- che `markRENTRISynced` registri il **numero ufficiale** e non il solo identificativo di transazione.

- [ ] **Step 2: Eseguire e verificare il fallimento**

- [ ] **Step 3: Implementare**

- [ ] **Step 4: Eseguire i test e la suite completa**

- [ ] **Step 5: Commit**

---

### Task 3: La persistenza — mappare i campi e de-stubbare il log

**Files:**
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts`
- Modify: `apps/backend/src/infrastructure/persistence/rentri-sync-log.repository.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

Salva un FIR con i dati di legame RENTRI valorizzati, **rileggilo dal repository**, verifica che tornino tutti. È lo stesso tranello già incontrato con le firme: mappare la scrittura e dimenticare la lettura fa passare il test di scrittura e lascia il difetto identico.

- [ ] **Step 2: Mappare i campi `rentri*` nel repository FIR**

Oggi il repository non ne tocca nessuno. Vanno mappati in scrittura **e** in lettura.

- [ ] **Step 3: De-stubbare il repository dei log**

`rentri-sync-log.repository.ts` ha tutte le chiamate Prisma commentate. Attivale contro il modello creato nel Task 1. Se qualche metodo non ha un corrispettivo sensato nel modello, **fermati e segnalalo** invece di inventare campi.

- [ ] **Step 4: Verificare su database reale**

Non basta il test con la finta: usa Postgres vero (`docker compose up -d postgres`) e mostra il record realmente scritto. Incolla l'esito.

- [ ] **Step 5: Commit**

---

### Task 3-bis: Far emergere il numero ufficiale dall'esito

**Scoperto durante l'esecuzione del Task 2 e verificato sul contratto (2026-07-26).**

Il numero ufficiale **viene restituito dall'ente**, ma annidato: `EsitoFormularioModel` espone `esito` come `oneOf`, che per una creazione risolve in **`EsitoNuovoFormularioModel`**, il quale contiene `numero_fir`. Il livello superiore ha solo `esito`, `tipo`, `transazione_id`, `validazione`, `errore`, `tempo_elaborazione`.

Il nostro client però lo **scarta**: `attendiEsito` in `rentri-api.client.ts` restituisce un `EsitoFormulario` modellato come `{ errore, validazione }`, senza il payload `esito`. Di conseguenza lo use case non ha modo di conoscere il numero e chiama `markRENTRISynced` passando la `transazione_id` — che è la causa dell'incoerenza rilevata nel Task 2.

**Files:**
- Modify: `apps/backend/src/infrastructure/rentri/rentri-api.client.ts`
- Modify: `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts`

- [ ] **Step 1: Leggere il contratto prima di tipizzare**

`EsitoNuovoFormularioModel` e gli altri membri del `oneOf` in `docs/contracts/rentri/formulari.yaml`. Il tipo deve riflettere il contratto, non una comodità: `esito` è polimorfo e il `numero_fir` esiste **solo** nella variante di creazione.

- [ ] **Step 2: Scrivere il test**

Contro l'oracolo (`*.oracolo.spec.ts`): completando una transazione con un esito che contiene `numero_fir`, il client deve restituirlo. E il caso negativo: un esito **senza** `numero_fir` non deve produrre un legame — meglio nessun legame che uno inventato.

**Nota:** la fake accetta qualunque corpo (riserva nota in `FEDELTA.md`), quindi il test dimostra che il client **legge** correttamente ciò che riceve, non che l'ente restituisca davvero quella forma. Dichiaralo nel report: è una conformità di lettura, non di contratto.

- [ ] **Step 3: Correggere la chiamata nello use case**

`markRENTRISynced` deve ricevere il **numero ufficiale** in prima posizione, come previsto dal modello dati. Se il numero non è disponibile nell'esito, la trasmissione **non** va marcata come legata.

- [ ] **Step 4: Commit**

---

### Task 4: Il cablaggio

È il cuore di R0: qui il sottosistema smette di essere codice morto.

**Files:**
- Modify: `apps/backend/src/infrastructure/rentri/rentri.module.ts` (o un modulo dedicato, motivando la scelta)
- Modify: `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts` (dipendenze `any` → tipi reali)
- Modify: `apps/backend/src/app.module.ts` se necessario

- [ ] **Step 1: Sostituire le dipendenze `any` con quelle reali**

`firRepository`, `rentriApiClient`, `syncLogRepository` sono dichiarati `any` con «will be injected». Vanno tipizzati e iniettati per davvero, con i token di injection corretti — nel progetto è ricorrente il caso di repository iniettati per interfaccia senza `@Inject(token)`, che fallisce solo a runtime.

- [ ] **Step 2: Registrare gli otto pezzi orfani**

`SyncFIRToRENTRIUseCase`, `TriggerBatchSyncUseCase`, `GetSyncStatusUseCase`, `RENTRISyncQueue`, `RENTRISyncJobProcessor`, `RENTRISyncLogRepository`, `FIRConsegnatoHandler`, `RENTRISyncController`.

Procedi **uno alla volta**, verificando dopo ciascuno che il modulo si componga ancora: registrarli tutti insieme rende impossibile capire quale rompe cosa. Attenzione, in questo progetto si sono già visti: `CqrsModule` mai importato, dipendenze da `AuthModule`, e **temporal dead zone** su DTO dichiarate dopo il controller che le usa.

- [ ] **Step 3: Verificare che il modulo si componga senza infrastruttura**

Un test di wiring DI che compili il modulo. **Attenzione:** questo sottosistema apre connessioni Redis/Bull e un `Test.createTestingModule` ingenuo **si blocca** — è già successo. Fornisci finte per le dipendenze infrastrutturali o isola il modulo, e documenta il metodo usato.

- [ ] **Step 4: Verificare che gli endpoint rispondano**

I cinque endpoint di `RENTRISyncController` oggi danno 404. Avvia il backend con i container di sviluppo e verifica che rispondano — **401 senza token è l'esito corretto**, 404 significa che il cablaggio non ha funzionato. Incolla gli esiti reali.

- [ ] **Step 5: Sorvegliare l'autorizzazione**

Questi endpoint scrivono verso un ente pubblico. Verifica **quali guard montano** e chi può invocarli: se non hanno `RolesGuard`, va aggiunto. Un VIEWER non deve poter trasmettere formulari a RENTRI. Riporta la scelta e la verifica.

- [ ] **Step 6: Commit**

---

### Task 5: Il ciclo end-to-end contro l'oracolo

**Files:**
- Create: `apps/backend/src/infrastructure/rentri/rentri-sync.oracolo.spec.ts`

**Nota sull'esecuzione:** le spec `*.oracolo.spec.ts` sono escluse dalla suite unitaria ed eseguite da `npm run test:oracolo` (config `jest.oracolo.config.js`), perché richiedono le dipendenze di `tools/rentri-fake` che `npm ci` alla radice non installa — `tools/*` non è un workspace. La CI le esegue in un passo dedicato.

- [ ] **Step 1: Scrivere il test**

Il ciclo completo con la fake in-process: un FIR nel giusto stato → trasmissione → 202 con `transazione_id` → polling (200, poi **303**) → esito → **il FIR riletto dal repository porta il numero ufficiale e lo stato corretto**.

L'ultimo passaggio è il punto: non basta che la chiamata riesca, deve **restare scritto**.

Ricorda: la CA della fake è memoizzata per processo, quindi serve un certificato emesso da quella CA con la fake istanziata in-process; ogni chiamata richiede un JWT nuovo perché il registro anti-replay rifiuta un `jti` riusato.

- [ ] **Step 2: Aggiungere il caso negativo**

Con un guasto iniettato (`POST /__controllo/guasto` con 403), la trasmissione **fallisce e il FIR non risulta legato**: nessun numero ufficiale scritto, stato di errore leggibile. Un legame scritto su una trasmissione fallita sarebbe peggio di nessun legame.

- [ ] **Step 3: Eseguire**

```bash
docker compose up -d rentri-fake
cd apps/backend && npm run test:oracolo
```

- [ ] **Step 4: Commit**

---

## Criteri di completamento di R0

- [ ] Il FIR ha un campo per il **numero ufficiale RENTRI**, distinto dall'identificativo di transazione, e viene scritto quando la trasmissione riesce.
- [ ] Ogni azienda ha una modalità di legame (automatica / ibrida / manuale) con un default motivato.
- [ ] I log di sincronizzazione sono realmente persistiti, non più uno stub.
- [ ] Gli otto pezzi orfani sono cablati; i cinque endpoint rispondono (401 senza token, non 404).
- [ ] Le scritture verso RENTRI sono protette da un controllo di ruolo.
- [ ] Il ciclo end-to-end contro l'oracolo passa, **e il legame sopravvive alla rilettura**.
- [ ] Il caso negativo non lascia legami spuri.
- [ ] Suite backend ≥ 101 suite / 911 test, più `test:oracolo` verde.

## Ciò che R0 **non** fa

Nessuna interfaccia utente: il badge e i log restano orfani fino a R1, e le modalità di legame non hanno ancora una schermata di configurazione. R0 rende il legame **possibile**; R1 lo rende **visibile e governabile**.
