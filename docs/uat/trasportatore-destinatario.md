# UAT — Anagrafiche Trasportatore e Destinatario (con le scadenze)

- **Data**: 2026-09-14
- **Entità**: `Trasportatore`, `Destinatario` — trattate insieme perché
  condividono forma del form e page object, e perché le loro scadenze
  alimentano lo stesso meccanismo (`calcolaScadenza`,
  `scadenza-controparte.util.ts`)
- **Fonti lette**:
  - `apps/backend/src/api/registry/dto/create-registry.dto.ts` (CreateTrasportatoreDto/CreateDestinatarioDto e Update\*)
  - `apps/backend/src/domain/registry/entities/{trasportatore,destinatario}.ts`
  - `apps/backend/prisma/schema.prisma` (model `Trasportatore`/`Destinatario`, colonne `scadenzaIscrizione`/`scadenzaAutorizzazione` nullable)
  - `apps/backend/src/application/notifications/scadenza-controparte.util.ts` (`calcolaScadenza`)
  - `apps/backend/src/api/registry/registry.controller.ts` (campi `iscrizioneScaduta`/`autorizzazioneScaduta`/`giorniAllaScadenza` nella lista)
  - `apps/backend/src/application/rentri/mappatura/mappa-parti.ts` (`normalizzaNumeroIscrizioneAlbo`)
  - `apps/frontend/src/app/features/registry/{trasportatori,destinatari}-list.component.ts`
  - `apps/frontend/src/app/features/fir/fir-list.component.ts` (avviso righe ~442-521, `validateFir()` righe ~1610-1627, `loadAnagrafiche()` righe ~1383-1406)
- **Automazione**: `e2e/tests/registry/trasportatore-destinatario.spec.ts`,
  page object `e2e/pages/anagrafiche.page.ts` (esteso rispetto al Task 3 con
  `scadenzaInput`)
- **Verifica di questa sessione**: `npx tsc --noEmit -p e2e/tsconfig.json`
  (0 errori) + `npx prettier --check` sui file toccati. **La suite NON è
  stata eseguita contro un'app viva** (stesso vincolo d'ambiente del Task 3
  — dichiarato, non taciuto).

## 1. Mappa dell'entità

