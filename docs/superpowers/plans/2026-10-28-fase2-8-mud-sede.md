# Fase 2 pezzo 8: MUD calcolato dal registro, per unità locale, con le giacenze al 31/12 — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa un task alla
> volta, opus rivede ogni task. Ordine STRETTAMENTE SEQUENZIALE:
> Task 0 → 1 → 2a → 2b → 3a → 3b → 4 → 5a → 5b → 6 → 7 → 8a → 8b → 9 (motivo in D20).
> Worktree `C:\Progetti\rifiuti-wt-mud`, branch `feat/fase2-8-mud-sede` (= `origin/master`
> `a2bf11e`, con F2-1..F2-5 e F2-7 in produzione). In parallelo, su altri worktree, corrono
> F2-6 deposito (`rifiuti-wt-rentri-b1`, Postgres 55432) e F2-10 controparti (`rifiuti-wt-fir`,
> Postgres 55434): vedi D17 e D18.
> Piano rivisto da opus il 2026-10-28: C1, I1-I9 e M1-M10 recepiti; decisioni di Graziano su
> I2 (avvisi di giacenza semplici), I5 (totali condivisi per il Bilancio) e I9 (merge e deploy
> autonomi).

**Obiettivo.** Il file MUD contiene **una dichiarazione per unità locale** (sezione anagrafica
AA/AB con le sue schede RIF), con il codice e l'indirizzo della sede, e nelle schede RIF scrive
le **giacenze al 31/12** calcolate dal registro della sede con le stesse regole dei saldi
(vigenza F2-3, giacenze iniziali F2-2, famiglia di massa). Un MUD già presentato non cambia in
silenzio: il confronto "dati modificati dopo la presentazione" usa la versione del calcolo con
cui era stato fatto. Con una sola sede e senza giacenze il risultato resta identico a oggi.
Seguito di F2-5: nei controlli la causale si mostra con la descrizione del catalogo. In più, una
funzione pura dei totali del MUD (`totaliMud`) che la vista "Bilancio" userà dopo il merge.

**Fonti.**
- Roadmap `C:\Progetti\winwaste\docs\roadmap-fase2-parita-registro.md` §F2-8 (righe 238-260:
  giacenze al 31/12, ripartizione per unità locale, ruolo del dichiarante; "una dichiarazione
  per unità locale, come la scheda RIF, si conferma in F2-8"; rischio: ogni numero va
  confrontato con un caso reale su `mudtelematico.it`), §0.2 riga 41 (giacenze non calcolate,
  RT/MG non supportati, più sedi sulla principale), §3 (RLS: regole 1-8), §4 riga 395
  (predefinito "MUD per sede").
- WinWaste `C:\Progetti\winwaste\docs\mud.md` §2.2 (chiave di ogni record: anno + CF +
  `"MUD" + codice interno` dell'unità locale, più dichiarazioni nello stesso file), §4.2
  (dichiaranti per unità locale), §4.3 (giacenza del produttore da `[schede produttori]` più
  residui dell'anno prima), §4.4 (`CalcolaGiacenzaRD`: giacenza divisa in recupero e
  smaltimento secondo la classe del carico, senza avvisi; CER con sola giacenza iniziale
  "chiesti all'utente").
- Confronto `C:\Progetti\winwaste\docs\confronto-rifiuti\03-adempimenti-integrazioni.md` §1.1
  riga 32 (una sola UL con codice fisso, sede legale = UL), riga 36 (RT/RE/MG mai alimentati),
  §1.2 A10 (ruolo del dichiarante), A11 (giacenze sempre zero), §7 riga 226 (RT/RE/MG e profili
  impianto/trasportatore/intermediario: taglia L).
- Tracciato `docs/20250129_TracciatiRecord_MUD_V604-24-rev01.pdf`: pag. 10 «Caratteristiche del
  file di esportazione» (un file può contenere più dichiarazioni dello stesso dichiarante purché
  **tutte le unità locali siano nella stessa provincia**, altrimenti il file non viene ricevuto;
  ogni sezione anagrafica è una dichiarazione a sé e paga il proprio diritto di segreteria;
  sequenza `XX, {AA, AB, AU, AR, BA, BB…}, {AA, AB, BA…}`); pag. 11 «Codice di identificazione
  univoca dell'unità locale» (alfa 15: un progressivo numerico allineato a destra con zeri, che
  distingue le dichiarazioni dello stesso dichiarante nella stessa provincia); pag. 28-29 record
  BA (giacenza presso il produttore al 31/12 **da avviare a recupero** e **da avviare a
  smaltimento**, due campi distinti).
- Piani modello: `docs/superpowers/plans/2026-10-28-fase2-5-causali.md` (il MUD legge il ruolo
  dal catalogo; oracolo copiato nello spec), `2026-10-27-fase2-3-rettifica-annullamento.md`
  (vigenza; R10 sul MUD già presentato), `2026-10-27-fase2-2-giacenze-iniziali.md`.
- Piani paralleli (solo per i punti di contatto): `C:\Progetti\rifiuti-wt-fir\docs\superpowers\plans\2026-10-28-fase2-10-controparti.md`
  (D6 colonne congelate e guardia `anagrafiche-colonne-congelate.spec.ts` `:303`, D10, D14,
  Task 0, Task 3b-1, helper `creaDittaConRuolo` `:696`) e
  `C:\Progetti\rifiuti-wt-rentri-b1\docs\superpowers\plans\2026-10-28-fase2-6-deposito.md`
  (vincoli righe 572-578).

## Stato di partenza (branch `feat/fase2-8-mud-sede` = `a2bf11e`, verificato)

Percorsi relativi a `apps/backend/` salvo indicazione.

