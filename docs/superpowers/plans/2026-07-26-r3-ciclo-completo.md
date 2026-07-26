# R3 — Il ciclo completo del formulario digitale

> **Per agenti esecutori:** SUB-SKILL RICHIESTA: `superpowers:subagent-driven-development`. I passi usano checkbox (`- [ ]`).

**Obiettivo:** nessuna operazione del formulario digitale nativo deve richiedere il portale RENTRI. Il destinatario accetta o respinge (anche parzialmente), il trasportatore dichiara trasbordo e sosta tecnica, il formulario cambia destinatario o si annulla con nota — tutto dentro WasteFlow, con lo stato dell'ente sempre coerente con quello che l'utente vede.

**Il criterio di valore resta quello di R1:** l'utente non cambia piattaforma. Le operazioni vivono nella pagina di dettaglio del FIR (`/fir/:id`), non in un pannello RENTRI separato.

---

## 0. Raccomandazione: questo programma va spezzato in due piani

R3, come descritta nel design del programma, comprende **undici operazioni distinte** più un nodo architetturale (il doppio ciclo di vita) che va risolto **prima** di scrivere una qualsiasi di esse, perché le attraversa tutte. Ho verificato il contratto (`docs/contracts/rentri/formulari.yaml`) e c'è una complicazione non esplicitata nel design che cambia la stima: **quasi ogni operazione di scrittura non si conclude da sola**. Lo stato `StatoFormulario` (riga 10173) alterna stati "Inserimento…" a stati "Firma…" prima di arrivare a un esito stabile — es. l'accettazione passa da `InserimentoAccettazione` a `FirmaAccettazione` e solo dopo `POST /{numero_fir}/hash` + `POST /{numero_fir}/acquisizione-firma` diventa `Accettato` o `RespintoAccettatoParzialmente`. Lo stesso vale per annotazione, trasbordo, sosta tecnica, cambio destinatario e annullamento (`FirmaAnnullamento`, riga 10194). **Se l'orchestrazione scrittura→firma non è a posto, ogni operazione di R3 si ferma a metà e l'utente finisce comunque sul portale per firmare** — la stessa promessa che R3 dovrebbe mantenere.

Propongo quindi il taglio:

- **Questo piano (R3)** copre: l'infrastruttura comune (riconciliazione dei due stati, orchestrazione scrittura+firma, azioni disponibili come motore della UI) e le operazioni a più alto valore/urgenza — **accettazione e respingimento anche parziale**, **annullamento con note**, **allegati**, **stampa PDF**, **consultazione stato e azioni**. Sono le operazioni che il committente ha nominato per prime e quelle su cui la scadenza normativa del 15/09/2026 (memoria `rifiuti-rentri-non-conforme`) pesa di più: senza accettazione/respingimento e annullamento digitali, il ciclo del FIR non si chiude comunque in WasteFlow.
- **R3-bis (piano da scrivere dopo, non in questo file)** copre le operazioni di trasporto in corsa: **trasbordo parziale e totale, sosta tecnica, cambio destinatario, modifica di quantità e dati di trasporto, annotazioni**. Riusano esattamente l'infrastruttura costruita qui (Task 1-3) — sono più numerose ma non introducono nodi architetturali nuovi. Farne un piano a parte evita un documento da 20+ task che nessun esecutore porta a termine in una sessione, e permette di verificare l'infrastruttura comune su un sottoinsieme prima di replicarla cinque volte.

Se il coordinatore preferisce un'unica fase, i Task 8-13 di questo piano sono comunque il punto di innesto: R3-bis aggiungerebbe, per ciascuna nuova operazione, un task nella stessa forma di Task 6 (metodo client + use case + firma automatica + test oracolo + pulsante pilotato da `/azioni`).

---

## Vincoli globali

