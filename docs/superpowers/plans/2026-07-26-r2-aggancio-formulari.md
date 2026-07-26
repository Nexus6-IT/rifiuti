# R2 — Aggancio ai formulari esistenti: portare dentro WasteFlow ciò che è nato altrove

> **Per agenti esecutori:** SUB-SKILL RICHIESTA: `superpowers:subagent-driven-development`. I passi usano checkbox (`- [ ]`).

**Obiettivo:** un'azienda può trovare, su RENTRI, i formulari in cui compare — **anche quelli creati da un'altra controparte** — e agganciarli al proprio gestionale **senza aprire il portale**. L'aggancio è tracciato, reversibile, e non produce mai un doppio legame.

**Il criterio di valore:** oggi, se un trasportatore o un produttore terzo crea un FIR digitale che coinvolge l'azienda cliente, quell'azienda deve aprire il portale RENTRI per accorgersene e prenderne visibilità. R2 chiude questo buco: la ricerca e l'aggancio vivono nell'applicativo.

**Fonte di verità per ogni endpoint, campo e vincolo:** `docs/contracts/rentri/formulari.yaml` (openapi 3.0.4, `version: 1.0.20260723-1089`). Ogni riferimento sotto è tracciato al path/riga di quel file. Nessuna deduzione da `tools/rentri-fake/` o da memoria.

## Vincoli globali (validi per ogni task)

- **Italiano** in ogni testo utente. Identificatori di codice in inglese; i termini di dominio RENTRI (`numero_fir`, `num_iscr_sito`, `identificativo_soggetto`, `visibilita_sito_acquisita`) identici alla specifica, mai tradotti nei nomi di campo/variabile che dialogano col contratto.
- **Verbi del mestiere, non del protocollo**: «aggancia questo formulario», «rilascia l'aggancio» — mai «acquisisci visibilità sito» in un testo utente (è terminologia dell'ente, va nel tooltip/dettaglio tecnico, non nel verbo dell'azione principale).
- **`data-testid` dal primo commit**, secondo la convenzione di `e2e/SELECTORS-DEBT.md` (`{area}-{azione}-{businessId}`, badge `{area}-status-badge`, dialog `{area}-confirm-dialog[-confirm-button|-cancel-button]`).
- **Prettier** sui file toccati prima di ogni commit: un solo errore blocca il gate di rilascio.
- **Baseline da non far calare**: backend **106 suite / 987 test**, oracolo **6 suite / 13 test**, frontend **53 test**. Chi esegue il piano verifica il numero effettivo all'inizio (può essere cresciuto rispetto a queste cifre per lavoro intermedio) e non lo fa scendere.
- Le spec contro l'oracolo si chiamano `*.oracolo.spec.ts`, girano con `npm run test:oracolo`, **non** nella suite unitaria (`tools/rentri-fake` non è un workspace npm — non importarne codice da `apps/backend/src`, solo colpirlo via HTTP).
- **423 = ban del chiamante**: ogni nuova chiamata verso RENTRI introdotta in questo piano (ricerca, acquisizione, rilascio) deve rispettare la stessa disciplina di R1 — nessun retry automatico su 403/423, backoff su 429, mai una sequenza di chiamate scatenata da un click ripetuto dell'utente senza debounce/lock lato backend.
- **L'oracolo accetta qualunque corpo**: non dichiarare conforme un modello dati di scrittura (es. il body di `acquisizione-visibilita`, che nel contratto non richiede corpo, o gli eventuali filtri di `GET /`) solo perché l'oracolo risponde 202/200. La verifica di conformità dei parametri di query e degli header resta l'unica cosa controllabile con certezza (l'oracolo valida path/query, non la semantica del corpo).
- Commit in italiano, senza attribuzione ad AI.

## Stato di partenza, accertato leggendo il codice (non R1 sulla carta: R1 risulta già implementato)

A differenza di quanto indicato nel piano R1 come "stato di partenza", il codice **oggi** (verificato leggendo i file, non i piani) mostra R0+R1 conclusi:

- `apps/backend/prisma/schema.prisma`: `FIR.rentriNumeroFir`, `rentriTransazioneId`, `rentriOrigineLegame` (enum `RentriOrigineLegame`: `TRASMESSO_DA_NOI` | `ACQUISITO_DA_TERZI` | `AGGANCIO_MANUALE` — **i tre valori esistono già nello schema**, ma solo `TRASMESSO_DA_NOI` è mai assegnato da codice, in `fir.aggregate.ts::markRENTRISynced`/`confermaLegameRENTRI`), `rentriNumeroFirProposto`, `Tenant.rentriModalitaLegame` (`AUTOMATICA`/`IBRIDA`/`MANUALE`, default `MANUALE`).
- `apps/backend/src/domain/fir/aggregates/fir.aggregate.ts`: `markRENTRISynced`, `proporreLegameRENTRI`, `confermaLegameRENTRI`, `rifiutaLegameRENTRI`, `canSyncToRENTRI` esistono. **Nessun metodo imposta `ACQUISITO_DA_TERZI` o `AGGANCIO_MANUALE`**: sono valori dell'enum previsti dal commento di schema ma senza codice che li produca. È esattamente il gap che R2 chiude.
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts`: `creaFormulario`, `leggiFormulario` (= `GET /{numero_fir}`, righe 283+ del contratto), `attendiEsito`. **Nessun metodo per `GET /` (ricerca), `POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}`, `POST /{numero_fir}/rilascio-visibilita/{num_iscr_sito}`.**
- `apps/backend/prisma/schema.prisma` → `RentriCredential`: un solo record per tenant (`tenantId @unique`), campi `clientId`/`certificatePem`/`privateKeyEnc`/`algorithm`/`environment`. **Nessun campo `num_iscr_sito`**: l'unità locale del soggetto non è modellata da nessuna parte del programma.
- `FIR` ha `@@index([tenantId, rentriNumeroFir])` — un indice, non un vincolo di unicità: **oggi nulla impedisce che due FIR locali dello stesso tenant abbiano lo stesso `rentriNumeroFir`.**
- `ActivityLog` (righe 604+ schema) è il log generico di audit già usato su altre azioni sensibili del FIR (`tenantId`, `userId`, `firId`, `action`, `description`, `metadata`, `correlationId`) — distinto da `RENTRISyncLog`, che è specifico dei tentativi di *trasmissione* (payload = xFIR). **Va riusato per l'audit dell'aggancio manuale**, non `RENTRISyncLog`: un aggancio non è un tentativo di trasmissione, è un'azione umana di collegamento — impastarlo nel log delle trasmissioni confonderebbe "quante volte abbiamo provato a mandare questo FIR" con "chi lo ha collegato e quando".
- `e2e/SELECTORS-DEBT.md` conferma R1 concluso lato frontend: `fir-detail.component.ts` con `/fir/:id`, badge `rentri-sync-badge-{numeroFir}`, azioni `fir-rentri-trasmetti-{id}` / `fir-rentri-riprova-{id}` / `fir-rentri-conferma-legame-{id}`. **Non esiste ancora nulla per la ricerca/aggancio**: né area dedicata, né testid.
- `apps/backend/src/api/rentri/rentri-sync.controller.ts` (`/rentri/sync/*`) è protetto da `RolesGuard` con `@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')` — VIEWER escluso. Stessa policy da applicare ai nuovi endpoint di ricerca/aggancio: sono anch'essi un adempimento verso un ente pubblico.

## Cosa dice il contratto sull'aggancio (verificato riga per riga)

1. **Ricerca** — `GET /` (formulari.yaml riga 15). Filtro `identificativo_soggetto` (righe 34-51): elenca *tutti* i FIR digitali in cui il CF compare come uno qualunque dei soggetti indicati, **indipendentemente da chi li ha creati**. Alternativo: `num_iscr_sito` (righe 22-33) — i due filtri sono mutuamente esclusivi (uno dei due deve essere valorizzato, mai nessuno, cfr. righe 29 e 45). Risultato `FormularioItemResult` (riga 9686) include `visibilita_sito_acquisita` (riga 9794): «indica se il formulario è stato acquisito in visibilità da almeno un'unità locale [...] riconducibile al soggetto per cui viene fatta la richiesta». **Questo flag, non un secondo giro di ricerca, è il modo corretto di sapere se un formulario trovato va ancora acquisito.**
2. **Dettaglio** — `GET /{numero_fir}` (riga 283), già implementato in `leggiFormulario`. Nessun vincolo aggiuntivo da chiarire: la lettura del dettaglio non richiede aver acquisito la visibilità se l'utenza ha comunque incarico su uno dei soggetti coinvolti (stessa condizione di riga 43).
3. **Acquisizione di visibilità (corrente)** — `POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}` (riga 657). Condizione esplicita (righe 666-668): l'utenza deve avere incarichi per (o coincidere con) almeno uno dei soggetti coinvolti nel FIR, **e** il `num_iscr_sito` indicato deve essere riferibile a quell'utenza. Non richiede corpo. Asincrona (202 + polling, stessa meccanica di ogni scrittura del contratto).
   - `POST /{numero_fir}/acquisizione/{num_iscr_sito}` (riga 716) è la stessa operazione **deprecata**: non va usata in codice nuovo, ma il codice deve saperla riconoscere come alias storico se mai comparisse in log di terzi (non è un problema di R2, solo una nota per chi legge il contratto).
4. **Rilascio di visibilità (corrente)** — `POST /{numero_fir}/rilascio-visibilita/{num_iscr_sito}` (riga 2030). È l'operazione inversa: "abbandona" un FIR precedentemente acquisito **senza cancellarlo dall'ente** — il formulario resta su RENTRI, smette solo di comparire tra quelli visibili a quell'unità locale. `POST /{numero_fir}/respingi` (riga 1980) è l'alias deprecato.
5. **La differenza fra "acquisizione" e "acquisizione-visibilità"** (uno dei punti che il committente ha chiesto di chiarire dal contratto): **non sono due operazioni concettualmente diverse. `/acquisizione/{num_iscr_sito}` è il nome deprecato dello stesso endpoint** — il contratto lo dichiara esplicitamente riga 720: *"⚠️[DEPRECATO] - utilizzare /{numeroFIR}/acquisizione-visibilita/{numIscrSito} - Acquisizione visibilità FIR"*. Non esiste, nel contratto, un'operazione distinta chiamata solo "acquisizione" che faccia qualcosa di diverso dall'acquisire la visibilità: è una rinominazione dell'ente fra una versione del contratto e l'altra, non un secondo meccanismo. **Conseguenza per il piano: un solo metodo client, verso il path corrente.** Il punto realmente distinto è invece fra *acquisire la visibilità* (rendere visibile un FIR già esistente su RENTRI, creato da terzi, nella propria unità locale) e *creare* un FIR (`POST /`, che genera un `numero_fir` nuovo) — quello sì un'operazione diversa, già coperta da R1.
6. **Nessun import automatico dei dati**: acquisire la visibilità non copia nulla nel nostro database. Serve sempre un `GET /{numero_fir}` esplicito per avere i dati.

---

### Task 1: Modellare l'unità locale (`num_iscr_sito`) del tenant

Senza questo, non si può chiamare né la ricerca (quando si usa il filtro `num_iscr_sito`) né l'acquisizione/il rilascio di visibilità: il parametro non esiste da nessuna parte nel programma.

**Decisione di scope, da scrivere nel commit**: `RentriCredential` è oggi un record unico per tenant (`tenantId @unique`). R2 aggiunge un campo `numIscrSito` opzionale a quel record, **non** un nuovo modello `RentriUnitaLocale` con cardinalità N. Un tenant con più unità locali operative su RENTRI resta fuori da questa fase (nota esplicita in "Ciò che R2 non fa"): il recupero automatico delle unità locali da `anagrafiche.yaml` (`GET /operatore/{num_iscr}/siti`) è anagrafiche, non formulari, ed è materia di R4. Qui il valore è inserito a mano dall'amministratore del tenant, che lo conosce già (è stampato sul certificato di iscrizione RENTRI dell'unità).

**Files:**
- `apps/backend/prisma/schema.prisma` (campo su `RentriCredential`)
- `apps/backend/prisma/migrations/<timestamp>_add_num_iscr_sito/migration.sql`
- `apps/backend/src/api/rentri/dto/set-rentri-credential.dto.ts`
- `apps/backend/src/api/rentri/rentri-credential.controller.ts` (+ `.spec.ts`)
- `apps/backend/src/infrastructure/rentri/rentri-credential.service.ts` (+ `.spec.ts`)

- [ ] **Step 1: Scrivere i test prima**

  `rentri-credential.service.spec.ts`: salvare/leggere `numIscrSito`; validare il pattern `^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$` (formulari.yaml riga 684, ricorrente su ogni path che referenzia `num_iscr_sito`) **prima** di persistere — un valore fuori pattern verso RENTRI diventerebbe un 400 rumoroso durante la ricerca/aggancio, meglio bloccarlo subito con un messaggio comprensibile.

- [ ] **Step 2: Migrazione Prisma**

  Campo `numIscrSito String? @map("num_iscr_sito") @db.VarChar(30)` su `RentriCredential`. Nullable: i tenant esistenti non ce l'hanno.

- [ ] **Step 3: Estendere l'endpoint credenziale**

  `PUT /rentri/credential` (o l'endpoint esistente di scrittura) accetta anche `numIscrSito`. Stessa policy di ruolo dell'endpoint attuale (verifica quale sia in `rentri-credential.controller.ts` e non abbassarla).

- [ ] **Step 4: Interfaccia**

  Nella pagina certificato (`/rentri/certificato`) aggiungere il campo con etichetta e descrizione in italiano: «Numero di iscrizione della tua unità locale su RENTRI (lo trovi sul certificato di iscrizione)» — non «num_iscr_sito», che resta nel tooltip/aiuto per chi vuole il riferimento tecnico.

- [ ] **Step 5: Commit**

---

### Task 2: Il client RENTRI — ricerca, acquisizione, rilascio

**Files:**
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ts` (+ `.spec.ts`)
- `apps/backend/src/infrastructure/rentri/rentri-api.client.ricerca-aggancio.oracolo.spec.ts` (nuovo)

- [ ] **Step 1: Scrivere i test (unitari, con HTTP mockato) prima del codice**

  Tre nuovi metodi:
  - `cercaFormulari(tenantId, { identificativoSoggetto?, numIscrSito?, paging? })` → `GET /` (riga 15). **Verificare che il chiamante non passi entrambi i filtri né nessuno dei due** (righe 29, 45 del contratto: mai zero, mai due) — lanciare un errore di programmazione locale, non lasciare che RENTRI risponda 400. Gestire la paginazione dichiarata (`Paging-Page`/`Paging-PageSize`, righe 112-129, default page=1/size=100, max size=1000): un tenant con centinaia di formulari non deve rompersi al primo GET.
  - `acquisisciVisibilita(tenantId, numeroFir, numIscrSito, correlationId?)` → `POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}` (riga 657, **non** `/acquisizione/{num_iscr_sito}`, deprecato). Asincrona: riusa lo stesso `attendiEsito`/polling già scritto per `creaFormulario`, non duplicarlo.
  - `rilasciaVisibilita(tenantId, numeroFir, numIscrSito, correlationId?)` → `POST /{numero_fir}/rilascio-visibilita/{num_iscr_sito}` (riga 2030). Stessa meccanica asincrona.

- [ ] **Step 2: Implementazione**

  Riusare `eseguiRichiestaConResilienza`/`buildAuthHeaders`/`post`/`get` già presenti nel client: **non** scrivere un secondo percorso HTTP parallelo per questi tre metodi.

- [ ] **Step 3: Verifica reale contro l'oracolo**

  `rentri-api.client.ricerca-aggancio.oracolo.spec.ts`, `npm run test:oracolo`:
  - creare un formulario con `creaFormulario` (percorso già validato in R1/R0), poi cercarlo con `cercaFormulari({ identificativoSoggetto: <CF usato nel test> })` e verificare che compaia con `visibilita_sito_acquisita` coerente;
  - chiamare `acquisisciVisibilita` su un `numero_fir` valido e verificare l'esito 202→200/303 secondo lo stesso ciclo asincrono di R1;
  - chiamare `rilasciaVisibilita` sullo stesso `numero_fir` e verificare che l'operazione risponda senza errore (l'oracolo non necessariamente riflette lo stato in una successiva `GET /`, quindi il test verifica solo che il ciclo asincrono si chiuda, non un side-effect osservabile — annotarlo nel commento del test, per non promettere più di quanto l'oracolo possa attestare);
  - **423/429**: riusare (o estendere) l'harness di guasti iniettati già esistente per `rentri-api.client.resilienza.oracolo.spec.ts` per verificare che un 423 su questi tre metodi **non** scateni un retry automatico.

- [ ] **Step 4: Commit**

---

### Task 3: L'aggregate FIR — due modi distinti di legare un formulario altrui

Qui si decide, nel dominio, la risposta alla prima domanda del committente: **non un solo metodo, ma due**, perché rappresentano due situazioni diverse per l'utente.

**Decisione di progettazione (delicata, va motivata nel commit):**
- `agganciaFormularioAcquisito(numeroFir, correlationId?)` → imposta `rentriOrigineLegame = ACQUISITO_DA_TERZI`. Usato quando **non esiste alcun FIR locale** per quel movimento: il record locale viene creato da zero a partire dal dettaglio RENTRI (Task 5), e il metodo si invoca sul FIR appena creato, non su un FIR preesistente.
- `agganciaManualmente(numeroFir, correlationId?)` → imposta `rentriOrigineLegame = AGGANCIO_MANUALE`. Usato quando l'operatore riconosce che **un FIR già presente nel gestionale** (tipicamente una bozza o un record incompleto creato prima di sapere il numero ufficiale) è lo stesso movimento del formulario trovato su RENTRI: non si crea un duplicato, si completa quello che c'è. È una riconciliazione a giudizio umano — non automatizzabile, perché solo l'operatore sa che "questo carico del 12/07" e "FIR TVXYZ1234AB" sono la stessa cosa.
- Entrambi i metodi devono rifiutarsi (eccezione di dominio) se il FIR **ha già** un `rentriNumeroFir` non nullo: un formulario legato non si ri-lega, va prima rilasciato (Task 4).
- Nuovo metodo `rilasciaLegameRENTRI(correlationId?)`: azzera `rentriNumeroFir`/`rentriOrigineLegame`, **solo** se l'origine corrente è `ACQUISITO_DA_TERZI` o `AGGANCIO_MANUALE` — **mai** su un legame `TRASMESSO_DA_NOI`: un formulario che abbiamo creato noi non si "rilascia", si annullerebbe con gli endpoint del ciclo di vita (R3). Impedire questa confusione con un controllo esplicito e un messaggio di dominio chiaro, non lasciare che sia solo una convenzione UI.

**Files:**
- `apps/backend/src/domain/fir/aggregates/fir.aggregate.ts` (+ `.spec.ts`)

- [ ] **Step 1: Scrivere i test di dominio prima**

  Casi: aggancio su FIR senza legame (ok); aggancio su FIR già legato (rifiutato, con messaggio che dice l'origine esistente); rilascio su `ACQUISITO_DA_TERZI`/`AGGANCIO_MANUALE` (ok, torna a `rentriNumeroFir = null`); rilascio su `TRASMESSO_DA_NOI` (rifiutato); rilascio su FIR senza alcun legame (rifiutato, niente da rilasciare).

- [ ] **Step 2: Implementazione**

  Metodi sull'aggregate, coerenti con lo stile di `markRENTRISynced`/`confermaLegameRENTRI` già presenti (stesso modo di emettere l'evento di dominio, se il pattern esistente lo prevede — verificarlo leggendo quei due metodi prima di scrivere i nuovi).

- [ ] **Step 3: Vincolo di unicità in database**

  Migrazione: `@@unique([tenantId, rentriNumeroFir])` su `FIR` (oggi solo indice, riga 366 dello schema). In PostgreSQL un indice unique tratta i `NULL` come distinti fra loro, quindi i FIR non ancora legati (`rentriNumeroFir = null`) non collidono: il vincolo blocca solo il caso reale da evitare, due FIR locali con lo **stesso** `numero_fir` non nullo. **Prima di applicare la migrazione, verificare in un ambiente con dati reali/seed che non esistano già duplicati** (query di controllo da eseguire e riportare nel commit): se un tenant ha già due righe con lo stesso `rentriNumeroFir` per un bug pregresso, la migrazione fallisce ed è meglio scoprirlo qui che in produzione.

- [ ] **Step 4: Test dell'errore di vincolo a livello di repository**

  `fir-prisma.repository.spec.ts` (contro un database reale di test, non un mock): tentare di salvare due FIR con lo stesso `rentriNumeroFir` nello stesso tenant e verificare che il repository traduca il vincolo Postgres in un'eccezione di dominio leggibile (`FORMULARIO_GIA_AGGANCIATO` o simile), non lasciare risalire l'errore Prisma grezzo fino al controller.

- [ ] **Step 5: Commit**

---

### Task 4: L'orchestrazione — cercare, verificare, acquisire

Questo task risponde alla seconda domanda del committente: **come si evita il doppio aggancio**.

**Files:**
- `apps/backend/src/application/rentri/cerca-formulari-rentri.use-case.ts` (+ `.spec.ts`)
- `apps/backend/src/application/rentri/acquisisci-formulario-rentri.use-case.ts` (+ `.spec.ts`)
- `apps/backend/src/application/rentri/rilascia-formulario-rentri.use-case.ts` (+ `.spec.ts`)
- `apps/backend/src/application/rentri/rentri-sync.module.ts` (registrazione — **non ripetere l'errore di R0**: verificare che il modulo che dichiara questi use case sia davvero importato da `app.module`, con un test che lo accerti, non solo la dichiarazione del provider)

- [ ] **Step 1: `CercaFormulariRENTRIUseCase` — scrivere i test prima**

  Input: CF del tenant (va letto dal tenant/anagrafica esistente, non chiesto ogni volta all'utente — verificare dove il CF del soggetto è già memorizzato per il tenant, es. dati azienda). Output: lista di risultati con, **per ciascuno**, tre informazioni combinate:
  1. i dati che RENTRI restituisce (`numero_fir`, soggetti coinvolti, `visibilita_sito_acquisita`);
  2. se quel `numero_fir` **esiste già in un FIR locale del tenant** (query sul nostro database, non su RENTRI) — se sì, il risultato deve dirlo e non proporre un aggancio, altrimenti l'utente lo aggancerebbe due volte;
  3. se manca il prerequisito (`RentriCredential.numIscrSito` non impostato) — il caso non si presenta nemmeno: la ricerca stessa fallisce in modo leggibile ("configura prima la tua unità locale") prima di chiamare RENTRI, coerente col principio fail-closed di R1 Task 2.

- [ ] **Step 2: `AcquisisciFormularioRENTRIUseCase` — scrivere i test prima**

  Riceve `numeroFir` e una scelta esplicita dell'utente: **"aggancia come nuovo formulario"** oppure **"collega al FIR locale `<id>`"** (mai una terza opzione implicita "indovina tu"). Precondizioni verificate **prima** di chiamare RENTRI (fail-closed, evita 423):
  - il `numeroFir` non è già legato a un altro FIR locale del tenant (query locale, ridondante col vincolo DB del Task 3 ma verificata prima per dare un errore di dominio invece di un errore di constraint);
  - se `visibilita_sito_acquisita` era già `true` nel risultato di ricerca, **non richiamare `acquisisciVisibilita`** (sarebbe una chiamata ridondante verso un ente che banna sulle richieste non valide/superflue) — passare direttamente alla lettura del dettaglio;
  - altrimenti chiamare `acquisisciVisibilita`, attendere l'esito, poi leggere il dettaglio (`leggiFormulario`, già esistente) e:
    - ramo "nuovo formulario" → delega al Task 5 (creazione FIR locale dal dettaglio) poi `agganciaFormularioAcquisito` sul FIR appena creato;
    - ramo "collega al FIR locale" → `agganciaManualmente` sul FIR indicato dall'utente (nessuna copia automatica dei dati sul record esistente in questa fase: sovrascrivere un FIR locale con dati altrui è una decisione distinta, non richiesta esplicitamente e rischiosa se il FIR locale ha già dati validi — annotarla come possibile estensione futura, non implementarla silenziosamente).
  - **Audit**: ogni chiamata riuscita scrive un `ActivityLog` (non `RENTRISyncLog` — vedi motivazione nello stato di partenza) con `action = 'RENTRI_AGGANCIO_FORMULARIO'`, `userId`, `firId`, `metadata` contenente `numeroFir` e l'origine scelta.

- [ ] **Step 3: `RilasciaFormularioRENTRIUseCase` — scrivere i test prima**

  Simmetrico: verifica che l'origine sia `ACQUISITO_DA_TERZI`/`AGGANCIO_MANUALE` (il vincolo di dominio del Task 3 lo garantisce già, ma l'use case deve tradurre l'eccezione in un errore HTTP leggibile), chiama `rilasciaVisibilita`, poi `rilasciaLegameRENTRI()` sull'aggregate, scrive `ActivityLog` con `action = 'RENTRI_RILASCIO_FORMULARIO'`. **Il FIR locale non viene cancellato**: resta come record, solo senza più `rentriNumeroFir` — coerente con la semantica del contratto ("abbandona senza cancellare dall'ente").

- [ ] **Step 4: Commit**

---

### Task 5: Creare un FIR locale dal dettaglio RENTRI

Risponde alla prima domanda del committente per il ramo "non esiste nulla in locale".

**Files:**
- `apps/backend/src/application/rentri/crea-fir-da-dettaglio-rentri.use-case.ts` (+ `.spec.ts`)

- [ ] **Step 1: Scrivere i test prima**

  Mappare `DettaglioFormulario` (formulari.yaml, modello restituito da `GET /{numero_fir}`, righe ~9032+) sui campi del `FIR` locale. Applicare la stessa decisione di prodotto già presa per l'anagrafica FIR (memoria di progetto, decisione PO 2026-06-09): **snapshot immutabile dai registri**, non riferimenti dinamici — i dati del produttore/trasportatore/destinatario copiati dal dettaglio RENTRI diventano uno snapshot nel FIR locale al momento dell'aggancio, non un collegamento live che si aggiorna da solo (un refresh successivo è un'azione esplicita futura, non R2).
  - Test con dettaglio completo → FIR locale coerente, `rentriNumeroFir` valorizzato, `rentriOrigineLegame` **non ancora impostato qui** (lo imposta il chiamante, Task 4, dopo la creazione).
  - Test con dettaglio che manca di un campo che il nostro modello richiede come obbligatorio → errore di dominio leggibile ("il formulario RENTRI non contiene `<campo>`, necessario per registrarlo nel gestionale"), **non** un FIR locale a metà creato silenziosamente.

- [ ] **Step 2: Implementazione**

  Riusare `create-fir.use-case.ts` o il repository `FIRPrismaRepository` per la persistenza — non duplicare la logica di creazione FIR.

- [ ] **Step 3: Commit**

---

### Task 6: Endpoint REST

**Files:**
- `apps/backend/src/api/rentri/rentri-sync.controller.ts` (o un nuovo `rentri-formulari.controller.ts`, se il controller attuale diventa troppo grande — decidere e motivare nel commit)
- `apps/backend/src/api/rentri/dto/*` (nuovi DTO)

- [ ] **Step 1: Scrivere i test del controller prima**

  - `GET /rentri/formulari?identificativoSoggetto=...` (o senza parametro, usando il CF già noto del tenant) — ricerca.
  - `POST /rentri/formulari/:numeroFir/aggancia` con body `{ modalita: 'NUOVO' } | { modalita: 'ESISTENTE', firId: string }` — acquisizione.
  - `POST /rentri/fir/:id/rilascia-legame-rentri` — rilascio, scoped sul FIR locale (non sul `numeroFir` in query, per restare coerente con la convenzione già in uso su `/rentri/sync/fir/:id/conferma-legame`).
  - Stessa policy `RolesGuard`/`@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')` del controller esistente. **Verificare empiricamente che un VIEWER riceva 403** su tutti e tre.
  - **Tenant scoping**: un tentativo di rilasciare il legame di un FIR di un altro tenant deve rispondere **404, non 403** (convenzione P4, nessuna fuga di esistenza — stesso principio già richiesto in R1 Task 4 per il dettaglio FIR).

- [ ] **Step 2: Implementazione**

- [ ] **Step 3: Mappare gli errori del dominio/use case sui codici HTTP corretti** (400 per precondizioni di dominio, 404 per non trovato/altro tenant, 409 per "già agganciato da un altro FIR locale" — un conflitto, non un errore di validazione generico).

- [ ] **Step 4: Commit**

---

### Task 7: Errori leggibili specifici dell'aggancio

Estende `rentri-error-presentation.ts` (R1), non lo sostituisce.

**Files:**
- `apps/backend/src/application/rentri/rentri-error-presentation.ts` (+ `.spec.ts`)

- [ ] **Step 1: Nuovi casi da tradurre, con test uno per famiglia**

  - Formulario già agganciato a un altro FIR locale → «Questo formulario è già collegato a un altro FIR nel gestionale: rilascialo da lì prima di riprovare qui» (mai il codice del vincolo DB).
  - Tentativo di ricerca senza unità locale configurata → «Configura il numero di iscrizione della tua unità locale nella pagina del certificato prima di cercare i formulari» + collegamento diretto.
  - Nessun incarico/soggetto coinvolto (RENTRI risponde 403 su acquisizione-visibilità perché l'utenza non ha titolo) → «Non risulti tra i soggetti coinvolti in questo formulario: RENTRI non consente di agganciarlo» — **diverso** dal 403 di R1 (certificato non valido): stesso status HTTP, causa diversa, messaggio diverso. Distinguerli dal codice macchina che il client deve già propagare, non dal solo status.
  - 423/429 su ricerca/acquisizione/rilascio → stesso messaggio di R1 ("RENTRI ha temporaneamente sospeso le richieste..."), riusato senza duplicarlo.

- [ ] **Step 2: Commit**

---

### Task 8: L'interfaccia — cercare e agganciare senza uscire da WasteFlow

Coerente col principio del design: quest'area è per «ciò che non appartiene a un singolo formulario» (ricerca), ma l'esito atterra dove l'utente già lavora (lista/dettaglio FIR).

**Files:**
- Area RENTRI esistente: nuova sezione "Formulari da agganciare" (`apps/frontend/src/app/features/rentri/...`)
- `apps/frontend/src/app/features/fir/fir-detail.component.ts` (azione "Rilascia legame RENTRI" quando l'origine è `ACQUISITO_DA_TERZI`/`AGGANCIO_MANUALE`)

- [ ] **Step 1: Pagina di ricerca**

  Campo di ricerca (default: CF del tenant, senza che l'utente lo digiti se già noto), tabella risultati con `numero_fir`, soggetti coinvolti, e uno stato a colpo d'occhio: "già nel gestionale" (disabilitato) / "da agganciare" / "in corso". `data-testid`: `rentri-formulari-search-input`, `rentri-formulari-row-{numeroFir}`, `rentri-formulari-aggancia-{numeroFir}`.

- [ ] **Step 2: Il dialog di aggancio**

  Le due opzioni del Task 4 come scelta esplicita, mai un default silenzioso: "Crea un nuovo formulario nel gestionale" oppure "Collega a un formulario già presente" (con selezione tra i FIR locali senza `rentriNumeroFir` — non tutti i FIR, solo quelli ancora liberi, altrimenti l'utente sceglie un FIR già legato e riceve un 409 evitabile in UI). `data-testid`: `rentri-formulari-confirm-dialog`, `-modalita-nuovo`, `-modalita-esistente`, `-fir-locale-select`, `-confirm-button`, `-cancel-button`.

- [ ] **Step 3: Il rilascio, nel dettaglio del FIR**

  Bottone "Rilascia legame RENTRI" visibile **solo** quando `rentriOrigineLegame` è `ACQUISITO_DA_TERZI` o `AGGANCIO_MANUALE` (mai su `TRASMESSO_DA_NOI`, coerente col vincolo di dominio del Task 3), con un dialog di conferma che spiega la conseguenza in italiano: «Il formulario resterà su RENTRI, ma non sarà più collegato a questo FIR nel gestionale». `data-testid`: `fir-detail-rentri-rilascia-legame`, `fir-detail-rentri-rilascia-legame-confirm-dialog`.

- [ ] **Step 4: Test frontend**

- [ ] **Step 5: Commit**

---

### Task 9: Verifica end-to-end

- [ ] **Step 1: Scenari Playwright**

  Cercare un formulario esistente (seed di dati contro l'oracolo o skip condizionale come il resto della suite); agganciarlo come nuovo formulario e verificare che compaia nella lista FIR con badge coerente; agganciare a un FIR locale esistente e verificare l'aggiornamento del dettaglio; rilasciare il legame e verificare che il FIR locale resti ma perda il `numero_fir`; tentare di agganciare due volte lo stesso formulario e verificare il messaggio di conflitto leggibile.

- [ ] **Step 2: Ciclo contro l'oracolo end-to-end**

  Nuova spec `*.oracolo.spec.ts`: creare un formulario con un client "produttore" simulato (o riusare la fixture già presente), poi come tenant "destinatario" cercarlo per CF, verificarne il flag `visibilita_sito_acquisita = false`, acquisirlo, verificare che una seconda ricerca lo mostri `visibilita_sito_acquisita = true` (se l'oracolo lo riflette — annotare se non lo fa, coerente con la riserva già scritta al Task 2 Step 3), rilasciarlo.

- [ ] **Step 3: Suite complete**

  Backend, oracolo, frontend. Nessuna cala rispetto al numero verificato a inizio piano.

- [ ] **Step 4: Commit**

---

## Criteri di completamento di R2

- [ ] Un'azienda può cercare, per il proprio codice fiscale, i formulari RENTRI in cui compare — anche quelli creati da terzi — senza aprire il portale.
- [ ] Un formulario trovato può essere agganciato in due modi distinti e scelti esplicitamente dall'utente: come nuovo FIR locale (dati importati dal dettaglio RENTRI, snapshot immutabile) o come completamento di un FIR locale esistente.
- [ ] Nessun formulario RENTRI può risultare agganciato a due FIR locali dello stesso tenant contemporaneamente (garantito da un vincolo di database, non solo da un controllo applicativo).
- [ ] Un'acquisizione già presente su RENTRI (`visibilita_sito_acquisita = true`) non genera una chiamata `acquisizione-visibilita` ridondante.
- [ ] L'aggancio manuale è tracciato (chi, quando, quale formulario) in un log di audit distinto dal log delle trasmissioni, ed è reversibile tramite `rilascio-visibilita` — mai su un legame nato da una nostra trasmissione.
- [ ] Ogni errore mostra all'utente cosa è successo e cosa fare, mai un codice o uno status HTTP grezzo.
- [ ] `data-testid` presenti su tutto ciò che è nuovo.
- [ ] Le suite backend/oracolo/frontend restano almeno al livello verificato a inizio piano.

## Ciò che R2 non fa

- **Recupero automatico del `num_iscr_sito`** dall'API anagrafiche (`GET /operatore/{num_iscr}/siti`): in R2 l'amministratore lo inserisce a mano. L'integrazione con `anagrafiche.yaml` è R4.
- **Tenant con più unità locali operative** (più `num_iscr_sito` per lo stesso tenant): R2 modella un solo valore per tenant, coerente con `RentriCredential` essere oggi un record unico per tenant. Un'estensione a più unità locali richiede prima ripensare la cardinalità di `RentriCredential`, fuori scope qui.
- **Aggiornamento automatico dei dati** di un FIR locale già agganciato con un refresh successivo del dettaglio RENTRI (nessun "risincronizza dati" su un formulario acquisito da terzi): il dato importato al momento dell'aggancio resta uno snapshot, coerente con la decisione di prodotto sull'anagrafica FIR.
- **Sovrascrittura dei dati di un FIR locale esistente** con quelli del dettaglio RENTRI nel ramo "collega a un formulario esistente": si collega, non si sostituisce. Un'eventuale riconciliazione dei campi discordanti è una funzione distinta, non richiesta qui.
- **Le operazioni del ciclo oltre l'aggancio** (accettazione, respingimento, trasbordo, sosta tecnica, annullamento) restano R3, anche per un formulario acquisito da terzi.
- **Registri cronologici, vidimazione cartacea, "quarta copia" come oggetto distinto**: fuori contratto, invariato rispetto al design di programma.