**Aggregazione** (`src/application/mud/aggregazione/mud-aggregazione.service.ts`).
- `aggrega(tenantId, anno)` `:194-603`: catalogo causali `:198`; movimenti vigenti dell'anno
  di **tutti i registri** `:201-205`; stessi FIR negli anni precedenti `:210-227`; FIR
  collegati `:228-249`; FIR dell'anno `:253-271`; azienda e comune ISTAT `:273-291`; unità
  locali attive `:293-297` (solo per l'avviso); integrazioni `:299-303`; etichette dei registri
  e fonti DR/TE `:305-314`; `rif()` `:317-327` (passa `m.causale`, il codice); doppi (passo 0)
  `:335-380`; ciclo `:407-494` con gli insiemi `inclusi`, `avviatiPerFir`, `ricevuti`,
  `nonConvertiti`, `convertiti` dichiarati a `:399-405` (i `RICEVUTO_DA_TERZI` vanno in
  `ricevuti` e non entrano nelle righe, `:417-420`); dopo il ciclo `:497-551` (doppi, anno
  precedente e `FIR_SCARICATO_PIU_VOLTE` da `avviatiPerFir`, `:547-551`); `completaRighe`
  `:553`; **giacenze: solo l'avviso** `:555-556`; `NESSUN_MOVIMENTO`/`REGISTRO_VUOTO_CON_FIR`/
  `NESSUN_RIFIUTO_DICHIARABILE`/`FIR_NON_REGISTRATO` `:558-573`; `PROFILO_NON_SUPPORTATO` e
  `PIU_UNITA_LOCALI` `:575-576`; controlli del dichiarante `:578-588`.
- `saldiAl31Dicembre` `:613-659`: `groupBy(['cerCode','type','unit'])` dei vigenti con
  `movementDate < fine` (`:618-622`), solo unità di massa via `convertiInKg` (`:626-627`),
  più le aperture con `data_riferimento ≤ 31/12` (`:638-651`), saldo > 0,0005 kg, **somma di
  tutti i registri** (nessun `registroId` nel `by`).
- `completaRighe(righe, integrazioni, anno, controlli)` `:801-884` (deduplica dei controlli per
  messaggio con un `Set` locale `:808-813`, dei TE con `trasportatoriSegnalati` locale `:816`),
  `completaTe` `:887-914`, `caricaTrasportatori` `:920-943`, `caricaDestinatari` `:949-990`
  (anagrafiche: punto di contatto con F2-10, D17).
- `MudAggregato` `:37-56`: `righe` una per CER, nessuna sede.
- `mud-registri.ts:8-19` `etichetteRegistri`: id → denominazione della sede, solo con più di un
  registro.

**Controlli** (`src/application/mud/aggregazione/mud-controlli.ts`): codici `:15-48`;
`MudEsitoControllo` `:73-82` (con `kgNonDichiarati` per le giacenze); `RifMovimento` `:93-104`;
`RifUnitaLocale` `:106-110`; `profiloNonSupportato` `:234-239` (RT e MG non supportati);
`piuUnitaLocali` `:241-249`; `causaleEsclusa` `:279-284` (messaggio con `m.causale`, il
codice); `giacenzeNonCalcolate` `:464-476`; `CODICI_RIPARTIZIONE_RD` `:518-521`;
`riepilogaAvvisi` `:526-610` (testo `:589-608`), con le giacenze escluse da `cambianoQuantita`
`:582-587`.

**Regole e hash** (`mud-regole.ts`): `classificaMovimento` `:60-65`; `canonico` `:129-141`
(scarta le chiavi `undefined`, `:136`); `hashAggregato(righe)` `:168-183`;
`hashDichiarante({azienda, autorizzazioni})` `:192-199`.

**Catalogo causali** (`src/domain/waste-movement/catalogo-causali.ts:221-228`):
`descrizione(verso, codice, giorno, versioneId)` restituisce la descrizione o, fuori
catalogo, il codice. Righe di sistema in
`prisma/migrations/20261030100000_causali_registro/migration.sql:98-119`
(`INGRESSO_ESTERNO` = `RICEVUTO_DA_TERZI`, `ALTRO_CARICO`/`RICLASSIFICAZIONE` = `ESCLUSO`).

**Export** (`src/application/mud/export/`).
- `mud-export.service.ts`: `aggrega` `:74`, dichiarante `:122-127`, `MudExportData` `:128-134`
  (`rifiuti: aggregato.righe`), `generate` `:136`, `hashAggregato(aggregato.righe)` `:150`, voce
  di `reportData.esportazioni` `:157-181` (nessuna versione del calcolo).
- `mud-export.types.ts`: `MudRifiutoLine` `:289-315` (campi `giacenzaRecuperoKg`,
  `giacenzaSmaltimentoKg` `:311-314`, mai valorizzati); `MudExportData` `:318-335` (una sola
  anagrafica); `MudAllegatoRT` `:150-165`; `MudModuloGestione` `:216-238`.
- `mud-dichiarante.ts`: `aziendaDichiarante` `:45-68`, `caricaAutorizzazioni` `:78-116`
  (`AutorizzazioneImpianto` non ha sede), `caricaDichiarante` `:119-129`.
- `versions/mud-tracciato-v604-base.ts`: `generate` `:182-242` (un solo pacchetto AA/AB/AU/AR/
  BA…/DA); `unitaLocale()` `:257-265` **costante `000000000000001`**; `chiaveSchedaRif`
  `:277-285`; `recordAA` `:328-366` (blocco unità locale = blocco sede legale = indirizzo
  dell'azienda, `:334-357`; mesi di attività fissi `:361`); `recordAB` `:369-386` (conta
  INT `:375`, AU `:382`, AR `:383` da `data`); `recordAU` `:395-438`; `recordBA` `:494-512`
  (giacenze `:507-508` con `qtyUm(undefined) = 0`, `:294-296`). Sottoclassi
  `versions/mud-tracciato-v604-2024.ts` e `-2025.ts`.

**Presentazione e riepilogo.**
- `src/application/mud/mud-presentazione.service.ts`: `stato` `:103-158` ricalcola
  `aggrega` e confronta `hashAggregato` e `hashDichiarante` salvati (`:133-147`), **con le
  regole di oggi**; `segnaPresentato` `:164-283` salva l'hash del file scelto, con ripiego
  sull'hash attuale `:238`, o quello attuale senza file (`:199-245`); `annullaPresentazione`
  `:291-356`.
- `src/application/mud/mud-generator.service.ts:41-81`: riepilogo da `aggregato.righe`
  (`wasteProduced` con il solo prodotto per CER, `totals`); lo usano
  `api/mud/mud.controller.ts:76-91` e il PDF (`api/pdf/pdf.controller.ts:121`,
  `infrastructure/pdf/pdf.service.ts:403`).
- `src/application/mud/mud-report-data.ts`: `aggiornaReportData` (lock
  `mud-report|tenant|anno`), `dataComunicazioneSostituita`.
- `MUDReport` `prisma/schema.prisma:682-703`: `@@unique([tenantId, year])` `:699` (un record
  per azienda e anno), `status` `DRAFT|REVIEWING|SUBMITTED|ARCHIVED` `:705-712`.

**Integrazioni**: `aggregazione/mud-integrazioni.ts` (`IntegrazioniMud` `:17-31`,
`INTEGRAZIONI_VUOTE` `:33-40`, `leggiIntegrazioni` `:134-184`); `mud-integrazioni.service.ts`
(salvataggio a sostituzione `:215-243`); DTO `api/mud/dtos/integrazioni-mud.dto.ts:153-180`.
Frontend: le righe nascono **solo dai bloccanti** (`apps/frontend/src/app/features/mud/mud.service.ts:408-425`,
`rigaDaBloccante` `:310`); voci salvate non più usate con `AVVISO_VOCE_SENZA_SEDE` `:303-304`.

**Sedi e registri.**
- `RentriUnitaLocale` `prisma/schema.prisma:2015-2057`: `numIscrSito`, `denominazione`,
  `principale`, `attiva`, campi della scorta; **nessun indirizzo, CAP, comune, provincia,
  addetti, nessun codice per il MUD**. Il sito RENTRI ha `indirizzo`, `civico`, `comune_id`,
  `provincia_id` (`src/infrastructure/rentri/rentri-anagrafiche.client.ts:236-248`), ma la
  sincronizzazione salva solo nome e stato (`src/application/rentri/use-cases/sincronizza-siti.use-case.ts:116-120`).
- `RegistroRifiuti` `schema.prisma:2064-2088`: `unitaLocaleId String?` `:2070` (registro
  "senza sede"); il legame si fa **solo da NULL**, in automatico, quando la principale non ha già
  un registro (`src/application/registro/registri.service.ts:164-190`); nessuna API per farlo a
  mano (`api/registro/registro.controller.ts`, rotte `:100-523`).
- Servizio delle sedi `src/infrastructure/rentri/rentri-unita-locale.service.ts`: interfaccia
  `:10-22`, `create` `:84`, `update` `:119-152` (solo denominazione, attiva, scorta),
  `upsertFromRentri` `:293-330`; una sede con registro con movimenti non si cancella
  (`SEDE_CON_REGISTRO_CON_MOVIMENTI`, `:250-268`); DTO
  `src/api/rentri/dto/update-rentri-unita-locale.dto.ts`; controller
  `src/api/rentri/rentri-unita-locale.controller.ts:76-89` (`PUT :id`, `SUPER_ADMIN|ADMIN`).
  Frontend: `apps/frontend/src/app/features/rentri/rentri-unita-locale.component.ts`
  (form `:163-194`), `rentri-unita-locale.service.ts:8-31`.

**Saldi del registro (regola da rispettare).** `src/application/registro/giacenza-disponibile.ts:63-92`
(`sqlRigheDiMassa`: vigenti del registro + aperture, alias kg/t, unità vuota = kg, CER sulle
sole cifre) e `src/application/registro/aperture-registro.ts:33-61` (`leggiApertureRegistro`
con `registroId` nel risultato). `saldiAl31Dicembre` applica già le stesse regole, ma per
azienda.

**Guardie e test.**
- `src/application/registro/lettori-movimenti.spec.ts:25-40`: ogni file non `.spec.ts` che
  legge `waste_movements` deve stare in `LETTORI` con la scelta (`vigenti` → importa `vigenza`).
- Consumatori di `aggrega` negli spec: `aggregazione/mud-aggregazione.service.spec.ts`
  (1997 righe, prisma finto: `registroRifiuti.findMany` → `[]`, una sede finta senza `id`,
  `:89-117`; query distinte per `where` `:62-82`; scenario `dueRegistri` `:729-782`; test sul
  saldo con `groupBy.mockResolvedValue` `:1292-1362`), `aggregazione/mud-aggregazione-causali.postgres.spec.ts`,
  `aggregazione/mud-aggregazione-saldi.postgres.spec.ts`,
  `src/application/registro/lettori-vigenti.postgres.spec.ts:386,451` (legge `agg.righe`),
  `src/infrastructure/persistence/rls-percorsi-reali.postgres.spec.ts`.
  `PIU_UNITA_LOCALI`/`GIACENZE_NON_CALCOLATE` compaiono in `mud-aggregazione.service.spec.ts`,
  `mud-controlli.spec.ts`, `export/mud-export.service.spec.ts`, `api/mud/mud.controller.export.spec.ts`.
- **Guard fisso su `:55432/`** in 5 spec: `aggregazione/mud-aggregazione-causali.postgres.spec.ts:134`
  e quattro in `src/application/registro/` (`causali/catalogo-causali.repository.postgres.spec.ts`,
  `causali/causali-registro.service.postgres.spec.ts`,
  `use-cases/correggi-movimento.causali.postgres.spec.ts`,
  `use-cases/registra-movimento.causali.postgres.spec.ts`). F2-10 li parametrizza nel suo Task 0
  con un helper `src/test-support/database-di-test.ts` (non ancora scritto).
- CI Postgres: `.gitea/workflows/ci.yml:197-316` (postgres:16-alpine, utente `wasteflow`,
  `wasteflow_ci`, scram, `migrate deploy`, `ops/db-ruoli.sh`, `npm run test:postgres`).
- `tsconfig.json:31` esclude `**/*spec.ts` dalla compilazione; `jest.config.js` gira su
  `.*\.spec\.ts$` ed esclude `*.oracolo.spec.ts`, `*.postgres.spec.ts`, `*.redis.spec.ts`;
  `collectCoverageFrom` (`jest.config.js:34-43`) esclude solo `**/*.spec.ts` e pochi altri.
- Ultime migration: `20261030110000_fir_versione`; F2-6 userà `20261031100000_…`, F2-10
  `20261031110000/110100/110200_…`.

## Decisioni (vincolanti)

- **D1. Una dichiarazione per unità locale, tutte nello stesso file.** Il default della roadmap
  è confermato dal tracciato (pag. 10): un file contiene più "sezioni anagrafiche" dello stesso
  dichiarante, una per unità locale, distinte dal codice dell'unità locale nella chiave di ogni
  record. Restano **un solo file, una sola esportazione e una sola presentazione per azienda e
  anno** (`MUDReport @@unique([tenantId, year])`, `schema.prisma:699`): il ciclo di vita del
  MUD (export, conferma avvisi, segnatura, annullamento, sostitutiva) non cambia. Pacchetti in
  ordine di codice dell'unità locale. La pagina dice che ogni dichiarazione paga il proprio
  diritto di segreteria (Task 8b).
- **D2. A quale dichiarazione va un registro.** Una sola funzione pura
  `dichiarazioneDelRegistro(registroId, contestoSedi)` in `mud-dichiarazioni.ts`, usata **sia**
  per attribuire i movimenti **sia** per i saldi al 31/12 (D8): le due attribuzioni non possono
  divergere. Regole, dal registro `registri_rifiuti.unita_locale_id` (`schema.prisma:2070`):
  - registro legato a una sede → quella sede;
  - registro senza sede, o `registroId` che non si trova (solo nei test finti: in database c'è
    la FK), con azienda **senza nessuna unità locale** → dichiarazione "azienda": codice 1,
    anagrafica dell'azienda (= oggi);
  - stesso caso con unità locali **e una principale** → sulla principale, con l'AVVISO
    `MOVIMENTI_SENZA_SEDE` (informativo, movimenti `incluso: true`) quando almeno un movimento
    del registro entra nel MUD. Motivo: è la regola dei FIR di F2-1 (D10: un movimento con FIR va
    nel registro della principale) e quella di oggi; il legame del registro alla sede si fa solo
    in automatico (`registri.service.ts:164-190`), quindi un bloccante non si potrebbe correggere;
  - unità locali **senza principale** → BLOCCANTE `SEDE_PRINCIPALE_MANCANTE` (si corregge
    indicando la principale); i movimenti restano fuori dalle dichiarazioni.
- **D3. Quali dichiarazioni.** Una per ogni sede (attiva o cessata) con almeno una riga RIF
  nell'anno. Una sede che ha solo movimenti esclusi o solo giacenza non ha pacchetto (i motivi
  sono già nei controlli dei movimenti e in `GIACENZE_NON_DICHIARATE`, D8).
  `NESSUN_RIFIUTO_DICHIARABILE` resta globale (nessuna riga in nessuna dichiarazione).
- **D4. Codice dell'unità locale.** Nuova colonna `rentri_unita_locali.progressivo_mud INTEGER`
  (nullable), unica per `(tenant_id, progressivo_mud)`. Backfill nella migration con
  `row_number() OVER (PARTITION BY tenant_id ORDER BY principale DESC, created_at, id)`: la
  principale di oggi prende **1**, cioè il codice che il file usa da sempre (`base.ts:263-265`).
  Le sedi nuove lo ricevono da un trigger `BEFORE INSERT FOR EACH ROW` con funzione plpgsql
  dichiarata **`VOLATILE`** (così un `INSERT` di più righe vede le righe precedenti dello stesso
  comando): massimo + 1 per tenant, sotto
  `pg_advisory_xact_lock(hashtext('ul-progressivo-mud|' || tenant_id))`. Nessun codice da
  toccare nei servizi RENTRI. Cambiare la principale **non** cambia i codici. **Codice
  liberato:** se si cancella la sede col codice più alto, la sede creata dopo riprende quel
  codice; è innocuo perché una sede si cancella solo se il suo registro non ha movimenti
  (`rentri-unita-locale.service.ts:250-268`), quindi non è mai stata dichiarata. La
  dichiarazione "azienda" (D2) ha codice 1. Nel file: `mudNum(progressivo, 15)`. Un
  `progressivo_mud` NULL (impossibile dopo la migration) vale "dopo tutti gli altri, in ordine
  di `createdAt`" con un `logger.warn`, mai un errore della pagina.
- **D5. Anagrafica dell'unità locale nel record AA.** Nuove colonne nullable su
  `rentri_unita_locali`: `indirizzo VARCHAR(255)`, `civico VARCHAR(20)`, `cap VARCHAR(5)`,
  `comune VARCHAR(100)`, `provincia VARCHAR(2)`, `numero_addetti INTEGER`, con CHECK
  (`cap ~ '^[0-9]{5}$'`, `provincia ~ '^[A-Z]{2}$'`, `numero_addetti >= 0`,
  `progressivo_mud > 0`). Si inseriscono a mano dalla pagina delle unità locali (`PUT
  /rentri/unita-locali/:id`); la sincronizzazione da RENTRI non li scrive (fuori ambito: il
  formato di `comune_id` non è verificato e manca il CAP). Regole:
  - sede con indirizzo, CAP, comune e provincia → blocco "unità locale" del record AA con quei
    dati e il codice ISTAT risolto con `referenceData.findComuneByName(comune, provincia)` (come
    l'azienda, `mud-aggregazione.service.ts:285-290`); comune non trovato → BLOCCANTE
    `UNITA_LOCALE_SENZA_COMUNE_ISTAT`;
  - principale, o dichiarazione "azienda", senza indirizzo completo → anagrafica dell'azienda
    (= oggi); **se le dichiarazioni sono più di una** si aggiunge l'AVVISO
    `PRINCIPALE_CON_INDIRIZZO_AZIENDA` (la sede legale potrebbe non essere la principale);
  - altra sede senza indirizzo completo → BLOCCANTE `UNITA_LOCALE_SENZA_INDIRIZZO` (elenca i
    campi mancanti);
  - sede legale, ATECO, REA, telefono, legale rappresentante: sempre dell'azienda;
  - addetti: `numero_addetti` della sede; se manca, `tenant.numeroAddetti` solo con **una**
    dichiarazione (= oggi), altrimenti 0 con l'AVVISO `UNITA_LOCALE_SENZA_ADDETTI` (uno per
    sede: il dato dell'azienda è il totale, non quello della sede).
- **D6. Province diverse.** Provincia di una dichiarazione = prime 3 cifre del codice ISTAT del
  comune dell'unità locale (o dell'azienda, D5). Più di una → BLOCCANTE
  `UNITA_LOCALI_PROVINCE_DIVERSE` (il portale rifiuterebbe il file, tracciato pag. 10). Il file
  per provincia è un seguito.
- **D7. Dove stanno AU, AR e INT.** `AutorizzazioneImpianto` non ha sede: le schede **AU** escono
  nella dichiarazione della **principale**; se la principale non ha un pacchetto (D3), nella
  **prima dichiarazione per codice**; con una sola dichiarazione, in quella. **AR** (mai
  alimentato) e **INT** (DA/DB, mai alimentate) stanno nel **primo pacchetto per codice**. Il
  record **AB** di ogni pacchetto conta solo le schede AU, AR e INT che quel pacchetto contiene
  (gli altri riportano 00). Con più dichiarazioni e almeno un'autorizzazione → AVVISO
  `AUTORIZZAZIONI_SULLA_PRINCIPALE` (informativo, nessun movimento: non riserva la conferma agli
  amministratori), col testo che dice in quale sede sono finite e perché (D16).
