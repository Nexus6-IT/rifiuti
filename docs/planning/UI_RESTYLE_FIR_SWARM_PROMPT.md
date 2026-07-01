# Prompt — Swarm "UI/UX: restyle grafico + form FIR + create/edit inline anagrafiche"

> Swarm di agenti coordinati per (1) sistemare l'aspetto grafico dell'app —
> spacing e contrasti oggi gestiti male — con particolare attenzione alla **form
> del Formulario (FIR)**, e (2) permettere, DALLA form FIR, di **aggiungere o
> modificare** una delle figure coinvolte (produttore, trasportatore,
> destinatario) e ritrovarla **subito selezionata** nella dropdown.
> Frontend: Angular 17 standalone + PrimeNG 17. Design system "B" (slate + teal).

---

## 0. Obiettivo

1. **Restyle grafico coerente**: correggere spacing incoerente e **contrasti non
   conformi WCAG 2.1 AA** in tutta l'app, con focus prioritario sulla **form di
   creazione/modifica FIR** (oggi la peggiore). Griglia 8pt, gerarchia tipografica
   chiara, densità coerente, stati (hover/focus/disabled/error) leggibili.
2. **Create/Edit inline delle anagrafiche dalla form FIR**: accanto a ciascuna
   dropdown (Produttore / Trasportatore / Destinatario) l'utente può:
   - **Aggiungere** una nuova anagrafica (apre un sotto-dialog con il form
     anagrafica); al salvataggio l'entità viene creata via API, la dropdown si
     aggiorna e la **nuova entità risulta selezionata**;
   - **Modificare** l'anagrafica attualmente selezionata (stesso sotto-dialog
     precompilato); al salvataggio l'entità viene aggiornata e **resta selezionata
     con i dati aggiornati**.
   Riuso del form anagrafica esistente (registry) come componente/dialog
   condiviso, con validazioni (P.IVA/CF) e scoping multi-tenant già presenti.

Ogni intervento è **verificato live** su https://rifiuti.ignicraft.com con
Playwright + misurazioni reali di contrasto/spacing.

---

## 1. Contesto condiviso (per OGNI agente)

- **Stack FE**: Angular 17 standalone, PrimeNG 17, PrimeFlex; SCSS globale
  `apps/frontend/src/styles.scss`; design system "B": slate + teal-600 `#0d9488`
  (dark `#0f766e` per testo su fill AA), IBM Plex Sans/Mono, griglia 8pt, altezze
  controlli 32/40/48. WCAG 2.1 AA.
- **File chiave**: `apps/frontend/src/styles.scss` (token/spacing/contrasti);
  `apps/frontend/src/app/features/fir/fir-list.component.ts` (form FIR con le 3
  dropdown ricercabili + sezione trasportatori intermodali); il modulo/feature
  **registry** (`features/registry/…` + `registry.service.ts` con
  create/update/get per produttori/trasportatori/destinatari e i relativi form);
  layout `shared/components/layout.component.ts`.
- **Contratti backend utili**: `GET /registry/{produttori,trasportatori,destinatari}`
  ritorna envelope paginato `{items,total,…}`; create `POST …`, update `PATCH/PUT
  …/:id`, get `…/:id`. Le anagrafiche sono tenant-scoped (header società attiva
  gestito lato core). Il FIR usa **snapshot immutabile** dell'anagrafica al momento
  della creazione (vedi memory `rifiuti-fir-data-model`): quindi modificare
  un'anagrafica NON deve alterare i FIR già creati (solo i nuovi).
- Vedi memory: `rifiuti-fir-lifecycle`, `rifiuti-fir-data-model`,
  `rifiuti-build-deploy-gotchas`, `rifiuti-admin-provisioning`.

## 2. Strumenti OBBLIGATORI (scoprili con ToolSearch e usali)

- **MCP PrimeNG** (`mcp__primeng__*`): componenti, prop, esempi, **token di tema**,
  **accessibilità** e passthrough per Dropdown/Select, Dialog, InputText, Button,
  InputNumber, ecc. Usalo PRIMA di scrivere markup PrimeNG.
