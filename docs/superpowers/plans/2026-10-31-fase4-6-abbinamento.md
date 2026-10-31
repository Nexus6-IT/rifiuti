# Fase 4 pezzo 6: abbinamento carichi-scarichi (R13/D15) — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`. Sonnet implementa un task alla volta, opus rivede ogni
> task prima del successivo. Ordine **strettamente sequenziale** (un worktree, un database di
> test, commit condivisi, 16 GB di RAM): Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11.
> I passi usano le checkbox (`- [ ]`).

**Obiettivo.** Sapere, per gli stoccaggi R13/D15, quali carichi (e quali giacenze iniziali) ha
consumato ogni scarico e per quanto, con residuo ed età di ogni carico; FIFO automatico alla
registrazione, override manuale, ricalcolo, differenze rispetto al FIFO.

**Architettura.** Una tabella nuova `abbinamenti_carico_scarico` a righe (scarico, carico o
giacenza iniziale, quantità), riferite alla **radice della catena** di rettifiche, con RLS. Il
residuo **non** è un accumulatore: è `quantità vigente del carico − somma delle righe`, calcolato
in lettura. La proposta FIFO è `calcolaFifo` di F2-6 con un'opzione additiva che non salda i
debiti con carichi successivi. Ogni scrittura (registrazione, rettifica, annullamento, override,
ricalcolo, giacenze iniziali) passa sotto lo stesso advisory lock della giacenza del CER nel
registro (`chiaveLockGiacenza`).

**Tech stack.** NestJS + Prisma 5.22 + PostgreSQL 16 con RLS FORCE; Angular + PrimeNG; jest,
Karma.

**Spec.** `/home/graziano/Progetti/winwaste/docs/roadmap-fasi3-4-import-gestori.md` §4.6 (con §1,
§6, §7 D9, §9); WinWaste: `/home/graziano/Progetti/winwaste/docs/giacenze.md` §2.2, §3, §6, §7 e
`/home/graziano/Progetti/winwaste/docs/movimenti.md` §2.4-2.6, §3.6; confronto:
`/home/graziano/Progetti/winwaste/docs/confronto-rifiuti/01-registro-fir-giacenze.md` (G2, riga 10
della tabella delle priorità) e `04-piattaforma-e-migrazione.md` §5 righe 318 e 346.

---

## Domande DA CONFERMARE CON GRAZIANO

Il piano è eseguibile con le raccomandazioni. Per ognuna: raccomandazione, poi impatto se la
risposta è diversa.

1. **Residuo per carico: colonna persistita o calcolato dalle righe?** La roadmap dice "residuo e
   età per carico persistiti". **Raccomandazione: si persistono le righe di abbinamento, il
   residuo si calcola** (`quantità vigente − Σ righe`). Un accumulatore tipo `GIASCAR` è
   proprio la fonte delle derive di WinWaste (`giacenze.md` §6, §7 punti 6-7: tre utility di
   riparazione). *Se si vuole la colonna:* +1 tabella `saldi_carico` aggiornata da ogni writer
   (5 punti), un controllo di coerenza e una riparazione; +1 task, rischio di deriva.
   **DA CONFERMARE CON GRAZIANO.**
2. **Abbinamento obbligatorio alla registrazione?** WinWaste rifiuta lo scarico da giacenza
   senza relazione ("manca relazione di carico/scarico", `movimenti.md` §2.4). **Raccomandazione:
   non bloccante.** Alla registrazione dello scarico il FIFO si applica da solo e si persiste;
   se non copre tutto, lo scarico resta `PARZIALE` o `NON_ABBINATO` con un avviso e si completa
   dalla pagina. Così la ricopia dei FIR, i flussi automatici e i produttori non cambiano.
   *Se bloccante:* `registra-movimento` deve rifiutare lo scarico non coperto dai carichi
   R13/D15, i retry della ricopia vanno ripensati, e serve una scelta della relazione nella
   form di registrazione (+2 task, rischio sui flussi RENTRI). **DA CONFERMARE CON GRAZIANO.**
3. **Classe dello scarico (R13 o D15) senza campo dedicato.** **Raccomandazione:** la classe si
   deduce dall'operazione dello scarico come fa WinWaste (`giacenze.md` §3.1: prima lettera di
   `MODA`): `operationCode` che inizia per `R` → R13, per `D` → D15; se manca, l'operazione della
   causale (`AVVIO_RECUPERO` = R, `AVVIO_SMALTIMENTO` = D); se manca anche quella e nel registro
   il CER ha una sola classe, quella; altrimenti nessun abbinamento automatico (solo manuale).
   *Se serve un campo esplicito:* non si aggiungono colonne a `waste_movements` (roadmap §8),
   quindi una tabella 1:1 a parte e un campo nella form (+1 task). **DA CONFERMARE CON GRAZIANO.**
4. **Carichi "di stoccaggio".** **Raccomandazione:** è di stoccaggio il carico vigente con
   `operationCode` normalizzato `R13` o `D15`. I carichi senza operazione (deposito temporaneo,
   produzione propria) restano fuori dall'abbinamento e la pagina lo dice. *Alternativa:* una
   causale di carico dedicata (F2-5) o un'impostazione del registro "impianto di stoccaggio":
   +1 task e una migration sul catalogo. **DA CONFERMARE CON GRAZIANO.**
5. **Giacenze iniziali senza classe.** `giacenze_iniziali` non ha R13/D15. **Raccomandazione:**
   entrano nella proposta automatica solo se nel registro il CER ha una sola classe; con
   entrambe si abbinano solo a mano (con avviso). *Se si vuole la classe:* colonna nullable
   `classe_stoccaggio` su `giacenze_iniziali` e un campo nel dialog di F2-2 (+1 task frontend e
   backend). **DA CONFERMARE CON GRAZIANO.**
6. **Rettifica o annullamento di un carico già abbinato.** **Raccomandazione: bloccati con 409**
   se rendono incoerenti gli abbinamenti (quantità sotto l'abbinato, data dopo uno scarico che
   lo usa, CER, famiglia di unità o classe diversi; annullamento con righe), con l'elenco dei
   numeri degli scarichi da riabbinare. È la regola di WinWaste (`MovimentoScaricato`,
   `movimenti.md` §3.6). *Se invece si vuole riabbinare da soli gli scarichi colpiti:* la
   correzione del carico rilancia il FIFO sugli scarichi automatici e marca "da rivedere" i
   manuali (+1 task, avvisi più complessi). **DA CONFERMARE CON GRAZIANO.**
7. **Vincolo di somma come trigger nel database.** **Raccomandazione: no**, si usano advisory
   lock + vincoli strutturali (FK composte, CHECK, unicità) + una verifica di coerenza in
   lettura (stato `INCOERENTE`). La quantità vigente del carico cambia con le rettifiche in
   `waste_movements`, quindi un trigger utile andrebbe messo sulla tabella più calda del
   database. *Se sì:* constraint trigger deferred su `abbinamenti_carico_scarico` (+1 task, con
   le conversioni t → kg scritte in SQL), che comunque non copre le rettifiche dei carichi.
   **DA CONFERMARE CON GRAZIANO.**
8. **Scarichi già registrati al rilascio.** **Raccomandazione: nessun backfill automatico** al
   deploy; la pagina mostra i non abbinati e il pulsante "Abbina con FIFO i non abbinati".
   *Se backfill:* un comando per tenant (ruolo applicativo, un tenant per transazione, come
   §9 punto 5 della roadmap), +1 task. **DA CONFERMARE CON GRAZIANO.**
9. **D9, `RELAZ` dell'import (Fase 3).** **Raccomandazione: ricalcolare e mostrare le
   differenze.** L'import non scrive in questa tabella; scrive `RELAZ` nello staging, si
   ricalcola col FIFO e `confrontaAbbinamenti` (Task 2) mostra le differenze. *Se si importa:*
   valore `IMPORT` nell'enum `origine_abbinamento` (migration additiva in 3.4) e righe importate
   trattate come le manuali (mai toccate dal ricalcolo). **DA CONFERMARE CON GRAZIANO.**
10. **Ruoli.** **Raccomandazione:** lettura per ogni membro; override manuale e "abbina i non
    abbinati" per `SUPER_ADMIN`, `ADMIN`, `OPERATOR` (chi registra); "ricalcola gli automatici"
    solo `SUPER_ADMIN`/`ADMIN`. *Se l'override è solo ADMIN:* cambia una costante e i test del
    controller. **DA CONFERMARE CON GRAZIANO.**

---

## Stato di partenza (branch `feat/fase4-6-abbinamento` = master `692880e`, verificato)

Percorsi relativi a `apps/backend/` salvo indicazione; `fe/` = `apps/frontend/src/app/`.

**Nessun abbinamento oggi.** `grep -ri "abbinament" src prisma` trova solo commenti di F2-6. Il
registro non ha relazione fra scarico e carichi.

**FIFO di F2-6** — `src/domain/waste-movement/fifo-deposito.ts`:
- `EventoFifo` `:59-70` (`tipo`, `giorno` YYYY-MM-DD, `quantita` > 0 nella famiglia, `origine`
  `APERTURA|MOVIMENTO`, `ordine`, `riferimento {id, numero?}`); `AbbinamentoFifo` `:81-85`;
  `EsitoFifo` `:87-97` (`lotti`, `residuoTotale`, `scoperto`, `giornoPiuVecchio`,
  `abbinamenti`).
- `confrontaEventiFifo` `:114-121`: giorno, carichi prima degli scarichi nello stesso giorno,
  aperture prima dei movimenti, `ordine`, `riferimento.id`.
