# Fase 0, piano C: integrità di registro e FIR (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** il saldo complessivo del registro non va sotto zero per colpa di uno scarico nuovo, nemmeno con due scarichi concorrenti e con kg e tonnellate mescolati (un ordine di date incoerente produce un avviso, non un blocco); un movimento si collega solo a un FIR **collegabile** (emesso in locale, oppure con numero RENTRI e non annullato all'ente); il riferimento interno del FIR è unico e progressivo per tenant e anno di emissione anche sotto concorrenza; stato del FIR e firme si salvano insieme o per niente; un FIR si ricopia nel registro al massimo una volta per tipo di movimento, **da qui in avanti**, senza toccare le annotazioni già registrate; la data di registrazione la fissa il server, e la ricopia porta la data del FIR solo quando è una data vera (presa in carico registrata in WasteFlow per lo scarico, consegna per il carico); lo stato del formulario presso RENTRI (`rentriStatoFormulario`) si salva e si rilegge davvero, cosa che oggi non avviene.

**Architettura:** per primo (Task 0) si corregge un difetto preesistente del repository dei FIR, che non scrive né rilegge `rentriStatoFormulario`: tutto ciò che in questo piano e nel piano A dipende dallo stato dell'ente (FIR annullato all'ente, esito respinto, riconciliazione dei FIR sincronizzati) oggi vedrebbe sempre `null`. Poi un modulo condiviso di unità di misura (`domain/waste-movement/unita-misura-registro.ts`) e un modulo condiviso degli stati del FIR (`domain/fir/stati-fir.ts`, elenco positivo e fail-closed, con `etichettaFir`), entrambi usati anche dal piano A. Il controllo di giacenza entra nella transazione di `RegistraMovimentoUseCase`, dopo un advisory lock per tenant e CER: una query SQL calcola in kg sia il saldo complessivo (che decide il blocco) sia il saldo per giorno italiano dalla data dello scarico in poi (che produce soltanto un avviso restituito al client e scritto nel log); gli scarichi in unità non di massa saltano il controllo con un warning nel log. La numerazione interna dei FIR si sposta in un nuovo metodo del repository, `emettiConNumerazione`, che in un'unica transaction prende un advisory lock per tenant e anno, ricontrolla lo stato in database, calcola `MAX()+1` numerico sul prefisso `FIR-<anno>-` e salva FIR e firme. `save` diventa atomico. L'unicità della ricopia FIR → registro vale solo per i movimenti registrati dopo il deploy: una colonna nuova `fir_id_ricopia`, valorizzata soltanto dalle ricopie nuove, porta un indice unico; un controllo idempotente dentro la transaction (regola di confronto in `application/registro/ricopia-fir.ts`, condivisa con il piano A) copre anche i movimenti storici.

**Tech Stack:** NestJS 10, Prisma 5.8, PostgreSQL 16, Jest 29 + ts-jest (backend), Angular 17 + Karma (frontend, Task 4, 5, 6 e 10).