- **MCP Playwright** (`mcp__plugin_playwright_playwright__*`): verifica live,
  screenshot, e **misura reale** di contrasto/spacing via `browser_evaluate`
  (getComputedStyle, rapporti di contrasto, box metrics).
- **MCP Context7** (`resolve-library-id`→`query-docs`): doc aggiornata Angular 17
  (signals, reactive forms, standalone, control flow), PrimeNG 17, WCAG.
- **MCP Angular** e **MCP Chrome DevTools** — se disponibili nella sessione
  (scoprili con ToolSearch, es. query "angular", "devtools"/"chrome"): usali per
  ispezione componenti/DOM, performance e **audit accessibilità/contrasto** in
  pagina. Se NON disponibili, ripiega su Playwright `browser_evaluate` + la skill.
- **Skill `frontend-design`**: applicane i principi (gerarchia, spazio, contrasto,
  micro-interazioni sobrie) mantenendo la coerenza col design system "B" esistente
  (NON reinventare il tema; raffina).
- Altre skill/agenti utili a discrezione (es. `ux-ui-mobile-specialist`).

Ogni workstream consegna una **nota** con: cosa misurato/consultato (fonti) e
decisioni.

## 3. Vincoli HARD

1. **NON rompere la logica esistente**: ciclo di vita FIR, dropdown ricercabili,
   sezione trasportatori intermodali, multi-tenant, enforcement — tutto deve
   continuare a funzionare (verifica live).
2. **WCAG 2.1 AA**: ogni testo/again componente interattivo deve raggiungere i
   rapporti di contrasto AA (≥4.5:1 testo normale, ≥3:1 testo grande/UI); focus
   visibile; target ≥ 24px (idealmente 44px touch). Misurare, non stimare.
3. **Griglia 8pt** e scala di spacing coerente via token; niente valori magici.
4. **Snapshot FIR immutabile**: modificare un'anagrafica dal form FIR aggiorna il
   registro ma NON i FIR storici (solo lo snapshot del nuovo FIR in creazione).
5. Coerenza col design system "B" (slate + teal); Italian-first (UI/commenti/commit);
   **nessuna attribuzione AI** nei commit; nessun segreto.
6. Frontend `npm run build` + lint verdi; se tocchi il backend (improbabile),
   `tsc`+`jest` verdi e **lockfile sincronizzati** (backend standalone + root — vedi
   `rifiuti-build-deploy-gotchas`). NON aggiornare typescript (5.4.5).
7. Deploy solo a fine fase, in batch (no push-storm); il **CI gate** (lint+build)
   deve restare verde. Verifica live dopo il deploy.

## 4. Workstream

### WS-1 — Audit UI/accessibilità (read-only, prima di tutto)
- **Scopo**: mappare i problemi reali di spacing e contrasto, con numeri.
- **Task**: con Playwright (+ Chrome DevTools/Angular MCP se disponibili) naviga
  le viste chiave (login, dashboard, **form FIR**, liste anagrafiche, registro,
  MUD, abbonamento) e MISURA: rapporti di contrasto (testo, bottoni, placeholder,
  bordi input, tag/stati), spacing (padding/margini/gap incoerenti vs 8pt),
  allineamenti, densità, stati focus/hover/disabled, responsività (breakpoint
  mobile/tablet). Cattura screenshot annotati.
- **Output**: elenco priorizzato (P0/P1/P2) di violazioni con selettore/file,
  valore attuale → valore atteso; focus sulla form FIR. Alimenta WS-2/WS-3.

### WS-2 — Design system: spacing + contrasti (fondamentale)
- **Scopo**: correggere alla radice token di spacing e contrasti in `styles.scss`.
- **Task**: definire/riordinare la scala di spacing (8pt) e i token colore in modo
  che TUTTI i testi/UI raggiungano AA (slate su bianco, testo su teal, placeholder,
  bordi input ≥3:1, tag di stato, link, disabled). Stati focus visibili e coerenti.
  Applicare i fix sistemici alle classi condivise (bottoni, input, select, dialog,
  tabelle, card). Evitare override locali dove basta il token.
