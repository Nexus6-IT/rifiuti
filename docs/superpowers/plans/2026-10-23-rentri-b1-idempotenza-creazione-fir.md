# Piano B RENTRI, pezzo 1: creazione del FIR senza doppioni (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** una trasmissione di un FIR a RENTRI crea **al massimo un** formulario sull'ente. Questo vale anche con un doppio clic, con due job concorrenti, con un timeout del polling, con un 5xx o un timeout sulla `POST /` e con un worker che si ferma a metà. Quando non si può sapere se l'ente ha creato il formulario, il sistema **si ferma e lo dice**, senza ritrasmettere.

**Architettura:**
- **Prenotazione.** Prima della `POST /` il tentativo si prenota a database con un `UPDATE` condizionato: lo stato passa a `SYNCING` con l'istante di avvio. Chi non vince la prenotazione non trasmette.
- **Transazione in attesa.** Subito dopo il 202, il `transazione_id` si salva come "transazione in attesa". Un tentativo successivo interroga quella transazione invece di rifare la `POST /`.
- **Niente ritentativi ciechi.** Il client non ritenta più la `POST /` su 5xx. Un 5xx, un timeout o un errore di rete sulla creazione diventano `RENTRI_TRASMISSIONE_INCERTA`: un codice non ritentabile, che si sblocca solo con una conferma esplicita dopo una verifica sul portale RENTRI.
- **Coda.** Il job ha un `jobId` deterministico per FIR.
- **Recupero.** Un job ogni 30 minuti riprende le trasmissioni rimaste `SYNCING` oltre la soglia.

**Tech Stack:** NestJS 10, Prisma 5.8, PostgreSQL 16, BullMQ, Jest 29 + ts-jest, fake RENTRI in-process (`tools/rentri-fake`), Angular 17 + Karma (Task 6).

**Spec:**
- `C:\Progetti\winwaste\docs\rentri\04-confronto-con-rifiuti.md`: §4 riga 10 (idempotenza assente, punti a-d) e §6 raccomandazione 3.
- `C:\Progetti\winwaste\docs\confronto-rifiuti\03-adempimenti-integrazioni.md` §2.2 punto d.
- `C:\Progetti\winwaste\docs\confronto-con-rifiuti.md` §4 punto 2 e §10 (decisione: Piano B a pezzi, un difetto alla volta).
- Contratto: `docs/contracts/rentri/formulari.yaml`:
  - righe 187-265: `POST /`, che risponde 202 con `transazione_id`;
  - righe 2847-2897: `GET /{transazione_id}/status`, che risponde 200, 303 o **404 se la transazione non esiste**;
  - righe 7498-7505: `numero_fir` facoltativo in `dati_partenza`.

## Fuori ambito (pezzi successivi del Piano B)

- **`numero_fir` vidimato nel payload.** È la seconda difesa, perché RENTRI rifiuta un numero già usato. Dipende dal consumo del numero vidimato all'emissione, che il piano `2026-09-12-collegamento-scorta-emissione.md` deve ancora innestare in `emetti-fir.use-case.ts`, passo 3. Oggi il FIR non porta il numero vidimato.
- **Ricerca automatica del formulario** dopo una trasmissione incerta (`cercaFormulari` per unità locale e intervallo di creazione). Per ora la verifica la fa una persona sul portale (Decisione 1).
- **Vidimazione che "perde" un numero** quando il polling scade (`avvia-vidimazione-scorta.use-case.ts:180-187`). È lo stesso difetto su un'altra transazione: pezzo a parte.
- **Gli altri tre difetti del Piano B:** certificati EC, path `sign-hash`, tenant nella firma dei job.

## Decisioni per Graziano

Tutte e cinque confermate da Graziano il 2026-10-23.

1. **Trasmissione incerta: ci si ferma, verifica una persona.**
   - Una `POST /` che finisce con 5xx, timeout, errore di rete o un 202 senza `transazione_id` non si ritenta. Diventa `PERMANENTLY_FAILED` con codice `RENTRI_TRASMISSIONE_INCERTA`.
   - Il dettaglio del FIR dice: "Non sappiamo se RENTRI ha ricevuto il formulario: controlla sul portale RENTRI. Se non c'è, ritrasmetti."
   - Un amministratore preme **Ritrasmetti** e conferma in un dialog.
   - Alternativa: ricerca automatica sull'ente (pezzo successivo). Ritardare la verifica costa poco; un doppione sull'ente si annulla solo a mano.
2. **Soglia di stallo: 15 minuti.** Una trasmissione `SYNCING` avviata da più di 15 minuti si considera interrotta e può essere ripresa. Il calcolo: il caso peggiore del polling è 30 interrogazioni × 2 s, più 5 tentativi di resilienza per chiamata con backoff fino a 30 s, cioè meno di 10 minuti.
3. **Esito positivo senza `numero_fir` (`RENTRI_MISSING_NUMERO_FIR`).**
   - Oggi è ritentabile e il messaggio dice "Riprova la trasmissione". Ma l'ente ha già elaborato la transazione senza errori, quindi il formulario probabilmente esiste: un nuovo tentativo farebbe un doppione.
   - Predefinito: diventa **non ritentabile**, con la stessa azione `VERIFICA_SU_RENTRI` della Decisione 1.
