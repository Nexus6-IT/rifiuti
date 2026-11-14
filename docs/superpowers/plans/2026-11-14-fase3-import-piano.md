# Fase 3 blocco 1: provenienza, blocco all'invio e staging da WinWaste — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa un task alla
> volta, opus rivede ogni task prima del successivo. Ordine STRETTAMENTE SEQUENZIALE (un solo
> worktree, un solo database di test, file condivisi: schema, `ruoli-db.sql`, conteggio RLS):
> vedi «Ordine» in fondo. Motivo: 16 GB di RAM e un solo processo pesante alla volta.
> Questo piano **non** contiene codice: dice cosa fare, dove e come si verifica.

**Obiettivo.** Preparare WasteFlow a ricevere dati da WinWaste senza alcun rischio di
ritrasmissione a RENTRI, e scrivere tutta la parte dell'import che si può verificare **senza un
`.bak` reale**: le colonne di provenienza, il lotto di import, il blocco all'invio di movimenti e
FIR importati (con i quattro test di non-trasmissione obbligatori), il motore di caricamento per
tenant, il formato di staging, i decodificatori dei formati posizionali e un analizzatore che
produce il lato «sorgente» del rapporto di riconciliazione. Nessun dato WinWaste entra nel
database applicativo in questo blocco.

**Architettura in breve.**
- **Schema (3.1).** Tre colonne immutabili `import_source`, `legacy_key`, `lotto_import_id` su
  `waste_movements`, `firs`, `ditte`, `sedi_ditte`, `produttori`, `trasportatori`, `destinatari`, con
  unico `(tenant_id, import_source, legacy_key)`. Tabella nuova `lotti_import` (RLS, 84 → 85).
  Movimenti: valore nuovo `DA_RICONCILIARE` di `stato_trasmissione_rentri` e origine `IMPORTAZIONE`;
  un movimento importato nasce **nella stessa transazione** con la sua riga 1:1 bloccata. FIR:
  colonne `bloccato_invio` e `motivo_blocco_invio` su `firs`, obbligatorie per i FIR importati.
- **Caricamento (infrastruttura di 3.3-3.5).** `application/migrazione/caricamento/`: lotti, blocchi
  con il tenant reimpostato a ogni transazione, `INSERT ... ON CONFLICT (tenant_id, import_source,
  legacy_key) DO NOTHING` con le righe saltate contate. In questo blocco lo si prova solo sulle
  ditte, con record costruiti nei test.
- **Staging ed estrazione (3.2, lato WasteFlow).** Formato di staging definito da noi (manifest +
  JSON Lines con i valori grezzi), lettore con verifica degli hash, decodificatori puri, parser per
  tabella con rapporto scarti, CLI `migrazione:analizza` che non apre il database. L'estrattore da
  SQL Server è l'ultimo task, opzionale, su un database sintetico.

**Stack.** NestJS 10, Prisma 5.22, PostgreSQL 16 (RLS FORCE, ruoli `wasteflow_app` /
`wasteflow_sistema` / `wasteflow_lettura`), Angular + PrimeNG per due etichette, `ts-node` per la
CLI. Nessuna dipendenza npm nuova (JSON Lines si legge con `readline`).

**Fonti.**
- Roadmap `/home/graziano/Progetti/winwaste/docs/roadmap-fasi3-4-import-gestori.md`: §1 (decisioni
  del 23 e 24/10: import a staging, idempotente, solo `INSERT`, a blocchi col tenant reimpostato,
  FIR importati bloccati anche nei job AUTOMATICA e IBRIDA), §4 regole fisse e 3.1-3.8, §6
  (ordine), §7 (D1, D3, D4, D12, domanda trasversale sul `.bak`), §8 (rischi), §9 (RLS, punti 1-6 e
  10-11), §10.
- Rapporto `/home/graziano/Progetti/winwaste/docs/confronto-rifiuti/04-piattaforma-e-migrazione.md`
  §4.1-4.8 (sorgenti, come estrarre, 12 passi, idempotenza, sei confronti, rischio di
  ritrasmissione, aspetti legali) e §6 (R6 modello pronto per l'import, R7 strumento di
  migrazione), §7 domande 4-6.
- Tabelle WinWaste: `docs/movimenti.md` §2.2 (86 posizioni + colonne di server), §2.3 (causali,
  registri, giacenze, magazzini), §2.4 (`OPER`), §2.5-2.6 (`RELAZ`, `LEGAME`, `GIASCAR`, `STATO`);
  `docs/formulari.md` §2.1-2.4 (101 colonne, `C4`, `C7`, `NUMERAZIONI`, `WWQRCODE`);
  `docs/giacenze.md` §2.1-2.5 (segmento `RELAZ` completo, righe `G0..G5`, `[GIACENZE RIFIUTI]`,
  `RenRelazioniIniziali`); `docs/contratti.md` §3 (solo per il fuori ambito);
  `docs/rentri/03-aggancio-a-winwaste.md` §2.2 (`VERSIS`), §3.1 (`RENregistrazioni`), §3.3 (siti);
  `docs/funzionalita.md` §3.1 (anagrafiche: una form, quattro ruoli P/T/S/I).
- Memoria: `rifiuti-decisioni-strategia.md` (import per tenant col ruolo normale, solo `INSERT`;
  3.2 e seguenti dopo la Fase 4) e `rifiuti-decisioni-31-10.md` (esclusione dall'invio automatico,
  interruttore di emergenza, codice rinnovo `O` convertito in `S` da 3.8, scaglioni).
- Codice reale verificato su `575efb64` (sotto).

## Perimetro: cosa si fa senza `.bak` e cosa no

La Fase 2 e la Fase 4 sono chiuse (F2-1, F2-2, F2-9, F2-10, 4.1-4.4 in master), quindi le
dipendenze di schema di 3.1 esistono. Manca solo il dato reale.

| Pezzo | In questo blocco | Perché |
|---|---|---|
| 3.1 provenienza e blocco all'invio | **Tutto**, tranne le colonne sui contratti | Dipende solo dal nostro schema. È la rete di sicurezza: deve esistere prima di qualunque riga importata. I contratti vanno con 3.8, che decide il bersaglio (`Contract` o `ContrattoCliente`). |
| Motore di caricamento (3.3-3.5) | **Sì**, generico | Lotto, blocchi, RLS e `ON CONFLICT` non dipendono da WinWaste. Provarlo ora su `ditte` toglie il rischio di sbagliare il pattern su movimenti e FIR. |
| 3.2 formato di staging, lettore, decodificatori, parser, analizzatore | **Sì** | Le colonne di `MOVIMENTI`, `FORMULARI`, `[GIACENZE RIFIUTI]`, `[CAUSALI RIFIUTI]`, `[REGISTRI RIFIUTI]` e i formati (`DTUK`, `$$`, `RELAZ`, `C4`, numeri `it-IT`, litri) sono documentati per posizione. Si testano con fixture sintetiche. |
| 3.2 estrattore da SQL Server | **Opzionale** (Task 14), su database sintetico | La meccanica (codifica, campi `text` con a capo e `§`) si prova senza dati veri; i nomi reali delle colonne no. |
| 3.3 mapping delle anagrafiche WinWaste | **No** | Di `[SEDI LEGALI]` e `[UNITA LOCALI]` sono documentate poche colonne (`PRECOD`, `COD`, `CODFIS`, `ISTAT`, `C6`, `C8`, `C9`, `AN3`, `MUD`): mancano ragione sociale, P.IVA e indirizzo. Lo schema delle chiavi (una ditta WinWaste per ruolo P/T/S/I contro la ditta unica di F2-10) va deciso sui dati (Q6). |
| 3.4 registro e giacenze, 3.5 FIR, 3.6 riconciliazione | **No** (solo il lato sorgente dei confronti) | Mapping `OPER` → causali, continuità del protocollo, giacenza ricalcolata contro `GIASCAR`, collisioni di `firNumber`: vanno misurati su un archivio reale. D3 va decisa col primo cliente. |
| 3.7 archivio, 3.8 contratti e listini | **No** | D4 aperta; 3.8 vuole un `ADDEBCON` reale. |

Il blocco si consegna in **due PR**: PR A = Task 0-9 (3.1 e motore di caricamento, con
migration), PR B = Task 10-15 (3.2, senza migration). La PR B non dipende dalla A e si può
rivedere a parte.

