# Fase 2 pezzo 5: causali configurabili con comportamenti e mapping RENTRI — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa un task
> alla volta, opus rivede ogni task. Ordine STRETTAMENTE SEQUENZIALE (un solo worktree, un
> solo database di test `127.0.0.1:55432`, commit condivisi):
> Task 1 → 2 → 3 → 4a → 4b → 5 → 6 → 7a → 7b. Nessun parallelismo interno a F2-5: il
> parallelismo è già fra questo branch e quello dei FIR (vedi I1 nel Task 1).
> Piano rivisto da opus il 2026-10-27 (I1-I8 e M1-M11 recepiti).

**Obiettivo.** Le causali del registro diventano dati: un catalogo di sistema globale e non
modificabile dall'applicazione, più personalizzazioni per azienda (disattivare una causale
di sistema, creare causali proprie con validità nel tempo). Ogni causale porta il proprio
**verso** (CARICO/SCARICO), il **ruolo nel MUD**, l'eventuale **operazione R/D** e il
**codice della causale RENTRI** (NULL = non trasmissibile). Un solo risolutore sostituisce
le costanti `CAUSALI_CARICO/SCARICO`, la mappa del ruolo MUD e `operazioneDaCausale`, e lo
usano la registrazione, la rettifica, il MUD, l'elenco del registro e il frontend.
Nessun movimento esistente viene riscritto; il MUD degli anni passati non cambia.

**Fonti.**
- Roadmap `C:\Progetti\winwaste\docs\roadmap-fase2-parita-registro.md` §F2-5 (catalogo
  globale + personalizzazioni, validità per non cambiare il MUD retroattivamente,
  automatismi dei gestori esclusi) e §3 regola 4 (tabella globale senza `tenant_id`, sola
  lettura per il ruolo applicativo; tabella aziendale con `tenant_id` NOT NULL e policy).
- WinWaste `C:\Progetti\winwaste\docs\movimenti.md` §2.3 (`[CAUSALI RIFIUTI]`: `TIP`,
  `OPE`, `MUD`, `AVANZ`...), §2.4 (`OPER` 10-52, ≥ 60 esclusi), §3.2 (`AVANZ`: automatismi
  da gestore, fuori ambito).
- WinWaste `C:\Progetti\winwaste\docs\rentri\03-aggancio-a-winwaste.md` §3.1: `OPER` →
  causale RENTRI (`10` → `DT`/C; `11` → `aT`/S; `12`/`28` → `DT` + `aT`; `DT` diventa `NP`
  per le operazioni da gestore, `RE` se il luogo di produzione è esterno; `oper < '60'`).
- Contratto RENTRI `docs/contracts/rentri/dati-registri.yaml:2844-2855` (`CausaliOperazione`:
  `DT` prodotto o detenuto nell'unità locale, `NP` nuovo produttore, `T*` ricevuto da
  terzi, `RE` prodotto al di fuori dell'unità locale, `I` scarico interno, `aT` scarico a
  terzi, `M` scarico per produzione di materiali, `TR` intermediario, `T*aT` carico e
  scarico) e `:2856-2861` (`CausaliOperazioneCs`: `Carico`, `Scarico`, `CaricoScarico`);
  vincoli d'uso a `:3096-3123` (materiali solo con `M`; dati del trasporto solo con
  `aT`, `TR`, `T*`, `T*aT`).
- Piani modello: `2026-10-27-fase2-3-rettifica-annullamento.md` e
  `2026-10-27-fase2-2-giacenze-iniziali.md`.

## Stato di partenza (branch `feat/fase2-5-causali` = master `5b6f661`, verificato)

**Backend (file non spec).**
- `apps/backend/src/domain/waste-movement/waste-movement.entity.ts:15-21`
  `CAUSALI_CARICO` (PRODUZIONE_INTERNA, INGRESSO_ESTERNO, RICLASSIFICAZIONE,
  RECUPERO_PARZIALE, ALTRO_CARICO), `:28-35` `CAUSALI_SCARICO` (CONFERIMENTO_TRASPORTATORE,
  AVVIO_RECUPERO, AVVIO_SMALTIMENTO, CESSIONE, RICLASSIFICAZIONE, ALTRO_SCARICO), tipi
  `CausaleCarico/CausaleScarico/CausaleMovimento` `:23-39`, `WasteMovementProps.causale:
  CausaleMovimento` `:72`; `WasteMovement.create` respinge la causale fuori elenco per tipo
  `:181-193`. **11 righe, 10 codici distinti: `RICLASSIFICAZIONE` esiste in entrambi i
  versi** → la chiave di una causale è `(codice, verso)`, non il solo codice.
- `src/application/registro/valida-dati-movimento.ts:1,25-38`: stessa verifica con le
  costanti, prima di ogni lettura; parametro `db: Parameters<typeof cerCodeExists>[0]`
  (= interfaccia strutturale `LettoreCatalogoCer`, `cer-catalogo.ts:4-35`). Usata da
  `registra-movimento.use-case.ts:155` (fuori transazione, con `this.prisma`) e da
  `correggi-movimento.use-case.ts:314` (dentro la transazione, solo per la rettifica).
  L'annullamento copia alla lettera (`correggi-movimento.use-case.ts:297-312`,
  `:455-466`): già indipendente dalle causali.
- `src/api/registro/dtos/registra-movimento.dto.ts:15-20` `ALL_CAUSALI`, `:57-65`
  `@IsIn(ALL_CAUSALI)` su `causale`, `:166-169` stesso `@IsIn` sul filtro `causale` di
  `ListMovimentiDto`. `RettificaMovimentoDto` deriva da `RegistraMovimentoDto`
  (`correggi-movimento.dto.ts:1-5`, `OmitType`).
- `src/application/registro/commands/registra-movimento.command.ts:23`
  `causale: CausaleMovimento`; `correggi-movimento.use-case.ts:16,36,334,480` e
  `registra-movimento.use-case.ts:15,538` usano `CausaleMovimento`;
  `verifica-catena-registro.service.ts:72` `causale: r.causale as never`.
- `src/application/mud/aggregazione/mud-regole.ts:25-45` `RuoloMovimento` e le mappe
  `RUOLO_CARICO`/`RUOLO_SCARICO` (causale non elencata = `ESCLUSO`), `:53-57`
  `operazioneDaCausale` (AVVIO_RECUPERO → R, AVVIO_SMALTIMENTO → D). Usi:
  `mud-aggregazione.service.ts:16-23` (import), `:151` (select), `:330` (gruppi dei
  doppi, anche per gli anni precedenti), `:405` (classificazione), `:663`
  (`recuperoOSmaltimento`). `mud-controlli.ts:30,279-282` (`CAUSALE_ESCLUSA`, messaggio col
  codice).
- `src/application/registro/queries/list-movimenti.handler.ts:106` (filtro per causale
  esatta), `:154` (causale restituita come codice, nessuna descrizione).
- `src/application/registro/giacenze-iniziali.service.ts:533` (`causale = 'ALTRO_CARICO'`
  nell'avviso G8) e `registra-movimento.use-case.ts:658-661` (`RIMEDIO_CARICO_MANCANTE`
  cita "Produzione interna"): letterali di codici di sistema, restano validi.
- `prisma/schema.prisma:1816-1819`: `causale String @db.VarChar(100)` con l'elenco nel
  commento; commento di `entryHash` a `:1849-1851`. Nessun catalogo, nessun codice RENTRI.
  Il catalogo ufficiale sincronizzato non contiene le causali (roadmap §F2-5).
- Nessun altro uso: `grep -rn causale` non trova occorrenze in `application/dashboard`,
  `anomaly`, `esg`, `giacenze` (la giacenza conta ogni CARICO e SCARICO a prescindere dalla
  causale, `giacenza-disponibile.ts`), statistiche. `infrastructure/rentri/rentri-registri.client.ts:531-532`
  ha `causale_operazione` del contratto ma nessun chiamante (F2-9).
- RLS: `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts:64`
  `expect(righe.length).toBe(31)` (tabelle con `tenant_id`); "(31)" anche in
  `README-tenant-transazione.md:120,131,143`. `TENANT_SCOPED_MODELS` in
  `prisma-rls.extension.ts:47-91`, con il test DMMF di `prisma-rls.extension.spec.ts:187-217`.
