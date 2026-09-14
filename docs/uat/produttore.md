# UAT — Anagrafica Produttore

- **Data**: 2026-09-14
- **Entità**: `Produttore` (registro anagrafiche rifiuti — la più usata, prima
  ad essere coperta perché è la più stabile)
- **Fonti lette** (nessun campo/comportamento sotto è stato indovinato):
  - `apps/backend/src/api/registry/dto/create-registry.dto.ts` (CreateProduttoreDto/UpdateProduttoreDto)
  - `apps/backend/src/domain/registry/entities/produttore.ts`
  - `apps/backend/src/domain/registry/value-objects/partita-iva.ts`
  - `apps/backend/src/domain/registry/value-objects/indirizzo.ts`
  - `apps/backend/src/application/registry/use-cases/{create,update,delete,get,list}-produttore.use-case.ts`
  - `apps/backend/src/infrastructure/persistence/produttore-prisma.repository.ts`
  - `apps/backend/src/api/registry/registry.controller.ts`
  - `apps/backend/prisma/schema.prisma` (model `Produttore`, model `FIR` campi `producerId`/`producerName`)
  - `apps/frontend/src/app/features/registry/produttori-list.component.ts`
  - `apps/backend/src/main.ts` (ValidationPipe globale: `whitelist: true, forbidNonWhitelisted: true`)
- **Automazione**: `e2e/tests/registry/produttore.spec.ts` (Playwright), page
  object `e2e/pages/anagrafiche.page.ts`
- **Verifica di questa sessione**: `npx tsc --noEmit -p e2e/tsconfig.json`
  (0 errori) + `npx prettier --check` sui file toccati. **La suite NON è
  stata eseguita contro un'app viva** (vincolo d'ambiente: macchina con meno
  di 2 GB liberi, nessuno stack avviato in questa sessione) — dichiarato,
  non taciuto.

## 1. Mappa dell'entità

