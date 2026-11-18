# Controparte strutturata del movimento (`counterpart_sede_id`) — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa un task alla
> volta. Opus rivede ogni task prima di passare al successivo. Una sola PR dal branch
> `feat/counterpart-sede-id` (base master `7b708fdf`). I comandi pesanti (jest completo, Karma,
> Postgres) girano **uno alla volta**.

**Obiettivo.** Il movimento del registro salva il riferimento strutturato alla sede della ditta
controparte. Così O.R.SO. dettagliata non deve più indovinare il soggetto dal nome. Elimina alla
radice N1, N2 e N4 della review `~/.claude/state/orchestrazione/report/rifiuti/2026-11-14-review-4-9cdef-verifica.md`
(sezione C) per tutti i movimenti registrati da qui in poi. Nel ripiego per nome (movimenti
storici) si preferiscono le sedi attive (N3).

**Decisione di Graziano (18/11).** Colonna nullable `waste_movements.counterpart_sede_id`.
- FK composta `(counterpart_sede_id, tenant_id) → sedi_ditte(id, tenant_id)`.
- **Fuori dall'hash** di vidimazione.
- Valorizzata dal form del registro: `onProduttoreSelect` e `applicaControparteDaFir`.
- Il resolver dei soggetti la usa per prima. Il nome resta il ripiego per i movimenti storici.

**Architettura in breve.**
- **DB:** una migration additiva. Colonna, FK `NOT VALID` + `VALIDATE`, `lock_timeout`. Nessun
  indice, nessun backfill, nessuna tabella nuova: il conteggio RLS resta 88.
- **Registro:** il DTO, il command e il use-case della registrazione accettano `counterpartSedeId`
  facoltativo. La sede deve esistere nell'azienda; altrimenti 400 e nessuna riga scritta.
- **Rettifica:** regola di propagazione pura (D3). L'annullamento copia il valore alla lettera.
- **Comunicazioni:**
  - `lettore-movimenti-orso` legge la colonna;
  - `lettore-dettagli-tracciato` carica quelle sedi e aggiunge `attiva` a `SedeDettaglio`;
  - `soggetti-orso` usa questo ordine: colonna → FIR → nome, e nel ripiego preferisce le sedi attive.
- **Frontend:** un helper puro decide se inviare la sede. La sede scelta vale solo finché nome e
  indirizzo restano quelli compilati dalla scelta.

**Stack.** NestJS 10 + Prisma 5.22 + PostgreSQL 16 (RLS FORCE), Angular + PrimeNG.

---

## Stato di partenza (verificato sul worktree)

- **Hash.** `hashAnnotazioneV2` (`domain/waste-movement/waste-movement.entity.ts:96`) contiene:
  `v2`, hash precedente, registro, anno, numero, tipo di annotazione, predecessore, tipo, CER,
  quantità, unità, data, causale. **Nessun campo di controparte.** La colonna nuova resta fuori
  per costruzione. `verifica-catena-registro.service.ts` non cambia.
- **Scrittura.** Le annotazioni si scrivono solo con `inserisciAnnotazione`
  (`application/registro/numerazione-annotazione.ts:63`). Due chiamanti: registra (`:368`) e
  correggi (`:315`). Mai UPDATE (R13).
- **Rettifica.** `RettificaMovimentoDto` = `OmitType(RegistraMovimentoDto, [type, registroId, firId,
  registrationDate])`. Il controller passa `...resto` in `dati`, quindi un campo aggiunto a
  `RegistraMovimentoDto` arriva da solo in `DatiRettifica`. `originale` si legge con `findFirst`
  senza `select`, quindi la colonna c'è dopo `prisma generate`.
- **Finestra di rettifica (frontend).** `correggi-movimento-dialog.component.ts` ha nome e
  indirizzo a testo libero e **nessuna scelta dall'anagrafica**.
- **Resolver.** `soggetti-orso.ts`:
  - `sedeDelMovimento`: con FIR usa `producerSedeId`/`receiverSedeId` (ripiego sul ruolo di
    anagrafica); senza FIR usa `sedeDaControparte` per nome.
  - N1 è già corretto in parte: con una sola candidata, il comune deve comparire nell'indirizzo.
  - N3 è aperto: `SedeDettaglio` non ha `attiva`.
  - N2 è aperto: in `lettore-dettagli-tracciato.ts` c'è `equals` insensitive sul nome compattato.