- **CA**: contrasti AA verificati con misura (Playwright/devtools) sui campioni
  chiave; spacing coerente; nessuna regressione visiva sulle viste principali.

### WS-3 — Restyle form FIR (priorità)
- **Scopo**: rendere la form di creazione/modifica FIR ordinata e leggibile.
- **Task**: ristrutturare il layout del dialog FIR (raggruppamenti logici:
  Soggetti / Rifiuto / Trasporto intermodale / Dati aggiuntivi; label chiare,
  spacing 8pt, larghezze campi coerenti, help text, messaggi d'errore leggibili,
  griglia responsive). Usare i pattern PrimeNG corretti (MCP PrimeNG) per
  Dropdown/Select ricercabili, InputNumber, Textarea, Dialog. Mantenere TUTTI i
  campi esistenti (inclusi i nuovi DM 59/2023: stato fisico, HP, colli, R/D,
  Campo 17) e la sezione trasportatori intermodali. Micro-interazioni sobrie.
- **CA**: la form è chiaramente più leggibile (prima/dopo con screenshot), AA
  rispettato, creazione FIR + ciclo di vita ancora funzionanti live.

### WS-4 — Create/Edit inline anagrafiche dalla form FIR (feature)
- **Scopo**: aggiungere/modificare produttore/trasportatore/destinatario senza
  uscire dal form FIR, ritrovando l'entità selezionata.
- **Task**:
  1. Estrai il form anagrafica esistente (registry) in un **componente/dialog
     riutilizzabile** (`AnagraficaFormDialog`) parametrizzato per tipo
     (produttore/trasportatore/destinatario) e modalità (create/edit), con le
     validazioni esistenti (P.IVA/CF, indirizzo, numero iscrizione/autorizzazione).
  2. Nella form FIR, accanto a ciascuna dropdown: pulsante **"Nuovo"** (apre il
     dialog in create) e azione **"Modifica"** sull'elemento selezionato (apre in
     edit precompilato). Al salvataggio: chiama create/update via `RegistryService`,
     **ricarica le opzioni** della dropdown e **seleziona** l'entità
     creata/aggiornata (by id). Gestisci errori (toast) e stato di caricamento.
  3. Coerenza multi-tenant (società attiva) e con lo snapshot immutabile del FIR
     (la modifica aggiorna il registro; lo snapshot viene preso alla creazione FIR).
- **CA (verifica live)**: dal form FIR creo un nuovo trasportatore → compare
  selezionato nella dropdown e nel FIR creato; modifico un produttore selezionato →
  i dati aggiornati si riflettono nella selezione; l'entità è persistita nel
  registro (visibile anche nella lista anagrafiche). Design coerente (WS-2/WS-3).

## 5. Orchestrazione
1. **Fase A — Audit** (WS-1, read-only) → report priorizzato.
2. **Fase B — Fix design** (WS-2 poi WS-3; toccano `styles.scss` + form FIR →
   sequenziali/coordinati per evitare conflitti). 
3. **Fase C — Feature** (WS-4, sopra il layout ristrutturato di WS-3).
4. **Fase D — Deploy batch + verifica live** (Playwright): restyle + misure AA +
   flusso create/edit inline end-to-end; screenshot prima/dopo; aggiorna eventuali
   note in `docs/`. Deploy solo qui, CI gate verde.

Integrazione a cura dell'orchestratore (WS-2/3/4 toccano file frontend condivisi:
`styles.scss`, `fir-list.component.ts`, registry) — worktree isolati o sequenza.

## 6. Definition of Done
- Spacing coerente (8pt) e **contrasti AA verificati con misura** sulle viste
  chiave e in particolare sulla form FIR (report prima/dopo).
- Form FIR ristrutturata e leggibile, tutti i campi e il ciclo di vita funzionanti.
- Dal form FIR si **aggiunge e si modifica** produttore/trasportatore/destinatario
  ritrovandoli selezionati nella dropdown; entità persistite nel registro
  (verificato live con Playwright).
- `npm run build` + lint frontend verdi; CI gate verde; deploy live verificato;
  nessuna regressione funzionale.
