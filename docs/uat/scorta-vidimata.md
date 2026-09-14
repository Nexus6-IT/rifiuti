# UAT — Blocchi e scorta vidimata RENTRI (R6)

- **Data**: 2026-09-14
- **Entità**: blocchi virtuali RENTRI (`GET /rentri/blocchi`), scorta di
  numeri pre-vidimati (`GET /rentri/scorta`), avvio di una vidimazione
  (`POST /rentri/scorta/vidima`)
- **Fonti lette**:
  - `apps/frontend/src/app/features/rentri/rentri-blocchi.component.ts`
    (template, selettori `data-testid`, `quantitaVidimazioneMassima`)
  - `apps/frontend/src/app/features/rentri/rentri-blocchi.service.ts`
  - `apps/backend/src/api/rentri/rentri-scorta.controller.ts`
  - `apps/backend/src/api/rentri/dto/vidima-scorta-rentri.dto.ts` (`@Max(100)`)
  - `apps/backend/src/application/rentri/scorta/avvia-vidimazione-scorta.use-case.ts`
    (in particolare `verificaBlocco`, la verifica preventiva fail-closed)
  - `docs/superpowers/plans/2026-09-12-collegamento-scorta-emissione.md`
- **Automazione**: `e2e/tests/rentri/scorta-blocchi.spec.ts`, page object
  `e2e/pages/rentri-blocchi.page.ts`
- **Verifica di questa sessione**: `npx tsc --noEmit -p e2e/tsconfig.json` e
  `npx prettier --check` sui file toccati. **La suite NON è stata eseguita
  contro un'app viva** — vincolo d'ambiente (macchina con meno di 2 GB liberi
  e ~190 processi node di altri progetti in corso): l'esecuzione la fa
  Graziano separatamente. Dichiarato, non taciuto.

## 1. Riduzione di portata dichiarata

`ConsumaNumeroVidimatoUseCase` (backend, ricerca del 2026-09-14) **non ha un
solo chiamante**. Tutto il lavoro R6 — scorta, rifornimento automatico,
pagina dei blocchi — è in produzione ma **scollegato dall'emissione**:
`EmettiFIRUseCase` genera ancora il proprio `numeroProgressivo`, non preleva
mai dalla scorta. Il banner che segnalava "emissione non possibile" è stato
rimosso il 2026-09-11 proprio perché era un falso allarme permanente:
l'emissione riesce sempre, a prescindere dallo stato della scorta.

**Conseguenza per questo documento**: un test end-to-end che emette un
formulario e verifica che porti un numero vidimato dalla scorta
proverebbe un percorso **che nessun utente attraversa oggi**. Non è stato
scritto, per lo stesso motivo per cui non ha senso scrivere un test che
verifichi il comportamento di un bottone che non esiste in pagina.

Il collegamento è pianificato in
`docs/superpowers/plans/2026-09-12-collegamento-scorta-emissione.md`
(Task 1: decisione se il numero vidimato sostituisce o convive con
`numeroProgressivo`, Task 2-3: innesto in `EmettiFIRUseCase`). **Quando
quel piano sarà eseguito**, questo documento e la spec vanno estesi con un
caso end-to-end "emettere un FIR quando la scorta ha numeri disponibili →
il FIR emesso porta il numero vidimato, non il progressivo nostro" — non
prima, perché prima quel percorso non esiste.

Restano quindi fuori da questa sessione, e vanno considerati debito
esplicito (non omissione silenziosa):

