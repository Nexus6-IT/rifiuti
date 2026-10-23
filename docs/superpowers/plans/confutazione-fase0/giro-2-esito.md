# Confutazione Fase 0, giro 2: esito e correzioni applicate

Data: 2026-10-21. Rapporti di ingresso: `giro-2-codice.md` (G2-C-xx, con la verifica del giro 1) e `giro-2-dominio.md` (G2-D-xx, con la verifica dei G1-D). Contesto: `giro-1-esito.md`. Piani corretti nel worktree `C:\Progetti\rifiuti-wt-fase0`, branch `fix/fase0-confronto-winwaste`:

- A: `docs/superpowers/plans/2026-10-21-fase0-a-mud.md`
- C: `docs/superpowers/plans/2026-10-21-fase0-c-integrita-registro-fir.md`
- D: `docs/superpowers/plans/2026-10-21-fase0-d-esercizio.md`

Fatto verificato dal revisore capo e ricontrollato qui: `CreaFIRDaDettaglioRENTRIUseCase.creaDaDettaglio` crea i FIR presi da RENTRI con `FIR.create(props)` (`application/rentri/crea-fir-da-dettaglio-rentri.use-case.ts:169`), che parte da `DRAFT` fino alla riconciliazione delle 6 ore. G2-D-01 è reale.

Ordine di merge invariato: D → C → A.

## Regole di risoluzione (decise dal revisore capo)

| # | Regola | Dove |
|---|---|---|
| R1 | FIR **collegabile** = emesso in locale **oppure** con `rentriNumeroFir` e non annullato all'ente. Modulo unico puro `domain/fir/stati-fir.ts` (elenco positivo, fail-closed sugli stati sconosciuti, `etichettaFir` unica), usato da C (collegamento, autocompletamento) e da A (inclusione nel MUD). | C Decisione 9, Task 5 (backend, DTO di risposta del FIR, `registro-fir.ts` con test Karma, filtro di `caricaFir`); A Decisione 14, Task 2 (elenco tolto), Task 3 (`etichettaFir` tolta), Task 4 |
| R2 | Export e segnatura richiedono la conferma esplicita dei codici di avviso (422 `MUD_AVVISI_DA_CONFERMARE` con i codici mancanti in `details`); i codici si salvano con l'esportazione e alla presentazione. `PROFILO_NON_SUPPORTATO` e `PIU_UNITA_LOCALI` diventano avvisi che dicono quali moduli o unità mancano. | A Decisioni 2, 13, 19; Task 3 (`codiciAvvisoDaConfermare`, `avvisiNonConfermati`), Task 5, Task 8, Task 9 |
| R3 | Integrazioni MUD in `MUDReport.reportData` (nessuna migration): CF per destinatario e peso specifico per CER e unità. Con le integrazioni, DR senza CF e quantità non di massa senza peso specifico diventano **bloccanti correggibili** con il punto esatto in cui correggere; con l'integrazione la quantità si converte ed entra. Citato il tracciato (record BB, esenzione solo per RT da privati, righe 2238-2239). Giacenze al 31/12 restano decisione e follow-up. | A Decisioni 3, 6, 18; Task 3 (`mud-integrazioni.ts`, catalogo), Task 4, nuovo Task 10; Verifica finale (prova sul portale) |
| R4 | Giacenza: blocco solo se il saldo complessivo (a qualunque data) scende sotto zero o è già negativo; l'ordine delle date sbagliato è un avviso restituito al client e scritto nel log. Garanzia di concorrenza invariata. | C Decisione 8, Task 2 (SQL con `saldo_totale`), Task 3 (regola, messaggi, `MovimentoRegistrato.avvisi`, test), Task 4 (toast), Review Focus 1-4 |
| R5 | `registrationDate` fissata dal server (giorno italiano) e ignorata se mandata dal client; `movementDate` del client; la ricopia FIR → registro precompila `movementDate` con la data di presa in carico del FIR. Effetto sull'anno del progressivo annotato. | C Decisione 10, nuovo Task 10; D Task 5 (`dataDelGiornoItaliano`) |
| R6 | MUD: doppi storici identici contati una volta con avviso; FIR annullato dopo la ricopia: avviso nel MUD e nella pagina giacenze, correzione vera come follow-up. | A Decisioni 20, 21; Task 3, Task 4; C Decisione 11, Task 6, Fuori ambito |
| R7 | `segnalaErroreJob` su tutti gli 11 `@Cron` (compreso `allineamentoSchedulato`), anche nei `catch` per tenant dei job RENTRI con il tag `tenantId`; guardiano che fallisce su un `@Cron` senza segnalazione; i 503 di `/health` non vanno a Bugsink. | D Decisione 4, Review Focus 6-7, Task 2 |
| R8 | Rollback = `git revert` del merge più pipeline intera; l'input `tag` del deploy è una decisione; cartella di staging creata sul server prima del primo deploy; query informative da eseguire prima delle conferme, sapendo che il VPS è di collaudo. | D Task 3 Step 8, Task 7 (7.1, 7.1b), Decisioni aperte 9; C Global Constraints (Rollback, caso di Capodanno), Decisioni (premessa sulle query) |
| R9 | Correzioni di codice: G2-C-01 (metodo deprecato fino al Task 9), G2-C-02 (junction), G2-C-03 (`formattaQuantita`), G2-C-04 (`Prisma.Decimal` e `maxDecimalPlaces: 2`), G2-C-05 (`TZ='UTC'` e `useRealTimers`), G2-C-10, 11, 13, 14. | vedi tabella |