- **Italiano** in ogni testo utente; verbi del mestiere («accetta il carico», «respingi il carico», «dichiara il trasbordo», «annulla il formulario»), mai del protocollo («invia accettazione», «avvia sync»).
- **`data-testid` dal primo commit**, secondo `e2e/SELECTORS-DEBT.md`. Il blocco azioni di `fir-detail.component.ts` ha già `data-testid="fir-detail-actions"`: i nuovi pulsanti seguono lo stesso pattern (`fir-detail-rentri-accetta`, `fir-detail-rentri-respingi`, ecc.).
- **Prettier** sui file toccati prima di ogni commit.
- Suite da non far calare: **backend 106 suite / 987 test**, **oracolo 6 suite / 13 test**, **frontend 53 test**. Ogni task che aggiunge codice aggiunge test, mai il contrario.
- Le spec contro l'oracolo si chiamano `*.oracolo.spec.ts`, vivono accanto al codice infrastrutturale (`apps/backend/src/infrastructure/rentri/`), girano con `npm run test:oracolo` (`jest -c jest.oracolo.config.js --forceExit --ci --runInBand`), **mai** nella suite unitaria.
- Ogni scrittura verso RENTRI resta dietro `RolesGuard` con `@Roles('SUPER_ADMIN','ADMIN','OPERATOR')` — stesso pattern di `RentriSyncController` (guardia a livello di classe, motivata da adempimento normativo). VIEWER **mai**.
- **RENTRI risponde 423 bandendo** chi insiste con richieste non valide. Ogni nuovo use case verifica **prima** della chiamata che l'operazione richiesta compaia nella risposta di `GET /{numero_fir}/azioni` per il soggetto corrente: se non c'è, l'operazione non parte e lo dice, senza mai tentare la richiesta. Questo è il meccanismo di difesa richiesto in Task 2 ed è precondizione di ogni task successivo.
- **L'oracolo accetta qualunque corpo**: non può validare i modelli dati di scrittura (`DatiAccettazioneModel`, `DatiAnnullamentoModel`, ecc.). I test oracolo di questo piano verificano il **ciclo** (202→stato→firma→esito, 400/403/429/423, filtro di `/azioni`), non la correttezza dei campi del corpo. Non dichiarare conforme ciò che l'oracolo non giudica — annotarlo esplicitamente nel commento del test, come già fatto nei test oracolo di R1/P2.
- Commit in italiano, senza attribuzione ad AI.

---

## Stato di partenza (fine R1, verificato sul codice)

**Aggregate del ciclo di vita** — `apps/backend/src/domain/fir/aggregates/fir.aggregate.ts`:
- `FIRStato`: `BOZZA | EMESSO | IN_TRANSITO | CONSEGNATO | ANNULLATO` (stato interno WasteFlow).
- Campi RENTRI: `rentriNumeroFir`, `rentriTransazioneId`, `rentriOrigineLegame` (`TRASMESSO_DA_NOI | ACQUISITO_DA_TERZI | AGGANCIO_MANUALE`), `rentriNumeroFirProposto`, `rentriSyncStatus`.
- **Nessun campo rappresenta lo `StatoFormulario` dell'ente** (`InserimentoAccettazione`, `FirmaAccettazione`, `Accettato`, `RespintoAccettatoParzialmente`, `Annullato`, ecc., riga 10173 del contratto). È il buco che il Task 1 chiude.
- `annulla(_motivo: string)` (riga 376) **scarta il motivo**: commento nel codice «In production, store motivo in a separate field or event». È un difetto noto da correggere nel Task 5, non un dettaglio.
- Esiste un **secondo aggregate**, `apps/backend/src/domain/fir/fir.aggregate.ts`, usato solo dal sottosistema firma (P3, stati stringa `DRAFT|SIGNED_BY_PRODUCER|...`). **Non è quello su cui lavora R3** — va usato/riferito solo per riusarne la logica di firma (hash + `acquisizione-firma`), mai per lo stato del ciclo.

**RENTRIApiClient** — `apps/backend/src/infrastructure/rentri/rentri-api.client.ts`: implementa solo `creaFormulario`, `leggiFormulario`, `attendiEsito` (polling 202→200/303→result) e la resilienza condivisa (403 mai ritentato, 429/423/5xx con backoff, max 5 tentativi). **Nessun metodo per accettazione, allegati, annullamento, stampa, stato o azioni**: vanno scritti da zero in questo piano, riusando `eseguiRichiestaConResilienza`.

**Fake RENTRI** (`tools/rentri-fake/src/routes/formulari.ts`) implementa solo l'elenco e il dettaglio; `POST /` sta in `transazioni.ts`. **Nessuna rotta di questo piano esiste nella fake.** Prerequisito reale, non rimandabile: senza queste rotte non c'è oracolo contro cui verificare.

**Controller e use case RENTRI esistenti** — `apps/backend/src/api/rentri/rentri-sync.controller.ts` (`@Controller('rentri/sync')`), use case in `apps/backend/src/application/rentri/`. R3 aggiunge un controller dedicato al ciclo del formulario (`rentri-fir-lifecycle.controller.ts`, `@Controller('rentri/fir')`) per non sovraccaricare quello di sync, che resta di competenza R0/R1.

**Errori leggibili** — `apps/backend/src/application/rentri/rentri-error-presentation.ts`: `traduciErroreRentri` gestisce oggi `RENTRI_FORBIDDEN`, `RENTRI_RATE_LIMITED`, `RENTRI_VALIDATION_ERROR`, `RENTRI_MISSING_NUMERO_FIR`, default. Va esteso, non riscritto.

