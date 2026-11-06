# Fase 4 pezzo 4: valorizzazione per periodo ed export — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`. Un agente sonnet per task, revisione opus fra un task e il
> successivo; ondate come nella sezione "Ondate". Passi con checkbox (`- [ ]`). Tre pezzi in
> sequenza (4.4a → 4.4b → 4.4c; la 4.4b in due, 4.4b1 → 4.4b2, decisione 26), ciascuno con la propria PR, rilasciabile da solo. Nessun task del
> pezzo N+1 parte prima del merge del pezzo N, salvo il Task 14 (modelli del frontend), che fissa i
> nomi per il backend della 4.4b. La 4.4d (Zucchetti) è solo un segnaposto.

**Goal.** Dai legami `CONFERMATO` della 4.3 produrre fatture numerate senza buchi per registro IVA e
anno, immutabili, valide contro l'XSD FatturaPA, esportabili in CSV, XML e TeamSystem, con annullo
dell'ultimo numero, nota di credito di storno e lista degli scostamenti.

**Architecture.** Calcolo in dominio puro (`src/domain/fatturazione/`), senza database. Il servizio
legge, chiama il calcolo e scrive (`src/application/fatturazione/`). Anteprima e definitiva sono job
BullMQ per tenant nella coda `fatturazione`. La definitiva è **una** transazione che numera, marca i
legami `FATTURATO` e scrive i marcatori. Bozze e definitivi stanno nella stessa tabella. Un trigger
rende immutabili i documenti non in bozza. API nel modulo `src/api/fatturazione/`.

**Tech Stack.** NestJS 10 + Prisma 5.22 + PostgreSQL 16 (RLS FORCE) + BullMQ 5; `xmllint-wasm`
(dipendenza nuova, Task 16) per l'XSD; `pdfmake` 0.2 (già presente) per il PDF; Angular 17 +
PrimeNG 17.18; jest, Karma, Playwright (solo in CI).

**Spec.** `docs/superpowers/specs/2026-11-05-fase4-4-valorizzazione-export-design.md`. Le decisioni
1-26 del §19 sono vincolanti (Q38); le scelte S1-S21 valgono come accettate. I ruling della scansione
preliminare (`.superpowers/sdd/2026-11-05-fase4-4-valorizzazione-export/scansione-preliminare.md`)
sono applicati nei task; l'esito di ciascuno sta in `ruling-applicati.md` della stessa cartella.
I ruling della scansione della 4.4b (`scansione-4-4b.md`, Q1-Q45) sono applicati nei Task 14-27b;
l'esito sta in `ruling-4-4b-applicati.md`. Nel testo «(scansione Pn)» cita i ruling della prima, «(Qn)» quelli della seconda, «P1-P8» sotto sono le scelte di piano. Modello di formato:
`docs/superpowers/plans/2026-11-03-fase4-3-legame-movimento.md`. Lezioni: `.superpowers/sdd/2026-11-03-fase4-3/progress.md`,
`4-3c-report.md`, `review-finale-4-3b.md`. Percorsi relativi a `apps/backend/` salvo
`fe/` = `apps/frontend/src/app/` ed `e2e/` alla radice.

**Scelte di piano** (P1-P8, da confermare in revisione; solo P8 estende un insieme della spec, per la decisione 17):
- **P1.** `numerazioni_fattura` ha in più `data_partenza date null`. Il `PUT` del numero di partenza
  la scrive insieme a `ultima_data`. Serve al §5.5 passo 5: dopo l'annullo dell'unico definitivo di
  WasteFlow, `ultima_data` torna a `data_partenza`. Senza la colonna quel valore si perde.
- **P2.** Rate: quota = `netto / n` troncata al centesimo (`ROUND_DOWN`), resto sull'ultima rata. Così
  la regola «il resto sull'ultima» (§6.11) dà sempre un resto ≥ 0.
- **P3.** Test basato su proprietà con un generatore con seme fisso in `src/test-support/` (nessuna
  dipendenza nuova come `fast-check`).
- **P4.** I tracciati TeamSystem (`cTeamSystemRec1/2`) **non** sono in `contabilita.md` campo per
  campo: il §8 cita solo i nomi. Il Task 30 li ricostruisce prima dall'installer WinWaste con
  l'agente REA (memoria `feedback-rea-feature-agente-parallelo`) in
  `winwaste/docs/export-teamsystem-tracciato.md`, che sta **fuori dal repository** e non entra nel
  commit; la sostanza si copia in `adattatori/riferimenti/TRACCIATO.md`, che si committa (scansione P44).
- **P5.** Il Task 14 (modelli e servizio HTTP del frontend) apre la 4.4b. I nomi dei suoi tipi sono
  il contratto dei DTO del backend: lezione della 4.3, Task 25.
- **P6.** Lo storno copia le righe dell'origine con i loro tipi: l'XML del TD04 ha le stesse linee.
  Il tipo riga `STORNO` resta nell'enum per le note libere (fuori dalla prima uscita) e nella 4.4 non
  si scrive.
- **P7.** Codici HTTP che la spec non nomina e il piano aggiunge: 409 `NESSUN_DOCUMENTO_DEFINIBILE`,
  `DOPPIA_FATTURAZIONE` (violazione dell'unico dei marcatori, §4.7), `PARTENZA_NON_MODIFICABILE`,
  `SUFFISSO_NON_MODIFICABILE` (§4.10), `SCOSTAMENTO_NON_APERTO`, `DEFINITIVE_NON_ATTIVE` (decisione
  13), `XML_NON_DISPONIBILE` (Q7), `STORNO_NON_AMMESSO` con `details.motivo` (Q33); `chiediDefinitiva`
  risponde 409 anche con i codici degli errori generali bloccanti (decisione 24); 400 `PERIODO_NON_VALIDO`, `DATA_FUTURA`, `CONFERMA_EMISSIONE_RICHIESTA`,
  `ADATTATORE_SCONOSCIUTO`. Tetto di 5000 documenti per export CSV e di 500 per `XML_ZIP` (400 `TROPPI_DOCUMENTI`, Q24).
- **P8.** Le righe `TT` e `TF` della decisione 17 hanno un tipo riga proprio, `QUANTITA_MOVIMENTI`
  (ottavo valore dell'insieme del §4.4): non sono `MOVIMENTO` (nessun legame), né `FISSO` (nessun
  marcatore, importo dalle quantità), né `FASCIA_SPECIALE` (nessuna tabella a scaglioni).
  `tipoDocumento` non le conta: un documento che le ha ha sempre anche righe `MOVIMENTO`.

## Global Constraints

- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), messaggi in italiano, **nessuna
  attribuzione AI** (né `Co-Authored-By` né `Claude-Session`; la regola di Graziano prevale su ogni
  suggerimento dell'ambiente). Niente push dai task.
- Commenti e testi in italiano; termini tecnici non tradotti (branch, commit, deploy, test, build,
  database, backup, container, log, worker, queue, job, cache, rollback, merge, migration, RLS,
  tenant, lock, trigger, savepoint). Messaggi all'utente senza id né dati personali.
- Azienda sempre da `requireRequestTenantId(req)`; `@Roles` esplicito su **ogni** rotta;
  `controller-tenant-selezionato.spec.ts` e `nessun-user-userid.spec.ts` verdi. Ruoli:
  `RUOLI_LETTURA`, `RUOLI_SCRITTURA`, `RUOLI_AMMINISTRATORI` da `src/api/legami-movimento/ruoli.ts`,
  riesportati in `src/api/fatturazione/ruoli.ts`. Tabella dei permessi: spec §12.
- **Nessuna colonna, nessun UPDATE/INSERT/DELETE su `waste_movements`.** `guardia-registro.spec.ts`
  si estende a `src/application/fatturazione/**`, `src/api/fatturazione/**` e ai due job della
  fatturazione (Task 17, Q35).
- La 4.4 **non prende mai** il lock del registro, il lock consultivo per radice o
  `impostazioni_fatturazione FOR UPDATE` (S5). Ordine dei lock (spec §8), mai invertito:
  `elaborazione FOR UPDATE → numerazioni FOR UPDATE per registro_iva_id → contratti FOR SHARE per id
  → elenchi FOR SHARE per id → righe di listino FOR SHARE per id (bloccaPerDefinitiva, insiemi interi, Q20) →
  testate e righe dei legami FOR UPDATE per id (bloccaRigheLegame) → marcatori INSERT/DELETE →
  documenti in BOZZA FOR UPDATE`. Annullo e storno: `numerazioni → documento DEFINITIVO → testate e
  righe dei legami → marcatori DELETE`; XML: `documento FOR UPDATE` da solo (transazione B). `contatori_file_fatturapa FOR UPDATE` da solo, in una
  transazione che non prende altro.
- Importi con `Prisma.Decimal` o stringhe decimali, mai `number`. Nell'API stringhe col punto.
  `importoRiga`, `scontoCascata`, `arrotonda2` (`src/domain/listino/importi-riga.ts:83,72,23`),
  `applicaScaglioni`, `validaPrezzoSpeciale` (`prezzo-speciale.ts:288,173`), `scadenzeNelPeriodo`,
  `periodoCompetenza` (`scadenze-fisse.ts:257,229`), `periodoDaFatturare`
  (`periodi-fatturazione.ts:148`), `destinatarioEffettivo`, `contoCorrenteEffettivo`
  (`regole-contratto-cliente.ts:619,642`), `improntaVariazione` (`variazione-prezzi.ts:180`) si
  riusano, non si riscrivono.
- **Liste di id (lezione 4.3b I1 e seguiti B I1):** `joinLineari(tx)` + `JOIN unnest($1::uuid[])`
  solo per una lista data. `= ANY($1::uuid[])` per letture mirate. Nessuna query che legge l'intero
  tenant gira dopo `joinLineari`. `SET LOCAL enable_nestloop` va ripristinato (`current_setting`
  letto prima) appena finita la query a lista. Vietati i cicli di UPDATE singoli: si usa
  `UPDATE … FROM unnest(...)`.
- Scritture interattive: `impostaTimeoutLock(tx)` per prima, `OPZIONI_TRANSAZIONE_SCRITTURA`.
  55P03, P2028 e 40P01 diventano 409 `OPERAZIONE_CONCORRENTE` (`traduciErrorePrisma`). Definitiva:
  `lock_timeout` 5 s, `timeout` della transazione 120 s, `statement_timeout` 60 s
  (`OPZIONI_TRANSAZIONE_DEFINITIVA`, Task 19).
- **Query paginate:** ogni DTO di lista ha `@Max(100)` su `dimensione` (come `ElencoClientiQueryDto`).
  Il frontend non chiede mai più di 100 (lezione 4.3c I6: dimensione 200 → 400 silenzioso). Le
  ricerche di clienti e contratti nei filtri sono lato server, con dimensione 25.
- **Campi numerici modificabili in UI:** virgola decimale, punto vietato con «Usa la virgola per i
  decimali», niente separatore delle migliaia, direttiva `appNumeroIt`
  (`fe/shared/directives/numero-it.directive.ts`) e `leggiNumero`, `formatNumero`,
  `validatoreNumero` (`fe/shared/utils/numero-modificabile.ts`). Numeri in sola lettura con `it-IT`.
  Mai parser nuovi.
- **Date in UI:** `p-calendar` con `[maxDate]` riceve la **fine del giorno** ricalcolata a ogni
  apertura del dialog, mai un `new Date()` del costruttore: PrimeNG confronta l'istante e svuota il
  valore (lezione dei seguiti C della 4.3).
- Pagine nuove con la classe `pagina-lavoro`, tema «Foglio salvia».
- **Nomi dei DTO:** i tipi di `fe/features/fatturazione/fatturazione.model.ts` (Task 14) sono il
  contratto. Il backend li segue nei DTO di risposta e di richiesta. Un nome diverso si cambia nel
  modello del frontend con un commit separato, citato nel rapporto del task.
- Database di test: `wasteflow-pg-test-registro` su `127.0.0.1:55438` (in CI `55432`, `wasteflow_ci`:
  le guardie di porta accettano le due); test Postgres col ruolo `wasteflow_app`; **pulizia solo per
  id esatti** (`pulisciTenantDiTest` di `src/test-support/legami-di-test.ts`, id raccolti in
  `tenantCreati`). Vietato cancellare per nome, per prefisso o per ora di creazione. Le fixture di
  volume si puliscono a blocchi e reggono un `afterAll` interrotto. **Un solo processo pesante alla
  volta**: `flock /home/graziano/Progetti/rifiuti-wt-rentri-registro/.superpowers/sdd/2026-11-05-fase4-4-valorizzazione-export/pesante.lock <cmd>`,
  lo stesso percorso assoluto da **tutti** i worktree (un secondo lock annullerebbe la regola;
  scansione P35). La cartella dei rapporti è la stessa.
- Barriere nei test di concorrenza: `pg_stat_activity` con `application_name` del processo e
  `wait_event_type = 'Lock'` (modello `elenchi-addebiti.service.postgres.spec.ts:18-20,613-626`),
  mai `sleep`. Piano generico: `ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`,
  ripristinato in `finally` (modello `variazioni-prezzi.service.postgres.spec.ts:761-778`).
- e2e Playwright su un'**azienda di test propria** (`creaAziendaDiTest`, `tokenAzienda`,
  `accediUiComeAzienda` di `e2e/utils/azienda-di-test.ts`; decisione 23 della 4.3), mai su
  «Azienda Test SRL». Retry sul 429 già in `e2e/utils/api-client.ts`.
- Fine task backend: `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov`
  (una volta), `npx tsc --noEmit -p tsconfig.json`, `npx eslint "{src,test}/**/*.ts" --max-warnings=-1`
  da `apps/backend` con 0 errori, suite Postgres toccate più `rls-catalogo.postgres.spec.ts` (**67**
  prima del Task 6, **76** dopo, **77** dopo il Task 29). Task frontend: Karma una volta
  (`cd apps/frontend && CHROME_BIN=… npx ng test --watch=false --browsers=ChromeHeadless`),
  `npm run build`, eslint dalla radice sui file toccati. Mai Karma e jest insieme.
- Migration: `20261105100000_fatturazione_modello` (4.4a) e `20261106100000_fatturazione_mappature`
  (4.4c). L'ultima su master è `20261104100000_legami_avvisi_e_causali`. `SET LOCAL lock_timeout = '5s';`
  in testa; additive (tabelle e colonne nuove, unici, FK e CHECK `NOT VALID` + `VALIDATE`).
  Eccezioni dichiarate: i trigger del §4.12 e gli indici unici parziali (clausola solo in SQL).
  Nessun `DROP`. Nomi ≤ 63 caratteri, uguali in schema e SQL. Ogni migration: `prisma validate`,
  `migrate deploy` su 55438, `ops/db-ruoli.sh`, `migrate diff` vuoto, rollback in `ops/README.md`.
- Audit in `activity_log` per avvio, definitiva, annullo, storno, presa d'atto, export, numero di
  partenza, cedente, emissione, mappature: solo id, numeri e importi.
- Valori della spec da non reinterpretare:
  - stati elaborazione `IN_CODA, IN_CORSO, ANTEPRIMA_PRONTA, IN_DEFINITIVA, DEFINITIVA, FALLITA, SCARTATA`;
    stati documento `BOZZA, DEFINITIVO, ANNULLATO`; tipi `TD01, TD04, TD24`; raggruppamento
    `PER_CONTRATTO, PER_ELENCO`;
  - tipi riga `MOVIMENTO, FASCIA_SPECIALE, FISSO, MINIMO, SPESA_INCASSO, BOLLO, STORNO` più
    `QUANTITA_MOVIMENTI` (P8, decisione 17); marcatori
    `SCADENZA_FISSO, PERIODO_CANONE, CONGUAGLIO, ACCONTO_FATTURATO, ACCONTO_DETRATTO`;
    `chiave_competenza` `AAAA-MM-GG` o `AAAA-MM-GG/AAAA-MM-GG`;
  - errori generali `CEDENTE_INCOMPLETO, DATA_ANTERIORE_ULTIMA_FATTURA, DATA_FUTURA, LEGAMI_SENZA_CONTRATTO`;
  - errori del documento `CONTRATTO_SOSPESO, SENZA_REGISTRO_IVA, CLIENTE_SENZA_DATI_FISCALI,
    SEDE_CLIENTE_INCOMPLETA, DATI_PA_INCOMPLETI, SENZA_CONDIZIONE_PAGAMENTO, PAGAMENTO_SENZA_BANCA,
    PAGAMENTO_NON_AMMESSO, SPESA_SENZA_CODICE_IVA, RIGA_LEGAME_INCOMPLETA, FAMIGLIA_NON_CALCOLATA,
    PREZZO_SPECIALE_NON_VALIDO, UM_NON_UNIVOCA, CANONE_PERIODO_SOVRAPPOSTO, NATURA_NON_AMMESSA,
    IMPORTI_NON_COERENTI, TOTALE_NON_POSITIVO, RITENUTA_NON_GESTITA` (18);
  - avvisi `MOVIMENTI_DA_COLLEGARE_ESCLUSI, MOVIMENTI_SOSPESI, ARRETRATI_PRESENTI, BOLLO_NON_ADDEBITATO,
    DESTINATARIO_ASSENTE, FPA_DA_FIRMARE, DATA_OLTRE_TERMINE_DIFFERITA` (7);
  - errori HTTP `ANTEPRIMA_SUPERATA, ELABORAZIONE_GIA_IN_DEFINITIVA, ELABORAZIONE_IN_CORSO,
    TROPPI_DOCUMENTI, ANNULLO_NON_AMMESSO, STORNO_GIA_PRESENTE, XML_NON_VALIDO, MAPPATURE_MANCANTI,
    VERSIONE_SUPERATA, OPERAZIONE_CONCORRENTE` più quelli di P7 (fra cui `DEFINITIVE_NON_ATTIVE`)
    nella forma `{ error, message, details? }` (dettagli numerici in `details`, mai al primo livello);
  - famiglie calcolate (decisioni 2 e 17): `CER`, `V`, `F`, `MW`, `MF`, `M<cat>`, `TT`, `TF` a prezzo
    singolo, prezzo speciale `DOCUMENTO` e `PERIODO` su `CER` e `V`; tutte le altre (`TS`, `TP`, `TQ`,
    `TR`, `T<cat>`, `N…`, `$…`, regole `PROGRESSIVO_DA_DATA`, `CONGUAGLIO_365`, `GIORNO`, condizionati,
    `TT`/`TF` a prezzo speciale) danno `FAMIGLIA_NON_CALCOLATA`;
  - tetto della definitiva 500 documenti (400 `TROPPI_DOCUMENTI`); `motivo` di annullo e storno e
    `nota` della presa d'atto da 1 a 200 caratteri dopo trim; bollo dovuto oltre `77.47`, importo
    `2.00`; nature soggette a bollo `N1, N2.1, N2.2, N3.5, N3.6, N4`; nature vietate `N2, N3, N6`;
    arretrati dei fissi al più 12 mesi; pulizia delle bozze dopo 7 giorni (`SCARTATA`, `FALLITA`) e
    30 (`ANTEPRIMA_PRONTA`); tentativi del job: `anteprima` 2, `definitiva` 1;
  - XML: `FPR12` con codice destinatario di 7 caratteri, `FPA12` con 6; `PECDestinatario` solo con
    `0000000`; `Causale` a blocchi di 200; `RiferimentoNormativo` ≤ 100; `progressivo_file` base 36
    su 5 caratteri; nome file `IT<partita IVA>_<progressivo_file>.xml`;
  - CSV: ZIP con `testate.csv` e `righe.csv`, UTF-8 con BOM, `;`, decimali con la virgola, date
    `gg/mm/aaaa`, ogni cella fra virgolette con i doppi apici raddoppiati.

- **Interruttore delle definitive (decisione 13 della spec):** colonna additiva `impostazioni_fatturazione.definitive_attive boolean NOT NULL DEFAULT false`, nella migration della 4.4a (Task 6); un'azienda senza riga = spento. `chiediDefinitiva` (Task 18-19) risponde 409 `DEFINITIVE_NON_ATTIVE` se è falsa e il job la ricontrolla nella sua transazione, con una lettura semplice (nessun lock su `impostazioni_fatturazione`, S5), senza toccare numerazione né legami (test). Anteprime e CSV non dipendono dall'interruttore. Rotta ADMIN `PUT /impostazioni-fatturazione/definitive` (Task 29b) e interruttore nella UI delle impostazioni (Task 35b) nella 4.4c, con l'avviso del gate (commercialista, decisione 14). Nessuno la accende in produzione prima del rilascio della 4.4c (query di controllo in `ops/README.md`, Task 27a).
- **TeamSystem non verificato (decisione 15):** l'interfaccia degli adattatori ha `readonly verificato: boolean` (Task 29); TeamSystem lo ha `false` (Task 30); le pagine 33 e 35 mostrano «tracciato non verificato su un'installazione reale»; il rapporto della 4.4c lo riporta (Task 37). Nessun gate di prova d'import reale.

## Review Focus

I casi che la spec implica e che nessun test della spec copre (1-5 dalla prima stesura, 6-11 dalla
scansione della 4.4b). Ciascuno ha il suo test nel task indicato.

1. **Doppio download XML in parallelo** (due amministratori, stesso documento non ancora generato):
   un solo `progressivo_file` salvato (il contatore può avanzare di più: è un nome di file, non un
   numero fiscale, Q23), stessi byte e stesso `xml_sha256` alle due risposte, un solo audit di
   emissione → Task 23.
2. **Definitiva senza documenti da numerare** (tutti esclusi, o tutti con errori): 409
   `NESSUN_DOCUMENTO_DEFINIBILE`, nessun numero consumato, l'elaborazione resta `ANTEPRIMA_PRONTA` →
   Task 19.
3. **Data documento vicino alla mezzanotte e a cavallo d'anno:** «oggi» alle 00:30 ora italiana
   (23:30 UTC del giorno prima) non è `DATA_FUTURA`; una data del 2 gennaio numera l'anno nuovo da
   `numero_partenza + 1`, anche se il registro ha definitivi a dicembre → Task 18 (data) e Task 8
   (anno).
4. **Contratto allegato con registro IVA, condizione di pagamento o esigibilità diversi dal
   principale:** il documento usa i valori del principale, le righe dell'allegato confluiscono, e il
   documento ha un solo riepilogo per aliquota → Task 17. Un allegato ha solo righe `T…`
   (`riga-addebito.ts:628-630`): con la decisione 17 le righe `TT` e `TF` si calcolano sui movimenti
   del documento e il documento esce **senza errori**; un allegato con una riga `TS` dà invece
   `FAMIGLIA_NON_CALCOLATA` (controprova nello stesso test).
5. **Storno con data documento anteriore all'`ultima_data` del registro o futura:** 409
   `DATA_ANTERIORE_ULTIMA_FATTURA` o 400 `DATA_FUTURA`, nulla scritto, legami invariati → Task 20.
6. **FK verso le righe dei legami:** `riga_legame_id` NULL in bozze, definitivi e storni; una conferma
   della 4.3 con cambio di elenco, dopo un'anteprima aperta, un annullo o uno storno rifatturabile,
   riesce (Q1, Q2) → Task 18 e 20.
7. **Doppia fatturazione dei canoni fra due elaborazioni:** `ANTEPRIMA_SUPERATA`, mai errore
   interno; con `PER_ELENCO` un allegato con una `F` dà una sola riga `F` (Q4, Q6) → Task 17 e 19.
8. **Rilancio dopo un fallimento:** una definitiva fallita e richiesta di nuovo parte e arriva a
   `DEFINITIVA`; un orfano si recupera entro 15 minuti (Q5, Q25) → Task 19 e 22.
9. **Documenti che non si possono salvare:** contratto senza registro elencato in
   `documentiNonGenerati`, nessun 500 (Q3) → Task 18.
10. **Annullo contro emissione e storno:** annullo ∥ XML mai 500; un'origine stornata non si annulla
    (Q9, Q10) → Task 20 e 23.
11. **Suffisso della serie (decisione 20)** uguale in numerazione prevista, definitiva e storno
    (Q8) → Task 18 e 20.

## Mappa dei file

Nuovi (backend):
- `src/domain/fatturazione/{codici,tipi,costanti-fiscali,righe-movimento,righe-fisse,righe-quantita,festivi,minimi,iva-bollo,pagamento,tipo-documento,controlli-sdi,calcola-documento,impronta,scostamento}.ts` (+ spec);
- `src/domain/fatturazione/xml/{normalizza-testo,serializza-fattura}.ts` (+ spec);
- `src/infrastructure/fatturapa/{valida-xsd.ts,xsd/}`; `scripts/valida-fatturapa.ts` (Task 26b);
- `src/application/fatturazione/{cedente.service,numerazione,numerazioni.service,suffisso-registro,lock-fatturazione,selezione-fatturazione,documenti-fattura.service,elaborazioni.service,anteprima,definitiva,annullo-storno.service,scostamenti.service,manutenzione-fatturazione,xml-documento.service,export-csv,export.service,pdf-cortesia}.ts` (+ spec);
- `src/application/fatturazione/adattatori/{adattatore-export-contabile,registro-adattatori,mappature.service,teamsystem.adattatore}.ts`;
- `src/infrastructure/queue/jobs/fatturazione.job.ts`;
- `src/api/fatturazione/{fatturazione.module,ruoli,cedente.controller,numerazioni.controller,elaborazioni.controller,documenti-fattura.controller,scostamenti.controller,export-contabile.controller}.ts` + `dto/`;
- `src/test-support/{fatturazione-di-test,generatore-casuale}.ts`; helper dei task della 4.4b in
  `src/test-support/fatturazione-<task>-di-test.ts` o nel loro spec (Q36: `fatturazione-di-test.ts`
  lo tocca solo il Task 17).

Nuovi (frontend): `fe/features/fatturazione/*`. Modificati: nei singoli task.

## Task 0: ambiente e linea di base

**File:** nessuno (verifica). Backend/Postgres.

- [ ] **Step 1: ambiente.** Worktree da `origin/master` (`8e991f87` o successivo), container
  `wasteflow-pg-test-registro` acceso, `rls-catalogo` a 67, cartella
  `.superpowers/sdd/2026-11-05-fase4-4-valorizzazione-export/` con `pesante.lock` e `progress.md`,
  `npx prisma --version` → 5.22.x. Aziende di volume rimaste dalla 4.3 nel DB locale: elencarle per
  id nel rapporto, non cancellarle senza l'elenco degli id. **Proprietario del DB di test:**
  `SELECT rolsuper FROM pg_roles WHERE rolname = current_user` col client proprietario, in locale
  (55438) e nella configurazione della CI (55432); l'esito decide la pulizia dei definitivi del Task 6
  (scansione P4) e va nel rapporto.
- [ ] **Step 2: linea di base** sotto `flock`: `test:cov`, `tsc`, `rls-catalogo.postgres.spec.ts` (67),
  le suite Postgres di `src/application/legami-movimento/`, `elenchi-addebiti`, `righe-addebito`,
  `codici-iva`, `spese-accessorie`, `registri-iva`. Test già rossi in `base-4-4.md` della cartella.

---

# Pezzo 4.4a — modello, numerazione, cedente e motore di calcolo

Rilascio senza cambiare il comportamento: nessun documento si crea ancora.

## Task 1: codici, tipi e costanti fiscali (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/codici.ts`, `tipi.ts`, `costanti-fiscali.ts`, `codici.spec.ts`, `costanti-fiscali.spec.ts`

