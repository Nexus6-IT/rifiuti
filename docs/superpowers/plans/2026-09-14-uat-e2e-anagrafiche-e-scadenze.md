# UAT + E2E — anagrafiche e scadenze — piano di implementazione

> **Per chi esegue:** usa `superpowers:subagent-driven-development` (consigliato)
> o `superpowers:executing-plans`. I passi hanno caselle `- [ ]`.
> La skill di riferimento è `uat-e2e-entity-testing`.

**Obiettivo:** copertura UAT + E2E per produttori, trasportatori, destinatari,
per il flusso delle scadenze che li attraversa, e per la superficie
raggiungibile della scorta vidimata — con setup via API, asserzioni a delta
sugli effetti collaterali e pulizia verificata a residuo zero.

**Stato di partenza, misurato il 2026-09-14.** La suite E2E esiste ma è in gran
parte uno **scheletro**: 68 test fra `test.fixme` e `test.skip` distribuiti su
11 file; gira davvero solo `e2e/tests/public/`. Non esiste alcuna cartella per
le anagrafiche, e `e2e/pages/` non ha un page object per produttori,
trasportatori o destinatari nonostante il README li elenchi. Non esistono
helper di setup via API, né un registro delle risorse, né una verifica di
residuo.

## I due ostacoli da sciogliere prima di scrivere un solo test

### 1. Il guardrail blocca la pulizia

`e2e/utils/blacklist.ts` vieta `DELETE /registry/*` con la motivazione
«elimina anagrafica master data». È una protezione giusta e va tenuta. Ma è
esattamente l'endpoint che serve al teardown delle tre entità di questo piano:
così com'è, la regola di residuo zero della skill è **impossibile da
rispettare**.

**Decisione:** il guardrail continua a bloccare la cancellazione di qualunque
anagrafica, **tranne** quelle il cui identificativo di business porta il
prefisso del run corrente. Un record creato dal test non è master data: è
spazzatura che il test ha l'obbligo di rimuovere. La protezione resta intera
per tutto il resto, e diventa più forte, perché oggi un test che volesse
cancellare dati veri semplicemente fallirebbe in silenzio invece di essere
fermato con un messaggio.

### 2. I selettori non ci sono

`e2e/SELECTORS-DEBT.md` misura i `data-testid` presenti in **6 aree su 54**
componenti. Il documento dichiara il frontend fuori ambito per chi lo ha
scritto. Per questo piano non lo è: senza selettori stabili i test si
appoggiano a testo e classi CSS, cioè nascono già fragili.

**Decisione:** si aggiungono i `data-testid` **solo** alle aree che questo
piano tocca, seguendo la convenzione già scritta in quel documento. Non si
sana tutto il debito: si sana ciò che serve, e si aggiorna il documento
togliendo le righe chiuse.

## Vincoli globali

- **TDD** dove si tocca codice di produzione; per i test E2E vale la regola
  gemella: il test deve fallire se la funzione non c'è.
- **Un run = un prefisso univoco** in ogni dato creato. Nessuna eccezione.
- **Setup via API**, non via interfaccia, tranne il passo sotto test.
- **Asserzioni a delta**, mai valori assoluti.
- **Teardown idempotente** e verifica di residuo zero: se il residuo non è
  zero la suite fallisce.
- **Mai contro produzione.** Il default è `localhost`; `e2e/utils/env.ts` lo
  garantisce già e non va indebolito.
- **Isolamento**: ogni query filtra per tenant. Il tenant È l'azienda.
- Italiano nelle stringhe utente, nei commenti e nei messaggi di commit.
- Prettier senza punto e virgola. Nessuna riga di attribuzione al modello nei
  commit.

---

### Task 1: Le fondamenta — prefisso di run, client API, teardown, residuo zero

Senza questo, ogni task successivo produce test che sporcano l'ambiente.

**File:**

- Crea: `e2e/utils/run-id.ts`
- Crea: `e2e/utils/api-client.ts`
- Crea: `e2e/fixtures/risorse.ts`
- Modifica: `e2e/utils/blacklist.ts`
- Modifica: `e2e/playwright.config.ts` (global teardown)
- Crea: `e2e/scripts/verifica-residuo.ts`
- Test: `e2e/tests/public/pulizia-self-test.spec.ts`

**Interfacce prodotte, usate da tutti i task successivi:**