- **Indirizzo del produttore (N4).** `indirizzoProduttore` del frontend usa `p.sedeLegale` (colonne
  congelate). `Produttore.sedeId` (sede predefinita del ruolo) è già nel modello frontend.
  `ParteFIR.sedeId` c'è per produttore e destinatario, ma manca sui FIR precedenti.
- **FK verso le sedi.** Precedente con FK: `ritiri_produttore_sede_fkey` `(produttore_sede_id,
  tenant_id) → sedi_ditte(id, tenant_id)`, NO ACTION. I FIR invece **non** hanno FK sulle sedi
  (snapshot). Le sedi non si cancellano mai, si disattivano. Nessun servizio cancella le ditte.
- **Import WinWaste (Fase 3).** Su master ci sono parser, staging e motore di caricamento (provato
  sulle ditte). **Nessun caricatore scrive in `waste_movements`.**
  `test-support/migrazione/movimento-importato.ts` crea movimenti con campi espliciti: la colonna
  nullable non lo rompe.
- **Guardie.**
  - `lettori-movimenti.spec.ts`: nessun file nuovo legge `waste_movements` (si toccano solo
    lettori già in elenco).
  - `rls-catalogo.postgres.spec.ts` conta le tabelle con `tenant_id` (88): una colonna non lo
    cambia, quindi nessuna modifica.
  - `prisma-rls.extension.ts`: nessun modello nuovo.
- **Ultima migration:** `20261114140500_lotti_import_transizioni`.

## Decisioni (vincolanti)

**D1. Schema.**
- `counterpartSedeId String? @map("counterpart_sede_id") @db.Uuid`.
- Relazione `counterpartSede SedeDitta? @relation("MovimentiControparteSede", fields:
  [counterpartSedeId, tenantId], references: [id, tenantId], onDelete: NoAction, onUpdate: NoAction,
  map: "waste_movements_counterpart_sede_fkey")`.
- Inversa `movimentiControparte WasteMovement[] @relation("MovimentiControparteSede")` in fondo a
  `SedeDitta`.
- **Nessun indice.** Nessuna query filtra per sede. La FK non ne ha bisogno, perché `id` e
  `tenant_id` delle sedi non si aggiornano e le sedi non si cancellano. Un `CREATE INDEX` su una
  tabella viva in una migration transazionale bloccherebbe le scritture durante la costruzione. Si
  documenta nel commento della migration.
- **NO ACTION**, come le altre FK del movimento: la cascata da `tenants` toglie movimenti e sedi
  nello stesso statement.

**D2. Registrazione.**
- `counterpartSedeId` facoltativo (`@IsOptional() @IsUUID()`); null e assente valgono «nessuna
  sede».
- Nella transazione, prima della numerazione: `tx.sedeDitta.findFirst({ where: { id, tenantId },
  select: { id: true } })`. Se manca: `Result.fail('Sede della controparte non trovata
  nell'azienda')` → 400, niente scritto.
- **Nessun controllo** di coerenza fra nome e ragione sociale della ditta: niente blocchi falsi.
  Ci pensa il frontend (D5).
- **Una sede disattivata si accetta** (Q2).
- Il backend **non** ricava la sede dal FIR: il resolver ha già il ripiego sul FIR.

**D3. Rettifica e annullamento.** La rettifica è una nuova annotazione con i dati completi (R4).
- **Annullamento:** copia alla lettera, come gli altri campi.
- **Rettifica:** la decide la funzione pura `sedeControparteRettifica(originale, dati)`:
  - `dati.counterpartSedeId` è una stringa → si usa (validata come in D2);
  - è `null` → nessuna sede (azzeramento esplicito);
  - è `undefined` → si **propaga** la sede del predecessore **solo se** nome e indirizzo della
    controparte, compattati (`trim`, spazi singoli, maiuscole ignorate), sono uguali a quelli del
    predecessore; altrimenti `null`.

