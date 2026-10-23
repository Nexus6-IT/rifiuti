# Collegamento della scorta vidimata all'emissione — piano di implementazione

> **Per chi esegue:** usa `superpowers:subagent-driven-development` (consigliato)
> o `superpowers:executing-plans`. I passi hanno caselle `- [ ]`.

**Obiettivo:** far sì che un formulario emesso porti un numero **vidimato
dall'ente RENTRI**, prelevato dalla scorta, invece del progressivo che
generiamo noi.

**Perché esiste questo piano.** Tutto il lavoro R6 — la scorta, il consumo
atomico, il rifornimento automatico, la pagina dei blocchi — è in produzione ma
**scollegato**: `ConsumaNumeroVidimatoUseCase` non ha un solo chiamante. Il
banner che avvisava «emissione non possibile» è stato rimosso il 2026-09-11
proprio per questo (revisione finale del ramo `feat/scadenzario-cruscotto`): era
un falso allarme permanente, perché l'emissione non consuma mai dalla scorta e
quindi riesce sempre.

**Perché merita un piano invece di una correzione.** Questa modifica decide
**quale numero finisce su un documento trasmesso a un ente pubblico**. Un numero
sbagliato non è un difetto di interfaccia: è un formulario non conforme. È la
stessa ragione per cui il programma di prodotto classifica la vidimazione come
sostanza normativa e non come funzione accessoria.

**Architettura:** il punto di innesto è `EmettiFIRUseCase.execute`, passo 3,
dove oggi si chiama `firRepository.generateNumeroProgressivo`. Non si riscrive
il ciclo di vita del formulario: si sostituisce la fonte del numero, si
persiste ciò che l'ente ha già prodotto (numero e QR), e si decide cosa fare
quando la scorta è vuota.

**Stack:** NestJS 10, Prisma 5, PostgreSQL 16; Angular 17 + PrimeNG per la
parte di interfaccia.

**Spec:** non esiste un documento di specifica separato. Le fonti vincolanti
sono il manuale ministeriale (Allegato 3 al DD 254 del 12/12/2024, §6) e
l'indagine `docs/audits/rentri-blocchi-come-fanno-gli-altri-2026-09-11.md`.
Chi esegue li legge prima di cominciare: un piano senza spec produce rulings
provvisori, e qui gli errori non sono reversibili con un rilascio.

## Vincoli globali

- **TDD obbligatorio**: il test si scrive prima e lo si vede fallire.
- **Isolamento**: ogni query filtra per `tenantId`. Il tenant È l'azienda.
- **Fail-closed**: nel dubbio si rifiuta. Mai inventare un numero.
- **Italiano** nelle stringhe utente, nei commenti e nei messaggi di commit.
- **Prettier senza punto e virgola** (`semi: false`).
- **Migrazioni additive e solo in avanti**: nessun DROP, nessuna colonna NOT
  NULL senza default su tabella popolata.
- **Jest** con `--runInBand`, `--forceExit` e percorsi stretti; la macchina
  esaurisce la memoria con la suite intera.
- **Nessuna riga di attribuzione al modello** nei messaggi di commit.

---

### Task 1: La decisione che nessun altro task può prendere al posto tuo

Prima di scrivere codice va sciolto un nodo che cambia tutto ciò che viene
dopo. Non è lavoro di ricerca facoltativo: è il presupposto dei Task 2 e 3.

**Domanda:** il numero vidimato **sostituisce** `numeroProgressivo`, oppure
**convive** con esso?

I due mondi oggi coesistono per caso: `generateNumeroProgressivo` produce un
identificativo nostro, per anno e tenant; la scorta contiene numeri dell'ente,
con il loro QR. Il modello `FIR` ha già `rentriNumeroFir` (campo distinto).

**File da leggere prima di rispondere:**

- `apps/backend/src/domain/fir/fir.aggregate.ts` (metodo `emetti`)
- `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts:376`
  (`generateNumeroProgressivo`)
- `apps/backend/prisma/schema.prisma`, modelli `FIR` e `RentriNumeroVidimato`
- `apps/backend/src/application/rentri/mappatura/costruisci-payload-rentri.ts`,
  per vedere quale dei due finisce nel payload trasmesso

- [ ] **Passo 1: stabilire quale numero l'ente considera identificativo del
      formulario**, sulla base del manuale ministeriale, non per analogia.
- [ ] **Passo 2: verificare sul sorgente** quale dei due campi viene oggi
      trasmesso, e se il progressivo nostro compare da qualche parte nei
      documenti prodotti (PDF, registro, MUD).
- [ ] **Passo 3: scrivere la decisione** in `docs/adr/`, con la fonte. Non è
      burocrazia: chi verrà dopo deve sapere perché, e la risposta sbagliata
      non si vede finché non arriva un controllo.
- [ ] **Passo 4: commit** `docs(adr): quale numero identifica il formulario emesso`

**Se la risposta è «convivono»**, i Task 2 e 3 restano come scritti. **Se la
risposta è «sostituisce»**, il Task 2 cambia: va aggiornato prima di eseguirlo,
perché tocca anche i documenti prodotti.

---

### Task 2: Consumare il numero all'emissione

**File:**

- Modifica: `apps/backend/src/application/fir/use-cases/emetti-fir.use-case.ts`
  (passo 3, righe ~64-69)
- Test: `apps/backend/src/application/fir/use-cases/emetti-fir.use-case.spec.ts`

**Interfacce:**

- Consuma: `ConsumaNumeroVidimatoUseCase.execute(tenantId, { numIscrSito?, codiceBlocco?, firId })`
  → `Promise<NumeroVidimatoRow>`; solleva
  `DomainException.businessRuleViolation('SCORTA_RENTRI_VUOTA', …)` quando la
  scorta è esaurita.
