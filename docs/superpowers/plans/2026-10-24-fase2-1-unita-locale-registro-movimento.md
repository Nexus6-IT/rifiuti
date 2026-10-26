# Fase 2, pezzo 1: unità locale e registro sul movimento, progressivo per registro (piano di implementazione)

> Rivisto il 2026-10-24 dopo `piani/revisione-roadmap-2026-10-24.md` e le decisioni del §10 (tabella "Decisioni del 2026-10-24" in `confronto-con-rifiuti.md`).

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** ogni movimento del registro appartiene a un registro, e ogni registro a una sede (unità locale). Il progressivo, il progressivo iniziale e il controllo di giacenza lavorano per registro, non più per azienda. Le aziende con due sedi hanno due numerazioni indipendenti. I movimenti esistenti finiscono nel registro unico dell'azienda senza perdere né rinumerare nulla.

**Precondizione (decisione 2026-10-24):** questo pezzo parte **solo a Fase 1 finita**, cioè con F1-RLS-1, 2, 3 e 4 fusi nel branch di partenza. Non si avvia prima, nemmeno in parallelo.

**Architettura:**
- Una tabella `registri_rifiuti` (modello `RegistroRifiuti`): un registro per sede, con la sede facoltativa (le aziende senza iscrizione RENTRI hanno un registro "senza sede"). Ha già la colonna `identificativo_rentri varchar null`, che valorizzerà F2-9.
- `WasteMovement.registroId` obbligatorio. L'unità locale **sta sul registro**, il movimento la eredita (Decisione D1, confermata il 2026-10-24).
- Chiave esterna **composta con `tenant_id`** per i movimenti e i progressivi iniziali: `waste_movements(registro_id, tenant_id)` e `registro_progressivi_iniziali(registro_id, tenant_id)` → `registri_rifiuti(id, tenant_id)`; serve `@@unique([id, tenantId])` su `RegistroRifiuti`. Per la sede: relazione Prisma su una sola colonna (`unita_locale_id` → `rentri_unita_locali(id)`) e coerenza di tenant garantita da un trigger (`unita_locale_id` è nullable per sempre, quindi la FK composta non è esprimibile in Prisma, e una FK scritta solo in SQL darebbe drift in `migrate diff`).
- Il legame registro → sede è **immutabile dopo l'aggancio**: `unita_locale_id` passa solo da `NULL` a un valore (trigger nel database più guard nel service).
- Indice unico del progressivo `(registro_id, progressive_year, progressive_number)` al posto di `(tenant_id, progressive_year, progressive_number)`.
- `RegistroProgressivoIniziale` passa da `(tenant, anno)` a `(registro, anno)`.
- Un servizio `RegistriService`: assicura (in una transazione propria e breve, **fuori** dalla registrazione) che ogni sede attiva abbia il suo registro; risolve, **in sola lettura**, il registro di un comando; risponde alla domanda "qual è la sede RENTRI di questo registro".
- Il lock di numerazione diventa `<registroId>-<anno>`, quello di giacenza `giacenza|<registroId>|<CER>`.
- **Due migration**, così ogni commit compila e il database non resta mai senza vincolo: `20261024100000_registro_per_sede` (additiva: tabella, colonne nullable, backfill, nuovi unici) nel Task 1, `20261024110000_registro_obbligatorio` (`SET NOT NULL`, via i vecchi unici) nel Task 3, quando il codice scrive già `registroId`.

**Tech Stack:** NestJS 10, Prisma 5.8, PostgreSQL 16 (advisory lock, indici unici parziali, chiavi esterne composte), Jest 29 + ts-jest, Angular 17 + Karma.

**Spec:**
- Roadmap: `C:\Progetti\winwaste\docs\roadmap-fase2-parita-registro.md`, pezzo F2-1.
- Rapporto: `C:\Progetti\winwaste\docs\confronto-rifiuti\01-registro-fir-giacenze.md` §1.1 R4-R5, §2.1, §5.2 (riga `PROT1`), §5.3 punto 4, §6 raccomandazione 5.
- WinWaste: `C:\Progetti\winwaste\docs\movimenti.md` §2.2, §2.3, §3.3.
- Codice (percorsi relativi a `apps/backend/`; **le righe valgono per il branch `fix/rentri-b7-emissione-senza-certificato` @ `2c45b1f`: dopo la Fase 1 sono slittate, riverificarle con `grep`**):
  - `prisma/schema.prisma`: `WasteMovement` (`:1732`, unico `:1799`), `RegistroProgressivoIniziale` (`:798`), `RentriUnitaLocale` (`:1903`);
  - `src/application/registro/use-cases/registra-movimento.use-case.ts` (anno `:198`, lock numerazione `:223-224`, massimo `:232-237`, progressivo iniziale `:241-245`, ricopia `:345-372`, lock di giacenza `:503-505`);
  - `src/application/registro/progressivo-iniziale.service.ts` (lock `:61-62`);
  - `src/application/registro/giacenza-disponibile.ts` (query `:55-85`);
  - `src/domain/waste-movement/waste-movement.entity.ts` (`computeHash` `:150-172`);
  - `src/api/registro/registro.controller.ts`, `registro.module.ts`, `dtos/registra-movimento.dto.ts`;
  - `src/application/registro/queries/list-movimenti.handler.ts`;
  - `src/application/giacenze/giacenze.service.ts`;
  - `src/infrastructure/rentri/rentri-unita-locale.service.ts` (`remove` `:212-233`, `create` `:90`, `upsertFromRentri` `:276`);
  - `src/application/mud/aggregazione/mud-controlli.ts:229-239` (avviso `PIU_UNITA_LOCALI`);
  - `src/infrastructure/persistence/prisma-rls.extension.ts:47-81`;
  - `src/application/rentri/mappatura/costruisci-payload-rentri.ts:39` (il payload dei FIR usa la sede principale);
  - migration esistenti: `20260629300000_extend_waste_movement_registro/migration.sql:63-65` (`ADD CONSTRAINT ... UNIQUE`), `20260726160000_allinea_storia_migrazioni_alla_realta/migration.sql:62-63` (rinomina), `20261022100000_registro_progressivo_iniziale/migration.sql:19` (`CREATE UNIQUE INDEX`), `20260726113432_add_rentri_unita_locale/migration.sql:44` (`updated_at` scritto a mano).
- Frontend: `apps/frontend/src/app/features/registro/` (`registro.service.ts`, `registro.component.ts`).

## Global Constraints

