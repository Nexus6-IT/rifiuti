# Fase 2 pezzo 10: controparti, ditta unica con sedi — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa un task alla
> volta, opus rivede ogni task. Ordine STRETTAMENTE sequenziale:
> Task 0 → 1 → 2 → 3a → 3b-1 → 3b-2 → 4 → 5a → 5b → 6 → 7 → 8 (motivo in D15). Worktree
> `C:\Progetti\rifiuti-wt-fir`, branch `feat/fase2-10-controparti` (= master `4db1b4a`, con F2-1..F2-5
> e F2-7 in produzione). In parallelo, su un altro worktree (`rifiuti-wt-rentri-b1`, Postgres 55432),
> corre F2-6 (deposito temporaneo): vedi D13.
> Piano rivisto il 2026-10-28 dopo la revisione opus (C1-C2, I1-I9, M1-M9 recepiti, decisioni
> dell'orchestratore su I2 e I6).

**Obiettivo.** Una controparte è una **ditta unica dell'azienda**, identificata da partita IVA o
codice fiscale (anche un privato con il solo codice fiscale), con **più sedi**. Le tre anagrafiche
per ruolo (Produttore, Trasportatore, Destinatario) restano, con gli **stessi id**, e puntano a
ditta e sede. Il FIR può indicare la sede del produttore e del destinatario; i FIR esistenti e il
loro snapshot non cambiano. Deduplica e ricerca per auto-compilazione lavorano sulla ditta.

**Fonti.**
- Roadmap `C:\Progetti\winwaste\docs\roadmap-fase2-parita-registro.md` §F2-10 (`:291-321`), §0.2
  (`:43`), §2 punto 9, §3 (regole RLS 1-3 e 6, tabella `:377`).
- `C:\Progetti\winwaste\docs\roadmap-fasi3-4-import-gestori.md` §3.1 (`:135`, colonne di
  provenienza `importSource`/`legacyKey` sulle ditte), §3.3 (`:180-205`, import di sedi legali e
  unità locali, dedup per P.IVA o CF "si segnala, non si corregge"), §4.1 (`:354-378`, il cliente
  è una ditta con sedi).
- WinWaste: `formulari.md` §2 (`:73` `PROD`(11) = anagrafica 6 + unità locale e `AUTP`
  autorizzazione; `:76` `SMAL` + `AUTS`); `rentri/03-aggancio-a-winwaste.md:204,261-266`
  (`CalcolaSoggetto` su `[unita locali]`/`[sedi legali]`/`autorizzazioni`: il soggetto del FIR è
  `ditta.unità`, l'autorizzazione è dell'unità); `confronto-rifiuti/04-piattaforma-e-migrazione.md:315,335`
  (chiave legacy `ditta|PRECOD|COD`, collisione col vincolo unico P.IVA).
- Piani modello: `docs/superpowers/plans/2026-10-28-fase2-4-7-fir.md` (snapshot, D7, D9, C1) e
  `2026-10-28-fase2-5-causali.md` (RLS di una tabella nuova, convivenza fra branch).

## Stato di partenza (verificato su `4db1b4a`)

Percorsi relativi a `apps/backend/` salvo indicazione (`src/` per il codice).

**Schema.**
- `prisma/schema.prisma:1213-1239` `Produttore`: `partitaIVA String @db.VarChar(11)` NOT NULL
  (`:1220`), indirizzo (`via`, `civico`, `cap`, `comune`, `provincia`) e contatti (`email`,
  `telefono`, `pec`) sulla riga, `@@unique([tenantId, partitaIVA])` (`:1236`).
  `Trasportatore` `:1241-1274` (P.IVA `:1248`, unico `:1271`, più `numeroIscrizione`,
  `scadenzaIscrizione`); `Destinatario` `:1276-1309` (P.IVA `:1283`, unico `:1306`, più
  `numeroAutorizzazione`, `scadenzaAutorizzazione`). Nomi degli indici unici:
  `produttori_tenant_id_partita_iva_key`, `trasportatori_…`, `destinatari_…`
  (`prisma/migrations/20260609065136_init/migration.sql:629,635,641`). Relazioni inverse su
  `Tenant` a `:114-116`.
- **Nessuna chiave esterna** verso le anagrafiche: `firs.producer_id`, `carrier_id`, `receiver_id`
  sono `String?` senza relazione (`schema.prisma:293,300,307`), `contracts.producer_id` e
  `counterparty_id` idem (`:1719-1720`), `fir_transporters.trasportatore_id` idem (`:663`). Gli id
  delle righe di ruolo vanno quindi **conservati**: sono il legame di FIR e contratti.
- Snapshot sul FIR: `producer_partita_iva VarChar(11)` NOT NULL, `producer_name`,
  `producer_address`, `producer_contact` (`:294-297`), carrier `:301-304` (nessun indirizzo),
  receiver `:308-311`. Nessuna colonna per il codice fiscale né per la sede. `fir_transporters` ha
  già `partita_iva VarChar(11)?` e `codice_fiscale VarChar(16)?` (`:667-668`).
- Ultima migration: `20261030110000_fir_versione`. F2-6 userà `20261031100000_…`.

**Dominio e persistenza delle anagrafiche.**
- VO `domain/registry/value-objects/partita-iva.ts:25-35`: solo 11 cifre, **nessun checksum**
  ("For MVP"). Il checksum c'è già in `domain/shared/partita-iva.vo.ts:40-63`
  (`PartitaIva.isValid`), e il codice fiscale con carattere di controllo (16 caratteri, omocodia
  compresa; 11 cifre = P.IVA) in `domain/shared/codice-fiscale-soggetto.ts:46-57`
  (`normalizzaCodiceFiscaleSoggetto`, `codiceFiscaleSoggettoValido`), oggi usato dal MUD.
  `InvalidPartitaIVAError` mette il valore nel messaggio (`core/domain/errors.ts:40-45`).
  **Una P.IVA di comodo come `'12345678901'` NON passa il checksum; `'12345678903'` sì** (verificato
  a mano con l'algoritmo di `partita-iva.vo.ts`).
- Entità `domain/registry/entities/{produttore,trasportatore,destinatario}.ts` (P.IVA `readonly`,
  `sedeLegale`/`sede: Indirizzo`, contatti). `Indirizzo` (`value-objects/indirizzo.ts`) esige via,
  civico, CAP di 5 cifre, città, provincia di 2 lettere; `getFormatted()` `:98`.
- Repository `infrastructure/persistence/{produttore,trasportatore,destinatario}-prisma.repository.ts`:
  `save` = `upsert` di tutte le colonne (`:18`), `findById` scoped per tenant (`:47`/`:49`),
  `findByTenantId` ordinato per ragione sociale (`:62`/`:64`), `findByPartitaIVA` (`:71`/`:73`),
  `findByNumeroAutorizzazione`/`findByNumeroIscrizione` (`:90`), `delete` = `deleteMany` (hard
  delete, `:88`/`:107`), `toDomain` con `PartitaIVA.create(record.partitaIVA)` (`:101`/`:119`).
- Use case `application/registry/use-cases/`: `create-{produttore,trasportatore,destinatario}`
  rifiutano una P.IVA già presente **nello stesso ruolo** (`create-produttore.use-case.ts:44`,
  `create-trasportatore.use-case.ts:46`, `create-destinatario.use-case.ts:46`, messaggi inglesi);
  nessun controllo fra ruoli diversi; `update-*`, `get-*`, `list-*`, `delete-*` (uno per ruolo).
  `UpdateProduttoreDto` non ammette la P.IVA (`api/registry/dto/create-registry.dto.ts:149`).
- `api/registry/registry.controller.ts`: `POST/GET/GET :id/PUT :id/DELETE :id` per i tre ruoli
  (`:74-390`), scritture con `@Roles('SUPER_ADMIN','ADMIN','OPERATOR')`, letture senza `@Roles`.
  Wiring: `api/registry/registry.module.ts:43-79` e, per i FIR, `fir/fir.module.ts:49-74,140-157`
  (le factory ricevono `ProduttorePrismaRepository` ecc. direttamente).

**Inventario degli usi (decisione 1 dell'orchestratore).**

*Backend, codice:*
1. Registry: entità, repository e use case sopra; `api/registry/registry.controller.ts`,
   `api/registry/dto/create-registry.dto.ts`, `api/registry/registry.module.ts`, `fir/fir.module.ts`.
2. Contratti `application/contracts/contract.service.ts`: `registroPerTipo` `:189-198`,
   `assertPartiEsistono` (solo `id`) `:207-233`, `risolviParti` (select `ragioneSociale`,
   `partitaIVA`) `:245-276`, `getAutoFillForFir` (solo `contract.producerId`/`counterpartyId`)
   `:283-318`, `ContractParty.partitaIVA: string` `:48-52`; `contract.controller.ts:52-63` (auto-fill).
3. MUD `application/mud/aggregazione/mud-aggregazione.service.ts`: trasportatori `:935-941`
   (`ragioneSociale`, `partitaIVA`), destinatari `:960-990` (riga intera: `comune`, `provincia`,
   `via`, `civico`, `cap`, `partitaIVA` come codice fiscale del soggetto). **La ragione sociale
   entra nelle chiavi delle integrazioni salvate**: `chiaveDestinatario(v.dr.ragioneSociale)` `:824`,
   `chiaveDestinatario(t.ragioneSociale)` `:898`, chiave del TE `:785` (funzione in
   `mud-integrazioni.ts`, usata anche da `mud-controlli.ts:7`).
4. Dashboard `application/dashboard/raccogli-attenzione.use-case.ts:232,251-252,270,289-290`.
5. Scadenze `application/notifications/deadline-checker.service.ts:450,473` (client di sistema
   `PrismaSistemaService`, `:40`) e il template `infrastructure/email/templates/counterparty-expiration.hbs`
   (riceve i dati dal servizio, non legge il database).
6. RENTRI `application/rentri/mappatura/costruisci-payload-rentri.ts:48-50,125-155`: legge **dal
   vivo** la riga del registro dal `registroId` dello snapshot, **con accesso dinamico**
   (`this.prisma.db[nomeParte]`, cast `as never`, `:139-149`): tsc **non** segnala una colonna che
   sparisce, si ottiene `undefined`. Passa la P.IVA come `codice_fiscale`
   (`mappa-parti.ts:183-201,220,254`, "scelta opinabile" documentata).
7. FIR: `application/fir/snapshot-parti.ts` (snapshot da entità, `p.partitaIVA.getValue()`),
   `create-fir.use-case.ts:53-91`, `modifica-fir.use-case.ts:61-112` (D7 di F2-4: stesso id =
   snapshot congelato), `api/fir/dtos/create-fir.dto.ts:136-170`, `modifica-fir.dto.ts:22`
   (`OmitType(CreateFIRDto, ['rifiuto'])`), `fir-response.dto.ts`.
8. FIR da RENTRI `application/rentri/crea-fir-da-dettaglio-rentri.use-case.ts:189-219`: mette il
   `codice_fiscale` dell'ente in `ParteFIR.partitaIva` (un CF di 16 caratteri non entra in
   `producer_partita_iva VarChar(11)`: oggi l'acquisizione di un FIR con produttore privato fallisce).
9. Persistenza FIR `infrastructure/persistence/fir-prisma.repository.ts:815-825` (`toPersistence`:
   `producerPartitaIva: produttore?.partitaIva ?? ''`, `''` è già la convenzione "senza P.IVA"),
   `:1000-1010`, `:1036-1048`.
10. Aggregate lifecycle `domain/fir/aggregates/fir.aggregate.ts:129-136` (`ParteFIR`), `:692-703`
    (`stessaParte`); aggregate crittografico `domain/fir/fir.aggregate.ts:29-44,263-275`
    (`toSignableDocument`; `schemaVersion` non persistita, `signature-fir.repository.ts:264-267`:
    ogni campo nuovo nel documento canonico renderebbe non verificabili le firme esistenti).
11. PDF `infrastructure/pdf/pdf.service.ts:128-136`, `:329-330`.
12. Analytics `application/analytics/analytics.service.ts:413-450` (`groupBy producerPartitaIva`
    sullo snapshot: non tocca le anagrafiche).
13. Filtro errori `core/filters/http-exception.filter.ts:87-100,187` (Prisma noti → status, messaggi
    generici); Bugsink `core/monitoring/opzioni-sentry.ts:218-228` (toglie corpo e query, **non**
    il messaggio dell'eccezione).
14. **Import**: nessuno oggi (roadmap 3-4 §2). **Export**: `apps/frontend/src/app/core/services/export.service.ts:128-130,192-193`
    esporta solo gli id delle parti del FIR.

*Backend, spec e strumenti che si rompono quando cambiano entità e righe di ruolo:*
`application/fir/snapshot-parti.spec.ts`, `application/fir/use-cases/create-fir.use-case.spec.ts`,
`modifica-fir.use-case.spec.ts`, `application/registry/use-cases/create-produttore.use-case.spec.ts`,
`produttore-istat-validation.spec.ts`, `update-trasportatore.use-case.spec.ts`,
`update-destinatario.use-case.spec.ts`, `domain/registry/entities/*.spec.ts`,
`infrastructure/persistence/produttore-prisma.repository.spec.ts`, `tenant-isolation.spec.ts:50-136`
(mock), `api/registry/registry.controller{,.authorization,.scadenza-update}.spec.ts`,
`infrastructure/persistence/fir-modifica-bozza.postgres.spec.ts`, `rls-percorsi-reali.postgres.spec.ts:117,183`,
`application/gruppo/isolamento-sorelle.postgres.spec.ts:75-198`,
`infrastructure/persistence/prisma-service-tenant.postgres.spec.ts:9,53-73` (trigger di prova su
`produttori.via`), `test/integration/setup.ts:93-130` (escluso da tsc e da jest: `tsconfig.json:31`,
`jest.config.js:3`). Nelle fixture ci sono P.IVA senza checksum valido.

*E2E (`e2e/`, radice):* generatori di P.IVA casuali **senza checksum**:
`tests/registry/produttore.spec.ts:29` (`nuovaPartitaIVA`), `tests/registry/trasportatore-destinatario.spec.ts:44`,
`tests/scadenze/flusso-scadenze.spec.ts:82`, `tests/pulizia/pulizia-self-test.spec.ts:39`
(`partitaIvaCasuale`); `tests/public/guardrail-self-test.spec.ts` non genera P.IVA ma controlla la
blacklist delle rotte distruttive di `/registry/produttori/…` (`:44,87,150,162`, `utils/blacklist.ts`).
`utils/db-locale.ts:186-210` (`anagraficheConPrefissoResidui`) legge `ragioneSociale` dalle tre
tabelle di ruolo. La CI esegue solo `tests/public` (`.gitea/workflows/ci.yml:669`) e il lint di
`e2e/**/*.ts` (`:462`).

*Frontend (`apps/frontend/src/app/`):* `shared/models/registry.model.ts:9-55` (`partitaIVA: string`),
`features/registry/registry.service.ts` (CRUD; `search*` `:126-139` chiamano rotte `…/search` che
**non esistono** e non hanno chiamanti: codice morto, non si tocca), form in linea delle tre liste
(`produttori-list.component.ts:120,235-236,684`, `trasportatori-list.component.ts`,
`destinatari-list.component.ts:123,242-243`), `anagrafica-form-dialog.component.ts:623,702`,
`anagrafica-select.component.ts:29-36,92,279,329-335` (contratti), `contracts/contracts-list.component.ts:146`,
`contracts/contracts.service.ts:36-40,96,148` (`autoFill` senza chiamanti), `fir/fir-list.component.ts`
con **quattro** tendine di parti (`:349-372` produttore, `:407-432` trasportatore, `:477-502`
destinatario, `:575-591` trasportatori aggiuntivi), `fir/fir-detail.component.ts:222-238`,
`fir/fir-form.ts:14-19`, `features/registro/registro.component.ts:831,1653,1685` (tendina dei
produttori, già tollerante a `null`: **non si tocca**, D13).
`features/registry/produttori-list-enhanced.component.ts` **non è instradato** (`app.routes.ts:83-99`
usa `produttori-list.component`): codice morto, si ignora.
Fixture Karma con P.IVA senza checksum valido (es. `'01234567890'` ×10, `'09876543210'`,
`'12345678901'`, `'11122233344'`, `'55566677788'`, `'98765432109'`) negli spec di
`features/registry`, `features/fir`, `features/contracts`.

**RLS, ruoli, test.**
- `TENANT_SCOPED_MODELS` `src/infrastructure/persistence/prisma-rls.extension.ts:47-91`, test
  `prisma-rls.extension.spec.ts:187-217`. Catalogo: `rls-catalogo.postgres.spec.ts:64`
  `toBe(32)`; "(32)" in `README-tenant-transazione.md:120,131,143`. Forma delle policy:
  `prisma/migrations/20261027100000_registro_per_sede/migration.sql:171-177`. Privilegi: i default
  privileges di `prisma/sql/ruoli-db.sql` danno CRUD alle tabelle nuove (nessun GRANT). Indice unico
  parziale solo SQL già usato due volte (`registri_rifiuti_uno_senza_sede_per_tenant`,
  `causali_registro_azienda_una_aperta`) con `migrate diff` vuoto.
- Modello di test della migration dati: `src/application/registro/registro-migrazione.postgres.spec.ts:1-60`.
- `src/test-support/` esiste (`argomenti-handler.ts`) ma **non** è escluso né dalla build
  (`nest build` usa `tsconfig.json`, che esclude solo `test` e `**/*spec.ts`, `:31`) né dalla
  coverage (`jest.config.js:36-43`).
- **Guard su 55432.** Ripiego dell'URL su `127.0.0.1:55432` quando `DATABASE_URL` manca in ~35 spec
  Postgres (innocuo se `DATABASE_URL` è esportata). In più **5 controlli fissi**, **4 in
  `application/registro/`** e **1 nel MUD**, che fanno fallire la suite su qualunque altra porta:
  `application/registro/causali/catalogo-causali.repository.postgres.spec.ts:87`,
  `application/registro/causali/causali-registro.service.postgres.spec.ts:162`,
  `application/registro/use-cases/correggi-movimento.causali.postgres.spec.ts:179`,
  `application/registro/use-cases/registra-movimento.causali.postgres.spec.ts:134`,
  `application/mud/aggregazione/mud-aggregazione-causali.postgres.spec.ts:134`. La CI usa 55432
  (`.gitea/workflows/ci.yml:207`).

## Decisioni

- **D1. Modello (vincolante, dettagliato).** Due tabelle nuove:
  - `ditte` (`Ditta`): identità fiscale e ragione sociale. Per un privato la ragione sociale è
    "Cognome Nome".
  - `sedi_ditte` (`SedeDitta`): indirizzo (stessi campi e limiti di oggi), `denominazione`
    facoltativa, `referente`, `email`, `telefono`, `pec`, `principale`, `attiva`. I contatti stanno
    sulla sede perché oggi stanno sulla riga di ruolo, e la migration non deve perderli.
  Le righe di ruolo restano con **gli stessi id** (legame di FIR e contratti, nessuna FK) e i soli
  dati del ruolo (albo e scadenza; autorizzazione e scadenza), più `ditta_id` e `sede_id` NOT NULL
  (**sede predefinita del ruolo**, D4). **Una riga per ruolo per ditta**: `UNIQUE(tenant_id,
  ditta_id)`. Motivo: contratti, auto-compilazione e `firs.producer_id` restano 1:1 con la ditta
  senza toccarli; la scelta della sede passa dal FIR (D9). Alternativa scartata: una riga di ruolo
  per (ditta, sede), come `ditta.unità` di WinWaste (duplicherebbe albo e scadenze e farebbe
  apparire la stessa ditta più volte). **Limite accettato:** l'autorizzazione del destinatario resta
  per ruolo, non per sede (seguito con 3.3).
- **D2. Identificativi e validazione.** Su `ditte`: `partita_iva VarChar(11)?`, `codice_fiscale
  VarChar(16)?`, CHECK "almeno uno" e CHECK di **forma** (P.IVA `^[0-9]{11}$`; CF
  `^([A-Z0-9]{16}|[0-9]{11})$`). Il **checksum non sta nel database** (le P.IVA migrate non sono mai
  state controllate): lo applica l'applicazione **quando un identificativo viene impostato**, mai in
  lettura né quando si modifica altro. Un solo VO `domain/registry/value-objects/identificativo-fiscale.ts`
  che **riusa** `PartitaIva.isValid` e `codiceFiscaleSoggettoValido`/`normalizzaCodiceFiscaleSoggetto`:
  1. normalizzazione: maiuscolo, senza spazi, prefisso `IT` tolto dalla P.IVA;
  2. P.IVA: 11 cifre con checksum;
  3. CF: 16 caratteri con carattere di controllo (persona fisica) oppure 11 cifre con checksum
     (persona giuridica o ente). Un CF più lungo di 16 caratteri (codici esteri) → **400 di campo**
     (`@MaxLength(16)` nel DTO con messaggio "Il codice fiscale ha al massimo 16 caratteri: le
     controparti estere non sono ancora gestite"), non un 500 di Prisma;
  4. se CF e P.IVA coincidono si conserva solo la P.IVA (`codice_fiscale` NULL);
  5. **privato = solo CF di 16 caratteri**, ammesso **solo come Produttore**; Trasportatore e
     Destinatario esigono una P.IVA o un CF numerico (400 "Un privato senza partita IVA può essere
     solo produttore.");
  6. una P.IVA migrata senza checksum valido resta com'è; le risposte espongono
     `partitaIvaDaVerificare: true`; nessuna correzione automatica (3.3: "si segnala, non si corregge");
  7. gli identificativi impostati **non si cambiano**; si può **aggiungere** quello mancante;
  8. **unica eccezione (I3): sostituzione della P.IVA** di una ditta **solo se quella attuale non
     passa il checksum e la nuova sì**, sotto il lock D3 (su entrambi i valori), con verifica di
     unicità e una riga di audit in `activity_logs` (`action 'DITTA_PARTITA_IVA_CORRETTA'`,
     `tenantId`, `userId`, metadata `{ dittaId }`, nessun valore). Lo snapshot dei FIR già creati non
     cambia (è il documento di allora);
  9. `InvalidPartitaIVAError` (`core/domain/errors.ts:40-45`) smette di mettere il valore nel
     messaggio (M9): "Partita IVA non valida: servono 11 cifre."; stessa regola per gli errori nuovi.
- **D3. Unicità, deduplica e creazione atomica (I1).** `@@unique([tenantId, partitaIva])` e
  `@@unique([tenantId, codiceFiscale])` come **indici unici Prisma normali**: in PostgreSQL i NULL
  sono distinti (`NULLS DISTINCT` di default), quindi l'indice equivale al "parziale dove il campo
  non è nullo" della roadmap ma resta esprimibile in Prisma (nessun drift); un test lo dimostra. La
  ricerca per identificativo guarda **entrambe le colonne**. **La creazione di un ruolo è una sola
  transazione**, in quest'ordine:
  1. `pg_advisory_xact_lock(hashtext('ditta|' || tenant || '|' || identificativo))` per ciascun
     identificativo, in ordine alfabetico (niente deadlock);
  2. ricerca della ditta (nessuna → nuova; una → riuso, con eventuale aggiunta D2.7 o rifiuto se
     contraddice; due → 409 "Partita IVA e codice fiscale appartengono a due anagrafiche diverse");
  3. ruolo già presente per quella ditta (`findByDittaId(tx, …)`) → 400 "Esiste già un produttore
     per questa ditta";
  4. sede (D4);
  5. insert della riga di ruolo **con lo stesso `tx`** (i repository di ruolo accettano un client
     transazionale).
  Reti di sicurezza: P2002 su `ditte_tenant_id_*_key` → 409 "Esiste già un'anagrafica con questo
  identificativo fiscale"; P2002 su `<tabella>_tenant_id_ditta_id_key` → lo stesso 400 del punto 3.
  Nessun valore nei messaggi.
- **D4. Sedi.** Esattamente **una sede principale** per ditta: "al più una" nel database (indice
  unico parziale solo SQL `sedi_ditte_una_principale ON sedi_ditte(ditta_id) WHERE principale`, CHECK
  `sedi_ditte_principale_attiva`), "almeno una" garantita dall'applicazione e dai test. **Le sedi non
  si cancellano**: si disattivano. Non si disattiva la principale né la **sede predefinita di un
  ruolo** (409 "È la sede predefinita del destinatario: scegline un'altra prima"). Le ditte non si
  cancellano: la `DELETE` di un ruolo cancella solo la riga di ruolo; una nuova creazione riusa
  ditta e sedi. Sedi solo italiane, come oggi. **Sede predefinita del ruolo** alla creazione: la
  sede attiva con lo stesso indirizzo normalizzato (D5.4) se esiste, altrimenti una nuova sede non
  principale (o la principale se la ditta è nuova). Si cambia con `PUT` del ruolo (`sedeId`).
- **D5. Migration dati (vincolante: "ogni anagrafica diventa una ditta con una sede").**
  `20261031110000_ditte_sedi_controparti`, eseguita da `wasteflow` (superuser con BYPASSRLS). Il
  backfill sta in una **funzione SQL idempotente** `f210_collega_anagrafiche()` che lavora **solo
  sulle righe di ruolo con `ditta_id` NULL** (riusa ditta e sede esistenti per (tenant, P.IVA) e
  chiave d'indirizzo, crea quelle mancanti): la 110000 la crea e la chiama, la 110100 la richiama e
  poi la elimina (I6). Regole:
  1. **Precondizione fail-closed**: una P.IVA (dopo `btrim`) che non sia di 11 cifre → `RAISE
     EXCEPTION` con i **soli conteggi per tabella**. Il censimento (D5.8) lo verifica prima.
  2. **Stessa P.IVA in più ruoli della stessa azienda** → **una sola ditta con più ruoli** (è il
     motivo stesso del pezzo). Mai fra aziende diverse. **Deviazione dalla lettera della roadmap**
     ("ogni anagrafica diventa una ditta con una sede"): la si segnala nel rapporto finale (Task 8).
  3. Ragione sociale della ditta = quella della riga aggiornata più di recente fra le righe con quella
     P.IVA (a parità: produttore, destinatario, trasportatore, poi id); `created_at` = il minimo,
     `updated_at` = il massimo.
  4. **Sedi**: una per indirizzo distinto della ditta; chiave normalizzata = `lower` + spazi compressi
     di `via`, `civico`, `comune`, più `btrim(cap)` e `upper(btrim(provincia))`. Contatti della sede
     dalla riga più recente con quell'indirizzo. Principale = la sede della riga scelta al punto 3.
  5. Ogni riga di ruolo riceve `ditta_id` e `sede_id` (la sede del **proprio** indirizzo). Controlli
     finali con `RAISE EXCEPTION`: nessuna riga senza ditta o sede; ogni ditta con esattamente una
     principale.
  6. `RAISE NOTICE` con i conteggi (informativi; **i test non li leggono**, I5: verificano i dati).
  7. Le colonne di oggi **restano** come copia congelata (D6): nessun dato si perde.
  8. **Censimento PRIMA del merge** (I6): lo lancia l'orchestratore sul VPS, sola lettura, soli
     conteggi; query pronta nel Task 1 e in `ops/README.md`. `piva_non_conformi > 0` blocca il merge
     finché le righe non sono corrette a mano. Il numero di **ditte fuse con nome divergente** va
     nel rapporto (D10, I2).
  9. **Ripristino da migration fallita (P3009)** documentato in `ops/README.md`: la migration è
     transazionale (DDL e DML in un solo script; un `RAISE` annulla tutto). Si controlla che
     `ditte` non esista (`SELECT to_regclass('public.ditte')` → NULL), si corregge il dato, poi
     `npx prisma migrate resolve --rolled-back 20261031110000_ditte_sedi_controparti` (o il nome della
     migration fallita) e si rilancia il deploy.
  Il `codice_fiscale` migrato è sempre NULL. Nessun dato di FIR o contratti viene toccato.
- **D6. Colonne vecchie delle righe di ruolo.** In `20261031110100_anagrafiche_su_ditte` (Task
  3b-2): `SELECT f210_collega_anagrafiche()` (completa le righe create dal backend vecchio fra la
  110000 e l'avvio del nuovo: il deploy applica le migration mentre il vecchio è ancora in servizio,
  I6), `DROP FUNCTION`, poi `ditta_id`/`sede_id` NOT NULL; le colonne vecchie perdono il NOT NULL,
  gli indici `*_tenant_id_partita_iva_key` cadono, `COMMENT ON COLUMN` "F2-10: copia congelata, non
  più scritta". Nello schema Prisma:
  - `ragione_sociale` resta **visibile** ma rinominata nel client: `ragioneSocialeStorica String?
    @map("ragione_sociale")` (serve al MUD, D10/I2; la rinomina fa emergere in compilazione ogni altro
    lettore);
  - le altre (`partita_iva`, indirizzo, contatti) opzionali con **`@ignore`**;
  - **in ogni caso** uno spec di guardia `src/infrastructure/persistence/anagrafiche-colonne-congelate.spec.ts`
    che scorre i file non di test sotto `src/` e fallisce se trova, su `.produttore`,
    `.trasportatore`, `.destinatario` o `db[nomeParte]`, i nomi delle colonne congelate fuori da un
    elenco esplicito di eccezioni (MUD per `ragioneSocialeStorica`): copre gli accessi dinamici che
    tsc non vede (I7). Se `@ignore` desse problemi con Prisma 5.22, campi opzionali senza `@ignore` e
    la sola guardia, detto nel rapporto.
  La rimozione fisica è un seguito (F2-10b).
- **D7. API (compatibili: solo aggiunte, salvo dove motivato).**
  - Ruoli, `POST /registry/{produttori|trasportatori|destinatari}`: `partitaIVA` **facoltativa** (dal
    Task 3b-2), nuovo `codiceFiscale` facoltativo (almeno uno, D2). Deduplica D3. Risposta: i campi di
    oggi più `codiceFiscale`, `dittaId`, `sedeId`, `dittaEsistente`, `avvisi: string[]` (es. "La
    ragione sociale registrata per questa ditta è «…»: è stata mantenuta.").
  - `PUT /registry/{ruolo}/:id`: più `codiceFiscale?`/`partitaIVA?` (aggiunta D2.7 o sostituzione
    D2.8; altrimenti 400) e `sedeId?` (nuova sede predefinita, attiva, della stessa ditta). `sedeId` e
    indirizzo insieme → 400 "Scegli la nuova sede predefinita oppure modifica l'indirizzo, non
    entrambi". `ragioneSociale` modifica la **ditta**, l'indirizzo la **sede predefinita**, entrambe
    condivise con gli altri ruoli (la risposta lo dice con `ruoliDitta`).
  - `GET` lista e dettaglio: campi di oggi (`partitaIVA: string | null`; `sedeLegale`/`sede` = sede
    predefinita) più `codiceFiscale`, `dittaId`, `sedeId`, `numeroSedi`, `partitaIvaDaVerificare`;
    il dettaglio anche `ruoliDitta`. Ordinamento per ragione sociale della ditta.
  - `DELETE` del ruolo: invariata.
  - Nuove rotte `api/registry/ditte.controller.ts` (`@Controller('registry/ditte')`, guardie del
    registry; letture senza `@Roles`, scritture `@Roles('SUPER_ADMIN','ADMIN','OPERATOR')`):
    `POST cerca` (corpo `{ identificativo }`; **POST** perché un CF in query string finirebbe nei log di
    nginx) → `{ ditta: DittaDto | null }`; `GET :id`; `PUT :id` (`ragioneSociale`, aggiunta o
    sostituzione D2.7-D2.8); `POST :id/sedi`; `PUT :id/sedi/:sedeId`; `POST :id/sedi/:sedeId/principale`.
    `DittaDto` = `{ id, ragioneSociale, partitaIva, codiceFiscale, partitaIvaDaVerificare, privato,
    sedi: SedeDto[], ruoli: { produttoreId?, trasportatoreId?, destinatarioId? } }`. `ParseUUIDPipe`;
    ditta o sede di un'altra azienda → 404 senza id.
- **D8. Auto-compilazione e deduplica "sulla ditta".** L'auto-compilazione del FIR dal **contratto**
  (`GET /contracts/auto-fill`) lavora sugli id di ruolo, 1:1 con la ditta: **non cambia** (e nel
  frontend non ha chiamanti). L'auto-compilazione dell'**anagrafica** usa `POST /registry/ditte/cerca`
  dal form di creazione; la deduplica vera è nel backend (D3).
- **D9. FIR (decisione 3 dell'orchestratore).**
  1. `CreateFIRDto` riceve `produttoreSedeId?` e `destinatarioSedeId?` (`@IsOptional() @IsUUID()`),
     ereditati da `ModificaFIRDto`. Il trasportatore non ha sede sul FIR.
  2. **Default = sede predefinita del ruolo**, non la principale della ditta: per una ditta fusa
     (produttore in via A, destinatario in via B) la principale cambierebbe l'indirizzo dei FIR nuovi
     di uno dei due ruoli rispetto a oggi. Per i client attuali, che non mandano il campo, il FIR resta
     identico a oggi.
  3. Sede indicata: attiva e della ditta del ruolo, altrimenti 400 "La sede indicata non è una sede
     attiva del produttore scelto".
  4. Persistenza (migration `20261031110200_fir_parti_sede_cf`, additiva): `firs.producer_sede_id`,
     `receiver_sede_id` (UUID NULL, **senza FK**) e `producer_codice_fiscale`, `carrier_codice_fiscale`,
     `receiver_codice_fiscale` (VarChar(16) NULL). I FIR esistenti restano con NULL. Lo snapshot mette
     in `*_partita_iva` la P.IVA o `''`, in `*_codice_fiscale` il CF; le tratte valorizzano il loro
     `codice_fiscale`.
  5. `ParteFIR` riceve `sedeId?` e `codiceFiscale?`; `stessaParte` li confronta.
  6. Modifica della bozza (D7 di F2-4 esteso), **regole esplicite (I4)**:
     - stesso id di ruolo e sede del DTO **assente** → si conserva sede e snapshot del FIR (anche
       NULL per i FIR precedenti);
     - stesso id e sede del DTO **uguale a quella del FIR** → invariato;
     - stesso id, FIR con sede **NULL** e sede del DTO **uguale alla predefinita del ruolo** →
       **invariato** (il FIR era stato creato su quella sede): niente scrittura, 200, versione
       invariata, come D9 di F2-4;
     - stesso id e sede diversa → nuovo snapshot da quella sede;
     - id cambiato → sede indicata o predefinita del nuovo ruolo, nuovo snapshot.
     Il frontend manda la sede **solo se l'utente l'ha cambiata** (Task 7).
  7. Documento firmato: `producerCodiceFiscale`, `carrierCodiceFiscale`, `receiverCodiceFiscale` entrano
     **solo se non nulli**; ogni FIR esistente o con sole P.IVA dà lo stesso documento canonico di
     prima (test golden). La sede non entra.
  8. RENTRI: riga di ruolo con ditta e sede; sede = quella del FIR (filtrata per tenant e ditta del
     ruolo) o, se NULL, la predefinita; sede non trovata → `DatoMancantePerRentriError`.
     `codice_fiscale` = CF della ditta se c'è, altrimenti P.IVA (chiude la "scelta opinabile").
  9. FIR da RENTRI: `codice_fiscale` di 11 cifre → `partitaIva`; altrimenti `partitaIva = ''` e
     `codiceFiscale` = valore.
  10. PDF: `fiscalCode: fir[`${nome}CodiceFiscale`]`, `vatNumber: fir[…PartitaIva] || undefined`.
  11. Risposta: `codiceFiscale` e `sedeId` di ogni parte.
- **D10. Altri lettori.** Contratti, dashboard e scadenze: ragione sociale e identificativo dalla
  ditta, indirizzo dalla sede predefinita. `ContractParty` riceve `codiceFiscale` e `partitaIVA:
  string | null`. **MUD (decisione dell'orchestratore su I2):** il MUD **non cambia nome ai record
  DR/TE né stacca le integrazioni salvate**: ragione sociale del soggetto e `chiaveDestinatario` usano
  la ragione sociale **della riga di ruolo** (`ragioneSocialeStorica`, congelata dalla migration),
  e solo per le righe create dopo il deploy (dove è NULL) quella della ditta. La ragione sociale della
  ditta serve all'anagrafica, non al MUD. Indirizzo dalla sede predefinita; codice fiscale del
  soggetto = CF ?? P.IVA (per le righe migrate il CF è NULL: valore identico a oggi). Il MUD non usa
  ancora la sede scelta sul singolo FIR (F2-8). Analytics invariata (seguito).
- **D11. RLS e ruoli DB.** `ditte` e `sedi_ditte`: `tenant_id` NOT NULL con FK `CASCADE` verso
  `tenants`; `@@unique([id, tenantId])` su entrambe e `@@unique([id, dittaId, tenantId])` sulle sedi;
  sede → ditta `(ditta_id, tenant_id)` `CASCADE`; ruolo → ditta `(ditta_id, tenant_id)` e ruolo → sede
  `(sede_id, ditta_id, tenant_id)` (la sede è della stessa ditta, imposto dal database) con
  `NO ACTION`. `ENABLE` + `FORCE`, `isolamento_azienda`, `sola_lettura TO wasteflow_lettura` (forma
  di `20261027100000_registro_per_sede/migration.sql:171-177`). Nessun GRANT. `Ditta`, `SedeDitta`
  in `TENANT_SCOPED_MODELS`. Catalogo 32 → **34**. Ogni query nuova porta `tenantId` nel `where`.
- **D12. Codice fiscale e GDPR.** Il CF di un privato è un dato personale:
  - mai nei log, nei metadata di `activity_logs`, nei messaggi d'errore (4xx e 5xx), nelle eccezioni
    dei VO, nei NOTICE, in query string;
  - **violazioni di vincoli Postgres (M5)**: il dettaglio di una violazione di CHECK riporta la riga
    intera ("Failing row contains (…)"), CF compreso. Il filtro HTTP risponde già con un messaggio
    generico (da verificare con un test per l'errore Prisma sconosciuto/`P2010`/CHECK); in più
    `ripulisciEventoSentry` (`opzioni-sentry.ts`) toglie dal messaggio e dai valori dell'eccezione
    ogni testo da `Failing row contains` in poi e ogni `DETAIL:`. Test su un evento costruito con
    quel messaggio;
  - restituito nelle risposte a chi già legge l'anagrafica;
  - oblio/conservazione: seguito.
- **D13. Convivenza con F2-6.** Questo piano **non tocca** `application/giacenze/**`,
  `application/anomal*/**`, `deposito-temporaneo*`, soglie, `application/registro/**`,
  `api/registro/**`, `domain/waste-movement/**`, `apps/frontend/src/app/features/registro/**`,
  **salvo** la riga del guard 55432 dei **4 spec** di `application/registro/` (Task 0, una riga e un
  import per file). Schema: modelli nuovi **in coda**; su `Tenant`, ruoli e `FIR` solo righe nuove in
  fondo ai blocchi (`// Fase 2 pezzo 10`). Migration `20261031110000`, `110100`, `110200` (F2-6:
  `20261031100000`). **Al merge (M6)**: chi entra per secondo fa rebase, `npx prisma generate`,
  `migrate deploy`, `migrate diff` vuoto, conteggio del catalogo **35**; se l'ordine per nome delle
  migration non segue più l'ordine di merge (per esempio F2-6 rinomina dopo la 110000), **chi entra
  per secondo rinomina il timestamp della propria** migration, prima del merge e mai dopo un deploy.
- **D14. Guard su 55432.** Si **parametrizzano** i 5 controlli fissi (4 in `registro/`, 1 nel MUD) con
  un helper `src/test-support/database-di-test.ts` `eDatabaseDiTestLocale(url)` vero solo per
  `postgresql://…@(127.0.0.1|localhost):<porta>/wasteflow_ci`. Conserva lo scopo (mai un database
  vero), passa in CI e qui, e permette l'intera `npm run test:postgres`. `src/test-support/**` va
  escluso dalla build (`tsconfig.json` `exclude`) e dalla coverage (`jest.config.js`
  `collectCoverageFrom`: `'!**/test-support/**'`) (M4).
- **D15. Ordine e parallelismo.** Tutto sequenziale (file condivisi, un solo worktree e database,
  RAM). Gli split esistono per tenere verde ogni task:
  - **3a**: registry su ditte e sedi con **doppia scrittura** delle colonne vecchie (gli altri lettori
    restano sulle vecchie), creazione atomica, fixture e generatore e2e con checksum;
  - **3b-1**: gli altri lettori passano a ditta e sede **con le colonne vecchie ancora presenti**;
  - **3b-2**: migration 110100, `@ignore`/rinomina, guardia, spec e strumenti, privati;
  - **5a**: FIR schema, dominio, snapshot, persistenza, documento firmato;
  - **5b**: RENTRI, PDF, risposta, acquisizione da RENTRI.
- **D16. Migration.** `20261031110000_ditte_sedi_controparti` (Task 1), `20261031110100_anagrafiche_su_ditte`
  (Task 3b-2), `20261031110200_fir_parti_sede_cf` (Task 5a). Additive salvo il drop dei tre indici
  P.IVA vecchi. Commento iniziale con cosa, perché, ruolo che esegue, ripristino a mano.

## Vincoli globali (per ogni task)

- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), messaggi in italiano, **nessuna
  attribuzione AI**. Niente push. Commenti in italiano, termini tecnici non tradotti.
- **Database di test: `wasteflow-pg-test-fir` su `127.0.0.1:55434`.** Mai 55432. In ogni shell:
  ```bash
  export DOCKER_HOST=tcp://localhost:2375
  export DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55434/wasteflow_ci?schema=public"
  export DB_APP_PASSWORD=wasteflow_app_dev DB_SISTEMA_PASSWORD=wasteflow_sistema_dev
  ```
  e prima di **ogni** suite Postgres
  `[[ "$DATABASE_URL" == *":55434/"* ]] || { echo "DATABASE_URL non punta a 55434: fermo"; exit 1; }`.
- Prisma solo dal pacchetto installato (`npx prisma --version` → 5.22.x); dopo ogni modifica dello
  schema `npx prisma generate`.
- Test Postgres col ruolo **`wasteflow_app`** (modello `registro-per-sede.postgres.spec.ts`:
  `urlComeRuolo`, `creaPrismaServiceApplicativo()`, `TenantContext.run`), lanciati con
  `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`.
  Preparazione e pulizia col proprietario, **per `tenantId`**, mai `deleteMany` senza filtro.
- **Fixture:** P.IVA valide con checksum. Costante condivisa `PIVA_VALIDA = '12345678903'` e
  generatore `partitaIvaValida(seme)` (calcola la cifra di controllo) in
  `src/test-support/anagrafiche-di-test.ts`; mai `'12345678901'` o simili negli spec nuovi o toccati.
- **RAM:** jest mirato con `npx jest -w 2 <percorsi>`; `npm run test:cov` **una volta** a fine task
  backend; lint senza `--fix` globale: durante il lavoro `npx eslint <file toccati>`, a fine task una
  volta `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` da `apps/backend`; quando si tocca `e2e/`,
  dalla root `npx eslint "e2e/**/*.ts" --max-warnings=-1`. Karma **una volta** per task frontend.
- Fine task backend: `npm run test:cov` (con `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod`),
  `npx tsc --noEmit -p tsconfig.json`, le suite Postgres toccate più `rls-catalogo.postgres.spec.ts`.
  **Dal Task 3a in poi l'intera `npm run test:postgres`** (gli spec escono da tsc: solo ts-jest li
  compila, quindi un errore di tipo in uno spec si vede solo eseguendolo). Confronto con la base del
  Task 0: nessun fallimento nuovo.
- Task con migration: `npx prisma validate`; `npx prisma migrate deploy` su 55434;
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://wasteflow:wasteflow_ci@127.0.0.1:55434/shadow_f210?schema=public"`
  (database `shadow_f210` creato e rimosso con
  `docker exec wasteflow-pg-test-fir psql -U wasteflow -d wasteflow_ci -c "CREATE DATABASE shadow_f210"` /
  `"DROP DATABASE shadow_f210"`) → **vuoto** (o solo le note preesistenti di master: pgcrypto e
  default di `notifications.expires_at`). Nomi di vincoli e indici espliciti (≤ 63 caratteri).
- **E2E:** i Playwright `tests/registry`, `tests/scadenze`, `tests/pulizia` non girano in CI e non si
  lanciano qui (stack completo, RAM). Si tengono compilabili e coerenti (lint di `e2e/**/*.ts`); **la
  verifica vera è il job E2E della CI** (`ci.yml:669`, `tests/public`) e, per le altre cartelle, la
  prima esecuzione manuale dopo il merge, da segnalare nel rapporto.
- Task frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless`,
  `npm run build`, dalla root `npx eslint "apps/frontend/src/**/*.ts" --max-warnings=-1`.
- Mai un codice fiscale in log, audit, messaggi d'errore, NOTICE, query string (D12); mai id di
  tenant nei messaggi.
- Aree escluse (D13): se un task scopre di doverne toccare una, si ferma e lo segnala.

## Task 0: ambiente, base di confronto, guard 55432

**File:** `src/test-support/database-di-test.ts` (nuovo) + `database-di-test.spec.ts`, i 5 spec con
il controllo fisso, `tsconfig.json` (exclude `src/test-support/**`), `jest.config.js`
(`'!**/test-support/**'` in `collectCoverageFrom`).

1. Verifiche (niente da creare se c'è già): container `wasteflow-pg-test-fir` acceso (altrimenti
   `docker start`); `git check-ignore -v apps/backend/.env` e `.env` che punta a 55434;
   `node_modules` alla radice (altrimenti `npm ci` e `cd apps/backend && npm run prisma:generate`);
   `npx prisma migrate deploy`; dalla root
   `MSYS_NO_PATHCONV=1 PG_EXEC="docker exec -i wasteflow-pg-test-fir" bash ops/db-ruoli.sh` →
   `ruoli DB applicati (wasteflow_app, wasteflow_sistema)`.
2. Helper `eDatabaseDiTestLocale(url)` + spec unitario: 55432 e 55434 veri; host remoto, database
   `wasteflow_prod`, URL vuoto o malformato falsi.
3. Nei 5 spec sostituire `expect(process.env.DATABASE_URL ?? '').toContain(':55432/')` con
   `expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)`.
4. Esclusioni M4. Controllo che `argomenti-handler.ts` (già in `test-support`) non sia importato da
   codice di produzione (`grep -rn "test-support" src --include=*.ts | grep -v spec`): se lo è, non
   escludere la cartella dalla build e segnalarlo.
5. Base: intera `npm run test:postgres` (annotare i fallimenti preesistenti) e `npm run test:cov`.
6. Commit: `test: controllo del database di test locale indipendente dalla porta`.

## Task 1: ditte e sedi, backfill, RLS (solo database e schema)

**Dipende da 0.** **File:** `prisma/schema.prisma`,
`prisma/migrations/20261031110000_ditte_sedi_controparti/migration.sql`,
`src/infrastructure/persistence/prisma-rls.extension.ts` (+ spec), `rls-catalogo.postgres.spec.ts`
(32 → 34), `README-tenant-transazione.md`, `src/infrastructure/persistence/ditte-migrazione.postgres.spec.ts`
(nuovo), `ops/README.md`.

1. Schema, in coda al file:
   ```prisma
   model Ditta {
     id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
     tenantId       String   @map("tenant_id") @db.Uuid
     createdAt      DateTime @default(now()) @map("created_at")
     updatedAt      DateTime @updatedAt @map("updated_at")
     ragioneSociale String   @map("ragione_sociale") @db.VarChar(255)
     partitaIva     String?  @map("partita_iva") @db.VarChar(11)
     codiceFiscale  String?  @map("codice_fiscale") @db.VarChar(16)
     tenant         Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
     sedi           SedeDitta[]
     produttori     Produttore[]
     trasportatori  Trasportatore[]
     destinatari    Destinatario[]
     @@unique([id, tenantId], map: "ditte_id_tenant_id_key")
     @@unique([tenantId, partitaIva], map: "ditte_tenant_id_partita_iva_key")
     @@unique([tenantId, codiceFiscale], map: "ditte_tenant_id_codice_fiscale_key")
     @@index([tenantId], map: "ditte_tenant_id_idx")
     @@map("ditte")
   }
   model SedeDitta {
     // id, tenantId, dittaId, createdAt, updatedAt; denominazione String? VarChar(255);
     // via VarChar(255), civico VarChar(20), cap VarChar(5), comune VarChar(100), provincia VarChar(2);
     // referente VarChar(255)?, email VarChar(255)?, telefono VarChar(20)?, pec VarChar(255)?;
     // principale Boolean @default(false); attiva Boolean @default(true)
     ditta Ditta @relation(fields: [dittaId, tenantId], references: [id, tenantId], onDelete: Cascade, map: "sedi_ditte_ditta_fkey")
     // + tenant (Cascade), produttori/trasportatori/destinatari inversi
     @@unique([id, tenantId], map: "sedi_ditte_id_tenant_id_key")
     @@unique([id, dittaId, tenantId], map: "sedi_ditte_id_ditta_id_tenant_id_key")
     @@index([tenantId], map: "sedi_ditte_tenant_id_idx")
     @@index([dittaId], map: "sedi_ditte_ditta_id_idx")
     @@map("sedi_ditte")
   }
   ```
   Sulle tre righe di ruolo, in fondo ai blocchi: `dittaId String?`, `sedeId String?` (`@db.Uuid`),
   `ditta Ditta? @relation(fields: [dittaId, tenantId], references: [id, tenantId], onDelete:
   NoAction, onUpdate: NoAction, map: "<tabella>_ditta_fkey")`, `sede SedeDitta? @relation(fields:
   [sedeId, dittaId, tenantId], references: [id, dittaId, tenantId], onDelete: NoAction, onUpdate:
   NoAction, map: "<tabella>_sede_fkey")`, `@@unique([tenantId, dittaId], map:
   "<tabella>_tenant_id_ditta_id_key")`, `@@index([sedeId], map: "<tabella>_sede_id_idx")`. Le
   colonne vecchie non cambiano. Relazioni inverse su `Tenant`.
2. Migration, nell'ordine: commento iniziale (D5, D16, ruolo `wasteflow`, ripristino: `DROP FUNCTION
   f210_collega_anagrafiche`, DROP delle FK/indici/colonne `ditta_id`/`sede_id`, `DROP TABLE
   sedi_ditte, ditte`; ripristino da P3009 come D5.9); `CREATE TABLE ditte` con CHECK
   `ditte_identificativo_presente`, `ditte_partita_iva_forma`, `ditte_codice_fiscale_forma`,
   `ditte_ragione_sociale_non_vuota`; `CREATE TABLE sedi_ditte` con CHECK `sedi_ditte_principale_attiva`,
   indici, FK, indice parziale `sedi_ditte_una_principale`; `ADD COLUMN ditta_id, sede_id`;
   precondizione D5.1; `CREATE FUNCTION f210_collega_anagrafiche() RETURNS void` (plpgsql) che:
   raccoglie le righe di ruolo con `ditta_id IS NULL` (tabella temporanea esplicita
   `_f210_anagrafiche`, **senza `ON COMMIT DROP`**, `DROP TABLE` in fondo alla funzione), crea le ditte
   mancanti per (tenant, P.IVA) con la regola D5.3 (`DISTINCT ON (tenant_id, piva) … ORDER BY
   tenant_id, piva, updated_at DESC, priorita, id`), crea le sedi mancanti per (ditta, chiave
   d'indirizzo) con la regola D5.4 (principale solo se la ditta è nuova), aggiorna `ditta_id` e
   `sede_id`, esegue i controlli D5.5 con `RAISE EXCEPTION` e i NOTICE D5.6; `SELECT
   f210_collega_anagrafiche();`; FK composte, unici `(tenant_id, ditta_id)`, indici su `sede_id`;
   RLS (D11).
3. `TENANT_SCOPED_MODELS` + spec; catalogo 34 e README.
4. `ditte-migrazione.postgres.spec.ts` sul modello di `registro-migrazione.postgres.spec.ts`. **Le
   asserzioni sono query sui dati, mai sui NOTICE (I5).** Casi:
   - azienda A: produttore "Rossi S.r.l." P.IVA X in via Roma 1 e destinatario "ROSSI SRL" stessa X in
     via dell'Industria 5, aggiornato dopo → **una** ditta "ROSSI SRL", due sedi, principale = via
     dell'Industria, ciascun ruolo sulla propria sede, id di ruolo invariati, `ragione_sociale` delle
     righe di ruolo invariata ("Rossi S.r.l." e "ROSSI SRL");
   - azienda A: produttore e trasportatore con P.IVA Y e lo stesso indirizzo scritto con maiuscole e
     spazi diversi → una ditta, **una** sede, contatti della riga più recente;
   - azienda B con la stessa P.IVA X → ditta **separata**;
   - P.IVA di 11 cifre con checksum sbagliato → migrata così com'è;
   - azienda senza anagrafiche → nessuna ditta;
   - FIR e contratto inseriti prima → tutte le colonne di `firs` e `contracts` identiche dopo;
   - **idempotenza**: una riga di ruolo inserita dopo la migration con `ditta_id` NULL (simula il
     backend vecchio) e `SELECT f210_collega_anagrafiche()` → collegata alla ditta esistente se la
     P.IVA c'è già, nuova ditta altrimenti; una seconda chiamata non cambia nulla;
   - secondo database: una riga con `partita_iva = '1234567890A'` → `prisma db execute` fallisce;
     su **stderr** compaiono i conteggi e **non** compare il valore; `to_regclass('public.ditte')` è
     NULL (transazionalità);
   - dopo la migration, col proprietario: due ditte stessa P.IVA → violazione; stesso CF →
     violazione; due ditte con P.IVA NULL e CF diversi → ammesse; nessun identificativo → CHECK;
     P.IVA `'IT12345678'` → CHECK; seconda principale → indice parziale; principale non attiva →
     CHECK; ruolo con sede di un'altra ditta → FK; sede con tenant diverso dalla ditta → FK; secondo
     produttore per la stessa ditta → unico;
   - come `wasteflow_app` in `TenantContext` di A: solo ditte e sedi di A; INSERT con tenant di B →
     respinto.
5. `ops/README.md`, voce "F2-10 controparti": censimento **prima del merge** (lo lancia
   l'orchestratore sul VPS: `docker exec -i <container postgres> psql -U <utente> -d <db>`), sola lettura:
   ```sql
   WITH a AS (
     SELECT 'P' r, tenant_id, btrim(partita_iva) p, lower(btrim(ragione_sociale)) n FROM produttori
     UNION ALL SELECT 'T', tenant_id, btrim(partita_iva), lower(btrim(ragione_sociale)) FROM trasportatori
     UNION ALL SELECT 'D', tenant_id, btrim(partita_iva), lower(btrim(ragione_sociale)) FROM destinatari)
   SELECT
     (SELECT count(*) FROM a) AS anagrafiche,
     (SELECT count(*) FROM a WHERE p !~ '^[0-9]{11}$') AS piva_non_conformi,
     (SELECT count(*) FROM (SELECT 1 FROM a GROUP BY tenant_id, p HAVING count(DISTINCT r) > 1) x) AS ditte_fuse,
     (SELECT count(*) FROM (SELECT 1 FROM a GROUP BY tenant_id, p
        HAVING count(DISTINCT r) > 1 AND count(DISTINCT n) > 1) x) AS ditte_fuse_nome_divergente;
   ```
   `piva_non_conformi > 0` blocca il merge. Ripristino da P3009 (D5.9). Rollback: additive fino a
   3b-2; dopo, il codice vecchio non legge le anagrafiche create dopo il deploy (colonne vecchie
   NULL): rollback del codice = ripristino del backup notturno o script inverso (colonne ricostruite
   dalla ditta e dalla sede predefinita), descritto qui.
6. Verifiche (migration). Nessun codice applicativo cambia. Commit:
   `feat(anagrafiche): ditte e sedi delle controparti, migrazione delle anagrafiche esistenti`.

## Task 2: dominio e servizio delle ditte (senza collegarlo al registry)

**Dipende da 1.** **File nuovi:** `src/domain/registry/value-objects/identificativo-fiscale.ts`
(+ spec), `src/domain/registry/entities/ditta.ts`, `sede-ditta.ts` (+ spec),
`src/domain/registry/repositories/ditta.repository.ts`, `src/infrastructure/persistence/ditta-prisma.repository.ts`,
`src/application/registry/ditte/ditte.service.ts` (+ spec unitario), `ditte.service.postgres.spec.ts`.
**Modificati:** `src/core/domain/errors.ts` (errori nuovi, M9), `src/core/filters/http-exception.filter.ts`
(+ spec), `src/core/monitoring/opzioni-sentry.ts` (+ spec, M5).

1. VO `IdentificativoFiscale` (D2): `crea({ partitaIva?, codiceFiscale? })`, `privato`,
   `identificativoRentri`, `valori()` (ordinati). Errori senza valori. Test: P.IVA valida/checksum
   errato/10 cifre/con `IT`; CF valido, omocodico, controllo errato, minuscolo con spazi, 17
   caratteri (errore di lunghezza); CF 11 cifre valido/errato; CF = P.IVA → solo P.IVA; nessuno →
   errore; nessun messaggio contiene il valore. `partitaIvaDaVerificare(valore)`.
2. M9: `InvalidPartitaIVAError` senza valore; aggiornare gli spec che ne leggono il messaggio.
3. Entità `Ditta` (`aggiungiIdentificativi` D2.7, `sostituisciPartitaIva` D2.8: consentita solo se
   l'attuale non passa il checksum e la nuova sì) e `SedeDitta` (riusa `Indirizzo`; regole D4;
   `chiaveIndirizzo()` con la stessa normalizzazione della migration, testata con gli esempi del Task 1).
4. `DittaPrismaRepository`: tutti i metodi ricevono il client (`tx` o quello normale) e mettono il
   `tenantId` del `TenantContext` nel `where`: `cercaPerIdentificativi(tx, valori)`, `trovaPerId`,
   `trovaSede(tx, dittaId, sedeId)`, `sedi`, `crea`, `aggiorna`, `creaSede`, `aggiornaSede`,
   `impostaPrincipale` (prima togliere poi mettere), `ruoliDellaDitta`.
5. `DitteService`:
   - `risolviPerRuolo(tx, ruolo, dati)`: passi 1, 2 e 4 di D3 **dentro la transazione del chiamante**
     (il passo 3 e l'insert li fa il chiamante con lo stesso `tx`, Task 3a) → `{ dittaId, sedeId,
     ragioneSocialeDitta, dittaEsistente, avvisi }`; D2.5 per il privato non produttore;
   - `cerca(identificativo)` → `DittaDto | null`;
   - `aggiornaDitta` (ragione sociale, aggiunta D2.7, sostituzione D2.8 sotto lock su **entrambi** i
     valori, con audit), `aggiungiSede`, `aggiornaSede` (controllo "predefinita di un ruolo"),
     `impostaPrincipale`.
   Errori in `errors.ts` (`DittaIdentificativiInConflittoError` 409, `IdentificativoNonCorrispondenteError`
   400, `SedeNonModificabileError` 409, `DittaNonTrovataError` 404, `SedeNonTrovataError` 404) mappati
   nel filtro come gli errori FIR di F2-4, senza Bugsink.
6. M5: test del filtro con un `PrismaClientUnknownRequestError` (e `P2010`) il cui messaggio
   contiene `Failing row contains (… RSSMRA80A01H501U …)` → risposta senza quel testo; in
   `ripulisciEventoSentry` togliere `Failing row contains …` e `DETAIL: …` da `message` ed
   `exception.values[].value`; test su un evento costruito.
7. Test Postgres `wasteflow_app`: creazione nuova; riuso per P.IVA e per CF numerico uguale alla
   P.IVA; aggiunta del CF mancante; CF contraddittorio → 400; P.IVA e CF di due ditte → 409; **due
   `risolviPerRuolo` concorrenti** (due client, `Promise.all`, ciascuno nella sua transazione) → una
   sola ditta; sede riusata con indirizzo normalizzato uguale, sede nuova non principale altrimenti;
   privato come trasportatore → errore; **sostituzione della P.IVA (I3)**: ditta con P.IVA senza
   checksum → sostituita con una valida, audit presente senza valori; ditta con P.IVA valida →
   rifiutata; nuova P.IVA già di un'altra ditta → 409; `impostaPrincipale` lascia una sola principale;
   disattivare principale o predefinita → 409; un'altra azienda non trova la ditta.
8. Verifiche globali. Commit: `feat(anagrafiche): identificativo fiscale, ditte e sedi nel dominio`.

## Task 3a: registry su ditte e sedi (doppia scrittura), fixture e generatore e2e

**Dipende da 2.** **File:** entità `src/domain/registry/entities/{produttore,trasportatore,destinatario}.ts`
(+ spec), `src/domain/registry/repositories/*.ts`, i tre repository di ruolo (+
`produttore-prisma.repository.spec.ts`, `tenant-isolation.spec.ts`), `application/registry/use-cases/`
(`create-*`, `update-*`, `get-*`, `list-*`, `delete-*`, + `create-produttore.use-case.spec.ts`,
`produttore-istat-validation.spec.ts`, `update-trasportatore.use-case.spec.ts`,
`update-destinatario.use-case.spec.ts`), `api/registry/registry.controller.ts` (+ i tre spec),
`api/registry/dto/create-registry.dto.ts`, `api/registry/registry.module.ts`, `src/fir/fir.module.ts`
(solo se servono le factory), **adattamento minimo** di `application/fir/snapshot-parti.ts` (+ spec) e
degli spec `create-fir.use-case.spec.ts`, `modifica-fir.use-case.spec.ts`; spec Postgres
`fir-modifica-bozza.postgres.spec.ts`, `rls-percorsi-reali.postgres.spec.ts`,
`isolamento-sorelle.postgres.spec.ts`; nuovo `src/test-support/anagrafiche-di-test.ts`; nuovo
`registry-ditte.postgres.spec.ts`; e2e: nuovo `e2e/utils/partita-iva.ts` e i 4 spec con i
generatori.

1. Entità di ruolo: `dittaId`, `sedeId`, `codiceFiscale?`, `partitaIVA: PartitaIVA | null`, `privato`.
2. `snapshot-parti.ts`, adattamento **minimo** per compilare (il resto è del Task 5a):
   `partitaIva: p.partitaIVA?.getValue() ?? ''` nelle quattro funzioni; snapshot invariato per ogni
   ruolo con P.IVA (test esistenti verdi).
3. Repository di ruolo:
   - lettura con `include: { ditta: true, sede: true }`, `toDomain` da ditta e sede, ordinamento
     `{ ditta: { ragioneSociale: 'asc' } }`;
   - `findById(id, opzioni?: { sedeId?: string })`: con `sedeId` l'entità porta indirizzo e contatti
     di quella sede se attiva e della stessa ditta, altrimenti `SedeNonValidaPerRuoloError` (usato nel
     Task 5a; qui solo test);
   - `findByDittaId(client, dittaId)` al posto di `findByPartitaIVA`;
   - `crea(tx, entità)` (insert con `ditta_id`, `sede_id`, campi del ruolo) e `save(entità)` per la
     modifica, in una `$transaction`: ragione sociale della ditta (+ identificativi aggiunti), sede
     predefinita, riga di ruolo;
   - **temporaneamente** entrambe scrivono anche le colonne vecchie (ragione sociale, P.IVA,
     indirizzo e contatti della sede predefinita), con il commento `// F2-10 Task 3a: doppia
     scrittura, la toglie il Task 3b-2`.
4. Use case `create-*` (I1): **una** `this.prisma.$transaction(async tx => …)` con
   `DitteService.risolviPerRuolo(tx, …)`, `findByDittaId(tx, …)` (presente → 400 "Esiste già un
   produttore per questa ditta"), `repository.crea(tx, …)`; P2002 su `<tabella>_tenant_id_ditta_id_key`
   tradotto nello stesso 400. In questo task la **P.IVA resta obbligatoria** nel DTO (colonne vecchie
   NOT NULL): il CF si accetta in aggiunta. `update-*`: ragione sociale e sede come oggi (ora su ditta
   e sede), aggiunta/sostituzione di identificativi, `sedeId` (D7). Controlli di albo/autorizzazione
   invariati.
5. Controller e DTO: campi D7 in risposta, `PUT` con `codiceFiscale?`, `partitaIVA?`, `sedeId?`
   (`@IsOptional() @IsUUID()`), `codiceFiscale` con `@MaxLength(16)` (M8). Swagger.
6. Fixture (C2): `src/test-support/anagrafiche-di-test.ts` con `PIVA_VALIDA = '12345678903'`,
   `partitaIvaValida(seme)` e `creaDittaConRuolo(client, tenantId, ruolo, dati)` (ditta + sede + riga
   di ruolo **con** le colonne vecchie, finché esistono). Aggiornare **tutti** gli spec elencati sopra
   e nello stato di partenza che creano anagrafiche o leggono `.partitaIVA.getValue()`; le P.IVA delle
   fixture che passano dal VO nuovo diventano valide.
7. E2E (C1): `e2e/utils/partita-iva.ts` con `partitaIvaCasualeValida()` (10 cifre casuali + cifra di
   controllo, stesso algoritmo di `partita-iva.vo.ts`, commento che lo cita) e sostituirlo ai
   generatori di `tests/registry/produttore.spec.ts:29`, `tests/registry/trasportatore-destinatario.spec.ts:44`,
   `tests/scadenze/flusso-scadenze.spec.ts:82`, `tests/pulizia/pulizia-self-test.spec.ts:39`.
   `tests/public/guardrail-self-test.spec.ts` non genera P.IVA: verificare solo che resti verde con le
   rotte nuove (le sedi non si cancellano: nessuna rotta distruttiva nuova per `utils/blacklist.ts`).
   Lint `npx eslint "e2e/**/*.ts" --max-warnings=-1`.
8. Test: unitari (riuso della ditta, ragione sociale della ditta che vince con avviso, ruolo
   duplicato, privato trasportatore rifiutato, risposta compatibile con un corpo di oggi). Postgres
   `registry-ditte.postgres.spec.ts` (`wasteflow_app`): produttore e destinatario con la stessa P.IVA
   → una ditta, due ruoli, colonne vecchie valorizzate; **due creazioni concorrenti dello stesso
   produttore** → una riesce, l'altra 400 "già presente", una sola ditta; `PUT` della ragione sociale
   dal destinatario → lista dei produttori aggiornata; cambio di sede predefinita;
   `findById(id, { sedeId })` con sede di un'altra ditta → errore. **Intera `test:postgres` verde**
   (MUD, contratti, RENTRI ancora sulle colonne vecchie).
9. Verifiche globali + lint e2e. Commit: `feat(anagrafiche): il registry delle controparti lavora su ditte e sedi`.

## Task 3b-1: altri lettori su ditta e sede (colonne vecchie ancora presenti)

**Dipende da 3a.** **File:** `application/contracts/contract.service.ts` (+ spec),
`application/mud/aggregazione/mud-aggregazione.service.ts` (+ spec), `application/dashboard/raccogli-attenzione.use-case.ts`
(+ spec), `application/notifications/deadline-checker.service.ts` (+ spec),
`application/rentri/mappatura/costruisci-payload-rentri.ts` (+ spec) e il solo commento di
`mappa-parti.ts:183-190`, `e2e/utils/db-locale.ts`, nuovo `costruisci-payload-rentri.postgres.spec.ts`,
nuovo `mud-anagrafiche-ditte.postgres.spec.ts`.

1. Contratti, dashboard, scadenze: D10 (`include ditta`/`sede`; `ContractParty` con `partitaIVA:
   string | null` e `codiceFiscale`).
2. MUD (I2): ragione sociale del soggetto = `ragione_sociale` della **riga di ruolo** (in questo task
   ancora col suo nome; dal 3b-2 `ragioneSocialeStorica`) ?? ragione sociale della ditta;
   `chiaveDestinatario` e chiave del TE invariate nel calcolo; indirizzo dalla sede predefinita;
   codice fiscale = CF ?? P.IVA.
3. RENTRI: `leggiRegistro` con `include: { ditta: true, sede: true }` e **un tipo esplicito** al posto
   del cast `as never` sul risultato (così tsc controlla i campi letti); `partitaIVA:` =
   `ditta.codiceFiscale ?? ditta.partitaIva`; indirizzo dalla sede predefinita (la sede per FIR arriva
   nel 5b).
4. `e2e/utils/db-locale.ts:186-210` (C1): legge le **righe di ruolo** con `include: { ditta: { select:
   { ragioneSociale: true } } }` e filtra sul nome della ditta; **non** legge la tabella `ditte` (le
   ditte sopravvivono alla DELETE del ruolo e risulterebbero sempre "residue"). Lint e2e.
5. Test Postgres (I7) su **righe reali** create con `creaDittaConRuolo`: payload RENTRI di produttore,
   destinatario e trasportatore (denominazione, `codice_fiscale`, indirizzo) uguale a quello calcolato
   prima del cambio per le stesse anagrafiche; MUD: ditta fusa con nome divergente (righe di ruolo con
   nomi diversi da quello della ditta) → i record DR usano il nome della **riga di ruolo** e
   un'integrazione salvata con la chiave di quel nome resta agganciata (I2); contratto la cui ditta
   ha cambiato nome → la lista mostra il nome nuovo.
6. Verifiche globali (intera `test:postgres`). Commit: `refactor(anagrafiche): contratti, MUD, RENTRI e scadenze leggono ditte e sedi`.

## Task 3b-2: migration 110100, colonne congelate, privati

**Dipende da 3b-1.** **File:** `prisma/schema.prisma`, `prisma/migrations/20261031110100_anagrafiche_su_ditte/migration.sql`,
i tre repository di ruolo (via la doppia scrittura), `api/registry/dto/create-registry.dto.ts`,
use case `create-*`, `mud-aggregazione.service.ts` (solo il nome `ragioneSocialeStorica`),
`src/test-support/anagrafiche-di-test.ts` (niente più colonne vecchie), spec che le scrivevano
(`isolamento-sorelle.postgres.spec.ts`, `prisma-service-tenant.postgres.spec.ts`: trigger di prova
spostato da `produttori.via` a `sedi_ditte.via`, `rls-percorsi-reali.postgres.spec.ts` se serve),
`test/integration/setup.ts`, nuovo `anagrafiche-colonne-congelate.spec.ts`, `ditte-migrazione.postgres.spec.ts`
(caso 110100), `ops/README.md`.

1. Migration D6: `SELECT f210_collega_anagrafiche();` (completa le righe nate nella finestra di
   deploy, I6), `DROP FUNCTION f210_collega_anagrafiche();`, poi un controllo di sicurezza (nessuna
   riga con `ditta_id`/`sede_id` NULL, altrimenti `RAISE EXCEPTION` con i conteggi), `SET NOT NULL`,
   `DROP NOT NULL` delle colonne vecchie, `DROP INDEX` dei tre `*_tenant_id_partita_iva_key`,
   `COMMENT ON COLUMN`. Schema D6 (`ragioneSocialeStorica`, `@ignore`).
2. Repository senza doppia scrittura; DTO di creazione con `partitaIVA` facoltativa e validatore di
   classe "almeno uno fra `partitaIVA` e `codiceFiscale`"; un privato come produttore si salva.
3. Spec di guardia D6/I7 (con l'elenco di eccezioni esplicito).
4. Test: `ditte-migrazione.postgres.spec.ts` esteso: dopo 110000 una riga di ruolo con `ditta_id`
   NULL (backend vecchio), applicata 110100 → collegata, funzione eliminata, colonne NOT NULL;
   Postgres: produttore privato (solo CF) creato e letto; payload RENTRI di un produttore privato →
   `codice_fiscale` = CF di 16 (I7, su righe reali); MUD dopo la 110100 → stessi nomi del Task 3b-1;
   righe create dopo il deploy con colonne vecchie NULL e MUD che usa il nome della ditta. `tsc`
   pulito. Intera `test:postgres`.
5. Verifiche globali (migration comprese) + lint e2e. Commit: `feat(anagrafiche): privati con solo codice fiscale, colonne vecchie congelate`.

## Task 4: API delle ditte e delle sedi

**Dipende da 3b-2.** **File:** `src/api/registry/ditte.controller.ts` (nuovo, + spec),
`src/api/registry/dto/ditte.dto.ts` (nuovo), `api/registry/registry.module.ts`, `DitteService` (ritocchi).

1. Rotte D7 con `requireRequestTenantId(req)`, `ParseUUIDPipe`, guardie e ruoli del registry. `POST
   cerca`: identificativo malformato → 400 senza valore; nessun risultato → `{ ditta: null }`.
2. `DittaDto`/`SedeDto`.
3. Test: controller con pipe reali; Postgres `wasteflow_app`: ciclo completo (cerca → nulla; crea
   ruolo; cerca → trovata; nuova sede; principale spostata; disattivazione rifiutata per la predefinita
   e consentita dopo il cambio; sostituzione della P.IVA D2.8 via `PUT :id`); ditta di un'altra
   azienda → 404 e `null`; 403 per un ruolo senza scrittura (schema di `registry.controller.authorization.spec.ts`).
4. Verifiche globali. Commit: `feat(anagrafiche): API delle ditte e delle sedi`.

## Task 5a: FIR, schema, dominio, snapshot, persistenza, documento firmato

**Dipende da 4.** **File:** `prisma/schema.prisma` (colonne in fondo al blocco `FIR`),
`prisma/migrations/20261031110200_fir_parti_sede_cf/migration.sql`, `api/fir/dtos/create-fir.dto.ts`,
`domain/fir/aggregates/fir.aggregate.ts` (+ spec), `domain/fir/fir.aggregate.ts` (crittografico, +
spec), `infrastructure/signatures/signature-fir.repository.ts`, `application/fir/snapshot-parti.ts`
(+ spec), `application/fir/use-cases/create-fir.use-case.ts`, `modifica-fir.use-case.ts` (+ spec),
`infrastructure/persistence/fir-prisma.repository.ts` (+ spec), `fir-modifica-bozza.postgres.spec.ts`,
nuovo `fir-sede-parti.postgres.spec.ts`.

1. Migration D9.4 (additiva, nessuna policy: `firs` è già sotto RLS; ripristino `DROP COLUMN`) e
   schema.
2. Dominio e snapshot D9.5: `codiceFiscale`, `sedeId` (non per il trasportatore), `snapshotTratta` con
   `codiceFiscale`.
3. Creazione D9.1-D9.3 (`findById(id, { sedeId })`, errore → `Result.fail` → 400). Modifica D9.6, con
   un test unitario per ciascuna delle cinque regole (I4); gli spec di F2-4 restano verdi.
4. Persistenza: `toPersistence`, mappatura della modifica (`?? null`, lezione C1 di F2-4), `toDomain`.
5. Documento firmato D9.7: **test golden** (stringa canonica attesa scritta nello spec **prima** della
   modifica, per un FIR con sole P.IVA) e test che un FIR con CF del produttore la contenga.
6. Test Postgres `fir-sede-parti.postgres.spec.ts` (`wasteflow_app`): FIR senza sede nel DTO →
   predefinita, `producer_sede_id` valorizzato; con `produttoreSedeId` della seconda sede → indirizzo
   della seconda; sede di un'altra ditta o disattivata → 400; produttore privato → `producer_partita_iva
   = ''`, `producer_codice_fiscale` = CF; **FIR creato prima della migration** (riga del proprietario
   senza colonne nuove) e `PUT` con sede uguale alla predefinita → 200, versione invariata, nessuna
   scrittura (I4); stesso FIR con sede diversa → nuovo snapshot; emissione del FIR vecchio → snapshot
   invariato.
7. Verifiche globali (migration comprese). Commit: `feat(fir): sede e codice fiscale delle parti nello snapshot`.

## Task 5b: FIR, RENTRI, PDF, risposta, acquisizione

**Dipende da 5a.** **File:** `application/rentri/mappatura/costruisci-payload-rentri.ts` (+ spec e
`costruisci-payload-rentri.postgres.spec.ts`), `application/rentri/crea-fir-da-dettaglio-rentri.use-case.ts`
(+ spec), `infrastructure/pdf/pdf.service.ts` (+ `pdf.service.fir.spec.ts`), `api/fir/dtos/fir-response.dto.ts`
(+ spec).

1. RENTRI D9.8: sede del FIR filtrata per tenant e ditta, fallback sulla predefinita, sede assente →
   `DatoMancantePerRentriError`. Test Postgres: FIR sulla seconda sede → indirizzo della seconda; FIR
   precedente (sede NULL) → predefinita; sede di un'altra ditta forzata nel database → errore.
2. Acquisizione D9.9: test con CF di 16 caratteri (prima falliva) e con P.IVA.
3. PDF D9.10 e risposta D9.11 (+ test).
4. Verifiche globali. Commit: `feat(fir): RENTRI e PDF con la sede e il codice fiscale delle parti`.

## Task 6: frontend delle anagrafiche

**Dipende da 4.** **File** (`apps/frontend/src/app/`): `shared/models/registry.model.ts`,
`features/registry/registry.service.ts` (+ spec se esiste), `features/registry/identificativo-fiscale.ts`
(nuovo, + spec), `anagrafica-form-dialog.component.ts` (+ spec), `produttori-list.component.ts`,
`trasportatori-list.component.ts`, `destinatari-list.component.ts` (+ spec),
`features/registry/sedi-ditta-dialog.component.ts` (nuovo, + spec). `produttori-list-enhanced` non si
tocca (morto).

1. Modelli e servizio (`cercaDitta` POST, `getDitta`, `aggiornaDitta`, sedi).
2. `identificativo-fiscale.ts`: gemella del VO, stessi casi del Task 2 punto 1.
3. Form (dialog e form in linea): "Codice fiscale" accanto alla P.IVA (max 16), P.IVA facoltativa con
   "Indica la partita IVA o il codice fiscale"; messaggio D2.5 per trasportatore e destinatario. In
   creazione, all'uscita dal campo con un identificativo valido, `cercaDitta`: se trovata, avviso
   `role="status"`, ragione sociale precompilata e bloccata, scelta fra le sedi attive o "Nuova sede".
   `avvisi` in un toast `info`. In modifica, identificativi impostati non modificabili salvo il
   caso D2.8 (P.IVA "da verificare": campo modificabile con avviso), mancanti aggiungibili.
4. Liste: colonna "P.IVA / C.F.", badge "Da verificare", pulsante "Sedi (n)" con `SediDittaDialogComponent`.
5. **Fixture Karma (I9):** sostituire le P.IVA senza checksum valido degli spec toccati e di quelli
   che passano dalla validazione gemella (`'01234567890'` e simili) con P.IVA valide (costante nello
   spec, es. `'12345678903'`); le fixture che vogliono una P.IVA non valida lo dicono nel nome.
6. Karma: validazione gemella; ricerca chiamata una volta per valore; avviso con ditta trovata;
   precompilazione della sede; dialog delle sedi. Verifiche frontend. Commit:
   `feat(anagrafiche): codice fiscale, ditta già presente e sedi nell'interfaccia`.

## Task 7: frontend del FIR e dei selettori

**Dipende da 5b e 6.** **File:** `shared/models/fir.model.ts`, `features/fir/fir-list.component.ts`
(+ spec), `features/fir/fir-form.ts` (+ spec), `features/fir/fir-detail.component.ts` (+ spec),
`features/registry/anagrafica-select.component.ts` (+ spec), `features/contracts/contracts-list.component.ts`,
`features/contracts/contracts.service.ts`.

1. Modello: `ParteFIR.sedeId?`, `codiceFiscale?`; `CreateFIRDto.produttoreSedeId?`, `destinatarioSedeId?`.
2. Dialog "Nuovo FIR" e modifica: con più sedi attive compare "Sede del produttore"/"Sede del
   destinatario" preimpostata (sede del FIR in modifica, predefinita del ruolo in creazione; `getDitta`
   in cache per ditta). **Il DTO porta la sede solo se l'utente l'ha cambiata** rispetto al valore
   iniziale (I4); `formDaFir` conserva le sedi del FIR come valore iniziale.
3. Le **quattro** tendine di `fir-list` (`:349-372`, `:407-432`, `:477-502`, `:575-591`),
   `anagrafica-select` e lista contratti: "P.IVA …" o "C.F. …", mai "P.IVA null"; filtro anche sul CF;
   nessun `.includes` su un valore nullo (`anagrafica-select.component.ts:279`).
4. Dettaglio: "P.IVA X · C.F. Y", "C.F. Y" per un privato.
5. Karma: tendina solo con più sedi; DTO senza sede se non cambiata e con sede se cambiata; selettori
   con P.IVA nulla; dettaglio. Verifiche frontend. Commit: `feat(fir): scelta della sede delle parti e codice fiscale nell'interfaccia`.

## Task 8: chiusura

**Dipende da tutti.** Nessun codice nuovo salvo correzioni.

1. Da database vuoto (`shadow_f210`) `migrate deploy` di tutto, `migrate diff` vuoto; `ops/db-ruoli.sh`;
   intera `test:postgres`, `test:cov`, lint check di backend, frontend ed e2e, build di entrambi.
   Confronto con la base del Task 0.
2. Rilettura del diff: CF in log o messaggi (grep di `codiceFiscale`/`codice_fiscale` dentro
   `logger.`, `throw new`, `RAISE`), query senza `tenantId`, aree escluse toccate, residui di doppia
   scrittura.
3. Rapporto finale con:
   - **deviazione dalla roadmap (M7)**: le anagrafiche con la stessa P.IVA in ruoli diversi diventano
     **una** ditta, non una ditta ciascuna;
   - **ditte fuse con nome divergente (I2)**: conteggio dal censimento; il MUD continua a usare il
     nome della riga di ruolo, l'anagrafica mostra quello della ditta;
   - istruzioni di deploy: censimento prima del merge (D5.8), deploy, controllo `SELECT count(*) FROM
     ditte` e una lista anagrafiche; ripristino da P3009 (D5.9);
   - E2E: CI `tests/public` verde; `tests/registry`, `tests/scadenze`, `tests/pulizia` da eseguire a
     mano dopo il merge;
   - seguiti aperti (sotto).

## Fuori ambito (seguiti)

- **Import delle anagrafiche da WinWaste (3.3)**: mapping `[SEDI LEGALI]`/`[UNITA LOCALI]` →
  ditte e sedi, colonne `importSource`/`legacyKey` con `UNIQUE(tenantId, importSource, legacyKey)` sulle
  ditte (3.1). Il modello non le preclude (colonne nullable di `ditte` e, se serve, di `sedi_ditte`);
  la deduplica D3 è quella che 3.3 chiede ("si segnala, non si corregge").
- **Cliente e contratto lato cliente (4.1)**: quarto ruolo che punta a ditta e sede di fatturazione.
- Autorizzazioni e iscrizione all'Albo **per sede**; MUD per sede del destinatario indicata sul FIR
  (F2-8).
- Rimozione fisica delle colonne congelate (F2-10b).
- Sedi e controparti estere (CF oltre 16 caratteri, città estere).
- Oblio/anonimizzazione di una ditta privata; unione manuale di due ditte create per errore.
- "P.IVA" vuota mostrata per i privati nella tendina del registro (`registro.component.ts:831`, area
  di F2-6) e nell'analytics (gruppo `''` di `producerPartitaIva`).
- Rotte `…/search` morte del frontend; `produttori-list-enhanced.component.ts` morto.
