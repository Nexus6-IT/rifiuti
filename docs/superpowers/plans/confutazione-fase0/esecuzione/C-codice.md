# Confutazione del codice: piano C (integrità registro/FIR), `c9b10dd..23c5a17`

Revisione avversariale del codice implementato. Riferimenti di riga presi su `23c5a17`. Ho letto `final-review.md`, `re-review-final.md` e i ruling in fondo a `progress.md`: i punti già accettati o parcheggiati non sono ripetuti. Dove contesto un ruling lo dico esplicitamente e porto uno scenario concreto.

Conteggio: **0 Critiche, 3 Importanti, 7 Minori.**

---

## Obiezioni

### C-C-01: Importante. La I1 è chiusa a metà: l'anomalia `NEGATIVE_STOCK` segnala ancora come HIGH gli scarichi non di massa che il registro accetta per scelta

- **Dove:** `apps/backend/src/application/anomaly/anomaly-detection.service.ts:154-176`. Test che fissa il comportamento: `anomaly-detection.service.spec.ts:146-167`, con l'attesa `'3 M3'`.
- **Tesi:**
  - La revisione finale (I1, terzo punto) indicava come falso allarme "Decision 4's M3 scarico without carichi → flagged". La correzione separa le unità non di massa, ma continua a confrontare scarico e carico per ciascuna di esse.
  - Per la Decisione 4 l'utente **non può** registrare carichi in unità non di massa: il form manuale manda sempre `KG` (`registro.component.ts:1137`, senza un controllo dell'unità nel template). Un'unità diversa arriva solo dalla ricopia di un FIR.
  - Quindi uno scarico in `LITRI` o `M3` ricopiato da FIR non ha mai un carico nella stessa unità, e diventa per costruzione "Giacenza impossibile", severità HIGH.
  - Il test non prova il comportamento giusto: certifica il falso allarme (`expect(anomalies).toHaveLength(2)` con il caso `3 M3`).
- **Scenario:**
  1. Un produttore di emulsioni oleose (CER 13 08 02*) registra a mano la produzione in kg.
  2. Conferisce con FIR RENTRI in litri: `crea-fir-da-dettaglio-rentri.use-case.ts:278` mappa `'l'` su `LITRI`.
  3. La ricopia registra lo SCARICO in `LITRI`. Il registro lo accetta e salta il controllo, con un warning nel log.
  4. La pagina anomalie mostra "Giacenza impossibile per 13 08 02*: scarico (1.000 LITRI) supera carico (0 LITRI)", HIGH, a ogni conferimento.
- **Evidenza:** riga 166 `if (scarico <= carico + 1e-9) continue` vale anche per le unità non di massa. Il test alle righe 154-165 lo pretende.
- **Correzione proposta:**
  - Per le unità non di massa, segnalare solo se esiste almeno un carico in quell'unità (bilancio confrontabile). Altrimenti niente anomalia, oppure un'anomalia LOW distinta, tipo `UNITA_NON_CONFRONTABILE`.
  - Riscrivere il test: un M3 scaricato senza carichi in M3 non è HIGH.

### C-C-02: Importante. Uno scarico in kg di un CER caricato in litri viene bloccato, e il messaggio spinge a un carico fittizio che raddoppia la giacenza

- **Dove:**
  - `apps/backend/src/application/registro/giacenza-disponibile.ts:57-59` (solo la famiglia di massa entra nel saldo);
  - `registra-movimento.use-case.ts:497-507` (blocco con `RIMEDIO_CARICO_MANCANTE`, righe 536-539).
- **Tesi:**
  - La Decisione 4 copre un solo verso: lo scarico non di massa salta il controllo.
  - Il verso opposto non è trattato. I carichi di un CER sono entrati in un'unità non di massa (ricopia di FIR in `LITRI`), lo scarico è in kg. Il saldo di massa vale 0 e lo scarico è **rifiutato**.
  - Il messaggio dice di registrare "il carico mancante con la causale Altro carico". Così il registro immutabile annota due volte lo stesso rifiuto: 5.000 L più 4.800 kg di carico, contro 4.800 kg di scarico.
  - Il risultato è una giacenza di 5.000 L che non scende mai: la pagina giacenze e la giacenza al 31/12 del MUD (piano A) la conteranno.
