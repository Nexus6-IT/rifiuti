# Restyle delle pagine, giro 2 («Libro mastro», colori IgniCraft) — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`. Un agente sonnet per task (`typescript-expert-coder`),
> revisione opus fra un task e il successivo (`typescript-nestjs-reviewer` sul codice,
> `ux-ui-mobile-specialist` sugli screenshot); ondate come nella sezione «Ondate». Passi con checkbox
> (`- [ ]`). Tre pezzi in sequenza (A → B → C), ciascuno con la propria PR, rilasciabile da solo.
> Nessun task del pezzo N+1 parte prima del merge del pezzo N.

**Goal.** Portare tutto il frontend di WasteFlow sulla direzione B «Libro mastro» con i colori
IgniCraft e il carattere Geist, tema chiaro al primo accesso, Dashboard rifatta con «Da fare oggi», e
correggere i 35 bug grafici della proposta, ciascuno in un task e con un test dove si può.

**Architecture.** I nomi dei token restano (circa 1.500 usi): cambiano i valori in `_tokens.scss`.
Il Task 1, da solo, rifà token, carattere, tema e shell (niente cornice, sidebar sul fondo, nessun h1
nella shell). Il Task 4, da solo, mette nei file globali il pattern delle liste (menu ⋯, lista a due
righe sotto i 640 px, colonne vuote nascoste, nessuna paginazione a zero righe). Dopo, ogni task di
pagina tocca solo i file della sua pagina, quindi le pagine vanno in parallelo.

**Tech Stack.** Angular 17 standalone + PrimeNG 17.18 (base Aura «noir») + PrimeFlex 4 + primeicons
6.0.1; `@fontsource-variable/geist` e `@fontsource-variable/geist-mono` (dipendenze nuove, Task 1);
Karma + Jasmine; Playwright (in CI); skill `design-taste-frontend` (`inspect.mjs --app`, `lint.mjs --app`).

**Spec.** `/home/graziano/Progetti/winwaste/docs/design/giro-2/proposta.md` (fuori dal repository):
palette e mappatura sui token (§1-§2), direzione B (§3), tema (§4), i 35 bug (§5), pagine e stime
(§6). Mockup di riferimento nella stessa cartella: `b-dashboard.html`, `b-dashboard-scuro.html`,
`b-clienti.html`, `b-clienti-scuro.html`, screenshot in `screenshot/b-*` e lo stato di oggi in
`prima/`. Decisioni di Graziano del 05/11 (vincolanti, non si ridiscutono):
**D1** direzione B «Libro mastro»: contorno neutro, arancio solo sul dato principale e sull'azione;
**D2** carattere Geist, come IgniCraft; **D3** tema chiaro al primo accesso, pulsante
Chiaro → Scuro → Sistema, scelta salvata; **D4** stati dei FIR tradotti solo nel frontend, senza
migration; **D5** torna la fascia «Da fare oggi» della Dashboard; **D6** si correggono tutti i 35 bug,
ognuno in un task e con un test quando si può. Seconda tornata, sui dubbi del piano (05/11):
**D7** il bottone primario è l'arancio IgniCraft `#b9440f` (il mockup B non vincola su questo);
l'arancio resta solo sull'azione e sul dato principale; **D8** i riquadri di oggi della Dashboard
(conformità, top 5 produttori e trasportatori, top 10 CER, destinazione, firme, RENTRI, previsione)
**restano**, sotto i blocchi del mockup B, rifatti col tema nuovo e con dati corretti; i bug 5 e 7 si
correggono davvero; per il 7 un task backend separato (nome della ditta oltre alla P. IVA), con test
unit e Postgres, query con `= ANY(ids)`, tenant dalla richiesta, nessuna migration; **D9** i testi
del login del Task 5 sono approvati così; **D10** nella Dashboard gli stati dei FIR sono 5, come
nella lista FIR: «Trasmesso» non è uno stato a sé. Terza tornata, sulla scansione preliminare
(`.superpowers/sdd/2026-11-05-restyle-giro-2/scansione-preliminare.md`, 05/11): **D11** la previsione
del riquadro «Andamento» si corregge nel backend (`predictNextMonthVolume`, Task 2b, senza migration,
con test che fissano il calcolo); **D12** l'arancio va solo sul bottone primario, con un token suo; gli
altri bottoni pieni, i badge, il paginatore e i controlli PrimeNG sono in inchiostro, le tinte di
selezione grigie, anche dove la proposta §2 diceva altro; **D13** il filtro per stato della lista FIR
resta un seguito fuori dal giro 2 (sezione «Seguiti»). Percorsi relativi a `apps/frontend/src/` salvo
`fe/` = `apps/frontend/src/app/`, `e2e/` alla radice e `skill/` =
`/home/graziano/.claude/skills/design-taste-frontend/`.

**Scelte di piano** (P1-P13; solo P10 tocca il backend, nessuna il DB):
- **P1. Geist in self-hosting.** La CSP di `apps/frontend/nginx.conf:79` ammette sia
  `https://fonts.googleapis.com` (style-src) e `https://fonts.gstatic.com` (font-src) sia `'self'`:
  entrambe le strade la rispettano. Si sceglie il self-hosting con `@fontsource-variable/geist` e
  `@fontsource-variable/geist-mono` (licenza OFL) nei `styles` di `angular.json`, col percorso
  `../../node_modules/@fontsource-variable/<nome>/index.css` (dipendenze del workspace nella radice,
  come primeicons e PrimeNG). Il builder è `@angular-devkit/build-angular:browser` (webpack): i
  `.woff2` escono nella **radice** di `dist/frontend` (come `primeicons.<hash>.woff2`), non in `media/`;
  `font-src 'self'` basta. Nessun indirizzo IP dell'utente va a Google
  (GDPR), nessuna dipendenza esterna a runtime. I due `<link>` di Google in `index.html` si tolgono.
  La CSP **non si tocca**: le voci Google restano inutilizzate; toglierle è un seguito su `nginx.conf`
  (riga nel rapporto del Task 3). Il nome di famiglia di fontsource è `"Geist Variable"`.
- **P2. Stati dei FIR (D4).** `GET /dashboard` restituisce le chiavi dell'enum Prisma `FIRStatus`
  (7 valori, `schema.prisma:565`). Il frontend le raggruppa nei 5 `FIRStato` del frontend con la
  **stessa** mappa di `DB_TO_STATO` (`apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts:104-112`):
  `DRAFT`, `AWAITING_PRODUCER` → Bozza; `AWAITING_CARRIER` → Emesso; `AWAITING_RECEIVER` → In
  transito; `COMPLETED`, `SYNCED_TO_RENTRI` → Consegnato; `CANCELLED` → Annullato. Così i conteggi
  della Dashboard coincidono con lo stato che la lista FIR mostra su ogni riga (`DB_TO_STATO`), **non**
  col suo filtro per stato, che usa `STATO_TO_DB` 1:1 e oggi non trova `AWAITING_PRODUCER` né
  `SYNCED_TO_RENTRI` (`fir-prisma.repository.ts:168-169`; seguito fuori dal giro 2, D13). Le celle di
  «FIR del mese» non sono link al filtro. D10: nessuna cella «Trasmesso»; la trasmissione a RENTRI
  resta nel riquadro RENTRI dell'analisi.
- **P3. Shell B.** Niente cornice e niente foglio: sidebar e contenuto sullo stesso fondo
  `--surface-ground`, card bianche da 8 px senza ombra. Sopra i 992 px **non c'è barra in alto**:
  azienda attiva, campanella, pulsante del tema, utente ed «Esci» vanno in fondo alla sidebar (come
  `b-dashboard.html`). Sotto i 992 px resta una barra da 48 px con hamburger, nome della pagina in uno
  `<span>` (non heading) e campanella; il drawer resta `p-sidebar`. Il gutter laterale sta nella
  shell, su `.main__inner` (24 px sopra i 992 px, 20 px fra 576 e 992, 16 px sotto i 576, anche sotto
  i 768), perché le pagine non hanno una radice comune (`.page`, `.pagina`, `.cer-search`, `.titolo`
  delle Pese); `.page` perde il padding laterale e ogni task di pagina toglie quello proprio della
  sua radice. Restano il banner d'impersonificazione e `id="main-content"` sul `<main>`.
- **P4. Voce attiva del menu.** Una sola: la rotta di menu con il prefisso **più lungo per segmenti**
  (`percorso === rotta` oppure `percorso.startsWith(rotta + '/')`), calcolata in una funzione pura. Si
  toglie `routerLinkActive` dalle voci (oggi `/clienti` resta acceso su `/clienti/fatturazione` e
  `isActiveRoute('/contratti')` è vero su `/contratti-clienti`).
- **P5. Blocchi della Dashboard (D5, mockup B).** Titolo «Panoramica» con la risposta del giorno;
  colonna sinistra fissa da 306 px con «Deposito temporaneo» e «FIR recenti»; a destra «Da fare
  oggi», «FIR di <mese> per stato» (striscia divisa a 5 celle) e «Formulari per mese» (12 barre).
  Sotto, a tutta larghezza, la sezione «Analisi dell'azienda» (D8) con i riquadri di oggi rifatti:
  una striscia divisa «Conformità · Firme · RENTRI · Andamento» (conformità con i tre fattori, firme
  completate e tempo medio, FIR sincronizzati e in attesa, mese corrente contro il precedente e
  previsione del prossimo, corretta dal Task 2b, D11; «questo mese» e «il mese scorso» si leggono dalla
  stessa serie di `GET /dashboard/andamento` delle barre, non da `trends.monthOverMonth`, così le copie
  dello stesso dato coincidono), poi «Destinazione» (recupero e smaltimento come barre a rapporto vero, al
  posto della ciambella), «Top 10 codici CER» (barre orizzontali in un solo grigio, codice in mono, kg
  a destra) e «Produttori e trasportatori più frequenti» (due liste da 5: ragione sociale, P. IVA in
  grigio mono, numero di FIR a destra). Niente Chart.js nella Dashboard. L'intestazione della sezione
  dice «Tutti i formulari dell'azienda», perché l'API la calcola su tutti i FIR del tenant, non sul
  mese. I dati: `GET /dashboard/attenzione` (scadenze, formulari da trasmettere, scorta vidimata),
  `GET /dashboard/andamento`, `GET /dashboard` (con `startDate`/`endDate` per il mese, P10),
  `GET /giacenze/deposito-temporaneo`, `GET /fir?page=1&limit=5`. Gli avvisi del deposito entrano anche in «Da
  fare oggi», convertiti nel frontend. La fascia non compare se non ha voci e non c'è errore, come nel
  componente di oggi (comportamento già coperto dal suo spec e citato da `e2e/tests/scadenze/flusso-scadenze.spec.ts:55`).
- **P6. «Formulari per mese» è un SVG del componente**, non Chart.js: mese corrente nell'accento, gli
  altri neutri, media come linea tratteggiata, 12 etichette abbreviate. Chart.js resta per la
  dashboard del consulente, con la tavolozza nuova di `colori-grafici.ts`.
- **P7. Azioni di riga.** Componente condiviso `app-azioni-riga` (Task 4): l'azione principale resta
  un bottone sulla riga (di norma «Modifica», con l'`ariaLabel` di oggi), le altre vanno in un
  `p-menu` a comparsa aperto da un bottone ⋯ con `aria-label="Altre azioni per <nome>"`. Gli e2e usano
  un helper unico (`e2e/utils/azioni-riga.ts`) che clicca il bottone se c'è, altrimenti apre il menu.
- **P8. Numeri in sola lettura** con `DecimalPipe` e `LOCALE_ID` `it-IT` (già registrato in
  `fe/app.config.ts:16,24`): raggruppa anche le 4 cifre («1.240»). Mai `toFixed()` in un template.
  Unità in grigio dopo la cifra («1.240 kg»).
- **P9. Deposito temporaneo in kg**, come l'API (`DepositoRegistro.totaleKg`, `soglie.kgMaxTotale`,
  `totalePericolosiKg`, `soglie.kgMaxPericolosi`), non in m³ come il mockup, e **secondo il criterio
  del registro** (`apps/backend/src/domain/waste-movement/deposito-temporaneo.ts:14-21, 305-308`):
  `TEMPORALE` → solo la durata; `QUANTITATIVO` → le due quantità e la durata sul tetto di un anno;
  `NON_SCELTO` → tutte e tre, con la nota «Criterio non ancora scelto». La durata è `etaGiorni` del CER
  più vecchio contro i giorni da `giornoPiuVecchio` a `scadenza` dello stesso `DepositoCer`, che
  contengono già i tre mesi di legge e l'eventuale `giorniMax` (anche quando `giorniMax` è null, il
  valore predefinito). Con `quantitaParziale` la nota dice «solo i rifiuti in kg».
- **P10. Task backend 2b (D8, D11, bug 7, marcato BACKEND).** Tre modifiche a
  `GET /dashboard`, senza migration (la (c) è descritta nel Task 2b): (a) `top.producers` e `top.carriers` danno anche `nome: string | null`,
  la ragione sociale dello snapshot del FIR più recente con quella P. IVA (`firs.producer_name`,
  `firs.carrier_name`, colonne che esistono già); (b) `status.breakdown` rispetta `startDate`/`endDate`
  su `created_at`. La (b) è una necessità dimostrata: oggi il controller legge l'intervallo ma
  `GetDashboardUseCase.execute` (`apps/backend/src/application/analytics/get-dashboard.use-case.ts:57-70`)
  non lo passa a nessuna query, quindi «FIR di novembre» mostrerebbe i FIR di sempre. Gli altri
  indicatori restano su tutto il tenant (come dice l'intestazione della sezione d'analisi), compresi
  `overview.completedFIRs` e `overview.pendingFIRs`, che oggi derivano da `firsByStatus`
  (`get-dashboard.use-case.ts:78-85`): con l'intervallo `getFIRsByStatus` si chiama due volte (senza,
  per `overview`; con, per `status`). (c) `trends.prediction.nextMonth` diventa una previsione vera sui
  mesi (D11): oggi `predictNextMonthVolume` raggruppa per istante e restituisce quasi sempre 1 o 0. In
  più, date non valide nell'intervallo → 400 invece di un errore di Prisma (`new Date` senza controllo
  in `dashboard.controller.ts:126-132`).
- **P11. Conformità con 0 FIR (bug 5).** Il punteggio di oggi è
  `0,4 × firme + 0,4 × RENTRI + 0,2 × (1 − ritardi)` (`analytics.service.ts:302-307`): con 0 FIR i
  primi due valgono 0 e il terzo 1, quindi esce 20% e «Critica». Il 20% è un artefatto della formula,
  non una misura. Con `overview.totalFIRs === 0` (lo stesso conteggio su tutto il tenant che usa
  `getComplianceScore`) il riquadro mostra «—» in grigio al posto del numero, nessuna pillola di
  livello, e la frase «Si calcola dal primo formulario». Si corregge nel frontend e non nel backend
  perché il contratto dell'API e l'export CSV restano invariati e la regola «un valore che non esiste
  è un trattino» è una regola di presentazione (house rule §11); i tre fattori seguono la stessa
  regola. Con almeno un FIR il numero si mostra com'è, in percentuale it-IT senza decimali.