- **Branch e worktree:** `feat/fase2-1-unita-locale-registro`, partito da `develop` (o dal branch di integrazione) **dopo la fusione di F1-RLS-4**. Verificare con `ls apps/backend/prisma/migrations | tail -3` che l'ultima migration sia successiva a `20261023100000_fir_rentri_trasmissione_idempotente` e comprenda quelle della RLS. Se le migration della RLS hanno data successiva a `20261024100000`, rinominare le due migration di questo piano con un prefisso più recente (mantenendo l'ordine M1 < M2).
- **TDD obbligatorio:** prima il test, **eseguito e visto fallire**, poi il codice.
- **Il backend compila alla fine di OGNI task.** Se `npx tsc --noEmit -p apps/backend` dà errori, il task non è finito e non si committa.
- **Comandi** (mai la suite intera):
  - backend, unitari: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - backend, Postgres reale (`*.postgres.spec.ts`): `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit -c jest.postgres.config.js <spec>`. Il database di test è il container `wasteflow-pg-test` su `55432`; se non c'è, va ricreato come nei Global Constraints dei pezzi B precedenti, e le migration applicate con `npx prisma migrate deploy`;
  - tipi: `npx tsc --noEmit -p apps/backend`;
  - lint: `npx eslint "{src,test}/**/*.ts" --quiet` (da `apps/backend`);
  - frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=<spec>`.
- **Gli spec delle migration NON usano `psql`** (non c'è garantito nel runner CI e `pg` non è fra le dipendenze). Si usano solo `npx prisma migrate deploy` e `npx prisma db execute` (vedi Task 1, Step 1).
- **Schema Prisma:** dopo ogni modifica a `schema.prisma`, `npx prisma generate` da `apps/backend`. La migration SQL si scrive a mano e si controlla con `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <url>`: l'esito atteso è vuoto. I nomi degli indici sono quelli che Prisma deriva dallo schema, già accorciati a 63 caratteri (stessa cautela di `20261022110000_registro_ricopia_chiave`).
- **Migration additiva:** il nuovo indice unico si crea **prima** del vecchio vincolo da togliere. Il vecchio unico di `waste_movements` è un **CONSTRAINT** (si toglie con `ALTER TABLE ... DROP CONSTRAINT`); quello di `registro_progressivi_iniziali` è un **INDEX** (si toglie con `DROP INDEX`). Un `DROP INDEX` sul primo fallisce.
- **Ruolo che esegue le migration:** con `FORCE ROW LEVEL SECURITY` il **proprietario della tabella NON è esente**: solo un superuser o un ruolo con `BYPASSRLS` lo è. Prima di cominciare: `npx prisma db execute --stdin --schema prisma/schema.prisma <<< "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"` (o la forma equivalente), e annotare l'esito nel commit del Task 1. Se il ruolo delle migration è soggetto alle policy, il backfill non vede le righe: fermarsi e chiedere.
- **Ordine dei lock** dentro la transazione di registrazione, uguale ovunque: (1) ricopia del FIR `fir-registro|<tenant>|<fir>`, (2) progressivo `<registroId>-<anno>`, (3) giacenza `giacenza|<registroId>|<CER>`. È l'ordine di oggi. Il lock `registro-init|<tenant>` **non fa parte di questo ordine**: lo prende `assicuraRegistri` in una transazione propria e breve, **prima** della transazione di registrazione, e non è mai annidato con gli altri. Chi cambia l'ordine rompe l'assenza di deadlock.
- **`risolvi` non scrive e non prende lock.** Nessuna lettura di un `GET` deve poter fare `INSERT`.
- **Commit:** senza attribuzione AI, mai `git add -A` (si aggiungono i file per nome).
- **Messaggi all'utente in italiano**, termini tecnici in inglese (registro, sede, unità locale restano italiani perché termini di dominio).

## Review Focus

1. **Azienda con due sedi, stesso anno.** Sede A registra 3 movimenti, sede B 2: A ha 1, 2, 3 e B ha 1, 2. Nessun conflitto sull'indice unico. Uno scarico in sede B non usa il carico di sede A: è bloccato per giacenza insufficiente.
2. **Movimento esistente migrato.** Un'azienda con movimenti `2026/1..2026/40`, un progressivo iniziale impostato e una sede principale: dopo la migration tutti i movimenti sono nel registro legato alla sede principale, il prossimo numero è 41 (o il progressivo iniziale, se maggiore), il progressivo iniziale è sul registro. Un'azienda senza sede ha il registro senza sede. Un'azienda con due sedi e nessuna principale ha il registro senza sede (nessuna scelta indovinata). `updated_at` dei registri creati dal backfill è valorizzato.
3. **RENTRI riceve la sede giusta.** `sedeRentri(registro)` restituisce il `numIscrSito` della sede del registro, non quello della principale; per un registro senza sede lancia un errore chiaro che dice di collegare la sede. Il payload dei FIR resta sulla sede principale (nessun cambiamento oggi: il FIR non ha una sede propria), e un movimento con `firId` va **sempre** nel registro della sede principale (D10).
4. **Concorrenza sul progressivo e assenza di serializzazione dell'azienda.** 8 registrazioni parallele sul registro A e 8 sul registro B: A ha 1..8 e B ha 1..8, senza buchi né duplicati. **Test di non-bloccaggio:** una registrazione su A tenuta ferma sul lock del progressivo di A (client in pausa, come in `progressivo-iniziale.service.postgres.spec.ts:226`) **non blocca** una registrazione su B. Nessun lock a livello di azienda dentro la transazione di registrazione.
5. **Una sede con movimenti non si cancella; una senza sì.** `remove` rifiuta con un messaggio che propone di disattivarla solo se il suo registro ha movimenti (o un progressivo iniziale); altrimenti cancella registro e sede nella stessa transazione. Il database impedisce comunque la cancellazione con la chiave esterna `RESTRICT`.
6. **Isolamento fra tenant nel database.** Un movimento non può puntare a un registro di un altro tenant (chiave esterna composta), né un registro a una sede di un altro tenant (trigger): non solo `risolvi`.
7. **Legame registro → sede immutabile.** Un `UPDATE` di `unita_locale_id` da un valore a un altro è rifiutato dal trigger; da `NULL` a un valore passa.
8. **Hash.** `entryHash` non cambia (D7), ma con più registri la formula `tenant|anno|numero|...` non identifica più un'annotazione: lo si scrive nella nota per il revisore, e la versione concatenata dell'hash si introduce in F2-3.

## Decisioni

Confermate da Graziano il 2026-10-24:

1. **D1. L'unità locale sta sul registro, non sul movimento.** Il movimento punta al registro (`registroId`) e ne eredita la sede. Motivo: coincide con il modello RENTRI (registro con `identificativo_registro` legato a una unità locale, movimento indirizzato come `movimento/{anno}/{progressivo}` dentro il registro) e con WinWaste; una sola fonte di verità; un registro senza sede si lega alla sede dopo, senza toccare i movimenti. Costo: per sapere la sede di un movimento serve un join, coperto dall'indice `(registro_id, ...)`. **Condizioni:** legame registro → sede immutabile dopo l'aggancio; chiavi esterne composte con `tenant_id`. Il "luogo di produzione fuori dall'unità locale" (`COMU`/`PRES`/`IND` di WinWaste) resta un campo del movimento e non è in F2-1.
2. **D4. Un registro per sede**, con codice `CARICO_SCARICO` e colonna `identificativo_rentri` già prevista (nulla). La tabella ammette altri codici (conto terzi, per attività) ma né il servizio né l'interfaccia li creano.
3. **D5. Giacenza per registro.** Uno scarico si confronta con i carichi dello stesso registro. **Nessun trasferimento fra sedi fino a F2-5** (causali).
4. **D9. Nessuna trasmissione RENTRI in questo pezzo.** Si prepara solo il dato e il risolutore `sedeRentri`. La trasmissione del registro è F2-9.

Predefinite del controller (da rivedere in revisione):

5. **D2. Azienda senza sede RENTRI: registro "senza sede".** Appena la sede principale esiste **e non ha già un registro**, il registro senza sede si lega **da solo** a quella sede (una sola volta, con una riga in `ActivityLog`). Se la principale ha già un suo registro, il registro senza sede resta senza sede (orfano ma valido): il caso è quasi irraggiungibile, perché `create` e `upsertFromRentri` rendono principale la prima sede (`rentri-unita-locale.service.ts:90`, `:276`), ed è comunque coperto da un test. Se l'azienda ha già due sedi e nessuna principale, il registro resta senza sede finché non se ne imposta una principale. **Il legame passa solo da `NULL` a un valore, mai da una sede a un'altra.**
6. **D3. Registro predefinito.** Se la richiesta non indica `registroId`: il registro della sede principale; altrimenti l'unico registro attivo; con più registri e nessuna principale la registrazione è rifiutata ("Indica il registro").
7. **D6. Progressivo iniziale per registro.** Il valore esistente passa al registro unico dell'azienda.
8. **D7. `entryHash` invariato.** La formula non include il registro: è un fingerprint, mai verificato. Cambiarla non serve a F2-1 e invaliderebbe i valori esistenti. Con la numerazione per registro, due registri possono avere lo stesso numero e gli stessi dati, quindi la formula non identifica più un'annotazione: lo gestisce F2-3 (hash concatenato, con una versione della formula).
9. **D8. Una sede con registro e movimenti non si cancella, si disattiva.** Una sede il cui registro è vuoto (nessun movimento, nessun progressivo iniziale) si cancella insieme al suo registro, nella stessa transazione. `onDelete: Restrict` sulle chiavi esterne resta come rete di sicurezza. Quando F2-2 introdurrà le giacenze iniziali, la condizione "registro vuoto" le includerà.
10. **D10. Ricopia del FIR e sede.** Un FIR si ricopia una sola volta per azienda e tipo (indice esistente). Un retry con un `registroId` diverso da quello della ricopia esistente è rifiutato come "FIR già registrato". **D10 vale per i FIR emessi dall'azienda** (il payload RENTRI di `costruisci-payload-rentri.ts:39` usa sempre la principale). Per un FIR ricevuto o acquisito (`acquisisci-formulario-rentri.use-case.ts`, che lavora su un `numIscrSito` scelto) il CARICO del destinatario dovrebbe andare nel registro di quella sede: per i produttori non serve, per i gestori multi-sede è una nota della Fase 4. **Finché il FIR non ha una sede propria**, un movimento con `firId` va **nel registro della sede principale**; se l'utente indica un altro registro la registrazione è **rifiutata** con `RegistroNonCoerenteConFirError` (scelta del controller: rifiutare, non accettare con un avviso, perché un movimento in un registro diverso da quello trasmesso nel FIR sarebbe un dato incoerente). Se l'azienda non ha una principale, vale il registro senza sede o l'unico registro attivo (D3).
11. **D11. Aziende con `numIscrSito` solo sulla credenziale.** `RentriCredential.numIscrSito` è deprecato, ma `rentri-credential.controller.ts:174` lo scrive ancora. Le aziende che hanno un `numIscrSito` e nessuna riga in `rentri_unita_locali` sono trattate come "senza sede" (coerente con il payload dei FIR, che già le rifiuta). Prima della migration si **conta** quante sono (Task 1, Step 0).

---

### Task 1: schema, migration additiva e backfill dei dati esistenti

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`:
  - nuovo `model RegistroRifiuti` mappato su `registri_rifiuti`, con `id`, `tenantId`, `createdAt`, `updatedAt`, `unitaLocaleId String? @db.Uuid`, `codice String @default("CARICO_SCARICO") @db.VarChar(30)`, `descrizione String @db.VarChar(255)`, `identificativoRentri String? @map("identificativo_rentri") @db.VarChar(100)`, `attivo Boolean @default(true)`; relazioni a `Tenant` (`onDelete: Cascade`) e (opzionale) a `RentriUnitaLocale` con `fields: [unitaLocaleId], references: [id], onDelete: Restrict` (**una sola colonna**); `@@unique([id, tenantId])`, `@@unique([tenantId, unitaLocaleId, codice])`, `@@index([tenantId])`;
  - `RentriUnitaLocale`: solo la relazione inversa `registri RegistroRifiuti[]` (nessun `@@unique([id, tenantId])`: non serve più);
  - `WasteMovement`: **`registroId String? @map("registro_id") @db.Uuid`, nullable in questo task**; relazione opzionale `RegistroRifiuti` con `fields: [registroId, tenantId], references: [id, tenantId], onDelete: Restrict`; **in aggiunta** al vecchio `@@unique([tenantId, progressiveYear, progressiveNumber])` (che resta fino al Task 3): `@@unique([registroId, progressiveYear, progressiveNumber])`; `@@index([registroId, cerCode])`;
  - `RegistroProgressivoIniziale`: `registroId String? @map("registro_id") @db.Uuid`, relazione composta opzionale, `@@unique([registroId, anno])` **in aggiunta** al vecchio `@@unique([tenantId, anno])`;
  - relazioni inverse su `Tenant`.
  - **Verifica Prisma:** Prisma con ogni probabilità rifiuta una relazione opzionale che usa anche un campo obbligatorio (`tenantId`). Si esegue `npx prisma validate`. Per `waste_movements` e `registro_progressivi_iniziali`, se rifiuta (atteso), in M1 la relazione sta **solo su `registroId`** (una colonna) e la chiave esterna **composta** `(registro_id, tenant_id)` si crea in M2 (Task 3), dove `registroId` diventa obbligatorio e la relazione composta è esprimibile. Per la sede nessun ripiego: relazione su una colonna fin da M1 (decisione del controller).