| Cosa NON è coperto                                                        | Perché                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Emissione di un FIR con consumo dalla scorta                              | `ConsumaNumeroVidimatoUseCase` senza chiamanti — percorso non raggiungibile, vedi piano collegamento                                                                                                                                                                                                                                                   |
| Comportamento quando la scorta si esaurisce durante l'emissione           | Stessa ragione: dipende dal collegamento non ancora fatto                                                                                                                                                                                                                                                                                              |
| Esito reale di una vidimazione avviata (i numeri che compaiono in scorta) | La vidimazione è asincrona e dipende dalla risposta dell'ente (fake o reale): non c'è un modo affidabile di attendere l'esito senza un tempo fisso, che la skill vieta. `AvviaVidimazioneScortaUseCase.execute` ha già copertura unitaria dedicata (`avvia-vidimazione-scorta.use-case.spec.ts`) per il ciclo per-numero e l'isolamento dei fallimenti |
| `RentriRifornimentoScortaJob` (rifornimento automatico schedulato)        | Job in background, fuori dal perimetro di una UAT sull'interfaccia; ha una propria suite unitaria (`rentri-rifornimento-scorta.job.spec.ts`)                                                                                                                                                                                                           |
| Impostare un blocco come predefinito (`PUT .../predefinito`)              | Non nel perimetro del Task 6 (brief limitato a caricamento pagina, limite quantità, blocco inesistente); nessun principio di prodotto a rischio di regressione silenziosa su questa azione                                                                                                                                                             |

## 2. Matrice di copertura

| Caso                                                                      | Test esistente (prima di questa sessione)                                                                                  | Test aggiunto in questa sessione                                                                                                                                                          |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pagina blocchi: caricamento, blocchi disattivati attenuati e non nascosti | **Nessuno** (solo `rentri-blocchi.component.spec.ts`, unitario su Angular TestBed, non sul browser reale)                  | `scorta-blocchi.spec.ts` → "la pagina dei blocchi si carica e i blocchi disattivati restano visibili, attenuati e non nascosti"                                                           |
| Limite di quantità (100) rifiutato lato client, prima del server          | Coperto **a livello di componente** (`rentri-blocchi.component.spec.ts`, chiamando `confermaVidimazione()` direttamente)   | `scorta-blocchi.spec.ts` → "il campo quantità rifiuta un lotto oltre cento prima di interrogare il server..." — stavolta digitando davvero nel campo nel browser, non chiamando il metodo |
| Vidimazione su blocco inesistente → rifiuto reale, messaggio italiano     | **Nessuno** (la correzione fail-closed è di ieri, 2026-09-13/14 — vedi commento in `avvia-vidimazione-scorta.use-case.ts`) | `scorta-blocchi.spec.ts` → "vidimare un blocco inesistente riceve un rifiuto vero e in italiano, non un avvio accettato"                                                                  |
| Emissione con consumo dalla scorta                                        | Non applicabile — percorso non raggiungibile                                                                               | Vedi §1                                                                                                                                                                                   |

## 3. Casi UAT

### UAT-SCORTA-01 — I blocchi disattivati restano visibili, solo attenuati

- **Precondizioni**: utente ADMIN/SUPER_ADMIN/OPERATOR su `/rentri/blocchi`;
  almeno un blocco disattivato letto dall'ente per il tenant di test.
- **Passi**: aprire "Blocchi e vidimazione RENTRI".
- **Risultato atteso**: la sezione "Blocchi disattivati" è visibile (non
  nascosta dietro un filtro), ogni riga mostra il badge "Disattivato" ed è
  visivamente attenuata (opacità ridotta, non zero — non è un `display:
none` travestito). Principio di prodotto: "non far sparire le cose". Se
  in futuro qualcuno nascondesse i blocchi disattivati "per pulizia
  dell'interfaccia", questo caso lo rileva.
- **Pulizia**: nessuna — test di sola lettura, nessuna risorsa creata.
- **Automazione**: `e2e/tests/rentri/scorta-blocchi.spec.ts::la pagina dei blocchi si carica e i blocchi disattivati restano visibili, attenuati e non nascosti`
- **Nota**: se il tenant di test non ha alcun blocco disattivato al momento
  dell'esecuzione, il test fa `test.skip()` con motivo esplicito — i blocchi
  si creano/disattivano solo sul portale dell'ente, nessuna fixture di
  questa suite può prepararne uno in anticipo.