- `calcolaFifo(eventi)` `:149-205`: lavora in millesimi; uno scarico non coperto diventa
  **debito** e il primo carico **successivo** lo salda registrando l'abbinamento
  (`:160-168`). Per un abbinamento vero questo è sbagliato: WinWaste abbina solo carichi con
  `dtuk <= data dello scarico` (`giacenze.md` §3.1 punto 2). Commento `:20-27` (M13) e `:42-44`:
  la funzione è prevista come proposta di 4.6.
- `famigliaFifo` `:211-214`, `quantitaFifo` `:217-219`, `millesimiFifo` `:102-104`.
- Unico chiamante: `src/application/giacenze/giacenze.service.ts:161` e `:372`.

**Lettore degli eventi di F2-6** — `src/application/giacenze/eventi-deposito.ts:58-170`: legge i
vigenti con `WHERE_VIGENTE` (`:66-79`), non legge `movimento_originale_id`, `operation_code` né
la causale; `ordine` = progressivo della **testa** (`:149`); aperture con `id`
(`:153-167`). Va bene per il deposito, non per l'abbinamento (serve la radice e la classe):
il pezzo scrive un lettore proprio e riusa solo `famigliaFifo`/`quantitaFifo`/`millesimiFifo`.

**Vigenza** — `src/domain/waste-movement/vigenza.ts:18-21` `WHERE_VIGENTE`, `:32-38`
`sqlVigente(alias)`. Rettifica e annullamento sono nuove righe (`schema.prisma:1900-1911`):
`movimentoRettificatoId` (predecessore, unico `:1933`), `movimentoOriginaleId` (radice). La testa
vigente cambia `id` a ogni rettifica: **un riferimento all'`id` della testa diventerebbe vecchio
alla prima rettifica**, quello alla radice resta.

**Guardia dei lettori** — `src/application/registro/lettori-movimenti.spec.ts:25-86` (`LETTORI`):
ogni file non spec che contiene `wasteMovement.` o `waste_movements` deve stare in elenco.

**Movimenti** — `schema.prisma:1833-1944`: `quantity Decimal(10,2)`, `unit`, `operationCode
VarChar(10)` **testo libero** (`src/api/registro/dtos/registra-movimento.dto.ts:109-113`),
`causale`, `causaleAziendaId`; unico composto `@@unique([id, registroId, tenantId, type])`
`:1932` (`waste_movements_id_registro_tenant_type_key`), già usato come destinazione delle FK
della catena (`:1923`, `:1926`, `onDelete: NoAction`).

**Causali** — `src/domain/waste-movement/catalogo-causali.ts`: `DefinizioneCausale.operazione:
'R'|'D'|null`, `CatalogoCausali.comportamento(verso, codice, giorno, versioneId)`. Di sistema
(`prisma/migrations/20261030100000_causali_registro/migration.sql:114-119`): `AVVIO_RECUPERO`
operazione `R`, `AVVIO_SMALTIMENTO` `D`, le altre `NULL`. Caricamento:
`caricaCatalogoCausali(client, tenantId)` in `src/application/registro/causali/catalogo-causali.repository.ts`.

**Registrazione** — `src/application/registro/use-cases/registra-movimento.use-case.ts`:
transazione `:226-353`; ordine dei lock FIR → progressivo (`:259`) → giacenza
(`verificaGiacenza` `:586-…`, lock `:608`, **solo per gli scarichi di massa**: per gli altri
ritorna prima senza lock, `:594-601`); insert `:318`; risposta con `avvisi` `:347-351`. Il ramo
della ricopia già registrata ritorna prima (`:242-254`).

**Correzioni** — `src/application/registro/use-cases/correggi-movimento.use-case.ts`: lock del
progressivo e della giacenza di ogni CER toccato in ordine (`:163-172`), rilettura sotto lock e
vigenza (`:175-186`), radice (`:186`, `radiceDellaCatena` `:430-…`), insert `:232`, saldi dopo
`:264-266`, avvisi FIR `:268-271`, audit `:273-299`. `DatiRettifica` `:36-49` (può cambiare
data, CER, quantità, unità, operazione, causale).

**Lock della giacenza** — `src/application/registro/chiave-lock-giacenza.ts:12-14`
`chiaveLockGiacenza(registroId, cer)`; usato da registrazione (`:608`), correzioni (`:171`) e
giacenze iniziali (`giacenze-iniziali.service.ts:354-358`). `pg_advisory_xact_lock` è
rientrante nella stessa transazione.

**Giacenze iniziali (F2-2)** — `schema.prisma:861-885`: `id`, `registroId`, `cerCode`,
`statoFisico`, `quantita Decimal(10,2)`, `unita`, `dataRiferimento @db.Date`; unici `(id,
tenantId)` e `(registroId, cerCode, statoFisico, unita)`; **modificabili e cancellabili** finché
`controllaNonUsata` (`giacenze-iniziali.service.ts:502-516`) non trova uno scarico dello stesso
CER creato dopo di loro (`MSG_USATA` `:78-81`); modifica `:292`, eliminazione `:338`. Lettore
`src/application/registro/aperture-registro.ts:35-65` (`leggiApertureRegistro`, con `id`).

**Date** — `src/core/time/anno-italiano.ts:25` `giornoItaliano`; `src/domain/waste-movement/deposito-temporaneo.ts:140`
`giorniTra(da, a)`. CER: `src/domain/waste-movement/cer-registro.ts:9` `cerSoloCifre`, `:18`
`cerCanonico`, `:30` `chiaveConfrontoCer`.

**API e ruoli** — `src/application/giacenze/giacenze.controller.ts` (controller dentro
`application/`, `requireRequestTenantId(req)`, `RuoloEffettivoService.ruoloEffettivo`
`:112`); `giacenze.module.ts:23` `imports: [PrismaModule, LoggerModule, AuthModule,
RuoloEffettivoModule]`; registrato in `src/app.module.ts:32,114`.
`src/api/registro/registro.controller.ts:73` `RUOLI_REGISTRAZIONE` (**non esportata**), `:74`
`export const RUOLI_PROGRESSIVO_INIZIALE`.

**RLS** — `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts:64` `toBe(35)`;
`README-tenant-transazione.md:120` "(35)"; `TENANT_SCOPED_MODELS`
`src/infrastructure/persistence/prisma-rls.extension.ts:47-…` (ultima voce `SogliaDepositoTemporaneo`
`:86`). Forma della RLS: `prisma/migrations/20261031100000_soglie_deposito_temporaneo/migration.sql`
sezione 4. `lock_timeout` sulle tabelle vive: `20261031110200_fir_parti_sede_cf/migration.sql:14`.
Ultima migration: `20261031110200_fir_parti_sede_cf`. `schema.prisma` termina con
`SogliaDepositoTemporaneo` (`:2456-…`).

**Test** — helper `creaPrismaServiceApplicativo()` `src/infrastructure/persistence/prisma.service.ts:127`;
modello di suite Postgres `src/application/giacenze/giacenze.service.postgres.spec.ts:44-104`
(`tenantCreati`, `TenantContext.run`, pulizia per `{ in: tenantCreati }`). Fixture fiscali:
`src/test-support/anagrafiche-di-test.ts:25` `partitaIvaValida`, `:81` `creaDittaConRuolo`
(servono solo se un test crea controparti: i movimenti usano `counterpartName` libero).

**Frontend** — `fe/app.routes.ts:118-122` rotta `giacenze`; menu
`fe/shared/components/layout.component.ts:1284` (feature `giacenze`); `fe/features/giacenze/`
(`giacenze.component.ts` 686 righe, `giacenze.service.ts`); selettore del registro:
`fe/features/registro/registro-sede.ts:4` `etichettaRegistro`, `:14` `registroPredefinito`,
`fe/features/registro/registro.service.ts` `listRegistri()`. `registro.component.ts` (2401
righe) **non si tocca**.

## Come funziona WinWaste e cosa si fa meglio

- `RELAZ`: segmenti di 34 caratteri `C`/`P`/`G` + codice + classe + kg + m³ (`giacenze.md`
  §2.2); `GIASCAR` accumulatore sul carico; `STATO` con `$` a esaurimento. Qui: **righe**, mai
  stringhe; nessun accumulatore.
- FIFO automatico G → P → C per data, ultima riga parziale (`§3.2`). Qui: un solo database per
  tutti gli anni (P e C sono solo carichi più vecchi o più nuovi), aperture (G) ordinate per la
  loro data vera come in F2-6 (`fifo-deposito.ts:25-27`).
- Controllo ottimistico (`RelazWWrem`, `movimenti.md` §2.5) e transazioni che fanno sempre
  COMMIT (`movimenti.md` §5.1, difetto A). Qui: lock pessimistico per (registro, CER) e una sola
  transazione per ogni scrittura.
- Riparazioni non atomiche (`giacenze.md` §6, §7.6). Qui: nulla da riparare; il ricalcolo è
  una transazione e non tocca le righe manuali.
- Limite silenzioso di 4990 righe (`§7.10`). Qui: nessun limite nella lettura dell'ambito; la
  pagina pagina gli scarichi lato client.
- I m³ dei segmenti (car. 23-34): fuori ambito, si abbina nella famiglia dell'unità (kg con t;
  m³, litri a parte), come F2-6.

## Decisioni (vincolanti)

- **D1. Righe persistite, riferite alla radice.** Ogni riga lega la **radice** della catena
  dello scarico (`COALESCE(movimento_originale_id, id)` della testa vigente) alla radice di un
  carico **oppure** a una giacenza iniziale, con una quantità nella famiglia dell'unità. Una
  rettifica non rompe i riferimenti; la quantità, la data e la classe si leggono sempre dalla
  testa vigente.
