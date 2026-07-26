# Audit — legame discrezionale FIR ⇄ RENTRI (stato attuale del codice)

Data: 2026-07-26. Branch: `develop`. Ambito: solo lettura del codice, nessuna modifica.

## (a) Risposta secca

**No.** Oggi non esiste alcuna via — né manuale né automatica — per far corrispondere a scelta di un operatore un FIR del gestionale a un formulario RENTRI, in nessuno dei due versi. L'unico canale pensato per popolare il legame è la sincronizzazione automatica (`SyncFIRToRENTRIUseCase`), ma il controller REST che la espone, il job che la esegue e l'handler che dovrebbe innescarla **non sono registrati in nessun modulo NestJS**: sono codice compilabile e testato in isolamento (via mock), ma irraggiungibile a runtime. In più, il campo che verrebbe scritto (`rentriProtocolNumber`) non è il "numero FIR RENTRI" ufficiale ma il `transazione_id` della chiamata REST — un identificativo tecnico di trasmissione, non l'identificativo del formulario lato ente.

## (b) Evidenza dettagliata

### 1. Il modello dati

`apps/backend/prisma/schema.prisma:283-288`, sul modello `FIR`:

```prisma
rentriSyncStatus     RENTRISyncStatus @default(PENDING) @map("rentri_sync_status")
rentriProtocolNumber String?          @map("rentri_protocol_number") @db.VarChar(100)
rentriSyncedAt       DateTime?        @map("rentri_synced_at")
rentriSyncAttempts   Int              @default(0) @map("rentri_sync_attempts")
rentriLastSyncError  String?          @map("rentri_last_sync_error") @db.Text
rentriNextRetryAt    DateTime?        @map("rentri_next_retry_at")
```

`RENTRISyncStatus` (righe 326-334): `PENDING | SYNCING | SYNCED | FAILED | PERMANENTLY_FAILED`.

**Cosa rappresenta davvero `rentriProtocolNumber`.** Il commento nel codice che lo scrive è esplicito — `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts:101-106`:

```
// Successo - il contratto non restituisce un "protocolNumber"
// dedicato per questo sottoinsieme di EsitoFormularioModel: si usa
// la transazione_id come riferimento della trasmissione riuscita.
fir.markRENTRISynced(transazioneId, correlationId)
```