**Spec:**
- `C:\Progetti\winwaste\docs\confronto-con-rifiuti.md` §4 punti 3, 4, 5 e §7 Fase 0
- `C:\Progetti\winwaste\docs\confronto-rifiuti\01-registro-fir-giacenze.md`: G1, G7, F3, F9 (§1), §3.1 punti 7-8, D2b, D13, D17, D20, D21 (§4), raccomandazioni 1, 2 e 8 (§6)
- Piano collegato, da non contraddire: `docs/superpowers/plans/2026-09-12-collegamento-scorta-emissione.md` (numero vidimato RENTRI all'emissione: si innesta nello stesso punto, `emetti-fir.use-case.ts` passo 3)
- Esito dei giri di revisione: `docs/superpowers/plans/confutazione-fase0/giro-1-esito.md`, `docs/superpowers/plans/confutazione-fase0/giro-2-esito.md`, `docs/superpowers/plans/confutazione-fase0/giro-3-esito.md`; decisioni aperte consolidate in `docs/superpowers/plans/confutazione-fase0/decisioni-per-graziano.md`

## Decisioni per Graziano

Da confermare prima dell'esecuzione. Il piano è scritto con l'opzione indicata come predefinita. Le voci marcate **(scelta predefinita adottata, da confermare)** sono state decise dal revisore dopo il primo o il secondo giro.

**Prima di confermare** le Decisioni 3, 4 e 8 vanno eseguite le query informative (Task 1 Step 6, Task 3 Step 8, Task 4 Step 6), sola lettura e con l'approvazione di Graziano: sono i dati su cui si conferma la scelta, non un allegato da produrre dopo. **Il VPS attuale è un server di sviluppo e collaudo** (nota del 16/09/2026): le query misurano dati di prova, non clienti reali. Vanno ripetute sui dati WinWaste nella Fase 3 (migrazione).

1. **Quantità della ricopia FIR → registro (NON implementata).** Oggi il form del registro precompila la quantità **dichiarata** del FIR (`registro.component.ts:1266-1275`, `quantity: r.quantita`), non il peso verificato a destino (`effectiveWeight`). Opzioni: (a) usare il peso a destino quando il FIR è `CONSEGNATO`, la quantità dichiarata altrimenti; (b) lasciare la dichiarata e mostrare il peso a destino come suggerimento. Dipende anche dalla revisione della regola ±10% (`fir.aggregate.ts:552`), fuori ambito. Consiglio: (a), ma dopo la decisione sul ±10%.
2. **Ricopia ripetuta dello stesso FIR.** Predefinito: se arriva una seconda richiesta con lo stesso `firId` e tipo e **gli stessi dati** (CER, quantità arrotondata a 2 decimali con `Prisma.Decimal` e `ROUND_HALF_UP`, come la salva la colonna `numeric(10,2)`, unità normalizzata, data), si restituisce il movimento esistente con `giaRegistrato: true` (retry dopo un timeout) e il frontend dice "già registrato nel movimento N"; se i dati differiscono, errore `Il FIR è già registrato nel movimento n. N/AAAA`. Alternativa: errore sempre.
3. **Doppi FIR → registro già presenti: nessuna correzione** **(scelta predefinita adottata, da confermare).** Il registro è immutabile (solo `POST` e `GET` nel controller, nessun `update`/`delete` di `wasteMovement` nel codice) e le rettifiche arrivano in Fase 2: cancellare un doppio vorrebbe dire alterare un'annotazione legale e lasciare un buco nel progressivo. Quindi la migration **non può fallire** sui dati esistenti: aggiunge la colonna nullable `fir_id_ricopia`, valorizzata solo per le ricopie registrate dopo il deploy, con l'indice unico `(tenant_id, fir_id_ricopia, type)`; le righe storiche hanno `NULL` e non collidono. Il controllo idempotente nello use case legge invece `fir_id`, quindi vede anche i movimenti storici. La query del Task 4, Step 6 elenca i doppi storici **solo a titolo informativo** (allegarla alla PR). Il vincolo non lega le rettifiche della Fase 2: una rettifica lascerà `fir_id_ricopia` a `NULL`.
4. **Unità di misura** **(scelta predefinita adottata, da confermare).** Un solo modulo per registro, giacenze e MUD (questo Task 1; il piano A lo importa). Famiglia di massa: `KG` (alias `KILOGRAMMI`, `KILOGRAMMO`; unità vuota = KG, segnalata come tale) e `T` (alias `TON`, `TONNELLATE`, `TONNELLATA`, ×1000). Ogni altra unità (`M3`, `LITRI`, `L`, …) **non è di massa**: nel controllo di giacenza uno scarico non di massa **salta il controllo** con un warning nel log (oggi passa comunque; l'utente non può scegliere l'unità dei carichi, `registro.component.ts:1131`, quindi un rifiuto in m³ ricopiato da FIR non avrebbe mai giacenza); nella pagina giacenze le altre unità stanno a parte; nel MUD si convertono in kg con il peso specifico per CER inserito nelle integrazioni del MUD (piano A), e senza peso specifico bloccano il file con un messaggio che dice dove inserirlo. Prima della conferma, la query del Task 1, Step 6 elenca le unità distinte presenti in `waste_movements` e `firs` (informativa).
5. **Firma senza `userId`.** Oggi `persistSignatures` la salta con un warning e il FIR passa comunque di stato (`fir-prisma.repository.ts:297-303`). Con il salvataggio atomico il piano la rende **bloccante** (`FirmaSenzaUtenteError`, nessuna scrittura). Nel flusso reale non accade (gli use case valorizzano sempre `userId`, e al reload le firme si ricostruiscono da `fir_signatures`, che ha la FK `user_id` obbligatoria); se si preferisce il comportamento attuale, il Task 7 Step 1 perde un test e `persistSignatures` resta tollerante.
6. **Anno del numero FIR e del registro.** Anno solare **italiano** dell'istante (`annoSolareItaliano`), importato da `apps/backend/src/core/time/anno-italiano.ts`, creato dal piano D (Task 5) e già in `master` quando si esegue questo piano (ordine D → C → A). Questo piano **non** ridefinisce la funzione. Il progressivo del registro usa già `annoSolareItaliano(command.registrationDate)` dopo il piano D: la transaction riscritta qui lo mantiene.
7. **Quale numero del FIR è quello legale** **(dipendenza aperta, scelta predefinita adottata, da confermare).** In regime RENTRI il numero legale è quello vidimato (`RentriNumeroVidimato`, `FIR.rentriNumeroFir`); `FIR-AAAA-NNNNNN` è un **riferimento interno**. Il piano della scorta (`2026-09-12-collegamento-scorta-emissione.md`, suo Task 1) deve ancora decidere se il vidimato sostituisce o affianca `numeroProgressivo`. Predefinito qui: `emettiConNumerazione` serializza **il riferimento interno** e nei commenti e nei messaggi nuovi lo chiama così; è progettata come **la** transaction di emissione, in cui il piano della scorta aggiungerà il consumo del numero vidimato (rapporto 01, D13: consumo e salvataggio nella stessa transaction). Se Graziano decide che il vidimato sostituisce il progressivo, il Task 8 resta valido (protegge il riferimento interno) ma il Task 9 andrà ripreso dal piano della scorta.
8. **Giacenza: blocco sul saldo complessivo, avviso sull'ordine delle date** **(scelta predefinita adottata, da confermare; sostituisce la regola del primo giro).** Con il registro immutabile, un blocco sull'ordine delle date non ha rimedio: chi registra oggi la giacenza esistente e poi ricopia i FIR delle settimane prima se li vedrebbe rifiutare tutti, e l'unica scappatoia sarebbe un carico doppio o una data falsa (WinWaste qui avvisa e non blocca, `winwaste/docs/giacenze.md:248`). Regola: uno SCARICO di massa è **rifiutato** solo se il saldo complessivo del CER (tutti i movimenti della famiglia di massa, a qualunque data) meno la quantità richiesta scende sotto zero; se il saldo complessivo è già negativo, ogni scarico lo peggiora ed è rifiutato. Se invece è solo l'ordine delle date a non tornare (il saldo dalla data dello scarico in poi scenderebbe sotto zero, ma il complessivo regge), lo scarico **si registra** e lo use case restituisce un **avviso** (`MovimentoRegistrato.avvisi`), mostrato dal frontend e scritto nel log con `logger.warn`. I saldi si calcolano per **giorno italiano** del movimento, così un carico delle 10:00 e uno scarico dello stesso giorno senza ora si compensano. La garanzia di concorrenza resta: il lock della giacenza serializza gli scarichi, e il secondo vede il primo. La query del Task 3, Step 8 (informativa, da eseguire prima della conferma) elenca per tenant e CER il saldo minimo e il saldo complessivo. Alternativa per Graziano: una data di taglio prima della quale lo storico non conta.
9. **Collegamento solo a FIR collegabili** **(scelta predefinita adottata, da confermare; evita la regressione che la regola del primo giro avrebbe introdotto per i FIR presi da RENTRI).** Il ramo "annullato all'ente" funziona solo dopo il Task 0: oggi `rentriStatoFormulario` non viene mai salvato né riletto (`fir-prisma.repository.ts`, `toDomain` e `rentriToPersistence`), quindi vale sempre `null`. Anche dopo il Task 0, un FIR già `SYNCED` prima del rilascio resta con la colonna a `NULL`: il campionamento dei SYNCED segnala e non corregge (`riconcilia-stato-rentri.use-case.ts`, `riconciliaSynced`), quindi un suo annullamento all'ente non si vede finché non c'è un ripopolamento una tantum (follow-up, decisione). Un FIR preso da RENTRI (`CreaFIRDaDettaglioRENTRIUseCase.creaDaDettaglio`, `application/rentri/crea-fir-da-dettaglio-rentri.use-case.ts:169`, crea con `FIR.create(props)`) o agganciato a mano resta `DRAFT` in locale finché la riconciliazione, ogni 6 ore, non applica lo stato dell'ente: un controllo sul solo stato locale rifiuterebbe proprio il flusso dei produttori serviti dal trasportatore. Regola, in un solo modulo (`domain/fir/stati-fir.ts`, Task 5), usata anche dal piano A: un FIR è **annullato** se `status = CANCELLED` oppure `rentriStatoFormulario = 'Annullato'`; è **collegabile** se non è annullato e (lo stato locale è fra quelli emessi `AWAITING_CARRIER`, `AWAITING_RECEIVER`, `COMPLETED`, `SYNCED_TO_RENTRI`, **oppure** ha `rentriNumeroFir`). Un `status` fuori dall'enum noto (o assente) non è collegabile (fail-closed). Il Task 5 applica la regola al collegamento e filtra con la stessa regola l'autocompletamento dei FIR nel registro.
10. **Data di registrazione fissata dal server** **(scelta predefinita adottata, da confermare).** Oggi `registrationDate` la sceglie il client (`registro.component.ts:457-465`), e dopo il piano D decide l'anno e il numero del progressivo e il calcolo del ritardo di legge: si può annotare un movimento in un anno già chiuso. Predefinito (Task 10): il server ignora `registrationDate` del client e usa l'**istante reale** di adesso (`new Date()`), perché il modello RENTRI del movimento vuole data **e ora** di registrazione (`data_ora_registrazione`, `rentri-registri.client.ts:530`) e la mezzanotte UTC la perderebbe (rilievo G3-D-16). La data dell'operazione (`movementDate`) resta del client; il form non manda più la data di registrazione e la mostra in sola lettura. L'entità confronta registrazione e operazione sul **giorno italiano** (`giornoItaliano`, piano D), e anche il ritardo di legge (`ritardoRegistrazioneGg`) si conta in giorni italiani di calendario, così una registrazione alle 00:30 italiane non perde un giorno. Effetto sul progressivo: l'anno della numerazione è l'anno italiano in cui l'annotazione viene fatta (`annoSolareItaliano` dell'istante), quindi un movimento del 28/12/2025 registrato l'08/01/2026 prende un numero del 2026 (con il ritardo di legge calcolato e segnalato come oggi), e il MUD lo conta nel 2025 perché guarda `movementDate`. L'import della Fase 3 da WinWaste dovrà passare dallo use case con la data di registrazione originale (lo use case la accetta ancora, il controller no).
    **Data dell'operazione nella ricopia FIR → registro (rilievi G3-C-02, G3-D-01, G3-D-02).** `transport_date` **non** è una data affidabile: è `NOT NULL` (`schema.prisma:350`) e `save` la scrive con `fir.dataPresaCarico || new Date()` (`fir-prisma.repository.ts:625`), quindi per una bozza, per un FIR emesso e non ancora preso in carico e per ogni FIR preso da RENTRI (`crea-fir-da-dettaglio-rentri.use-case.ts:155-169` non passa date) contiene l'istante del primo salvataggio, non del trasporto. La data vera la scrive solo `FIR.presaInCarico` (`fir.aggregate.ts:516-532`), che è vietata sui FIR legati a RENTRI e salva insieme la firma del trasportatore. Regola: il DTO del FIR espone `dataPresaCaricoEffettiva` = `dataPresaCarico` **solo se** il FIR ha la firma del trasportatore (presa in carico avvenuta in WasteFlow), altrimenti `null`. Nella ricopia: per uno **SCARICO** si precompila con `dataPresaCaricoEffettiva`; se manca, nessuna precompilazione (resta la data del form) e un suggerimento esplicito, anche quando lo stato locale o `rentriStatoFormulario` dicono che il trasporto è avvenuto, perché in quel caso la data non è nota a WasteFlow. Per un **CARICO** (l'azienda è destinataria, `registro.component.ts:1250-1251`) si precompila con `dataConsegna` (arrivo registrato in WasteFlow, `actualArrivalDate`); se manca, nessuna precompilazione e il suggerimento. Correggere `transport_date` alla fonte (colonna nullable e niente `new Date()` di ripiego) richiede una migration ed è un follow-up.
11. **FIR annullato dopo la ricopia** **(scelta predefinita adottata, da confermare).** Lo scarico collegato continua a pesare sulla giacenza, mentre il MUD lo esclude. Qui (Task 6) la pagina giacenze mostra, per CER, gli scarichi collegati a FIR annullati con un avviso; il piano A li elenca come `FIR_ANNULLATO`. La correzione vera (conferma esplicita all'annullamento di un FIR collegato, esclusione dal calcolo) è un follow-up.
12. **Rimedio nel messaggio di giacenza insufficiente** **(scelta predefinita adottata, da validare con un consulente; rilievo G3-D-12).** Il messaggio di blocco dice quale carico registrare. Chi parte con rifiuti già in deposito sceglierebbe `PRODUZIONE_INTERNA`, che il MUD (piano A, Decisione 4) conta come **prodotto nell'anno**; non esiste una causale "giacenza iniziale" (`registro.service.ts:10-24`). Predefinito: per i rifiuti già in deposito prima di usare il registro il messaggio indica **Altro carico** (`ALTRO_CARICO`, che il MUD esclude con `CAUSALE_ESCLUSA`), per i rifiuti prodotti ora **Produzione interna**. La causale dedicata arriva con le giacenze iniziali (Fase 2).
13. **Causale predefinita nella ricopia quando il ruolo non si riconosce** **(scelta predefinita adottata, da confermare; rilievo G3-D-21).** Oggi `onFirSelect` mette `INGRESSO_ESTERNO` anche quando la società non risulta né produttore né destinataria (`registro.component.ts:1256-1262`), e ogni carico così registrato esce dal MUD con `PROFILO_NON_SUPPORTATO`. Predefinito (Task 10): con il ruolo non riconosciuto nessuna causale viene impostata, la sceglie l'utente (il campo è già obbligatorio).
14. **Rientro di un FIR respinto** (decisione aperta, rilievo G3-D-15). Un FIR in `InserimentoQuantita` (non ancora partito) è collegabile: accettato per la Fase 0. Per `RespintoAccettatoParzialmente` lo scarico resta nel MUD con l'avviso `ESITO_FIR_RESPINTO` (piano A), ma per il **rientro** del rifiuto respinto nessuna causale è giusta (`INGRESSO_ESTERNO` esce come profilo non supportato, `PRODUZIONE_INTERNA` lo conta due volte come prodotto). Predefinito: nessuna regola, il messaggio dell'avviso nel piano A dice di verificare la quantità; la causale dedicata è un follow-up della Fase 2.
15. **Avviso sull'ordine delle date salvato sul movimento** (decisione che può aspettare, rilievo G3-D-13). Predefinito: l'avviso resta nella risposta e nel log, non nelle `notes` del movimento. Alternativa: aggiungerlo in coda alle `notes` prima del salvataggio, così in un'ispezione lo scarico che precede il carico è spiegato nell'annotazione stessa.

## Global Constraints

- **Ordine di merge della Fase 0: D → C → A, un solo merge per piano.** Questo piano si esegue su un branch che contiene già il merge del piano D, per tre motivi: (1) la sua migration deve trovare in produzione il backup pre-deploy del piano D; (2) importa `annoSolareItaliano`, `giornoItaliano`, `formattaDataItaliana` da `core/time/anno-italiano.ts` (piano D) e riscrive `registra-movimento.use-case.ts` sopra le modifiche di D (blocco "0c" sulla data nel futuro e calcolo dell'anno); (3) il piano A importa da qui `unita-misura-registro.ts`, `stati-fir.ts`, `ricopia-fir.ts` e `formatta-quantita.ts`, e si appoggia al controllo del Task 5.
- **`node_modules` del worktree: mai attraverso le junction.** In `C:\Progetti\rifiuti-wt-fase0` le cartelle `node_modules` e `apps\backend\node_modules` sono **junction** verso `C:\Progetti\rifiuti\...`, e `apps\frontend\node_modules` non esiste. `npx prisma generate` eseguito qui riscriverebbe il client Prisma del checkout principale, e il backend avviato da `C:\Progetti\rifiuti` (database senza la migration) fallirebbe su ogni query di `wasteMovement` con "column fir_id_ricopia does not exist". Per questo il Task 0 comincia (Step 0) sostituendo le junction con un'installazione locale fatta **come in CI**: un solo `npm ci` alla radice (workspace npm `apps/*`, `.gitea/workflows/ci.yml:69-73`) e poi `npx prisma generate` in `apps/backend` (`ci.yml:75-78`, `npm run prisma:generate`). Niente secondo `npm ci` dentro `apps\backend`: con npm 11 verrebbe risolto sul lockfile della radice e lascerebbe un albero diverso da quello del CI. Mai `rm -rf` su una junction: si toglie con `cmd /c rmdir`, che rimuove il collegamento e non il contenuto.
- **TDD obbligatorio** (regola di progetto): prima il test, poi guardarlo fallire. Un test che passerebbe già sul codice di oggi non conta come prova: va reso rosso o accompagnato da uno che lo è.
- **Memoria della macchina:** mai la suite intera. Unitari: `cd apps/backend && npx jest --runInBand <percorso spec>`. Postgres reale: `cd apps/backend && npm run test:postgres -- <pattern>`, con `DATABASE_URL` verso un Postgres 16 con migration applicate (`npx prisma migrate deploy`). Per averne uno locale come in CI: `docker run -d --rm --name wasteflow-pg-test -p 55432:5432 -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci postgres:16-alpine` e `DATABASE_URL=postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public`. Frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=<percorso spec>`. Oracolo RENTRI: `cd tools/rentri-fake && npm ci`, poi `cd apps/backend && npm run test:oracolo -- <pattern>` (config `jest.oracolo.config.js`; la config di default esclude `*.oracolo.spec.ts`).
- **Cosa blocca il rilascio e cosa no.** Nel gate di `deploy.yml` girano gli unitari (`test:cov`) e l'oracolo (`test:oracolo`). **Non** girano: i `*.postgres.spec.ts` (solo nel job CI «Test integrazione Postgres», `.gitea/workflows/ci.yml:283-284`, non bloccante per il deploy) e i test frontend Karma (fuori da ogni gate, `deploy.yml:170-190`). Per questo ogni task che li tocca li esegue **in locale** con i comandi indicati, e la Verifica finale li ripete. I test di concorrenza stanno nei `*.postgres.spec.ts`: un mock non prende lock.
- **`tsc` non controlla gli spec** (`tsconfig.json` esclude `**/*spec.ts`): un doppio di test sbagliato si vede solo eseguendo il suo spec con jest.
- **Lingua:** commenti, messaggi ed errori in italiano; identificatori come il codice attorno. I termini tecnici non si traducono. Numeri e date nei messaggi all'utente in formato italiano (`0,4`, `1.234,5`, `05/03/2026`): i numeri **sempre** con `formattaQuantita` (`core/format/formatta-quantita.ts`, Task 3), mai con un `toLocaleString` scritto sul posto. Con le opzioni di default CLDR `it` non raggruppa i numeri di 4 cifre (`1234,5`) e l'esito cambia con la versione ICU; l'helper usa `useGrouping: 'always'`.
- **Stile:** prettier di `.prettierrc` (`semi: false`, `singleQuote: true`).
- **Isolamento:** ogni query porta `tenant_id`/`tenantId` nel `where`.
- **SQL solo parametrizzato:** `$queryRaw`/`$executeRaw` con template, mai `$queryRawUnsafe`.
- **Migration additive che non possono fallire sui dati esistenti:** nessun `RAISE`, nessun vincolo che le righe storiche potrebbero violare.
- **Ordine dei lock in `RegistraMovimentoUseCase`** (sempre questo, per non creare deadlock): 1) `fir-registro|<tenantId>|<firId>` se c'è un FIR; 2) `<tenantId>-<anno>` (chiave esistente, invariata); 3) `giacenza|<tenantId>|<CER senza asterisco>` se è uno SCARICO di massa. Tutti `pg_advisory_xact_lock(hashtext(...))`.
- **Commit:** `fix(registro): …` / `fix(fir): …` / `test(…): …` in italiano, **senza righe `Co-Authored-By` né altre attribuzioni**.
- **Rollback:** la migration aggiunge solo una colonna nullable e un indice, ignorati dal codice precedente, quindi tornare indietro non richiede un restore. Il workflow di deploy non accetta un tag (`workflow_dispatch` senza input, `git reset --hard origin/master`): il rollback è un `git revert -m 1 <merge>` su `master` più la pipeline intera (build di 30-40 minuti sul runner condiviso), come scritto in `ops/README.md`, sezione Rollback (piano D). **Caso limite di Capodanno:** se si torna indietro fra il 1° gennaio e il primo FIR emesso dal codice vecchio, `generateNumeroProgressivo` (che filtra per `createdAt` e ordina le stringhe) può ricalcolare un riferimento già assegnato dal codice di questo piano: l'emissione fallisce con P2002 su `[tenantId, firNumber]` (`schema.prisma:453`). Non si perdono dati, ma l'emissione resta bloccata finché non si rilascia di nuovo questo piano: evitare il rollback in quella finestra, o riemettere dopo il nuovo rilascio.
- **Revert solo in ordine inverso (A → C → D)**, come in `ops/README.md` (piano D): un revert di C con A già in `master` rompe la build di A. Per rilasciare di nuovo dopo un revert serve il revert del revert.
- **Il merge su `master` è un rilascio in produzione** (fa partire il deploy): lo fa Graziano o lo approva esplicitamente, dopo aver letto la nota di rilascio (sezione «Cosa vede l'utente dopo il rilascio» in fondo al piano), da mandare ai clienti lo stesso giorno.
- **Fuori ambito:** la regola ±10% sul peso a destino (`fir.aggregate.ts:552`), giacenze iniziali, unità locale, rettifiche, l'età del deposito temporaneo (`giacenze.service.ts:50-54`), il consumo del numero vidimato (piano della scorta).

## Review Focus

1. **Due SCARICO concorrenti sullo stesso CER registrati in anni diversi** (carico 100 kg del 20/12/2025; scarico A da 100 kg con `registrationDate` 31/12/2025 e scarico B da 100 kg con `registrationDate` 02/01/2026, entrambi del 30/12/2025, in `Promise.all`, chiamando lo use case direttamente): prendono lock di progressivo diversi (`<tenant>-2025`, `<tenant>-2026`), quindi solo il lock della giacenza li serializza; atteso un solo successo, perché il secondo porterebbe il saldo complessivo a -100. Test: Task 3, `due scarichi concorrenti in anni di registrazione diversi: ne passa uno solo`.
2. **SCARICO retrodatato prima dell'unico CARICO** (carico del 10/03, scarico del 05/03, quantità coperta): atteso che si registri **con un avviso** sull'ordine delle date che nomina il 05/03; scarico più grande del saldo complessivo: rifiutato. E un client che manda un carico alle 10:00 del 01/03 e uno scarico del 01/03 senza ora: stesso giorno italiano, nessun avviso. Test: Task 2, `non consuma carichi successivi alla data dello scarico`, `carico e scarico nello stesso giorno italiano si compensano`; Task 3, `uno scarico retrodatato coperto dal saldo complessivo si registra con un avviso` e `l'avviso indica la data del saldo che fa da limite`.
3. **kg e t sullo stesso CER, più un rifiuto in m³** (carico 1 `T`, scarico 600 `KG`, poi scarico 0,5 `t`; poi uno scarico 3 `M3` ricopiato da FIR senza carichi in m³): il primo passa (residuo 400 kg), il secondo è rifiutato con `disponibili 0,4 t`; lo scarico in m³ passa senza controllo con un warning nel log. Test: Task 2, `somma kg e tonnellate e ignora le unità non di massa`; Task 3, `il messaggio riporta la giacenza nell'unità dello scarico, in formato italiano` e `uno scarico in unità non di massa salta il controllo con un warning`.
4. **Giacenza non calcolabile o storico già sotto zero** (la query restituisce `NaN` o `null`; oppure il saldo complessivo è già -100 kg): atteso il rifiuto dello scarico (fail-closed), con un messaggio che dice che il registro è già sotto zero invece di "disponibili -100". Test: Task 3, `se la giacenza non è un numero finito lo scarico è rifiutato` e `con il saldo complessivo già negativo il messaggio lo dice`.
5. **Ricopia nel registro ripetuta dopo un timeout** (stesso comando con `firId`, quantità `1.005` che `numeric(10,2)` salva come `1.01`, mentre `Math.round(1.005 * 100)` darebbe `100`; inviato due volte, anche in parallelo): un solo movimento, la seconda risposta restituisce lo stesso `id` con `giaRegistrato: true`, il progressivo non avanza, il toast dice "già registrato". Con quantità diversa: errore `già registrato`. Test: Task 4, `la stessa ricopia ripetuta restituisce il movimento esistente`, `stessiDatiRicopia arrotonda come numeric(10,2)` e `due ricopie concorrenti dello stesso FIR producono un solo movimento`.
6. **FIR preso da RENTRI e ricopiato subito** (FIR `DRAFT` in locale con `rentriNumeroFir` valorizzato, prima della riconciliazione delle 6 ore; e un FIR `AWAITING_CARRIER` con `rentriStatoFormulario = 'Annullato'`): il primo si collega e compare nell'autocompletamento del registro, il secondo no ("è annullato"). Test: Task 5, `stati-fir.spec.ts` (`un FIR in bozza locale con numero RENTRI è collegabile`, `annullato all'ente vale come annullato`) e `accetta il collegamento a un FIR in bozza locale con numero RENTRI`; frontend `firCollegabileNelRegistro`.
7. **Due emissioni nello stesso millisecondo** (due bozze dello stesso tenant in `Promise.all`; e la stessa bozza emessa due volte in `Promise.all`): nel primo caso `000001` e `000002`, entrambe riuscite; nel secondo una sola emissione, l'altra `FirNonPiuInBozzaError`, una sola riga in `fir_signatures`. Test: Task 8, `due emissioni concorrenti di bozze diverse prendono numeri consecutivi senza errori` e `la stessa bozza emessa due volte in parallelo: una sola emissione`.
8. **FIR acquisito da RENTRI e ricopiato come SCARICO, o ricevuto e ricopiato come CARICO** (trasporto il 28/12/2025, acquisizione l'08/01/2026, quindi `transport_date` = 08/01/2026; e un carico del destinatario con arrivo il 02/01/2026 e trasporto il 30/12/2025): atteso che lo scarico **non** venga precompilato con l'08/01 e che l'utente veda il suggerimento, e che il carico prenda il 02/01. Test: Task 10, `dataOperazioneDaFir: senza presa in carico registrata nessuna data`, `dataOperazioneDaFir: il carico usa la data di arrivo` e (backend) `dataPresaCaricoEffettiva è nulla senza la firma del trasportatore`.
9. **Stato dell'ente salvato e riletto** (`applyRentriStato('Annullato')`, `save`, `findById`): atteso `rentriStatoFormulario === 'Annullato'` dopo il reload, e la riconciliazione dei SYNCED che non segnala più una divergenza per un FIR allineato. Test: Task 0, `rentriStatoFormulario sopravvive a save e findById` e l'oracolo `riconcilia-stato-rentri`.

---

## File Structure

| File | Responsabilità |
|---|---|
| `apps/backend/src/domain/waste-movement/unita-misura-registro.ts` (nuovo) | **Modulo condiviso** (registro, giacenze, MUD): famiglia di massa, fattore verso i kg, `convertiInKg`, `simboloUnita` |
| `apps/backend/src/core/format/formatta-quantita.ts` (nuovo) | **Modulo condiviso**: numeri nei messaggi in formato italiano, con raggruppamento sempre attivo |
| `apps/backend/src/application/registro/giacenza-disponibile.ts` (nuovo) | Query SQL: saldo complessivo in kg e saldo minimo dalla data dello scarico, per giorno italiano |
| `apps/backend/src/application/registro/ricopia-fir.ts` (nuovo) | **Modulo condiviso** (registro e MUD): quando due movimenti sono "la stessa ricopia" |
| `apps/backend/src/domain/fir/stati-fir.ts` (nuovo) | **Modulo condiviso** (registro e MUD): stati emessi, collegabilità fail-closed, annullamento, `etichettaFir` |
| `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts` (modifica) | Lock, controllo di giacenza con avvisi, ricopia idempotente, collegamento solo a FIR collegabili |
| `apps/backend/src/api/registro/registro.controller.ts`, `api/registro/dtos/registra-movimento.dto.ts` (modifica) | Data di registrazione dal server; quantità con al massimo 2 decimali |
| `apps/backend/src/domain/waste-movement/waste-movement.entity.ts` (modifica) | Confronto fra data di registrazione e di operazione, e ritardo di legge, sul giorno italiano |
| `apps/backend/prisma/schema.prisma` + nuova migration (modifica) | Colonna `firIdRicopia` e `@@unique([tenantId, firIdRicopia, type])` su `WasteMovement` |
| `apps/backend/src/api/fir/dtos/fir-response.dto.ts` + `apps/frontend/src/app/shared/models/fir.model.ts` (modifica) | `rentriStatoFormulario` (Task 5) e `dataPresaCaricoEffettiva` (Task 10) nella risposta del FIR |
| `apps/frontend/src/app/features/registro/registro-messaggi.ts`, `registro-fir.ts` (nuovi) + `registro.component.ts`, `registro.service.ts` (modifica) | Toast "già registrato" e avvisi; FIR collegabili nell'autocompletamento; data del FIR nella ricopia; data di registrazione in sola lettura |
| `apps/backend/src/application/giacenze/giacenze.service.ts` (modifica) + frontend `features/giacenze/*` | Giacenze UI in kg veri, altre unità a parte, scarichi su FIR annullati |
| `apps/backend/src/domain/fir/numero-fir.ts` (nuovo) | Formato del riferimento interno del FIR (l'anno viene da `core/time`) |
| `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts` (modifica) | `rentriStatoFormulario` salvato e riletto (Task 0), `save` atomico, `emettiConNumerazione` |
| `apps/backend/src/domain/fir/repositories/fir-repository.interface.ts` (modifica) | `emettiConNumerazione` (Task 8), poi via `generateNumeroProgressivo` (Task 9) |
| `apps/backend/src/core/domain/errors.ts` (modifica) | `FirNonPiuInBozzaError`, `FirmaSenzaUtenteError`, `FirGiaRegistratoError` |
| `apps/backend/src/application/fir/use-cases/emetti-fir.use-case.ts` (modifica) | Emissione tramite il nuovo metodo, errori di dominio come `Result.fail` |
| `apps/backend/src/infrastructure/pdf/pdf.service.ts` (modifica, `buildFIRContent`) | "Numero FIR" = numero RENTRI se c'è; il riferimento interno con la sua etichetta |

---

### Task 0: lo stato del formulario presso RENTRI si salva e si rilegge (difetto preesistente)

**Perché:** la colonna `firs.rentri_stato_formulario` esiste (`schema.prisma:399`) e l'aggregate la aggiorna in `applyRentriStato` (`fir.aggregate.ts:958-971`), ma il repository non la scrive (`rentriToPersistence`, `fir-prisma.repository.ts:643-660`) né la rilegge (`toDomain`, `Object.assign` di `:483-504`). Nel database vale quindi sempre `NULL` e nel dominio sempre `null`. È un difetto **già in produzione**: la riconciliazione dei FIR `SYNCED` (`riconcilia-stato-rentri.use-case.ts:397-398`, `statoLocale = fir.rentriStatoFormulario ?? null`) confronta lo stato dell'ente con `null` e segnala come divergente ogni FIR campionato. In questo piano il Task 5 (FIR annullato all'ente, filtro dell'autocompletamento) e il Task 6 (scarichi su FIR annullati), e nel piano A `FIR_ANNULLATO` ed `ESITO_FIR_RESPINTO`, dipendono da questo campo: senza questo task non scatterebbero mai fuori dai mock.

**Files:**
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts` (import da `@prisma/client` e da `fir.aggregate`; `toDomain`, `Object.assign` del blocco "Legame RENTRI"; `rentriToPersistence`)
- Test: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.postgres.spec.ts` (nuovo `describe`)
- Test (da rieseguire, ed eventualmente correggere se codificava il difetto): `apps/backend/src/application/rentri/riconcilia-stato-rentri.oracolo.spec.ts`, `apps/backend/src/application/rentri/riconcilia-stato-rentri.use-case.spec.ts`

**Interfaces:**
- Produces: `FIRPrismaRepository.findById` (e ogni lettura che passa da `toDomain`) restituisce un `FIR` con `rentriStatoFormulario` uguale alla colonna; `save` scrive `rentriStatoFormulario: (fir.rentriStatoFormulario ?? null) as PrismaRentriStatoFormulario | null` (import `RentriStatoFormulario as PrismaRentriStatoFormulario` da `@prisma/client`, accanto agli altri enum), e `toDomain` ripristina `_rentriStatoFormulario: (record.rentriStatoFormulario as StatoFormulario | null) ?? null` (`StatoFormulario` importato da `fir.aggregate`). I 22 valori dell'enum Prisma e del tipo TypeScript sono gli stessi (`schema.prisma:517-551`, `fir.aggregate.ts:53-75`).
- Consumes da qui: Task 5 e 6 di questo piano, piano A (Task 4).

- [ ] **Step 0: installazione locale nel worktree, come in CI (prima di ogni comando del piano).** Da PowerShell, nella radice del worktree:

```powershell
cmd /c rmdir C:\Progetti\rifiuti-wt-fase0\node_modules
cmd /c rmdir C:\Progetti\rifiuti-wt-fase0\apps\backend\node_modules
cd C:\Progetti\rifiuti-wt-fase0; npm ci
cd apps\backend; npx prisma generate
(Get-Item C:\Progetti\rifiuti-wt-fase0\node_modules).LinkType
```

Expected: `rmdir` toglie solo le due junction (il checkout principale resta intatto: `Test-Path C:\Progetti\rifiuti\node_modules\.prisma` → `True`); l'unico `npm ci` è quello della radice, come `.gitea/workflows/ci.yml:69-73`, e installa anche i workspace `apps/*` (frontend compreso, che serve ai test Karma dei Task 4-6 e 10); `prisma generate` gira in `apps/backend` come `ci.yml:75-78`; l'ultima riga stampa una stringa vuota (cartella vera, non junction). Da qui in avanti ogni comando del piano gira sulla copia locale.

- [ ] **Step 1: scrivere i test che falliscono** (nuovo `describe` in `fir-prisma.repository.postgres.spec.ts`, stesso setup e stesso helper `buildFirAgganciato` del file):

```ts
it('rentriStatoFormulario sopravvive a save e findById', async () => {
  const fir = buildFirAgganciato(`RENTRI-SF-${Date.now()}`)
  await repo.save(fir)
  fir.applyRentriStato('Annullato')
  await repo.save(fir)
  expect((await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })).rentriStatoFormulario).toBe('Annullato')
  expect((await repo.findById(fir.id))!.rentriStatoFormulario).toBe('Annullato')
})
it('un salvataggio successivo non cancella lo stato dell ente', async () => {
  const fir = buildFirAgganciato(`RENTRI-SF2-${Date.now()}`)
  fir.applyRentriStato('RespintoAccettatoParzialmente')
  await repo.save(fir)
  const riletto = (await repo.findById(fir.id))!
  await repo.save(riletto) // salvataggio per un altro motivo
  expect((await repo.findById(fir.id))!.rentriStatoFormulario).toBe('RespintoAccettatoParzialmente')
})
it('un FIR mai riconciliato resta con rentriStatoFormulario null', async () => {
  const fir = buildFirAgganciato(`RENTRI-SF3-${Date.now()}`)
  await repo.save(fir)
  expect((await repo.findById(fir.id))!.rentriStatoFormulario).toBeNull()
})
```

- [ ] **Step 2: eseguire e vederli fallire**

Run (Postgres locale come nei Global Constraints, con `npx prisma migrate deploy`): `cd apps/backend && npm run test:postgres -- fir-prisma`
Expected: FAIL sui primi due (`null` invece di `'Annullato'` e di `'RespintoAccettatoParzialmente'`).

- [ ] **Step 3: implementare** le due righe e gli import descritti in Interfaces, con un commento accanto a quelle già presenti per gli altri campi del legame (lo stesso tranello "scrittura dimenticata, lettura dimenticata" già descritto nel file).

- [ ] **Step 4: eseguire i test, compresa la riconciliazione**

Run, nell'ordine:
- `cd apps/backend && npm run test:postgres -- fir-prisma` → PASS;
- `cd apps/backend && npx jest --runInBand src/infrastructure/persistence/fir-prisma.repository.spec.ts src/application/rentri/riconcilia-stato-rentri.use-case.spec.ts` → PASS;
- `cd tools/rentri-fake && npm ci && cd ../../apps/backend && npm run test:oracolo -- riconcilia-stato-rentri` → PASS. L'oracolo è nel gate di `deploy.yml`: se un suo test si aspettava una divergenza su un FIR `SYNCED` già allineato all'ente, stava codificando il difetto; va corretto per attendersi "nessuna divergenza", e il messaggio di commit lo dice.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts apps/backend/src/infrastructure/persistence/fir-prisma.repository.postgres.spec.ts apps/backend/src/application/rentri/
git commit -m "fix(fir): lo stato del formulario presso RENTRI si salva e si rilegge (la riconciliazione confrontava sempre con null)"
```

Nella descrizione della PR: dopo il rilascio la riconciliazione dei FIR `SYNCED` smette di segnalare divergenze false sui FIR riconciliati da qui in avanti; quelli già `SYNCED` prima restano con la colonna a `NULL` e continuano a risultare divergenti nel campionamento finché non si decide un ripopolamento (Decisione 9, follow-up).

---

### Task 1: unità di misura del registro (modulo condiviso)

**Files:**
- Create: `apps/backend/src/domain/waste-movement/unita-misura-registro.ts`
- Test: `apps/backend/src/domain/waste-movement/unita-misura-registro.spec.ts`

**Interfaces:**
- Produces (usati dai Task 2, 3, 6 e dal **piano A**, Task 2 e 4; nessun altro modulo deve ridefinire alias o fattori):
  - `export const ALIAS_KG: readonly string[] = ['KG', 'KILOGRAMMI', 'KILOGRAMMO']`
  - `export const ALIAS_T: readonly string[] = ['T', 'TON', 'TONNELLATE', 'TONNELLATA']`
  - `export interface UnitaNormalizzata { unita: string; massa: boolean; fattoreKg: number | null; vuota: boolean }` — `unita` = `'KG'` per gli alias dei kg e per l'unità vuota, `'T'` per gli alias delle tonnellate, altrimenti l'unità maiuscola senza spazi; `fattoreKg` = 1, 1000 o `null` per le unità non di massa; `vuota` = la stringa era vuota, `null` o `undefined` (trattata come KG, ma chi la usa può avvisare).
  - `export function normalizzaUnitaRegistro(unit: string | null | undefined): UnitaNormalizzata`
  - `export function convertiInKg(quantita: number, unit: string | null | undefined): number | null` — `null` per le unità non di massa; altrimenti `Math.round(quantita * fattoreKg * 1000) / 1000`.
  - `export function simboloUnita(u: UnitaNormalizzata): string` — `'kg'` per `KG` (anche vuota), `'t'` per `T`, altrimenti `u.unita`. È l'unità da scrivere nei messaggi (mai `command.unit` grezza, che può essere vuota o un alias).

- [ ] **Step 1: scrivere il test che fallisce**

```ts
describe('normalizzaUnitaRegistro', () => {
  it('kg e tonnellate sono massa, maiuscole e spazi ignorati', () => {
    expect(normalizzaUnitaRegistro('KG')).toEqual({ unita: 'KG', massa: true, fattoreKg: 1, vuota: false })
    expect(normalizzaUnitaRegistro(' kg ')).toEqual({ unita: 'KG', massa: true, fattoreKg: 1, vuota: false })
    expect(normalizzaUnitaRegistro('Kilogrammi')).toEqual({ unita: 'KG', massa: true, fattoreKg: 1, vuota: false })
    expect(normalizzaUnitaRegistro('t')).toEqual({ unita: 'T', massa: true, fattoreKg: 1000, vuota: false })
    expect(normalizzaUnitaRegistro('Tonnellate')).toEqual({ unita: 'T', massa: true, fattoreKg: 1000, vuota: false })
  })
  it('unità vuota = KG, ma segnalata (default dello schema e del DTO)', () => {
    for (const u of ['', '  ', null, undefined]) {
      expect(normalizzaUnitaRegistro(u as any)).toEqual({ unita: 'KG', massa: true, fattoreKg: 1, vuota: true })
    }
  })
  it('le altre unità non sono di massa e non si convertono', () => {
    expect(normalizzaUnitaRegistro('litri')).toEqual({ unita: 'LITRI', massa: false, fattoreKg: null, vuota: false })
    expect(normalizzaUnitaRegistro('m3')).toEqual({ unita: 'M3', massa: false, fattoreKg: null, vuota: false })
  })
})
describe('convertiInKg', () => {
  it('converte kg e tonnellate al grammo', () => {
    expect(convertiInKg(500, 'KG')).toBe(500)
    expect(convertiInKg(1.25, 'T')).toBe(1250)
    expect(convertiInKg(0.001, 'tonnellate')).toBe(1)
    expect(convertiInKg(3, '')).toBe(3)
  })
  it('restituisce null per le unità non di massa', () => {
    for (const u of ['litri', 'l', 'LT', 'm3']) expect(convertiInKg(10, u)).toBeNull()
  })
})
describe('simboloUnita', () => {
  it('kg e t in minuscolo, vuota come kg, le altre come sono', () => {
    expect(simboloUnita(normalizzaUnitaRegistro('Tonnellate'))).toBe('t')
    expect(simboloUnita(normalizzaUnitaRegistro(''))).toBe('kg')
    expect(simboloUnita(normalizzaUnitaRegistro('m3'))).toBe('M3')
  })
})
```

- [ ] **Step 2: eseguire e vederlo fallire**

Run: `cd apps/backend && npx jest --runInBand src/domain/waste-movement/unita-misura-registro.spec.ts`
Expected: FAIL, modulo non trovato.

- [ ] **Step 3: implementare** con `(unit ?? '').trim().toUpperCase()` e confronto con `ALIAS_KG`/`ALIAS_T`. Commento in testa: unico punto in cui stanno alias e fattori; registro, giacenze e MUD lo importano.

- [ ] **Step 4: eseguire il test**

Run: come Step 2. Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/domain/waste-movement/unita-misura-registro.ts apps/backend/src/domain/waste-movement/unita-misura-registro.spec.ts
git commit -m "feat(registro): modulo unico delle unità di misura (massa in kg e t, altre unità a parte)"
```

- [ ] **Step 6: query informativa, da eseguire prima di confermare la Decisione 4** (sul database del VPS, sola lettura, eseguita da Graziano o con la sua approvazione; il VPS è di collaudo, quindi misura dati di prova; l'esito va anche nella PR):

```sql
SELECT 'waste_movements' AS tabella, upper(btrim(unit)) AS unita, count(*) FROM waste_movements GROUP BY 2
UNION ALL
SELECT 'firs', upper(btrim(unit)), count(*) FROM firs GROUP BY 2
ORDER BY 1, 3 DESC;
```

---

### Task 2: saldo complessivo e saldo dalla data del movimento, per giorno italiano

**Files:**
- Create: `apps/backend/src/application/registro/giacenza-disponibile.ts`
- Test: `apps/backend/src/application/registro/giacenza-disponibile.postgres.spec.ts`

**Interfaces:**
- Consumes: `ALIAS_KG`, `ALIAS_T` (Task 1); `giornoItaliano` (`core/time/anno-italiano.ts`, piano D).
- Produces:
  - `export interface ParametriGiacenza { tenantId: string; cerCode: string; alla: Date }`
  - `export interface GiacenzaDisponibile { saldoComplessivoKg: number; disponibileAllaDataKg: number; vincoloAl: Date }`
  - `export async function giacenzaDisponibileAl(tx: Prisma.TransactionClient, p: ParametriGiacenza): Promise<GiacenzaDisponibile>`:
    - `saldoComplessivoKg`: carichi meno scarichi del CER, **a qualunque data**, in kg. Decide il blocco (Decisione 8).
    - `disponibileAllaDataKg`: quantità in kg che uno SCARICO del giorno italiano di `alla` può consumare senza portare sotto zero nessun saldo da quel giorno in poi; `vincoloAl` è il giorno (mezzanotte UTC) del saldo che fa da limite, il giorno di `alla` o uno successivo già registrato. Decide solo l'avviso sull'ordine delle date.
    - Entrambi arrotondati a 3 decimali; possono essere negativi se lo storico è già incoerente. Considera solo la famiglia di massa (alias di kg e t, unità vuota).

`disponibileAllaDataKg = min(saldo al giorno di 'alla', minimo dei saldi dei giorni successivi)`. I saldi si raggruppano per **giorno italiano** di `movement_date` (colonna `timestamp` senza fuso, scritta in UTC): un carico delle 10:00 e uno scarico dello stesso giorno mandato senza ora (mezzanotte UTC) stanno nello stesso saldo. Il CER si confronta su entrambe le forme, con e senza `*`, perché `normalizzaCerCode` conserva l'asterisco solo se l'operatore lo ha scritto. Algoritmo (un solo `$queryRaw`, `giornoAlla = giornoItaliano(p.alla)`):

```sql
WITH mov AS (
  SELECT (movement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date AS g,
         SUM(CASE WHEN type = 'CARICO' THEN 1 ELSE -1 END * quantity *
             CASE WHEN upper(btrim(unit)) = ANY(${ALIAS_T}) THEN 1000 ELSE 1 END) AS delta
  FROM waste_movements
  WHERE tenant_id = ${tenantId}::uuid
    AND cer_code IN (${cerSenzaStella}, ${cerConStella})
    AND (upper(btrim(unit)) = ANY(${ALIAS_KG}) OR upper(btrim(unit)) = ANY(${ALIAS_T}) OR btrim(unit) = '')
  GROUP BY 1
),
saldi AS (SELECT g, SUM(delta) OVER (ORDER BY g) AS saldo FROM mov),
candidati AS (
  SELECT ${giornoAlla}::date AS g,
         COALESCE((SELECT saldo FROM saldi WHERE g <= ${giornoAlla}::date ORDER BY g DESC LIMIT 1), 0) AS saldo
  UNION ALL
  SELECT g, saldo FROM saldi WHERE g > ${giornoAlla}::date
)
SELECT c.g AS vincolo_al, c.saldo, (SELECT COALESCE(SUM(delta), 0) FROM mov) AS saldo_totale
FROM candidati c ORDER BY c.saldo ASC, c.g ASC LIMIT 1
```

Gli array di alias si passano come parametri: le liste restano solo in `unita-misura-registro.ts`.

- [ ] **Step 1: scrivere i test che falliscono** (Postgres reale, schema di `rentri-scorta.repository.postgres.spec.ts`: `new PrismaClient()`, tenant creato in `beforeAll` con `partitaIva: \`GD${Date.now().toString().slice(-9)}\``, `afterAll` che cancella `wasteMovement` e tenant). Helper `carico(data, qty, unit = 'KG', cer = '99 99 01')` e `scarico(...)` che inseriscono direttamente con `prisma.wasteMovement.create` (`progressiveYear: 2026`, `progressiveNumber` da un contatore, `causale: 'ALTRO_CARICO'`/`'ALTRO_SCARICO'`, `registrationDate` = data). Helper `disp(alla, cer = '99 99 01')` = `prisma.$transaction(tx => giacenzaDisponibileAl(tx, { tenantId, cerCode: cer, alla }))`. `beforeEach` svuota i movimenti del tenant.

```ts
it('saldo semplice: carichi meno scarichi fino alla data', async () => {
  await carico('2026-03-01', 100)
  await scarico('2026-03-02', 30)
  expect(await disp(new Date('2026-03-05'))).toMatchObject({ saldoComplessivoKg: 70, disponibileAllaDataKg: 70 })
})
it('non consuma carichi successivi alla data dello scarico', async () => {
  await carico('2026-03-10', 100)
  expect(await disp(new Date('2026-03-05'))).toEqual({
    saldoComplessivoKg: 100, disponibileAllaDataKg: 0, vincoloAl: new Date('2026-03-05T00:00:00Z'),
  })
})
it('non rompe il saldo di uno scarico successivo già registrato', async () => {
  await carico('2026-03-01', 100)
  await scarico('2026-03-03', 100)
  expect(await disp(new Date('2026-03-02'))).toEqual({
    saldoComplessivoKg: 0, disponibileAllaDataKg: 0, vincoloAl: new Date('2026-03-03T00:00:00Z'),
  })
})
it('il saldo complessivo conta anche i movimenti successivi alla data', async () => {
  await carico('2026-03-10', 100)
  await scarico('2026-03-12', 30)
  expect((await disp(new Date('2026-03-05'))).saldoComplessivoKg).toBe(70)
})
it('carico e scarico nello stesso giorno italiano si compensano', async () => {
  await carico('2026-03-01T10:00:00Z', 50) // client API con l'ora
  expect((await disp(new Date('2026-03-01T00:00:00Z'))).disponibileAllaDataKg).toBe(50) // data senza ora
})
it("un movimento delle 00:30 italiane appartiene al giorno dopo", async () => {
  await carico('2026-03-01T23:30:00Z', 50) // 02/03 00:30 a Roma
  expect((await disp(new Date('2026-03-01T00:00:00Z'))).disponibileAllaDataKg).toBe(0)
})
it('somma kg e tonnellate e ignora le unità non di massa', async () => {
  await carico('2026-03-01', 1, 'T')
  await scarico('2026-03-02', 600, 'kg')
  await carico('2026-03-02', 30, 'LITRI')
  await scarico('2026-03-02', 5, 'M3')
  expect(await disp(new Date('2026-03-05'))).toMatchObject({ saldoComplessivoKg: 400, disponibileAllaDataKg: 400 })
})
it("l'unità vuota vale kg", async () => {
  await carico('2026-03-01', 70, '')
  expect((await disp(new Date('2026-03-05'))).disponibileAllaDataKg).toBe(70)
})
it('CER con e senza asterisco sono lo stesso rifiuto', async () => {
  await carico('2026-03-01', 80, 'KG', '99 99 01*')
  expect((await disp(new Date('2026-03-05'), '99 99 01')).saldoComplessivoKg).toBe(80)
})
it('ignora i movimenti di un altro tenant', async () => {
  // crea un secondo tenant con un carico di 500 sullo stesso CER
  expect(await disp(new Date('2026-03-05'))).toMatchObject({ saldoComplessivoKg: 0, disponibileAllaDataKg: 0 })
})
```

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npm run test:postgres -- giacenza-disponibile`
Expected: FAIL, modulo non trovato.

- [ ] **Step 3: implementare `giacenzaDisponibileAl`** con la query sopra; `saldoComplessivoKg = Math.round(Number(saldo_totale) * 1000) / 1000`, `disponibileAllaDataKg = Math.round(Number(saldo) * 1000) / 1000`, `vincoloAl = new Date(vincolo_al)`.

- [ ] **Step 4: eseguire i test**

Run: come Step 2. Expected: PASS (10 test).

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/registro/giacenza-disponibile.ts apps/backend/src/application/registro/giacenza-disponibile.postgres.spec.ts
git commit -m "feat(registro): saldo complessivo e saldo dalla data dello scarico in kg, per giorno italiano"
```

---

### Task 3: controllo di giacenza dentro la transaction, sotto lock (blocco sul complessivo, avviso sulle date)

**Files:**
- Create: `apps/backend/src/core/format/formatta-quantita.ts`, `apps/backend/src/core/format/formatta-quantita.spec.ts`
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts`: blocco commentato "1. Validazione preventiva giacenza per SCARICO" (rimosso), blocco "2. Assegnazione numero progressivo" (la transaction), metodo privato `getGiacenzaCer` (rimosso), interfaccia `MovimentoRegistrato` (campo `avvisi`). I blocchi si cercano per commento e nome: dopo il piano D i numeri di riga non corrispondono più.
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.spec.ts` (test di giacenza oggi basati su `prisma.wasteMovement.groupBy`; helper `_mockTransazione`)
- Create: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.postgres.spec.ts`

**Interfaces:**
- Consumes: `giacenzaDisponibileAl` (Task 2), `normalizzaUnitaRegistro`, `simboloUnita` (Task 1), `formattaDataItaliana` (`core/time/anno-italiano.ts`, piano D).
- Produces:
  - `export function formattaQuantita(n: number): string` in `core/format/formatta-quantita.ts`: un `Intl.NumberFormat('it-IT', { maximumFractionDigits: 3, useGrouping: 'always' })` creato una volta a livello di modulo. Con TypeScript 5.4 il tipo di `useGrouping` è ancora `boolean`: scrivere `useGrouping: 'always' as unknown as boolean` con un commento (Node 20 e 24 supportano il valore stringa). **Unico** punto in cui si formattano le quantità dei messaggi, qui e nel piano A.
  - `MovimentoRegistrato.avvisi: string[]` (nuovo campo, `[]` se non ci sono avvisi).
  - Dentro la transaction lo use case lancia `GiacenzaInsufficienteError` (classe privata del file, `extends Error`), che il `catch` di `execute` trasforma in `Result.fail(err.message)` **senza** il prefisso `Errore durante la registrazione:`. Nello spec, `_mockTransazione(record)` **restituisce il `tx`** che passa alla callback.

Nella transaction, dopo il lock `<tenantId>-<anno>` già esistente e **prima** del `MAX(progressive_number)`, se `command.type === 'SCARICO'`:
1. `u = normalizzaUnitaRegistro(command.unit)`. Se `!u.massa`: `logger.warn('Scarico in unità non di massa: controllo di giacenza saltato', { tenantId, cerCode, unit: command.unit })` e si prosegue senza lock né query (Decisione 4).
2. Altrimenti `pg_advisory_xact_lock(hashtext('giacenza|' + tenantId + '|' + cerSenzaStella))`, poi `g = await giacenzaDisponibileAl(tx, { tenantId, cerCode, alla: command.movementDate })`.
3. `richiestoKg = command.quantity * u.fattoreKg`. **Fail-closed:** se `!Number.isFinite(g.saldoComplessivoKg)` o `!Number.isFinite(g.disponibileAllaDataKg)`, `logger.error(...)` e `throw new GiacenzaInsufficienteError(\`Impossibile verificare la giacenza per CER ${cerCode}: riprovare; se il problema persiste, contattare l'assistenza.\`)`.
4. **Blocco** se `g.saldoComplessivoKg + 1e-9 < richiestoKg` (Decisione 8). Unità nei messaggi: `um = simboloUnita(u)`; numeri con `formattaQuantita`, date con `formattaDataItaliana`. Due testi, entrambi chiusi dalla costante `RIMEDIO_CARICO_MANCANTE` (Decisione 12):
   - saldo complessivo ≥ 0: `Giacenza insufficiente per CER ${cerCode}: nel registro restano ${formattaQuantita(g.saldoComplessivoKg / u.fattoreKg)} ${um}, richiesti ${formattaQuantita(command.quantity)} ${um}. ${RIMEDIO_CARICO_MANCANTE}`
   - saldo complessivo < 0: `Giacenza insufficiente per CER ${cerCode}: il registro risulta già sotto zero di ${formattaQuantita(-g.saldoComplessivoKg / u.fattoreKg)} ${um}, quindi nessuno scarico è registrabile finché non si registrano i carichi mancanti. ${RIMEDIO_CARICO_MANCANTE}`
   - `const RIMEDIO_CARICO_MANCANTE = 'Se il rifiuto era già in deposito prima di iniziare a usare il registro, registra il carico mancante con la causale Altro carico (non viene contato come prodotto nel MUD); se è stato prodotto ora, usa Produzione interna.'`
5. **Avviso** (lo scarico si registra) se il blocco non scatta ma `g.disponibileAllaDataKg + 1e-9 < richiestoKg`: testo `Lo scarico è datato ${formattaDataItaliana(command.movementDate)}, ma a quella data il registro ha disponibili ${formattaQuantita(Math.max(0, g.disponibileAllaDataKg) / u.fattoreKg)} ${um}` + (se `vincoloAl` è dopo il giorno dello scarico) ` (il limite viene dal saldo del ${formattaDataItaliana(g.vincoloAl)})` + `: il carico che lo copre è annotato con una data successiva. Lo scarico resta registrato con questa data.` (Il registro è immutabile: il testo non chiede una correzione che l'applicazione non permette; rilievo G3-D-13.) L'avviso va in `avvisi` del movimento restituito e in `logger.warn('Scarico registrato con un ordine di date incoerente', { tenantId, cerCode, movementDate, avviso })`.

- [ ] **Step 1: test di `formattaQuantita`** (`formatta-quantita.spec.ts`), con valori che non dipendono dalla versione ICU (separatori italiani e raggruppamento forzato):

```ts
it.each([
  [1234.5, '1.234,5'],
  [12345.5, '12.345,5'],
  [0.4, '0,4'],
  [1.25, '1,25'],
  [100, '100'],
  [-100, '-100'],
])('formattaQuantita(%p) = %s', (n, atteso) => {
  expect(formattaQuantita(n)).toBe(atteso)
})
```

- [ ] **Step 2: adattare e scrivere i test unitari dello use case.** In testa allo spec: `jest.mock('../giacenza-disponibile')` e `const giacenzaMock = giacenzaDisponibileAl as jest.MockedFunction<typeof giacenzaDisponibileAl>`; nel `beforeEach`, **valore di default esplicito** `giacenzaMock.mockResolvedValue({ saldoComplessivoKg: 1_000_000, disponibileAllaDataKg: 1_000_000, vincoloAl: TODAY })` (con l'automock la funzione restituirebbe `undefined`). `_mockTransazione` restituisce il `tx`. I test che oggi impostano `prisma.wasteMovement.groupBy` passano a `giacenzaMock.mockResolvedValue(...)` e alla `$transaction` mockata. Il test `la query giacenza filtra per tenantId` diventa il primo qui sotto:

```ts
const g = (complessivo: number, allaData = complessivo, vincoloAl = TODAY) =>
  ({ saldoComplessivoKg: complessivo, disponibileAllaDataKg: allaData, vincoloAl })

it('calcola la giacenza dentro la transaction, per tenant, CER e data dello scarico', async () => {
  giacenzaMock.mockResolvedValue(g(50))
  _mockTransazione(recordScarico)
  await useCase.execute(scaricoCmd({ quantity: 10, unit: 'KG', movementDate: TODAY }))
  expect(giacenzaMock).toHaveBeenCalledWith(expect.anything(), { tenantId: TENANT, cerCode: '20 03 01', alla: TODAY })
  expect(prisma.wasteMovement.groupBy).not.toHaveBeenCalled()
})
it('prende il lock della giacenza dopo quello del progressivo e prima di leggere la giacenza', async () => {
  const ordine: string[] = []
  const tx = _mockTransazione(recordScarico)
  tx.$executeRaw.mockImplementation(async (_s: any, chiave: string) => { ordine.push(`lock ${chiave}`); return 0 })
  giacenzaMock.mockImplementation(async () => { ordine.push('giacenza'); return g(1000) })
  await useCase.execute(scaricoCmd())
  expect(ordine).toEqual([`lock ${TENANT}-${annoSolareItaliano(TODAY)}`, `lock giacenza|${TENANT}|20 03 01`, 'giacenza'])
})
it("il messaggio riporta la giacenza nell'unità dello scarico, in formato italiano", async () => {
  giacenzaMock.mockResolvedValue(g(400))
  const tx = _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ quantity: 0.5, unit: 'tonnellate' }))
  expect(r.isFailure).toBe(true)
  expect(r.error).toContain('restano 0,4 t, richiesti 0,5 t')
  expect(r.error).not.toContain('Errore durante la registrazione')
  expect(tx.wasteMovement.create).not.toHaveBeenCalled()
})
it("con l'unità vuota il messaggio scrive kg", async () => {
  giacenzaMock.mockResolvedValue(g(1234.5))
  _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ quantity: 2000, unit: '' }))
  expect(r.error).toContain('restano 1.234,5 kg, richiesti 2.000 kg')
})
it('con il saldo complessivo già negativo il messaggio lo dice', async () => {
  giacenzaMock.mockResolvedValue(g(-100))
  _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ quantity: 1 }))
  expect(r.error).toContain('il registro risulta già sotto zero di 100 kg')
  expect(r.error).not.toContain('-100')
})
it('il messaggio di giacenza insufficiente indica quale carico registrare', async () => {
  giacenzaMock.mockResolvedValue(g(10))
  _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ quantity: 50 }))
  expect(r.error).toContain('registra il carico mancante con la causale Altro carico (non viene contato come prodotto nel MUD)')
  expect(r.error).toContain('se è stato prodotto ora, usa Produzione interna.')
})
it('uno scarico retrodatato coperto dal saldo complessivo si registra con un avviso', async () => {
  giacenzaMock.mockResolvedValue(g(100, 0))
  const tx = _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ quantity: 50, movementDate: new Date('2026-03-05T00:00:00Z') }))
  expect(r.isSuccess).toBe(true)
  expect(tx.wasteMovement.create).toHaveBeenCalled()
  expect(r.value.avvisi).toEqual([expect.stringContaining('Lo scarico è datato 05/03/2026, ma a quella data il registro ha disponibili 0 kg')])
  expect(mockLogger.warn).toHaveBeenCalledWith('Scarico registrato con un ordine di date incoerente', expect.objectContaining({ cerCode: '20 03 01' }))
})
it("l'avviso indica la data del saldo che fa da limite", async () => {
  giacenzaMock.mockResolvedValue(g(100, 0, new Date('2026-03-03T00:00:00Z')))
  _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ movementDate: new Date('2026-03-02T00:00:00Z'), quantity: 10 }))
  expect(r.value.avvisi[0]).toContain('(il limite viene dal saldo del 03/03/2026)')
})
it('senza problemi di date non ci sono avvisi', async () => {
  _mockTransazione(recordScarico)
  expect((await useCase.execute(scaricoCmd())).value.avvisi).toEqual([])
})
it.each([[NaN], [undefined], [null]])('se la giacenza non è un numero finito (%p) lo scarico è rifiutato', async valore => {
  giacenzaMock.mockResolvedValue({ saldoComplessivoKg: valore as any, disponibileAllaDataKg: 1000, vincoloAl: TODAY })
  const tx = _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ quantity: 1 }))
  expect(r.isFailure).toBe(true)
  expect(r.error).toContain('Impossibile verificare la giacenza')
  expect(tx.wasteMovement.create).not.toHaveBeenCalled()
})
it('uno scarico in unità non di massa salta il controllo con un warning', async () => {
  const tx = _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ quantity: 3, unit: 'M3' }))
  expect(r.isSuccess).toBe(true)
  expect(giacenzaMock).not.toHaveBeenCalled()
  expect(mockLogger.warn).toHaveBeenCalledWith('Scarico in unità non di massa: controllo di giacenza saltato', expect.objectContaining({ unit: 'M3' }))
  expect(tx.wasteMovement.create).toHaveBeenCalled()
})
it('un CARICO non legge la giacenza e non prende il lock della giacenza', async () => {
  _mockTransazione(recordCarico)
  await useCase.execute(buildCommand())
  expect(giacenzaMock).not.toHaveBeenCalled()
})
```

(`scaricoCmd(over)` è un helper nuovo dello spec che costruisce un `RegistraMovimentoCommand` SCARICO `CONFERIMENTO_TRASPORTATORE` sul CER `20 03 01`, quantità 100 `KG`, `movementDate` = `TODAY`, **senza `firId`**, con gli override indicati; `recordScarico`/`recordCarico` sono i record già presenti nei test esistenti, estratti in costanti; `mockLogger` è il mock del logger già usato dallo spec; `annoSolareItaliano` si importa da `core/time/anno-italiano`.)

- [ ] **Step 3: scrivere i test di concorrenza e di date su Postgres reale.** `registra-movimento.use-case.postgres.spec.ts`: `new RegistraMovimentoUseCase(prisma as any, loggerStub as any)` con `loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }`; in `beforeAll` tenant nuovo e `prisma.cERCode.upsert({ where: { code: '99 99 01' }, create: { code: '99 99 01', description: 'CER di test', category: '99', subcategory: '' }, update: {} })`; `afterAll` cancella movimenti, tenant e il CER di test.

```ts
it('due scarichi concorrenti in anni di registrazione diversi: ne passa uno solo', async () => {
  // Il lock del progressivo è <tenant>-<anno>: con anni diversi non li serializza.
  // Solo il lock della giacenza può farlo, ed è quello che questo test prova.
  expect((await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2025-12-20'))).isSuccess).toBe(true)
  const [a, b] = await Promise.all([
    useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 100, '2025-12-30', 'KG', undefined, '2025-12-31')),
    useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 100, '2025-12-30', 'KG', undefined, '2026-01-02')),
  ])
  expect([a, b].filter(e => e.isSuccess)).toHaveLength(1)
  expect([a, b].find(e => e.isFailure)!.error).toContain('Giacenza insufficiente')
  expect(await prisma.wasteMovement.count({ where: { tenantId, type: 'SCARICO' } })).toBe(1)
})
it("cinque scarichi concorrenti dell'intera giacenza nello stesso anno: ne passa uno solo", async () => {
  expect((await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2026-03-01'))).isSuccess).toBe(true)
  const esiti = await Promise.all(
    Array.from({ length: 5 }, () => useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 100, '2026-03-02')))
  )
  expect(esiti.filter(e => e.isSuccess)).toHaveLength(1)
  expect(esiti.filter(e => e.isFailure).every(e => e.error.includes('Giacenza insufficiente'))).toBe(true)
})
it("uno scarico retrodatato prima dell'unico carico si registra con un avviso", async () => {
  await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2026-03-10'))
  const r = await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 50, '2026-03-05'))
  expect(r.isSuccess).toBe(true)
  expect(r.value.avvisi[0]).toContain('Lo scarico è datato 05/03/2026')
})
it('uno scarico oltre il saldo complessivo è rifiutato, a qualunque data', async () => {
  await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2026-03-10'))
  expect((await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 150, '2026-03-20'))).isFailure).toBe(true)
})
it('con uno storico incoerente conta il saldo complessivo', async () => {
  // storico scritto senza use case: carico 100, scarico 200 (saldo -100)
  await prisma.wasteMovement.createMany({ data: [movimentoDiretto('CARICO', 100, '2026-02-01', 1), movimentoDiretto('SCARICO', 200, '2026-02-02', 2)] })
  expect((await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 10, '2026-02-11'))).isFailure).toBe(true) // complessivo già -100
  await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 300, '2026-02-10'))
  expect((await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 150, '2026-02-11'))).isSuccess).toBe(true) // complessivo 50
  const r = await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 10, '2026-02-01')) // complessivo 40, ma prima del buco
  expect(r.isSuccess).toBe(true)
  expect(r.value.avvisi).toHaveLength(1)
})
```

(`cmd(type, causale, qty, data, unit = 'KG', firId?, dataRegistrazione = data)` costruisce il comando con CER `99 99 01`, `movementDate = new Date(data)`, `registrationDate = new Date(dataRegistrazione)`: lo use case riceve ancora la data di registrazione dal comando, è il controller che dal Task 10 la fissa; `movimentoDiretto(type, qty, data, n)` costruisce i dati per `createMany` con `progressiveYear: 2025`, `progressiveNumber: 900 + n` per non collidere con i progressivi assegnati dallo use case; `beforeEach` svuota i movimenti del tenant.)

- [ ] **Step 4: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/core/format/formatta-quantita.spec.ts src/application/registro/use-cases/registra-movimento.use-case.spec.ts` (FAIL sui test nuovi) e `npm run test:postgres -- registra-movimento` (FAIL: passa più di uno scarico, nessun avviso, i messaggi hanno il formato vecchio).

- [ ] **Step 5: implementare** `formattaQuantita` e lo spostamento descritto sopra; rimuovere `getGiacenzaCer` e il blocco "1. Validazione preventiva giacenza per SCARICO". Il frontend mostra gli avvisi nel Task 4 (toast).

- [ ] **Step 6: eseguire i test**

Run: entrambi i comandi dello Step 4. Expected: PASS.

- [ ] **Step 7: commit**

```bash
git add apps/backend/src/core/format apps/backend/src/application/registro/use-cases/
git commit -m "fix(registro): giacenza sotto lock, blocco sul saldo complessivo in kg e avviso sull'ordine delle date"
```

- [ ] **Step 8: query informativa, da eseguire prima di confermare la Decisione 8** (saldo progressivo minimo e saldo complessivo per tenant e CER nella famiglia di massa; sola lettura sul VPS, con l'approvazione di Graziano; dati di collaudo). Le righe con `saldo_complessivo < 0` sono i CER in cui **ogni** scarico sarà rifiutato finché non si registrano i carichi mancanti; quelle con solo `saldo_minimo < 0` daranno avvisi sull'ordine delle date:

```sql
WITH mov AS (
  SELECT tenant_id, replace(cer_code, '*', '') AS cer,
         (movement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date AS g,
         SUM(CASE WHEN type = 'CARICO' THEN 1 ELSE -1 END * quantity *
             CASE WHEN upper(btrim(unit)) IN ('T','TON','TONNELLATE','TONNELLATA') THEN 1000 ELSE 1 END) AS delta
  FROM waste_movements
  WHERE upper(btrim(unit)) IN ('KG','KILOGRAMMI','KILOGRAMMO','T','TON','TONNELLATE','TONNELLATA') OR btrim(unit) = ''
  GROUP BY 1, 2, 3
), saldi AS (
  SELECT tenant_id, cer, g, SUM(delta) OVER (PARTITION BY tenant_id, cer ORDER BY g) AS saldo,
         SUM(delta) OVER (PARTITION BY tenant_id, cer) AS saldo_complessivo
  FROM mov
)
SELECT DISTINCT ON (tenant_id, cer) tenant_id, cer, g AS data_minimo, saldo AS saldo_minimo, saldo_complessivo
FROM saldi ORDER BY tenant_id, cer, saldo ASC, g ASC;
```

---

### Task 4: ricopia FIR → registro idempotente

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (`model WasteMovement`: colonna `firIdRicopia`, `@@unique([tenantId, firIdRicopia, type])`)
- Create: `apps/backend/prisma/migrations/20261021120000_registro_ricopia_fir_unica/migration.sql`
- Create: `apps/backend/src/application/registro/ricopia-fir.ts`, `apps/backend/src/application/registro/ricopia-fir.spec.ts`
- Modify: `apps/backend/src/core/domain/errors.ts` (`FirGiaRegistratoError`)
- Modify: `apps/backend/src/api/registro/dtos/registra-movimento.dto.ts` (`quantity`), test `apps/backend/src/api/registro/dtos/registra-movimento.dto.spec.ts` (nuovo)
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts` (`MovimentoRegistrato`, transaction)
- Create: `apps/frontend/src/app/features/registro/registro-messaggi.ts`, `apps/frontend/src/app/features/registro/registro-messaggi.spec.ts`
- Modify: `apps/frontend/src/app/features/registro/registro.service.ts` (interfaccia del movimento registrato: `giaRegistrato?: boolean`, `avvisi?: string[]`), `registro.component.ts` (toast dopo `registra`)
- Test: `registra-movimento.use-case.spec.ts`, `registra-movimento.use-case.postgres.spec.ts` (Task 3)

**Interfaces:**
- Consumes: ordine dei lock (Global Constraints), `normalizzaUnitaRegistro` (Task 1), `MovimentoRegistrato.avvisi` (Task 3).
- Produces:
  - `WasteMovement.firIdRicopia String? @map("fir_id_ricopia") @db.Uuid` — valorizzata con `command.firId` solo dai movimenti registrati da questo codice in poi; i movimenti storici restano `NULL`.
  - `ricopia-fir.ts` (**modulo condiviso**, lo usa anche il piano A per i doppi storici):
    - `export interface DatiRicopia { cerCode: string; quantity: number | string | Prisma.Decimal; unit: string | null; movementDate: Date }`
    - `export function quantitaComeInDatabase(q: number | string | Prisma.Decimal): Prisma.Decimal` — `new Prisma.Decimal(q).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)`, come arrotonda la colonna `numeric(10,2)`. Niente `Math.round(q * 100)`: `1.005 * 100` in virgola mobile vale `100.49999…`.
    - `export function stessiDatiRicopia(a: DatiRicopia, b: DatiRicopia): boolean` — vero se coincidono le cifre del CER (`cerCode.replace(/[^0-9]/g, '')`, così asterisco e spazi non contano), `quantitaComeInDatabase` (con `.equals`), `normalizzaUnitaRegistro(unit).unita` e `movementDate.getTime()`.
  - `MovimentoRegistrato.giaRegistrato: boolean` (nuovo campo, `false` sui movimenti nuovi; un movimento restituito come già registrato ha `avvisi: []`)
  - `RegistraMovimentoDto.quantity`: `@IsNumber({ maxDecimalPlaces: 2 })` al posto di `@IsNumber()` (il form ha già `maxFractionDigits = 2`).
  - `export class FirGiaRegistratoError extends DomainError { constructor(progressiveNumber: number, progressiveYear: number) }`, messaggio: `Il FIR è già registrato nel movimento n. ${progressiveNumber}/${progressiveYear} con dati diversi: verificare quel movimento invece di registrarne un secondo`
  - Frontend: `export function messaggioMovimentoRegistrato(m: { progressiveNumber: number; progressiveYear: number; fuoriTermine?: boolean; giaRegistrato?: boolean }): string` — `Movimento ${anno}/${n} registrato` (+ ` — ATTENZIONE: fuori termine di legge` come oggi), oppure, se `giaRegistrato`, `Il FIR era già registrato nel movimento ${anno}/${n}: nessun nuovo movimento creato`.

Migration (scritta a mano, perché senza database non si può generare; **non può fallire** sui dati esistenti, Decisione 3):

```sql
ALTER TABLE "waste_movements" ADD COLUMN "fir_id_ricopia" UUID;
CREATE UNIQUE INDEX "waste_movements_tenant_id_fir_id_ricopia_type_key"
  ON "waste_movements"("tenant_id", "fir_id_ricopia", "type");
```

In Postgres i `NULL` sono distinti: le righe storiche e i movimenti senza FIR non collidono.

Nella transaction, **per primi** (prima del lock del progressivo e del controllo di giacenza, così un retry di uno scarico non viene respinto per la giacenza che lui stesso ha consumato): se `command.firId`, lock `fir-registro|<tenantId>|<firId>`, poi `tx.wasteMovement.findMany({ where: { tenantId, firId, type }, orderBy: { createdAt: 'asc' } })` (legge `fir_id`, quindi vede anche i movimenti storici, anche se doppi). Se uno di essi soddisfa `stessiDatiRicopia(esistente, comando)` si restituisce quello con `giaRegistrato: true`, `avvisi: []`, `fuoriTermine`/`ritardoGg` ricalcolati come per un movimento nuovo e nessun insert; se ce ne sono ma nessuno coincide, `throw new FirGiaRegistratoError(...)` con il primo. Altrimenti si prosegue e `wasteMovement.create` riceve anche `firIdRicopia: command.firId`. Nel `catch` di `execute`, `DomainError` → `Result.fail(err.message)` senza prefisso; un `P2002` il cui `meta.target` contiene `fir_id_ricopia` → `Result.fail` con lo stesso testo di `FirGiaRegistratoError` (rete di sicurezza, il lock lo rende raro).

- [ ] **Step 0: verificare l'installazione locale** fatta nel Task 0, Step 0 (questo task è il primo che esegue `prisma generate` dopo uno schema cambiato): `(Get-Item C:\Progetti\rifiuti-wt-fase0\node_modules).LinkType` → stringa vuota. Se stampa `Junction`, rifare il Task 0 Step 0 prima di continuare.

- [ ] **Step 1: scrivere i test unitari che falliscono.**

`ricopia-fir.spec.ts`:

```ts
const base = { cerCode: '20 03 01', quantity: 100, unit: 'KG', movementDate: new Date('2026-03-01T00:00:00Z') }
it('stessiDatiRicopia arrotonda come numeric(10,2)', () => {
  expect(stessiDatiRicopia({ ...base, quantity: 1.005 }, { ...base, quantity: '1.01' })).toBe(true)
  expect(stessiDatiRicopia({ ...base, quantity: 100.005 }, { ...base, quantity: new Prisma.Decimal('100.01') })).toBe(true)
  expect(stessiDatiRicopia({ ...base, quantity: 1.004 }, { ...base, quantity: '1.01' })).toBe(false)
})
it('CER con o senza spazi e asterisco, unità con alias: stessi dati', () => {
  expect(stessiDatiRicopia({ ...base, cerCode: '200301*', unit: 'kilogrammi' }, base)).toBe(true)
})
it('data o unità diverse: dati diversi', () => {
  expect(stessiDatiRicopia({ ...base, movementDate: new Date('2026-03-02T00:00:00Z') }, base)).toBe(false)
  expect(stessiDatiRicopia({ ...base, unit: 'T' }, base)).toBe(false)
})
```

`registra-movimento.dto.spec.ts` (`plainToInstance` + `validate` di `class-validator`, con i campi obbligatori minimi):

```ts
it('rifiuta una quantità con più di 2 decimali', async () => {
  const errori = await validate(plainToInstance(RegistraMovimentoDto, { ...minimo, quantity: 1.005 }))
  expect(errori.map(e => e.property)).toContain('quantity')
})
it('accetta 2 decimali', async () => {
  expect(await validate(plainToInstance(RegistraMovimentoDto, { ...minimo, quantity: 1.01 }))).toEqual([])
})
```

Use case (`_mockTransazione` aggiunge al `tx` `wasteMovement.findMany: jest.fn().mockResolvedValue([])` e lo restituisce, Task 3; l'helper `cmd(...)` dello spec Postgres ha già il parametro `firId`):

```ts
it('la stessa ricopia ripetuta restituisce il movimento esistente', async () => {
  const tx = _mockTransazione(recordScarico)
  tx.wasteMovement.findMany.mockResolvedValue([{ ...recordScarico, progressiveNumber: 7, progressiveYear: 2026, firId: 'fir-id-001', quantity: 100, unit: 'KG', movementDate: TODAY }])
  const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
  expect(r.isSuccess).toBe(true)
  expect(r.value).toMatchObject({ progressiveNumber: 7, giaRegistrato: true, avvisi: [] })
  expect(tx.wasteMovement.create).not.toHaveBeenCalled()
  expect(giacenzaMock).not.toHaveBeenCalled()
})
it('il confronto usa la quantità arrotondata come la salva il database', async () => {
  const tx = _mockTransazione(recordScarico)
  tx.wasteMovement.findMany.mockResolvedValue([{ ...recordScarico, progressiveNumber: 7, progressiveYear: 2026, quantity: new Prisma.Decimal('1.01'), unit: 'KG', movementDate: TODAY }])
  const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001', quantity: 1.005 }))
  expect(r.value).toMatchObject({ giaRegistrato: true })
})
it('una seconda ricopia con quantità diversa è rifiutata', async () => {
  const tx = _mockTransazione(recordScarico)
  tx.wasteMovement.findMany.mockResolvedValue([{ ...recordScarico, progressiveNumber: 7, progressiveYear: 2026, quantity: 100, unit: 'KG', movementDate: TODAY }])
  const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001', quantity: 90 }))
  expect(r.error).toBe(new FirGiaRegistratoError(7, 2026).message)
  expect(tx.wasteMovement.create).not.toHaveBeenCalled()
})
it('un movimento nuovo ha giaRegistrato false e salva firIdRicopia', async () => {
  const tx = _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
  expect(r.value.giaRegistrato).toBe(false)
  expect(tx.wasteMovement.create.mock.calls[0][0].data).toMatchObject({ firId: 'fir-id-001', firIdRicopia: 'fir-id-001' })
})
```

(I comandi con `firId` richiedono che `prisma.fIR.findFirst` restituisca un FIR collegabile: dopo il Task 5 lo stub di default dello spec lo fa; fino ad allora lo stub `{ id }` di oggi basta, perché il controllo di stato non esiste ancora.)

`registro-messaggi.spec.ts`:

```ts
it('movimento nuovo', () => {
  expect(messaggioMovimentoRegistrato({ progressiveNumber: 4, progressiveYear: 2026 })).toBe('Movimento 2026/4 registrato')
})
it('ricopia già registrata', () => {
  expect(messaggioMovimentoRegistrato({ progressiveNumber: 4, progressiveYear: 2026, giaRegistrato: true }))
    .toBe('Il FIR era già registrato nel movimento 2026/4: nessun nuovo movimento creato')
})
```

- [ ] **Step 2: scrivere i test Postgres** (in coda a `registra-movimento.use-case.postgres.spec.ts`; serve un FIR **emesso** del tenant, creato come in `fir-prisma.repository.postgres.spec.ts:66-77` con un utente del tenant e `repo.save`, poi portato a `AWAITING_CARRIER` con `prisma.fIR.update`):

```ts
it('la stessa ricopia ripetuta restituisce il movimento esistente', async () => {
  await useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 1.005, '2026-03-01', 'KG', firId))
  const a = await useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 1.005, '2026-03-01', 'KG', firId))
  expect(a.value.giaRegistrato).toBe(true)
  expect(await prisma.wasteMovement.count({ where: { tenantId, firId } })).toBe(1)
})
it('due ricopie concorrenti dello stesso FIR producono un solo movimento', async () => {
  const [x, y] = await Promise.all([
    useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 100, '2026-03-01', 'KG', firId)),
    useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 100, '2026-03-01', 'KG', firId)),
  ])
  expect(x.isSuccess && y.isSuccess).toBe(true)
  expect(x.value.id).toBe(y.value.id)
  expect([x.value.giaRegistrato, y.value.giaRegistrato].sort()).toEqual([false, true])
})
it("l'indice unico rifiuta un doppio scritto senza passare dallo use case", async () => {
  // due prisma.wasteMovement.create con stessi tenantId, firIdRicopia e type → il secondo rejects con code 'P2002'
})
it('i doppi storici (fir_id_ricopia NULL) restano ammessi', async () => {
  // due prisma.wasteMovement.create con stessi tenantId, firId e type e firIdRicopia assente → entrambi riescono
})
```

- [ ] **Step 3: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/application/registro/ricopia-fir.spec.ts src/api/registro/dtos/registra-movimento.dto.spec.ts src/application/registro/use-cases/registra-movimento.use-case.spec.ts` e `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/registro/registro-messaggi.spec.ts`. Expected: FAIL sui test nuovi.

- [ ] **Step 4: schema, migration, modulo, errore, DTO, use case e frontend.** Dopo `registra(...)` il componente mostra `messaggioMovimentoRegistrato(m)` (con `toast.info` se `giaRegistrato`, `toast.success` altrimenti) e un `toast.warn` per ciascuna voce di `m.avvisi`. Poi `cd apps/backend && npx prisma validate && npx prisma generate` (sulla copia locale del Task 0, Step 0).

- [ ] **Step 5: eseguire i test**

Run: i due comandi dello Step 3, poi (con il database locale) `cd apps/backend && npx prisma migrate deploy && npm run test:postgres -- registra-movimento`. Expected: PASS. La migration applicata su un database con doppi storici non fallisce (lo prova il quarto test Postgres).

- [ ] **Step 6: query informativa, da eseguire prima di confermare la Decisione 3** (doppi storici, solo per conoscenza: non si correggono; sola lettura sul VPS di collaudo, con l'approvazione di Graziano):

```sql
SELECT tenant_id, fir_id, type, array_agg(progressive_year || '/' || progressive_number) AS movimenti
FROM waste_movements WHERE fir_id IS NOT NULL
GROUP BY tenant_id, fir_id, type HAVING COUNT(*) > 1;
```

- [ ] **Step 7: commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/20261021120000_registro_ricopia_fir_unica apps/backend/src/core/domain/errors.ts apps/backend/src/application/registro/ apps/backend/src/api/registro/dtos/ apps/frontend/src/app/features/registro/
git commit -m "fix(registro): un FIR si ricopia una sola volta per tipo, il retry restituisce il movimento esistente"
```

---

### Task 5: un movimento si collega solo a un FIR collegabile (modulo unico degli stati del FIR)

**Files:**
- Create: `apps/backend/src/domain/fir/stati-fir.ts`, `apps/backend/src/domain/fir/stati-fir.spec.ts`
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts` (blocco commentato "0d. Se è indicato un FIR collegato, deve esistere e appartenere al tenant")
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.spec.ts`
- Modify: `apps/backend/src/api/fir/dtos/fir-response.dto.ts` (campo `rentriStatoFormulario` e sua valorizzazione da `fir.rentriStatoFormulario`)
- Modify: `apps/frontend/src/app/shared/models/fir.model.ts` (`rentriStatoFormulario?: string | null`)
- Create: `apps/frontend/src/app/features/registro/registro-fir.ts`, `apps/frontend/src/app/features/registro/registro-fir.spec.ts`
- Modify: `apps/frontend/src/app/features/registro/registro.component.ts` (`caricaFir`)

**Interfaces:**
- Consumes: `FIR.rentriStatoFormulario` letto e scritto davvero dal repository (Task 0); senza il Task 0 il ramo "annullato all'ente" non scatterebbe mai fuori dai mock.
- Produces (`domain/fir/stati-fir.ts`, **modulo puro e unico**, nessun `@Injectable` e nessun import da Prisma; lo importa anche il piano A al posto di ogni elenco proprio):
  - `export const STATI_FIR_EMESSI = ['AWAITING_CARRIER', 'AWAITING_RECEIVER', 'COMPLETED', 'SYNCED_TO_RENTRI'] as const`
  - `export const STATI_FIR_IN_BOZZA = ['DRAFT', 'AWAITING_PRODUCER'] as const` (`AWAITING_PRODUCER` è una bozza: `DB_TO_STATO` lo mappa su `BOZZA`)
  - `export const STATO_FIR_ANNULLATO = 'CANCELLED'`, `export const STATO_RENTRI_ANNULLATO = 'Annullato'`
  - `export interface FirPerStato { id: string; status: string | null | undefined; firNumber: string | null; rentriNumeroFir?: string | null; rentriStatoFormulario?: string | null }`
  - `export type CollegabilitaFir = { collegabile: true; base: 'EMESSO' | 'NUMERO_RENTRI' } | { collegabile: false; motivo: 'ANNULLATO' | 'BOZZA' | 'STATO_SCONOSCIUTO' }`
  - `export function firAnnullato(f: FirPerStato): boolean` — `status === 'CANCELLED'` oppure `rentriStatoFormulario === 'Annullato'`.
  - `export function collegabilitaFir(f: FirPerStato): CollegabilitaFir` — nell'ordine: `status` fuori da emessi ∪ bozza ∪ annullato (o assente) → `STATO_SCONOSCIUTO`; `firAnnullato` → `ANNULLATO`; stato emesso → `EMESSO`; `rentriNumeroFir?.trim()` → `NUMERO_RENTRI`; altrimenti `BOZZA` (Decisione 9).
  - `export function etichettaFir(f: Pick<FirPerStato, 'id' | 'firNumber' | 'rentriNumeroFir'>): string` — `rentriNumeroFir` (il numero che l'utente vede sul documento), poi `firNumber`, poi `` `id ${id.slice(0, 8)}` ``. **Unica** definizione (il piano A non la riscrive).
- La `findFirst` del blocco 0d seleziona `{ id, status, firNumber, rentriNumeroFir, rentriStatoFormulario }`. Messaggi di rifiuto (`etichetta = etichettaFir(fir)`):
  - `BOZZA`: `Il FIR ${etichetta} è ancora in bozza: si registra nel registro solo dopo l'emissione. Se il trasporto è già avvenuto con un altro formulario, registra lo scarico senza collegare questo FIR.` (rilievo G3-D-14: la via d'uscita per chi ha usato la bozza come formulario cartaceo)
  - `ANNULLATO`: `Il FIR ${etichetta} è annullato: non si può collegare a un movimento del registro.`
  - `STATO_SCONOSCIUTO`: `Il FIR ${etichetta} ha uno stato non riconosciuto (${status ?? 'assente'}): non si può collegare a un movimento; contattare l'assistenza.`
- Frontend (`registro-fir.ts`): `export function firCollegabileNelRegistro(fir: Pick<FIR, 'stato' | 'rentriNumeroFir' | 'rentriStatoFormulario'>): boolean` — stessa regola sugli stati del frontend: falso se `stato === FIRStato.ANNULLATO` o `rentriStatoFormulario === 'Annullato'`; vero se `stato` è `EMESSO`, `IN_TRANSITO` o `CONSEGNATO`; vero se `BOZZA` con `rentriNumeroFir` non vuoto; falso altrimenti (anche per uno stato sconosciuto). Commento: rispecchia `domain/fir/stati-fir.ts`, il backend resta l'arbitro.

- [ ] **Step 1: scrivere i test che falliscono.**

`stati-fir.spec.ts`:

```ts
const fir = (p: Partial<FirPerStato>): FirPerStato => ({ id: 'abcdef12-3456', status: 'DRAFT', firNumber: 'FIR-2026-000007', rentriNumeroFir: null, rentriStatoFormulario: null, ...p })
it('emessi, bozza e annullato coprono tutto FIRStatus, senza sovrapporsi', () => {
  expect([...STATI_FIR_EMESSI, ...STATI_FIR_IN_BOZZA, STATO_FIR_ANNULLATO].sort()).toEqual(Object.values(FIRStatus).sort()) // FIRStatus da '@prisma/client', solo nello spec
})
it('un FIR emesso in locale è collegabile', () => {
  expect(collegabilitaFir(fir({ status: 'AWAITING_CARRIER' }))).toEqual({ collegabile: true, base: 'EMESSO' })
})
it('un FIR in bozza locale con numero RENTRI è collegabile', () => {
  expect(collegabilitaFir(fir({ status: 'DRAFT', rentriNumeroFir: 'RENTRI-1' }))).toEqual({ collegabile: true, base: 'NUMERO_RENTRI' })
})
it('una bozza senza numero RENTRI non è collegabile', () => {
  expect(collegabilitaFir(fir({ status: 'AWAITING_PRODUCER' }))).toEqual({ collegabile: false, motivo: 'BOZZA' })
})
it("annullato all'ente vale come annullato", () => {
  expect(collegabilitaFir(fir({ status: 'AWAITING_CARRIER', rentriStatoFormulario: 'Annullato' }))).toEqual({ collegabile: false, motivo: 'ANNULLATO' })
  expect(collegabilitaFir(fir({ status: 'CANCELLED', rentriNumeroFir: 'RENTRI-1' }))).toEqual({ collegabile: false, motivo: 'ANNULLATO' })
})
it.each(['QUALCOSA', undefined, null])('uno stato sconosciuto o assente (%p) non è collegabile', status => {
  expect(collegabilitaFir(fir({ status: status as any, rentriNumeroFir: 'RENTRI-1' }))).toEqual({ collegabile: false, motivo: 'STATO_SCONOSCIUTO' })
})
it("etichettaFir preferisce il numero RENTRI, poi il riferimento interno, poi l'id abbreviato", () => {
  expect(etichettaFir({ id: 'abcdef12-3456', firNumber: 'FIR-9', rentriNumeroFir: 'RENTRI-1' })).toBe('RENTRI-1')
  expect(etichettaFir({ id: 'abcdef12-3456', firNumber: 'FIR-9', rentriNumeroFir: null })).toBe('FIR-9')
  expect(etichettaFir({ id: 'abcdef12-3456', firNumber: null })).toBe('id abcdef12')
})
```

Use case: lo stub di default di `prisma.fIR.findFirst` in `buildPrisma` (oggi `{ id: 'fir-id-001' }`) diventa `{ id: 'fir-id-001', status: 'AWAITING_CARRIER', firNumber: 'FIR-2026-000007', rentriNumeroFir: null, rentriStatoFormulario: null }`.

```ts
it.each([
  [{ status: 'DRAFT' }, "Il FIR FIR-2026-000007 è ancora in bozza: si registra nel registro solo dopo l'emissione. Se il trasporto è già avvenuto con un altro formulario, registra lo scarico senza collegare questo FIR."],
  [{ status: 'AWAITING_PRODUCER' }, "Il FIR FIR-2026-000007 è ancora in bozza: si registra nel registro solo dopo l'emissione. Se il trasporto è già avvenuto con un altro formulario, registra lo scarico senza collegare questo FIR."],
  [{ status: 'CANCELLED', rentriNumeroFir: 'ABC123' }, 'Il FIR ABC123 è annullato: non si può collegare a un movimento del registro.'],
  [{ status: 'AWAITING_CARRIER', rentriStatoFormulario: 'Annullato' }, 'Il FIR FIR-2026-000007 è annullato: non si può collegare a un movimento del registro.'],
  [{ status: 'BOH' }, "Il FIR FIR-2026-000007 ha uno stato non riconosciuto (BOH): non si può collegare a un movimento; contattare l'assistenza."],
])('rifiuta il collegamento a un FIR %o', async (over, messaggio) => {
  prisma.fIR.findFirst.mockResolvedValue({ id: 'fir-id-001', firNumber: 'FIR-2026-000007', rentriNumeroFir: null, rentriStatoFormulario: null, ...over })
  const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
  expect(r.isFailure).toBe(true)
  expect(r.error).toBe(messaggio)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})
it.each(['AWAITING_CARRIER', 'AWAITING_RECEIVER', 'COMPLETED', 'SYNCED_TO_RENTRI'])('accetta il collegamento a un FIR %s', async status => {
  prisma.fIR.findFirst.mockResolvedValue({ id: 'fir-id-001', status, firNumber: 'FIR-2026-000007', rentriNumeroFir: null, rentriStatoFormulario: null })
  _mockTransazione(recordScarico)
  expect((await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))).isSuccess).toBe(true)
})
it('accetta il collegamento a un FIR in bozza locale con numero RENTRI (acquisito o agganciato)', async () => {
  prisma.fIR.findFirst.mockResolvedValue({ id: 'fir-id-001', status: 'DRAFT', firNumber: null, rentriNumeroFir: 'RENTRI-1', rentriStatoFormulario: null })
  _mockTransazione(recordScarico)
  expect((await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))).isSuccess).toBe(true)
})
```

`registro-fir.spec.ts` (Karma):

```ts
const casi: Array<[string, Partial<FIR>, boolean]> = [
  ['emesso', { stato: FIRStato.EMESSO }, true],
  ['consegnato', { stato: FIRStato.CONSEGNATO }, true],
  ['bozza con numero RENTRI', { stato: FIRStato.BOZZA, rentriNumeroFir: 'RENTRI-1' }, true],
  ['bozza senza numero RENTRI', { stato: FIRStato.BOZZA, rentriNumeroFir: null }, false],
  ['annullato con numero RENTRI', { stato: FIRStato.ANNULLATO, rentriNumeroFir: 'RENTRI-1' }, false],
  ["annullato all'ente", { stato: FIRStato.IN_TRANSITO, rentriStatoFormulario: 'Annullato' }, false],
  ['stato sconosciuto', { stato: 'SCONOSCIUTO' as any }, false],
]
for (const [nome, fir, atteso] of casi) {
  it(`firCollegabileNelRegistro: ${nome} → ${atteso}`, () => {
    expect(firCollegabileNelRegistro(fir as any)).toBe(atteso)
  })
}
```

(Jasmine non ha `it.each`: un `it` per caso, generato dal ciclo.)

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/domain/fir/stati-fir.spec.ts src/application/registro/use-cases/registra-movimento.use-case.spec.ts -t "stati|collegamento|etichetta|FIRStatus"` e `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/registro/registro-fir.spec.ts`. Expected: FAIL (moduli inesistenti, nessun rifiuto).

- [ ] **Step 3: implementare** `stati-fir.ts`, il controllo nel blocco 0d (dopo il controllo di esistenza, con `collegabilitaFir` ed `etichettaFir`), il campo del DTO di risposta del FIR, il modello frontend, `registro-fir.ts` e in `caricaFir` `this.tuttiFir = (res.items ?? []).filter(firCollegabileNelRegistro)`, così l'autocompletamento propone solo i FIR collegabili.

- [ ] **Step 4: eseguire i test** (comandi dello Step 2 senza `-t`, poi `npm run test:postgres -- registra-movimento` e `cd apps/backend && npx tsc -p tsconfig.json --noEmit`). Expected: PASS. Il test Karma va eseguito **in locale**: nessun gate lo esegue.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/domain/fir/stati-fir.ts apps/backend/src/domain/fir/stati-fir.spec.ts apps/backend/src/application/registro/use-cases/ apps/backend/src/api/fir/dtos/fir-response.dto.ts apps/frontend/src/app/shared/models/fir.model.ts apps/frontend/src/app/features/registro/
git commit -m "fix(registro): collegamento solo a FIR emessi o con numero RENTRI non annullato, anche nell'autocompletamento"
```

---

### Task 6: giacenze della pagina in kg veri, altre unità a parte, scarichi su FIR annullati

**Files:**
- Modify: `apps/backend/src/application/giacenze/giacenze.service.ts:6-84`
- Modify: `apps/backend/src/application/giacenze/giacenze.service.spec.ts`
- Modify: `apps/frontend/src/app/features/giacenze/giacenze.service.ts:7-13` (interfaccia `Giacenza`)
- Modify: `apps/frontend/src/app/features/giacenze/giacenze.component.ts:138-152` (tabella)
- Create: `apps/frontend/src/app/features/giacenze/giacenze.component.spec.ts`

**Interfaces:**
- Consumes: `normalizzaUnitaRegistro` (Task 1); `firAnnullato`, `etichettaFir` (Task 5); la colonna `rentri_stato_formulario` valorizzata dal Task 0.
- Produces:
  - `GiacenzaCer.altreUnita: Array<{ unita: string; carico: number; scarico: number; giacenza: number }>` (backend e interfaccia frontend `Giacenza`). `caricoKg`/`scaricoKg`/`giacenzaKg` contengono solo la famiglia di massa, con le tonnellate ×1000.
  - `GiacenzaCer.scarichiSuFirAnnullati: Array<{ numero: string; quantita: number; unita: string; fir: string }>` (`numero` = `progressiveYear/progressiveNumber`, `fir` = `etichettaFir`): scarichi del CER collegati a un FIR poi annullato (Decisione 11). La giacenza li conta ancora, il MUD no.

Il primo `groupBy` diventa `by: ['cerCode', 'type', 'unit']`; ogni riga si somma, tramite `normalizzaUnitaRegistro`, nei campi kg (se `massa`, moltiplicando per `fattoreKg`) o nella voce di `altreUnita` della sua `unita`. Gli alert (`getDepositoTemporaneoAlerts`) restano sui kg, ora corretti. Per gli scarichi su FIR annullati due query: `prisma.fIR.findMany({ where: { tenantId, OR: [{ status: 'CANCELLED' }, { rentriStatoFormulario: 'Annullato' }] }, select: { id, status, firNumber, rentriNumeroFir, rentriStatoFormulario } })`, poi, se non è vuota, `prisma.wasteMovement.findMany({ where: { tenantId, type: 'SCARICO', firId: { in: ids } }, select: { cerCode, progressiveNumber, progressiveYear, quantity, unit, firId } })`, attaccati alla riga del loro `cerCode`.

- [ ] **Step 1: scrivere i test che falliscono**

```ts
it('converte le tonnellate in kg e tiene i litri fuori dai kg', async () => {
  mockGroupBy(
    [
      { cerCode: '170405', type: 'CARICO', unit: 'T', _sum: { quantity: 1 } },
      { cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 500 } },
      { cerCode: '170405', type: 'SCARICO', unit: 'kg', _sum: { quantity: 200 } },
      { cerCode: '170405', type: 'CARICO', unit: 'LITRI', _sum: { quantity: 30 } },
    ],
    []
  )
  const [g] = await service.getGiacenze('t1')
  expect(g).toMatchObject({ caricoKg: 1500, scaricoKg: 200, giacenzaKg: 1300 })
  expect(g.altreUnita).toEqual([{ unita: 'LITRI', carico: 30, scarico: 0, giacenza: 30 }])
})
it('elenca gli scarichi collegati a FIR annullati, senza toglierli dalla giacenza', async () => {
  mockGroupBy([{ cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 500 } },
               { cerCode: '170405', type: 'SCARICO', unit: 'KG', _sum: { quantity: 200 } }], [])
  prisma.fIR.findMany.mockResolvedValue([{ id: 'f1', status: 'AWAITING_CARRIER', firNumber: 'FIR-2026-000003', rentriNumeroFir: null, rentriStatoFormulario: 'Annullato' }])
  prisma.wasteMovement.findMany.mockResolvedValue([{ cerCode: '170405', progressiveNumber: 9, progressiveYear: 2026, quantity: 200, unit: 'KG', firId: 'f1' }])
  const [g] = await service.getGiacenze('t1')
  expect(g.giacenzaKg).toBe(300)
  expect(g.scarichiSuFirAnnullati).toEqual([{ numero: '2026/9', quantita: 200, unita: 'KG', fir: 'FIR-2026-000003' }])
  expect(prisma.fIR.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) }))
})
```

(Il mock di `beforeEach` aggiunge `fIR.findMany` e `wasteMovement.findMany` che restituiscono `[]`.)

Frontend, `giacenze.component.spec.ts` (schema di `features/dashboard/dashboard.component.spec.ts`, `GiacenzeService` sostituito da uno stub con `of(...)`):

```ts
it('mostra le giacenze in unità diverse dal kg accanto alla riga del CER', () => {
  // getGiacenze → [{ cerCode: '170405', caricoKg: 0, scaricoKg: 0, giacenzaKg: 0, oldestCaricoDate: null,
  //                  altreUnita: [{ unita: 'LITRI', carico: 30, scarico: 0, giacenza: 30 }], scarichiSuFirAnnullati: [] }]
  expect(fixture.nativeElement.textContent).toContain('30 LITRI')
})
it('avvisa degli scarichi su FIR annullati', () => {
  // scarichiSuFirAnnullati: [{ numero: '2026/9', quantita: 200, unita: 'KG', fir: 'FIR-2026-000003' }]
  expect(fixture.nativeElement.textContent).toContain(
    'Scarico 2026/9 (200 KG) collegato al FIR FIR-2026-000003, poi annullato: la giacenza lo conta ancora.'
  )
})
```

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/application/giacenze/giacenze.service.spec.ts`; `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/giacenze/giacenze.component.spec.ts`. Expected: FAIL.

- [ ] **Step 3: implementare** il servizio e, nella cella "Giacenza (kg)", una riga per ogni voce di `altreUnita` nel formato `{{ a.giacenza | number: '1.0-2' }} {{ a.unita }}`; sotto la riga del CER, un `p-tag severity="warning"` per ogni voce di `scarichiSuFirAnnullati` con il testo esatto del test. Adeguare i test esistenti di `giacenze.service.spec.ts` aggiungendo `unit: 'KG'` alle righe mockate.

- [ ] **Step 4: eseguire i test** (comandi dello Step 2; il test Karma va eseguito **in locale**: nessun gate lo esegue). Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/giacenze/ apps/frontend/src/app/features/giacenze/
git commit -m "fix(giacenze): kg e tonnellate sommati correttamente, altre unità a parte, avviso sugli scarichi di FIR annullati"
```

Nella descrizione della PR: al primo deploy le giacenze in kg dei CER con movimenti in tonnellate cambiano (×1000) e gli alert del deposito temporaneo possono comparire tutti insieme; le giacenze in m³ non sono coperte dagli alert volumetrici (follow-up).

---

### Task 7: salvataggio atomico di FIR e firme

**Files:**
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts:201-341` (`save`, `persistSignatures`)
- Modify: `apps/backend/src/core/domain/errors.ts` (`FirmaSenzaUtenteError`)
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.spec.ts:75-92` (mock), `:338-345`
- Test: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.postgres.spec.ts`

**Interfaces:**
- Produces:
  - `private async salvaCon(client: Prisma.TransactionClient, fir: FIR): Promise<void>`: upsert + firme sullo stesso client; usato da `save` e dal Task 8.
  - `save(fir)` = `this.prisma.$transaction(tx => this.salvaCon(tx, fir))`, firma pubblica invariata.
  - `persistSignatures(client: Prisma.TransactionClient, fir: FIR)`.
  - `export class FirmaSenzaUtenteError extends DomainError { constructor(ruolo: string, firId: string) }`, messaggio: `La firma ${ruolo} del FIR ${firId} non indica l'utente che l'ha apposta: il FIR non viene salvato` (Decisione 5).

La traduzione `translateUniqueConstraintError` resta attorno all'upsert, dentro `salvaCon`.

- [ ] **Step 1: test unitari.** Nel mock di `beforeEach` aggiungere `$transaction: jest.fn(async (fn: any) => fn(prisma))`. Il test `non tenta di persistere una firma priva di userId` diventa:

```ts
it('rifiuta il salvataggio di una firma priva di userId, senza scrivere nulla', async () => {
  const fir = buildFirWithFirmaProduttore()
  ;(fir.firme.produttore as any).userId = undefined
  await expect(repo.save(fir)).rejects.toThrow(FirmaSenzaUtenteError)
  expect(prisma.fIRSignature.create).not.toHaveBeenCalled()
})
it('save esegue upsert e firme nella stessa transaction', async () => {
  await repo.save(buildFirWithFirmaProduttore())
  expect(prisma.$transaction).toHaveBeenCalledTimes(1)
})
```

Il controllo su `userId` va fatto per tutte le firme **prima** dell'upsert.

- [ ] **Step 2: test Postgres** (in `fir-prisma.repository.postgres.spec.ts`, nuovo `describe`, stesso setup del file):

```ts
it('se la firma non si può scrivere, lo stato del FIR non cambia', async () => {
  const fir = FIR.create({ /* come buildFirAgganciato, senza aggancio */ })
  await repo.save(fir) // BOZZA
  fir.emetti('FIR-2099-000001', {
    firmatario: 'Mario Rossi',
    timestamp: new Date(),
    certificato: 'x',
    userId: '99999999-9999-4999-8999-999999999999', // utente inesistente: viola la FK
  })
  await expect(repo.save(fir)).rejects.toThrow()
  const riletto = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
  expect(riletto.status).toBe('DRAFT')
  expect(riletto.firNumber).toBeNull()
})
```

- [ ] **Step 3: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/infrastructure/persistence/fir-prisma.repository.spec.ts` e `npm run test:postgres -- fir-prisma`. Expected: FAIL (oggi il FIR resta `AWAITING_CARRIER` con numero assegnato).