- **D2. Invariante degli abbinamenti (I-ABB).** Ogni riga riguarda uno scarico vigente e un
  carico vigente (o una giacenza iniziale) dello stesso registro e della stessa chiave CER
  (`chiaveConfrontoCer`) e famiglia; giorno del carico ≤ giorno dello scarico; per ogni scarico
  Σ righe ≤ quantità; per ogni carico Σ righe (di tutti gli scarichi) ≤ quantità. La garantisce
  l'applicazione sotto il lock di D6; il database garantisce la parte strutturale (D4). Una
  violazione trovata in lettura dà lo stato `INCOERENTE`, non un errore.
- **D3. Residuo ed età calcolati.** Residuo = quantità vigente − Σ righe; età = `giorniTra(giorno
  del carico, oggi)` solo con residuo > 0 (domanda 1).
- **D4. Tabella `abbinamenti_carico_scarico`** (modello `AbbinamentoCaricoScarico`, enum
  `origine_abbinamento` = `AUTOMATICO | MANUALE`):
  `id uuid pk`, `tenant_id`, `registro_id`, `scarico_id uuid NOT NULL`, `scarico_tipo
  waste_movement_type NOT NULL DEFAULT 'SCARICO'`, `carico_id uuid NULL`, `carico_tipo
  waste_movement_type NOT NULL DEFAULT 'CARICO'`, `giacenza_iniziale_id uuid NULL`, `famiglia
  VARCHAR(10) NOT NULL`, `quantita DECIMAL(12,3) NOT NULL`, `origine`, `creato_da uuid NULL`
  (null per i flussi senza utente), `created_at`.
  Vincoli (nomi esatti, ≤ 63 caratteri, uguali in schema e SQL):
  - `abbinamenti_cs_pkey`; CHECK `abbinamenti_cs_scarico_tipo_check` (`scarico_tipo =
    'SCARICO'`), `abbinamenti_cs_carico_tipo_check` (`carico_tipo = 'CARICO'`),
    `abbinamenti_cs_un_carico_check` (`num_nonnulls(carico_id, giacenza_iniziale_id) = 1`),
    `abbinamenti_cs_quantita_check` (`quantita > 0`), `abbinamenti_cs_famiglia_check`
    (`btrim(famiglia) <> ''`);
  - FK composte, `ON DELETE NO ACTION ON UPDATE NO ACTION` (come la catena, `schema.prisma:1923`):
    `abbinamenti_cs_scarico_fkey` (`scarico_id, registro_id, tenant_id, scarico_tipo`) e
    `abbinamenti_cs_carico_fkey` (`carico_id, registro_id, tenant_id, carico_tipo`) verso
    `waste_movements(id, registro_id, tenant_id, type)`; `abbinamenti_cs_giacenza_fkey`
    (`giacenza_iniziale_id, registro_id, tenant_id`) verso `giacenze_iniziali(id, registro_id,
    tenant_id)`; `abbinamenti_cs_registro_fkey` (`registro_id, tenant_id`) verso
    `registri_rifiuti(id, tenant_id)`; `abbinamenti_cs_tenant_id_fkey` `ON DELETE CASCADE`.
    `MATCH SIMPLE`: con `carico_id` NULL la FK del carico non si controlla.
  - unici `abbinamenti_cs_scarico_carico_key (scarico_id, carico_id)` e
    `abbinamenti_cs_scarico_giacenza_key (scarico_id, giacenza_iniziale_id)` (i NULL non
    collidono, niente indici parziali); indici `abbinamenti_cs_tenant_id_idx`,
    `abbinamenti_cs_registro_id_idx`, `abbinamenti_cs_carico_id_idx`,
    `abbinamenti_cs_giacenza_iniziale_id_idx`.
  - Su `giacenze_iniziali` un unico nuovo `giacenze_iniziali_id_registro_tenant_key (id,
    registro_id, tenant_id)` (destinazione della FK).
  - Che la radice sia una `ORDINARIA` non si esprime con una FK: lo controlla la scrittura (D6)
    e la lettura (D2, `INCOERENTE`).
- **D5. Opzione additiva di `calcolaFifo`.** `calcolaFifo(eventi, opzioni?: { saldaDebiti?:
  boolean })`, predefinito `true` (comportamento di F2-6 invariato); con `false` un carico
  successivo **non** salda i debiti, quindi ogni abbinamento ha carico ≤ scarico nell'ordine di
  `confrontaEventiFifo`. Nuovo campo sempre presente `EsitoFifo.debiti: Array<{ scarico:
  RiferimentoFifo; quantita: number }>` (i debiti rimasti, la cui somma è `scoperto`). Niente
  copia del FIFO.
- **D6. Un lock, sempre.** Ogni scrittura di righe prende `pg_advisory_xact_lock(hashtext(
  chiaveLockGiacenza(registroId, cer)))` per ogni CER coinvolto in ordine lessicografico della
  chiave, **dopo** il lock del progressivo quando c'è (ordine di registrazione e correzioni), poi
  rilegge l'ambito. Le scritture puramente di abbinamento (override, ricalcolo) prendono solo i
  lock della giacenza. Due scarichi concorrenti sullo stesso carico si serializzano.
- **D7. Ambito e partizione.** Ambito = (registro, `chiaveConfrontoCer`, famiglia). È **di
  stoccaggio** se ha almeno un carico vigente di classe R13 o D15 oppure almeno una riga.
  Partizione automatica = (ambito, classe): carichi della classe, più le giacenze iniziali
  dell'ambito se l'ambito ha **una sola** classe (domanda 5), più gli scarichi la cui classe
  attesa è quella (domanda 3). Uno scarico con classe attesa indeterminata non entra in nessuna
  partizione automatica.
- **D8. Classi.** `classeStoccaggio(operationCode)`: maiuscole, tolti spazi e punti, `R13` →
  `'R13'`, `D15` → `'D15'`, altro → `null` (domanda 4). `classeAttesaScarico(operationCode,
  operazioneCausale)`: prima lettera `R`/`D` dell'`operationCode` normalizzato, altrimenti
  l'operazione della causale (`'R'`/`'D'`), → `'R13'`/`'D15'`, altrimenti `null`.
- **D9. Ordine.** Eventi FIFO con `giorno` = giorno italiano della **testa** vigente,
  `ordine` = `anno * 1e7 + progressivo` della **radice** (stabile fra le rettifiche),
  `riferimento.id` = id della radice (movimenti) o della giacenza iniziale. Stesso giorno:
  carichi prima degli scarichi (M13 di F2-6).
- **D10. Quando si scrivono le righe.**
  - **Registrazione di uno scarico** (anche non di massa): nella stessa transazione, dopo
    l'insert, proposta FIFO sui **residui attuali** dei carichi della partizione con giorno ≤
    giorno dello scarico; righe `AUTOMATICO`. Se resta una parte scoperta e l'ambito è di
    stoccaggio: avviso. Una ricopia già registrata (`giaRegistrato`) non fa nulla.
  - **Registrazione di un carico**: nessuna scrittura (gli scarichi non abbinati si completano
    dalla pagina).
  - **Override manuale** di uno scarico: sostituisce tutte le sue righe con righe `MANUALE`
    validate; un elenco vuoto lo scollega.
  - **Ricalcolo** per registro (facoltativo un CER): `NON_ABBINATI` riempie solo gli scarichi
    senza righe, sui residui; `AUTOMATICI` (solo ADMIN) cancella le righe `AUTOMATICO`, tiene
    le `MANUALE`, e rifà la partizione in ordine cronologico (un `calcolaFifo` per partizione).
- **D11. Effetto di rettifiche e annullamenti** (domanda 6):
  - **Annullamento di uno scarico**: le sue righe si cancellano nella stessa transazione, con
    audit `ABBINAMENTI_LIBERATI` (righe nel `metadata`) e avviso "Abbinamenti liberati: n carichi
    tornano disponibili".
  - **Rettifica di uno scarico**: se non cambiano giorno, chiave CER, famiglia, classe attesa né
    quantità, le righe restano. Altrimenti: righe tutte `AUTOMATICO` → cancellate e riproposte
    col FIFO (avviso "Abbinamento ricalcolato con FIFO"); con righe `MANUALE` → restano se
    rispettano ancora I-ABB con i dati nuovi, altrimenti cancellate e riproposte (avviso
    "L'abbinamento manuale non era più valido: ricalcolato con FIFO, verificalo"). Audit
    `ABBINAMENTO_SCARICO_RICALCOLATO` solo quando cambiano.
  - **Rettifica di un carico con righe**: ammessa se la nuova quantità (nella famiglia) ≥ Σ
    righe, la nuova data ≤ il giorno di ogni scarico che lo usa, e chiave CER, famiglia e classe
    restano; altrimenti 409 col messaggio di D13. Senza righe: nessun controllo.
  - **Annullamento di un carico con righe**: 409 (D13).
  - **Giacenza iniziale con righe**: modifica e cancellazione rifiutate con 409
    (`MSG_ABBINATA`), in aggiunta a `controllaNonUsata`; la FK `NO ACTION` lo garantisce anche
    per la cancellazione.
- **D12. Stati.** Scarico: `ABBINATO` (Σ = quantità, in millesimi), `PARZIALE` (0 < Σ <
  quantità), `NON_ABBINATO` (Σ = 0), `INCOERENTE` (Σ > quantità o una riga viola I-ABB). Carico:
  `APERTO` (residuo > 0), `ESAURITO` (= 0), `INCOERENTE` (< 0 o riga che viola I-ABB).