## Esito per finding

### Rapporto "codice e fattibilità", giro 2 (G2-C)

| ID | Esito | Dove è applicato / motivo |
|---|---|---|
| G2-C-01 | ACCOLTO | C Task 8: `generateNumeroProgressivo` resta `@deprecated` in interfaccia, repository e doppi, così ogni commit compila e `emetti-fir.use-case.spec.ts` passa; Task 9 cambia lo use case e toglie il metodo nello stesso commit; Step 5 del Task 8 riscritto; File Structure aggiornata. |
| G2-C-02 | ACCOLTO | C Global Constraints (`node_modules` del worktree) e Task 4 Step 0 (rimozione delle junction con `cmd /c rmdir`, `npm ci` locale, `prisma generate` locale, verifica); Verifica finale controlla che il client del checkout principale non contenga `fir_id_ricopia`; A Global Constraints. |
| G2-C-03 | ACCOLTO | C Task 3: `core/format/formatta-quantita.ts` con `useGrouping: 'always'` (cast documentato per TypeScript 5.4) e test con valori indipendenti dalla versione ICU; C e A Global Constraints (unico modo di formattare); A Task 3 lo consuma; Verifica finale di A cerca `toLocaleString('it-IT'` nel modulo MUD. |
| G2-C-04 | ACCOLTO | C Task 4: `application/registro/ricopia-fir.ts` (`quantitaComeInDatabase` con `Prisma.Decimal` e `ROUND_HALF_UP`, `stessiDatiRicopia`), test con `1.005`; DTO `@IsNumber({ maxDecimalPlaces: 2 })` con test; Decisione 2 e Review Focus 5. |
| G2-C-05 | ACCOLTO | C Task 9 Step 1: `describe` con `TZ='UTC'` in `beforeAll`/`afterAll` e `useRealTimers` in `afterEach`. |
| G2-C-06 | ACCOLTO | D Decisione 4 e Task 2: 11 handler elencati con i metodi, `allineamentoSchedulato` smette di rilanciare (log e segnalazione, test nuovo), guardiano `ogni metodo @Cron dei sorgenti chiama segnalaErroreJob`. |
| G2-C-07 | ACCOLTO | D Decisione 4 (eccezione per `/health`, scelta predefinita da confermare), Task 2 Interfaces, test `non invia a Bugsink i 503 delle rotte di health`, Review Focus 7, README. |
| G2-C-08 | ACCOLTO | C Task 5: `registro-fir.ts` (`firCollegabileNelRegistro`) con test Karma e filtro in `caricaFir`; `rentriStatoFormulario` aggiunto alla risposta del FIR e al modello frontend. |
| G2-C-09 | ACCOLTO | C Task 5: `domain/fir/stati-fir.ts` puro, elenco positivo, fail-closed (`STATO_SCONOSCIUTO`, test con stato assente), `etichettaFir` unica; A importa da lì (Global Constraints, Task 2, 3, 4). |
| G2-C-10 | ACCOLTO | Verifiche finali di C e A: pattern `export const ALIAS_KG` (più gli altri simboli condivisi). |
| G2-C-11 | ACCOLTO | C Task 1 `simboloUnita`; C Task 3: unità dal valore normalizzato, testo dedicato per il saldo già negativo, test `con l'unità vuota il messaggio scrive kg` e `con il saldo complessivo già negativo il messaggio lo dice`. |
| G2-C-12 | ACCOLTO | C Task 10: l'entità confronta registrazione e operazione sul giorno italiano (test); con la data di registrazione fissata dal server a mezzanotte UTC del giorno italiano il caso dei client API è chiuso. |
| G2-C-13 | ACCOLTO | A Task 7: asserzioni su `logger.debug` del salto (65 giorni), `logger.error` e `Sentry.captureException` non chiamati; Step 3 conserva il messaggio di `debug`. |
| G2-C-14 | ACCOLTO | D Decisione aperta 8 senza `fir-prisma.repository.ts:385` (con la nota che lo toglie C); C cita i blocchi di `registra-movimento.use-case.ts` per commento (Task 3, 5, Global Constraints) e D Global Constraints fa lo stesso. |