```ts
// run-id.ts
export function runId(): string // 'run-<timestamp>-<random>', stabile per processo
export function conPrefisso(nome: string): string // `${runId()}-${nome}`
export function haPrefissoDiRun(valore: string): boolean

// api-client.ts — autenticazione via POST /auth/dev/login (non disponibile in produzione)
export async function apiLogin(ruolo: Role): Promise<string> // bearer token
export async function apiPost<T>(percorso: string, corpo: unknown, token: string): Promise<T>
export async function apiGet<T>(percorso: string, token: string): Promise<T>
export async function apiDelete(percorso: string, token: string): Promise<void>

// risorse.ts — registro delle risorse create, consumato dal teardown
export function registra(tipo: 'produttore' | 'trasportatore' | 'destinatario' | 'fir', id: string): void
export async function ripulisci(token: string): Promise<{ rimosse: number; residue: string[] }>
```

- [ ] **Passo 1: test che fallisce** — `pulizia-self-test.spec.ts` crea due
      anagrafiche col prefisso, invoca il teardown, e asserisce che una
      ricerca per prefisso restituisca zero risultati.
- [ ] **Passo 2: eseguirlo e vederlo fallire** (i moduli non esistono).
- [ ] **Passo 3: implementare** prefisso, client e registro.
- [ ] **Passo 4: emendare il guardrail** — `DELETE /registry/*` resta bloccato,
      ma consentito quando l'identificativo nell'URL appartiene a una risorsa
      registrata in questo run. Aggiungere un test del guardrail che dimostra
      ENTRAMBE le cose: la cancellazione di un record col prefisso passa,
      quella di un record senza prefisso viene ancora bloccata. Senza il
      secondo test la modifica è un indebolimento travestito da correzione.
- [ ] **Passo 5: teardown globale** in `playwright.config.ts`, idempotente:
      deve poter girare dopo un run morto a metà senza fallire.
- [ ] **Passo 6: verifica di residuo** — la suite fallisce se dopo il teardown
      esiste ancora un solo record col prefisso del run.
- [ ] **Passo 7: commit** `test(e2e): prefisso di run, client API e pulizia verificata`

---

### Task 2: I selettori che mancano

**File:**

- Modifica: `apps/frontend/src/app/features/registry/anagrafica-form-dialog.component.ts`
- Modifica: gli elenchi delle anagrafiche (produttori, trasportatori, destinatari)
- Modifica: `apps/frontend/src/app/features/dashboard/dashboard.component.ts`
  (fascia «Richiede attenzione»: la voce e il suo pulsante di azione)
- Modifica: `apps/frontend/src/app/features/fir/fir-list.component.ts`
  (avviso di controparte scaduta alla scelta)
- Modifica: `e2e/SELECTORS-DEBT.md`

- [ ] **Passo 1: elencare** i selettori necessari ai Task 3-6 PRIMA di
      aggiungerli, così non se ne aggiungono di inutili.
- [ ] **Passo 2: aggiungerli** seguendo la convenzione già scritta nel
      documento del debito: `{area}-row-{businessId}`, `{area}-{azione}-{businessId}`,
      `{area}-status-badge`, `{area}-confirm-dialog`.
- [ ] **Passo 3: verificare** che i test unitari del frontend restino verdi:
      un `data-testid` non cambia comportamento, ma un refuso nel template sì.
- [ ] **Passo 4: togliere dal documento del debito** le righe chiuse, con la
      data. Un elenco di debito che non cala non viene più letto.
- [ ] **Passo 5: commit** `feat(frontend): data-testid per le aree coperte dai test E2E`

---

### Task 3: Produttore

L'anagrafica più usata e senza alcuna copertura. Si comincia da qui perché è
la più stabile: se le fondamenta hanno un difetto, emerge su un'entità che non
sta cambiando sotto i piedi.

**File:**

- Crea: `e2e/pages/anagrafiche.page.ts` (condiviso dai Task 3 e 4)
- Crea: `e2e/tests/registry/produttore.spec.ts`
- Crea: `docs/uat/produttore.md`

- [ ] **Passo 1: mappa dell'entità** secondo la tabella della skill — campi e
      formati (partita IVA, codice fiscale, indirizzo, codice ISTAT del
      comune), CRUD, relazioni, effetti collaterali, permessi per ruolo,
      isolamento per azienda, concorrenza. Ogni riga «non applicabile» va
      scritta, non omessa.