- **D13. Messaggi (testi esatti, senza id né dati fiscali).**
  - carico: `Il carico n. {numero} è abbinato agli scarichi n. {elenco}: {motivo}. Modifica
    prima l'abbinamento di quegli scarichi (Giacenze → Abbinamenti).` con `{elenco}` fino a 5
    numeri e poi `e altri {n}`; `{motivo}` ∈ `la nuova quantità è inferiore a quella già
    abbinata ({q})`, `la nuova data è successiva a quella di uno scarico che lo usa`, `cambia
    il rifiuto, l'unità o l'operazione di stoccaggio`, `non si può annullare`.
  - giacenza iniziale: `MSG_ABBINATA = 'Questa giacenza iniziale è abbinata a uno o più
    scarichi: togli prima l'abbinamento (Giacenze → Abbinamenti).'`
  - registrazione parziale: `Lo scarico è coperto dai carichi in stoccaggio {classe} solo per
    {q} {unità}: completa l'abbinamento da Giacenze → Abbinamenti.` (`{q}` con
    `formattaQuantita`).
  - override, errori di validazione: in Task 2 (`validaRigheManuali`).
- **D14. API** (nuovo `AbbinamentiController`, prefisso `abbinamenti`, `JwtAuthGuard`,
  `requireRequestTenantId(req)`, ruolo effettivo):
  - `GET /abbinamenti?registroId=` (obbligatorio, UUID) → `VistaAbbinamenti`;
  - `GET /abbinamenti/scarichi/:id/proposta` → `PropostaScarico` (candidati con residuo esclusa
    la quota dello scarico stesso, proposta FIFO);
  - `PUT /abbinamenti/scarichi/:id` body `{ righe: { caricoId?: uuid; giacenzaInizialeId?:
    uuid; quantita: number }[] }` (max 500 righe) → `VistaScarico` + `avvisi`;
  - `POST /abbinamenti/ricalcolo` body `{ registroId: uuid; cerCode?: string; modalita:
    'NON_ABBINATI' | 'AUTOMATICI' }` → `{ scarichiAbbinati: number; righeScritte: number;
    righeCancellate: number; avvisi: string[] }`;
  - `GET /abbinamenti/differenze?registroId=&cerCode=` → `DifferenzaAbbinamento[]` (righe
    persistite contro FIFO ricalcolato da zero).
  `:id` è l'id di **qualunque** annotazione della catena dello scarico: si risolve alla radice;
  un id di un'altra azienda o un carico è 404 `Scarico non trovato`.
- **D15. Frontend.** Pagina `fe/features/giacenze/abbinamenti.component.ts`, rotta
  `giacenze/abbinamenti`, link dalla pagina giacenze; dialog dell'override
  `abbinamento-scarico-dialog.component.ts`. Nessuna voce di menu nuova.

## Vincoli globali

- Commit `git commit -m "…" -- <file…>` con percorsi espliciti, messaggi in italiano, **nessuna
  attribuzione AI** (né `Co-Authored-By` né altro). Niente push.
- Testi in italiano, termini tecnici in inglese; mai id, chiavi o dati fiscali nei messaggi
  all'utente. Azienda sempre da `requireRequestTenantId(req)`, ruolo **effettivo**
  (`RuoloEffettivoService.ruoloEffettivo(req.user, tenantId)`).
- **Database di test di questo worktree: `wasteflow-pg-test-abbinamento` su
  `127.0.0.1:55442`.** Mai 55432, 55434, 55436, 55438, 55440, 55444. Macchina Fedora: **niente
  `DOCKER_HOST`**. Creazione (una volta):
  ```bash
  docker run -d --name wasteflow-pg-test-abbinamento -p 127.0.0.1:55442:5432 \
    -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci \
    -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 postgres:16-alpine
  ```
  In ogni shell:
  ```bash
  export DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55442/wasteflow_ci?schema=public"
  export DB_APP_PASSWORD=wasteflow_app_dev DB_SISTEMA_PASSWORD=wasteflow_sistema_dev
  ```
  e prima di ogni suite Postgres
  `[[ "$DATABASE_URL" == *":55442/"* ]] || { echo "DATABASE_URL non punta a 55442: fermo"; exit 1; }`.
  Preparazione: `cd apps/backend && npx prisma migrate deploy`, poi dalla root
  `PG_EXEC="docker exec -i wasteflow-pg-test-abbinamento" bash ops/db-ruoli.sh`, poi
  `cd apps/backend && npx ts-node prisma/seed.ts` (catalogo CER).
- Prisma solo dal pacchetto installato (`npx prisma --version` = 5.22.x).
- Test Postgres col ruolo **`wasteflow_app`** (`creaPrismaServiceApplicativo()`,
  `TenantContext.run`), lanciati con `cd apps/backend && npx jest -c jest.postgres.config.js
  --runInBand --forceExit <spec>`. Pulizia **solo per id esatti creati**: `tenantCreati:
  string[]` e `{ in: tenantCreati }`, nulla se l'array è vuoto; **mai `deleteMany` con un filtro
  che può essere `undefined`**. Ordine di pulizia: `abbinamentoCaricoScarico`, `activityLog`,
  `wasteMovement`, `giacenzaIniziale`, registri, tenant. Fixture fiscali, se servono, con
  `partitaIvaValida(seme)` e `creaDittaConRuolo`. Le righe di `cer_codes` non si modificano.
- **RAM limitata.** Suite unitaria con `cd apps/backend && NODE_ENV=test
  JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --forceExit --ci -w 2 <file>` durante
  il task; `npm run test:cov` (già `runInBand`) a fine task. Lint solo dei file toccati, **senza
  `--fix`**. Karma completo una volta a fine task frontend. Un solo processo pesante alla volta.
- A fine task backend: `npm run test:cov`, `npx tsc --noEmit -p tsconfig.json`, `npx eslint
  "src/**/*.ts"` con 0 errori (senza `--fix`), le suite Postgres toccate, più
  `rls-catalogo.postgres.spec.ts` e `lettori-vigenti.postgres.spec.ts`.
- **Migration** `prisma/migrations/20261101300000_abbinamenti_carico_scarico/migration.sql`
  (prefisso assegnato `202611013000`), additiva: `SET LOCAL lock_timeout = '5s';` in testa
  (le FK prendono un lock su `waste_movements` e `giacenze_iniziali`, tabelle vive); RLS
  ENABLE + FORCE con `isolamento_azienda` e `sola_lettura` per `wasteflow_lettura` (forma di
  `20261031100000_soglie_deposito_temporaneo`); ripristino a mano nel commento iniziale e in
  `ops/README.md`. Dopo ogni modifica di schema: `npx prisma generate`, `npx prisma validate`,
  `migrate deploy` su 55442, `npx prisma migrate diff --from-migrations prisma/migrations
  --to-schema-datamodel prisma/schema.prisma --shadow-database-url
  "postgresql://wasteflow:wasteflow_ci@127.0.0.1:55442/shadow_abbinamento?schema=public"`
  (database creato e rimosso con `docker exec wasteflow-pg-test-abbinamento psql -U wasteflow
  -d wasteflow_ci -c "CREATE DATABASE shadow_abbinamento"` / `DROP DATABASE`): nessuna
  differenza dovuta al pezzo.
- `TENANT_SCOPED_MODELS` += `AbbinamentoCaricoScarico`; `rls-catalogo.postgres.spec.ts:64` da
  35 a **36**; `README-tenant-transazione.md:120` "(36)". Se nel rebase master ha altre tabelle,
  si sommano.
- Nessun UPDATE né DELETE su `waste_movements`. Nessuna colonna nuova su `waste_movements`.
- File di altri pezzi toccabili **solo** come indicato: `fifo-deposito.ts` (D5, additivo),
  `registra-movimento.use-case.ts` (Task 7, solo la chiamata), `correggi-movimento.use-case.ts`
  (Task 7), `giacenze-iniziali.service.ts` (Task 7), `registro.controller.ts` (solo `export`
  di `RUOLI_REGISTRAZIONE`), `lettori-movimenti.spec.ts`, `giacenze.component.ts` (solo il
  link), `app.routes.ts`. Nessun file in `application/fir/**`, `application/mud/**`,
  `infrastructure/rentri/**`, `fe/features/registro/**` (solo import). Se un task scopre di
  doverne toccare un altro, si ferma e lo segnala.

## Review Focus

1. **Scarico retrodatato** registrato dopo altri scarichi già abbinati: la proposta usa solo i
   residui dei carichi con giorno ≤ al suo e non "ruba" nulla agli altri → test in Task 5
   (`retrodatato non tocca le righe esistenti`).
2. **Rettifica che non cambia nulla dell'abbinamento** (solo note o controparte) su uno scarico
   abbinato a mano: le righe manuali restano identiche → test in Task 7.
3. **Tonnellate e kg nello stesso ambito**, litri a parte: un carico in t abbinato a uno scarico
   in kg con le quantità in kg; un carico in litri non compare fra i candidati di uno scarico in
   kg → test in Task 2 e Task 4.
4. **Concorrenza**: due registrazioni di scarico in parallelo sullo stesso carico residuo, e un
   override in parallelo a una registrazione → Σ righe del carico ≤ quantità → test in Task 6.
5. **Catena con rettifiche**: carico rettificato in aumento dopo l'abbinamento, poi uno scarico
   nuovo → la proposta vede il residuo aumentato e la riga punta ancora alla radice → test in
   Task 7.

---

## Task 0: ambiente e linea di base

**File:** nessuno.

- [ ] Creare il container (Vincoli globali) se `docker ps -a` non lo mostra; `docker start
  wasteflow-pg-test-abbinamento` se spento; esportare le variabili; guardia sulla porta.
- [ ] `cd apps/backend && npm ci` solo se `node_modules` manca; `npx prisma migrate deploy`
  (allineato a `20261031110200_fir_parti_sede_cf`), `ops/db-ruoli.sh`, seed, `npx prisma
  generate`.