- Privilegi: `prisma/sql/ruoli-db.sql:75-87` concede **CRUD su ogni tabella** a
  `wasteflow_app` e `wasteflow_sistema` a ogni esecuzione, e `:93-101` imposta i default
  privileges (CRUD sulle tabelle future dell'owner). `ops/db-ruoli.sh` lo esegue dopo ogni
  `prisma migrate deploy`. **Quindi una REVOKE scritta solo nella migration verrebbe
  annullata alla prima esecuzione di `db-ruoli.sh`.** Test: `src/infrastructure/database/ruoli-db.postgres.spec.ts`.
- `src/infrastructure/persistence/prisma.service.ts:83-96` `cleanDatabase()` (solo
  `NODE_ENV=test`) fa `TRUNCATE ... CASCADE` di **ogni** tabella tranne `_prisma_migrations`:
  svuoterebbe anche il catalogo della migration.
- Guardia dei lettori di `waste_movements`: `src/application/registro/lettori-movimenti.spec.ts:24`.
- Ultima migration: `20261029100000_rettifica_annullamento`. Il piano dei FIR, su un altro
  branch, userà `20261030110000_fir_versione`.
- Ruoli: `registro.controller.ts:73-74` `RUOLI_REGISTRAZIONE`, `RUOLI_PROGRESSIVO_INIZIALE`
  (costanti NON esportate), `:568-575` `haRuolo` privato su `RuoloEffettivoService`.

**Frontend.**
- `apps/frontend/src/app/features/registro/registro.service.ts:10-28` copia delle costanti
  e dei tipi, `:57,102,119` `causale: CausaleMovimento` nei modelli, `:160` filtro,
  `:171-182` `CAUSALE_LABELS`.
- `registro-opzioni.ts:23-26` `opzioniCausali(tipo)` sincrona dalle costanti, usata da
  `registro.component.ts:1390-1392` (`causaliOptions`) e da
  `correggi-movimento-dialog.component.ts:485`.
- Etichette: `registro.component.ts:2216-2218`, `correggi-movimento-dialog.component.ts:499-501`,
  `core/services/export.service.ts:11-12,380,406,436-439` (export PDF/Excel).
- `registro-fir.ts:45-51` `causalePredefinitaDaFir`: propone `CONFERIMENTO_TRASPORTATORE` /
  `INGRESSO_ESTERNO` nella ricopia di un FIR, applicata a `registro.component.ts:1585-1590`.
- Dialog amministrativo di riferimento: `giacenze-iniziali-dialog.component.ts`, aperto da
  `registro.component.ts:155-160,975-980,1912-1920` quando `statoProgressivo().puoImpostare`.
- e2e: nessun test seleziona causali del registro (`e2e/tests/registro/registro-carico-scarico.spec.ts:23`
  è un TODO); `rentri-ciclo-formulario.spec.ts:163-166` riguarda la causale di
  respingimento del FIR (NC/IR/A), estranea.

## Decisioni (dell'orchestratore, vincolanti)

- **C1. Catalogo di sistema `causali_registro`** (modello `CausaleRegistro`), globale,
  **senza `tenant_id`, senza RLS**:
  `codice VARCHAR(100)`, `verso waste_movement_type` (enum esistente `WasteMovementType`),
  `descrizione VARCHAR(200)`, `ruolo_mud ruolo_mud_causale` (enum nuovo
  `RuoloMudCausale { PRODOTTO, AVVIATO, RICEVUTO_DA_TERZI, ESCLUSO }`), `codice_rentri
  VARCHAR(5) NULL`, `operazione VARCHAR(1) NULL`, `ordine SMALLINT`, `attiva BOOLEAN NOT NULL
  DEFAULT true`, `created_at`. Chiave primaria `(codice, verso)` (`@@id`, map
  `causali_registro_pkey`). CHECK (nomi espliciti, uguali nelle due tabelle col prefisso):
  - `codice ~ '^[A-Z][A-Z0-9_]*$' AND codice !~ '^AZ_'` (il prefisso `AZ_` è riservato alle
    aziende: collisione impossibile per costruzione);
  - ruolo coerente col verso: CARICO → `PRODOTTO | RICEVUTO_DA_TERZI | ESCLUSO`;
    SCARICO → `AVVIATO | ESCLUSO` (gli stessi ruoli che le mappe di oggi assegnano);
  - codice RENTRI NULL oppure coerente col verso: CARICO → `DT | NP | T* | RE`; SCARICO →
    `I | aT | M`. **`TR` e `T*aT` non sono ammessi**: sono `CaricoScarico`
    (`CausaliOperazioneCs`), un tipo di movimento che il registro non ha (intermediari e
    trasportatori: Fase 4);
  - `operazione` NULL oppure (`verso = 'SCARICO' AND ruolo_mud = 'AVVIATO' AND operazione IN ('R','D'))`.
  Le righe le scrive **solo la migration** (owner). **Regola di immutabilità**, scritta nel
  commento della migration: `verso`, `ruolo_mud` e `operazione` di una riga di sistema non
  cambiano mai (un cambio futuro è una nuova causale con un nuovo codice e la
  disattivazione della vecchia, `attiva = false`); `codice_rentri` può essere corretto da
  una migration futura **solo finché F2-9 non ha trasmesso nulla** (dopo, una correzione
  cambierebbe il significato di trasmissioni già fatte e va decisa in F2-9).
- **C2. Privilegi del catalogo.** Nella migration, subito dopo la `CREATE TABLE` (i default
  privileges hanno già dato CRUD all'app): in un blocco `DO` che controlla l'esistenza di
  ciascun ruolo in `pg_roles`, `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON causali_registro
  FROM wasteflow_app, wasteflow_sistema` e `GRANT SELECT ON causali_registro TO
  wasteflow_app, wasteflow_sistema`. **Nessun GRANT a `wasteflow_lettura`**: per scelta
  della Fase 1 quel ruolo non ha privilegi propri sulle tabelle
  (`20261026100000_rls_sola_lettura_controlli/migration.sql`, commento iniziale); chi lo usa
  legge con i propri diritti. **Stessa regola in `prisma/sql/ruoli-db.sql`**: un elenco
  costante `v_sola_lettura text[] := ARRAY['causali_registro']`; nel ciclo di `:75-87` le
  tabelle in elenco ricevono solo `SELECT` e una `REVOKE INSERT, UPDATE, DELETE, TRUNCATE`
  esplicita (idempotente, come `_prisma_migrations` a `:89-92`). Commento in testa allo
  script aggiornato. I default privileges restano CRUD: una tabella globale futura va
  aggiunta all'elenco (scriverlo nel commento).
- **C3. Contenuto del catalogo e mapping RENTRI.** La migration inserisce le 11 righe di
  oggi, con gli stessi codici e, come descrizioni, le etichette del frontend
  (`registro.service.ts:171-182`):

  | codice | verso | descrizione | ruolo MUD | RENTRI | operazione | ordine |
  |---|---|---|---|---|---|---|
  | PRODUZIONE_INTERNA | CARICO | Produzione interna | PRODOTTO | `DT` | — | 10 |
  | INGRESSO_ESTERNO | CARICO | Ingresso da esterno | RICEVUTO_DA_TERZI | `T*` (da confermare) | — | 20 |
  | RICLASSIFICAZIONE | CARICO | Riclassificazione CER | ESCLUSO | NULL | — | 30 |
  | RECUPERO_PARZIALE | CARICO | Recupero parziale | PRODOTTO | NULL | — | 40 |
  | ALTRO_CARICO | CARICO | Altro carico | ESCLUSO | NULL | — | 50 |
  | CONFERIMENTO_TRASPORTATORE | SCARICO | Conferimento a trasportatore | AVVIATO | `aT` | — | 10 |
  | AVVIO_RECUPERO | SCARICO | Avvio a recupero (R) | AVVIATO | `aT` | R | 20 |
  | AVVIO_SMALTIMENTO | SCARICO | Avvio a smaltimento (D) | AVVIATO | `aT` | D | 30 |
  | CESSIONE | SCARICO | Cessione a terzi | AVVIATO | `aT` | — | 40 |
  | RICLASSIFICAZIONE | SCARICO | Riclassificazione CER | ESCLUSO | NULL | — | 50 |
  | ALTRO_SCARICO | SCARICO | Altro scarico | ESCLUSO | NULL | — | 60 |

  Motivazioni (da riportare come commento SQL accanto alle righe):
  - `DT` per la produzione nell'unità locale (contratto: "prodotto o detenuto nell'unità
    locale"; WinWaste `OPER 10` → `DT`/C).
  - `T*` per la ricezione da terzi (contratto: "ricevuto da terzi"), **da confermare**
    prima di F2-9: per un produttore puro un rifiuto proprio prodotto altrove (cantiere,
    manutenzione) e portato nell'unità locale è `RE` ("prodotto al di fuori dell'unità
    locale"), e `INGRESSO_ESTERNO` oggi copre entrambi i casi.
  - NULL per `RECUPERO_PARZIALE`: il caso "nuovo produttore" (`NP`) è plausibile (WinWaste
    trasforma `DT` in `NP` per le operazioni da gestore), ma non è certo per chi non è un
    impianto autorizzato; F2-9 lo segnalerà come non trasmissibile finché non è deciso.
  - `aT` per i quattro scarichi `AVVIATO`: il MUD di oggi li tratta tutti come consegna a
    terzi (`mud-regole.ts:35-40`); `I` (scarico interno verso un proprio impianto) non è
    coerente con quel ruolo. Chi avvia a recupero in un impianto proprio crea una causale
    aziendale con `I` e ruolo `ESCLUSO`.
  - NULL per `RICLASSIFICAZIONE` (in RENTRI non c'è una causale di riclassificazione:
    corrisponderebbe a uno scarico e un carico con causali da decidere caso per caso) e per
    `ALTRO_CARICO`/`ALTRO_SCARICO` (per definizione non classificate).
  L'operazione R/D sostituisce `operazioneDaCausale` con gli stessi due valori. Il ruolo
  MUD riproduce esattamente le mappe di `mud-regole.ts` (le causali assenti dalle mappe
  sono `ESCLUSO`): **il MUD di ogni anno resta identico** (test di equivalenza con la
  vecchia implementazione come oracolo, Task 3). La migration emette un `RAISE NOTICE` col
  numero di movimenti la cui coppia `(causale, type)` non è nel catalogo (dati storici:
  oggi sono `ESCLUSO` e lo restano), senza fallire.
  **Nessun override per azienda del codice RENTRI (né del ruolo MUD) di una causale di
  sistema**: un'azienda che vuole un comportamento diverso disattiva la causale di sistema
  e ne crea una propria. Un override vero è fuori ambito.
- **C4. Personalizzazioni `causali_registro_azienda`** (modello `CausaleRegistroAzienda`),
  `tenant_id` NOT NULL, RLS, una tabella con discriminatore
  `natura natura_causale_azienda` (enum `NaturaCausaleAzienda { PROPRIA, DISATTIVAZIONE }`):
  colonne `id UUID`, `tenant_id`, `natura`, `codice VARCHAR(100)`, `verso
  waste_movement_type`, `causale_sistema_codice VARCHAR(100) NULL`, `descrizione
  VARCHAR(200) NULL`, `ruolo_mud ruolo_mud_causale NULL`, `codice_rentri VARCHAR(5) NULL`,
  `operazione VARCHAR(1) NULL`, `ordine SMALLINT NOT NULL DEFAULT 100`, `valida_dal DATE
  NULL`, `valida_al DATE NULL`, `creato_da UUID`, `created_at`, `updated_at`.
  - **DISATTIVAZIONE** (decisione 2a): `causale_sistema_codice = codice`, chiave esterna
    `(causale_sistema_codice, verso) → causali_registro(codice, verso)` `ON DELETE RESTRICT`
    (MATCH SIMPLE: le righe PROPRIA, con NULL, non sono controllate); descrizione, ruolo,
    RENTRI, operazione, validità tutti NULL. **Non datata**: finché la riga esiste la
    causale di sistema non è selezionabile per l'azienda in nessuna data; cancellarla la
    riattiva. Non tocca mai il MUD né l'elenco. Unica per `(tenant_id,
    causale_sistema_codice, verso)` (`@@unique`, i NULL delle PROPRIA non collidono).
  - **PROPRIA** (decisione 2b): `causale_sistema_codice` NULL, `codice ~
    '^AZ_[A-Z0-9_]{2,40}$'`, descrizione/ruolo/`valida_dal` NOT NULL, `valida_al` NULL o ≥
    `valida_dal`, stessi CHECK di coerenza verso/ruolo/RENTRI/operazione di C1. Ogni riga è
    una **versione**: stessa coppia `(codice, verso)`, periodi `[valida_dal, valida_al]`
    disgiunti. `@@unique([tenantId, codice, verso, validaDal])` (map
    `causali_registro_azienda_versione_key`).
  - CHECK di natura (nomi `causali_registro_azienda_natura_*`) che impongono le due forme.
  - `@@unique([id, tenantId])` e `@@unique([id, tenantId, codice, verso])` (map
    `causali_registro_azienda_id_tenant_codice_verso_key`, serve a C6),
    `@@index([tenantId])`. Tenant `ON DELETE CASCADE`.
  - Trigger `causali_registro_azienda_controlli` (funzione
    `causali_registro_azienda_controlli()`, `BEFORE INSERT OR UPDATE`; i trigger non entrano
    in `migrate diff`). "Usata" = esiste un movimento con `causale_azienda_id = OLD.id`;
    "ultimo giorno d'uso" = `max(<giorno italiano>)` di quei movimenti (espressione in C5).
    Controlli:
    1. sovrapposizione di periodi fra versioni PROPRIA della stessa `(tenant_id, codice,
       verso)` (con `valida_al` NULL = infinito) → `RAISE EXCEPTION`;
    2. in UPDATE, `tenant_id`, `natura`, `codice`, `verso`, `causale_sistema_codice`
       immutabili;
    3. in UPDATE, se la versione è usata: `ruolo_mud`, `codice_rentri`, `operazione` e
       `valida_dal` immutabili, e `valida_al` (se non NULL) ≥ ultimo giorno d'uso.
    È la rete del database; il percorso normale è C5. Niente `btree_gist` / `EXCLUDE`.
  - Più un indice unico parziale `causali_registro_azienda_una_aperta` su
    `(tenant_id, codice, verso) WHERE natura = 'PROPRIA' AND valida_al IS NULL` (non
    esprimibile in Prisma, come `registri_rifiuti_uno_senza_sede_per_tenant`; verificare che
    `migrate diff` resti vuoto, altrimenti toglierlo e dirlo nel rapporto: il trigger basta).
  - RLS in fondo alla migration: `ENABLE` + `FORCE`, policy `isolamento_azienda` e
    `sola_lettura ... TO wasteflow_lettura`, stessa forma di
    `20261028100000_giacenze_iniziali/migration.sql` (sezione 4). Nessun GRANT (default
    privileges). Modello in `TENANT_SCOPED_MODELS`.
- **C5. Versioni e non retroattività (decisione 2).** Regole del servizio di gestione,
  tutte in transazione con `pg_advisory_xact_lock(hashtext('causale|' || tenant || '|' ||
  verso || '|' || codice))` e, per le operazioni su una versione esistente, `SELECT ... FOR
  UPDATE` della riga (attende gli insert di movimenti in corso che la referenziano: la
  chiave esterna di C6 tiene un `FOR KEY SHARE` fino al commit, che `FOR UPDATE` non
  attraversa).
  - **Giorno italiano di un movimento**, unica espressione SQL ammessa (nel trigger, nel
    servizio e nei test): `(movement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date`
    (`movement_date` è `timestamp without time zone` in UTC, come lo scrive Prisma; il primo
    `AT TIME ZONE` lo rende `timestamptz`, il secondo lo porta all'ora di Roma). Test: un
    movimento delle 23:30 UTC del 31 dicembre conta il 1° gennaio.
  - **Uso di tutte le versioni dell'azienda**, una sola query (anche per `gestione`, C13):
    ```sql
    SELECT c.id,
           count(m.id)::int AS movimenti,
           max((m.movement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date) AS ultimo_giorno_uso
    FROM causali_registro_azienda c
    LEFT JOIN waste_movements m
      ON m.causale_azienda_id = c.id AND m.tenant_id = c.tenant_id
    WHERE c.tenant_id = $1 AND c.natura = 'PROPRIA'
    GROUP BY c.id
    ```
    (contano tutte le annotazioni, anche rettificate e annullamenti). Per una sola versione,
    la stessa query con `AND c.id = $2`.
  - **Creazione**: `valida_dal` facoltativo (default oggi, giorno italiano), qualunque data
    ≤ oggi + 365; nessuna sovrapposizione.
  - **Modifica (PATCH) in place.** Semantica dei campi: **assente** (`=== undefined`) =
    invariato, **`null`** (`=== null`) = azzera (solo per i campi nullable: `codiceRentri`,
    `operazione`; `null` su `descrizione`, `ruoloMud`, `validaDal`, `ordine` → 400).
    `descrizione` e `ordine` sempre; `ruolo_mud`, `codice_rentri`, `operazione` e
    `valida_dal` **solo se la versione non è usata**, altrimenti 409
    `CAUSALE_USATA_NUOVA_VERSIONE` ("Questa causale è già usata nel registro: per cambiarne
    il comportamento crea una nuova versione con una data di inizio."). I vincoli di C1/C4
    (coerenza verso/ruolo/RENTRI/operazione) si validano nel servizio **sul record
    risultante** dalla fusione (es. ruolo passato a `ESCLUSO` con `operazione` rimasta `R`
    → 400 "L'operazione R/D vale solo per gli scarichi avviati a recupero o smaltimento.").
  - **Nuova versione** (solo dall'ultima versione della coppia, altrimenti 409
    `CAUSALE_NON_ULTIMA_VERSIONE`): `valida_dal` nuova > `valida_dal` della precedente;
    `ruolo_mud` obbligatorio; `codice_rentri` e `operazione` **assenti = NULL** (non si
    copiano); si copiano dalla precedente solo `descrizione` e `ordine` se non indicati.
    Se la precedente è aperta, **prima l'UPDATE di chiusura** a `valida_dal - 1` (che deve
    essere ≥ l'ultimo giorno d'uso, altrimenti 409 `CAUSALE_DATA_PRIMA_DELL_ULTIMO_USO` con
    la prima data ammessa nel messaggio), **poi l'INSERT** (nell'ordine inverso il trigger
    vedrebbe una sovrapposizione); se è già chiusa, la nuova deve iniziare dopo `valida_al`.
  - **Chiusura** (`valida_al`): ≥ `valida_dal` e ≥ l'ultimo giorno d'uso (stesso 409).
  - **Cancellazione**: solo se non usata (409 `CAUSALE_USATA_NON_ELIMINABILE`; la chiave
    esterna NoAction di C6 è la rete). Cancellare l'ultima versione **non riapre** la
    precedente: resta chiusa com'era (per riaprire si crea una nuova versione).
  - Disattivazione/riattivazione di una causale di sistema: insert/delete della riga
    DISATTIVAZIONE (idempotenti: 204 anche se già nello stato richiesto); codice di sistema
    inesistente → 404.
  - `codice` e `verso` di una causale propria non si cambiano mai (si crea un'altra causale).
  - Audit: `activityLog.create` nella stessa transazione (`REGISTRO_CAUSALE_CREATA |
    MODIFICATA | VERSIONATA | CHIUSA | ELIMINATA | DISATTIVATA | RIATTIVATA`, metadata con
    codice, verso, id delle versioni coinvolte e date), come
    `giacenze-iniziali.service.ts:551-560`.
- **C6. Riferimento facoltativo sul movimento: SÌ.** Colonna `waste_movements.causale_azienda_id
  UUID NULL` con chiave esterna composta `(causale_azienda_id, tenant_id, causale, type) →
  causali_registro_azienda(id, tenant_id, codice, verso)` `ON DELETE NO ACTION ON UPDATE NO
  ACTION` (map `waste_movements_causale_azienda_fkey`), indice
  `waste_movements_causale_azienda_id_idx` e CHECK
  `waste_movements_causale_azienda_coerente`:
  `(causale LIKE 'AZ\_%') = (causale_azienda_id IS NOT NULL)` (una causale aziendale ha
  sempre il riferimento, una di sistema o storica mai). Prima di aggiungerlo la migration
  conta i movimenti con `causale LIKE 'AZ\_%'` e, se ce ne sono, si ferma con un
  `RAISE EXCEPTION` leggibile (atteso zero: il prefisso nasce qui).
  Motivi del riferimento: (a) il MUD e F2-9 leggono il comportamento della **versione
  effettivamente scelta**, senza ricalcoli per data; (b) il database garantisce che codice
  e verso del movimento coincidano con la versione e che una versione usata non si
  cancelli; (c) rende "usata" una query esatta e rende race-free C5 (lock di riga).
  NoAction e non Restrict per la stessa ragione di F2-3 R1: la cancellazione a cascata di
  un'azienda cancella movimenti e causali nello stesso statement. **Nessun backfill**:
  oggi non esistono causali aziendali. La colonna **non entra nell'hash** v2 (formato di
  F2-3 invariato) e il commento di `entryHash` nello schema non si tocca. Valorizzata da
  registrazione e rettifica (C8) quando la causale risolve a una versione aziendale;
  l'annullamento copia alla lettera quella della testa (C9).
- **C7. Risolutore unico.** Due livelli:
  - **Dominio puro** `src/domain/waste-movement/catalogo-causali.ts`: tipi
    `DefinizioneCausale { codice, verso, descrizione, ruoloMud, codiceRentri, operazione,
    ordine, origine: 'SISTEMA' | 'AZIENDA', versioneId: string | null, validaDal, validaAl,
    attiva }` e classe `CatalogoCausali` costruita da righe di sistema + righe aziendali:
    - `comportamento(verso, codice, giorno, versioneId?)` → definizione o `null`. Con
      `versioneId` usa quella versione (se codice e verso coincidono, altrimenti `null`);
      senza: codice `AZ_` → versione valida al giorno; altrimenti la riga di sistema
      `(codice, verso)`. **Ignora** `attiva` e le disattivazioni (il MUD di un movimento
      passato non dipende dalla selezionabilità di oggi). `null` = causale sconosciuta per
      quel verso → ruolo `ESCLUSO`, codice RENTRI assente (come oggi).
    - `selezionabile(verso, codice, giorno)` → `{ ok: true, definizione } | { ok: false,
      motivo: 'SCONOSCIUTA' | 'VERSO' | 'DISATTIVATA' | 'FUORI_VALIDITA' }`: sistema con
      `attiva` e senza disattivazione dell'azienda; propria con una versione valida al
      giorno. `VERSO` = il codice esiste solo nell'altro verso.
    - `opzioni(verso, giorno)` → definizioni selezionabili, ordinate per `ordine`, poi
      sistema prima di azienda, poi `codice`.
    - `descrizione(verso, codice, giorno, versioneId?)` per elenco e risposte (fallback: il
      codice).
    `giorno` = stringa `AAAA-MM-GG` del giorno italiano (`giornoItaliano` di
    `core/time/anno-italiano.ts:25`); le colonne `DATE` lette da Prisma (mezzanotte UTC) si
    convertono con `toISOString().slice(0, 10)`, mai con `giornoItaliano`.
  - **Caricamento** `src/application/registro/causali/catalogo-causali.repository.ts`:
    `caricaCatalogoCausali(db: LettoreCatalogoCausali, tenantId): Promise<CatalogoCausali>`
    e `confermaVersioneAzienda(tx: Prisma.TransactionClient, tenantId, versioneId, giorno)`
    (rilettura `FOR KEY SHARE` della versione dentro la transazione di insert; se non è
    più valida al giorno → `ConflictException` `CAUSALE_MODIFICATA` "La causale è stata
    modificata nel frattempo: ricarica e riprova."). **Tipo del parametro `db`**:
    interfaccia strutturale esportata `LettoreCatalogoCausali` con i soli
    `causaleRegistro.findMany` e `causaleRegistroAzienda.findMany` (forma minima degli
    argomenti usati), sul modello di `LettoreCatalogoCer` (`cer-catalogo.ts:4-35`): la
    soddisfano `PrismaService`, `Prisma.TransactionClient` e i mock degli spec senza
    `as any`. `validaDatiMovimento` tipizza `db` come `LettoreCatalogoCer &
    LettoreCatalogoCausali`. **Funzioni con `db` come parametro, non un provider
    iniettato**: i costruttori di `RegistraMovimentoUseCase`, `CorreggiMovimentoUseCase`,
    `MudAggregazioneService` e `ListMovimentiHandler` non cambiano (sono istanziati a mano
    in ~20 spec, elenco in `grep -rn "new RegistraMovimentoUseCase\|new MudAggregazioneService\|new ListMovimentiHandler\|new CorreggiMovimentoUseCase" src`).
    Un catalogo per operazione (una registrazione, una correzione, un'aggregazione MUD,
    una pagina dell'elenco), mai una query per movimento.
- **C8. Validazione della registrazione e della rettifica.** `validaDatiMovimento` riceve
  `tenantId` e (solo per la rettifica) `causaleAttuale?: { codice, versioneId }`, carica il
  catalogo e, nello stesso ordine di oggi (causale prima di CER e date):
  - registrazione: `selezionabile(type, causale, giornoItaliano(movementDate))`; errore →
    stesso formato di oggi, `Causale non valida per CARICO: X. Valori: A, B, ...` con i
    codici di `opzioni` a quella data (per `DISATTIVATA`/`FUORI_VALIDITA` il testo dice
    "non è attiva per l'azienda" / "non è valida alla data dell'operazione");
  - rettifica: se `causale` coincide con `causaleAttuale.codice` basta
    `comportamento(type, causale, nuovoGiorno)` **senza `versioneId`** (risoluzione per
    data) `!== null` — una causale disattivata dopo la registrazione non deve impedire di
    correggere la quantità; se cambia, vale `selezionabile`. In entrambi i casi
    `causaleAziendaId` = `versioneId` della definizione **risolta alla nuova data**;
    `causaleAttuale.versioneId` è solo informativo (log/messaggio), non decide la versione.
    Una data nuova fuori da ogni versione della causale propria → 400 "non è valida alla
    data dell'operazione".
  - Il risultato porta `cerCode`, `causaleAziendaId` (id della versione o `null`) e
    `causaleDescrizione` (per la risposta, M8). Il caso d'uso salva `causaleAziendaId` (C6)
    dopo `confermaVersioneAzienda` dentro la sua transazione.
  - `WasteMovement.create` **non** controlla più l'elenco (il dominio non conosce il
    catalogo dell'azienda): verifica solo causale non vuota, ≤ 100 caratteri, formato
    `^[A-Z][A-Z0-9_]*$`. `CausaleMovimento` diventa `string` ovunque.
  - DTO: `causale` con `@IsString() @IsNotEmpty() @MaxLength(100)
    @Matches(/^[A-Z][A-Z0-9_]*$/)`; il filtro di `ListMovimentiDto` con `@IsString()
    @MaxLength(100)`. Una causale sconosciuta passa il DTO e la respinge il caso d'uso
    (400, stesso messaggio): aggiornare gli spec DTO e HTTP che si aspettavano il 400 da
    `@IsIn`.
  - Le costanti `CAUSALI_CARICO`, `CAUSALI_SCARICO`, `ALL_CAUSALI`, i tipi
    `CausaleCarico/CausaleScarico/CausaleMovimento`, le mappe `RUOLO_CARICO/RUOLO_SCARICO` e
    `operazioneDaCausale` spariscono dal codice non di test. **Guardia statica**
    `src/application/registro/causali/costanti-causali.guardia.spec.ts` (modello
    `lettori-movimenti.spec.ts`): cerca solo le **dichiarazioni**, con la regex
    `\b(const|function|type|enum|export)\b[^\n]*\b(NOME)\b` per ciascun nome, nei `.ts`
    non spec di `apps/backend/src` dopo aver tolto i commenti (`senzaCommenti` come nel
    modello): un commento che cita il vecchio nome non la fa fallire. La crea il Task 3
    coi nomi del MUD (`RUOLO_CARICO`, `RUOLO_SCARICO`, `operazioneDaCausale`); il Task 4a vi
    aggiunge i propri (`CAUSALI_CARICO`, `CAUSALI_SCARICO`, `ALL_CAUSALI`, `CausaleCarico`,
    `CausaleScarico`, `CausaleMovimento`). Ogni task aggiunge solo i nomi che rimuove.
- **C9. Annullamento.** Il **risultato** non dipende dal catalogo: copia alla lettera
  `causale` e `causale_azienda_id` della testa, anche se la causale non è più nel catalogo,
  è disattivata o la versione è chiusa (la chiave esterna e il CHECK di C6 restano
  soddisfatti perché la coppia è copiata intera). Il catalogo si legge solo **dopo** il
  commit, per la `causaleDescrizione` della risposta (M8); per una causale fuori catalogo
  vale il codice.
- **C10. MUD.** `MudAggregazioneService` carica il catalogo una volta per aggregazione e
  classifica ogni movimento (anno e anni precedenti, compreso `gruppoDoppi`) con
  `comportamento(type, causale, giornoItaliano(movementDate), causaleAziendaId)`:
  `ruoloMud ?? 'ESCLUSO'` al posto di `classificaMovimento`, `operazione` al posto di
  `operazioneDaCausale` (stesso posto nella catena di `recuperoOSmaltimento`). Il `select`
  dei movimenti (`:151`) aggiunge `causaleAziendaId`. Le funzioni pure restano in
  `mud-regole.ts` con firma `classificaMovimento(catalogo, m)` /
  `operazioneDaCatalogo(catalogo, m)`. Nessun altro cambiamento al MUD (sedi, giacenze al
  31/12: F2-8).
- **C11. Elenco e risposte.** `list-movimenti.handler.ts` carica il catalogo una volta per
  pagina e aggiunge a ogni riga `causaleDescrizione: string` (descrizione della versione o
  della riga di sistema; per un codice sconosciuto, il codice) e `causaleCodiceRentri:
  string | null` (informativo, per F2-9 e per l'interfaccia). Il filtro per causale resta
  per codice esatto. **Anche le risposte di registrazione (`movimentoDaRecord`) e di
  correzione (`{ movimento, avvisi }`) portano `causaleDescrizione`** (M8).
- **C12. Classe di giacenza: nessuna colonna.** La roadmap la cita nell'obiettivo, ma oggi
  ogni CARICO aumenta e ogni SCARICO diminuisce la giacenza a prescindere dalla causale, e
  le classi di WinWaste (`T`, `R`, `D`, `X`, `movimenti.md` §2.6) servono a deposito
  temporaneo per età (F2-6) e a stoccaggi da gestore (Fase 4). Il verso basta; una classe
  si aggiungerà quando un pezzo la userà.
- **C13. API** (controller nuovo `src/api/registro/causali-registro.controller.ts`,
  `@Controller('registro/causali')`, `JwtAuthGuard`, tenant da `requireRequestTenantId`,
  ruoli effettivi con `RuoloEffettivoService` come `haRuolo` di `registro.controller.ts`;
  `RUOLI_PROGRESSIVO_INIZIALE` diventa `export const` in `registro.controller.ts` e lo si
  importa, senza altre modifiche a quel file):
  - `GET registro/causali?tipo=CARICO|SCARICO&data=AAAA-MM-GG` (qualunque ruolo; `data`
    facoltativa = oggi italiano) → `{ tipo, data, causali: [{ codice, descrizione, origine,
    ruoloMud, codiceRentri, operazione, versioneId }] }` = `opzioni`.
  - `GET registro/causali/gestione` (ADMIN) → `{ sistema: [{ codice, verso, descrizione,
    ruoloMud, codiceRentri, operazione, ordine, attiva, disattivataPerAzienda }], aziendali:
    [{ id, codice, verso, descrizione, ruoloMud, codiceRentri, operazione, ordine,
    validaDal, validaAl, usata, ultimoGiornoUso }] }` (date `AAAA-MM-GG`; `usata` e
    `ultimoGiornoUso` dalla query aggregata di C5).
  - `PUT` / `DELETE registro/causali/sistema/:verso/:codice/disattivazione` (ADMIN, 204).
  - `POST registro/causali/aziendali` (ADMIN, 201) `{ codice, verso, descrizione,
    ruoloMud, codiceRentri?, operazione?, ordine?, validaDal? }`.
  - `PATCH registro/causali/aziendali/:id` (ADMIN) `{ descrizione?, ordine?, ruoloMud?,
    codiceRentri?: string | null, operazione?: string | null, validaDal? }` (semantica
    assente/null di C5).
  - `POST registro/causali/aziendali/:id/versioni` (ADMIN, 201) `{ validaDal, ruoloMud,
    codiceRentri?, operazione?, descrizione?, ordine? }` (C5: assenti = NULL per RENTRI e
    operazione).
  - `PUT registro/causali/aziendali/:id/chiusura` (ADMIN) `{ validaAl }`.
  - `DELETE registro/causali/aziendali/:id` (ADMIN, 204).
  `:id` con `ParseUUIDPipe`; `:verso` validato (400); id di un'altra azienda → 404 (la RLS
  lo nasconde). Non ADMIN → 403 `REGISTRO_CAUSALI_RISERVATE_AMMINISTRATORI` ("Solo un
  amministratore dell'azienda può gestire le causali del registro."). Errori del servizio
  come eccezioni Nest con messaggi in italiano, mai id di tenant.
  Il servizio applicativo `src/application/registro/causali/causali-registro.service.ts`
  (`CausaliRegistroService`, iniettato, `PrismaService` corrente del registro) fa
  gestione ed elenco; registrato in `registro.module.ts`.
- **C14. Frontend.**
  - Servizio `features/registro/causali-registro.service.ts` (tutte le chiamate di C13),
    con cache per `(tipo, giorno)` delle opzioni, invalidata dopo ogni modifica.
  - `registro-opzioni.ts`: `opzioniCausali(righe, corrente?)` pura, dalle righe dell'API;
    un codice `corrente` assente dalle righe si aggiunge con etichetta
    `descrizione ?? codice` (come `opzioniUnita` per l'unità storica).
  - Registrazione: opzioni dall'API per tipo e per la data dell'operazione del form
    (ricaricate al cambio di tipo o di data; senza data, oggi). La causale proposta dal FIR
    (`causalePredefinitaDaFir`) si applica **dopo** che le opzioni del tipo e della data
    del FIR sono arrivate, e solo se è fra loro (altrimenti nessuna proposta e il messaggio
    "scegli la causale" di oggi); prima delle opzioni non si imposta nulla, così un
    caricamento lento non cancella la proposta.
  - Rettifica: opzioni per il tipo della testa alla data del form + la causale attuale.
  - Etichette: `CAUSALE_LABELS` e le costanti spariscono; elenco ed export usano
    `causaleDescrizione` (C11), con fallback al codice.
  - Gestione per gli ADMIN: dialog standalone `causali-registro-dialog.component.ts`
    aperto da un pulsante "Causali" della barra del registro visibile con
    `statoProgressivo()?.puoImpostare === true` (come le giacenze iniziali). Due sezioni:
    "Causali di sistema" (codice, descrizione, verso, ruolo MUD, codice RENTRI o "non
    trasmissibile a RENTRI", interruttore "Attiva per l'azienda") e "Causali dell'azienda"
    (tabella delle versioni con validità e "usata", azioni Nuova, Modifica, Nuova versione,
    Chiudi, Elimina abilitate secondo `usata`; il codice ha il prefisso fisso `AZ_`
    mostrato e non digitabile; ruolo MUD e codice RENTRI filtrati per verso come i CHECK di
    C1). Errori 409 mostrati col testo del backend.
- **C15. Verifica.** Nessun test e2e Playwright nuovo (nessun e2e oggi copre il form del
  registro). Dopo il deploy, **verifica manuale in produzione** (o in collaudo), da riportare
  nel rapporto di rilascio, con un'azienda di prova:
  1. il registro mostra le 11 causali di sempre, con le stesse etichette; un movimento
     esistente mostra la sua descrizione;
  2. da ADMIN: disattivare `CESSIONE` → sparisce dalle opzioni di SCARICO; riattivarla;
  3. creare `AZ_PROVA` (SCARICO, ruolo `ESCLUSO`, RENTRI `I`), registrare uno scarico con
     quella causale, verificare che la modifica del ruolo dia il 409 e che una nuova
     versione dal giorno dopo sia accettata;
  4. l'anteprima del MUD dell'anno precedente è identica a prima del deploy (stessi totali
     e stesso hash dell'aggregato);
  5. rettificare la quantità del movimento del punto 3 e poi annullarlo;
  6. pulizia: annullamenti restano nel registro di prova (come ogni annotazione); la
     causale `AZ_PROVA` resta chiusa.
- **C16. Fuori ambito** (vedi in fondo): trasferimenti fra sedi, automatismi da gestore,
  trasmissione RENTRI, MUD per sede, sincronizzazione delle codifiche RENTRI, override per
  azienda delle causali di sistema.

## Vincoli globali

- Commit `git commit -m … -- <file>`; niente attribuzioni AI nei messaggi.
- Commenti in italiano, termini tecnici non tradotti. Mai id di tenant, chiavi o
  credenziali nei messaggi restituiti all'utente.
- Test su Postgres reale col ruolo `wasteflow_app` (`*.postgres.spec.ts`,
  `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand <file>`, Postgres di
  test `127.0.0.1:55432`, `DOCKER_HOST=tcp://localhost:2375`): da superuser la RLS e i
  privilegi non si vedono. Modello: `src/application/registro/registro-per-sede.postgres.spec.ts`
  (`creaPrismaServiceApplicativo()`, `TenantContext.run`, `DB_APP_PASSWORD`), NON
  `progressivo-iniziale.service.postgres.spec.ts` (gira da superuser). I dati di prova
  (aziende, causali aziendali) si creano dal proprietario o nel contesto del tenant e si
  puliscono; **le righe di `causali_registro` non si modificano mai in modo persistente**
  (i test che provano i CHECK sul catalogo girano in una transazione annullata, M3).
- **Mock Prisma degli spec unitari**: ogni task che porta il catalogo in un percorso deve
  aggiungere `causaleRegistro.findMany` (le 11 righe, da un fixture condiviso
  `src/application/registro/causali/catalogo-causali.fixture.ts` creato nel Task 2) e
  `causaleRegistroAzienda.findMany` (default `[]`) ai mock degli spec che lo attraversano.
  Elenco per task: **3** `mud-aggregazione.service.spec.ts`; **4a**
  `valida-dati-movimento.spec.ts`, `registra-movimento.use-case.spec.ts`,
  `correggi-movimento.use-case.spec.ts`; **6** `list-movimenti.handler.spec.ts`. Se un
  altro spec si rompe per lo stesso motivo, lo si aggiunge e lo si dice nel rapporto.
- Prima di dichiarare finito un task: suite unitaria COMPLETA
  (`cd apps/backend && NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov`),
  `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, le suite Postgres toccate e quelle
  di `src/application/registro/`, `src/application/mud/` e `src/infrastructure/persistence/`.
  Frontend (Task 7a/7b): Karma (`cd apps/frontend && npx ng test --watch=false
  --browsers=ChromeHeadless`), `npm run build`, `npx eslint "apps/frontend/src/**/*.ts"`
  dalla root. Servizio nuovo iniettato → risoluzione in `api/registro/registro.module.spec.ts`.
- Prisma: dopo ogni modifica a `schema.prisma` `npx prisma generate`; `npx prisma validate`
  e `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel
  prisma/schema.prisma --shadow-database-url <url>` con esito **vuoto** (i CHECK, il
  trigger e l'indice parziale non entrano nel confronto; se l'indice parziale lo sporca,
  vedi C4). Nomi di vincoli e indici espliciti e ≤ 63 caratteri, identici in schema e
  migration.
- `rls-catalogo.postgres.spec.ts`: il conteggio passa da 31 a **32** (si aggiunge solo
  `causali_registro_azienda`; `causali_registro` non ha `tenant_id`).
- Nessun UPDATE né DELETE su `waste_movements` nel codice non di test (R13 di F2-3).
- Migration additiva, con commento iniziale (cosa fa, perché, ripristino a mano).

## Task 1: modello, migration, privilegi e RLS

**File:** `apps/backend/prisma/schema.prisma`,
`apps/backend/prisma/migrations/20261030100000_causali_registro/migration.sql`,
`apps/backend/prisma/sql/ruoli-db.sql` (C2) e `prisma/sql/README.md` se descrive i
privilegi, `src/infrastructure/database/ruoli-db.postgres.spec.ts`,
`src/infrastructure/persistence/prisma.service.ts` (`cleanDatabase`),
`src/infrastructure/persistence/prisma-rls.extension.ts` (`TENANT_SCOPED_MODELS`:
`CausaleRegistroAzienda` sì, `CausaleRegistro` no) e `prisma-rls.extension.spec.ts`
(asserzione che `CausaleRegistro` non c'è),
`src/infrastructure/persistence/rls-catalogo.postgres.spec.ts` (31 → 32) e
`README-tenant-transazione.md` (i tre "(31)" → 32, `causali_registro_azienda`
nell'elenco, una riga sul catalogo globale senza RLS e in sola lettura),
`src/application/registro/causali/causali-registro.schema.postgres.spec.ts` (nuovo),
`ops/README.md` (rollback).

**I1, convivenza col branch dei FIR.** Il nome della migration resta
`20261030100000_causali_registro` (il piano FIR usa `20261030110000_fir_versione`, che
viene dopo). Per ridurre i conflitti su `schema.prisma`, **le definizioni nuove (i due
enum e i due modelli) vanno in coda al file**, dopo `WasteMovement`, gli enum esistenti e
`RegistroRifiuti`; dentro `WasteMovement` si aggiungono solo la colonna, la relazione e
l'indice, e su `Tenant` le relazioni inverse, in fondo ai rispettivi blocchi. Al merge
(il secondo dei due branch che entra fa rebase sull'altro): rebase, `npx prisma generate`,
`npx prisma migrate deploy` sul database di test, `npx prisma migrate diff` di nuovo
**vuoto**, suite Postgres di `registro/` e `persistence/`.

1. Schema: enum `RuoloMudCausale` (`@@map("ruolo_mud_causale")`) e `NaturaCausaleAzienda`
   (`@@map("natura_causale_azienda")`); modelli C1 e C4 con `@@map`, `@map` snake_case,
   relazioni inverse su `Tenant`; su `WasteMovement` `causaleAziendaId String?
   @map("causale_azienda_id") @db.Uuid` e la relazione C6
   (`fields: [causaleAziendaId, tenantId, causale, type]`, `references: [id, tenantId,
   codice, verso]`, `onDelete: NoAction, onUpdate: NoAction`, map
   `waste_movements_causale_azienda_fkey`) con l'inverso su `CausaleRegistroAzienda`,
   `@@index([causaleAziendaId], map: "waste_movements_causale_azienda_id_idx")`. Aggiornare
   il commento di `causale` (`schema.prisma:1816-1818`): "codice di una causale del
   catalogo (`causali_registro`) o dell'azienda (`AZ_…`, con `causaleAziendaId`)". Il tipo
   di `codice` deve coincidere con `causale` (`@db.VarChar(100)`). **Il commento di
   `entryHash` non si tocca** (M11).
2. Migration nell'ordine: enum; `causali_registro` con PK e CHECK; blocco `DO` di C2
   (REVOKE/GRANT condizionati all'esistenza dei ruoli); `INSERT` delle 11 righe di C3 con
   i commenti di motivazione e la regola di immutabilità di C1; `RAISE NOTICE` dei
   movimenti fuori catalogo; `causali_registro_azienda` con CHECK, unici, FK (tenant
   `CASCADE`, sistema `RESTRICT`), indice parziale, funzione + trigger C4 (con
   l'espressione del giorno italiano di C5); controllo "nessun movimento `AZ_`" e poi
   colonna, FK (`ADD CONSTRAINT ... NOT VALID` seguito da `VALIDATE CONSTRAINT`: la colonna
   è tutta NULL), CHECK `waste_movements_causale_azienda_coerente` e indice di C6 su
   `waste_movements`; in fondo `ENABLE` + `FORCE ROW LEVEL SECURITY`, `isolamento_azienda`,
   `sola_lettura TO wasteflow_lettura` su `causali_registro_azienda`. Commento iniziale con
   ripristino: `DROP` di CHECK/FK/indice/colonna su `waste_movements`, delle due tabelle,
   della funzione e degli enum.
3. `ruoli-db.sql` (C2) e test in `ruoli-db.postgres.spec.ts`: dopo lo script,
   `wasteflow_app` e `wasteflow_sistema` leggono `causali_registro` e ricevono
   `permission denied` (SQLSTATE 42501) su INSERT, UPDATE, DELETE, TRUNCATE; lo script
   eseguito due volte lascia lo stesso stato; le altre tabelle restano CRUD (test
   esistenti verdi). `ops/README.md`: rollback (prima controllare `SELECT count(*) FROM
   causali_registro_azienda` e i movimenti con `causale_azienda_id`; dopo un rollback del
   codice le causali `AZ_` tornano `ESCLUSO` nel MUD e non sono più registrabili).
4. `cleanDatabase` (M2): elenco esplicito di tabelle escluse dal `TRUNCATE`,
   `const TABELLE_NON_SVUOTABILI = ['_prisma_migrations', 'causali_registro']`, con un
   commento: il catalogo lo scrive solo la migration e i test non possono ricrearlo
   (l'app non ha i privilegi di scrittura). Un test (in
   `prisma-service-tenant.postgres.spec.ts` o nel nuovo spec dello schema) che dopo
   `cleanDatabase` le 11 righe ci sono ancora, **solo se** quel test gira già su un
   database usa e getta; altrimenti un test unitario sull'elenco.
5. `causali-registro.schema.postgres.spec.ts` col ruolo applicativo:
   - catalogo: esattamente le 11 righe di C3 (tabella attesa scritta nel test), leggibile
     senza contesto di tenant; insert/update/delete dell'app → 42501;
   - CHECK del catalogo provati **dal proprietario dentro una transazione annullata**
     (`$transaction` che lancia un errore sentinella alla fine, o `BEGIN … ROLLBACK` con
     `$executeRawUnsafe` sulla stessa connessione) (M3): codice `AZ_` respinto, ruolo
     `AVVIATO` su CARICO respinto, `TR` respinto; dopo, il catalogo è ancora identico;
   - CHECK delle proprie: codice senza prefisso, ruolo `AVVIATO` su CARICO, `T*` su
     SCARICO, `TR`, operazione su CARICO, `valida_al < valida_dal`, DISATTIVAZIONE con
     descrizione → respinti;
   - DISATTIVAZIONE di un codice di sistema inesistente → violazione FK; doppia
     disattivazione → violazione d'unicità;
   - trigger: due versioni sovrapposte respinte, contigue ammesse; UPDATE di `codice` o
     `verso` respinto; su una versione referenziata da un movimento: UPDATE di
     `ruolo_mud`, di `valida_dal` e di `valida_al` prima dell'ultimo giorno d'uso respinti,
     `valida_al` uguale all'ultimo giorno d'uso ammesso; su una non referenziata tutto
     ammesso; giorno d'uso calcolato all'italiana (movimento alle 23:30 UTC del 31/12 →
     1° gennaio);
   - C6: movimento con `causale_azienda_id` e `causale` diversa dal codice della versione
     (o tipo diverso dal verso) → violazione FK; CHECK `waste_movements_causale_azienda_coerente`:
     causale `AZ_X` senza riferimento respinta, causale di sistema con riferimento respinta;
     DELETE di una versione usata respinto; DELETE di un'azienda di test con movimenti e
     causali in un solo statement riesce;
   - RLS: l'azienda B non vede né modifica le causali di A; insert con `tenant_id` di
     un'altra azienda respinto dal `WITH CHECK`.
   `prisma validate` e `migrate diff` vuoti.

## Task 2: risolutore

**Dipende da 1.** **File:** `src/domain/waste-movement/catalogo-causali.ts` (+ `.spec.ts`),
`src/application/registro/causali/catalogo-causali.repository.ts` (+ `.spec.ts`,
`.postgres.spec.ts`), `src/application/registro/causali/catalogo-causali.fixture.ts`
(righe di sistema per i mock: copia della tabella di C3, usata solo dagli spec).

1. `CatalogoCausali` e tipi di C7, senza dipendenze da Prisma (le righe arrivano già
   convertite: date come `AAAA-MM-GG`, ruolo come stringa).
2. `LettoreCatalogoCausali`, `caricaCatalogoCausali` e `confermaVersioneAzienda` (C7). La
   conversione delle colonne `DATE` è in una funzione esportata e testata (mezzanotte UTC
   → `AAAA-MM-GG`, mai spostata di un giorno).
3. Test unitari del dominio: per ciascuna delle 11 righe di sistema `comportamento` dà il
   ruolo delle mappe di oggi e l'operazione di `operazioneDaCausale`; `RICLASSIFICAZIONE`
   risolve per verso; codice sconosciuto o verso sbagliato (`CESSIONE` su CARICO) →
   `null`; disattivazione: `selezionabile` → `DISATTIVATA` ma `comportamento` invariato;
   `attiva = false` di sistema idem; versioni: giorno prima di `valida_dal`, il giorno
   stesso, il giorno di `valida_al`, il giorno dopo; `versioneId` esplicito vince sulla
   data, ma con codice o verso diversi dà `null`; `opzioni` ordinate e senza disattivate;
   `VERSO` per un codice presente solo nell'altro verso.
4. Postgres col ruolo applicativo: `caricaCatalogoCausali` dentro `TenantContext.run` di A
   vede le 11 righe + le proprie di A e non quelle di B; `confermaVersioneAzienda` con una
   versione chiusa nel frattempo → 409 `CAUSALE_MODIFICATA`.

## Task 3: il MUD usa il catalogo

**Dipende da 2.** **File:** `src/application/mud/aggregazione/mud-regole.ts` (+ spec),
`mud-aggregazione.service.ts` (+ `mud-aggregazione.service.spec.ts`: mock del catalogo,
vedi Vincoli; `mud-aggregazione-saldi.postgres.spec.ts` se si rompe),
`src/application/registro/lettori-vigenti.postgres.spec.ts` e
`src/infrastructure/persistence/rls-percorsi-reali.postgres.spec.ts` solo se si rompono,
`src/application/registro/causali/costanti-causali.guardia.spec.ts` (nuovo, C8: coi nomi
del MUD).

1. C10. Le mappe `RUOLO_CARICO/RUOLO_SCARICO` e `operazioneDaCausale` spariscono;
   `classificaMovimento(catalogo, m)` e `operazioneDaCatalogo(catalogo, m)` restano pure.
   Il `select` di `mud-aggregazione.service.ts:151` aggiunge `causaleAziendaId`.
2. **Oracolo (M5):** in `mud-regole.spec.ts` la vecchia implementazione
   (`RUOLO_CARICO`, `RUOLO_SCARICO`, `classificaMovimento`, `operazioneDaCausale` di
   `mud-regole.ts:28-57` di master `5b6f661`) è **copiata nello spec** come funzioni
   `vecchiaClassificazione`/`vecchiaOperazione`, con un commento che dice da dove viene e
   che non va modificata. Il test confronta vecchio e nuovo (catalogo dal fixture) su
   tutte le coppie `{CARICO, SCARICO} × (i 10 codici + 'SCONOSCIUTA' + '')`.
3. Altri test unitari: causale aziendale `PRODOTTO` conta nel prodotto, `ESCLUSO` produce
   `CAUSALE_ESCLUSA`, `RICEVUTO_DA_TERZI` finisce fra i ricevuti; causale aziendale con
   operazione `R` sceglie recupero prima del FIR; due versioni della stessa causale con
   ruoli diversi: i movimenti contano col ruolo della propria versione (`causaleAziendaId`),
   anche se la versione è chiusa. La guardia statica fallisce su un sorgente finto con
   `const RUOLO_CARICO` e non su uno con il nome solo in un commento.
4. Postgres (nel file di aggregazione esistente o nuovo
   `mud-aggregazione-causali.postgres.spec.ts`) col ruolo applicativo: stessi movimenti di
   sistema → `hashAggregato` identico a quello calcolato con l'oracolo; una causale
   aziendale cambiata con una nuova versione non cambia il MUD dell'anno prima.

## Task 4a: validazione e registrazione

**Dipende da 3.** **File:** `valida-dati-movimento.ts` (+ spec),
`waste-movement.entity.ts` (+ spec), `registra-movimento.dto.ts` (+
`registra-movimento.dto.spec.ts`), `correggi-movimento.dto.spec.ts` (solo le attese sulla
causale), `registra-movimento.command.ts`, `registra-movimento.use-case.ts` (+ spec,
postgres spec), `numerazione-annotazione.ts` (campo `causaleAziendaId` nell'insert),
`verifica-catena-registro.service.ts` (solo il tipo), `registro.controller.http.spec.ts`
(solo i casi di causale non valida), `costanti-causali.guardia.spec.ts` (i nomi di C8 di
questo task), e **l'adattamento meccanico** di `correggi-movimento.use-case.ts` (+
`correggi-movimento.use-case.spec.ts`): tipi `string` al posto di `CausaleMovimento`, nuova
firma di `validaDatiMovimento` (passa `tenantId` e, per ora, nessun `causaleAttuale`),
mock del catalogo nello spec. **Nessun cambio di semantica della correzione**: quello è il
Task 4b. Mock del catalogo: `valida-dati-movimento.spec.ts`,
`registra-movimento.use-case.spec.ts`, `correggi-movimento.use-case.spec.ts`.

1. C8 per la registrazione: `validaDatiMovimento(db, { tenantId, type, causale, cerCode,
   movementDate, registrationDate, causaleAttuale? })` → `{ cerCode, causaleAziendaId,
   causaleDescrizione }` o `{ errore }`; stesso ordine e stessi messaggi di oggi per i casi
   di oggi.
2. Registrazione: `confermaVersioneAzienda` dentro la transazione (dopo i lock del
   progressivo e della giacenza, prima dell'insert) quando `causaleAziendaId` non è null;
   insert con `causaleAziendaId`; risposta con `causaleDescrizione` (C11).
3. Entità, DTO, command, tipi (C8). La guardia statica, coi nomi aggiunti, deve restare
   verde sul codice e fallire su un sorgente finto con `export const CAUSALI_CARICO`.
4. Test: unitari di `validaDatiMovimento` (sistema valida, verso sbagliato, disattivata,
   sconosciuta, propria fuori validità, propria valida → id e descrizione restituiti) con
   il mock del catalogo; Postgres col ruolo applicativo: registrazione con causale di
   sistema (`causale_azienda_id` NULL), con causale propria (id della versione valida alla
   data dell'operazione, anche retrodatata nella versione precedente), con causale di
   sistema disattivata → 400, con codice sconosciuto → 400 (messaggio con l'elenco);
   HTTP: causale `pippo` → 400 dal DTO (formato), `NON_ESISTE` → 400 dal caso d'uso.

## Task 4b: rettifica e annullamento

**Dipende da 4a.** **File:** `correggi-movimento.use-case.ts` (+ spec, postgres spec).

1. Rettifica (C8, I3): `validaDatiMovimento` con `causaleAttuale = { codice: testa.causale,
   versioneId: testa.causaleAziendaId }`; risoluzione **per data** (senza `versioneId`);
   `causaleAziendaId` = versione risolta alla nuova data; `confermaVersioneAzienda` nella
   transazione; insert con il nuovo `causaleAziendaId`; risposta con `causaleDescrizione`.
   Il `WasteMovement.create` di `correggi-movimento.use-case.ts:326-340` e `:472-486` non
   fa più il controllo dell'elenco (C8).
2. Annullamento (C9): copia `causale` e `causaleAziendaId` della testa; il catalogo si
   legge solo dopo il commit, per la descrizione della risposta.
3. Postgres col ruolo applicativo: rettifica che cambia solo la quantità di un movimento
   con causale di sistema disattivata dopo la registrazione → riesce; rettifica che passa
   a una causale disattivata → 400; rettifica che sposta la data in un'altra versione della
   causale propria → `causale_azienda_id` della nuova versione; rettifica che sposta la
   data fuori da ogni versione → 400; annullamento di un movimento con causale storica
   fuori catalogo (insert diretto del proprietario) → riesce, descrizione = codice;
   annullamento di uno con versione chiusa → riesce e copia il riferimento; la catena hash
   resta verificata.

## Task 5: servizio di gestione delle causali

**Dipende da 4b.** **File:** `src/application/registro/causali/causali-registro.service.ts`
(+ `.spec.ts`, `.postgres.spec.ts`), `src/application/registro/lettori-movimenti.spec.ts`
(il servizio legge `waste_movements`: scelta `tutte`, motivo "usata e ultimo giorno d'uso
di una versione: ogni annotazione conta").

1. Metodi: `opzioni(tenantId, verso, giorno)`, `gestione(tenantId)` (query aggregata di
   C5), `disattiva/riattiva(tenantId, userId, verso, codice)`, `crea`, `modifica`,
   `nuovaVersione`, `chiudi`, `elimina` con le regole di C5 (lock, `FOR UPDATE`, semantica
   assente/null della PATCH, validazione sul record risultante, ordine UPDATE-poi-INSERT
   della nuova versione, nessuna riapertura alla cancellazione, audit, 409 con codici
   `error` stabili: `CAUSALE_USATA_NUOVA_VERSIONE`, `CAUSALE_DATA_PRIMA_DELL_ULTIMO_USO`,
   `CAUSALE_SOVRAPPOSTA`, `CAUSALE_USATA_NON_ELIMINABILE`, `CAUSALE_ESISTENTE`,
   `CAUSALE_NON_ULTIMA_VERSIONE`). Violazioni dei CHECK o del trigger che sfuggono alla
   validazione → 400 con messaggio generico, mai il testo del database.
2. Test unitari sui rami di validazione (prefisso, coerenza verso/ruolo/RENTRI/operazione
   sul record risultante, `null` contro assente, date).
3. Postgres col ruolo applicativo: ciclo completo (crea → registra un movimento → modifica
   del ruolo in place → 409 → nuova versione con data prima dell'ultimo uso → 409 → con
   data dopo → ok, la vecchia è chiusa al giorno prima, la nuova ha RENTRI e operazione
   NULL se non indicati → il movimento conserva la vecchia versione); PATCH con
   `codiceRentri: null` azzera, campo assente lascia invariato; PATCH che rende incoerente
   il record → 400; modifica in place di una non usata ammessa; chiusura prima dell'ultimo
   uso → 409; elimina usata → 409, non usata → ok; eliminazione dell'ultima versione → la
   precedente resta chiusa; disattivazione idempotente e riattivazione; concorrenza: una
   registrazione in corso (transazione aperta con il movimento inserito) e una modifica
   del ruolo in place → la modifica attende e poi risponde 409 (modello dei test "in
   pausa" di `registro-per-sede.postgres.spec.ts:304-340`); due nuove versioni concorrenti
   → una sola riesce; isolamento fra aziende; `gestione` con più versioni fa una sola
   query sui movimenti.

## Task 6: API ed elenco

**Dipende da 5.** **File:** `src/api/registro/causali-registro.controller.ts` (nuovo, +
`.spec.ts`, `.http.spec.ts`), `src/api/registro/dtos/causali-registro.dto.ts` (nuovo, +
spec), `registro.controller.ts` (solo `export` di `RUOLI_PROGRESSIVO_INIZIALE`),
`registro.module.ts` (controller e servizio, commento delle rotte) e
`registro.module.spec.ts`, `src/application/registro/queries/list-movimenti.handler.ts`
(+ `list-movimenti.handler.spec.ts` con il mock del catalogo, postgres spec) e il tipo
della risposta.

1. Rotte di C13 con DTO (`whitelist`/`forbidNonWhitelisted` già attivi): `tipo`/`verso`
   `@IsEnum`, `data`/`validaDal`/`validaAl` `AAAA-MM-GG` (`@Matches` + data reale),
   `codice` `^AZ_[A-Z0-9_]{2,40}$`, `descrizione` 1..200 dopo trim, `ruoloMud` enum,
   `codiceRentri` in `DT|NP|T*|RE|I|aT|M`, `operazione` `R|D`, `ordine` intero 0..9999.
   PATCH: `@ValidateIf(o => o.campo !== null)` sui campi azzerabili, così `null` arriva al
   servizio (semantica di C5) e un campo assente resta `undefined`. Ruoli prima del
   servizio.
2. Elenco C11 (`causaleDescrizione`, `causaleCodiceRentri`), un catalogo per pagina.
3. Test: DTO con la pipe vera (anche `null` contro assente nella PATCH); HTTP (VIEWER legge
   `GET registro/causali` e riceve 403 su gestione e mutazioni; OPERATOR 403 sulle
   mutazioni; ADMIN 201/204; `:id` non UUID → 400; 409 passati invariati); elenco:
   descrizione della versione giusta per due movimenti della stessa causale propria in
   versioni diverse; codice sconosciuto → il codice; una sola lettura del catalogo per
   pagina.

## Task 7a: frontend, opzioni dall'API

**Dipende da 6.** **File:**
`apps/frontend/src/app/features/registro/causali-registro.service.ts` (nuovo, + spec),
`registro.service.ts` (+ spec: via costanti, tipi ed etichette; `causaleDescrizione` e
`causaleCodiceRentri` nel modello dell'elenco e delle risposte; `causale: string`),
`registro-opzioni.ts`, `registro-fir.ts` (+ spec), `registro.component.ts` (+
`registro.component.sede.spec.ts` se serve), `correggi-movimento-dialog.component.ts` (+
`correggi-movimento-dialog.dom.spec.ts`), `core/services/export.service.ts` (+ spec).

1. C14 tranne la gestione. Le opzioni si caricano con un `switchMap` sulle modifiche di
   tipo e data (nessuna richiesta per ogni tasto: data come giorno, `distinctUntilChanged`);
   se la causale scelta non è più fra le opzioni dopo un cambio di data, si azzera con un
   messaggio sotto il campo. La causale proposta dal FIR (M7) si applica nel callback
   dell'arrivo delle opzioni del tipo e della data del FIR, solo se presente.
2. Test: servizio (URL, parametri, cache e invalidazione); registrazione (opzioni per tipo
   dall'API, ricaricate al cambio di data); **ricopia di un FIR con risposta delle opzioni
   ritardata** (la proposta compare solo dopo l'arrivo e solo se la causale è fra le
   opzioni; con la causale disattivata nessuna proposta); dialog di rettifica (causale
   attuale fuori elenco presente e selezionata, test DOM a click reali come quelli
   esistenti); export con `causaleDescrizione`.

## Task 7b: frontend, gestione per gli ADMIN

**Dipende da 7a.** **File:** `features/registro/causali-registro-dialog.component.ts`
(nuovo, standalone, + `.spec.ts` e `.dom.spec.ts`), `registro.component.ts` (pulsante e
dialog, sul modello di `registro.component.ts:155-160,975-980,1912-1920`).

1. C14 "Gestione". Ruolo MUD e codice RENTRI con opzioni filtrate per verso; etichette
   leggibili ("Prodotto", "Avviato a recupero o smaltimento", "Ricevuto da terzi", "Escluso
   dal MUD"; codici RENTRI con la descrizione del contratto, `dati-registri.yaml:3294`).
   Date come giorni senza fuso. Nella modifica, "nessun codice RENTRI" invia `null`. Dopo
   ogni modifica si ricaricano gestione e opzioni (cache invalidata).
2. Accessibilità come il dialog delle giacenze iniziali (label, `aria-describedby` degli
   errori, focus).
3. Test DOM a click reali: disattiva una causale di sistema → chiamata `PUT` e stato
   aggiornato; crea una causale propria; "Modifica" del ruolo su una usata → messaggio 409
   del backend e proposta "Nuova versione"; il pulsante "Causali" non c'è senza
   `puoImpostare`.

## Ordine

Strettamente sequenziale, un agente sonnet per task, revisione opus dopo ognuno:

```
T1 → T2 → T3 → T4a → T4b → T5 → T6 → T7a → T7b
```

Nessun task gira in parallelo a un altro di F2-5: il parallelismo c'è già fra questo
branch e quello dei FIR (I1). Se un agente esaurisce il contesto su T1 o T5, il task si
spezza fra "codice" e "test Postgres" con la stessa lista di test, sempre in sequenza.
Dopo T7b: verifica manuale di C15 dopo il deploy.

## Fuori ambito (seguiti)

- **Trasferimenti fra sedi** (decisione 2026-10-24: possibili da F2-5 in poi): pezzo
  dedicato subito dopo F2-5 (scarico da un registro e carico in un altro dell'azienda,
  WinWaste `OPER` 15/16/24/26 e byte 31 di `AVANZ`).
- **Automatismi da gestore** (`AVANZ`: carico automatico dei prodotti, master/dettaglio,
  produttori percentuali, carico in stoccaggio dopo trattamento, `($$PARTENZA$$)`):
  Fase 4. Anche le classi di giacenza (C12).
- **Trasmissione RENTRI** (F2-9): uso di `codice_rentri`, segnalazione dei movimenti con
  causale non trasmissibile (NULL), conferma di `T*` contro `RE` per `INGRESSO_ESTERNO` e
  decisione su `NP` per `RECUPERO_PARZIALE`, causali `TR` / `T*aT` (`CaricoScarico`) e
  regole per causale del contratto (`:3096-3123`).
- **Override per azienda del codice RENTRI o del ruolo MUD di una causale di sistema**
  (oggi: disattivare e creare una propria, C3).
- **Sincronizzazione delle causali RENTRI** da `GET /codifiche/v1.0/causali-operazione`
  (oggi CHECK con l'elenco del contratto).
- **MUD per sede e giacenze al 31/12** (F2-8), che userà `ruolo_mud` del catalogo.
- Etichette del MUD e dei controlli (`CAUSALE_ESCLUSA`) con la descrizione invece del
  codice; stampa ufficiale del registro con le descrizioni.
- Test e2e Playwright del form del registro (C15).
- Causali aziendali condivise fra le aziende di un gruppo o di un consulente.