- **D8. Giacenze al 31/12.** Saldo per **(dichiarazione, CER a 6 cifre)**, con il registro
  attribuito da `dichiarazioneDelRegistro` (D2: il saldo di un registro senza sede va sulla
  principale), e le regole di `saldiAl31Dicembre` (`:613-659`): vigenti con
  `movementDate < fine`, aperture con `data_riferimento ≤ 31/12`, solo famiglia di massa, saldo
  > 0,0005 kg, arrotondato al grammo. Unica query:
  `groupBy(['registroId','cerCode','type','unit'])` (la versione 1 somma i registri e ritrova i
  numeri di oggi). Il saldo si scrive in `giacenzaRecuperoKg`/`giacenzaSmaltimentoKg` della riga
  BA della stessa dichiarazione e dello stesso CER (D9). **Un campo di giacenza nullo resta
  assente** dalla riga (mai `0`): `canonico` scarta le chiavi `undefined` (`mud-regole.ts:136`),
  quindi una riga senza giacenza ha lo stesso hash di oggi; il tracciato scrive comunque 0
  (`qtyUm(undefined)`, `base.ts:294-296`). **Non** si scrive, e finisce nell'AVVISO nuovo
  `GIACENZE_NON_DICHIARATE` (con `kgNonDichiarati`, escluso da `cambianoQuantita` come oggi
  `GIACENZE_NON_CALCOLATE`, `mud-controlli.ts:582-587`), quando:
  - il CER non ha una riga nella dichiarazione (giacenza senza movimenti dichiarabili
    nell'anno: nessuna scheda RIF in cui scriverla; WinWaste chiede all'utente, `mud.md` §4.4;
    creare la scheda è un seguito);
  - la dichiarazione ha, fino al 31/12, almeno un carico vigente dello stesso CER con ruolo
    `RICEVUTO_DA_TERZI` (la giacenza non si può attribuire al solo produttore; quella del
    gestore va nel modulo MG, fuori ambito D12). Si ricava con
    `groupBy(['registroId','cerCode','causale','causaleAziendaId'], where type CARICO, vigenti,
    movementDate < fine, _min/_max movementDate)` classificato con `classificaMovimento` alle due
    date: basta una delle due. **Limite dichiarato:** una versione aziendale della causale valida
    solo fra `_min` e `_max` con un ruolo diverso non viene vista (caso raro: la versione si
    sceglie con `causaleAziendaId`, che fa parte del `by`, quindi la data conta solo per le
    causali di sistema, che non hanno versioni); scritto in un commento.
  Le giacenze di una dichiarazione senza pacchetto (D3) finiscono nello stesso avviso.
  `GIACENZE_NON_CALCOLATE` resta **solo** nella versione 1 del calcolo (D10).
- **D9. Recupero o smaltimento della giacenza** (il tracciato chiede i due campi), in ordine:
  1. integrazione `DESTINAZIONE_GIACENZA` dell'anno (`R` o `D`) per la chiave
     `<unitaLocaleId | 'AZIENDA'>|<cer6>` → tutta lì, nessun avviso;
  2. la riga ha solo recupero (`recuperoKg > 0`, `smaltimentoKg = 0`) → tutta a recupero; solo
     smaltimento → tutta a smaltimento; nessun avviso;
  3. entrambi → in proporzione ai kg avviati (`R = arrotonda3(s·rec/(rec+sma))`, `D = s − R`),
     AVVISO `GIACENZA_RIPARTITA`;
  4. nessuno (solo prodotto) → smaltimento, AVVISO `GIACENZA_DESTINAZIONE_NON_INDICATA` (come
     `OPERAZIONE_NON_INDICATA` vale smaltimento, `mud-aggregazione.service.ts:686-687`).
  **Decisione di Graziano:** i due avvisi sono **semplici**, **fuori** da
  `CODICI_RIPARTIZIONE_RD`: non cambiano le quantità dichiarate (`cambianoQuantita` resta
  `false` se ci sono solo loro), quindi la conferma non è riservata agli amministratori;
  WinWaste non avvisa nemmeno (R/D dalla classe del carico, `mud.md` §4.4). `riepilogaAvvisi`
  ha un testo dedicato (D16). I due avvisi portano `integrazione: { tipo:
  'DESTINAZIONE_GIACENZA', chiave, cerCode, unitaLocaleId, sede }`.