- **Scenario:**
  1. Un impianto di stoccaggio (destinatario) riceve un FIR RENTRI in litri e lo ricopia: CARICO 5.000 `LITRI`.
  2. Rispedisce il rifiuto a un altro impianto con un proprio FIR in kg (RENTRI ammette `kg`/`l`) e lo ricopia: SCARICO 4.800 `KG`.
  3. Risposta: "Giacenza insufficiente per CER …: nel registro restano 0 kg, richiesti 4.800 kg. Se il rifiuto era già in deposito … registra il carico mancante con la causale Altro carico".
  4. L'operatore esegue. La rettifica non esiste (Fase 2), quindi il doppio carico resta.
- **Evidenza:**
  - Il WHERE alle righe 57-59 esclude le righe in `LITRI`.
  - `verificaGiacenza` non guarda se il CER ha movimenti non di massa.
  - Nessun test copre il caso "carico non di massa, scarico di massa". I test del Task 3 hanno solo kg/t, e lo scarico in M3 senza carichi.
- **Correzione proposta:**
  - Se il CER ha movimenti del tenant in unità non di massa, il saldo di massa non è affidabile: lo scarico si registra con un **avviso** ("il CER ha carichi in L/M3 che non si possono confrontare con i kg; verificare la giacenza"), non con un blocco.
  - In ogni caso il messaggio non deve proporre un carico fittizio.
  - Basta un `EXISTS` aggiuntivo nella stessa query, più un test postgres (carico 5.000 L, scarico 4.800 kg).

### C-C-03: Importante (contesto il ruling su M1 e la nota "finestra piccola"). La protezione dell'annullamento copre solo `rentri_stato_formulario`: un salvataggio stantio della sync RENTRI fa rivivere un FIR annullato in locale