*Perché non propagare sempre:* un nome cambiato con un id vecchio direbbe il falso in silenzio.
Questo è proprio il difetto N1 che si vuole eliminare. Con `null` si torna al ripiego per nome, che
è prudente.

*Perché non ricalcolare sempre:* la finestra di rettifica non ha la scelta della ditta. La
correzione più comune (quantità o data) perderebbe il riferimento senza motivo.

La finestra di rettifica del frontend **non cambia**: non manda il campo, quindi vale la propagazione.

**D4. Resolver.**
- Ordine in `sedeDelMovimento`:
  1. `m.sedeControparteId`, se la sede è fra quelle caricate (anche se disattivata: era quella
     scelta);
  2. il FIR come oggi;
  3. il nome.
- Se l'id c'è ma la sede non si carica (non succede, per la FK), si passa al punto 2 e poi al 3.
- La colonna vince sul FIR perché è la scelta esplicita fatta nel form; di solito i due valori
  coincidono.
- Nel ripiego per nome (N3): `candidate` = sedi attive della ditta se ce n'è almeno una,
  altrimenti tutte.
- I movimenti con la colonna non mandano il nome alla ricerca `controparti` (meno query).

**D5. Frontend.**
- Un campo del componente (non un controllo del form): `sceltaControparte: { sedeId, nome,
  indirizzo } | null`. Lo impostano:
  - `onProduttoreSelect`, con `p.sedeId` e i testi appena compilati;
  - `applicaControparteDaFir`, con `parte?.sedeId`.
- All'invio, l'helper puro `sedeControparteDaInviare(scelta, nome, indirizzo)` restituisce
  `sedeId` solo se nome e indirizzo correnti, compattati, coincidono con quelli della scelta;
  altrimenti `undefined`.
- Niente `valueChanges`, perché `patchValue` emette per ogni controllo e l'ordine delle chiavi
  azzererebbe la sede appena scelta.

**D6. Messaggio.** Aggiungere a `SOGGETTO_NON_IDENTIFICATO` (`comunicazioni-orso.service.ts:105`)
questa frase: «I movimenti registrati scegliendo la ditta dall'anagrafica o da un FIR usano la sede
scelta; il confronto per nome vale solo per i movimenti precedenti.»

## Cosa NON fare

- **Nessun backfill** dei movimenti storici nella migration né nel piano principale (vedi Q3 e
  «Opzione separata»).
- Nessuna modifica a `hashAnnotazioneV2`, `WasteMovement.computeHash`, `HASH_VERSIONE_CORRENTE`,
  `verifica-catena-registro.service.ts`.
- Nessun indice, CHECK o trigger nuovo su `waste_movements`. Nessuna colonna resa NOT NULL.
- Non cambiare l'indirizzo che il registro scrive per il produttore (resta `sedeLegale`, Q1).
- Non toccare FIR (`application/fir/**`, `domain/fir/**`), RENTRI, MUD, CONOU, COBAT, O.R.R.
- Non toccare la finestra di rettifica del frontend.
- Mai `prisma migrate reset` né `db push --force-reset`.
- Non usare `valueChanges` per azzerare la sede nel form (D5).

## Vincoli globali

- Prisma 5.22 dal pacchetto installato. Dopo la modifica dello schema: `npx prisma generate`.
- **Migration solo additiva:**
  - `SET LOCAL lock_timeout = '5s'` in testa;
  - commento «Cosa fa / Additiva / Ripristino», come `20261030100000_causali_registro`;
  - si applica con `npx prisma migrate deploy`.
- **Database di test:** `wasteflow-pg-test-controparte` su `127.0.0.1:55456`. Il container esiste già (creato dal coordinatore): non ricrearlo. Prima di partire,
  controllare con `ss -ltn` che la porta sia libera.
  `docker run -d --name wasteflow-pg-test-controparte -p 127.0.0.1:55456:5432 -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_test -e POSTGRES_DB=wasteflow_ci -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 postgres:16-alpine`
- **Test Postgres** col ruolo `wasteflow_app` (`creaPrismaServiceApplicativo()`,
  `TenantContext.run`):
  `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`.
  - Preparazione e pulizia col proprietario, solo per id esatti.
  - In pulizia, cancellare i movimenti **prima** delle sedi: la FK è NO ACTION.