- **D7 e D12 applicate.** Oggi `--accent-fill` non è solo il primario: `_primeng.scss:53-55` lo
  applica a **ogni** `.p-button` pieno (circa 523 su 552), al paginatore attivo (`:469`), a tutti i
  `.p-badge` (`:622`), a `p-selectButton`, e `_tokens.scss:212-214` ci collega `--primary-color` e
  `--p-primary-color` (checkbox, radio, switch, slider di PrimeNG). Quindi: token nuovi `--ink-fill`
  = `--text-primary` (`#141414` / `#eeece7`), `--on-ink` = `#f3f2ef` / `#131311`, `--ink-fill-hover` =
  `#2b2a27` / `#ffffff`; il `.p-button` pieno di base, il paginatore, `.p-badge`, `p-selectButton`,
  `--primary-color` e `--p-primary-color` passano a `--ink-fill`/`--on-ink`. `--accent-fill` = `#b9440f`
  con `--on-accent` `#ffffff` in chiaro, `#ff8a5c` con `#131311` in scuro, e vale **solo** su
  `.p-button.wf-primario` (classe nuova in `_primeng.scss`). Ogni task di pagina mette
  `styleClass="wf-primario"` sul solo bottone primario della schermata e lo prova nel DOM (al più un
  `.wf-primario` visibile). L'arancio sui dati va solo alla serie principale (il mese corrente), non ai
  grafici dell'analisi, che restano in grigio.
- **P12. Selezione e menu in grigio (D12).** Ci si scosta dalla proposta §2: `--sidebar-active` =
  `--text-primary` (icona della voce attiva e bordo del contatore, `layout.component.ts:888-890,
  918-921`); `--selected` = `#e9e7e2` / `#2c2b27`; `--brand-primary-50` = `#f7f6f3` / `#232320`;
  `--brand-primary-100` = `#e9e7e2` / `#2c2b27`; `--highlight-text-color` = `--text-primary`.
  `--brand-primary-dark` resta l'hover di link e focus; ogni suo uso fuori da link e focus (58 oggi) va
  in una riga del rapporto del Task 1 col numero del task che lo porta a `--text-primary`.
- **P13. Link.** Arancio sui link nel testo e sui link isolati («Vedi tutti i FIR»); i link che fanno
  da identificativo di riga (numero FIR, ragione sociale) restano in inchiostro, sottolineati al
  passaggio e al focus.

## Global Constraints

- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), messaggi in italiano con prefisso
  `feat(stile)`/`fix(stile)`/`test(e2e)`, **nessuna attribuzione AI** (né `Co-Authored-By` né
  `Claude-Session`; la regola di Graziano prevale su ogni suggerimento dell'ambiente). Niente push dai
  task: il push lo fa l'orchestratore all'apertura della PR.
- **Nessuna modifica a backend, DB, migration o `nginx.conf`**, salvo il Task 2b (P10), unico task
  backend, senza migration. Un altro dato che manca all'API non si inventa: si scrive nel rapporto.
- **Task 2b (backend):** tenant sempre da `requireRequestTenantId(req)` (già così in
  `dashboard.controller.ts:124`), filtro esplicito `tenant_id = ${tenantId}::uuid` anche dentro la
  transazione di tenant; liste di valori con `= ANY(${valori}::text[])`, mai `IN` costruito a mano;
  test Postgres col ruolo `wasteflow_app` sul DB `127.0.0.1:55438`, pulizia solo per id esatti
  (`pulisciTenantDiTest` di `apps/backend/src/test-support/legami-di-test.ts`); fine task:
  `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov` una volta,
  `npx tsc --noEmit -p tsconfig.json`, `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` da
  `apps/backend`, la suite Postgres nuova sotto `flock $LOCK`. Mai Karma e jest insieme.
- Testi e commenti in italiano; termini tecnici non tradotti (branch, commit, build, test, token,
  cache, deploy, layout, template, worktree). Etichette in sentence case. Mai id nei testi a schermo.
- **Token.** Solo `var(--…)` nei componenti, mai colori letterali (eccezioni: `colori-grafici.ts`,
  `index.html`, `tema.service.ts`, `assets/tema-iniziale.js`, che non leggono il CSS). Valori: la
  tabella della proposta §2, colonne chiaro e scuro, alla lettera, **salvo** le eccezioni di D7/D12
  («D7 e D12 applicate» e P12: `--accent-fill`, `--ink-fill*`, `--sidebar-active`, `--selected`,
  `--brand-primary-50/-100`, `--highlight-text-color`); per `--sidebar-active-bg` la variante B
  (`#e9e7e2` / `#2c2b27`). In più, per la direzione B: `--tab-line` e `--selected-line`
  = `--text-primary` (scheda attiva sottolineata in inchiostro); `--radius-lg` 8 px; `--frame` =
  `--surface-ground`; `--sheet` trasparente e `--sheet-border` trasparente; `--brand-panel` =
  `#141414` e `--brand-mark` = `#f0602a` in entrambi i temi, al posto di `--brand-panel-from/-mid/-to`
  (li aggiunge il Task 1, li usa il Task 5: nessun colore letterale nei componenti).
- **Arancio (D1, D12):** solo sul dato principale della schermata (una serie, un valore), sul bottone
  primario (`.wf-primario`), sul focus, sui link del testo (P13) e sul segno del marchio. Mai su voci di menu, schede, bordi, sfondi di
  card, KPI fermi. Chrome in inchiostro e grigi.
- **Carattere (D2):** `--font-family` e `--font-display` = `'Geist Variable', 'Geist', system-ui,
  -apple-system, 'Segoe UI', sans-serif`; `--font-family-mono` = `'Geist Mono Variable', 'Geist
  Mono', ui-monospace, monospace`, solo per numeri di FIR, P. IVA, codici e id. Pesi 400, 500, 600.
- **Regole della casa per le schermate di app** (skill `design-taste-frontend`,
  `skill/SKILL.md` e `skill/references/app-screens.md` §2.7, §9, §11, §12, §13, §14), in breve:
  colore su dati, stati e una sola azione; KPI come testo (etichetta 12-14 px sopra il valore 24-30 px
  a 500), mai icone in cerchi o riquadri colorati, mai sparkline; superfici piatte, bordo 1 px **oppure**
  ombra solo su ciò che galleggia (menu, dialog, tooltip); titolo della pagina 24 px/500 (22 px sul
  telefono), un solo h1 per schermata; tabelle con righe da 1 px, intestazioni 12 px grigie in sentence
  case, niente zebra né fasce, cifre a destra in `tabular-nums`, righe da 48 px (56 px solo per le
  liste a due righe sotto i 640 px, app-screens §7.1); pillole di stato 22 px, tinta tenue +
  inchiostro dello stesso tono + parola; zeri stampati come zeri, mancanti come «—» grigio; stati vuoti
  compatti dentro la card che resta; niente paginazione sotto liste da meno di una pagina; niente
  gradienti, glow, emoji, maiuscolo spaziato (al più un'etichetta tracciata per schermata), viola o
  indaco; sul telefono menu ripiegato, controlli alti 44 px, nessuno scroll orizzontale della pagina,
  liste a due righe al posto delle tabelle sotto i 640 px; margini laterali 24 px sopra i 992 px, 20 px
  fra 576 e 992, 16 px sotto i 576. Nessuna animazione d'ingresso.
- **Gate di ogni pagina: `inspect.mjs --app`.** Con lo script `foto.sh` del Task 0, a 1440, 768 e
  390 px, in chiaro **e** in scuro: **0 FAIL**. Ogni WARN si difende in una frase nel rapporto. WARN
  già difesi dalla proposta (§3): `palette-cream` in scuro (è l'inchiostro `#eeece7`) e l'avviso del
  dev server. `lint.mjs --app` sui file toccati: 0 errori. Poi si guardano gli screenshot e si
  risponde per iscritto alle 7 domande di `app-screens.md` §2.7 nel rapporto del task.
- **Screenshot prima/dopo** in `.taste-skill/prima/<task>/` (dal Task 0, o dal primo passo del task
  se la pagina è cambiata dopo) e `.taste-skill/dopo/<task>/`, per ogni pagina del task: chiaro e scuro,
  1440 e 390 (quelli del gate). La cartella è nel `.gitignore` del worktree (`.taste-skill/` si
  aggiunge al Task 0 se manca). Il rapporto elenca i file.
- **Ciclo di verifica di ogni task frontend** (i passi dei task lo citano come «verifica completa»):
  1. Karma **mirato** sugli spec toccati:
     `cd apps/frontend && CHROME_BIN=$HOME/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome flock $LOCK npx ng test --watch=false --browsers=ChromeHeadless --include='<spec>'`;
  2. Karma **completo una volta** a fine task (stesso comando senza `--include`): 0 fallimenti, i
     test rossi già nella linea di base del Task 0 non contano ma si citano;
  3. `npx eslint <file toccati> --max-warnings=0` dalla radice;
  4. `cd apps/frontend && flock $LOCK npm run build` senza errori né nuovi avvisi di budget;
  5. `node skill/scripts/lint.mjs --app <file toccati>`;
  6. gate dell'inspector e screenshot dopo;
  7. e2e toccati dal task, se l'app è accesa in locale (`npx playwright test <spec> --workers=1`);
     altrimenti in CI sulla PR.
  `LOCK=/home/graziano/Progetti/rifiuti-wt-rentri-registro/.superpowers/sdd/2026-11-05-fase4-4-valorizzazione-export/pesante.lock`:
  lo **stesso** lock dei lavori della 4.4, che usano lo stesso DB `127.0.0.1:55438`. Karma, build e
  app accesa per l'inspector passano tutti dal `flock`; mai due processi pesanti insieme.
- **Test «dal template»:** ogni comportamento visibile si prova sul DOM renderizzato
  (`fixture.nativeElement.querySelector…`, testo, attributi `aria-*`, classi), non solo sui metodi
  del componente. Selettori `data-testid` nuovi in kebab-case italiano.
- **e2e: non si rompe niente.** I titoli h1 delle pagine **non cambiano** (gli e2e li cercano con
  `getByRole('heading', { level: 1, name })`): «Impostazioni di fatturazione», «Tabelle di
  fatturazione», «Contratti clienti», «Clienti», «Archivio addebiti», «Da collegare», «Listino del
  contratto <n>». Restano: `aria-label` «Navigazione principale» della nav desktop
  (`e2e/pages/dashboard.page.ts:18`), il bottone «Esci», il bottone «Accedi», i `data-testid`
  `attenzione-fascia`, `attenzione-voce-<chiave>`, `attenzione-azione-<chiave>`,
  `attenzione-voce-verifica-fallita`, `contatore-legami`, `nav-abbonamento`. Restano anche:
  `id="main-content"` sul `<main>` (7 spec); gli `aria-label` dei campi di ricerca «Cerca un
  cliente», «Cerca un contratto», «Cerca un addebito» (`getByRole('searchbox')`); il ruolo `textbox`
  dei campi di ricerca delle anagrafiche (`e2e/pages/registry.page.ts:33`: niente `type="search"`
  senza aggiornare il page object nel Task 11); i bottoni «Agenti», «Tabelle di fatturazione» e
  «Archivio addebiti» su Clienti (`archivio-addebiti.spec.ts:141`); il banner «Stai impersonando… /
  Torna al tuo account» (`impersonation.spec.ts:30`); i link di menu «Clienti» e «Contratti clienti»
  col nome esatto (`contratto-cliente.spec.ts:305, 382`); la voce `attenzione-voce-<chiave>` con
  titolo **e** dettaglio (`flusso-scadenze.spec.ts:286-288` filtra per ragione sociale). Una lista
  senza azioni (VIEWER) non rende né la colonna né l'intestazione «Azioni»
  (`contratto-cliente.spec.ts:576`, `archivio-addebiti.spec.ts:446`). Le righe e2e da
  aggiornare sono elencate nei task che le toccano (tabella «e2e da aggiornare» in fondo).
- **App accesa per l'inspector:** come la proposta §8. Redis usa e getta `rifiuti-stile2-redis`,
  backend su 3000 contro `127.0.0.1:55438` **senza** migration, `ng serve` su 4200, tutto sotto
  `flock $LOCK`; a fine giro porte libere, processi chiusi, Redis rimosso.
- **Dati per le foto:** solo sull'azienda di prova del Task 0 (`creaAziendaDiTest`), mai su «Azienda
  Test SRL»; pulizia solo per gli id annotati in `ids-foto.json`.
- Rapporti in `.superpowers/sdd/2026-11-05-restyle-giro-2/` (`base.md`, `task-<n>.md`,
  `progress.md`); la cartella è ignorata da git.

## Review Focus

Casi che la proposta implica e che nessun test di pagina copre da solo. Ciascuno ha il suo test nel
task indicato.

1. **Primo accesso con il sistema in scuro.** Profilo senza `wf_tema` e `prefers-color-scheme: dark`:
   la pagina parte chiara **già prima** che Angular giri (nessun lampo scuro), `data-theme="light"`,
   `tema-primeng-chiaro.css`, `theme-color` `#f3f2ef`. Con `wf_tema = 'sistema'` salvato e sistema
   scuro: parte scura, e dopo una ricarica resta «Sistema» → Task 1 (spec del servizio e controllo
   con l'inspector su profilo vuoto con `--force-dark-mode`).
2. **Valori di `wf_tema` lasciati dal giro 1:** chi aveva `'chiaro'` o `'scuro'` non vede cambiamenti;
   un valore sconosciuto (`'auto'`, stringa vuota) vale chiaro e non rompe il ciclo del pulsante;
   storage bloccato: chiaro, nessuna eccezione → Task 1.
3. **Chiavi di stato FIR sconosciute o assenti** nel `breakdown` (un valore nuovo dell'enum, un oggetto
   vuoto, un conteggio a zero): le cinque celle stampano «0», la chiave ignota non entra in nessuna
   cella né produce `undefined`, il totale nell'intestazione è la somma delle cinque celle → Task 2.
4. **Una rotta senza voce di menu** (`/notifications`, `/permissions/denied`, `/fir/<id>`,
   `/contratti-clienti/<id>/listino`, `/giacenze/abbinamenti`, `/rentri/sedi`, `/rentri/formulari`,
   `/rentri/modalita-legame`, `/rentri/diagnostica`, `/permissions/consultant-dashboard`): titolo della barra corretto e al più
   una voce accesa, mai «WasteFlow» su una pagina nota → Task 1.
5. **Righe con nomi lunghi e zero righe** nelle liste: ragione sociale da 80 caratteri a 390 px non
   allarga la pagina (nessuno scroll orizzontale), il menu ⋯ resta raggiungibile da tastiera (Invio
   apre, Esc chiude e rimette il focus sul ⋯), con 0 righe nessun paginatore → Task 4 (sul componente
   condiviso) e Task 6 (su Clienti).

---

## Mappa dei file

**Globali (solo i task indicati li toccano):**
- `styles/_tokens.scss`, `styles.scss`, `index.html`, `assets/tema-iniziale.js`, `angular.json`,
  `apps/frontend/package.json` (+ lock), `fe/core/services/tema.service.ts` (+ spec),
  `fe/shared/utils/colori-grafici.ts` (+ spec), `fe/shared/components/layout.component.ts` (+ spec)
  → **solo Task 1**.
- `styles/_primeng.scss`, `styles/_pagine.scss` → **Task 1** (adeguamenti ai token, `.wf-primario`,
  `--ink-fill`) e **Task 4** (pattern delle liste), e al ripasso il **Task 16**. Nessun task di pagina li tocca: un bisogno globale emerso dopo va nel
  rapporto e lo applica il Task 16.

**Nuovi:**
- `fe/shared/components/navigazione-shell.ts` (+ spec), `fe/shared/components/segno-marchio.component.ts` (Task 1);
- `fe/shared/models/stati-fir.ts` (+ spec); `fe/features/dashboard/dashboard-page/{da-fare-oggi,deposito-sintesi,fir-recenti,fir-mese-stati,barre-mensili,analisi-sintesi,barre-orizzontali,classifica-ditte}.component.ts` (+ spec), `dashboard-page.component.spec.ts`, `fe/features/dashboard/dashboard-page/dashboard-dati.ts` (+ spec) (Task 2);
- backend: `apps/backend/src/application/analytics/analytics-dashboard.postgres.spec.ts` e `get-dashboard.use-case.spec.ts` (Task 2b; modifica anche `analytics.service.ts`, `get-dashboard.use-case.ts` e `api/dashboard/dashboard.controller.ts`, solo questo task);
- `fe/shared/components/azioni-riga.component.ts` (+ spec), `fe/shared/utils/colonne-visibili.ts` (+ spec), `e2e/utils/azioni-riga.ts` (Task 4; il Task 4 modifica anche `fe/shared/components/skeleton-loader.component.ts`);
- spec che oggi non esistono e si **creano** nei task indicati: `fe/features/auth/login.component.spec.ts`, `fe/features/auth/signup/signup.component.spec.ts` (5); `fe/features/cer/cer-search.component.spec.ts` (9); `fe/features/listino/elenchi-pannello.component.spec.ts` (7); `fe/features/{esg/esg,anomaly/anomaly,pese/pese}.component.spec.ts`, `fe/features/pese/pese-stili.spec.ts` (13); `fe/core/services/toast.service.spec.ts`, `fe/core/interceptors/error.interceptor.spec.ts` (14); `fe/core/guards/super-admin.guard.spec.ts`, `fe/features/permissions/pipes/role-description.pipe.spec.ts`, `fe/features/permissions/pages/permission-discovery/permission-discovery.component.spec.ts`, `fe/features/notifications/notifications-page/notifications-page.component.spec.ts` (15); `fe/features/registro/registro.component.stile.spec.ts` (16: il registro ha spec divisi `registro.component.{causali,rentri,sede}.spec.ts`);
- `.superpowers/sdd/2026-11-05-restyle-giro-2/{foto.sh,dati-foto.ts,ids-foto.json}` (Task 0, non committati).

**Cancellati:** `fe/features/dashboard/dashboard.component.ts` e `dashboard.component.spec.ts`
(Task 2, componente morto: non è in `app.routes.ts`).

---

## Task 0: ambiente e linea di base

**File:** nessuno nel repository; `.gitignore` solo se manca `.taste-skill/`.

- [ ] **Step 1: ambiente.** Worktree `/home/graziano/Progetti/rifiuti-wt-stile-2`, branch
  `feat/stile-pagine-2` su `origin/master` (`f8155833` o successivo, `git log -1`); container
  `wasteflow-pg-test-registro` acceso su 55438; cartella dei rapporti con `progress.md`; `node -v` 20;
  `ls $HOME/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`. Se `.taste-skill/` non è in
  `.gitignore`, aggiungerlo (commit `chore: .taste-skill nel gitignore`).
- [ ] **Step 2: dati per le foto.** `dati-foto.ts` (eseguito con `npx tsx` da `e2e/`) crea
  un'azienda con `creaAziendaDiTest('foto-stile-2')` e, via API con gli helper di
  `e2e/utils/legami-api.ts` e `api-client.ts`: 3 produttori, 2 trasportatori, 2 destinatari, 8 FIR in
  almeno 4 stati diversi (uno annullato), 6 movimenti di registro di cui uno su CER pericoloso, 5
  clienti (uno disattivo, uno con ragione sociale di 80 caratteri), 2 contratti clienti con listino,
  1 agente, soglie del deposito tali che un CER sia in preavviso. Scrive ogni id creato in
  `ids-foto.json`. Se un'API rifiuta un dato, il rapporto lo dice e la foto resta senza quel dato.
- [ ] **Step 3: `foto.sh <task> <nome> <percorso> [prima|dopo]`.** Prepara due profili Chromium
  usa e getta (chiaro: `wf_tema='chiaro'`; scuro: `wf_tema='scuro'`) con i token dell'ADMIN
  dell'azienda di prova nelle chiavi di `fe/core/services/auth.service.ts` (`accessToken`,
  `refreshToken` e quelle dell'utente corrente), e lancia per ciascuno
  `CHROME_PATH=<wrapper col profilo> node skill/scripts/inspect.mjs --app http://localhost:4200<percorso> --out .taste-skill/<prima|dopo>/<task>/<nome>-<tema>`
  (stesso metodo della proposta §8). Stampa per tema il riepilogo FAIL/WARN.
- [ ] **Step 4: linea di base** sotto `flock $LOCK`: Karma completo una volta (test rossi in
  `base.md`), `npm run build` (avvisi di budget annotati), e `foto.sh 0 <pagina> <percorso> prima`
  per le pagine di tutti i task (elenco nei task); FAIL e WARN di oggi in `base.md` accanto a quelli
  della proposta §5. Annotare che `e2e/tests/scadenze/flusso-scadenze.spec.ts` (passo 4) oggi non può
  passare: cerca la fascia nel componente non instradato.

---

# Pezzo A (PR 1) — token, carattere, tema, shell, Dashboard e task backend 2b

## Task 1: token IgniCraft, Geist, tema chiaro e shell B (da solo)

Bug **4, 11, 12, 13, 14, 15, 16, 17, 18**. Proposta §2, §4, §6 riga 1.

**Files:**
- Modify: `styles/_tokens.scss` (anche `--ink-fill*`, `--brand-panel`, `--brand-mark`, P12),
  `styles/_primeng.scss` (schede con riga in inchiostro, tag e toast sulle coppie nuove, `.wf-primario`,
  bottoni pieni/paginatore/badge/selectButton in `--ink-fill`, nessun colore letterale salvia rimasto),
  `styles/_pagine.scss` (solo adeguamenti ai token),
  `styles.scss` (testata, `.page` senza padding laterale, `h1` 24/500), `index.html`,
  `assets/tema-iniziale.js`, `angular.json`, `apps/frontend/package.json` (+ `package-lock.json` della
  radice), `fe/core/services/tema.service.ts` (+ spec), `fe/shared/utils/colori-grafici.ts` (+ spec),
  `fe/shared/components/layout.component.ts` (+ spec)
- Create: `fe/shared/components/navigazione-shell.ts` (+ `navigazione-shell.spec.ts`),
  `fe/shared/components/segno-marchio.component.ts`

**Interfaces:**
- Produces:
```ts
// tema.service.ts
export type PreferenzaTema = 'sistema' | 'chiaro' | 'scuro'          // invariato
export function leggiPreferenzaTema(valore: string | null): PreferenzaTema   // null o ignoto → 'chiaro'; 'sistema' resta 'sistema'
export function prossimaPreferenzaTema(p: PreferenzaTema): PreferenzaTema    // chiaro → scuro → sistema → chiaro
export function etichettaPreferenzaTema(p: PreferenzaTema): 'Chiaro' | 'Scuro' | 'Sistema'
// COLORE_BARRA: { chiaro: '#f3f2ef', scuro: '#131311' }; scriviStorage salva sempre (anche 'sistema')
// colori-grafici.ts — stessa interfaccia ColoriGrafico
// chiaro: testo '#6b6964', griglia '#eeece8', primario '#b9440f', fondo '#ffffff', info '#504e4a',
//         successo '#1d5a35', attenzione '#6b4b00', pericolo '#b91c1c', neutro '#d3d0c9'
// scuro:  testo '#96938c', griglia '#2c2b27', primario '#ff8a5c', fondo '#1d1d1a', info '#bdbab3',
//         successo '#c4ecd2', attenzione '#ffe9a8', pericolo '#f87171', neutro '#4a4843'
// navigazione-shell.ts
export interface VoceShell { label: string; route: string }
export function rottaVoceAttiva(percorso: string, rotte: readonly string[]): string | null
export function titoloShell(percorso: string, voci: readonly VoceShell[]): string
export const TITOLI_FUORI_MENU: readonly VoceShell[]   // /notifications → 'Notifiche', /permissions/denied → 'Accesso non consentito' (come il suo h1), /permissions/consultant-dashboard → 'Dashboard consulente', /permissions → 'Permessi', /rentri → 'RENTRI', /fir → 'FIR', /giacenze → 'Giacenze' (/legal sta fuori dalla shell: nessuna voce)
// segno-marchio.component.ts: <app-segno-marchio [dimensione]="26" />, SVG inline con fill var(--brand-primary-light), aria-hidden
```
`percorso` è `location.pathname` senza query né frammento. `titoloShell` cerca prima nelle voci di
menu con `rottaVoceAttiva`, poi in `TITOLI_FUORI_MENU` con la stessa regola, e solo alla fine
restituisce `'WasteFlow'`.

- [ ] **Step 1: foto prima** delle pagine `dashboard`, `clienti`, `clienti/fatturazione`,
  `notifications`, `permissions/my-permissions`, `fir` (dal Task 0).
- [ ] **Step 2: test che falliscono.**
  - `tema.service.spec.ts`: `leggiPreferenzaTema(null)`, `('')`, `('auto')` → `'chiaro'`;
    `('sistema')` → `'sistema'`; `prossimaPreferenzaTema`: `chiaro→scuro→sistema→chiaro`;
    `imposta('sistema')` scrive `'sistema'` in `wf_tema` (non lo cancella); senza preferenza e media
    scura: `effettivo() === 'chiaro'`, `data-theme="light"`, href `tema-primeng-chiaro.css`; meta
    `theme-color` `'#f3f2ef'` in chiaro e `'#131311'` in scuro; storage che lancia → `'chiaro'`, nessuna
    eccezione; `etichettaPreferenzaTema` per i tre valori; con **due** `meta[name="theme-color"]` nel
    documento di test (come `index.html:8-9`), tutti e due `#f3f2ef` in chiaro e `#131311` in scuro
    (bug 18: oggi si aggiorna solo il primo). Si aggiornano i test di oggi sul default «sistema»
    (righe 43-44, 84, 123-127).
  - `navigazione-shell.spec.ts`: `rottaVoceAttiva('/clienti/fatturazione', ['/clienti', '/clienti/fatturazione'])`
    → `'/clienti/fatturazione'`; `('/contratti-clienti/42/listino', ['/contratti', '/contratti-clienti'])`
    → `'/contratti-clienti'`; `('/clienti', ['/clienti'])` → `'/clienti'`; `('/clientiX', ['/clienti'])`
    → `null`; `titoloShell('/notifications', voci)` → `'Notifiche'`; `('/permissions/my-permissions')`
    → `'Permessi'`; `('/permissions/denied')` → `'Accesso non consentito'`; `('/fir/abc')` → `'FIR'`;
    `('/rentri/formulari')` → `'RENTRI'`; `('/permissions/consultant-dashboard')` → `'Dashboard consulente'`;
    `('/nulla')` → `'WasteFlow'`.
  - `layout.component.spec.ts` (DOM): nessun `h1` nel template della shell; la voce «Registro C/S»
    ha `pi pi-book`; con percorso `/clienti/fatturazione` c'è **una** `.nav-item--active` («Fatturazione
    da») e un solo `aria-current="page"`; la voce attiva non ha la barra a sinistra (oggi è un
    `::before`, righe 908-917: si verifica `getComputedStyle(voce, '::before').content === 'none'`);
    l'icona della voce attiva non ha il colore di `--brand-primary`; il pulsante del tema mostra «Tema:
    Chiaro» e dopo un clic «Tema: Scuro», poi «Tema: Sistema», con `aria-label` che comincia col testo
    visibile («Tema: Chiaro. Passa a scuro», WCAG 2.5.3); la nav desktop ha
    `aria-label="Navigazione principale"`; «Esci» presente in fondo alla sidebar; `<main id="main-content">`
    e il banner d'impersonificazione presenti; `.main__inner` ha `padding-left` 24 px (il test imposta
    la larghezza dell'host; 20 e 16 px si verificano con l'inspector).
  - stile dei bottoni (in `layout.component.spec.ts`, blocco «token»): un
    `p-button` senza classe ha `background-color` uguale a `--ink-fill`, uno con `styleClass="wf-primario"`
    uguale a `--accent-fill`.
  - `colori-grafici.spec.ts`: i valori dell'interfaccia sopra, nessun `#0f766e` né `#1d4ed8`.
- [ ] **Step 3: run** Karma mirato sui quattro spec → FAIL.
- [ ] **Step 4: implementa.**
  - Carattere: `npm i -w @wasteflow/frontend @fontsource-variable/geist @fontsource-variable/geist-mono`
    (versioni esatte fissate, nessun `^` cambiato altrove); in `angular.json` → `build.options.styles`
    `"../../node_modules/@fontsource-variable/geist/index.css"` e
    `"../../node_modules/@fontsource-variable/geist-mono/index.css"` **prima** di `src/styles.scss`; via
    da `index.html` i tre `<link>` di Google (righe 10-12).
  - Token: valori della proposta §2 e dei Global Constraints, con le eccezioni di D7/D12 (P12);
    commento di testata «Libro mastro, colori IgniCraft (giro 2)». Il blocco scuro resta su
    `:root[data-theme='dark']` dentro `@media screen`. Poi
    `grep -rn "brand-primary-dark" apps/frontend/src/app`: nel rapporto una riga per ogni uso fuori da
    link e focus, col numero del task che lo porta a `--text-primary`.
  - Tema: le funzioni dell'interfaccia; `applica()` aggiorna **tutti** i `meta[name="theme-color"]`;
    `tema-iniziale.js` applica lo scuro solo con `wf_tema === 'scuro'` oppure `'sistema'` e `matchMedia`
    scuro, e scrive lo stesso colore in tutti i meta; `index.html` `theme-color` `#f3f2ef` (light) e
    `#131311` (dark).
  - Shell (P3, P4): fondo unico, `.main` senza bordo, raggio né margini del foglio; voci a 32 px con
    raggio 8 px, attiva = `--sidebar-active-bg` + `--sidebar-ink-strong` + peso 500, nessuna barra a
    sinistra (via le righe 907-916); `[class.nav-item--active]` e `aria-current` da
    `rottaVoceAttiva(percorso, tutteLeRotte)` aggiornato su `NavigationEnd`; via `routerLinkActive`
    e `isActiveRoute`; titolo da `titoloShell`; marchio con `<app-segno-marchio>` + «WasteFlow»;
    in fondo alla sidebar: azienda attiva, campanella, `<button class="tema">Tema: {{ etichetta }}</button>`
    con `aria-label` che dice anche la prossima scelta, utente con iniziali e «Esci»; sotto i 992 px
    barra da 48 px con `<span class="topbar__title">`; `pi pi-clipboard` → `pi pi-book`.
  - Gutter (bug 16, P3): `.main__inner` con padding laterale 24/20/16 px ai tre intervalli (via il
    `padding: 0` sotto i 768, righe 1180-1182); `.page` senza padding laterale. Nel rapporto l'elenco
    dei componenti col padding proprio sulla radice (`.pagina` ×5, `.cer-search`, `.titolo` delle Pese,
    …) e il task che lo toglie.
- [ ] **Step 5: run** Karma mirato → PASS.
- [ ] **Step 6: carattere davvero caricato.** Nel build:
  `ls apps/frontend/dist/frontend/geist-*.woff2 apps/frontend/dist/frontend/geist-mono-*.woff2` non
  vuoto (il builder webpack li mette nella radice di `dist/frontend`, non in `media/`);
  `grep -c fonts.googleapis apps/frontend/src/index.html` → 0; nell'app accesa
  `await document.fonts.load('500 14px "Geist Variable"')` restituisce almeno un `FontFace`,
  `[...document.fonts].some(f => f.family.replace(/"/g, '') === 'Geist Variable' && f.status === 'loaded')`
  è `true` (`document.fonts.check` non basta: è vero anche per una famiglia senza `@font-face`) e
  `getComputedStyle(document.body).fontFamily` comincia con `"Geist Variable"`.
- [ ] **Step 7: Review Focus 1-2 a mano.** Profilo vuoto con `--force-dark-mode`: parte chiaro, nessun
  lampo; `wf_tema='sistema'` + scuro: parte scuro; screenshot in `.taste-skill/dopo/1/primo-accesso/`.
- [ ] **Step 8: verifica completa** e gate dell'inspector su Dashboard (vecchia, ma nella shell nuova),
  Clienti, Fatturazione da, Notifiche, FIR. La shell deve dare 0 FAIL; i FAIL che restano dentro il
  contenuto delle pagine si annotano col numero di task che li chiude.
- [ ] **Step 9: commit** `feat(stile): token IgniCraft, Geist in self-hosting, tema chiaro predefinito e shell Libro mastro`.

## Task 2: Dashboard «Panoramica»

Bug **1, 2, 3, 4** (sulla Dashboard), **5, 6, 7, 8, 9, 10**. Proposta §3 (B), §6 riga 2. Mockup
`b-dashboard.html` per i blocchi in alto; i riquadri dell'analisi (D8, P5) seguono le stesse regole.
Si scrive in parallelo al Task 2b dalle sue interfacce.

**Files:**
- Modify: `fe/features/dashboard/dashboard-page/dashboard-page.component.ts` (riscritto),
  `fe/features/fir/fir-list.component.ts` (solo: query param `nuovo=1` apre il dialog «Nuovo FIR», solo
  se `puoCreareFir()`, e si toglie dall'URL, come `modifica` alle righe 1482 e 1922) (+ spec esistente),
  `e2e/tests/scadenze/flusso-scadenze.spec.ts` (solo il commento della riga 63, che cita lo spec
  cancellato: diventa `da-fare-oggi.component.spec.ts`)
- Create: `fe/shared/models/stati-fir.ts` (+ spec), `fe/features/dashboard/dashboard-page/dashboard-dati.ts`
  (+ spec), `da-fare-oggi.component.ts`, `deposito-sintesi.component.ts`, `fir-recenti.component.ts`,
  `fir-mese-stati.component.ts`, `barre-mensili.component.ts`, `analisi-sintesi.component.ts`,
  `barre-orizzontali.component.ts`, `classifica-ditte.component.ts` (+ uno spec ciascuno),
  `dashboard-page.component.spec.ts`
- Modify: `fe/core/services/dashboard.service.ts` (tipo `DashboardData.top`: `nome: string | null`
  accanto a `partitaIva`, e `trends.prediction.nextMonth: number | null`, copiati **alla lettera**
  dalle interfacce del Task 2b)
- Delete: `fe/features/dashboard/dashboard.component.ts`, `dashboard.component.spec.ts` (i suoi test
  sulla fascia si riportano in `da-fare-oggi.component.spec.ts`)

**Interfaces:**
- Consumes: `AttenzioneService.getAttenzione()`, `AndamentoService.getAndamento()`,
  `DashboardService.getDashboard({ startDate, endDate })`, `GiacenzeService.getDepositoTemporaneo()`,
  `FirService.getFIRList(1, 5)`, `puoCreareFir(role)` (`fe/features/fir/fir-permissions.ts:21`),
  `FeatureFlagsService.has('fir' | 'giacenze' | 'registro')`; dal Task 2b `top.producers[i].nome`,
  `top.carriers[i].nome` e `status.breakdown` limitato all'intervallo. `coloriGrafico` non serve più qui.
- Produces:
```ts
// shared/models/stati-fir.ts
export const STATO_FIR_DA_DB: Readonly<Record<string, FIRStato>>            // P2, 7 chiavi
export const ETICHETTE_STATO_FIR: Readonly<Record<FIRStato, string>>        // Bozza, Emesso, In transito, Consegnato, Annullato
export type TonoStato = 'ok' | 'warn' | 'err' | 'none' | 'todo'
export const TONO_STATO_FIR: Readonly<Record<FIRStato, TonoStato>>          // BOZZA none, EMESSO todo, IN_TRANSITO warn, CONSEGNATO ok, ANNULLATO none
export function contaPerStatoFir(breakdown: Readonly<Record<string, number>> | null | undefined): Record<FIRStato, number>
// dashboard-dati.ts
export function intervalloMeseCorrente(oggi: Date): { startDate: Date; endDate: Date }   // 1° del mese 00:00 locali → oggi
export function vociDaDeposito(vista: DepositoTemporaneoVista): VoceAttenzione[]
//   chiave `deposito-${tipo.toLowerCase().replace('_', '-')}`, SUPERATO → 'critico', PREAVVISO → 'avviso',
//   titolo = messaggio, dettaglio = registroDescrizione, azione { etichetta: 'Vedi le giacenze', rotta: '/giacenze' }
export function unisciVoci(attenzione: VoceAttenzione[], deposito: VoceAttenzione[]): VoceAttenzione[]  // ordinate per gravità, critici primi, ordine stabile
export function rispostaDelGiorno(voci: readonly VoceAttenzione[]): string
//   0 → 'Nessuna scadenza da seguire oggi'; 1 → '1 cosa da fare oggi'; n → 'n cose da fare oggi', + ', 1 urgente' / ', k urgenti' se ci sono critici
export interface BarraDeposito { etichetta: string; valore: number; limite: number; unita: 'kg' | 'giorni'; allarme: boolean; nota: string | null }
export function barreDeposito(r: DepositoRegistro): BarraDeposito[]
//   secondo r.soglie.criterio (P9): TEMPORALE → solo «Giacenza più vecchia»; QUANTITATIVO → Pericolosi
//   (totalePericolosiKg / kgMaxPericolosi), Totale (totaleKg / kgMaxTotale) e «Giacenza più vecchia» sul tetto
//   annuale; NON_SCELTO → tutte e tre, nota «Criterio non ancora scelto». Durata: valore = etaGiorni del CER più
//   vecchio, limite = giorni da giornoPiuVecchio a scadenza dello stesso DepositoCer; nessun CER in giacenza →
//   nessuna barra di durata. allarme se c'è un avviso del tipo corrispondente; nota = cerCode e scadenza della
//   giacenza più vecchia («08 01 11* · entro il 07/11»); con quantitaParziale «solo i rifiuti in kg»
export interface CellaAnalisi { etichetta: string; valore: string; dettaglio: string | null; vuota: boolean }
export function celleAnalisi(d: DashboardData): CellaAnalisi[]
//   4 celle nell'ordine Conformità, Firme, RENTRI, Andamento. Con d.overview.totalFIRs === 0 (P11) tutte
//   hanno valore '—', vuota true; Conformità dettaglio 'Si calcola dal primo formulario', le altre null.
//   Altrimenti: Conformità «82%» + dettaglio «Firme 90% · RENTRI 75% · Ritardi 4%»; Firme «18 di 20» +
//   «Tempo medio 12,5 h» ('—' se averageTimeHours è 0 con 0 firme); RENTRI «15 di 20» + «5 in attesa»;
//   Andamento «41 questo mese» + «32 il mese scorso · previsione 45» (percentuale in parole: «+28% sul mese
//   scorso», «come il mese scorso» se 0, «nuovo» se il precedente è 0). «questo mese» e «il mese scorso» sono
//   gli ultimi due valori di GET /dashboard/andamento (secondo argomento `mesi: AndamentoMensileVoce[]`), non
//   trends.monthOverMonth (M8); previsione da trends.prediction.nextMonth (Task 2b), «—» se null.
//   Percentuali it-IT senza decimali. Firma quindi: celleAnalisi(d: DashboardData, mesi: readonly AndamentoMensileVoce[])
export function livelloConformita(d: DashboardData): { parola: string; tono: TonoStato } | null
//   null con 0 FIR (nessuna pillola); EXCELLENT 'Eccellente' ok, GOOD 'Buona' ok, NEEDS_IMPROVEMENT 'Da migliorare' warn, CRITICAL 'Critica' err
export interface VoceClassifica { nome: string; partitaIva: string; conteggio: number }
export function vociClassifica(top: ReadonlyArray<{ partitaIva: string; nome: string | null; count: number }>): VoceClassifica[]
//   nome null o vuoto → nome = partitaIva (e la P. IVA non si ripete in grigio)
```
Componenti: `<app-da-fare-oggi [voci] [errore] (riprova)>`, `<app-deposito-sintesi [vista]>`,
`<app-fir-recenti [fir]>`, `<app-fir-mese-stati [conteggi] [mese]>`, `<app-barre-mensili [mesi]>`,
`<app-analisi-sintesi [celle] [livello]>`, `<app-barre-orizzontali [voci] [unita] [titolo]>` (voci
`{ etichetta: string; valore: number; mono?: boolean }`, barre a rapporto vero sul massimo, un solo grigio
`--text-secondary`), `<app-classifica-ditte [voci] [titolo]>`.
La pagina carica le cinque sorgenti in parallelo, ognuna con il proprio stato di caricamento ed errore
(un errore di una non spegne le altre); `getDepositoTemporaneo` si chiama solo con `ff.has('giacenze')`
e `getFIRList` solo con `ff.has('fir')`. Caricamento come house rule §11: ogni blocco mostra subito
titolo e cornice, valori sostituiti da barre grigie piatte della loro altezza, nessun «0» provvisorio.
«Da fare oggi» usa `@for (voce of voci; track $index)` (le chiavi si ripetono: `trasportatore-iscrizione`
per ogni trasportatore, `deposito-durata` per CER e registro) e non ha un tetto di righe (l'e2e cerca
la voce per testo). «FIR recenti»: quantità con `rifiuto.unitaMisura` (non sempre kg); una bozza senza
`numeroProgressivo` mostra «Bozza» al posto del numero.

Pagina (P5): h1 «Panoramica»; sotto, «<giorno della settimana> <d> <mese> <aaaa> · <rispostaDelGiorno>»;
azioni «Nuovo FIR» (primario, `<a pButton class="wf-primario" routerLink="/fir" [queryParams]="{ nuovo: 1 }">`:
`p-button` non accetta `routerLink`; solo con `ff.has('fir')` e `puoCreareFir`) ed «Esporta CSV» (bottone
di testo, sul telefono nel menu ⋯ della riga del titolo, app-screens §12). Griglia a due colonne sopra i
1200 px: sinistra 306 px `position: sticky` con deposito (solo con `ff.has('giacenze')`) e FIR recenti
(solo con `ff.has('fir')`); destra Da fare oggi, FIR del mese, Formulari per mese. Sotto i 1200 px una
colonna nell'ordine Da fare oggi, FIR del mese, Deposito, Formulari per mese, FIR recenti. Sotto,
la sezione «Analisi dell'azienda» (h2, meta «Tutti i formulari dell'azienda»): la striscia di
`analisi-sintesi`, poi Destinazione e Top 10 CER affiancati sopra i 992 px, poi le due classifiche
affiancate. Un riquadro senza dati resta con la sua cornice e una riga di testo («Nessun formulario
registrato»), mai un'icona grande (bug 8).

- [ ] **Step 1: foto prima** `dashboard` chiaro e scuro (azienda di prova e «Azienda Test SRL» senza FIR).
- [ ] **Step 2: test che falliscono.**
  - `stati-fir.spec.ts`: `contaPerStatoFir({ DRAFT: 2, AWAITING_PRODUCER: 1, AWAITING_CARRIER: 4, AWAITING_RECEIVER: 9, COMPLETED: 20, SYNCED_TO_RENTRI: 1, CANCELLED: 1 })`
    → `{ BOZZA: 3, EMESSO: 4, IN_TRANSITO: 9, CONSEGNATO: 21, ANNULLATO: 1 }`; `({})`, `(null)` → tutti 0;
    `({ NUOVO_STATO: 5, DRAFT: 1 })` → BOZZA 1, somma 1 (Review Focus 3); ogni `FIRStato` ha etichetta e
    tono; `STATO_FIR_DA_DB` coincide con le 7 coppie di P2 (guardia: cambiarla è una decisione).
  - `dashboard-dati.spec.ts`: `intervalloMeseCorrente(new Date(2026, 10, 5, 9, 20))` → dal 1/11 00:00
    al 5/11 09:20; `vociDaDeposito` con un avviso `DURATA` `SUPERATO` e uno `QUANTITA_TOTALE`
    `PREAVVISO` → due voci `critico` e `avviso` con chiavi `deposito-durata`, `deposito-quantita-totale`;
    `unisciVoci` mette i critici primi e a parità tiene l'ordine; `rispostaDelGiorno` per 0, 1, 4 voci
    con 1 critico («4 cose da fare oggi, 1 urgente») e 4 voci con 2 critici («…, 2 urgenti»);
    `barreDeposito`: un caso per criterio (TEMPORALE → una barra di durata; QUANTITATIVO → tre, durata sul
    tetto annuale; NON_SCELTO → tre con la nota); `giorniMax: null` con una giacenza di 89 giorni su 92 →
    barra «89 di 92»; valori 6400/10000 → `valore 6400, limite 10000`; nessun CER → nessuna barra di durata.
  - `da-fare-oggi.component.spec.ts` (DOM, riportati dal vecchio spec): con voci → `[data-testid=attenzione-fascia]`
    con titolo «Da fare oggi», una `li` per voce con `data-testid="attenzione-voce-<chiave>"`, pillola
    con la parola della gravità («Urgente», «In scadenza», «Da sapere») sulla coppia `err`/`warn`/`none`,
    bottone `attenzione-azione-<chiave>` con `routerLink` della voce; ogni `li` contiene titolo e
    dettaglio; due voci con la stessa chiave → due `li` con lo stesso `data-testid`; 12 voci → 12 `li`
    (nessun tetto); senza voci e senza errore → nessuna fascia; con errore → voce
    `attenzione-voce-verifica-fallita` e «Riprova» che emette `riprova`.
  - `fir-mese-stati.component.spec.ts`: titolo «FIR di novembre · 41»; cinque celle nell'ordine Bozza,
    Emesso, In transito, Consegnato, Annullato con le cifre `4, 6, 9, 21, 1`; zero stampato «0»; ogni
    cella ha il pallino del suo tono (classe `tono-<tono>`), **non** un colore per posizione (bug 3:
    con l'ordine delle chiavi del breakdown rimescolato i colori non cambiano).
  - `barre-mensili.component.spec.ts`: 12 `rect` con `data-mese`; l'ultimo ha la classe `barra--corrente`
    (riempita con `var(--brand-primary)`), gli altri `barra`; con i mesi da `2025-12` a `2026-11`
    12 etichette «dic», «gen», … «nov», ricavate dal campo `mese` e mai dalla data di oggi; linea
    della media con `aria-label="Media 137 al mese"` per `[…]` che somma 1.647; tutti zero → testo
    «Nessun formulario negli ultimi dodici mesi» con `data-testid="andamento-vuoto"` e la linea di base;
    tabella `sr-only` `andamento-tabella-testuale` con 12 righe.
  - `deposito-sintesi.component.spec.ts`: tre barre con `aria-valuenow`/`aria-valuemax`, larghezza
    `64%` per 6400 su 10000; testo «6.400 di 10.000 kg» (P8, separatore delle migliaia); barra in allarme
    con classe `barra--allarme` e la nota; nessun registro → «Nessun deposito da controllare» dentro la card.
  - `fir-recenti.component.spec.ts`: 5 righe su due linee (numero FIR in mono e pillola di stato;
    CER, produttore, «1.240 kg», data); quantità mancante → «—»; 0 FIR → «Nessun FIR registrato» e
    il link «Nuovo FIR» se permesso, nessun paginatore; link «Vedi tutti i FIR» → `/fir`; un FIR in litri
    → «1.240 l»; una bozza senza numero → «Bozza»; il numero di riga in inchiostro (P13).
  - `dashboard-dati.spec.ts`, analisi: `celleAnalisi` con `totalFIRs: 0` e `compliance.score: 0.2`,
    `level: 'CRITICAL'` → quattro celle `'—'`, nessun «20%», `livelloConformita` → `null` (bug 5);
    con 20 FIR e `score 0.82` → «82%» e «Buona»; Andamento con i mesi `[…, 32, 41]` → «41 questo mese» e
    «32 il mese scorso» anche se `trends.monthOverMonth` dice altro; `prediction.nextMonth: null` →
    «previsione —»; firme `averageTimeHours: 12.5` → «Tempo medio 12,5 h»
    (bug 6); `vociClassifica([{ partitaIva: '01234567890', nome: 'Acciaierie Valdelsa S.p.A.', count: 12 }, { partitaIva: '09876543210', nome: null, count: 3 }])`
    → nome della ditta nel primo, P. IVA come nome nel secondo (bug 7).
  - `analisi-sintesi.component.spec.ts`, `barre-orizzontali.component.spec.ts`, `classifica-ditte.component.spec.ts`
    (DOM): quattro celle in un solo contenitore diviso, nessuna icona; cella vuota con «—» in
    `--text-tertiary` e senza pillola; barre con larghezza `valore / massimo` (12.400 su 31.000 kg →
    `40%`), testo «12.400 kg», codice CER in mono, un solo colore di riempimento per tutte le barre
    (nessun `#0f766e`, `#1d4ed8`: bug 4); destinazione con «Recupero» e «Smaltimento» e le loro
    quantità, nessun `canvas`; classifica con ragione sociale in testa, P. IVA in grigio mono sotto,
    conteggio a destra, rango «1.»-«5.» come testo senza cerchio colorato.
  - `dashboard-page.component.spec.ts` (DOM, servizi finti): un solo `h1` «Panoramica»; il sottotitolo
    contiene `rispostaDelGiorno`; «Nuovo FIR» presente per ADMIN con `fir`, assente per VIEWER; la
    sezione «Analisi dell'azienda» presente con i suoi sei riquadri; nessun testo «0.0», «0h», nessuna
    chiave inglese (`COMPLETED`, `DRAFT`, `AWAITING_`, `EXCELLENT`, `CRITICAL`) nel DOM e nessun
    `canvas` (bug 1, 4, 6); con 0 FIR nessun «20%» né «Critica» (bug 5); getDashboard chiamato una
    volta con l'intervallo del mese; errore di `getAndamento` → solo
    il blocco dei mesi mostra l'errore; nessuna card alta più di quanto serve: gli stati vuoti sono
    righe di testo, non `.empty-state` con l'icona da 3rem (bug 8); un solo `.wf-primario` («Nuovo
    FIR»); Andamento «questo mese» = valore dell'ultima barra dei mesi (M8); durante il caricamento ogni
    blocco ha titolo e cornice e nessun «0»; con `ff.has('giacenze')` falso `getDepositoTemporaneo` non
    viene chiamato.
  - `fir-list.component.spec.ts`: con `?nuovo=1` il dialog «Nuovo FIR» è aperto e il parametro sparisce.
- [ ] **Step 3: run** Karma mirato → FAIL.
- [ ] **Step 4: implementa** (stili nei componenti, solo token); cancella il componente morto; nessun
  `toFixed`, `DecimalPipe` con `'1.0-0'`; pillole e barre come in `b-dashboard.html`.
- [ ] **Step 5: run** Karma mirato → PASS.
- [ ] **Step 6: verifica completa**, gate dell'inspector su `/dashboard` con l'azienda di prova e con
  un'azienda senza FIR; risposte alle 7 domande di §2.7 (in particolare la 4: 4 + 6 + 9 + 21 + 1 = totale
  dell'intestazione, la somma dei 12 mesi e la media; il totale di «FIR del mese» può differire
  dall'ultima barra per i FIR creati fra le 00:00 e le 01:00 italiane del primo giorno, perché
  l'andamento conta in mesi UTC: il rapporto lo dice). Nel rapporto anche una frase che difende Geist
  su fondo chiaro con card bianche (tell «the kit's own face» di app-screens §14: lo compensano
  l'arancio sul mese corrente e il deposito temporaneo) e una che cita D7 contro «primary near-black»
  (§4.3, §8.3); e i limiti dei dati che il giro 2 non corregge: `averageTimeHours` arrotondato
  all'ora, totali delle firme che contano anche bozze e annullati, RENTRI che conta solo `COMPLETED`.
  e2e: `flusso-scadenze.spec.ts` (passo 4 torna verde; cambia solo il commento della riga 63);
  `e2e/pages/dashboard.page.ts` invariato.
- [ ] **Step 7: commit** `feat(stile): Dashboard Panoramica con Da fare oggi, deposito temporaneo, FIR del mese, formulari per mese e analisi dell'azienda`.

## Task 2b — BACKEND: nome della ditta nei più frequenti, stati nel periodo e previsione (`GET /dashboard`)

Bug **7** (dato), la parte dati di «FIR di <mese>» (P10) e la previsione del riquadro Andamento (D11). Unico task backend del piano, **nessuna
migration**, nessuna colonna nuova: `firs.producer_name` e `firs.carrier_name` esistono già
(`apps/backend/prisma/schema.prisma:355,362`). Percorsi relativi a `apps/backend/`.

**Files:**
- Modify: `src/application/analytics/analytics.service.ts` (`getTopProducers`, `getTopCarriers`,
  `getFIRsByStatus`, `predictNextMonthVolume`), `src/application/analytics/get-dashboard.use-case.ts`
  (intervallo solo alla seconda chiamata di `getFIRsByStatus`; tipi `DashboardData.top` e
  `trends.prediction`), `src/application/analytics/analytics.service.spec.ts`,
  `src/api/dashboard/dashboard.controller.ts` (solo la validazione delle date)
- Create: `src/application/analytics/analytics-dashboard.postgres.spec.ts`,
  `src/application/analytics/get-dashboard.use-case.spec.ts`
- Non si modifica `src/test-support/legami-di-test.ts` (lo usano in parallelo i lavori della 4.4).

**Interfaces:**
- Produces (contratto che il Task 2 copia alla lettera):
```ts
// get-dashboard.use-case.ts, DashboardData.top
producers: Array<{ partitaIva: string; nome: string | null; count: number }>
carriers:  Array<{ partitaIva: string; nome: string | null; count: number }>
// analytics.service.ts
getFIRsByStatus(tenantId: string, intervallo?: { startDate: Date; endDate: Date }): Promise<Record<string, number>>
//   con intervallo: createdAt >= startDate e <= endDate; senza: come oggi
getTopProducers(tenantId: string, limit: number): Promise<Array<{ partitaIva: string; nome: string | null; count: number }>>
getTopCarriers(tenantId: string, limit: number): Promise<Array<{ partitaIva: string; nome: string | null; count: number }>>
predictNextMonthVolume(tenantId: string, oggi?: Date): Promise<number | null>
// get-dashboard.use-case.ts, DashboardData.trends.prediction
prediction: { nextMonth: number | null }
```
`execute`: senza intervallo una sola `getFIRsByStatus(t)`, come oggi; con l'intervallo due chiamate,
`getFIRsByStatus(t)` per `overview` e `getFIRsByStatus(t, intervallo)` per `status.breakdown` e
`status.chart`. Controller: con `startDate`/`endDate` non validi (`isNaN(getTime())`) o
`startDate > endDate` → `BadRequestException('Intervallo di date non valido')`.

**Previsione (D11), metodo scelto: regressione lineare ai minimi quadrati sui conteggi degli ultimi 6
mesi completi.** Query unica, dentro la transazione di tenant:
`SELECT date_trunc('month', created_at) AS mese, COUNT(*)::int AS conteggio FROM firs WHERE tenant_id =
${tenantId}::uuid AND created_at >= <primo giorno UTC di 6 mesi fa> AND created_at < <primo giorno UTC del
mese corrente> GROUP BY 1`; i mesi senza FIR valgono 0. Si parte dal primo mese che ha almeno un FIR
(un'azienda nuova non ha mesi a zero «prima di esistere»). Con 3 o più mesi: retta `y = a + b·x` sui
mesi `x = 0…n-1`, previsione = `max(0, round(a + b·n))` (il mese corrente, primo dopo la serie). Con 1 o
2 mesi: la media arrotondata. Con 0 mesi completi: `null` (il frontend mostra «—»). Perché questo
metodo: (1) usa solo mesi **completi**, mentre il mese in corso, parziale, tirerebbe giù la stima;
(2) usa gli stessi mesi UTC (`date_trunc`) di `GET /dashboard/andamento`, così previsione e barre
parlano degli stessi mesi; (3) sei mesi seguono una tendenza senza farsi trascinare da un mese
anomalo, e una retta su sei punti si spiega in una riga a chi legge la Dashboard; una stagionalità
vera chiederebbe almeno 24 mesi di storia, che le aziende di oggi non hanno. «Prossimo mese» = il mese
corrente (quello che si sta chiudendo), come diceva l'etichetta di oggi; il mese è calcolato da `oggi`
(parametro per i test, predefinito `new Date()`).
Il `groupBy` di oggi resta (stesse P. IVA, stesso ordine). Poi **una** query per tipo di ditta, dentro la
transazione di tenant di `this.prisma` (`README-tenant-transazione.md`):
```sql
SELECT DISTINCT ON (producer_partita_iva) producer_partita_iva AS partita_iva, producer_name AS nome
FROM firs
WHERE tenant_id = ${tenantId}::uuid AND producer_partita_iva = ANY(${partiteIva}::text[])
ORDER BY producer_partita_iva, created_at DESC, id DESC
```
(gemella con `carrier_*`). Il nome è quello dello snapshot più recente; stringa vuota o solo spazi →
`null`. Lista vuota → nessuna query. Il `groupBy` ordina con un secondo criterio stabile,
`orderBy: [{ _count: { producerPartitaIva: 'desc' } }, { producerPartitaIva: 'asc' }]` (gemello per i
trasportatori), e una P. IVA vuota (`''`) resta fuori dalla classifica. Il tenant arriva da
`requireRequestTenantId(req)` nel controller, che cambia solo per la validazione delle date.

- [ ] **Step 1: test unit** (`analytics.service.spec.ts`, Prisma finto): `getTopProducers` unisce
  `nome` alle P. IVA del `groupBy` mantenendo l'ordine; P. IVA senza riga nella seconda query →
  `nome: null`; `groupBy` vuoto → nessuna `$queryRaw`; P. IVA `''` esclusa; `getFIRsByStatus(t, { startDate, endDate })`
  passa `createdAt: { gte, lte }`, senza intervallo nessun filtro sulla data; previsione (calcolo
  fissato): mesi `[10, 12, 14, 16, 18, 20]` → 22; `[20, 20, 20, 20, 20, 20]` → 20; `[30, 20, 10]` →
  0 (mai negativo); `[0, 0, 5]` dopo il primo FIR del terzo mese → 5 (media di un mese); un solo
  mese completo `[7]` → 7; nessun mese completo → `null`; il mese in corso non entra mai nella query
  (limite `< primo giorno del mese corrente`). In `get-dashboard.use-case.spec.ts`: senza intervallo
  una chiamata a `getFIRsByStatus`; con l'intervallo due, `overview.completedFIRs` dalla chiamata
  senza intervallo e `status.breakdown` dall'altra; nessun altro metodo riceve l'intervallo. Controller:
  `startDate=abc` → 400; `startDate > endDate` → 400.
- [ ] **Step 2: test Postgres** (`analytics-dashboard.postgres.spec.ts`, due tenant creati dal test,
  ruolo `wasteflow_app` con `creaPrismaServiceApplicativo()` e `TenantContext.run({ tenantId }, …)`, come
  `legami-movimento/impostazioni-fatturazione.service.postgres.spec.ts:25-43`; i FIR si creano con
  `owner.fIR.create` nello spec, con P. IVA, nome e `createdAt` espliciti): due FIR dello stesso produttore con nomi diversi → il nome del più recente;
  un FIR dell'altro tenant con la stessa P. IVA e un altro nome → mai restituito (isolamento); FIR
  di ottobre e di novembre → `getFIRsByStatus` con l'intervallo di novembre conta solo quelli di
  novembre; nome vuoto → `null`; previsione su FIR con `createdAt` in sei mesi diversi → il valore
  della retta calcolato a mano nel test, e un FIR dell'altro tenant non la cambia; pulizia per id con
  `pulisciTenantDiTest(owner, [t1, t2])`.
- [ ] **Step 3: run** `npx jest -w 2 src/application/analytics src/api/dashboard` e, sotto
  `flock $LOCK`, `npx jest -c jest.postgres.config.js --runInBand src/application/analytics/analytics-dashboard.postgres.spec.ts` → FAIL.
- [ ] **Step 4: implementa** le firme sopra, la doppia chiamata in `execute` e la validazione nel controller.
- [ ] **Step 5: run** → PASS; fine task backend dei Global Constraints; il frontend del Task 2 compila
  col tipo nuovo (campo additivo: nessun altro consumatore rompe).
- [ ] **Step 6: commit** `feat(dashboard): nome della ditta nei più frequenti, stati dei FIR nel periodo e previsione sui mesi`.

## Task 3: revisione e rilascio del pezzo A

**File:** nessuno (revisione su `git diff master...HEAD`).

- [ ] **Step 1:** revisori in parallelo: `typescript-nestjs-reviewer` (signal, unsubscribe, guard dei
  permessi su «Nuovo FIR», funzioni pure dei Task 1-2; Task 2b: tenant, `= ANY`, nessun `IN` costruito,
  isolamento nel test Postgres, contratto uguale nel frontend, previsione sui soli mesi completi) e `ux-ui-mobile-specialist` (screenshot del
  Task 1 e 2 a 1440 e 390, chiaro e scuro; focus visibile; contrasto delle pillole e dell'accento in
  scuro; tastiera nella sidebar). Correzioni nello stesso branch.
- [ ] **Step 2:** Karma completo, build, gate su Dashboard, Clienti, FIR, Registro con 0 FAIL nella
  shell; rapporto `pezzo-a.md` con il seguito P1 sulla CSP. PR «Restyle giro 2, pezzo A: token,
  shell, tema chiaro, Dashboard e nome della ditta», CI verde (e2e compresi), merge e deploy secondo la regola del merge
  autonomo; `STATUS.md` e `COSTS.md`.

---

# Pezzo B (PR 2) — pattern delle liste, accesso e pagine dei clienti

Parte da master dopo il merge del pezzo A (branch `feat/stile-pagine-2b`).

## Task 4: pattern delle liste (file globali, da solo nell'ondata con il Task 5)

Bug **28, 29, 32** (globali) e la base di 25, 26, 27, 31. Proposta §5 «Liste e tabelle», mockup
`b-clienti.html`.

**Files:**
- Modify: `styles/_pagine.scss` (barra filtri: campo di ricerca largo almeno 320 px, 100% sotto i
  640 px, lente centrata sulla riga; tabella: intestazioni 12 px grigie, righe da 48 px, `.num-col` a
  destra; classe `.lista-telefono` che sotto i 640 px trasforma `p-table` in righe a due linee da 56 px
  come `b-clienti.html` righe 200-212 del CSS: `td.m-hide` nascosta, `td.m2` a tutta riga). Oggi in
  `_pagine.scss` ogni regola sta sotto `.pagina-lavoro` (righe 6-7, 36), che le pagine dei Task 6-15
  non hanno: le classi nuove (`.lista-telefono`, `.senza-righe`, `.barra-filtri` e una copia di
  `.num-col` per le tabelle) stanno **fuori** da `.pagina-lavoro`, con selettori propri.
  `fe/shared/components/skeleton-loader.component.ts`: barre grigie piatte, nessun `gradient`
  (house rule §11). `styles/_primeng.scss`
  (bottone del dropdown di `p-autoComplete` senza fondo, icona `--text-secondary`, bordo del campo;
  paginatore nascosto quando la tabella ha la classe `senza-righe`)
- Create: `fe/shared/components/azioni-riga.component.ts` (+ spec), `fe/shared/utils/colonne-visibili.ts`
  (+ spec), `e2e/utils/azioni-riga.ts`

**Interfaces:**
- Produces:
```ts
// azioni-riga.component.ts
export interface AzioneRiga { etichetta: string; icona?: string; pericolosa?: boolean; disabilitata?: boolean; motivo?: string; esegui: () => void }
// <app-azioni-riga [principale]="AzioneRiga | null" [altre]="AzioneRiga[]" [nome]="string" />
//   principale → p-button text con ariaLabel = etichetta + ' ' + nome (es. «Modifica il cliente X» lo passa la pagina in etichetta)
//   altre → bottone ⋯ (icona pi pi-ellipsis-h, aria-label `Altre azioni per ${nome}`, aria-haspopup="menu") + p-menu popup appeso al body
//   nessuna altra azione → nessun ⋯; pericolose in fondo, separate
//   principale null e altre vuote: la pagina non rende né la cella né la colonna né l'intestazione «Azioni» (VIEWER)
// colonne-visibili.ts
export function colonneConDati<T>(righe: readonly T[], colonne: Readonly<Record<string, (r: T) => unknown>>): Set<string>
//   una colonna è visibile se almeno una riga ha un valore non null, non undefined e non stringa vuota dopo trim
// e2e/utils/azioni-riga.ts
export async function eseguiAzioneRiga(page: Page, riga: Locator, nome: string | RegExp): Promise<void>
export async function nomiAzioniRiga(page: Page, riga: Locator): Promise<string[]>   // bottoni della riga + voci del menu (lo apre e lo richiude)
```
- [ ] **Step 1: test che falliscono.** `azioni-riga.component.spec.ts` (DOM): con principale e due
  altre → un bottone con il nome completo e un ⋯ con `aria-label="Altre azioni per Rossi S.r.l."`; clic
  sul ⋯ → `role="menuitem"` con le due etichette, la pericolosa ultima; Invio apre, Esc chiude e il
  focus torna sul ⋯ (Review Focus 5); voce disabilitata con `motivo` come tooltip e senza `esegui`;
  nessuna altra → nessun ⋯. `colonne-visibili.spec.ts`: colonna tutta `null`/`''`/`'  '` esclusa, una
  riga valorizzata la include, zero righe → insieme vuoto. Spec di stile (nuovo
  `fe/shared/utils/pattern-liste.spec.ts`): una `p-table` con classe `lista-telefono` dentro un
  contenitore **senza** `.pagina-lavoro` riceve le regole (a 390 px `td.m-hide` ha `display: none`);
  `.senza-righe` nasconde `.p-paginator`. `skeleton-loader`: `background-image` calcolato `none`.
- [ ] **Step 2-4:** Karma mirato FAIL → implementa → PASS.
- [ ] **Step 5: verifica completa;** gate su `/cer` e `/contratti-clienti` solo per il bottone
  dell'autocomplete (bug 29) e su `/clienti/agenti` per la paginazione a zero righe (bug 32: la classe
  `senza-righe` si mette nelle pagine nei Task 6-15; qui si prova su una tabella del test).
- [ ] **Step 6: commit** `feat(stile): pattern delle liste (azioni di riga, lista sul telefono, colonne vuote, autocomplete)`.

## Task 5: Login e Richiedi accesso (iscrizione)

Bug **21, 22, 23, 24**. Proposta §6 riga 3.

**Files:**
- Modify: `fe/features/auth/login.component.ts`, `fe/features/auth/signup/signup.component.ts`,
  `fe/features/auth/auth-callback.component.ts` (passa a ogni login), `fe/features/auth/spid-login/spid-login.component.ts`,
  `fe/features/auth/spid-callback/spid-callback.component.ts` (stesso gradiente: pannello piatto)
- Create: `fe/features/auth/login.component.spec.ts`, `fe/features/auth/signup/signup.component.spec.ts`

Pannello di marca piatto `var(--brand-panel)` (token del Task 1, `#141414` in entrambi i temi: nessun
colore letterale nel componente) con `<app-segno-marchio>` nella fiamma (`--brand-mark`) e il testo
`--on-brand-panel`; il
pannello non supera il 40% della larghezza sopra i 992 px e sparisce sotto i 768 px (resta il marchio
sopra il form). Testi, alla lettera (approvati da Graziano, D9):
- titolo del pannello: «Formulari, registro e RENTRI in un solo posto»;
- sotto: «Il gestionale per le aziende che producono, trasportano e recuperano rifiuti.»;
- elenco (senza icone in riquadri, bug 24): «FIR digitali e trasmissione a RENTRI»; «Registro di
  carico e scarico sempre allineato»; «MUD preparato dai dati dell'anno»;
- piede: «WasteFlow · IgniCraft».
Il pannello di «Richiedi accesso» usa gli stessi testi approvati (al posto di «Scopri WasteFlow con un
consulente dedicato.», `signup.component.ts:57`); il titolo del form «Richiedi accesso» non cambia.
Via «Piattaforma per la Pubblica Amministrazione» (righe 40 e 64) e «Conformità normativa
garantita» (riga 60). Etichette in sentence case: «Gestione digitale dei rifiuti», «Prova guidata»,
«Dati azienda», «Referente» (bug 23). Il form sta in alto nella colonna, non centrato su 700 px di vuoto.

- [ ] **Step 1: foto prima** `login`, `richiedi-accesso`.
- [ ] **Step 2: test che falliscono** (DOM): nessun testo «Pubblica Amministrazione» né «garantita»;
  i quattro testi sopra presenti; nessun elemento con `text-transform: uppercase` calcolato nel
  pannello e nelle intestazioni del form di richiesta; il pannello ha `background-image: none`; il
  bottone «Accedi» resta (`e2e/pages/login.page.ts:18`); `auth-callback`, `spid-login` e
  `spid-callback` senza `gradient` nello stile calcolato (controllo con un `TestBed` minimo per ognuno,
  nello spec del login).
- [ ] **Step 3-5:** FAIL → implementa (via `radial-gradient`/`linear-gradient` delle righe 136-151 e
  dei gemelli in `signup.component.ts:380-395`) → PASS; verifica completa; gate senza FAIL
  `gradient`, `micro-label`, `colour-sprawl`.
- [ ] **Step 6: commit** `feat(stile): login e richiesta d'accesso con pannello piatto e testi di WasteFlow`.

## Task 6: Clienti, Agenti, Archivio addebiti, Tabelle di fatturazione

Bug **25, 26, 27, 28, 31, 32** su queste pagine. Proposta §6 riga 4, mockup `b-clienti.html`.

**Files:**
- Modify: `fe/features/clienti/clienti-list.component.ts`, `agenti-list.component.ts`,
  `fe/features/listino/addebiti-list.component.ts`, `fe/features/clienti/tabelle/tabelle-fatturazione.component.ts`,
  `fe/features/clienti/tabelle/{codifiche-griglia,registri-iva,conti-correnti,condizioni-pagamento,spese-accessorie,testi-fatturazione,codifiche-contratto}.component.ts`,
  `fe/features/listino/tabelle/{codici-iva-tab,codifiche-addebito-tab}.component.ts` (schede della
  stessa pagina «Tabelle di fatturazione») (+ i loro spec)
- **Non** si modificano (li usano in parallelo i Task 7 e 8): `clienti/clienti.service.ts`,
  `clienti/clienti.model.ts`, `clienti/vocabolario-clienti.ts`,
  `clienti/tabelle/{elenco-paginato,tabella-comune,tabelle-test-utils}.ts`. Se servono, si scrive nel
  rapporto e la modifica si fa dopo l'integrazione dell'ondata.
- e2e: `e2e/tests/tabelle-fatturazione/tabelle-fatturazione.spec.ts` (righe 189, 191 con
  `eseguiAzioneRiga`; 344 con `nomiAzioniRiga` vuoto; commento 114 senza «topbar»),
  `e2e/tests/listino/archivio-addebiti.spec.ts` (348 e 409 restano bottoni principali; 359 «Varia i
  prezzi» con `eseguiAzioneRiga`; 435 e 446-452 con `nomiAzioniRiga` vuoto per il VIEWER)

Clienti: schede per stato in cima come nel mockup **solo se** il filtro per stato c'è già nel servizio
(`clienti.service.ts`): oggi il filtro ha solo `testo` e `soloAttivi`, quindi niente schede (nessuna
API nuova). La radice `.pagina` perde il `padding: 1rem` (`clienti-list.component.ts:176`; gemelli
in agenti e addebiti): il gutter è della shell. «Nuovo cliente» (e i «Nuovo …» delle altre pagine) è il
solo `wf-primario`; «Agenti», «Tabelle di fatturazione» e «Archivio addebiti» restano bottoni a
contorno. Per riga: azione principale
«Modifica» (`ariaLabel` «Modifica il cliente <ragione sociale>» come oggi), nel ⋯ «Disattiva/Riattiva»
ed «Elimina» (pericolosa). Codice, Codice destinatario e Agente con `colonneConDati`. P. IVA in mono,
cifre a destra. Stessa regola per agenti, addebiti (principale «Modifica l'addebito …», nel ⋯ «Varia
i prezzi…», «Disattiva/Riattiva», «Elimina») e griglie delle tabelle (principale «Modifica», nel ⋯
«Disattiva/Riattiva», «Elimina»). Importi con `DecimalPipe '1.2-2'` («5,00»). `lista-telefono` e
`senza-righe` su tutte.

- [ ] **Step 1: foto prima** `clienti`, `clienti/agenti`, `clienti/addebiti`, `clienti/tabelle`.
- [ ] **Step 2: test che falliscono** (DOM, per ognuna delle quattro pagine): colonna tutta vuota non
  renderizzata, presente con una riga valorizzata; una sola azione visibile sulla riga + ⋯ con le altre;
  le celle numeriche con classe `num-col` e testo «5,00»; con 0 righe testo dello stato vuoto e nessun
  `.p-paginator`; placeholder «Cerca un cliente» per intero (il campo ha `min-width` 320 px: si
  verifica lo stile calcolato a 1440); su Clienti nome di 80 caratteri: `scrollWidth <= clientWidth`
  del contenitore a 390 px (Review Focus 5); VIEWER: nessun ⋯, nessun «Modifica» e nessun `th`
  «Azioni»; al più un `.wf-primario`; l'`aria-label` «Cerca un cliente» del campo di ricerca resta.
- [ ] **Step 3-5:** FAIL → implementa → PASS; verifica completa (gate sulle quattro pagine, FAIL
  `numeric-align` e `panel-void` di Clienti chiusi); e2e delle due spec.
- [ ] **Step 6: commit** `feat(stile): clienti, agenti, addebiti e tabelle con il pattern delle liste`
  e `test(e2e): azioni di riga nel menu per tabelle di fatturazione e archivio addebiti`.

## Task 7: Contratti clienti e Listino del contratto

Bug **30** e il pattern (25-27, 31, 32) su queste pagine; 29 verificato. Proposta §6 riga 5.

**Files:**
- Modify: `fe/features/contratti-cliente/contratti-cliente-list.component.ts` (+ spec),
  `fe/features/listino/listino-contratto.component.ts`, `righe-tavola.component.ts`,
  `elenchi-pannello.component.ts` (+ spec)
- Create: `fe/features/listino/elenchi-pannello.component.spec.ts`
- e2e: `e2e/tests/contratti-cliente/contratto-cliente.spec.ts` (195 resta bottone; 457 e 473
  «Attiva», 506 «Sospendi solo movimenti», 509 «Rinnova» e 534 «Annulla il contratto» con
  `eseguiAzioneRiga`; 475 con `nomiAzioniRiga` che contiene «Sospendi solo movimenti»; 558, 576-579
  e 588 con `nomiAzioniRiga` vuoto; le righe 584-590 controllano Clienti, del Task 6: con
  `nomiAzioniRiga` vanno bene prima e dopo il Task 6), `e2e/tests/listino/listino-contratto.spec.ts`
  (661 «Annulla il contratto <n>» con `eseguiAzioneRiga`; il nome della voce resta «Annulla il
  contratto <n>»; 823 con `nomiAzioniRiga` vuoto per il VIEWER)

Righe dei contratti: principale «Modifica», nel ⋯ le azioni di `etichettaAzione(c, s)`, «Rinnova»,
«Annulla il contratto <n>», «Elimina». Descrizione e cliente su una riga con ellissi e `title`
(niente 5 righe), colonna delle azioni a larghezza fissa e mai tagliata, filtri tutti senza etichetta
sopra (il filtro «Cliente» con `placeholder` e `aria-label`, come gli altri), placeholder interi
(bug 28: il campo largo almeno 320 px del Task 4). L'`aria-label` «Cerca un contratto» resta. La
radice `.pagina` perde il padding proprio. Un solo `wf-primario` («Nuovo contratto»).

- [ ] **Step 1: foto prima** `contratti-clienti` e il listino di un contratto dell'azienda di prova.
- [ ] **Step 2: test che falliscono** (DOM): cella descrizione con `white-space: nowrap` e `title`
  completo; la riga sta in 48 px con descrizione di 200 caratteri; ultima colonna interamente dentro
  la tabella a 1440 (`getBoundingClientRect().right <= tabella.right`); i filtri senza `<label>` visibile
  sopra e con `aria-label`; placeholder del filtro «Cliente» non troncato (`scrollWidth <= clientWidth`
  dell'input); azioni di riga come sopra; VIEWER senza `th` «Azioni»; 0 contratti → niente paginatore.
- [ ] **Step 3-5:** FAIL → implementa → PASS; verifica completa; e2e delle due spec.
- [ ] **Step 6: commit** `feat(stile): contratti clienti e listino con il pattern delle liste` e `test(e2e): azioni dei contratti nel menu di riga`.

## Task 8: Da collegare e Impostazioni di fatturazione

Bug **32** (Da collegare) e la «voce di menu» della proposta §6 riga 6, che è il bug 14 già chiuso
dal Task 1 (qui si verifica soltanto). L'h1 «Impostazioni di fatturazione» non cambia
(`e2e/tests/fatturazione/impostazioni-fatturazione-4-4.spec.ts:323`, `e2e/tests/legami/impostazione-fatturazione.spec.ts:338`).

**Files:**
- Modify: `fe/features/legami/da-collegare.component.ts` (+ `da-collegare.dom.spec.ts`),
  `fe/features/legami/impostazioni-fatturazione.component.ts` (+ spec)

- [ ] **Step 1: foto prima** `legami/da-collegare`, `clienti/fatturazione`.
- [ ] **Step 2: test che falliscono** (DOM): filtri su una riga allineati alla base a 1440, a capo
  sotto i 640 px; «Fatturazione non attiva» come riga di stato dentro la card, senza paginatore; 0 righe
  → nessun `.p-paginator`; cifre a destra; un solo h1 per pagina con il testo di oggi; al più un
  `.wf-primario` per pagina.
- [ ] **Step 3-5:** FAIL → implementa → PASS; verifica completa; e2e `pages/legami.page.ts` e le due
  spec delle impostazioni.
- [ ] **Step 6: commit** `feat(stile): da collegare e impostazioni di fatturazione allineate al pattern`.

## Task 9: Catalogo CER

Bug **27** (34 su 34 `numeric-align`) e **29** sulla pagina. Proposta §6 riga 7.

**Files:**
- Modify: `fe/features/cer/cer-search.component.ts` (la radice `.cer-search` perde il padding proprio)
- Create: `fe/features/cer/cer-search.component.spec.ts`

«Pericoloso» come segno (asterisco del codice e pillola `err` tenue solo nella riga), non colonna
colorata; codici in mono; colonne numeriche a destra; h1 «Ricerca codici CER» invariato.

- [ ] **Step 1-2:** foto prima; test (DOM): celle numeriche `num-col`; un CER pericoloso ha `*` nel
  codice e la pillola «Pericoloso», uno non pericoloso nessuna pillola; il bottone del dropdown
  dell'autocomplete senza fondo pieno: Karma carica solo `src/styles.scss` e non il tema Aura, quindi
  si controlla la regola di `_primeng.scss` (`background-color` calcolato `transparent` /
  `rgba(0, 0, 0, 0)`), non il confronto col fondo del campo.
- [ ] **Step 3-5:** FAIL → implementa → PASS; verifica completa (FAIL `edge-text`, `numeric-align` chiusi).
- [ ] **Step 6: commit** `feat(stile): catalogo CER con cifre a destra e pericoloso come segno`.

## Task 10: revisione e rilascio del pezzo B

- [ ] **Step 1:** revisori come nel Task 3, più `web-testing-specialist` sulle spec e2e modificate
  (l'helper non deve rendere banali i controlli negativi: un VIEWER senza ⋯ deve essere verificato).
- [ ] **Step 2:** verifica completa, e2e toccati in CI; rapporto `pezzo-b.md`; PR «Restyle giro 2,
  pezzo B: liste, accesso e clienti», merge e deploy; `STATUS.md` e `COSTS.md`.

---

# Pezzo C (PR 3) — anagrafiche, adempimenti, RENTRI, amministrazione e ripasso

Parte da master dopo il merge del pezzo B (branch `feat/stile-pagine-2c`).

## Task 11: Produttori, Trasportatori, Destinatari

Il pattern (25-27, 31, 32) sulle tre anagrafiche. Proposta §6 riga 8.

**Files:**
- Modify: `fe/features/registry/produttori-list.component.ts`, `trasportatori-list.component.ts`,
  `destinatari-list.component.ts` (+ spec)
- e2e: `e2e/pages/registry.page.ts:54` (azione «Elimina» con `eseguiAzioneRiga`; nessun chiamante
  nei test oggi); `registry.page.ts:33` cerca la ricerca come `textbox`: o il campo resta senza
  `type="search"`, o il page object passa a `searchbox` nello stesso commit

Principale «Modifica <ragione sociale>» (ariaLabel di oggi), nel ⋯ «Sedi (n)» e «Elimina»; P. IVA in
mono; un solo pattern per le tre (stessa struttura di colonne e di stato vuoto); via il maiuscolo
spaziato in `trasportatori-list.component.ts`.

- [ ] **Step 1-2:** foto prima `produttori`, `trasportatori`, `destinatari`; test (DOM, una per
  pagina): colonne vuote nascoste, una azione + ⋯, lista a due righe a 390, 0 righe senza
  paginatore, nessun `text-transform: uppercase`, VIEWER senza `th` «Azioni», al più un `.wf-primario`.
- [ ] **Step 3-5:** FAIL → implementa → PASS; verifica completa; e2e `tests/registry/*`.
- [ ] **Step 6: commit** `feat(stile): anagrafiche con un solo pattern di lista`.

## Task 12: Contratti (produttore)

Il pattern sulla lista. Proposta §6 riga 9.

**Files:**
- Modify: `fe/features/contracts/contracts-list.component.ts` (+ spec)

Principale «Modifica» (`etichettaModifica(c)`), nel ⋯ «Cambia stato del contratto <n>» ed «Elimina
il contratto <n>»; via «Aggiorna» dalla riga del titolo (resta «Riprova» nello stato di errore).

- [ ] **Step 1-5:** foto prima `contratti`; test (DOM) come nel Task 11; FAIL → implementa → PASS;
  verifica completa.
- [ ] **Step 6: commit** `feat(stile): contratti del produttore con il pattern delle liste`.

## Task 13: Pese, MUD, ESG, Anomalie

Bug **31** (overflow di Pese, 413 su 390), **34**, e la parte MUD del **35**. Proposta §6 riga 10.

**Files:**
- Modify: `fe/features/pese/pese.component.ts` (la radice `.titolo` perde il padding proprio),
  `accessi.component.ts` (+ `accessi.component.dom.spec.ts`), `pese-stili.ts`,
  `fe/features/mud/mud.component.ts` (+ spec), `fe/features/esg/esg.component.ts`,
  `fe/features/anomaly/anomaly.component.ts`
- Create: `fe/features/pese/pese.component.spec.ts`, `fe/features/pese/pese-stili.spec.ts`,
  `fe/features/esg/esg.component.spec.ts`, `fe/features/anomaly/anomaly.component.spec.ts`

Anomalie: i tre KPI con bordo rosso, arancio e blu diventano **una** striscia divisa (come «FIR del
mese» del Task 2) con lo stato come parola e il pallino del tono; ESG: card «CO₂ evitata» senza bordo
né fondo teal, «CO2» scritto «CO₂» ovunque nel componente (la voce di menu «ESG / CO2» sta in
`layout.component.ts`, file globale: va nel rapporto e la cambia il Task 16); MUD: l'interruttore «non è tenuta a presentare» con etichetta a destra e stato in
parola («Sì»/«No») accanto; Pese: nessun elemento più largo del viewport a 390.

- [ ] **Step 1-2:** foto prima `pese`, `mud`, `esg`, `anomalie`; test (DOM): in Anomalie un solo
  contenitore KPI con tre celle e nessun `border-color` di stato; in ESG il testo «CO₂» e nessuna
  occorrenza di «CO2»; nel MUD l'interruttore ha `aria-checked` e la parola di stato; in Pese
  `scrollWidth <= clientWidth` del contenitore della pagina con `fixture.nativeElement.style.width =
  '390px'` (non `documentElement`, che in Karma ha la larghezza della finestra).
- [ ] **Step 3-5:** FAIL → implementa → PASS; verifica completa.
- [ ] **Step 6: commit** `feat(stile): pese, MUD, ESG e anomalie con striscia divisa e CO₂`.

## Task 14: RENTRI (Certificato, Unità locali, Codifiche, Blocchi) e toast in italiano

Bug **20** e la parte RENTRI del **35**. Proposta §6 riga 11.

**Files:**
- Modify: `fe/features/rentri/{rentri-credential,rentri-siti,rentri-codifiche-diagnostica,rentri-blocchi}.component.ts`
  (+ spec), `fe/core/services/toast.service.ts`, `fe/core/interceptors/error.interceptor.ts`
- Create: `fe/core/services/toast.service.spec.ts`, `fe/core/interceptors/error.interceptor.spec.ts`

Le quattro pagine perdono la larghezza propria: oggi `<div class="page" style="max-width: 820px | 900px |
1000px">` (`rentri-credential.component.ts:41`, `rentri-siti.component.ts:30`,
`rentri-codifiche-diagnostica.component.ts:31`, `rentri-blocchi.component.ts:45`); restano solo con
`.page`, come le altre pagine. Toast: `summary` predefiniti «Fatto», «Errore», «Attenzione»,
«Informazione» (righe 29, 41, 53, 65 di `toast.service.ts`). Nell'interceptor `summary` (riga 69) e
`detail` (righe 18-58) in italiano; il file **resta non registrato** (`app.config.ts:21` monta solo
`loading`, `auth` e `tenant`): registrarlo cambierebbe il comportamento, va nei «Seguiti».

- [ ] **Step 1-2:** foto prima `rentri/certificato`, `rentri/unita-locali`, `rentri/codifiche`,
  `rentri/blocchi`; test: `toast.error('x')` aggiunge un messaggio con `summary: 'Errore'`,
  `toast.warn('x')` con `'Attenzione'`, `success` «Fatto», `info` «Informazione»: nessun `summary`
  predefinito in inglese; l'interceptor su 500 e 409 usa «Errore» e «Attenzione» e un `detail` in
  italiano; nelle quattro pagine il contenitore `.page` non ha un attributo `style` con `max-width` e il
  suo `max-width` calcolato è quello di `.page` (1320 px).
- [ ] **Step 3-5:** FAIL → implementa → PASS; verifica completa; e2e `tests/rentri/*`.
- [ ] **Step 6: commit** `feat(stile): pagine RENTRI a tutta larghezza e toast in italiano`.

## Task 15: Amministrazione e account

Bug **19** e la parte permessi del **35**. Proposta §6 riga 12.

**Files:**
- Modify: `fe/core/guards/super-admin.guard.ts` (+ spec nuovo `super-admin.guard.spec.ts`),
  `fe/features/permissions/pipes/role-description.pipe.ts` (+ spec), `fe/features/permissions/components/role-card/role-card.component.ts`,
  `fe/features/permissions/pages/permission-discovery/permission-discovery.component.ts` (+ spec),
  `fe/features/permissions/pages/permission-denied/permission-denied.component.ts`,
  `fe/features/admin/users/user-admin.component.ts`, `fe/features/admin/tenants/tenant-admin.component.ts`,
  `fe/features/admin/system-health/system-health.component.ts`, `fe/features/billing/billing-page.component.ts`,
  `fe/features/notifications/notifications-page/notifications-page.component.ts` (+ spec da creare,
  come quelli della pipe e di `permission-discovery`), `fe/features/permissions/pages/consultant-dashboard/consultant-dashboard.component.ts`
  (solo se il gate trova FAIL: usa `coloriGrafico` del Task 1)
- e2e: `e2e/pages/admin-users.page.ts:33` («Impersona» con `eseguiAzioneRiga`) e il suo chiamante
  `e2e/tests/admin/impersonation.spec.ts:27`

Guard: chi non è SUPER_ADMIN va su `/permissions/denied` (la pagina esistente), non sulla Dashboard. In
Angular 17 uno `UrlTree` non porta lo stato di navigazione (`RedirectCommand` arriva in Angular 18) e la
pagina legge i query param `permission`, `role`, `resource` (`permission-denied.component.ts:415-420`):
`router.createUrlTree(['/permissions/denied'], { queryParams: { resource: <nome della pagina>, role: <ruolo> } })`. Permessi: nomi in italiano dalla pipe (es.
«Vedere le analisi della dashboard», «Tutti i permessi», «Accesso completo al sistema»), il badge del
ruolo in sentence case («Amministratore di sistema»). Liste di Utenti e Le mie aziende col pattern
(principale «Modifica», nel ⋯ «Impersona», «Disattiva», …).

- [ ] **Step 1-2:** foto prima `abbonamento`, `admin/stato-sistema`, `reference-data` (come ADMIN:
  oggi mostrano la Dashboard), `admin/utenti`, `admin/tenants`, `permissions/my-permissions`,
  `notifications`, `permissions/consultant-dashboard`; test: il guard con ruolo ADMIN restituisce un
  `UrlTree` che serializzato contiene `/permissions/denied?resource=`, con SUPER_ADMIN `true`; la pipe non restituisce mai una stringa inglese per i ruoli e i permessi
  noti (elenco chiuso nel test) e nessun `text-transform: uppercase` nel badge; pagine di
  amministrazione con un solo h1 e il pattern di lista.
- [ ] **Step 3-5:** FAIL → implementa → PASS; verifica completa; e2e `tests/rbac/*`, `tests/admin/*`.
- [ ] **Step 6: commit** `feat(stile): accesso negato esplicito, permessi in italiano e liste di amministrazione`.

## Task 16: ripasso delle pagine del giro 1

Bug **27** (registro, giacenze), **33**, e le correzioni globali rimandate dai rapporti dei Task 6-15
(per esempio la voce di menu «ESG / CO₂» del Task 13). Proposta §6 riga «Ripasso».

**Files:**
- Modify: `fe/features/registro/registro.component.ts` (+ nuovo `registro.component.stile.spec.ts`), `fe/features/giacenze/{giacenze,abbinamenti}.component.ts`,
  `fe/features/fir/{fir-list,fir-detail}.component.ts` (colori, stati e, in `fir-list`, lo stato vuoto
  intero sul telefono: bug 31), più i residui fuori dai task: maiuscolo spaziato in
  `fe/features/legami/{riquadro-legame,blocco-fatturazione}.component.ts`,
  `fe/features/registry/{anagrafica-form-dialog,sedi-ditta-dialog,ditta-identificativi}.component.ts`,
  `fe/features/permissions/components/{audit-timeline,tenant-selector}/*.component.ts`,
  `fe/features/registro/correggi-movimento-dialog.component.ts`, `fe/features/fir/consegna-da-accesso.component.ts`,
  `fe/features/legal/legal-page.component.ts`; token inesistenti con ripiego letterale e barra sinistra
  da 4 px in `fe/features/legami/aggiorna-prezzi-dialog.component.ts:328-360`; commenti «teal-700
  #0f766e» in `fe/features/cer/cer-select.component.ts:12` e `registro.component.ts:8`, più le righe globali
  raccolte (`_pagine.scss`, `_primeng.scss`, `layout.component.ts`): **unico** task del pezzo C che
  tocca file globali, e lo fa da solo nella sua ondata.

Registro: tipo «Carico»/«Scarico» in sentence case con la freccia come icona grigia, «kg» in grigio
normale (non maiuscoletto), «Nei termini» senza colore (grigio, solo testo) e il colore solo su «In
ritardo» o «Scaduto». Le pagine del giro 1 sui token nuovi: nessun teal residuo
(`grep -rnE "0f6b63|5cc0b3|eef2ef|0f766e|1d4ed8|e2e8f0|--color-(surface-alt|border|text-secondary)" apps/frontend/src` → 0),
e `grep -rn "text-transform: uppercase" apps/frontend/src/app` con ogni riga rimasta motivata nel
rapporto (al più un'etichetta tracciata per schermata).

- [ ] **Step 1-2:** foto prima `fir`, `registro`, `giacenze`, `giacenze/abbinamenti`, `fir/<id>`;
  test (DOM): «Carico» senza maiuscolo; «Nei termini» con il tono `none`; cifre a destra; lista FIR
  vuota a 390 px: il testo dello stato vuoto intero (`scrollWidth <= clientWidth`, niente ellissi); i
  grep sopra a zero (passo di verifica).
- [ ] **Step 3-5:** FAIL → implementa → PASS; verifica completa (FAIL `gradient` dell'ombra di
  scorrimento della tabella di FIR e Registro chiusi con un bordo invece del gradiente).
- [ ] **Step 6: commit** `feat(stile): ripasso di FIR, registro e giacenze sui token del giro 2`.

## Task 17: revisione e rilascio del pezzo C

- [ ] **Step 1:** revisori come nel Task 10; inspector su **tutte** le 37 pagine della proposta
  (elenco di `prima/`), chiaro e scuro: 0 FAIL; tabella prima/dopo nel rapporto `pezzo-c.md`.
- [ ] **Step 2:** PR «Restyle giro 2, pezzo C», merge e deploy; `STATUS.md`, `COSTS.md`; memoria
  `rifiuti-stile-grafico` aggiornata.

---

## Bug → task

| Bug | Task | Test |
|---|---|---|
| 1 stati in inglese | 2 | `stati-fir.spec`, `dashboard-page.spec` (nessuna chiave inglese) |
| 2 fascia sparita | 2 | `da-fare-oggi.spec`, e2e `flusso-scadenze` |
| 3 colori per posizione | 2 | `fir-mese-stati.spec` (ordine rimescolato) |
| 4 tavolozza dei grafici | 1, 2 | `colori-grafici.spec`; spec di `barre-orizzontali` e della pagina (nessun `canvas`) |
| 5 conformità 20% su 0 FIR | 2 (P11) | `dashboard-dati.spec` (`celleAnalisi`, `livelloConformita`), `dashboard-page.spec` |
| 6 decimali col punto | 2 | `deposito-sintesi.spec`, `fir-recenti.spec`, `dashboard-dati.spec` («1.240», «12,5 h», nessun «0.0») |
| 7 P. IVA al posto del nome | **2b** (dato) + 2 (vista) | `analytics.service.spec`, `analytics-dashboard.postgres.spec`, `classifica-ditte.spec` |
| 8 card vuote da 300 px | 2 | `fir-recenti.spec`, spec dei riquadri d'analisi, `dashboard-page.spec` |
| 9 grafico del componente morto | 2 (cancellato) | build |
| 10 nessuna azione primaria | 2 | `dashboard-page.spec` |
| 11 due h1 | 1 | `layout.component.spec` |
| 12 titolo «WasteFlow» | 1 | `navigazione-shell.spec` |
| 13 icona del Registro | 1 | `layout.component.spec` |
| 14 due voci attive | 1 (verifica nel 8) | `navigazione-shell.spec`, `layout.component.spec` |
| 15 barra a sinistra | 1 | `layout.component.spec` (`::before` con `content: none`) |
| 16 8 px dal bordo a 768 | 1 | `layout.component.spec` (padding di `.main__inner`), inspector `edge-text` |
| 17 tema senza stato | 1 | `layout.component.spec` |
| 18 theme-color | 1 | `tema.service.spec` (tutti e due i meta) |
| 19 rimando silenzioso | 15 | `super-admin.guard.spec` |
| 20 toast in inglese | 14 | `toast.service.spec` (quattro `summary`), spec dell'interceptor |
| 21 gradiente del login | 5 | spec del login (`background-image: none`; anche `auth-callback`, `spid-login`, `spid-callback`) |
| 22 copy della PA | 5 | spec del login e della richiesta |
| 23 maiuscolo spaziato | 5 | spec (uppercase calcolato) |
| 24 icone in riquadri | 5 | spec (nessuna icona nell'elenco) |
| 25 colonne vuote | 4 (base), 6, 7, 11 | `colonne-visibili.spec` + spec di pagina |
| 26 azioni impilate | 4 (base), 6, 7, 11, 12, 15 | `azioni-riga.spec` + spec di pagina, e2e |
| 27 numeri a sinistra | 6, 7, 9, 16 | spec di pagina (`num-col`, «5,00») |
| 28 placeholder troncati | 4, 6, 7 | spec di Clienti (larghezza minima), spec di Contratti clienti (filtro «Cliente») |
| 29 dropdown nero | 4, 9 | spec del CER (fondo calcolato) |
| 30 contratti clienti | 7 | spec della lista |
| 31 tabelle sul telefono, Pese, stato vuoto dei FIR | 4 (base), 6, 7, 11, 13, 16 | spec a 390 (`pattern-liste.spec`, pagine, Pese, lista FIR), inspector |
| 32 paginazione a zero righe | 4 (base), 6, 7, 8, 11 | `pattern-liste.spec`, spec di pagina |
| 33 registro | 16 | spec del registro |
| 34 anomalie ed ESG | 13 | spec di anomalie ed ESG |
| 35 permessi, RENTRI, MUD | 15, 14, 13 | spec della pipe, delle tre pagine RENTRI, del MUD |

## e2e da aggiornare

| File | Righe | Task | Modifica |
|---|---|---|---|
| `e2e/tests/scadenze/flusso-scadenze.spec.ts` | passo 4 (282-296); commento 63 | 2 | il passo 4 torna verde coi `data-testid` conservati; il commento cita `da-fare-oggi.component.spec.ts` |
| `e2e/tests/tabelle-fatturazione/tabelle-fatturazione.spec.ts` | 189, 191, 344; commento 114 | 6 | `eseguiAzioneRiga`, `nomiAzioniRiga`; commento senza «topbar» |
| `e2e/tests/listino/archivio-addebiti.spec.ts` | 359, 435, 446-452 | 6 | 359 «Varia i prezzi» con `eseguiAzioneRiga`; 435 e 446-452 (VIEWER) con `nomiAzioniRiga` vuoto |
| `e2e/tests/contratti-cliente/contratto-cliente.spec.ts` | 457, 473, 475, 506, 509, 534, 558, 576-579, 584-590 | 7 | `eseguiAzioneRiga` («Attiva», «Sospendi solo movimenti», «Rinnova», «Annulla il contratto»), `nomiAzioniRiga` |
| `e2e/tests/listino/listino-contratto.spec.ts` | 661, 823 | 7 | `eseguiAzioneRiga`; 823 (VIEWER) con `nomiAzioniRiga` vuoto |
| `e2e/pages/registry.page.ts` | 54 | 11 | `eseguiAzioneRiga` |
| `e2e/pages/registry.page.ts` | 33 | 11 | solo se la ricerca diventa `type="search"`: `textbox` → `searchbox` |
| `e2e/pages/admin-users.page.ts` | 33 | 15 | `eseguiAzioneRiga` |
| `e2e/tests/admin/impersonation.spec.ts` | 27 | 15 | `eseguiAzioneRiga(page, row, /impersona/i)` al posto di `impersonaButtonInRow(row).click()` |

Titoli h1 che **non** cambiano (vedi Global Constraints). `e2e/pages/fir-list.page.ts:37` non cambia
(il Task 16 non sposta le azioni della lista FIR).

---

## Ondate

Regola: **i file globali li tocca un solo task per ondata, da solo** (Task 1; Task 4 con il solo
Task 5, che non li tocca; Task 16). Nelle altre ondate i task toccano file disgiunti (colonna «File»).
Il codice si scrive in parallelo, un worktree per task
(`git worktree add ../rifiuti-wt-stile2-<task> -b wt/stile2-<task> <HEAD>`, `node_modules` copiati
con `cp -a --reflink=auto`); Karma, build e app accesa si serializzano con `flock $LOCK`.
Integrazione a fine ondata con `git cherry-pick` nell'ordine dei task, poi revisione opus e Karma
completo una volta sul branch integrato. Al più tre task in parallelo (16 GB di RAM).

| Pezzo | Ondata | Task in parallelo | File | Perché insieme |
|---|---|---|---|---|
| A | 0 | **0** | nessuno | linea di base, dati e `foto.sh` |
| A | 1 | **1** | tutti i globali | token, carattere, tema, shell: da solo |
| A | 2 | **2** ∥ **2b** | `features/dashboard/**`, `core/services/dashboard.service.ts`, `shared/models/stati-fir.ts`, `fir-list.component.ts` (solo `nuovo`) (+ spec), commento di `e2e/tests/scadenze/flusso-scadenze.spec.ts` ∥ `apps/backend/src/application/analytics/**`, `apps/backend/src/api/dashboard/dashboard.controller.ts` | frontend ∥ backend, file disgiunti; il 2 scrive dal contratto del 2b, l'integrazione cherry-picka prima il 2b |
| A | 3 | **3** | — | revisione, PR 1 |
| B | 1 | **4** ∥ **5** | `_pagine.scss`, `_primeng.scss`, `shared/components/{azioni-riga*,skeleton-loader.component.ts}`, `shared/utils/{colonne-visibili*,pattern-liste.spec.ts}`, `e2e/utils/azioni-riga.ts` ∥ `features/auth/**` (login, signup, auth-callback, spid-login, spid-callback) | 5 non usa il pattern e non tocca i globali; `--brand-panel` è già del Task 1 |
| B | 2 | **6** ∥ **7** ∥ **8** | `features/clienti/**` **tranne** `clienti.service.ts`, `clienti.model.ts`, `vocabolario-clienti.ts`, `tabelle/{elenco-paginato,tabella-comune,tabelle-test-utils}.ts`; `listino/addebiti-list*`, `listino/tabelle/**`; `tabelle-fatturazione.spec.ts`, `archivio-addebiti.spec.ts` ∥ `features/contratti-cliente/**`, `listino/{listino-contratto,righe-tavola,elenchi-pannello}*`, `contratto-cliente.spec.ts`, `listino-contratto.spec.ts` ∥ `features/legami/{da-collegare,impostazioni-fatturazione}*` | file disgiunti; gli helper condivisi di `clienti/**` non li tocca nessuno; usano il Task 4 |
| B | 3 | **9** | `features/cer/**` | piccolo; dopo il 4 |
| B | 4 | **10** | — | revisione, PR 2 |
| C | 1 | **11** ∥ **12** ∥ **13** | `features/registry/{produttori,trasportatori,destinatari}-list*`, `e2e/pages/registry.page.ts` ∥ `features/contracts/**` ∥ `features/{pese,mud,esg,anomaly}/**` | disgiunti |
| C | 2 | **14** ∥ **15** | `features/rentri/**`, `core/services/toast.service*`, `core/interceptors/error.interceptor*` ∥ `core/guards/super-admin.guard*`, `features/{permissions,admin,billing,notifications}/**` (tranne `permissions/components/{audit-timeline,tenant-selector}`, del 16), `e2e/pages/admin-users.page.ts`, `e2e/tests/admin/impersonation.spec.ts` | disgiunti |
| C | 3 | **16** | registro, giacenze, FIR, residui di legami, registry (dialoghi), permissions (`audit-timeline`, `tenant-selector`), legal, `cer-select` + globali raccolti | tocca i globali e file di altre aree già chiuse: da solo |
| C | 4 | **17** | — | revisione, PR 3 |

**PR proposte.** PR 1 (pezzo A, Task 0-3 con il 2b): token IgniCraft, Geist, tema chiaro, shell B,
Dashboard con l'analisi dell'azienda, e il task backend 2b (bug 1-18). PR 2 (pezzo B, Task 4-10): pattern delle liste, login e richiesta d'accesso, Clienti con
Agenti, Addebiti e Tabelle, Contratti clienti e Listino, Da collegare e Impostazioni, CER (bug 21-32
sulle pagine dei clienti). PR 3 (pezzo C, Task 11-17): anagrafiche, contratti del produttore, Pese,
MUD, ESG, Anomalie, RENTRI, amministrazione, ripasso del giro 1 (bug 19, 20, 33, 34, 35 e il resto di
25-32). Conteggio: **19 task** (0-17 più il 2b, unico backend), di cui 3 di revisione e rilascio.
Ruling della scansione preliminare e decisioni D11-D13 applicati il 05/11: rapporto in
`.superpowers/sdd/2026-11-05-restyle-giro-2/ruling-applicati.md`.

## Seguiti (fuori dal giro 2)

- **Filtro per stato della lista FIR (D13).** `fir-prisma.repository.ts:168-169` filtra con
  `STATO_TO_DB` 1:1: «Bozza» non trova `AWAITING_PRODUCER`, «Consegnato» non trova `SYNCED_TO_RENTRI`.
  Va filtrato con l'insieme di stati DB di ciascun `FIRStato` (l'inverso di `DB_TO_STATO`). Backend,
  senza migration; dopo, le celle di «FIR del mese» possono diventare link al filtro.
- **`error.interceptor.ts` non registrato** (`app.config.ts:21`): decidere se montarlo o cancellarlo
  (Task 14 lo traduce soltanto).
- **Dati dell'analisi** che il giro 2 mostra ma non corregge: `getAverageSignatureTime` arrotonda
  all'ora; `getSignatureCompletionRate` conta nel totale bozze e annullati; `getRENTRISyncRate` conta
  solo `COMPLETED`; `getMonthOverMonthGrowth` usa `previousMonthEnd = new Date(y, m, 0)` e perde
  l'ultimo giorno del mese prima (la Dashboard non lo usa più, M8); `pendingFIRs` somma stati che non
  esistono (`SIGNED_BY_PRODUCER`, `IN_TRANSIT`).
- **CSP:** togliere da `nginx.conf:79` le voci di Google rimaste inutilizzate (P1).
- **Pagina «Accesso non consentito»:** contatti segnaposto (`support@wasteflow.it`, `+39 02 1234 5678`,
  `permission-denied.component.ts:410-411`) da sostituire coi contatti veri.

## Self-review (eseguita)

- **Copertura della proposta:** §1-§2 → Task 1 (e i valori nei Global Constraints); §3 B → Task 1-2 e
  il pattern del 4; §4 → Task 1 e Review Focus 1-2; §5 → tabella «Bug → task» (35 su 35); §6 righe
  1-12 e Ripasso → Task 1, 2, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16; §7 → decisioni D1-D6; §8 →
  Global Constraints (app accesa, dati di prova). Fuori perimetro come dice la proposta: la nota sui
  token di IgniCraft (§1, §7.6).
- **Nomi coerenti:** `rottaVoceAttiva`, `titoloShell`, `TITOLI_FUORI_MENU` (1) nel layout (1) e nelle
  verifiche dell'8; `contaPerStatoFir`, `ETICHETTE_STATO_FIR`, `TONO_STATO_FIR` (2) in
  `fir-mese-stati` e `fir-recenti` (2); `AzioneRiga`, `app-azioni-riga`, `colonneConDati`,
  `eseguiAzioneRiga`, `nomiAzioniRiga` (4) nei Task 6, 7, 11, 12, 15; `<app-segno-marchio>` (1) nel 5;
  `etichettaPreferenzaTema` (1) nel layout (1).
- **Dati della Dashboard:** ogni blocco ha un endpoint che esiste già (P5); il Task 2b aggiunge il
  nome della ditta e fa rispettare l'intervallo al conteggio per stato (P10), senza migration.
- **Proporzione:** il piano fissa firme, valori, testi e test; nessun corpo di componente.