- **Dove:**
  - `fir-prisma.repository.ts:272-282` (`conservaAnnullamentoEnte`: protegge solo `'Annullato'` dell'ente);
  - `toPersistence`, riga ~665: `status` scritto dall'aggregate;
  - `sync-fir-to-rentri.use-case.ts:77` (`findById`), poi `121-122` (`creaFormulario` + `attendiEsito`, polling), poi `192` (`save`).
- **Tesi:**
  - `fir.annulla()` è consentito finché `rentriNumeroFir` è nullo (`fir.aggregate.ts:577-583`). Durante la prima sync il numero è ancora nullo: lo valorizza `markRENTRISynced` solo alla fine.
  - La sync tiene l'aggregate in memoria per tutto il polling dell'esito (secondi o minuti, non millisecondi), poi fa l'upsert di tutti gli scalari.
  - Lo `status = CANCELLED` scritto nel frattempo da `annulla-fir` viene sovrascritto con lo stato emesso. Così il FIR:
    - torna **collegabile** (`collegabilitaFir`);
    - sparisce dall'avviso "scarichi su FIR annullati" della pagina giacenze (Task 6);
    - torna a contare nel MUD (piano A esclude gli annullati).

  Il fix di M1 dà una falsa sicurezza: protegge uno solo dei due segnali di annullamento che `firAnnullato` legge.
- **Scenario:**
  1. Il FIR viene emesso in modalità AUTOMATICA, e la sync parte (`emetti-fir.use-case.ts:92`).
  2. L'operatore si accorge di un errore e annulla subito: `CANCELLED`, motivo salvato.
  3. La sync riceve l'esito positivo e salva: status `AWAITING_CARRIER`, `rentri_numero_fir` valorizzato, motivo di annullamento NULL.
  4. Il FIR è attivo in locale e sull'ente, mentre l'utente lo crede annullato. Il registro ne accetta la ricopia.
- **Evidenza:** `annulla-fir.use-case.ts:16-29` non prende lock. `salvaCon` prende `FOR UPDATE`, ma confronta solo `rentri_stato_formulario`. Il piano elenca "D17 last-write-wins" fra i follow-up, ma la revisione finale ha giudicato M1 su una "finestra piccola", e per la sync non lo è.
- **Correzione proposta:**
  - In `conservaAnnullamentoEnte` leggere anche `status`, già sotto `FOR UPDATE`.
  - Se il valore persistito è `CANCELLED` e l'aggregate no, **non** fare l'upsert: lanciare un `DomainError` ("FIR annullato nel frattempo") e loggarlo. La sync deve segnalare che sull'ente esiste un formulario per un FIR annullato in locale, invece di risuscitarlo in silenzio.
  - Test postgres: aggregate caricato, `annulla` salvato, poi `save` della copia vecchia → errore, riga ancora `CANCELLED`.

### C-C-04: Minore. Chiavi di advisory lock a 32 bit in un unico spazio: una collisione fra namespace crea un ciclo di lock

- **Dove:**
  - `registra-movimento.use-case.ts:209`, `329`, `477`;
  - `fir-prisma.repository.ts:452`.

  Tutti usano `pg_advisory_xact_lock(hashtext(...))`.
- **Tesi:** l'ordine fisso (FIR → progressivo → giacenza) evita i deadlock solo se le chiavi sono distinte. `hashtext` restituisce un `int4`, e `fir-registro|t|f`, `t-anno` e `giacenza|t|cer` condividono lo stesso spazio di chiavi.
- **Scenario:**
  - T1 tiene `fir-registro|t|F` e aspetta `t-2026`.
  - T2 tiene `t-2026` e chiede `giacenza|t|15 01 01`, che per collisione ha lo stesso `hashtext` di `fir-registro|t|F`.
  - Postgres abortisce una delle due dopo `deadlock_timeout`. L'utente vede "Errore durante la registrazione: deadlock detected".
  - La probabilità è bassa (coppie FIR×CER per tenant / 2³²), ma non nulla su tutta la flotta, e smentisce la garanzia "nessun percorso di deadlock".
- **Correzione proposta:** usare la forma a due interi `pg_advisory_xact_lock(<classid costante per namespace>, hashtext(chiave))`. Namespace diversi non possono più collidere fra loro, e il ragionamento sull'ordine torna esatto.

### C-C-05: Minore. `conservaAnnullamentoEnte`: niente `tenant_id` nel WHERE e lock più forte del necessario

- **Dove:** `fir-prisma.repository.ts:278-279`.
- **Tesi:**
  - Viola il vincolo globale del piano "ogni query porta `tenant_id`" (le altre query raw nuove lo fanno, ad esempio la riga 458).
  - Prende `FOR UPDATE` a **ogni** `save`. Questo blocca anche i `FOR KEY SHARE` delle FK figlie, cioè gli insert in `fir_signatures` e `rentri_sync_logs` di altre transaction sullo stesso FIR. Per leggere e poi aggiornare scalari non chiave basta `FOR NO KEY UPDATE`, che è anche il lock che l'upsert prende comunque.
- **Scenario:** la sync scrive il proprio log di sync mentre un `save` concorrente dello stesso FIR è aperto. L'insert del log attende la fine della transaction del `save`. Non è un deadlock, ma è un'attesa nuova senza motivo.
- **Correzione proposta:** `WHERE id = … AND tenant_id = … FOR NO KEY UPDATE`.

### C-C-06: Minore. L'unità è testo libero: qualunque alias non previsto salta il controllo di giacenza senza che l'utente lo sappia

- **Dove:**
  - `registra-movimento.dto.ts:88-92` (`@IsString @MaxLength(10)`, nessuna lista);
  - `registra-movimento.use-case.ts:461-469` (solo un `logger.warn`).
- **Tesi:**
  - La UI manda solo `KG`/`T`/`LITRI`. Ma l'API e l'import della Fase 3, che secondo la Decisione 10 "passerà dallo use case", accettano anche `TN`, `KGS`, `Kg.`, `QL`.
  - Tutte queste unità sono "non di massa": lo scarico salta il controllo, la pagina giacenze le mette in una colonna a parte e il MUD (piano A) blocca per mancanza di densità.
- **Scenario:** un import WinWaste con unità `TN` registra tutti gli scarichi senza alcun controllo. La giacenza in kg resta quella dei soli carichi.
- **Correzione proposta:** sulla scrittura, `@IsIn` con gli alias noti più le unità non di massa ammesse (`L`, `LITRI`, `M3`). Un'unità sconosciuta si rifiuta con un messaggio, invece di essere declassata a "non di massa".

### C-C-07: Minore. Il blocco per giacenza insufficiente propone un carico fittizio anche quando la causa sono scarichi collegati a FIR poi annullati

- **Dove:** `registra-movimento.use-case.ts:497-507` e Decisione 11.
- **Tesi:**
  - Gli scarichi su FIR annullati continuano a consumare la giacenza (scelta dichiarata), ma il messaggio di blocco non li nomina.
  - L'utente che ha annullato un FIR già ricopiato non riesce più a scaricare il rifiuto ancora in deposito. Il sistema gli suggerisce "Altro carico", cioè un secondo carico dello stesso rifiuto.
- **Scenario:**
  1. CARICO di 1.000 kg.
  2. SCARICO di 1.000 kg sul FIR A, che poi viene annullato.
  3. Nuovo FIR B per lo stesso rifiuto: lo scarico è bloccato con il rimedio "Altro carico". La pagina giacenze avvisa, il messaggio di blocco no.
- **Correzione proposta:** nella stessa transaction, se esistono scarichi del CER su FIR annullati, il messaggio li elenca (numero di movimento e FIR) e indica che la correzione è sul registro (follow-up della Fase 2), non un nuovo carico.

### C-C-08: Minore. Un FIR in `FirmaAnnullamento` (annullamento in corso presso l'ente) resta collegabile

- **Dove:** `apps/backend/src/domain/fir/stati-fir.ts:37-39`, e lo specchio nel frontend `registro-fir.ts:57`.
- **Tesi:** `firAnnullato` riconosce solo `'Annullato'`. Lo stato `FirmaAnnullamento` dell'enum `RentriStatoFormulario` indica un annullamento avviato e in attesa di firma.
- **Scenario:** si avvia l'annullamento su RENTRI e, prima della firma, si ricopia il FIR nel registro. Il collegamento è accettato. Quando l'annullamento si completa, lo scarico resta su un FIR annullato (C-C-07).
- **Correzione proposta:** trattare `FirmaAnnullamento` come non collegabile, con un motivo dedicato ("annullamento in corso") e un test.

### C-C-09: Minore. I movimenti senza FIR non sono idempotenti: un retry dopo un timeout crea un doppio permanente nel registro immutabile

- **Dove:**
  - `registra-movimento.use-case.ts:192-202`: l'idempotenza vale solo con `firId`;
  - lato frontend, `registro.component.ts:1440-1468`.
- **Tesi:** il piano ha chiuso il doppio solo per la ricopia. Per un carico o uno scarico manuale, una risposta persa (timeout di nginx o di rete dopo il commit) seguita da un nuovo "Registra" produce due annotazioni con progressivi consecutivi. Non esiste rettifica (Fase 2), quindi il doppio carico gonfia la giacenza e il MUD.
- **Correzione proposta:** chiave di idempotenza generata dal client (UUID per apertura del form) su una colonna con indice unico parziale, come `fir_id_ricopia`. Va almeno elencata fra i follow-up della PR.

### C-C-10: Minore. Il ragionamento sui lock della revisione finale cita una FK che non esiste

- **Dove:**
  - `schema.prisma:1739`: `firId` di `WasteMovement` senza `@relation`;
  - migration `20260629300000_extend_waste_movement_registro/migration.sql:69`: solo un indice.
- **Tesi:** `final-review.md` (Strengths, punto 1) fonda l'assenza di cicli fra registro ed emissione sul `KEY SHARE` della FK `waste_movements.fir_id → firs`. Quella FK non c'è. La conclusione regge comunque, perché il registro non prende lock sulla riga del FIR. Però:
  - il controllo 0d "Evita movimenti con FK penzolante" è solo applicativo;
  - un FIR cancellato fisicamente (cascade da tenant a parte) lascerebbe movimenti con `fir_id` orfano.
- **Correzione proposta:** nessuna azione su questo piano. Correggere la motivazione nella PR, così che il prossimo che aggiunge un `FOR UPDATE` non ragioni su una FK inesistente.

---

## Cosa ho verificato e regge

- **Scrittori di `waste_movements`.** L'unico è `RegistraMovimentoUseCase` (grep su `create|update|delete|createMany` e su SQL raw in `apps/` e `tools/`). Nessun import, nessuna sync RENTRI e nessun job scrive movimenti, quindi nessun percorso aggira i lock del registro.
- **Ordine dei lock.** Registro: FIR → `t-anno` → giacenza, sempre in quest'ordine. Emissione: `fir-numero|t|anno` → riga `firs` `FOR UPDATE`. `save`: solo la riga `firs`. Nessun ciclo fra i tre percorsi, salvo la collisione di hash di C-C-04. Il retry idempotente esce prima del lock del progressivo e del controllo di giacenza.
- **Ricopia idempotente.** Lettura per `fir_id` (vede anche lo storico) sotto il lock del FIR. Indice unico `(tenant_id, fir_id_ricopia, type)` con NULL distinti: la migration non può fallire sui doppi storici. Il percorso P2002 è protetto e l'errore di lettura non scappa da `execute`.
- **Giacenza.**
  - Il CER si confronta sulle cifre sia in SQL sia nella chiave del lock (canonica, equivalente per 6 cifre).
  - Kg e t sono in kg con gli alias condivisi passati come parametri.
  - L'unità vuota vale KG sia in JS sia in SQL: `unit` è `NOT NULL DEFAULT 'KG'`, quindi non esiste il caso NULL.
  - Il giorno italiano coincide in SQL (`AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome'` su `timestamp(3)`) e in JS.
  - La tolleranza `1e-9` assorbe gli errori di `q*1000` in virgola mobile (ad esempio `0.07*1000`).
- **Numerazione del FIR.**
  - Lock per tenant e anno, controllo della bozza sullo stato grezzo sotto `FOR UPDATE`, massimo numerico su `^FIR-\d{4}-\d{1,9}$` filtrato per `tenant_id`.
  - Unique `(tenant_id, fir_number)`.
  - L'anno è letto dal riferimento.
  - Nessun altro percorso assegna `firNumber` (grep): `crea-fir-da-dettaglio-rentri` crea bozze senza numero.
- **Isolamento.** Tutte le query raw nuove filtrano per tenant, tranne quella di C-C-05. Non esiste una RLS nativa (l'estensione Prisma non tocca il SQL raw), quindi il filtro esplicito è l'unica difesa, ed è presente.
- **Frontend contro backend.**
  - `firCollegabileNelRegistro` rispecchia `collegabilitaFir`, con la mappatura `DRAFT/AWAITING_PRODUCER → BOZZA` verificata.
  - Il form manda date `AAAA-MM-GG` locali, coerenti con `giornoItaliano` e con l'uguaglianza esatta di `stessiDatiRicopia`.
  - `giorniDiRitardo` equivale a `giorniItalianiFra`.
  - Il pulsante resta disabilitato durante il salvataggio (`[loading]`).
- **Test.** `jest --runInBand --forceExit` su `anomaly-detection.service.spec.ts`, `application/registro` e `stati-fir.spec.ts`: 5 suite, 77 test verdi. Non ho rieseguito i `*.postgres.spec.ts` per non interferire con l'agente che lavora in parallelo sullo stesso database `wasteflow_ci`. Il test di concorrenza "anni diversi" usa una barriera reale ed è significativo. Il test delle anomalie sulle unità non di massa invece certifica il comportamento sbagliato (C-C-01).