**Interfaces:**
- Produces:
```ts
// codici.ts — insiemi chiusi con i valori dei Global Constraints
export const STATI_ELABORAZIONE, STATI_DOCUMENTO, TIPI_DOCUMENTO, RAGGRUPPAMENTI, TIPI_RIGA_DOCUMENTO, TIPI_MARCATORE: readonly [...] as const
export const ERRORI_GENERALI, ERRORI_DOCUMENTO, AVVISI_DOCUMENTO: readonly [...] as const
export type StatoElaborazione, StatoDocumento, TipoDocumento, TipoRigaDocumento, TipoMarcatore, ErroreGenerale, ErroreDocumento, AvvisoDocumento
export const MESSAGGI_ERRORE: Readonly<Record<ErroreGenerale | ErroreDocumento, string>>
export const MESSAGGI_AVVISO: Readonly<Record<AvvisoDocumento, string>>
export interface Segnalazione<C extends string> { codice: C; dettaglio?: string }   // dettaglio senza id né dati personali
export function validaTestoBreve(testo: unknown): { ok: true; valore: string } | { ok: false; errore: string }  // 1-200 dopo trim
export const TETTO_DOCUMENTI_DEFINITIVA = 500
// costanti-fiscali.ts
export const SOGLIA_BOLLO = '77.47'
export const NATURE_SOGGETTE_BOLLO: readonly string[]       // N1, N2.1, N2.2, N3.5, N3.6, N4 — fonte DPR 642/1972, tariffa art. 13
export function importoBolloAl(data: string): string          // '2.00' dal 2013-06-26; data precedente → errore (scansione P17)
export const NATURE_NON_AMMESSE: readonly string[]            // N2, N3, N6
export const REGIMI_FISCALI: readonly string[]                // enumerazione RegimeFiscale dell'XSD vigente (scansione P8): RF01, RF02, RF04-RF20, senza RF03; il Task 16 prova che coincide con l'XSD
export const FAMIGLIE_CALCOLATE: readonly string[]            // tipi riga: CER, V, F, MW, MF, M<cat>, TT, TF (decisione 17); applicaA: DOCUMENTO, PERIODO solo su CER e V
export function famigliaCalcolata(r: { tipo: string; prezzoSpeciale: boolean; applicaA: string | null; condizione: number | null; condizioniRiferite: string | null }): boolean
export const TOLLERANZE_SDI = { prezzoTotale: '0.01', imposta: '0.01', imponibile: '1.00' } as const  // da verificare sulle specifiche SDI vigenti (controlli 00421-00423) e citare nel commento
// tipi.ts — ingressi e uscite del calcolo, tutti gli importi come stringhe. Il Task 15 aggiunge FotografiaDocumento e DocumentoPerXml (scansione P37)
export interface RigaLegameDaFatturare { legameId: string; rigaLegameId: string; legameVersione: number; elencoId: string; movimentoVigenteId: string; dataMovimento: string; quantitaMovimento: string; unitaMovimento: string; cerCode: string; numeroFir: string | null; rigaAddebitoId: string; tipo: string; descrizione: string | null; unitaMisura: string; quantita: string | null; prezzo: string | null; prezzoSpeciale: boolean; sconto: string | null; codiceIvaId: string; aliquotaIva: string; naturaIva: string | null }
// quantitaMovimento e unitaMovimento: quantità e unità del movimento vigente, base delle righe TT e TF (decisione 17)
export interface RigaListinoDaFatturare { id: string; versione: number; elencoId: string; daAllegato: boolean; tipo: string; descrizione: string | null; categoriaId: string | null; unitaMisura: string; prezzo: string | null; quantitaFissa: string | null; sconto: string | null; prezzoSpeciale: boolean; applicaA: string | null; condizione: number | null; condizioniRiferite: string | null; scaglioni: Scaglione[]; scadenze: Scadenza[]; periodoScadenze: string | null; minimoFatturabile: string | null; minimoPerCategoria: boolean; codiceIva: CodiceIvaDaFatturare }
export interface CodiceIvaDaFatturare { id: string; versione: number; aliquota: string; natura: string | null; descrizione: string }
export interface RigaDocumentoCalcolata { numeroLinea: number; tipoRiga: TipoRigaDocumento; legameId: string | null; rigaLegameId: string | null; rigaAddebitoId: string | null; descrizione: string; dataMovimento: string | null; cerCode: string | null; numeroFir: string | null; quantita: string | null; unitaMisura: string | null; prezzoUnitario: string; sconto: string | null; importoLordo: string; importoSconto: string; prezzoTotale: string; codiceIvaId: string; aliquotaIva: string; naturaIva: string | null; marcatore?: { tipo: TipoMarcatore; chiaveCompetenza: string } }
export interface RiepilogoIvaCalcolato { aliquota: string; natura: string | null; imponibile: string; imposta: string; esigibilita: 'I' | 'D' | 'S'; riferimentoNormativo: string | null }
export interface RataCalcolata { ordine: number; modalita: string; dataScadenza: string; importo: string; istituto: string | null; iban: string | null; abi: string | null; cab: string | null; bic: string | null }
```

- [ ] **Step 1: test.** `insiemi chiusi: 7 stati di elaborazione, 3 di documento, 3 tipi, 8 tipi riga (P8), 5 marcatori, 4 errori generali, 18 errori del documento, 7 avvisi`; `ogni codice ha un messaggio non vuoto, senza id`; `validaTestoBreve("  x ")` → `"x"`; `""` e `"   "` → errore; 200 caratteri ok, 201 errore; `importoBolloAl('2026-11-05') = '2.00'`, `importoBolloAl('2013-06-26') = '2.00'`, `importoBolloAl('2013-06-25')` → errore; `NATURE_SOGGETTE_BOLLO` uguale alla lista dei Global Constraints (guardia: ampliarla è un cambio esplicito); `REGIMI_FISCALI`: 19 valori, `RF01` e `RF20` presenti, `RF03` assente; `famigliaCalcolata` vero per `CER`, `V`, `F`, `MW`, `MF`, `M001`, `TT` e `TF` a prezzo singolo, prezzo speciale `DOCUMENTO` e `PERIODO` su `CER` e `V`; falso per `TS`, `TP`, `TQ`, `TR`, `T001`, `TT` a prezzo speciale, `NM`, `NR`, `$A`, `$D`, `$R`, `PROGRESSIVO_DA_DATA`, `CONGUAGLIO_365`, `GIORNO`, una riga con `condizione` o `condizioniRiferite` valorizzate (guardia sull'insieme, spec §6.6, decisione 17).
- [ ] **Step 2: run** `npx jest -w 2 src/domain/fatturazione/codici.spec.ts src/domain/fatturazione/costanti-fiscali.spec.ts` → FAIL.
- [ ] **Step 3: implementa** i tre file; messaggi brevi in italiano (es. `FAMIGLIA_NON_CALCOLATA`: «Il contratto ha un addebito che WasteFlow non calcola ancora: il documento non si emette.»).
- [ ] **Step 4: run** → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): codici, tipi e costanti fiscali (dominio)`.

## Task 2: righe dai legami e prezzo speciale (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/righe-movimento.ts`, `righe-movimento.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`RigaLegameDaFatturare`, `RigaListinoDaFatturare`, `famigliaCalcolata`); `importoRiga`, `applicaScaglioni`, `validaPrezzoSpeciale`.
- Produces:
```ts
export type EsitoRighe = { righe: Omit<RigaDocumentoCalcolata, 'numeroLinea'>[]; errori: Segnalazione<ErroreDocumento>[] }
export function righeDaLegami(legami: readonly RigaLegameDaFatturare[], listino: ReadonlyMap<string, RigaListinoDaFatturare>): EsitoRighe
export function descrizioneRigaMovimento(r: { descrizione: string | null; cerCode: string; dataMovimento: string; numeroFir: string | null }): string  // «<descrizione> CER <cer> del gg/mm/aaaa FIR <numero>»
```
Ordine delle righe d'uscita: data del movimento, poi `legameId`, poi `rigaLegameId`. Una riga
`FASCIA_SPECIALE` del prezzo a periodo segue l'ultima riga `MOVIMENTO` della sua riga di listino;
quelle del prezzo per documento seguono la riga `MOVIMENTO` del loro legame.

**Una riga `MOVIMENTO` per ogni riga di legame (S10, scansione P13).** A prezzo singolo porta
l'importo. A prezzo speciale porta quantità, UM, FIR e `riga_legame_id` con `prezzo_unitario` `0` e
`prezzo_totale` `0.00`: l'importo sta nelle righe `FASCIA_SPECIALE`, con `legame_id` valorizzato per
`DOCUMENTO` e nullo per `PERIODO`. Così il Task 19 (`movimento_fatturato_id`), il 20 (ripristino) e
il 21 (`soloQuantita`) trovano sempre la riga del legame.

I legami hanno solo righe `CER` e `V` (`letture-legame.ts:121`): qui l'unica fonte di
`FAMIGLIA_NON_CALCOLATA` è la regola del prezzo speciale. Le famiglie non calcolate del listino
(`TS`, `N…`, `$…`) le controlla il Task 5 (scansione P12).

- [ ] **Step 1: test.** `prezzo singolo: quantità 1234.567 × 0.123456 con sconto 10+5: lordo arrotondato prima dello sconto, poi lo sconto, come importoRiga`; `descrizione: «Imballaggi CER 150101 del 03/11/2026 FIR ABC123»`; `senza FIR: niente «FIR»`; `riga CONFERMATO con quantita null o prezzo null a prezzo singolo: RIGA_LEGAME_INCOMPLETA`; `prezzo speciale DOCUMENTO: applicaScaglioni sulla quantità del singolo legame, una riga FASCIA_SPECIALE per fascia raggiunta con legameId del legame`; `prezzo speciale PERIODO: tabella A/D di fatturazione.md §4.5 sulla somma delle quantità dei legami del documento con la stessa riga di listino → importi 470.00 e 300.00, fasce con legameId null`; **`prezzo speciale (DOCUMENTO e PERIODO): ogni riga di legame ha la sua riga MOVIMENTO con rigaLegameId, quantità, prezzoUnitario "0" e prezzoTotale "0.00"; Σ prezzoTotale del documento = Σ fasce`**; `PERIODO con due UM diverse per la stessa riga di listino: UM_NON_UNIVOCA, nessuna riga`; `scaglioni non validi (validaPrezzoSpeciale): PREZZO_SPECIALE_NON_VALIDO`; `riga di legame a prezzo speciale con applicaA PROGRESSIVO_DA_DATA, CONGUAGLIO_365 o GIORNO, oppure condizionata: FAMIGLIA_NON_CALCOLATA con dettaglio «<regola> riga <n>»` (mai id), nessuna riga per quella riga di listino; `una famiglia non calcolata non impedisce il calcolo delle altre righe (l'errore blocca il documento, non il calcolo)`; `ordine deterministico: stesso insieme in ordine diverso → stesse righe nello stesso ordine`.
- [ ] **Step 2: run** `npx jest -w 2 src/domain/fatturazione/righe-movimento.spec.ts` → FAIL.
- [ ] **Step 3: implementa** `righeDaLegami` e `descrizioneRigaMovimento`; nessuna riscrittura degli importi: `importoRiga` per il prezzo singolo, `applicaScaglioni` per le fasce.
- [ ] **Step 4: run** → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): righe dai legami e prezzo speciale (dominio)`.

## Task 3: addebiti fissi, canoni, addebiti TT e TF e minimi (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/righe-fisse.ts`, `righe-quantita.ts`, `festivi.ts`, `minimi.ts` (+ spec)

**Interfaces:**
- Consumes: Task 1; `scadenzeNelPeriodo`, `periodoCompetenza`; `importoRiga`; `quantitaDaMovimento` (`src/domain/listino/importi-riga.ts:131`); `normalizzaUnitaRegistro` (`src/domain/waste-movement/unita-misura-registro.ts:18`, solo il `fattoreKg`, calcolo con `Prisma.Decimal`).
- Produces:
```ts
export interface MarcatoreEsistente { rigaAddebitoId: string; tipo: TipoMarcatore; chiaveCompetenza: string }
export function righeFisse(i: { righe: readonly RigaListinoDaFatturare[]; periodo: { dal: string; al: string }; contratto: { dataInizio: string; dataFine: string | null }; marcatori: readonly MarcatoreEsistente[] }): EsitoRighe
// righe-quantita.ts — decisione 17: solo TT e TF a prezzo singolo; ogni altra riga in ingresso è ignorata (la segnala il Task 5)
export function righeQuantitaMovimenti(i: { righe: readonly RigaListinoDaFatturare[]; legami: readonly RigaLegameDaFatturare[]; periodo: { dal: string; al: string } }): EsitoRighe   // righe QUANTITA_MOVIMENTI
// festivi.ts
export function giornoFestivo(data: string): boolean   // 'AAAA-MM-GG': domenica o festività nazionale
export function applicaMinimi(righe: readonly Omit<RigaDocumentoCalcolata, 'numeroLinea'>[], minimi: readonly RigaListinoDaFatturare[], listino: ReadonlyMap<string, RigaListinoDaFatturare>): EsitoRighe   // restituisce solo le righe aggiunte (tipo MINIMO)
```
Regole di `TT` e `TF` (decisione 17, `fatturazione.md` §4.4, WinWaste `:11928-11990`):
- base = somma delle quantità dei **movimenti** (una volta per legame, anche se il legame ha più
  righe) convertite in kg con il `fattoreKg` dell'unità del movimento. Riga di un elenco del
  principale: i legami del documento con lo stesso `elencoId`. Riga di un **contratto allegato**
  (`daAllegato`): tutti i legami del documento, perché l'allegato confluisce nel documento del
  principale e non ha movimenti propri (decisione 5);
- `TF`: solo i legami con `giornoFestivo(dataMovimento)`;
- quantità della riga = `quantitaDaMovimento('PESO_NETTO', unitaMisura, { netto: base })` (`TON`
  divide per 1000, come WinWaste); importo con `importoRiga(quantità, prezzo, sconto)`;
  descrizione = descrizione della riga di listino, o l'etichetta del tipo, con il periodo
  «dal gg/mm/aaaa al gg/mm/aaaa»; codice IVA della riga di listino; `legameId` nullo;
- base zero (nessun legame, o nessun giorno festivo per `TF`): nessuna riga;
- un movimento con unità non di massa (`fattoreKg` nullo, es. `LT`): `UM_NON_UNIVOCA` con dettaglio
  «<tipo> riga <n>», nessuna riga per quella riga di listino.

Festività di `giornoFestivo`: la domenica e le festività nazionali civili (L. 260/1949 e successive):
1/1, 6/1, lunedì dell'Angelo (Pasqua col calcolo gregoriano), 25/4, 1/5, 2/6, 15/8, 1/11, 8/12,
25/12, 26/12 e il **4/10 dal 2026** (festa di San Francesco ripristinata: estremi della legge da
verificare sulla Gazzetta Ufficiale e citare nel commento). Il patrono del comune **non** è compreso:
WinWaste aveva un calendario dei festivi suo, WasteFlow nella prima uscita usa quello nazionale.
Regole di spec §6.4 e §6.5:
- `F` con scadenze: una riga per scadenza nel periodo e nelle date del contratto senza marcatore
  `SCADENZA_FISSO` con chiave `AAAA-MM-GG`; arretrati fino a `max(dataInizio, dal − 12 mesi)`;
  descrizione con `periodoCompetenza`.
- `F` senza scadenze: una riga per il periodo con marcatore `PERIODO_CANONE` `dal/al`. Se un
  marcatore esistente ha la stessa chiave, nessuna riga. Se un marcatore della stessa riga si
  sovrappone in parte: `CANONE_PERIODO_SOVRAPPOSTO`.
- `quantita_fissa` null = 1, `0` = nessuna riga.
- Minimo di riga: il netto della riga di listino nel documento, cioè la **somma delle righe del
  documento con la stessa `rigaAddebitoId`** (una riga di listino ha tante righe quanti i legami),
  < `minimo_fatturabile` → riga «Differenza per minimo fatturabile» (scansione P20, da confermare in
  revisione). Con `minimo_per_categoria` il confronto va sulla somma delle righe della stessa
  categoria. `MW` = documento (righe `QUANTITA_MOVIMENTI` comprese), `MF` = righe CER, `M<cat>` =
  righe di quella categoria; si aggiunge la differenza.

- [ ] **Step 1: test.** `F trimestrale con scadenze 31/03, 30/06: periodo 01/04-30/06 → una riga del 30/06 con marcatore SCADENZA_FISSO "AAAA-06-30"`; `scadenza del 31/12 dell'anno prima senza marcatore: fatturata come arretrato`; `scadenza di 13 mesi prima: non fatturata`; `scadenza prima di dataInizio del contratto: non fatturata`; `scadenza con marcatore esistente: nessuna riga`; `F senza scadenze, periodo 01/10-31/10: riga con marcatore PERIODO_CANONE "AAAA-10-01/AAAA-10-31"`; `stesso periodo già marcato: nessuna riga`; `marcatore 15/10-14/11 esistente e periodo 01/10-31/10: CANONE_PERIODO_SOVRAPPOSTO`; `quantita_fissa null: quantità 1; "0": nessuna riga`; *TT e TF (decisione 17):* `TT in KG a 0.02 su tre legami dell'elenco da 1000, 2500.5 e 499.5 KG: una riga QUANTITA_MOVIMENTI con quantità 4000 e prezzoTotale 80.00`; `TT in TON a 15.00 su un movimento da 1.5 T e uno da 2500 KG: quantità 4, prezzoTotale 60.00`; `un legame con due righe (CER e V): il movimento conta una volta`; `TF in KG a 0.05 sui movimenti del 02/11/2026 (lunedì, 1000 KG), 08/11/2026 (domenica, 300 KG) e 08/12/2026 (Immacolata, martedì, 200 KG): quantità 500, prezzoTotale 25.00`; `TT di un elenco del principale: solo i legami di quell'elenco (elenco A 1000 KG, elenco B 500 KG → 1000)`; `TT di un contratto allegato: tutti i legami del documento → 1500`; `TF senza movimenti festivi o TT senza legami: nessuna riga`; `movimento in LT sotto una riga TT: UM_NON_UNIVOCA con dettaglio «TT riga <n>», nessuna riga TT`; `righe TS, TT a prezzo speciale, NM in ingresso: ignorate (nessuna riga, nessun errore qui)`; `sconto 10 su TT: come importoRiga`; *festivi:* `giornoFestivo` vero per `2026-11-08` (domenica), `2026-04-06` (lunedì dell'Angelo), `2026-06-02`, `2026-12-08`, `2027-10-04` (lunedì, San Francesco); falso per `2026-11-02`, `2026-04-07`, `2025-10-04` (sabato, prima del ripristino); *minimi:* `minimo di riga 50.00 su netto 30.00: riga MINIMO 20.00`; `minimo di riga 50.00 su due righe della stessa riga di listino da 20.00 e 25.00: riga MINIMO 5.00`; `minimo per categoria: confronto sulla somma della categoria`; `MW 100.00 su imponibile 80.00: riga MINIMO 20.00; su 120.00: nessuna riga`; `MW conta anche le righe QUANTITA_MOVIMENTI`; `MF solo sulle righe CER`; `M001 solo sulle righe della categoria 001`; `codice IVA della riga MINIMO = quello della riga di listino del minimo`.
- [ ] **Step 2: run** → FAIL. **Step 3: implementa.** **Step 4: run** → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): addebiti fissi, canoni, TT e TF e minimi (dominio)`.

## Task 4: IVA, bollo, spese di incasso, split, rate e tipo documento (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/iva-bollo.ts`, `pagamento.ts`, `tipo-documento.ts` (+ spec)

**Interfaces:**
- Consumes: Task 1; `arrotonda2`; `normalizzaIban`, `ibanValido` (`src/domain/clienti/iban.ts`).
- Produces:
```ts
export function riepiloghiIva(righe: readonly RigaDocumentoCalcolata[], esigibilita: 'I' | 'D' | 'S', codiciIva: ReadonlyMap<string, CodiceIvaDaFatturare>): { riepiloghi: RiepilogoIvaCalcolato[]; errori: Segnalazione<ErroreDocumento>[] }
export function valutaBollo(riepiloghi: readonly RiepilogoIvaCalcolato[], dataDocumento: string, spesaBollo: { importo: string; codiceIva: CodiceIvaDaFatturare | null } | null): { dovuto: boolean; importo: string | null; rigaBollo: Omit<RigaDocumentoCalcolata, 'numeroLinea'> | null; errori: Segnalazione<ErroreDocumento>[]; avvisi: Segnalazione<AvvisoDocumento>[] }
export function rigaSpeseIncasso(spesa: { descrizione: string; importo: string; codiceIva: CodiceIvaDaFatturare | null } | null, numeroRate: number): { riga: Omit<RigaDocumentoCalcolata, 'numeroLinea'> | null; errori: Segnalazione<ErroreDocumento>[] }
export interface DatiBanca { istituto: string | null; iban: string | null; bic: string | null }
export function calcolaRate(i: { netto: string; dataDocumento: string; condizione: { modalita: string; giorniRate: readonly number[]; fineMese: boolean }; esigibilita: 'I' | 'D' | 'S'; contoCedente: DatiBanca | null; bancaCliente: DatiBanca | null }): { condizioniPagamento: 'TP01' | 'TP02'; rate: RataCalcolata[]; errori: Segnalazione<ErroreDocumento>[] }
// MP05 (bonifico) usa contoCedente (da contoCorrenteEffettivo), MP12 (RiBa) usa bancaCliente (spec §6.11, scansione P15)
export function abiCabDaIban(iban: string): { abi: string; cab: string } | null    // solo IBAN IT valido: ABI = caratteri 6-10, CAB = 11-15
export function tipoDocumento(righe: readonly { tipoRiga: TipoRigaDocumento }[]): 'TD01' | 'TD24'   // TD24 con almeno una riga MOVIMENTO o FASCIA_SPECIALE (S19)
export function oltreTermineDifferita(dataDocumento: string, periodoAl: string): boolean   // data > 15 del mese dopo periodoAl
```
Algoritmi (spec §6.7-§6.11, P2):
```text
imposta(aliquota, natura)  = arrotonda2(Σ prezzo_totale × aliquota / 100)       // sul totale per coppia, non per riga
bollo dovuto              ⇔ Σ imponibili con natura ∈ NATURE_SOGGETTE_BOLLO > SOGLIA_BOLLO
spesa di incasso          = importo × numero delle rate; importo 0 → nessuna riga
netto_a_pagare            = totale_documento − (esigibilita = 'S' ? Σ imposta : 0)
rata i < n                = netto / n con ROUND_DOWN al centesimo; rata n = netto − Σ rate precedenti
data rata                 = dataDocumento + giorni; con fineMese → ultimo giorno di quel mese
```

