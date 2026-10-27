# Fase 2 pezzo 2: giacenze iniziali — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa,
> opus rivede. Ordine STRETTAMENTE sequenziale: Task 1, Task 2, Task 3, Task 4
> (un solo worktree: verifiche globali, commit e database di test condivisi).
> Piano rivisto da opus il 2026-10-27 (rilievi I1-I8, M1-M9 recepiti).

**Obiettivo.** Un concetto proprio di giacenza di apertura del registro (per
registro, CER, stato fisico, unità e data) che entra in ogni saldo (blocco dello
scarico, pagina giacenze, MUD al 31/12, anomalie) senza essere un movimento: non
consuma progressivi, non è "prodotto" né "ricevuto" nel MUD. Chi arriva da
WinWaste o da carta non deve più registrare un `ALTRO_CARICO` fittizio.

**Fonti.** Roadmap `C:\Progetti\winwaste\docs\roadmap-fase2-parita-registro.md`
§F2-2 e §3 (RLS delle tabelle nuove); decisione 2026-10-24 "tabella propria, con
anno e protocollo d'origine quando noti"; `giacenze.md` §2.5 (le
`RenRelazioniIniziali` di RENTRI legano uno scarico ai carichi, anno e
protocollo, che compongono una giacenza iniziale: è il motivo del campo
`origini`).

**Stato di partenza (master `0b20475`).**
- Nessun modello. Il saldo parte da zero in `application/registro/giacenza-disponibile.ts`
  (query SQL per giorno italiano, solo kg/t/vuota, CER sulle sole cifre).
- Altri quattro calcoli di saldo leggono solo `waste_movements`:
  `application/giacenze/giacenze.service.ts` `getGiacenze` (pagina giacenze e
  deposito temporaneo), `application/mud/aggregazione/mud-aggregazione.service.ts`
  `saldiAl31Dicembre` (controllo `GIACENZE_NON_CALCOLATE`),
  `application/anomaly/anomaly-detection.service.ts` `giacenzeImpossibili`
  (`NEGATIVE_STOCK`), e la condizione "registro vuoto" di
  `infrastructure/rentri/rentri-unita-locale.service.ts` `remove` (D8 di F2-1).
  Nessun altro saldo nel backend o nel frontend (verificato dalla revisione).
- Il messaggio di giacenza insufficiente consiglia `ALTRO_CARICO`
  (`RIMEDIO_CARICO_MANCANTE` in `registra-movimento.use-case.ts`).
- Modello di riferimento per tutto il pezzo: il progressivo iniziale
  (`progressivo-iniziale.service.ts`, rotte `progressivo-iniziale/:anno` di
  `api/registro/registro.controller.ts`, dialog in `registro.component.ts`).

## Decisioni (dell'orchestratore, vincolanti)