- [ ] **Step 4: implementare** `salvaCon` e il nuovo `save`.

- [ ] **Step 5: eseguire i test** (comandi dello Step 3). Expected: PASS.

- [ ] **Step 6: commit**

```bash
git add apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts apps/backend/src/infrastructure/persistence/fir-prisma.repository.spec.ts apps/backend/src/infrastructure/persistence/fir-prisma.repository.postgres.spec.ts apps/backend/src/core/domain/errors.ts
git commit -m "fix(fir): stato e firme salvati nella stessa transaction"
```

---

### Task 8: riferimento interno del FIR serializzato per tenant e anno di emissione

**Files:**
- Create: `apps/backend/src/domain/fir/numero-fir.ts` + `numero-fir.spec.ts`
- Modify: `apps/backend/src/domain/fir/repositories/fir-repository.interface.ts:77-80`
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts` (`emettiConNumerazione` nuovo; `generateNumeroProgressivo`, oggi `:376-404`, resta `@deprecated` fino al Task 9)
- Modify: `apps/backend/src/core/domain/errors.ts` (`FirNonPiuInBozzaError`)
- Modify (doppi di test che implementano `IFIRRepository`): `src/application/fir/queries/get-fir-by-id.handler.spec.ts`, `queries/list-firs.handler.spec.ts`, `use-cases/conferma-consegna-fir.use-case.spec.ts`, `use-cases/create-fir.use-case.spec.ts`, `use-cases/emetti-fir.use-case.spec.ts`, `use-cases/presa-in-carico-fir.use-case.spec.ts`, `src/application/rentri/aggancio-formulari-ciclo-completo.oracolo.spec.ts`
- Test: `fir-prisma.repository.postgres.spec.ts`

**Interfaces:**
- Consumes: `salvaCon` (Task 7); `annoSolareItaliano` da `apps/backend/src/core/time/anno-italiano.ts` (piano D: **non** ridefinirla qui).
- Produces:
  - `export function formattaNumeroFir(anno: number, progressivo: number): string` → `FIR-2027-000001` (6 cifre minime, nessun troncamento oltre). JSDoc: è il **riferimento interno** del FIR; il numero legale in regime RENTRI è quello vidimato (`rentriNumeroFir`), Decisione 7.
  - `IFIRRepository.emettiConNumerazione(fir: FIR, anno: number, applicaEmissione: (numeroProgressivo: string) => void): Promise<string>`: restituisce il riferimento interno assegnato. **Affianca** `generateNumeroProgressivo`, che in questo task resta in interfaccia, repository e doppi con un JSDoc `@deprecated usare emettiConNumerazione` (oggi `emetti-fir.use-case.ts` la chiama: toglierla qui romperebbe `tsc`, `nest build` e il caricamento dello spec in ts-jest). Sparisce nel Task 9, nello stesso commit che cambia lo use case, così ogni commit compila. JSDoc: è la transaction di emissione in cui il piano `2026-09-12-collegamento-scorta-emissione.md` aggiungerà il consumo del numero vidimato.
  - `export class FirNonPiuInBozzaError extends DomainError { constructor(firId: string) }`, messaggio: `Il FIR ${firId} non è più in bozza: è già stato emesso o annullato da un'altra operazione`