### UAT-SCORTA-02 — Il campo quantità rifiuta oltre cento prima di contattare il server

- **Precondizioni**: utente ADMIN/SUPER_ADMIN su `/rentri/blocchi`; almeno
  un blocco attivo (necessario per vedere il bottone "Vidima un lotto",
  visibile solo per questi ruoli).
- **Passi**: aprire il dialogo di vidimazione su un blocco attivo, digitare
  150 nel campo quantità.
- **Risultato atteso**: il bottone "Avvia vidimazione" si disabilita
  immediatamente (nessun clic possibile), **nessuna richiesta HTTP** parte
  verso `/rentri/scorta/vidima`, e non compare da nessuna parte il
  messaggio inglese che il validatore lato server (`@Max(100)`,
  class-validator) produrrebbe se la richiesta arrivasse comunque. Il tetto
  lato client (`quantitaVidimazioneMassima = 100`, allineato al `@Max(100)`
  del DTO) è il criterio di normalizzazione preventiva del progetto: un
  utente non deve mai vedere un errore di validazione in inglese.
- **Pulizia**: nessuna — nessuna richiesta scritta, dialogo chiuso senza
  conferma.
- **Automazione**: `e2e/tests/rentri/scorta-blocchi.spec.ts::il campo quantità rifiuta un lotto oltre cento prima di interrogare il server, senza il messaggio inglese del validatore`
- **Nota**: se il tenant di test non ha alcun blocco attivo, il test fa
  `test.skip()` con motivo esplicito.

### UAT-SCORTA-03 — Vidimare un blocco inesistente è un rifiuto vero, non un "avviato" ottimistico

- **Precondizioni**: utente autenticato con ruolo ADMIN/SUPER_ADMIN/OPERATOR
  (token JWT valido).
- **Passi**: chiamare `POST /rentri/scorta/vidima` con un `codiceBlocco`
  inventato (non presente nell'elenco dell'ente per questo operatore) e
  `quantita: 1`.
- **Risultato atteso**: risposta **404**, non 202. Il corpo contiene un
  messaggio in italiano ("Nessun blocco virtuale RENTRI con codice ... trovato
  per questo operatore"), non un codice macchina né un fallback in inglese, e
  **non** contiene `avviato: true`. Questo comportamento — verifica
  preventiva del blocco PRIMA di rispondere 202 — è la correzione applicata
  ieri (`AvviaVidimazioneScortaUseCase.verificaBlocco`, chiamata `await`
  dal controller prima della risposta): prima, un `codiceBlocco` inventato
  finiva comunque nel ciclo fire-and-forget e l'endpoint rispondeva 202
  "avviato" a un utente che aveva sbagliato codice, con l'unico segnale
  d'errore perso in un log di background.
- **Pulizia**: nessuna — nessuna risorsa creata, nessun blocco esiste con
  quel codice.
- **Automazione**: `e2e/tests/rentri/scorta-blocchi.spec.ts::vidimare un blocco inesistente riceve un rifiuto vero e in italiano, non un avvio accettato`
- **Nota importante — non testato qui**: se l'ente RENTRI (o la fake usata
  in sviluppo) è irraggiungibile durante questa verifica preventiva
  (errore di rete/timeout, condizione **transitoria**), `verificaBlocco`
  **non rifiuta** — prosegue con il ciclo di vidimazione, che isola i
  fallimenti per singolo numero. Questo caso richiede di rendere l'ente
  irraggiungibile a comando (tools/rentri-fake spento o che risponde con
  errore), non è nel perimetro del Task 6 e non ha una fixture pronta in
  questa suite. Va tracciato separatamente se si vuole provare anche quel
  ramo (l'unit test `avvia-vidimazione-scorta.use-case.spec.ts` copre già
  la distinzione "blocco assente" vs "ente irraggiungibile" a livello di
  use case).