**Frontend** — `apps/frontend/src/app/features/fir/fir-detail.component.ts`: sezione «Azioni disponibili» (`haAzioni()`, blocco `data-testid="fir-detail-actions"`) già pilotata da booleani locali (`canTrasmettereRentri()`, `canRiprovareRentri()`, ecc.). I nuovi pulsanti si innestano nello stesso blocco, ma **cambiano il meccanismo**: non più booleani calcolati localmente sullo stato interno, bensì la lista `azioni` restituita da `GET /{numero_fir}/azioni` (Task 2) — è il punto centrale del design di questo piano.

**Prisma** (`apps/backend/prisma/schema.prisma`): `model FIR` (riga 227) ha i campi RENTRI di R0/R1; `model RENTRISyncLog` (riga 1445) è immutabile per design, un log per tentativo di sincronizzazione. Nessun campo per lo stato ente, nessuna tabella per gli allegati RENTRI, nessun campo per la nota di annullamento.

---

## Il nodo architetturale: due cicli di vita, una sola verità visibile

**Il problema.** `FIRStato` (WasteFlow) e `StatoFormulario` (RENTRI) non sono la stessa cosa e non transitano insieme. Un'accettazione o un annullamento accadono **su RENTRI**, in risposta a una chiamata che WasteFlow ha fatto o che un altro soggetto (produttore, trasportatore, destinatario che non usa WasteFlow) ha fatto direttamente sul portale. Se WasteFlow continuasse a decidere `CONSEGNATO` o `ANNULLATO` in base a un click locale, indipendente dall'esito reale su RENTRI, l'utente vedrebbe due verità: il suo elenco FIR direbbe una cosa, l'ente un'altra.

**La decisione.** Introdurre un campo nuovo e distinto, **non sostituire** `FIRStato`:

- `rentriStatoFormulario` — nuovo campo Prisma su `model FIR`, enum che rispecchia **esattamente** `StatoFormulario` del contratto (stesso set di valori, stesso naming italiano). È la copia locale, in sola lettura per l'utente, dell'ultimo stato noto dell'ente. Si aggiorna **solo** leggendo dall'ente (esito di un'operazione, `GET /{numero_fir}/stato`, `GET /{numero_fir}/azioni`), mai da un'azione locale isolata.
- `FIRStato` (interno) resta il ciclo operativo di WasteFlow — quello che governa scadenze, viste, permessi locali — ma **per un FIR legato a RENTRI (`rentriNumeroFir` non nullo), le transizioni verso `CONSEGNATO` e `ANNULLATO` non sono più decidibili da un pulsante locale indipendente: sono calcolate deterministicamente da `rentriStatoFormulario`** tramite una funzione di mappatura pura sull'aggregate (`FIR.applyRentriStato(nuovoStato: StatoFormulario)`, Task 1). Esempio di mappatura: `Accettato` / `RespintoAccettatoParzialmente` → `CONSEGNATO`; `Annullato` → `ANNULLATO`; ogni stato `Inserimento*`/`Firma*` intermedio → resta `IN_TRANSITO` (il FIR è "in lavorazione presso l'ente", non è né bozza né concluso).
- **Chi comanda, in una frase:** finché il FIR non è legato a RENTRI, comanda WasteFlow (comportamento di oggi, invariato). Da quando è legato, **RENTRI comanda l'esito**, WasteFlow **rispecchia** — i pulsanti locali che duplicavano un esito RENTRI (`presaInCarico()`, `confermaConsegna()`, `annulla()` invocati senza passare da RENTRI) vengono **disabilitati per i FIR legati** e sostituiti dai pulsanti che invocano l'operazione reale sull'ente. Non è ambiguo: un solo scrittore per stato, a seconda che il legame esista o no.
- **Tracciabilità del cambio:** ogni riconciliazione (`applyRentriStato`) è un evento di dominio distinto da una transizione locale (`RentriStatoRiconciliato`, non `FIREmesso`/`FIRAnnullato`), per non confondere in cronologia "l'utente ha cliccato" con "l'ente ha risposto".

**Perché non l'alternativa (un solo stato unificato):** fondere i due enum in uno solo perderebbe la distinzione fra "il documento è bozza in WasteFlow" (concetto che RENTRI non ha) e "il formulario è nello stato tecnico `InserimentoTrasportoSuccessivo`" (concetto che WasteFlow non deve esporre all'utente come stato operativo primario — nella lista FIR l'utente continua a vedere `IN_TRANSITO`, non `FirmaTrasbordoParziale`). Due campi, una regola di priorità esplicita, è più semplice da spiegare e da testare di un enum ibrido con stati inventati.

---

### Task 1: Il campo di stato RENTRI e la riconciliazione

**Files:**
- `apps/backend/prisma/schema.prisma` (nuovo enum `RentriStatoFormulario`, nuovo campo `FIR.rentriStatoFormulario`, migrazione)
- `apps/backend/src/domain/fir/aggregates/fir.aggregate.ts` (`applyRentriStato`, mappatura, nuovo evento `RentriStatoRiconciliato`)
- `apps/backend/src/domain/fir/aggregates/fir.aggregate.spec.ts`

- [ ] **Step 1: Scrivere i test della mappatura prima del codice**

Una tabella di casi: ogni valore di `StatoFormulario` del contratto (22 valori, righe 10175-10196 — il conteggio "21" scritto qui in origine era sbagliato: verificato contando le voci del contratto) verso il `FIRStato` interno atteso, più il caso "FIR non legato a RENTRI → `applyRentriStato` rifiuta la chiamata" (non ha senso riconciliare senza legame) e il caso "il nuovo stato ente è più indietro di quello già registrato" (es. per via di una race fra polling — non deve far regredire `FIRStato` da `CONSEGNATO` a `IN_TRANSITO`).

- [ ] **Step 2: Migrazione Prisma**

`RentriStatoFormulario` enum con gli stessi 22 valori del contratto, in italiano dove il contratto è già in italiano (lo è: `InserimentoQuantita`, `Accettato`, ecc. — copiare i nomi esatti, non tradurli di nuovo). Campo `FIR.rentriStatoFormulario RentriStatoFormulario?` nullable (un FIR non legato non ce l'ha).

- [ ] **Step 3: Implementare `applyRentriStato` sull'aggregate**

Deterministica, pura, nessuna chiamata di rete al suo interno (la chiamata di rete la fa lo use case che la invoca, Task 2-6). Emette `RentriStatoRiconciliato{numeroFir, statoRentriPrecedente, statoRentriNuovo, statoInternoRisultante}`.

- [ ] **Step 4: Verifica che i vecchi metodi locali siano bloccati per i FIR legati**

`presaInCarico()`, `confermaConsegna()`, `annulla()` devono rifiutarsi (eccezione di dominio chiara, non silenziosa) se `rentriNumeroFir` è valorizzato — il commento dell'eccezione indica quale operazione RENTRI usare al suo posto. Test per ciascuno dei tre.

- [ ] **Step 5: Commit**

---

### Task 2: Consultazione stato e azioni disponibili — il motore della UI

Va scritto **prima** delle operazioni di scrittura: è la difesa contro il 423 e la fonte di verità per quali pulsanti mostrare.

**Files:**
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts` (nuovi metodi `leggiStato`, `leggiAzioniDisponibili`)
- `apps/backend/src/application/rentri/get-azioni-disponibili.use-case.ts` (nuovo)
- `apps/backend/src/api/rentri/rentri-fir-lifecycle.controller.ts` (nuovo, `GET /rentri/fir/:id/azioni`)
- `tools/rentri-fake/src/routes/formulari.ts` (nuove rotte `GET /{numero_fir}/stato`, `GET /{numero_fir}/azioni`, con una tabella di stato interna alla fake che tenga traccia delle transizioni already-simulated)
- Test oracolo: `apps/backend/src/infrastructure/rentri/rentri-azioni.oracolo.spec.ts`

- [ ] **Step 1: Estendere la fake con una macchina a stati minima**

La fake oggi non tiene alcuno stato del FIR (`GET /{numero_fir}` restituisce dati statici di fixture). Perché `/azioni` abbia senso, la fake deve **tenere in memoria** lo stato corrente di ciascun FIR creato in test e restituire, per `GET /{numero_fir}/azioni`, un sottoinsieme plausibile di `Operazione` coerente con quello stato (es. in `BOZZA`/`InserimentoQuantita` non compare `Accettazione`; dopo `Accettato` non compare più `TrasbordoParziale`). **Non serve replicare tutta la macchina a stati reale dell'ente** — serve una simulazione sufficiente a testare che WasteFlow: (a) chiama `/azioni` prima di proporre un pulsante, (b) non chiama mai un'operazione assente dalla lista, (c) gestisce correttamente il caso in cui l'ente rifiuta con 400/403 comunque (difesa in profondità, non fiducia cieca nella cache locale di `/azioni`).

- [ ] **Step 2: Metodi client**

`leggiStato(tenantId, numeroFir): Promise<{stato: StatoFormulario, versione}>` — `GET /{numero_fir}/stato`.
`leggiAzioniDisponibili(tenantId, numeroFir, identificativoSoggetto): Promise<{stato, azioni: Operazione[]}>` — `GET /{numero_fir}/azioni` con `identificativo_soggetto` obbligatorio (query, riga 1348 del contratto — è il CF del soggetto per cui si chiedono le azioni, non un parametro opzionale).

- [ ] **Step 3: Use case + endpoint**

`GetAzioniDisponibiliUseCase`: legge `/azioni`, aggiorna `rentriStatoFormulario` via `applyRentriStato` (ogni lettura di stato è anche un'occasione di riconciliazione, silenziosa se non cambia nulla), mappa ogni `Operazione` del contratto a un verbo di mestiere italiano (tabella statica: `Accettazione → "Accetta o respingi il carico"`, `TrasbordoParziale → "Dichiara un trasbordo parziale"`, `Annulla → "Annulla il formulario"`, ecc. — usata anche dal frontend, va condivisa come costante esportata, non duplicata FE/BE).

- [ ] **Step 4: Test**

Unitario sull'use case (mock del client); oracolo sul ciclo reale contro la fake estesa (Step 1).

- [ ] **Step 5: Commit**

---

### Task 3: Orchestrazione scrittura + firma — l'infrastruttura comune

> **RISCRITTO il 2026-07-26 dopo una decisione del committente.** La versione
> precedente di questo task faceva firmare a noi il `digest_to_sign` con il
> meccanismo interno di P3. Quella strada è stata **scartata**: v. l'ADR
> `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md`. In sintesi — una
> firma è qualificata solo se la chiave resta sotto controllo esclusivo del
> firmatario; se firmiamo noi, non lo è, e su un documento che vale in
> contestazione una firma non qualificata è peggio di nessuna firma.
>
> **Si usa la firma remota RENTRI**: `POST /{numero_fir}/invia-a-dispositivo`
> con un `credentials_id`. La chiave privata non passa mai da noi.

Senza questo, ogni operazione successiva si ferma nello stato `Firma*` e l'utente torna sul portale. È il task che rende reali i Task 4-7 (e, in futuro, R3-bis).

**PREREQUISITO BLOCCANTE — non iniziare senza:** il contratto versionato cita
le «API Firma remota RENTRI» **per nome, senza URL né documentazione**, e non
contiene alcun endpoint per creare o interrogare un `credentials_id`. Inoltre
`invia-a-dispositivo` risponde **200 senza corpo**: nessun id di transazione,
nessun webhook — quindi il contratto **non dice come sapere se l'utente ha poi
autorizzato sul dispositivo**. Prima di implementare serve la risposta
dell'ente su: (a) dove sono documentate quelle API e come si ottiene un
`credentials_id`; (b) come si conosce l'esito di un invio a dispositivo.
Ipotesi plausibile ma **non accertata**: l'esito si manifesta come
valorizzazione di `dati_firma.credentials_id` leggibile da `GET /{numero_fir}`.
Non costruire su questa ipotesi senza conferma.

**Files:**
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts` (metodo `inviaADispositivo`; `rollbackFirma` resta utile per annullare una firma già apposta)
- `apps/backend/src/application/rentri/completa-operazione-con-firma.use-case.ts` (nuovo, generico — prende `numero_fir` e tipo di operazione, non conosce i dettagli di accettazione/trasbordo/ecc.)
- Test oracolo: `apps/backend/src/infrastructure/rentri/rentri-firma-operazione.oracolo.spec.ts`

- [ ] **Step 1: Chiarire i due punti del prerequisito**

Se la risposta dell'ente non è disponibile, **fermarsi e riferire**: non
inventare un meccanismo di attesa dell'esito. Un finto polling su un endpoint
che non esiste è esattamente il tipo di sottosistema che questo progetto ha già
scritto e mai cablato cinque volte.

- [ ] **Step 2: Scrivere `CompletaOperazioneConFirmaUseCase`**

Sequenza: (1) l'operazione specifica (Task 4-7) ha già fatto la sua `POST` e il
formulario è in uno stato `Firma*`; (2) `POST /{numero_fir}/invia-a-dispositivo`
con il `credentials_id` del firmatario; (3) l'utente autorizza **sul proprio
dispositivo**, fuori dalla nostra applicazione; (4) si rileva l'esito con il
meccanismo chiarito allo Step 1; (5) si richiama `applyRentriStato` con lo stato
finale.

**Fail-closed**: se un passaggio fallisce, o se l'utente non autorizza,
l'operazione resta visibilmente «in attesa di firma» — mai finta come
completata, mai uno stato incoerente silenzioso. L'attesa dell'autorizzazione
non è un errore: è uno stato legittimo e va mostrato come tale, con l'indicazione
di cosa deve fare l'utente sul proprio dispositivo.

- [ ] **Step 3: Il provider `qes` non deve più mentire**

`qes-signature.provider.ts` oggi è uno stub che lancia sempre eccezione. Con
questa decisione non è più la strada principale: va **rimosso** oppure marcato
esplicitamente come ramo futuro (l'opzione 2 dell'ADR, integrazione QTSP via
API CSC). Non lasciarlo a suggerire una capacità che non esiste — è il difetto
che questo progetto ripete.

- [ ] **Step 4: Test**

Un test per ogni fallimento: invio a dispositivo rifiutato; utente che non
autorizza (o autorizzazione non ancora arrivata); esito in errore. Nessuno di
questi deve corrompere `rentriStatoFormulario` con uno stato mai confermato
dall'ente.

- [ ] **Step 5: Commit**

---

### Task 4: Accettazione e respingimento (anche parziale)

`POST /{numero_fir}/accettazione` (riga 431). Non è un endpoint a sé per il respingimento: `DatiAccettazioneModel.tipo_accettazione` vale `A` (intero), `P` (parziale), `R` (respinto) — righe 6828, 6837.

**Files:**
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts` (`inviaAccettazione`)
- `apps/backend/src/application/rentri/accetta-o-respingi-fir.use-case.ts`
- `apps/backend/src/api/rentri/rentri-fir-lifecycle.controller.ts` (`POST /rentri/fir/:id/accettazione`)
- `tools/rentri-fake/src/routes/formulari.ts` (rotta + transizione di stato nella macchina minima del Task 2)
- Test oracolo: `apps/backend/src/infrastructure/rentri/rentri-accettazione.oracolo.spec.ts`

- [ ] **Step 1: Test del use case**

Tre scenari (accettazione intera, parziale, respingimento), con verifica che il campo `tipo_accettazione` mandato al client corrisponda esattamente alla scelta dell'utente — è il punto dove un bug manderebbe un'accettazione quando l'utente intendeva respingere.

- [ ] **Step 2: Precondizione da `/azioni`**

Il use case verifica che `Accettazione` compaia nella lista azioni corrente (Task 2) prima di procedere. Se non c'è, errore leggibile («questo formulario non è nella fase di accettazione»), nessuna chiamata.

- [ ] **Step 3: Collegare `CompletaOperazioneConFirmaUseCase` (Task 3)**

- [ ] **Step 4: Frontend**

In `fir-detail.component.ts`: dialog «Accetta il carico» con tre opzioni (intero / parziale / respingi), motivazione obbligatoria per parziale e respinto (il campo che il contratto si aspetta in `DatiAccettazioneModel`, verificarne il nome esatto — righe 6820-6845). `data-testid="fir-detail-rentri-accettazione-dialog"`, `-accettazione-completa`, `-accettazione-parziale`, `-accettazione-respingi`, `-accettazione-confirm-button`.

- [ ] **Step 5: Test frontend + oracolo**

- [ ] **Step 6: Commit**

---

### Task 5: Annullamento con note

`POST /{numero_fir}/annulla-fir` (riga 1232, corrente — **non** `/annulla`, deprecato) + `POST /{numero_fir}/note-annullamento` (riga 1642).

**Files:**
- `apps/backend/prisma/schema.prisma` (campo per la nota di annullamento, oggi scartata — vedi difetto in "Stato di partenza")
- `apps/backend/src/domain/fir/aggregates/fir.aggregate.ts` (correggere `annulla(motivo)` per persistere davvero il motivo, non solo per RENTRI ma anche per l'annullamento locale di un FIR non legato)
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts` (`annullaFormulario`, `inviaNoteAnnullamento`)
- `apps/backend/src/application/rentri/annulla-fir-rentri.use-case.ts`
- Test oracolo: `apps/backend/src/infrastructure/rentri/rentri-annullamento.oracolo.spec.ts`

- [ ] **Step 1: Correggere il difetto esistente prima di estenderlo**

Scrivere il test che oggi fallirebbe (`annulla('errore di pesatura')` seguito da una lettura che verifica il motivo persistito) e farlo passare. Farlo qui perché l'annullamento RENTRI ne dipende: le note di annullamento (`/note-annullamento`) sono lo stesso testo, e non ha senso mandarlo all'ente se WasteFlow stesso lo scarta.

- [ ] **Step 2: Use case**

Sequenza: `annulla-fir` → firma (Task 3, stato `FirmaAnnullamento`) → `note-annullamento` col motivo → riconciliazione (`Annullato` → `FIRStato.ANNULLATO`).

- [ ] **Step 3: Precondizione da `/azioni`** (come Task 4, Step 2)

- [ ] **Step 4: Frontend**

Dialog «Annulla il formulario» con motivo obbligatorio (textarea), avviso che l'operazione è irreversibile lato ente. `data-testid="fir-detail-rentri-annulla-dialog"`, `-annulla-motivo-input`, `-annulla-confirm-button`.

- [ ] **Step 5: Test + Commit**

---

### Task 6: Allegati

`POST /{numero_fir}/allegato` (776), `GET/DELETE /{numero_fir}/allegato/{allegato_id}` (882).

**Files:**
- `apps/backend/prisma/schema.prisma` (nuovo model `FIRAllegatoRentri`: id, firId, rentriAllegatoId, filename, mimeType, sizeBytes, caricatoDa, caricatoAlle — sostituisce l'uso del generico `attachmentUrls Json?`, non tipizzato e senza modo di elencare/cancellare singolarmente)
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts` (`caricaAllegato`, `scaricaAllegato`, `eliminaAllegato`)
- `apps/backend/src/application/rentri/gestisci-allegati-fir.use-case.ts`
- Test oracolo: `apps/backend/src/infrastructure/rentri/rentri-allegati.oracolo.spec.ts`

- [ ] **Step 1: Migrazione Prisma per `FIRAllegatoRentri`**

- [ ] **Step 2: Use case di caricamento con vincolo di dimensione**

Il contratto non impone qui il limite di 5MB/3MB (quelli sono copia cartacea/xFIR, vincoli diversi — verificare nel contratto se `/allegato` ha un proprio limite dichiarato prima di assumerlo uguale); qualunque sia il limite, va verificato **lato nostro prima di chiamare l'ente**, per lo stesso motivo del 423: un allegato di dimensione sbagliata è una richiesta non valida che l'ente potrebbe contare contro il chiamante.

- [ ] **Step 3: Frontend**

Sezione allegati nella pagina di dettaglio: elenco, upload, download, elimina. `data-testid="fir-detail-allegati-list"`, `-allegati-upload-input`, `-allegati-row-{id}`, `-allegati-elimina-{id}`.

- [ ] **Step 4: Test + Commit**

---

### Task 7: Stampa PDF e consultazione stato

`GET /{numero_fir}/pdf` (1739) + `GET /{numero_fir}/stato` (già usato in lettura dal Task 2, qui esposto anche come azione utente esplicita "aggiorna lo stato").

**Files:**
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts` (`scaricaPdf`)
- `apps/backend/src/application/rentri/scarica-pdf-fir.use-case.ts`
- `apps/backend/src/api/rentri/rentri-fir-lifecycle.controller.ts` (`GET /rentri/fir/:id/pdf`)

- [ ] **Step 1: Use case + endpoint** (proxy dello stream PDF, non un redirect al portale)

- [ ] **Step 2: Autorizzazione**

Verifica che l'utenza chiamante abbia "incarichi per (o coincida con) almeno uno dei soggetti coinvolti" (riga 1748 del contratto) — non è automatico che ogni utente del tenant possa scaricare il PDF di ogni FIR: replicare qui la stessa cautela tenant-scoped già applicata al dettaglio FIR in R1 (404, non 403, per non rivelare esistenza).

- [ ] **Step 3: Frontend**

Pulsante «Scarica il PDF» in `fir-detail.component.ts`, `data-testid="fir-detail-rentri-scarica-pdf"`. Pulsante «Aggiorna lo stato», per quando l'utente sospetta che qualcosa sia cambiato su RENTRI senza notifica (chiama `/azioni`, Task 2, e riconcilia).

- [ ] **Step 4: Test + Commit**

---

### Task 8: I pulsanti pilotati da `/azioni`, non più da booleani locali

È il cambio di meccanismo annunciato nello "Stato di partenza": sostituire i booleani calcolati localmente con la lista reale restituita dall'ente.

**Files:**
- `apps/frontend/src/app/features/fir/fir-detail.component.ts`
- `apps/frontend/src/app/features/fir/fir-detail.component.spec.ts`

- [ ] **Step 1: Caricare `/azioni` all'apertura della pagina e dopo ogni operazione**

Sostituisce (per i FIR legati a RENTRI) i booleani `canTrasmettereRentri()`/`canRiprovareRentri()`/ecc. dove duplicano una decisione che l'ente può già dare: il pulsante compare **se e solo se** l'operazione è nella lista `azioni` corrente, mappata al verbo di mestiere (tabella condivisa del Task 2, Step 3).

- [ ] **Step 2: Mantenere i pulsanti locali dove non c'è equivalente RENTRI**

`Emetti` (bozza→emesso, puramente interno prima della trasmissione) resta locale — non tutto passa da `/azioni`, solo ciò che l'ente governa.

- [ ] **Step 3: Test**

Verificare empiricamente che un'azione **assente** dalla risposta di `/azioni` non produca mai un pulsante cliccabile (non solo "non dovrebbe" — un test che inietta una risposta senza `Accettazione` e verifica l'assenza del `data-testid` corrispondente).

- [ ] **Step 4: Commit**

---

### Task 9: Errori leggibili per le nuove operazioni

**Files:**
- `apps/backend/src/application/rentri/rentri-error-presentation.ts`
- `apps/backend/src/application/rentri/rentri-error-presentation.spec.ts`

- [ ] **Step 1: Nuovi casi**

Almeno: operazione non ammessa nello stato corrente (rilevata localmente da `/azioni`, non dovrebbe mai arrivare a RENTRI ma va gestita se arriva comunque — messaggio: «il formulario non è più nella fase in cui questa operazione è possibile: la pagina si aggiornerà con lo stato corrente»); firma rifiutata a metà operazione (Task 3, Step 3: «l'operazione non si è completata sull'ente: puoi riprovare» — con verbo dell'operazione specifica, non generico); allegato troppo grande o formato non ammesso (validato lato nostro, quindi il messaggio non è nemmeno un errore RENTRI ma una validazione locale — comunque in italiano, comunque azionabile).

- [ ] **Step 2: Un test per ciascun nuovo caso, col testo esatto che l'utente vedrebbe**

- [ ] **Step 3: Commit**

---

### Task 10: Verifica end-to-end

- [ ] **Step 1: Scenari Playwright**

Accetta un carico per intero; respingi parzialmente con motivazione; annulla un formulario con nota e verifica che compaia nella cronologia; carica e cancella un allegato; scarica il PDF; verifica che un'azione non disponibile non mostri il pulsante.

- [ ] **Step 2: Suite oracolo complete**

Tutte le nuove spec (`rentri-azioni`, `rentri-firma-operazione`, `rentri-accettazione`, `rentri-annullamento`, `rentri-allegati`) più le esistenti, verificando che nessuna sia calata. Verifica esplicita che almeno un test per famiglia inietti un 423/429 e che il client non ritenti oltre i limiti previsti.

- [ ] **Step 3: Suite complete (backend, oracolo, frontend), nessuna cala**

- [ ] **Step 4: Commit**

---

## Criteri di completamento di R3

- [ ] Un utente accetta, respinge (anche parzialmente) e annulla (con nota) un formulario interamente da WasteFlow.
- [ ] Lo stato che l'utente vede (`FIRStato`) e lo stato dell'ente (`rentriStatoFormulario`) non divergono mai in modo silenzioso: per un FIR legato, l'esito visibile all'utente è sempre derivato da un'operazione confermata dall'ente, mai da un click locale indipendente.
- [ ] Ogni pulsante d'azione mostrato per un FIR legato a RENTRI corrisponde a un'operazione presente nella risposta reale di `GET /{numero_fir}/azioni` in quel momento — mai un'operazione che l'ente rifiuterebbe.
- [ ] Allegati e stampa PDF funzionano senza uscire da WasteFlow.
- [ ] Nessuna chiamata di scrittura verso RENTRI parte senza aver verificato la precondizione locale (`/azioni` o stato interno) — a tutela del rischio di ban 423.
- [ ] Ogni errore mostra cosa è successo e cosa fare, mai un codice tecnico.
- [ ] `data-testid` presenti su tutto ciò che è nuovo.
- [ ] Le tre suite restano verdi, con i nuovi test aggiunti.

## Ciò che R3 non fa

- **Trasbordo parziale/totale, sosta tecnica, cambio destinatario, modifica di quantità e dati di trasporto, annotazioni** — proposti come **R3-bis**, piano separato che riusa l'infrastruttura dei Task 1-3 di questo piano.
- **Registri cronologici**: l'API non è esposta (invariato da R0/R1/R2).
- **La vidimazione del cartaceo, l'iscrizione anagrafica, la "quarta copia" come oggetto distinto**: restano fuori contratto, invariato.
- **Il valore legale della firma**: gli endpoint di hash/firma usati nel Task 3 restano — come in P3 — privi di valore legale in assenza di un QTSP. R3 li usa solo per far avanzare lo stato tecnico del formulario presso l'ente, non dichiara conformità normativa della firma.
- **Copia cartacea e copia digitale (xFIR) di chiusura ciclo** (`/copia-cartacea/*`, `/copia-digitale/*`): sono canali distinti dal ciclo di scrittura ordinario del formulario e non sono nell'elenco di operazioni richiesto per questa fase — da valutare come fase propria se il committente li richiede.
- **Riconciliazione periodica in background** (polling autonomo per formulari legati da terzi che cambiano stato senza che WasteFlow chiami nulla): è R5 (robustezza e osservabilità). Qui la riconciliazione avviene solo come effetto collaterale di un'azione dell'utente (apertura pagina, esecuzione di un'operazione).