4. **Transazione in attesa che l'ente non trova (404 su `/status`).**
   - Il 202 era arrivato, quindi l'ente l'aveva registrata.
   - Predefinito: trattarla come trasmissione incerta (Decisione 1), mai come via libera a una nuova `POST /`.
5. **Chi può sbloccare una trasmissione incerta.** Lo stesso controllo del pulsante "Riprova" di oggi (`canManageRENTRI()` nel frontend). Lato backend, l'endpoint di sync con `confermaNuovaTrasmissione: true` richiede il ruolo ADMIN **nell'azienda selezionata**, tramite `RuoloEffettivoService`.

## Global Constraints

- **Branch e worktree:**
  - Si lavora nel worktree `C:\Progetti\rifiuti-wt-rentri-b1`, branch `fix/rentri-b1-idempotenza-fir`, partito da `fix/fase0-confronto-winwaste` @ `64c647c`.
  - Va in merge **dopo** la Fase 0, perché usa `RuoloEffettivoService` e `requireRequestTenantId` del piano R.
  - Si fa un solo push quando il piano è finito. Il merge lo decide Graziano.
- **`node_modules`:** come nel piano C (Global Constraints), mai attraverso le junction.
  - Se il worktree ha junction verso `C:\Progetti\rifiuti`, si tolgono con `cmd /c rmdir`.
  - Poi un `npm ci` alla radice e `npx prisma generate` in `apps/backend`.
- **TDD obbligatorio:** prima il test, poi guardarlo fallire.
- **Comandi dei test** (mai la suite intera):
  - Unitari: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`.
  - Postgres: container `wasteflow-pg-test` su 127.0.0.1:55432, `DATABASE_URL=postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public`, `npx prisma migrate deploy`, poi `npm run test:postgres -- <pattern>`. Ogni `deleteMany` di teardown va filtrato sugli id creati dal test.
  - Oracolo: `npm run test:oracolo -- <pattern>`, con la fake in-process (`creaApp()`), come in `rentri-api.client.numero-fir.oracolo.spec.ts`.
  - Frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=<spec>`.
- **Migration solo additive:** colonne nullable, nessuna DROP.
- **Lingua:**
  - Messaggi utente e commenti in italiano.
  - I termini tecnici restano in inglese: job, worker, timeout, polling.
  - Nei messaggi all'utente "formulario" e "FIR" restano termini di dominio.
- **Commit senza attribuzione AI.**
- **Mai il corpo grezzo della risposta RENTRI nei log:** valgono le regole esistenti (`problemTitle` / `problemDetail`).

## Review Focus

1. **Due job dello stesso FIR in parallelo** (doppio clic, oppure modalità AUTOMATICA più "Trasmetti" manuale): ci deve essere una sola `POST /`. Il test è nel Task 3 (Postgres, prenotazione concorrente) e nel Task 4 (use case: prenotazione persa, nessuna chiamata al client).
2. **Il polling scade e il job riparte:** il secondo tentativo interroga la transazione salvata e la fake conta un solo formulario. Il test è nel Task 7 (oracolo).
3. **Il worker si ferma dopo il 202 e prima di salvare l'esito:** la ripresa (Task 5) trova la transazione in attesa e non rifà la `POST /`. Il test è nel Task 4 ("ripresa da SYNCING scaduto con transazione in attesa") e nel Task 5.
4. **Il worker si ferma fra la prenotazione e il 202:** non c'è nessuna transazione, quindi il FIR finisce in `RENTRI_TRASMISSIONE_INCERTA`, senza `POST /`. Il test è nel Task 4.
5. **Un FIR annullato in locale durante l'attesa:** la prenotazione non lo prende, e se è già prenotato vale il comportamento attuale (`FirAnnullatoNelFrattempoError`, nessun nuovo tentativo). Il test è nel Task 3 (prenotazione rifiutata su `CANCELLED`).

---

### Task 1: client RENTRI, niente ritentativi ciechi sulla creazione

**Files:**
- Modify: `apps/backend/src/infrastructure/rentri/rentri-api.client.ts`. Metodi da toccare:
  - `creaFormulario` (righe 147-162);
  - `eseguiRichiestaConResilienza` (righe 1300-1325);
  - `interrogaStatoTransazione` e `leggiEsitoTransazione` (righe 1143-1245).
- Modify: `apps/backend/src/infrastructure/rentri/rentri-http-resilienza.ts`, solo se serve per passare l'opzione.
- Test: `apps/backend/src/infrastructure/rentri/rentri-api.client.spec.ts`.