`emettiConNumerazione` in una sola `this.prisma.$transaction(async tx => ...)`:
1. `pg_advisory_xact_lock(hashtext('fir-numero|' + tenantId + '|' + anno))`, con `tenantId = fir.tenantId ?? fir.produttoreId` come oggi;
2. `SELECT status::text FROM firs WHERE id = ${fir.id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`: se la riga manca o lo stato non è `DRAFT`/`AWAITING_PRODUCER` (entrambi mappati su `BOZZA`, `DB_TO_STATO`), `throw new FirNonPiuInBozzaError(fir.id)`;
3. `SELECT MAX(CAST(substring(fir_number FROM '^FIR-[0-9]{4}-([0-9]+)$') AS integer)) AS max_num FROM firs WHERE tenant_id = ${tenantId}::uuid AND fir_number LIKE ${'FIR-' + anno + '-%'}`: l'anno si legge dal **numero**, non da `createdAt`, e il massimo è numerico, non sull'ordine delle stringhe;
4. `numero = formattaNumeroFir(anno, (max_num ?? 0) + 1)`; `applicaEmissione(numero)` (un'eccezione del dominio annulla tutto);
5. `await this.salvaCon(tx, fir)`; `return numero`.

Doppi di test: in ognuna delle sette classi si **aggiunge**, accanto a `generateNumeroProgressivo` (che resta fino al Task 9),

```ts
async emettiConNumerazione(fir: FIR, anno: number, applica: (n: string) => void): Promise<string> {
  this.progressiveCounter = (this.progressiveCounter ?? 0) + 1
  const numero = formattaNumeroFir(anno, this.progressiveCounter)
  applica(numero)
  await this.save(fir)
  return numero
}
```

(se la classe non ha `progressiveCounter`, aggiungere `private progressiveCounter = 0`).

- [ ] **Step 1: test unitari di `numero-fir`**

```ts
it('formattaNumeroFir', () => {
  expect(formattaNumeroFir(2027, 1)).toBe('FIR-2027-000001')
  expect(formattaNumeroFir(2027, 1234567)).toBe('FIR-2027-1234567')
})
```

- [ ] **Step 2: test Postgres** (nuovo `describe` in `fir-prisma.repository.postgres.spec.ts`, con un tenant dedicato per non contare i FIR degli altri test; `firma(userId)` costruisce una `FirmaDigitale` valida; `bozza()` crea e salva un FIR in BOZZA):

```ts
it("una bozza creata a dicembre ed emessa a gennaio conta nel progressivo dell'anno di emissione", async () => {
  const a = await bozza()
  await prisma.fIR.update({ where: { id: a.id }, data: { createdAt: new Date('2026-12-31T10:00:00Z') } })
  expect(await repo.emettiConNumerazione(a, 2027, n => a.emetti(n, firma(userId)))).toBe('FIR-2027-000001')
  const b = await bozza()
  expect(await repo.emettiConNumerazione(b, 2027, n => b.emetti(n, firma(userId)))).toBe('FIR-2027-000002')
})
it('due emissioni concorrenti di bozze diverse prendono numeri consecutivi senza errori', async () => {
  const [x, y] = [await bozza(), await bozza()]
  const numeri = await Promise.all([
    repo.emettiConNumerazione(x, 2028, n => x.emetti(n, firma(userId))),
    repo.emettiConNumerazione(y, 2028, n => y.emetti(n, firma(userId))),
  ])
  expect(numeri.sort()).toEqual(['FIR-2028-000001', 'FIR-2028-000002'])
})
it('la stessa bozza emessa due volte in parallelo: una sola emissione', async () => {
  const f = await bozza()
  const copia1 = (await repo.findById(f.id))!
  const copia2 = (await repo.findById(f.id))!
  const esiti = await Promise.allSettled([
    repo.emettiConNumerazione(copia1, 2029, n => copia1.emetti(n, firma(userId))),
    repo.emettiConNumerazione(copia2, 2029, n => copia2.emetti(n, firma(userId))),
  ])
  expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
  const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
  expect(rifiutato.reason).toBeInstanceOf(FirNonPiuInBozzaError)
  expect(await prisma.fIRSignature.count({ where: { firId: f.id } })).toBe(1)
})
it('il progressivo ignora i numeri che non hanno il formato FIR-AAAA-N', async () => {
  // un FIR del tenant con firNumber 'FIR-2030-ABC' non fa fallire il calcolo: la prima emissione 2030 è 000001
})
```

- [ ] **Step 3: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/domain/fir/numero-fir.spec.ts` e `npm run test:postgres -- fir-prisma`. Expected: FAIL (modulo e metodo inesistenti).

- [ ] **Step 4: implementare** `numero-fir.ts`, errore, interfaccia, repository e i sette doppi. `git grep -n "function annoSolareItaliano" -- apps/backend/src` deve restituire **una sola** riga, in `core/time/anno-italiano.ts`.

- [ ] **Step 5: eseguire i test, compresi tutti i doppi**

Run, nell'ordine:
- `cd apps/backend && npx jest --runInBand src/domain/fir/numero-fir.spec.ts src/application/fir src/infrastructure/persistence/fir-prisma.repository.spec.ts` → PASS, compreso `emetti-fir.use-case.spec.ts` (lo use case è ancora quello di oggi e usa il metodo deprecato);
- `cd tools/rentri-fake && npm ci && cd ../../apps/backend && npm run test:oracolo -- aggancio-formulari` → PASS (l'oracolo è escluso dalla config di default ma gira nel gate di `deploy.yml`, quindi un doppio sbagliato qui blocca il rilascio);
- `cd apps/backend && npx tsc -p tsconfig.json --noEmit` → nessun errore nel codice applicativo (questo comando **non** controlla gli spec: per loro valgono i due comandi sopra).

- [ ] **Step 6: commit**

```bash
git add apps/backend/src/domain/fir/ apps/backend/src/infrastructure/persistence/ apps/backend/src/core/domain/errors.ts apps/backend/src/application/fir apps/backend/src/application/rentri/aggancio-formulari-ciclo-completo.oracolo.spec.ts
git commit -m "fix(fir): riferimento interno del FIR assegnato sotto lock per tenant e anno di emissione"
```

---

### Task 9: emissione tramite la numerazione serializzata (e via il metodo deprecato)

**Files:**
- Modify: `apps/backend/src/application/fir/use-cases/emetti-fir.use-case.ts` (passi commentati "3. Generate numero progressivo", "4. Execute domain method", "5. Persist changes")
- Modify: `apps/backend/src/application/fir/use-cases/emetti-fir.use-case.spec.ts` (test `due FIR sullo stesso tenant generano progressivi distinti e crescenti` e nuovi)
- Modify: `apps/backend/src/domain/fir/repositories/fir-repository.interface.ts`, `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts` e i sette doppi di test del Task 8: via `generateNumeroProgressivo`
- Modify: `apps/backend/src/infrastructure/pdf/pdf.service.ts` (`buildFIRContent`, blocco "FIR Number and Status") + test `apps/backend/src/infrastructure/pdf/pdf.service.fir.spec.ts` (nuovo)

**Interfaces:**
- Consumes: `IFIRRepository.emettiConNumerazione` (Task 8), `annoSolareItaliano` (`core/time/anno-italiano.ts`, piano D), `DomainError`.
- Produces: nessuna firma nuova; `generateNumeroProgressivo` non esiste più.

I passi 3-5 attuali diventano: `const anno = annoSolareItaliano(new Date())`; `await this.firRepository.emettiConNumerazione(fir, anno, numero => fir.emetti(numero, firma))` dentro un `try`: un `DomainError` (stato non valido, `FirNonPiuInBozzaError`, `FirmaSenzaUtenteError`) → `Result.fail(\`Failed to emit FIR: ${error.message}\`)` come oggi per l'errore di `fir.emetti`; ogni altro errore si rilancia. La trasmissione RENTRI parte solo dopo un'emissione riuscita, come oggi. Commento al passo 3: qui il piano della scorta innesterà il numero vidimato (Decisione 7).

PDF del FIR (rilievo del secondo giro): il titolo "Numero FIR" mostra `fir.rentriNumeroFir` se c'è; il riferimento interno `fir.firNumber` va in un campo a parte con l'etichetta `Riferimento interno`. Senza numero RENTRI il titolo resta "Numero FIR" con `firNumber`, come oggi.

- [ ] **Step 1: adattare e scrivere i test.** `due FIR sullo stesso tenant generano progressivi distinti e crescenti` spia `emettiConNumerazione` invece di `generateNumeroProgressivo` (`calls[0][0].tenantId === TENANT_ID`, `calls[0][1] === annoSolareItaliano(new Date())`). Nuovi, in un `describe('anno di emissione')` che in `beforeAll` salva `process.env.TZ` e lo imposta a `'UTC'`, in `afterAll` lo ripristina, e in `afterEach` chiama `jest.useRealTimers()` (sulla workstation, in Europe/Rome, il codice di oggi darebbe già 2027 e il test non sarebbe rosso; e un'asserzione fallita non deve lasciare i fake timer ai test successivi):

```ts
it("usa l'anno italiano dell'istante di emissione", async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-12-31T23:30:00Z'))
  const r = await useCase.execute(new EmettiFIRCommand(fir.id, 'user-123', 'Test'))
  expect(r.value.numeroProgressivo).toMatch(/^FIR-2027-/)
})
it("un FIR non più in bozza nel database dà un errore leggibile e non avvia RENTRI", async () => {
  jest.spyOn(repository, 'emettiConNumerazione').mockRejectedValue(new FirNonPiuInBozzaError(fir.id))
  const r = await useCase.execute(new EmettiFIRCommand(fir.id, 'user-123', 'Test'))
  expect(r.isFailure).toBe(true)
  expect(r.error).toContain('non è più in bozza')
  expect(trasmissioneRentri.eseguiSeAutomatica).not.toHaveBeenCalled()
})
```

`pdf.service.fir.spec.ts` (stesso schema di `pdf.service.mud.spec.ts` del piano A: `(new PDFService(logger) as any).buildFIRContent(fir)` e `JSON.stringify` del contenuto):

```ts
it('con il numero RENTRI, "Numero FIR" è quello e il riferimento interno ha la sua etichetta', () => {
  const testo = JSON.stringify((new PDFService(logger) as any).buildFIRContent({ ...firBase, firNumber: 'FIR-2026-000007', rentriNumeroFir: 'XYZ123' }))
  expect(testo).toMatch(/"Numero FIR".*"XYZ123"/)
  expect(testo).toMatch(/"Riferimento interno".*"FIR-2026-000007"/)
})
it('senza numero RENTRI resta il riferimento interno come oggi', () => {
  const testo = JSON.stringify((new PDFService(logger) as any).buildFIRContent({ ...firBase, firNumber: 'FIR-2026-000007', rentriNumeroFir: null }))
  expect(testo).toMatch(/"Numero FIR".*"FIR-2026-000007"/)
  expect(testo).not.toContain('Riferimento interno')
})
```

(`firBase` è un oggetto con i campi che `buildFIRContent` legge; per sapere quali, leggere il metodo prima di scrivere il test.)

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/application/fir/use-cases/emetti-fir.use-case.spec.ts src/infrastructure/pdf/pdf.service.fir.spec.ts`. Expected: FAIL.

- [ ] **Step 3: implementare** lo use case come descritto, poi togliere `generateNumeroProgressivo` da interfaccia, repository e dai sette doppi, poi il PDF.

- [ ] **Step 4: eseguire i test**

Run: il comando dello Step 2, poi `cd apps/backend && npx jest --runInBand src/application/fir src/infrastructure/persistence/fir-prisma.repository.spec.ts`, `npm run test:oracolo -- aggancio-formulari` e `npx tsc -p tsconfig.json --noEmit`. Expected: PASS, nessun errore di tipo.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/fir apps/backend/src/domain/fir/repositories apps/backend/src/infrastructure/persistence apps/backend/src/infrastructure/pdf apps/backend/src/application/rentri/aggancio-formulari-ciclo-completo.oracolo.spec.ts
git commit -m "fix(fir): emissione con riferimento interno e firma nella stessa transaction, anno italiano, numero RENTRI sul PDF"
```

---

### Task 10: data di registrazione fissata dal server, data del FIR nella ricopia solo se è vera

**Files:**
- Modify: `apps/backend/src/api/registro/registro.controller.ts` (`registra`)
- Create: `apps/backend/src/api/registro/registro.controller.spec.ts`
- Modify: `apps/backend/src/api/registro/dtos/registra-movimento.dto.ts` (`registrationDate`: resta facoltativa per compatibilità, descrizione "ignorata: la data di registrazione la assegna il server")
- Modify: `apps/backend/src/domain/waste-movement/waste-movement.entity.ts` (controllo "La data di registrazione non può precedere la data di operazione" e `ritardoRegistrazioneGg`) + `waste-movement.entity.spec.ts`
- Modify: `apps/backend/src/api/fir/dtos/fir-response.dto.ts` (`dataPresaCaricoEffettiva`) + `fir-response.dto.spec.ts`
- Modify: `apps/frontend/src/app/shared/models/fir.model.ts` (`dataPresaCaricoEffettiva?: string | null`)
- Modify: `apps/frontend/src/app/features/registro/registro-fir.ts` + `registro-fir.spec.ts` (Task 5)
- Modify: `apps/frontend/src/app/features/registro/registro.component.ts` (`onFirSelect`, campo `registrationDate` del form, payload di `registra`, `ritardoGgCalcolati`)

**Interfaces:**
- Consumes: `giornoItaliano` (`core/time/anno-italiano.ts`, piano D); `firCollegabileNelRegistro` (Task 5).
- Produces:
  - Controller: `registrationDate = new Date()` (istante reale, Decisione 10); `dto.registrationDate` si ignora. `movementDate` resta quella del client. L'anno del progressivo resta `annoSolareItaliano(command.registrationDate)` (piano D), corretto anche per un istante.
  - Entità: rifiuta solo se `giornoItaliano(regDate) < giornoItaliano(movDate)`; il messaggio resta quello di oggi. `ritardoRegistrazioneGg` = `Math.max(0, giorni - TERMINE_REGISTRAZIONE_PRODUTTORE_GG)` con `giorni = (Date.parse(\`${giornoItaliano(reg)}T00:00:00Z\`) - Date.parse(\`${giornoItaliano(mov)}T00:00:00Z\`)) / 86_400_000` (giorni di calendario italiani: oggi la differenza fra istanti, con `Math.floor`, perderebbe un giorno per una registrazione fra le 00:00 e l'01:00 italiane). La stessa differenza, in una funzione privata del file `giorniItalianiFra(da: Date, a: Date): number`, sostituisce anche il `diffGg` calcolato in `create` (`waste-movement.entity.ts:97`).
  - DTO del FIR: `FIRResponseDto.dataPresaCaricoEffettiva: Date | null` = `fir.firme.trasportatore ? fir.dataPresaCarico : null`. La firma del trasportatore la scrive solo `FIR.presaInCarico` (`fir.aggregate.ts:516-532`, vietata sui FIR legati a RENTRI), insieme alla data vera; senza firma `dataPresaCarico` è il ripiego `new Date()` del primo salvataggio (Decisione 10). `dataPresaCarico` resta com'è per chi la usa oggi.
  - Frontend (`registro-fir.ts`):
    - `export interface DataDaFir { data: Date | null; suggerimento: string | null }`
    - `export const SUGGERIMENTO_SENZA_PRESA_IN_CARICO = 'WasteFlow non conosce la data di presa in carico di questo FIR (non registrata qui, o avvenuta su RENTRI): inserisci la data del trasporto riportata sul formulario.'`
    - `export const SUGGERIMENTO_SENZA_ARRIVO = 'WasteFlow non conosce la data di arrivo di questo FIR: inserisci la data in cui il rifiuto è stato ricevuto.'`
    - `export function dataOperazioneDaFir(fir: Pick<FIR, 'dataPresaCaricoEffettiva' | 'dataConsegna'>, tipo: 'CARICO' | 'SCARICO'): DataDaFir` — SCARICO: `dataPresaCaricoEffettiva` se c'è, altrimenti `{ data: null, suggerimento: SUGGERIMENTO_SENZA_PRESA_IN_CARICO }`; CARICO (l'azienda è destinataria): `dataConsegna` se c'è, altrimenti `{ data: null, suggerimento: SUGGERIMENTO_SENZA_ARRIVO }`. **Mai** `dataPresaCarico`: è la colonna `transport_date`, che per un FIR non preso in carico in WasteFlow contiene un ripiego.
    - `export function causalePredefinitaDaFir(tipo: 'CARICO' | 'SCARICO', ruolo: 'PRODUTTORE' | 'DESTINATARIO' | null): CausaleMovimento | null` — `null` se `ruolo` è `null` (Decisione 13), altrimenti `CONFERIMENTO_TRASPORTATORE` per SCARICO e `INGRESSO_ESTERNO` per CARICO, come oggi.

Comportamento del form: alla selezione di un FIR, `esito = dataOperazioneDaFir(fir, tipo)`; se `esito.data` non è `null` e non è nel futuro, `movementDate` prende quel valore; altrimenti `movementDate` resta quella del form e `ruoloHint` aggiunge `esito.suggerimento` (o, per una data nel futuro, il testo di oggi). La causale si imposta solo se `causalePredefinitaDaFir(tipo, ruolo)` non è `null`; con il ruolo non riconosciuto il campo resta com'è (vuoto se l'utente non l'aveva scelto: è obbligatorio). Il campo "Data registrazione" diventa in sola lettura (`p-calendar` disabilitato, valore oggi, suggerimento `Assegnata dal sistema alla conferma.`) e il payload di `registra` non contiene più `registrationDate`; il calcolo del ritardo usa la data di oggi.

- [ ] **Step 1: scrivere i test che falliscono**

`registro.controller.spec.ts` (use case e handler mockati, `new RegistroController(useCase as any, {} as any)`; `TZ` del processo impostato a `'UTC'` in `beforeAll` e ripristinato in `afterAll`, fake timer con `useRealTimers` in `afterEach`):

```ts
it("ignora la data di registrazione del client e usa l'istante di adesso", async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-03-10T23:30:00Z')) // 00:30 dell'11/03 a Roma
  useCase.execute.mockResolvedValue(Result.ok({ id: 'm1' }))
  await controller.registra({ ...dtoMinimo, movementDate: '2026-03-11', registrationDate: '2025-01-01' } as any, utente)
  const comando = useCase.execute.mock.calls[0][0]
  expect(comando.registrationDate).toEqual(new Date('2026-03-10T23:30:00.000Z'))
  expect(comando.movementDate).toEqual(new Date('2026-03-11'))
})
```

(`dtoMinimo` e `utente` sono costanti dello spec con i campi obbligatori; la forma di `Result` e il modo in cui il controller traduce un fallimento si leggono dal metodo `registra` prima di scrivere il test.)

`waste-movement.entity.spec.ts`:

```ts
it("accetta un movimento del giorno registrato alle 00:30 italiane (istante del giorno prima in UTC)", () => {
  expect(() => WasteMovement.create({ ...propsBase, movementDate: new Date('2026-03-11T00:00:00Z'), registrationDate: new Date('2026-03-10T23:30:00Z') })).not.toThrow()
})
it('rifiuta una registrazione del giorno prima', () => {
  expect(() => WasteMovement.create({ ...propsBase, movementDate: new Date('2026-03-11T00:00:00Z'), registrationDate: new Date('2026-03-10T12:00:00Z') }))
    .toThrow('La data di registrazione non può precedere la data di operazione')
})
it('il ritardo si conta in giorni italiani di calendario', () => {
  const m = WasteMovement.create({ ...propsBase, movementDate: new Date('2026-03-01T00:00:00Z'), registrationDate: new Date('2026-03-31T22:30:00Z') }) // 01/04 00:30 a Roma
  expect(m.ritardoRegistrazioneGg).toBe(31 - TERMINE_REGISTRAZIONE_PRODUTTORE_GG)
})
```

`fir-response.dto.spec.ts` (aggiunta, FIR costruito come negli altri test del file):

```ts
it('dataPresaCaricoEffettiva è nulla senza la firma del trasportatore', () => {
  const fir = firEmessoDiProva() // emesso, mai preso in carico: dataPresaCarico è il ripiego del primo salvataggio
  expect(FIRResponseDto.fromDomain(fir).dataPresaCaricoEffettiva).toBeNull()
})
it('dataPresaCaricoEffettiva è la data della presa in carico registrata in WasteFlow', () => {
  const fir = firEmessoDiProva()
  fir.presaInCarico(new Date('2025-12-28T09:00:00Z'), firmaDiProva('TRASPORTATORE'))
  expect(FIRResponseDto.fromDomain(fir).dataPresaCaricoEffettiva).toEqual(new Date('2025-12-28T09:00:00Z'))
})
```

(`firEmessoDiProva` e `firmaDiProva` sono helper dello spec, sul modello di quelli di `fir.aggregate.spec.ts`.)

`registro-fir.spec.ts` (aggiunta):

```ts
it('dataOperazioneDaFir: lo scarico usa la presa in carico registrata in WasteFlow', () => {
  expect(dataOperazioneDaFir({ dataPresaCaricoEffettiva: '2025-12-28T09:00:00.000Z', dataConsegna: null }, 'SCARICO'))
    .toEqual({ data: new Date('2025-12-28T09:00:00.000Z'), suggerimento: null })
})
it('dataOperazioneDaFir: senza presa in carico registrata nessuna data', () => {
  // FIR EMESSO mai preso in carico, o acquisito da RENTRI: dataPresaCarico c'è (ripiego) ma non conta
  const fir = { stato: FIRStato.EMESSO, dataPresaCarico: '2026-01-08T10:00:00.000Z', dataPresaCaricoEffettiva: null, dataConsegna: null }
  expect(dataOperazioneDaFir(fir as any, 'SCARICO')).toEqual({ data: null, suggerimento: SUGGERIMENTO_SENZA_PRESA_IN_CARICO })
})
it('dataOperazioneDaFir: il carico usa la data di arrivo', () => {
  expect(dataOperazioneDaFir({ dataPresaCaricoEffettiva: '2025-12-30T08:00:00.000Z', dataConsegna: '2026-01-02T15:00:00.000Z' }, 'CARICO'))
    .toEqual({ data: new Date('2026-01-02T15:00:00.000Z'), suggerimento: null })
  expect(dataOperazioneDaFir({ dataPresaCaricoEffettiva: '2025-12-30T08:00:00.000Z', dataConsegna: null }, 'CARICO'))
    .toEqual({ data: null, suggerimento: SUGGERIMENTO_SENZA_ARRIVO })
})
it('causalePredefinitaDaFir: nessuna causale se il ruolo non si riconosce', () => {
  expect(causalePredefinitaDaFir('CARICO', null)).toBeNull()
  expect(causalePredefinitaDaFir('SCARICO', 'PRODUTTORE')).toBe('CONFERIMENTO_TRASPORTATORE')
  expect(causalePredefinitaDaFir('CARICO', 'DESTINATARIO')).toBe('INGRESSO_ESTERNO')
})
```

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/api/registro/registro.controller.spec.ts src/domain/waste-movement/waste-movement.entity.spec.ts src/api/fir/dtos/fir-response.dto.spec.ts` e `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/registro/registro-fir.spec.ts`. Expected: FAIL (il controller usa la data del client; l'entità confronta gli istanti e il ritardo perde un giorno; il campo del DTO e le funzioni non esistono).

- [ ] **Step 3: implementare** controller, DTO del movimento, entità, DTO del FIR, modello frontend, `registro-fir.ts` e il form come descritto.

- [ ] **Step 4: eseguire i test** (comandi dello Step 2, poi `npx jest --runInBand src/application/registro src/api/fir` e il lint del frontend dalla radice: `npx eslint "apps/frontend/src/app/features/registro/**/*.ts" --max-warnings=-1`). Expected: PASS, compresi i test esistenti dello use case (se uno confronta `ritardoGg` calcolato su istanti, va riletto: il risultato cambia solo per registrazioni fra le 00:00 e le 02:00 italiane). Il test Karma va eseguito **in locale**.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/api/registro apps/backend/src/api/fir/dtos apps/backend/src/domain/waste-movement apps/frontend/src/app/features/registro apps/frontend/src/app/shared/models/fir.model.ts
git commit -m "fix(registro): data di registrazione assegnata dal server, data del FIR nella ricopia solo se registrata davvero"
```

---

## Verifica finale (dopo il Task 10)

- [ ] `cd apps/backend && npx jest --runInBand src/core/format src/domain/waste-movement src/domain/fir src/application/registro src/application/giacenze src/application/fir src/application/rentri/riconcilia-stato-rentri.use-case.spec.ts src/api/registro src/api/fir src/infrastructure/persistence/fir-prisma.repository.spec.ts src/infrastructure/pdf/pdf.service.fir.spec.ts`: tutto PASS.
- [ ] `cd apps/backend && npm run test:oracolo`: PASS (è nel gate del deploy).
- [ ] `cd apps/backend && npx prisma migrate deploy && npm run test:postgres`: tutti i `*.postgres.spec.ts` PASS, compresi quelli già esistenti (isolamento sorelle, gerarchia, CER, scorta). **Non** è un gate del deploy: va eseguito qui, in locale.
- [ ] `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/registro/registro-messaggi.spec.ts --include=src/app/features/registro/registro-fir.spec.ts --include=src/app/features/giacenze/giacenze.component.spec.ts`: PASS. **Non** è un gate: va eseguito qui. Dalla radice: `npx eslint "apps/frontend/src/**/*.ts" --max-warnings=-1` (è il lint frontend del job CI, l'unico controllo frontend automatico).
- [ ] `cd apps/backend && npx tsc -p tsconfig.json --noEmit`: nessun errore.
- [ ] `git grep -n "generateNumeroProgressivo\|getGiacenzaCer" -- apps/backend/src`: nessun risultato.
- [ ] `git grep -n "function annoSolareItaliano\|export const ALIAS_KG\|export const STATI_FIR_EMESSI\|export function etichettaFir\|export function formattaQuantita\|export function stessiDatiRicopia" -- apps/backend/src`: una riga ciascuno (`core/time/anno-italiano.ts`, `unita-misura-registro.ts`, `stati-fir.ts` due volte, `formatta-quantita.ts`, `ricopia-fir.ts`).
- [ ] `git grep -n "createdAt: {" -- apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts`: nessun filtro per anno su `createdAt`.
- [ ] `(Get-Item C:\Progetti\rifiuti\node_modules\.prisma\client\schema.prisma | Select-String fir_id_ricopia)`: nessun risultato (il client del checkout principale non è stato toccato).
- [ ] Gli esiti delle query informative del Task 1 Step 6, Task 3 Step 8 e Task 4 Step 6 sono nella descrizione della PR, eseguite **prima** della conferma delle Decisioni 3, 4 e 8, con la nota che il VPS è di collaudo.
- [ ] `git grep -n "rentriStatoFormulario" -- apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts`: almeno due righe (scrittura in `rentriToPersistence` e lettura in `toDomain`).
- [ ] `git grep -n "dataPresaCarico)" -- apps/frontend/src/app/features/registro`: nessun uso di `dataPresaCarico` come data dell'operazione (solo `dataPresaCaricoEffettiva`).
- [ ] La nota di rilascio qui sotto è nella descrizione della PR, e Graziano ha approvato il merge (Global Constraints).

## Cosa vede l'utente dopo il rilascio (nota di rilascio da mandare ai clienti)

Il merge su `master` mette in produzione queste modifiche lo stesso giorno. Testo proposto per i clienti, da adattare:

> **Aggiornamento del registro di carico e scarico e dei FIR**
> - La **data di registrazione** la assegna il sistema al momento della conferma e non si modifica più: il registro annota quando il movimento viene scritto. La data dell'operazione resta quella che inserite voi.
> - Quando ricopiate un FIR nel registro, la **data dell'operazione** si compila da sola solo se WasteFlow conosce la data vera (presa in carico registrata in WasteFlow per gli scarichi, arrivo per i carichi). Per i FIR gestiti su RENTRI o non ancora presi in carico vi chiediamo di inserirla dal formulario.
> - Le **giacenze in tonnellate** sono ora convertite correttamente in kg: alcuni totali cambiano (prima le tonnellate erano sommate come se fossero kg) e alcuni avvisi del deposito temporaneo possono comparire tutti insieme. Le quantità in m³ o litri sono mostrate a parte.
> - Uno **scarico più grande della giacenza** viene rifiutato con un messaggio che indica quale carico manca e con quale causale registrarlo (per i rifiuti già in deposito prima di usare il registro: «Altro carico»). Uno scarico con una data precedente al carico che lo copre viene registrato con un avviso.
> - Ricopiare **due volte lo stesso FIR** non crea più un secondo movimento: il sistema vi indica quello già registrato.
> - I FIR **in bozza o annullati** non compaiono più fra quelli da collegare a un movimento.
> - Sul **PDF del FIR**, "Numero FIR" è il numero RENTRI quando c'è; il numero interno compare come "Riferimento interno".
> - Gli scarichi in m³ o litri non vengono più rifiutati per mancanza di giacenza.

## Fuori ambito (follow-up espliciti)

- **`transport_date` come ripiego** (Decisione 10): la colonna è `NOT NULL` e `save` scrive `new Date()` quando la presa in carico non c'è. Renderla nullable e togliere il ripiego richiede una migration e la revisione di chi la legge (piano A la usa già solo con la firma del trasportatore); in alternativa, all'acquisizione da RENTRI, valorizzarla con la data di inizio trasporto del dettaglio.
- **Ripopolamento una tantum di `rentri_stato_formulario`** per i FIR già `SYNCED` prima del Task 0 (Decisione 9): oggi restano a `NULL` e il campionamento li segnala come divergenti senza correggerli.

- **Peso a destino nella ricopia** (Decisione 1) e **regola ±10%** (`fir.aggregate.ts:552`).
- **Numero vidimato RENTRI all'emissione** (Decisione 7): piano `2026-09-12-collegamento-scorta-emissione.md`, da innestare in `emettiConNumerazione`.
- **Annullamento di un FIR già ricopiato nel registro** (Decisione 11): conferma esplicita all'annullamento con il numero del movimento collegato, e decisione se escludere dal calcolo di giacenza gli scarichi su FIR annullati (oggi la pagina giacenze li segnala soltanto); l'azione correttiva sul registro arriva con le rettifiche (Fase 2).
- **Stato locale di un FIR preso da RENTRI**: applicare `applyRentriStato` subito dopo l'acquisizione (lo use case legge già `dettaglio`), invece di aspettare la riconciliazione delle 6 ore; la regola di collegabilità della Decisione 9 non ne dipende.
- **Avvisi di ordine delle date salvati sul movimento** (oggi solo nella risposta e nel log): con le rettifiche della Fase 2, o in una colonna nuova.
- **Autocompletamento oltre i 200 FIR** (`getFIRList(1, 200)`): con molti FIR quelli più vecchi non compaiono; serve una ricerca lato server.
- **Rettifiche del registro (Fase 2)**: l'indice unico su `fir_id_ricopia` non le vincola, purché una rettifica lasci la colonna a `NULL` o ne usi una propria.
- **Autocompletamento del registro che nasconde i FIR già ricopiati**: il Task 5 nasconde i FIR non collegabili, ma un FIR già ricopiato continua a comparire (il backend rifiuta o restituisce il movimento esistente).
- **Selettore dell'unità sui carichi** e densità per convertire le unità non di massa (Decisione 4).
- **Alert volumetrici del deposito temporaneo** (art. 185-bis: 30 m³, di cui 10 m³ pericolosi) per le giacenze in `M3`.
- **Anomalia `NEGATIVE_STOCK`** (`anomaly-detection.service.ts:104-127`): somma ancora unità diverse; da riallineare a `normalizzaUnitaRegistro`.
- **Età del deposito temporaneo** sul primo carico di sempre (`giacenze.service.ts:50-54`) e soglie fisse: raccomandazione 4 del rapporto 01.
- **`existsNumeroProgressivo`** (`fir-prisma.repository.ts:369-374`) non filtra per tenant; oggi non ha chiamanti in `src/`.
- **Controllo di versione sulle altre transizioni del FIR** (presa in carico, consegna, annullamento: D17, last-write-wins): qui si protegge solo l'emissione.
- **CER salvato con e senza asterisco** nel registro: il controllo di giacenza li unisce, ma pagina giacenze e MUD li vedono come due CER diversi. Conviene normalizzare sempre con `*` per i pericolosi in `normalizeCerCode`.