- **Backend:**
  - `npx jest -w 2 <percorsi>`;
  - a fine task `npx tsc --noEmit -p tsconfig.json` ed eslint dei file toccati;
  - una volta in T7: `npm run test:cov` (con `NODE_ENV=test
    JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod`) e `npx eslint "{src,test}/**/*.ts"
    --max-warnings=-1`.
- **Frontend:** mai la porta 4200. Karma `npx ng test --watch=false` una volta per task frontend.
- **Task con migration:**
  - `npx prisma validate`;
  - `migrate deploy` su 55456;
  - `ops/db-ruoli.sh` con `PG_EXEC="docker exec -i wasteflow-pg-test-controparte"`;
  - `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel
    prisma/schema.prisma --shadow-database-url …` → vuoto.
- **Convivenza:** se master riceve una migration con timestamp successivo, rinominare la nostra
  (mai applicata in produzione).
- Commit in italiano con i termini tecnici in inglese, senza attribuzione AI. Niente push senza
  richiesta.

## Review focus

1. **Hash invariato:** stesso `entryHash` con e senza sede. `verifica-catena` resta integra sui
   registri che contengono righe con la sede (T2).
2. **Isolamento:** una sede di un'altra azienda → 400 e nessuna riga scritta. La FK composta
   rifiuta l'insert diretto anche col proprietario (T1, T2).
