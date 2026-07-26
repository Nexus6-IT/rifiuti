# R1 — Trasmissione e stato: il legame diventa visibile e governabile

> **Per agenti esecutori:** SUB-SKILL RICHIESTA: `superpowers:subagent-driven-development`. I passi usano checkbox (`- [ ]`).

**Obiettivo:** un formulario emesso in WasteFlow arriva su RENTRI e torna col numero ufficiale, **senza che l'utente apra il portale**; lo stato è visibile dove l'utente già lavora; gli errori sono leggibili e azionabili; ogni azienda sceglie la propria modalità.

**Il criterio di valore, fissato dal committente:** l'utente non deve **cambiare piattaforma**. Un'area che replica il portale dentro l'applicativo sposta soltanto la finestra e non produce valore. Quindi l'operatività vive **nel flusso del formulario**, non in un pannello tecnico separato.

**Stack:** NestJS 10, Angular 17 + PrimeNG, Prisma, BullMQ, Jest, Playwright.

## Vincoli globali

- **Italiano** in ogni testo utente. Gli identificatori di codice restano in inglese; i termini di dominio RENTRI (`numero_fir`, `transazione_id`, `num_iscr_sito`) identici alla specifica.
- **Verbi del mestiere, non del protocollo**: «trasmetti», «riprova», «apri il PDF» — mai «sincronizza», «vedi transazione», «job».
- **`data-testid` dal primo commit**, secondo le convenzioni già pianificate in `e2e/SELECTORS-DEBT.md` (`fir-status-badge-{numeroFir}`, `rentri-sync-badge-{numeroFir}`, `rentri-credential-*`). L'area oggi ne ha **zero**.
- **Prettier** sui file toccati prima di ogni commit: un solo errore blocca il gate di rilascio.
- Suite: **100 suite / 928 test** unitari backend, **5 suite / 11 test** oracolo, **20 test** frontend. Nessuna deve calare.
- Commit in italiano, senza attribuzione ad AI.

## Stato di partenza (fine R0)

Il legame **esiste ed è cablato**: modello dati completo (`rentriNumeroFir` ufficiale, `rentriTransazioneId`, `rentriOrigineLegame`, `Tenant.rentriModalitaLegame` con default `MANUALE`, tabella `RENTRISyncLog`), otto metodi di dominio, persistenza in scrittura e lettura, `RentriSyncModule` cablato con cinque endpoint protetti da `RolesGuard` (SUPER_ADMIN/ADMIN/OPERATOR, VIEWER escluso), ciclo end-to-end dimostrato contro l'oracolo.

**Ciò che manca è tutto lato utente:** nessuna schermata mostra lo stato RENTRI, nessuno può scegliere la modalità della propria azienda, e gli errori sono codici.

**Materiale già scritto e mai collegato, da riusare dopo averlo riallineato:**
- `apps/frontend/src/app/features/fir/components/rentri-sync-badge/` — progettato esattamente per la colonna della lista FIR, ma con testi **in inglese** («Syncing 42%», «Retry 3/5», «Unknown») e senza `data-testid`.
- `apps/frontend/src/app/features/fir/components/rentri-sync-logs/` — stessa situazione.

**Vincolo strutturale:** **non esiste una pagina di dettaglio del FIR.** Tutto vive nella lista `/fir` (`fir-list.component.ts`), con colonne `Numero | CER | Quantità | Stato | Data creazione | Azioni`. Crearla non è un extra di R1: è il contenitore naturale della cronologia delle trasmissioni e delle azioni sul formulario.

---

### Task 1: La modalità dell'azienda

Senza questa, la trasmissione automatica non può esistere: il default di R0 è `MANUALE` per tutti.

**Files:**
- Backend: nuovo endpoint di lettura/scrittura della modalità (area admin del tenant)
- Frontend: sezione nell'area RENTRI esistente (`/rentri/...`)

- [ ] **Step 1: Endpoint**