- Create: `apps/backend/prisma/migrations/20261024100000_registro_per_sede/migration.sql`.
- Modify: `apps/backend/src/infrastructure/persistence/prisma-rls.extension.ts`: `'RegistroRifiuti'` in `TENANT_SCOPED_MODELS` (`:47-81`), con commento "registro dell'azienda".
- Test (Create): `apps/backend/src/application/registro/registro-migrazione.postgres.spec.ts`.

**Interfaces (valori esatti):**
- Tabella `registri_rifiuti`: colonne `id uuid default gen_random_uuid()`, `tenant_id uuid not null`, `created_at timestamp default now()`, **`updated_at timestamp not null` senza default** (come ogni `@updatedAt` Prisma: il backfill lo scrive con `now()`, come in `20260726113432_add_rentri_unita_locale/migration.sql:44`), `unita_locale_id uuid null`, `codice varchar(30) not null default 'CARICO_SCARICO'`, `descrizione varchar(255) not null`, `identificativo_rentri varchar(100) null`, `attivo boolean not null default true`.
- Indice unico parziale `registri_rifiuti_uno_senza_sede_per_tenant` su `(tenant_id, codice) WHERE unita_locale_id IS NULL` (stesso modello di `rentri_unita_locali_una_principale_per_tenant`, non esprimibile in Prisma). **Si crea prima di qualunque `INSERT`.**
- Unico `(id, tenant_id)` su `registri_rifiuti` (vincolo, nome derivato da Prisma).
- Chiave esterna semplice `registri_rifiuti(unita_locale_id)` → `rentri_unita_locali(id)`, `ON DELETE RESTRICT` (quella che Prisma conosce).
- Chiavi esterne composte `ON DELETE RESTRICT`, create **dopo** l'aggiunta delle colonne e il backfill, se Prisma le accetta (altrimenti in M2, vedi sopra): `waste_movements(registro_id, tenant_id)` e `registro_progressivi_iniziali(registro_id, tenant_id)` → `registri_rifiuti(id, tenant_id)`.
- Trigger `registri_rifiuti_sede_immutabile` (`BEFORE INSERT OR UPDATE OF unita_locale_id`), due controlli: (1) `RAISE EXCEPTION 'unita_locale_id di un registro non si cambia dopo l''aggancio'` se `TG_OP = 'UPDATE' AND OLD.unita_locale_id IS NOT NULL AND NEW.unita_locale_id IS DISTINCT FROM OLD.unita_locale_id`; (2) `RAISE EXCEPTION` se `NEW.unita_locale_id IS NOT NULL` e la sede ha un `tenant_id` diverso da `NEW.tenant_id` (coerenza di tenant). I trigger non entrano in `migrate diff`.
- Descrizione del registro: `'Registro cronologico'` se senza sede; altrimenti `'Registro ' || denominazione della sede`.