**Interfaces:**
- Produces, esportate da `rentri-api.client.ts`:
  - `class TrasmissioneRentriIncertaError extends Error { constructor(readonly causa: 'HTTP_5XX' | 'NESSUNA_RISPOSTA' | 'RISPOSTA_SENZA_TRANSAZIONE', readonly status?: number) }`
  - `class TransazioneRentriNonTrovataError extends Error { constructor(readonly transazioneId: string) }`
  - `creaFormulario(tenantId, dati)`: firma invariata. Solleva `TrasmissioneRentriIncertaError` nei casi elencati sotto.
  - `attendiEsito(tenantId, transazioneId, opzioni?)`: firma invariata. Solleva `TransazioneRentriNonTrovataError` su 404 da `/status` o da `/result`.

- [ ] **Step 1: test che falliscono**, in un `describe('creaFormulario: nessun ritentativo cieco')`:
  - `'5xx sulla POST: una sola chiamata e TrasmissioneRentriIncertaError HTTP_5XX'`. Mock `httpService.post` che rifiuta con `{ response: { status: 502 } }`. Attesi: `post` chiamato **1** volta, errore istanza di `TrasmissioneRentriIncertaError` con `causa === 'HTTP_5XX'` e `status === 502`.
  - `'timeout senza risposta: TrasmissioneRentriIncertaError NESSUNA_RISPOSTA'`. Rifiuta con `{ code: 'ECONNABORTED' }`, senza `response`. Atteso: `post` chiamato 1 volta.
  - `'202 senza transazione_id: TrasmissioneRentriIncertaError RISPOSTA_SENZA_TRANSAZIONE'`.
  - `'429 sulla POST si ritenta ancora'`. Il primo tentativo è 429 con `Retry-After: 0`, il secondo 202 con `transazione_id: 't-1'`. Atteso: `post` chiamato 2 volte, risultato `{ transazioneId: 't-1' }`.
  - `'403 sulla POST resta RentriApiError non ritentabile'`: comportamento invariato.
  - In `describe('attendiEsito')`: `'404 su /status: TransazioneRentriNonTrovataError con il transazioneId'`.
- [ ] **Step 2:** esegui `npx jest --runInBand apps/backend/src/infrastructure/rentri/rentri-api.client.spec.ts -t "ritentativo cieco|404 su /status"`. Atteso: FAIL. Il 5xx oggi produce 5 chiamate, il timeout rilancia l'errore axios grezzo.
- [ ] **Step 3: implementazione.**
  - `eseguiRichiestaConResilienza` riceve un quarto parametro facoltativo `opzioni?: { creazione?: boolean }`. Con `creazione: true`:
    - errore senza `response` → `TrasmissioneRentriIncertaError('NESSUNA_RISPOSTA')`;
    - `status >= 500` → `TrasmissioneRentriIncertaError('HTTP_5XX', status)`, **prima** di `gestisciRispostaNonPrevista`;
    - 403, 429 e 423 restano come oggi. 429 e 423 significano che la richiesta non è stata elaborata, quindi ritentare è sicuro.
  - `creaFormulario` passa `{ creazione: true }`. Se `transazione_id` manca o è vuoto solleva `RISPOSTA_SENZA_TRANSAZIONE`.
  - In `interrogaStatoTransazione` e in `leggiEsitoTransazione`, uno status 404 solleva `TransazioneRentriNonTrovataError` prima della gestione generica.
- [ ] **Step 4:** stesso comando dello Step 2. Atteso: PASS. Poi l'intero `rentri-api.client.spec.ts` e `npm run test:oracolo -- rentri-api.client`: atteso PASS, senza regressioni sulla resilienza delle altre chiamate.
- [ ] **Step 5:** commit `fix(rentri): la creazione del formulario non si ritenta alla cieca su 5xx o timeout`.

### Task 2: dominio, transazione in attesa e trasmissione incerta

**Files:**
- Modify: `apps/backend/src/domain/fir/rentri-sync-status.vo.ts`.
- Modify: `apps/backend/src/domain/fir/aggregates/fir.aggregate.ts`:
  - costruttore e `reconstitute`, dove oggi passa `_rentriTransazioneId` (riga 412 e riga 488);
  - metodi di sync (righe 656-760).
- Test: `apps/backend/src/domain/fir/rentri-sync-status.vo.spec.ts` e `apps/backend/src/domain/fir/aggregates/fir.aggregate.spec.ts`. I nomi esatti si verificano con `ls`; se uno dei due non esiste, si crea accanto al sorgente.

**Interfaces:**
- Produces nel VO:
  - `'RENTRI_TRASMISSIONE_INCERTA'` e `'RENTRI_MISSING_NUMERO_FIR'` aggiunti a `NON_RETRYABLE_ERROR_CODES` (Decisione 3);
  - `riapriDopoVerificaManuale(): RENTRISyncStatus`, che restituisce `PENDING` con gli stessi `attempts` e solleva `DomainException` se `lastErrorCode` non è uno dei due codici;
  - `markAsSyncing()` accettato anche da `SYNCING`, per la ripresa dopo uno stallo.