Lettura e scrittura di `Tenant.rentriModalitaLegame` (`AUTOMATICA` | `IBRIDA` | `MANUALE`). **Solo ADMIN e SUPER_ADMIN**: è una scelta che impegna l'azienda verso un ente pubblico, non una preferenza d'uso. Verifica empiricamente che un OPERATOR riceva 403.

- [ ] **Step 2: Scrivere i test**

Compresa la regola che conta: cambiare modalità **non** deve retroagire sui formulari già trasmessi.

- [ ] **Step 3: Interfaccia**

Tre opzioni con una descrizione in italiano che spieghi **la conseguenza**, non il meccanismo. Per esempio, per l'automatica: «I formulari emessi vengono trasmessi a RENTRI senza ulteriori passaggi» — non «attiva la sincronizzazione automatica».

Se l'azienda **non ha un certificato RENTRI valido**, le modalità automatica e ibrida vanno mostrate ma **non selezionabili**, con la ragione e il collegamento alla pagina del certificato. È il caso più frequente oggi: nessun tenant ne ha uno.

- [ ] **Step 4: Commit**

---

### Task 2: L'orchestrazione secondo la modalità

**Files:**
- `apps/backend/src/application/rentri/` (use case di trasmissione)
- Punto di aggancio nel ciclo di vita del FIR

- [ ] **Step 1: Definire il comportamento delle tre modalità e testarlo**

- **AUTOMATICA**: all'emissione il formulario viene trasmesso senza intervento; il numero ufficiale compare quando arriva. L'utente se ne accorge **solo se qualcosa non funziona**.
- **IBRIDA**: la trasmissione parte da sola, ma **l'aggancio richiede conferma esplicita** dell'utente prima di considerare il formulario legato.
- **MANUALE**: nulla parte da solo; esiste un'azione «Trasmetti a RENTRI» sul formulario.

- [ ] **Step 2: L'aggancio del ciclo di vita**

R0 ha lasciato un residuo noto: `FIRConsegnatoHandler` è cablato ma **non scatta**, perché l'aggregate emette `DomainEvent{eventName}` mentre `DomainEventsService` attende `IDomainEvent{eventType}` — due famiglie di eventi mai riconciliate.

**Decidi come agganciare la trasmissione e motiva la scelta**: riconciliare le due famiglie di eventi, oppure invocare la trasmissione direttamente dallo use case di emissione. Non lasciare un aggancio che sembra esserci e non scatta: è il difetto che questo progetto ripete.

- [ ] **Step 3: Fail-closed sulle precondizioni**

Se l'azienda non ha un certificato valido, la trasmissione **non parte** e lo dice: non deve accumulare tentativi destinati a fallire — soprattutto perché RENTRI risponde **423 bandendo** il chiamante che insiste con richieste non valide.

- [ ] **Step 4: Commit**

---

### Task 3: Lo stato nella lista dei formulari

**Files:**
- `apps/frontend/src/app/features/fir/fir-list.component.ts`
- `apps/frontend/src/app/features/fir/components/rentri-sync-badge/`

- [ ] **Step 1: Riallineare il componente esistente**

Testi in italiano, `data-testid` secondo `e2e/SELECTORS-DEBT.md`, stati coerenti con `RENTRISyncStatus` reale. **Non riusarlo com'è**: viola la convenzione linguistica del progetto.

- [ ] **Step 2: Aggiungere la colonna**

Accanto a «Stato», che oggi mostra solo il ciclo interno. La colonna deve comunicare **una cosa sola a colpo d'occhio**: il formulario è a posto con l'ente, sta andando, o richiede attenzione. Il numero ufficiale va mostrato quando c'è: è il dato che l'operatore cerca.

- [ ] **Step 3: L'azione contestuale**

In modalità manuale, «Trasmetti a RENTRI». In caso di errore, «Riprova». Le azioni compaiono **solo** quando hanno senso: un formulario in bozza non le mostra (`canSyncToRENTRI` esclude la bozza).

- [ ] **Step 4: Test frontend**

- [ ] **Step 5: Commit**

---

