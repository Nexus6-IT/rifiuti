# Confutazione Fase 0, giro 3 (finale): esito e correzioni applicate

Data: 2026-10-21. Rapporti di ingresso: `giro-3-codice.md` (G3-C-xx) e `giro-3-dominio.md` (G3-D-xx, con il §4 delle 31 decisioni consolidate). Contesto: `giro-1-esito.md`, `giro-2-esito.md`. Piani corretti nel worktree `C:\Progetti\rifiuti-wt-fase0`, branch `fix/fase0-confronto-winwaste`:

- A: `docs/superpowers/plans/2026-10-21-fase0-a-mud.md`
- C: `docs/superpowers/plans/2026-10-21-fase0-c-integrita-registro-fir.md`
- D: `docs/superpowers/plans/2026-10-21-fase0-d-esercizio.md`
- Elenco unico delle decisioni aperte: `docs/superpowers/plans/confutazione-fase0/decisioni-per-graziano.md` (DG-01…DG-51)

Fatti verificati dal revisore capo e ricontrollati qui sul codice:

- `rentriStatoFormulario` non è mai scritto (`rentriToPersistence`, `fir-prisma.repository.ts:643-660`) né riletto (`toDomain`, `:483-504`), benché la colonna esista (`schema.prisma:399`) e l'aggregate la aggiorni (`fir.aggregate.ts:958-971`): la riconciliazione dei SYNCED (`riconcilia-stato-rentri.use-case.ts:397-398`) confronta sempre con `null`. Difetto **già in produzione**.
- `transport_date` si salva come `fir.dataPresaCarico || new Date()` (`fir-prisma.repository.ts:625`), quindi non è mai `NULL` e non è una data di trasporto affidabile. La data vera la scrive solo `FIR.presaInCarico` (`fir.aggregate.ts:516-532`), vietata sui FIR legati a RENTRI, insieme alla firma `TRASPORTATORE`.
- Verificati anche: `@sentry/node` 10.62.0 installato, con `httpIntegration({ maxIncomingRequestBodySize })` e `requestDataIntegration({ include })` (nomi `Http` e `RequestData`); `scheduledRefresh` senza `try/catch` e `safe()` che inghiotte gli errori (`reference-data-seeder.service.ts:74-78, 255-262`); il CI fa un solo `npm ci` alla radice e poi `npm run prisma:generate` in `apps/backend` (`ci.yml:69-78`); `req.user.role` restituito da `JwtStrategy.validate` (`jwt.strategy.ts:93-101`); `PartitaIva.isValid` esistente (`domain/shared/partita-iva.vo.ts:40`); valori di prova `12345678903` (partita IVA valida), `RSSMRA80A01H501U` e `RSSMRA80A01H50MM` (CF validi) calcolati con l'algoritmo ufficiale.

Ordine di merge invariato: D → C → A. Revert solo in ordine inverso.

## Regole di risoluzione (decise dal revisore capo)