- [ ] **Passo 2: matrice di copertura** — righe della mappa contro test
      esistenti. Oggi la colonna «esistente» sarà vuota: dichiararlo.
- [ ] **Passo 3: casi UAT** in `docs/uat/produttore.md`, nel formato della
      skill, con la riga «Pulizia» compilata per ciascuno.
- [ ] **Passo 4: E2E** — happy path, ogni validazione, permessi negati per
      ruolo di sola lettura, isolamento fra due aziende, doppio invio.
- [ ] **Passo 5: effetto collaterale** — un produttore referenziato da un
      formulario non deve poter essere cancellato. Asserire il rifiuto, non
      solo l'assenza di errore.
- [ ] **Passo 6: commit** `test(e2e): produttore — UAT e copertura end-to-end`

---

### Task 4: Trasportatore e destinatario, con le scadenze

Insieme perché condividono il page object e la forma del form, e perché le
loro scadenze alimentano lo stesso meccanismo.

**File:**

- Modifica: `e2e/pages/anagrafiche.page.ts`
- Crea: `e2e/tests/registry/trasportatore-destinatario.spec.ts`
- Crea: `docs/uat/trasportatore-destinatario.md`

- [ ] **Passo 1: mappa** delle due entità, comprese le colonne aggiunte il
      2026-09-12: `Trasportatore.scadenzaIscrizione` e
      `Destinatario.scadenzaAutorizzazione`, entrambe **nullabili di
      proposito**.
- [ ] **Passo 2: casi UAT.**
- [ ] **Passo 3: E2E del dato mancante** — assenza della scadenza significa
      «non lo so»: nessun avviso, mai. È il caso che distingue un avviso utile
      da rumore, e va provato prima degli altri.
- [ ] **Passo 4: E2E della normalizzazione del numero Albo** — `MI/7490`
      inserito dall'utente viene accettato e mostrato come `MI/007490`;
      `MI/1234567` e `M/123` restano rifiutati. È il comportamento rilasciato
      il 2026-09-12 e non ha copertura end-to-end.
- [ ] **Passo 5: E2E dell'avviso alla scelta della parte** — scegliendo in un
      formulario una controparte con autorizzazione scaduta compare l'avviso
      inline, e **l'emissione NON viene impedita**. Asserire entrambe le cose:
      il piano dello scadenzario vieta esplicitamente il blocco.
- [ ] **Passo 6: commit** `test(e2e): trasportatore e destinatario, scadenze comprese`

---

### Task 5: Le scadenze come flusso, non come campo

Qui si prova ciò che nessun test per entità può provare: che il dato
attraversa cron, notifica, email e cruscotto restando coerente.

**File:**

- Crea: `e2e/tests/scadenze/flusso-scadenze.spec.ts`
- Crea: `docs/uat/scadenze.md`
- Eventuale: un endpoint di amministrazione che esegua il controllo su
  richiesta, se non esiste già — **verificare prima** in
  `apps/backend/src/application/admin/system-health/job-actions.service.ts`,
  che espone già l'esecuzione manuale di job.

- [ ] **Passo 1: verificare** come si innesca il controllo delle scadenze
      senza aspettare il cron. Se la via esiste già, usarla; se non esiste,
      fermarsi e chiedere prima di aggiungere superficie al backend.
- [ ] **Passo 2: E2E a delta** — contare le notifiche dell'azienda PRIMA,
      innescare il controllo, contare DOPO: il delta deve essere esattamente
      il numero di anagrafiche in scadenza create dal test. Mai asserire un
      totale assoluto.
- [ ] **Passo 3: E2E della deduplicazione** — innescando il controllo due
      volte di seguito il delta della seconda volta è **zero**. È la regola dei
      sette giorni decisa il 2026-09-11, e senza questo test si può rompere
      senza che nessuno se ne accorga.
- [ ] **Passo 4: E2E della fascia del cruscotto** — l'anagrafica scaduta
      compare fra le cose che richiedono attenzione, con il pulsante che
      naviga davvero alla pagina giusta. Le rotte morte sono già state un
      difetto critico il 2026-09-11: questo test le impedisce di tornare.