| Aspetto                                             | Dettaglio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Campi**                                           | `ragioneSociale` (stringa, obbligatoria, trim); `partitaIVA` (stringa, obbligatoria, esattamente 11 cifre numeriche — `PartitaIVA.isValid`, nessuna validazione del checksum reale, commento esplicito "For MVP, we accept any 11-digit number"); `sedeLegale` (oggetto obbligatorio: `via`/`civico`/`cap` (5 cifre)/`comune`/`provincia`, tutti obbligatori e non vuoti; `nazione` opzionale, default `"Italia"`); `email` opzionale (validata `@IsEmail`); `telefono` opzionale (stringa libera, nessun formato imposto); `pec` opzionale (stringa libera — **nota**: nonostante il nome, non è validata come indirizzo email, solo `@IsString`) |
| **Codice fiscale**                                  | **Non applicabile**: l'entità non ha un campo codice fiscale (solo partita IVA — coerente con un'anagrafica di soggetto economico, non di persona fisica)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Codice ISTAT del comune**                         | **Non applicabile a livello di colonna**: non esiste un campo `codiceIstat` sul modello `Produttore`. Il comune/provincia sono validati (se le tabelle `IstatProvincia`/`IstatComune` sono popolate) contro il catalogo condiviso in `CreateProduttoreUseCase.execute` via `ReferenceDataService.validateLocalita` — validazione best-effort: se le tabelle sono vuote, `{ok:true}` senza controllo                                                                                                                                                                                                                                                |
| **CRUD — create**                                   | `POST /registry/produttori`, ruoli `SUPER_ADMIN`\|`ADMIN`\|`OPERATOR`. Rifiuta partita IVA duplicata **nello stesso tenant** (`@@unique([tenantId, partitaIVA])` + controllo applicativo preventivo)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **CRUD — read singolo**                             | `GET /registry/produttori/:id`, qualunque ruolo autenticato (nessun `@Roles` sulla rotta)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **CRUD — read lista**                               | `GET /registry/produttori`, qualunque ruolo autenticato. **Non paginata lato dominio**: l'intero elenco del tenant è restituito come "pagina unica" (`toPaginated` in registry.controller.ts) — nessun filtro/ordinamento server-side oltre lo scoping per tenant                                                                                                                                                                                                                                                                                                                                                                                  |
| **CRUD — update**                                   | `PUT /registry/produttori/:id`, ruoli `SUPER_ADMIN`\|`ADMIN`\|`OPERATOR`. **`partitaIVA` è immutabile**: `UpdateProduttoreDto` non la include, e il `ValidationPipe` globale (`forbidNonWhitelisted: true`) rifiuta (400) qualunque richiesta che la includa, invece di ignorarla silenziosamente                                                                                                                                                                                                                                                                                                                                                  |
| **CRUD — delete**                                   | `DELETE /registry/produttori/:id`, ruoli `SUPER_ADMIN`\|`ADMIN`\|`OPERATOR`. **Hard delete**, nessun soft-delete/restore                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Relazioni**                                       | `FIR.producerId` referenzia (per id) il produttore d'origine, ma il FIR conserva anche uno **snapshot immutabile** dei campi (`producerName`, `producerPartitaIva`, `producerAddress`) — decisione di prodotto documentata (memoria progetto `rifiuti-fir-data-model.md`): il FIR è un documento legale, non un join live                                                                                                                                                                                                                                                                                                                          |
| **Cancellazione di un'anagrafica referenziata**     | **Decisione di prodotto, non un difetto** (`schema.prisma` righe ~272-275, decisione 2026-06-09): "Il FIR è un documento legale: conserva lo snapshot, non un join live". `FIR.producerId`/`carrierId`/`receiverId` sono colonne `String?` **senza** relazione Prisma (`@relation`) verso le tabelle anagrafiche, DI PROPOSITO — cancellare un produttore/trasportatore/destinatario referenziato da un FIR riesce sempre, e questo è corretto: l'invariante che conta è che il documento già creato **non cambi** (vedi riga sotto)                                                                                                               |
| **Invariante — lo snapshot del FIR non cambia mai** | Alla creazione di un FIR, `CreateFIRUseCase` congela un `ParteFIR` (ragioneSociale/partitaIva/indirizzo) per ciascuna delle tre parti, letto dal registro in quel momento. Da lì in poi il FIR non guarda più il registro: cancellare, modificare o rinominare il produttore/trasportatore/destinatario originale non tocca il documento già emesso o in bozza. È la garanzia legale del documento — vedi test dedicato                                                                                                                                                                                                                            |
| **Macchina a stati**                                | Non applicabile: l'anagrafica non ha stati (a differenza del FIR)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Effetti collaterali**                             | Nessuna statistica/dashboard/giacenza dipende direttamente dal record anagrafico (il FIR usa lo snapshot, non un riferimento live — vedi sopra). Nessuna notifica/email è generata da create/update/delete del produttore (a differenza di trasportatore/destinatario, che hanno la scadenza — vedi `docs/uat/trasportatore-destinatario.md`)                                                                                                                                                                                                                                                                                                      |
| **Integrazioni terze**                              | Nessuna diretta. Il produttore compare nel payload RENTRI di un FIR (`apps/backend/src/application/rentri/mappatura/mappa-parti.ts`) ma quella mappatura non è esercitata da questo documento (di competenza dei test RENTRI esistenti)                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Permessi per ruolo**                              | Lettura (GET singolo/lista): qualunque ruolo autenticato, incluso `VIEWER`. Scrittura (create/update/delete): solo `SUPER_ADMIN`/`ADMIN`/`OPERATOR` — `VIEWER` riceve 403 (`RolesGuard`)                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Isolamento per azienda**                          | Query sempre scoped per `tenantId` (letto dal contesto richiesta, mai dal "primo tenant del DB" — commento esplicito in `produttore-prisma.repository.ts` `getContextTenantId`). L'unicità della partita IVA è per tenant, non globale: due aziende diverse possono avere produttori con la stessa partita IVA registrati indipendentemente                                                                                                                                                                                                                                                                                                        |
| **Concorrenza / doppio invio**                      | Nessun lock ottimistico esplicito. La difesa contro il doppio submit è il controllo di unicità sulla partita IVA in `CreateProduttoreUseCase`: un secondo invio identico (stessa partita IVA) viene rifiutato con 400 "Produttore with this Partita IVA already exists" — non è idempotenza in senso stretto (non restituisce il record già creato), ma impedisce la duplicazione                                                                                                                                                                                                                                                                  |