- Produces nell'aggregate:
  - `get rentriTransazioneInAttesa(): string | null`
  - `get rentriSyncAvviatoAt(): Date | null`
  - `avviaTentativoRentri(ora: Date): void`. Sostituisce `startRENTRISync`, che va rimosso con tutti i suoi usi. Accetta `PENDING`, `FAILED` ritentabile e `SYNCING`; altrimenti solleva `DomainError`. Imposta lo stato `SYNCING` e `_rentriSyncAvviatoAt = ora`.
  - `registraTransazioneInAttesa(transazioneId: string): void`. Imposta `_rentriTransazioneInAttesa` e `_rentriTransazioneId`.
  - `markRENTRISynced` e `proporreLegameRENTRI` azzerano `_rentriTransazioneInAttesa`.
  - `chiudiTransazioneInAttesa(): void`. La chiama lo use case quando ha letto un esito negativo.
  - `segnaTrasmissioneIncerta(motivo: string, correlationId?: string): void`. Chiama `markRENTRISyncFailed(motivo, 'RENTRI_TRASMISSIONE_INCERTA', correlationId)` e azzera `_rentriTransazioneInAttesa`.
  - `riapriTrasmissioneDopoVerifica(): void`. Delega a `riapriDopoVerificaManuale` e solleva `DomainError` se il FIR ha già `rentriNumeroFir`.

- [ ] **Step 1: test che falliscono.**
  - VO:
    - `'RENTRI_TRASMISSIONE_INCERTA ferma subito il ciclo'`: `failed(1, 'x', 'RENTRI_TRASMISSIONE_INCERTA').getStatus() === 'PERMANENTLY_FAILED'` e `canRetry() === false`;
    - lo stesso per `RENTRI_MISSING_NUMERO_FIR`;
    - `'riapriDopoVerificaManuale torna PENDING e conserva i tentativi'`: da `failed(3, …, 'RENTRI_TRASMISSIONE_INCERTA')` atteso `PENDING`, `getAttempts() === 3`, `canRetry() === true`;
    - `'riapriDopoVerificaManuale rifiuta un altro codice'`: con `RENTRI_FORBIDDEN` solleva.
  - Aggregate:
    - `'avviaTentativoRentri riprende un SYNCING'`;
    - `'avviaTentativoRentri rifiuta un FIR legato'`;
    - `'markRENTRISynced azzera la transazione in attesa'`;
    - `'segnaTrasmissioneIncerta: PERMANENTLY_FAILED, codice RENTRI_TRASMISSIONE_INCERTA, transazione in attesa null'`;
    - `'riapriTrasmissioneDopoVerifica: canSyncToRENTRI torna true'`.
- [ ] **Step 2:** esegui i due spec. Atteso: FAIL, perché metodi e codici non esistono.
- [ ] **Step 3: implementazione**, secondo le Interfaces. Aggiorna anche il messaggio di `getSyncBlockReason` in `sync-fir-to-rentri.use-case.ts` solo se cambia il testo per `PERMANENTLY_FAILED`; non deve cambiare.
- [ ] **Step 4:** stessi spec più `npx tsc --noEmit -p apps/backend`. Atteso: PASS e nessun uso residuo di `startRENTRISync` (`grep -rn startRENTRISync apps/backend/src` vuoto).
- [ ] **Step 5:** commit `feat(fir): transazione RENTRI in attesa e trasmissione incerta nel dominio`.

### Task 3: persistenza, prenotazione atomica e transazione salvata subito

**Files:**
- Create: `apps/backend/prisma/migrations/20261023100000_fir_rentri_trasmissione_idempotente/migration.sql`.
- Modify: `apps/backend/prisma/schema.prisma`, modello `FIR` accanto a `rentriTransazioneId` (righe 389-393).
- Modify: `apps/backend/src/domain/fir/repositories/fir-repository.interface.ts`.
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts`: `toDomain` (righe ~598-603), `rentriToPersistence` (righe 747-772), metodi nuovi.
- Test: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.postgres.spec.ts`.

**Interfaces:**
- Colonne:
  - `rentriTransazioneInAttesa String? @map("rentri_transazione_in_attesa") @db.VarChar(100)`
  - `rentriSyncAvviatoAt DateTime? @map("rentri_sync_avviato_at")`
- Indice `@@index([rentriSyncStatus, rentriSyncAvviatoAt])` per il Task 5.
- Produces in `IFIRRepository`:
  - `prenotaTrasmissioneRentri(firId: string, tenantId: string, ora: Date, sogliaStallo: Date): Promise<boolean>`
  - `registraTransazioneInAttesa(firId: string, tenantId: string, transazioneId: string): Promise<void>`
  - `elencaTrasmissioniRentriSospese(sogliaStallo: Date, limite: number): Promise<Array<{ firId: string; tenantId: string }>>`