- [ ] **Step 1: test.** *IVA:* `tre righe al 22% da 10.01, 10.01, 10.01 → imponibile 30.03, imposta 6.61 (arrotonda2(30.03 × 22 / 100) = arrotonda2(6.6066)), non 6.60 della somma delle imposte di riga (3 × 2.20)` (scansione P14: `prezzo_totale` ha 2 decimali); `riga N2.2 a zero e riga 22%: due riepiloghi`; `natura N2, N3 o N6: NATURA_NON_AMMESSA`; `riferimentoNormativo = descrizione del codice IVA troncata a 100`; `esigibilità S sul riepilogo`. *Bollo:* `imponibile N4 77.47: non dovuto; 77.48: dovuto 2.00`; `dovuto senza spesa: avviso BOLLO_NON_ADDEBITATO, nessuna riga`; `dovuto con spesa e codice IVA N1: riga BOLLO`; `spesa di bollo con codice IVA non N1: errore` (`SPESA_SENZA_CODICE_IVA` se manca, `NATURA_NON_AMMESSA` con dettaglio «bollo: serve un codice IVA con natura N1» se non N1: l'insieme resta a 18, scansione P18); `solo imponibile al 22%: non dovuto`. *Spese:* `spesa 2.50 con 3 rate: riga 7.50`; `spesa senza codice IVA: SPESA_SENZA_CODICE_IVA`. *Rate:* `100.00 in 3 rate: 33.33, 33.33, 33.34`; `200.00 in 3: 66.66, 66.66, 66.68`; `una rata: TP02; più rate: TP01`; `30 giorni fine mese dal 15/01: 28/02 (29/02 negli anni bisestili)`; `MP05 senza IBAN in contoCedente: PAGAMENTO_SENZA_BANCA, anche se bancaCliente ha l'IBAN`; `MP05 con contoCedente: rata con IBAN, istituto, ABI e CAB del cedente`; `MP12 usa bancaCliente; MP12 senza bancaCliente: PAGAMENTO_SENZA_BANCA`; `MP01 con esigibilità S o D: PAGAMENTO_NON_AMMESSO`; `split: la somma delle rate è il netto senza IVA`; `abiCabDaIban("IT60X0542811101000000123456") = { abi: "05428", cab: "11101" }`; `IBAN estero: null`. *Tipo:* `solo FISSO: TD01`; `FISSO e MOVIMENTO: TD24`; `oltreTermineDifferita("2026-11-16","2026-10-31") vero, "2026-11-15" falso`.
- [ ] **Step 2: run** → FAIL. **Step 3: implementa.** **Step 4: run** → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): IVA, bollo, spese, rate e tipo documento (dominio)`.

## Task 5: controlli SDI, calcolo del documento e impronta (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/controlli-sdi.ts`, `calcola-documento.ts`, `impronta.ts` (+ spec), `src/test-support/generatore-casuale.ts`

**Interfaces:**
- Consumes: Task 1-4.
- Produces:
```ts
export function prezzoTotaleSdi(prezzoUnitario: string, quantita: string, sconti: readonly string[]): string   // formula SDI, 8 decimali
export function controllaCoerenzaSdi(d: { righe: readonly RigaDocumentoCalcolata[]; riepiloghi: readonly RiepilogoIvaCalcolato[]; totaleDocumento: string }): Segnalazione<ErroreDocumento>[]   // [] oppure IMPORTI_NON_COERENTI con dettaglio del controllo
export interface InputDocumento { raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'; contratto: ContrattoDaFatturare; periodo: { dal: string; al: string }; dataDocumento: string; legami: RigaLegameDaFatturare[]; listino: ReadonlyMap<string, RigaListinoDaFatturare>; righeFisse: RigaListinoDaFatturare[]; righeQuantita: RigaListinoDaFatturare[]; minimi: RigaListinoDaFatturare[]; marcatori: MarcatoreEsistente[]; codiciIva: ReadonlyMap<string, CodiceIvaDaFatturare>; legamiDaCollegareEsclusi: number; arretrati: number }
// listino = TUTTE le righe attive degli elenchi del documento (principale e allegati), non solo quelle citate dai legami (scansione P12); le costruisce il Task 17
export interface ContrattoDaFatturare { id: string; versione: number; stato: string; dataInizio: string; dataFine: string | null; esigibilita: 'I' | 'D' | 'S'; ritenutaPercentuale: string | null; condizione: { modalita: string; giorniRate: number[]; fineMese: boolean } | null; contoCedente: DatiBanca | null; bancaCliente: DatiBanca | null; speseIncasso: { descrizione: string; importo: string; codiceIva: CodiceIvaDaFatturare | null } | null; bollo: { importo: string; codiceIva: CodiceIvaDaFatturare | null } | null; registroIvaId: string | null; codiceDestinatario: string | null; pec: string | null; cig: string | null; cup: string | null; idDocumento: string | null; clienteCompleto: { datiFiscali: boolean; sede: boolean } }
export interface DocumentoCalcolato { tipoDocumento: 'TD01' | 'TD24'; formatoTrasmissione: 'FPR12' | 'FPA12'; righe: RigaDocumentoCalcolata[]; riepiloghi: RiepilogoIvaCalcolato[]; rate: RataCalcolata[]; condizioniPagamento: 'TP01' | 'TP02' | null; totaleImponibile: string; totaleIva: string; totaleDocumento: string; nettoAPagare: string; bolloDovuto: boolean; importoBollo: string | null; errori: Segnalazione<ErroreDocumento>[]; avvisi: Segnalazione<AvvisoDocumento>[] }
export function calcolaDocumento(i: InputDocumento): DocumentoCalcolato
export function improntaElaborazione(i: { parametri: unknown; legami: readonly { id: string; versione: number }[]; contratti: readonly { id: string; versione: number }[]; elenchi: readonly { id: string; versione: number }[]; righeAddebito: readonly { id: string; versione: number }[]; codiciIva: readonly { id: string; versione: number }[] }): string   // sha256 esadecimale, 64 caratteri, calcolato da improntaVariazione
```
Ordine in `calcolaDocumento` (scansione P16): controllo del listino (ogni riga di `listino` con
`famigliaCalcolata` falso → `FAMIGLIA_NON_CALCOLATA` con dettaglio «<tipo> riga <n>», scansione P12)
→ righe movimento → righe `TT`/`TF` (`righeQuantitaMovimenti`) → fisse → minimi → spese di incasso →
**riepiloghi provvisori** → `valutaBollo` (sui riepiloghi senza la riga BOLLO) → riga BOLLO → numeri
di linea 1..n → **riepiloghi finali** → totali → rate → errori di contratto (`CONTRATTO_SOSPESO`,
`SENZA_REGISTRO_IVA`, `SENZA_CONDIZIONE_PAGAMENTO`, `CLIENTE_SENZA_DATI_FISCALI`,
`SEDE_CLIENTE_INCOMPLETA`, `DATI_PA_INCOMPLETI`, `RITENUTA_NON_GESTITA` con `ritenutaPercentuale > 0`)
→ `TOTALE_NON_POSITIVO` → `controllaCoerenzaSdi` → avvisi. `SOSPESO_MOVIMENTI` (lo stato arriva in
`contratto.stato`): righe movimento e righe `TT`/`TF` vuote e avviso `MOVIMENTI_SOSPESI`.

Algoritmo dello sconto a cascata contro la tolleranza SDI (spec §6.12, §17.4):
```text
nostro netto  = importoRiga(q, p, sconto).netto       // lordo = arrotonda2(q·p); sconto = arrotonda2(lordo − lordo·Π(1−sᵢ/100))
formula SDI   = p · Π(1 − sᵢ/100) · q                 // ScontoMaggiorazione SC con Percentuale sᵢ, in ordine
coerente      ⇔ |nostro netto − formula SDI| ≤ TOLLERANZE_SDI.prezzoTotale
ImponibileImporto ⇔ |imponibile − Σ PrezzoTotale| ≤ TOLLERANZE_SDI.imponibile
Imposta       ⇔ |imposta − imponibile·aliquota/100| ≤ TOLLERANZE_SDI.imposta
ImportoTotaleDocumento = Σ (imponibile + imposta) dei riepiloghi finali
```
Il bollo addebitato è già la riga `BOLLO` del riepilogo N1: non si somma una seconda volta.
`importoBollo` serve solo a `DatiBollo` (è «l'eventuale bollo» del §6.12, scansione P16).
Il test basato su proprietà gira su 20.000 casi con seme fisso: `q` da 0.001 a 99999.999 (3
decimali), `p` da 0.000001 a 9999.999999 (6 decimali), da 0 a 3 sconti fino a 99.99. **Se trova un
caso fuori tolleranza, il task si ferma e lo segnala con i valori del caso**: la rappresentazione si
sceglie in revisione (§17.4), non nel task.

Impronta (scansione P19): `improntaVariazione` (`variazione-prezzi.ts:180`) sulle voci
`{ id: '<tipo>:<id>', versione }` (`tipo` ∈ `legame, contratto, elenco, riga, iva`) più una voce
`{ id: 'parametri:' + JSON a chiavi ordinate, versione: 0 }`. Nessun `createHash` nuovo.

- [ ] **Step 1: test.** `controllaCoerenzaSdi: documento costruito con le funzioni dei Task 2-4 → []`; `PrezzoTotale alterato di 0.02 → IMPORTI_NON_COERENTI`; `bollo dovuto e non addebitato: totaleDocumento = Σ (imponibile + imposta), coerente`; **`bollo addebitato su imponibile N4 100.00: riga BOLLO 2.00 nel riepilogo N1, importoBollo 2.00 e totaleDocumento 102.00 (contato una volta, non 104.00)`**; `valutaBollo riceve i riepiloghi senza la riga BOLLO`; *listino (scansione P12):* `riga TS nel listino di un allegato del documento, mai citata dai legami: FAMIGLIA_NON_CALCOLATA con dettaglio «TS riga <n>»`; `riga NM o $A nel listino: idem`; `allegato con sola riga TT a 0.02 e legami del principale per 1500 KG: riga QUANTITA_MOVIMENTI 30.00, nessun errore` (decisione 17); `SOSPESO_MOVIMENTI con riga TT: nessuna riga TT`; **proprietà** `20.000 casi: |netto − prezzoTotaleSdi| ≤ 0.01` e `Σ rate = netto_a_pagare` e `Σ righe = Σ imponibili`; `calcolaDocumento: contratto SOSPESO → CONTRATTO_SOSPESO, nessuna riga`; `SOSPESO_MOVIMENTI → solo fisse, avviso MOVIMENTI_SOSPESI`; `ritenuta 4%: RITENUTA_NON_GESTITA`; `codice destinatario di 6 caratteri: FPA12 e avviso FPA_DA_FIRMARE`; `FPA12 con CIG e senza idDocumento: DATI_PA_INCOMPLETI`; `"0000000" senza PEC: avviso DESTINATARIO_ASSENTE`; `legamiDaCollegareEsclusi 3: avviso MOVIMENTI_DA_COLLEGARE_ESCLUSI con dettaglio "3"`; `arretrati 2: ARRETRATI_PRESENTI`; `TD24 con data oltre il 15: DATA_OLTRE_TERMINE_DIFFERITA`; `totale 0: TOTALE_NON_POSITIVO`; `numeri di linea consecutivi da 1`; `deterministico: due chiamate sullo stesso input → JSON identico`; `improntaElaborazione: ordine degli id diverso → stessa impronta; una versione cambiata → impronta diversa; parametri con chiavi in ordine diverso → stessa impronta; stesso id con tipo diverso (legame e contratto) → impronta diversa`.
- [ ] **Step 2: run** → FAIL. **Step 3: implementa** (generatore con seme fisso, P3). **Step 4: run** → PASS, la proprietà sotto 10 s.
- [ ] **Step 5: commit** `feat(fatturazione): controlli SDI, calcolo del documento e impronta (dominio)`.

## Task 6: schema, migration, trigger e RLS (Postgres, migration pesante)

**Files:**
- Modify: `prisma/schema.prisma` (enum `StatoElaborazioneFatturazione` `@@map("stato_elaborazione_fatturazione")`, `StatoDocumentoFattura`, `RaggruppamentoFatturazione`, `TipoRigaDocumentoFattura` (8 valori, P8), `TipoMarcatoreAddebito`; 9 modelli in coda dopo `ImpostazioneFatturazione`; colonne additive, compresa `ImpostazioneFatturazione.definitiveAttive` `@map("definitive_attive")`; relazioni inverse su `Tenant`, `Cliente`, `ContrattoCliente`, `ElencoAddebiti`, `RigaAddebito`, `CodiceIva`, `RegistroIva`, `SpesaAccessoria`, `LegameMovimento`, `RigaLegameMovimento`)
- Create: `prisma/migrations/20261105100000_fatturazione_modello/migration.sql`
- Modify: `src/infrastructure/persistence/prisma-rls.extension.ts` (`TENANT_SCOPED_MODELS` + 9), `rls-catalogo.postgres.spec.ts` (67 → 76), `README-tenant-transazione.md`, `ops/README.md` (rilascio e rollback), `prisma/sql/ruoli-db.sql` (`EXECUTE` della funzione della sonda), `src/test-support/legami-di-test.ts` (`pulisciTenantDiTest`, scansione P4)
- Create: `src/test-support/fatturazione-di-test.ts`
- Test: `src/application/fatturazione/fatturazione.schema.postgres.spec.ts`

**Interfaces:**
- Produces (tabelle, colonne e vincoli di spec §4.2-§4.13 più P1):
  - `impostazioni_fatturazione.definitive_attive boolean NOT NULL DEFAULT false` (decisione 13, scansione P1): i DTO della 4.3 **non** la espongono (la rotta è del Task 29b);
  - `cedente_fatturazione` (unico `tenant_id`; `regime_fiscale` CHECK `IN (…)` con l'elenco esplicito di `REGIMI_FISCALI` del Task 1, scansione P8; `socio_unico` `SU`/`SM`/null; `stato_liquidazione` default `LN`);
  - `numerazioni_fattura` (PK `(tenant_id, registro_iva_id, anno)`, `ultimo_numero`, `ultima_data`, `numero_partenza`, **`data_partenza`** (P1), `versione`; CHECK `ultimo_numero ≥ numero_partenza ≥ 0`);
  - `elaborazioni_fatturazione` (indice `(tenant_id, stato, created_at)`; unico parziale `elaborazioni_fatturazione_una_attiva` `(tenant_id) WHERE stato IN ('IN_CORSO','IN_DEFINITIVA')`; più **`esito jsonb null`** `{ codice, differenze? }`, scritto dal job della definitiva (`ANTEPRIMA_SUPERATA`, `DOPPIA_FATTURAZIONE`, `DEFINITIVE_NON_ATTIVE`) e letto da `dettaglio` come `ElaborazioneDettaglio.errore`, così la 4.4b resta senza migration (scansione P5));
  - `documenti_fattura` (unico parziale `documenti_fattura_numero_definitivo` `(tenant_id, registro_iva_id, anno, numero) WHERE stato = 'DEFINITIVO'`; unico parziale `documenti_fattura_un_storno` `(tenant_id, documento_origine_id) WHERE tipo_documento = 'TD04' AND stato <> 'ANNULLATO'`; unico `(tenant_id, progressivo_file)`; i 5 CHECK del §4.3; `errori <@ ARRAY[…18]`, `avvisi <@ ARRAY[…7]`; indici del §4.3);
  - `righe_documento_fattura` (FK `(documento_id, tenant_id)` CASCADE; unico `(documento_id, numero_linea)`; FK NoAction a legame, riga del legame, riga di listino, codice IVA);
  - `riepiloghi_iva_documento` (unico `(documento_id, aliquota, natura)` `NULLS NOT DISTINCT`), `rate_documento_fattura` (unico `(documento_id, ordine)`);
  - `marcatori_addebiti_fatturati` (unico `(tenant_id, riga_addebito_id, tipo, chiave_competenza)`; CHECK della forma della chiave);
  - `contatori_file_fatturapa` (PK `tenant_id`, `ultimo int NOT NULL DEFAULT 0`);
  - colonne: `legami_movimento.documento_id` (FK NoAction) + `scostamento_gestito_il`, `scostamento_gestito_da`, `scostamento_nota varchar(200)`; CHECK `(stato = 'FATTURATO') = (documento_id IS NOT NULL)` e `scostamento_gestito_il IS NOT NULL ⇒ scostamento_dopo_fattura` (`NOT VALID` + `VALIDATE`); `spese_accessorie.codice_iva_id` (FK NoAction); `registri_iva.suffisso_numero varchar(10)`;
  - trigger `documenti_fattura_immutabile` e `figlie_documento_immutabili` (`BEFORE UPDATE OR DELETE`) con le regole del §4.12; rollback con `DROP TRIGGER` e `DROP FUNCTION` in `ops/README.md`. Le figlie seguono lo stato della testata: l'UPDATE di una riga di un documento in BOZZA è ammesso (lo usa il passo 8 della definitiva, Task 19, scansione P2);
  - funzione della sonda `fatturazione_violazioni_numerazione() RETURNS TABLE (tenant_id uuid, violazioni int)` (scansione P6): per ogni coppia conta i numeri mancanti o doppi fra `numero_partenza+1 .. ultimo_numero` dei `DEFINITIVO`, solo conteggi per tenant. `SECURITY INVOKER` (non `DEFINER`: con la RLS FORCE il proprietario non superuser vedrebbe zero righe), `REVOKE EXECUTE … FROM PUBLIC` nella migration, `GRANT EXECUTE` al solo `wasteflow_sistema` (che ha `BYPASSRLS`) in `prisma/sql/ruoli-db.sql`, perché il ruolo può non esistere quando la migration gira (come il `REVOKE` condizionato di `20261101600000_pese_modello_dati`).
- Fixture:
```ts
export async function creaScenarioFatturazione(owner: PrismaClient, tenantId: string, opz?: { legami?: number; registri?: number; conFissi?: boolean; prezzoSpeciale?: 'DOCUMENTO' | 'PERIODO'; dataMovimento?: string; definitiveAttive?: boolean }): Promise<{ contrattoId: string; clienteId: string; elencoId: string; registroIvaId: string; legamiIds: string[]; rigaAddebitoIds: string[]; codiceIvaId: string }>
export async function creaDocumentoDiTest(owner: PrismaClient, tenantId: string, opz: { stato: 'BOZZA' | 'DEFINITIVO' | 'ANNULLATO'; registroIvaId: string; anno: number; numero?: number; dataDocumento?: string; legamiIds?: string[]; elaborazioneId?: string }): Promise<{ documentoId: string }>
export async function creaCedenteDiTest(owner: PrismaClient, tenantId: string): Promise<void>
```
Effetti delle fixture (scansione P9), inserimenti col proprietario nel rispetto dei CHECK:
- `creaDocumentoDiTest` **non** tocca `numerazioni_fattura`: chi vuole la coerenza chiama prima
  `riservaNumeri` (Task 8) e passa `numero`;
- con `legamiIds` crea una riga `MOVIMENTO` per ogni riga di quei legami, con `legame_id`,
  `riga_legame_id` e `movimento_fatturato_id`; con `DEFINITIVO` marca i legami `FATTURATO` con
  `documento_id`;
- `creaScenarioFatturazione` scrive `definitive_attive` (default `false`, come in produzione).

Pulizia (scansione P4): `pulisciTenantDiTest` aggiunge le 9 tabelle, per id esatti del tenant e
nell'ordine delle FK, **prima** dei passi esistenti dei legami: marcatori → rate, riepiloghi e righe
dei documenti → righe dei legami e legami → documenti → elaborazioni → numerazioni, contatori,
cedente → poi i passi esistenti. I documenti non in bozza si cancellano nel passo dei documenti con
`SET LOCAL session_replication_role = replica`, che serve un superuser: è il proprietario del DB di
test se il Task 0 lo conferma in locale e in CI. Altrimenti il trigger ha un'esenzione per il solo
ruolo proprietario (`current_user = <proprietario>`), mai attivabile da `wasteflow_app`.

- [ ] **Step 1: test che falliscono** (ruolo `wasteflow_app`): `documento BOZZA con numero: respinto`; `DEFINITIVO senza numero: respinto`; `DEFINITIVO con errori non vuoti: respinto`; `ANNULLATO senza motivo: respinto`; `TD04 senza documento_origine_id: respinto`; `emesso_il su BOZZA: respinto`; `due DEFINITIVO con lo stesso (registro, anno, numero): 23505`; `un ANNULLATO e un DEFINITIVO con lo stesso numero: ammesso` (decisione 3); `errore fuori dall'insieme: respinto`; `due TD04 non annullati sullo stesso documento: 23505`; *trigger:* `UPDATE del totale di un DEFINITIVO: respinto`; `UPDATE di stato DEFINITIVO → ANNULLATO con motivo: ammesso`; `ANNULLATO → DEFINITIVO: respinto`; `emesso_il null → valore: ammesso; valore → altro valore: respinto`; `xml e progressivo_file da null a valore: ammesso una volta; seconda scrittura: respinta`; `DELETE di un DEFINITIVO: respinto`; `DELETE di una BOZZA con righe: ammesso (cascata)`; `UPDATE e DELETE di righe, riepiloghi e rate di un DEFINITIVO: respinti`; **`UPDATE di movimento_fatturato_id su una riga di una BOZZA: ammesso; sulla stessa riga dopo il passaggio a DEFINITIVO: respinto`** (scansione P2); **`colonna non nell'elenco delle permesse (es. fotografia, cliente_id) cambiata su un DEFINITIVO: respinta`** (trigger fail-closed, scansione P3); *legami:* `FATTURATO senza documento_id: respinto`; `CONFERMATO con documento_id: respinto`; `scostamento_gestito_il senza scostamento_dopo_fattura: respinto`; `IMPORTATO_FATTURATO senza documento: ammesso`; *altro:* `secondo cedente per lo stesso tenant: 23505`; `marcatore duplicato: 23505`; `chiave_competenza "2026-13-01": respinta`; `delete di riga_addebito citata da una riga di documento o da un marcatore: 23503`; `delete di codice IVA citato: 23503`; `seconda elaborazione IN_CORSO per lo stesso tenant: 23505; una IN_CORSO e due ANTEPRIMA_PRONTA: ammesse`; RLS: `senza tenant 0 righe, altro tenant 0 righe` per le 9 tabelle; `nessuna colonna nuova su waste_movements` (elenco atteso delle colonne **scritto nel test**, preso da master `8e991f87`, confrontato con `information_schema`; mai letto a runtime, scansione P11); *interruttore:* `definitive_attive default false; azienda senza riga di impostazioni = spento` (scansione P1); *insiemi:* `i CHECK errori <@ … e avvisi <@ …, letti da pg_constraint, coincidono con ERRORI_DOCUMENTO e AVVISI_DOCUMENTO del Task 1; il CHECK del regime con REGIMI_FISCALI` (scansione P7); *sonda:* `fatturazione_violazioni_numerazione() chiamata da wasteflow_app: permesso negato`; *pulizia:* `pulisciTenantDiTest di un tenant con un DEFINITIVO, un ANNULLATO, marcatori e legami FATTURATO: nessuna riga rimasta, nessun errore su console.error`.
- [ ] **Step 2: run** `flock … npx jest -c jest.postgres.config.js --runInBand --forceExit src/application/fatturazione/fatturazione.schema.postgres.spec.ts` → FAIL.
- [ ] **Step 3: schema + migration.** Ordine nel file: enum → colonne additive → tabelle → unici e FK → CHECK `NOT VALID` + `VALIDATE` → indici (parziali solo in SQL) → funzioni e trigger → `ENABLE` + `FORCE ROW LEVEL SECURITY` + le due policy standard per ciascuna delle 9 tabelle (copiare da `20261103200000_legami_movimento`) → `GRANT` come `ops/db-ruoli.sh`. Il trigger è **fail-closed** (scansione P3): `to_jsonb(NEW) - ARRAY[<permesse>] IS DISTINCT FROM to_jsonb(OLD) - ARRAY[<permesse>]` → errore, così una colonna aggiunta domani è immutabile senza toccare il trigger; poi le regole puntuali sulle permesse (`stato` solo DEFINITIVO → ANNULLATO, `emesso_il`, `xml*`, `progressivo_file` da null a valore una volta). L'elenco delle colonne permesse resta esplicito (§4.12).
- [ ] **Step 4: verifiche migration.** `npx prisma validate`; `npx prisma generate`; `migrate deploy` su 55438; `db-ruoli.sh`; `migrate diff … --shadow-database-url …` → vuoto. Due prove distinte su DB temporanei (scansione P10): **(a)** DB con soli legami `CONFERMATO` della 4.3 → la migration passa; **(b)** DB con un legame `FATTURATO` → il `VALIDATE` del CHECK su `documento_id` fallisce con un messaggio che nomina il vincolo. In produzione non ci sono `FATTURATO`: la query di controllo prima del deploy va in `ops/README.md`.
- [ ] **Step 5: run** la suite + `rls-catalogo.postgres.spec.ts` (76) → PASS; `tsc`. Fine task backend.
- [ ] **Step 6: commit** `feat(fatturazione): tabelle dei documenti, numerazione, marcatori e cedente con RLS e trigger di immutabilità`.

## Task 7: dati del cedente (servizio e API, Postgres)

**Files:**
- Create: `src/application/fatturazione/cedente.service.ts` (+ `.spec.ts`, `.postgres.spec.ts`), `src/api/fatturazione/{fatturazione.module,ruoli,cedente.controller}.ts`, `dto/cedente.dto.ts`, `cedente.controller.spec.ts`
- Modify: `src/app.module.ts` (una riga: `FatturazioneModule`)

**Interfaces:**
- Produces:
```ts
export interface CedenteVista { regimeFiscale: string | null; reaUfficio: string | null; capitaleSociale: string | null; socioUnico: 'SU' | 'SM' | null; statoLiquidazione: 'LN' | 'LS'; registroIvaPredefinitoId: string | null; idTrasmittenteCodice: string | null; versione: number; daTenant: { ragioneSociale: string; partitaIva: string | null; codiceFiscale: string | null; indirizzo: string | null; cap: string | null; comune: string | null; provincia: string | null; numeroRea: string | null }; completo: boolean; mancanti: string[] }
// GET /cedente-fatturazione  RUOLI_LETTURA → CedenteVista (senza riga: valori null, versione 0)
// PUT /cedente-fatturazione  RUOLI_AMMINISTRATORI body { regimeFiscale, reaUfficio?, capitaleSociale?, socioUnico?, statoLiquidazione, registroIvaPredefinitoId?, idTrasmittenteCodice?, versione } → CedenteVista; 409 VERSIONE_SUPERATA
export class CedenteService { leggi(tenantId: string): Promise<CedenteVista>; leggiInTx(tx: Prisma.TransactionClient, tenantId: string): Promise<CedenteVista>; imposta(tenantId: string, utenteId: string, dati: DatiCedente): Promise<CedenteVista> }
```
`completo` = regime fiscale presente e, dal tenant, partita IVA, ragione sociale e indirizzo
completo (§4.9). `mancanti` = etichette italiane dei campi assenti.

- [ ] **Step 1: test (unit + Postgres).** `GET senza riga: completo false, mancanti con «Regime fiscale»`; `PUT prima volta (versione 0): 200, versione 1`; `regime "RF21", "RF03" o "XX": 400` (DTO da `REGIMI_FISCALI`); `capitaleSociale "1000,50" o numero JSON: 400; "1000.50": 200`; `socioUnico con statoLiquidazione mancante: default LN`; `registro predefinito di un altro tenant: 404`; `tenant senza indirizzo: completo false con «Indirizzo della sede»`; `versione vecchia: 409 VERSIONE_SUPERATA`; `OPERATOR e VIEWER su PUT: 403; VIEWER su GET: 200`; `audit con i nomi dei campi cambiati più codici e importi prima e dopo (regime, SU/SM, LN/LS, capitale sociale); nessun testo libero (reaUfficio, idTrasmittenteCodice solo come nome di campo)` (Global Constraints, scansione P22); `RLS: altro tenant non vede la riga`; `due PUT concorrenti con la stessa versione: uno 200 e uno 409`.
- [ ] **Step 2: run** → FAIL. **Step 3: implementa** (lock ottimistico come `ImpostazioniFatturazioneService`; modulo registrato in `app.module.ts`). **Step 4: run** → PASS; controller-tenant-selezionato e nessun-user-userid verdi. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): dati del cedente (servizio e API)`.

## Task 8: numerazione sotto lock e numero di partenza (Postgres pesante: concorrenza)

**Files:**
- Create: `src/application/fatturazione/numerazione.ts`, `numerazioni.service.ts` (+ `.spec.ts`, `.postgres.spec.ts`), `src/api/fatturazione/numerazioni.controller.ts`, `dto/numerazione.dto.ts` (+ spec)
- Modify: `src/api/fatturazione/fatturazione.module.ts`

**Interfaces:**
- Produces:
```ts
export interface RichiestaNumeri { registroIvaId: string; anno: number; quanti: number; dataDocumento: string }
export interface NumeriRiservati { registroIvaId: string; anno: number; da: number; a: number; suffisso: string | null }
export async function bloccaNumerazioni(tx: Prisma.TransactionClient, tenantId: string, coppie: readonly { registroIvaId: string; anno: number }[]): Promise<Map<string, { ultimoNumero: number; ultimaData: string | null; numeroPartenza: number; dataPartenza: string | null }>>   // chiave `${registroIvaId}:${anno}`
export async function riservaNumeri(tx: Prisma.TransactionClient, tenantId: string, r: readonly RichiestaNumeri[]): Promise<NumeriRiservati[]>   // 409 DATA_ANTERIORE_ULTIMA_FATTURA
export async function rilasciaUltimo(tx: Prisma.TransactionClient, tenantId: string, c: { registroIvaId: string; anno: number; numero: number; documentoId: string }): Promise<void>   // 409 ANNULLO_NON_AMMESSO se numero ≠ ultimo_numero
export function numeroTesto(numero: number, suffisso: string | null): string   // 15 + "/A" → "15/A"
export class NumerazioniService { elenco(tenantId: string, anno: number): Promise<NumerazioneVista[]>; impostaPartenza(tenantId: string, utenteId: string, registroIvaId: string, anno: number, dati: { numeroPartenza: number; dataPartenza: string | null; versione: number }): Promise<NumerazioneVista> }
export interface NumerazioneVista { registroIvaId: string; codiceRegistro: string; anno: number; ultimoNumero: number; ultimaData: string | null; numeroPartenza: number; dataPartenza: string | null; partenzaModificabile: boolean; versione: number }
// GET /numerazioni-fattura?anno=   RUOLI_LETTURA (un elemento per registro attivo, anche senza riga)
// PUT /numerazioni-fattura/:registroIvaId/:anno   RUOLI_AMMINISTRATORI → 409 PARTENZA_NON_MODIFICABILE se esiste un DEFINITIVO o un ANNULLATO della coppia
```
Algoritmo della riserva (spec §4.6, §5.4 passo 2):
```text
1. INSERT INTO numerazioni_fattura (tenant, registro, anno) SELECT … FROM unnest(...) ON CONFLICT DO NOTHING
2. SELECT … FOR UPDATE delle coppie, ORDER BY registro_iva_id, anno     // una query, = ANY
3. per ogni richiesta: se ultima_data non nulla e dataDocumento < ultima_data → 409 DATA_ANTERIORE_ULTIMA_FATTURA
   da = ultimo_numero + 1; a = ultimo_numero + quanti
4. UPDATE … FROM unnest(...) SET ultimo_numero = a, ultima_data = dataDocumento, versione = versione + 1
```
`rilasciaUltimo`: coppia `FOR UPDATE`; `numero = ultimo_numero` altrimenti 409; `ultimo_numero − 1`;
`ultima_data` := `max(data_documento)` dei `DEFINITIVO` della coppia con numero < quello rilasciato,
altrimenti `data_partenza` (P1).

`impostaPartenza` (scansione P23): `INSERT … ON CONFLICT DO NOTHING` della coppia, poi `FOR UPDATE`
della coppia (lo stesso lock della riserva), **poi** il controllo dei `DEFINITIVO`/`ANNULLATO` e la
scrittura: un `PUT` concorrente a una definitiva si serializza sulla numerazione.

- [ ] **Step 1: test (Postgres, `application_name` = `fatt-t8-${pid}`).** `prima riserva: 1..3`; `con numero_partenza 120: 121..`; `numeroTesto(15, "/A") = "15/A"`; `data anteriore a ultima_data: 409, ultimo_numero invariato`; `due registri nella stessa riserva: lock in ordine di registro_iva_id`; **`due transazioni sulla stessa coppia: la seconda aspetta (barriera wait_event_type = 'Lock') e riceve i numeri dopo quelli della prima`**; **`8 riserve in parallelo su 8 tenant: nessuna attesa reciproca`**; **`20 riserve in parallelo sulla stessa coppia (Promise.all, 1-5 numeri ciascuna): numeri unici, consecutivi, ultimo_numero = somma`**; `rollback della transazione dopo la riserva: ultimo_numero invariato`; `rilasciaUltimo dell'ultimo: ultimo_numero − 1 e ultima_data del precedente`; `rilasciaUltimo dell'unico definitivo dopo una partenza: ultima_data = data_partenza`; `rilasciaUltimo di un numero intermedio: 409 ANNULLO_NON_AMMESSO`; `anno nuovo (Review Focus 3): riserva al 02/01 su un registro con definitivi a dicembre → 1 (o numero_partenza + 1 dell'anno nuovo)`; *partenza:* `PUT senza definitivi: 200, ultimo_numero = numero_partenza`; `PUT con un DEFINITIVO o un ANNULLATO nella coppia: 409 PARTENZA_NON_MODIFICABILE`; **`PUT della partenza contro una riserva aperta sulla stessa coppia (barriera wait_event_type = 'Lock'): il PUT aspetta il commit della riserva e risponde 409 PARTENZA_NON_MODIFICABILE se la riserva ha poi scritto un DEFINITIVO; con la riserva annullata (rollback) risponde 200`**; `numeroPartenza negativo o non intero: 400`; `OPERATOR: 403`; `GET elenca anche i registri senza riga con ultimoNumero 0`; `audit del numero di partenza`.
- [ ] **Step 2: run** (sotto `flock`) → FAIL. **Step 3: implementa.** **Step 4: run** → PASS. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): numerazione senza buchi sotto lock e numero di partenza`.

## Task 9: colonne additive nei servizi esistenti e «in uso» (Postgres)

**Files:**
- Modify: `src/application/clienti/spese-accessorie.service.ts` e DTO (`codiceIvaId?: string | null`), `src/application/clienti/registri-iva.service.ts` e DTO (`suffissoNumero?: string | null`), `src/api/clienti/spese-accessorie.controller.ts`, `registri-iva.controller.ts`, `src/application/listino/uso-listino.ts` (sorgenti `righeDocumento` e `marcatori`), `src/application/listino/codici-iva.service.ts` (`eliminabile`), `src/application/clienti/uso-tabelle-fatturazione.ts` (sorgenti nuove, scansione P24); i servizi di cliente, contratto ed elenco solo se il test di eliminazione dà 500 invece di 409
- Create: `src/application/fatturazione/suffisso-registro.ts`
- Test: le suite Postgres e controller di spese accessorie, registri IVA, codici IVA, righe di listino, clienti, contratti ed elenchi; `uso-listino.spec.ts`

**Interfaces:**
- Produces: `SpesaAccessoriaVista.codiceIvaId: string | null`; `RegistroIvaVista.suffissoNumero: string | null` e `suffissoModificabile: boolean`; 409 `SUFFISSO_NON_MODIFICABILE` se il registro ha un `DEFINITIVO` nell'anno della data italiana corrente (§4.10), letto sotto `FOR UPDATE` della numerazione di quella coppia (stesso lock della riserva; scansione P25, perimetro della spec); `ColonneReferentiListino.righeDocumento` e `.marcatori`; sorgenti «in uso» nuove in `uso-tabelle-fatturazione.ts`: spese accessorie per i codici IVA; documenti, numerazioni e cedente (registro predefinito) per i registri IVA (scansione P24); `suffissoValido(s: string | null): boolean` (1-10 caratteri `[A-Za-z0-9/-]`, accettati dall'XSD in `Numero`).

- [ ] **Step 1: test.** `spesa con codice IVA di un altro tenant: 404`; `spesa senza codice IVA: 200 come prima`; `codice IVA della spesa disattivato: la spesa resta`; `suffisso "/A": 200; "/A B" o 11 caratteri: 400`; `suffisso con un DEFINITIVO nell'anno: 409 SUFFISSO_NON_MODIFICABILE; con definitivi solo dell'anno prima: 200`; `cambio di suffisso contro una riserva aperta sulla coppia dell'anno (barriera): aspetta, poi 409`; `riga di listino citata da una riga di documento: eliminabile false, delete 409 RIGA_ADDEBITO_IN_USO`; `citata da un marcatore: idem`; `codice IVA citato da una spesa o da una riga di documento: CODICE_IVA_IN_USO`; **`registro IVA citato da un documento, da una numerazione o dal cedente come predefinito: non eliminabile, delete 409`**; **`cliente, contratto ed elenco citati da un documento: delete 409 col codice «in uso» del loro servizio, mai 500`** (FK NoAction, 23503); `contaUsiListino con 1000 id: una query per colonna`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (suite toccate + `rls-catalogo` 76). Nessuna regressione su clienti e listino. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): codice IVA delle spese, suffisso del registro e listino in uso dai documenti`.

## Task 10: frontend — schede «Dati del cedente» e «Numerazione»

**Files:**
- Create: `fe/features/fatturazione/impostazioni/cedente-scheda.component.ts` (+ spec), `numerazione-scheda.component.ts` (+ spec), `fe/features/fatturazione/impostazioni/impostazioni-fatturazione-4-4.service.ts` (+ spec), `impostazioni.model.ts`
- Modify: `fe/features/legami/impostazioni-fatturazione.component.ts` (tre schede: «Fatturazione da», «Dati del cedente», «Numerazione»; spec estesa)

**Interfaces:**
- Consumes: Task 7 (`CedenteVista`), Task 8 (`NumerazioneVista`, `PARTENZA_NON_MODIFICABILE`). `CedenteVista` e `NumerazioneVista` si copiano **alla lettera** in `impostazioni.model.ts` (il task si scrive prima del backend; il Task 13 confronta le chiavi con le risposte del 7 e dell'8, scansione P28). `REGIMI_FISCALI` si copia nello stesso file dall'elenco scritto nel Task 1 di questo piano (stessa ondata: si copia dal piano, non dal codice; scansione P8).
- Produces: `ImpostazioniFatturazione44Service.leggiCedente()`, `.salvaCedente(dati)`, `.numerazioni(anno)`, `.impostaPartenza(registroIvaId, anno, dati)`. Servizio separato da `impostazioni-fatturazione.service.ts` della 4.3: endpoint diversi (scansione P27).

- [ ] **Step 1: test.** `cedente: dati del tenant in sola lettura, regime fiscale dal menu di REGIMI_FISCALI (19 voci, niente RF03)`; `capitale sociale con appNumeroIt: "1000,50" inviato "1000.50"; "1000.50" → «Usa la virgola per i decimali»`; `cedente incompleto: riquadro con i campi mancanti`; `numerazione: tabella per registro con ultimo numero, ultima data, partenza; «Numero di partenza» solo se partenzaModificabile`; `nessuna partenza impostata e nessun definitivo: avviso «La numerazione partirà da 1»`; `data di partenza: maxDate = fine del giorno ricalcolata all'apertura`; `VIEWER e OPERATOR: campi disabilitati`; `409 VERSIONE_SUPERATA e PARTENZA_NON_MODIFICABILE: messaggio e ricarica`.
- [ ] **Step 2-4:** Karma mirato FAIL → implementa → Karma una volta + build + eslint → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): schede cedente e numerazione nelle impostazioni`.

## Task 11: frontend — codice IVA delle spese e suffisso del registro

**Files:**
- Modify: `fe/features/clienti/tabelle/registro-iva-dialog.component.ts` e il dialog delle spese accessorie nella stessa cartella (+ spec), i rispettivi modelli e servizi

**Interfaces:** Consumes Task 9 (`codiceIvaId`, `suffissoNumero`, `suffissoModificabile`, `SUFFISSO_NON_MODIFICABILE`).

- [ ] **Step 1: test.** `spesa: menu codice IVA (solo attivi), salvato nel corpo; vuoto → null`; `bollo senza codice IVA N1: suggerimento «Per addebitare il bollo serve un codice IVA con natura N1»`; `registro: suffisso modificabile solo se suffissoModificabile, con tooltip del motivo`; `409 SUFFISSO_NON_MODIFICABILE: messaggio del backend`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): codice IVA delle spese e suffisso del registro`.

## Task 12: verifica e chiusura 4.4a (e2e API leggero, Postgres)

**Files:**
- Create: `e2e/tests/fatturazione/impostazioni-fatturazione-4-4.spec.ts`
- Modify: `ops/README.md` (rilascio e rollback 4.4a, query di controllo dei `FATTURATO` prima del deploy)

- [ ] **Step 1: test e2e** (azienda propria): `ADMIN imposta il cedente; OPERATOR 403`; `GET numerazioni dell'anno: registri con ultimo numero 0`; `ADMIN imposta il numero di partenza 120`; `spesa con codice IVA`; `nessuna rotta di elaborazione esiste ancora (POST /elaborazioni-fatturazione → 404)`.
- [ ] **Step 2: verifica completa** sotto `flock`: `test:cov`, `tsc`, eslint, suite Postgres dei Task 6-9, `rls-catalogo` 76, Karma una volta, `migrate diff` vuoto. Confronto con la linea di base del Task 0.
- [ ] **Step 3: commit** `test(fatturazione): e2e delle impostazioni e chiusura 4.4a`.

## Task 13: revisione dell'intero branch — 4.4a

**File:** nessuno (revisione opus su `git diff master...HEAD`).

- [ ] **Step 1:** revisore opus fresco (`typescript-nestjs-reviewer`). Controlli espliciti: RLS ENABLE+FORCE nella stessa migration, 9 modelli in `TENANT_SCOPED_MODELS`, conteggio 76; trigger **fail-closed** (`to_jsonb` meno le colonne permesse, elenco esplicito delle permesse); `definitive_attive` default `false` e non esposta dai DTO della 4.3; colonna `esito` e funzione della sonda con `EXECUTE` al solo `wasteflow_sistema`; CHECK di errori, avvisi e regime uguali alle costanti del Task 1 (test da `pg_constraint`); nessun `DROP`; il `VALIDATE` sul CHECK di `documento_id` sicuro in produzione; nessuna colonna su `waste_movements`; `@Roles` su ogni rotta; il dominio non importa Prisma client né servizi; proprietà dello sconto verde su 20.000 casi; `TT`/`TF` calcolati e le altre `T…` in errore (decisione 17); pulizia dei test per id, definitivi compresi; chiavi di `CedenteVista` e `NumerazioneVista` del frontend uguali alle risposte dei Task 7 e 8; Global Constraints. Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto `.superpowers/sdd/2026-11-05-fase4-4-valorizzazione-export/4-4a-report.md`; PR 4.4a, merge, deploy con `migrate deploy`.

---

## Seguiti dalla 4.4a (revisione finale, review-finale-4-4a.md)

Da portare nei brief dei task indicati. Il primo è vincolante. Correzioni della scansione della 4.4b
(`scansione-4-4b.md`, Q1-Q45) applicate; esito in `ruling-4-4b-applicati.md`.
- **Task 18 e 19, FK delle righe di legame (I1, corretto da Q1 e Q2):** `riga_legame_id` resta
  **sempre NULL** sulle righe dei documenti, nelle bozze e nei definitivi. La FK
  `righe_documento_fattura_riga_legame_fkey` (NO ACTION) resta inutilizzata, senza migration. Le
  bozze le scrive il Task 18 (`eseguiAnteprima` ignora `RigaDocumentoCalcolata.rigaLegameId`); la
  definitiva (Task 19, passo 8) scrive sulle righe solo `movimento_fatturato_id`. Chi deve risalire
  alla riga del legame usa `(legame_id, riga_addebito_id)`. Motivo: dopo un annullo o uno storno
  rifatturabile il legame torna `CONFERMATO` e la 4.3 cancella o sostituisce le sue righe
  (`conferma-legame.service.ts:1195`, `:1256`); una riga immutabile che le cita darebbe 23503 per
  sempre. Test: Task 18 «legame in un'anteprima aperta: conferma con cambio di elenco riuscita,
  l'impronta dell'anteprima risulta superata»; Task 20 «annullo dell'ultimo, poi conferma del
  legame con cambio di elenco: riuscita, nessun 23503», e lo stesso dopo uno storno rifatturabile.
  `creaDocumentoDiTest` (fixture della 4.4a) scrive anch'essa NULL (Task 17).
- **Task 17:** `numeroRiga` obbligatorio in `righe-fisse.ts`, `righe-quantita.ts`, `minimi.ts`;
  `FORMA_MINIMO_CATEGORIA` esportata da `costanti-fiscali.ts` e usata in `minimi.ts`; testo di
  `RIGA_LEGAME_INCOMPLETA` «Una riga del legame o del listino è incompleta: mancano quantità o
  prezzo.» (lo stesso testo nel vocabolario del Task 14, Q19); Task 17 passa `righeFisse`,
  `righeQuantita`, `minimi` come sottoinsiemi di `listino`, riempie `categoriaCodice` e passa le date
  `AAAA-MM-GG`.
- **Task 18, suffisso e documenti dell'anno prima (M2, decisione 20, Q8):** il Task 18 aggiunge a
  `numerazione.ts` `suffissiDelleSerie`, usata da `riservaNumeri` (quindi da definitiva e storno) e
  dalla numerazione prevista; test con cambio di suffisso a gennaio e documento datato dicembre.
- **Task 17, `F` senza prezzo (decisione 21):** `RIGA_LEGAME_INCOMPLETA` solo se nel periodo la `F`
  produrrebbe una riga (controllo dopo `scadenzeNelPeriodo`); test con `F` senza prezzo e senza
  scadenze nel periodo: nessun errore.
- **Task 19/20:** ordine `BOZZA` → figlie → `DEFINITIVO`; annullo = `rilasciaUltimo` sul
  `DEFINITIVO` non emesso, poi `ANNULLATO`, nella stessa transazione.
- **Task 17b, uso (Q18):** campo `documenti` in `ColonneReferentiListino` con
  `documenti_fattura.elenco_id` in `COLONNE_ELENCO` di `uso-listino.ts` (M4); filtro delle
  numerazioni scritte come terzo elemento della tupla `sorgenti` in `uso-tabelle-fatturazione.ts`;
  `impostaPartenza` tratta una riga vuota come assente (M3).
- **Task 14, frontend (Q18):** dopo un 409 `SUFFISSO_NON_MODIFICABILE` il campo torna al valore
  salvato (`registro-iva-dialog.component.ts`).

# Pezzo 4.4b (4.4b1) — elaborazione, definitiva, annullo, storno e scostamenti

Da master dopo il merge della 4.4a. La conferma del commercialista su TD24, documenti misti e nature
del bollo (§17.5) **non** è un gate del codice: è il gate per accendere `definitive_attive` in
produzione (decisione 14), scritto in `ops/README.md` (Task 27a) e nell'avviso della UI (Task 35b).

**Divisione (decisione 26).** La 4.4b esce in due pezzi, ciascuno con la sua PR e il suo rilascio:
- **4.4b1** = Task 14, 15, 17, 17b, 18, 19, 20, 21, 22, 25a, 26a, 27a: elaborazione, anteprima,
  definitiva, annullo, storno, scostamenti, pulizia, API senza XML ed export. Con le definitive
  spente il rilascio è innocuo e mette in produzione transazioni e lock con una revisione dedicata.
- **4.4b2** = Task 16, 23, 24, 25b, 26b, 27b: XSD, XML, emissione, CSV ed export. Parte dopo il merge
  della 4.4b1. La 4.5 aspetta la 4.4b2 (XML validato); la 4.4c parte dopo il merge della 4.4b2.

Il Task 14 apre la 4.4b1 e fissa anche i nomi usati dalla 4.4b2 (XML, export).

**Codici HTTP aggiunti dalla scansione della 4.4b** (in P7 e nel vocabolario del Task 14): 409
`XML_NON_DISPONIBILE` (Q7), 409 `STORNO_NON_AMMESSO` con `details.motivo` (Q33); 409 con il codice
dell'errore generale `CEDENTE_INCOMPLETO` o `DATA_ANTERIORE_ULTIMA_FATTURA` da `chiediDefinitiva`
(decisione 24, Q15).

## Task 14: frontend — modelli e servizio HTTP della fatturazione (contratto dei nomi)

**Files:**
- Create: `fe/features/fatturazione/fatturazione.model.ts`, `fatturazione.service.ts` (+ spec), `vocabolario-fatturazione.ts` (+ spec), `permessi-fatturazione.ts` (+ spec)
- Modify: `fe/features/clienti/tabelle/registro-iva-dialog.component.ts` (+ spec) (seguito della 4.4a, Q18)

**Interfaces:**
- Produces (nomi vincolanti per i DTO del backend, P5). `fatturazione.model.ts` **non importa nulla
  da Angular**: lo importa anche l'e2e del Task 26a (Q21).
```ts
export interface NuovaElaborazione { periodoDal: string; periodoAl: string; dataDocumento: string; raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'; includiArretrati: boolean; filtri: FiltriElaborazione }
export interface FiltriElaborazione { clienteIds?: string[]; contrattoIds?: string[]; categoriaIds?: string[]; tipiAddebito?: string[]; registroIvaIds?: string[] }
// decisione 25: categoriaIds e tipiAddebito scelgono CONTRATTI interi, mai righe (Task 17)
export interface SegnalazioneVista { codice: string; messaggio: string; dettaglio?: string }
export type MotivoNonAnnullabile = 'NON_DEFINITIVO' | 'NOTA_DI_CREDITO' | 'STORNATO' | 'EMESSO' | 'NON_ULTIMO'   // Q9
export type MotivoNonStornabile = 'NON_DEFINITIVO' | 'NOTA_DI_CREDITO'                                          // Q33
export interface DocumentoNonGenerato { contrattoId: string; contrattoNumero: string; clienteId: string; denominazione: string; errori: SegnalazioneVista[] }   // Q3
export interface ElaborazioneRiga { id: string; stato: StatoElaborazione; createdAt: string; periodoDal: string; periodoAl: string; dataDocumento: string; documenti: number; totale: string; errori: number; avvisi: number }
export interface ElaborazioneDettaglio extends ElaborazioneRiga { raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'; includiArretrati: boolean; filtri: FiltriElaborazione; impronta: string | null; versione: number; definitiveAttive: boolean; erroriGenerali: SegnalazioneVista[]; erroriPeriodo: { motivo: string; quanti: number; contrattoId: string | null }[]; numerazionePrevista: { registroIvaId: string; codiceRegistro: string; da: string; a: string }[]; totaliPerRegistro: { registroIvaId: string; imponibile: string; iva: string; totale: string }[]; documentiNonGenerati: DocumentoNonGenerato[]; errore: { codice: string; differenze?: { nuovi: number; cambiati: number; fatturatiDaAltri: number }; ultimaData?: string } | null; erroreTecnico: string | null }
// definitiveAttive: l'interruttore dell'azienda (decisione 13, scansione P34); errore: la colonna esito (scansione P5, Q15); erroreTecnico: errore_tecnico di una FALLITA (Q17)
export interface DocumentoRiga { id: string; stato: StatoDocumento; tipoDocumento: string; numeroTesto: string | null; dataDocumento: string; cliente: { id: string; denominazione: string }; contratto: { id: string; numero: string }; registro: { id: string; codice: string }; totaleImponibile: string; totaleIva: string; totaleDocumento: string; errori: SegnalazioneVista[]; avvisi: SegnalazioneVista[]; esclusoDaDefinitiva: boolean; emessoIl: string | null; annullabile: boolean; motivoNonAnnullabile: MotivoNonAnnullabile | null; stornabile: boolean }
// registro non nullo: un documento senza registro non diventa bozza, sta in documentiNonGenerati (Q3). motivoNonAnnullabile è il codice; l'etichetta la dà il vocabolario
export interface RigaDocumentoVista { numeroLinea: number; tipoRiga: string; legameId: string | null; rigaAddebitoId: string | null; descrizione: string; dataMovimento: string | null; cerCode: string | null; numeroFir: string | null; quantita: string | null; unitaMisura: string | null; prezzoUnitario: string; sconto: string | null; importoLordo: string; importoSconto: string; prezzoTotale: string; aliquotaIva: string; naturaIva: string | null }
export interface RiepilogoIvaVista { aliquota: string; natura: string | null; imponibile: string; imposta: string; esigibilita: 'I' | 'D' | 'S'; riferimentoNormativo: string | null }
export interface RataVista { ordine: number; modalita: string; dataScadenza: string; importo: string; istituto: string | null; iban: string | null; abi: string | null; cab: string | null; bic: string | null }
// Q34: elenco chiuso, importi e quantità stringhe col punto; nessun id interno oltre a legameId e rigaAddebitoId
export interface DocumentoDettaglio extends DocumentoRiga { righe: RigaDocumentoVista[]; riepiloghi: RiepilogoIvaVista[]; rate: RataVista[]; nettoAPagare: string; bolloDovuto: boolean; importoBollo: string | null; versione: number; documentoOrigineId: string | null; stornoId: string | null; xmlGenerato: boolean }
export interface ScostamentoRiga { legameId: string; documento: { id: string; numeroTesto: string; dataDocumento: string }; tipoCorrezione: 'RETTIFICA' | 'ANNULLO' | 'CAMBIO_CER' | 'CAMBIO_CAUSALE'; quantitaFatturata: string | null; importoFatturato: string; quantitaAttuale: string | null; importoAttuale: string | null; soloQuantita: boolean }
export interface Pagina<T> { elementi: T[]; totale: number; pagina: number; dimensione: number }
export interface SelezioneExport { registroIvaId?: string; anno?: number; numeroDa?: number; numeroA?: number; dataDa?: string; dataA?: string; clienteId?: string; documentoIds?: string[]; elaborazioneId?: string }   // = SelezioneExport del Task 24
// Q21: costanti esaustive, il compilatore le tiene allineate ai tipi
export const CHIAVI_ELABORAZIONE_RIGA: Record<keyof ElaborazioneRiga, true>
export const CHIAVI_ELABORAZIONE_DETTAGLIO: Record<keyof ElaborazioneDettaglio, true>
export const CHIAVI_DOCUMENTO_RIGA: Record<keyof DocumentoRiga, true>
export const CHIAVI_DOCUMENTO_DETTAGLIO: Record<keyof DocumentoDettaglio, true>
export const CHIAVI_RIGA_DOCUMENTO: Record<keyof RigaDocumentoVista, true>
export const CHIAVI_SCOSTAMENTO_RIGA: Record<keyof ScostamentoRiga, true>
```
`FatturazioneService`: un metodo per rotta del §11 tranne mappature e credenziali (`avvia`, `lista`,
`dettaglio`, `documentiElaborazione`, `ricalcola`, `scarta`, `escludi`, `riammetti`, `definitiva`,
`documenti`, `documento`, `annulla`, `storno`, `segnaEmesso`, `scaricaXml(id: string,
confermaEmissione: boolean)`, `pdf`, `esporta(formato: string, selezione: SelezioneExport,
confermaEmissione: boolean)`, `scostamenti`, `presaAtto`). Il parametro `confermaEmissione` è
esplicito: il servizio non lo mette mai a `true` da solo (Q28). `dimensione` di default 50, mai
oltre 100. `permessiFatturazione(ruolo)`: `{ vede, prepara, rendeDefinitiva, scaricaXml, imposta }`
secondo spec §12; `rendeDefinitiva` dice solo il ruolo: l'interruttore lo legge la UI da
`ElaborazioneDettaglio.definitiveAttive` (Task 32).

Vocabolario: ogni stato, errore, avviso e motivo con etichetta e severità. `LEGAMI_SENZA_CONTRATTO`
ha severità **avviso** (decisione 24: non blocca la definitiva; i movimenti restano fuori dalla
fattura); `CEDENTE_INCOMPLETO`, `DATA_ANTERIORE_ULTIMA_FATTURA` e `DATA_FUTURA` severità errore.
`RIGA_LEGAME_INCOMPLETA` con lo stesso testo del backend (Q19). Esiti di `ElaborazioneDettaglio.errore`:
`ANTEPRIMA_SUPERATA`, `DOPPIA_FATTURAZIONE`, `DEFINITIVE_NON_ATTIVE`, `DATA_ANTERIORE_ULTIMA_FATTURA`,
`CEDENTE_INCOMPLETO` (Task 19) ed `ELABORAZIONE_INTERROTTA` («L'elaborazione si è interrotta: richiedi
di nuovo la definitiva», Task 22).

- [ ] **Step 1: test.** un test per metodo con `HttpTestingController` (URL, metodo, corpo con importi come stringhe col punto, `responseType: 'blob'` per XML, PDF ed export); **`scaricaXml(id, true)` ed `esporta('XML_ZIP', s, true)` mandano `confermaEmissione: true`; `scaricaXml(id, false)` manda `false`: il servizio non la inventa** (Q28); `dimensione 200 richiesta: il servizio manda 100`; vocabolario: `ogni stato, errore e avviso ha etichetta e severità`; `errori HTTP di P7 compresi, con DEFINITIVE_NON_ATTIVE «Le fatture definitive non sono ancora attive per questa azienda»` (scansione P33), `XML_NON_DISPONIBILE «Un documento annullato non ha l'XML»` (Q7) e `STORNO_NON_AMMESSO` (Q33); `i cinque MotivoNonAnnullabile, STORNATO compreso, e i due MotivoNonStornabile con etichetta` (Q9, Q33); `LEGAMI_SENZA_CONTRATTO con severità avviso` (decisione 24); `i sei esiti di errore.codice con etichetta, ELABORAZIONE_INTERROTTA compreso`; `RIGA_LEGAME_INCOMPLETA «Una riga del legame o del listino è incompleta: mancano quantità o prezzo.»` (Q19); `tipo riga QUANTITA_MOVIMENTI con etichetta`; permessi: `VIEWER vede soltanto; OPERATOR prepara; ADMIN e SUPER_ADMIN tutto`; `CHIAVI_*: una chiave per campo del tipo (prova di compilazione con un campo in più e uno in meno, @ts-expect-error)`; *registro IVA (Q18):* `409 SUFFISSO_NON_MODIFICABILE: messaggio del backend e il campo torna al valore salvato`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): modelli, servizio e vocabolario frontend`.

## Task 15: normalizzatore dei testi e serializzatore XML FatturaPA (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/xml/normalizza-testo.ts`, `serializza-fattura.ts` (+ spec)
- Modify: `src/domain/fatturazione/tipi.ts` (`FotografiaDocumento`, `FotografiaSalvata`, `DocumentoPerXml`: stanno nel dominio, il Task 17 li importa; scansione P37, Q16). Il Task 15 è l'unico della 4.4b che tocca `tipi.ts`.

**Interfaces:**
- Produces:
```ts
// tipi.ts
export interface FotografiaDocumento { cedente: { denominazione: string; partitaIva: string; codiceFiscale: string | null; regimeFiscale: string; sede: { indirizzo: string; cap: string; comune: string; provincia: string | null; nazione: 'IT' }; rea: { ufficio: string; numero: string; capitaleSociale: string | null; socioUnico: 'SU' | 'SM' | null; statoLiquidazione: 'LN' | 'LS' } | null; idTrasmittente: string }; cessionario: { denominazione: string | null; nome: string | null; cognome: string | null; partitaIva: string | null; codiceFiscale: string | null; sede: { indirizzo: string; cap: string; comune: string; provincia: string | null; nazione: 'IT' } }; pagamento: { codice: string; descrizione: string; modalita: string; giorniRate: number[]; fineMese: boolean } | null; conto: { istituto: string | null; iban: string | null; bic: string | null } | null; testoFatturazione: string[]; cig: string | null; cup: string | null; idDocumento: string | null }
// nazione 'IT' è una scelta: i clienti esteri sono fuori dalla prima uscita (oggi i clienti non hanno nazione, Q27)
export interface FotografiaSalvata extends FotografiaDocumento { segnalazioni: { errori: Segnalazione<ErroreDocumento>[]; avvisi: Segnalazione<AvvisoDocumento>[] } }
// forma di documenti_fattura.fotografia (Q16): le bozze salvano errori e avvisi completi di dettaglio; la definitiva la riscrive con errori [] e gli avvisi. Le colonne text[] errori/avvisi restano la fonte dei CHECK
export interface DocumentoPerXml { testata: { tipoDocumento: 'TD01' | 'TD04' | 'TD24'; formatoTrasmissione: 'FPR12' | 'FPA12'; codiceDestinatario: string; pecDestinatario: string | null; dataDocumento: string; numeroTesto: string; totaleDocumento: string; bolloDovuto: boolean; importoBollo: string | null; esigibilita: 'I' | 'D' | 'S'; condizioniPagamento: 'TP01' | 'TP02' | null; origine: { numeroTesto: string; dataDocumento: string } | null }; righe: RigaDocumentoCalcolata[]; riepiloghi: RiepilogoIvaCalcolato[]; rate: RataCalcolata[]; fotografia: FotografiaDocumento }
// normalizza-testo.ts, serializza-fattura.ts
export function normalizzaTesto(s: string, lunghezzaMassima: number): string   // traslittera in Latin di base + Latin-1, poi tronca; '€' → 'EUR', virgolette tipografiche → '"', lineette → '-', spazi multipli → uno
export interface DatiFatturaXml { trasmissione: { idPaese: 'IT'; idCodice: string; progressivoInvio: string; formato: 'FPR12' | 'FPA12'; codiceDestinatario: string; pecDestinatario: string | null }; cedente: FotografiaDocumento['cedente']; cessionario: FotografiaDocumento['cessionario']; generali: { tipoDocumento: string; data: string; numero: string; bollo: { importo: string } | null; importoTotale: string; causale: string[] }; contratto: { idDocumento: string | null; cig: string | null; cup: string | null } | null; fattureCollegate: { idDocumento: string; data: string } | null; linee: RigaDocumentoCalcolata[]; riepiloghi: RiepilogoIvaCalcolato[]; pagamento: { condizioni: 'TP01' | 'TP02'; rate: RataCalcolata[] } | null }
export function serializzaFattura(d: DatiFatturaXml): string   // UTF-8, ordine delle sequenze dell'XSD, nessuno spazio non significativo, importi col punto
export function datiFatturaDaDocumento(doc: DocumentoPerXml, progressivoFile: string): DatiFatturaXml   // dalla fotografia e dalle righe salvate
```
Lunghezze dell'XSD in una tabella costante con il nome del campo (es. `Denominazione` 80,
`Descrizione` 1000, `Causale` 200 per blocco). `ScontoMaggiorazione` `SC` con `Percentuale` per ogni
termine della cascata, nell'ordine. Il numero del FIR in `AltriDatiGestionali` con `TipoDato` `FIR`.
Il serializzatore serve alla 4.4b2; sta nella 4.4b1 perché `FotografiaDocumento` serve al Task 17.