- Produce: nessuna nuova interfaccia pubblica.

- [ ] **Passo 1: test che fallisce** — emettendo un formulario per un tenant
      con un numero vidimato disponibile, il formulario salvato porta quel
      numero e il suo QR, e la riga di scorta risulta consumata con il
      `firId` giusto.
- [ ] **Passo 2: eseguirlo e vederlo fallire** (oggi il consumo non è
      chiamato da nessuno).
- [ ] **Passo 3: implementare** il collegamento nel passo 3 del use case,
      rispettando l'ordine esistente: la firma del produttore avviene PRIMA
      (passo 2) e il documento firmabile esclude il numero, quindi consumare
      dopo la firma non invalida nulla. Non spostare la firma.
- [ ] **Passo 4: verificare che passi.**
- [ ] **Passo 5: test dell'ordine** — se la persistenza del formulario
      fallisce dopo il consumo, il numero vidimato NON deve restare bruciato.
      Decidere e rendere esplicito il comportamento: transazione unica, oppure
      restituzione del numero alla scorta. Un numero perso a ogni errore
      svuota la scorta in silenzio.
- [ ] **Passo 6: commit** `feat(fir): il formulario emesso porta il numero vidimato dall'ente`

---

### Task 3: Cosa succede quando la scorta è vuota

È il caso che decide se la funzione è usabile. Oggi l'emissione riesce sempre;
domani potrebbe fallire, e il modo in cui fallisce è una scelta di prodotto.

**File:**

- Modifica: lo stesso use case del Task 2
- Modifica: `apps/frontend/src/app/features/fir/fir-list.component.ts`
- Test: le spec di entrambi

- [ ] **Passo 1: test backend** — a scorta vuota l'emissione fallisce con un
      messaggio in italiano che dice cosa fare, non un errore tecnico.
- [ ] **Passo 2: implementare**, riusando il messaggio già presente in
      `ConsumaNumeroVidimatoUseCase` invece di scriverne un secondo.
- [ ] **Passo 3: rimettere l'avviso preventivo nel form Nuovo FIR.** L'endpoint
      `GET /rentri/emissione-possibile` e
      `VerificaEmissionePossibileUseCase` esistono già e sono intatti: erano
      stati scollegati dall'interfaccia il 2026-09-11 proprio in attesa di
      questo momento. Ora l'avviso diventa vero e va rimesso, con il commento
      sul posto aggiornato.
- [ ] **Passo 4: test frontend** — con la scorta esaurita l'avviso compare
      all'APERTURA del form, non al salvataggio. È il punto in cui superiamo i
      concorrenti, documentato in `concorrenti-sintesi-2026-09-11.md` §5.1.
- [ ] **Passo 5: commit** `feat(fir): avviso all'apertura quando la scorta vidimata e' esaurita`

---

### Task 4: Il caso in cui l'ente non è raggiungibile

Il portale RENTRI è caduto il 13/02/2026, giorno dell'obbligo, ed è stato
ripristinato il 14/04/2026: due mesi. La scorta è la difesa contro quell'evento,
ma solo se il rifornimento fallito si vede.

**File:**

- Modifica: `apps/backend/src/application/dashboard/raccogli-indicatori-azione.use-case.ts`
  o `raccogli-attenzione.use-case.ts` — decidere in base a quale delle due
  domande risponde: «quanti ne ho» è un indicatore, «sto per restare senza» è
  una voce di attenzione
- Test: la spec corrispondente

- [ ] **Passo 1: test** — con la scorta sotto la soglia configurata
      (`RentriUnitaLocale.dimensioneScortaDesiderata`) compare una voce di
      attenzione con la rotta verso la pagina dei blocchi.
- [ ] **Passo 2: implementare**, riusando `RentriScortaRepository`. La voce va
      aggiunta al raccoglitore esistente: la struttura è già pensata per
      questo (vedi il rapporto del Task 1 del cruscotto).
- [ ] **Passo 3: test** — a scorta ESAURITA la gravità è `critico`, non
      `avviso`: a quel punto non si emette più.
- [ ] **Passo 4: commit** `feat(cruscotto): la scorta vidimata sotto soglia richiede attenzione`

---

## Automazione — cosa fa il sistema al posto dell'utente

- **Sceglie il numero**: l'utente non deve sapere quale blocco, quale
  progressivo, quale sede. Il sistema lo sa meglio di lui.
- **Avvisa prima**: all'apertura del formulario, non dopo che è stato
  compilato.
- **Rifornisce da solo**: il job esiste già.

Quello che il sistema NON decide da solo, per la regola del programma di
prodotto (§5): **su quale blocco vidimare quando ce n'è più d'uno**. Lì si usa
`codiceBloccoPredefinito`, che è un valore configurato una volta e dichiarato,
non una scelta indovinata al momento.

## Autoverifica del piano

- **Copertura:** il Task 2 collega, il Task 3 gestisce l'esaurimento, il Task 4
  lo previene. Il Task 1 scioglie il nodo che condiziona tutti gli altri.
- **Nessun segnaposto:** firme, percorsi e numeri di riga sono verificati sul
  sorgente al 2026-09-12.
- **Dipendenza dichiarata:** il Task 1 va eseguito per primo e può cambiare il
  Task 2. Non è una formalità: è l'unico punto del piano in cui una risposta
  sbagliata produce documenti non conformi invece di codice da correggere.
- **Punto lasciato aperto di proposito:** il rimedio al numero bruciato (Task 2
  passo 5) non è deciso qui. Transazione unica e restituzione alla scorta
  hanno costi diversi, e la scelta va fatta guardando come `firRepository.save`
  è implementato, non a memoria.