- [ ] Linea di base: `npm run test:cov`, `rls-catalogo.postgres.spec.ts` (35),
  `lettori-vigenti.postgres.spec.ts`, `giacenze.service.postgres.spec.ts`,
  `correggi-movimento.use-case.postgres.spec.ts`, `registra-movimento.use-case.postgres.spec.ts`.
  Annotare nel rapporto i test già rossi su master (non si aggiustano qui).

## Task 1: FIFO senza saldo dei debiti (D5)

**File:**
- Modify: `src/domain/waste-movement/fifo-deposito.ts:87-97` (tipo), `:149-205` (funzione),
  commento di testa (paragrafo su `saldaDebiti`)
- Test: `src/domain/waste-movement/fifo-deposito.spec.ts`

**Interfaces — Produces:**
```ts
export interface OpzioniFifo { saldaDebiti?: boolean } // predefinito true
export interface DebitoFifo { scarico: RiferimentoFifo; quantita: number }
// EsitoFifo += debiti: DebitoFifo[]
export function calcolaFifo(eventi: readonly EventoFifo[], opzioni?: OpzioniFifo): EsitoFifo
```

- [ ] **Test che falliscono** in un nuovo `describe('saldaDebiti: false')`:
  - `scarico 100 senza lotti, poi carico 60`: con `{ saldaDebiti: false }` → `abbinamenti`
    vuoti, `debiti` = `[{ scarico: S, quantita: 100 }]`, `scoperto` 100, lotto C1 residuo 60;
  - `carico 50 il 01/03, scarico 80 il 02/03, carico 40 il 03/03` → un abbinamento (S, C1, 50),
    debito (S, 30), lotti [C2 residuo 40];
  - `stesso giorno: carico prima dello scarico anche con saldaDebiti false` → (S, C, q);
  - `debiti esposti anche col predefinito`: lo scenario "debito mai saldato" esistente → `debiti`
    con la stessa somma di `scoperto`;
  - proprietà (LCG del file, seme fisso, 300 sequenze): con `saldaDebiti: false` per ogni
    abbinamento `confrontaEventiFifo(carico, scarico) < 0`; Σ `debiti` = `scoperto` in
    millesimi; per ogni scarico abbinato + debito = quantità.
- [ ] Eseguire: `npx jest -w 2 src/domain/waste-movement/fifo-deposito.spec.ts` → FAIL.
- [ ] Implementare: con `saldaDebiti === false` il ciclo del carico non entra nel `while` dei
  debiti (`:161-168`); `debiti` = mappa dei `DebitoInterno` rimasti (`mancante / 1000`). Nessun
  altro cambiamento; i test esistenti restano invariati.
- [ ] Eseguire lo spec → PASS; `giacenze.service.spec.ts` → PASS.
- [ ] Commit: `feat(fifo): opzione saldaDebiti e debiti per l'abbinamento carichi-scarichi`.

## Task 2: dominio puro dell'abbinamento

**File:**
- Create: `src/domain/waste-movement/abbinamento-carichi.ts`
- Test: `src/domain/waste-movement/abbinamento-carichi.spec.ts`

**Interfaces — Consumes:** Task 1 (`calcolaFifo`, `EventoFifo`, `confrontaEventiFifo`,
`millesimiFifo`). **Produces:**
```ts
export type ClasseStoccaggio = 'R13' | 'D15'
export function classeStoccaggio(operationCode: string | null | undefined): ClasseStoccaggio | null
export function classeAttesaScarico(operationCode: string | null | undefined,
  operazioneCausale: 'R' | 'D' | null): ClasseStoccaggio | null

export type OrigineRiga = 'AUTOMATICO' | 'MANUALE'
/** chiave: 'M:' + id radice del carico, oppure 'A:' + id della giacenza iniziale */
export type ChiaveCarico = string
export interface CaricoAbbinabile {
  chiave: ChiaveCarico; evento: EventoFifo /* tipo CARICO, quantita = quantità vigente */
  classe: ClasseStoccaggio | null /* null solo per le giacenze iniziali */; numero?: string
}
export interface ScaricoAbbinabile {
  radiceId: string; evento: EventoFifo /* tipo SCARICO, riferimento.id = radiceId */
  classeAttesa: ClasseStoccaggio | null; numero: string
}
export interface RigaAbbinamento { scaricoRadiceId: string; carico: ChiaveCarico; quantita: number; origine: OrigineRiga }

/** FIFO cronologico su una partizione: carichi con quantita = residuo, scarichi con quantita = da coprire. */
export function proponiAbbinamenti(input: {
  carichi: Array<{ chiave: ChiaveCarico; evento: EventoFifo; residuo: number }>
  scarichi: Array<{ radiceId: string; evento: EventoFifo; daCoprire: number }>
}): { righe: Array<Omit<RigaAbbinamento, 'origine'>>; scoperti: Map<string, number> }

export function residui(carichi: CaricoAbbinabile[], righe: RigaAbbinamento[]): Map<ChiaveCarico, number>

export interface EsitoValidazioneRighe { errori: string[]; avvisi: string[] }
export function validaRigheManuali(input: {
  scarico: ScaricoAbbinabile
  righe: Array<{ carico: ChiaveCarico; quantita: number }>
  candidati: CaricoAbbinabile[] /* stesso ambito */
  residuoEsclusoScarico: Map<ChiaveCarico, number>
}): EsitoValidazioneRighe

export type StatoScarico = 'ABBINATO' | 'PARZIALE' | 'NON_ABBINATO' | 'INCOERENTE'
export type StatoCarico = 'APERTO' | 'ESAURITO' | 'INCOERENTE'
export function statoScarico(quantita: number, abbinato: number): StatoScarico
export function statoCarico(quantita: number, abbinato: number): StatoCarico

export interface DifferenzaAbbinamento { scaricoRadiceId: string; carico: ChiaveCarico; quantitaA: number; quantitaB: number }
/** Confronto generico per (scarico, carico): riusabile in Fase 3 con RELAZ (D9). Ordinato per scarico e carico. */
export function confrontaAbbinamenti(a: RigaAbbinamento[] | Array<Omit<RigaAbbinamento,'origine'>>,
  b: RigaAbbinamento[] | Array<Omit<RigaAbbinamento,'origine'>>): DifferenzaAbbinamento[]
```