## Stato di partenza (branch `feat/fase3-import-piano` = master `575efb64`, verificato)

Percorsi relativi a `apps/backend/` salvo indicazione; `fe/` = `apps/frontend/src/app/`.

**Registro e trasmissione (F2-1, F2-3, F2-9).**
- `prisma/schema.prisma:1942-2050` `WasteMovement`: nessuna colonna di provenienza;
  `registroId` obbligatorio; unico `(registroId, progressiveYear, progressiveNumber)`;
  `tipoAnnotazione`, `movimentoRettificatoId`, `movimentoOriginaleId`; `entryHash`, `hashVersione`.
  `onDelete: Cascade` da `Tenant`. Nessun trigger di immutabilità sulla tabella: l'append-only è
  applicativo.
- `prisma/schema.prisma:3023-3115`: enum `StatoTrasmissioneRentri` (8 valori, `DA_TRASMETTERE` …
  `GIA_SU_RENTRI`), `OrigineTrasmissioneRentri` (`MANUALE`, `AUTOMATICA`, `CORREZIONE`,
  `DICHIARATA`), modello `MovimentoTrasmissioneRentri` (1:1 col movimento, `bloccatoInvio`,
  `motivoBlocco`, `identificativoRentri`, campi di esclusione). Nessuna riga = non trasmesso.
- Migration `20261101500000_trasmissione_registro_rentri/migration.sql:83-92`: CHECK
  `bloccato_coerente` (`TRASMESSA`/`GIA_SU_RENTRI`/`INCERTA` ⇒ bloccato), **`coda_sbloccata`
  (`DA_TRASMETTERE` ⇒ non bloccato)**, `motivo_blocco`; `:126-152` trigger `…_immutabile`; `:160-173`
  trigger `…_no_delete` (si cancellano solo `DA_TRASMETTERE`, `RIFIUTATA`, `NON_TRASMISSIBILE`).
  `20261102100000_rentri_esclusione_invio_automatico`: CHECK di esclusione (solo
  `DA_TRASMETTERE` non bloccato).
- `src/application/rentri/registro/trasmissioni-registro.repository.ts:492-515`
  `adottaAutomatiche`: crea righe `AUTOMATICA` per i movimenti **senza riga** con `created_at >=
  invio_rentri_automatico_dal`. **Un movimento importato oggi verrebbe adottato e trasmesso**
  (nasce con `created_at = now()`). `:521-541` `adottaCorrezioni`: correzioni il cui predecessore è
  `TRASMESSA`/`GIA_SU_RENTRI`.
- `src/application/rentri/registro/accoda-trasmissione-rentri.use-case.ts:34` `RIACCODABILI`; `:153-155`
  l'accodamento manuale tira dentro i predecessori non trasmessi e considera «ok» i predecessori in
  stati non riaccodabili. Con un predecessore importato e non riconciliato la correzione partirebbe
  da sola.
- `src/infrastructure/jobs/rentri-registro-trasmissione.job.ts`: ogni 10 minuti, adozione + lotti;
  interruttore `RENTRI_REGISTRO_INVII_ATTIVI`.

**FIR.**
- `prisma/schema.prisma:335-590` `FIR`: unici `(tenantId, firNumber)` `:568` e `(tenantId,
  rentriNumeroFir)` `:578`; `rentriSyncStatus` (`PENDING` di default), nessun campo di blocco.
- `src/application/rentri/sync-fir-to-rentri.use-case.ts:105-137`: unico punto della POST di
  creazione. **`eraSyncing` salta `canSyncToRENTRI()`** (`:134-135`): una guardia messa solo
  nell'aggregato non basta.