| # | Regola | Dove |
|---|---|---|
| S1 | Persistere e rileggere `rentriStatoFormulario` in un task di C prima di quelli che ne dipendono, con test Postgres e oracolo RENTRI; allineare A. | C **nuovo Task 0**, Decisione 9, Interfaces dei Task 5 e 6, Review Focus 9, Verifica finale, Fuori ambito (ripopolamento); A Decisione 14, Task 4 Interfaces |
| S2 | Precompilazione della data dal FIR: scarico con la presa in carico solo se avvenuta (e la data è vera), carico con la consegna, altrimenti nessuna precompilazione; mai `transport_date` come data reale; allineare il filtro di A. | C Decisione 10, Task 10 (`dataPresaCaricoEffettiva` nel DTO, `dataOperazioneDaFir(fir, tipo)`), Review Focus 8, nota di rilascio; A Task 4 (filtro con la firma `TRASPORTATORE`, test 26) |
| S3 | Ogni scrittura di `MUDReport.reportData` sotto lock, race dell'upsert gestita, test Postgres con due salvataggi concorrenti. | A Global Constraints, Task 5 (`aggiornaReportData`, `mud-report-data.postgres.spec.ts`), Task 7 (P2002 nel deadline checker), Task 8, Task 10, Review Focus 8, Verifica finale |
| S4 | Step 0 come il CI: un solo `npm ci` alla radice, poi `npx prisma generate` in `apps/backend`. | C Global Constraints, Task 0 Step 0 (spostato dal Task 4), Task 4 Step 0 (solo verifica); A Global Constraints |
| S5 | Collegabilità del FIR prima dei controlli di unità. | A Decisione 23, Task 4 (passo 2), test 33 |
| S6 | `scheduledRefresh` (e ogni `@Cron` non elencato) nel Task 2 di D; guardiano robusto ai `@Cron` con opzioni. | D Decisione 4, Task 2 (Files, Interfaces `corpoMetodoDopoCron`, test, Step 4, README), Review Focus 9 |
| S7 | Conferma quantitativa (kg in meno/in più per motivo), snapshot per codice all'export e alla presentazione, avvisi raggruppati per codice, export con avvisi e segnatura riservati ad ADMIN/SUPER_ADMIN, conferma per codice ricalcolata dal server. | A Decisione 19, Task 3 (`riepilogaAvvisi`, `MudMovimentoSegnalato.kg`), Task 5 (403, `riepilogo` in `details` e in `esportazioni`), Task 6 (`riepilogoAvvisi`), Task 8 (`riepilogoAllaPresentazione`), Task 9 (dialogo, `testoConferma`), Review Focus 9-10 |
| S8 | Doppi storici nel MUD confrontati senza la data per i movimenti anteriori a `fir_id_ricopia`. | A Decisione 20, Task 4 (passo 0, `firIdRicopia` nella query, test 31-32), catalogo `firDoppioIdentico` con le date |
| S9 | Testo di `PIU_UNITA_LOCALI`: tutto attribuito alla sede principale, niente dichiarazioni separate con le stesse quantità. | A Decisione 13, catalogo del Task 3 e test, nota di rilascio |
| S10 | Integrazioni: intervalli di plausibilità con conferma, audit prima/dopo con l'utente, CF con carattere di controllo e partita IVA con cifra di controllo. | A Decisione 18, Task 3 (`INTERVALLI_PESO_SPECIFICO`, `pesoSpecificoPlausibile`), Task 10 (`codiceFiscaleSoggettoValido`, regole di `salva`, `differenzeIntegrazioni`, test), Task 5 (`integrazioniUsate`) |
| S11 | Bugsink senza dati personali: `sendDefaultPii: false`, `beforeSend` che toglie request data, query, header, cookie e corpo; test sullo scrubber; lettura di un evento vero al passo 7.5; ordine dei revert in `ops/README.md`. | D Decisione 5, File Structure, Task 2 (`opzioni-sentry.ts`), Review Focus 8, Task 3 Step 8 (Rollback), passo 7.5 |
| S12 | Messaggio di giacenza con il rimedio (Altro carico per il pregresso, da validare); merge di C e A come rilascio con approvazione e nota per i clienti. | C Decisione 12, Task 3 (`RIMEDIO_CARICO_MANCANTE`, test), Global Constraints, sezione «Cosa vede l'utente dopo il rilascio»; A Global Constraints e stessa sezione; D Decisioni aperte 11 |
| S13 | Ogni altro rilievo del giro 3: accolto se l'evidenza regge, altrimenti respinto con motivo; chiudere le voci parziali delle tabelle di verifica. | tabelle sotto |
| S14 | Elenco unico delle decisioni, ordinate prima/dopo l'esecuzione. | `decisioni-per-graziano.md` |

## Esito per rilievo

### Rapporto "codice e fattibilità", giro 3 (G3-C)