- `prenotaTrasmissioneRentri` è un solo `UPDATE firs … WHERE …` con `$executeRaw`. Restituisce `true` se ha aggiornato una riga. Condizioni del `WHERE`:
  - `id` e `tenant_id`;
  - `rentri_numero_fir IS NULL`;
  - `status <> 'CANCELLED'`;
  - `rentri_stato_formulario IS DISTINCT FROM 'Annullato'`;
  - una fra `rentri_sync_status IN ('PENDING','FAILED')` e `rentri_sync_status = 'SYNCING' AND (rentri_sync_avviato_at IS NULL OR rentri_sync_avviato_at < sogliaStallo)`.

  Il `SET` scrive `rentri_sync_status = 'SYNCING'` e `rentri_sync_avviato_at = ora`.
- `registraTransazioneInAttesa` scrive `rentri_transazione_in_attesa` e `rentri_transazione_id` con `WHERE id AND tenant_id AND rentri_sync_status = 'SYNCING'`.
- `elencaTrasmissioniRentriSospese` restituisce i FIR `SYNCING` con `rentri_sync_avviato_at < sogliaStallo` o `NULL`, su tutti i tenant (job di sistema), con `ORDER BY rentri_sync_avviato_at NULLS FIRST LIMIT limite`.

- [ ] **Step 1: test Postgres che falliscono.**
  - `'due prenotazioni concorrenti: una sola vince'`: `Promise.all` di due `prenotaTrasmissioneRentri` sullo stesso FIR `PENDING`. Atteso: `[true, false]` in un ordine qualsiasi, cioè esattamente un `true`.
  - `'SYNCING recente non si riprenota, SYNCING scaduto sì'`.
  - `'FIR legato, CANCELLED, annullato all\'ente o di un altro tenant: false'`.
  - `'registraTransazioneInAttesa e reload: rentriTransazioneInAttesa e rentriSyncAvviatoAt riletti dall\'aggregate'`.
  - `'save di un aggregate con transazione in attesa azzerata la scrive NULL'`.
  - `'elencaTrasmissioniRentriSospese restituisce solo gli scaduti'`.
- [ ] **Step 2:** `npm run test:postgres -- fir-prisma.repository`. Atteso: FAIL, perché colonne e metodi non esistono.
- [ ] **Step 3:**
  - Scrivi la migration (`ALTER TABLE firs ADD COLUMN …` ×2, `CREATE INDEX …`) e lo schema.
  - Implementa i tre metodi e la lettura e scrittura dei due campi in `toDomain` e `rentriToPersistence`. Usa la stessa tecnica di `_rentriTransazioneId`: senza lettura al reload il campo tornerebbe sempre `null`.
  - Aggiungi i metodi ai mock di `IFIRRepository` usati dagli spec esistenti (`grep -rln "IFIRRepository\|findByRentriNumeroFir: jest.fn" apps/backend/src`).
- [ ] **Step 4:** `npx prisma migrate deploy`, poi lo Step 2 e `npx tsc --noEmit`. Atteso: PASS.
- [ ] **Step 5:** commit `feat(fir): prenotazione atomica della trasmissione RENTRI e transazione in attesa salvata`.

### Task 4: use case di trasmissione idempotente

**Files:**
- Modify: `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts`.
- Test: `apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.spec.ts`.