## 2. Matrice di copertura

| Riga della mappa                                                                           | Test esistente (prima di questa sessione)                                                                               | Test aggiunto in questa sessione                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campi obbligatori (ragioneSociale, partitaIVA, sedeLegale/via/civico/cap/comune/provincia) | **Nessuno** (colonna vuota, dichiarato)                                                                                 | `produttore.spec.ts` → "ragione sociale mancante...", "sede legale mancante...", "CAP con formato non valido..."                                                                              |
| Formato partita IVA (11 cifre)                                                             | **Nessuno**                                                                                                             | `produttore.spec.ts` → "partita IVA con formato non valido..."                                                                                                                                |
| Codice fiscale (non applicabile)                                                           | —                                                                                                                       | Documentato in mappa, nessun test (non c'è nulla da testare)                                                                                                                                  |
| Codice ISTAT comune (non applicabile a livello di colonna)                                 | **Nessuno**                                                                                                             | Non testato in questa sessione: la validazione ISTAT best-effort dipende dallo stato del seed di reference-data nell'ambiente, fuori perimetro di un test sull'entità Produttore              |
| Create (happy path)                                                                        | **Nessuno**                                                                                                             | `produttore.spec.ts` → "happy path: crea e modifica un produttore dalla UI"                                                                                                                   |
| Update (ragione sociale)                                                                   | **Nessuno**                                                                                                             | idem, stesso test (fase di modifica)                                                                                                                                                          |
| Update — partitaIVA immutabile                                                             | **Nessuno**                                                                                                             | `produttore.spec.ts` → "la partita IVA è immutabile..."                                                                                                                                       |
| Delete (happy path)                                                                        | **Nessuno**                                                                                                             | Non coperto via UI in questa sessione (gap testid sul pulsante di conferma di PrimeNG, vedi `e2e/SELECTORS-DEBT.md`); coperto indirettamente dal teardown via API in ogni test                |
| Invariante — snapshot del FIR immutato dopo la cancellazione del produttore                | **Nessuno**                                                                                                             | `produttore.spec.ts` → "cancellare il produttore non cambia nome/P.IVA/indirizzo già congelati sul FIR"                                                                                       |
| Lista (GET, scoping tenant)                                                                | **Nessuno**                                                                                                             | Coperto indirettamente da "doppio invio" e dal test di isolamento                                                                                                                             |
| Permessi — lettura per VIEWER                                                              | **Nessuno**                                                                                                             | Non esplicitamente testato in questo file (GET senza `@Roles`: nessun 403 atteso) — la negazione di scrittura per VIEWER è la riga sotto                                                      |
| Permessi — scrittura negata per VIEWER                                                     | Parzialmente: `e2e/tests/rbac/write-permissions-ui.spec.ts` (solo visibilità/disabilitazione del bottone "Nuovo" in UI) | `produttore.spec.ts` → "VIEWER non può creare un produttore (403)" — verifica diretta lato API, indipendente dalla UI                                                                         |
| Isolamento fra due aziende                                                                 | **Nessuno**                                                                                                             | `produttore.spec.ts` → "un produttore creato in un tenant non è visibile nell'altro" — **salta a runtime** se l'admin di test non gestisce almeno 2 tenant (nessuna fixture nota in anticipo) |
| Doppio invio / idempotenza                                                                 | **Nessuno**                                                                                                             | `produttore.spec.ts` → "stesso payload inviato due volte: solo il primo viene creato"                                                                                                         |
| Concorrenza (lock ottimistico)                                                             | **Nessuno**                                                                                                             | Non applicabile: l'entità non ha un meccanismo di lock ottimistico da testare (nessun campo di versione)                                                                                      |

## 3. Casi UAT

### UAT-PROD-01 — Creazione di un produttore (percorso felice)

- **Precondizioni**: utente con ruolo OPERATOR/ADMIN/SUPER_ADMIN autenticato, su `/produttori`.
- **Passi**:
  1. Cliccare "Nuovo produttore".
  2. Compilare ragione sociale, partita IVA (11 cifre), via/civico/CAP/comune/provincia.
  3. Cliccare "Salva".
- **Risultato atteso**: il dialog si chiude, la nuova riga compare nella tabella con i dati inseriti.
- **Pulizia**: il produttore creato viene cancellato via `DELETE /registry/produttori/:id` (teardown automatico della suite E2E, registro `fixtures/risorse.ts`).
- **Automazione**: `e2e/tests/registry/produttore.spec.ts::happy path: crea e modifica un produttore dalla UI`

### UAT-PROD-02 — Modifica della ragione sociale

- **Precondizioni**: un produttore esistente.
- **Passi**:
  1. Cliccare l'icona "Modifica" sulla riga del produttore.
  2. Cambiare la ragione sociale.
  3. Cliccare "Salva".
- **Risultato atteso**: la riga mostra la nuova ragione sociale; la partita IVA resta invariata. Il campo è VISIBILE anche in modifica ma disabilitato (readonly, `[disabled]="editMode"` in `produttori-list.component.ts`) — non "non proposto": l'utente lo vede col valore attuale, ma non può cambiarlo. Coerente con `UpdateProduttoreDto`/il `ValidationPipe` globale: il payload PUT non include mai `partitaIVA` in modifica (v. UAT-PROD-05, che verifica lato API il motivo per cui il form si comporta così — se il campo fosse editabile e il suo valore venisse inviato, l'update fallirebbe con 400 per whitelist).
- **Pulizia**: come UAT-PROD-01 (stesso record).
- **Automazione**: `e2e/tests/registry/produttore.spec.ts::happy path: crea e modifica un produttore dalla UI` (stesso test, fase di modifica)