- [ ] **Passo 5: E2E dello stato «tutto a posto»** — senza nulla in scadenza
      la fascia non compare affatto.
- [ ] **Passo 6: commit** `test(e2e): il flusso delle scadenze dal dato all'avviso`

---

### Task 6: Scorta vidimata — solo la superficie raggiungibile

**Riduzione di portata dichiarata.** `ConsumaNumeroVidimatoUseCase` non ha
chiamanti: l'emissione non consuma dalla scorta. Un test end-to-end
dell'emissione con numero vidimato proverebbe un percorso che nessun utente
attraversa. Si copre ciò che è davvero raggiungibile, e il resto entra nel
piano `2026-09-12-collegamento-scorta-emissione.md`.

**File:**

- Crea: `e2e/tests/rentri/scorta-blocchi.spec.ts`
- Crea: `docs/uat/scorta-vidimata.md`

- [ ] **Passo 1: E2E della pagina dei blocchi** — l'elenco si carica, i
      blocchi disattivati si mostrano **attenuati e non nascosti** (principio
      scritto nel programma di prodotto).
- [ ] **Passo 2: E2E del limite di quantità** — il campo rifiuta valori oltre
      cento **prima** di chiamare il server, senza mostrare il messaggio
      inglese del validatore.
- [ ] **Passo 3: E2E del blocco inesistente** — chiedendo la vidimazione su un
      codice inesistente si riceve un rifiuto vero e un messaggio in italiano,
      non un messaggio verde di avvio.
- [ ] **Passo 4: dichiarare nel documento UAT** cosa NON è coperto e perché,
      con il rimando al piano del collegamento.
- [ ] **Passo 5: commit** `test(e2e): blocchi e scorta vidimata, superficie raggiungibile`

---

### Task 7: La suite in CI

Oggi nessun workflow esegue Playwright. Una suite che nessuno esegue si
degrada: è successo in questa stessa base di codice con le prove contro
PostgreSQL, mai eseguite e rotte per mesi senza che nulla diventasse rosso.

**File:**

- Modifica: `.gitea/workflows/ci.yml`

- [ ] **Passo 1: verificare la fattibilità sul runner** — LXC 102 ha Docker e
      spazio, ma i browser di Playwright vanno installati. Misurare quanto
      pesa `npx playwright install --with-deps chromium` e quanto dura, e
      riportarlo PRIMA di cablare. Se il runner non regge, dirlo invece di
      aggiungere un job che fallirà sempre.
- [ ] **Passo 2: job dedicato** che accende PostgreSQL come fa già il job di
      integrazione, avvia backend e frontend, attende che rispondano su
      condizione (mai un'attesa a tempo) ed esegue la suite.
- [ ] **Passo 3: pubblicare il report** come artefatto quando il job fallisce.
      Un fallimento E2E senza traccia costringe a riprodurlo a mano.
- [ ] **Passo 4: eseguire il job due volte di seguito** — la seconda dimostra
      che la pulizia funziona. È la regola di consegna della skill.
- [ ] **Passo 5: commit** `ci: la suite E2E gira nella pipeline`

---

## Consegna

1. Suite eseguita **due volte di seguito** in locale, con l'output riportato e
   non riassunto.
2. Matrice di copertura aggiornata per ciascuna entità.
3. Riga in `COSTS.md` e voce in `STATUS.md`.

## Autoverifica del piano

- **Copertura:** i Task 3, 4 e 6 coprono le entità richieste; il Task 5 copre
  il flusso che le attraversa; i Task 1, 2 e 7 costruiscono ciò che senza di
  essi renderebbe gli altri inutili.
- **Nessun segnaposto:** percorsi, nomi di file ed endpoint sono verificati sul
  sorgente il 2026-09-14.
- **Ordine vincolante:** il Task 1 viene prima di tutto, il Task 2 prima dei
  Task 3-6. Non è preferenza: senza pulizia i test sporcano l'ambiente, senza
  selettori nascono fragili.
- **Riduzione dichiarata:** il Task 6 è volutamente parziale, e il documento
  UAT deve dirlo al lettore invece di lasciarlo dedurre.
- **Punto lasciato aperto di proposito:** il Task 5 passo 1 non decide come
  innescare il controllo delle scadenze, perché aggiungere superficie al
  backend per comodità dei test è una scelta che va fatta guardando cosa
  esiste già, non a memoria.
