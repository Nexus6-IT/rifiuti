# Fase 2 pezzo 3: rettifica e annullamento dei movimenti — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa,
> opus rivede. Ordine STRETTAMENTE sequenziale: Task 1a → 1b → 2a → 2b → 3 → 4 → 5
> (un solo worktree: verifiche globali, commit e database di test condivisi).
> Piano rivisto da opus il 2026-10-27 (C1-C2, I1-I8 e i minori recepiti).

**Obiettivo.** Un errore di registrazione si corregge dall'interfaccia senza mai
modificare o cancellare una riga del registro: la rettifica e l'annullamento sono
**nuove annotazioni**, con un proprio numero del registro, collegate a quella che
correggono. Ogni calcolo (saldo dello scarico, giacenze, MUD, anomalie) conta solo
le annotazioni **vigenti**. In più la versione 2 dell'hash dell'annotazione,
concatenato per registro e anno, con una verifica della catena.

**Fonti.**
- Roadmap `C:\Progetti\winwaste\docs\roadmap-fase2-parita-registro.md` §F2-3
  (decisione 2026-10-24: rettifica su anno già presentato al MUD consentita come
  nuova annotazione, con avviso esplicito).
- Contratto RENTRI `docs/contracts/rentri/dati-registri.yaml`: rettifica e
  annullamento (`AnnullamentoMovimentoModel`) sono registrazioni con **numero
  proprio**; l'annullamento ha `annotazioni` obbligatorie (minLength 1). Il
  contratto descrive le variazioni appese alla registrazione principale
  (`:809-818`): per questo ogni correzione conserva anche il riferimento alla
  **radice** della catena (R1). Come F2-9 userà radice o predecessore lo deciderà
  F2-9.
- WinWaste `movimenti.md` §3.6: cancellazione logica, "non è possibile cancellare
  carichi già scaricati", `darettificare='A'` verso RENTRI.

**Stato di partenza (master `6310d40`, verificato dalla revisione).**
- `WasteMovement` (`prisma/schema.prisma`, `@@map("waste_movements")`): nessun
  campo che leghi due movimenti; `entryHash` (`DEFAULT ''`, le righe precedenti
  alla migration `20260629300000_extend_waste_movement_registro` hanno hash vuoto)
  = SHA-256 di `tenant|anno|numero|type|cer|quantity.toString()|movementDate ISO|causale`
  (`domain/waste-movement/waste-movement.entity.ts` `computeHash`), non
  concatenato e mai verificato.
- Registrazione: `registra-movimento.use-case.ts`: validazioni in `execute`
  (CER normalizzato e a catalogo con `cer-catalogo.ts`, date non future,
  ~righe 116-157), `WasteMovement.create` (quantità > 0, registrazione ≥
  movimento, causale per tipo), lock FIR → progressivo `<registroId>-<anno>` →
  giacenza `chiaveLockGiacenza`; numero = `MAX+1` o progressivo iniziale;
  `verificaGiacenza` blocca solo sul **saldo complessivo**, l'ordine delle date è
  un avviso, con carichi in unità non di massa il blocco diventa avviso.
- Lettori di `waste_movements` fuori dagli spec: `giacenza-disponibile.ts`
  (CTE `righe` + sottoquery `unita_non_massa`), `giacenze/giacenze.service.ts` (3),
  `mud/aggregazione/mud-aggregazione.service.ts` (4: movimenti dell'anno, anni
  precedenti per i doppi, `scarichiDeiFirAnno` ~:254, `saldiAl31Dicembre`),
  `anomaly/anomaly-detection.service.ts`, `registro/giacenze-iniziali.service.ts`
  (3: `controllaNonUsata`, `elenca`/`modificabile`, avviso G8),
  `registro/progressivo-iniziale.service.ts` (2),
  `registro/queries/list-movimenti.handler.ts` (2), `registra-movimento.use-case.ts`
  (3), `infrastructure/rentri/rentri-unita-locale.service.ts` (1). Frontend:
  `core/services/export.service.ts` (export PDF/Excel del registro, ~238-360).