- Chiamanti: `infrastructure/queue/jobs/rentri-sync.job.ts` (worker), `trigger-batch-sync.use-case.ts:71`,
  `trasmetti-fir-secondo-modalita.use-case.ts` (aggancio all'emissione, AUTOMATICA/IBRIDA),
  `infrastructure/jobs/rentri-trasmissioni-sospese.job.ts` con
  `infrastructure/persistence/fir-prisma.repository.ts:289-330` `elencaTrasmissioniRentriSospese`
  (prende anche i `PENDING` mai avviati delle aziende AUTOMATICA/IBRIDA: **un FIR importato in
  `PENDING` entrerebbe qui**).
- Altre scritture verso RENTRI su un FIR legato: `annulla-fir-rentri`, `accetta-o-respingi-fir`,
  `completa-operazione-con-firma`, `gestisci-allegati-fir`, `rilascia-formulario-rentri`,
  `conferma-legame-rentri` (cartella `src/application/rentri/`).
- `src/domain/fir/aggregates/fir.aggregate.ts:882` `canSyncToRENTRI()`.

**Anagrafiche (F2-10).** `prisma/schema.prisma:2543-2615` `Ditta` (unici `(tenantId, partitaIva)` e
`(tenantId, codiceFiscale)`), `SedeDitta`; `Produttore`/`Trasportatore`/`Destinatario`
(`:1315-1455`) con `dittaId` + `sedeId` e unico `(tenantId, dittaId)`.

**Giacenze iniziali (F2-2).** `prisma/schema.prisma:925-973`: enum `GiacenzaInizialeProvenienza`
con `IMPORTAZIONE` «riservato alla Fase 3»; `origini` JSON `{ anno, protocollo, quantita? }`.

**RLS e ruoli.** `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts:78` `toBe(84)`;
`TENANT_SCOPED_MODELS` in `prisma-rls.extension.ts:47`; `README-tenant-transazione.md`;
`prisma/sql/ruoli-db.sql:49-53` liste `v_sola_lettura`, `v_solo_inserimento`, `v_senza_cancellazione`;
`ops/db-ruoli.sh`; `PrismaSistemaService` per i job cross-tenant.

**Import.** Nessun modulo `migrazione`, nessuna CLI, nessuna dipendenza CSV/SQL Server.
`mdfcat.py` sta in `/home/graziano/Progetti/winwaste/tools/`, non nel repo.

**Migration.** Ultima: `20261113100100_pese_agenti`. Questo blocco usa il prefisso `202611141000`.

## Decisioni (vincolanti per chi esegue, salvo risposta diversa alle domande)

**D1. Valori di provenienza.** `import_source VARCHAR(30)` con CHECK `IN ('WINWASTE')` (lista
estendibile da migration). `legacy_key VARCHAR(200)` con CHECK sul formato `^[0-9]{4}\|[^|]+(\|[^|]+)+$`
(prima parte = ditta WinWaste di 4 cifre). `lotto_import_id UUID` con FK composta `(lotto_import_id,
tenant_id) → lotti_import(id, tenant_id)`. CHECK «tutti o nessuno» sulle tre colonne. Chiavi
(costruite solo da `domain/migrazione/chiavi-legacy.ts`):
- movimenti e FIR: `ditta|anno|TABELLA|COD` (es. `0001|2026|MOVIMENTI|12345`), come rapporto 04 §4.4;
- anagrafiche: schema proposto in Q6, **non usato in questo blocco** oltre ai test del motore.

**D2. Immutabilità.** Funzione unica `provenienza_import_immutabile()` + trigger `BEFORE UPDATE` su
ogni tabella con le colonne: le tre colonne non cambiano mai, neppure da NULL a valore (un record
nato in WasteFlow non diventa «importato»). Vale anche per il proprietario: è un trigger, non un
GRANT.

**D3. Blocco dei movimenti: stato nuovo `DA_RICONCILIARE`.** Il CHECK `coda_sbloccata` vieta un
`DA_TRASMETTERE` bloccato, quindi la riga dell'importato non può essere «in coda e bloccata». Si
aggiungono `DA_RICONCILIARE` a `stato_trasmissione_rentri` e `IMPORTAZIONE` a
`origine_trasmissione_rentri`, in una migration **da sola** (un valore di enum aggiunto non si usa
nella stessa transazione). Regole, tutte nel database:
- CHECK: `DA_RICONCILIARE` ⇒ origine `IMPORTAZIONE` e `bloccato_invio` con motivo
  (`bloccato_coerente` esteso); l'inverso (origine `IMPORTAZIONE` ⇒ nasce `DA_RICONCILIARE`) lo
  impone il trigger d'inserimento, perché dopo 3.6 la riga cambierà stato restando `IMPORTAZIONE`;
- trigger `BEFORE INSERT` su `movimenti_trasmissione_rentri`: origine `IMPORTAZIONE` solo se il
  movimento ha `import_source` non nullo;
- trigger `BEFORE UPDATE`: da `DA_RICONCILIARE` **non si esce** in questo blocco (lo sblocco è 3.6,
  che allenterà il trigger con una funzione dedicata e audit);
- `DA_RICONCILIARE` non si cancella: il trigger `…_no_delete` già lo vieta (non è nella lista dei
  cancellabili); un test lo fissa, perché una riga cancellata farebbe ripartire l'adozione;
- trigger di vincolo **differito** `AFTER INSERT ON waste_movements DEFERRABLE INITIALLY DEFERRED`:
  un movimento con `import_source` non nullo senza riga `DA_RICONCILIARE` fa fallire il commit.
  È la rete se un caricatore futuro dimentica la riga. Il trigger ha `WHEN (NEW.import_source IS NOT
  NULL)`: le registrazioni normali non pagano nulla.

Doppia rete applicativa: `adottaAutomatiche` e `adottaCorrezioni` escludono i movimenti con
`import_source` non nullo **e** le correzioni la cui catena (`movimento_originale_id`) parte da un
importato non riconciliato; l'accodamento manuale tratta un predecessore `DA_RICONCILIARE` come
bloccante (la correzione è saltata con motivo, non accodata).

**D4. Blocco dei FIR.** Colonne `firs.bloccato_invio BOOLEAN NOT NULL DEFAULT false` e
`motivo_blocco_invio VARCHAR(500)`; CHECK `NOT bloccato_invio OR motivo_blocco_invio IS NOT NULL`;
trigger `BEFORE INSERT`: `import_source` non nullo ⇒ `bloccato_invio`; trigger `BEFORE UPDATE`: da
vero a falso non si passa in questo blocco (3.6). Guardia applicativa unica
`verificaFirNonBloccato(fir)` (dominio, errore `FirBloccatoAllInvioError`, HTTP 409 con messaggio
«FIR importato: l'invio a RENTRI è bloccato fino alla riconciliazione»), chiamata **prima**
del ramo `eraSyncing` in `SyncFIRToRENTRIUseCase.execute` e in ogni use case che scrive verso RENTRI
su un FIR (elenco in Stato di partenza; perimetro in Q5). Filtri: `elencaTrasmissioniRentriSospese`
(`AND NOT bloccato_invio`), `TrasmettiFIRSecondoModalitaUseCase` (non accoda, log),
`TriggerBatchSyncUseCase` (salta e conta). `canSyncToRENTRI()` restituisce falso se bloccato.

**D5. `lotti_import`.** Colonne: `id`, `tenant_id`, `import_source`, `archivio` (es. `WW00012026`,
CHECK `^WW[0-9]{8}$`), `ambito` (enum `ambito_lotto_import`: `ANAGRAFICHE`, `REGISTRO`,
`GIACENZE`, `FIR`), `formato_staging` (`winwaste-staging/1`), `hash_staging` (SHA-256 hex del
manifest), `stato` (enum `stato_lotto_import`: `IN_CORSO`, `COMPLETATO`, `FALLITO`, `ANNULLATO`),
`conteggi` JSONB `{ lette, inserite, saltate, scartate, blocchi }`, `errore` VARCHAR(1000),
`avviato_da` UUID, `avviato_il`, `concluso_il`, `created_at`, `updated_at`. Unico `(id, tenant_id)`.
Indice unico parziale: un solo `IN_CORSO` per `(tenant_id, archivio, ambito)`. RLS con le due
policy standard; in `v_senza_cancellazione` (un lotto non si cancella, si annulla). `ANNULLATO` si
raggiunge in un pezzo successivo: qui solo l'enum.

**D6. Motore di caricamento.** `inserisciABlocchi(tenantId, righe, { dimensioneBlocco = 200,
inserisciBlocco })`: ogni blocco in `TenantContext.run({ tenantId })` + `prisma.$transaction` sul
client **applicativo** (mai `PrismaSistemaService`); `inserisciBlocco` usa SQL con `ON CONFLICT
(tenant_id, import_source, legacy_key) WHERE import_source IS NOT NULL DO NOTHING RETURNING id` (bersaglio sempre nominato: un
conflitto su un altro unico, per esempio la P.IVA, **deve** fallire). I blocchi già scritti restano
(la riesecuzione è idempotente); al primo errore il lotto va `FALLITO` con l'errore e il numero del
blocco, e il caricamento si ferma. Conteggi aggiornati a fine di ogni blocco, nella stessa
transazione del blocco.

**D7. Staging (proposta D1 della roadmap, Q2).** Dati grezzi **fuori** dal database: una cartella
per archivio con `manifest.json` e un file JSON Lines per tabella, valori come stringhe esattamente
come in SQL Server (`null` distinto da `""`), UTF-8. Nel database solo lotti (e in 3.6 i rapporti).
Il manifest dichiara formato, ditta, anno, database d'origine, data di estrazione, e per tabella
file, righe, SHA-256 e colonne nell'ordine del catalogo. I file stanno fuori dal repo (guardia in
`.gitignore` e test che lo verifica), sulla workstation, mai sul VPS condiviso. Il formato è scritto
in `docs/migrazione/formato-staging-winwaste.md` ed è la frontiera fra estrazione e trasformazione.

**D8. Decodifica senza interpretazione silenziosa.** Ogni decodificatore restituisce
`{ ok: true, valore } | { ok: false, codice, dettaglio }`. Nessuna correzione automatica: un valore
inatteso diventa uno scarto con codice stabile (`DTUK_NON_VALIDA`, `RELAZ_LUNGHEZZA`, `NUMERO_IT`,
`UM_SCONOSCIUTA`, `OPER_SCONOSCIUTO`, `KGNUM_INCOERENTE`, …). Le corrispondenze dedotte con
confidenza media (`OPER` 51, `NATU`, `AVVE`) sono marcate `dedotta: true` nel rapporto.

**D9. Analizzatore senza database.** `migrazione:analizza <cartella>` legge lo staging, decodifica,
scrive `rapporto-sorgente.json` e `.md` accanto allo staging. Non importa Prisma né Nest (test
d'architettura). Produce il lato sorgente dei confronti 1, 2, 3 (solo per carico) e 4 di rapporto 04
§4.5, e per il 5 dice se `VERSIS`/`RENregistrazioni` sono presenti nello staging e quanti
`XSEINVIATO='X'`.

## Vincoli globali

- **Migration solo additive.** Nessun `DROP`, nessun cambio di tipo, nessun backfill su righe
  esistenti (le colonne nuove sono NULL o con default). Ogni migration ha in testa il commento
  «Cosa fa», «Ripristino a mano», «Da migration fallita (P3009)», come le precedenti; `SET LOCAL
  lock_timeout = '5s'`. CHECK e trigger stanno solo nella migration: `migrate diff` deve restare vuoto.
- **Mai `prisma migrate reset`, mai `db push`, mai `migrate dev` su un database condiviso.** Solo
  `migrate deploy` sul database di test di questo worktree.
- **RLS.** Ogni tabella nuova con `tenant_id` nasce con ENABLE + FORCE + `isolamento_azienda` +
  `sola_lettura` nella stessa migration; `rls-catalogo.postgres.spec.ts` 84 → 85 con commento;
  `TENANT_SCOPED_MODELS` e `README-tenant-transazione.md` aggiornati; `ruoli-db.sql` aggiornato e
  rieseguito due volte nei test.
- **Database di test** `wasteflow-pg-test-import` su `127.0.0.1:55446` (55445 è dell'agente pesa,
  55438 del registro): `docker run -d --name wasteflow-pg-test-import -p 127.0.0.1:55446:5432 -e
  POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci -e
  POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 postgres:16-alpine`. Shadow per `migrate diff`
  sullo stesso container (`shadow_import`).
- **Test Postgres col ruolo `wasteflow_app`** (`creaPrismaServiceApplicativo()`, `TenantContext.run`),
  preparazione e pulizia col proprietario solo per id esatti; `cd apps/backend && npx jest -c
  jest.postgres.config.js --runInBand --forceExit <spec>`.
- **RAM.** Jest mirato con `-w 2`; `npm run test:cov` una volta a fine task backend; eslint dei file
  toccati, globale a fine task; Karma una volta nel task frontend. Un solo processo pesante alla volta.
- **Niente porta 4200**: se serve il dev server del frontend, `--port 4300`. Il Task 8 si verifica con
  Karma, senza dev server.
- **Nessun dato reale nel repo.** Le fixture sono sintetiche: ragioni sociali `DITTA PROVA n`, codici
  fiscali e P.IVA con formato valido ma inventati (P.IVA con cifra di controllo corretta e prefisso
  `000`), nessun nome di persona reale. Ogni file di fixture ha in testa la sezione della
  documentazione WinWaste da cui deriva.
- Aree che questo blocco **non** tocca: `application/registro/registra-movimento*`, emissione FIR,
  `application/fatturazione/**`, `listino/**`, `pese/**`, `contratti*`. Toccati in modo mirato:
  `application/rentri/**` (solo guardie e filtri), `domain/fir/aggregates/fir.aggregate.ts`,
  `infrastructure/persistence/fir-prisma.repository.ts`, `fe/features/registro/stato-rentri.ts`, il
  dettaglio FIR del frontend. Se un task scopre di doverne toccare un altro, si ferma e lo segnala.
- **Convivenza con altri branch.** File a rischio: `schema.prisma` (modelli nuovi in coda, campi
  nuovi in fondo ai modelli), `rls-catalogo.postgres.spec.ts`, `prisma-rls.extension.ts`,
  `ruoli-db.sql`. Al rebase: somma dei conteggi RLS, `prisma generate`, `migrate deploy`, `migrate
  diff` vuoto; se master ha una migration con timestamp successivo, rinominare le nostre (mai
  applicate in produzione).

## Review Focus

1. **Movimento importato adottato dal job** (registro con invio automatico attivo da ieri, movimento
   importato oggi): nessuna riga `AUTOMATICA`, nessuna POST → Task 6 test (a).
2. **Correzione di un importato non riconciliato**: né l'adozione automatica né l'accodamento manuale
   la mandano; motivo esplicito → Task 6.
3. **FIR importato in `PENDING` in un'azienda IBRIDA**: il job di ripresa non lo prende, la coda
   BullMQ non lo riceve → Task 7 test (b) e (d).
4. **Invio manuale e `eraSyncing`**: un FIR importato forzato in `SYNCING` (via proprietario, nel
   test) è rifiutato prima della POST → Task 7 test (c).
5. **Caricatore che dimentica la riga di blocco**: il commit fallisce (vincolo differito) → Task 4.
6. **Collisione su un unico diverso dal bersaglio** (P.IVA già presente con altra chiave legacy): il
   blocco fallisce, non viene inghiottito; il lotto è `FALLITO` con il blocco indicato → Task 9.
7. **Tenant sbagliato in un blocco**: con il contesto dell'azienda B nessuna riga di A è visibile né
   scrivibile; il contesto non sopravvive da un blocco al successivo → Task 9.
8. **Decodifica che inventa**: nessun valore corretto in silenzio; ogni scarto ha codice e `COD` →
   Task 11-12.

---

## Task 0: ambiente e linea di base

**File:** nessuno.

- [ ] Container `wasteflow-pg-test-import` (Vincoli globali); `.env` del backend sul 55446
  (`git check-ignore -v apps/backend/.env`).
- [ ] `node_modules`, `npx prisma generate`, `npx prisma migrate deploy` (fino a
  `20261113100100_pese_agenti`), `ops/db-ruoli.sh` con `PG_EXEC="docker exec -i
  wasteflow-pg-test-import"`, seed.
- [ ] Base: `npm run test:postgres` e `npm run test:cov`; annotare nel rapporto i test già rossi.
- [ ] Censimento delle scritture verso RENTRI su FIR: `grep` dei metodi di scrittura dei client RENTRI
  (`creaFormulario`, `annulla`, `accetta`, `respingi`, allegati, firma) in `src/`; l'elenco va nel
  rapporto e diventa la lista del test d'architettura del Task 7. Se compare un chiamante non
  elencato in «Stato di partenza», aggiungerlo.
- [ ] Censimento delle mappe esaustive su `StatoTrasmissioneRentri` e `OrigineTrasmissioneRentri`
  (backend e frontend: `Record<…>`, `switch` con `never`): elenco nel rapporto, servono al Task 6 e 8.

**Fatto quando:** base annotata, due elenchi nel rapporto, nessun file cambiato.

## Task 1: dominio della provenienza e delle chiavi legacy

**Dipende da 0.** **File:** `src/domain/migrazione/provenienza.ts`, `chiavi-legacy.ts`, `errori.ts` e
le spec accanto.

- [ ] Test prima: `chiaveMovimento('0001', 2026, 'MOVIMENTI', 12345)` → `0001|2026|MOVIMENTI|12345`;
  ditta non di 4 cifre, anno fuori 1990-2100, `COD` non intero positivo, tabella fuori elenco
  (`MOVIMENTI`, `FORMULARI`) → errore tipato; nessun `|` nei componenti; lunghezza ≤ 200; la regex
  di D1 accetta tutte le chiavi prodotte e rifiuta le altre (test a tabella, lo stesso pattern
  esportato che userà la migration nel commento).
- [ ] `ImportSource = 'WINWASTE'` come tipo letterale e costante; `provenienzaValida()` (tutti o
  nessuno).

**Fatto quando:** spec verdi, copertura 100% dei file nuovi, nessun import da Prisma.

## Task 2: migration dei valori di enum e tabella `lotti_import`

**Dipende da 1.** **File:** `prisma/schema.prisma` (enum nuovi, valori nuovi, modello `LottoImport` in
coda, relazione inversa su `Tenant`), migration `20261114100000_import_valori_trasmissione` (solo
`ALTER TYPE … ADD VALUE 'DA_RICONCILIARE'` e `'IMPORTAZIONE'`), migration
`20261114100100_lotti_import`, `prisma/sql/ruoli-db.sql` (`lotti_import` in `v_senza_cancellazione`),
`prisma-rls.extension.ts`, `README-tenant-transazione.md`, `rls-catalogo.postgres.spec.ts` (84 → 85),
`src/infrastructure/database/ruoli-db.postgres.spec.ts`, nuovo
`src/application/migrazione/lotti-import.schema.postgres.spec.ts`.

- [ ] Test prima (schema spec, col ruolo applicativo): INSERT di un lotto nel proprio tenant; non
  visibile dal tenant B; INSERT con `tenant_id` di B rifiutato dalla policy; DELETE rifiutato per
  `wasteflow_app` e `wasteflow_sistema`; secondo `IN_CORSO` per stesso archivio e ambito rifiutato,
  ammesso dopo `COMPLETATO`; `archivio` fuori formato rifiutato; `hash_staging` non esadecimale di 64
  rifiutato; cascata da `tenants` col proprietario riesce.
- [ ] `ruoli-db.postgres.spec.ts`: privilegi SELECT/INSERT/UPDATE senza DELETE su `lotti_import`,
  anche dopo una seconda esecuzione.
- [ ] `rls-catalogo` a 85 con commento «85 dalla 3.1 (Task 2): `lotti_import`, provata in
  `lotti-import.schema.postgres.spec.ts`».
- [ ] Verifiche di migration: `prisma validate`, `migrate deploy`, `db-ruoli.sh`, `migrate diff` vuoto.
- [ ] Commit: `feat(import): lotti di import e valori di trasmissione per gli importati`.

**Fatto quando:** suite toccate verdi, `migrate diff` vuoto, conteggio 85.

## Task 3: colonne di provenienza e immutabilità

**Dipende da 2.** **File:** `prisma/schema.prisma` (tre campi in fondo a `WasteMovement`, `FIR`,
`Ditta`, `SedeDitta`, `Produttore`, `Trasportatore`, `Destinatario`, con commento `///` e relazione
verso `LottoImport`), migration `20261114100200_provenienza_import`, nuovo
`src/application/migrazione/provenienza.schema.postgres.spec.ts`.

- [ ] Migration: colonne NULL, CHECK `<tabella>_provenienza_check` (tutti o nessuno, `import_source`
  nella lista, `legacy_key` col formato di D1), indice unico **parziale**
  `<tabella>_tenant_import_legacy_key` su `(tenant_id, import_source, legacy_key) WHERE import_source
  IS NOT NULL` (solo SQL: Prisma non rappresenta gli indici parziali, quindi niente `@@unique` e
  `migrate diff` resta pulito; il caricatore deve scrivere `ON CONFLICT (tenant_id, import_source,
  legacy_key) WHERE import_source IS NOT NULL DO NOTHING`, altrimenti PostgreSQL non trova l'indice), FK
  composta verso `lotti_import` (`ON DELETE NO ACTION`), funzione `provenienza_import_immutabile()`
  e trigger `BEFORE UPDATE OF import_source, legacy_key, lotto_import_id` su ciascuna tabella.
- [ ] Test prima, per **ogni** tabella (test parametrico): insert con provenienza completa riesce;
  con una sola colonna → CHECK; seconda riga con stessa chiave nello stesso tenant → unico; stessa
  chiave in un altro tenant → ammessa; UPDATE di una delle tre colonne (anche NULL → valore) →
  rifiutato, anche col proprietario; UPDATE di un'altra colonna di una riga importata → ammesso;
  `lotto_import_id` di un lotto di un altro tenant → FK composta.
- [ ] Le righe esistenti (create dal seed) restano con le tre colonne NULL: test che conta le righe
  con provenienza dopo la migration (0).
- [ ] Commit: `feat(import): colonne di provenienza immutabili su registro, FIR e anagrafiche`.

**Fatto quando:** spec verde su 7 tabelle, `migrate diff` vuoto, nessun test esistente rosso.

## Task 4: blocco all'invio dei movimenti importati (database)

**Dipende da 3.** **File:** migration `20261114100300_blocco_invio_importati` (parte movimenti),
`prisma/schema.prisma` (solo commenti degli enum), nuovo
`src/application/rentri/registro/trasmissione-importati.schema.postgres.spec.ts`; estensione di
`trasmissione-rentri.schema.postgres.spec.ts` se fissa l'elenco dei CHECK.

- [ ] Migration: `bloccato_coerente` sostituito da una versione che include `DA_RICONCILIARE` (DROP +
  ADD dello stesso vincolo **nella stessa istruzione `ALTER TABLE`**: non toglie alcuna garanzia, la
  nuova condizione è più stretta); CHECK `origine_importazione_check` (`stato = 'DA_RICONCILIARE'` ⇒
  `origine = 'IMPORTAZIONE'`);
  trigger `movimenti_trasmissione_rentri_importati` (`BEFORE INSERT`: origine `IMPORTAZIONE` solo
  con movimento importato e stato `DA_RICONCILIARE`; `BEFORE UPDATE`: da `DA_RICONCILIARE` non si
  esce e `bloccato_invio` non cambia); trigger di vincolo differito
  `waste_movements_importato_bloccato` (D3).
- [ ] Test prima: movimento importato + riga `DA_RICONCILIARE` nella stessa transazione → commit
  riesce; movimento importato senza riga → commit fallisce con il messaggio del trigger; riga
  `IMPORTAZIONE` per un movimento non importato → rifiutata; riga `DA_RICONCILIARE` non bloccata o
  senza motivo → CHECK; UPDATE verso `DA_TRASMETTERE`, `GIA_SU_RENTRI`, `TRASMESSA` → rifiutato;
  DELETE → rifiutato; esclusione (`escluso_il`) su `DA_RICONCILIARE` → CHECK di esclusione; righe e
  movimenti esistenti invariati.
- [ ] Commit: `feat(import): i movimenti importati nascono bloccati all'invio a RENTRI`.

**Fatto quando:** spec verde, le suite F2-9 esistenti verdi, `migrate diff` vuoto.

## Task 5: blocco all'invio dei FIR importati (database)

**Dipende da 4.** **File:** stessa migration `…100300` (parte FIR) o `…100400` se il revisore
preferisce separarla, `prisma/schema.prisma` (`bloccatoInvio`, `motivoBloccoInvio` in fondo a
`FIR`), nuovo `src/application/rentri/fir-importati.schema.postgres.spec.ts`.

- [ ] Test prima: FIR con `import_source` e `bloccato_invio = false` → rifiutato all'inserimento; con
  blocco ma senza motivo → CHECK; UPDATE da bloccato a sbloccato → rifiutato; FIR non importato può
  restare non bloccato (default) e i FIR esistenti hanno `bloccato_invio = false`; un FIR non
  importato bloccato a mano (per test) è ammesso: il blocco è più largo dell'import, l'obbligo vale
  solo per gli importati.
- [ ] Commit: `feat(import): i FIR importati nascono bloccati all'invio a RENTRI`.

**Fatto quando:** spec verde, suite FIR e RENTRI esistenti verdi.

## Task 6: adozione e accodamento rispettano gli importati (test (a) e (d) movimenti)

**Dipende da 5.** **File:** `trasmissioni-registro.repository.ts` (`adottaAutomatiche`,
`adottaCorrezioni`), `accoda-trasmissione-rentri.use-case.ts` (`applicaAccodamento`,
`accodaStorico`, `dichiaraGiaSuRentri`, `escludiDaInvioAutomatico`), le mappe esaustive del Task 0
(etichette, DTO di dettaglio, `esito-movimenti-rentri.ts` se elenca gli stati), helper di test
`src/test-support/migrazione/movimento-importato.ts` (crea movimento + riga bloccata col
proprietario, solo per i test), nuovo
`src/application/rentri/registro/non-trasmissione-importati.postgres.spec.ts`.

- [ ] **(a)** Registro con `invio_rentri_automatico_dal` nel passato, un movimento importato e uno
  normale creati dopo: `adottaAutomatiche` adotta solo il normale; `prenota` e
  `TrasmettiLottoRegistroUseCase` con il client RENTRI finto non inviano l'importato (zero chiamate
  col suo id).
- [ ] **(d, movimenti)** Il giro completo `RentriRegistroTrasmissioneJob.eseguiTrasmissione` su
  un'azienda con invio automatico: l'importato resta `DA_RICONCILIARE`, nessuna POST lo contiene.
- [ ] Correzione (RETTIFICA) di un importato: `adottaAutomatiche` e `adottaCorrezioni` non la
  adottano; `accoda` la conta fra le saltate con motivo `PREDECESSORE_DA_RICONCILIARE` e non crea
  righe; `accodaStorico` idem.
- [ ] `accoda` diretto dell'importato → saltato (stato non riaccodabile); `dichiaraGiaSuRentri` su
  un intervallo che lo contiene → saltato e contato in `saltatePerStato.DA_RICONCILIARE`, gli altri
  dichiarati; `escludiDaInvioAutomatico` → 409 come per gli stati non escludibili;
  `togliDallaCoda` → 409.
- [ ] Etichetta API dello stato nuovo: «Importata, da riconciliare»; origine «Importazione».
- [ ] Commit: `feat(import): adozione e coda del registro saltano i movimenti importati`.

**Fatto quando:** spec nuova verde, suite `registro/**` e `rentri-registro-trasmissione.job*`
verdi, `tsc` senza errori (mappe esaustive aggiornate).

## Task 7: guardie sui FIR importati (test (b), (c), (d) FIR)

**Dipende da 6.** **File:** `domain/fir/aggregates/fir.aggregate.ts` (proprietà `bloccatoInvio`,
`motivoBloccoInvio`, `canSyncToRENTRI()`), nuovo `domain/fir/guardia-invio-rentri.ts`
(`verificaFirNonBloccato`, `FirBloccatoAllInvioError`), mapper in `fir-prisma.repository.ts` e
`elencaTrasmissioniRentriSospese`, `sync-fir-to-rentri.use-case.ts`,
`trasmetti-fir-secondo-modalita.use-case.ts`, `trigger-batch-sync.use-case.ts`, gli use case di
scrittura scelti con Q5, mappatura dell'errore in HTTP 409 (filtro delle eccezioni esistente),
`api/fir/dtos/fir-response.dto.ts` (`bloccatoInvio`, `motivoBloccoInvio`), nuovi
`src/application/rentri/non-trasmissione-fir-importati.postgres.spec.ts` e
`src/application/rentri/scritture-rentri-guardate.spec.ts` (test d'architettura).

- [ ] Test unitari prima: `canSyncToRENTRI()` falso se bloccato; `verificaFirNonBloccato` lancia con
  il motivo; `SyncFIRToRENTRIUseCase.execute` su FIR bloccato in `PENDING` **e** in `SYNCING` →
  `FirBloccatoAllInvioError` prima di costruire il corpo, zero chiamate al client.
- [ ] **(b)** `elencaTrasmissioniRentriSospese` (Postgres, ruolo di sistema) non restituisce un FIR
  importato `PENDING` né `SYNCING` stallato, in un'azienda AUTOMATICA e in una IBRIDA; il FIR normale
  equivalente sì.
- [ ] **(c)** Invio manuale (`POST` del controller di sync, test HTTP con supertest) di un FIR
  importato → 409 con il messaggio di D4, nessun job in coda (`RENTRISyncQueue` finta).
- [ ] **(d, FIR)** `TrasmettiFIRSecondoModalitaUseCase` in AUTOMATICA e IBRIDA con FIR importato →
  nessun `addSyncJob`; `TriggerBatchSyncUseCase` con un importato fra tre → due accodati, uno saltato
  con motivo; worker `rentri-sync.job.ts` che riceve comunque un job per un importato (coda sporca)
  → rifiuto senza POST.
- [ ] Test d'architettura: ogni file dell'elenco del Task 0 che chiama un metodo di scrittura RENTRI
  su un FIR chiama `verificaFirNonBloccato` (lettura del sorgente, come `punti-di-sistema.spec.ts`);
  un file nuovo con una scrittura e senza guardia fa fallire il test.
- [ ] Commit: `feat(import): nessuna trasmissione a RENTRI dei FIR importati`.

**Fatto quando:** i quattro test (a)-(d) sono verdi e nominati come tali nel rapporto; suite FIR,
RENTRI e oracoli (`sync-fir-idempotenza.oracolo.spec.ts`) verdi.

## Task 8: frontend, stato e badge

**Dipende da 7.** **File:** `fe/features/registro/stato-rentri.ts` e spec, pannello RENTRI del
registro se mostra legende, dettaglio FIR (componente che mostra lo stato RENTRI) e spec.

- [ ] Test prima (Karma): `DA_RICONCILIARE` ha etichetta «Importata, da riconciliare», gravità
  informativa, nessuna azione offerta («Trasmetti», «Escludi», «Togli dalla coda» assenti); FIR con
  `bloccatoInvio` mostra il tag «Importato: invio a RENTRI bloccato» con il motivo in tooltip e il
  pulsante «Trasmetti a RENTRI» disabilitato.
- [ ] Nessun dev server sulla 4200 (Vincoli globali).
- [ ] Commit: `feat(import): stato e badge degli importati nell'interfaccia`.

**Fatto quando:** Karma verde, lint del frontend pulito.

## Task 9: motore di caricamento per tenant

**Dipende da 8.** **File:** `src/application/migrazione/caricamento/lotti-import.service.ts`
(`avvia`, `registraBlocco`, `completa`, `fallisci`), `inserisci-a-blocchi.ts`, `tipi.ts`; test-only
`src/test-support/migrazione/inserisci-ditte-importate.ts` (un `inserisciBlocco` per `ditte` con SQL
parametrizzato, usato solo dai test); nuovo
`src/application/migrazione/caricamento/inserisci-a-blocchi.postgres.spec.ts`;
`punti-di-sistema.spec.ts` invariato (il motore non usa il client di sistema).

- [ ] Test prima: 450 righe in blocchi da 200 → 3 transazioni, `conteggi = { lette: 450, inserite:
  450, saltate: 0, blocchi: 3 }`, lotto `COMPLETATO`; seconda esecuzione dello stesso input su un
  lotto nuovo → `inserite: 0, saltate: 450`; P.IVA già presente con altra chiave nel secondo blocco
  → primo blocco scritto, secondo annullato, lotto `FALLITO` con `errore` che cita il blocco 2 e il
  vincolo, terzo blocco non tentato; contesto: dentro il blocco `current_setting('app.tenant_id')`
  è il tenant del lotto, fuori da `inserisciABlocchi` è vuoto; un `inserisciBlocco` che scrive con
  `tenant_id` di B → rifiutato dalla policy; due `avvia` concorrenti sullo stesso archivio e ambito →
  uno solo `IN_CORSO` (`Promise.all`, l'altro errore tipato).
- [ ] Log: solo id tecnici e conteggi, mai valori delle righe (dati personali).
- [ ] Commit: `feat(import): motore di caricamento a blocchi per tenant con lotti`.

**Fatto quando:** spec verde, `test:cov`, `tsc`, eslint globale, suite Postgres toccate +
`rls-catalogo` + `ruoli-db`. **Fine della PR A.**

## Task 10: formato di staging e lettore

**Dipende da 0** (non dalla PR A). **File:** `docs/migrazione/formato-staging-winwaste.md`,
`src/application/migrazione/staging/manifest.ts`, `lettore-staging.ts`, `colonne-documentate.ts`
(elenco delle colonne per tabella con la fonte: `movimenti.md §2.2` posizioni 0-85 + colonne di
server, `formulari.md §2.1` 1-101, `giacenze.md §2.3`, `movimenti.md §2.3` causali e registri,
`rentri/03 §2.2` `VERSIS`), spec; fixture `test/fixtures/winwaste/WW00012026/` (manifest + JSONL
generati da `test/fixtures/winwaste/genera-fixture.ts`, committati), `.gitignore` (guardia per
`**/staging-winwaste/**` e `*.bak`).

- [ ] Test prima: manifest con formato sconosciuto, ditta o anno incoerenti col nome della cartella,
  hash che non corrisponde, righe dichiarate diverse da quelle lette → errore tipato prima di
  qualunque decodifica; colonna documentata mancante → avviso `COLONNA_MANCANTE` con tabella e nome;
  colonna in più → avviso `COLONNA_NON_DOCUMENTATA` (non errore: le versioni di WinWaste cambiano);
  `null` e `""` restano distinti; una riga JSON malformata → scarto con numero di riga, la lettura
  prosegue; lettura in streaming (test con 50 000 righe generate in memoria sotto 200 MB di heap).
- [ ] Test che nessun file in `test/fixtures/winwaste` contenga un codice fiscale con cifra di
  controllo valida fuori da un elenco di codici inventati dichiarati nel generatore.
- [ ] Commit: `feat(import): formato di staging WinWaste e lettore verificato`.

**Fatto quando:** documento del formato scritto, spec verdi, fixture rigenerabili in modo
deterministico.

## Task 11: decodificatori puri

**Dipende da 10.** **File:** `src/domain/migrazione/winwaste/` — `dtuk.ts`, `data-registrazione.ts`,
`numero-it.ts`, `quantita.ts`, `relaz.ts`, `c4.ts`, `soggetto.ts`, `oper.ts`, `registri.ts`, `cer.ts`
e spec.

- [ ] `dtuk`: `aaaammgg` valida → data; prefisso `$$` → `{ annullato: true, data }`; `≤ '0'` →
  annullato o nascosto (`movimenti.md §2.2` pos. 11); mese 13, giorno 32, 29/02 non bisestile →
  scarto.
- [ ] `data-registrazione`: `DATR` `gg-mm` + anno del database → data; coerenza con `DTUK` (avviso se
  diversa, non scarto).
- [ ] `numero-it`: `1.234,56`, `0,001`, `-12,5`, `''` → valori; `1,234.56` e `1.234` ambiguo → scarto
  `NUMERO_IT`; mai `parseFloat` grezzo.
- [ ] `quantita`: `NETTO` in kg, `VOLU` + `UM` (`M` m³, `L` litri / 1000); confronto con `KGNUM` e
  `MCNUM` (tolleranza 0,001) → `KGNUM_INCOERENTE` come avviso.
- [ ] `relaz`: segmenti di 34 caratteri (`giacenze.md §2.2`): tipo `C`/`P`/`G`, codice (8), classe
  `T`/`R`/`r`/`D`/`d`/`X`, kg (12, virgola), m³ (12); lunghezza non multipla di 34, tipo o classe
  ignoti, `G` con codice fuori `G0..G5` → scarto `RELAZ_*`; stringa vuota → nessun segmento.
- [ ] `c4`: sottocampi separati da `§`, posizioni nominate di `formulari.md §2.2` (5, 15-16, 22-30);
  posizione 14 fra `^` = id esterno.
- [ ] `soggetto`: `PROD`/`TRAS`/`SMAL`/`INTE` come `ditta.unità` (forma presunta da verificare sul
  `.bak`, marcata `dedotta`); vuoto e `0` → nessun soggetto.
- [ ] `oper`: tabella di `movimenti.md §2.4` → `{ tipo: CARICO|SCARICO|ENTRAMBI|NESSUNA_GIACENZA,
  classe, richiedeRelazione, dedotta }`; ≥ 60 → `SOLO_FATTURAZIONE`; ignoto → scarto.
- [ ] `registri`: `REG1..4` + `PROT1..4` → elenco `{ registro, protocollo }` senza vuoti.
- [ ] `cer`: 6 cifre → `NN NN NN`, con `*` se `TIPOL` è `P`/`Q` (`formulari.md §2.1` col. 30-34);
  formato errato → scarto. Il confronto col catalogo CER resta a 3.4.
- [ ] Ogni test cita in un commento la sezione della documentazione da cui viene il caso.
- [ ] Commit: `feat(import): decodificatori dei formati posizionali di WinWaste`.

**Fatto quando:** copertura 100% di `domain/migrazione/winwaste/`, nessun import da Prisma o Nest.

## Task 12: parser per tabella con rapporto scarti

**Dipende da 11.** **File:** `src/application/migrazione/staging/parser/` — `movimenti.ts`,
`formulari.ts`, `giacenze-rifiuti.ts`, `causali-rifiuti.ts`, `registri-rifiuti.ts`, `versis.ts`,
`scarti.ts` e spec; tipi dei record decodificati in `src/domain/migrazione/winwaste/record.ts` (ogni
record porta `legacyKey`, `annullato`, valori decodificati, `grezzo` per i campi non ancora mappati).

- [ ] Test sulle fixture del Task 10: conteggi attesi per tabella; un movimento annullato `$$` è
  letto e marcato, non scartato; un FIR con `C7 = 'A'` marcato annullato; `C7` `R`/`9`/`''`/portale
  classificati; righe `[GIACENZE RIFIUTI]` normali e di compensazione (`UL` che inizia per `8`)
  distinte; obbligo di relazione (`MAG1 > 0`, `NETTO > 0`, `OPER` in `11 13 15 21 23 24 51`) senza
  `RELAZ` → scarto `RELAZIONE_MANCANTE`; `COD` duplicato nella stessa tabella → scarto; `legacyKey`
  costruita col Task 1.
- [ ] Scarti: `{ tabella, cod, riga, codice, dettaglio }`, ordinati, senza valori personali nel
  dettaglio (solo nomi di colonna e codici).
- [ ] Commit: `feat(import): parser delle tabelle WinWaste con scarti tipati`.

**Fatto quando:** spec verdi; ogni codice di scarto ha almeno un test.

## Task 13: analizzatore e CLI `migrazione:analizza`

**Dipende da 12.** **File:** `src/application/migrazione/analisi/analizza-archivio.ts`,
`rapporto-sorgente.ts` (JSON + Markdown), `src/cli/migrazione-analizza.ts`, script npm
`migrazione:analizza` in `apps/backend/package.json`, spec e test d'architettura
`src/application/migrazione/analisi/senza-database.spec.ts`.

- [ ] Test prima, sulle fixture: confronto 1 (conteggi per tabella, `CAUS`, `OPER`, attivi e
  annullati); confronto 2 (totali per CER, anno, tipo, unità da `KGNUM`/`MCNUM`, solo attivi, mai
  sommando kg e m³); confronto 3 (per ogni carico, residuo `KGNUM - GIASCAR` contro la somma dei
  segmenti `C` che lo citano, differenze ≥ 0,001 kg elencate; le `G` si sommano per riga `G0..G5`);
  confronto 4 (per registro e anno: primo e ultimo protocollo, buchi); confronto 5 (presenza di
  `VERSIS` e `RENregistrazioni`, conteggio `XSEINVIATO = 'X'`, oppure «tabelle RENTRI assenti dallo
  staging»).
- [ ] La CLI scrive accanto allo staging, non sovrascrive un rapporto esistente senza `--forza`,
  esce con codice 2 se il lettore rifiuta il manifest, 0 altrimenti (gli scarti non sono un errore
  di esecuzione).
- [ ] Test d'architettura: nessun file sotto `application/migrazione/staging|analisi` e
  `cli/migrazione-analizza.ts` importa `@prisma/client`, `PrismaService` o `@nestjs/*`.
- [ ] Commit: `feat(import): analizzatore dell'archivio WinWaste e rapporto sorgente`.

**Fatto quando:** `npm run migrazione:analizza -- test/fixtures/winwaste/WW00012026` produce un
rapporto uguale al file atteso committato (`rapporto-atteso.json`).

## Task 14 (opzionale): estrattore da SQL Server su database sintetico

**Dipende da 13.** Si salta se la RAM non basta (SQL Server Developer in container chiede ~2 GB) o se
il revisore preferisce attendere il `.bak`: in quel caso passa al blocco 2. **File:**
`tools/import-winwaste/estrai.ts` (Node con `mssql` **solo in quel tool**, `package.json` proprio,
fuori dall'immagine del backend), `tools/import-winwaste/schema-sintetico.sql` (DDL ricavata dalla
documentazione: tipi `varchar`, `text` per `RELAZ`/`FOGLIO`, `decimal` per `GIASCAR`/`KGNUM`/`MCNUM`,
collation `Latin1_General_CI_AS`), `README.md`, test end-to-end in container.

- [ ] Test: righe con `§`, `à`, `è`, tabulazioni e a capo dentro `RELAZ`/`C4`/`NOT3` escono in UTF-8
  identiche; `NULL` resta `null`; il manifest prodotto passa il lettore del Task 10 e l'analizzatore
  dà lo stesso rapporto delle fixture caricate nel database sintetico.
- [ ] L'estrattore apre SQL Server con un login di sola lettura e rifiuta un login con permessi di
  scrittura (controllo con `fn_my_permissions`).
- [ ] Commit: `feat(import): estrattore da SQL Server verso lo staging`.

**Fatto quando:** prova end-to-end verde una volta in locale; nessun job CI nuovo (troppa RAM).

## Task 15: documentazione e verifica finale

**Dipende da 14 (o 13).** **File:** `docs/migrazione/README.md` (flusso, ruoli, dove stanno i file,
cosa non si migra: certificati, serie vidimate, contabilità), sezione «Al primo `.bak`» con la
checklist sotto, `CHANGELOG.md`.

- [ ] Verifica finale: `npm run test:cov`, `npm run test:postgres` intera, Karma, `tsc`, eslint,
  `migrate diff` vuoto, confronto con la base del Task 0 (nessun rosso nuovo).
- [ ] Commit: `docs(import): flusso di migrazione e checklist del primo archivio reale`.

**Fatto quando:** rapporto finale con i quattro test di non-trasmissione elencati per nome e i
comandi eseguiti.

---

## Da ri-verificare all'arrivo del `.bak` (checklist del blocco 2)

1. **Schema reale.** `mdfcat.py` sul `.mdf` (o `INFORMATION_SCHEMA` sul ripristino): nomi, ordine e
   tipi delle colonne di ogni tabella contro `colonne-documentate.ts`. Gli avvisi
   `COLONNA_MANCANTE`/`COLONNA_NON_DOCUMENTATA` del lettore vanno a zero o diventano decisioni scritte.
2. **Versione di WinWaste** del cliente, nel manifest.
3. **Codifica.** Collation del database; `§` e accentate nei campi compositi dopo l'estrazione.
4. **Forme presunte:** `PROD`/`TRAS`/`SMAL` `ditta.unità`, separatore e lunghezze; `DATR` sempre
   `gg-mm`; `C4` con posizioni vuote finali; `RELAZ` con virgola decimale in tutti i segmenti;
   `NFATT`; marcatori `ARRI`.
5. **`OPER` dedotti** (51, 30/40, ≥ 60) e causali personalizzate del cliente: elenco reale di
   `[CAUSALI RIFIUTI]`, base del mapping `OPER` → causali di F2-5 (3.4).
6. **Giacenze.** Rapporto del confronto 3 su dati veri: quante differenze `GIASCAR`, righe di
   compensazione, modalità `P` o `G` del passaggio d'anno, `RenRelazioniIniziali`.
7. **Numerazione.** Quanti registri (`REG1..4`) usa davvero il cliente (rapporto 04 §7 domanda 5);
   buchi e protocolli per registro.
8. **FIR.** Formati di `FORMU` (serie, numeri vidimati, numeri RENTRI) contro `firs_tenant_id_fir_number_key`:
   quante collisioni.
9. **Anagrafiche.** Colonne vere di `[SEDI LEGALI]` e `[UNITA LOCALI]`, ruoli P/T/S/I della stessa
   ditta, privati senza P.IVA, P.IVA errate: base dello schema delle chiavi (Q6) e di 3.3.
10. **RENTRI.** Presenza e contenuto di `VERSIS`, `RENregistrazioni.IDRENTRI`/`XSEINVIATO`,
    `XRENTRIFIRTRASMESSI`.
11. **Volumi.** Righe per tabella e tempi del lettore e dell'analizzatore; dimensione del blocco del
    motore di caricamento.
12. **Rapporto sorgente** rifatto sul `.bak` e mostrato al cliente prima di qualunque caricamento.

## Ordine

T0 → T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 (**PR A**) → T10 → T11 → T12 → T13 → [T14] → T15
(**PR B**). Sequenziale per la RAM e i file condivisi. T10-T13 non dipendono da T1-T9: se la PR A si
ferma in revisione, la PR B può partire da master in un secondo worktree, ma mai con due processi
pesanti insieme.

## Rischi

- **Un percorso di invio dimenticato** ritrasmette a RENTRI. Mitigazione: blocco nel database
  (trigger e vincolo differito) oltre alle guardie, test d'architettura sulle scritture verso RENTRI,
  i quattro test obbligatori.
- **Enum nuovo e codice esaustivo.** `DA_RICONCILIARE` rompe `switch` e mappe che non lo conoscono;
  peggio, codice non tipato che tratta «stato sconosciuto» come trasmissibile. Mitigazione: censimento
  del Task 0 e `tsc` come criterio di fatto; grep delle stringhe di stato nel frontend.
- **`ALTER TYPE … ADD VALUE` in produzione.** Non si annulla con un `DROP`; è additivo e innocuo
  finché nessuna riga lo usa. Il ripristino a mano della migration lo dice.
- **Vincolo differito.** Costa un controllo per inserimento in `waste_movements` solo con
  `import_source` non nullo (clausola `WHEN` sul trigger): zero costo per le registrazioni normali.
  Va misurato nel Task 4 su 10 000 inserimenti.
- **Lavorare al buio sul formato.** Il parser può fissare con i test un'interpretazione sbagliata
  della documentazione. Mitigazione: forme dedotte marcate, avvisi invece di errori per le colonne,
  checklist del `.bak`. Il costo di rifare i parser è contenuto (sono puri).
- **Dati personali.** Staging e rapporti contengono CF, nominativi e targhe. Mitigazione: fuori dal
  repo con guardia, log solo con id e conteggi, DPA prima del primo `.bak` (roadmap §8).
- **Colonne su `waste_movements`.** Tabella calda: tre colonne NULL e un indice unico parziale
  (`WHERE import_source IS NOT NULL`, Task 3) che resta vuoto per i movimenti normali. Trappola:
  un `ON CONFLICT` senza il predicato non usa l'indice parziale e fallisce; il motore del Task 9 lo
  scrive una volta sola e i test lo fissano.
- **Aspetti legali** del reverse engineering del formato: da far confermare prima di offrire la
  migrazione come servizio (rapporto 04 §4.7), non prima di questo blocco, che non tocca dati di
  clienti.

## Fuori ambito

- Mapping delle anagrafiche WinWaste e loro caricamento (3.3), import di registro e giacenze (3.4),
  FIR (3.5), riconciliazione e sblocco con pagina SUPER_ADMIN (3.6), archivio degli anni precedenti e
  MUD storici (3.7), contratti e listini (3.8) con le loro colonne di provenienza.
- Annullamento di un lotto (`ANNULLATO` esiste solo come valore).
- Creazione dei tenant del gruppo col ruolo di sistema (3.3).
- Divieto di cancellare un'azienda con registro (`onDelete: Cascade`): valutato, rinviato (Q7).
- Certificati RENTRI, serie vidimate `WWQRCODE`, contabilità: non si migrano.
- Job CI con SQL Server.

## Domande aperte per Graziano (con proposta)

| # | Domanda | Proposta (applicata dal piano) | Impatto se la risposta è diversa |
|---|---|---|---|
| Q1 | Come si blocca la riga di trasmissione di un movimento importato? | **Stato nuovo `DA_RICONCILIARE`** con origine `IMPORTAZIONE`, bloccato, da cui si esce solo con lo sblocco di 3.6. Gli stati e l'esclusione esistenti hanno già un significato (in coda, già su RENTRI) che l'importato non ha. | Riusare `GIA_SU_RENTRI` per chi ha `IDRENTRI` e l'esclusione per gli altri: niente enum nuovo, ma l'esclusione si toglie da ADMIN senza riconciliazione (contro la decisione del 24/10) e `GIA_SU_RENTRI` è immutabile. Task 4 e 6 da rifare. |
| Q2 | D1 della roadmap: dove sta lo staging? | **File JSON Lines fuori dal database**, sulla workstation, con manifest e hash; nel database solo lotti (e i rapporti di 3.6). | Tabelle di staging con RLS: +6-8 tabelle, i dati personali grezzi finiscono nei backup di produzione. Task 10 diverso, Task 2 più grande. |
| Q3 | Dove girerà il caricamento (dal blocco 2)? | Estrazione e analisi sulla workstation (container usa e getta); **caricamento con una CLI dentro l'immagine del backend sul server di produzione**, col ruolo applicativo, partendo dai file trasformati (mai il `.bak`) copiati cifrati con age e cancellati a fine lotto. | Dalla workstation con un tunnel al database di produzione: niente file sul server, ma una porta del database raggiungibile da fuori e un ruolo applicativo usato fuori dall'app. Non cambia questo blocco. |
| Q4 | Un movimento importato non ancora riconciliato si può rettificare o annullare? | **Sì** (F2-3 resta com'è), ma la correzione non si trasmette finché l'originale non è sbloccato: l'adozione la salta e l'accodamento la rifiuta con motivo. | Vietare la correzione: un controllo in più in F2-3 (Task 6 tocca `registro/**`), errori di import correggibili solo dopo 3.6. |
| Q5 | Il blocco del FIR importato vale per tutte le scritture verso RENTRI o solo per la creazione? | **Tutte** (creazione, annullamento, accettazione e respingimento, firma, allegati, rilascio, conferma del legame). Un FIR digitale riacquisito da RENTRI in 3.5 nasce già legato e non importato da WinWaste, quindi non è toccato. | Solo la creazione: meno guardie, ma un FIR cartaceo importato con un numero RENTRI sbagliato potrebbe annullare il formulario vero sull'ente. |
| Q6 | Schema delle chiavi legacy delle anagrafiche (per 3.3, da confermare sul `.bak`)? | Ditta per P.IVA o CF con chiave `ditta\|FISC\|<piva o cf>`; ruolo (produttore, trasportatore, destinatario) con `ditta\|<PRECOD>\|<COD>`; sede con `ditta\|<PRECOD>\|<COD>\|<UL>`. Le colonne si aggiungono ora su tutte e cinque le tabelle. | Chiave sola sulla ditta: niente colonne sulle tabelle dei ruoli (Task 3 più piccolo), ma un'anagrafica WinWaste P e una S della stessa ditta non si distinguono più al ricaricamento. |
| Q7 | `onDelete: Cascade` da `Tenant` al registro (roadmap §9 punto 11): si vieta ora? | **No in questo blocco**: nessun endpoint cancella un'azienda e le suite di test puliscono con la cascata. Pezzo a sé prima del primo cliente migrato (trigger che rifiuta il DELETE di un'azienda con movimenti, salvo flag di sessione dei test). | Sì ora: un task in più nella PR A e la revisione di tutte le pulizie dei test Postgres (rischio alto di test rotti). |
| Q8 | Il `.bak` reale e il DPA: chi li procura e quando? Nel frattempo si fa l'estrattore su database sintetico (Task 14)? | **Sì al Task 14** se la RAM regge, come prova della meccanica di codifica; il `.bak` anonimizzato serve prima di aprire il blocco 2. | No al Task 14: l'estrattore passa al blocco 2 (S), il resto invariato. |