| ID | Esito | Dove è applicato / motivo |
|---|---|---|
| G3-C-01 | ACCOLTO | S1. C nuovo Task 0 (persistenza e rilettura, 3 test Postgres, oracolo `riconcilia-stato-rentri` rieseguito e corretto se codificava il difetto), Decisione 9 (frase "corregge la regressione" riscritta; limite dei FIR già SYNCED), Interfaces dei Task 5 e 6, Review Focus 9, Verifica finale (`git grep`), Fuori ambito (ripopolamento, DG-39); A Decisione 14 e Task 4 Interfaces. |
| G3-C-02 | ACCOLTO | S2. C Decisione 10 e Task 10 riscritto (`dataPresaCaricoEffettiva` = `dataPresaCarico` solo con la firma del trasportatore; `dataOperazioneDaFir(fir, tipo)` con test sul FIR `EMESSO` mai preso in carico); A Task 4, filtro `signatures: { some: { role: 'TRASPORTATORE' } }` e test 26. |
| G3-C-03 | ACCOLTO | S3. A `aggiornaReportData` (advisory lock `mud-report|tenant|anno`, poi `findUnique` e `upsert`), usata da export, segnatura, annullamento e integrazioni; test unitari dell'ordine lock → lettura e test Postgres con due salvataggi concorrenti, anche a record assente; `deadline-checker` con `upsert` e ripiego sul P2002 (test). |
| G3-C-04 | ACCOLTO | S4. C Task 0 Step 0 con i riferimenti a `ci.yml:69-78`; il secondo `npm ci` in `apps\backend` è tolto; Task 4 Step 0 diventa una verifica. |
| G3-C-05 | ACCOLTO | S5. A Task 4: il passo 2 (collegabilità) precede il passo 3 (unità); test 33 (`m3` su FIR annullato → solo `FIR_ANNULLATO`, nessun bloccante). |
| G3-C-06 | ACCOLTO | S6. D Task 2: `scheduledRefresh` fra gli handler senza `try/catch`, `safe()` segnala con il tag `dataset`, guardiano su `corpoMetodoDopoCron` (parentesi della chiamata `@Cron`, poi la firma del metodo) con un test su un `@Cron` con opzioni; i `catch` per utente di `checkMudDeadlines` restano nel log, limite scritto nel guardiano e in `ops/README.md`. |
| G3-C-07 | ACCOLTO + DECISIONE | S7. A Decisione 19: limite della conferma per codice scritto, riepilogo ricalcolato dal server e salvato; legare la conferma all'hash del riepilogo visto è un follow-up (DG-28). |
| G3-C-08 | ACCOLTO (superato) | Con G3-D-16 la data di registrazione è l'istante reale e `dataDelGiornoItaliano` non serve più: tolta da D (Interfaces e test del Task 5); la File Structure di D lo dice, e il coordinamento con C cita `giornoItaliano`. |
| Proporzione, passo 0 di A Task 4 ambiguo | ACCOLTO | A Decisione 20 e Task 4 passo 0: si confronta con **ogni movimento già contato** del gruppo, non con quelli scartati; test 32. |
| Proporzione, UI non testata (A Task 9, C Task 10) | ACCOLTO in parte | Le regole nuove dell'interfaccia stanno in funzioni pure con test Karma (`testoConferma`, `dataOperazioneDaFir`, `causalePredefinitaDaFir`); il resto del dialogo resta senza test automatico (e2e Playwright già fra i follow-up di A). |
| Proporzione, `firBase` di C Task 9 | RESPINTO | Il revisore lo giudica accettabile; i campi letti da `buildFIRContent` si ricavano dal metodo, e il test lo dice. |
| Proporzione, doppi `emettiConNumerazione` e catalogo di A | RESPINTO | Il catalogo è l'unica fonte del testo esatto (i test lo confrontano carattere per carattere); il doppio di test è un blocco di 6 righe ripetuto in sette classi, più chiaro scritto che descritto. |

### Rapporto "dominio, rischio ed esercizio", giro 3 (G3-D)