**Interfaces:**
- Consumes: Task 1 (errori del client), Task 2 (metodi dell'aggregate), Task 3 (metodi del repository).
- Produces:
  - `export const SOGLIA_STALLO_RENTRI_MS = 15 * 60 * 1000` (Decisione 2), esportata dallo use case;
  - `SyncFIRToRENTRIResult` con un campo nuovo `giaInCorso?: boolean`;
  - `SyncFIRToRENTRIOpzioni` con un campo nuovo `confermaNuovaTrasmissione?: boolean`.

**Flusso di `execute`.** Questo algoritmo è la decisione del piano; il resto della struttura dello use case resta com'è.
1. Carica il FIR e controlla il tenant, come oggi.
2. Se `opzioni.confermaNuovaTrasmissione`, chiama `fir.riapriTrasmissioneDopoVerifica()` e poi `firRepository.save(fir)`. Un `DomainError` diventa `DomainException.businessRuleViolation('CANNOT_SYNC_FIR', …)`.
3. Se lo stato **non** è `SYNCING` e `!fir.canSyncToRENTRI()`, solleva `CANNOT_SYNC_FIR`, come oggi.
4. `prenotato = await firRepository.prenotaTrasmissioneRentri(firId, tenantId, ora, new Date(ora - SOGLIA_STALLO_RENTRI_MS))`. Se è `false`, restituisce `{ success: false, giaInCorso: true, willRetry: false, attempts }` senza log di sync e senza chiamate al client.
5. Ricorda `eraSyncing` e `transazioneInAttesa` letti dal FIR **prima** della prenotazione, poi chiama `fir.avviaTentativoRentri(ora)`.
6. **Ripresa.** Se `transazioneInAttesa` c'è, si salta la `POST /`, si esegue `attendiEsito(tenantId, transazioneInAttesa)` e si continua dal passo 9. Nel log di sync `requestPayload` vale `{"ripresaTransazione": "<id>"}`.
7. **Interruzione prima del 202.** Se `eraSyncing` è vero e non c'è transazione in attesa: `fir.segnaTrasmissioneIncerta('Trasmissione interrotta prima della risposta di RENTRI: verificare sul portale')`, salvataggio e ritorno con `willRetry: false`. Nessuna `POST /`.
8. **Trasmissione.** Si costruisce il payload, si crea il log e si chiama `creaFormulario`. Subito dopo, **prima** del polling, si eseguono `firRepository.registraTransazioneInAttesa(...)` e `fir.registraTransazioneInAttesa(...)`, poi `attendiEsito`.
9. **Esiti:**
   - esito positivo con `numero_fir`: come oggi, synced oppure proposto;
   - esito negativo: `fir.chiudiTransazioneInAttesa()` e poi lo stesso trattamento di oggi;
   - esito positivo senza numero: `fir.chiudiTransazioneInAttesa()` e `RENTRI_MISSING_NUMERO_FIR`, ora non ritentabile.
10. **Errori:**
    - `TrasmissioneRentriIncertaError` e `TransazioneRentriNonTrovataError` → `fir.segnaTrasmissioneIncerta(...)`, `willRetry: false`, log con codice `RENTRI_TRASMISSIONE_INCERTA`;
    - ogni altro errore dopo il 202, come un timeout del polling → come oggi (`RENTRI_API_ERROR`, ritentabile), con la transazione **ancora in attesa**.

- [ ] **Step 1: test che falliscono** (mock di repository e client, `aiuti-test.ts`):
  - `'prenotazione persa: giaInCorso, nessuna chiamata a creaFormulario né ad attendiEsito'`.
  - `'transazione salvata prima del polling'`: `registraTransazioneInAttesa` chiamato con `'t-1'` **prima** di `attendiEsito`, verificato con `mock.invocationCallOrder`.
  - `'timeout del polling: willRetry true e transazione ancora in attesa'`.
  - `'ripresa: FIR FAILED con transazione in attesa → attendiEsito su quella, creaFormulario mai chiamato'`.
  - `'ripresa da SYNCING scaduto con transazione in attesa → attendiEsito, nessuna POST'`.
  - `'SYNCING scaduto senza transazione → RENTRI_TRASMISSIONE_INCERTA, nessuna POST'`.
  - `'5xx sulla creazione → PERMANENTLY_FAILED RENTRI_TRASMISSIONE_INCERTA, willRetry false'`.
  - `'404 della transazione in attesa → RENTRI_TRASMISSIONE_INCERTA'`.
  - `'esito senza numero_fir → willRetry false'`. Va aggiornato il test esistente che oggi si aspetta `willRetry: true`: è il cambio della Decisione 3.
  - `'confermaNuovaTrasmissione su trasmissione incerta → nuova POST'`.
  - `'confermaNuovaTrasmissione su FIR non incerto → CANNOT_SYNC_FIR'`.
- [ ] **Step 2:** `npx jest --runInBand apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.spec.ts`. Atteso: FAIL sui test nuovi.
- [ ] **Step 3:** implementa il flusso descritto sopra.
- [ ] **Step 4:** stesso comando, più `rentri-sync.module.spec.ts` e `npx tsc --noEmit`. Atteso: PASS.
- [ ] **Step 5:** commit `fix(rentri): trasmissione del FIR idempotente, ripresa della transazione invece di una nuova POST`.

### Task 5: coda con jobId per FIR e ripresa delle trasmissioni sospese

**Files:**
- Modify: `apps/backend/src/infrastructure/queue/rentri-sync.queue.ts` (`addSyncJob`, righe 77-122).
- Modify: `apps/backend/src/infrastructure/queue/jobs/rentri-sync.job.ts` (righe 140-170).
- Create: `apps/backend/src/infrastructure/jobs/rentri-trasmissioni-sospese.job.ts`, sul modello di `rentri-rifornimento-scorta.job.ts`, con `@Cron(CronExpression.EVERY_30_MINUTES)` e `segnalaErroreJob`.
- Modify: il modulo che registra `RentriRifornimentoScortaJob`, da trovare con `grep -rn RentriRifornimentoScortaJob apps/backend/src --include=*.module.ts`.
- Test:
  - `apps/backend/src/infrastructure/queue/rentri-sync.queue.spec.ts` (nuovo);
  - `apps/backend/src/infrastructure/queue/jobs/rentri-sync.job.spec.ts`;
  - `apps/backend/src/infrastructure/jobs/rentri-trasmissioni-sospese.job.spec.ts` (nuovo).

**Interfaces:**
- `addSyncJob`: firma invariata. `jobId` = `sync-${firId}`. Prima dell'`add`, `await this.queue.getJob(jobId)`:
  - se lo stato (`await job.getState()`) è `waiting`, `delayed`, `active` o `prioritized`, restituisce `job.id` senza aggiungere;
  - se è `completed` o `failed`, `await job.remove()` e poi `add`. Altrimenti un nuovo tentativo legittimo sarebbe scartato in silenzio per 24 ore da `removeOnComplete`.
- `addSyncJob` accetta in più `confermaNuovaTrasmissione?: boolean`, che passa nel `data` del job e da lì allo use case.
- Il worker: `result.giaInCorso === true` → il job finisce senza errore e con un log `info`. Nessun nuovo tentativo, perché la trasmissione è di un altro job.
- `RentriTrasmissioniSospeseJob.riprendi()`: `elencaTrasmissioniRentriSospese(new Date(Date.now() - SOGLIA_STALLO_RENTRI_MS), 100)` e per ciascun FIR `addSyncJob({ firId, tenantId, priority: 'low' })`.

- [ ] **Step 1: test che falliscono.**
  - Coda (`Queue` di BullMQ mockato):
    - `'stesso FIR due volte con job in attesa: un solo add, stesso id'`;
    - `'job precedente completed: remove e nuovo add'`;
    - `'jobId è sync-<firId>'`.
  - Worker: `'giaInCorso: il job non lancia'`.
  - Job di ripresa: `'accoda i FIR sospesi con priorità low'`, `'un errore di accodamento su un FIR non ferma gli altri'`.
- [ ] **Step 2:** esegui i tre spec. Atteso: FAIL.
- [ ] **Step 3:** implementa e registra il job nel modulo.
- [ ] **Step 4:** stessi spec più `npx tsc --noEmit`. Atteso: PASS.
- [ ] **Step 5:** commit `fix(rentri): un job di trasmissione per FIR e ripresa periodica delle trasmissioni interrotte`.

### Task 6: messaggio, sblocco manuale e pulsante "Ritrasmetti"

**Files:**
- Modify: `apps/backend/src/application/rentri/rentri-error-presentation.ts`:
  - `RentriAzioneUtente` (riga 31) diventa `'RIPROVA' | 'VEDI_CERTIFICATO' | 'NESSUNA' | 'VERIFICA_SU_RENTRI'`;
  - nuovi `case`.
- Modify: `apps/backend/src/api/rentri/rentri-sync.controller.ts` (`syncFIR`, righe ~143-175) e il DTO `SyncFIRRequestDto`.
- Modify, frontend:
  - `apps/frontend/src/app/shared/models/fir.model.ts:114`;
  - `apps/frontend/src/app/features/fir/services/rentri-sync.service.ts:220` e `syncFIR`;
  - `apps/frontend/src/app/features/fir/fir-detail.component.ts`, accanto a `canRiprovareRentri` (righe 998-1005) e al pulsante "Riprova" (righe 349-360).
- Test:
  - `rentri-error-presentation.spec.ts`;
  - lo spec del controller (`rentri-sync.controller.spec.ts`; se non esiste, si crea accanto);
  - `fir-detail.component.spec.ts`.

**Interfaces:**
- `traduciErroreRentri({ errorCode: 'RENTRI_TRASMISSIONE_INCERTA' })` → `{ messaggio: 'Non sappiamo se RENTRI ha ricevuto il formulario: controlla sul portale RENTRI. Se il formulario non c\'è, ritrasmetti il FIR; se c\'è, non ritrasmettere e collegalo con «Cerca su RENTRI».', azione: 'VERIFICA_SU_RENTRI' }`.
- `RENTRI_MISSING_NUMERO_FIR` → `{ messaggio: 'RENTRI ha accettato la trasmissione ma non ha restituito il numero del formulario: controlla sul portale RENTRI prima di ritrasmettere, il formulario potrebbe già esistere.', azione: 'VERIFICA_SU_RENTRI' }`.
- `SyncFIRRequestDto.confermaNuovaTrasmissione?: boolean` (`@IsOptional() @IsBoolean()`). Se è `true`, il controller richiede il ruolo ADMIN nell'azienda selezionata (`RuoloEffettivoService`, stesso uso degli endpoint MUD del piano R) e altrimenti risponde 403. Poi passa il flag a `addSyncJob`.
- Frontend:
  - `mostraRitrasmettiDopoVerifica(fir): boolean` = `fir.rentriSyncStatus === 'PERMANENTLY_FAILED' && fir.rentriAzioneErrore === 'VERIFICA_SU_RENTRI' && this.canManageRENTRI()`;
  - pulsante `data-testid="fir-detail-rentri-ritrasmetti-dopo-verifica"`, etichetta "Ritrasmetti";
  - `ConfirmationService` con il testo "Hai controllato sul portale RENTRI che il formulario non esiste? Se esiste, ritrasmettere crea un doppione." Alla conferma chiama `syncFIR(id, { confermaNuovaTrasmissione: true })`.

- [ ] **Step 1: test che falliscono.**
  - Presentazione: i due codici danno i messaggi e le azioni esatti sopra.
  - Controller:
    - `'confermaNuovaTrasmissione da utente non ADMIN nell\'azienda selezionata: 403'`;
    - `'da ADMIN: addSyncJob con confermaNuovaTrasmissione true'`.
  - Frontend:
    - `'Ritrasmetti visibile solo con VERIFICA_SU_RENTRI e PERMANENTLY_FAILED'`;
    - `'Riprova non compare per VERIFICA_SU_RENTRI'`;
    - `'conferma del dialog → syncFIR con confermaNuovaTrasmissione true'`.
- [ ] **Step 2:** esegui gli spec. Atteso: FAIL.
- [ ] **Step 3:** implementa. Se manca, aggiungi il campo `confermaNuovaTrasmissione` alla firma di `syncFIR` nel service del frontend.
- [ ] **Step 4:** stessi spec, `npx tsc --noEmit` per il backend e `npx ng build` per il frontend, solo se c'è memoria (≥ 3 GB liberi; altrimenti segnalarlo e chiedere a Graziano). Atteso: PASS.
- [ ] **Step 5:** commit `feat(rentri): trasmissione incerta spiegata all'utente e ritrasmissione solo dopo conferma`.

### Task 7: prova contro la fake RENTRI, un solo formulario

**Files:**
- Create: `apps/backend/src/application/rentri/sync-fir-idempotenza.oracolo.spec.ts`.

**Interfaces:**
- Consumes:
  - fake in-process (`creaApp()`, certificato di prova), come `rentri-api.client.numero-fir.oracolo.spec.ts`;
  - canale di controllo `/__controllo/completa-transazione` per completare la transazione;
  - un repository FIR in memoria che implementa `prenotaTrasmissioneRentri` e `registraTransazioneInAttesa` con la stessa semantica del Task 3. Va scritto nello spec: il comportamento SQL è già provato nel Task 3.

- [ ] **Step 1: test che falliscono.**
  - `'polling scaduto e nuovo tentativo: una sola POST / sulla fake, FIR legato al numero dell\'esito'`:
    1. primo `execute` con il client configurato a `maxTentativi: 1`, sulla transazione non ancora completata → `willRetry: true`;
    2. completa la transazione dal canale di controllo con un esito che porta `numero_fir`;
    3. secondo `execute` → `success: true`;
    4. conta le `POST /` ricevute dalla fake (hook `onRequest` di Fastify sull'app in-process, filtrato su metodo `POST` e path radice dei formulari): atteso **1**.
  - `'due execute concorrenti sullo stesso FIR: una sola POST /'`.
- [ ] **Step 2:** `npm run test:oracolo -- sync-fir-idempotenza`. Atteso: FAIL sul codice del Task 3, prima del Task 4. Se si esegue dopo il Task 4, il test va visto fallire tornando temporaneamente al flusso con `creaFormulario` sempre chiamato (`git stash` della modifica allo use case), poi ripristinato.
- [ ] **Step 3:** nessun codice di produzione nuovo. Se il test fallisce dopo il Task 4, la correzione va nello use case, non nel test.
- [ ] **Step 4:** stesso comando, poi `npm run test:oracolo -- rentri`. Atteso: PASS.
- [ ] **Step 5:** commit `test(rentri): un solo formulario sull'ente con polling scaduto e job concorrenti`.

## Verifica finale

- [ ] Unitari del perimetro:
  - `npx jest --runInBand --forceExit src/application/rentri src/domain/fir src/infrastructure/rentri src/infrastructure/queue src/infrastructure/jobs src/api/rentri`;
  - il resto con `JWT_SECRET` come nei Global Constraints.
- [ ] Postgres: `npm run test:postgres -- fir-prisma`.
- [ ] Oracolo: `npm run test:oracolo -- rentri`.
- [ ] Frontend: `fir-detail.component.spec.ts` e `rentri-sync.service.spec.ts`.
- [ ] Lint sui file toccati: `npx eslint <file>`.
- [ ] Nota per la PR, insieme alla Fase 0 o dopo:
  - al deploy, i FIR rimasti `SYNCING` con l'istante di avvio `NULL` vengono presi dal job di ripresa come "interrotti prima del 202" e diventano `RENTRI_TRASMISSIONE_INCERTA`;
  - query informativa, sola lettura e con approvazione: `SELECT count(*) FROM firs WHERE rentri_sync_status = 'SYNCING'`. Sul VPS di collaudo atteso 0, perché `SYNCING` non veniva mai salvato.