- [ ] **Test che falliscono** (esempi scritti a mano):
  - `classeStoccaggio`: `'R13'`, `' r 13 '`, `'R.13'` → R13; `'D15'` → D15; `'R1'`, `'R130'`,
    `''`, `null` → null. `classeAttesaScarico`: `('R4', null)` → R13; `('D9', null)` → D15;
    `(null, 'R')` → R13; `('R13', 'D')` → R13 (vince l'operationCode); `(null, null)` → null.
  - `proponiAbbinamenti`: due carichi 100 (01/03) e 100 (05/03), scarico 150 (10/03) → righe
    (S, C1, 100), (S, C2, 50); scarico del 03/03 di 150 con gli stessi carichi → (S, C1, 100) e
    scoperto 50 (C2 è successivo); due scarichi in ordine cronologico consumano in FIFO;
    residui già ridotti (C1 residuo 30) → (S, C1, 30), (S, C2, …); millesimi: 0,1 × 3 contro 0,3.
    Il risultato non dipende dall'ordine dell'input.
  - `validaRigheManuali`, un test per errore, con questi testi esatti:
    `Il carico indicato non appartiene a questo rifiuto e registro.`;
    `Il carico n. {numero} è successivo allo scarico: si possono abbinare solo carichi con data uguale o precedente.`;
    `La quantità deve essere maggiore di zero, con al massimo 3 decimali.`;
    `Lo stesso carico è indicato due volte.`;
    `Il totale abbinato ({q}) supera la quantità dello scarico ({s}).`;
    `Il carico n. {numero} ha un residuo di {r}: non basta per {q}.`
    (per una giacenza iniziale `La giacenza iniziale del {gg/mm/aaaa}` al posto di `Il carico
    n. {numero}`); avvisi: `Il carico n. {numero} è in stoccaggio {classe}, lo scarico è
    un'operazione {attesa}.` e `Abbinamento parziale: restano {q} da abbinare.`.
  - `statoScarico`/`statoCarico` ai bordi (millesimi: 99,9995 contro 100).
  - `confrontaAbbinamenti`: righe uguali → `[]`; quantità diverse, riga solo in A, riga solo in
    B (quantità mancante = 0).
- [ ] Eseguire → FAIL.
- [ ] Implementare. `proponiAbbinamenti`: eventi = carichi con `quantita = residuo` (si saltano
  quelli con `millesimiFifo(residuo) <= 0`) + scarichi con `quantita = daCoprire` (stessa
  regola), `calcolaFifo(eventi, { saldaDebiti: false })`, mappa `riferimento.id` → chiave con
  una `Map` costruita dall'input; `scoperti` dai `debiti`. Le funzioni non conoscono Prisma.
  Quantità formattate con `formattaQuantita` (`src/core/format/formatta-quantita`).
- [ ] PASS; commit: `feat(abbinamenti): dominio puro dell'abbinamento carichi-scarichi`.

## Task 3: schema, migration e RLS

**File:**
- Modify: `prisma/schema.prisma` (enum `OrigineAbbinamento` e modello in coda al file;
  `@@unique([id, registroId, tenantId], map: "giacenze_iniziali_id_registro_tenant_key")` su
  `GiacenzaIniziale`; relazioni inverse in fondo ai campi di relazione di `Tenant`,
  `RegistroRifiuti`, `GiacenzaIniziale`, `WasteMovement`: `abbinamentiComeScarico`
  `@relation("AbbinamentiScarico")`, `abbinamentiComeCarico` `@relation("AbbinamentiCarico")`)
- Create: `prisma/migrations/20261101300000_abbinamenti_carico_scarico/migration.sql`
- Modify: `src/infrastructure/persistence/prisma-rls.extension.ts` (`TENANT_SCOPED_MODELS`),
  `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts:64` (36),
  `src/infrastructure/persistence/README-tenant-transazione.md:120` (36, e nome nell'elenco),
  `ops/README.md` (voce "F4-6 abbinamenti": ripristino)
- Test: `src/application/abbinamenti/abbinamenti.schema.postgres.spec.ts` (nuovo)

- [ ] **Test che falliscono** (ruolo `wasteflow_app`, un tenant A e uno B, un registro per
  tenant, un carico e uno scarico per registro, una giacenza iniziale):
  - `inserisce una riga carico e una riga giacenza iniziale`;
  - `rifiuta carico_id e giacenza_iniziale_id insieme o entrambi nulli` (`abbinamenti_cs_un_carico_check`);
  - `rifiuta quantita 0` (`abbinamenti_cs_quantita_check`);
  - `rifiuta uno scarico usato come carico` (carico_id = id dello scarico → FK `abbinamenti_cs_carico_fkey`);
  - `rifiuta un carico di un altro registro` (FK composta);
  - `rifiuta la stessa coppia scarico-carico due volte` (`abbinamenti_cs_scarico_carico_key`);
  - `non cancella una giacenza iniziale abbinata` (FK `NO ACTION`);
  - RLS: nel contesto di B non vede né inserisce righe di A; senza contesto 0 righe;
  - `rls-catalogo`: 36 tabelle con ENABLE + FORCE + policy.
- [ ] FAIL (tabella assente).
- [ ] Migration, in quest'ordine: commento iniziale (cosa aggiunge; additiva; ripristino:
  `DROP TABLE abbinamenti_carico_scarico; DROP TYPE origine_abbinamento; DROP INDEX
  giacenze_iniziali_id_registro_tenant_key;` e riga da togliere da `_prisma_migrations`, con la
  query di controllo `SELECT tenant_id, count(*) FROM abbinamenti_carico_scarico GROUP BY 1`);
  `SET LOCAL lock_timeout = '5s';`; enum; indice unico su `giacenze_iniziali`; tabella con i
  CHECK di D4; indici e FK con i nomi di D4; RLS in fondo come
  `20261031100000_soglie_deposito_temporaneo` sezione 4.
- [ ] `prisma generate`, `validate`, `migrate deploy`, `ops/db-ruoli.sh`, `migrate diff` vuoto.
- [ ] PASS: spec dello schema, `rls-catalogo`, `src/infrastructure/persistence/` Postgres.
- [ ] Commit: `feat(abbinamenti): tabella abbinamenti_carico_scarico con RLS`.

## Task 4: lettore dell'ambito

**File:**
- Create: `src/application/abbinamenti/lettore-abbinamenti.ts`
- Modify: `src/application/registro/lettori-movimenti.spec.ts` (voce `'application/abbinamenti/lettore-abbinamenti.ts': { scelta: 'vigenti', motivo: "ambito dell'abbinamento: teste vigenti con la loro radice; le righe di catene non vigenti risultano INCOERENTI" }`)
- Test: `src/application/abbinamenti/lettore-abbinamenti.postgres.spec.ts`,
  `src/application/abbinamenti/lettore-abbinamenti.spec.ts` (mappatura, con client finto)

**Interfaces — Consumes:** Task 2 (tipi, `classeStoccaggio`, `classeAttesaScarico`), Task 3
(modello). **Produces:**
```ts
export type ClientAbbinamenti = Prisma.TransactionClient | PrismaService
export interface AmbitoAbbinamento {
  registroId: string; chiaveCer: string; cerCode: string /* canonico della testa più recente */
  famiglia: string; unita: string /* 'kg' per la massa */
  carichi: CaricoAbbinabile[]   /* stoccaggio R13/D15 + giacenze iniziali dell'ambito */
  scarichi: ScaricoAbbinabile[] /* tutti gli scarichi vigenti dell'ambito */
  righe: RigaAbbinamento[]      /* righe che puntano a scarichi o carichi dell'ambito */
  righeIncoerenti: Array<{ id: string; motivo: string }> /* violano I-ABB (D2) */
  classi: ClasseStoccaggio[]    /* classi presenti fra i carichi */
  diStoccaggio: boolean
}
export async function leggiAmbitiAbbinamento(client: ClientAbbinamenti, tenantId: string,
  filtro: { registroId: string; cer?: string }): Promise<AmbitoAbbinamento[]>
/** Risolve un id qualunque della catena dello scarico: null se non esiste, non è uno scarico o è di un'altra azienda. */
export async function radiceScarico(client: ClientAbbinamenti, tenantId: string, id: string):
  Promise<{ radiceId: string; registroId: string; cerCode: string } | null>
/** Righe e scarichi (numero, giorno) che usano la radice di un carico. */
export async function righeDelCarico(client: ClientAbbinamenti, tenantId: string, caricoRadiceId: string):
  Promise<Array<{ scaricoRadiceId: string; numeroScarico: string; giornoScarico: string; quantita: number; famiglia: string }>>
```

- [ ] **Test che falliscono** (Postgres, ruolo applicativo, dati costruiti con
  `RegistraMovimentoUseCase` e `CorreggiMovimentoUseCase` veri):
  - `un ambito per CER e famiglia`: carichi R13 in kg e in t dello stesso CER → un ambito
    `KG`, quantità in kg; un carico in litri → ambito separato;
  - `carico senza operazione R13/D15 escluso`; `ambito senza carichi di stoccaggio e senza righe
    → diStoccaggio false`;
  - `testa vigente e radice`: carico rettificato (quantità e data) → evento con giorno della
    testa, `ordine` e `riferimento.id` della radice, numero della testa;
  - `catena annullata esclusa` (carico e scarico);
  - `classe attesa dalla causale`: scarico `AVVIO_SMALTIMENTO` senza operationCode → D15;
  - `giacenze iniziali dell'ambito` con chiave `A:<id>`, classe null;
  - `righeIncoerenti`: riga che punta a un carico la cui catena è stata annullata (inserita a
    mano dal proprietario) → motivo `carico non più vigente`;
  - `radiceScarico`: id della testa rettificata → radice; id di un carico → null; id di un'altra
    azienda → null;
  - mappatura (unitario): quantità che arrotonda a 0 millesimi saltata con `logger.warn`.
- [ ] FAIL.
- [ ] Implementare: **una** `$queryRaw` per i movimenti vigenti del registro (alias `wm`,
  `sqlVigente('wm')`, filtro facoltativo `regexp_replace(cer_code,'[^0-9]','','g') =
  cerSoloCifre(cer)`, join sulla radice per il suo progressivo; colonne: `id`, radice,
  `type`, `cer_code`, `unit`, `quantity`, `movement_date`, progressivi di testa e radice,
  `operation_code`, `causale`, `causale_azienda_id`), `leggiApertureRegistro` (filtro per
  chiave CER in memoria), `abbinamentoCaricoScarico.findMany({ where: { tenantId, registroId } })`,
  `caricaCatalogoCausali` una volta (operazione della causale col giorno della testa).
  Quantità con `quantitaFifo`, famiglie con `famigliaFifo`, giorni con `giornoItaliano`.
  Numero query fisso (nessun N+1).
- [ ] PASS: le due spec, `lettori-movimenti.spec.ts`, `lettori-vigenti.postgres.spec.ts`.
- [ ] Commit: `feat(abbinamenti): lettore dell'ambito con radici e classi`.

## Task 5: scritture in transazione (proposta, override, ricalcolo)

**File:**
- Create: `src/application/abbinamenti/abbinamenti-scrittura.ts`
- Test: `src/application/abbinamenti/abbinamenti-scrittura.postgres.spec.ts`

**Interfaces — Consumes:** Task 2, Task 4. **Produces** (tutte da chiamare **dentro** una
transazione; prendono da sole i lock di D6, rientranti):
```ts
export async function bloccaAmbiti(tx: Prisma.TransactionClient, registroId: string, cer: string[]): Promise<void>
export async function abbinaNuovoScarico(tx: Prisma.TransactionClient, p: {
  tenantId: string; registroId: string; scaricoId: string /* id appena inserito */; userId: string | null
}): Promise<string[] /* avvisi */>
export async function salvaAbbinamentoManuale(tx: Prisma.TransactionClient, p: {
  tenantId: string; scaricoRadiceId: string; userId: string
  righe: Array<{ caricoId?: string; giacenzaInizialeId?: string; quantita: number }>
}): Promise<{ avvisi: string[] }> // BadRequestException con gli errori di validaRigheManuali uniti da ' '
export async function ricalcolaAbbinamenti(tx: Prisma.TransactionClient, p: {
  tenantId: string; registroId: string; cer?: string; modalita: 'NON_ABBINATI' | 'AUTOMATICI'; userId: string
}): Promise<{ scarichiAbbinati: number; righeScritte: number; righeCancellate: number; avvisi: string[] }>
```

- [ ] **Test che falliscono** (Postgres):
  - `abbinaNuovoScarico FIFO`: due carichi R13 (100, 100), scarico `AVVIO_RECUPERO` 150 → righe
    `AUTOMATICO` (C1 100, C2 50), `creato_da` = utente, nessun avviso;
  - `parziale con avviso`: scarico 250 → righe 200 e l'avviso di D13 col testo esatto;
  - `fuori ambito`: CER senza carichi di stoccaggio → nessuna riga, nessun avviso;
  - `classe indeterminata con due classi` → nessuna riga, avviso
    `Il rifiuto è in stoccaggio sia R13 sia D15: indica l'abbinamento a mano (Giacenze → Abbinamenti).`;
  - `retrodatato non tocca le righe esistenti` (Review Focus 1);
  - `giacenza iniziale in ambito a una classe` usata per prima se più vecchia;
  - `salvaAbbinamentoManuale` sostituisce le righe con `MANUALE`, scrive l'audit
    `ABBINAMENTO_SCARICO_MODIFICATO` (metadata: numeri, non id fiscali); errori di validazione →
    `BadRequestException` e righe invariate; elenco vuoto → scarico senza righe;
  - `ricalcolo NON_ABBINATI` riempie solo gli scarichi senza righe; `ricalcolo AUTOMATICI`
    tiene le `MANUALE`, rifà le altre, conta cancellate e scritte;
  - `ricalcolo` scrive un solo audit `ABBINAMENTI_RICALCOLATI` con i conteggi.
- [ ] FAIL.
- [ ] Implementare: lock (`bloccaAmbiti` = chiavi `chiaveLockGiacenza` distinte e ordinate),
  poi `leggiAmbitiAbbinamento`, poi le funzioni pure. Partizioni come D7; residui con
  `residui()`. Inserimenti con `createMany` (quantità come stringa a 3 decimali), cancellazioni
  per id esatti (`id: { in: ids }`, saltata se vuota). Lo scarico manuale si cerca con
  `radiceScarico` dentro la transazione: assente → `NotFoundException('Scarico non trovato')`.
- [ ] PASS; commit: `feat(abbinamenti): FIFO alla registrazione, override e ricalcolo in transazione`.

## Task 6: concorrenza

**File:**
- Test: `src/application/abbinamenti/abbinamenti-concorrenza.postgres.spec.ts` (nuovo)

**Interfaces — Consumes:** Task 5, `RegistraMovimentoUseCase` (dopo Task 7 il test 1 passa
attraverso la registrazione vera; prima di Task 7 si usa `abbinaNuovoScarico` in due
transazioni). Il task si esegue **dopo** Task 7: l'ordine dell'elenco lo rispetta (vedi
"Ordine"), qui sta solo per tenere vicine le scritture.

- [ ] Test (due `PrismaService` applicativi, `Promise.all`, 10 ripetizioni ciascuno):
  - `due scarichi concorrenti sullo stesso carico residuo`: carico 100, due scarichi da 70 →
    Σ righe del carico = 100, uno dei due `PARZIALE` di 40;
  - `override concorrente a una registrazione`: Σ righe ≤ quantità del carico, nessun deadlock
    (timeout del test 20 s);
  - `ricalcolo AUTOMATICI concorrente a una registrazione` → stessa invariante.
- [ ] Eseguire due volte di fila → PASS entrambe.
- [ ] Commit: `test(abbinamenti): concorrenza su carico condiviso`.

## Task 7: integrazione con registrazione, correzioni e giacenze iniziali

**File:**
- Create: `src/application/abbinamenti/abbinamenti-correzioni.ts`
- Modify: `src/application/registro/use-cases/registra-movimento.use-case.ts` (dopo `:318`,
  prima di `:347`), `src/application/registro/use-cases/correggi-movimento.use-case.ts`
  (dopo `:186` e dopo `:232`), `src/application/registro/giacenze-iniziali.service.ts`
  (`:292`, `:338`, costante `MSG_ABBINATA`)
- Test: `src/application/abbinamenti/abbinamenti-correzioni.postgres.spec.ts`; casi nuovi in
  `registra-movimento.use-case.postgres.spec.ts`, `correggi-movimento.use-case.postgres.spec.ts`,
  `giacenze-iniziali.postgres.spec.ts`; mock aggiornati in `registra-movimento.use-case.spec.ts`
  e `correggi-movimento.use-case.spec.ts` (il client finto deve rispondere a
  `abbinamentoCaricoScarico` e alla `$queryRaw` del lettore: si mocka il modulo
  `abbinamenti-scrittura`/`abbinamenti-correzioni` con `jest.mock`).

**Interfaces — Consumes:** Task 4, Task 5. **Produces:**
```ts
/** Prima dell'insert di una correzione di CARICO: ConflictException col testo di D13 se viola I-ABB. */
export async function verificaCorrezioneCarico(tx: Prisma.TransactionClient, p: {
  tenantId: string; caricoRadiceId: string; numeroCarico: string
  tipo: 'RETTIFICA' | 'ANNULLAMENTO'
  nuovo?: { giorno: string; chiaveCer: string; famiglia: string; quantita: number /* nella famiglia */; classe: ClasseStoccaggio | null }
}): Promise<void>
/** Dopo l'insert di una correzione di SCARICO (la nuova testa e' gia' scritta): D11. */
export async function riallineaDopoCorrezioneScarico(tx: Prisma.TransactionClient, p: {
  tenantId: string; registroId: string; scaricoRadiceId: string; tipo: 'RETTIFICA' | 'ANNULLAMENTO'
  prima: { giorno: string; chiaveCer: string; famiglia: string; quantita: number; classeAttesa: ClasseStoccaggio | null }
  userId: string
}): Promise<string[] /* avvisi */>
export async function giacenzaInizialeAbbinata(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<boolean>
```

- [ ] **Test che falliscono:**
  - registrazione: `scarico registrato con FIFO automatico` (righe presenti a fine
    transazione); `ricopia già registrata non duplica le righe`; `scarico in litri` prende il
    lock e si abbina nella sua famiglia; un errore del lettore fa fallire la registrazione
    (rollback, nessun movimento).
  - correzioni di scarico: `annullamento libera le righe` (righe cancellate, audit
    `ABBINAMENTI_LIBERATI`, avviso); `rettifica solo note mantiene le righe manuali` (Review
    Focus 2); `rettifica quantità con righe automatiche → riproposte`; `rettifica che rende
    invalido il manuale → riproposto con avviso`; `rettifica del CER → righe nel nuovo ambito`.
  - correzioni di carico: `rettifica in aumento ammessa, riga sulla radice, residuo aumentato`
    (Review Focus 5); `rettifica sotto l'abbinato → 409` col testo esatto di D13 e
    `{elenco}`; `data dopo lo scarico → 409`; `operazione da R13 a R1 con righe → 409`;
    `annullamento con righe → 409`; `annullamento senza righe ammesso`; in ogni 409 nessuna
    nuova annotazione (rollback).
  - giacenze iniziali: `modifica di una giacenza abbinata → 409 MSG_ABBINATA`; `eliminazione
    → 409 MSG_ABBINATA`.
- [ ] FAIL.
- [ ] Implementare:
  - registrazione: dopo l'insert, solo se `command.type === 'SCARICO'`,
    `avvisi.push(...await abbinaNuovoScarico(tx, { tenantId, registroId: registroMovimento.id,
    scaricoId: record.id, userId: command.userId ?? null }))`. Nient'altro cambia.
  - correzioni: carico → `verificaCorrezioneCarico` dopo la rilettura sotto lock (`:186`) e
    prima della numerazione, con i dati nuovi in famiglia (`quantitaFifo`, `famigliaFifo`,
    `classeStoccaggio(dati.operationCode)`, `giornoItaliano(dati.movementDate)`); scarico →
    calcolare `prima` dall'originale, e dopo l'insert (`:232`)
    `avvisi.push(...await riallineaDopoCorrezioneScarico(...))`. I lock dei CER toccati sono
    già presi (`:163-172`).
  - giacenze iniziali: in `modifica` e `elimina`, subito dopo `controllaNonUsata`,
    `if (await giacenzaInizialeAbbinata(tx, tenantId, id)) throw new ConflictException(MSG_ABBINATA)`.
- [ ] PASS: le spec toccate, `registra-movimento.causali.postgres.spec.ts`,
  `correggi-movimento.causali.postgres.spec.ts`, `lettori-movimenti.spec.ts`; poi Task 6.
- [ ] Commit: `feat(abbinamenti): FIFO alla registrazione e regole su rettifiche e annullamenti`.

## Task 8: vista, servizio e API

**File:**
- Create: `src/application/abbinamenti/abbinamenti.service.ts`,
  `src/application/abbinamenti/abbinamenti.controller.ts`,
  `src/application/abbinamenti/abbinamenti.module.ts`,
  `src/application/abbinamenti/abbinamenti.dto.ts`
- Modify: `src/app.module.ts` (import del modulo), `src/api/registro/registro.controller.ts:73`
  (`export const RUOLI_REGISTRAZIONE`)
- Test: `abbinamenti.service.spec.ts`, `abbinamenti.service.postgres.spec.ts`,
  `abbinamenti.controller.spec.ts`, `abbinamenti.controller.http.spec.ts`,
  `abbinamenti.module.spec.ts` (tutti in `src/application/abbinamenti/`)

**Interfaces — Consumes:** Task 2, 4, 5. **Produces** (contratto JSON per il frontend):
```ts
export interface RiferimentoCaricoVista { tipo: 'MOVIMENTO' | 'APERTURA'; id: string /* radice o giacenza */; numero: string | null; giorno: string }
export interface CaricoVista extends RiferimentoCaricoVista {
  classe: ClasseStoccaggio | null; quantita: number; abbinato: number; residuo: number
  etaGiorni: number | null; stato: StatoCarico }
export interface RigaVista { carico: RiferimentoCaricoVista; quantita: number; origine: OrigineRiga }
export interface ScaricoVista { id: string /* radice */; numero: string; giorno: string; quantita: number
  classeAttesa: ClasseStoccaggio | null; abbinato: number; stato: StatoScarico; righe: RigaVista[] }
export interface AmbitoVista { cerCode: string; famiglia: string; unita: string; classi: ClasseStoccaggio[]
  carichi: CaricoVista[]; scarichi: ScaricoVista[]; differenzeFifo: number; incoerenze: string[] }
export interface VistaAbbinamenti { registroId: string; oggi: string; ambiti: AmbitoVista[]
  puoModificare: boolean; puoRicalcolare: boolean }
export interface PropostaScarico { scarico: ScaricoVista; candidati: CaricoVista[] /* residuo escluso lo scarico */
  proposta: Array<{ carico: RiferimentoCaricoVista; quantita: number }>; scoperto: number }
export interface DifferenzaVista { scarico: { id: string; numero: string }; carico: RiferimentoCaricoVista; persistita: number; fifo: number }
```
Servizio: `vista(tenantId, registroId, oggi = giornoItaliano(new Date()), ruolo)`,
`proposta(tenantId, scaricoId)`, `salvaManuale(tenantId, userId, scaricoId, righe)`,
`ricalcola(tenantId, userId, dto)`, `differenze(tenantId, registroId, cer?)`. Le scritture
aprono `this.prisma.$transaction` e chiamano Task 5. Registro risolto con
`RegistriService.risolviInLettura` (registro di un'altra azienda → 404 come i controller
esistenti). La vista mostra solo gli ambiti `diStoccaggio`; carichi in ordine FIFO; scarichi in
ordine cronologico inverso.

- [ ] **Test che falliscono:**
  - servizio (Postgres): vista con stati, residui, età (`oggi` fisso) e `differenzeFifo`
    (override manuale diverso dal FIFO → 1); `proposta` esclude le righe dello scarico stesso;
    `differenze` elenca la riga manuale contro quella FIFO.
  - controller (unitari): ruoli — `OPERATOR` può `PUT` e `ricalcolo NON_ABBINATI`, riceve 403
    `Solo un amministratore dell'azienda può ricalcolare gli abbinamenti automatici.` su
    `AUTOMATICI`; `VIEWER` (o ruolo senza registrazione) 403 su `PUT` con
    `Il tuo ruolo non consente di modificare gli abbinamenti.`; `puoModificare` e
    `puoRicalcolare` coerenti col ruolo effettivo.
  - http (supertest): `registroId` mancante o non UUID → 400; `righe` con più di 500 elementi →
    400; `quantita` negativa → 400 dal DTO; `caricoId` e `giacenzaInizialeId` insieme → 400
    `Indica un carico oppure una giacenza iniziale, non entrambi.`; id di un'altra azienda → 404.
  - modulo: compila con `PrismaModule, LoggerModule, AuthModule, RuoloEffettivoModule` e
    `RegistriService` disponibile.
- [ ] FAIL → implementare → PASS. Swagger con `@ApiTags('abbinamenti')`.
- [ ] Commit: `feat(abbinamenti): API di vista, proposta, override, ricalcolo e differenze`.

## Task 9: frontend, pagina degli abbinamenti

**File:**
- Create: `fe/features/giacenze/abbinamenti.service.ts`, `abbinamenti.component.ts`,
  `abbinamenti.component.spec.ts`, `abbinamenti.component.dom.spec.ts`, `abbinamenti.service.spec.ts`
  (in `fe/features/giacenze/`)
- Modify: `fe/app.routes.ts:118-122` (figlia `giacenze/abbinamenti`, `loadComponent`),
  `fe/features/giacenze/giacenze.component.ts` (solo un `p-button` link "Abbinamenti R13/D15"
  con `routerLink="/giacenze/abbinamenti"` e `data-testid="link-abbinamenti"`)

**Interfaces — Consumes:** contratto JSON di Task 8 (tipi copiati in `abbinamenti.service.ts`).

- [ ] **Test che falliscono:**
  - servizio: URL e parametri dei 5 endpoint.
  - componente: selettore del registro con `registroPredefinito`/`etichettaRegistro`; un
    pannello per ambito (`CER {cerCode} · {classi}`); tabella carichi (n., data, classe,
    quantità, abbinato, residuo, età in giorni, stato); tabella scarichi con tag di stato
    (`ABBINATO` verde, `PARZIALE` giallo, `NON_ABBINATO` grigio, `INCOERENTE` rosso); filtro
    "solo da completare"; nessun ambito → testo
    `Nessun rifiuto in stoccaggio R13/D15 in questo registro. Compaiono qui i carichi con operazione R13 o D15.`;
    pulsante `Abbina con FIFO i non abbinati` visibile con `puoModificare`, `Ricalcola gli
    automatici` solo con `puoRicalcolare` e con conferma
    `Le righe automatiche di questo registro vengono ricalcolate con FIFO; quelle inserite a mano restano.`;
    sezione `Differenze dal FIFO ({n})` espandibile; gli `avvisi` della risposta in `p-message`.
  - DOM: `data-testid` su tabelle, pulsanti e righe (`scarico-{numero}`).
- [ ] FAIL → implementare (componente standalone, PrimeNG come `giacenze.component.ts`,
  `ChangeDetectionStrategy.OnPush` se il resto della feature lo usa) → PASS.
- [ ] `npx ng test --watch=false --browsers=ChromeHeadless`, `npm run build`, eslint dei file
  toccati.
- [ ] Commit: `feat(abbinamenti): pagina degli abbinamenti carichi-scarichi`.

## Task 10: frontend, dialog dell'abbinamento di uno scarico

**File:**
- Create: `fe/features/giacenze/abbinamento-scarico-dialog.component.ts`,
  `abbinamento-scarico-dialog.component.spec.ts`, `abbinamento-scarico-dialog.dom.spec.ts`
- Modify: `fe/features/giacenze/abbinamenti.component.ts` (apertura del dialog dalla riga dello
  scarico, ricarica dopo il salvataggio)

**Interfaces — Consumes:** `PropostaScarico`, `PUT /abbinamenti/scarichi/:id`.

- [ ] **Test che falliscono:** all'apertura carica la proposta e precompila le quantità;
  `Usa la proposta FIFO` ripristina; una riga per candidato con residuo e campo quantità
  (`p-inputNumber`, 3 decimali, min 0); totale e "da abbinare" aggiornati; `Salva` invia solo le
  righe con quantità > 0; `Scollega tutto` invia `righe: []` dopo conferma; un 400 mostra il
  messaggio del backend così com'è; la riga di una classe diversa da quella attesa ha
  l'etichetta `classe diversa`; il pulsante `Salva` è disabilitato se il totale supera la
  quantità dello scarico.
- [ ] FAIL → implementare → PASS; Karma completo, `npm run build`, eslint dei file toccati.
- [ ] Commit: `feat(abbinamenti): dialog dell'abbinamento manuale di uno scarico`.

## Task 11: chiusura e verifica finale

**File:** `CHANGELOG.md`, `ops/README.md` (completare la voce del Task 3 con "cosa controllare
dopo il deploy").

- [ ] `CHANGELOG.md`, sezione `## [Unreleased]`, "### Added — Abbinamento carichi-scarichi
  R13/D15 (Fase 4 pezzo 6)":
  > Per i rifiuti in stoccaggio (carichi con operazione R13 o D15) ogni scarico è ora abbinato
  > ai carichi da cui esce, in ordine FIFO, già al momento della registrazione. Nella pagina
  > Giacenze → Abbinamenti si vedono per ogni carico il residuo e l'età, per ogni scarico se è
  > abbinato del tutto, in parte o per niente; l'abbinamento si può correggere a mano. Gli
  > scarichi registrati prima di questa versione non sono abbinati: si abbinano con il pulsante
  > "Abbina con FIFO i non abbinati". Un carico già abbinato non si può più ridurre sotto la
  > quantità abbinata né annullare finché i suoi scarichi non sono riabbinati.
- [ ] `ops/README.md`: dopo il deploy `SELECT count(*) FROM abbinamenti_carico_scarico` (0 se
  nessuno ha ancora registrato scarichi di stoccaggio) e controllo RLS
  (`rls-catalogo` = 36 in CI).
- [ ] Verifica finale: `npm run test:cov`; tutte le suite Postgres di `src/application/abbinamenti/`,
  `src/application/registro/`, `src/application/giacenze/`, `src/infrastructure/persistence/`;
  `npx eslint "src/**/*.ts"` senza `--fix` (0 errori); `tsc`; Karma; `npm run build`;
  `prisma migrate diff` vuoto.
- [ ] Commit: `docs(abbinamenti): changelog e note di deploy dell'abbinamento carichi-scarichi`.

## Ordine

0 → 1 → 2 → 3 → 4 → 5 → 7 → 6 → 8 → 9 → 10 → 11. (Task 6 dopo Task 7: il primo test di
concorrenza passa dalla registrazione vera.) Nessun parallelismo interno (RAM, file condivisi).

## Fuori ambito (seguiti)

- **Import di `RELAZ`** (Fase 3, 3.4): mappatura dei segmenti `C`/`P`/`G` in righe di
  confronto per `confrontaAbbinamenti`; decisione D9 (domanda 9).
- **Invio a RENTRI** dei riferimenti dello scarico ai carichi e delle relazioni sulle giacenze
  iniziali (WinWaste `RenRelazioniIniziali`, `giacenze.md` §2.5): con F2-9.
- **Limiti dell'autorizzazione** dello stoccaggio (tempo massimo R13/D15, quantità massima) e
  magazzini/posizioni (D12 della roadmap).
- **Volume (m³) dei segmenti** e pesi specifici: si abbina nella famiglia dell'unità.
- **Scarico volutamente non abbinato** (per esempio rifiuto prodotto dall'impianto con lo stesso
  CER): oggi "Abbina con FIFO i non abbinati" lo riempirebbe; serve un marcatore "nessun
  abbinamento" (tabella 1:1) se i clienti lo chiedono.
- **Ora del movimento** come criterio d'ordine fra (1) e (2) di `confrontaEventiFifo`.
- **Avvisi pianificati** sull'età degli stoccaggi.