| ID | Esito | Dove è applicato / motivo |
|---|---|---|
| G3-D-01 | ACCOLTO | S2 (vedi G3-C-02). Evidenza confermata: `crea-fir-da-dettaglio-rentri.use-case.ts:155-169` non passa date, `presaInCarico` è vietata sui FIR legati. Anche lo stato RENTRI che prova il trasporto non dà una data vera: in quel caso nessuna precompilazione e il suggerimento. |
| G3-D-02 | ACCOLTO | C Task 10: per il CARICO la data di arrivo (`dataConsegna`), altrimenti nessuna precompilazione; test `il carico usa la data di arrivo`. |
| G3-D-03 | ACCOLTO + DECISIONE | S8. A Decisione 20 e Task 4 (confronto senza data solo fra movimenti entrambi anteriori al piano C, `firIdRicopia` nullo); messaggio con le date; test 31. DG-29. |
| G3-D-04 | ACCOLTO | S9. A Decisione 13, catalogo `piuUnitaLocali` riscritto e test; nota di rilascio. |
| G3-D-05 | ACCOLTO + DECISIONE | S10. Intervalli 0,1–3 kg/l e 10–3.000 kg/m³, conferma esplicita fuori intervallo (anche per le unità senza intervallo), voce salvata con `confermatoFuoriIntervallo`, avviso di conversione che lo dice; totale convertito in tempo reale nel form. DG-25. |
| G3-D-06 | ACCOLTO + DECISIONE | S10. `metadata.modifiche` con prima/dopo per chiave (l'utente è in `userId`), `integrazioniUsate` copiate in ogni esportazione; proporre i valori dell'anno prima resta una decisione (DG-42). |
| G3-D-07 | ACCOLTO | S10. `codiceFiscaleSoggettoValido` (partita IVA con `PartitaIva.isValid`, CF con omocodia e carattere di controllo) nel servizio, con messaggio dedicato; rifiuto del CF o della partita IVA del dichiarante. |
| G3-D-08 | ACCOLTO | A Task 4 passo 6: fusione dei DR per CF normalizzato dopo le integrazioni; test 34. Nessuna prova sul portale in più: con la fusione il file non ha più DR duplicati. |
| G3-D-09 | DECISIONE (predefinito applicato) | S7. Export con avvisi e segnatura solo `ADMIN`/`SUPER_ADMIN` (403 `MUD_CONFERMA_RISERVATA_AMMINISTRATORI`), senza avvisi aperto a tutti; test. DG-27. |
| G3-D-10 | ACCOLTO | S7. Riepilogo quantitativo per codice, avvisi informativi chiusi di default, casella che ripete i kg, snapshot all'export e alla presentazione. |
| G3-D-11 | ACCOLTO | A Decisione 22, Task 8 (`fileTracciato`), Task 9 (etichetta), test. DG-33. |
| G3-D-12 | ACCOLTO + DECISIONE | S12. C Decisione 12, Task 3 (`RIMEDIO_CARICO_MANCANTE` in entrambi i testi, test). Da validare con un consulente (DG-16). |
| G3-D-13 | ACCOLTO in parte + DECISIONE | Testo dell'avviso riformulato (C Task 3: "il carico che lo copre è annotato con una data successiva", senza chiedere una correzione impossibile); salvarlo nelle `notes` resta una decisione che può aspettare (C Decisione 15, DG-38). |
| G3-D-14 | ACCOLTO | C Task 5: messaggio `BOZZA` con la via d'uscita, test aggiornati. |
| G3-D-15 | DECISIONE | C Decisione 14: (a) accettato per la Fase 0 (DG-17); (b) causale del rientro di un respinto non definita, follow-up della Fase 2 (DG-37). |
| G3-D-16 | ACCOLTO + DECISIONE | C Decisione 10 e Task 10: istante reale, confronti e ritardo di legge sul giorno italiano (`giorniItalianiFra`, test sul ritardo a cavallo della mezzanotte); nota sull'import della Fase 3. DG-18. |
| G3-D-17 | ACCOLTO | S11. D Decisione 5, `opzioni-sentry.ts` con test, passo 7.5 con la lettura del JSON dell'evento e l'istruzione di fermarsi se compaiono dati personali. DG-04. |
| G3-D-18 | DECISIONE | D Decisioni aperte 10 (DG-44): il rilievo lo dichiara facoltativo, e la scelta fra `warning`, `fingerprint` o esclusione dipende da come il job dei certificati notifica il cliente. |
| G3-D-19 | ACCOLTO | D Global Constraints e Task 3 Step 8 (ordine dei revert, revert del revert, chiavi di `reportData` dopo un revert di A); C e A Global Constraints. |
| G3-D-20 | ACCOLTO | S12. C e A Global Constraints (merge = rilascio con approvazione), sezioni «Cosa vede l'utente dopo il rilascio» con il testo per i clienti, Verifica finale; D Decisioni aperte 11. DG-01. |
| G3-D-21 | DECISIONE (predefinito applicato) | C Decisione 13 e Task 10 (`causalePredefinitaDaFir`, nessuna causale con il ruolo non riconosciuto, test). DG-20. Chiude il rischio residuo del giro 2 (G2-D-02). |

### Voci parziali delle tabelle di verifica del giro 3

| ID | Esito | Dove |
|---|---|---|
| G2-C-02 (riserva) | ACCOLTO | Chiusa da G3-C-04. |
| G2-C-06, G1-C-14 (riserva) | ACCOLTO | Chiuse da G3-C-06. |
| G2-C-08 (inefficace nel codice) | ACCOLTO | Chiusa da G3-C-01 (C Task 0). |
| G1-D-10 (parziale) | ACCOLTO | Il ramo "annullato all'ente" funziona dopo il C Task 0; per i FIR già SYNCED resta il limite di DG-39. |
| G2-D-02 (parziale) | ACCOLTO | Causale predefinita tolta con il ruolo non riconosciuto (G3-D-21). |
| G2-D-08 (parziale accettato) | invariato | Conferma all'annullamento ancora follow-up (DG-21). |
| G2-D-09 (difetto nuovo) | ACCOLTO | Chiusa da G3-D-01 e G3-D-02. |
| G2-D-12 (parziale) | ACCOLTO | Chiusa da G3-D-03. |
| G2-D-13, G1-D-07 (parziali) | ACCOLTO | Chiuse da G3-D-04. |
| G1-D-08 | DECISIONE | DG-32. |

## Conteggi

- G3-C: 8 rilievi, 8 accolti (G3-C-07 con una decisione, G3-C-08 superato da G3-D-16), 0 respinti; delle osservazioni sulla proporzione 2 accolte (una in parte) e 2 respinte con motivo.
- G3-D: 21 rilievi. 17 accolti (01, 02, 03, 04, 05, 06, 07, 08, 10, 11, 12, 13 in parte, 14, 16, 17, 19, 20; di questi 6 portano anche una decisione: 03, 05, 06, 12, 13, 16). 4 decisioni (09 e 21 con il predefinito applicato nei piani, 15 e 18 lasciate al predefinito attuale). 0 respinti.
- Decisioni aperte consolidate: 51 (`decisioni-per-graziano.md`), di cui **35 da prendere prima dell'esecuzione** e 16 che possono aspettare; le 31 del §4 del giro 3 sono tutte mappate.

## Task aggiunti o cambiati

- **D (7 task):** Task 2 (`opzioni-sentry.ts`, `scheduledRefresh`, `safe()`, guardiano robusto, README); Task 3 Step 8 (ordine dei revert); Task 5 (via `dataDelGiornoItaliano`); Task 7 passo 7.5 (prova con le opzioni vere e lettura del JSON dell'evento); Decisione 5 riscritta, Decisioni aperte 10 e 11, Review Focus 8-9.
- **C (11 task):** **nuovo Task 0** (stato del formulario RENTRI salvato e riletto; installazione locale come in CI); Task 3 (rimedio e testo dell'avviso); Task 4 (Step 0 ridotto a verifica); Task 5 (messaggio `BOZZA`, dipendenza dal Task 0); Task 6 (dipendenza dal Task 0); Task 10 riscritto (istante reale, ritardo sui giorni italiani, `dataPresaCaricoEffettiva`, data per tipo, causale predefinita); Decisioni 9, 10 riscritte e nuove 12-15; Global Constraints (Step 0, revert, rilascio); Review Focus 8-9; nota di rilascio; Fuori ambito.
- **A (10 task):** Task 3 (`riepilogaAvvisi`, `kg` nei movimenti segnalati, `movementDate`, intervalli del peso specifico, testi di `piuUnitaLocali`, `firDoppioIdentico`, `convertitoConPesoSpecifico`); Task 4 (ordine collegabilità → unità, doppi storici senza data, fusione dei DR, filtro dei FIR dell'anno, test 31-34); Task 5 (`aggiornaReportData` con test Postgres, 403, riepilogo, integrazioni usate); Task 6 (`riepilogoAvvisi`); Task 7 (P2002); Task 8 (`aggiornaReportData`, riepilogo, `fileTracciato`); Task 9 (dialogo quantitativo, `testoConferma`, 403); Task 10 (CF e partita IVA con controllo, plausibilità, storico delle modifiche); Decisioni 13, 14, 18, 19, 20 riscritte e nuove 22-23; Global Constraints (lock, rilascio, revert); Review Focus 8-11; nota di rilascio; Fuori ambito.

## Rischi residui

- I FIR già `SYNCED` prima del rilascio di C restano con `rentri_stato_formulario` a `NULL`: un loro annullamento o respingimento all'ente non produce avvisi, e il campionamento li segnala come divergenti finché non si decide un ripopolamento (DG-39).
- `transport_date` resta un ripiego nel database: chi la legge altrove (report, esportazioni non toccate dalla Fase 0) continua a vedere la data di creazione per i FIR non presi in carico (DG-40).
- I FIR trasportati solo su RENTRI non contano fra quelli "con trasporto nell'anno": `FIR_NON_REGISTRATO` e `REGISTRO_VUOTO_CON_FIR` possono non scattare per loro.
- La conferma degli avvisi vale per codice: un caso nuovo dello stesso codice fra il caricamento della pagina e il download è coperto senza essere stato visto (il riepilogo salvato è però quello vero).
- I nomi delle opzioni di `@sentry/node` sono verificati sulla 10.62.0: un aggiornamento dell'SDK va seguito dalla lettura di un evento vero; `ripulisciEventoSentry` resta la rete di sicurezza.
- Il rigetto da parte del portale di un DR senza CF non è ancora provato (Verifica finale di A).
- Tutte le query informative misurano il VPS di collaudo; le scelte su unità, saldi e doppi andranno riviste sui dati WinWaste (Fase 3).
- Il dialogo di conferma e i form restano senza test automatici di interfaccia (Karma solo sulle funzioni pure; nessun test frontend è in un gate).