3. **Rettifica:** la sede si propaga solo con nome e indirizzo invariati. L'annullamento copia (T3).
4. **Resolver:** colonna → FIR → nome. Il caso N1 (una sola candidata a Calliano TN, sede scelta
   un'altra) dà la sede scelta. Nel ripiego vincono le sedi attive (T5).
5. **Frontend:** modificare a mano nome o indirizzo dopo la scelta fa sparire la sede dal payload (T6).
6. **Migration:** additiva, senza indice, `lock_timeout`, `migrate diff` vuoto (T1).

---

## Task T0: ambiente e linea di base

**File:** nessuno.

- [ ] Container `wasteflow-pg-test-controparte` (Vincoli globali). `.env` del backend su 55456
  (`git check-ignore -v apps/backend/.env`).
- [ ] `node_modules` presenti (altrimenti `npm ci`). Poi `npx prisma generate`, `migrate deploy`,
  `ops/db-ruoli.sh`, seed.
- [ ] Linea di base, annotando i test già rossi:
  - `npm run test:postgres` intera;
  - `npm run test:cov`;
  - Karma del frontend.

**Fatto quando:** linea di base annotata nel rapporto del task e repository non modificato.

## Task T1: migration e schema

**Dipende da T0.** **File:**
- `apps/backend/prisma/migrations/20261118100000_movimenti_sede_controparte/migration.sql`;
- `apps/backend/prisma/schema.prisma` (`WasteMovement`: campo, relazione, commento «fuori
  dall'hash»; `SedeDitta`: inversa in fondo);
- `apps/backend/src/application/registro/sede-controparte.schema.postgres.spec.ts` (nuova).

- [ ] **Test prima (rosso):** spec di schema col proprietario.
  - La colonna esiste ed è nullable, `uuid`.
  - Esiste `waste_movements_counterpart_sede_fkey`, con `confdeltype = 'a'` e colonne
    `(counterpart_sede_id, tenant_id)` (da `pg_constraint`).
  - Un insert con la sede di **un'altra azienda** → violazione FK (23503).
  - Un insert con un id inesistente → 23503. Con NULL va bene.
  - Con il ruolo `wasteflow_app` sotto RLS, una riga con la sede della propria azienda si scrive
    e si rilegge.
  - Nessun indice sulla colonna (`pg_index`): fissa la decisione D1.
- [ ] Migration, nell'ordine:
  1. `SET LOCAL lock_timeout = '5s'`;
  2. `ALTER TABLE "waste_movements" ADD COLUMN "counterpart_sede_id" UUID`;
  3. `ADD CONSTRAINT … FOREIGN KEY ("counterpart_sede_id","tenant_id") REFERENCES
     "sedi_ditte"("id","tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID`;
  4. `VALIDATE CONSTRAINT`.
- [ ] Nel commento: nessun backfill, nessun indice (motivo D1), colonna fuori dall'hash, ripristino a
  mano (`DROP CONSTRAINT`, `DROP COLUMN`, solo se nessuna riga ha la colonna valorizzata), P3009
  (`migrate resolve --rolled-back`).
- [ ] `npx prisma generate`, `validate`, `migrate deploy`, `migrate diff` vuoto. `rls-catalogo`
  invariato (88): eseguirlo per conferma.

**Verifica:** `npx jest -c jest.postgres.config.js --runInBand --forceExit
src/application/registro/sede-controparte.schema.postgres.spec.ts
src/infrastructure/persistence/rls-catalogo.postgres.spec.ts`; `npx tsc --noEmit -p tsconfig.json`.

**Fatto quando:** le due spec sono verdi, `migrate diff` è vuoto e `tsc` passa.

## Task T2: registrazione con la sede della controparte

**Dipende da T1.** **File:**
- `api/registro/dtos/registra-movimento.dto.ts` (+ `.spec.ts`);
- `application/registro/commands/registra-movimento.command.ts` (parametro facoltativo **in coda**,
  dopo `legame`, così le 22 chiamate esistenti non cambiano);
- `api/registro/registro.controller.ts` (passa `dto.counterpartSedeId`);
- `domain/waste-movement/waste-movement.entity.ts` (prop `counterpartSedeId?: string | null`, con
  commento «non entra nell'hash»);
- `application/registro/use-cases/registra-movimento.use-case.ts` (controllo D2 + insert);
- `registra-movimento.use-case.spec.ts`, `registra-movimento.use-case.postgres.spec.ts`,
  `domain/waste-movement/waste-movement.entity.spec.ts` (o lo spec esistente dell'entità).

- [ ] **Test prima:**
  - DTO: UUID accettato; stringa non UUID → errore; assente e null accettati.
  - Entità: `WasteMovement.create` con e senza `counterpartSedeId` dà **lo stesso `entryHash`**.
  - Unit del use-case: sede non trovata → `isFailure` con il messaggio di D2, nessun
    `inserisciAnnotazione`.
  - Postgres (ruolo app):
    - registra con la sede → colonna salvata;
    - sede di un'altra azienda → failure e nessuna riga;
    - senza sede → NULL;
    - `VerificaCatenaRegistroService.verifica` sul registro → `primoErrore === null`.
- [ ] Implementazione D2: controllo della sede **dentro** la transazione, prima di
  `numeraAnnotazione`, così un errore non consuma il progressivo. Poi `counterpartSedeId` in
  `inserisciAnnotazione`.
- [ ] Controllare che `lettori-movimenti.spec.ts` resti verde (nessun lettore nuovo).

**Verifica:** `npx jest -w 2 src/api/registro src/application/registro/use-cases/registra-movimento.use-case.spec.ts src/domain/waste-movement src/application/registro/lettori-movimenti.spec.ts`;
la spec Postgres della registrazione e `verifica-catena-registro.service.postgres.spec.ts`; `tsc`.

**Fatto quando:** le spec sono verdi, l'hash è dimostrato invariato e `tsc` ed eslint dei file
toccati passano.

## Task T3: rettifica e annullamento (D3)

**Dipende da T2.** **File:**
- `application/registro/sede-controparte-rettifica.ts` + `.spec.ts` (nuovi, puri, nessuna query);
- `application/registro/use-cases/correggi-movimento.use-case.ts` (`DatiRettifica`,
  `DatiAnnotazione`, `datiNuovi`, insert, validazione della sede passata in modo esplicito come in
  D2);
- `correggi-movimento.use-case.spec.ts`, `correggi-movimento.use-case.postgres.spec.ts`.

- [ ] **Test prima (unit puri):**
  - stringa → quella;
  - `null` → null;
  - `undefined` con nome e indirizzo uguali (anche con maiuscole o doppi spazi diversi) → sede del
    predecessore;
  - nome diverso → null; indirizzo diverso → null;
  - predecessore senza sede → null.
- [ ] **Test Postgres:**
  - rettifica della sola quantità → la sede si propaga;
  - rettifica con nome cambiato → NULL;
  - rettifica con sede esplicita di un'altra azienda → 400 e nessuna riga;
  - annullamento → copia;
  - `verifica-catena` integra dopo la catena.
- [ ] Il controller non cambia: `...resto` porta già il campo. Lo prova un test in
  `registro.controller.spec.ts`: `dati.counterpartSedeId` passato.

**Verifica:** `npx jest -w 2 src/application/registro/sede-controparte-rettifica.spec.ts
src/application/registro/use-cases/correggi-movimento.use-case.spec.ts
src/api/registro/registro.controller.spec.ts`; poi la spec Postgres della correzione; `tsc`.

**Fatto quando:** le spec sono verdi, `lettori-movimenti.spec.ts` è verde e i file toccati passano
eslint.

## Task T4: lettori delle comunicazioni

**Dipende da T1** (in parallelo a T2 e T3: file diversi; la PR resta unica). **File:**
- `application/comunicazioni/lettore-movimenti-orso.ts`:
  - `select` + `counterpartSedeId` nel tipo grezzo;
  - `MovimentoOrso.sedeControparteId: string | null`, con il commento «sede scelta nel form; null
    per i movimenti storici».
- `application/comunicazioni/lettore-dettagli-tracciato.ts`:
  - `RichiestaDettagli.movimenti[].sedeControparteId?`, aggiunto a `sedeIds`;
  - `SedeDettaglio.attiva: boolean`.
- `lettore-movimenti-orso.postgres.spec.ts`, `lettore-dettagli-tracciato.postgres.spec.ts`.
- I fixture che costruiscono `SedeDettaglio` a mano (`soggetti-orso.spec.ts`, `preparatore-*.spec.ts`,
  `costruisci-file-orr.spec.ts`: trovarli con `grep -rln "principale:" src/application/comunicazioni`)
  ricevono `attiva: true`.

- [ ] **Test prima:**
  - il lettore dei movimenti restituisce `sedeControparteId` (valorizzato e NULL);
  - il lettore dei dettagli carica in `sedi` la sede della colonna anche senza FIR e senza nome;
  - `attiva` riflette il DB (una sede disattivata ha `attiva: false`);
  - una sede di un'altra azienda non compare: il filtro per `tenantId` resta.
- [ ] Il numero di query resta fisso: la sede della colonna entra nella stessa `findMany` per `id`.

**Verifica:** le due spec Postgres; `npx jest -w 2 src/application/comunicazioni`; `tsc`.

**Fatto quando:** le spec sono verdi, la suite unit di `comunicazioni` è verde e `tsc` passa.

## Task T5: resolver dei soggetti (D4) e servizio O.R.SO. dettagliata

**Dipende da T4.** **File:**
- `application/comunicazioni/soggetti-orso.ts` (+ `soggetti-orso.spec.ts`);
- `application/comunicazioni/comunicazioni-orso.service.ts`:
  - `sedeControparteId` passato nella richiesta dei dettagli e in `MovimentoPerSoggetto`;
  - `controparti` solo per `!m.firId && !m.sedeControparteId && m.controparte`;
  - messaggio D6.
- `comunicazioni-orso-dettagliata.service.postgres.spec.ts`.

- [ ] **Test prima (unit):**
  - **N1:** ditta «Comune di Calliano» con una sola sede (TN); movimento con nome uguale, indirizzo
    «…, Calliano (AT)» e `sedeControparteId` di un'altra sede → soggetto = sede scelta;
  - colonna e FIR diversi → vince la colonna;
  - colonna con id non caricato → ripiego su FIR, poi su nome;
  - sede scelta disattivata → si usa lo stesso;
  - **N3, ripiego:** due sedi della ditta, una attiva e una no, indirizzo vuoto → la sola attiva;
  - **N3, ripiego:** due attive e una disattivata → decide l'indirizzo come oggi;
  - **N3, ripiego:** solo sedi disattivate → comportamento di oggi su tutte;
  - **N2:** nome con doppi spazi salvato nel movimento e sede nella colonna → soggetto trovato
    (non serve il nome).
- [ ] **Test Postgres:** un movimento senza FIR registrato con la colonna (seed diretto) e uno
  storico omonimo senza colonna. Il primo ha il soggetto della sede scelta; il secondo segue il
  ripiego. Il numero di query a `ditte` resta zero se tutti i movimenti hanno la colonna.
- [ ] Aggiornare il commento in testa a `sedeDaControparte` e `sedeDelMovimento`, con l'ordine D4.

**Verifica:** `npx jest -w 2 src/application/comunicazioni src/domain/comunicazioni`; la spec
Postgres della dettagliata; `tsc`.

**Fatto quando:** le spec sono verdi e i test N1, N3 e «colonna vince» sono nominati nel titolo.

## Task T6: frontend del registro (D5)

**Dipende da T2** (API). **File:**
- `apps/frontend/src/app/features/registro/registro-controparte.ts` + `.spec.ts` (nuovi, puri):
  `SceltaControparte`, `sedeControparteDaInviare(scelta, nome, indirizzo)`, `compattaTesto`;
- `registro.service.ts` (`counterpartSedeId?: string` nell'input di `registra`);
- `registro.component.ts`:
  - campo `sceltaControparte`;
  - impostato in `onProduttoreSelect` (`p.sedeId`) e in `applicaControparteDaFir` (`parte?.sedeId`,
    `null` se assente);
  - azzerato in `chiudiForm` o nel reset del form;
  - payload: `counterpartSedeId: sedeControparteDaInviare(...)`.
- Spec del componente: aggiungere a `registro-fir.spec.ts` o a un nuovo
  `registro.component.controparte.spec.ts`, seguendo il pattern di `registro.component.sede.spec.ts`.

- [ ] **Test prima (puri):**
  - scelta null → undefined;
  - testi identici → sedeId;
  - maiuscole e spazi diversi → sedeId;
  - nome cambiato → undefined; indirizzo cambiato → undefined;
  - sedeId assente nella scelta → undefined.
- [ ] **Test del componente:**
  - produttore scelto e salvato → la richiesta ha `counterpartSedeId = p.sedeId`;
  - produttore scelto, poi nome modificato a mano → niente `counterpartSedeId`;
  - FIR collegato → `counterpartSedeId` = sede del produttore (CARICO) o del destinatario (SCARICO);
  - cambio di tipo con il FIR → si aggiorna.
- [ ] Nessuna modifica visiva, nessun controllo nuovo nel form, nessuna modifica a
  `correggi-movimento-dialog.component.ts`.

**Verifica:** `cd apps/frontend && npx ng test --watch=false`; `npx eslint` dei file toccati;
`npx tsc --noEmit -p tsconfig.app.json`.

**Fatto quando:** Karma è verde e il payload è dimostrato nei quattro casi.

## Task T7: verifica finale

**Dipende da T1-T6.** **File:** se serve, `e2e/tests/comunicazioni/orso-dettagliata.spec.ts`: un
movimento senza FIR registrato via `POST /registro/movimenti` con `counterpartSedeId`, il cui
soggetto compare nell'anteprima.

- [ ] Backend: `npm run test:postgres` intera, `npm run test:cov`, eslint completo, `tsc`. Il
  confronto con la linea di base T0 non deve mostrare nuovi rossi.
- [ ] Frontend: Karma intero.
- [ ] `migrate diff` vuoto. Controllo manuale del Review focus 1-6, con il rapporto per voce.
- [ ] Rapporto: file toccati, test aggiunti, test che dimostra l'hash invariato, residui (N2 e N3
  nel ripiego, Q1).

**Fatto quando:** tutto è verde e il rapporto è consegnato.

---

## Ordine e PR

T0 → T1 → (T2 → T3) ‖ T4 → T5 → T6 (dopo T2) → T7. Una PR: `feat(registro): sede della controparte
nel movimento (counterpart_sede_id)`.

## Rischi

- **Sede scelta e testo scritto divergono** (Q1, N4): il soggetto O.R.SO. è la sede predefinita del
  produttore, mentre il registro stampa l'indirizzo della sede legale. Coincidono per le ditte con
  una sola sede.
- **Client API terzi** che mandano un id di sede sbagliato ma della stessa azienda: il resolver gli
  crede. È accettato. L'alternativa (controllo del nome) produrrebbe blocchi falsi.
- **`VALIDATE CONSTRAINT`** scansiona `waste_movements` con il lock della `ADD COLUMN` ancora
  preso. La colonna è tutta NULL, quindi è veloce. Precedente: `causale_azienda_id`.
- **Pulizia dei test:** con la FK NO ACTION, una spec che cancella le sedi prima dei movimenti
  fallisce. Seguire l'ordine dei Vincoli.

## Opzione separata (non in questo piano): backfill dei movimenti storici

- **Movimenti con FIR:** inutile, il resolver usa già il FIR.
- **Movimenti senza FIR:** si dovrebbe dedurre la sede dal nome, cioè rifare l'euristica di N1 e
  N3, e scriverla con un UPDATE su righe di un registro vidimato (contro R13, anche se fuori
  dall'hash).

Se Graziano lo vuole: uno script a parte e idempotente, solo dove la corrispondenza è univoca
(nome compattato, una sola sede attiva, comune presente nell'indirizzo). Prima un report a secco,
poi l'esecuzione. Va in un pezzo separato.

## Seguiti

- **Import WinWaste (Fase 3):** quando arriva il caricatore dei movimenti, deve valorizzare
  `counterpart_sede_id` dalla chiave legacy della sede (`ditta|PRECOD|COD|UL`) se la sede è stata
  importata. Altrimenti NULL.
- **N2 nel ripiego:** `trim` e spazi singoli al salvataggio della ragione sociale della ditta,
  oppure ricerca più larga e confronto in memoria (Q4).
- **Selettore della sede nel form** (scegliere fra le sedi attive della ditta) e indirizzo scritto
  da quella sede: chiude N4 anche nel testo del registro.
- **Altri usi della colonna:**
  - `provinciaConferitore` in `lettore-movimenti-orso` (oggi FIR o sigla nell'indirizzo);
  - preparatori CONOU, COBAT e O.R.R.;
  - MUD (oggi per nome);
  - esporre `counterpartSedeId` nella lista e nel dettaglio dei movimenti.

## Domande per Graziano

- **Q1.** Con «Seleziona da anagrafica produttori», la colonna prende `Produttore.sedeId` (sede
  predefinita del ruolo). L'indirizzo scritto nel registro resta quello della sede legale. Va
  bene così per ora? *Raccomandazione:* sì. Non si cambia cosa scrive il registro in questo pezzo.
  Il selettore della sede con il suo indirizzo è un seguito.
- **Q2.** Alla registrazione si accetta una sede disattivata? *Raccomandazione:* sì, solo il
  controllo di appartenenza all'azienda. Bloccare romperebbe registrazioni tardive di conferimenti
  avvenuti quando la sede era attiva.
- **Q3.** Backfill dei movimenti storici? *Raccomandazione:* no in questo piano (vedi «Opzione
  separata»).
- **Q4.** Correggere ora N2 nel ripiego (trim della ragione sociale al salvataggio della ditta)?
  *Raccomandazione:* no, è un pezzo a parte. Tocca le anagrafiche, e con la colonna N2 riguarda
  solo i movimenti storici.

### Critical Files for Implementation
- /home/graziano/Progetti/rifiuti-wt-controparte/apps/backend/prisma/schema.prisma
- /home/graziano/Progetti/rifiuti-wt-controparte/apps/backend/src/application/registro/use-cases/correggi-movimento.use-case.ts
- /home/graziano/Progetti/rifiuti-wt-controparte/apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts
- /home/graziano/Progetti/rifiuti-wt-controparte/apps/backend/src/application/comunicazioni/soggetti-orso.ts
- /home/graziano/Progetti/rifiuti-wt-controparte/apps/backend/src/application/comunicazioni/lettore-dettagli-tracciato.ts
- /home/graziano/Progetti/rifiuti-wt-controparte/apps/frontend/src/app/features/registro/registro.component.ts

### Risposte di Graziano (18/11)

- Q1: sì, la colonna prende la sede predefinita del produttore; il selettore della sede arriva dopo.
- Q2: sì, una sede disattivata si accetta (solo controllo di appartenenza all'azienda).
- Q3: no backfill dei movimenti storici.
- Q4: N2 (trim della ragione sociale) in un pezzo a parte.