Quindi `rentriProtocolNumber` **non è** il `numero_fir` che RENTRI assegna al formulario ufficiale: è il `transazione_id` restituito dal `POST` asincrono (202) al momento dell'invio (righe 96-100, ciclo `creaFormulario` → `attendiEsito`). Non esiste nello schema né nel codice un campo dedicato a `numero_fir` (il numero FIR ufficiale RENTRI) né a `transazione_id` con nome proprio — quest'ultimo viene semplicemente riversato dentro `rentriProtocolNumber`, sovrapponendo due concetti diversi (identificativo di trasmissione vs. identificativo del formulario presso l'ente).

Non esiste inoltre alcun campo per un riferimento RENTRI inserito manualmente (es. `rentriManualReference`, `rentriFormularioId` distinto dal transazione_id).

### 2. Chi popola quei campi — raggiungibilità

Punti di scrittura di `rentriProtocolNumber`/`rentriSyncStatus` nel dominio:
- `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts:106` — `fir.markRENTRISynced(transazioneId, correlationId)` (successo)
- `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts:140` / `:180` — `fir.markRENTRISyncFailed(...)` (fallimento validazione / errore API)

Questi metodi (`markRENTRISynced`, `markRENTRISyncFailed`, `startRENTRISync`, `canSyncToRENTRI`, `needsRENTRIRetry`, `getNextRENTRIRetryAt`) sono invocati sull'aggregate `fir` **ma non sono definiti da nessuna parte nel layer `domain`** — la ricerca in `apps/backend/src/domain` non trova alcuna implementazione di questi metodi sull'entità FIR (esiste solo il value object `apps/backend/src/domain/fir/rentri-sync-status.vo.ts`, che incapsula stato/tentativi/`getProtocolNumber()` ma è un oggetto satellite, non l'aggregate). Il costruttore dello use case stesso lo ammette esplicitamente — `sync-fir-to-rentri.use-case.ts:37-40`:

```ts
constructor(
  private readonly firRepository: any, // IFIRRepository - will be injected
  private readonly rentriApiClient: any, // RENTRIApiClient - will be injected
  private readonly syncLogRepository: any, // IRENTRISyncLogRepository - will be injected
  ...
```

Tipizzato `any`, con commento "will be injected": non c'è un binding reale a un repository FIR concreto.

**Verifica di cablaggio (raggiungibilità dal flusso reale):**

- Il repository FIR reale, `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts`, **non contiene nessun riferimento** ai campi `rentri*` (unico match nel file è la mappatura dell'enum di stato `SYNCED_TO_RENTRI → CONSEGNATO`, non il campo protocollo). Quindi anche se lo use case venisse eseguito, il repository di produzione non ha logica per scrivere `rentriProtocolNumber`/`rentriSyncStatus` su riga reale — a meno che Prisma non lo faccia implicitamente passando l'intero oggetto (non verificabile senza vedere il metodo `update`, ma nessun mapping esplicito è presente).
- `RentriModule` (`apps/backend/src/infrastructure/rentri/rentri.module.ts:25-49`) — l'unico modulo RENTRI importato in `app.module.ts:37,116` — dichiara come `controllers` **solo** `RentriCredentialController` e come `providers` solo il client HTTP/auth/firma/credenziali. **Non fornisce** `SyncFIRToRENTRIUseCase`, `TriggerBatchSyncUseCase`, `GetSyncStatusUseCase`, `RENTRISyncQueue`, `RENTRISyncLogRepository`, `RENTRISyncJobProcessor`, né il controller `RENTRISyncController`.
- Ricerca esaustiva (`grep -rn` su `apps/backend/src`) di `RENTRISyncController`, `SyncFIRToRENTRIUseCase`, `TriggerBatchSyncUseCase`, `GetSyncStatusUseCase`, `RENTRISyncQueue`, `RENTRISyncLogRepository`, `RENTRISyncJobProcessor`, `FIRConsegnatoHandler`: ciascuna classe compare **solo** nel proprio file di definizione, nel proprio file di spec, e nei file che la importano fra loro (es. `rentri-sync.job.ts` importa lo use case, `rentri-sync.controller.ts` importa lo use case di batch) — **mai** dentro un array `providers:`/`controllers:` di un `@Module`.
- Il test di cablaggio DI dedicato del modulo, `apps/backend/src/infrastructure/rentri/rentri.module.spec.ts:18-33`, verifica esplicitamente la risoluzione di `RENTRIApiClient`, `RentriAuthService`, `RentriSignatureService`, `RentriCredentialService`, `RentriCredentialResolver`, `RentriCredentialController` — **non** verifica (perché non esiste nel modulo) nulla della catena di sync. Il commento del file dice "DI smoke test per RentriModule (cablato in AppModule)" riferendosi solo al sottosistema credenziali.
- `apps/backend/src/infrastructure/queue/jobs/rentri-sync.job.ts:30-42` — `RENTRISyncJobProcessor` costruisce un `Worker` BullMQ grezzo in `onModuleInit()`, ma per essere istanziato da Nest deve comunque comparire come `provider` in un modulo effettivamente importato: non è il caso (a differenza di `pdf-generation.job.ts:48`, che usa il decoratore standard `@Processor('pdf-generation', ...)` — pattern coerente col resto della coda, qui abbandonato).
- `apps/backend/src/application/rentri/handlers/fir-consegnato.handler.ts` — `FIRConsegnatoHandler`, pensato per innescare automaticamente il sync alla consegna del FIR (evento `FIRConsegnatoEvent`), ha `rentriSyncQueue: any` nel costruttore (stesso pattern "any, verrà iniettato") e **non risulta sottoscritto da nessun event bus/dispatcher** nel codice (nessun match oltre alla propria definizione).

**Conclusione punto 2:** l'intera pipeline di scrittura di `rentriProtocolNumber`/`rentriSyncStatus` (use case, job, controller, handler d'evento) è codice orfano — scritto, con test unitari basati su mock, ma non cablato in `AppModule` né in `RentriModule`. Non viene eseguito da nessun percorso applicativo reale (né HTTP, né coda, né evento di dominio).

### 3. Esiste un'azione utente per inserire/modificare a mano il riferimento RENTRI?

- Ricerca in `apps/backend/src/api/rentri/` e `apps/backend/src/application/rentri/`: gli unici DTO sono `set-rentri-credential.dto.ts` (credenziali ModI del tenant, non riferimenti a formulari) e `sync-fir.dto.ts` (`SyncFIRRequestDto`, `BatchSyncRequestDto` — innescano una sincronizzazione, non permettono di scrivere un protocollo a mano).
- Nessun controller REST espone un endpoint tipo `PATCH /fir/:id/rentri-reference` o simile. Ricerca di `rentriProtocolNumber`/`numeroFIRRentri`/`numero_fir` sotto `apps/backend/src/api`: **nessun risultato**.
- Frontend: `apps/frontend/src/app/features/rentri/` contiene solo `rentri-credential.component.ts` e `rentri-credential.service.ts` — gestione delle credenziali RENTRI del tenant, non collegamento FIR↔formulario.
- Esiste un componente di visualizzazione, `apps/frontend/src/app/features/fir/components/rentri-sync-badge/rentri-sync-badge.component.ts`, che mostra lo stato (`SYNCED`/`PENDING`/`FAILED`) e il `protocolNumber` **in sola lettura**, con polling verso `RENTRISyncService` — ma è anch'esso un vicolo cieco: ricerca di `RENTRISyncBadgeComponent`/`rentri-sync-badge` in tutto `apps/frontend/src` non trova nessun punto che lo importi/usi in una pagina reale (nessun risultato oltre al file stesso).

**Conclusione punto 3:** anche volendo, un operatore non ha alcuna schermata né alcun endpoint per dire "questo FIR corrisponde a quel formulario RENTRI" — né in scrittura né, di fatto, in lettura (il badge esiste ma non è montato da nessuna parte).

### 4. Il flusso di sincronizzazione attuale (P2)

`apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts`, metodo `execute()` (righe 50-219), descrive correttamente — nel commento di testa (righe 20-34) e nel corpo — il ciclo ModI reale:

1. Carica l'aggregate FIR (`firRepository.findById`, riga 59) e verifica isolamento tenant (riga 66).
2. Verifica `fir.canSyncToRENTRI()` (riga 71) e stato che blocca il sync (`getSyncBlockReason`, righe 250-264: richiede `status === 'COMPLETED'`, blocca se già `SYNCED` o `PERMANENTLY_FAILED`).
3. `fir.startRENTRISync()` (riga 77), crea un `syncLog` (riga 80).
4. Chiama `rentriApiClient.creaFormulario(...)` → riceve `{ transazioneId }` (righe 96-99: `POST /` asincrono, risposta 202).
5. Fa polling con `rentriApiClient.attendiEsito(tenantId, transazioneId)` (riga 100 — ciclo NONBLOCK_PULL `/status` → `/result`).
6. Se `esito.errore` è falso (successo): `fir.markRENTRISynced(transazioneId, correlationId)` (riga 106) — **l'unico identificativo persistito è il `transazione_id`**, non un numero_fir ufficiale (che il contratto RENTRI, secondo il commento a riga 103-105, non restituisce in questo sottoinsieme di `EsitoFormularioModel`). Aggiorna anche il `syncLog` con `protocolNumber: transazioneId` (riga 112).
7. Se `esito.errore` è vero: fallimento permanente, nessun retry (righe 134-160).
8. In caso di eccezione di rete/API: distingue errori non ritentabili (403, `RentriApiError.retryable === false`, righe 162-169) da errori ritentabili con backoff (`fir.needsRENTRIRetry()`, riga 193).

**Cosa conserva dell'esito:** solo `transazioneId` (rinominato di fatto "protocolNumber" nel dominio e nel log di sync), lo stato (`SYNCED`/`FAILED`/`PERMANENTLY_FAILED`), timestamp e contatore tentativi, messaggio d'errore formattato (righe 273-281, solo `title`/`detail` del ProblemDetails, mai il corpo grezzo). Non c'è alcun campo per il numero FIR ufficiale RENTRI distinto dal transazione_id — se il contratto RENTRI lo restituisse in altre risposte (es. tramite l'endpoint di controllo/consultazione), questo codice non lo cattura né lo persiste.

Come già emerso al punto 2, questo flusso — per quanto corretto nella logica ModI descritta — **non è raggiungibile a runtime**: nessun controller/job/handler cablato lo invoca.

### 5. Il verso opposto: import/collegamento da un formulario RENTRI esistente

- `apps/backend/src/api/rentri/rentri-sync.controller.ts` (`RENTRISyncController`) espone solo endpoint di **invio** (`POST /rentri/sync/fir/:id`, `POST /rentri/sync/batch`) e di **lettura di stato locale** (`GET /rentri/sync/status/:jobId`, `GET /rentri/sync/logs`, `GET /rentri/sync/metrics`) — righe 68-414. Nessun endpoint legge da RENTRI un formulario esistente per importarlo/agganciarlo a un FIR locale.
- Ricerca di use case di "import"/"lookup" RENTRI (`grep` su `application/rentri`): non esiste nulla che chiami un endpoint RENTRI di consultazione (`/controllo`, `/formulari/{id}`) per recuperare un formulario esistente e collegarlo a un FIR locale. Il client (`rentri-api.client.ts`) ha metodi `creaFormulario`/`attendiEsito` orientati solo all'invio.
- In ogni caso, come detto, anche `RENTRISyncController` stesso non è registrato in nessun modulo (vedi punto 2): è irraggiungibile via HTTP indipendentemente dal fatto che non copra il verso "import".

**Conclusione punto 5:** il verso RENTRI→gestionale non esiste in nessuna forma, né cablata né orfana.

## (c) Cosa manca per renderlo possibile

Elenco constatativo, senza disegnare la soluzione:

1. **Cablaggio DI mancante per l'intera pipeline di sync automatico**: `SyncFIRToRENTRIUseCase`, `TriggerBatchSyncUseCase`, `GetSyncStatusUseCase`, `RENTRISyncQueue`, `RENTRISyncLogRepository`, `RENTRISyncJobProcessor`, `RENTRISyncController`, `FIRConsegnatoHandler` non sono registrati in nessun `@Module` (né `RentriModule` né altrove). Finché resta così, il sync automatico via evento di dominio o via endpoint REST non parte mai, a prescindere da qualunque decisione sul "legame discrezionale".
2. **Dipendenze `any` non risolte**: il costruttore di `SyncFIRToRENTRIUseCase` dichiara `firRepository`, `rentriApiClient`, `syncLogRepository` come `any` con commento "will be injected" — non è mai stato collegato a un'implementazione concreta (`IFIRRepository`, repository log). Anche cablando il modulo, va verificato/creato il binding ai token/provider reali.
3. **Metodi di dominio mancanti sull'aggregate FIR**: `canSyncToRENTRI()`, `startRENTRISync()`, `markRENTRISynced()`, `markRENTRISyncFailed()`, `needsRENTRIRetry()`, `getNextRENTRIRetryAt()` sono invocati dallo use case ma non risultano definiti nel layer `domain/fir` (solo il VO satellite `rentri-sync-status.vo.ts` esiste, con superficie diversa/parziale).
4. **Persistenza non collegata**: `fir-prisma.repository.ts` non contiene logica di lettura/scrittura per i sei campi `rentri*` dello schema — va verificato/aggiunto il mapping esplicito se e quando l'aggregate calcola questi valori.
5. **Nessun campo dati per il numero FIR ufficiale RENTRI**: lo schema Prisma non distingue fra `transazione_id` (identificativo di trasmissione, oggi riversato in `rentriProtocolNumber`) e un eventuale `numero_fir`/identificativo del formulario lato ente. Se l'ente restituisce quest'ultimo in altre chiamate (es. consultazione/controllo), oggi non c'è dove metterlo.
6. **Nessuna azione utente, né manuale né di sola visualizzazione, effettivamente esposta**: mancano sia un endpoint di scrittura manuale del riferimento RENTRI su un FIR, sia il montaggio nella UI del componente di sola lettura già scritto (`rentri-sync-badge`) — oggi orfano quanto il backend.
7. **Nessun percorso di import/consultazione da RENTRI verso il gestionale**: nessun client/use case legge un formulario RENTRI esistente per proporlo come collegamento a un FIR locale; il client RENTRI espone solo `creaFormulario`/`attendiEsito` (verso di invio).
8. **Copertura di test solo unitaria/mock**: i test esistenti (`sync-fir-to-rentri.use-case.spec.ts`, `rentri-sync.job.spec.ts`) istanziano le classi direttamente con mock, senza passare da un modulo Nest compilato con l'intero grafo — motivo per cui l'assenza di cablaggio non è mai stata rilevata da CI.