- [ ] **Step 1: test.** `normalizzaTesto("Società “Rossi” – 10 €", 80) = 'Società "Rossi" - 10 EUR'` (`à` è Latin-1 e resta); `"Łódź"` → `"Lodz"`; `testo di 90 caratteri con limite 80: 80`; `emoji e caratteri CJK: tolti`; `serializzaFattura deterministico: stessi dati → stessa stringa byte per byte`; `ordine degli elementi di DatiGeneraliDocumento come l'XSD`; `PECDestinatario solo con "0000000"`; `causale di 450 caratteri: 3 blocchi`; `sconto "10+5": due ScontoMaggiorazione SC 10.00 e 5.00`; `persona fisica: Nome e Cognome, nessuna Denominazione`; `TD04: DatiFattureCollegate con numero e data dell'origine`; `bollo: DatiBollo con BolloVirtuale SI e ImportoBollo 2.00`; `split: EsigibilitaIVA S nel riepilogo`; `caratteri speciali XML (&, <) escapati`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): normalizzatore e serializzatore XML FatturaPA (dominio)`.

## Task 17: selezione e letture dell'elaborazione, guardia sul registro (Postgres pesante: volume)

**Files:**
- Create: `src/application/fatturazione/selezione-fatturazione.ts` (+ `.postgres.spec.ts`), `lock-fatturazione.ts`
- Modify: `src/domain/fatturazione/{righe-fisse,righe-quantita,minimi,costanti-fiscali,codici,impronta}.ts` e le loro spec (seguiti della 4.4a, decisione 21, Q4, Q19); `src/application/legami-movimento/guardia-registro.spec.ts` (Q35); `src/test-support/fatturazione-di-test.ts` (`creaScenarioVolume`; `creaDocumentoDiTest` scrive `riga_legame_id` NULL, Q1)

**Interfaces:**
- Consumes: `sqlCandidati` (`lista-legami.service.ts:224`), `sqlGiornoMovimento`, `periodoDaFatturare`, `destinatarioEffettivo`, `contoCorrenteEffettivo`, `bloccaRigheLegame`, `joinLineari`; Task 5 (`InputDocumento`); Task 15 (`FotografiaDocumento` da `src/domain/fatturazione/tipi.ts`).
- Produces:
```ts
export interface FiltriElaborazione { clienteIds?: string[]; contrattoIds?: string[]; categoriaIds?: string[]; tipiAddebito?: string[]; registroIvaIds?: string[] }   // stessi nomi del Task 14 (scansione P40)
export interface ParametriElaborazione { periodoDal: string; periodoAl: string; dataDocumento: string; raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'; includiArretrati: boolean; filtri: FiltriElaborazione }
export interface DocumentoSelezionato { chiave: string; contrattoId: string; contrattoNumero: string; elencoId: string | null; clienteId: string; clienteFatturazioneId: string; denominazione: string; registroIvaId: string | null; periodo: { dal: string; al: string }; input: InputDocumento; fotografia: FotografiaDocumento }
// registroIvaId null: il Task 18 non ne fa una bozza, lo mette in documentiNonGenerati (Q3)
export interface SelezioneElaborazione { documenti: DocumentoSelezionato[]; erroriGenerali: Segnalazione<ErroreGenerale>[]; erroriPeriodo: { motivo: string; quanti: number; contrattoId: string | null }[]; versioni: Parameters<typeof improntaElaborazione>[0] }
export async function selezionaElaborazione(tx: Prisma.TransactionClient, tenantId: string, p: ParametriElaborazione): Promise<SelezioneElaborazione>   // sola lettura, nessun lock
// lock-fatturazione.ts
export interface InsiemiDaBloccare { contrattoIds: string[]; elencoIds: string[]; rigaIds: string[]; legameIds: string[] }
export async function insiemiPerDefinitiva(tx: Prisma.TransactionClient, tenantId: string, documentoIds: readonly string[]): Promise<InsiemiDaBloccare>   // lettura senza lock (Q20)
export async function bloccaElaborazione(tx: Prisma.TransactionClient, tenantId: string, elaborazioneId: string): Promise<{ stato: StatoElaborazione; versione: number }>
export async function bloccaPerDefinitiva(tx: Prisma.TransactionClient, tenantId: string, s: InsiemiDaBloccare): Promise<void>   // contratti SHARE → elenchi SHARE → righe SHARE → legami e righe FOR UPDATE; ripristina enable_nestloop prima di tornare (scansione P46)
// codici.ts
export const ERRORI_GENERALI_BLOCCANTI: readonly ErroreGenerale[]   // ['CEDENTE_INCOMPLETO', 'DATA_ANTERIORE_ULTIMA_FATTURA', 'DATA_FUTURA'] (decisione 24)
// impronta.ts (Q4): firma estesa, le voci nuove con tipo proprio nel prefisso
export type Voce = { id: string; versione: number }   // oggi interno a impronta.ts: si esporta
export function improntaElaborazione(i: { parametri: unknown; legami: readonly Voce[]; contratti: readonly Voce[]; elenchi: readonly Voce[]; righeAddebito: readonly Voce[]; codiciIva: readonly Voce[]; clienti: readonly Voce[]; condizioniPagamento: readonly Voce[]; speseAccessorie: readonly Voce[]; contiCorrenti: readonly Voce[]; cedente: Voce | null; marcatori: readonly { rigaAddebitoId: string; tipo: TipoMarcatore; chiaveCompetenza: string }[] }): string
```
**Impronta (Q4, estende §5.3 per lo scopo di S2; da annotare nel ledger).** Oltre alle cinque voci
della 4.4a entrano le versioni dei clienti di fatturazione, delle condizioni di pagamento, delle
spese accessorie, dei conti correnti del cedente usati e del cedente, e i marcatori letti per le
righe del listino dei documenti (voce `{ id: 'marcatore:<rigaAddebitoId>:<tipo>:<chiave>',
versione: 0 }`). Così un canone fatturato da un'altra elaborazione, o un dato letto dal calcolo che
cambia importi o errori, fa `ANTEPRIMA_SUPERATA` al passo 5 della definitiva, mai un errore interno
al passo 6. I dati del tenant (ragione sociale, sede) restano fuori: entrano solo nella fotografia,
che la definitiva riscrive sotto lock, e non cambiano gli importi.

**Lock della definitiva (Q20).** `insiemiPerDefinitiva` legge, senza lock, contratti principali e
allegati dei documenti candidati, i loro elenchi validi nel periodo, le righe di listino attive di
quegli elenchi e i legami delle righe delle bozze. `bloccaPerDefinitiva` blocca ciascun insieme
intero con una query (`JOIN unnest`, in ordine di id); non sostituisce `bloccaListinoInCondivisione`
(che lavora su un contratto e lancia 404/409) e non lancia mai 404 o 409: blocca le righe che
trova. Un id sparito o un contratto cambiato lo rileva l'impronta al passo 5 (`ANTEPRIMA_SUPERATA`,
voce `cambiati`).

Costruzione dell'ingresso del calcolo: `InputDocumento.listino` = **tutte** le righe attive (elenchi
validi nel periodo) degli elenchi del documento, principale e allegati, non solo quelle citate dai
legami (scansione P12); `righeQuantita` = le righe `TT` e `TF` fra queste (decisione 17), con
`daAllegato` vero per quelle di un contratto allegato; `RigaLegameDaFatturare.quantitaMovimento`,
`unitaMovimento` ed `elencoId` dal movimento vigente e dal legame, letti con la stessa query dei
legami (sola lettura di `waste_movements`); `contoCedente` da `contoCorrenteEffettivo`,
`bancaCliente` dalla banca del cliente di fatturazione (scansione P15); `numeroRiga` passato
sempre (seguito 4.4a).

Regole (spec §5.2): stati del contratto come D8 della 4.1; periodo effettivo da `periodoDaFatturare`;
allegati nel documento del principale con i valori del principale (Review Focus 4). **Con
`PER_ELENCO` (Q6):** le righe `TT`/`TF` di un allegato entrano in ciascun documento del principale,
calcolate sui movimenti di quel documento; le righe `F` e `M…` di un allegato entrano **solo** nel
documento del primo elenco del principale (ordine del codice dell'elenco), così un canone e un
minimo dell'allegato si fatturano una volta. Legami `CONFERMATO`, `fatturato_il IS NULL`,
`movimento_vigente_id` = testa; `IMPORTATO_FATTURATO` mai; arretrati solo con `includiArretrati`,
altrimenti contati in `ARRETRATI_PRESENTI`; errori del periodo dal frammento `sqlCandidati`, senza
duplicarlo; registro: contratto → cliente → predefinito del cedente, disattivato o assente =
`SENZA_REGISTRO_IVA` con `registroIvaId` null. Letture: una query per insieme (contratti, legami e
righe, listino, codici IVA, marcatori, clienti) con `= ANY($ids)`; nessuna query per documento.
`CEDENTE_INCOMPLETO`, `DATA_ANTERIORE_ULTIMA_FATTURA` (contro `ultima_data` letta senza lock) e
`LEGAMI_SENZA_CONTRATTO` negli errori generali; i primi due (con `DATA_FUTURA`) sono
`ERRORI_GENERALI_BLOCCANTI` (decisione 24), `LEGAMI_SENZA_CONTRATTO` no: quei movimenti restano
fuori dai documenti.

**Filtri (decisione 25).** `clienteIds`, `contrattoIds` e `registroIvaIds` filtrano i contratti
principali. `categoriaIds` e `tipiAddebito` scelgono anch'essi **contratti**: entra un contratto
principale che ha almeno una riga di listino attiva, negli elenchi validi nel periodo suoi o dei suoi
allegati, con `categoria_id` fra quelle scelte o con `tipo` fra quelli scelti. Il documento resta
sempre intero (tutte le righe, tutti i legami, minimi, fasce, bollo). Filtri diversi si combinano in
AND, i valori di uno stesso filtro in OR. `tipiAddebito` accetta i tipi riga del listino (`CER`,
`V`, `F`, `TT`, …).

- [ ] **Step 1: test (Postgres).** `contratto ATTIVO con 3 legami CONFERMATO nel periodo: un documento con 3 righe`; `legame già fatturato, ESCLUSO o IMPORTATO_FATTURATO: non selezionato`; `legame DA_RIALLINEARE (vigente ≠ testa): negli errori del periodo, non nel documento`; `legame PROPOSTO con contratto: avviso sul documento; senza contratto: LEGAMI_SENZA_CONTRATTO negli errori generali, il movimento in nessun documento`; `SOSPESO: documento con CONTRATTO_SOSPESO`; `BOZZA e ANNULLATO: nessun documento`; `contratto con periodi mensili e intervallo 01/10-15/10: nessun documento (nessuna fine nell'intervallo)`; `intervallo 01/10-31/10: periodo effettivo del contratto`; `PER_ELENCO: un documento per elenco`; **`PER_ELENCO, principale con due elenchi (codici A e B), allegato con una F a 50.00 e un MW a 100.00: la riga F e il minimo dell'allegato solo nel documento dell'elenco A; i due documenti hanno marcatori distinti`** (Q6); **`allegato con registro, condizione ed esigibilità diversi dal principale e con una riga TT in KG a 0.02 al 22%, principale con 3 legami CER al 22% da 500, 700 e 300 KG a 0.10: un documento coi valori del principale (registro, condizione, esigibilità), tre righe MOVIMENTO (50.00, 70.00, 30.00) e una QUANTITA_MOVIMENTI di 1500 KG da 30.00, un solo riepilogo al 22% con imponibile 180.00 e imposta 39.60, nessun errore`** (Review Focus 4, decisione 17); **`stesso scenario con la riga dell'allegato TS invece di TT: FAMIGLIA_NON_CALCOLATA con dettaglio «TS riga 1»`**; `listino con una riga NM dell'elenco principale mai citata dai legami: FAMIGLIA_NON_CALCOLATA` (scansione P12); `arretrati spenti: ARRETRATI_PRESENTI con il conteggio; accesi: legami precedenti inclusi fino a «fatturazione da»`; `registro IVA disattivato: SENZA_REGISTRO_IVA e registroIvaId null`; `contratto senza registro e cedente senza predefinito: registroIvaId null, SENZA_REGISTRO_IVA`; `cedente senza indirizzo: CEDENTE_INCOMPLETO`; `data documento prima di ultima_data: DATA_ANTERIORE_ULTIMA_FATTURA`; `ERRORI_GENERALI_BLOCCANTI contiene CEDENTE_INCOMPLETO, DATA_ANTERIORE_ULTIMA_FATTURA e DATA_FUTURA, non LEGAMI_SENZA_CONTRATTO`; `filtri per cliente, contratto e registro`; *filtri per categoria e tipo (decisione 25):* **`categoriaIds [cat. 001]: entra il contratto con una riga V di categoria 001, con TUTTE le sue righe (anche la F e le righe CER di altre categorie) e tutti i legami; il contratto senza righe della categoria 001 resta fuori`**; **`tipiAddebito ['F']: entra il contratto con una F attiva, il documento contiene anche le righe MOVIMENTO e i minimi; un contratto con sole righe CER resta fuori`**; `riga della categoria solo in un allegato: il principale entra`; `riga della categoria disattivata o in un elenco non valido nel periodo: il contratto resta fuori`; `categoriaIds e tipiAddebito insieme: AND (serve una riga di ciascuno, anche diverse)`; `cliente di fatturazione diverso dal cliente del contratto: cessionario = cliente di fatturazione`; *impronta (Q4):* `improntaElaborazione: un marcatore in più → impronta diversa; versione di cliente, condizione di pagamento, spesa accessoria, conto corrente o cedente cambiata → diversa; ordine dei marcatori diverso → uguale`; `selezione dopo un marcatore scritto su un canone del documento: versioni.marcatori lo contiene`; *domini (seguiti 4.4a):* `numeroRiga obbligatorio (tsc)`; `minimi usa FORMA_MINIMO_CATEGORIA esportata`; `F senza prezzo e senza scadenze nel periodo: nessun errore; con una scadenza nel periodo: RIGA_LEGAME_INCOMPLETA` (decisione 21); `messaggio di RIGA_LEGAME_INCOMPLETA uguale al testo del seguito`; **volume:** `10.000 legami su 500 contratti: selezione sotto 5 s, numero di query costante (contato), piano generico forzato sotto 5 s`; `insiemiPerDefinitiva su 500 documenti: una query per insieme`; `bloccaPerDefinitiva: un FOR UPDATE del listino tiene in attesa la selezione bloccante (barriera) e nessun deadlock con 20 coppie parallele listino/definitiva`; `bloccaPerDefinitiva con un id di contratto cancellato: nessun errore, le altre righe bloccate`; `dopo bloccaPerDefinitiva current_setting('enable_nestloop') è il valore di prima`; *fixture:* `creaDocumentoDiTest con legamiIds: riga_legame_id NULL, movimento_fatturato_id valorizzato`; *guardia (Q35):* `nessun file di src/application/fatturazione/**, src/api/fatturazione/**, src/infrastructure/queue/jobs/fatturazione.job.ts e src/infrastructure/jobs/fatturazione-manutenzione.job.ts scrive su waste_movements né prende pg_advisory_xact_lock o impostazioni_fatturazione FOR UPDATE` (i due job si controllano quando esistono: la guardia elenca i percorsi e salta quelli assenti).
- [ ] **Step 2-4:** FAIL → implementa → PASS (sotto `flock`; fixture di volume a blocchi e pulizia per id). Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): selezione dell'elaborazione, lock e guardia sul registro`.

## Task 17b: lista, dettaglio e mappatura dei documenti (Postgres)

Scansione P38: nessun task scriveva il servizio che legge i documenti e li mappa nei tipi del Task
14. Lo usano 18 (documenti dell'elaborazione, esclusione), 20 (risposte di annullo e storno), 23
(«Segna come emesso»), 25a (`GET /documenti-fattura`, `GET /:id`) e 28 (PDF). Raccoglie anche i
seguiti «uso» della 4.4a (Q18) e il messaggio «in uso» dei documenti (Q37).

**Files:**
- Create: `src/application/fatturazione/documenti-fattura.service.ts` (+ `.spec.ts`, `.postgres.spec.ts`)
- Modify: `src/api/fatturazione/fatturazione.module.ts` (provider); `src/application/listino/uso-listino.ts` (+ `uso-listino.spec.ts`); `src/application/clienti/uso-tabelle-fatturazione.ts`; `src/application/fatturazione/numerazioni.service.ts`; test in `colonne-fatturazione.postgres.spec.ts` e `numerazioni.service.postgres.spec.ts`

**Interfaces:**
- Consumes: Task 6 (tabelle, `creaDocumentoDiTest`), Task 8 (`numeroTesto`), Task 14 (`DocumentoRiga`, `DocumentoDettaglio`, `Pagina`, `MotivoNonAnnullabile`, nomi vincolanti), Task 15 (`FotografiaSalvata`).
- Produces:
```ts
export type MotivoNonAnnullabile = 'NON_DEFINITIVO' | 'NOTA_DI_CREDITO' | 'STORNATO' | 'EMESSO' | 'NON_ULTIMO'   // Q9, nell'ordine di controllo
export function annullabilita(d: { stato: StatoDocumento; tipoDocumento: string; emessoIl: Date | null; numero: number | null; ultimoNumero: number; haStorno: boolean }): { annullabile: boolean; motivo: MotivoNonAnnullabile | null }
// pura; haStorno = esiste un TD04 con documento_origine_id = id e stato ≠ ANNULLATO. Ordine: NON_DEFINITIVO, NOTA_DI_CREDITO, STORNATO, EMESSO, NON_ULTIMO (il primo che vale)
export interface FiltriDocumenti { registroIvaId?: string; anno?: number; stato?: StatoDocumento; clienteId?: string; dataDa?: string; dataA?: string; elaborazioneId?: string; conErrori?: boolean }
export class DocumentiFatturaService {
  lista(tenantId: string, q: FiltriDocumenti & { pagina: number; dimensione: number }): Promise<Pagina<DocumentoRiga>>   // dimensione ≤ 100
  dettaglio(tenantId: string, id: string): Promise<DocumentoDettaglio>   // 404 se non c'è (o di un altro tenant)
  dettaglioInTx(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<DocumentoDettaglio>
  righeInTx(tx: Prisma.TransactionClient, tenantId: string, ids: readonly string[]): Promise<DocumentoRiga[]>
}
// uso-listino.ts: ColonneReferentiListino.documenti: readonly string[]  (['elencoId'] in COLONNE_ELENCO, [] altrove; M4)
```
`annullabile` e `motivoNonAnnullabile` (il codice; l'etichetta è del vocabolario del Task 14) da
`annullabilita` con `ultimo_numero` e `haStorno` letti senza lock; `stornabile` = `DEFINITIVO`, non
`TD04` e senza storno non annullato. `errori` e `avvisi` con `dettaglio` da
`fotografia.segnalazioni` (Q16), messaggio da `MESSAGGI_ERRORE`/`MESSAGGI_AVVISO`. Letture per
pagina con `= ANY(ids)`: una query per insieme (testate, clienti, contratti, registri, storni), mai
una per documento.

**Seguiti «uso» (Q18) e messaggio (Q37).** Sorgente `documenti_fattura.elenco_id` in
`COLONNE_ELENCO` (M4); filtro esplicito delle numerazioni scritte (`ultimo_numero > numero_partenza`
o `data_partenza` non nulla) come terzo elemento della tupla `sorgenti` in
`uso-tabelle-fatturazione.ts`; `impostaPartenza` tratta una riga di `numerazioni_fattura` vuota
(`ultimo_numero = numero_partenza = 0`, `data_partenza` nulla, nessun documento) come assente (M3).
Quando l'«in uso» viene da documenti di fatturazione, il messaggio di righe di listino, elenchi,
codici IVA, registri IVA, clienti e contratti dice «È usato da documenti di fatturazione, anche da
anteprime aperte: scarta le anteprime per liberarlo» (Q37, modificato: nessuna query in più per
distinguere le bozze dai definitivi).

- [ ] **Step 1: test (unit + Postgres).** `annullabilita: DEFINITIVO ultimo non emesso senza storno → annullabile; numero intermedio → NON_ULTIMO; emesso → EMESSO; BOZZA o ANNULLATO → NON_DEFINITIVO; TD04 ultimo non emesso → NOTA_DI_CREDITO; haStorno vero su un ultimo non emesso → STORNATO; emesso e stornato → STORNATO (ordine)`; `lista per registro, anno, stato, cliente, date ed elaborazione`; `numeroTesto «15/A» col suffisso`; `dettaglio con righe, riepiloghi e rate nell'ordine di numero_linea e ordine`; **`bozza con FAMIGLIA_NON_CALCOLATA salvata con fotografia.segnalazioni: dettaglio «TS riga 1» nella risposta`** (Q16); `documento stornato: stornabile false, stornoId valorizzato, motivoNonAnnullabile STORNATO`; `numero di query costante con 1 e con 100 documenti (contato)`; `RLS: documento di un altro tenant → 404`; `forma del mapper: le chiavi di DocumentoRiga, DocumentoDettaglio e RigaDocumentoVista sono esattamente quelle scritte nel test (nessun id interno, nessun tenantId)` (Q21: il confronto col modello del frontend lo fa il 26a); *uso (Q18):* `elenco citato da un documento: delete 409 col codice «in uso» dell'elenco` (`colonne-fatturazione.postgres.spec.ts`); `registro con una riga di numerazione vuota: eliminabile; con ultimo_numero > partenza: non eliminabile`; `impostaPartenza su una riga vuota creata da una riserva annullata: 200 come senza riga` (`numerazioni.service.postgres.spec.ts`); `messaggio «in uso» da documenti con il testo di Q37`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): lista e dettaglio dei documenti, seguiti «in uso»`.

## Task 18: elaborazione, coda e job di anteprima (Postgres pesante: concorrenza)

**Files:**
- Create: `src/application/fatturazione/elaborazioni.service.ts`, `anteprima.ts` (+ spec, `.postgres.spec.ts`), `src/infrastructure/queue/jobs/fatturazione.job.ts` (+ spec, `.contesto.spec.ts`)
- Modify: `src/api/fatturazione/fatturazione.module.ts` (coda `fatturazione`, processor, servizi); `src/application/fatturazione/numerazione.ts` (+ `numerazioni.service.postgres.spec.ts` o spec propria: `suffissiDelleSerie`, Q8)

**Interfaces:**
- Consumes: Task 5, 7, 17, 17b (`DocumentiFatturaService` per `documenti` ed `escludi`).
- Produces:
```ts
export const CODA_FATTURAZIONE = 'fatturazione'
export interface JobFatturazione { tenantId: string; elaborazioneId: string; tipo: 'anteprima' | 'definitiva'; versione: number; rinvii?: number }
export function idJobFatturazione(j: { tipo: 'anteprima' | 'definitiva'; elaborazioneId: string; versione: number }): string   // `${tipo}-${elaborazioneId}-v${versione}` (Q5; BullMQ vieta ':' negli id)
export interface RiepilogoElaborazione { documenti: number; totale: string; errori: number; avvisi: number; erroriPeriodo: SelezioneElaborazione['erroriPeriodo']; numerazionePrevista: { registroIvaId: string; codiceRegistro: string; da: string; a: string }[]; totaliPerRegistro: { registroIvaId: string; imponibile: string; iva: string; totale: string }[]; documentiNonGenerati: { contrattoId: string; contrattoNumero: string; clienteId: string; denominazione: string; errori: Segnalazione<ErroreDocumento>[] }[]; prontaIl: string }
// forma di elaborazioni_fatturazione.riepilogo (Q17, Q11), nomi del Task 14 (spec §17.9); dettaglio() mappa Segnalazione in SegnalazioneVista col messaggio
export class ElaborazioniService {
  avvia(tenantId: string, utenteId: string, p: ParametriElaborazione): Promise<{ id: string }>   // 202; 400 DATA_FUTURA, PERIODO_NON_VALIDO, CEDENTE_INCOMPLETO; 409 ELABORAZIONE_IN_CORSO
  lista(tenantId: string, q: { pagina: number; dimensione: number; stato?: StatoElaborazione }): Promise<Pagina<ElaborazioneRiga>>
  dettaglio(tenantId: string, id: string): Promise<ElaborazioneDettaglio>
  documenti(tenantId: string, id: string, q: { pagina: number; dimensione: number; conErrori?: boolean }): Promise<Pagina<DocumentoRiga>>
  ricalcola(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>   // 409 ELABORAZIONE_IN_CORSO se il tenant ha un'altra elaborazione attiva
  scarta(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>
  escludi(tenantId: string, id: string, documentoId: string, escluso: boolean): Promise<DocumentoRiga>   // elaborazione FOR UPDATE, vuole ANTEPRIMA_PRONTA (scansione P41)
  chiediDefinitiva(tenantId: string, utenteId: string, id: string, b: { impronta: string; versione: number }): Promise<void>   // qui lancia «non implementato» (Q44); la scrive il Task 19
}
export async function eseguiAnteprima(prisma: PrismaService, tenantId: string, elaborazioneId: string): Promise<void>
// numerazione.ts (Q8)
export async function suffissiDelleSerie(tx: Prisma.TransactionClient, tenantId: string, coppie: readonly CoppiaNumerazione[]): Promise<Map<string, string | null>>   // chiave chiaveNumerazione; sola lettura
```
**Suffisso delle serie (decisione 20, Q8).** `suffissiDelleSerie`: per ogni coppia (registro, anno)
con almeno un `DEFINITIVO`, il suffisso del definitivo col numero più alto della coppia, ricavato da
`numero_testo` togliendo il prefisso `numero::text`; per le altre il `suffisso_numero` attuale del
registro. `riservaNumeri` la usa al posto della lettura di `registri_iva.suffisso_numero`
(`numerazione.ts:204-208`), quindi definitiva (19) e storno (20) la ereditano; la numerazione
prevista dell'anteprima la usa uguale. Il test della 4.4a
`numerazioni.service.postgres.spec.ts:220` resta valido (nessun definitivo: suffisso del registro).

Controlli dell'avvio (§5.1): `periodoDal ≤ periodoAl`, stesso anno solare; `dataDocumento ≥ periodoAl`
e non futura **sul giorno italiano** (`Europe/Rome`, Review Focus 3); cedente completo; **nessuna
elaborazione `IN_CODA`, `IN_CORSO` o `IN_DEFINITIVA` del tenant** (lettura semplice → 409
`ELABORAZIONE_IN_CORSO`, Q12). L'indice unico parziale copre solo `IN_CORSO` e `IN_DEFINITIVA`: un
23505 al passaggio a `IN_CORSO` nel job (due avvii nella stessa finestra) rimette il job in attesa
con `job.moveToDelayed(ora + 30 s)` e `DelayedError`, al più 10 volte (`rinvii` in `job.data`),
poi `FALLITA` con `errore_tecnico` «Un'altra elaborazione era in corso». `ricalcola` risponde 409
`ELABORAZIONE_IN_CORSO` in modo sincrono se il tenant ha un'altra elaborazione `IN_CODA`,
`IN_CORSO` o `IN_DEFINITIVA`.

**Job.** `jobId = idJobFatturazione(...)` con la versione dopo l'incremento, salvato in
`elaborazioni_fatturazione.job_id` (Q5: con un id fisso BullMQ ignorerebbe il secondo `add`, e i
falliti restano 7 giorni). `TenantContext.run({ tenantId })`; senza `tenantId` `UnrecoverableError`
senza toccare il database; `attempts: 2` per `anteprima`; `REPEATABLE READ` per la selezione; poi
una transazione che cancella le bozze dell'elaborazione e inserisce documenti, righe, riepiloghi e
rate con `createMany`, scrive `impronta`, `riepilogo` e `esito = NULL` e passa a
`ANTEPRIMA_PRONTA`. Ogni riga scrive **`riga_legame_id = NULL`** anche se
`RigaDocumentoCalcolata.rigaLegameId` è valorizzato (I1, Q1, Q2). Un documento con
`registroIvaId = null` non diventa bozza: va in `riepilogo.documentiNonGenerati` con le sue
segnalazioni e conta negli `errori` dell'elaborazione (Q3). `fotografia` delle bozze =
`FotografiaSalvata` con `segnalazioni` complete di `dettaglio` (Q16). `riepilogo` =
`RiepilogoElaborazione`, scritto nella transazione delle bozze; `prontaIl` = istante del passaggio
a `ANTEPRIMA_PRONTA` (serve alle differenze del Task 19, Q11). Errore: `FALLITA`, `errore_tecnico`
(≤ 200, senza dati personali), `segnalaErroreJob`. `dettaglio` legge `esito` come `errore`
(scansione P5), `errore_tecnico` come `erroreTecnico` (Q17), il `riepilogo` nei campi omonimi e
`impostazioni_fatturazione.definitive_attive` (lettura semplice, nessun lock; assente = `false`)
come `definitiveAttive` (scansione P34). `ricalcola` e ogni nuovo passaggio a `ANTEPRIMA_PRONTA`
azzerano `esito` (Q17). `escludi`/`riammetti` prendono l'elaborazione `FOR UPDATE` (primo anello
dell'ordine dei lock) e rispondono 409 `ELABORAZIONE_GIA_IN_DEFINITIVA` se non è
`ANTEPRIMA_PRONTA`: così non corrono con la definitiva (scansione P41).

- [ ] **Step 1: test (unit + Postgres, `application_name` = `fatt-t18-${pid}`).** `avvio valido: 202, IN_CODA, job accodato con tenantId, elaborazioneId e jobId "anteprima-<id>-v1" salvato in job_id`; `periodo a cavallo d'anno: 400`; `dataDocumento < periodoAl: 400`; **`dataDocumento = oggi alle 00:30 ora italiana (23:30 UTC di ieri): accettata; domani: 400 DATA_FUTURA`** (orologio finto); `seconda elaborazione mentre una è IN_CODA, IN_CORSO o IN_DEFINITIVA: 409 ELABORAZIONE_IN_CORSO` (Q12); **`due avvii in parallelo (barriera su pg_stat_activity): uno solo arriva a ANTEPRIMA_PRONTA alla volta, l'altro 409 o rinviato e poi pronto; nessun 500`** (Q12); `job con 23505 al passaggio a IN_CORSO: rinviato di 30 s; all'undicesimo FALLITA con errore_tecnico «Un'altra elaborazione era in corso»`; `cedente incompleto: 400 con CEDENTE_INCOMPLETO`; `anteprima: bozze con righe, riepiloghi, rate, errori, avvisi; impronta di 64 caratteri; legami invariati (stato, versione, fatturato_il)`; **`ogni riga delle bozze ha riga_legame_id NULL e legame_id valorizzato`** (I1); **`legame in un'anteprima aperta: conferma della 4.3 con cambio di elenco riuscita (nessun 23503), l'impronta dell'anteprima risulta superata`** (I1, Q2); **`contratto senza registro e senza predefinito: nessuna bozza, una voce in documentiNonGenerati con SENZA_REGISTRO_IVA, contata negli errori; nessun 500`** (Q3); `riepilogo con le chiavi di RiepilogoElaborazione e prontaIl` (Q17); `bozza con FAMIGLIA_NON_CALCOLATA: fotografia.segnalazioni.errori con dettaglio «TS riga 1»` (Q16); `numerazione prevista «da 15/A a 42/A» senza toccare numerazioni_fattura`; **`suffisso cambiato da /A a /B a gennaio, documento datato dicembre su una coppia con definitivi: numerazione prevista e riservaNumeri con /A; serie nuova (coppia senza definitivi) con /B`** (decisione 20, Q8); `suffissiDelleSerie: coppia senza definitivi → suffisso del registro; numero_testo "15/A" → "/A"; senza suffisso → null`; `ricalcola: le bozze precedenti spariscono, nessun duplicato`; **`ricalcola dopo un'anteprima completata: nuovo job "anteprima-<id>-v2" eseguito`** (Q5); **`dopo ANTEPRIMA_SUPERATA (esito scritto col proprietario) e ricalcola: errore null`** (Q17); **`primo tentativo fallito dopo il passaggio a IN_CORSO già confermato: il secondo tentativo accetta il proprio IN_CORSO e arriva a ANTEPRIMA_PRONTA`** (Q30); `scarta: SCARTATA, bozze cancellate`; `escludi e riammetti: escluso_da_definitiva; su un DEFINITIVO 409`; **`escludi durante IN_DEFINITIVA: 409 ELABORAZIONE_GIA_IN_DEFINITIVA, documento invariato`**; `ricalcola o scarta su IN_DEFINITIVA: 409`; `ricalcola con un'altra elaborazione attiva del tenant: 409 ELABORAZIONE_IN_CORSO sincrono`; `dettaglio: definitiveAttive false di default, true dopo l'accensione col proprietario; errore null senza esito, { codice: 'ANTEPRIMA_SUPERATA', differenze } con esito scritto; erroreTecnico di una FALLITA`; `chiediDefinitiva: «non implementato»` (Q44, il Task 19 cambia il test); *contesto:* `job senza tenantId: UnrecoverableError, nessuna query`; `job con il tenant di un'altra azienda: non vede l'elaborazione (RLS), FALLITA non scritta su un altro tenant`; `lista e documenti: dimensione 101 rifiutata dal DTO (Task 25a), qui il servizio accetta fino a 100`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (sotto `flock`). Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): elaborazione, coda e job di anteprima`.

## Task 19: definitiva in una transazione (Postgres pesante: concorrenza e volume)

**Files:**
- Create: `src/application/fatturazione/definitiva.ts` (+ `.postgres.spec.ts`)
- Modify: `fatturazione.job.ts` (ramo `definitiva`, `attempts: 1`), `elaborazioni.service.ts` (`chiediDefinitiva`)

**Interfaces:**
- Consumes: Task 5, 8 (`riservaNumeri`, che usa `suffissiDelleSerie` del 18), 17 (`bloccaElaborazione`, `insiemiPerDefinitiva`, `bloccaPerDefinitiva`, `selezionaElaborazione`, `ERRORI_GENERALI_BLOCCANTI`), 18 (`idJobFatturazione`, `RiepilogoElaborazione`).
- Produces:
```ts
export const OPZIONI_TRANSAZIONE_DEFINITIVA = { timeout: 120_000, maxWait: 10_000 } as const
export type EsitoDefinitiva =
  | { esito: 'DEFINITIVA'; documenti: number; numeri: NumeriRiservati[] }
  | { esito: 'ANTEPRIMA_SUPERATA'; differenze: { nuovi: number; cambiati: number; fatturatiDaAltri: number } }
  | { esito: 'DATA_ANTERIORE_ULTIMA_FATTURA'; ultimaData: string }   // Q15
  | { esito: 'CEDENTE_INCOMPLETO' }                                   // decisione 24, emerso sotto lock
  | { esito: 'DOPPIA_FATTURAZIONE' | 'DEFINITIVE_NON_ATTIVE' }
// gli esiti diversi da DEFINITIVA finiscono nella colonna esito come { codice, differenze?, ultimaData? } (= ElaborazioneDettaglio.errore)
export async function eseguiDefinitiva(prisma: PrismaService, tenantId: string, elaborazioneId: string, utenteId: string): Promise<EsitoDefinitiva>
```
`chiediDefinitiva` (rotta `POST /:id/definitiva`), **transazione breve e sincrona** (scansione P36:
i codici HTTP non possono venire da un job):
```text
impostaTimeoutLock; OPZIONI_TRANSAZIONE_SCRITTURA
a. bloccaElaborazione FOR UPDATE; stato IN_DEFINITIVA o DEFINITIVA → 409 ELABORAZIONE_GIA_IN_DEFINITIVA (prima della versione: è il codice del secondo clic, §5.4 passo 1);
   altro stato ≠ ANTEPRIMA_PRONTA → 409 ELABORAZIONE_IN_CORSO; versione ≠ → 409 VERSIONE_SUPERATA; impronta ≠ salvata → 409 ANTEPRIMA_SUPERATA
b. definitive_attive falsa (lettura semplice, nessun lock) → 409 DEFINITIVE_NON_ATTIVE (scansione P33)
c. errori_generali salvati ∩ ERRORI_GENERALI_BLOCCANTI non vuoto → 409 col codice del primo (CEDENTE_INCOMPLETO, poi DATA_ANTERIORE_ULTIMA_FATTURA, poi DATA_FUTURA), message dal vocabolario
   (decisione 24); LEGAMI_SENZA_CONTRATTO non blocca;
   poi ultima_data delle coppie dei candidati letta senza lock: dataDocumento < ultima_data → 409 DATA_ANTERIORE_ULTIMA_FATTURA { details: { ultimaData } } (Q15)
d. candidati = bozze non escluse e senza errori; 0 → 409 NESSUN_DOCUMENTO_DEFINIBILE; > 500 → 400 TROPPI_DOCUMENTI
e. IN_DEFINITIVA, versione + 1 (23505 dell'indice unico del §4.2 → 409 ELABORAZIONE_IN_CORSO), job_id = idJobFatturazione({ tipo: 'definitiva', elaborazioneId, versione }),
   commit, poi job accodato con quel jobId → 202 (Q5: un rilancio dopo un fallimento ha una versione nuova e quindi un id nuovo; il doppio clic lo ferma il FOR UPDATE di a)
```
Job `definitiva`, **una** transazione (spec §5.4):
```text
lock_timeout 5s; statement_timeout 60s
1. bloccaElaborazione: deve essere IN_DEFINITIVA con la versione e il job_id scritti in e (altrimenti esce senza scrivere); ricontrolla definitive_attive (spenta → esito DEFINITIVE_NON_ATTIVE)
2. candidati come in d (non cambiano: escludi vuole ANTEPRIMA_PRONTA)
3. riservaNumeri per (registro, anno di dataDocumento)          // numerazioni FOR UPDATE prima dei contratti; 409 DATA_ANTERIORE_ULTIMA_FATTURA → rollback, esito DATA_ANTERIORE_ULTIMA_FATTURA con ultimaData dai details (Q15)
4. insiemiPerDefinitiva (lettura) → bloccaPerDefinitiva sugli insiemi interi (Q20; ripristina enable_nestloop, scansione P46)
5. selezionaElaborazione sotto lock; erroriGenerali con CEDENTE_INCOMPLETO → rollback, esito CEDENTE_INCOMPLETO;
   improntaElaborazione ≠ impronta → rollback; seconda transazione breve: ANTEPRIMA_PRONTA + esito ANTEPRIMA_SUPERATA con differenze (Q11, sotto)
6. calcolaDocumento per ogni candidato; importi ≠ bozza → rollback, errore interno, segnalaErroreJob (con l'impronta estesa di Q4 resta solo per un difetto vero)
7. ordine: registro, ragione sociale del cliente di fatturazione, id del cliente, numero del contratto, codice dell'elenco; numeri da..a in quell'ordine
8. PRIMA UPDATE righe FROM unnest (solo movimento_fatturato_id; riga_legame_id resta NULL, Q1), con le testate ancora in BOZZA;
   POI UPDATE documenti FROM unnest (stato DEFINITIVO, numero, numero_testo, fotografia con segnalazioni { errori: [], avvisi } (Q16), definito_*)    // ordine imposto dal trigger delle figlie (scansione P2)
   UPDATE legami FROM unnest (FATTURATO, fatturato_il, documento_id, riferimento_fattura «<numero_testo> del gg/mm/aaaa», versione+1);
   INSERT marcatori con riga_documento_id e marcatore presi dal ricalcolo del passo 6, abbinati alle righe salvate per numero_linea (Q43) (23505 → esito DOPPIA_FATTURAZIONE, rollback totale)
9. elaborazione DEFINITIVA, definita_*; audit: una riga per documento (id, numero, totale) e una per l'elaborazione
```
Ogni uscita senza commit (esito o errore) riporta l'elaborazione a `ANTEPRIMA_PRONTA` con una seconda
transazione breve che scrive `esito` (o `errore_tecnico` e `segnalaErroreJob`), come il §4.11.

**Differenze di `ANTEPRIMA_SUPERATA` (Q11)**, contate sui legami: `nuovi` = legami della nuova
selezione assenti dalle righe delle bozze; `fatturatiDaAltri` = legami delle bozze non più
`CONFERMATO` o con `fatturato_il`; `cambiati` = legami presenti in entrambe con `updated_at` >
`riepilogo.prontaIl`, più i documenti il cui ricalcolo differisce per un'altra voce dell'impronta
(contratto, listino, IVA, marcatori, clienti, condizioni, spese, conti, cedente). Possono essere
tutti 0 se è cambiata solo una voce fuori dai documenti: la UI dice allora «dati del contratto o del
listino cambiati».

- [ ] **Step 1: test (Postgres, `application_name` = `fatt-t19-${pid}`).** `definitiva: numeri consecutivi per registro nell'ordine del passo 7, legami FATTURATO con documento_id e riferimento_fattura, marcatori scritti con riga_documento_id della riga giusta, elaborazione DEFINITIVA`; `documenti con errori o esclusi: restano BOZZA`; `righe dei documenti definiti con movimento_fatturato_id = movimento_vigente_id del legame e riga_legame_id NULL` (passo 8, scansione P2, Q1); `fotografia del definitivo: segnalazioni.errori vuoto, avvisi conservati` (Q16); **`tutti esclusi o con errori: chiediDefinitiva risponde 409 NESSUN_DOCUMENTO_DEFINIBILE, numerazioni invariate, ANTEPRIMA_PRONTA, nessun job`** (Review Focus 2); `501 documenti: 400 TROPPI_DOCUMENTI dalla rotta`; **`definitive_attive falsa: 409 DEFINITIVE_NON_ATTIVE, numerazioni, legami e stato invariati, nessun job`** (decisione 13, scansione P33); `interruttore spento fra chiediDefinitiva e il job: esito DEFINITIVE_NON_ATTIVE, ANTEPRIMA_PRONTA, nessun numero`; *errori generali (decisione 24):* **`elaborazione con CEDENTE_INCOMPLETO negli errori generali: chiediDefinitiva 409 { error: 'CEDENTE_INCOMPLETO' }, nessun job, stato invariato`**; **`con DATA_ANTERIORE_ULTIMA_FATTURA negli errori generali: 409 { error: 'DATA_ANTERIORE_ULTIMA_FATTURA' }`**; **`con LEGAMI_SENZA_CONTRATTO: 202 e DEFINITIVA; il legame senza contratto resta CONFERMATO e fuori da ogni documento; il codice resta in erroriGenerali del dettaglio con severità avviso`**; `cedente reso incompleto fra chiediDefinitiva e il job: esito CEDENTE_INCOMPLETO, nessun numero`; *data (Q15):* **`storno con data più recente sullo stesso registro fatto fra l'anteprima e chiediDefinitiva: 409 DATA_ANTERIORE_ULTIMA_FATTURA sincrono con details.ultimaData`**; **`stesso storno fra chiediDefinitiva e il job: esito { codice: 'DATA_ANTERIORE_ULTIMA_FATTURA', ultimaData }, ANTEPRIMA_PRONTA, nessun numero`**; `impronta diversa (un legame confermato dopo l'anteprima): esito ANTEPRIMA_SUPERATA con nuovi 1, bozze intatte, nessun numero`; `legame delle bozze modificato dopo prontaIl: cambiati 1`; `solo una riga di listino cambiata: differenze tutte 0 o cambiati dei documenti toccati, mai errore interno`; **atomicità:** `guasto iniettato dopo riservaNumeri e prima del commit: nessun numero consumato, nessun legame FATTURATO, nessun marcatore, ANTEPRIMA_PRONTA`; **rilancio (Q5):** **`definitiva fallita (guasto iniettato), seconda chiediDefinitiva: job "definitiva-<id>-v<n+1>" eseguito, arriva a DEFINITIVA`**; **doppio clic:** `due chiediDefinitiva con la stessa versione: un 202 e un 409 ELABORAZIONE_GIA_IN_DEFINITIVA; un solo job accodato; due job lanciati a mano con lo stesso job_id: uno solo arriva a DEFINITIVA, l'altro esce senza scrivere`; `job con un job_id diverso da quello salvato: esce senza scrivere`; **concorrenza:** `8 definitive in parallelo su 8 tenant: nessuna attesa reciproca (sessioni in Lock = 0)`; `due elaborazioni pronte dello stesso tenant sugli stessi legami, definitive una dopo l'altra: la seconda ANTEPRIMA_SUPERATA con fatturatiDaAltri; su legami diversi dello stesso registro: numeri successivi, mai doppioni`; *con la 4.3:* `conferma concorrente di un legame della definitiva: 409 OPERAZIONE_CONCORRENTE dopo 5 s oppure FATTURATO dopo il commit`; `rettifica di un movimento nella definitiva: la rettifica riesce sempre; il legame finisce con scostamento oppure DA_RIALLINEARE`; `«Aggiorna prezzi» dopo il commit: salta i FATTURATO`; `modifica del listino durante la definitiva: aspetta il commit (barriera), poi l'anteprima aperta ha impronta superata`; `riga di listino aggiunta a un elenco di un allegato durante la definitiva: aspetta il commit (lock dell'elenco intero, Q20)`; `registrazione di un movimento nuovo durante la definitiva: non aspetta oltre 2 s`; **marcatori (Q4):** **`due elaborazioni aperte sullo stesso canone, la prima diventa definitiva: la definitiva della seconda dà ANTEPRIMA_SUPERATA, nessun numero, mai errore interno`**; **`marcatore scritto fra anteprima e definitiva: ANTEPRIMA_SUPERATA, nessun numero`**; **`due bozze che portano lo stesso marcatore, iniettate col proprietario nella stessa elaborazione: esito DOPPIA_FATTURAZIONE, rollback totale, ANTEPRIMA_PRONTA`**; **invariante:** dopo ogni prova `numeri dei DEFINITIVO = numero_partenza+1 .. ultimo_numero` per ogni coppia; **volume:** `10.000 legami e 500 documenti: definitiva entro 120 s, misure nel rapporto; piano generico sulle query unnest`; *RLS:* `job col tenant sbagliato non vede né scrive nulla`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (sotto `flock`). Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): definitiva atomica con numerazione, legami fatturati e marcatori`.

## Task 20: annullo e nota di credito di storno (Postgres pesante: concorrenza)

**Files:**
- Create: `src/application/fatturazione/annullo-storno.service.ts` (+ spec, `.postgres.spec.ts`); helper di test, se servono, in `src/test-support/fatturazione-annullo-di-test.ts` (Q36)

**Interfaces:**
- Consumes: Task 8 (`bloccaNumerazioni`, `riservaNumeri`, `rilasciaUltimo`), Task 6 (trigger), Task 17b (`annullabilita`, `DocumentiFatturaService.dettaglioInTx` per le risposte), Task 18 (`suffissiDelleSerie`, tramite `riservaNumeri`).
- Produces:
```ts
export type MotivoNonStornabile = 'NON_DEFINITIVO' | 'NOTA_DI_CREDITO'   // = Task 14 (Q33)
export class AnnulloStornoService {
  annulla(tenantId: string, utenteId: string, documentoId: string, b: { motivo: string; versione: number }): Promise<DocumentoDettaglio>   // 409 ANNULLO_NON_AMMESSO { details: { motivo: MotivoNonAnnullabile } }
  storna(tenantId: string, utenteId: string, documentoId: string, b: { motivo: string; dataDocumento: string; rifatturabile: boolean; versione: number }): Promise<DocumentoDettaglio>   // il TD04 creato; 409 STORNO_GIA_PRESENTE; 409 STORNO_NON_AMMESSO { details: { motivo: MotivoNonStornabile } }
}
export async function ripristinaLegamiDelDocumento(tx: Prisma.TransactionClient, tenantId: string, documentoId: string): Promise<number>   // §5.5 passo 7, UPDATE … FROM (SELECT DISTINCT legame_id, movimento_fatturato_id delle righe MOVIMENTO del documento)
```
**Annullo (§5.5, Q10).** Lettura semplice del documento per ricavare (registro, anno) →
`bloccaNumerazioni` → documento `FOR UPDATE` → `annullabilita` **sotto lock**, con `ultimo_numero`
della coppia bloccata e `haStorno` (409 `ANNULLO_NON_AMMESSO` con `details.motivo`, messaggio dal
motivo: `NON_ULTIMO` «usa la nota di credito di storno») → testate e righe dei legami `FOR UPDATE`
per id (`bloccaRigheLegame`; `enable_nestloop` ripristinato al valore letto prima, Q39) →
`rilasciaUltimo` (difesa: sul `DEFINITIVO` non emesso, prima del cambio di stato) → `ANNULLATO` →
marcatori del documento cancellati → `ripristinaLegamiDelDocumento` (`CONFERMATO`, `fatturato_il`,
`documento_id`, `riferimento_fattura` nulli, `scostamento_dopo_fattura` falso,
`scostamento_gestito_il`, `scostamento_gestito_da` e `scostamento_nota` nulli,
`movimento_vigente_id := movimento_fatturato_id`; `SELECT DISTINCT legame_id,
movimento_fatturato_id`, perché un legame ha più righe, Q42) → audit. Il documento sotto lock rende
l'annullo sicuro contro l'emissione: se l'XML (Task 23) ha già scritto `emesso_il`, `annullabilita`
dà `EMESSO` prima di qualunque scrittura, mai un 500 dal trigger.

**Storno (§5.6, Q33).** Numerazione → origine `FOR UPDATE` → legami. Origine `BOZZA` o `ANNULLATO` →
409 `STORNO_NON_AMMESSO` motivo `NON_DEFINITIVO`; origine `TD04` → motivo `NOTA_DI_CREDITO`; storno
non annullato già presente → 409 `STORNO_GIA_PRESENTE`. `dataDocumento` non futura sul giorno
italiano (400 `DATA_FUTURA`), ≥ `ultima_data` della serie (409 da `riservaNumeri`) e ≥
`data_documento` dell'origine (409 `DATA_ANTERIORE_ULTIMA_FATTURA`, Q33 modificato: 409 come il
controllo della serie, non 400; di fatto è una difesa, perché nella stessa serie `ultima_data` è
già ≥ data dell'origine). TD04 creato in `BOZZA` con `elaborazione_id` NULL, poi righe, riepiloghi e
rate, poi promosso a `DEFINITIVO` con numero successivo (i trigger del Task 6 rifiutano le figlie su
un `DEFINITIVO`), stesse righe coi tipi dell'origine (P6) e `riga_legame_id` NULL (Q1), stessi
riepiloghi e rate; `documento_origine_id`; con `rifatturabile` ripristino come l'annullo, altrimenti
legami `FATTURATO` e scostamenti segnati gestiti con nota «storno documento <numero_testo>» (S20).
`bloccaRigheLegame` con `enable_nestloop` ripristinato come nell'annullo (Q39).

**Annullo di un TD04** (scansione P42, decisione 18): 409 `ANNULLO_NON_AMMESSO` con motivo
`NOTA_DI_CREDITO`, anche se è l'ultimo numero e non è emesso.

- [ ] **Step 1: test (Postgres, `application_name` = `fatt-t20-${pid}`).** `annullo dell'ultimo non emesso: ANNULLATO, ultimo_numero − 1, legami CONFERMATO con movimento_vigente_id = movimento fatturato, marcatori tolti, scostamento_gestito_* e scostamento_nota nulli`; `legame con due righe MOVIMENTO (CER e V): ripristinato una volta` (Q42); **`annullo dell'ultimo, poi conferma del legame con cambio di elenco (4.3): riuscita, nessun 23503`** (Q1); **`storno rifatturabile, poi conferma del legame con cambio di elenco: riuscita, nessun 23503`** (Q1); `annullo di un numero intermedio: 409 ANNULLO_NON_AMMESSO, details.motivo NON_ULTIMO, messaggio «usa la nota di credito di storno»`; `annullo di un emesso: 409 con motivo EMESSO`; **`origine stornata con TD04 datato nell'anno dopo (origine ancora ultima del suo anno, non emessa): annullo 409 con motivo STORNATO, nulla scritto, legami invariati`** (Q9); `motivo vuoto o 201 caratteri: 400`; `annullo con scostamento: legame CONFERMATO, poi la lista della 4.3 lo mostra DA_RIALLINEARE e «Riallinea» lo porta alla testa`; `numero annullato riusato dalla definitiva successiva`; `storno: TD04 col numero successivo, importi positivi, stesse righe con riga_legame_id NULL, documento_origine_id; origine resta DEFINITIVO`; `storno rifatturabile: legami CONFERMATO e marcatori tolti; non rifatturabile: legami FATTURATO, scostamento gestito con nota`; `secondo storno: 409 STORNO_GIA_PRESENTE`; **`storno con data prima di ultima_data: 409 DATA_ANTERIORE_ULTIMA_FATTURA; con data di domani: 400 DATA_FUTURA; nulla scritto, legami invariati`** (Review Focus 5); `difesa sulla data dell'origine: ultima_data della coppia riportata col proprietario al 01/12, origine del 20/12, storno del 19/12: 409 DATA_ANTERIORE_ULTIMA_FATTURA, nulla scritto`; **`storno di una BOZZA o di un ANNULLATO: 409 STORNO_NON_AMMESSO motivo NON_DEFINITIVO; di un TD04: motivo NOTA_DI_CREDITO; nulla scritto`** (Q33); `annullo di un TD04 ultimo e non emesso: 409 ANNULLO_NON_AMMESSO con details.motivo NOTA_DI_CREDITO, nulla scritto`; `suffisso dello storno nella serie con definitivi: quello dell'ultimo definitivo (decisione 20)`; `dopo annullo e storno current_setting('enable_nestloop') è il valore di prima` (Q39); **concorrenza:** `annullo contro definitiva sullo stesso registro: si serializzano sulla numerazione (barriera), nessun doppione, invariante valida`; `storno contro definitiva: idem`; `due annulli dello stesso documento: un 200 e un 409`; **`annullo contro una transazione del proprietario che tiene il documento FOR UPDATE e scrive emesso_il (simula l'emissione dell'XML, barriera): 409 ANNULLO_NON_AMMESSO con motivo EMESSO, mai 500; con la transazione in rollback: ANNULLATO`** (Q10; la gara con il vero `XmlDocumentoService` è nel Task 23); `VERSIONE_SUPERATA`; audit senza dati personali.
- [ ] **Step 2-4:** FAIL → implementa → PASS (sotto `flock`). Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): annullo dell'ultimo numero e nota di credito di storno`.

## Task 21: scostamenti e presa d'atto (Postgres pesante: volume)

**Files:**
- Create: `src/domain/fatturazione/scostamento.ts` (+ spec), `src/application/fatturazione/scostamenti.service.ts` (+ `.postgres.spec.ts`)

**Interfaces:**
- Produces:
```ts
export function valoreAttualeScostamento(i: { fatturato: { quantita: string | null; prezzoTotale: string; prezzoUnitario: string; sconto: string | null; tipoRiga: TipoRigaDocumento; prezzoSpeciale: boolean }[]; testa: { quantita: string | null; annullato: boolean } }): { quantitaAttuale: string | null; importoAttuale: string | null; soloQuantita: boolean }
// fatturato = le righe MOVIMENTO del legame nel documento (una per riga del legame, Task 2; Q40)
export class ScostamentiService {
  lista(tenantId: string, q: { pagina: number; dimensione: number; clienteId?: string }): Promise<Pagina<ScostamentoRiga>>
  presaAtto(tenantId: string, utenteId: string, legameId: string, b: { nota: string; versione: number }): Promise<void>   // 409 SCOSTAMENTO_NON_APERTO
}
```
Lista: legami `FATTURATO` con `scostamento_dopo_fattura` e `scostamento_gestito_il IS NULL`; letture
per pagina con `= ANY(ids)`, non per tenant dopo `joinLineari`. Tipo di correzione dalla testa
della catena. **Una `ScostamentoRiga` per legame (Q40):** `importoFatturato` e `importoAttuale` sono
somme sulle righe `MOVIMENTO` del legame nel documento; `soloQuantita` è vero se almeno una di
quelle righe è a prezzo speciale (prezzo 0 del Task 2), e allora `importoAttuale` è null;
`quantitaFatturata` e `quantitaAttuale` sono quelle del movimento (fatturato e testa), non la somma
delle righe. Le righe `FASCIA_SPECIALE` e `QUANTITA_MOVIMENTI` del documento non si ricalcolano: la
lista mostra il legame, l'effetto su fasce e su `TT`/`TF` lo dice la differenza di quantità. Il
controllo dei ruoli (VIEWER e OPERATOR 403 sulla presa d'atto) sta nel Task 25a (Q31).

- [ ] **Step 1: test.** `rettifica da 1000 a 1200 kg a 0.10: fatturato 100.00, attuale 120.00`; `annullo del movimento: attuale 0.00, tipo ANNULLO`; `riga MOVIMENTO di un legame a prezzo speciale (prezzoUnitario 0): soloQuantita, importo null, quantità fatturata e attuale`; **`legame con due righe MOVIMENTO (CER a 0.10 e V a 0.02) su 1000 kg rettificato a 1200: una sola ScostamentoRiga, fatturato 120.00, attuale 144.00, quantità 1000 e 1200`** (Q40); `legame con una riga CER a prezzo singolo e una V a prezzo speciale: soloQuantita vero, importoAttuale null`; `lista: solo gli scostamenti non gestiti, ordinati per data del documento`; `presa d'atto con nota: sparisce dalla lista, colonne gestito_* scritte, audit`; `nota vuota o 201 caratteri: 400`; `presa d'atto su un legame senza scostamento: 409`; **volume (PG pesante, Q32):** `200.000 movimenti nel tenant (fixture a blocchi, pulizia per id, sotto flock): pagina sotto 1 s con EXPLAIN senza Seq Scan sui movimenti`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (sotto `flock`). **Step 5: commit** `feat(fatturazione): lista degli scostamenti e presa d'atto`.

## Task 22: pulizia delle bozze, job orfani e sonda della numerazione (Postgres)

**Files:**
- Create: `src/application/fatturazione/manutenzione-fatturazione.ts` (+ `.postgres.spec.ts`), `src/infrastructure/jobs/fatturazione-manutenzione.job.ts` (+ spec)
- Modify: `src/application/admin/system-health/evidenze-db.service.ts` (sonda), `src/application/admin/system-health/probes/code.probe.ts` (`CODE_ATTESE`, Q41) e il probe delle evidenze che espone la sonda, `fatturazione.module.ts`

**Interfaces:**
- Produces:
```ts
export async function pulisciBozzeTenant(tx: Prisma.TransactionClient, tenantId: string, ora: Date): Promise<number>   // SCARTATA/FALLITA > 7 giorni, ANTEPRIMA_PRONTA > 30
export async function recuperaOrfaniTenant(tx: Prisma.TransactionClient, tenantId: string, jobVivi: ReadonlySet<string>, ora: Date): Promise<number>
// orfana = IN_CODA, IN_CORSO o IN_DEFINITIVA con updated_at < ora − 5 min e job_id assente da jobVivi (Q25);
// IN_DEFINITIVA → ANTEPRIMA_PRONTA con esito { codice: 'ELABORAZIONE_INTERROTTA' }; IN_CORSO o IN_CODA → FALLITA con errore_tecnico «Elaborazione interrotta»
// system-health: violazioniNumerazione(): Promise<{ tenantId: string; violazioni: number }[]>   chiama fatturazione_violazioni_numerazione() del Task 6 con PrismaSistemaService; solo conteggi
```
`jobVivi` = id dei job attivi, in attesa e ritardati della coda `fatturazione` (Q25: un job
rinviato dal Task 18 non è orfano). Il codice `ELABORAZIONE_INTERROTTA` va nel vocabolario del Task
14 come esito (etichetta «L'elaborazione si è interrotta: richiedi di nuovo la definitiva»).
La funzione SQL della sonda nasce nella migration della 4.4a (Task 6, scansione P6): questo task la
usa e la prova, la 4.4b resta senza migration. **Due cron:** gli orfani ogni 10 minuti (Q25) e la
pulizia delle bozze una volta al giorno. Tenant da `PrismaSistemaService` con `escludiPiattaforma`,
come `RentriRiconciliazioneJob` (`rentri-riconciliazione.job.ts:44`); una transazione per tenant nel
suo contesto; un errore su un tenant non ferma gli altri; mai un `DELETE` fra tenant. Gli orfani si
controllano anche all'avvio del modulo. La coda `fatturazione` entra in `CODE_ATTESE` di
system-health e `violazioniNumerazione` è esposta in un probe (Q41).

- [ ] **Step 1: test.** `bozze di una SCARTATA di 8 giorni: cancellate; di 6: restano`; `ANTEPRIMA_PRONTA di 31 giorni: bozze cancellate, elaborazione SCARTATA`; `DEFINITIVO mai toccato`; `due tenant: errore iniettato sul primo, il secondo pulito`; `IN_DEFINITIVA da 6 minuti senza job vivo: ANTEPRIMA_PRONTA con esito ELABORAZIONE_INTERROTTA`; `IN_DEFINITIVA da 4 minuti senza job: invariata`; `IN_DEFINITIVA con il suo job_id fra i ritardati: invariata`; `IN_CODA da 6 minuti senza job: FALLITA con errore_tecnico` (Q25 modificato, sotto); `cron degli orfani ogni 10 minuti, pulizia giornaliera (spec del job)`; `sonda: un buco iniettato col proprietario (numero 3 mancante) → 1 violazione per quel tenant, nessun dato oltre al conteggio`; `system-health espone il conteggio delle violazioni e la coda fatturazione fra le attese` (Q31, Q41: sostituisce il doppione «il ruolo applicativo non può chiamare la funzione», già in `fatturazione.schema.postgres.spec.ts:1295`).
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): pulizia delle bozze, job orfani e sonda della numerazione`.

## Task 25a: API delle elaborazioni, dei documenti in lettura, di annullo, storno e scostamenti (backend, senza Postgres)

**Files:**
- Create: `src/api/fatturazione/{elaborazioni.controller,documenti-fattura.controller,scostamenti.controller}.ts`, `dto/{nuova-elaborazione,lista-elaborazioni,definitiva,escludi,lista-documenti,annulla,storno,lista-scostamenti,presa-atto}.dto.ts`, spec `*.controller.spec.ts`, `fatturazione.controller.http.spec.ts`
- Modify: `fatturazione.module.ts` (controller più i provider dei servizi dei Task 20 e 21, che non toccano il modulo; scansione P43)

**Interfaces:** rotte e ruoli di spec §11-§12 tranne XML, emissione, export, PDF, mappature, invio
e credenziali. `documenti-fattura.controller.ts` ha qui `GET /documenti-fattura`, `GET /:id`,
`POST /:id/annulla`, `POST /:id/storno`; `POST /:id/emesso` sta nel 25b perché `segnaEmesso` è di
`XmlDocumentoService` (Task 23, 4.4b2). Corpi e risposte coi nomi del Task 14. `GET
/documenti-fattura` e `GET /documenti-fattura/:id` usano `DocumentiFatturaService` (Task 17b,
scansione P38). `POST /legami-movimento/:id/presa-atto-scostamento` sta in
`scostamenti.controller.ts`.
`elaborazioni.controller.ts` ha anche `GET /elaborazioni-fatturazione/:id/documenti`
(`RUOLI_LETTURA`, query `pagina`, `dimensione` ≤ 100, `conErrori`; risposta `Pagina<DocumentoRiga>`;
fissata col Task 14, revisione task-14-review.md).

- [ ] **Step 1: test.** `ogni rotta ha @Roles esplicito` (riflessione sui tre controller più cedente e numerazioni); matrice §12 (Q29, senza PDF): `VIEWER 200 su GET di elaborazioni, documenti e scostamenti; 403 su avvia, ricalcola, scarta, escludi, definitiva, annulla, storno, presa d'atto`; `OPERATOR 200 su avvia, ricalcola, scarta, escludi; 403 su definitiva, annulla, storno, presa d'atto` (comprende il 403 della presa d'atto spostato dal Task 21, Q31); `ADMIN e SUPER_ADMIN: 200`; `dimensione 101: 400; pagina 0: 400`; `id non UUID: 400`; `date "05/11/2026": 400 (solo AAAA-MM-GG)`; `filtri con più di 200 id: 400`; `categoriaIds e tipiAddebito validati (UUID, tipi del listino)`; `motivo oltre 200: 400`; `tenant dal request, mai dal corpo`; `errori con error, message e details numerici`; `POST definitiva con l'interruttore spento: 409 { error: 'DEFINITIVE_NON_ATTIVE', message }` (scansione P33); `POST definitiva con CEDENTE_INCOMPLETO o DATA_ANTERIORE_ULTIMA_FATTURA: 409 con quel codice e details.ultimaData per il secondo` (decisione 24, Q15); `NESSUN_DOCUMENTO_DEFINIBILE e TROPPI_DOCUMENTI dalla rotta, sincroni`; `STORNO_NON_AMMESSO e ANNULLO_NON_AMMESSO con details.motivo`; `controller-tenant-selezionato.spec.ts e nessun-user-userid.spec.ts verdi`; `forma delle risposte: il controller restituisce il valore del servizio senza aggiungere né togliere chiavi` (Q21: il confronto con `fatturazione.model.ts` lo fa il 26a su risposte reali).
- [ ] **Step 2-4:** FAIL → implementa → PASS (HTTP spec con servizi finti). **Step 5: commit** `feat(fatturazione): API delle elaborazioni, dei documenti e degli scostamenti`.

## Task 26a: e2e 4.4b1 via API (Playwright, Postgres)

**Files:**
- Create: `e2e/tests/fatturazione/fatturazione-api.spec.ts`, `e2e/utils/fatturazione-api.ts`

L'e2e non importa `apps/backend/src` in Playwright (scansione P45). Importa invece le costanti
`CHIAVI_*` da `apps/frontend/src/app/features/fatturazione/fatturazione.model.ts`, che non dipende da
Angular (Q21).

- [ ] **Step 1: scenario** (azienda propria in `beforeAll`: cedente completo, registro IVA, cliente con P.IVA valida, contratto ATTIVO, elenco con riga CER a 0.10 e una riga F con scadenza nel periodo; **periodo `[max(1 gennaio dell'anno corrente, oggi − 60), oggi]`**, `fatturazione_da` = inizio del periodo, movimenti e scadenza della `F` dentro il periodo (Q26); movimenti `INGRESSO_ESTERNO` registrati via API con legame confermato; **interruttore acceso** col client del proprietario, `clientDbLocale()` di `e2e/utils/azienda-di-test.ts`, perché la rotta ADMIN nasce nella 4.4c (scansione P34); senza DB locale gli scenari della definitiva si saltano con un messaggio esplicito e il rapporto del 27a dice se in CI sono stati saltati (Q26); pulizia per id): `definitiva con l'interruttore ancora spento: 409 DEFINITIVE_NON_ATTIVE`; `elaborazione completa: avvio 202, attesa ANTEPRIMA_PRONTA, documento con righe MOVIMENTO e FISSO`; `definitiva: numeri 1..n, legami FATTURATO`; `annullo dell'ultimo non emesso: ANNULLATO, numero rilasciato; il legame si conferma di nuovo con cambio di elenco senza errori` (Q1); `rettifica di un movimento fatturato → scostamento in lista → storno rifatturabile → riallineamento → nuova elaborazione e definitiva`; `ANTEPRIMA_SUPERATA: un movimento confermato dopo l'anteprima`; `VIEWER 403 su avvio, OPERATOR 403 su definitiva`; **`chiavi delle risposte reali di ElaborazioneDettaglio, DocumentoRiga, DocumentoDettaglio, RigaDocumentoVista e ScostamentoRiga uguali alle costanti CHIAVI_* del modello del frontend`** (Q21).
- [ ] **Step 2: verifica completa** sotto `flock`: `test:cov`, `tsc`, eslint, suite Postgres dei Task 17-22 (17b compreso) + `rls-catalogo` (76) + suite dei legami; Karma una volta (Task 14); confronto con la linea di base.
- [ ] **Step 3: commit** `test(fatturazione): e2e API e chiusura 4.4b1`.

## Task 27a: revisione dell'intero branch — 4.4b1

**File:** nessuno.

- [ ] **Step 1:** revisore opus fresco (`typescript-nestjs-reviewer`). Controlli espliciti: ordine dei lock identico in definitiva, annullo e storno (grep di `FOR UPDATE`/`FOR SHARE` nel modulo); nessun lock del registro, di radice o di `impostazioni_fatturazione FOR UPDATE`; nessuna query per tenant dopo `joinLineari`, `enable_nestloop` ripristinato; nessun ciclo di UPDATE singoli; una sola transazione nella definitiva; job nel contesto dell'azienda con `UnrecoverableError` senza tenant; trigger mai aggirato; `@Max(100)` su ogni lista; audit senza dati personali; i punti 2-5 di Review Focus col loro test; DTO coi nomi del Task 14. Controlli della prima scansione: `chiediDefinitiva` sincrona con `DEFINITIVE_NON_ATTIVE`, `NESSUN_DOCUMENTO_DEFINIBILE` e `TROPPI_DOCUMENTI`; nel passo 8 le righe prima delle testate; `esito` scritto per ogni uscita senza commit; `escludi` sotto lock dell'elaborazione; annullo di un TD04 respinto. Controlli della scansione della 4.4b (Review Focus 6-11): `riga_legame_id` NULL in bozze, definitivi e storni (grep degli INSERT/UPDATE delle righe); impronta con marcatori e versioni dei dati non versionati della 4.4a; `jobId` con la versione e senza `:`; `documentiNonGenerati` invece di bozze senza registro; `annullabilita` sotto lock con `STORNATO`; suffisso da `suffissiDelleSerie` in previsione, definitiva e storno; `ERRORI_GENERALI_BLOCCANTI` in `chiediDefinitiva` (decisione 24); filtri per categoria e tipo che scelgono contratti interi (decisione 25); orfani ogni 10 minuti anche per `IN_CODA`. Nessuna migration nel diff. Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto `4-4b1-report.md` (dice se in CI gli scenari della definitiva dell'e2e sono stati saltati, Q26); PR 4.4b1, merge, deploy (nessuna migration nuova: la sonda e la colonna `esito` sono della 4.4a). Nota in `ops/README.md` (decisioni 13 e 14, scansione P32): `definitive_attive` resta `false` su tutte le aziende in produzione fino al rilascio della 4.4c e alla conferma del commercialista, con la query di controllo `SELECT count(*) FROM impostazioni_fatturazione WHERE definitive_attive` (atteso 0) da lanciare dopo ogni deploy.

---

# Pezzo 4.4b2 — XSD, XML, emissione, CSV ed export

Da master dopo il merge della 4.4b1. Nessuna migration.

## Task 16: validazione XSD con `xmllint-wasm` (backend, senza Postgres)

**Files:**
- Create: `src/infrastructure/fatturapa/valida-xsd.ts` (+ spec), `src/infrastructure/fatturapa/xsd/Schema_del_file_xml_FatturaPA_v1.2.x.xsd`, `xsd/xmldsig-core-schema.xsd`, `xsd/VERSIONI.md` (fonte, data, `sha256`), `src/infrastructure/fatturapa/esempi/` (XML dei test)
- Modify: `apps/backend/package.json` (`xmllint-wasm` a versione esatta), `nest-cli.json` o build per copiare `xsd/` nel `dist`

**Interfaces:**
- Consumes: Task 15.
- Produces:
```ts
export interface EsitoValidazioneXsd { valido: boolean; errori: string[] }   // errori dell'XSD senza contenuto dei campi
export async function validaFatturaPA(xml: string): Promise<EsitoValidazioneXsd>   // nessun accesso alla rete; schemaLocation di xmldsig riscritto sul file locale
```
**Step 0 (porta).** Prova che `xmllint-wasm` valida l'XSD FatturaPA con l'import di `xmldsig`. Se non
funziona, il task si ferma e segnala l'alternativa (`libxmljs2` o `xmllint` nel container) prima di
procedere (§17.3). La dipendenza nuova obbliga a `npm ci` nei worktree delle ondate successive.

- [ ] **Step 1: test.** `sha256 dei due XSD uguale a VERSIONI.md`; `REGIMI_FISCALI del Task 1 uguale all'enumerazione RegimeFiscaleType letta dall'XSD copiato` (scansione P8; se diverge, il task si ferma e lo segnala: correggere il CHECK vorrebbe una migration, che la 4.4b non ha); `nessuna richiesta di rete durante la validazione` (rete finta che fallisce); validi: `FPR12 TD24`, `FPA12 con CIG, CUP e IdDocumento`, `TD04 con DatiFattureCollegate`, `split payment`, `bollo`, `cessionario persona fisica`, `300 righe`, `testi normalizzati da caratteri fuori Latin-1`; controprove: `manca CodiceDestinatario`, `Numero vuoto`, `ImportoTotaleDocumento con la virgola`, `Natura "N2"`, `elemento fuori ordine` → `valido: false` con messaggi; `messaggi d'errore senza i valori dei campi`. Confronto con l'`xmllint` di sistema (Q31): solo se l'immagine della CI lo contiene (verificarlo nello Step 0 e scriverlo nel rapporto); se non lo contiene, il test non si scrive (niente test sempre saltati).
- [ ] **Step 2-4:** FAIL → implementa → PASS; `npm run build` copia `xsd/` nel `dist`. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): validazione XSD FatturaPA senza rete`.

## Task 24: export CSV (Postgres)

**Files:**
- Create: `src/application/fatturazione/export-csv.ts` (+ spec), `export.service.ts` (+ `.postgres.spec.ts`)

**Interfaces:**
- Produces:
```ts
export interface DocumentoPerExport { documento: DocumentoDettaglio; numero: number | null; anno: number; registroCodice: string; fotografia: FotografiaDocumento }   // Q24: testata, righe, riepiloghi e rate dal dettaglio del 17b; usato anche da 23 (XML_ZIP) e 29-30
export function cellaCsv(v: string | null): string            // "…" con i doppi apici raddoppiati
export function importoCsv(v: string): string                 // "1234.50" → "1234,50", niente migliaia
export function dataCsv(iso: string): string                  // "2026-11-05" → "05/11/2026"
export function testateCsv(d: readonly DocumentoPerExport[]): string; export function righeCsv(d: readonly DocumentoPerExport[]): string   // BOM + intestazione + righe, separatore ";", "\r\n"
export interface SelezioneExport { registroIvaId?: string; anno?: number; numeroDa?: number; numeroA?: number; dataDa?: string; dataA?: string; clienteId?: string; documentoIds?: string[]; elaborazioneId?: string }
export class ExportService { esporta(tenantId: string, utenteId: string, b: { formato: string; selezione: SelezioneExport; confermaEmissione?: boolean }): Promise<{ nomeFile: string; contentType: string; contenuto: Buffer; saltati: number }> }   // saltati: annullati esclusi da XML_ZIP (Task 23), 0 per il CSV; CSV → zip; XML_ZIP collegato dal Task 23 (fino ad allora 400 ADATTATORE_SCONOSCIUTO); adattatori → Task 29-30
```
Allineamento a `exportToCsv` (`permission-audit-log.repository.ts:512`) e
`audit.controller.ts:161-172`, con le differenze di S21. Le bozze solo con `elaborazioneId` e nome
che contiene `ANTEPRIMA`. Il CSV non scrive `emesso_il` (S18) ed esporta anche gli `ANNULLATO`.
Tetto: 5000 documenti per export CSV (scelta di piano, 400 `TROPPI_DOCUMENTI` oltre). Letture per
blocchi con `DocumentiFatturaService.righeInTx`/`dettaglioInTx` o una query per insieme, mai una per
documento.

- [ ] **Step 1: test.** `cellaCsv('a"b') = '"a""b"'`; `importoCsv("1234.50") = "1234,50"`; `testate.csv comincia con il BOM e ha l'intestazione in prima riga`; `righe.csv ripete numero, data e cliente`; `ANNULLATO esportato con lo stato`; `CSV di bozze: nome con ANTEPRIMA`; `CSV non cambia emesso_il`; `selezione per registro, anno, intervallo di numeri e di date, cliente`; `5001 documenti: 400 TROPPI_DOCUMENTI`; `audit dell'export con formato e conteggio`; `formato sconosciuto: 400`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): export CSV dei documenti`.

## Task 23: XML del documento, progressivo del file ed emissione (Postgres pesante: concorrenza)

**Files:**
- Create: `src/application/fatturazione/xml-documento.service.ts` (+ spec, `.postgres.spec.ts`)
- Modify: `src/application/fatturazione/export.service.ts` (formato `XML_ZIP` → `XmlDocumentoService.zip`, scansione P39)

**Interfaces:**
- Consumes: Task 15, 16, 17b (`dettaglioInTx`, `annullabilita`), 20 (`AnnulloStornoService`, già su master con la 4.4b1), 24 (`ExportService`, `DocumentoPerExport`); `contatori_file_fatturapa`.
- Produces:
```ts
export function progressivoBase36(n: number): string   // 1 → "00001", 36 → "00010"; > 36^5 − 1 → errore
export const TETTO_DOCUMENTI_XML_ZIP = 500             // Q24; il CSV resta a 5000
export class XmlDocumentoService {
  xml(tenantId: string, utenteId: string, documentoId: string, b: { confermaEmissione: boolean }): Promise<{ nomeFile: string; contenuto: Buffer; sha256: string }>   // 400 CONFERMA_EMISSIONE_RICHIESTA se non emesso e senza conferma; 409 XML_NON_DISPONIBILE su ANNULLATO; 422 XML_NON_VALIDO
  zip(tenantId: string, utenteId: string, documentoIds: string[], b: { confermaEmissione: boolean }): Promise<{ contenuto: Buffer; saltati: number }>
  segnaEmesso(tenantId: string, utenteId: string, documentoId: string, versione: number): Promise<DocumentoDettaglio>
}
```
Prima richiesta (§7.2): transazione A solo su `contatori_file_fatturapa FOR UPDATE` → nuovo
progressivo; transazione B: documento `FOR UPDATE`; se `xml` già presente restituisce i byte salvati
(il progressivo della A resta inutilizzato: è un nome di file, non un numero fiscale); altrimenti
genera, valida, salva `xml`, `xml_sha256`, `xml_generato_il`, `progressivo_file` ed `emesso_il` se
nullo. Validazione fallita: nulla salvato, 422 con i messaggi dell'XSD, log senza dati personali.
**Solo `DEFINITIVO` (Q7):** un `ANNULLATO` dà 409 `XML_NON_DISPONIBILE` («Un documento annullato non
ha l'XML»: il trigger respinge `xml*` e `progressivo_file` sugli annullati, e l'annullo vuole un
documento non emesso); una `BOZZA` 409. Nome `IT<partita IVA>_<progressivo>.xml`.

`zip` (Q24) lavora in due fasi: **prima** legge, genera e valida tutti i documenti senza scrivere
(422 `XML_NON_VALIDO` con l'indice del documento se uno fallisce, nulla emesso), **poi** fa le
transazioni A e B per documento. Gli `ANNULLATO` della selezione si saltano e si contano in
`saltati`, che la rotta restituisce nell'header `X-Documenti-Saltati` (la risposta è un file: un
`details` non ci sta; Q7 modificato). Oltre `TETTO_DOCUMENTI_XML_ZIP`: 400
`TROPPI_DOCUMENTI`.

- [ ] **Step 1: test.** `progressivoBase36(1) = "00001"`, `(35) = "0000Z"`, `(36) = "00010"`; `prima richiesta con conferma: XML valido, emesso_il scritto, audit di emissione`; `senza conferma su un non emesso: 400`; `seconda richiesta: stessi byte e stesso sha256, nessun progressivo nuovo salvato`; **`due richieste parallele sullo stesso documento: stessi byte, un solo progressivo salvato (il contatore può avanzare di due), un solo audit di emissione`** (Review Focus 1, Q23); `XML che non passa l'XSD (dato corrotto col proprietario): 422, nulla salvato`; `BOZZA: 409`; **`ANNULLATO: 409 XML_NON_DISPONIBILE, nulla scritto`** (Q7); `cliente modificato dopo la definitiva: l'XML usa la fotografia`; `zip di 3 documenti: 3 file con i nomi giusti, tutti emessi`; **`zip con un documento che non passa l'XSD: 422, nessuno dei tre emesso, nessun progressivo salvato`** (Q24); `zip con 2 DEFINITIVO e 1 ANNULLATO: 2 file, saltati 1`; `zip di 501 documenti: 400 TROPPI_DOCUMENTI`; `ExportService.esporta con formato XML_ZIP e confermaEmissione: lo stesso zip, audit dell'export`; **`«Segna come emesso», poi AnnulloStornoService.annulla: 409 ANNULLO_NON_AMMESSO con motivo EMESSO`** (Q22, modificato: con la divisione il Task 20 è già su master e si usa il servizio vero); **`annullo e download XML in parallelo sullo stesso documento (barriera su pg_stat_activity): o ANNULLATO senza emesso_il e XML 409 XML_NON_DISPONIBILE, o XML emesso e annullo 409 EMESSO; mai 500`** (Q10); `contatore di un tenant non bloccato da un altro tenant`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (sotto `flock`). **Step 5: commit** `feat(fatturazione): XML del documento, progressivo del file ed emissione`.

## Task 25b: API di XML, emissione ed export (backend, senza Postgres)

**Files:**
- Create: `dto/{emissione,export}.dto.ts`, spec `fatturazione-xml.controller.http.spec.ts`
- Modify: `src/api/fatturazione/documenti-fattura.controller.ts` (+ spec) (rotte `POST /:id/xml`, `POST /:id/emesso`, `POST /documenti-fattura/export`), `fatturazione.module.ts` (provider dei servizi dei Task 23 e 24)

**Interfaces:** rotte e ruoli di spec §11-§12 per XML, emissione ed export (CSV e `XML_ZIP`).
Download con `StreamableFile`, `Content-Type` e `Content-Disposition: attachment`. Corpi coi nomi del
Task 14 (`confermaEmissione`).

- [ ] **Step 1: test.** `ogni rotta nuova ha @Roles esplicito`; matrice §12 (Q29, senza PDF: la rotta è del Task 28): `VIEWER 200 su export CSV; 403 su xml, export XML_ZIP, emesso`; `OPERATOR 200 su export CSV; 403 su xml, export XML_ZIP, emesso`; `ADMIN e SUPER_ADMIN: 200`; `POST xml senza confermaEmissione: 400`; `export CSV con confermaEmissione: ignorata, nessuna emissione`; `export XML_ZIP con un annullato: header X-Documenti-Saltati 1`; `XML_NON_DISPONIBILE su un annullato: 409`; `download con Content-Disposition attachment e nome del file`; `tenant dal request, mai dal corpo`; `controller-tenant-selezionato.spec.ts e nessun-user-userid.spec.ts verdi`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (HTTP spec con servizi finti). **Step 5: commit** `feat(fatturazione): API di XML, emissione ed export`.

## Task 26b: e2e 4.4b2 via API (Playwright, Postgres)

**Files:**
- Create: `e2e/tests/fatturazione/fatturazione-xml-api.spec.ts`, `apps/backend/scripts/valida-fatturapa.ts` (legge un file XML, chiama `validaFatturaPA` del Task 16, esce con 0 o 1 e stampa solo i messaggi dell'XSD)
- Modify: `e2e/utils/fatturazione-api.ts` (helper del 26a, se servono)

L'e2e scrive l'XML scaricato in un file temporaneo e lancia lo script con
`execFileSync('npx', ['ts-node', …])` da `apps/backend` (scansione P45).

- [ ] **Step 1: scenario** (stessa azienda e stesso periodo del 26a, Q26, interruttore acceso col proprietario; senza DB locale gli scenari si saltano con un messaggio esplicito): `XML con conferma: valido (script valida-fatturapa.ts), documento emesso`; `poi annullo: 409 ANNULLO_NON_AMMESSO motivo EMESSO`; `storno del documento emesso: XML del TD04 valido`; `export CSV: zip con testate.csv e righe.csv`; `export XML_ZIP con conferma: file validi`; `VIEWER 403 su xml, OPERATOR 403 su xml ed emesso`.
- [ ] **Step 2: verifica completa** sotto `flock`: `test:cov`, `tsc`, eslint, suite Postgres dei Task 23-24 + `rls-catalogo` (76); confronto con la linea di base.
- [ ] **Step 3: commit** `test(fatturazione): e2e XML ed export, chiusura 4.4b2`.

## Task 27b: revisione dell'intero branch — 4.4b2

**File:** nessuno.

- [ ] **Step 1:** revisore opus fresco (`typescript-nestjs-reviewer`). Controlli espliciti: Review Focus 1 (un solo `progressivo_file` salvato, il contatore può avanzare di più, Q23); XML mai salvato senza XSD; solo `DEFINITIVO` riceve l'XML; `XML_ZIP` in due fasi, nulla emesso se un documento fallisce; `contatori_file_fatturapa FOR UPDATE` in una transazione che non prende altro; annullo ∥ XML mai 500; `confermaEmissione` mai inventata; nessuna rete nella validazione; CSV senza effetti sullo stato; `@Roles` e matrice §12; nessuna migration nel diff. Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto `4-4b2-report.md` (esito dello Step 0 del Task 16 e presenza di `xmllint` in CI); PR 4.4b2, merge, deploy; la query di controllo di `definitive_attive` del 27a resta valida.

---

# Pezzo 4.4c — interfaccia, PDF e adattatore TeamSystem

Da master dopo il merge della 4.4b2. Nessuna installazione TeamSystem reale è disponibile (decisione
15): il file si valida sul tracciato ricostruito e si rilascia segnalato «non verificato su
un'installazione reale» (Task 29, 30, 33, 35, 37). Nessun gate prima del Task 30.

## Task 28: PDF di cortesia (backend)

**Files:**
- Create: `src/application/fatturazione/pdf-cortesia.ts` (+ spec)
- Modify: `src/api/fatturazione/documenti-fattura.controller.ts` (`GET /documenti-fattura/:id/pdf`, `RUOLI_LETTURA`), `fatturazione.module.ts`

**Interfaces:**
- Consumes: Task 17b (`DocumentiFatturaService.dettaglio`), Task 15 (`FotografiaDocumento`).
- Produces: `export function definizionePdf(doc: DocumentoDettaglio, fotografia: FotografiaDocumento, bozza: boolean): TDocumentDefinitions` (pura, testabile senza rendering); `export async function generaPdf(def: TDocumentDefinitions): Promise<Buffer>`. Dati salvati, mai l'XML. Intestazione fissa «Copia di cortesia: l'originale è il file XML»; filigrana «ANTEPRIMA» sulle bozze. Importi `it-IT`.

- [ ] **Step 1: test.** `definizione con intestazione, cedente, cessionario, righe, riepiloghi, rate, totali`; `bozza: filigrana ANTEPRIMA`; `importi "1.234,50"`; `300 righe: PDF generato sotto 3 s`; `GET pdf non cambia emesso_il`; `VIEWER: 200`; `PDF di un altro tenant: 404`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): copia di cortesia in PDF`.

## Task 29: interfaccia degli adattatori e mappature (Postgres, migration pesante)

**Files:**
- Create: `src/application/fatturazione/adattatori/{adattatore-export-contabile,registro-adattatori,mappature.service}.ts` (+ spec, `.postgres.spec.ts`), `src/api/fatturazione/export-contabile.controller.ts`, `dto/mappature.dto.ts`, `prisma/migrations/20261106100000_fatturazione_mappature/migration.sql`
- Modify: `prisma/schema.prisma` (`MappaturaExportContabile`), `prisma-rls.extension.ts`, `rls-catalogo` (76 → 77), `README-tenant-transazione.md`, `ops/README.md`, `export.service.ts` (formato = codice dell'adattatore), `fatturazione.module.ts`

**Interfaces:**
- Produces (spec §7.3, interfaccia completa già per la 4.4d):
```ts
export type TipoMappatura = 'CODICE_IVA' | 'CONTO_RICAVI' | 'CLIENTE' | 'PAGAMENTO' | 'REGISTRO'
export interface ChiaveMancante { tipo: TipoMappatura; chiaveWasteflow: string; etichetta: string }
export interface FileGenerato { nome: string; contentType: string; contenuto: Buffer }
export interface EsitoInvio { documentoId: string; ok: boolean; riferimento?: string; errore?: string }
export interface AdattatoreExportContabile {
  readonly codice: string; readonly nome: string; readonly modalita: 'FILE' | 'API'
  readonly verificato: boolean   // false = «tracciato non verificato su un'installazione reale» (decisione 15, scansione P31)
  mappatureRichieste(documenti: readonly DocumentoPerExport[]): { tipo: TipoMappatura; chiaveWasteflow: string; etichetta: string }[]
  genera?(documenti: readonly DocumentoPerExport[], mappature: ReadonlyMap<string, string>): FileGenerato[]
  invia?(documenti: readonly DocumentoPerExport[], mappature: ReadonlyMap<string, string>, credenziali: unknown): Promise<EsitoInvio[]>
}
export const ADATTATORI_EXPORT = Symbol('ADATTATORI_EXPORT')   // provider multi del modulo
export class RegistroAdattatori { tutti(): AdattatoreExportContabile[]; trova(codice: string): AdattatoreExportContabile }   // 400 ADATTATORE_SCONOSCIUTO
export class MappatureService { lista(tenantId: string, adattatore: string): Promise<MappaturaVista[]>; imposta(tenantId: string, utenteId: string, adattatore: string, voci: { tipo: TipoMappatura; chiaveWasteflow: string; valore: string | null }[]): Promise<MappaturaVista[]>; mancanti(tenantId: string, adattatore: string, documenti: readonly DocumentoPerExport[]): Promise<ChiaveMancante[]> }
// GET/PUT /export-contabile/:adattatore/mappature   RUOLI_AMMINISTRATORI
// GET /export-contabile/adattatori   RUOLI_AMMINISTRATORI → { codice: string; nome: string; modalita: 'FILE' | 'API'; verificato: boolean }[]   (per l'etichetta delle pagine 33 e 35)
```
Tabella `mappature_export_contabile`: `tenant_id`, `adattatore varchar(30)`, `tipo`,
`chiave_wasteflow varchar(100)`, `valore varchar(50)`, `versione`, `modificato_da`; unico
`(tenant_id, adattatore, tipo, chiave_wasteflow)`; RLS ENABLE+FORCE. Export via adattatore:
mappature mancanti → 409 `MAPPATURE_MANCANTI` con l'elenco in `details`, nessun file; riuscito →
documenti emessi come l'XML (decisione 12).

- [ ] **Step 1: test.** schema e RLS come nel Task 6 (`rls-catalogo` 77); `registro con un adattatore finto: trova, sconosciuto 400`; `GET adattatori: codice, nome, modalità e verificato di ciascuno; OPERATOR 403`; `imposta e lista`; `valore null cancella la voce`; `mancanti: elenca solo le chiavi dei documenti scelti`; `export con mappature mancanti: 409 MAPPATURE_MANCANTI, nessun emesso_il`; `export riuscito con adattatore finto FILE: documenti emessi, audit`; `OPERATOR 403 sulle mappature`; `PUT con 501 voci: 400`.
- [ ] **Step 2-4:** FAIL → implementa → migration con le verifiche del Task 6 → PASS. **Step 5: commit** `feat(fatturazione): interfaccia degli adattatori e mappature per tenant`.

## Task 29b: rotta dell'interruttore delle definitive (backend, Postgres)

Decisione 13, scansione P34. La rotta sta sul servizio delle impostazioni della 4.3, fuori da
`src/application/fatturazione/` (e quindi fuori dalla guardia del Task 17 su
`impostazioni_fatturazione FOR UPDATE`).

**Files:**
- Modify: `src/application/legami-movimento/impostazioni-fatturazione.service.ts` (+ spec, `.postgres.spec.ts`), `src/api/legami-movimento/impostazioni-fatturazione.controller.ts` (+ spec), `dto/impostazione-fatturazione.dto.ts`

**Interfaces:**
- Produces:
```ts
// PUT /impostazioni-fatturazione/definitive   RUOLI_AMMINISTRATORI   body { attive: boolean; versione: number } → { definitiveAttive: boolean; versione: number }; 409 VERSIONE_SUPERATA
// GET /impostazioni-fatturazione aggiunge definitiveAttive alla vista esistente (sola lettura per tutti i ruoli)
ImpostazioniFatturazioneService.impostaDefinitive(tenantId: string, utenteId: string, b: { attive: boolean; versione: number }): Promise<{ definitiveAttive: boolean; versione: number }>
```
Lock ottimistico come `imposta` (versione), audit con il valore prima e dopo. Azienda senza riga di
impostazioni: la riga si crea con `fatturazione_da` nullo, come fa già `imposta`.

- [ ] **Step 1: test.** `ADMIN accende: 200, definitiveAttive true, versione + 1, audit`; `spegne: 200`; `OPERATOR e VIEWER: 403`; `versione vecchia: 409 VERSIONE_SUPERATA`; `GET con definitiveAttive per tutti i ruoli`; `il PUT di fatturazione_da della 4.3 non cambia definitive_attive`; `tenant dal request`; `controller-tenant-selezionato e nessun-user-userid verdi`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. Fine task backend. **Step 5: commit** `feat(fatturazione): interruttore delle definitive per azienda`.

## Task 30: adattatore TeamSystem (backend)

**Files:**
- Create: `winwaste/docs/export-teamsystem-tracciato.md` (Step 0, P4: **fuori dal repository**, non va nel commit), `src/application/fatturazione/adattatori/riferimenti/TRACCIATO.md` (sostanza del tracciato, campo per campo, committata; scansione P44), `src/application/fatturazione/adattatori/teamsystem.adattatore.ts` (+ spec), `adattatori/riferimenti/teamsystem-*.txt` (file attesi scritti a mano dal tracciato)
- Modify: `fatturazione.module.ts` (provider dell'adattatore)

**Interfaces:**
- Consumes: Task 29.
- Produces: `TeamSystemAdattatore implements AdattatoreExportContabile` con `codice = 'TEAMSYSTEM'`, `modalita = 'FILE'`, **`verificato = false`** (decisione 15); `campoFisso(valore: string, lunghezza: number, allineamento: 'S' | 'D', riempimento: ' ' | '0'): string` puro; un file di testo a record fissi con testata e righe secondo `cTeamSystemRec1/2` (`TIPRIGA 1` imponibili per conto, `2`, `3`, `K` IVA, scadenze, CIG/CUP).

- [ ] **Step 0: tracciato.** Ricostruzione dei record `cTeamSystemRec1/2` (posizione, lunghezza, tipo, allineamento di ogni campo `TRF_*`) da `WWNET31.FrmExportTeamSystem :995-1423` con l'agente REA, in `winwaste/docs/export-teamsystem-tracciato.md`, poi copia in `adattatori/riferimenti/TRACCIATO.md`. Senza tracciato completo il task si ferma. Il commit prende solo i file del repository, con percorsi espliciti.
- [ ] **Step 1: test.** `verificato è false`; `campoFisso("ABC", 5, "S", " ") = "ABC  "`; `("12", 5, "D", "0") = "00012"`; `valore più lungo: troncato`; `file di un documento con 2 aliquote uguale byte per byte al riferimento scritto a mano`; `TD04: segno o causale come da tracciato`; `ogni riga della lunghezza del record`; `mappature richieste: codici IVA, conti ricavi per categoria, cliente, pagamento`; `caratteri fuori ASCII normalizzati`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): adattatore TeamSystem a record fissi`.

## Task 31: frontend — menu, elaborazioni e «Nuova elaborazione»

**Files:**
- Create: `fe/features/fatturazione/fatturazione.routes.ts`, `elaborazioni/elaborazioni-lista.component.ts` (+ spec, `.dom.spec.ts`), `elaborazioni/nuova-elaborazione-dialog.component.ts` (+ spec)
- Modify: `fe/app.routes.ts` (`fatturazione`, `loadChildren`), `fe/shared/components/layout.component.ts` (menu «Fatturazione» accanto a «Da collegare»)

**Interfaces:** Consumes Task 14. Rotte figlie: `elaborazioni`, `elaborazioni/:id`, `documenti`,
`documenti/:id`, `scostamenti`, `export-contabile/:adattatore` (ognuna aggiunta dal suo task).

- [ ] **Step 1: test.** `tabella con data, periodo, stato (badge da vocabolario), documenti, totale it-IT, errori`; `paginazione con dimensione ≤ 100`; `«Nuova elaborazione» solo per OPERATOR, ADMIN, SUPER_ADMIN`; `dialog: periodo, data documento con maxDate = fine del giorno ricalcolata all'apertura, raggruppamento, arretrati, filtri cliente e contratto con ricerca lato server (dimensione 25)`; `periodo a cavallo d'anno: errore nel dialog`; `409 ELABORAZIONE_IN_CORSO: messaggio`; `dopo l'avvio: navigazione al dettaglio`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS. **Step 5: commit** `feat(fatturazione): menu, lista delle elaborazioni e nuova elaborazione`.

## Task 32: frontend — anteprima e definitiva

**Files:**
- Create: `fe/features/fatturazione/elaborazioni/anteprima.component.ts` (+ spec, `.dom.spec.ts`), `documento-anteprima-dialog.component.ts` (+ spec), `conferma-definitiva-dialog.component.ts` (+ spec)
- Modify: `fatturazione.routes.ts`

**Interfaces:** Consumes Task 14. Schede «Documenti», «Errori del periodo», «Numerazione prevista»;
barra «Ricalcola», «Scarta», «Rendi definitiva»; aggiornamento periodico ogni 3 s finché lo stato è
`IN_CODA`, `IN_CORSO` o `IN_DEFINITIVA`, fermato alla distruzione.

- [ ] **Step 1: test.** `documenti con imponibile, IVA, totale, errori e avvisi; esclusione e riammissione per riga`; `dialog del documento con righe, riepilogo IVA, rate e link al PDF`; `errori del periodo raggruppati per motivo con link a /legami/da-collegare filtrata per periodo e contratto`; `numerazione prevista «da 15/A a 42/A»`; `conferma: «Verranno emessi N documenti, numeri da X a Y del registro R, data gg/mm/aaaa»; Rendi definitiva solo ADMIN`; **`definitiveAttive false: «Rendi definitiva» disattivato con tooltip «Le fatture definitive non sono ancora attive per questa azienda»; 409 DEFINITIVE_NON_ATTIVE: stesso messaggio`** (decisione 13, scansione P34); `ANTEPRIMA_SUPERATA: messaggio con le differenze e «Ricalcola»`; `polling fermato a ANTEPRIMA_PRONTA e alla chiusura della pagina`; `FALLITA: messaggio senza dettagli tecnici`; `VIEWER: nessuna azione`.
- [ ] **Step 2-4:** come sopra. **Step 5: commit** `feat(fatturazione): anteprima e definitiva`.

## Task 33: frontend — documenti, export e azioni

**Files:**
- Create: `fe/features/fatturazione/documenti/documenti-lista.component.ts` (+ spec, `.dom.spec.ts`), `documento-dettaglio.component.ts` (+ spec), `annulla-dialog.component.ts`, `storno-dialog.component.ts`, `conferma-emissione-dialog.component.ts` (+ spec)
- Modify: `fatturazione.routes.ts`

**Interfaces:** Consumes Task 14, Task 35 (`FatturazioneService.adattatori()`, `AdattatoreVista`). Conferma della decisione 12: «La fattura diventerà emessa e non si
potrà più annullare.»

- [ ] **Step 1: test.** `filtri registro, anno, stato, cliente (ricerca lato server), date`; `selezione multipla; export CSV per tutti, XML e TeamSystem solo ADMIN con conferma`; **`export TeamSystem: la conferma mostra «Tracciato non verificato su un'installazione reale» se l'adattatore ha verificato false`** (decisione 15); `409 MAPPATURE_MANCANTI: elenco delle chiavi e link alla pagina delle mappature`; `dettaglio: «Scarica XML» solo ADMIN con conferma; già emesso senza conferma`; `«Annulla» disattivato con tooltip del motivo (motivoNonAnnullabile)`; `storno: motivo, data con maxDate = fine del giorno, «rifatturabile»`; `motivo vuoto: pulsante disabilitato`; `«Segna come emesso» con conferma`; `PDF scaricato per tutti`; `422 XML_NON_VALIDO: messaggio senza dati`.
- [ ] **Step 2-4:** come sopra. **Step 5: commit** `feat(fatturazione): documenti, export e azioni sul documento`.

## Task 34: frontend — scostamenti e riquadro del legame

**Files:**
- Create: `fe/features/fatturazione/scostamenti/scostamenti.component.ts` (+ spec), `presa-atto-dialog.component.ts` (+ spec)
- Modify: `fatturazione.routes.ts`, `fe/features/legami/riquadro-legame.component.ts` (+ spec)

- [ ] **Step 1: test.** `lista con documento, quantità e importo fatturati e attuali (it-IT), tipo di correzione`; `riga a prezzo speciale: solo la differenza di quantità`; `«Presa d'atto» con nota obbligatoria (1-200), solo ADMIN`; `«Storna e rifattura» apre lo storno con rifatturabile acceso`; `riquadro del legame FATTURATO: link al documento; con scostamento: «Vai agli scostamenti»`.
- [ ] **Step 2-4:** come sopra. **Step 5: commit** `feat(fatturazione): scostamenti e link dal riquadro del legame`.

## Task 35: frontend — pagina «Export contabile»

**Files:**
- Create: `fe/features/fatturazione/export-contabile/mappature.component.ts` (+ spec), tipi `MappaturaVista`, `ChiaveMancante` e `AdattatoreVista { codice: string; nome: string; modalita: 'FILE' | 'API'; verificato: boolean }` in `fatturazione.model.ts`
- Modify: `fatturazione.routes.ts`, `fatturazione.service.ts` (`mappature`, `salvaMappature`, `adattatori` → `GET /export-contabile/adattatori` del Task 29)

- [ ] **Step 1: test.** `adattatore con verificato false: riquadro «Tracciato non verificato su un'installazione reale» in cima alla pagina` (decisione 15, scansione P31); `una sezione per tipo di mappatura, con chiave WasteFlow, etichetta e valore modificabile`; `elenco delle mancanti in cima`; `solo ADMIN e SUPER_ADMIN`; `salvataggio di più voci in un PUT`; `valore vuoto → null`; `409 VERSIONE_SUPERATA: ricarica`.
- [ ] **Step 2-4:** come sopra. **Step 5: commit** `feat(fatturazione): pagina delle mappature dell'export contabile`.

## Task 35b: frontend — interruttore «Definitive attive»

Decisioni 13 e 14, scansione P26.

**Files:**
- Modify: `fe/features/legami/impostazioni-fatturazione.component.ts` (+ spec; scheda «Fatturazione da»), `fe/features/fatturazione/impostazioni/impostazioni-fatturazione-4-4.service.ts` (+ spec), `impostazioni.model.ts`

**Interfaces:** Consumes Task 29b (`PUT /impostazioni-fatturazione/definitive`, `definitiveAttive` nel `GET`).
Produces `ImpostazioniFatturazione44Service.impostaDefinitive(attive, versione)`.

- [ ] **Step 1: test.** `interruttore visibile a tutti, modificabile solo da ADMIN e SUPER_ADMIN`; `accensione: dialog di conferma con l'avviso «Accendi le definitive solo dopo la conferma del commercialista su TD24, documenti misti e nature soggette a bollo»`; `spegnimento senza avviso`; `409 VERSIONE_SUPERATA: messaggio e ricarica`; `VIEWER e OPERATOR: interruttore disabilitato`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS. **Step 5: commit** `feat(fatturazione): interruttore delle definitive nelle impostazioni`.

## Task 36: e2e 4.4c (Playwright, UI)

**Files:**
- Create: `e2e/tests/fatturazione/fatturazione-ui.spec.ts`, `e2e/pages/fatturazione.page.ts`

- [ ] **Step 1: scenari** (azienda propria, dati via API come nei Task 26a e 26b): nuova elaborazione dal dialog; anteprima con errori del periodo e link a «Da collegare»; esclusione di un documento; definitiva con conferma; lista documenti; export CSV e XML (conferma di emissione); PDF; scostamento con presa d'atto; numero di partenza; cedente incompleto che blocca l'avvio; `OPERATOR` senza «Rendi definitiva»; **interruttore spento: «Rendi definitiva» disattivato; acceso dalla UI dall'ADMIN con la conferma (Task 35b), poi la definitiva riesce** (scansione P34); etichetta «non verificato» sull'export TeamSystem. Selettori `data-testid`, attese da `e2e/utils/attese`; 3 giri consecutivi verdi con `--workers=1`.
- [ ] **Step 2: verifica completa:** Karma una volta, `npm run build`, eslint dei file toccati; backend `test:cov`, suite Postgres dei Task 28-30 e 29b, `rls-catalogo` 77.
- [ ] **Step 3: commit** `test(fatturazione): e2e dell'interfaccia di fatturazione`.

## Task 37: revisione dell'intero branch — 4.4c

**File:** nessuno.

- [ ] **Step 1:** revisori in parallelo: `typescript-nestjs-reviewer` (Angular standalone, unsubscribe e polling, tipi, adattatori e migration) e `ux-ui-mobile-specialist` (screenshot a 360 px e desktop di elaborazioni, anteprima, documenti, conferme; focus nei dialog, contrasto dei badge). Controlli espliciti: nessun campo numerico modificabile senza `appNumeroIt`; `maxDate` come fine del giorno; nessuna lista con dimensione oltre 100; ruoli coerenti col backend; nessuna stringa con id o dati personali; etichetta «tracciato non verificato su un'installazione reale» presente sull'export TeamSystem e sulla pagina delle mappature (decisione 15, scansione P31); interruttore delle definitive solo ADMIN con l'avviso del gate (decisione 14). Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto `4-4c-report.md`, che riporta «TeamSystem: tracciato non verificato su un'installazione reale»; PR 4.4c, merge, deploy. Aggiornare `STATUS.md` e `COSTS.md`.

---

# Pezzo 4.4d — Zucchetti (segnaposto)

Parte quando sono noti prodotto (Ad Hoc Revolution o Infinity) e ambiente di prova: si scrive allora
il suo piano (credenziali cifrate, adattatore `API`, e2e con un finto server).

---

## Ondate

Regola: **al massimo un task Postgres pesante per ondata** (migration, concorrenza con barriere o
volume, marcati **PG pesante**). I processi pesanti di tutti i task passano dal `flock`: in ondata si
scrive il codice in parallelo (un worktree per task:
`git worktree add ../rifiuti-wt-44-<task> -b wt/44-<task> <HEAD>`, `node_modules` copiati con
`cp -a --reflink=auto`, `prisma generate` solo nei worktree backend) e si serializzano le
esecuzioni. Integrazione a fine ondata con `git cherry-pick` backend → frontend, poi revisione opus.
Mai Karma e jest insieme.

**File condivisi:** `schema.prisma`, `prisma-rls.extension.ts`, `rls-catalogo…`,
`README-tenant-transazione.md` → solo Task 6 e 29; `prisma/sql/ruoli-db.sql` → solo 6;
`legami-di-test.ts` → solo 6; `ops/README.md` → 6, 12, 27a, 27b, 29; `app.module.ts` → solo 7;
`src/domain/fatturazione/tipi.ts` → 1, 15; `fatturazione.module.ts` → 7, 8, 17b, 18, 19, 22, 25a,
25b, 28, 29, 30 (mai due nella stessa ondata); `fatturazione-di-test.ts` → 6, 17; `fatturazione.job.ts` →
18, 19; `elaborazioni.service.ts` → 18, 19; `export.service.ts` → 24, 23, 29 (in quest'ordine);
`documenti-fattura.controller.ts` → 25a, 25b, 28; `guardia-registro.spec.ts` → solo 17;
`numerazione.ts` → 8, 18 (Q8); `numerazioni.service.ts` → 8, 17b; `uso-listino.ts` e
`uso-tabelle-fatturazione.ts` → 9, 17b; `src/domain/fatturazione/{codici,impronta,righe-fisse,righe-quantita,minimi,costanti-fiscali}.ts`
→ 1-5, 17; `registro-iva-dialog.component.ts` → 11, 14; `annullo-storno.service.ts` → solo 20
(il 23 lo usa nei test); `e2e/utils/fatturazione-api.ts` → 26a, 26b;
`impostazioni-fatturazione.service.ts` e `.controller.ts` della 4.3 → solo 29b;
`fe/features/legami/impostazioni-fatturazione.component.ts` → 10, 35b;
`impostazioni-fatturazione-4-4.service.ts` e `impostazioni.model.ts` → 10, 35b;
`fatturazione.model.ts` e `fatturazione.service.ts` → 14, 35; `fatturazione.routes.ts` → 31, 32, 33,
34, 35 (una riga ciascuno, conflitti risolti dall'orchestratore tenendo tutte le righe);
`app.routes.ts` e `layout.component.ts` → solo 31; `riquadro-legame.component.ts` → solo 34.

| Pezzo | Ondata | Task in parallelo | Tipo | Perché insieme |
|---|---|---|---|---|
| 4.4a | 0 | **0** | PG (verifica) | linea di base |
| 4.4a | 1 | **1** ∥ **10** | backend puro ∥ frontend | 10 si scrive dalle interfacce dei Task 7-8 |
| 4.4a | 2 | **2** ∥ **3** ∥ **4** ∥ **6** | puro ×3 ∥ **PG pesante** (migration) | domini in file propri; la migration copia gli insiemi del Task 1 (test da `pg_constraint`); 6 è cresciuto (interruttore, `esito`, sonda, pulizia) ma resta l'unico pesante |
| 4.4a | 3 | **5** ∥ **7** ∥ **11** | puro ∥ PG ∥ frontend | 5 dopo 2-4; 7 dopo 6; 11 dalle interfacce del 9 |
| 4.4a | 4 | **8** | **PG pesante** (concorrenza) | numerazione e partenza sotto lock |
| 4.4a | 5 | **9** | PG (una barriera) | colonne additive dopo il 6, suffisso sotto il lock della numerazione dell'8; da solo nell'ondata |
| 4.4a | 6 | **12** | e2e + PG | tutto integrato |
| 4.4a | 7 | **13** | revisione | |
| 4.4b1 | 1 | **14** ∥ **15** | frontend ∥ puro | 14 fissa i nomi (P5); 15 è l'unico su `tipi.ts` |
| 4.4b1 | 2 | **17** ∥ **17b** | **PG pesante** (volume) ∥ PG | 17 e 17b dopo 15 (`FotografiaDocumento`) e 14 (nomi); 17 sui domini e sulla fixture, 17b sul modulo e sui file «in uso»: nessun file in comune |
| 4.4b1 | 3 | **18** | **PG pesante** (concorrenza: due avvii con barriera, Q12) | usa 17 e 17b; `numerazione.ts` (Q8) |
| 4.4b1 | 4 | **19** | **PG pesante** (concorrenza, volume) | definitiva e `chiediDefinitiva` |
| 4.4b1 | 5 | **20** | **PG pesante** (concorrenza) | annullo e storno; da solo |
| 4.4b1 | 6 | **21** ∥ **22** | **PG pesante** (volume, Q32) ∥ PG | file propri; 22 modifica il modulo, 21 no; 22 usa la funzione della sonda del 6 |
| 4.4b1 | 7 | **25a** | backend (servizi finti) | dopo tutte le firme; registra i servizi di 20 e 21 |
| 4.4b1 | 8 | **26a** | e2e + PG | integrato; interruttore acceso col proprietario |
| 4.4b1 | 9 | **27a** | revisione | PR, merge e deploy della 4.4b1 |
| 4.4b2 | 1 | **16** ∥ **24** | backend ∥ PG | da master dopo la 4.4b1; 16 aggiunge `xmllint-wasm` (`npm ci` nelle ondate dopo); 24 crea `export.service.ts` |
| 4.4b2 | 2 | **23** | **PG pesante** (concorrenza: XML paralleli, annullo ∥ XML) | dopo 16 e 24; modifica `export.service.ts` |
| 4.4b2 | 3 | **25b** | backend (servizi finti) | registra i servizi di 23 e 24 |
| 4.4b2 | 4 | **26b** | e2e + PG | |
| 4.4b2 | 5 | **27b** | revisione | PR, merge e deploy della 4.4b2 |
| 4.4c | 1 | **29** ∥ **31** | **PG pesante** (migration) ∥ frontend | |
| 4.4c | 2 | **28** ∥ **29b** ∥ **32** ∥ **35** | backend ∥ PG ∥ frontend ×2 | 29b su file della 4.3, nessun altro li tocca; 35 dalle interfacce del 29 |
| 4.4c | 3 | **30** ∥ **33** ∥ **34** ∥ **35b** | backend ∥ frontend ×3 | 30 dopo il tracciato (Step 0); 33 usa `adattatori()` del 35; 35b dopo 29b |
| 4.4c | 4 | **36** | e2e | |
| 4.4c | 5 | **37** | revisione | |

Conteggio: **4.4a 13 task** (1-13), **4.4b1 12 task** (14, 15, 17, 17b, 18-22, 25a, 26a, 27a), **4.4b2
6 task** (16, 23, 24, 25b, 26b, 27b), **4.4c 12 task** (28-37, 29b e 35b), più il Task 0; 4.4d
segnaposto. Task Postgres pesanti: 6, 8, 17, 18, 19, 20, 21, 23, 29 (uno per ondata).

## Copertura della spec

§1-§2 → tutti; anti-obiettivi: numerazione senza buchi 8, 19, 20, 22; legame `FATTURATO` ⇔ documento
6 (CHECK), 19, 20; doppia fatturazione 3, 6, 19; immutabilità 6; registro mai bloccato 17 (guardia),
19; XML mai non valido 16, 23; niente `number` 1-5; niente query fra tenant 18, 22. §3.1 → 17, 19, 20.
S1 → 6, 18; S2 → 5, 18, 19; S3 → 19; S4 → 6; S5 → 17, 19; S6 → 20; S7 → 6, 7; S8 → 18; S9 → 8, 10;
S10 → 2; S11 → 15, 16; S12 → 29; S13 → 17; S14 → 5; S15 → 4; S16 → 4; S17 → 5, 17; S18 → 24;
S19 → 4; S20 → 20; S21 → 24. §4 → 6, 9 (P1 in 6, 8). §5.1-§5.3 → 17, 18; §5.4 → 19; §5.5-§5.6 →
20; §5.7 → 21, 34. §6 → 1-5. §7.1 → 24; §7.2 → 15, 16, 23; §7.3 → 29, 30; §7.4 → 28. §8 → 17, 19,
20, 23. §9 → 18, 22. §10 → Global Constraints. §11-§12 → 7, 8, 25a, 25b, 28, 29. §13 → 10, 11, 31-35.
§14 → 17, 18, 19, 20, 22, 23. §15 → test dei task, e2e 26a, 26b e 36. §16 → pezzi (4.4b divisa, decisione 26). §17: 1 → 6, 29; 2-3 →
16 (e 1, 6 per `REGIMI_FISCALI`); 4 → 5; 5 → gate all'accensione delle definitive (decisione 14:
`ops/README.md` del 27a, avviso del 35b); 6 → 24; 7 → 17; 8 → 19; 9 → 14, 18, 25a; 10 → 30 ed etichetta
«non verificato» (decisione 15); 11 → nessun task (non si usa). Decisioni del §19: 1 → 20, 21, 34;
2 → 1-3, 5; 3 → 8, 20; 4 → 23, 33; 5 → 17; 6 → 3, 19; 7 → 18; 8 → 4 (gate della decisione 14);
9 → 29, 30; 10 → 28; 11 → 29, segnaposto 4.4d; 12 → 23, 25b, 33; 13 → 6, 18, 19, 25a, 26a, 29b, 32,
35b, 36; 14 → 27a, 35b; 15 → 29, 30, 33, 35, 37; 16 → modo di esecuzione; 17 → 1, 3, 5, 17, 13;
18 → 17b, 20; 19 → 3; 20 → 18, 19, 20; 21 → 17; 22 → 3 (già nel codice); 23 → fuori dalla 4.4
(import); 24 → 14, 17, 19, 25a; 25 → 14, 17; 26 → divisione e ondate della 4.4b.

## Self-review (eseguita)

- **Spec coverage:** ogni sezione ha un task (tabella sopra). Senza task: §17.11
  (`ricevute_split`, non usato per scelta della spec); la tabella `credenziali_export_contabile` e le
  rotte di invio e credenziali sono della 4.4d.
- **Type consistency:** `Segnalazione` (1) in 2-5, 17; `RigaDocumentoCalcolata` (1) in 2-5, 15;
  `RigaLegameDaFatturare` (1, con `elencoId`, `quantitaMovimento`, `unitaMovimento`) e
  `RigaListinoDaFatturare` (1, con `elencoId`, `daAllegato`) in 2, 3, 5, costruite dal 17;
  `DatiBanca` (4) in `calcolaRate` e `ContrattoDaFatturare` (5); `InputDocumento` (5, con
  `righeQuantita`) e `ContrattoDaFatturare` (5) costruiti dal 17; `improntaElaborazione` (5) in 18-19
  con `SelezioneElaborazione.versioni` (17; firma estesa dal 17, Q4); `riservaNumeri` e `rilasciaUltimo` (8) in 19-20, con
  `suffissiDelleSerie` (18, Q8); `idJobFatturazione` e `RiepilogoElaborazione` (18) in 19 e 22;
  `ERRORI_GENERALI_BLOCCANTI` (17) in 19; `insiemiPerDefinitiva` e `bloccaPerDefinitiva` (17) in 19;
  `NumeriRiservati` (8) in `EsitoDefinitiva` (19); `ParametriElaborazione` e `FiltriElaborazione`
  (17) = `NuovaElaborazione` e `FiltriElaborazione` (14); `DocumentoRiga`, `DocumentoDettaglio`,
  `ScostamentoRiga`, `Pagina` (14) nelle risposte di 17b, 18, 20, 21, 25a, 25b; `CHIAVI_*` (14) in
  26a; `annullabilita` (con `haStorno`) e `MotivoNonAnnullabile` (17b, cinque valori) in 20, 23 e
  14; `MotivoNonStornabile` (14) in 20; `ElaborazioneDettaglio.definitiveAttive` ed `errore` (14)
  da 18 (colonne `definitive_attive` ed `esito` del 6); `DocumentoPerExport` (24) in 23 e 29-30;
  `FotografiaDocumento`, `FotografiaSalvata` e `DocumentoPerXml` (15, `tipi.ts`) in 17, 17b, 18, 19, 23, 28;
  `SelezioneExport` (24) = `SelezioneExport` (14);
  `AdattatoreExportContabile.verificato` (29) in 30 e, come `AdattatoreVista` (35), in 33.
- **Proportion:** piano circa come la spec; codice solo per firme e per gli algoritmi non
  determinati (riserva dei numeri, rate, sconto a cascata contro la tolleranza SDI, impronta, passi
  della definitiva).