- **G1. Tabella `giacenze_iniziali`**, modello Prisma `GiacenzaIniziale`:
  `id`, `tenant_id` NOT NULL, `registro_id` NOT NULL con chiave esterna composta
  `(registro_id, tenant_id) → registri_rifiuti(id, tenant_id)` `ON DELETE RESTRICT`,
  `cer_code VARCHAR(10)` (forma canonica "NN NN NN", nella forma del catalogo
  `CERCode`: con l'asterisco se il catalogo lo ha, qualunque cosa abbia digitato
  l'utente), `stato_fisico VARCHAR(50) NULL` (stesso dominio di
  `waste_physical_state`, normalizzato: trim, maiuscole, vuoto → NULL),
  `quantita DECIMAL(10,2)` > 0, `unita VARCHAR(10)` (salvata come
  `normalizzaUnitaRegistro(...).unita`: `KG`, `T` o l'unità maiuscola),
  `data_riferimento DATE` (giorno italiano dal quale la quantità è in deposito),
  `origini JSONB NOT NULL DEFAULT '[]'`, `provenienza` enum
  `GiacenzaInizialeProvenienza { MANUALE, IMPORTAZIONE }` default `MANUALE`
  (le API scrivono sempre `MANUALE`; `IMPORTAZIONE` è per la Fase 3), `note
  VARCHAR(500) NULL`, `impostato_da UUID`, `created_at`, `updated_at`.
  `@@unique([id, tenantId])`, `@@index([tenantId])`, `@@index([registroId])`.
- **G2. `origini`**: array di `{ anno: int, protocollo: int, quantita?: number }`
  (anno 1990..anno corrente, protocollo ≥ 1, quantità > 0 con al più 2 decimali
  nella stessa unità della giacenza, al più 200 voci, coppie `(anno, protocollo)`
  distinte; se tutte le voci hanno `quantita`, la somma non supera la quantità
  della giacenza). Validato nel servizio (non solo nel DTO). JSONB e non tabella
  figlia: lo legge solo F2-9, mai in query.
- **G3. Una sola apertura per (registro, CER, stato fisico, famiglia di unità)**.
  CER confrontato sulle sole cifre (con o senza `*` è lo stesso rifiuto);
  famiglia = `MASSA` per kg e t, altrimenti l'unità. Controllo nel servizio sotto
  il lock G5 (solo lui vede kg contro t). Rete nel database: nello schema
  `@@unique([registroId, cerCode, statoFisico, unita], map: "giacenze_iniziali_registro_cer_stato_unita_key")`
  e nella migration lo stesso indice, con lo stesso nome, più la clausola
  `NULLS NOT DISTINCT` (Prisma non la confronta, quindi `migrate diff` resta
  pulito; commento sul modello che lo spiega). Violazione → 409.
- **G4. Modificabile e cancellabile solo finché non è usata**: "usata" = esiste
  nello stesso registro almeno uno SCARICO dello stesso CER (sole cifre), di
  qualunque data e unità, con `waste_movements.created_at` ≥
  `giacenze_iniziali.created_at`. Gli scarichi registrati prima dell'apertura
  sono stati accettati senza di lei: cambiarla non li invalida, e una migrazione
  con scarichi già presenti resta correggibile. Se usata → 409 con messaggio che
  rimanda alla rettifica (F2-3, non ancora disponibile: "contatta
  l'assistenza"). Il CER di un'apertura non si modifica (si cancella e si
  ricrea).
- **G5. Concorrenza**: creazione, modifica e cancellazione prendono, dentro la
  transazione, lo stesso advisory lock dello scarico:
  `pg_advisory_xact_lock(hashtext(chiaveLockGiacenza(registroId, cer)))`, chiave
  `giacenza|<registroId>|<CER canonico senza *>`, identica a quella di
  `verificaGiacenza` in `registra-movimento.use-case.ts`. Così uno scarico
  concorrente o vede l'apertura o la aspetta.
- **G6. Data**: `data_riferimento` ≤ oggi (giorno italiano), confronto fra
  stringhe `YYYY-MM-DD` con `giornoItaliano(new Date())`. Nessun altro vincolo:
  carichi precedenti alla data sono leciti. Le risposte API serializzano la
  data come `YYYY-MM-DD`, mai come ISO a mezzanotte UTC.
- **G7. Nel saldo l'apertura conta come un carico del giorno `data_riferimento`**,
  con le stesse regole di unità dei movimenti (kg/t/vuota in kg; altre unità a
  parte). Vale in tutti e cinque i punti dello stato di partenza. Nel MUD non
  entra in nessuna riga di prodotto/ricevuto (non è un movimento: nessun cambio
  in `classificaMovimento`), solo nei saldi al 31/12 con `data_riferimento` ≤ 31/12
  dell'anno.
- **G8. Doppio conteggio con `ALTRO_CARICO`**: nessuna conversione. Alla
  creazione, se nello stesso registro esiste un CARICO con causale
  `ALTRO_CARICO` dello stesso CER (sole cifre), la risposta porta un avviso non
  bloccante: "Nel registro ci sono carichi «Altro carico» dello stesso CER: se
  servivano a registrare la stessa giacenza di apertura, la quantità è contata due
  volte." (con numero/anno dei primi 5 movimenti). Solo alla creazione: l'avviso
  speculare su un `ALTRO_CARICO` registrato dopo è un seguito.
- **G9. Ruoli**: lettura per chiunque legga il registro (stessa protezione della
  `GET` del progressivo iniziale); scrittura solo `SUPER_ADMIN`/`ADMIN` nel
  **ruolo effettivo dell'azienda selezionata** (`RUOLI_PROGRESSIVO_INIZIALE` e
  `haRuolo` del controller, 403 con `error: 'REGISTRO_GIACENZA_INIZIALE_RISERVATA_AMMINISTRATORI'`).
  Tenant sempre da `requireRequestTenantId(req)`.
- **G10. Audit**: ogni scrittura fa un `activityLog.create` nella stessa
  transazione (`REGISTRO_GIACENZA_INIZIALE_CREATA|MODIFICATA|ELIMINATA`, metadata
  con id, registroId, CER, quantità, unità, data; mai dati di altre aziende).
- **G11. Registro**: come il progressivo iniziale, `registroId` facoltativo in
  query; senza, il registro predefinito (`RegistriService.risolvi`, preceduto da
  `preparaRegistri` fuori dalla transazione per le scritture). Errori di dominio
  dei registri → 400/404 come nel progressivo iniziale.
- **G12. Sequenze.** Creazione: validazioni (CER sul catalogo, unità, stato
  fisico, origini, data) → `preparaRegistri` fuori → in transazione `risolvi` →
  lock G5 → G3 → insert → avviso G8 → audit. Modifica ed eliminazione:
  (1) `findFirst({ id, tenantId })` → 404; (2) lock G5; (3) rilettura della riga
  → 404 se sparita; (4) controllo G4 → 409; (5) in modifica, di nuovo G2, G3 e G6
  sui valori nuovi (unità e stato fisico possono cambiare famiglia o collidere);
  (6) scrittura e audit. Gli scarichi in unità non di massa non prendono il lock
  (`verificaGiacenza` ritorna prima): corsa innocua perché non si controllano;
  scriverlo in un commento.

## Vincoli globali

- Commit `git commit -m … -- <file>`; niente attribuzioni AI nei messaggi.
- Commenti in italiano, termini tecnici non tradotti. Mai id di tenant, chiavi o
  dati di credenziali nei messaggi d'errore restituiti all'utente.
- Test su Postgres reale col ruolo `wasteflow_app` (`*.postgres.spec.ts`,
  `npx jest -c jest.postgres.config.js`, Postgres di test `127.0.0.1:55432`):
  da superuser la RLS non si vede. Modello da seguire:
  `src/application/registro/registro-per-sede.postgres.spec.ts`
  (`creaPrismaServiceApplicativo()`, `TenantContext.run`, `DB_APP_PASSWORD`; la
  sezione D8 per la cancellazione della sede), NON
  `progressivo-iniziale.service.postgres.spec.ts`, che gira da superuser.
- Prima di dichiarare finito: suite unitaria COMPLETA come in CI
  (`cd apps/backend && NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov`),
  `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, le suite Postgres
  toccate; per il frontend i test (script della CI) e `npx ng build` se il Task
  tocca il frontend. Un servizio nuovo iniettato in un controller o in un
  servizio esistente rompe la DI dei moduli che lo usano: un test di modulo
  (`Test.createTestingModule` sul modulo reale, modello
  `api/registro/registro.module.spec.ts`) deve risolverlo.

## Task 1: modello, migration, RLS e servizio

**File:** `apps/backend/prisma/schema.prisma`,
`apps/backend/prisma/migrations/20261028100000_giacenze_iniziali/migration.sql`,
`src/infrastructure/persistence/prisma-rls.extension.ts` (`TENANT_SCOPED_MODELS`),
`src/infrastructure/persistence/rls-catalogo.postgres.spec.ts` (il conteggio
`toBe(30)` diventa 31) e il "(30)" in `README-tenant-transazione.md`,
`src/application/registro/giacenze-iniziali.service.ts` (nuovo, + `.spec.ts` e
`.postgres.spec.ts`), `src/application/registro/chiave-lock-giacenza.ts` (nuovo),
`registra-movimento.use-case.ts` (solo per `chiaveLockGiacenza` e l'estrazione
del punto 3), `src/api/registro/registro.module.ts` (registrazione del servizio)
e `registro.module.spec.ts` (risoluzione del servizio), `ops/README.md` (nota di
rollback gemella di quella del progressivo iniziale: dopo un rollback le
aperture sono ignorate e gli scarichi che contavano su di loro tornano
bloccati; prima del rollback controllare `giacenze_iniziali`).

1. Schema G1 e G3 con relazioni inverse su `Tenant` e `RegistroRifiuti`.
2. Migration additiva (forma di `20261027100000_registro_per_sede`): tabella,
   enum, chiavi esterne (tenant `CASCADE`, registro composta `RESTRICT`),
   indici, indice unico G3 con `NULLS NOT DISTINCT`, `CHECK (quantita > 0)`, poi
   in fondo `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `isolamento_azienda` e
   `sola_lettura ... TO wasteflow_lettura`. Nessun GRANT (default privileges di
   `ops/db-ruoli.sh`). Commento iniziale con cosa fa e il ripristino a mano.
   `prisma validate` e `prisma migrate diff` (migration contro schema) senza
   differenze residue.
3. `chiaveLockGiacenza(registroId, cer)` (G5): accetta un CER qualunque e
   calcola `cerCanonico(cer.toUpperCase()).replace(/\*$/, '')`; uso in
   `verificaGiacenza` senza cambiare la chiave risultante (test che la confronta
   con la forma attuale). Autorizzata l'estrazione di `normalizeCerCode` e
   `cerCodeExists` da `registra-movimento.use-case.ts` in una funzione condivisa
   (che restituisca anche la forma del catalogo, con l'asterisco), per non
   duplicarle nel servizio.
4. `GiacenzeInizialiService` (usa il `PrismaService` corrente del registro e
   `RegistriService`):
   - `elenca(tenantId, registroId?)` → righe del registro (ordinate per CER, stato
     fisico, unità) con `modificabile: boolean` (G4, una sola query per il
     registro, non una per riga) e `registroId`; senza registro determinabile,
     elenco vuoto con `registroId: null` (come `leggi` del progressivo iniziale:
     niente `preparaRegistri` in lettura);
   - `crea(tenantId, userId, dati, registroId?)` → `{ giacenza, avvisi }` con la
     sequenza G12;
   - `modifica(tenantId, userId, id, dati)` (tutti i campi tranne CER e registro)
     e `elimina(tenantId, userId, id)` con la sequenza G12.
   Errori come eccezioni Nest con messaggi in italiano per l'utente.
5. Test unitari sui rami di validazione; test Postgres col ruolo
   `wasteflow_app`: crea/modifica/elimina; unicità G3 (stesso CER con e senza
   `*`, kg contro t = conflitto, kg contro litri = ammesso, stato fisico NULL
   duplicato = conflitto anche nel database con un insert diretto); 409 dopo uno
   scarico dello stesso CER registrato dopo l'apertura, ma modificabile se lo
   scarico era precedente; isolamento fra due aziende (l'altra non vede né
   modifica); cancellazione del registro respinta dalla chiave esterna con
   un'apertura; avviso G8.

## Task 2: l'apertura entra nei saldi

**Dipende dal Task 1.** **File:** `src/application/registro/aperture-registro.ts`
(nuovo, + spec), `src/application/registro/giacenza-disponibile.ts` (+ spec),
`src/application/giacenze/giacenze.service.ts` (+ spec),
`src/application/mud/aggregazione/mud-aggregazione.service.ts` (+ spec),
`src/application/anomaly/anomaly-detection.service.ts` (+ spec),
`src/infrastructure/rentri/rentri-unita-locale.service.ts` (+ spec),
`registra-movimento.use-case.ts` (solo `RIMEDIO_CARICO_MANCANTE`, e il test che
lo cita).

1. `leggiApertureRegistro(client, tenantId, { registroId?, finoAl? })`: funzione
   pura esportata in `aperture-registro.ts`, senza injection, con `tenantId`
   esplicito nel `where` oltre alla RLS (`finoAl` stringa `YYYY-MM-DD`). La usano
   i punti 3-5, non tre query copiate. Nessun modulo Nest cambia import.
2. `giacenzaDisponibileAl`: le aperture del registro e del CER (sole cifre, unità
   di massa) entrano nella CTE `mov` come delta positivo (UNION ALL) con
   `data_riferimento AS g` SENZA conversioni di fuso: è già il giorno italiano
   (`AT TIME ZONE` su una DATE passa da un timestamp col fuso della sessione e
   può spostare il giorno). Le aperture in unità non di massa entrano in
   `unita_non_massa`. Test Postgres: scarico bloccato senza apertura e accettato
   con; apertura datata dopo lo scarico → lo scarico alla data precedente dà
   l'avviso di ordine delle date, non il blocco (stesso comportamento di un
   carico successivo); apertura di un altro registro non conta.
3. `GiacenzeService.getGiacenze`: aperture (per registro se indicato, altrimenti
   tutte) sommate al carico per CER e unità; nuovo campo `inizialeKg` in
   `GiacenzaCer` (parte di `caricoKg` che viene da aperture) e, per le altre
   unità, `iniziale` in `GiacenzaAltraUnita`; `oldestCaricoDate` = la più vecchia
   fra carichi e `data_riferimento` (il calcolo esatto del deposito è F2-6). Un
   CER con sola apertura e nessun movimento deve comparire (oggi le mappe nascono
   dai soli `groupBy` dei movimenti): test "CER con sola apertura compare con
   `caricoKg = inizialeKg`"; l'asterisco vince come per i movimenti.
4. `saldiAl31Dicembre`: aperture con `data_riferimento <= <anno>-12-31` (giorno,
   non l'istante `fine`), sommate come carichi; CER con sola apertura inclusi.
5. `giacenzeImpossibili`: aperture sommate ai carichi per CER e unità (una
   non di massa con sola apertura conta come "ha almeno un carico"; un CER con
   sola apertura entra nella mappa).
6. `RentriUnitaLocaleService.remove`: un registro con un'apertura non è vuoto
   (stesso errore `SEDE_CON_REGISTRO_CON_MOVIMENTI`, testo aggiornato a
   "movimenti, progressivo iniziale o giacenze iniziali"). Test Postgres sul
   modello della sezione D8 di `registro-per-sede.postgres.spec.ts`.
7. `RIMEDIO_CARICO_MANCANTE`: "Se il rifiuto era già in deposito prima di
   iniziare a usare il registro, inserisci la giacenza iniziale del registro
   (Registro → Giacenze iniziali); se è stato prodotto ora, usa Produzione
   interna." Aggiornare `registra-movimento.use-case.spec.ts` che lo cita.

## Task 3: API

**Dipende dal Task 2.** **File:** `src/api/registro/registro.controller.ts`,
`src/api/registro/dtos/giacenza-iniziale.dto.ts` (nuovo, + spec),
`registro.controller.spec.ts`, `registro.module.spec.ts` se serve.

1. Rotte (prefisso `registro`, stessa protezione di classe):
   - `GET giacenze-iniziali?registroId=` → `{ registroId, puoImpostare, voci[] }`
     (`puoImpostare` dal ruolo effettivo, come `leggiProgressivoIniziale`);
   - `POST giacenze-iniziali?registroId=` → 201 `{ giacenza, avvisi }`;
   - `PUT giacenze-iniziali/:id` → 200 `{ giacenza }`;
   - `DELETE giacenze-iniziali/:id` → 204.
   `:id` con `ParseUUIDPipe`. Ruoli G9 prima di chiamare il servizio. Data in
   uscita `YYYY-MM-DD` (G6).
2. DTO con `class-validator`: `cerCode` stringa, `statoFisico?` stringa ≤ 50,
   `quantita` numero > 0 con al più 2 decimali e ≤ 99 999 999,99, `unita`
   stringa ≤ 10, `dataRiferimento` con `@Matches(/^\d{4}-\d{2}-\d{2}$/)` più il
   controllo che la data esista, `origini?` array annidato validato
   (`ValidateNested`, `ArrayMaxSize(200)`, `quantita` con 2 decimali), `note?`
   ≤ 500. Swagger come le rotte del progressivo iniziale.
3. Validazione DTO verificata con la pipe vera: `dtos/giacenza-iniziale.dto.spec.ts`
   (modello `progressivo-iniziale.dto.spec.ts`) o `registro.controller.http.spec.ts`
   (data non ISO o con ora, quantità 0, origini malformate).
4. Test del controller: 403 per OPERATOR/VIEWER nell'azienda selezionata anche se
   ADMIN a casa (ruolo effettivo), tenant dall'header, 404/409 propagati.

## Task 4: frontend

**Dipende dal Task 3.** **File:**
`apps/frontend/src/app/features/registro/giacenze-iniziali-dialog.component.ts`
(nuovo, standalone, + spec), `registro.service.ts` (+ spec),
`registro.component.ts` (solo pulsante e apertura del dialog),
`apps/frontend/src/app/features/giacenze/giacenze.component.ts` e
`giacenze.service.ts` (+ spec).

1. `RegistroService`: tipi e metodi per le quattro rotte, con `registroId` in
   query come per il progressivo iniziale.
2. Pulsante "Giacenze iniziali" nella barra del registro accanto a quello del
   progressivo iniziale, visibile a tutti quando il registro è determinato;
   dialog (PrimeNG, stile del dialog del progressivo) con:
   tabella delle aperture (CER, stato fisico, quantità e unità, data, n. origini,
   azioni); form di inserimento e modifica (CER con lo stesso campo/autocomplete
   usato dal form del movimento se riusabile, stato fisico, quantità, unità,
   data, origini come righe anno/protocollo/quantità aggiungibili, note);
   modifica e cancellazione solo se `puoImpostare` e `modificabile`, altrimenti
   l'azione non compare e un testo spiega perché (uno scarico registrato dopo
   l'apertura l'ha usata); avvisi del POST mostrati; etichetta della sede come
   nel dialog del progressivo. Dopo ogni scrittura si ricarica l'elenco del
   dialog (la pagina giacenze legge dati freschi alla prossima apertura).
3. Pagina giacenze: colonna o nota "di cui iniziale" quando `inizialeKg > 0`.
4. Test dei componenti (visibilità delle azioni per ruolo e `modificabile`,
   invio del form, avvisi) e del servizio (URL e query).

## Fuori ambito (seguiti)

- Trasmissione delle aperture come relazioni iniziali a RENTRI (F2-9).
- Calcolo del deposito temporaneo sul carico più vecchio con residuo (F2-6).
- Riporto automatico di fine anno e giacenze per classe R13/D15 (WinWaste
  `[GIACENZE RIFIUTI]`): non previsti dalla roadmap per ora.
- Avviso speculare di G8 su un `ALTRO_CARICO` registrato dopo un'apertura.
- Conversione guidata degli `ALTRO_CARICO` già usati come apertura.
- Import da WinWaste (`provenienza = IMPORTAZIONE`, Fase 3).