### Rapporto "dominio, rischio ed esercizio", giro 2 (G2-D)

| ID | Esito | Dove è applicato / motivo |
|---|---|---|
| G2-D-01 | ACCOLTO | R1. C Decisione 9 riscritta, Task 5 (`collegabilitaFir`, test sul FIR `DRAFT` con numero RENTRI e su quello annullato all'ente), Review Focus 6; A Decisione 14, Task 4 test 13 e 15, Review Focus 2. La riconciliazione subito dopo l'acquisizione resta un follow-up di C (non serve più alla regola). |
| G2-D-02 | DECISIONE | R2. Strada (b) adattata: `PROFILO_NON_SUPPORTATO` è un avviso da confermare, i carichi ricevuti restano fuori dal file e il messaggio dice che mancano RT, RE e MG (A Decisione 13, Task 3, Task 4 test 8). La causale predefinita del form quando il ruolo non è riconosciuto **non** è cambiata: non era nelle regole del giro, resta un rischio residuo. |
| G2-D-03 | ACCOLTO + DECISIONE | R3. A Decisioni 3 e 18, Task 3 (bloccante con `integrazione`), Task 4 test 17, 18 e 23, Task 10; prova sul controllo di formato di mudtelematico.it nella Verifica finale. Le integrazioni coprono il CF, non comune e indirizzo (follow-up). |
| G2-D-04 | ACCOLTO + DECISIONE | R3. A Decisione 6, Task 3 (`unitaNonDiMassa` per CER e unità, bloccante; `convertitoConPesoSpecifico`), Task 4 test 2-4, Task 10, Review Focus 1. |
| G2-D-05 | ACCOLTO | A Task 3: testi di `giacenzeNonCalcolate`, `operazioneNonIndicata` e `profiloNonSupportato` riscritti; `destinatarioSenzaCf` ora dice dove si completa; il test vieta anche "prima dell'invio", "va corretto", "va completato". |
| G2-D-06 | ACCOLTO (parte) + DECISIONE | R2. A Decisione 19, Task 5, 8, 9. Non applicato il "totale escluso per CER" nel riepilogo: ogni avviso elenca già movimenti e quantità; resta nei follow-up di A. |
| G2-D-07 | ACCOLTO + DECISIONE | R4. C Decisione 8, Task 2-3, Review Focus 2 e 4; la data di taglio resta l'alternativa per Graziano. |
| G2-D-08 | ACCOLTO (parte) | R6. Avviso nel MUD (`FIR_ANNULLATO`, già presente) e nella pagina giacenze (C Task 6, `scarichiSuFirAnnullati`, test backend e Karma); conferma all'annullamento ed esclusione dal calcolo di giacenza come follow-up (C Decisione 11, Fuori ambito). |
| G2-D-09 | ACCOLTO (parte) + DECISIONE | R5. C Decisione 10 e Task 10 (data di registrazione dal server, data di presa in carico nella ricopia, test); D Task 5 (`dataDelGiornoItaliano`). L'avviso di A sull'anno del trasporto diverso dall'anno del movimento non è applicato: follow-up di A. |
| G2-D-10 | ACCOLTO | R7. D Task 2: `segnalaErroreJob(job, errore, tag)` nei `catch` per tenant dei tre job RENTRI, test sul job di riconciliazione. |
| G2-D-11 | ACCOLTO + DECISIONE | R8. D Task 3 Step 8 (rollback con `git revert` e durata), Decisione aperta 9 (input `tag`); C Global Constraints (caso di Capodanno). |
| G2-D-12 | ACCOLTO + DECISIONE | R6. A Decisione 20, Task 3 (`firDoppioIdentico`), Task 4 test 20-21 con `stessiDatiRicopia` del piano C, Review Focus 7. La pagina giacenze continua a contarli: follow-up. |
| G2-D-13 | ACCOLTO + DECISIONE | R2. Strada (a) adattata: avviso da confermare, file come unica unità locale, messaggio con l'elenco delle sedi e di quelle senza dichiarazione propria (A Decisione 13, Task 3, Task 4 test 9). La stima dei tenant colpiti non è stata aggiunta (il VPS è di collaudo, misurerebbe dati di prova). |
| G2-D-14 | ACCOLTO | Evidenza verificata (il DTO accetta istanti con l'ora). C Task 2: raggruppamento per giorno italiano (`AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome'`) con due test; query informativa del Task 3 allineata. |
| G2-D-15 | ACCOLTO | Evidenza verificata (`pdf.service.ts:117-119`). C Task 9: "Numero FIR" = `rentriNumeroFir` se c'è, `Riferimento interno` per `firNumber`, con test. |
| G2-D-16 | ACCOLTO | R8. D Task 3 Step 4 (`mkdir -p` prima del controllo dello spazio), Task 7 passo 7.1 (inventario di `/opt/rifiuti/site/backups`) e 7.1b (cartella di staging, marcato [SERVER]). |
| G2-D-17 | ACCOLTO | Risolto con l'esclusione dei 503 di `/health` (vedi G2-C-07); i limiti di ingestione di Bugsink non servono più a questo scopo. |
| G2-D-18 | ACCOLTO | R8. C: premessa alle Decisioni, Decisioni 4 e 8, Step delle query rinominati "da eseguire prima di confermare", con la nota sul VPS di collaudo e la ripetizione sui dati WinWaste in Fase 3; Verifica finale. |

### Voci del giro 1 rimaste parziali o non risolte

| ID | Esito | Dove è applicato / motivo |
|---|---|---|
| G1-C-14 | ACCOLTO | Chiuso da G2-C-06 (11 handler, `allineamentoSchedulato`, guardiano). |
| G1-C-17 | ACCOLTO | Chiuso da G2-C-04 (`Prisma.Decimal`, DTO a 2 decimali, test con `1.005`). |
| G1-D-01 | ACCOLTO | Chiuso da G2-D-02: nessun blocco resta su dati che l'utente non può correggere nell'applicazione. |
| G1-D-02 | ACCOLTO | Chiuso da G2-D-03 (integrazioni, bloccante correggibile, messaggio con il punto esatto). |
| G1-D-05 | ACCOLTO | Chiuso da G2-D-07 (blocco solo sul saldo complessivo). |
| G1-D-06 | ACCOLTO | Il blocco che colpiva anche i produttori con una causale sbagliata è diventato un avviso (G2-D-02). |
| G1-D-07 | ACCOLTO | Il blocco è diventato un avviso con l'elenco delle sedi (G2-D-13). |
| G1-D-08 | DECISIONE | Messaggio corretto (G2-D-05); il calcolo delle giacenze al 31/12 resta decisione e follow-up (A Decisioni 16 e 18). |
| G1-D-10 | ACCOLTO | Parte 1 chiusa da G2-D-01 (regressione eliminata); parte 2 in parte da G2-D-08, il resto è follow-up. |
| G1-D-13 | ACCOLTO | Residuo chiuso da G2-D-15 (etichette del PDF). |
| G1-D-15 | ACCOLTO | Chiuso da G2-D-10. |
| G1-D-31 | ACCOLTO + DECISIONE | Chiuso da G2-D-11 (procedura reale con `git revert`; input `tag` come decisione). |

## Conteggi

- G2-C: 14 accolti, 0 respinti.
- G2-D: 18 trattati: 9 accolti senza decisione (G2-D-01, 05, 10, 14, 15, 16, 17, 18 e G2-D-08 in parte), 8 accolti con una decisione per Graziano (G2-D-03, 04, 06, 07, 09, 11, 12, 13), 1 decisione (G2-D-02); 0 respinti. Accolti solo in parte, con il resto nei follow-up: G2-D-06, G2-D-08, G2-D-09.
- Voci del giro 1 riprese: 12, tutte chiuse o ricondotte a una decisione (G1-D-08, G1-D-31).

## Task aggiunti o cambiati

- **C:** Task 2 e 3 riscritti (saldo complessivo, giorno italiano, avvisi, `formattaQuantita`); Task 1 (`simboloUnita`); Task 4 (Step 0 sulle junction, `ricopia-fir.ts`, DTO); Task 5 riscritto (`stati-fir.ts`, autocompletamento); Task 6 (scarichi su FIR annullati); Task 8 (metodo deprecato); Task 9 (rimozione del metodo, `TZ`, PDF); **nuovo Task 10** (data di registrazione dal server, data del FIR nella ricopia, entità sul giorno italiano).
- **A:** Task 2 (stati del FIR tolti); Task 3 e 4 riscritti (catalogo, `mud-integrazioni.ts`, collegabilità, doppi identici, unità locali, integrazioni); Task 5 riscritto (conferma degli avvisi, traccia dell'esportazione, parametro del controller); Task 6 (test del PDF); Task 7 (asserzioni contro l'errore inghiottito); Task 8 (conferma alla segnatura); Task 9 riscritto (dialogo di conferma, 422 con `Blob`); **nuovo Task 10** (integrazioni MUD, backend e frontend).
- **D:** Task 2 (11 handler, `catch` per tenant, guardiano, esclusione di `/health`); Task 3 (`mkdir -p`, rollback reale); Task 5 (`dataDelGiornoItaliano`); Task 7 (7.1 inventario, nuovo 7.1b); Decisioni aperte 8 e 9.

## Rischi residui

- La causale predefinita `INGRESSO_ESTERNO` del form, quando il ruolo non si riconosce, continua a produrre carichi "ricevuti da terzi" per errore: ora generano un avviso e non un blocco, ma il MUD li esclude.
- Il rigetto da parte del portale di un DR senza CF non è verificato: lo decide la prova della Verifica finale di A.
- `FIR_NON_REGISTRATO` non vede i FIR presi da RENTRI ancora `DRAFT` in locale (scelta per non dare falsi positivi ai destinatari).
- Gli avvisi di ordine delle date nel registro restano solo nella risposta e nel log, non sul movimento.
- L'autocompletamento del registro carica al massimo 200 FIR.
- Tutte le query informative misurano il VPS di collaudo: le scelte su unità, saldi e doppi andranno riviste sui dati WinWaste.