### Task 4: La pagina di dettaglio del formulario

Oggi non esiste, ed è il contenitore naturale di tutto ciò che riguarda un singolo formulario.

**Files:**
- Nuovo componente + rotta `/fir/:id`
- Backend: endpoint di dettaglio se non già sufficiente

- [ ] **Step 1: Contenuti**

Dati del formulario; **stato verso RENTRI** con numero ufficiale e origine del legame (nostra trasmissione, acquisito da terzi, aggancio manuale); **cronologia delle trasmissioni** leggibile (quando, esito, motivo dell'eventuale errore); azioni disponibili.

- [ ] **Step 2: Riusare il componente dei log**

`rentri-sync-logs` esiste già: riallinealo (italiano, `data-testid`) e montalo qui.

- [ ] **Step 3: Attenzione all'autorizzazione**

La pagina mostra dati di un formulario: verifica che l'endpoint di dettaglio sia **tenant-scoped** e che un utente di un'altra azienda riceva 404, non 403 — nessuna fuga di esistenza. È la convenzione già adottata in P4.

- [ ] **Step 4: Test**

- [ ] **Step 5: Commit**

---

### Task 5: Errori leggibili

È il task che decide se l'utente resta nell'applicativo o va sul portale a capire cosa è successo.

**Files:**
- Backend: mappatura degli errori RENTRI
- Frontend: presentazione

- [ ] **Step 1: Mappare `ProblemDetails` in messaggi azionabili**

RENTRI risponde in `application/problem+json`. L'utente non deve mai vedere «403» o «RENTRI_MISSING_NUMERO_FIR». Deve vedere **cosa è successo e cosa fare**:

- 403 → «Il certificato dell'azienda non è valido per questa operazione» + collegamento alla pagina del certificato;
- 429 / 423 → «RENTRI ha temporaneamente sospeso le richieste: la trasmissione riprenderà da sola» — senza pulsante «riprova», che peggiorerebbe la situazione;
- errore di validazione → il messaggio dell'ente, **tradotto nel campo del formulario** che lo causa, quando ricavabile.

Il `ProblemDetails` grezzo resta nel log tecnico, non davanti all'utente.

- [ ] **Step 2: Test**

Un test per famiglia di errore, con il testo che l'utente vedrebbe.

- [ ] **Step 3: Commit**

---

### Task 6: Verifica end-to-end

- [ ] **Step 1: Scenari Playwright**

Con le credenziali disponibili (o in `skip` condizionale come il resto della suite): lo stato compare nella lista; il dettaglio mostra la cronologia; l'azione manuale trasmette; un errore produce un messaggio comprensibile.

- [ ] **Step 2: Ciclo contro l'oracolo**

Estendere le spec `*.oracolo.spec.ts`: modalità automatica → il formulario emesso risulta legato senza intervento; modalità manuale → non parte nulla finché non lo si chiede.

- [ ] **Step 3: Suite complete**

Backend, oracolo, frontend. Nessuna cala.

- [ ] **Step 4: Commit**

---

## Criteri di completamento di R1

- [ ] Un'azienda può scegliere la propria modalità, e non può sceglierne una che richiede un certificato che non ha.
- [ ] In modalità automatica, un formulario emesso risulta legato **senza alcun intervento dell'utente**.
- [ ] Lo stato verso RENTRI è visibile nella lista, col numero ufficiale quando c'è.
- [ ] Esiste una pagina di dettaglio del formulario con la cronologia delle trasmissioni.
- [ ] Nessun messaggio d'errore mostra codici tecnici: ogni errore dice **cosa fare**.
- [ ] `data-testid` presenti su tutto ciò che è nuovo.
- [ ] Le tre suite restano verdi.

## Ciò che R1 non fa

L'aggancio ai formulari **già esistenti** su RENTRI (ricerca per codice fiscale + acquisizione visibilità) è R2. Le operazioni del ciclo oltre la trasmissione — accettazione, respingimento, trasbordo, sosta tecnica, annullamento — sono R3.