- **D10. Versione del calcolo e niente cambi retroattivi silenziosi.** `VERSIONE_CALCOLO_MUD = 2`.
  Versione 1 = il calcolo di oggi (registri sommati, giacenze solo nell'avviso
  `GIACENZE_NON_CALCOLATE`, `PIU_UNITA_LOCALI`); versione 2 = D1-D9.
  `aggrega(tenantId, anno, { versioneCalcolo?: 1 | 2 })`, predefinita 2.
  - L'export e il riepilogo usano sempre la 2 (un file nuovo è un calcolo nuovo).
  - La voce di `reportData.esportazioni` salva `versioneCalcolo: 2`; la segnatura copia la
    versione della voce scelta (una voce vecchia senza campo = 1). Se l'hash della voce manca
    e si ripiega sull'hash attuale (`mud-presentazione.service.ts:238`), o se non c'è file, la
    versione salvata è **quella attuale** (2), coerente con l'hash che si salva. L'annullamento
    conserva la versione nella voce di `annullamenti` e la azzera.
  - `stato()` di un MUD `SUBMITTED` ricalcola **con la versione salvata** (assente = 1) e
    confronta gli hash di quella versione: le giacenze o la ripartizione nuove non fanno
    comparire "dati modificati dopo la presentazione" su un MUD presentato prima di F2-8.
  - Il riepilogo di un anno `SUBMITTED`/`ARCHIVED` presentato con una versione diversa da quella
    attuale porta `versionePresentata` e la pagina mostra una nota (Task 8b): i numeri sono
    quelli delle regole attuali, il file presentato è stato fatto con le precedenti.
  - Hash (`hashCalcoloMud`): versione 1 → `hashAggregato(righe)` (oggi); versione 2 con **una**
    dichiarazione **di codice 1** → `hashAggregato(righe)` della dichiarazione (stesso valore
    della versione 1 se non ci sono giacenze, D8); con una dichiarazione di codice diverso da 1
    o con più dichiarazioni → `hashDichiarazioni` (SHA-256 del JSON canonico di
    `[{ codice, righe normalizzate come in hashAggregato }]` ordinato per codice: il codice
    entra nell'hash). `hashDichiaranteMud`: `hashDichiarante` riceve in più `unitaLocali`
    (anagrafiche D5 dei pacchetti) **solo** se almeno una dichiarazione non usa l'anagrafica
    dell'azienda o se le dichiarazioni sono più di una: altrimenti il valore resta quello di oggi.
- **D11. Equivalenza con oggi (oracolo).** Copia di `mud-aggregazione.service.ts@a2bf11e` in
  `aggregazione/mud-aggregazione-a2bf11e.oracolo-spec.ts` (classe rinominata
  `MudAggregazioneOracoloA2bf11e`, import invariati: stessa cartella; il nome finisce in
  `spec.ts` ma non in `.spec.ts`, quindi tsc lo esclude e jest non lo esegue; va in `LETTORI`
  di `lettori-movimenti.spec.ts` come `vigenti`, motivo "oracolo dei test di equivalenza F2-8,
  mai usato in produzione"; escluso dalla coverage, M7). **Unica deviazione dal verbatim
  (C1):** il costruttore riceve in più `private readonly produzione: MudAggregazioneService`, e
  i corpi di `caricaDestinatari` e `caricaTrasportatori` diventano
  `return this.produzione['caricaDestinatari'](tenantId, receiverIds)` /
  `return this.produzione['caricaTrasportatori'](tenantId, firCollegati)`. Motivo: F2-10
  rinomina e congela le colonne delle anagrafiche che quei due metodi leggono (D17); delegando,
  l'oracolo resta compilabile dopo il merge e i soggetti dei DR/TE sono, per costruzione, gli
  stessi del servizio, quindi l'equivalenza misura solo il resto del calcolo. Commento in testa
  al file con la deviazione. Attese:
  - versione 1 = oracolo: `righe`, `movimentiPerCer`, `pericolosiPerCer`, `dichiarante`,
    `mudNonDovuto` identici; controlli confrontati come **multiinsieme** (ordinati per una chiave
    canonica: codice, messaggio, JSON di movimenti, fir, integrazione, `kgNonDichiarati`),
    identici **salvo** il messaggio di `CAUSALE_ESCLUSA` (D13);
  - versione 2 con una sede = oracolo, confrontando con una `normalizza` che **proietta solo le
    chiavi presenti nell'oracolo** (le chiavi nuove — `dichiarazioni`, `versioneCalcolo`,
    `sede` dei controlli — non entrano), salvo: i due campi di giacenza delle righe, i controlli
    di giacenza (`GIACENZE_NON_CALCOLATE` dell'oracolo contro `GIACENZE_NON_DICHIARATE`/
    `GIACENZA_*` della 2), `PIU_UNITA_LOCALI` (assente nella 2), `MOVIMENTI_SENZA_SEDE` (presente
    nella 2 per i registri senza sede residui, I6) e il messaggio di `CAUSALE_ESCLUSA`; la somma
    "giacenze scritte + `kgNonDichiarati`" della 2 è uguale al `kgNonDichiarati` dell'oracolo;
  - export: `generate(data)` senza `dichiarazioni` è **byte-identico** alle fixture registrate
    prima di toccare il generatore (Task 5a); con una dichiarazione di codice 1 e anagrafica
    dell'azienda è identico a `generate(data)`.
- **D12. Ruolo del dichiarante, moduli RT e MG: fuori ambito, con motivo.** Il tracciato chiede
  per RT (record BB tipo RT, `mud-export.types.ts:150-165`) codice fiscale, comune ISTAT e
  indirizzo del conferente, più i flag "ricevuto da privati", "origine urbana", "pile e
  accumulatori": il carico ha solo `counterpartName`/`counterpartAddress` in testo
  (`WasteMovement`, `schema.prisma:1799+`) e nessuno di quei flag. MG (BD+BE, `:216-238`) chiede
  la tipologia d'impianto e le quantità per ciascuna operazione R/D **svolta nell'unità locale**,
  che il registro non registra (gli scarichi sono avvii a terzi; il catalogo non ha causali di
  trattamento interno, `migration.sql:98-119`). Trasportatore e intermediario non hanno un
  registro proprio. Tutto in Fase 4. Nessun dato si inventa: `PROFILO_NON_SUPPORTATO` resta com'è.
- **D13. Seguito di F2-5: descrizione della causale.** `RifMovimento` riceve
  `causaleDescrizione?: string`, valorizzato in `rif()` con `catalogo.descrizione(type, causale,
  giornoItaliano(movementDate), causaleAziendaId)` **solo se diversa dal codice**.
  `causaleEsclusa` scrive `causale "${descrizione}"` se c'è, altrimenti il codice come oggi. La
  firma di `controlliMud.causaleEsclusa` non cambia (l'oracolo continua a compilare).
- **D14. Strutture condivise e controlli per sede.** Una sola volta per aggregazione si creano
  `condivisi = { segnalati: Set<string>, trasportatoriSegnalati: Set<string>, inclusi:
  Set<Movimento>, avviatiPerFir: Map<string, Movimento[]> }`. Ogni gruppo (dichiarazione) li
  riempie; i controlli che li leggono (`FIR_DOPPIO_IDENTICO` con `inclusi`,
  `FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE`, `FIR_SCARICATO_PIU_VOLTE` con `avviatiPerFir`) si
  emettono **una volta, dopo tutti i gruppi**, nella coda globale. Firma nuova:
  `completaRighe(righe, integrazioni, anno, controlli, condivisi, sede?: string)` (al posto dei
  due `Set` locali `:808`, `:816`); `completaTe(acc, integrazioni, anno, condivisi, controlli)`.
  `MudEsitoControllo.sede?: string` (denominazione della sede o "Azienda"), valorizzato **solo**
  nella versione 2 con più di una dichiarazione e solo per i controlli nati dentro un gruppo e
  riferiti a movimenti o righe di quella sede. **I controlli sui soggetti deduplicati su tutto il
  file** (`DESTINATARIO_SENZA_CF`, `DESTINATARIO_SENZA_ISTAT`, `DESTINATARIO_ESTERO`,
  `TRASPORTATORE_SENZA_CF`) **non portano `sede`**: la correzione (integrazione) vale per tutte le
  sedi. I messaggi non cambiano.
- **D15. Forma dei dati (additiva).**
  - `MudAggregato` riceve `versioneCalcolo` e `dichiarazioni: MudDichiarazione[]`
    (`{ codice: string /* 15 cifre */; progressivo: number; unitaLocale: { id: string | null;
    denominazione: string; numIscrSito: string | null; principale: boolean }; anagrafica:
    MudUnitaLocaleAnagrafica | null /* null = azienda */; conAutorizzazioni: boolean;
    conAllegatiAzienda: boolean /* AR, INT: primo pacchetto */; righe; movimentiPerCer;
    pericolosiPerCer }`). `righe`, `movimentiPerCer`, `pericolosiPerCer` restano:
    concatenazione/somma delle dichiarazioni (con una sede = oggi; i lettori negli spec non
    cambiano).
  - `TotaliMud` (Task 6, decisione di Graziano I5): funzione pura condivisa, vedi D22.
  - `MudRiepilogo` riceve `versioneCalcolo`, `versionePresentata: number | null` e
    `dichiarazioni` (da `TotaliMud`); le righe di `wasteProduced` ricevono `recoveryKg`,
    `disposalKg`, `giacenzaRecuperoKg`, `giacenzaSmaltimentoKg`. `wasteProduced` e `totals` in
    testa = somma per CER di tutte le dichiarazioni (il PDF non cambia).
  - `StatoPresentazioneMud` riceve `versioneCalcolo: number | null` (della presentazione) e
    `versioneCalcoloAttuale: number`.
- **D16. Messaggi nuovi** (testo concordato; i test li confrontano carattere per carattere;
  `nome(u)` = `${denominazione} (${numIscrSito})` come `mud-controlli.ts:242`; `q` =
  `formattaQuantita`; `cer` con `cerCanonico` e asterisco se pericoloso; `cer6` = le 6 cifre).
  L'etichetta della riga d'integrazione è **una costante esportata** `etichettaGiacenza(cer6)` =
  `Giacenza CER ${cer6}` in `mud-controlli.ts`, usata nei messaggi; il frontend ha la stessa
  funzione con lo stesso testo e uno spec che fissa la stringa (M5).
  - `MOVIMENTI_SENZA_SEDE` (AVVISO): `Nel ${anno} il registro senza sede ha ${n} movimenti nel MUD (n. ${elenco}): il file li attribuisce all'unità locale principale ${nome(principale)}. Verificare che siano stati prodotti o gestiti in quella sede.` (con `n === 1`: `ha 1 movimento nel MUD`).
  - `SEDE_PRINCIPALE_MANCANTE` (BLOCCANTE): `Nel ${anno} il registro senza sede ha ${n} movimenti, ma nessuna delle ${k} unità locali dell'azienda è indicata come principale: indicare la sede principale nella pagina delle unità locali RENTRI, così il MUD li attribuisce a quella sede.`
  - `UNITA_LOCALE_SENZA_INDIRIZZO` (BLOCCANTE): `Unità locale ${nome(u)}: mancano ${campi} nell'anagrafica della sede, obbligatori nella scheda anagrafica della sua dichiarazione MUD. Inserirli nella pagina delle unità locali RENTRI.` (`campi` = elenco fra "indirizzo", "CAP", "comune", "provincia", separati da virgola, "e" prima dell'ultimo).
  - `UNITA_LOCALE_SENZA_COMUNE_ISTAT` (BLOCCANTE): `Comune dell'unità locale ${nome(u)} non trovato nelle tabelle ISTAT (${comune} ${provincia}): correggerlo nella pagina delle unità locali RENTRI.`
  - `PRINCIPALE_CON_INDIRIZZO_AZIENDA` (AVVISO): `L'unità locale principale ${nome(u)} non ha un indirizzo proprio: nella sua dichiarazione MUD compare l'indirizzo dell'azienda. Se la sede è altrove, inserirne l'indirizzo nella pagina delle unità locali RENTRI.`
  - `UNITA_LOCALE_SENZA_ADDETTI` (AVVISO): `Unità locale ${nome(u)}: il numero di addetti della sede non è indicato e nella sua dichiarazione MUD risulta 0. Inserirlo nella pagina delle unità locali RENTRI.`
  - `UNITA_LOCALI_PROVINCE_DIVERSE` (BLOCCANTE): `Le unità locali da dichiarare sono in province diverse (${voci}): un file MUD può contenere solo dichiarazioni della stessa provincia, altrimenti viene rifiutato. La generazione di un file per provincia non è ancora supportata (contattare l'assistenza).` (`voci` = `${denominazione}: ${sigla o codice ISTAT provincia}`, ordinate per codice).
  - `AUTORIZZAZIONI_SULLA_PRINCIPALE` (AVVISO): `Il file contiene ${k} dichiarazioni e l'azienda ha ${n} autorizzazioni registrate: le schede delle autorizzazioni sono nella dichiarazione dell'unità locale ${nome(scelta)}${motivoScelta}, perché le autorizzazioni non indicano la sede. Verificare che siano dell'impianto di quella sede.` con `motivoScelta` = `''` se `scelta` è la principale, altrimenti ` (la principale non ha rifiuti da dichiarare nell'anno)`.
  - `GIACENZE_NON_DICHIARATE` (AVVISO, `kgNonDichiarati`): `Secondo il registro, al 31/12/${anno} risultano in deposito ${q(totale)} kg che il file non dichiara (${voci}): un rifiuto senza movimenti nel MUD dell'anno non ha una scheda RIF in cui scrivere la giacenza, e per un rifiuto ricevuto anche da terzi la giacenza non si può attribuire al solo produttore.` (`voci` = `CER ${cer}: ${q(kg)} kg, ${'nessun movimento nel MUD' | 'ricevuto anche da terzi'}`, per CER, separate da `; `). Un controllo per dichiarazione.
  - `GIACENZA_RIPARTITA` (AVVISO): `Il rifiuto CER ${cer} ha ${q(s)} kg in deposito al 31/12/${anno}: nell'anno è stato avviato sia a recupero sia a smaltimento, quindi la giacenza è ripartita in proporzione (${q(r)} kg a recupero, ${q(d)} kg a smaltimento). Se la destinazione è un'altra, indicarla in MUD > Integrazioni ${anno}, riga "${etichettaGiacenza(cer6)}".`
  - `GIACENZA_DESTINAZIONE_NON_INDICATA` (AVVISO): `Il rifiuto CER ${cer} ha ${q(s)} kg in deposito al 31/12/${anno}, ma nell'anno non è stato avviato né a recupero né a smaltimento: la giacenza è considerata da avviare a smaltimento. Se è destinata a recupero, indicarlo in MUD > Integrazioni ${anno}, riga "${etichettaGiacenza(cer6)}".`
  - Testo di `riepilogaAvvisi` (`:589-608`) quando fra gli avvisi c'è un `GIACENZA_*`: alla
    frase di oggi si aggiunge ` Per alcune giacenze al 31/12 la destinazione (recupero o smaltimento) è stimata: verificarla negli avvisi sotto.`
    Con i soli avvisi di giacenza il testo è quindi
    `Il file dichiara le stesse quantità del registro: gli avvisi sono informativi. Per alcune giacenze al 31/12 la destinazione (recupero o smaltimento) è stimata: verificarla negli avvisi sotto.`
- **D17. Contatto con F2-10 (anagrafiche) e punti di merge.** `caricaDestinatari` e
  `caricaTrasportatori` (`:920-990`) **non si toccano né si spostano**: F2-10 Task 3b-1 li
  riscrive (ditta + sede predefinita) e rinomina/congela le colonne che leggono (F2-10 D6:
  `ragioneSociale` → `ragioneSocialeStorica`, `@ignore` su P.IVA, indirizzo e contatti dei ruoli).
  La logica nuova sta in file nuovi (`mud-dichiarazioni.ts`, `mud-giacenze.ts`, `mud-totali.ts`)
  e dentro `aggrega`/`saldiAl31Dicembre`. Il DR "per sede del destinatario scelta sul FIR"
  (F2-10 D10: "è F2-8") richiede `firs.receiver_sede_id` di F2-10: seguito dopo il suo merge.
  **Punti di merge espliciti** (chi entra secondo fa rebase sull'altro):
  1. `npx prisma generate`, `migrate deploy` su 55436, `migrate diff` vuoto;
  2. oracolo: compila senza modifiche grazie alla delega di C1 (D11); se F2-10 cambia la firma
     dei due metodi, adeguare **solo** le due righe di delega;
  3. aggiungere `aggregazione/mud-aggregazione-a2bf11e.oracolo-spec.ts` alle eccezioni della
     guardia `src/infrastructure/persistence/anagrafiche-colonne-congelate.spec.ts` di F2-10 (non
     legge le colonne congelate, ma il file è un sorgente non `.spec.ts`);
  4. i seed Postgres di questo pezzo creano destinatari e trasportatori con un helper locale
     `creaSoggettoMud(client, tenantId, ruolo, dati)` in `aggregazione/mud-seed.postgres-spec.ts`
     (nome escluso da tsc e da jest come l'oracolo): al merge l'helper si riallinea a
     `creaDittaConRuolo` di F2-10 (`:696` del loro piano), lasciando invariati i dati;
  5. riga `:134` di `mud-aggregazione-causali.postgres.spec.ts`: vince la versione di F2-10
     (D19); unit e Postgres MUD verdi.
- **D18. Contatto con F2-6 (deposito).** Nessun file in `application/giacenze/**`,
  `application/anomal*/**`, `deposito-temporaneo*`, `application/registro/**` salvo la voce di
  `LETTORI` in `lettori-movimenti.spec.ts` (D11) e la sola lettura di `aperture-registro.ts`
  (F2-6 aggiunge un campo `id` facoltativo: compatibile). `giacenza-disponibile.ts` non si
  importa (il MUD resta sulla sua query, che ha le stesse regole).
- **D19. Database di test e guard.** Container nuovo `wasteflow-pg-test-mud` su
  `127.0.0.1:55436` (Task 0). **Non** si crea l'helper di F2-10: gli spec nuovi hanno un guard
  locale `expect(process.env.DATABASE_URL ?? '').toMatch(/@(127\.0\.0\.1|localhost):(55432|55436)\/wasteflow_ci\b/)`;
  nello spec già esistente `mud-aggregazione-causali.postgres.spec.ts` si cambia **solo** la riga
  `:134` nello stesso modo (va eseguito: tocca `aggrega`). I 4 spec guardati di
  `application/registro/` non si toccano e si escludono dalla suite locale (vincoli globali); la
  CI su 55432 li esegue tutti.
- **D20. Ordine e parallelismo.** Tutto sequenziale: un worktree, un database di test, RAM
  limitata, e i task 2a-6 toccano gli stessi file (`mud-aggregazione.service.ts`,
  `mud-controlli.ts`, `mud-export.types.ts`). I task sono spezzati (2a/2b, 3a/3b, 5a/5b) perché
  ciascuno stia nel contesto di un agente. Il Task 8a dipende solo dal Task 1: se serve si può
  anticipare subito dopo il Task 1, sempre in sequenza.
- **D21. Migration** `20261031130000_unita_locali_mud` (dopo F2-6 `20261031100000` e F2-10
  `20261031110000-110200`). Solo colonne, CHECK, indice unico, funzione e trigger su
  `rentri_unita_locali`: **nessuna tabella nuova**, quindi `rls-catalogo.postgres.spec.ts` e
  `TENANT_SCOPED_MODELS` non cambiano (la tabella ha già RLS). Eseguita da `wasteflow`
  (superuser: il backfill non è soggetto a `FORCE ROW LEVEL SECURITY`, roadmap §3 regola 6).
  Commento iniziale con cosa, perché, ruolo, ripristino a mano (`DROP TRIGGER`, `DROP
  FUNCTION`, `DROP INDEX`, `ALTER TABLE … DROP CONSTRAINT/COLUMN`). Nello schema i campi
  nuovi vanno **in fondo al blocco** di `RentriUnitaLocale` (`:2050`, prima di `tenant`), con un
  commento `// Fase 2 pezzo 8`.
- **D22. Totali del MUD condivisi (decisione di Graziano, I5).** Funzione pura
  `totaliMud(aggregato: MudAggregato): TotaliMud` in `src/application/mud/mud-totali.ts`, per la
  vista "Bilancio" che un'altra sessione costruirà dopo il merge (qui **niente vista e niente
  rotta**). `TotaliMud = { anno; versioneCalcolo; perCer: VoceTotaliMud[]; dichiarazioni:
  Array<{ codice; unitaLocale; perCer: VoceTotaliMud[]; totali: SommeMud }>; totali: SommeMud }`
  con `VoceTotaliMud = { cerCode /* canonico, con * se pericoloso */; pericoloso: boolean;
  prodottoKg; recuperoKg; smaltimentoKg; giacenzaRecuperoKg; giacenzaSmaltimentoKg; movimenti }`
  e `SommeMud` con le stesse cinque quantità più `movimenti`; `perCer` di testa = somma per CER
  di tutte le dichiarazioni; tutto al grammo. `MUDGeneratorService.generateMUDReport` la usa per
  `wasteProduced`, `totals` e `dichiarazioni`; metodo pubblico nuovo
  `MUDGeneratorService.totaliAnno(tenantId, anno): Promise<TotaliMud>` (aggregazione versione
  attuale + `totaliMud`).
- **D23. Rilascio (decisione di Graziano, I9).** Merge e deploy **autonomi**, come per gli altri
  pezzi della Fase 2 (CI verde e revisione pulita), senza attendere la prova sul portale. Il
  rapporto finale dice in chiaro che il file a più pacchetti **non è stato provato su
  mudtelematico.it**; i file di prova restano a disposizione di Graziano.

## Vincoli globali (per ogni task)

- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), messaggi in italiano,
  **nessuna attribuzione AI**. Niente push. Commenti in italiano, termini tecnici non tradotti.
  Mai id di tenant, codici fiscali o credenziali nei messaggi restituiti all'utente.
- In ogni shell:
  ```bash
  export DOCKER_HOST=tcp://localhost:2375
  export DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55436/wasteflow_ci?schema=public"
  export DB_APP_PASSWORD=wasteflow_app_dev DB_SISTEMA_PASSWORD=wasteflow_sistema_dev
  export NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod
  ```
  e prima di ogni suite Postgres
  `[[ "$DATABASE_URL" == *":55436/"* ]] || { echo "DATABASE_URL non punta a 55436: fermo"; exit 1; }`.
  Mai 55432 né 55434 (database degli altri worktree).
- Test Postgres col ruolo `wasteflow_app` (modello
  `aggregazione/mud-aggregazione-causali.postgres.spec.ts:8-30,130-140`: `urlComeRuolo`,
  `creaPrismaServiceApplicativo()`, `TenantContext.run`); preparazione e pulizia col client
  proprietario, **per `tenantId`**, mai `deleteMany` senza filtro; destinatari e trasportatori
  sempre da `creaSoggettoMud` (D17 punto 4). Lanciati con
  `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`.
- Suite Postgres "locale completa" (dal Task 3b):
  `npx jest -c jest.postgres.config.js --runInBand --forceExit --testPathIgnorePatterns "catalogo-causali.repository|causali-registro.service|correggi-movimento.causali|registra-movimento.causali"`
  (i 4 spec col guard fisso, D19). Confronto con la base del Task 0: nessun fallimento nuovo.
- **Prisma finto negli spec unitari:** i movimenti finti portano `vigente: boolean` (predefinito
  `true`); il finto scarta quelli con `vigente: false` quando il `where` contiene le chiavi di
  `WHERE_VIGENTE`, e `groupBy` calcola davvero dai movimenti rispettando `args.by`,
  `where.type`, `where.movementDate.lt` e la vigenza. Helper unico
  `aggregazione/mud-prisma-finto.fixture-spec.ts` (escluso da tsc e jest come l'oracolo),
  usato dagli spec di equivalenza e, dove serve, da `mud-aggregazione.service.spec.ts`.
- **RAM:** jest mirato `npx jest -w 2 <percorsi>`; `npm run test:cov` **una volta** a fine task
  backend; lint senza `--fix` globale: durante il lavoro `npx eslint <file toccati>`, a fine
  task una volta `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` da `apps/backend`. Karma
  **una volta** per task frontend. Mai due suite pesanti insieme.
- Fine task backend: `npm run test:cov`, `npx tsc --noEmit -p tsconfig.json`, gli spec Postgres
  del task, `src/application/mud/**/*.postgres.spec.ts`, `lettori-vigenti.postgres.spec.ts`,
  `rls-percorsi-reali.postgres.spec.ts`. Servizi o provider nuovi → `mud.module.spec.ts`.
- Task con migration: `npx prisma validate`; `npx prisma migrate deploy` su 55436;
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://wasteflow:wasteflow_ci@127.0.0.1:55436/shadow_f28?schema=public"`
  (database creato e poi tolto con `docker exec wasteflow-pg-test-mud psql -U wasteflow -d wasteflow_ci -c "CREATE DATABASE shadow_f28"` / `"DROP DATABASE shadow_f28"`) → **vuoto** (o solo le
  note preesistenti di master: pgcrypto e default di `notifications.expires_at`). Nomi di vincoli,
  indici, funzione e trigger espliciti (≤ 63 caratteri), identici in schema e migration.
- Task frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless`,
  `npm run build`, dalla root `npx eslint "apps/frontend/src/**/*.ts" --max-warnings=-1`.
- I numeri del file sono una dichiarazione a un ente: ogni test sui numeri scrive i valori attesi
  a mano (mai ricavati dal codice sotto test).

## Task 0: ambiente e base di confronto

**File:** `apps/backend/.env` (locale, ignorato da git), nessun file versionato.

1. `node_modules` alla radice assente: `npm ci` dalla radice, poi `cd apps/backend && npm run prisma:generate`; `npx prisma --version` → 5.22.x.
2. Container (stessa preparazione di `.gitea/workflows/ci.yml:247-258`, con porta pubblicata come
   gli altri due):
   ```bash
   docker run -d --name wasteflow-pg-test-mud -p 127.0.0.1:55436:5432 \
     -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci \
     -e POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256" postgres:16-alpine
   ```
   attesa con `docker exec wasteflow-pg-test-mud pg_isready -U wasteflow` (ciclo con limite).
   Se il container esiste già: `docker start wasteflow-pg-test-mud`.
3. `apps/backend/.env` locale con `DATABASE_URL` su 55436 (verificare `git check-ignore -v
   apps/backend/.env` → `.gitignore:16`); copiare le altre chiavi da `.env.example` senza
   segreti veri.
4. `cd apps/backend && npx prisma migrate deploy`; dalla radice
   `MSYS_NO_PATHCONV=1 PG_EXEC="docker exec -i wasteflow-pg-test-mud" bash ops/db-ruoli.sh` →
   `ruoli DB applicati (wasteflow_app, wasteflow_sistema)`.
5. Base: suite Postgres "locale completa" (vincoli globali) e `npm run test:cov` una volta.
   Annotare nel rapporto i fallimenti preesistenti. Nessun commit.

## Task 1: anagrafica e codice MUD delle unità locali (database, schema, API)

**Dipende da 0.** **File:** `prisma/schema.prisma`,
`prisma/migrations/20261031130000_unita_locali_mud/migration.sql` (nuovo),
`src/infrastructure/rentri/rentri-unita-locale.service.ts` (+ spec),
`src/api/rentri/dto/update-rentri-unita-locale.dto.ts` (+ spec del DTO se assente),
`src/api/rentri/rentri-unita-locale.controller.ts` (solo `@ApiOperation` del PUT)
(+ `rentri-unita-locale.controller.spec.ts`),
`src/infrastructure/rentri/unita-locali-mud.postgres.spec.ts` (nuovo), `ops/README.md` (ripristino).

1. Schema (D21): in fondo a `RentriUnitaLocale`, con commenti in italiano:
   `indirizzo String? @db.VarChar(255)`, `civico String? @db.VarChar(20)`,
   `cap String? @db.VarChar(5)`, `comune String? @db.VarChar(100)`,
   `provincia String? @db.VarChar(2)`, `numeroAddetti Int? @map("numero_addetti")`,
   `progressivoMud Int? @map("progressivo_mud")`,
   `@@unique([tenantId, progressivoMud], map: "rentri_unita_locali_tenant_progressivo_mud_key")`.
2. Migration nell'ordine: commento iniziale (D4, D5, D21); `ALTER TABLE` delle 7 colonne; CHECK
   `rentri_unita_locali_cap_check`, `_provincia_check`, `_numero_addetti_check`,
   `_progressivo_mud_check`; backfill D4; indice unico; funzione
   `rentri_unita_locali_assegna_progressivo_mud()` (plpgsql, **`VOLATILE` scritto
   esplicitamente**, `IF NEW.progressivo_mud IS NULL`: advisory lock D4,
   `COALESCE(MAX(progressivo_mud), 0) + 1` sullo stesso `tenant_id`) e trigger
   `rentri_unita_locali_progressivo_mud` `BEFORE INSERT FOR EACH ROW`. Nessun GRANT (default
   privileges). Note nel commento: la funzione gira come chi inserisce; con la RLS vede solo le
   righe del tenant del contesto, che coincide con `NEW.tenant_id` (altrimenti l'insert è già
   rifiutato dalla policy); il ruolo di sistema ha `BYPASSRLS` e il filtro su `tenant_id` lo
   tiene corretto; `VOLATILE` serve perché un `INSERT` di più righe veda le precedenti; il
   codice liberato (D4).
3. Servizio: `RentriUnitaLocale` (interfaccia `:10-22`) e `toPlain` con i 7 campi;
   `UpdateRentriUnitaLocaleInput` e `update` (`:119-152`) accettano `indirizzo`, `civico`, `cap`,
   `comune`, `provincia`, `numeroAddetti` (stringhe `trim`, vuota → `null`; `provincia`
   maiuscola; `cap` 5 cifre e `provincia` 2 lettere, altrimenti `BadRequestException` con
   messaggio in italiano; `numeroAddetti` intero ≥ 0 o `null`). `progressivoMud` **non** è
   modificabile. `create` e `upsertFromRentri` non cambiano (il trigger assegna il codice).
4. DTO: i 6 campi `@IsOptional()`, `@ValidateIf(v => v !== null)`, `@IsString()`/`@MaxLength`
   (255/20/5/100/2); CAP con `@Matches(/^(\d{5})?$/)` (la stringa vuota passa e il servizio la
   rende `null`, M1); provincia con `@Matches(/^([A-Za-z]{2})?$/)`; `@IsInt() @Min(0)` per gli
   addetti; `@ApiPropertyOptional` in italiano.
5. Test unitari (nomi):
   - `'update: salva indirizzo, civico, CAP, comune, provincia maiuscola e addetti'`;
   - `'update: stringa vuota diventa null'`, `'DTO: CAP vuoto ammesso e poi salvato come null'`;
   - `'update: CAP non di 5 cifre → 400'`, `'update: provincia non di 2 lettere → 400'`,
     `'update: addetti negativi → 400'`;
   - `'update: progressivoMud non è fra i campi aggiornabili'`;
   - controller: `'PUT :id passa i campi dell'anagrafica al servizio'`.
6. `unita-locali-mud.postgres.spec.ts` (guard D19; modello
   `src/application/registro/registro-migrazione.postgres.spec.ts:1-60`: database usa e getta,
   migration precedenti, dati vecchi, poi la nuova con `prisma db execute`):
   - `'backfill: la principale prende 1, le altre seguono per data di creazione'`;
   - `'backfill: i progressivi ripartono da 1 per ogni azienda'`;
   - `'trigger: una sede nuova prende il massimo dell'azienda più 1'` (anche come
     `wasteflow_app` nel `TenantContext`);
   - `'trigger: createMany di tre sedi dà tre progressivi consecutivi'` (M2);
   - `'trigger: upsertFromRentri assegna i progressivi alle sedi nuove e non tocca le esistenti'`
     (M2, col servizio vero);
   - `'trigger: un progressivo esplicito non viene sovrascritto'`;
   - `'unico: due sedi della stessa azienda con lo stesso progressivo → violazione'`;
   - `'CHECK: CAP, provincia, addetti negativi, progressivo 0 respinti'`;
   - `'cambiare la principale non cambia i progressivi'` (via `setPrincipale`).
7. `ops/README.md`: ripristino (commento della migration) e nota "i codici delle unità locali
   del MUD non vanno rinumerati a mano".
8. Verifiche dei vincoli globali (migration). Commit:
   `feat(rentri): indirizzo, addetti e codice MUD delle unità locali`.

## Task 2a: oracolo, descrizione della causale, equivalenza unitaria

**Dipende da 1.** **File:** `src/application/mud/aggregazione/mud-aggregazione-a2bf11e.oracolo-spec.ts`
(nuovo), `aggregazione/mud-prisma-finto.fixture-spec.ts` (nuovo),
`aggregazione/mud-aggregazione-equivalenza.spec.ts` (nuovo), `mud-aggregazione.service.ts` (solo
D13 in `rif()`), `mud-controlli.ts` (solo D13), `mud-controlli.spec.ts`,
`mud-aggregazione.service.spec.ts` (solo attese di `CAUSALE_ESCLUSA`),
`src/application/registro/lettori-movimenti.spec.ts` (solo la voce di `LETTORI`),
`jest.config.js` (solo `collectCoverageFrom`, M7).

1. **Prima di ogni modifica**:
   `git show a2bf11e:apps/backend/src/application/mud/aggregazione/mud-aggregazione.service.ts > apps/backend/src/application/mud/aggregazione/mud-aggregazione-a2bf11e.oracolo-spec.ts`,
   poi solo: classe rinominata `MudAggregazioneOracoloA2bf11e`, `@Injectable()` tolto, la
   deviazione C1 di D11 (costruttore con `produzione`, corpi delegati di `caricaDestinatari` e
   `caricaTrasportatori`), commento in testa ("copia di a2bf11e per i test di equivalenza F2-8;
   unica deviazione: le anagrafiche vengono dal servizio di produzione, vedi piano D11/D17; non
   modificare altro"). Voce in `LETTORI`.
2. `jest.config.js` `collectCoverageFrom`: aggiungere `'!**/*.oracolo-spec.ts'`,
   `'!**/*.fixture-spec.ts'`, `'!**/*.postgres-spec.ts'` (M7).
3. `mud-prisma-finto.fixture-spec.ts`: il prisma finto dei vincoli globali (vigenza con
   `vigente`, `groupBy` reale per `args.by`, query distinte per `where` come
   `mud-aggregazione.service.spec.ts:62-82`, `registroRifiuti`, `rentriUnitaLocale`,
   `giacenzaIniziale`, `autorizzazioneImpianto.count`, `causaleRegistro*`).
4. D13: `causaleDescrizione` in `RifMovimento` e in `rif()`; `causaleEsclusa` come D13.
   Test in `mud-controlli.spec.ts`: `'CAUSALE_ESCLUSA mostra la descrizione della causale'` (testo
   esatto con `causale "Altro carico"`), `'CAUSALE_ESCLUSA senza descrizione mostra il codice'`
   (testo di oggi); in `mud-aggregazione.service.spec.ts` aggiornare le attese di
   `CAUSALE_ESCLUSA` e aggiungere `'una causale aziendale esclusa mostra la propria descrizione'`.
5. `mud-aggregazione-equivalenza.spec.ts` (unitario, gira in CI): almeno 12 scenari scritti a
   mano col prisma finto: produzione e avvio R/D, FIR collegabile/annullato/bozza/non trovato,
   doppi nello stesso anno e con l'anno prima, FIR scaricato più volte, unità non di massa con e
   senza peso specifico, unità vuota, causale esclusa, ricevuto da terzi, destinatario dalle
   integrazioni, estero, stato fisico misto, aperture e saldi positivi, un movimento non vigente,
   due registri, azienda senza ATECO. Per ogni scenario confronto D11 (multiinsieme dei
   controlli, eccezione `CAUSALE_ESCLUSA`) fra servizio e oracolo **costruito col servizio**
   (`new MudAggregazioneOracoloA2bf11e(prisma, referenceData, logger, servizio)`).
6. Commit: `test(mud): oracolo di a2bf11e e descrizione della causale nei controlli`.

## Task 2b: aggregazione divisa in gruppi (nessun cambio di comportamento)

**Dipende da 2a.** **File:** `mud-aggregazione.service.ts`, `mud-aggregazione-equivalenza.spec.ts`,
`aggregazione/mud-seed.postgres-spec.ts` (nuovo, D17 punto 4),
`aggregazione/mud-aggregazione-equivalenza.postgres.spec.ts` (nuovo).

1. Scomposizione di `aggrega` in metodi privati, **stesse istruzioni nello stesso ordine**:
   `caricaContesto` (tutte le letture `:195-314`), `individuaDoppi` (passo 0 `:335-380`),
   `aggregaGruppo(movimenti, contesto, condivisi, controlli, sede?)` (passi 1-6 `:407-511` e
   `completaRighe` `:553`, con le strutture D14), coda globale (`:513-551` con `inclusi` e
   `avviatiPerFir` di `condivisi`, `:555-588`). Firme nuove di `completaRighe` e `completaTe`
   come D14. In questo task c'è un solo gruppo (tutti i movimenti). `caricaDestinatari` e
   `caricaTrasportatori` restano dove sono e come sono (D17).
2. `mud-seed.postgres-spec.ts`: `creaSoggettoMud` (destinatario o trasportatore con le colonne di
   oggi) e i seed comuni (azienda, sede, registro, aperture, movimenti, FIR con firma del
   trasportatore).
3. `mud-aggregazione-equivalenza.postgres.spec.ts` (guard D19, `wasteflow_app`): un'azienda con
   una sede, registro, giacenze iniziali, ~30 movimenti su due anni (vigenti, una rettifica, un
   annullamento, causali di sistema e una aziendale), FIR; confronto D11 per gli anni 2025 e 2026.
4. L'equivalenza unitaria del Task 2a, `mud-aggregazione.service.spec.ts` e gli spec Postgres MUD
   esistenti passano **senza modifiche alle attese**.
5. Commit: `refactor(mud): aggregazione divisa in gruppi con strutture condivise`.

## Task 3a: regole delle dichiarazioni e controlli nuovi (funzioni pure)

**Dipende da 2b.** **File:** `aggregazione/mud-dichiarazioni.ts` (nuovo) + `.spec.ts`,
`aggregazione/mud-registri.ts` (+ funzione `sediDeiRegistri`) + spec, `mud-controlli.ts` (+ spec).

1. `mud-registri.ts`: `sediDeiRegistri(prisma, tenantId): Promise<Map<string, string | null>>`
   (registro → `unitaLocaleId`), una query su `registroRifiuti` (non legge movimenti).
2. `mud-dichiarazioni.ts` (puro): tipi `MudDichiarazione`, `MudUnitaLocaleAnagrafica`,
   `ContestoSedi`; `dichiarazioneDelRegistro(registroId, contestoSedi)` (D2, **unica**);
   `attribuisciSedi(movimenti, contestoSedi)` che la usa (gruppi, movimenti senza sede
   attribuiti, mancanza della principale); `codiceUnitaLocale(progressivo)` (15 cifre, con
   l'ordinamento di ripiego D4 per i NULL); `anagraficaDichiarazione(ul, unica, tenant)` (D5,
   senza ISTAT); `campiMancanti(ul)`; `provinceDiverse(dichiarazioni)` (D6);
   `dichiarazionePerAllegati(dichiarazioni)` (D7: AU alla principale o alla prima per codice,
   AR/INT alla prima per codice).
3. `mud-controlli.ts`: i controlli di D16 tranne i tre di giacenza e il testo di
   `riepilogaAvvisi` (Task 4), `MudCodiceControllo` aggiornato, campo `sede?` (D14),
   `etichettaGiacenza(cer6)` esportata (usata nel Task 4). Test del testo esatto di ognuno.
4. Test di `mud-dichiarazioni.spec.ts` (nomi): `'D2: registro con sede'`, `'D2: senza sede e
   senza unità locali → azienda, codice 1'`, `'D2: senza sede con principale → principale'`,
   `'D2: senza sede senza principale → nessuna dichiarazione e mancanza segnalata'`,
   `'D2: registro sconosciuto come senza sede'`, `'D4: codici a 15 cifre e ripiego per NULL'`,
   `'D5: anagrafica della sede completa'`, `'D5: principale senza indirizzo usa l'azienda'`,
   `'D5: addetti con una o più dichiarazioni'`, `'D6: province diverse'`, `'D7: AU alla
   principale'`, `'D7: AU alla prima per codice se la principale non ha pacchetto'`, `'D7: AR e
   INT al primo pacchetto'`.
5. Commit: `feat(mud): regole delle dichiarazioni per unità locale`.

## Task 3b: dichiarazioni per unità locale nel servizio (versione 2, senza giacenze)

**Dipende da 3a.** **File:** `mud-aggregazione.service.ts`, `mud-aggregazione.service.spec.ts`,
`mud-aggregazione-equivalenza.spec.ts`, `aggregazione/mud-aggregazione-sedi.postgres.spec.ts`
(nuovo), `aggregazione/mud-aggregazione-causali.postgres.spec.ts` (solo la riga `:134`, D19).

1. Contesto (versione 2): tutte le unità locali dell'azienda, attive o no, con id,
   denominazione, `numIscrSito`, `principale`, `createdAt`, i campi D5 e `progressivoMud`
   (query **separata** da quella di oggi `:293-297`, che resta per la versione 1);
   `sediDeiRegistri`; `autorizzazioneImpianto.count({ where: { tenantId } })`.
2. Versione 2: un `aggregaGruppo` per dichiarazione, in ordine di codice, con `condivisi` unici
   (D14); controlli dei gruppi con `sede` solo con più di una dichiarazione, mai su quelli dei
   soggetti; ISTAT dell'unità locale con cache per `(comune, provincia)`; controlli D2, D5, D6,
   D7; niente `PIU_UNITA_LOCALI`; giacenze **ancora** come oggi (`GIACENZE_NON_CALCOLATE`
   sull'intera azienda: si sostituisce nel Task 4). Versione 1 = Task 2b (un gruppo),
   `dichiarazioni` con una sola voce "fusa" (codice 1, anagrafica `null`). `MudAggregato` come
   D15.
3. `mud-aggregazione.service.spec.ts`: mock predefiniti con una sede vera
   (`{ id: 'ul-1', denominazione: 'Sede', numIscrSito: 'OP1', principale: true, attiva: true,
   progressivoMud: 1, createdAt, indirizzo: null, civico: null, cap: null, comune: null,
   provincia: null, numeroAddetti: null }`) e il registro `reg-A` legato a `ul-1`
   (`{ id: 'reg-A', unitaLocaleId: 'ul-1', descrizione: 'Registro Sede', unitaLocale: {
   denominazione: 'Sede' } }`); le attese esistenti restano (versione 2, una sede), con queste
   **eccezioni (I6)**:
   - i test di `PIU_UNITA_LOCALI` e di `GIACENZE_NON_CALCOLATE` passano a `{ versioneCalcolo: 1 }`;
   - lo scenario `dueRegistri` (`:729-782`): i due registri sono legati a due sedi del mock, oppure
     (dove il test verifica i numeri con un registro senza sede) l'attesa aggiunge
     `MOVIMENTI_SENZA_SEDE`;
   - i test sul saldo (`:1292-1362`) usano un `groupBy` discriminato per `args.by` (quello con
     `registroId` per la 2, quello di oggi per la 1).
   Nuovi test (nomi):
   - `'v2: due sedi danno due dichiarazioni con codici 000000000000001 e 000000000000002'`;
   - `'v2: lo stesso CER in due sedi dà due righe, una per dichiarazione'`;
   - `'v2: registro senza sede con principale → sulla principale con MOVIMENTI_SENZA_SEDE'`;
   - `'v2: azienda senza unità locali → una dichiarazione azienda con codice 1'`;
   - `'v2: unità locali senza principale e registro senza sede → SEDE_PRINCIPALE_MANCANTE'`;
   - `'v2: seconda sede senza indirizzo → UNITA_LOCALE_SENZA_INDIRIZZO con i campi mancanti'`;
   - `'v2: principale senza indirizzo: azienda; con due dichiarazioni PRINCIPALE_CON_INDIRIZZO_AZIENDA'`;
   - `'v2: comune della sede non trovato → UNITA_LOCALE_SENZA_COMUNE_ISTAT'`;
   - `'v2: sedi in province diverse → UNITA_LOCALI_PROVINCE_DIVERSE'`;
   - `'v2: autorizzazioni e due dichiarazioni → AUTORIZZAZIONI_SULLA_PRINCIPALE'` e
     `'… con la principale senza pacchetto il testo nomina la prima sede e il motivo'`;
   - `'v2: una sede cessata con movimenti nell'anno ha la sua dichiarazione'`;
   - `'v2: una sede senza righe non ha dichiarazione'`;
   - `'v2: addetti mancanti con due dichiarazioni → 0 e UNITA_LOCALE_SENZA_ADDETTI'`;
   - `'v2: i controlli di un gruppo portano la sede solo con più dichiarazioni'`;
   - `'v2: un destinatario senza CF in due sedi dà un solo controllo, senza sede'`;
   - `'v2: FIR scaricato in due sedi → FIR_SCARICATO_PIU_VOLTE una volta'` (I1);
   - `'v1: identica all'oracolo anche con due sedi (tutto sulla principale, PIU_UNITA_LOCALI)'`.
4. Equivalenza (unitaria): ogni scenario del Task 2a anche in versione 2 con una sede, attese
   D11 (le giacenze sono ancora quelle di oggi, quindi qui la 2 con una sede = oracolo salvo
   `PIU_UNITA_LOCALI`, `MOVIMENTI_SENZA_SEDE` e `CAUSALE_ESCLUSA`).
5. `mud-aggregazione-sedi.postgres.spec.ts` (guard D19, `wasteflow_app`, seed D17): due sedi, due
   registri più un registro senza sede, movimenti in ciascuno, un'altra azienda con dati che non
   devono comparire; attese scritte a mano per dichiarazioni, codici, righe e controlli.
6. Commit: `feat(mud): una dichiarazione per unità locale`.

## Task 4: giacenze al 31/12 per sede e CER

**Dipende da 3b.** **File:** `aggregazione/mud-giacenze.ts` (nuovo, puro, + `.spec.ts`),
`mud-aggregazione.service.ts` (`saldiAl31Dicembre`, coda della versione 2),
`mud-controlli.ts` (+ spec), `aggregazione/mud-integrazioni.ts` (+ spec: solo tipo e lettura),
`mud-aggregazione.service.spec.ts`, `mud-aggregazione-equivalenza.spec.ts`,
`mud-aggregazione-saldi.postgres.spec.ts`, `mud-aggregazione-giacenze.postgres.spec.ts` (nuovo).

1. `saldiAl31Dicembre` → `saldiAl31DicembrePerRegistro(tenantId, fine, anno)`:
   `groupBy(['registroId','cerCode','type','unit'])` + aperture per `registroId`, risultato
   `Array<{ registroId, cerCode6, kg, pericoloso }>` **senza** filtro di positività (lo applica il
   chiamante dopo aver sommato). La versione 1 somma per CER fra tutti i registri, filtra
   > 0,0005, ordina e produce esattamente l'elenco di oggi (`:652-658`). Seconda query D8 per i
   carichi `RICEVUTO_DA_TERZI`, con il commento sul limite `_min`/`_max` (M4).
2. `IntegrazioniMud.destinazioniGiacenza: Record<string, { cerCode: string; unitaLocaleId: string | null; destinazione: 'R' | 'D' }>`,
   in `INTEGRAZIONI_VUOTE` e in `leggiIntegrazioni` (voce valida solo con `destinazione` `R` o
   `D` e `cerCode` stringa); `chiaveGiacenza(unitaLocaleId, cer6)` (D9).
3. `mud-giacenze.ts` (puro): `giacenzeDelleDichiarazioni(saldi, contestoSedi, dichiarazioni,
   ricevutiDaTerzi, integrazioni)`; ogni saldo si attribuisce con `dichiarazioneDelRegistro`
   (D2/D8, la stessa funzione dei movimenti); restituisce per ogni dichiarazione le righe con i due
   campi valorizzati **solo se > 0** (D8; nuovi oggetti, mai mutare quelli dell'aggregato), le
   voci non dichiarate con motivo, gli esiti della ripartizione. Test (nomi): `'D8: saldo scritto
   nella riga della stessa sede'`, `'D8: saldo di un registro senza sede sulla principale'` (I8),
   `'D8: CER senza riga → non dichiarata'`, `'D8: ricevuto da terzi → non dichiarata'`, `'D8:
   saldo sotto mezzo grammo ignorato'`, `'D8: componente nulla assente dalla riga, mai 0'`, `'D9:
   integrazione R vince'`, `'D9: solo recupero'`, `'D9: solo smaltimento'`, `'D9: entrambi,
   proporzione al grammo e somma esatta'`, `'D9: nessun avvio → smaltimento'`, `'D9:
   integrazione di un'altra sede non vale'`.
4. Versione 2: righe con le giacenze, `GIACENZE_NON_DICHIARATE` (uno per dichiarazione con
   voci), `GIACENZA_RIPARTITA`, `GIACENZA_DESTINAZIONE_NON_INDICATA` (D16, con `sede` D14 e
   `integrazione`); i due `GIACENZA_*` **non** in `CODICI_RIPARTIZIONE_RD` (D9);
   `GIACENZE_NON_DICHIARATE` fuori da `cambianoQuantita` come `GIACENZE_NON_CALCOLATE`
   (`mud-controlli.ts:582-587`); testo di `riepilogaAvvisi` di D16. Test: `'GIACENZE_NON_DICHIARATE
   conta in kgInMeno ma non cambia le quantità'`, `'con i soli avvisi di giacenza cambianoQuantita
   è false'`, `'testo del riepilogo con la sola GIACENZA_RIPARTITA'` (testo esatto D16),
   `'GIACENZA_DESTINAZIONE_NON_INDICATA non riserva la conferma agli amministratori'`.
5. Test del servizio (nomi): `'v2: giacenza al 31/12 nella riga BA con recupero e smaltimento'`,
   `'v2: le giacenze iniziali entrano nel saldo della loro sede'`, `'v2: un movimento rettificato
   o annullato conta solo se vigente'` (campo `vigente` del prisma finto), `'v2: giacenze di due
   sedi restano separate'`, `'v2: tonnellate convertite, litri esclusi'`, `'v2: riga senza
   giacenza ha lo stesso hashAggregato di oggi'` (I4), `'v1: GIACENZE_NON_CALCOLATE identico
   all'oracolo'`.
6. Equivalenza: attese complete di D11 per la versione 2 con una sede (incluso il controllo
   "giacenze scritte + kgNonDichiarati = kgNonDichiarati dell'oracolo").
7. `mud-aggregazione-giacenze.postgres.spec.ts` (guard D19, seed D17): confine dell'anno italiano
   (scarico alle 23:30 UTC del 31/12 → anno dopo), Decimal, apertura del 31/12 inclusa e del 1/1
   esclusa, rettifica e annullamento, due sedi, un registro senza sede, un carico
   `INGRESSO_ESTERNO` dell'anno prima, unità `T` e `L`; valori attesi a mano.
   `mud-aggregazione-saldi.postgres.spec.ts` resta verde (adattare solo il nome del metodo
   privato se lo chiama).
8. Commit: `feat(mud): giacenze al 31/12 per sede e CER, con recupero e smaltimento`.

## Task 5a: fixture del file di oggi, poi il generatore a più pacchetti

**Dipende da 4.** **File:** `export/mud-tracciato-v604-legacy.fixture-spec.ts` (nuovo),
`export/mud-export.types.ts`, `export/versions/mud-tracciato-v604-base.ts`,
`export/mud-tracciato-v604.conformita.spec.ts`, `export/mud-export.spec.ts`.

1. **Prima di toccare il generatore** (M8): due `MudExportData` fissi scritti nel file della
   fixture (uno completo: righe con DR, TE, stato fisico, AU con discariche, `sostituisce`; uno
   minimo), entrambi con `generatedAt` fisso (`new Date('2026-03-15T09:30:00Z')`). Si producono
   le stringhe con un test temporaneo non versionato
   (`export/stampa-fixture.tmp.spec.ts`) che, per **ciascuno dei due tracciati** (`registry.getForYear(2024)`
   = 6.04/24 e `getForYear(2025)` = 6.04/25) e per ciascun dato, stampa
   `JSON.stringify(tracciato.generate(dato))`; le quattro stringhe si incollano nella fixture
   come costanti esportate, poi il test temporaneo si cancella (verificare con `git status` che
   non resti). La fixture finisce in `spec.ts` ma non in `.spec.ts` (esclusa da tsc e jest, come
   l'oracolo). Commit separato: `test(mud): fixture del file telematico di a2bf11e`.
2. Tipi: `MudUnitaLocaleAnagrafica { via?; civico?; cap?; comune?; provincia?; comuneCode?;
   numeroAddetti: number }`; `MudDichiarazioneExport { progressivoUnitaLocale: number;
   unitaLocale: MudUnitaLocaleAnagrafica | null; rifiuti: MudRifiutoLine[]; conAutorizzazioni:
   boolean; conAllegatiAzienda: boolean }`; `MudExportData.dichiarazioni?: MudDichiarazioneExport[]`
   (assente = un pacchetto come oggi). `rifiuti` resta (con `dichiarazioni` è la concatenazione e
   non si usa).
3. Generatore: `generate` emette un pacchetto per dichiarazione (D1) nell'ordine dato, con un
   tipo interno `DatiPacchetto = MudExportData & { pacchetto?: MudDichiarazioneExport }` passato
   ai metodi esistenti; nella vista del pacchetto `autorizzazioni` vale solo con
   `conAutorizzazioni`, `riciclaggio` e `intermediazioni` solo con `conAllegatiAzienda` (D7), così
   `recordAB` conta da sé solo ciò che il pacchetto contiene; `unitaLocale(data)` restituisce
   `mudNum(data.pacchetto?.progressivoUnitaLocale ?? 1, 15)`; `recordAA` usa per il blocco "unità
   locale" `data.pacchetto?.unitaLocale ?? azienda` (ISTAT da `comuneCode` dell'unità locale) e
   per gli addetti quelli dell'unità locale, il blocco "sede legale" sempre l'azienda; le schede
   INT (DA/DB) escono dopo le schede RIF del loro pacchetto. XX conta tutto il corpo
   (invariato). Le sottoclassi 2024/2025 compilano senza modifiche.
4. Test di conformità (nomi): `'senza dichiarazioni il file è byte-identico alla fixture (6.04/24
   e 6.04/25)'`, `'una dichiarazione di codice 1 e anagrafica dell'azienda = file della
   fixture'`, `'due dichiarazioni: sequenza XX, AA, AB, AU, BA, BB, AA, AB, BA, BB'`, `'chiave di
   ogni record con il codice della sua unità locale'`, `'AA della seconda sede: indirizzo della
   sede, sede legale dell'azienda, addetti della sede'`, `'AB del secondo pacchetto: 00 AUT e 00
   RIC'`, `'AU nel pacchetto indicato anche se non è il primo'`, `'XX conta i record di tutti i
   pacchetti'`, `'lunghezze di tutti i record invariate'`, `'BA scrive le giacenze a recupero e a
   smaltimento; giacenza assente = 0'`.
5. Commit: `feat(mud): file telematico con una dichiarazione per unità locale`.

## Task 5b: hash ed export

**Dipende da 5a.** **File:** `aggregazione/mud-regole.ts` (+ spec), `export/mud-export.service.ts`
(+ spec), `export/mud-dichiarante.ts` (solo tipi, se serve), `api/mud/mud.controller.export.spec.ts`.

1. `mud-regole.ts`: normalizzazione delle righe estratta da `hashAggregato` in una funzione
   privata condivisa (valore invariato: test `'hashAggregato invariato su un caso fisso'` con
   l'hash scritto a mano prima della modifica); `hashDichiarazioni(dichiarazioni)`;
   `hashDichiarante` con `unitaLocali` facoltativo (assente → valore di oggi, test con hash
   fisso); `hashCalcoloMud(aggregato)` e `hashDichiaranteMud(dichiarante, aggregato)` (D10).
   Test: `'una dichiarazione di codice 2 entra in hashDichiarazioni e cambia l'hash'` (I4),
   `'due dichiarazioni: hash indipendente dall'ordine di lettura'`, `'una dichiarazione di codice 1
   senza giacenze: hashCalcoloMud = hashAggregato'`.
2. `mud-export.service.ts`: `data.dichiarazioni` dalle dichiarazioni dell'aggregato (D5, D7);
   voce con `versioneCalcolo`, `hashAggregato: hashCalcoloMud(…)`, `hashDichiarante:
   hashDichiaranteMud(…)`; log e `ActivityLog` con il numero di dichiarazioni. Test: `'la voce
   salva versioneCalcolo 2'`, `'con due sedi il file ha due pacchetti'`, `'con una sede senza
   giacenze l'hash è quello di hashAggregato'`, `'con i soli avvisi di giacenza un utente non
   amministratore genera il file dopo la conferma'` (D9), e i test esistenti di
   `PIU_UNITA_LOCALI` riscritti sui controlli della versione 2.
3. Commit: `feat(mud): hash e versione del calcolo nell'esportazione`.

## Task 6: presentazione, totali condivisi e riepilogo

**Dipende da 5b.** **File:** `mud-presentazione.service.ts` (+ spec + `.postgres.spec.ts`),
`src/application/mud/mud-totali.ts` (nuovo) + `.spec.ts`, `mud-generator.service.ts` (+ spec),
`api/mud/mud.controller.ts` (solo tipi di ritorno, se servono) (+ `mud.controller.presentazione.spec.ts`),
`mud-report-data.ts` (solo se serve una funzione di lettura della versione),
`api/pdf/pdf.controller.ts`/`infrastructure/pdf/pdf.service.ts` (nessuna modifica attesa:
verificare che compilino e che il PDF non cambi).

1. `stato()` (`:103-158`): `versioneCalcolo` della presentazione da `reportData.versioneCalcolo`
   (numero intero 1 o 2; altrimenti 1); `aggrega(…, { versioneCalcolo })`; confronto con
   `hashCalcoloMud` e `hashDichiaranteMud` di quella versione; risposta con `versioneCalcolo`
   (null se non presentato) e `versioneCalcoloAttuale`.
2. `segnaPresentato` (`:164-283`): `versioneCalcolo` dalla voce scelta (assente → 1); se l'hash
   della voce manca e si usa l'hash attuale (`:238`), o senza file, la versione è
   `VERSIONE_CALCOLO_MUD` (M6, D10); salvata in `reportData` e nella traccia dell'`ActivityLog`.
   `annullaPresentazione`: la copia nella voce di `annullamenti` e la azzera.
3. `mud-totali.ts` (D22, puro) e spec (nomi): `'totali di testa = somma delle dichiarazioni'`,
   `'per CER del file: lo stesso CER di due sedi sommato, asterisco se pericoloso in una delle
   due'`, `'stessi numeri dei record BA'` (generare il file con il tracciato 6.04/25 e rileggere
   prodotto, recupero, smaltimento e giacenze di ogni BA: uguali a `perCer` di ogni
   dichiarazione), `'prodotto uguale all'aggregazione MUD sugli stessi movimenti'` (somma di
   `prodottoKg` delle righe dell'aggregato = `totali.prodottoKg`, su uno scenario del prisma
   finto con valori attesi scritti a mano), `'arrotondamento al grammo'`, `'versioneCalcolo
   riportata'`.
4. Riepilogo (`mud-generator.service.ts:41-81`): usa `totaliMud`; D15 (`dichiarazioni`,
   `recoveryKg`/`disposalKg` e giacenze per CER, `versioneCalcolo`, `versionePresentata` letta da
   `MUDReport` per gli anni `SUBMITTED` o `ARCHIVED`, `null` altrimenti o se uguale
   all'attuale). Metodo pubblico `totaliAnno(tenantId, anno)` (D22). Nessuna rotta nuova.
   **Aggiunta per la vista "Bilancio" (branch `feat/demo-bilancio`):** esportare da
   `mud-regole.ts` una funzione pura `operazioneDelMovimento(...)` con la precedenza oggi chiusa
   nel metodo privato `recuperoOSmaltimento` di `MudAggregazioneService` (il metodo la chiama,
   comportamento identico: gli spec esistenti non cambiano), con spec per ogni gradino. Il
   Bilancio la userà al posto della sua copia `operazionePreliminare`. Non cambiare le firme già
   esportate da `mud-regole.ts`/`mud-controlli.ts` senza annotarlo nel rapporto del task: il
   Bilancio le importa.
5. Test (nomi): `'stato: un MUD presentato senza versioneCalcolo si confronta con la versione 1 e
   non risulta modificato dopo le giacenze nuove'` (unitario e Postgres: presentazione salvata
   con l'hash dell'oracolo, poi giacenze al 31/12 nel registro → `datiModificatiDopoPresentazione`
   false), `'stato: con versione 2 una rettifica dopo la presentazione risulta'`, `'segna: copia
   la versione della voce'`, `'segna: hash di ripiego con la versione attuale'`, `'segna senza
   file: versione attuale'`, `'annulla: conserva la versione nello storico'`, `'riepilogo: due
   sedi, totali in testa uguali alla somma'`, `'riepilogo: versionePresentata solo per un anno
   presentato con una versione diversa'`, `'riepilogo: una sede, wasteProduced come oggi più
   recupero, smaltimento e giacenze'`, `'totaliAnno restituisce gli stessi numeri del
   riepilogo'`, `'PDF: stesso contenuto con una sede'` (spec esistente del PDF verde).
6. Commit: `feat(mud): presentazione legata alla versione del calcolo, totali e riepilogo per sede`.

## Task 7: integrazione della destinazione delle giacenze

**Dipende da 6.** **File:** `api/mud/dtos/integrazioni-mud.dto.ts`, `mud-integrazioni.service.ts`
(+ spec), `api/mud/mud.controller.integrazioni.spec.ts`.

1. DTO: `destinazioniGiacenza?: VoceDestinazioneGiacenzaDto[]` (`cerCode` stringa, 6 cifre dopo
   `cerSoloCifre`; `unitaLocaleId` UUID o null; `destinazione` `@IsIn(['R','D'])`), facoltativo
   (assente = elenco vuoto: il PUT sostituisce tutto, come le altre voci).
2. Servizio: `unitaLocaleId` non nullo deve essere una sede dell'azienda (query per `tenantId`,
   altrimenti `BadRequestException` "Unità locale non trovata", senza id nel messaggio); chiave
   `chiaveGiacenza`; tipo `DESTINAZIONE_GIACENZA` in `TipoModificaIntegrazione` e in
   `differenzeIntegrazioni` (valore `R → "recupero"`, `D → "smaltimento"`); il GET aggiunge
   `unitaLocali: Record<unitaLocaleId, denominazione>` accanto a `registri` (M10).
3. Test (nomi): `'salva la destinazione della giacenza e la registra in ActivityLog'`,
   `'destinazione diversa da R o D → 400'`, `'sede di un'altra azienda → 400'`, `'PUT senza
   destinazioniGiacenza le toglie'`, `'il GET restituisce le unità locali'`, `'il calcolo usa la
   destinazione salvata'` (servizio di aggregazione con integrazioni lette dal record).
4. Commit: `feat(mud): integrazione della destinazione delle giacenze al 31/12`.

## Task 8a: frontend, anagrafica delle unità locali

**Dipende da 1** (eseguito qui per D20). **File:**
`apps/frontend/src/app/features/rentri/rentri-unita-locale.service.ts`,
`rentri-unita-locale.component.ts` (+ spec).

1. Modello con i 7 campi (`progressivoMud` solo lettura); `UpdateRentriUnitaLocale` con i 6
   modificabili.
2. Componente: per ogni sede un pulsante "Dati per il MUD" (solo `SUPER_ADMIN`/`ADMIN`, stessa
   regola delle altre azioni della pagina) che apre un `p-dialog` con indirizzo, civico, CAP,
   comune, provincia, addetti; validazione CAP/provincia come il backend (CAP vuoto ammesso);
   salva con `update`; nella riga della sede il codice MUD (`Codice MUD 2`) e un'etichetta
   "Indirizzo per il MUD mancante" se la sede non è la principale e manca un campo;
   `data-testid` coerenti con quelli esistenti (`rentri-unita-locale-…`).
3. Test Karma (nomi): `'apre i dati MUD precompilati'`, `'CAP non valido blocca il salvataggio'`,
   `'CAP vuoto si salva'`, `'salva e aggiorna la riga'`, `'mostra l'avviso di indirizzo mancante
   solo per le sedi non principali'`, `'un utente non amministratore non vede il pulsante'`.
4. Commit: `feat(frontend): dati MUD delle unità locali`.

## Task 8b: frontend, pagina MUD per sede

**Dipende da 7 e 8a.** **File:** `apps/frontend/src/app/features/mud/mud.service.ts`,
`mud.component.ts` (+ spec di entrambi).

1. Modelli: `MudControllo.sede?`, `MudRiepilogo` come D15, `StatoPresentazioneMud` con le
   versioni, `IntegrazioniMud.destinazioniGiacenza` e `unitaLocali`, `CorpoIntegrazioniMud` con
   `destinazioniGiacenza`, `MudIntegrazioneRichiesta` con `DESTINAZIONE_GIACENZA`;
   `etichettaGiacenza(cer6)` con lo stesso testo del backend (`Giacenza CER ${cer6}`) e uno spec
   che lo fissa (M5).
2. Integrazioni: le righe nascono da **ogni** controllo con `integrazione` (oggi solo dai
   bloccanti, `mud.service.ts:415`: gli avvisi attuali non hanno `integrazione`, quindi nulla
   cambia per loro); riga `etichettaGiacenza(cer6)` (con la sede fra parentesi, da
   `unitaLocali`, se ce n'è più di una) con una scelta Recupero/Smaltimento (`p-selectButton`);
   `righeSalvate` e corpo del PUT con le voci di destinazione. Una voce salvata che nessun
   controllo chiede più (per esempio legata alla vecchia principale dopo un cambio, o alla
   dichiarazione "azienda" dopo l'arrivo delle sedi) resta visibile con l'avviso `Voce non più
   usata: la giacenza ora è in un'altra dichiarazione (per esempio dopo un cambio della sede
   principale). Indicare di nuovo la destinazione nella riga corretta.` (M9, come
   `AVVISO_VOCE_SENZA_SEDE` `:303-304`).
3. Riepilogo (`mud.component.ts:232-427`): colonne "Recupero (kg)", "Smaltimento (kg)",
   "Giacenza a recupero (kg)" e "Giacenza a smaltimento (kg)" nella tabella per CER; con più
   dichiarazioni una sezione per sede (titolo `denominazione (codice MUD n)`, totali e tabella)
   sotto i totali generali, e la frase "Il file contiene N dichiarazioni, una per unità locale:
   ognuna paga il proprio diritto di segreteria."; etichetta della sede (`p-tag`) accanto ai
   controlli che la portano (bloccanti e `vociAvvisi` `:439+`); con `versionePresentata` la nota
   "Il MUD presentato è stato calcolato con le regole precedenti (registro unico, giacenze non
   dichiarate): i numeri qui sotto e un nuovo file seguono le regole attuali." Il testo fisso
   sul modulo RE (`:262-265`) resta.
4. Test Karma (nomi): `'mostra recupero, smaltimento e giacenze per CER'`, `'due sedi: una sezione
   per sede e la frase sul diritto di segreteria'`, `'una sede: nessuna sezione per sede'`,
   `'controllo con sede: etichetta visibile'`, `'riga di integrazione della giacenza da un avviso,
   salvata nel PUT'`, `'voce di giacenza non più usata con l'avviso'`, `'etichetta della riga
   uguale a quella del backend'`, `'nota della versione presentata'`.
5. Commit: `feat(frontend): MUD per unità locale con le giacenze al 31/12`.

## Task 9: verifica finale, roadmap e rapporto

**Dipende da tutti.** **File:** `C:\Progetti\winwaste\docs\roadmap-fase2-parita-registro.md`
(altro repository, nessun commit in questo worktree; eventuali correzioni del codice con commit
propri nei file dei task precedenti).

1. Backend: `npm run test:cov`, `npx tsc --noEmit -p tsconfig.json`, lint di fine task, suite
   Postgres "locale completa", `migrate diff` vuoto. Frontend: Karma, build, lint.
2. Prova manuale in locale (backend + frontend su 55436, dati seminati con i seed D17):
   un'azienda con una sede (il file confrontato con quello generato su `a2bf11e` con gli stessi
   dati: deve differire **solo** nei campi di giacenza dei record BA) e una con due sedi; salvare i
   due file in `C:\Users\manzo\AppData\Local\Temp\` a disposizione di Graziano per una prova
   successiva su `mudtelematico.it`.
3. Roadmap (I9): in §F2-8 lo stato "fatto" (dichiarazione per unità locale nello stesso file,
   codice persistito, anagrafica delle sedi, giacenze al 31/12 per sede e CER con R/D, versione
   del calcolo, totali condivisi) e i seguiti (RT/MG e ruoli del dichiarante in **Fase 4**; DR per
   la sede del destinatario scelta sul FIR **dopo F2-10**; file per provincia; scheda RIF per le
   sole giacenze); in §0.2 riga 41 aggiornare la voce MUD (giacenze calcolate; più sedi ripartite;
   RT/MG ancora non supportati).
4. Merge e deploy autonomi (D23) secondo la prassi dei pezzi della Fase 2.
5. Rapporto: test e conteggi, differenze dei file, punti di merge con F2-6 e F2-10 (D17-D19), e la
   frase esplicita: **"il file con più dichiarazioni non è stato provato su mudtelematico.it"**.

## Fuori ambito (seguiti)

- **Moduli RT e MG, profili impianto/trasportatore/intermediario** (D12): servono CF e ISTAT del
  conferente, flag privati/urbani/pile, tipologia d'impianto e operazioni svolte nell'unità
  locale, che il registro non ha. Fase 4 (gestori).
- **File per provincia** (D6): oggi bloccante.
- **Scheda RIF per i rifiuti con sola giacenza** (D8; WinWaste li chiede all'utente).
- **DR per sede del destinatario scelta sul FIR** (D17), dopo il merge di F2-10.
- **Anagrafica delle sedi dalla sincronizzazione RENTRI** (D5: `indirizzo`, `civico`,
  `comune_id` del sito), dopo aver verificato il formato di `comune_id`.
- **Autorizzazioni per sede** (D7): `AutorizzazioneImpianto` senza sede.
- **Giacenze in unità non di massa** (litri, m³) con il peso specifico delle integrazioni: oggi
  restano fuori dal saldo, come in tutti i saldi del registro.
- **Coerenza "prodotto + giacenza iniziale = avviato + giacenza finale"** (confronto 03 §7 riga
  227) come controllo del MUD.
- **Vista "Bilancio"** e sua rotta: un'altra sessione, sopra `totaliMud`/`totaliAnno` (D22).
- **PDF del riepilogo per sede** (oggi totali e CER di tutto il file).
- **Mesi di attività** (fissi a 12, `base.ts:361`), ATECO e REA per unità locale.
- **Legame manuale di un registro senza sede a una sede** (D2): oggi solo automatico.
- Parametrizzazione dei 4 guard di `application/registro/` (la fa F2-10, D19).