| Aspetto                                                       | Trasportatore                                                                                                                                                                                                                                                                                                                                                                                                          | Destinatario                                                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Campi comuni**                                              | `ragioneSociale`, `partitaIVA` (11 cifre), `sedeLegale` (via/civico/cap 5 cifre/comune/provincia), `email` (opz., `@IsEmail`), `telefono` (opz., libero), `pec` (opz., libero, non validato come email)                                                                                                                                                                                                                | stessi campi, ma l'indirizzo si chiama `sede` (non `sedeLegale`)                                                                                         |
| **Campo distintivo**                                          | `numeroIscrizione` (stringa obbligatoria, **nessuna validazione di formato** a livello di DTO/entità — accetta qualunque stringa non vuota)                                                                                                                                                                                                                                                                            | `numeroAutorizzazione` (stringa obbligatoria, stessa assenza di validazione di formato)                                                                  |
| **Scadenza (Task 3/4 dello scadenzario, 2026-09-11/12)**      | `scadenzaIscrizione: Date?` — **nullable di proposito**: l'assenza non è "scaduta" né "non scade mai", è "non lo sappiamo" (commento esplicito in `scadenza-controparte.util.ts`)                                                                                                                                                                                                                                      | `scadenzaAutorizzazione: Date?` — stessa semantica                                                                                                       |
| **CRUD**                                                      | Identico a Produttore (vedi `docs/uat/produttore.md`): create/update/delete richiedono `SUPER_ADMIN`\|`ADMIN`\|`OPERATOR`, lettura aperta a qualunque ruolo autenticato, `partitaIVA` immutabile in update                                                                                                                                                                                                             | Identico                                                                                                                                                 |
| **Unicità**                                                   | `partitaIVA` unica per tenant. `numeroIscrizione` **anche** unico per tenant (`findByNumeroIscrizione`, controllato in `CreateTrasportatoreUseCase` prima dell'insert)                                                                                                                                                                                                                                                 | `partitaIVA` unica per tenant. Nessun controllo di unicità applicativo trovato su `numeroAutorizzazione` (solo la partita IVA è ricontrollata in create) |
| **Aggiornamento scadenza**                                    | `undefined` in update = campo non toccato; `null` = azzeramento esplicito; stringa ISO = nuova data (`mapScadenzaUpdate` in registry.controller.ts)                                                                                                                                                                                                                                                                    | stessa semantica, stesso helper condiviso                                                                                                                |
| **Effetto collaterale — avviso "a scelta"**                   | `GET /registry/trasportatori` calcola e restituisce `iscrizioneScaduta`/`giorniAllaScadenza` per riga (via `calcolaScadenza`); il form "Nuovo FIR" mostra un `p-message` di avviso (`data-testid="fir-trasportatore-iscrizione-scaduta"`) quando il trasportatore scelto ha `iscrizioneScaduta === true`. **L'avviso NON blocca l'emissione**: `validateFir()` non controlla mai questo campo                          | stesso meccanismo, campo `autorizzazioneScaduta`, testid `fir-destinatario-autorizzazione-scaduta`                                                       |
| **Effetto collaterale — controllo periodico**                 | `DeadlineCheckerService` (Task 1/3 dello scadenzario, non nel perimetro di questo file) genera notifiche/email quando la scadenza si avvicina o è passata, usando la stessa `calcolaScadenza`                                                                                                                                                                                                                          | stesso meccanismo                                                                                                                                        |
| **Normalizzazione del numero Albo (`MI/7490` → `MI/007490`)** | **Esiste SOLO in `mappa-parti.ts` (`normalizzaNumeroIscrizioneAlbo`)**, ed è corretto che sia lì e non nel CRUD: normalizza sul confine verso RENTRI, dove il formato conta davvero (già coperta da 15 test unitari in `mappa-parti.spec.ts`). L'anagrafica **accetta e conserva** `numeroIscrizione` esattamente come inserito, senza normalizzarlo né rifiutarlo per l'assenza di zeri iniziali — vedi test dedicato | Non applicabile: `numeroAutorizzazione` non ha un formato normalizzato da nessuna parte del codice                                                       |
| **Relazioni / cancellazione dell'anagrafica referenziata**    | Stessa decisione di prodotto documentata in `docs/uat/produttore.md` §1 ("Cancellazione di un'anagrafica referenziata" / "Invariante — lo snapshot del FIR non cambia mai"): cancellare un trasportatore/destinatario referenziato da un FIR riesce sempre, di proposito — lo snapshot già congelato sul documento non cambia                                                                                          | idem                                                                                                                                                     |
| **Permessi per ruolo**                                        | Identico a Produttore                                                                                                                                                                                                                                                                                                                                                                                                  | Identico                                                                                                                                                 |
| **Isolamento per azienda**                                    | Identico a Produttore (scoping per tenant, unicità per tenant)                                                                                                                                                                                                                                                                                                                                                         | Identico                                                                                                                                                 |
| **Concorrenza / doppio invio**                                | Stessa difesa di Produttore (unicità su partitaIVA, più `numeroIscrizione` qui)                                                                                                                                                                                                                                                                                                                                        | Stessa difesa di Produttore (solo partitaIVA)                                                                                                            |

## 2. Matrice di copertura

| Riga della mappa                                                           | Test esistente (prima di questa sessione)      | Test aggiunto in questa sessione                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create con scadenza valorizzata (happy path UI)                            | **Nessuno**                                    | `trasportatore-destinatario.spec.ts` → "happy path: crea un trasportatore/destinatario con scadenza... dalla UI"                                                                                                                                                     |
| Scadenza assente → nessun avviso alla scelta in un FIR                     | **Nessuno**                                    | `trasportatore-destinatario.spec.ts` → describe "dato mancante non genera mai un avviso" (2 test, trasportatore e destinatario)                                                                                                                                      |
| Scadenza passata → avviso mostrato, emissione non impedita                 | **Nessuno**                                    | `trasportatore-destinatario.spec.ts` → describe "avviso alla scelta della parte..." (2 test) — vedi nota sullo scope in §3                                                                                                                                           |
| Numero Albo non normalizzato: accettato e persistito com'è                 | **Nessuno**                                    | `trasportatore-destinatario.spec.ts` → describe "numero Albo non normalizzato" → `"MI/7490" è accettato e si ritrova invariato dopo il salvataggio`                                                                                                                  |
| CRUD generico (validazioni di formato, permessi, isolamento, doppio invio) | Coperto per Produttore in `produttore.spec.ts` | **Non ripetuto qui**: il brief del Task 4 non lo richiede esplicitamente per queste due entità (si concentra sulle scadenze), ed è la stessa validazione già dimostrata sul Produttore — ripeterla identica su altre due entità non aggiungerebbe informazione nuova |

## 3. Casi UAT

### UAT-TRASP-01 — Creazione di un trasportatore con scadenza iscrizione

- **Precondizioni**: utente OPERATOR/ADMIN/SUPER_ADMIN su `/trasportatori`.
- **Passi**: "Nuovo trasportatore" → compilare ragione sociale, P.IVA, numero iscrizione Albo, scadenza iscrizione (facoltativa, qui valorizzata), sede → "Salva".
- **Risultato atteso**: la riga compare in tabella; la scadenza è persistita (visibile in modifica).
- **Pulizia**: `DELETE /registry/trasportatori/:id` (teardown automatico).
- **Automazione**: `e2e/tests/registry/trasportatore-destinatario.spec.ts::happy path: crea un trasportatore con scadenza iscrizione dalla UI`

### UAT-DEST-01 — Creazione di un destinatario con scadenza autorizzazione

- Analogo a UAT-TRASP-01, entità Destinatario.
- **Automazione**: `e2e/tests/registry/trasportatore-destinatario.spec.ts::happy path: crea un destinatario con scadenza autorizzazione dalla UI`

### UAT-SCAD-01 — Trasportatore senza scadenza: nessun avviso "inventato"

- **Precondizioni**: un trasportatore con `scadenzaIscrizione` **assente** (mai valorizzata).
- **Passi**: aprire "Nuovo FIR", selezionare quel trasportatore.
- **Risultato atteso**: nessun avviso di scadenza compare (l'assenza del dato non è "scaduta").
- **Pulizia**: il trasportatore di setup viene cancellato via API a fine test.
- **Automazione**: `e2e/tests/registry/trasportatore-destinatario.spec.ts::trasportatore SENZA scadenza: nessun avviso alla scelta in un FIR`

### UAT-SCAD-02 — Destinatario senza scadenza: nessun avviso "inventato"

- Analogo a UAT-SCAD-01, entità Destinatario.
- **Automazione**: `e2e/tests/registry/trasportatore-destinatario.spec.ts::destinatario SENZA scadenza: nessun avviso alla scelta in un FIR`

### UAT-SCAD-03 — Trasportatore con iscrizione scaduta: avviso, emissione non bloccata

- **Precondizioni**: un trasportatore con `scadenzaIscrizione` nel passato (ieri).
- **Passi**: aprire "Nuovo FIR", selezionare quel trasportatore, poi cliccare "Crea FIR" senza compilare gli altri campi obbligatori.
- **Risultato atteso**: l'avviso "L'iscrizione all'Albo Gestori di questo trasportatore risulta scaduta..." compare SUBITO alla selezione; cliccando "Crea FIR" NON compare alcun errore sul campo trasportatore (la selezione resta valida), mentre compaiono i normali errori sugli altri campi obbligatori mancanti (CER, provenienza, ecc.) — a riprova che la validazione del form funziona ma non tratta la scadenza come un blocco.
- **Pulizia**: il trasportatore di setup viene cancellato via API a fine test. Nessun FIR viene creato in questo caso (il submit non è mai completato con successo, si ferma sulla validazione degli altri campi).
- **Automazione**: `e2e/tests/registry/trasportatore-destinatario.spec.ts::trasportatore con iscrizione scaduta: avviso mostrato, selezione non bloccata`
- **Nota sullo scope**: questo caso NON dimostra che un FIR venga emesso con successo con un trasportatore scaduto (servirebbe completare l'intera creazione — CER, quantità, provenienza, modalità di trasporto — un percorso senza copertura E2E stabile in questa suite, vedi `fir-lifecycle.spec.ts::test.fixme`). Dimostra invece, sul componente reale e non solo sulla lettura del sorgente, che `validateFir()` non genera mai un errore legato alla scadenza — che è esattamente il punto rilevante ("non impedisce la selezione/il tentativo di emissione").

### UAT-SCAD-04 — Destinatario con autorizzazione scaduta: avviso, emissione non bloccata

- Analogo a UAT-SCAD-03, entità Destinatario.
- **Automazione**: `e2e/tests/registry/trasportatore-destinatario.spec.ts::destinatario con autorizzazione scaduta: avviso mostrato, selezione non bloccata`

### UAT-TRASP-02 — Il numero Albo senza zeri iniziali è accettato e conservato com'è

- **Precondizioni**: nessuna.
- **Passi**: `POST /registry/trasportatori` con `numeroIscrizione: "MI/7490"`; poi `GET /registry/trasportatori/:id`.
- **Risultato atteso**: la creazione riesce (201); il valore restituito, sia nella risposta di creazione sia nella successiva lettura, è esattamente `"MI/7490"` — nessuna normalizzazione, nessun rifiuto per l'assenza di zeri iniziali.
- **Pulizia**: il trasportatore creato viene cancellato via API a fine test.
- **Automazione**: `e2e/tests/registry/trasportatore-destinatario.spec.ts::"MI/7490" è accettato e si ritrova invariato dopo il salvataggio`
- **Nota**: la normalizzazione verso il formato RENTRI (`"MI/007490"`) avviene altrove, sul confine di trasmissione (`mappa-parti.ts`), già coperta da test unitari dedicati — non è oggetto di questo caso, che riguarda solo l'anagrafica.

## 4. Correzione rispetto alla prima stesura di questo documento

La prima stesura di questo documento (stessa sessione) trattava due punti
come riserve/difetti aperti. Il committente ha verificato sul sorgente,
confermato che i fatti erano esatti, ma corretto la lettura in entrambi i
casi:

1. **Cancellazione di un'anagrafica referenziata da un FIR**: non è un
   difetto, è la decisione di prodotto "il FIR conserva uno snapshot, non
   un riferimento vivo" (`schema.prisma`, 2026-06-09) — vedi
   `docs/uat/produttore.md` per l'invariante corretta, che vale
   identicamente per trasportatore e destinatario.
2. **Normalizzazione del numero Albo**: normalizzare sul confine RENTRI,
   dove il formato conta, è corretto — il problema che la ricerca sui
   concorrenti aveva segnalato (rifiuto di `"MI/7490"`) è già risolto lì.
   Il punto davvero scoperto e visibile all'utente non era la
   normalizzazione in sé, ma l'assenza di un rifiuto in anagrafica — ora
   coperto da UAT-TRASP-02.
