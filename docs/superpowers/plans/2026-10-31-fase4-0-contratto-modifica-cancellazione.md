# Fase 4 pezzo 0: modifica e cancellazione del contratto esistente — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`. Un agente sonnet per task, revisione opus fra un task e il
> successivo. Ordine **strettamente sequenziale** (un worktree, un database di test, commit
> condivisi): Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. Passi con checkbox (`- [ ]`).

**Obiettivo.** Rendere correggibile il contratto produttore ↔ controparte (`Contract`): modifica
parziale con lock ottimistico sulla `versione`, regole per stato (bozza tutta modificabile,
contratto attivo o sospeso solo nei termini, scaduto o cessato per niente), cancellazione logica
dei soli contratti mai attivati, audit in `activity_logs`, chiave esterna verso `tenants`.

**Architettura.** Regole pure in `src/domain/contracts/regole-contratto.ts` (quali campi cambiano,
quali sono ammessi nello stato, validazione dei dati); `ContractService` le applica e scrive con
un `updateMany` condizionato su `versione` (nessun lock esplicito: la condizione è l'arbitro);
due rotte nuove (`PATCH /contracts/:id`, `DELETE /contracts/:id?versione=`); nel frontend il
dialog di creazione diventa anche dialog di modifica, e la lista ha i pulsanti Modifica ed
Elimina guidati da due campi calcolati dal backend (`modificabili`, `eliminabile`).

**Tech stack.** NestJS + Prisma 5.22 + PostgreSQL 16 con RLS FORCE; Angular + PrimeNG; jest,
Karma.

**Spec.** `/home/graziano/Progetti/winwaste/docs/roadmap-fasi3-4-import-gestori.md` §5 (4.0),
§1, §6, §7 (D5), §9. Come lo fa WinWaste: `/home/graziano/Progetti/winwaste/docs/contratti.md`
§2-§6. Per non bloccare i pezzi dopo: `/home/graziano/Progetti/winwaste/docs/fatturazione.md`
(solo letto, nulla di 4.1-4.4 si progetta qui). Istruzioni comuni dei piani: brief
dell'orchestratore (regole riportate nei Vincoli globali).

---

## Da confermare con Graziano

Il piano è eseguibile con le raccomandazioni. Per ognuna: raccomandazione, e cosa cambia se la
risposta è diversa.

1. **Campi modificabili in un contratto `ACTIVE` o `SUSPENDED`.** DA CONFERMARE CON GRAZIANO.
   Raccomandazione: modificabili descrizione, CER coperti, modello di prezzo, prezzo base, unità
   di misura, data di fine, durata in mesi, rinnovo automatico, giorni di preavviso, termini di
   pagamento, frequenza di fatturazione; **bloccati** numero, produttore, controparte (e suo
   tipo), tipo di contratto, data di inizio. Motivo: i bloccati sono "chi e cosa" (cambiarli fa un
   altro contratto), gli altri sono termini che nella vita di un contratto cambiano davvero (in
   WinWaste prezzi e scadenze si aggiornano sul contratto in corso). Impatto se diverso: solo la
   costante `CAMPI_MODIFICABILI` del Task 2 e i suoi test; nessun altro task cambia.
2. **Contratto `PENDING_APPROVAL`.** DA CONFERMARE CON GRAZIANO. Raccomandazione: **non**
   modificabile; per correggerlo si riporta in bozza (transizione già ammessa, `PENDING_APPROVAL
   → DRAFT`) e poi si modifica. Motivo: chi approva deve approvare il testo che ha letto. Impatto
   se "modificabile come la bozza": una riga in `CAMPI_MODIFICABILI` e un test del Task 2, il
   tooltip del Task 6.
3. **Quali contratti si eliminano.** DA CONFERMARE CON GRAZIANO. Raccomandazione: solo `DRAFT` e
   `PENDING_APPROVAL` (mai stati attivi: nessuna transizione riporta un contratto attivo in quegli
   stati, `contract.service.ts:17-24`); un contratto attivo, sospeso, scaduto o cessato non si
   elimina, si porta a `TERMINATED`. Cancellazione **logica** (righe tenute con data e autore),
   come chiede la roadmap. Impatto se si vuole eliminare anche un cessato: `STATI_ELIMINABILI` del
   Task 2 e un test; il resto regge perché la cancellazione è comunque logica.
4. **Numero di un contratto eliminato.** DA CONFERMARE CON GRAZIANO. Raccomandazione: resta
   **riservato** (l'unico `contracts_tenant_id_contract_number_key` non cambia, e
   `nextContractNumber` continua a contare anche gli eliminati). Chi ha sbagliato il numero di una
   bozza lo corregge con la modifica, non eliminando e ricreando. Impatto se si vuole riusarlo:
   la migration del Task 1 sostituisce l'unico con un indice unico parziale `WHERE eliminato_il IS
   NULL` (non più puramente additiva: va scritto il ripristino), Prisma perde l'`@@unique`
   (l'indice parziale non si dichiara nello schema) e `nextContractNumber` filtra gli eliminati.
5. **Chiave esterna verso le anagrafiche.** DA CONFERMARE CON GRAZIANO. Raccomandazione: si
   aggiunge solo quella verso `tenants` (la roadmap la chiede); **non** quelle verso produttore e
   controparte. Motivo: la controparte è polimorfica (trasportatore, destinatario o intermediario
   senza registro) e un'anagrafica oggi si cancella davvero (`delete-produttore.use-case.ts:34`):
   una FK farebbe fallire quella cancellazione o cancellerebbe i contratti, e tocca un'area fuori
   da questo pezzo. La lista regge già un id che non risolve più (`contract.service.ts:235-288`).
   Impatto se si vogliono: pezzo a parte sulle anagrafiche (blocco della cancellazione di una
   ditta con contratti).

---

## Stato di partenza (branch `feat/fase4-0-contratto` = master `692880e`, verificato)

Percorsi relativi a `apps/backend/` salvo indicazione; `fe/` = `apps/frontend/src/app/`. I
numeri di riga della roadmap (`schema.prisma:1643-1683`) sono vecchi: valgono questi.

**Modello e database.**
- `prisma/schema.prisma:1744-1784`: `model Contract`, colonne `id`, `tenantId`, `createdAt`,
  `updatedAt @updatedAt`, `contractNumber` VarChar(50), `producerId`, `counterpartyId`,
  `counterpartyType`, `contractType`, `description`, `cerCodes String[]`, `pricingModel`,
  `basePrice Decimal(10,2)?`, `unitOfMeasure` VarChar(10) default `kg`, `pricingConfig Json?`,
  `startDate`, `endDate?`, `durationMonths?`, `autoRenew`, `renewalNoticeDays` default 60,
  `paymentTerms`, `billingFrequency`, `status` default `DRAFT`. `@@unique([tenantId,
  contractNumber])`, indici `(tenantId, status)`, `(tenantId, producerId)`. **Nessuna
  `@relation`**: né verso `Tenant` né verso le anagrafiche. Nessuna `versione`, nessun campo di
  cancellazione. Enum `:1786-1825`.
- `prisma/migrations/20260613110000_add_contract/migration.sql`: tabella `contracts` senza FK;
  nomi `contracts_pkey`, `contracts_tenant_id_contract_number_key`,
  `contracts_tenant_id_status_idx`, `contracts_tenant_id_producer_id_idx`.
- RLS già presente: `20261025130000_rls_policy_aziende/migration.sql:51-55` (ENABLE, FORCE,
  `isolamento_azienda`) e `20261026100000_rls_sola_lettura_controlli/migration.sql:37`
  (`sola_lettura` per `wasteflow_lettura`). `'Contract'` è già in `TENANT_SCOPED_MODELS`
  (`src/infrastructure/persistence/prisma-rls.extension.ts:87`). `rls-catalogo.postgres.spec.ts:64`
  conta 35 tabelle: **questo pezzo non aggiunge tabelle, il conteggio resta 35**.
- `Tenant` (`schema.prisma` intorno a `:120-131`): le relazioni inverse finiscono con `ditte`,
  `sediDitte` (F2-10). Convenzione di tutte le tabelle per azienda: `tenant Tenant @relation(...,
  onDelete: Cascade)` (es. `:204`, `:711`, `:1917`).
- `ActivityLog` (`schema.prisma:887-911`): `tenantId`, `userId?` (FK a `users`), `firId?`,
  `action` VarChar(100), `description`, `metadata Json?`. Esempio di uso nella stessa
  transazione della scrittura: `src/application/giacenze/soglie-deposito.service.ts:171-185`.

**Backend.**
- `src/application/contracts/contract.controller.ts:32-102`: `POST /contracts`, `GET`,
  `GET auto-fill`, `GET next-number` (prima di `:id`, commento `:66-67`), `GET :id`,
  `PATCH :id/status`. `@Roles('SUPER_ADMIN','ADMIN','OPERATOR')` su create e cambio stato; il
  `RolesGuard` decide sul **ruolo effettivo** nell'azienda selezionata
  (`src/auth/guards/roles.guard.ts:1-9,56-75`). Azienda via `requireRequestTenantId(req)`.
- `src/application/contracts/contract.service.ts`: `create` (`:88-120`, nessuna validazione di
  date né di CER, un numero duplicato esce come P2002 → 409 generico "Esiste già un record con
  questi dati.", `src/core/filters/http-exception.filter.ts:258-263`), `list` (`:122-128`),
  `findOrFail` (`:131-135`), `getById`, `nextContractNumber` (`:151-168`), `changeStatus`
  (`:171-188`, `update where { id }` senza condizione: legge, controlla, scrive),
  `assertPartiEsistono` (`:209-233`), `risolviParti` (`:244-288`, nomi dalla ditta di F2-10,
  `ContractParty.partitaIVA: string | null` e `codiceFiscale`), `getAutoFillForFir` (`:295-330`).
  Errori come `NotFoundException`/`BadRequestException` di Nest, messaggi in italiano senza id.
- DTO `src/application/contracts/dto/create-contract.dto.ts:42-130`; `ChangeContractStatusDto`
  `:132-145`. `ValidationPipe` globale con `whitelist` e `forbidNonWhitelisted`
  (`src/main.ts:43-47`).
- Test: `contract.service.spec.ts` (Prisma finto, `:12-49`), `contract.controller.spec.ts`
  (azienda selezionata), `contract-vocabulary.spec.ts` (allineamento col frontend letto come
  testo). Nessuno spec Postgres dei contratti; `mud-anagrafiche-ditte.postgres.spec.ts:180-218`
  usa `ContractService.list` con il ruolo app ed è il modello di setup (`urlComeRuolo`,
  `creaPrismaServiceApplicativo`, `creaDittaConRuolo`, pulizia per `tenantCreati`).
- **Chi punta a un contratto.** Nessuno: nessuna colonna `contract_id` in `schema.prisma`
  (`grep contractId` vuoto), il FIR non salva il contratto, e `GET /contracts/auto-fill` non è
  chiamato dal frontend (solo definito in `fe/features/contracts/contracts.service.ts:150-153`).
  Unico lettore di `contracts` fuori dal modulo: lo spec MUD citato. Quindi niente blocca
  tecnicamente una cancellazione; la cancellazione logica serve a conservare la storia e a non
  sorprendere i pezzi futuri.
- Precedente del lock ottimistico (F2-4): colonna `firs.versione INTEGER NOT NULL DEFAULT 1`
  (`prisma/migrations/20261030110000_fir_versione/migration.sql`), DTO con `versione` `@IsInt()
  @Min(1)` (`src/api/fir/dtos/modifica-fir.dto.ts:28-35`), 409 `FIR_MODIFICATO_NEL_FRATTEMPO`
  con messaggio "ricarica per vedere i dati aggiornati" (`src/core/domain/errors.ts:214-225`),
  frontend che rilegge prima di aprire la modifica e gestisce il 409 (`fe/features/fir/fir-list.component.ts:1842-1852,1990`).
- Convenzione sulle cancellazioni: si elimina ciò che non è mai stato usato, altrimenti si
  chiude (`src/api/registro/causali-registro.controller.ts:140-160`: "Elimina una versione mai
  usata" contro "chiusura"). Nessun `deletedAt` nel repository: questo pezzo introduce
  `eliminato_il`/`eliminato_da`.

**Frontend.**
- `fe/features/contracts/contracts.service.ts:45-73` (`Contract` senza `versione`), `:139-147`
  (`create`, `updateStatus`).
- `fe/features/contracts/contract-create-dialog.component.ts` (470 righe): `@Input() visible`,
  `@Output() creato` (`:305-308`), `crea()` (`:397-428`), `validate` (`:430-441`),
  `emptyForm` (`:450-469`); spec `contract-create-dialog.component.spec.ts` (20 test).
- `fe/features/contracts/contracts-list.component.ts`: colonna Azioni con il solo pulsante
  "Cambia stato" (`:162-172`), dialog di cambio stato (`:196-230`), mirror di
  `ALLOWED_TRANSITIONS` (`:17-24`). Nessuno spec della lista. Rotta `contratti` in
  `fe/app.routes.ts:135`. Conferme con `ConfirmationService` come in `fe/features/fir/fir-detail.component.ts:16,99,926`.
- E2E: nessuna spec Playwright sui contratti (`e2e/tests/**`).

## Normativa e punti dubbi

Il contratto produttore ↔ trasportatore/destinatario non ha uno schema imposto da norma: la
legge chiede che il produttore affidi i rifiuti a soggetti autorizzati (art. 188 D.Lgs
152/2006), non come tenga il contratto. Nessun obbligo di conservazione specifico del contratto
nel gestionale; la cancellazione logica è una scelta di prudenza, non un obbligo.

Punti dubbi (risolti nelle Decisioni):
- WinWaste non ha la cancellazione del singolo contratto: solo la pulizia massiva
  `cancellacontratti`, che scarta i contratti citati da movimenti, ritiri, formulari, card o
  unità locali (`contratti.md` §3 "Chi punta a un contratto", §6). Qui nessuno punta ancora a un
  contratto; la regola equivalente è "si elimina solo ciò che non è mai stato attivo" (D3).
- WinWaste controlla "data inizio non successiva alla data fine" e "descrizione obbligatoria"
  (`contratti.md` §4 punti 1-2). Il primo si porta (D6); il secondo no, perché da noi la
  descrizione è facoltativa da sempre e renderla obbligatoria bloccherebbe la modifica dei
  contratti esistenti senza descrizione.
- Le regole per installazione (`ControlloRegole`, 01/09/11) sono configurazioni per singoli
  clienti di Nica e riguardano il contratto **cliente** (attivo) di 4.1: non si portano.

## Decisioni (vincolanti)

**D1. Lock ottimistico con `versione`, non con `updatedAt`.** Colonna `contracts.versione INTEGER
NOT NULL DEFAULT 1` come `firs.versione` (F2-4). La roadmap dice `updatedAt`: si sceglie
`versione` per coerenza col FIR e perché un intero passa intatto da JSON, mentre un timestamp
deve fare il giro stringa ↔ `Date` con i millisecondi. Ogni scrittura (modifica, cambio di
stato, cancellazione) fa `versione + 1`. Modifica e cancellazione ricevono dal client la
`versione` letta; il cambio di stato non la riceve (la sua API non cambia) ma la condiziona su
quella letta dal server, così una modifica partita prima di un cambio di stato riceve 409.

**D2. Regole per stato** (raccomandazioni 1 e 2):

| Stato | Modificabile | Eliminabile |
|---|---|---|
| `DRAFT` | tutti i 17 campi di `CampoContratto` | sì |
| `PENDING_APPROVAL` | nessuno (riportare in bozza) | sì |
| `ACTIVE`, `SUSPENDED` | `description`, `cerCodes`, `pricingModel`, `basePrice`, `unitOfMeasure`, `endDate`, `durationMonths`, `autoRenew`, `renewalNoticeDays`, `paymentTerms`, `billingFrequency` | no |
| `EXPIRED`, `TERMINATED` | nessuno | no |

`pricingConfig` (Json scritto e mai letto) non è modificabile da questa API: resta fuori dal DTO.
`status` non è un campo della modifica: si cambia solo con `PATCH :id/status`.

**D3. Cancellazione logica.** Colonne `eliminato_il TIMESTAMP(3) NULL`, `eliminato_da UUID NULL`
(id dell'utente, senza FK: un utente rimosso non deve bloccare né cancellare la storia). Si
elimina solo in `DRAFT` e `PENDING_APPROVAL`. Un contratto eliminato sparisce da `list`,
`getById` (404), `auto-fill`, `changeStatus`, modifica e seconda cancellazione (404). Il numero
resta riservato (raccomandazione 4): `nextContractNumber` **non** filtra gli eliminati.

**D4. Semantica di `PATCH /contracts/:id`.** Modifica parziale: un campo assente non cambia;
`null` svuota un campo facoltativo (`description`, `basePrice`, `endDate`, `durationMonths`);
`null` su un campo obbligatorio è un 400 "<etichetta> è obbligatorio". `versione` obbligatoria.
Un corpo senza differenze rispetto al contratto (dopo la normalizzazione di D5) non scrive, non
incrementa la versione e non lascia audit, ma controlla comunque la versione (versione vecchia →
409). Ordine dei controlli: (1) contratto assente o eliminato → 404; (2) stato senza campi
modificabili (`EXPIRED`, `TERMINATED`, `PENDING_APPROVAL`) → 409 `CONTRATTO_NON_MODIFICABILE`
col motivo dello stato; (3) versione diversa → 409 `CONTRATTO_MODIFICATO_NEL_FRATTEMPO`; (4) campi
cambiati non ammessi nello stato → 409 `CONTRATTO_NON_MODIFICABILE` con l'elenco delle etichette;
(5) validazione dei dati risultanti → 400 `CONTRATTO_NON_VALIDO` con i messaggi; (6) parti
cambiate → `assertPartiEsistono` sui valori risultanti (400 attuali); (7) scrittura condizionata
(D7); numero duplicato → 409 `CONTRATTO_NUMERO_DUPLICATO`.

**D5. Confronto dei campi.** Date per `getTime()`; `basePrice` come numero (`Decimal` →
`Number`, `null` resta `null`); `cerCodes` come insieme (ordine e duplicati non contano; si salva
l'elenco ordinato e senza duplicati); stringhe dopo `trim()` (`contractNumber`, `description`,
`unitOfMeasure`), con `description` vuota dopo il trim = `null`.

**D6. Validazione condivisa da creazione e modifica** (`validaDatiContratto`): numero non vuoto
e ≤ 50 caratteri; almeno un CER; ogni CER di 6 cifre (`/^\d{6}$/`, come li salva il selettore);
`endDate` non precedente a `startDate`; `basePrice` ≥ 0; `durationMonths` intero ≥ 1;
`renewalNoticeDays` intero ≥ 0; `unitOfMeasure` non vuota e ≤ 10 caratteri. Si applica anche a
`create` (oggi accetta fine prima dell'inizio e zero CER): è una correzione, e il frontend già
richiede almeno un CER. Il controllo che il CER esista nel catalogo resta fuori ambito.

**D7. Scrittura condizionata.** `updateMany({ where: { id, tenantId, versione: letta,
eliminatoIl: null }, data: { ...cambiati, versione: { increment: 1 }, updatedAt: new Date() } })`
dentro `prisma.$transaction` insieme all'`activityLog.create`. `count === 0` → 409
`CONTRATTO_MODIFICATO_NEL_FRATTEMPO` (modificato, cambiato di stato o eliminato dopo la lettura).
Nessun advisory lock: la condizione sulla versione è sufficiente perché ogni scrittura la
incrementa. La cancellazione aggiunge alla condizione `status: { in: STATI_ELIMINABILI }`.

**D8. Audit.** `activity_logs` nella stessa transazione: `CONTRATTO_MODIFICATO` (descrizione
"Contratto <numero> modificato", metadata `{ contrattoId, campi, prima, dopo }` coi soli campi
cambiati, date in ISO, `basePrice` numero) e `CONTRATTO_ELIMINATO` (descrizione "Contratto
<numero> eliminato", metadata `{ contrattoId, numero, stato }`). Nessun dato fiscale in metadata
(il contratto ne ha solo gli id). Il cambio di stato resta senza audit (fuori ambito).

**D9. Errori.** Eccezioni HTTP di Nest lanciate dal servizio (come oggi nel modulo), con corpo
`{ message, error }`: il filtro globale (`http-exception.filter.ts:73-85`) usa `error` come codice.
Nessuna modifica al filtro. Codici e testi esatti:
- `CONTRATTO_MODIFICATO_NEL_FRATTEMPO` (409): "Il contratto è stato modificato nel frattempo da
  un'altra operazione: ricarica per vedere i dati aggiornati e ripeti l'operazione."
- `CONTRATTO_NON_MODIFICABILE` (409): per stato — `PENDING_APPROVAL` "Un contratto in
  approvazione non si modifica: riportalo in bozza per correggerlo.", `EXPIRED` "Un contratto
  scaduto non si modifica.", `TERMINATED` "Un contratto cessato non si modifica."; per campi —
  "In un contratto attivo o sospeso non si possono cambiare: <etichette separate da virgola>."
- `CONTRATTO_NON_ELIMINABILE` (409): "Si eliminano solo i contratti in bozza o in approvazione:
  per chiudere questo contratto portalo in stato Cessato."
- `CONTRATTO_NON_VALIDO` (400): `message` = array dei messaggi di `validaDatiContratto`.
- `CONTRATTO_NUMERO_DUPLICATO` (409): "Esiste già un contratto con questo numero." (anche in
  `create`).
- 404 invariato: "Contratto non trovato".

**D10. Vista restituita.** `list`, `getById`, `update` restituiscono `ContrattoVista` =
contratto con parti risolte, senza `eliminatoIl`/`eliminatoDa`, più `modificabili:
CampoContratto[]` e `eliminabile: boolean` calcolati dalle regole del Task 2. Il frontend non
replica le regole (nessun mirror da tenere allineato): abilita i campi e i pulsanti da questi due
valori. `create` resta com'è (il frontend ignora la risposta).

**D11. Ruoli.** `PATCH :id` e `DELETE :id` con `@Roles('SUPER_ADMIN','ADMIN','OPERATOR')`, come
creazione e cambio di stato (ruolo effettivo dal `RolesGuard`). `ParseUUIDPipe` su `:id`.
`DELETE` risponde 204; la `versione` arriva in query (`?versione=3`, `ParseIntPipe`), perché un
corpo su `DELETE` non è affidabile nei proxy.

**D12. FK verso `tenants`** con `ON DELETE CASCADE`, come tutte le tabelle per azienda; nome
`contracts_tenant_id_fkey` (predefinito di Prisma). Prima di aggiungerla la migration conta i
contratti orfani e si ferma con un messaggio senza id se ce ne sono. Nessuna FK verso le
anagrafiche (raccomandazione 5).

**D13. Non bloccare 4.1-4.4 (D5 della roadmap, "due modelli").** `Contract` resta il contratto
**passivo** del produttore: niente campo "ruolo attivo/passivo", niente cliente di fatturazione,
niente rinomina. Il contratto cliente di 4.1 sarà un modello separato (`ContrattoCliente`) che
potrà riusare lo stesso schema di regole (stato → campi modificabili, versione, cancellazione
logica) senza dipendere da questo codice. Le scelte di qui che 4.1+ trovano già fatte e non
devono rifare: lock con `versione`, cancellazione logica con `eliminato_il`/`eliminato_da`,
audit `CONTRATTO_*` in `activity_logs`. Nessun legame da movimenti o FIR verso `Contract` viene
introdotto (il legame movimento → contratto cliente è di 4.3).

## Vincoli globali

- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), messaggi in italiano,
  **nessuna attribuzione AI** (né `Co-Authored-By` né altro). Niente push.
- Commenti e testi in italiano, termini tecnici non tradotti. Messaggi all'utente senza id né
  dati fiscali.
- Azienda sempre da `requireRequestTenantId(req)`; ruolo effettivo dal `RolesGuard` (D11).
- **Database di test di questo worktree: `wasteflow-pg-test-contratti` su `127.0.0.1:55440`.**
  Mai le porte degli altri worktree (55432, 55434, 55436, 55438, 55442, 55444). Macchina Linux:
  **niente `DOCKER_HOST`**. In ogni shell:
  ```bash
  export DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55440/wasteflow_ci?schema=public"
  export DB_APP_PASSWORD=wasteflow_app_dev DB_SISTEMA_PASSWORD=wasteflow_sistema_dev
  ```
  e prima di **ogni** suite Postgres
  `[[ "$DATABASE_URL" == *":55440/"* ]] || { echo "DATABASE_URL non punta a 55440: fermo"; exit 1; }`.
  Gli spec Postgres esistenti hanno `55432` come ripiego se `DATABASE_URL` manca: per questo la
  guardia è obbligatoria.
- Prisma solo dal pacchetto installato (`npx prisma --version` → 5.22.x); dopo ogni modifica
  dello schema `npx prisma generate`.
- Test Postgres col ruolo **`wasteflow_app`** (modello `mud-anagrafiche-ditte.postgres.spec.ts:10-79`:
  `urlComeRuolo`, `creaPrismaServiceApplicativo`, `TenantContext.run`, owner per preparare),
  lanciati con `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`.
  Pulizia **solo per id esatti creati**: `const tenantCreati: string[] = []`, e in `afterAll`
  `if (tenantCreati.length > 0) { const where = { tenantId: { in: tenantCreati } } … }` per
  `activityLog`, `contract`, ruoli anagrafici, `sedeDitta`, `ditta`, `user`, poi
  `tenant.deleteMany({ where: { id: { in: tenantCreati } } })`. **Mai** un `deleteMany` con un
  filtro che può essere `undefined`. Fixture con `partitaIvaValida(seme)` e anagrafiche con
  `creaDittaConRuolo` (`src/test-support/anagrafiche-di-test.ts:25,81`); utente creato dal
  proprietario come in `soglie-deposito.service.postgres.spec.ts:44`.
- **RAM (16 GB).** jest mirato `npx jest -w 2 <percorsi>`; a fine task backend una volta
  `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov` (ha già
  `--runInBand`). Lint solo dei file toccati, senza `--fix`: `npx eslint <file…>`; mai `npm run
  lint` (fa `--fix` su tutto). Un solo processo pesante alla volta. Karma **una volta** a fine
  task frontend.
- Fine task backend: `test:cov`, `npx tsc --noEmit -p tsconfig.json`, eslint globale backend
  `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` con **0 errori**, le suite Postgres toccate
  più `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts` (resta **35**). Confronto
  con la linea di base del Task 0: nessun fallimento nuovo.
- Task con migration: `npx prisma validate`; `npx prisma migrate deploy` su 55440 seguito da
  `PG_EXEC="docker exec -i wasteflow-pg-test-contratti" bash ../../ops/db-ruoli.sh`;
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://wasteflow:wasteflow_ci@127.0.0.1:55440/shadow_contratti?schema=public"`
  (database creato e rimosso con `docker exec wasteflow-pg-test-contratti psql -U wasteflow -d
  wasteflow_ci -c "CREATE DATABASE shadow_contratti"` / `"DROP DATABASE shadow_contratti"`) →
  vuoto, salvo le note preesistenti di master (pgcrypto, default di `notifications.expires_at`).
  Migration additive; `SET LOCAL lock_timeout = '5s'`; nomi di vincoli e indici ≤ 63 caratteri,
  uguali in schema e SQL; ripristino scritto nel commento della migration e in `ops/README.md`.
  Prefisso del timestamp: **`202611012000`** (cartella `20261101200000_…`), per non collidere coi
  pezzi in parallelo. Le tabelle nuove avrebbero RLS ENABLE+FORCE, `isolamento_azienda`,
  `sola_lettura`, voce in `TENANT_SCOPED_MODELS` e conteggio in `rls-catalogo`: **qui non ce ne
  sono**, e un task che pensasse di doverne creare una si ferma e lo segnala.
- Task frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless`
  (una volta), `npm run build`, dalla root `npx eslint <file toccati> --max-warnings=-1`.
- Aree escluse: `application/fir/**`, `api/fir/**`, `application/registro/**`,
  `application/registry/**`, `api/registry/**`, `application/mud/**` (salvo lo spec MUD se la
  pulizia dei contratti avesse bisogno di `activityLog`: non ne ha), `core/filters/**`,
  `fe/features/fir/**`, `fe/features/registry/**`. Se un task scopre di doverne toccare una, si
  ferma e lo segnala.
- Convivenza con i branch paralleli: file condivisi a rischio di conflitto `schema.prisma`
  (modifiche solo dentro `model Contract` e una riga di relazione inversa in coda alle relazioni
  di `Tenant`, dopo `sediDitte`) e `ops/README.md` (paragrafo nuovo in coda alla sezione
  Rollback, prima di "Il ripristino dal backup"). Al rebase: `npx prisma generate`, `migrate
  deploy`, `migrate diff` vuoto, suite `contracts/` e `rls-catalogo`.

## Review focus

Le cinque situazioni che i test dei task devono fissare perché sono le più probabili in uso
reale (ognuna ha il suo test nel task indicato):

1. **Due finestre aperte sullo stesso contratto** (o modifica mentre un collega lo attiva): il
   secondo salvataggio riceve 409 e niente si sovrascrive. Test: Task 3 Postgres
   `due modifiche con la stessa versione: una riesce, l'altra 409` e `una modifica letta prima di
   un cambio di stato riceve 409`.
2. **Svuotare un campo facoltativo** (togliere la data di fine o il prezzo): `null` deve
   svuotare, l'assenza no. Test: Task 2 `null su endDate svuota, assente non cambia` e Task 4
   `il DTO accetta null su endDate e lo passa al servizio`.
3. **Riordinare i CER senza cambiarli** non è una modifica (nessuna versione, nessun audit, e
   in un contratto attivo nessun 409 inutile). Test: Task 2 `cerCodes in altro ordine: nessun
   campo cambiato`.
4. **Correggere il numero di una bozza con un numero già usato** (anche da un contratto
   eliminato): 409 chiaro, non 500. Test: Task 3 Postgres `numero già usato da un contratto
   eliminato: 409 CONTRATTO_NUMERO_DUPLICATO`.
5. **Contratto eliminato da un collega mentre lo guardo**: modifica, cambio di stato e
   cancellazione rispondono 404/409 e la lista non lo mostra più. Test: Task 3 Postgres
   `eliminato: sparisce da list, getById 404, changeStatus 404, update 404` e Task 6
   `dopo un 409 la lista si ricarica`.

---

## Task 0: ambiente e linea di base

**File:** nessuno (solo verifica).

- [ ] **Step 1: database di test.** Se `docker ps -a` non mostra `wasteflow-pg-test-contratti`:
  ```bash
  docker run -d --name wasteflow-pg-test-contratti -p 127.0.0.1:55440:5432 \
    -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci \
    -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 postgres:16-alpine
  ```
  (se esiste ed è spento: `docker start wasteflow-pg-test-contratti`). Variabili dei Vincoli
  globali; `npm ci` in `apps/backend` e `apps/frontend` solo se `node_modules` manca.
- [ ] **Step 2: schema e ruoli.** Da `apps/backend`: `npx prisma migrate deploy` (ultima
  migration `20261031110200_fir_parti_sede_cf`), `npx prisma generate`,
  `PG_EXEC="docker exec -i wasteflow-pg-test-contratti" bash ../../ops/db-ruoli.sh`,
  `npx ts-node prisma/seed.ts` (catalogo CER).
- [ ] **Step 3: linea di base.** `test:cov`, `npx tsc --noEmit -p tsconfig.json`,
  `rls-catalogo.postgres.spec.ts` (35), `mud-anagrafiche-ditte.postgres.spec.ts`. Annotare nel
  rapporto i test già rossi su master: non si aggiustano in questo pezzo.

## Task 1: schema, migration, FK verso `tenants`

**File:**
- Modify: `apps/backend/prisma/schema.prisma` (`model Contract` `:1744-1784`; relazione inversa
  su `Tenant` dopo `sediDitte`)
- Create: `apps/backend/prisma/migrations/20261101200000_contratti_modifica_eliminazione/migration.sql`
- Modify: `ops/README.md` (sezione Rollback)
- Create: `apps/backend/src/application/contracts/contracts.schema.postgres.spec.ts`

**Interfaces:**
- Produces: campi Prisma `Contract.versione: Int @default(1)`, `Contract.eliminatoIl: DateTime?
  @map("eliminato_il")`, `Contract.eliminatoDa: String? @map("eliminato_da") @db.Uuid`,
  `Contract.tenant: Tenant`; `Tenant.contracts: Contract[]`.

- [ ] **Step 1: test che fallisce** `contracts.schema.postgres.spec.ts` (ruolo app per le
  scritture nel contesto, owner per preparare). Casi:
  - `un contratto nuovo nasce con versione 1, eliminato_il e eliminato_da null`;
  - `eliminato_da senza eliminato_il è respinto` (errore che cita
    `contracts_eliminazione_coerente`);
  - `versione 0 è respinta` (cita `contracts_versione_positiva`);
  - `un contratto con tenant_id inesistente è respinto dalla FK` (owner, cita
    `contracts_tenant_id_fkey`);
  - `nel contesto di B l'update di un contratto di A tocca 0 righe` (RLS invariata);
  - `cancellare il tenant cancella i suoi contratti` (owner, tenant di prova creato apposta).
- [ ] **Step 2:** lanciarlo (con la guardia 55440): FAIL (colonne assenti).
- [ ] **Step 3: schema.** Nel modello, dopo `status`: `versione Int @default(1)` con commento
  `///` (lock ottimistico, come `FIR.versione`), `eliminatoIl`, `eliminatoDa` (commento:
  cancellazione logica, D3, nessuna FK all'utente), `tenant Tenant @relation(fields: [tenantId],
  references: [id], onDelete: Cascade)`. Su `Tenant`: `// Fase 4 pezzo 0` + `contracts Contract[]`.
- [ ] **Step 4: migration**, nell'ordine: commento iniziale (cosa fa, perché — 4.0, D1/D3/D12 —,
  che è additiva, ripristino a mano: `ALTER TABLE contracts DROP CONSTRAINT
  contracts_tenant_id_fkey, DROP CONSTRAINT contracts_eliminazione_coerente, DROP CONSTRAINT
  contracts_versione_positiva, DROP COLUMN eliminato_da, DROP COLUMN eliminato_il, DROP COLUMN
  versione;` e `DELETE FROM _prisma_migrations WHERE migration_name =
  '20261101200000_contratti_modifica_eliminazione';`, con l'avvertenza di D3 sotto); `SET LOCAL
  lock_timeout = '5s';`; `ADD COLUMN versione INTEGER NOT NULL DEFAULT 1`, `eliminato_il
  TIMESTAMP(3)`, `eliminato_da UUID`; `CHECK contracts_versione_positiva (versione >= 1)`;
  `CHECK contracts_eliminazione_coerente (eliminato_da IS NULL OR eliminato_il IS NOT NULL)`;
  blocco `DO $$` che conta i contratti senza tenant (`NOT EXISTS (SELECT 1 FROM tenants t WHERE
  t.id = c.tenant_id)`) e fa `RAISE EXCEPTION '4.0 contratti: % contratti senza azienda, la FK
  non si puo'' aggiungere. Correggerli o rimuoverli a mano prima del deploy.'` (modello
  `20261027110000_registro_obbligatorio/migration.sql:41-52`; il proprietario della migration è
  superuser e vede tutte le righe nonostante FORCE); `ADD CONSTRAINT contracts_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE CASCADE` (stesse
  clausole che Prisma genera per le altre relazioni: verificarle col `migrate diff`). Nessun
  GRANT, nessuna policy (tabella già sotto RLS).
- [ ] **Step 5: `ops/README.md`**, paragrafo "Stesso discorso per **modifica e cancellazione dei
  contratti** (Fase 4 pezzo 0, colonne `versione`, `eliminato_il`, `eliminato_da` di
  `contracts`)": il codice vecchio ignora le colonne, quindi **dopo un rollback i contratti
  eliminati ricompaiono** nella lista (e un contratto eliminato in `DRAFT` potrebbe essere
  attivato). Prima del rollback: `SELECT tenant_id, count(*) FROM contracts WHERE eliminato_il IS
  NOT NULL GROUP BY 1`; se non è vuoto, avvisare le aziende o portare quei contratti a
  `TERMINATED` con una query concordata. La FK resta e il codice vecchio non ne risente.
  Ripristino a mano dello schema: rimando al commento della migration.
- [ ] **Step 6: verifiche** dei Vincoli globali (generate, validate, deploy + `db-ruoli.sh`,
  `migrate diff` vuoto), spec del Step 1 PASS, `rls-catalogo` a 35, suite di fine task backend.
- [ ] **Step 7: commit**
  `git commit -m "feat(contratti): versione, cancellazione logica e chiave esterna verso l'azienda" -- apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/20261101200000_contratti_modifica_eliminazione/migration.sql ops/README.md apps/backend/src/application/contracts/contracts.schema.postgres.spec.ts`

## Task 2: regole pure del contratto

**File:**
- Create: `apps/backend/src/domain/contracts/regole-contratto.ts`
- Create: `apps/backend/src/domain/contracts/regole-contratto.spec.ts`

**Interfaces:**
- Consumes: `ContractStatus` (tipo esportato da `contract.service.ts:5-11`: lo si **sposta** qui e
  `contract.service.ts` lo ri-esporta con `export type { ContractStatus } from
  '../../domain/contracts/regole-contratto'`, così controller e spec esistenti non cambiano).
- Produces:
  ```ts
  export type CampoContratto =
    | 'contractNumber' | 'producerId' | 'counterpartyId' | 'counterpartyType' | 'contractType'
    | 'description' | 'cerCodes' | 'pricingModel' | 'basePrice' | 'unitOfMeasure'
    | 'startDate' | 'endDate' | 'durationMonths' | 'autoRenew' | 'renewalNoticeDays'
    | 'paymentTerms' | 'billingFrequency'
  export interface DatiContratto {            // valori normalizzati (D5)
    contractNumber: string; producerId: string; counterpartyId: string
    counterpartyType: 'TRANSPORTER' | 'DISPOSER' | 'BROKER'
    contractType: 'WASTE_DISPOSAL' | 'WASTE_TRANSPORT' | 'FULL_SERVICE' | 'FRAMEWORK'
    description: string | null; cerCodes: string[]; pricingModel: string
    basePrice: number | null; unitOfMeasure: string; startDate: Date; endDate: Date | null
    durationMonths: number | null; autoRenew: boolean; renewalNoticeDays: number
    paymentTerms: string; billingFrequency: string
  }
  export type ModificaContratto = { [K in CampoContratto]?: DatiContratto[K] | null }
  export const ETICHETTE_CAMPI: Readonly<Record<CampoContratto, string>>
  export const CAMPI_MODIFICABILI: Readonly<Record<ContractStatus, readonly CampoContratto[]>>
  export const STATI_ELIMINABILI: readonly ContractStatus[]          // ['DRAFT','PENDING_APPROVAL']
  export const CAMPI_FACOLTATIVI: readonly CampoContratto[]          // description, basePrice, endDate, durationMonths
  export function normalizzaDati(grezzo: {…campi Prisma, basePrice: Decimal|number|null…}): DatiContratto
  export function validaDatiContratto(d: DatiContratto): string[]
  export function motivoNonModificabile(stato: ContractStatus): string | null
  export function motivoNonEliminabile(stato: ContractStatus): string | null
  export function pianificaModifica(stato: ContractStatus, attuale: DatiContratto, modifica: ModificaContratto):
    { esito: 'NESSUNA_MODIFICA' }
    | { esito: 'CAMPI_NON_AMMESSI'; campi: CampoContratto[]; messaggio: string }
    | { esito: 'NON_VALIDA'; messaggi: string[] }
    | { esito: 'OK'; dopo: DatiContratto; cambiati: CampoContratto[] }
  ```
  Etichette (testo esatto, usate nei messaggi e nel frontend tramite il messaggio): numero
  "Numero", produttore "Produttore", controparte "Controparte", tipo controparte "Tipo
  controparte", tipo contratto "Tipo di contratto", descrizione "Descrizione", CER "Codici CER",
  modello di prezzo "Modello di prezzo", prezzo base "Prezzo base", unità "Unità di misura",
  inizio "Data di inizio", fine "Data di fine", durata "Durata in mesi", rinnovo "Rinnovo
  automatico", preavviso "Giorni di preavviso", pagamento "Termini di pagamento", fatturazione
  "Frequenza di fatturazione". Messaggi di stato e di campi: D9, testo esatto.

- [ ] **Step 1: test che falliscono** (`regole-contratto.spec.ts`), con un `bozza()` di fixture:
  - `CAMPI_MODIFICABILI: DRAFT tutti e 17, ACTIVE e SUSPENDED gli 11 di D2, PENDING_APPROVAL EXPIRED TERMINATED nessuno`;
  - `ogni campo ha un'etichetta`;
  - `motivoNonModificabile`: `DRAFT`/`ACTIVE`/`SUSPENDED` → null; `PENDING_APPROVAL`,
    `EXPIRED`, `TERMINATED` → i testi di D9;
  - `motivoNonEliminabile`: null per `DRAFT` e `PENDING_APPROVAL`, testo di D9 per gli altri 4;
  - `pianificaModifica`: `modifica vuota → NESSUNA_MODIFICA`; `stessi valori (numero con spazi
    intorno, stessa data come nuova istanza) → NESSUNA_MODIFICA`; `cerCodes in altro ordine:
    nessun campo cambiato`; `cerCodes con un duplicato → dopo.cerCodes ordinato e senza
    duplicati`; `null su endDate svuota, assente non cambia`; `description '  ' → null`;
    `null su contractNumber → NON_VALIDA con "Numero è obbligatorio"`; `ACTIVE: cambia basePrice
    e endDate → OK con cambiati ['basePrice','endDate']`; `ACTIVE: cambia producerId e
    startDate → CAMPI_NON_AMMESSI con messaggio "In un contratto attivo o sospeso non si possono
    cambiare: Produttore, Data di inizio."`; `ACTIVE: producerId uguale all'attuale non è un
    cambio e non blocca`; `DRAFT: cambia tutto → OK`; `basePrice 120.5 contro Decimal "120.50"
    → nessun cambio`;
  - `validaDatiContratto`: valido → `[]`; fine prima dell'inizio → "La data di fine non può
    precedere la data di inizio."; fine uguale all'inizio → valido; zero CER → "Indica almeno
    un codice CER."; CER `'15010'` → "Codice CER non valido: 15010."; numero di 51 caratteri;
    `basePrice` -1; `durationMonths` 0 e 1.5; `renewalNoticeDays` -1; unità vuota e di 11
    caratteri; più errori insieme → tutti i messaggi, nell'ordine dei campi.
- [ ] **Step 2:** `npx jest -w 2 src/domain/contracts`: FAIL (modulo assente).
- [ ] **Step 3: implementare** il file. Commento di testa: cosa decide, la tabella di D2, D4 e
  D5 riassunti, perché `pricingConfig` e `status` non ci sono, il rimando a questo piano e a D13
  (il contratto cliente di 4.1 è un altro modello). Ordine in `pianificaModifica`: normalizza la
  modifica sopra l'attuale (assente = attuale, `null` = svuota; `null` su un campo non in
  `CAMPI_FACOLTATIVI` = messaggio "<Etichetta> è obbligatorio."), calcola i cambiati, se nessuno
  `NESSUNA_MODIFICA`, poi campi non ammessi nello stato, poi `validaDatiContratto(dopo)`.
  Nessuna dipendenza da Nest o Prisma (il `Decimal` si riceve come `{ toNumber(): number } |
  number | null`).
- [ ] **Step 4:** test PASS; eslint dei due file; `tsc`.
- [ ] **Step 5: commit**
  `git commit -m "feat(contratti): regole pure di modifica e cancellazione per stato" -- apps/backend/src/domain/contracts/regole-contratto.ts apps/backend/src/domain/contracts/regole-contratto.spec.ts apps/backend/src/application/contracts/contract.service.ts`

## Task 3: servizio — modifica, cancellazione, filtri, cambio di stato condizionato

**File:**
- Modify: `apps/backend/src/application/contracts/contract.service.ts`
- Modify: `apps/backend/src/application/contracts/contract.service.spec.ts`
- Create: `apps/backend/src/application/contracts/contract.service.postgres.spec.ts`

**Interfaces:**
- Consumes: Task 1 (campi Prisma), Task 2 (tutte le funzioni e costanti).
- Produces:
  ```ts
  export type ContrattoVista = Omit<ContractWithParties<Contract>, 'eliminatoIl' | 'eliminatoDa'> & {
    modificabili: CampoContratto[]; eliminabile: boolean }
  export interface ModificaContrattoInput extends ModificaContratto { versione: number }
  list(tenantId: string, status?: ContractStatus): Promise<ContrattoVista[]>
  getById(tenantId: string, id: string): Promise<ContrattoVista>
  update(tenantId: string, utenteId: string, id: string, input: ModificaContrattoInput): Promise<ContrattoVista>
  elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>
  changeStatus(tenantId: string, id: string, newStatus: ContractStatus)   // firma invariata
  ```
  Codici d'errore e testi: D9.

- [ ] **Step 1: test unitari che falliscono** (Prisma finto: aggiungere `contract.updateMany`,
  `activityLog.create`, `$transaction: jest.fn(fn => fn(prisma))`):
  - `findOrFail cerca con eliminatoIl null` (si verifica il `where` passato a `findFirst`);
  - `list filtra eliminatoIl null e aggiunge modificabili ed eliminabile`; `list non espone
    eliminatoIl ed eliminatoDa`;
  - `getAutoFillForFir esclude gli eliminati`;
  - `nextContractNumber conta anche gli eliminati` (nessun filtro su `eliminatoIl`);
  - `create rifiuta fine prima dell'inizio con 400 CONTRATTO_NON_VALIDO senza scrivere`;
    `create con P2002 risponde 409 CONTRATTO_NUMERO_DUPLICATO`;
  - `update`: `contratto assente → 404`; `TERMINATED → 409 CONTRATTO_NON_MODIFICABILE prima del
    controllo di versione` (versione sbagliata ma risposta "non modificabile");
    `versione diversa → 409 CONTRATTO_MODIFICATO_NEL_FRATTEMPO senza updateMany`; `nessuna
    modifica → nessun updateMany né audit, restituisce la vista`; `campo non ammesso in ACTIVE →
    409 col messaggio delle etichette`; `dati non validi → 400 con message array`; `controparte
    cambiata → assertPartiEsistono sui valori nuovi (registro del nuovo tipo)`; `scrive solo i
    campi cambiati, con versione increment e condizione su id, tenantId, versione,
    eliminatoIl null`; `updateMany count 0 → 409 MODIFICATO_NEL_FRATTEMPO`; `audit
    CONTRATTO_MODIFICATO con campi, prima e dopo dei soli cambiati, nella stessa transazione`;
    `P2002 → 409 CONTRATTO_NUMERO_DUPLICATO`;
  - `elimina`: `ACTIVE → 409 CONTRATTO_NON_ELIMINABILE`; `versione diversa → 409`; `DRAFT →
    updateMany con eliminatoIl, eliminatoDa = utente, versione increment, condizione su stato
    eliminabile`; `count 0 → 409`; `audit CONTRATTO_ELIMINATO con numero e stato`;
  - `changeStatus`: `scrive con updateMany condizionato sulla versione letta e la incrementa`;
    `count 0 → 409 MODIFICATO_NEL_FRATTEMPO`; i 4 test esistenti (`:53-84`) adattati a
    `updateMany` restano verdi.
- [ ] **Step 2:** `npx jest -w 2 src/application/contracts`: FAIL.
- [ ] **Step 3: implementare.** `findOrFail` con `eliminatoIl: null`; `vista(c)` privata che
  toglie i due campi e aggiunge `modificabili = motivoNonModificabile(stato) ? [] :
  [...CAMPI_MODIFICABILI[stato]]` ed `eliminabile = motivoNonEliminabile(stato) === null`;
  `update` nell'ordine di D4 con la scrittura di D7 e l'audit di D8; `elimina` come D3/D7/D8;
  `changeStatus` con `updateMany` condizionato (e restituisce `findOrFail` dopo la scrittura);
  `create` chiama `validaDatiContratto(normalizzaDati(...))` prima delle parti. P2002 riconosciuto
  con `Prisma.PrismaClientKnownRequestError` e `code === 'P2002'`. Log `info` senza dati
  fiscali (`Contratto <id> modificato: <campi>`).
- [ ] **Step 4: test Postgres** `contract.service.postgres.spec.ts` (ruolo app, contesto per
  tenant, utente creato dal proprietario, fixture con `creaDittaConRuolo`; servizio costruito
  come nello spec MUD `:74`):
  - `modifica di una bozza: versione 2, campi aggiornati, updatedAt cambiato, una riga di audit`;
  - `due modifiche con la stessa versione: una riesce, l'altra 409` (`Promise.allSettled`, una
    `fulfilled` e una `rejected` con status 409; versione finale 2);
  - `una modifica letta prima di un cambio di stato riceve 409` (lettura → `changeStatus` DRAFT →
    PENDING_APPROVAL → `update` con la versione letta);
  - `contratto attivo: prezzo e fine modificabili, produttore no (409)`;
  - `numero già usato da un contratto eliminato: 409 CONTRATTO_NUMERO_DUPLICATO`;
  - `eliminato: sparisce da list, getById 404, changeStatus 404, update 404, seconda elimina
    404`, e la riga resta nel database con `eliminato_il` ed `eliminato_da` (lettura owner);
  - `contratto attivo non si elimina (409) e resta invariato`;
  - `nel contesto di B la modifica e la cancellazione di un contratto di A danno 404`.
- [ ] **Step 5:** unitari e Postgres PASS (guardia 55440); suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(contratti): modifica con lock ottimistico, cancellazione logica e audit" -- apps/backend/src/application/contracts/contract.service.ts apps/backend/src/application/contracts/contract.service.spec.ts apps/backend/src/application/contracts/contract.service.postgres.spec.ts`

## Task 4: API — `PATCH /contracts/:id` e `DELETE /contracts/:id`

**File:**
- Create: `apps/backend/src/application/contracts/dto/modifica-contratto.dto.ts`
- Create: `apps/backend/src/application/contracts/dto/modifica-contratto.dto.spec.ts`
- Modify: `apps/backend/src/application/contracts/contract.controller.ts`
- Modify: `apps/backend/src/application/contracts/contract.controller.spec.ts`

**Interfaces:**
- Consumes: `ContractService.update`, `ContractService.elimina` (Task 3).
- Produces: `class ModificaContrattoDto extends PartialType(OmitType(CreateContractDto,
  ['pricingConfig'] as const))` (da `@nestjs/swagger`) con in più `@IsInt() @Min(1) versione:
  number`. Rotte: `PATCH /contracts/:id` → 200 `ContrattoVista`; `DELETE
  /contracts/:id?versione=<n>` → 204.

- [ ] **Step 1: test che falliscono.** DTO (con `plainToInstance` + `validate`): `senza versione
  → errore su versione`; `versione 0 → errore`; `pricingConfig nel corpo → rifiutato da
  whitelist` (con `forbidNonWhitelisted` come in `main.ts`); `status nel corpo → rifiutato`;
  `il DTO accetta null su endDate e lo passa al servizio` (validazione senza errori, valore
  `null` conservato); `endDate '2026-13-01' → errore`. Controller: `update: usa l'azienda
  selezionata e l'utente della richiesta`; `update: converte startDate/endDate stringa in Date e
  lascia null come null e undefined come undefined`; `elimina: usa l'azienda selezionata, passa
  la versione numerica`; `PATCH :id e DELETE :id hanno @Roles SUPER_ADMIN, ADMIN, OPERATOR`
  (lettura dei metadata con `Reflector`); il test esistente `senza azienda determinabile: 403`
  esteso alle due rotte nuove.
- [ ] **Step 2:** `npx jest -w 2 src/application/contracts`: FAIL.
- [ ] **Step 3: implementare.** DTO con commento di testa (D4: assente non cambia, `null` svuota
  i facoltativi; perché `OmitType` di `pricingConfig`). Nel controller, dopo `getById` e prima di
  `PATCH :id/status`: `@Patch(':id')` con `ParseUUIDPipe`, `@Roles(...)`, `@ApiOperation`
  ("Modifica un contratto: solo i campi inviati; `null` svuota un campo facoltativo") e
  `@ApiResponse` 200/400/403/404/409 coi codici di D9; `@Delete(':id')` con
  `@HttpCode(HttpStatus.NO_CONTENT)`, `@Query('versione', ParseIntPipe)`, stesse annotazioni.
  Conversione delle date in una funzione locale `comeData(v: string | null | undefined): Date |
  null | undefined`. `req.user.id` come `utenteId`.
- [ ] **Step 4:** test PASS; suite di fine task backend.
- [ ] **Step 5: commit**
  `git commit -m "feat(contratti): rotte di modifica e cancellazione del contratto" -- apps/backend/src/application/contracts/dto/modifica-contratto.dto.ts apps/backend/src/application/contracts/dto/modifica-contratto.dto.spec.ts apps/backend/src/application/contracts/contract.controller.ts apps/backend/src/application/contracts/contract.controller.spec.ts`

## Task 5: frontend — servizio e dialog in modalità modifica

**File:**
- Modify: `apps/frontend/src/app/features/contracts/contracts.service.ts`
- Create: `apps/frontend/src/app/features/contracts/contracts.service.spec.ts`
- Modify: `apps/frontend/src/app/features/contracts/contract-create-dialog.component.ts`
- Modify: `apps/frontend/src/app/features/contracts/contract-create-dialog.component.spec.ts`

**Interfaces:**
- Consumes: le rotte del Task 4, la vista di D10.
- Produces:
  - in `Contract`: `versione: number`, `modificabili: CampoContratto[]`, `eliminabile: boolean`;
    `export type CampoContratto = …` (stessi 17 valori del backend);
    `export type ModificaContrattoDto = Partial<{ [K in keyof CreateContractDto]: CreateContractDto[K] | null }> & { versione: number }`
    (senza `pricingConfig`);
  - `ContractsService.update(id: string, dto: ModificaContrattoDto): Observable<Contract>` (PATCH);
  - `ContractsService.elimina(id: string, versione: number): Observable<void>` (DELETE con
    `params versione`);
  - nel dialog: `@Input() contratto: Contract | null = null` (null = creazione),
    `@Output() modificato = new EventEmitter<void>()` (`creato` resta per la creazione),
    metodo `salva()` che chiama `crea()` o `modifica()`, `campoBloccato(campo: CampoContratto):
    boolean`.

- [ ] **Step 1: test che falliscono.** Servizio (`HttpTestingController`): `update fa PATCH su
  /contracts/:id col corpo`; `elimina fa DELETE con ?versione=3`. Dialog:
  - `con un contratto in ingresso il titolo è "Modifica contratto" e il form è precompilato`
    (numero, tipo, produttore, controparte, CER, date come `Date`, registro della controparte
    dedotto da `counterpartyType`: `TRANSPORTER` → `trasportatori`, `DISPOSER` → `destinatari`);
  - `in modifica non chiede il prossimo numero` (`nextNumber` non chiamato);
  - `contratto attivo: produttore, controparte, tipo, numero e data di inizio disabilitati`
    (da `modificabili` del contratto, nessuna regola scritta nel frontend);
  - `salva in modifica manda solo i campi cambiati più la versione` (cambio del prezzo → corpo
    `{ basePrice: 130, versione: 4 }`);
  - `togliere la data di fine manda endDate null`;
  - `nessun cambiamento: non chiama update e chiude con un avviso "Nessuna modifica da salvare"`;
  - `409 CONTRATTO_MODIFICATO_NEL_FRATTEMPO: toast col messaggio del backend ed emette
    modificato` (la lista ricarica);
  - `400 CONTRATTO_NON_VALIDO: toast coi messaggi del backend, dialog resta aperto`;
  - i 20 test esistenti della creazione restano verdi.
- [ ] **Step 2:** Karma mirato non disponibile: si scrive tutto e si lancia una volta a fine task.
- [ ] **Step 3: implementare.** Header del `p-dialog` da `contratto ? 'Modifica contratto' :
  'Nuovo contratto'`; etichetta del pulsante "Salva modifiche" / "Crea contratto"; `[disabled]`
  sui campi da `campoBloccato`; in modifica il cambio di tipo contratto è possibile solo se
  `contractType` è modificabile (stessa logica di azzeramento della controparte di oggi). Il
  calcolo dei campi cambiati è locale al componente (confronto col contratto ricevuto: date per
  giorno ISO, CER come insieme, stringhe col trim): è solo per non mandare un corpo inutile, la
  decisione resta del backend. Messaggi d'errore presi da `error.error.message` (stringa o
  array), mai id. Commento di testa aggiornato (creazione e modifica, D10).
- [ ] **Step 4:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 5: commit**
  `git commit -m "feat(contratti): dialog di modifica del contratto" -- apps/frontend/src/app/features/contracts/contracts.service.ts apps/frontend/src/app/features/contracts/contracts.service.spec.ts apps/frontend/src/app/features/contracts/contract-create-dialog.component.ts apps/frontend/src/app/features/contracts/contract-create-dialog.component.spec.ts`

## Task 6: frontend — Modifica ed Elimina nella lista

**File:**
- Modify: `apps/frontend/src/app/features/contracts/contracts-list.component.ts`
- Create: `apps/frontend/src/app/features/contracts/contracts-list.component.spec.ts`

**Interfaces:**
- Consumes: `ContractsService.getById`, `ContractsService.elimina`, il dialog del Task 5
  (`[contratto]`, `(modificato)`).
- Produces: metodi `apriModifica(c: Contract): void`, `chiediEliminazione(c: Contract): void`.

- [ ] **Step 1: test che falliscono:**
  - `il pulsante Modifica è disabilitato se modificabili è vuoto, col tooltip del motivo`
    (`PENDING_APPROVAL`: "Riporta il contratto in bozza per modificarlo"; scaduto/cessato:
    "Un contratto scaduto o cessato non si modifica");
  - `il pulsante Elimina compare solo se eliminabile`;
  - `apriModifica rilegge il contratto con getById prima di aprire il dialog` (versione
    aggiornata, come il FIR `fir-list.component.ts:1871`);
  - `chiediEliminazione chiede conferma col numero del contratto e, se confermata, chiama
    elimina con la versione e ricarica la lista`; `se annullata non chiama elimina`;
  - `dopo un 409 la lista si ricarica` (eliminazione con risposta 409: toast col messaggio del
    backend e `loadContracts` chiamato);
  - `dopo una modifica riuscita la lista si ricarica`.
- [ ] **Step 2:** si lancia Karma a fine task.
- [ ] **Step 3: implementare.** Colonna Azioni più larga (tre pulsanti icona: `pi pi-pencil`
  "Modifica", `pi pi-sync` "Cambia stato", `pi pi-trash` "Elimina", con `ariaLabel` che cita il
  numero); `ConfirmationService` nei `providers` del componente e `p-confirmDialog` nel template;
  testo di conferma "Eliminare il contratto <numero>? Il contratto non comparirà più
  nell'elenco; il numero resta riservato."; toast di successo "Contratto eliminato" / "Contratto
  modificato". Il dialog di creazione riceve `[contratto]="contrattoInModifica"` e si apre sia da
  "Nuovo contratto" (con `null`) sia da "Modifica".
- [ ] **Step 4:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 5: commit**
  `git commit -m "feat(contratti): modifica ed eliminazione dalla lista dei contratti" -- apps/frontend/src/app/features/contracts/contracts-list.component.ts apps/frontend/src/app/features/contracts/contracts-list.component.spec.ts`

## Task 7: chiusura e verifica finale

**File:** nessuno nuovo; eventuali correzioni ai file dei task precedenti.

- [ ] **Step 1:** dalla radice del worktree, `git diff --stat 692880e..HEAD`: solo i file elencati
  nei Task 1-6 (nessuna area esclusa toccata).
- [ ] **Step 2:** backend completo: `test:cov`, `tsc`, eslint globale backend 0 errori,
  `npm run test:postgres` intera (guardia 55440) confrontata con la linea di base del Task 0.
- [ ] **Step 3:** frontend: Karma completo, `npm run build`, eslint
  `npx eslint "apps/frontend/src/app/features/contracts/**/*.ts" --max-warnings=-1`.
- [ ] **Step 4:** `migrate diff` vuoto un'ultima volta; `rls-catalogo` a 35.
- [ ] **Step 5: rapporto** all'orchestratore: commit, test rossi preesistenti, le 5 decisioni da
  confermare con la scelta applicata, la nota di rollback (contratti eliminati che ricompaiono
  col codice vecchio), la prova manuale consigliata dopo il merge (creare, modificare in bozza,
  attivare, modificare il prezzo, provare a cambiare il produttore → 409, eliminare una bozza,
  due schede sullo stesso contratto → 409).

## Ordine

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7, uno alla volta. Il 2 non dipende dal 1 (puro) ma resta in
sequenza per non avere due agenti col jest acceso; il 3 ha bisogno di entrambi; 5 e 6 hanno
bisogno della vista del Task 3 e delle rotte del Task 4.

## Fuori ambito (seguiti)

- Contratto cliente, anagrafica cliente, listino, legame con i movimenti, valorizzazione: 4.1-4.4
  (D13). Nessun campo di 4.1 si aggiunge a `Contract`.
- Chiavi esterne verso produttore e controparte, e blocco della cancellazione di un'anagrafica
  che ha contratti (raccomandazione 5).
- Audit del cambio di stato e `versione` nella richiesta di `PATCH :id/status`.
- Controllo che i CER del contratto esistano nel catalogo.
- Pulizia massiva dei contratti vecchi (equivalente di `cancellacontratti`) e ripristino di un
  contratto eliminato.
- Uso di `auto-fill` nel form del FIR (oggi l'endpoint non ha chiamanti nel frontend).
- Spec Playwright sui contratti: non c'è una cartella e2e dei contratti e lo stack completo non
  gira in locale con 16 GB; la copertura è nei test Postgres del Task 3 e in Karma. Da aggiungere
  in `e2e/tests/` quando si farà 4.1 (stesso dominio).