- L'elenco (`list-movimenti.handler.ts`) NON calcola `fuoriTermine`/`ritardoGg`:
  li calcola solo `movimentoDaRecord` nella risposta della registrazione.
- `MUDReport(tenantId, year, status: DRAFT|REVIEWING|SUBMITTED|ARCHIVED)`.
- Il controller di registrazione oggi trasforma ogni `Result.fail` in 400
  (`registro.controller.ts` ~139-141).

## Decisioni (dell'orchestratore, vincolanti)

- **R1. Modello.** Colonne nuove su `waste_movements`:
  - `tipo_annotazione` enum `TipoAnnotazioneMovimento { ORDINARIA, RETTIFICA, ANNULLAMENTO }`
    NOT NULL default `ORDINARIA`;
  - `movimento_rettificato_id UUID NULL` (predecessore diretto) e
    `movimento_originale_id UUID NULL` (radice: la `ORDINARIA` da cui parte la
    catena; per una correzione dell'originale coincidono);
  - `motivo_annotazione VARCHAR(500) NULL`;
  - `hash_versione SMALLINT NOT NULL DEFAULT 1`.
  Prisma: relazione **1:n** self-referencing
  `rettificato WasteMovement? @relation("Correzioni", fields: [movimentoRettificatoId, registroId, tenantId, type], references: [id, registroId, tenantId, type], onDelete: NoAction, onUpdate: NoAction, map: "waste_movements_rettificato_fkey")`
  con inverso `correzioni WasteMovement[] @relation("Correzioni")`;
  `@unique(map: "waste_movements_movimento_rettificato_id_key")` su
  `movimentoRettificatoId`; `@@unique([id, registroId, tenantId, type], map: "waste_movements_id_registro_tenant_type_key")`.
  Per la radice: chiave esterna semplice composta
  `(movimento_originale_id, registro_id, tenant_id, type)` verso lo stesso unico,
  `NoAction`, `map: "waste_movements_originale_fkey"`, con il suo inverso (nome a
  scelta), più un indice. **Stessi nomi nella migration** (i nomi di default
  supererebbero 63 caratteri). `NoAction` (controllo a fine statement) e non
  `Restrict`: la cancellazione a cascata di un'azienda o la pulizia dei test
  cancellano intere catene in uno statement. MATCH SIMPLE: righe con le colonne
  NULL non controllate. CHECK:
  - `ORDINARIA` ⇔ `movimento_rettificato_id`, `movimento_originale_id` e
    `motivo_annotazione` tutti NULL;
  - altrimenti tutti NOT NULL e `btrim(motivo_annotazione) <> ''`;
  - `movimento_rettificato_id <> id`.
- **R2. Vigenza.** Vigente = `tipo_annotazione <> 'ANNULLAMENTO'` e nessuna riga la
  indica in `movimento_rettificato_id`. Rettifica = la nuova sostituisce la
  precedente; annullamento = l'intera catena esce dai conteggi; si corregge solo
  la testa vigente, altrimenti 409. Definizione unica in
  `domain/waste-movement/vigenza.ts`:
  - `WHERE_VIGENTE` (Prisma): `{ tipoAnnotazione: { not: 'ANNULLAMENTO' }, correzioni: { none: {} } }`
    (vale anche nei `groupBy`);
  - `sqlVigente(alias)` (raw): `alias.tipo_annotazione <> 'ANNULLAMENTO' AND NOT EXISTS
    (SELECT 1 FROM waste_movements c WHERE c.movimento_rettificato_id = alias.id)`,
    con `Prisma.raw`/`Prisma.sql` su un alias costante, mai input utente.
- **R3. Chi conta cosa.**
  - **solo vigenti**: `giacenzaDisponibileAl` (CTE `righe` **e** sottoquery
    `unita_non_massa`), le tre letture di `GiacenzeService`, le quattro di
    `MudAggregazioneService` (anno, anni precedenti, `scarichiDeiFirAnno`,
    `saldiAl31Dicembre`), `giacenzeImpossibili`, l'avviso G8 di
    `GiacenzeInizialiService`;
  - **tutte le righe**: numerazione (`MAX`), progressivo iniziale (`haMovimenti`),
    "registro vuoto" della sede, `controllaNonUsata` ed `elenca`/`modificabile`
    delle giacenze iniziali (una correzione SCARICO registrata dopo l'apertura la
    rende usata: prudente), elenco del registro (con lo stato, R9);
  - **solo `ORDINARIA`**: `ricopiaEsistente` e il messaggio del doppio della
    ricopia del FIR (le correzioni copiano `firId` e hanno `ricopiaChiave ''`: non
    devono essere scambiate per la ricopia; il messaggio cita l'originale, e se non
    è vigente lo dice: "registrato come N/AAAA, poi rettificato/annullato").
  - Guardia statica `src/application/registro/lettori-movimenti.spec.ts` (modello
    `src/infrastructure/persistence/punti-di-sistema.spec.ts`): elenco dei file
    non spec autorizzati a leggere `waste_movements` (`wasteMovement.` o SQL) con
    la scelta "vigenti"/"tutte"/"ordinarie"; fallisce su un file nuovo non in
    elenco e se un file "vigenti" non importa `vigenza`. Deve fallire su un
    sorgente finto.
- **R4. Rettifica.** Nuova annotazione `RETTIFICA` nello stesso registro, numero
  dell'anno corrente (`annoSolareItaliano(now)`) con la stessa numerazione della
  registrazione ordinaria (progressivo iniziale compreso). Dati completi nuovi:
  data movimento, causale (coerente col tipo), CER, descrizione, quantità, unità,
  stato fisico, HP, operazione, controparte, indirizzo, note. **Tipo e registro
  immutabili** (dall'originale), `firId` copiato, `firIdRicopia` NULL,
  `ricopiaChiave` '', `motivo_annotazione` obbligatorio (1..500 dopo trim),
  `recordedByUserId` = chi rettifica, `registrationDate` = ora. Validazioni:
  quelle della registrazione ordinaria, estratte da `execute` in una funzione
  condivisa `validaDatiMovimento(...)` (causale per tipo, CER normalizzato e a
  catalogo, date non future) usata da entrambe, più `WasteMovement.create`.
  Nessuna validazione nuova inventata (niente controllo HP: oggi non esiste).
- **R5. Annullamento.** Nuova annotazione `ANNULLAMENTO` con numero proprio come
  R4 che copia **alla lettera** dalla testa vigente tipo, causale, CER, quantità,
  unità, date, descrizione, stato fisico, HP, operazione, controparte, `firId`:
  nessuna normalizzazione, nessun catalogo, nessun controllo di data (devono
  potersi annullare anche righe storiche con CER non normalizzato o fuori
  catalogo). `motivo_annotazione` obbligatorio. Non conta mai (R2).
- **R6. Controllo di giacenza della correzione**, coerente con lo scarico
  ordinario. Per ogni CER toccato (originale e, se `cerSoloCifre` cambia, il
  nuovo), famiglia di massa, su vigenti + giacenze iniziali, con lo **stesso
  frammento SQL** di `giacenzaDisponibileAl` (CTE condivisa, non una copia):
  - `saldoComplessivoKg` e `saldoMinimoGiornalieroKg` calcolati PRIMA e DOPO
    l'insert della correzione, nella stessa transazione (helper esportato in
    `giacenza-disponibile.ts`);
  - **blocco** (409, rollback) se `complessivo_dopo < -0,0005` e
    `complessivo_dopo < complessivo_prima - 0,0005`, **salvo** che il CER abbia,
    dopo la correzione, carichi vigenti o aperture in unità non di massa: allora
    avviso (stessa logica e stesso testo dello scarico);
  - **avviso** (non blocco) se `minimo_dopo < -0,0005` e
    `minimo_dopo < minimo_prima - 0,0005` (ordine delle date incoerente).
  Annullare un carico già interamente scaricato è quindi bloccato (la
  "cancellazione di carichi già scaricati" di WinWaste); spostarne la data dopo lo
  scarico dà un avviso. Limite dichiarato: con uno storico già negativo il
  confronto sul minimo globale può lasciar passare senza avviso un peggioramento
  in un altro giorno.
- **R7. Lock.** Ordine fisso: progressivo `<registroId>-<annoCorrente>` → giacenza
  `chiaveLockGiacenza(registroId, cer)` per i CER toccati, in ordine lessicografico
  della chiave. Sotto lock: rilettura dell'originale (`id` + `tenantId`) → 404;
  vigenza → 409. P2002: sul vincolo `waste_movements_movimento_rettificato_id_key`
  → 409 "già corretta"; sul progressivo → errore interno (non deve accadere sotto
  lock).
- **R8. Hash v2 concatenato.** Ogni nuova annotazione (anche ordinaria) ha
  `hash_versione = 2` e `entryHash = SHA-256("v2|" + hashPrecedente + "|" + registroId
  + "|" + anno + "|" + numero + "|" + tipoAnnotazione + "|" + (movimentoRettificatoId ?? "")
  + "|" + type + "|" + cerCode + "|" + new Prisma.Decimal(quantita).toFixed(2) + "|" + unit
  + "|" + movementDate.toISOString() + "|" + causale)`. La funzione pura
  `hashAnnotazioneV2` accetta `number | string | Prisma.Decimal`.
  `hashPrecedente` = `entry_hash` salvato (anche `''`) dell'annotazione col
  progressivo più alto dello stesso registro e anno, letto sotto il lock del
  progressivo nella stessa query del `MAX`; `''` se è la prima dell'anno. Le righe
  esistenti restano v1. `VerificaCatenaRegistroService.verifica(tenantId,
  registroId, anno)` scorre per progressivo e restituisce
  `{ verificate, nonVerificabili, primoErrore: { numero, motivo } | null }`:
  - v1 ricalcolata con `Number(decimal).toString()` (formato di oggi);
  - riga con `entry_hash = ''` → `nonVerificabili` (motivo `HASH_ASSENTE`, non è
    un'alterazione e non interrompe la catena);
  - `HASH_DIVERSO` se il ricalcolo non coincide; `VERSIONE_SCONOSCIUTA`;
  - `BUCO` se manca un progressivo fra il primo (o il progressivo iniziale) e
    l'ultimo.
- **R9. Elenco.** `list-movimenti` restituisce per riga `tipoAnnotazione`,
  `motivoAnnotazione`, il numero (`anno/numero`) del predecessore e
  dell'annotazione che la corregge, e `stato: 'VIGENTE' | 'RETTIFICATO' | 'ANNULLATO'`
  (ANNULLATO = la testa della catena è un ANNULLAMENTO, compresa la riga di
  annullamento). In due passi: (1) la pagina con Prisma includendo predecessore e
  correzioni (numero e tipo); (2) **una** `$queryRaw` `WITH RECURSIVE` che, per gli
  id della pagina, scende fino alla testa della catena e ne restituisce il tipo.
  Nessun N+1. Filtri esistenti invariati. L'elenco non ha `fuoriTermine` e non lo
  acquista. La risposta del caso d'uso di correzione ha `fuoriTermine=false`,
  `ritardoGg=0`.
- **R10. MUD già presentato.** Anni coinvolti = ogni anno ≥ min(anno italiano
  della data movimento della testa corretta, anno della data nuova) per cui esiste
  `MUDReport` `SUBMITTED` o `ARCHIVED` (la correzione cambia anche i saldi al 31/12
  degli anni successivi). Se ce n'è almeno uno e manca `confermaAnnoPresentato:
  true` → 409 `error: 'REGISTRO_ANNO_MUD_PRESENTATO'`, messaggio con gli anni:
  "Il MUD {anni} risulta già presentato: la correzione cambia i dati di quegli anni
  ma non il file già presentato. Conferma per procedere."; con la conferma si
  registra e la risposta porta l'avviso. Il file presentato non si tocca. Una
  corsa con la presentazione (lock `mud-report|tenant|anno` non preso) è
  accettata e dichiarata in un commento. RENTRI: nessuno stato qui (F2-9).
- **R11. Ruoli e tenant.** Correzioni: `SUPER_ADMIN`, `ADMIN`, `OPERATOR` nel ruolo
  effettivo dell'azienda selezionata (`RUOLI_REGISTRAZIONE` + `haRuolo`); verifica
  della catena: `RUOLI_PROGRESSIVO_INIZIALE`. Tenant da `requireRequestTenantId`.
  Mai id di tenant nei messaggi.
- **R12. Audit.** `activityLog.create` nella stessa transazione
  (`REGISTRO_MOVIMENTO_RETTIFICATO|ANNULLATO`, metadata: id e numero di
  predecessore, radice e correzione, registroId, motivo).
- **R13.** Nessun UPDATE né DELETE su `waste_movements` nel codice non di test.
- **R14. Errori del caso d'uso.** Il caso d'uso di correzione lancia eccezioni Nest
  (`NotFoundException`, `ConflictException` con `error` dove serve,
  `BadRequestException`) come `GiacenzeInizialiService`, non `Result.fail`.

## Vincoli globali

- Commit `git commit -m … -- <file>`; niente attribuzioni AI nei messaggi.
- Commenti in italiano, termini tecnici non tradotti. Mai id di tenant, chiavi o
  credenziali nei messaggi d'errore restituiti all'utente.
- Test su Postgres reale col ruolo `wasteflow_app` (`*.postgres.spec.ts`,
  `npx jest -c jest.postgres.config.js --runInBand`, Postgres di test
  `127.0.0.1:55432`, `DOCKER_HOST=tcp://localhost:2375`), modello
  `src/application/registro/registro-per-sede.postgres.spec.ts`
  (`creaPrismaServiceApplicativo()`, `TenantContext.run`).
- Prima di dichiarare finito: suite unitaria COMPLETA
  (`cd apps/backend && NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov`),
  `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, suite Postgres toccate e
  quelle di `registro/`, `giacenze`, `mud`; frontend: Karma in locale
  (`npx ng test --watch=false --browsers=ChromeHeadless`), `npm run build`,
  `npx eslint "apps/frontend/src/**/*.ts"` dalla root. Servizi nuovi iniettati →
  risoluzione in `api/registro/registro.module.spec.ts`.
- Prisma: `prisma validate` e `migrate diff` (migrations contro schema, shadow
  temporaneo) senza differenze nuove. `rls-catalogo.postgres.spec.ts` invariato.

## Task 1a: modello e vigenza

**File:** `prisma/schema.prisma`,
`prisma/migrations/20261029100000_rettifica_annullamento/migration.sql`,
`src/domain/waste-movement/vigenza.ts` (+ spec, postgres spec), `ops/README.md`
(rollback: dopo un rollback le correzioni conterebbero come movimenti ordinari;
prima del rollback controllare `tipo_annotazione <> 'ORDINARIA'`).

1. Schema e migration R1, additiva: enum, colonne con default, unico
   `(id, registro_id, tenant_id, type)` (indice normale: tabella piccola in
   produzione, scriverlo nel commento), le due chiavi esterne, unico su
   `movimento_rettificato_id`, indice su `movimento_originale_id`, CHECK. Commento
   iniziale con cosa fa e ripristino. `prisma validate` e `migrate diff` puliti.
2. `vigenza.ts` (R2). Test Postgres col ruolo applicativo su catene costruite con
   insert diretti del proprietario (ordinaria → rettifica → rettifica; ordinaria →
   annullamento; rettifica → annullamento): `WHERE_VIGENTE` (anche in un
   `groupBy`) e `sqlVigente` danno le stesse teste.
3. Test dei vincoli: correzione in altro registro / altro tipo / altra azienda
   respinta; seconda correzione dello stesso predecessore respinta; CHECK (motivo
   vuoto, ordinaria con riferimento); cancellazione in blocco di una catena (DELETE
   di tutte le righe dell'azienda di test in uno statement) riesce.

## Task 1b: hash v2 e verifica della catena

**Dipende da 1a.** **File:** `waste-movement.entity.ts` (+ spec),
`registra-movimento.use-case.ts` (+ spec, postgres spec),
`src/application/registro/verifica-catena-registro.service.ts` (nuovo, + spec,
postgres spec), `api/registro/registro.module.ts` (+ module spec).

1. `hashAnnotazioneV2` (R8) nel dominio; la v1 resta per la verifica.
2. La registrazione ordinaria legge `hashPrecedente` nella query del `MAX` sotto
   il lock e salva v2.
3. `VerificaCatenaRegistroService` (R8), registrato nel modulo.
4. Test: due registri con lo stesso numero → hash diversi; catena di tre
   registrazioni verificata; UPDATE fatto a mano dal proprietario nel test →
   `HASH_DIVERSO` col numero giusto; righe v1 verificate con la v1; riga con hash
   `''` → `nonVerificabili`; buco → `BUCO`; stabilità di `toFixed(2)` e ISO dopo
   la rilettura (anche quantità con decimali e data con millisecondi).

## Task 2a: i lettori contano solo le vigenti

**Dipende da 1b.** **File:** `giacenza-disponibile.ts` (+ spec, postgres spec),
`giacenze/giacenze.service.ts` (+ spec, postgres spec),
`mud-aggregazione.service.ts` (+ spec), `anomaly-detection.service.ts` (+ spec),
`giacenze-iniziali.service.ts` (solo G8), `registra-movimento.use-case.ts` (solo
`ricopiaEsistente` e messaggio del doppio: solo `ORDINARIA`),
`lettori-movimenti.spec.ts` (nuovo).

1. R3 in ogni lettore.
2. Guardia statica R3.
3. Test Postgres: un carico annullato non copre più uno scarico; un carico
   rettificato da 100 a 40 copre 40; MUD: un movimento rettificato conta coi dati
   nuovi, uno annullato non conta, un doppio FIR annullato non produce più il
   controllo del doppio; anomalie e giacenze ignorano le catene annullate; un
   retry di ricopia di un FIR il cui movimento è stato rettificato non restituisce
   la rettifica né l'annullamento come "già registrato".

## Task 2b: saldi della correzione ed elenco

**Dipende da 2a.** **File:** `giacenza-disponibile.ts` (+ postgres spec),
`queries/list-movimenti.handler.ts` (+ spec, postgres spec) e il tipo della sua
risposta.

1. Helper R6 (`saldoComplessivoKg`, `saldoMinimoGiornalieroKg`, unità non di
   massa presenti) sul frammento SQL condiviso con `giacenzaDisponibileAl`.
   Test: vigenti + aperture, catena annullata esclusa, storico negativo.
2. Elenco R9 con test Postgres (stato di ogni riga di catene a 2 e 3 anelli,
   numeri di predecessore e correttore, un'unica query ricorsiva, filtri
   esistenti invariati).

## Task 3: casi d'uso di rettifica e annullamento

**Dipende da 2b.** **File:**
`src/application/registro/use-cases/correggi-movimento.use-case.ts` (nuovo; due
operazioni `rettifica` e `annulla` con helper comuni, niente blocchi copiati) +
spec + postgres spec; `registro/numerazione-annotazione.ts` (nuovo: numerazione +
`hashPrecedente` + insert estratti dalla registrazione ordinaria e usati da
entrambi, senza cambiarne il comportamento); estrazione di
`validaDatiMovimento` (R4) da `registra-movimento.use-case.ts`.

1. Sequenza in una transazione: lettura dell'originale per `id` + `tenantId` → 404;
   lock (R7); rilettura + vigenza → 409; R10 → 409 senza conferma; saldi PRIMA
   (R6); numerazione + hash v2; insert (con `movimento_originale_id` =
   `originale.movimentoOriginaleId ?? originale.id`); saldi DOPO → 409 con
   rollback o avvisi; audit (R12). Risultato `{ movimento, avvisi }`. R14.
2. Test Postgres col ruolo applicativo: rettifica e annullamento di CARICO e
   SCARICO; carico interamente scaricato non annullabile; rettifica che lo riduce
   sotto lo scaricato respinta, entro lo scaricato accettata; data spostata dopo
   lo scarico → avviso; rettifica kg → unità non di massa con carichi in litri →
   avviso; correzione di una non vigente → 409; due annullamenti concorrenti →
   uno solo riesce; CER cambiato controlla entrambi; annullamento di una riga
   storica con CER non normalizzato riesce; MUD `SUBMITTED` dell'anno dopo → 409
   con l'anno nel messaggio, con conferma registrato con avviso; numerazione:
   progressivo successivo dell'anno corrente anche se l'originale è dell'anno
   prima; catena hash verificata; isolamento fra aziende (id di un'altra → 404);
   `movimento_originale_id` = radice anche al secondo anello.

## Task 4: API

**Dipende da 3.** **File:** `api/registro/registro.controller.ts`,
`api/registro/dtos/correggi-movimento.dto.ts` (nuovo, + spec),
`registro.controller.spec.ts`, `registro.controller.http.spec.ts`.

1. Rotte:
   - `POST registro/movimenti/:id/rettifica` → 201 `{ movimento, avvisi }`; corpo
     `OmitType(RegistraMovimentoDto, ['type','registroId','firId','registrationDate'])`
     (verificare i nomi reali dei campi) + `motivo` (stringa, 1..500 dopo trim) +
     `confermaAnnoPresentato?: boolean`; campi esclusi → 400 per
     `forbidNonWhitelisted` (già attivo in `main.ts`).
   - `POST registro/movimenti/:id/annullamento` → 201 `{ movimento, avvisi }`;
     corpo `{ motivo, confermaAnnoPresentato? }`.
   - `GET registro/verifica-catena?registroId=&anno=` → 200
     `{ registroId, anno, verificate, nonVerificabili, primoErrore }`; `anno`
     intero 2000..anno corrente+1; `registroId` facoltativo risolto con
     `registri.risolvi` (404 se non dell'azienda); letture nel contesto del tenant.
   - L'elenco espone i campi R9 (Swagger).
   `:id` con `ParseUUIDPipe`; ruoli R11 prima del servizio; le eccezioni del
   caso d'uso passano invariate.
2. Test DTO con la pipe vera e test HTTP (ruoli effettivi, 404/409, `type` nel
   corpo → 400, conferma, verifica catena per VIEWER → 403).

## Task 5: frontend

**Dipende da 4.** **File:** `apps/frontend/src/app/features/registro/`:
`registro.service.ts` (+ spec), `correggi-movimento-dialog.component.ts` (nuovo,
standalone, + spec e dom spec), `registro.component.ts`;
`core/services/export.service.ts` (+ spec).

1. Elenco: badge "Rettificato da N/AAAA", "Annullato", "Rettifica di N/AAAA",
   "Annullamento di N/AAAA" con il motivo in tooltip; righe non vigenti attenuate.
2. Azioni "Rettifica" e "Annulla" solo sulle righe `VIGENTE` e solo se
   `puoRegistrare` (come "Nuovo movimento"); il backend resta l'arbitro.
3. Dialog di rettifica precompilato coi dati vigenti, tipo e registro non
   modificabili, motivo obbligatorio; riusare le parti del form del movimento
   (opzioni causali per tipo, CER, unità come i FIR) estraendole se serve, senza
   duplicarle; date come stringhe del giorno senza spostamenti di fuso. Dialog di
   annullamento con riepilogo e motivo. Su 409 `REGISTRO_ANNO_MUD_PRESENTATO`:
   conferma esplicita col testo del backend e reinvio con
   `confermaAnnoPresentato: true`. Altri errori nel toast come il resto del
   registro; avvisi mostrati; dopo il successo si ricarica l'elenco.
4. "Verifica catena" solo se `statoProgressivo().puoImpostare`, per l'anno
   corrente del registro selezionato, con esito leggibile.
5. Export PDF/Excel del registro: colonne "Annotazione" (Ordinaria / Rettifica di
   N/AAAA / Annullamento di N/AAAA) e "Stato" (Vigente / Rettificato / Annullato).
6. Test di componente con almeno un test DOM a click reali (azione → dialog →
   invio, conferma MUD), test del servizio (URL, corpi) e dell'export.

## Fuori ambito (seguiti)

- Trasmissione di rettifiche e annullamenti a RENTRI (F2-9), compresa la scelta
  fra radice e predecessore nel riferimento.
- Trigger nel database che impedisca UPDATE/DELETE su `waste_movements` e
  ricalcolo degli hash v1 / vuoti.
- Ricollegare un FIR a un nuovo movimento dopo l'annullamento della ricopia.
- Stampa ufficiale del registro con le correzioni.