### UAT-PROD-03 — Campi obbligatori mancanti sono rifiutati

- **Precondizioni**: nessuna (chiamata diretta all'API, la UI non permette di isolare quale campo manca oltre al toast generico "Compila tutti i campi obbligatori").
- **Passi**: inviare `POST /registry/produttori` senza `ragioneSociale`, oppure senza `sedeLegale`, oppure con `sedeLegale.cap` di formato non valido.
- **Risultato atteso**: risposta 400 per ciascun caso, nessun record creato.
- **Pulizia**: nessuna (nessun record creato in caso di rifiuto).
- **Automazione**: `e2e/tests/registry/produttore.spec.ts` → i tre test del describe "validazioni"

### UAT-PROD-04 — Partita IVA con formato non valido è rifiutata

- **Precondizioni**: nessuna.
- **Passi**: inviare `POST /registry/produttori` con `partitaIVA: "123"`.
- **Risultato atteso**: risposta 400, nessun record creato.
- **Pulizia**: nessuna.
- **Automazione**: `e2e/tests/registry/produttore.spec.ts::partita IVA con formato non valido (non 11 cifre) è rifiutata (400)`

### UAT-PROD-05 — La partita IVA è immutabile in modifica

- **Precondizioni**: un produttore esistente.
- **Passi**: inviare `PUT /registry/produttori/:id` includendo `partitaIVA` nel corpo.
- **Risultato atteso**: risposta 400 (il `ValidationPipe` globale rifiuta l'intera richiesta per proprietà non whitelisted, non la ignora silenziosamente).
- **Pulizia**: il produttore di setup viene cancellato via API a fine test.
- **Automazione**: `e2e/tests/registry/produttore.spec.ts::la partita IVA è immutabile: inviarla in update è rifiutata (400, whitelist)`

### UAT-PROD-06 — Un utente VIEWER non può creare un produttore

- **Precondizioni**: utente con ruolo VIEWER autenticato.
- **Passi**: inviare `POST /registry/produttori` con un payload valido usando il token VIEWER.
- **Risultato atteso**: risposta 403, nessun record creato.
- **Pulizia**: nessuna (nessun record creato).
- **Automazione**: `e2e/tests/registry/produttore.spec.ts::VIEWER non può creare un produttore (403)`

### UAT-PROD-07 — Isolamento: un produttore di un'azienda non è visibile in un'altra

- **Precondizioni**: un utente ADMIN che gestisce almeno due tenant (aziende).
- **Passi**:
  1. Leggere l'elenco produttori del tenant B (baseline).
  2. Creare un produttore nel tenant A.
  3. Rileggere l'elenco produttori del tenant B.
- **Risultato atteso**: l'elenco del tenant B è invariato (stesso conteggio, id del nuovo produttore assente); l'elenco del tenant A include il nuovo produttore.
- **Pulizia**: il produttore creato nel tenant A viene cancellato esplicitamente dal test stesso (header `X-Tenant-ID: A`), **non** dal teardown automatico standard (che cancellerebbe sul tenant primario dell'admin, non su A, lasciando un residuo invisibile — vedi commento nel test).
- **Automazione**: `e2e/tests/registry/produttore.spec.ts::un produttore creato in un tenant non è visibile nell'altro` — **salta a runtime** se l'ambiente non fornisce un admin con ≥2 tenant

### UAT-PROD-08 — Doppio invio: lo stesso produttore non viene duplicato

- **Precondizioni**: nessuna.
- **Passi**: inviare due volte lo stesso `POST /registry/produttori` (stessa partita IVA) in sequenza.
- **Risultato atteso**: il primo invio crea il record (201); il secondo viene rifiutato (400 "Produttore with this Partita IVA already exists"); l'elenco contiene esattamente una riga con quella partita IVA.
- **Pulizia**: il produttore creato dal primo invio viene cancellato via API a fine test.
- **Automazione**: `e2e/tests/registry/produttore.spec.ts::stesso payload inviato due volte: solo il primo viene creato`

### UAT-PROD-09 — Cancellare un produttore non altera un FIR che lo referenzia

- **Precondizioni**: un produttore, un trasportatore e un destinatario di prova; un FIR in BOZZA creato con quelle tre parti (lo snapshot è congelato alla creazione, non solo all'emissione: un FIR in BOZZA basta a provare l'invariante).
- **Passi**:
  1. Leggere lo snapshot del produttore sul FIR appena creato (`GET /fir/:id` → campo `produttore`).
  2. Cancellare il produttore (`DELETE /registry/produttori/:id`).
  3. Rileggere lo snapshot del produttore sullo stesso FIR.
- **Risultato atteso**: la cancellazione del produttore riesce (per progetto, vedi mappa); lo snapshot letto al passo 3 è **identico** a quello letto al passo 1 — ragione sociale, partita IVA e indirizzo non cambiano perché il documento non guarda più il registro dopo la creazione.
- **Pulizia**: il produttore è già cancellato dal test (è l'azione sotto test); trasportatore e destinatario di prova via API a fine test; il FIR di prova via pulizia a livello di database (nessun endpoint di cancellazione HTTP per i FIR, vedi `e2e/utils/db-locale.ts`), automatica tramite `registra('fir', id)`.
- **Automazione**: `e2e/tests/registry/produttore.spec.ts::cancellare il produttore non cambia nome/P.IVA/indirizzo già congelati sul FIR`

## 4. Correzione rispetto alla prima stesura di questo documento

La prima stesura di questo documento (stessa sessione) descriveva il punto
sopra come un "difetto di prodotto": cancellare un'anagrafica referenziata
da un FIR non viene impedito. Il committente ha verificato sul sorgente e
confermato che i fatti riportati erano esatti, ma la lettura era sbagliata:
non è un difetto, è una decisione di prodotto esplicita e documentata
(`schema.prisma` righe ~272-275, decisione 2026-06-09) — il FIR è un
documento legale che conserva uno snapshot, non un riferimento vivo al
registro. Il test e questo documento sono stati riscritti sull'invariante
che conta davvero: lo snapshot di un FIR non cambia mai, qualunque cosa
succeda dopo all'anagrafica di origine.