**Algoritmo della migration M1 (non ovvio, in quest'ordine, in un solo script):**
1. Crea `registri_rifiuti`, l'indice unico parziale, l'unico `(id, tenant_id)`, la chiave esterna verso `rentri_unita_locali(id)` e il trigger. **Niente chiavi esterne su `waste_movements` e `registro_progressivi_iniziali` in questo passo**: le colonne non esistono ancora.
2. Per ogni azienda che ha righe in `waste_movements` **o** in `registro_progressivi_iniziali`, inserisce un registro con `updated_at = now()`. Sede scelta: la sede con `principale = true`; se non c'è nessuna principale e l'azienda ha **una sola** sede, quella; altrimenti `NULL`. Mai una sede indovinata fra due.
3. Aggiunge `waste_movements.registro_id` e `registro_progressivi_iniziali.registro_id` (nullable), li valorizza con l'unico registro dell'azienda, poi un blocco `DO $$` che conta le righe rimaste `NULL` e, se > 0, fa `RAISE EXCEPTION`: la migration si ferma e non lascia stati a metà.
4. Crea le chiavi esterne composte su `waste_movements` e `registro_progressivi_iniziali` (se Prisma le accetta; altrimenti in M2), **dopo** il backfill: il controllo gira una volta sola, su dati già coerenti.
4b. Crea i **nuovi** indici unici `(registro_id, progressive_year, progressive_number)` e `(registro_id, anno)` e l'indice `(registro_id, cer_code)`. **I vecchi vincoli restano**: li toglie M2 (Task 3).
4c. **In fondo allo script**, dopo il backfill: `ENABLE` e `FORCE ROW LEVEL SECURITY` e la policy di `registri_rifiuti` (altrimenti la `WITH CHECK` respingerebbe gli `INSERT` del backfill se il ruolo non bypassa la RLS).
5. Il nuovo indice si crea prima di togliere il vecchio: se lo script si interrompe, la tabella non resta mai senza vincolo. Il nuovo vincolo non può collidere perché il vecchio era più stretto e ogni azienda ha ancora un solo registro.

Ripristino (da lasciare scritto in un commento in cima al file): togliere trigger, chiavi esterne e colonne `registro_id`; tabella `registri_rifiuti` per ultima.

- [ ] **Step 0: conteggio delle sedi solo sulla credenziale (D11).** Sul database di sviluppo o di prova reale eseguire `SELECT count(*) FROM rentri_credentials rc WHERE num_iscr_sito IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rentri_unita_locali u WHERE u.tenant_id = rc.tenant_id);` e annotare il numero nel commento della migration. Il comportamento è già deciso (registro senza sede): serve solo a sapere quante aziende sono coinvolte.
- [ ] **Step 1: test che falliscono.** Lo spec **non usa `psql`**. Procedura:
  1. crea un database di prova vuoto `wasteflow_mig_<timestamp>` sul container `wasteflow-pg-test` (con `PrismaClient` connesso al database `postgres`, `$executeRawUnsafe('CREATE DATABASE ...')`, un'istruzione per chiamata);
  2. copia in una cartella temporanea (`os.tmpdir()`) lo `schema.prisma` e **solo** le migration con nome **precedente** a `20261024100000_registro_per_sede` (più `migration_lock.toml`), poi esegue `npx prisma migrate deploy --schema <tmp>/schema.prisma` con `DATABASE_URL` del database di prova (`child_process.execFileSync`);
  3. inserisce le righe "vecchie" (tenant, sedi, movimenti, progressivi iniziali) con `$executeRawUnsafe`, **un'istruzione per chiamata**;
  4. applica M1 con `npx prisma db execute --file <migration.sql> --url <url>` (accetta più istruzioni e i blocchi `DO`), poi verifica con query;
  5. applica M2 (Task 3) nello stesso modo e verifica; i test su M2 si scrivono nel Task 3, nello stesso spec;
  6. alla fine elimina il database.

  Test (M1):
  - `'migrazione: movimenti e progressivo iniziale esistenti finiscono nel registro dell'azienda, legato alla sede principale'`;
  - `'migrazione: azienda senza sede RENTRI → registro senza sede, movimenti migrati'`;
  - `'migrazione: azienda con due sedi e nessuna principale → registro senza sede, nessuna scelta indovinata'`;
  - `'migrazione: azienda con una sola sede non principale → registro su quella sede'`;
  - `'migrazione: azienda senza movimenti non ottiene nessun registro'`;
  - `'migrazione: i registri creati dal backfill hanno updated_at valorizzato'`;
  - `'migrazione: due registri della stessa azienda possono avere lo stesso progressivo; lo stesso registro no'`;
  - `'migrazione: un'azienda può avere un solo registro senza sede per codice'`;
  - `'migrazione: un movimento non può puntare a un registro di un altro tenant (chiave esterna composta)'`;
  - `'migrazione: un registro non può puntare a una sede di un altro tenant (trigger di coerenza del tenant)'`;
  - `'migrazione: unita_locale_id passa da NULL a un valore ma non da una sede a un'altra (trigger)'`;
  - `'migrazione: una sede con un registro non si cancella'`.
- [ ] **Step 2:** esegui con `-c jest.postgres.config.js`. Atteso: FAIL (migration assente).
- [ ] **Step 3:** scrivi schema, migration e riga in `TENANT_SCOPED_MODELS`. Poiché la Fase 1 è finita, **aggiungi in fondo alla stessa migration (passo 4c)** `ENABLE` e `FORCE ROW LEVEL SECURITY` e la policy di `registri_rifiuti`, **copiando la forma** dalle migration di F1-RLS-3 (`grep -rln "FORCE ROW LEVEL SECURITY" apps/backend/prisma/migrations`); il test di confronto con lo schema della RLS deve restare verde. `npx prisma generate`; `npx prisma migrate diff` (atteso vuoto).
- [ ] **Step 4:** esegui lo spec; `npx tsc --noEmit -p apps/backend` (atteso: **nessun errore**, perché `registroId` è ancora nullable e il codice esistente continua a compilare); `npx jest --runInBand --forceExit src/infrastructure/persistence/prisma-rls.extension.spec.ts` (se lo spec esiste: `ls` per trovarlo) e lo spec di confronto policy-schema della RLS. Atteso: tutto PASS.
- [ ] **Step 5: commit** `feat(registro): tabella dei registri per sede, registro nullable sul movimento e migration additiva dei dati esistenti`.

---

### Task 2: `RegistriService` (assicura, risolvi, sede RENTRI)

**Files:**
- Create: `apps/backend/src/application/registro/registri.service.ts`.
- Create: `apps/backend/src/application/registro/registri.service.spec.ts` (unitario, con finti Prisma).
- Create: `apps/backend/src/application/registro/registri.service.postgres.spec.ts`.
- Modify: `apps/backend/src/api/registro/registro.module.ts` (provider ed export di `RegistriService`).

**Interfaces:**

```ts
export interface RegistroVista {
  id: string
  unitaLocaleId: string | null
  /** Valorizzato solo se il registro ha una sede. */
  numIscrSito: string | null
  denominazione: string
  codice: string
  attivo: boolean
  /** true se la sede del registro è la sede principale dell'azienda. */
  principale: boolean
}

export class RegistroNonTrovatoError extends DomainError
export class RegistroDaIndicareError extends DomainError   // più registri, nessuna sede principale
export class RegistroSenzaSedeRentriError extends DomainError
export class RegistroNonCoerenteConFirError extends DomainError   // D10

@Injectable()
export class RegistriService {
  constructor(prisma: PrismaService, logger: LoggerService)
  /**
   * Un registro per ogni sede attiva; lega il registro senza sede alla principale (D2). Idempotente.
   * Apre una transazione PROPRIA e breve con il lock `registro-init|<tenantId>`: mai dentro la
   * transazione di registrazione.
   */
  assicuraRegistri(tenantId: string): Promise<RegistroVista[]>
  /** Solo lettura, nessun lock, nessuna scrittura. Per `GET /registro/registri`. */
  elenca(tenantId: string): Promise<RegistroVista[]>
  /**
   * Prima della transazione di registrazione. Lettura senza lock: se il registro richiesto
   * (o, senza `registroId`, quello predefinito) esiste, non fa altro; altrimenti chiama
   * `assicuraRegistri`.
   */
  preparaRegistri(tenantId: string, registroId?: string): Promise<void>
  /** D3. Dentro la transazione del chiamante. SOLA LETTURA, nessun lock. */
  risolvi(tx: Prisma.TransactionClient, tenantId: string, registroId?: string): Promise<RegistroVista>
  /** D10 (solo FIR emessi dall'azienda). Movimento con `firId`: il registro della sede principale; `registroId` diverso → errore. Senza principale e con più registri accetta il `registroId` indicato. */
  risolviPerFir(tx: Prisma.TransactionClient, tenantId: string, registroId?: string): Promise<RegistroVista>
  /** Per la trasmissione del registro a RENTRI (F2-9). */
  sedeRentri(tenantId: string, registroId: string): Promise<{ numIscrSito: string; denominazione: string }>
}
```

Messaggi esatti degli errori:
- `RegistroNonTrovatoError`: `"Registro non trovato o non attivo."`
- `RegistroDaIndicareError`: `"L'azienda ha più registri e nessuna sede principale: indica il registro."`
- `RegistroSenzaSedeRentriError`: `"Il registro non ha una sede RENTRI collegata: imposta una sede principale nella sezione Unità locali."`
- `RegistroNonCoerenteConFirError`: `"Un movimento collegato a un FIR si registra nel registro della sede principale, la stessa trasmessa a RENTRI nel FIR."`

**Algoritmo di `assicuraRegistri` (non ovvio):**
- Apre una transazione propria e prende `pg_advisory_xact_lock(hashtext('registro-init|<tenantId>'))`. Nessun altro lock in questa transazione.
- Legge sedi attive e registri dell'azienda.
- Per ogni sede attiva senza registro:
  - se la sede è la principale, **non ha già un registro**, ed esiste un registro senza sede: lo lega alla sede (`UPDATE ... SET unita_locale_id`, ammesso dal trigger perché da `NULL`), scrive `ActivityLog` con azione `REGISTRO_COLLEGATO_SEDE` (D2);
  - altrimenti crea un registro `'Registro ' || denominazione` (con `updated_at` valorizzato dal client Prisma).
- Se l'azienda non ha né sedi attive né registri: crea il registro senza sede `'Registro cronologico'`.
- Un registro la cui sede è disattivata resta com'è, anche attivo: i movimenti storici contano. Non lo disattiva da solo.
- Il service **non cambia mai** `unita_locale_id` da una sede a un'altra (guard esplicito, oltre al trigger).
- La violazione dell'indice unico (`P2002`) in una creazione concorrente si traduce in una rilettura, mai in un errore all'utente.

**Regola di `risolvi` (D3), in sola lettura:**
- `registroId` indicato: deve esistere, essere dell'azienda e `attivo`, altrimenti `RegistroNonTrovatoError` (mai il messaggio che rivela l'esistenza in un'altra azienda).
- Non indicato: registro della sede principale; altrimenti l'unico registro attivo; altrimenti `RegistroDaIndicareError`.
- `risolvi` non crea nulla: se manca il registro è perché `preparaRegistri` non è stato chiamato (errore di programmazione, `RegistroNonTrovatoError`).

**Regola di `risolviPerFir` (D10):** risolve come `risolvi` senza `registroId`; se `registroId` è indicato e diverso dal risultato, `RegistroNonCoerenteConFirError`. **Eccezione:** con più registri e nessuna principale non c'è un risultato con cui confrontare (`RegistroDaIndicareError`): si accetta il `registroId` indicato dall'utente (se non è indicato, `RegistroDaIndicareError`).

- [ ] **Step 1: test che falliscono.**
  - unitari (`registri.service.spec.ts`):
    - `'assicuraRegistri: azienda senza sedi né registri → un registro senza sede'`;
    - `'assicuraRegistri: due sedi attive → un registro per sede, idempotente alla seconda chiamata'`;
    - `'assicuraRegistri: registro senza sede + sede principale senza registro → il registro si lega alla sede e non se ne crea un secondo'`;
    - `'assicuraRegistri: la principale ha già un registro → il registro senza sede resta senza sede'`;
    - `'assicuraRegistri: sede disattivata → il suo registro resta e non ne nascono altri'`;
    - `'assicuraRegistri: non cambia mai la sede di un registro già agganciato'`;
    - `'preparaRegistri: se il registro predefinito esiste non apre transazioni né prende lock'`;
    - `'preparaRegistri: se manca il registro richiesto chiama assicuraRegistri'`;
    - `'elenca: non scrive mai (nessun create/update/lock)'`;
    - `'risolvi: senza registroId usa il registro della sede principale'`;
    - `'risolvi: due registri e nessuna principale → RegistroDaIndicareError'`;
    - `'risolvi: registroId di un'altra azienda → RegistroNonTrovatoError'`;
    - `'risolviPerFir: usa il registro della principale; registroId diverso → RegistroNonCoerenteConFirError col messaggio esatto'`;
    - `'risolviPerFir: più registri e nessuna principale → accetta il registroId indicato'`;
    - `'sedeRentri: restituisce il numIscrSito della sede del registro, non quello della principale'`;
    - `'sedeRentri: registro senza sede → RegistroSenzaSedeRentriError col messaggio esatto'`;
  - Postgres (`registri.service.postgres.spec.ts`):
    - `'assicuraRegistri concorrente: 6 chiamate parallele creano un solo registro per sede'`;
    - `'assicuraRegistri: lo scrive in ActivityLog quando lega il registro senza sede alla sede principale'`;
    - `'assicuraRegistri: il trigger impedisce di cambiare la sede di un registro già agganciato'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa e registra nel modulo.
- [ ] **Step 4:** esegui i due spec e `npx tsc --noEmit -p apps/backend` (atteso: nessun errore). Atteso: PASS.
- [ ] **Step 5: commit** `feat(registro): RegistriService (un registro per sede, risoluzione in sola lettura, sede RENTRI)`.

---

### Task 3: numerazione, progressivo iniziale e giacenza per registro, e migration che chiude i vincoli

Questo task rende `registroId` **obbligatorio**: il codice, gli spec e la migration M2 cambiano **insieme**, in un solo commit, e il backend compila.

**Files:**
- Create: `apps/backend/prisma/migrations/20261024110000_registro_obbligatorio/migration.sql` (M2):
  1. blocco `DO $$` che conta le righe con `registro_id IS NULL` in `waste_movements` e `registro_progressivi_iniziali` e fa `RAISE EXCEPTION` se > 0 (M1 e M2 vanno nella stessa release);
  2. `ALTER TABLE ... ALTER COLUMN registro_id SET NOT NULL` sulle due tabelle;
  3. **solo ora** toglie i vecchi vincoli: `ALTER TABLE "waste_movements" DROP CONSTRAINT "waste_movements_tenant_id_progressive_year_progressive_numb_key";` (**è un CONSTRAINT**, creato con `ADD CONSTRAINT ... UNIQUE` in `20260629300000_extend_waste_movement_registro/migration.sql:63-65` e rinominato con `ALTER INDEX` in `20260726160000_allinea_storia_migrazioni_alla_realta/migration.sql:62-63`; il nome si conferma con `\d waste_movements` o con `SELECT conname FROM pg_constraint WHERE conrelid = 'waste_movements'::regclass AND contype = 'u'`, **mai** con `DROP INDEX`) e `DROP INDEX "registro_progressivi_iniziali_tenant_id_anno_key";` (**è un INDEX**, `20261022100000_registro_progressivo_iniziale/migration.sql:19`);
  4. se nel Task 1 la chiave esterna composta di `waste_movements` non era esprimibile in Prisma, si crea qui.
- Modify: `apps/backend/prisma/schema.prisma`: `registroId` obbligatorio (non più `?`) su `WasteMovement` e `RegistroProgressivoIniziale`, relazioni non opzionali; via i vecchi `@@unique([tenantId, progressiveYear, progressiveNumber])` e `@@unique([tenantId, anno])`. `npx prisma generate`, poi `npx prisma migrate diff` (atteso vuoto).
- Modify: `apps/backend/src/domain/waste-movement/waste-movement.entity.ts`: `registroId: string` in `WasteMovementProps`, obbligatorio in `create`/`reconstitute`; **`computeHash` invariato** (D7).
- Modify: `apps/backend/src/application/registro/commands/registra-movimento.command.ts`: nuovo parametro **in coda** `registroId: string | undefined` (dopo `notes`), per non spostare i parametri esistenti.
- Modify: `apps/backend/src/core/domain/errors.ts`: `FirGiaRegistratoError` accetta in coda una `denominazioneRegistro?: string` e, se c'è, la cita nel messaggio (`"... nel registro <denominazione>"`); i chiamanti la passano solo se l'azienda ha più di un registro.
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts`:
  - costruttore con `RegistriService` come terzo parametro;
  - `registroId` in `MovimentoRegistrato`;
  - **prima** di aprire la transazione: `await registri.preparaRegistri(tenantId, command.registroId)` (nessun lock tenuto dalla transazione di registrazione);
  - dentro la transazione, come primo passo, `registri.risolvi(tx, tenantId, command.registroId)` oppure, se il comando ha `firId`, `registri.risolviPerFir(tx, tenantId, command.registroId)` (D10). **Nessun lock aggiuntivo**: l'ordine resta FIR → progressivo → giacenza;
  - `ricopiaEsistente`: se la ricopia trovata sta in un registro diverso da quello esplicitamente richiesto, `FirGiaRegistratoError` (D10); se `registroId` non è indicato, vale quella esistente;
  - lock di numerazione `${registro.id}-${anno}`; massimo `WHERE registro_id = ...::uuid AND progressive_year = ...` (non più per `tenant_id`);
  - progressivo iniziale letto per `registroId_anno`;
  - `verificaGiacenza` con `registroId` e lock `giacenza|<registroId>|<CER senza asterisco>`;
  - `registroId` nel `create` di `wasteMovement`.
- Modify: `apps/backend/src/application/registro/giacenza-disponibile.ts`: `registroId: string` in `ParametriGiacenza`; filtro `AND registro_id = ${p.registroId}::uuid` in **tutte** le sotto-query (la `mov` e la subquery `unita_non_massa`).
- Modify: `apps/backend/src/application/registro/progressivo-iniziale.service.ts`: `leggi(tenantId, anno, registroId?)` e `imposta(tenantId, anno, primoProgressivo, motivo, userId, registroId?)`; il registro si risolve con `RegistriService.preparaRegistri` (fuori dalla transazione) e `risolvi` (dentro); lock `${registro.id}-${anno}` (**stessa chiave** del use case); `haMovimenti` e il controllo "l'anno ha già movimenti" contano solo i movimenti del registro; `StatoProgressivoIniziale` aggiunge `registroId`.
- Test (Modify), tutti in `apps/backend/src/application/` salvo diversa indicazione: `registro/use-cases/registra-movimento.use-case.spec.ts`, `registro/use-cases/registra-movimento.use-case.postgres.spec.ts`, `registro/giacenza-disponibile.spec.ts`, `registro/giacenza-disponibile.postgres.spec.ts`, `registro/progressivo-iniziale.service.spec.ts`, `registro/progressivo-iniziale.service.postgres.spec.ts`, **`gruppo/isolamento-sorelle.postgres.spec.ts` (`:253`, fa `wasteMovement.create` senza `registroId`)** e **`mud/aggregazione/mud-aggregazione-saldi.postgres.spec.ts` (`:60`, idem)**. I finti e le istanze `new RegistraMovimentoUseCase(prisma, logger)` ricevono il `RegistriService`; le fixture portano un `registroId`. **Controllo di completezza:** `grep -rln "wasteMovement\.\(create\|createMany\)\|INSERT INTO \"\?waste_movements\|registroProgressivoIniziale\.\(create\|upsert\)" apps/backend/src apps/backend/test` deve elencare solo file già nell'elenco sopra o in codice di produzione già adeguato.
- Test (Create): `apps/backend/src/application/registro/registro-per-sede.postgres.spec.ts` (i casi del Review Focus).
- Test (Modify): `apps/backend/src/application/registro/registro-migrazione.postgres.spec.ts` (i test su M2).

**Interfaces:**
- `giacenzaDisponibileAl(tx, { tenantId, registroId, cerCode, alla })`.
- `ProgressivoInizialeService.imposta(...)` restituisce `{ anno, primoProgressivo, registroId }`.
- `MovimentoRegistrato.registroId: string`.

- [ ] **Step 1: test che falliscono.**
  - `registro-per-sede.postgres.spec.ts`:
    - `'due sedi: A registra 3 movimenti e B 2 nello stesso anno, A ha 1-3 e B ha 1-2'`;
    - `'scarico in sede B non usa il carico di sede A: bloccato per giacenza insufficiente'`;
    - `'scarico in sede A usa il carico di sede A anche se B ha più giacenza'`;
    - `'8 registrazioni parallele su A e 8 su B: 1-8 su ciascuno, senza buchi né duplicati'`;
    - `'una registrazione su A ferma sul lock del progressivo di A non blocca una registrazione su B'` (client in pausa, come in `progressivo-iniziale.service.postgres.spec.ts:226`; la registrazione su B deve completarsi mentre quella su A è ancora in attesa);
    - `'progressivo iniziale della sede A non cambia la numerazione della sede B'`;
    - `'azienda con una sola sede: registrazione senza registroId, finisce nel registro della principale'`;
    - `'movimento con firId e registroId di una sede non principale → RegistroNonCoerenteConFirError'`;
    - `'movimento con firId senza registroId finisce nel registro della sede principale'`;
    - `'ricopia dello stesso FIR con un registro diverso → FIR già registrato'`;
    - `'registrazione su azienda con sedi ma senza registri: preparaRegistri li crea e la registrazione riesce'`;
  - `giacenza-disponibile.postgres.spec.ts`: `'la giacenza conta solo i movimenti del registro richiesto'`;
  - `progressivo-iniziale.service.postgres.spec.ts`: `'imposta per registro: un movimento nell'altro registro non lo blocca'`;
  - `registra-movimento.use-case.spec.ts`: `'prende i lock nell'ordine FIR, progressivo, giacenza e non prende registro-init dentro la transazione'` (si verifica l'ordine delle chiamate `$executeRaw`);
  - `registro-migrazione.postgres.spec.ts` (M2): `'M2: il vecchio vincolo (tenant, anno, numero) non esiste più e quello per registro sì'`, `'M2: registro_id è NOT NULL'`, `'M2: M2 fallisce con un messaggio chiaro se resta un movimento senza registro'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa (schema, M2, codice, spec in blocco).
- [ ] **Step 4:** esegui gli spec unitari e `-c jest.postgres.config.js` per i `.postgres.spec.ts` toccati, `npx tsc --noEmit -p apps/backend` (**atteso: nessun errore**), `npx eslint "{src,test}/**/*.ts" --quiet`, `npx prisma migrate diff` (vuoto). Atteso: PASS.
- [ ] **Step 5: commit** `feat(registro): progressivo, progressivo iniziale e giacenza per registro; registro obbligatorio sul movimento`.

---

### Task 4: API, letture e protezione delle sedi

**Files:**
- Modify: `apps/backend/src/api/registro/dtos/registra-movimento.dto.ts`: `registroId?: string` con `@IsOptional() @IsUUID()`; `ListMovimentiDto` (se è nello stesso file o in uno vicino, `ls`) e i DTO del progressivo iniziale con lo stesso campo (query per il `GET`/`PUT`).
- Modify: `apps/backend/src/api/registro/registro.controller.ts`:
  - `POST /registro` passa `dto.registroId` al comando;
  - `GET /registro` filtra per `registroId`;
  - `GET`/`PUT progressivo-iniziale/:anno` accettano `?registroId=`;
  - nuovo `GET /registro/registri` → `RegistroVista[]` (`RegistriService.elenca`, **sola lettura**), aperto a ogni ruolo con accesso all'azienda, come la lista;
  - nuovo `POST /registro/registri/assicura` → `RegistroVista[]` (`RegistriService.assicuraRegistri`), con **lo stesso guard dei ruoli che possono registrare** (come `POST /registro`): è l'unico punto, oltre alla registrazione, dove i registri nascono. Un utente in sola lettura non scrive mai.
- Modify: `apps/backend/src/application/registro/queries/list-movimenti.handler.ts` e `list-movimenti.query.ts`: filtro `registroId`, `registroId` in ogni riga.
- Modify: `apps/backend/src/application/giacenze/giacenze.service.ts` e il suo controller: parametro facoltativo `registroId` in `getGiacenze` e negli alert; senza il parametro la pagina somma tutti i registri (comportamento di oggi). **Usa il `PrismaService` corrente di `giacenze.service.ts`** (dopo F1-RLS-1 è uno solo: non nominare un percorso, leggere l'import del file).
- Modify: `apps/backend/src/infrastructure/rentri/rentri-unita-locale.service.ts` (`remove`, `:212-233`): se il registro della sede ha **movimenti o un progressivo iniziale**, `BadRequestException("La sede ha un registro con movimenti: disattivala invece di eliminarla.")`; se il registro **esiste ma è vuoto**, lo cancella e poi cancella la sede **nella stessa transazione**; se la sede non ha registro, comportamento di oggi. Il database impedisce comunque la cancellazione con movimenti (D8, `RESTRICT`). Una race fra la cancellazione e una registrazione concorrente nel registro appena svuotato dà un errore di chiave esterna, che `remove` traduce nello stesso `BadRequestException`.
- Modify: `apps/backend/src/application/mud/aggregazione/mud-controlli.ts` (`piuUnitaLocali`, `:229-239`): il testo smette di dire che "il registro non indica la sede del movimento". Nuovo testo: `L'azienda ha ${n} unità locali attive (${elenco}): il file attribuisce all'unità locale ${principale} i movimenti di tutti i registri. Non presentare anche dichiarazioni separate per le altre sedi con le stesse quantità: risulterebbero dichiarate due volte. La ripartizione per sede non è ancora supportata.` Il codice `PIU_UNITA_LOCALI` e la gravità non cambiano. **Nessun cambiamento ai numeri del MUD.**
- Test (Modify/Create): `registro.controller.spec.ts`, `registro.controller.http.spec.ts`, `dtos/registra-movimento.dto.spec.ts`, `list-movimenti.handler.spec.ts` (se manca, si crea accanto al handler), `giacenze.service.spec.ts`, `rentri-unita-locale.service.spec.ts`, lo spec di `mud-controlli` (`ls src/application/mud/aggregazione/`), `mud-aggregazione.service.spec.ts`.

**Interfaces:**
- `GET /api/v1/registro/registri` → `[{ id, unitaLocaleId, numIscrSito, denominazione, codice, attivo, principale }]`, in sola lettura.
- `POST /api/v1/registro/registri/assicura` → stessa forma; idempotente; ruoli di scrittura.
- `POST /api/v1/registro` accetta `registroId` (uuid, facoltativo) e risponde con `registroId`.
- `GET /api/v1/registro?registroId=<uuid>`; `GET`/`PUT /api/v1/registro/progressivo-iniziale/:anno?registroId=<uuid>`.
- `GET /api/v1/giacenze?registroId=<uuid>` (nome del path come nel controller esistente: verificarlo).

- [ ] **Step 1: test che falliscono.**
  - `'registro controller: POST senza registroId lo passa undefined al comando; con registroId lo passa'`;
  - `'registro controller: registroId non uuid → 400'`;
  - `'registro controller: GET registri restituisce i registri dell'azienda selezionata e non scrive'` (mai di altre aziende);
  - `'registro controller: POST registri/assicura è negato a un ruolo di sola lettura'`;
  - `'lista movimenti: filtra per registroId e restituisce registroId'`;
  - `'giacenze: con registroId conta solo quel registro; senza, tutti'`;
  - `'rentri-unita-locale remove: sede con registro con movimenti → BadRequest col messaggio esatto'`;
  - `'rentri-unita-locale remove: sede con registro vuoto → cancella registro e sede nella stessa transazione'`;
  - `'rentri-unita-locale remove: sede con progressivo iniziale ma senza movimenti → rifiutata'`;
  - `'MUD: con due sedi i numeri non cambiano e l'avviso PIU_UNITA_LOCALI non dice più che il registro non indica la sede'`;
  - `'MUD: il testo contiene "tutti i registri" e "ripartizione per sede non è ancora supportata"'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui gli spec toccati, `npx tsc --noEmit -p apps/backend` (nessun errore), `npx eslint "{src,test}/**/*.ts" --quiet`. Atteso: PASS.
- [ ] **Step 5: commit** `feat(registro): registroId in API, lista e giacenze; sede con registri vuoti eliminabile; avviso MUD aggiornato`.

---

### Task 5: frontend e verifica finale

**Files:**
- Create: `apps/frontend/src/app/features/registro/registro-sede.ts`: funzioni pure `etichettaRegistro(r: RegistroVista): string` e `registroPredefinito(registri: RegistroVista[]): string | undefined` (un solo parametro: la principale si legge da `r.principale`).
- Create: `apps/frontend/src/app/features/registro/registro-sede.spec.ts`.
- Modify: `apps/frontend/src/app/features/registro/registro.service.ts`: interfaccia `RegistroVista` (con `principale: boolean`, identica a quella del backend), `listRegistri()` (GET), `assicuraRegistri()` (POST, solo per chi può registrare), `registroId` in `RegistraMovimentoRequest` e nei filtri della lista, `registroId` nel progressivo iniziale (`:142-160`).
- Modify: `apps/frontend/src/app/features/registro/registro.component.ts`: all'apertura, chi può registrare chiama `assicuraRegistri()` e gli altri `listRegistri()`; selettore "Sede" nel form di registrazione e filtro nella lista, **visibili solo se l'azienda ha più di un registro**; colonna "Sede" nella tabella con la stessa regola; il pannello del progressivo iniziale usa il registro selezionato.
- Test (Modify): `registro.service.spec.ts`.

**Interfaces:**
- `etichettaRegistro`: `denominazione` della sede o `"Registro senza sede"`, con il `numIscrSito` fra parentesi se c'è.
- `registroPredefinito`: l'id del registro con `principale === true`, altrimenti l'unico attivo, altrimenti `undefined` (il form obbliga a scegliere).

- [ ] **Step 1: test che falliscono.**
  - `'etichettaRegistro: sede con numero RENTRI → "Sede di Milano (OP…)"'`;
  - `'etichettaRegistro: senza sede → "Registro senza sede"'`;
  - `'registroPredefinito: un solo registro → lui'`;
  - `'registroPredefinito: due registri e uno principale → quello della principale'`;
  - `'registroPredefinito: due registri senza principale → undefined'`;
  - `'registro.service: listRegistri chiama GET registro/registri'`;
  - `'registro.service: assicuraRegistri chiama POST registro/registri/assicura'`;
  - `'registro.service: la registrazione invia registroId solo se valorizzato'`.
- [ ] **Step 2:** esegui con `npx ng test --watch=false --browsers=ChromeHeadless --include=...`. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui gli spec del frontend e `npx ng build` (solo controllo di compilazione). Atteso: PASS.
- [ ] **Step 5: verifica finale del pezzo** (nessun nuovo codice, solo esecuzione):
  - tutti gli spec toccati nei Task 1-4 (elenco con `git diff --name-only <base>..HEAD | grep spec`), **incluso** `isolamento-sorelle.postgres.spec.ts` e `mud-aggregazione-saldi.postgres.spec.ts`;
  - `npm run test:oracolo -- registro` se esiste un oracolo per il registro (`ls` per vedere);
  - `npx tsc --noEmit -p apps/backend` e `npx eslint "{src,test}/**/*.ts" --quiet`;
  - `npx prisma migrate diff` con esito vuoto;
  - lo spec di confronto policy-schema della RLS verde.
- [ ] **Step 6: commit** `feat(registro): selettore e colonna della sede nel registro (solo con più registri)`.

---

## Note per chi revisiona

- **Cosa non cambia:** formula di `entryHash` (D7), numeri del MUD, payload RENTRI dei FIR, regole di `giacenzaDisponibileAl` (cambia solo l'insieme dei movimenti su cui lavora).
- **Hash e registri:** con la numerazione per registro, `tenant|anno|numero|...` (`waste-movement.entity.ts:150-172`) non identifica più un'annotazione: due registri possono avere lo stesso numero e gli stessi dati. La formula resta invariata qui per non invalidare i valori esistenti; la nuova versione concatenata si introduce in F2-3.
- **Cosa resta aperto:**
  - giacenze per sede nella pagina "Giacenze" (qui solo un filtro);
  - ripartizione del MUD per sede (F2-8) e, con più registri, la denominazione del registro negli elenchi "n. ..." di `mud-controlli.ts` (si ripara con F2-8);
  - `anomaly-detection.service.ts:136` somma per tenant e con la giacenza per registro può nascondere un saldo negativo di un singolo registro: **voce esplicita di F2-6** (`registroId` nel `by` del `groupBy`), non più "aperto";
  - trasmissione del registro a RENTRI (F2-9);
  - registri conto terzi e per attività;
  - giacenze iniziali (F2-2): la condizione di "registro vuoto" di `remove` le includerà;
  - un FIR con una sede propria: finché non esiste, i movimenti con `firId` vanno nel registro della principale (D10).
- **RLS:** `registri_rifiuti` ha `tenant_id` NOT NULL, sta in `TENANT_SCOPED_MODELS` e, poiché la Fase 1 è finita, ha `ENABLE`+`FORCE ROW LEVEL SECURITY` e la policy nella migration M1. Il backfill gira con un ruolo che bypassa le policy (superuser o `BYPASSRLS`): con `FORCE` il proprietario della tabella **non** è esente. Le chiavi esterne composte con `tenant_id` sono il tema "tabelle figlie" di F1-RLS-4: queste tabelle nascono già così.
- **Conseguenze dell'endpoint `assicura`:** una sede nuova compare nell'elenco dei registri solo dopo la prima apertura della pagina da parte di chi può registrare, o dopo la prima registrazione; l'aggancio di D2 avviene in quello stesso momento, non quando si crea la sede.
- **Perché due migration:** M1 additiva e M2 che chiude i vincoli permettono di far compilare il backend a ogni commit e di non lasciare mai la tabella senza un unico valido. Vanno fatte uscire nella stessa release.
