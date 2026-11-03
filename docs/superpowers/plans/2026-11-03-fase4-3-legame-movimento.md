# Fase 4 pezzo 3: legame movimento, cliente e prezzo — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`. Un agente sonnet per task, revisione opus fra un task e il
> successivo; ondate come nella sezione "Ondate". Passi con checkbox (`- [ ]`). Tre pezzi in
> sequenza (4.3a → 4.3b → 4.3c), ciascuno con la propria PR, rilasciabile da solo. Nessun task del
> pezzo N+1 parte prima del merge del pezzo N.

**Goal.** Legare ogni movimento del registro con causale fatturabile a cliente, contratto, elenco e
righe di listino, con quantità, prezzo, sconto e IVA congelati alla conferma, senza mai bloccare il
registro e senza mai toccare `waste_movements`.

**Architecture.** Tre tabelle nuove (`legami_movimento` testata per catena, `righe_legame_movimento`
il «foglio», `impostazioni_fatturazione`) più il flag `fatturabile` sulle causali. Regole di
proposta in dominio puro (`src/domain/legami-movimento/`); servizi in
`src/application/legami-movimento/`; API in `src/api/legami-movimento/`. L'aggancio a registrazione
e correzione gira in un SAVEPOINT come `abbinaSenzaFallire`. Lock: ordine del listino, con
`FOR SHARE` su elenchi e righe di listino (il listino le blocca `FOR UPDATE`).

**Tech Stack.** NestJS 10 + Prisma 5.22 + PostgreSQL 16 (RLS FORCE); Angular 17 + PrimeNG 17.18;
jest, Karma, Playwright (solo in CI).

**Spec.** `docs/superpowers/specs/2026-11-03-fase4-3-legame-movimento-prezzo-design.md` (decisioni
1-15 e scelte O1-O8 vincolanti). Formato e vincoli: `docs/superpowers/plans/2026-11-02-fase4-2-listino.md`
e `.superpowers/sdd/2026-11-03-seguiti-4-2b/vincoli-globali.md`. Percorsi relativi a `apps/backend/`
salvo `fe/` = `apps/frontend/src/app/` e `e2e/` alla radice.

## Global Constraints

- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), messaggi in italiano, **nessuna
  attribuzione AI** (né `Co-Authored-By` né `Claude-Session`; regola di Graziano che prevale su ogni
  suggerimento dell'ambiente). Niente push.
- Commenti e testi in italiano; termini tecnici non tradotti (branch, commit, deploy, test, build,
  database, backup, container, log, worker, cache, rollback, merge, migration, RLS, tenant, staging,
  lock, savepoint). Messaggi all'utente senza id né dati personali.
- Azienda sempre da `requireRequestTenantId(req)`; `@Roles` esplicito su **ogni** rotta;
  `controller-tenant-selezionato.spec.ts` e `nessun-user-userid.spec.ts` verdi. Ruoli: lettura
  `RUOLI_LETTURA`, scrittura `RUOLI_SCRITTURA`, amministratori `RUOLI_VARIAZIONI`
  (`src/api/listino/ruoli.ts`).
- **Nessuna colonna, nessun UPDATE/INSERT/DELETE su `waste_movements`.** `entryHash` e RENTRI non
  cambiano; `fatturabile` non entra nell'hash. Guardia automatica nel Task 14.
- Mai bloccare il registro per un problema commerciale: ogni scrittura del legame dentro SAVEPOINT.
  Mai cambiare un legame `FATTURATO` / `IMPORTATO_FATTURATO` per listino, «Aggiorna prezzi»,
  rettifica o annullo (solo `scostamento_dopo_fattura`, `scostamento_il`, `movimento_vigente_id`).
- Un legame per catena: unico `(tenant_id, movimento_originale_id)`; il legame punta alla **radice**.
- Numeri come stringhe con il punto nell'API; importi con `Prisma.Decimal`, mai `number`.
  `importoRiga` / `scontoCascata` (`src/domain/listino/importi-riga.ts:83,72`) non si riscrivono.
  Nessun `importo` salvato.
- Campi numerici modificabili in UI: virgola decimale, punto vietato con «Usa la virgola per i
  decimali», niente separatore delle migliaia; direttiva `appNumeroIt`
  (`fe/shared/directives/numero-it.directive.ts`) e utilità `fe/shared/utils/numero-modificabile.ts`
  (`leggiNumero`, `formatNumero`, `validatoreNumero`); mai parser nuovi.
- Pagine nuove con la classe `pagina-lavoro` (`fe/../styles/_pagine.scss`), tema «Foglio salvia».
- Query su liste di id: `JOIN unnest($1::uuid[])` preceduta da `joinLineari(tx)`
  (`src/application/listino/lock-listino.ts`, firma `joinLineari(tx: Prisma.TransactionClient): Promise<void>`).
  Vietati i cicli di UPDATE singoli e `= ANY(uuid[])` su liste grandi.
- Scritture: `impostaTimeoutLock(tx)` per prima, `OPZIONI_TRANSAZIONE_SCRITTURA`, 55P03/P2028/40P01
  → 409 `OPERAZIONE_CONCORRENTE` (`traduciErrorePrisma`, `src/application/clienti/anagrafica-versionata.ts`).
- Ordine dei lock (mai invertito): lock del registro (progressivo, giacenza) → lock consultivo del
  legame (`pg_advisory_xact_lock(hashtext('legame-movimento'), hashtext(<radice>))`) → contratto
  `FOR SHARE` (`bloccaContrattoListino`) → elenchi `FOR SHARE` per `id` → righe di listino
  `FOR SHARE` per `id` → righe del legame `FOR UPDATE` per `id`. Il lock `listino-contratto` non si
  prende. I servizi del listino non prendono mai lock di registro o legame.
- Barriere nei test di concorrenza: `pg_stat_activity` con `application_name` del processo e
  `wait_event_type = 'Lock'` (modello: `elenchi-addebiti.service.postgres.spec.ts:18-20,613-626`),
  mai `sleep` come sincronizzazione.
- Database di test: `wasteflow-pg-test-registro` su `127.0.0.1:55438`; export e controllo
  `DATABASE_URL` come nei vincoli globali; test Postgres col ruolo `wasteflow_app`; pulizia per id
  esatti (`tenantCreati`); **un solo processo pesante alla volta** con
  `flock /home/graziano/Progetti/rifiuti-wt-rentri-registro/.superpowers/sdd/2026-11-03-fase4-3/pesante.lock <cmd>`.
- Fine task backend: `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov`
  (una volta), `npx tsc --noEmit -p tsconfig.json`, `npx eslint "{src,test}/**/*.ts" --max-warnings=-1`
  da `apps/backend` con 0 errori, suite Postgres toccate più `rls-catalogo.postgres.spec.ts`
  (**64** prima del Task 3, **67** dopo). Task frontend: Karma una volta
  (`cd apps/frontend && CHROME_BIN=… npx ng test --watch=false --browsers=ChromeHeadless`, comando
  completo nei vincoli globali), `npm run build`, eslint dalla radice sui file toccati.
- Migration: `20261103200000_legami_movimento` (ultima su master: `20261103100000_listino_indici_seguiti`).
  `SET LOCAL lock_timeout = '5s';` in testa; additiva. Eccezioni ammesse: le due `ADD COLUMN
  fatturabile` su `causali_registro` / `causali_registro_azienda` (tabelle piccole), l'`UPDATE` di
  backfill su `causali_registro_azienda` e i tre `CREATE UNIQUE INDEX` additivi su `contratti_cliente`,
  `elenchi_addebiti`, `righe_addebito`. Nessun `DROP`. Nomi ≤ 63 caratteri, uguali in schema e SQL;
  `prisma validate`, `migrate deploy` su 55438, `ops/db-ruoli.sh`, `migrate diff` vuoto.
- Aree toccate in modo **mirato**: `registra-movimento.use-case.ts`, `correggi-movimento.use-case.ts`,
  `valida-dati-movimento.ts`, `api/registro/dtos/*`, `catalogo-causali*`, `causali-registro.*`,
  `uso-listino.ts`, servizi `elenchi-addebiti`, `righe-addebito`, `codici-iva`. Altre aree del registro,
  FIR, RENTRI, MUD, pese: non si toccano. Se un task ne scopre una, si ferma e lo segnala.
- Valori della spec da non reinterpretare: valori iniziali del flag (solo `INGRESSO_ESTERNO` CARICO =
  `true`); motivi `SENZA_CLIENTE, SENZA_CONTRATTO, SEDE_SENZA_CONTRATTO, CONTRATTO_AMBIGUO,
  CONTRATTO_NON_ATTIVO, SENZA_ELENCO, ELENCO_SCADUTO, SENZA_RIGA_CER, RIGA_AMBIGUA, SENZA_PREZZO,
  SENZA_QUANTITA`; avvisi `CLIENTE_NON_DA_FIR, QUANTITA_MANUALE_NON_DERIVATA, CAMBIO_CER_DA_CONFERMARE`;
  stati `DA_COLLEGARE, PROPOSTO, CONFERMATO, ESCLUSO, ANNULLATO, FATTURATO, IMPORTATO_FATTURATO`;
  `motivo_esclusione` 1-200 caratteri dopo trim; tetto azioni di massa 500.

## Review Focus

I cinque casi più probabili che la spec implica e nessun task coprirebbe da sé. Ciascuno ha il suo
test nel task indicato.

1. **Doppio invio della conferma** (doppio clic, due operatori sullo stesso legame, `versione`
   vecchia): una risposta 200, l'altra 409; un solo `congelata_il`; nessuna riga duplicata → Task 16.
2. **Retry di una registrazione già ricopiata** (`giaRegistrato`, FIR ricopiato due volte) e due
   richieste parallele sulla stessa ricopia: un solo movimento, un solo legame, nessun errore
   sull'unico del legame → Task 20.
3. **Cliente disattivato, contratto sospeso/annullato/eliminato o elenco chiuso fra la proposta e la
   conferma**: la conferma ricontrolla sulla data del movimento e risponde 409 con il motivo esatto,
   non scrive nulla → Task 16.
4. **Catena lunga di correzioni** (rettifica, rettifica, annullo; rettifica che attraversa
   «fatturazione da»; rettifica concorrente con una conferma): un solo legame, `movimento_vigente_id`
   segue l'ultima testa, la data si ricalcola → Task 21.
5. **Quantità manuale 0, negativa, con la virgola o oltre 3 decimali, e movimento retrodatato prima
   di `dataInizio` del contratto o di `validoDal` dell'elenco**: 400 sulla quantità; sul retrodatato
   motivo `CONTRATTO_NON_ATTIVO` / `SENZA_ELENCO`, mai un'eccezione → Task 11 (retrodatato) e Task 16
   (quantità).

## Mappa dei file

Nuovi (backend): `src/domain/legami-movimento/{codici,proposta-contratto,proposta-righe,valori-legame,stato-legame}.ts`
(+ spec), `src/application/legami-movimento/{lock-legame,letture-legame,proposta-legame.service,legame-scrittura,conferma-legame.service,aggiorna-prezzi.service,lista-legami.service,azioni-massa.service,aggancio-registro,legami-correzioni,impostazioni-fatturazione.service}.ts`
(+ spec), `src/api/legami-movimento/{legami-movimento.module,impostazioni-fatturazione.controller,legami-movimento.controller,movimento-legame.controller,ruoli}.ts` + `dto/`,
`src/test-support/legami-di-test.ts`. Nuovi (frontend): `fe/features/legami/*`. Modificati: elenco
nei singoli task.

## Task 0: ambiente e linea di base

**File:** nessuno (verifica). Backend/Postgres.

- [ ] **Step 1: ambiente.** Container `wasteflow-pg-test-registro` acceso con `rls-catalogo` a 64;
  variabili dei Global Constraints; cartella `.superpowers/sdd/2026-11-03-fase4-3/` con `pesante.lock`;
  `npx prisma --version` → 5.22.x.
- [ ] **Step 2: linea di base** sotto `flock`: `test:cov`, `tsc`, `rls-catalogo.postgres.spec.ts` (64),
  `registra-movimento.use-case.postgres.spec.ts`, `correggi-movimento.use-case.postgres.spec.ts`,
  `causali-registro.service.postgres.spec.ts`, `elenchi-addebiti.service.postgres.spec.ts`,
  `righe-addebito.service.postgres.spec.ts`. Annotare i test già rossi in `base-4-3.md` della cartella sdd.

---

# Pezzo 4.3a — modello, flag, impostazione e vincoli

Nessun comportamento visibile cambia: nessun legame si crea ancora.

## Task 1: flag `fatturabile` nel catalogo delle causali (dominio, backend puro)

**Files:**
- Modify: `src/domain/waste-movement/catalogo-causali.ts` (`RigaCausaleSistema`, `RigaCausaleAzienda`, `DefinizioneCausale`, `daSistema`, `daAzienda`)
- Modify: `src/application/registro/causali/catalogo-causali.repository.ts` (mapping delle righe DB), `catalogo-causali.fixture.ts` (`righeCausaliSistema()`)
- Modify: `src/application/registro/valida-dati-movimento.ts` (esito ok)
- Test: `src/domain/waste-movement/catalogo-causali.spec.ts`, `src/application/registro/valida-dati-movimento.spec.ts`, `catalogo-causali.repository.spec.ts`

**Interfaces:**
- Produces:
```ts
// RigaCausaleSistema: + fatturabile: boolean
// RigaCausaleAzienda: + fatturabile: boolean | null   (null solo per natura DISATTIVAZIONE)
// DefinizioneCausale: + fatturabile: boolean
// EsitoValidazioneDati (ramo ok): + fatturabile: boolean   // letto dalla DefinizioneCausale risolta, nessuna seconda lettura
```

- [ ] **Step 1: test che falliscono.** `causale di sistema INGRESSO_ESTERNO CARICO: fatturabile true`;
  `ogni altra causale di sistema del fixture: fatturabile false` (decisione 15: tutte le righe di
  `righeCausaliSistema()` salvo `INGRESSO_ESTERNO`); `causale PROPRIA con fatturabile true: la definizione
  lo riporta`; `due versioni della stessa causale PROPRIA con valori diversi: vince quella valida alla
  data` (Review "versione per data", spec §12.11); `DISATTIVAZIONE: la causale di sistema resta con il
  suo valore`; `validaDatiMovimento ok porta fatturabile`.
- [ ] **Step 2: run** `npx jest -w 2 src/domain/waste-movement/catalogo-causali.spec.ts src/application/registro/valida-dati-movimento.spec.ts` → FAIL (campo assente).
- [ ] **Step 3: implementa** i campi sopra; il fixture mette `fatturabile: true` solo su `INGRESSO_ESTERNO`/CARICO; `daAzienda` usa `riga.fatturabile ?? false`.
- [ ] **Step 4: run** gli stessi spec + `catalogo-causali.repository.spec.ts` → PASS. `tsc` pulito (i chiamanti di `DefinizioneCausale` compilano: `mud-regole.ts` compreso).
- [ ] **Step 5: commit** `feat(registro): flag fatturabile nel catalogo delle causali (dominio)`.

## Task 2: codici, messaggi e stati del legame (dominio, backend puro)

**Files:**
- Create: `src/domain/legami-movimento/codici.ts`, `codici.spec.ts`

**Interfaces:**
- Produces:
```ts
export const STATI_LEGAME = ['DA_COLLEGARE','PROPOSTO','CONFERMATO','ESCLUSO','ANNULLATO','FATTURATO','IMPORTATO_FATTURATO'] as const
export type StatoLegame = (typeof STATI_LEGAME)[number]
export const MOTIVI_LEGAME = ['SENZA_CLIENTE','SENZA_CONTRATTO','SEDE_SENZA_CONTRATTO','CONTRATTO_AMBIGUO','CONTRATTO_NON_ATTIVO','SENZA_ELENCO','ELENCO_SCADUTO','SENZA_RIGA_CER','RIGA_AMBIGUA','SENZA_PREZZO','SENZA_QUANTITA'] as const
export type MotivoLegame = (typeof MOTIVI_LEGAME)[number]
export const AVVISI_LEGAME = ['CLIENTE_NON_DA_FIR','QUANTITA_MANUALE_NON_DERIVATA','CAMBIO_CER_DA_CONFERMARE'] as const
export type AvvisoLegame = (typeof AVVISI_LEGAME)[number]
export const MESSAGGI_MOTIVO: Readonly<Record<MotivoLegame, string>>
export const MESSAGGI_AVVISO: Readonly<Record<AvvisoLegame, string>>
export const STATI_FATTURATI: readonly StatoLegame[]            // FATTURATO, IMPORTATO_FATTURATO
export function eStatoFatturato(s: StatoLegame): boolean
export function sonoMotiviValidi(v: readonly unknown[]): v is MotivoLegame[]
export function sonoAvvisiValidi(v: readonly unknown[]): v is AvvisoLegame[]
export const MOTIVO_ESCLUSIONE_CAUSALE = 'Causale non fatturabile'
export const MOTIVO_ESCLUSIONE_DATA = 'Data del movimento prima di «fatturazione da»'
export const AVVISO_SCOSTAMENTO = 'Il movimento è già stato fatturato; la correzione non cambia la fattura'
export function validaMotivoEsclusione(testo: unknown): { ok: true; valore: string } | { ok: false; errore: string }
```

- [ ] **Step 1: test.** `gli insiemi sono chiusi: 11 motivi, 3 avvisi, 7 stati`; `ogni motivo e ogni avviso ha un messaggio non vuoto, senza id`; `validaMotivoEsclusione("  x ")` → ok `"x"`; `"   "` e `""` → errore; 200 caratteri ok, 201 errore; `eStatoFatturato` vero solo per i due stati fatturati; `sonoMotiviValidi(['FOO'])` falso.
- [ ] **Step 2: run** `npx jest -w 2 src/domain/legami-movimento/codici.spec.ts` → FAIL.
- [ ] **Step 3: implementa** `codici.ts` (messaggi brevi in italiano; `AVVISO_SCOSTAMENTO` copiato dalla spec §7.5).
- [ ] **Step 4: run** → PASS.
- [ ] **Step 5: commit** `feat(legami): codici, messaggi e stati del legame (dominio)`.

## Task 3: schema, migration e RLS (Postgres, migration)

**Files:**
- Modify: `prisma/schema.prisma` (enum `StatoLegameMovimento` `@@map("stato_legame_movimento")`, `FonteClienteLegame` (`FIR`/`UTENTE`), `OrigineRigaLegame` (`PRINCIPALE`/`PROPOSTA`/`MANUALE`), `OrigineQuantitaLegame` (`DA_MOVIMENTO`/`MANUALE`); tre modelli in coda dopo `RigaAddebito`/`ScadenzaRigaAddebito`; `fatturabile` su `CausaleRegistro` e `CausaleRegistroAzienda`; `@@unique` additivi su `ContrattoCliente (id, clienteId, tenantId)`, `ElencoAddebiti (id, contrattoId, tenantId)`, `RigaAddebito (id, elencoId, tenantId)`; relazioni inverse su `Tenant`, `Cliente`, `ContrattoCliente`, `ElencoAddebiti`, `RigaAddebito`, `CodiceIva`, `WasteMovement` solo come back-relation Prisma, nessuna colonna)
- Create: `prisma/migrations/20261103200000_legami_movimento/migration.sql`
- Modify: `src/infrastructure/persistence/prisma-rls.extension.ts` (`TENANT_SCOPED_MODELS`: `LegameMovimento`, `RigaLegameMovimento`, `ImpostazioneFatturazione`), `rls-catalogo.postgres.spec.ts:64` (64 → 67, elenca le tre), `README-tenant-transazione.md` (conteggi e tabelle), `ops/README.md` (rollback)
- Create: `src/test-support/legami-di-test.ts`
- Test: `src/application/legami-movimento/legami-movimento.schema.postgres.spec.ts`

**Interfaces:**
- Produces (tabelle): `legami_movimento` (colonne e vincoli di spec §4.2: unico `(tenant_id, movimento_originale_id)`; FK composta `(movimento_originale_id, registro_id, tenant_id, verso)` e `(movimento_vigente_id, …)` → `waste_movements (id, registro_id, tenant_id, type)` NoAction; FK `(cliente_id, tenant_id)`, `(contratto_id, cliente_id, tenant_id)`, `(elenco_id, contratto_id, tenant_id)` NoAction; CHECK di coerenza di §4.2 e `motivi <@ ARRAY[…]`, `avvisi <@ ARRAY[…]`; indici `(tenant_id, stato, data_movimento)`, `(tenant_id, cliente_id)`, `(tenant_id, contratto_id)`, `(tenant_id, elenco_id)`); `righe_legame_movimento` (§4.3: FK `(riga_addebito_id, elenco_id, tenant_id)` NoAction, `(legame_id, elenco_id, tenant_id)` CASCADE, `(codice_iva_id, tenant_id)` NoAction; unico `(legame_id, riga_addebito_id)`; CHECK `prezzo_speciale ⇒ prezzo IS NULL`, `quantita IS NULL ⇔ quantita_origine IS NULL`); `impostazioni_fatturazione` (§4.9, unico `tenant_id`). Colonne `fatturabile`: `causali_registro boolean NOT NULL DEFAULT false` con `UPDATE … SET fatturabile = true WHERE codice = 'INGRESSO_ESTERNO' AND verso = 'CARICO'`; `causali_registro_azienda boolean NULL`, backfill `false` per `natura = 'PROPRIA'`, poi `CHECK (natura <> 'PROPRIA' OR fatturabile IS NOT NULL) NOT VALID` + `VALIDATE`. Unico `(id, legame…)`: `legami_movimento (id, elenco_id, tenant_id)` per la FK CASCADE delle righe.
- Fixture:
```ts
export async function creaMovimentoDiTest(owner: PrismaClient, tenantId: string, opz?: { causale?: string; cerCode?: string; quantity?: string; unit?: string; movementDate?: string; firId?: string | null; type?: 'CARICO' | 'SCARICO' }): Promise<{ movimentoId: string; registroId: string; type: 'CARICO' | 'SCARICO' }>
export async function creaLegameDiTest(owner: PrismaClient, tenantId: string, opz: { movimentoOriginaleId: string; registroId: string; verso: 'CARICO' | 'SCARICO'; stato?: StatoLegame; clienteId?: string; contrattoId?: string; elencoId?: string; righe?: { rigaAddebitoId: string; quantita?: string; prezzo?: string | null; codiceIvaId: string }[] }): Promise<{ legameId: string; righeIds: string[] }>
```
(`creaLegameDiTest` inserisce col proprietario e rispetta i CHECK: per `CONFERMATO` pretende cliente, contratto, elenco).

- [ ] **Step 1: test che falliscono** (suite Postgres, ruolo `wasteflow_app`, fixture da `creaContrattoConElenco`/`creaRiga`): `INGRESSO_ESTERNO CARICO fatturabile true, tutte le altre causali di sistema false`; `causale aziendale PROPRIA con fatturabile NULL respinta, DISATTIVAZIONE con NULL ammessa`; `secondo legame per la stessa catena: P2002`; `legame CONFERMATO senza elenco respinto`; `legame CONFERMATO con motivi non vuoti respinto`; `legame PROPOSTO senza contratto respinto`; `motivo fuori dall'insieme chiuso respinto`; `(FATTURATO) senza fatturato_il respinto`; `ESCLUSO senza motivo_esclusione respinto` (il database non distingue la scelta dell'utente dal testo fisso della causale: il servizio scrive sempre un testo); `scostamento_dopo_fattura vero con stato CONFERMATO respinto`; `elenco di un altro contratto respinto (FK composta)`; `contratto di un altro cliente respinto`; `riga di un elenco diverso dall'elenco del legame respinta`; `riga con prezzo_speciale e prezzo valorizzato respinta`; `quantita NULL con quantita_origine DA_MOVIMENTO respinta`; `stessa riga di listino due volte nel legame: P2002`; **vincolo di eliminazione** `delete di riga_addebito usata: 23503`, `delete di elenco con riga usata: 23503 (anche a cascata)`, `delete di codice_iva usato: 23503`; `cancellare il tenant toglie legami, righe e movimenti` (cascata); RLS: `senza tenant attivo 0 righe`, `altro tenant 0 righe` per le tre tabelle; `modifica di un movimento: nessuna colonna nuova su waste_movements` (confronto con l'elenco colonne di `information_schema`: stesse di prima).
- [ ] **Step 2: run** `flock … npx jest -c jest.postgres.config.js --runInBand --forceExit src/application/legami-movimento/legami-movimento.schema.postgres.spec.ts` → FAIL.
- [ ] **Step 3: schema + migration.** Per `ESCLUSO` il CHECK impone `motivo_esclusione IS NOT NULL` (scelta di piano: la spec lo chiede solo per la scelta dell'utente, ma il database non distingue le origini); il servizio scrive `MOTIVO_ESCLUSIONE_CAUSALE`, `MOTIVO_ESCLUSIONE_DATA` o il motivo dell'utente. Migration scritta a mano nell'ordine: enum → ALTER causali → UPDATE backfill → unici additivi → tabelle → FK → CHECK → indici → `ENABLE` + `FORCE ROW LEVEL SECURITY` + le due policy standard per ciascuna delle tre tabelle (copiare da `20261102300100_listino_elenchi_righe`) → `GRANT` come le altre tabelle (`ops/db-ruoli.sh`). Rollback in `ops/README.md`.
- [ ] **Step 4: verifiche migration.** `npx prisma validate`; `npx prisma generate`; `migrate deploy` su 55438; `db-ruoli.sh`; `migrate diff … --shadow-database-url …shadow_listino` → vuoto.
- [ ] **Step 5: run** la suite Task 3 + `rls-catalogo.postgres.spec.ts` (67) → PASS; `tsc`.
- [ ] **Step 6: commit** `feat(legami): tabelle legami_movimento, righe, impostazioni_fatturazione e flag fatturabile con RLS`.

## Task 4: flag `fatturabile` nelle causali aziendali (servizio e API, Postgres)

**Files:**
- Modify: `src/application/registro/causali/causali-registro.service.ts` (`DatiNuovaCausale`, `DatiModificaCausale`, `DatiNuovaVersione`, `CausalePropriaVista`, `CausaleSistemaInGestione`, `OpzioneCausale`, `validaCoerenza`), `src/api/registro/dtos/` (DTO causali), `src/api/registro/causali-registro.controller.ts`
- Test: `causali-registro.service.postgres.spec.ts`, `causali-registro.service.spec.ts`, `causali-registro.controller.spec.ts`, `causali-registro.controller.http.spec.ts`

**Interfaces:**
- Produces: `fatturabile?: boolean` (default `false`) sui DTO di creazione, modifica e nuova versione; `fatturabile: boolean` in `CausalePropriaVista`, `CausaleSistemaInGestione` (sola lettura), `OpzioneCausale`. Nessuna rotta modifica il flag di una causale di sistema (decisione 14).

- [ ] **Step 1: test.** `crea causale AZ_ senza fatturabile: salvata false`; `crea con fatturabile true: la gestione e le opzioni lo riportano true`; `nuova versione con fatturabile cambiato: la versione precedente resta com'era`; `modifica con fatturabile non booleano: 400`; `gestione: INGRESSO_ESTERNO appare fatturabile true e senza azione di modifica`; `PUT/POST su una causale di sistema con fatturabile nel corpo: 400 o ignorato (proprietà non ammessa), flag invariato`; `operatore (non amministratore) che prova a creare: stesso errore di oggi`.
- [ ] **Step 2: run** (service+controller) → FAIL.
- [ ] **Step 3: implementa** il passaggio del campo fino alla riga DB e alle viste; `validaCoerenza` accetta `fatturabile` solo con `natura = PROPRIA`.
- [ ] **Step 4: run** i quattro spec + `causali-registro.schema.postgres.spec.ts` → PASS. Fine task backend.
- [ ] **Step 5: commit** `feat(registro): fatturabile impostabile sulle causali aziendali`.

## Task 5: impostazione «fatturazione da» (servizio e API, Postgres)

**Files:**
- Create: `src/application/legami-movimento/impostazioni-fatturazione.service.ts` + `.spec.ts` + `.postgres.spec.ts`
- Create: `src/api/legami-movimento/{legami-movimento.module,impostazioni-fatturazione.controller,ruoli}.ts`, `dto/impostazione-fatturazione.dto.ts`, `impostazioni-fatturazione.controller.spec.ts`
- Modify: `src/app.module.ts` (una riga: `LegamiMovimentoModule`)

**Interfaces:**
- Produces:
```ts
export interface ImpostazioneFatturazioneVista { fatturazioneDa: string | null; versione: number; modificatoIl: string | null }  // data AAAA-MM-GG
// GET /impostazioni-fatturazione            RUOLI_LETTURA     → ImpostazioneFatturazioneVista (senza riga: { fatturazioneDa: null, versione: 0, modificatoIl: null })
// PUT /impostazioni-fatturazione            RUOLI_VARIAZIONI  body { fatturazioneDa: string | null; versione: number; confermaMovimenti?: number }
//   → ImpostazioneFatturazioneVista; 409 CONFERMA_RICHIESTA { movimentiToccati: number } se il numero non coincide; 409 VERSIONE_SUPERATA
export function movimentiToccati(vecchia: string | null, nuova: string | null): /* intervallo [min,max) sul quale il filtro cambia */
// service
contaMovimentiToccati(tenantId: string, nuova: string | null): Promise<number>
imposta(tenantId: string, utenteId: string, dati: { fatturazioneDa: string | null; versione: number; confermaMovimenti?: number }): Promise<ImpostazioneFatturazioneVista>
```
`contaMovimentiToccati`: movimenti vigenti (testa della catena, non ANNULLAMENTO) con causale fatturabile alla data (catalogo risolto con `caricaCatalogoCausali`, raggruppati per `type, causale, causaleAziendaId` con `groupBy`, nessun ciclo per riga) la cui `movementDate` cade fra la vecchia e la nuova data.

- [ ] **Step 1: test (unit + Postgres).** `GET senza riga: fatturazioneDa null`; `PUT prima volta (versione 0) con data: 200, versione 1`; `PUT con data null: fatturazione spenta`; `data non valida ("2026-13-40") o nel formato sbagliato: 400`; `spostare la data indietro con 3 movimenti fatturabili nell'intervallo senza confermaMovimenti: 409 CONFERMA_RICHIESTA { movimentiToccati: 3 }, riga invariata`; `con confermaMovimenti: 3: 200`; `con confermaMovimenti: 2: 409`; `intervallo senza movimenti: nessuna conferma richiesta`; `versione vecchia: 409`; `OPERATOR e VIEWER su PUT: 403; VIEWER su GET: 200`; `audit con valore precedente e nuovo (ACTIVITY_LOG, solo date)`; `RLS: un altro tenant non vede la riga`; `due PUT concorrenti con la stessa versione: uno 200 e uno 409`. Spostare la data **avanti** non cancella legami `CONFERMATO` (la verifica con legami veri è nel Task 18, `lista-legami`; qui solo che `imposta` non tocca `legami_movimento`).
- [ ] **Step 2: run** → FAIL. **Step 3: implementa** (lock ottimistico come `Cliente`; `@Roles` esplicito; modulo registrato in `app.module.ts`). **Step 4: run** → PASS, controller-tenant-selezionato e nessun-user-userid verdi. Fine task backend.
- [ ] **Step 5: commit** `feat(legami): impostazione fatturazione da (servizio e API)`.

## Task 6: «in uso» per righe, elenchi e codici IVA (backend, Postgres)

**Files:**
- Modify: `src/application/listino/uso-listino.ts` (`ColonneReferentiListino` + `righeLegame`, `COLONNE_CODICE_IVA`, `COLONNE_ADDEBITO`, `contaUsiListino`), `elenchi-addebiti.service.ts` (`elimina`, `viste`/`eliminabile`), `righe-addebito.service.ts` (`elimina`, errore `RIGA_ADDEBITO_IN_USO`), `codici-iva.service.ts` (`eliminabile`, `elimina`), `src/application/clienti/anagrafica-versionata.ts` solo se serve mappare il nuovo nome di FK (P2003 → `<PREFISSO>_IN_USO`)
- Test: `uso-listino.spec.ts`, `elenchi-addebiti.service.postgres.spec.ts`, `righe-addebito.service.postgres.spec.ts`, `codici-iva.service.postgres.spec.ts`

**Interfaces:**
- Produces: `ColonneReferentiListino.righeLegame: readonly string[]` (colonne di `righe_legame_movimento`: `rigaAddebitoId`, `elencoId`, `codiceIvaId`); `ElencoAddebitiVista.eliminabile` falso se una sua riga è citata; viste di riga con `eliminabile: boolean` (nuovo campo, `RigaAddebitoVista`); errori 409 `ELENCO_ADDEBITI_IN_USO` (messaggio «L'elenco ha righe usate da movimenti: non si può eliminare.»), `RIGA_ADDEBITO_IN_USO` (messaggio esistente), `CODICE_IVA_IN_USO`.

- [ ] **Step 1: test (Postgres).** Con `creaLegameDiTest`: `elimina riga citata da un legame: 409 RIGA_ADDEBITO_IN_USO, riga e legame intatti`; `elimina elenco con una riga citata: 409 ELENCO_ADDEBITI_IN_USO, nessuna riga cancellata a cascata`; `elimina elenco senza righe citate: 200 come prima`; `elimina codice IVA citato: 409 CODICE_IVA_IN_USO`; `vista elenco e riga: eliminabile false se citati`; `disattivare il codice IVA o chiudere validoAl dell'elenco usato: 200` (decisione 8); `lista di 1000 id: contaUsiListino con una sola query per colonna`.
- [ ] **Step 2-4:** run FAIL → implementa → run PASS (tutte le suite listino toccate + `rls-catalogo` 67). Nessuna regressione sulle suite listino esistenti. Fine task backend.
- [ ] **Step 5: commit** `feat(listino): righe, elenchi e codici IVA usati dai legami non si eliminano`.

## Task 7: frontend — schermata «Fatturazione da» (4.3a)

**Files:**
- Create: `fe/features/legami/impostazioni-fatturazione.component.ts` + `.spec.ts`, `fe/features/legami/legami.model.ts` (solo `ImpostazioneFatturazione`), `fe/features/legami/impostazioni-fatturazione.service.ts` + `.spec.ts`
- Modify: `fe/app.routes.ts` (`clienti/fatturazione`, lazy), `fe/shared/components/layout.component.ts` (voce di menu sotto Clienti)

**Interfaces:**
- Consumes: Task 5 (`GET`/`PUT /impostazioni-fatturazione`, `CONFERMA_RICHIESTA { movimentiToccati }`).
- Produces: `ImpostazioneFatturazioneService.leggi(): Observable<ImpostazioneFatturazione>`, `.salva(dati: { fatturazioneDa: string | null; versione: number; confermaMovimenti?: number })`.

- [ ] **Step 1: test.** `mostra "Fatturazione spenta" quando la data è vuota`; `salva con una data: chiama PUT con AAAA-MM-GG`; `409 CONFERMA_RICHIESTA: apre la conferma «Verranno toccati 3 movimenti», e solo dopo il consenso rimanda con confermaMovimenti 3`; `VIEWER e OPERATOR: campo e pulsante disabilitati`; `409 VERSIONE_SUPERATA: messaggio e ricarica`. Pagina `pagina-lavoro`.
- [ ] **Step 2: run** Karma mirato → FAIL; **Step 3: implementa**; **Step 4:** Karma una volta + build + eslint → PASS.
- [ ] **Step 5: commit** `feat(legami): schermata fatturazione da`.

## Task 8: frontend — flag «fatturabile» nelle causali

**Files:**
- Modify: `fe/features/registro/causali-registro.service.ts` (+ spec), `causali-gestione.ts` (+ spec), `causali-registro-dialog.component.ts` (+ `.dom.spec.ts`)

**Interfaces:** Consumes Task 4: `fatturabile: boolean` nelle viste e nei DTO.

- [ ] **Step 1: test.** `causale aziendale: checkbox «Fatturabile» modificabile, salvata nel corpo`; `causale di sistema: «Fatturabile» mostrato in sola lettura (sì per INGRESSO_ESTERNO)`; `nuova versione: parte dal valore della versione precedente`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS.
- [ ] **Step 5: commit** `feat(registro): flag fatturabile nel dialog delle causali`.

## Task 9: verifica e chiusura 4.3a (e2e API leggero, Postgres)

**Files:**
- Create: `e2e/tests/legami/impostazione-fatturazione.spec.ts`
- Modify: `ops/README.md` (rilascio e rollback 4.3a, se non già fatto)

- [ ] **Step 1: test e2e** (API + UI minima, sul modello di `e2e/tests/listino/listino-contratto.spec.ts`: dati creati in `beforeAll`, nomi casuali, pulizia per id): `ADMIN imposta la data`; `OPERATOR riceve 403`; `crea causale aziendale fatturabile`; `registrare un movimento con INGRESSO_ESTERNO NON crea alcun legame` (conta legami = 0 via query del proprietario o assenza di rotta `GET /registro/movimenti/:id/legame` → 404); `eliminare una riga di listino senza legami funziona`.
- [ ] **Step 2: verifica completa** sotto `flock`: `test:cov`, `tsc`, eslint, suite Postgres toccate (Task 3-6), `rls-catalogo` 67, Karma una volta, `migrate diff` vuoto. Confronto con la linea di base del Task 0: nessun test nuovo rosso.
- [ ] **Step 3: commit** `test(legami): e2e dell'impostazione fatturazione e chiusura 4.3a`.

## Task 10: revisione dell'intero branch — 4.3a

**File:** nessuno (revisione opus su `git diff master...HEAD`).

- [ ] **Step 1:** revisore opus fresco (agente `typescript-nestjs-reviewer`) sul diff: RLS ENABLE+FORCE nella stessa migration, tre modelli in `TENANT_SCOPED_MODELS`, conteggio 67, nessun `DROP`, `entryHash` invariato (`entry-hash` spec verde), nessuna colonna su `waste_movements`, `@Roles` su ogni rotta, test di assenza di comportamento (Task 9), Global Constraints rispettati. Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto in `.superpowers/sdd/2026-11-03-fase4-3/4-3a-report.md` (stato, commit, numeri). PR 4.3a, merge, deploy con `migrate deploy`.

---

# Pezzo 4.3b — proposta, scritture e azioni

Da master dopo il merge della 4.3a.

## Task 11: dominio — cliente, contratto, elenco (puro)

**Files:**
- Create: `src/domain/legami-movimento/proposta-contratto.ts`, `proposta-contratto.spec.ts`

**Interfaces:**
- Consumes: `elenchiValidiAl`, `elencoProposto` (`src/domain/listino/elenco-addebiti.ts:119,127`); `MotivoLegame`, `AvvisoLegame` (Task 2).
- Produces:
```ts
export interface ClienteDaFir { id: string; attivo: boolean }
export function proponiCliente(i: { firPresente: boolean; clienteDaFir: ClienteDaFir | null }):
  { clienteId: string | null; fonte: 'FIR' | null; motivi: MotivoLegame[]; avvisi: AvvisoLegame[] }
export interface ContrattoCandidato { id: string; clienteId: string; stato: 'BOZZA'|'ATTIVO'|'SOSPESO'|'SOSPESO_MOVIMENTI'|'ANNULLATO'; dataInizio: string; dataFine: string | null; sedeId: string | null }
export interface EsitoContratto { contratto: ContrattoCandidato | null; candidati: ContrattoCandidato[]; motivo: 'SENZA_CONTRATTO'|'SEDE_SENZA_CONTRATTO'|'CONTRATTO_AMBIGUO'|'CONTRATTO_NON_ATTIVO' | null }
export function proponiContratto(contratti: readonly ContrattoCandidato[], data: string, sedeId: string | null): EsitoContratto
export interface ElencoCandidato { id: string; validoDal: string | null; validoAl: string | null; predefinito: boolean }
export function proponiElenco(elenchi: readonly ElencoCandidato[], data: string): { elenco: ElencoCandidato | null; validi: ElencoCandidato[]; motivo: 'SENZA_ELENCO'|'ELENCO_SCADUTO' | null }
```
Date `AAAA-MM-GG` (confronto fra stringhe). `sedeId` null = sede ignota (movimento senza FIR o FIR senza sede produttore).

- [ ] **Step 1: test.** *Cliente:* `FIR con cliente attivo: clienteId, fonte FIR, nessun motivo`; `FIR il cui produttore non è cliente: SENZA_CLIENTE + avviso CLIENTE_NON_DA_FIR`; `cliente disattivato: SENZA_CLIENTE`; `nessun FIR: SENZA_CLIENTE senza avviso`. *Contratto (decisione 10):* `stessa sede del FIR vince sul senza sede`; `nessuno della sede: il senza sede`; `solo contratti di altre sedi: nessuna proposta, SEDE_SENZA_CONTRATTO`; `due nella stessa sede: CONTRATTO_AMBIGUO con la lista`; `BOZZA e ANNULLATO mai proposti`; `unico SOSPESO: CONTRATTO_NON_ATTIVO`; `nessun contratto: SENZA_CONTRATTO`; `sedeId null e solo contratti senza sede, uno: proposto`; `sedeId null e solo contratti con sede: CONTRATTO_AMBIGUO con la lista`; `dataFine null = aperto`; `data = dataFine: valido, data = dataFine+1: non valido`; **`movimento retrodatato prima di dataInizio: CONTRATTO_NON_ATTIVO (se il contratto esiste ATTIVO ma non ancora iniziato), mai eccezione`** (Review 5). *Elenco:* `unico valido: quello`; `due validi e un predefinito valido: il predefinito`; `due validi senza predefinito: nessuno, SENZA_ELENCO`; `validoDal dopo la data: escluso (non ancora iniziato)`; `tutti scaduti: ELENCO_SCADUTO`; `nessun elenco: SENZA_ELENCO`.
- [ ] **Step 2: run** `npx jest -w 2 src/domain/legami-movimento/proposta-contratto.spec.ts` → FAIL. **Step 3: implementa** (a gradini, ferma al primo risultato; il controllo `validoDal ≤ data` sta qui perché `elenchiValidiAl` guarda solo `validoAl`). **Step 4:** PASS. **Step 5: commit** `feat(legami): regole di proposta di cliente, contratto ed elenco (dominio)`.

## Task 12: dominio — riga principale, righe proposte e quantità (puro)

**Files:**
- Create: `src/domain/legami-movimento/proposta-righe.ts`, `proposta-righe.spec.ts`

**Interfaces:**
- Consumes: `chiaveConfrontoCer` (`src/domain/waste-movement/cer-registro.ts:30`), `convertiInKg` (`src/domain/waste-movement/unita-misura-registro.ts:27`), `quantitaDaMovimento(tipo, um, m)` (`src/domain/listino/importi-riga.ts:131`).
- Produces:
```ts
export interface RigaCandidata { id: string; tipo: string; cerCode: string | null; riferimento: string | null; addebitoCodice: string | null; cerProposta: string[]; addebitiProposti: string[]; tipoQuantita: 'PESO_NETTO'|'PESO_LORDO'|'VOLUME'|'UNO'|'ALTRO' | null; unitaMisura: string }
export interface EsitoRighe { principale: RigaCandidata | null; motivo: 'SENZA_RIGA_CER'|'RIGA_AMBIGUA' | null; candidateCer: RigaCandidata[]; proposte: RigaCandidata[] }
export function scegliRighe(righe: readonly RigaCandidata[], cerMovimento: string): EsitoRighe
export function rigaVCombacia(riga: RigaCandidata, cerMovimento: string): boolean
export interface MovimentoPerQuantita { quantity: string; unit: string }
export function quantitaPerRiga(riga: Pick<RigaCandidata, 'tipoQuantita' | 'unitaMisura'>, m: MovimentoPerQuantita): string | null
```

- [ ] **Step 1: test (valori della spec).** *Riga CER (decisione 12):* `riferimento null vince su "?"`; `solo "?": quella`; `solo riferimenti specifici (es. "A1"): RIGA_AMBIGUA con le candidate`; `nessuna riga CER: SENZA_RIGA_CER`; `CER confrontato con chiaveConfrontoCer ("20 03 01" e "200301")`; `CER con asterisco non combacia con quello senza`. *Righe V:* `cerProposta "20 03 01/" combacia`; `"20 03 01/*" combacia`; `"20 03 01" senza barra combacia`; `"20 03 01/A1" non combacia`; `elementi "/" e "/*" sulla stessa riga V: una proposta sola`; `riga V il cui addebitoCodice è in addebitiProposti della riga CER: proposta`; `V non proposta da nessuno: non compare`; `tipo T/F/N/M non si propone`. *Quantità:* `PESO_NETTO su 6000 KG, riga KG: "6000"`; `6000 KG con riga TON: "6"` (dividi per 1000, come `quantitaDaMovimento`); `6 T (unit "T") con riga KG: "6000"` (via `convertiInKg`); `PESO_NETTO su unità "NR" o "L": null`; `PESO_LORDO: null`; `UNO: "1"`; `ALTRO: null`; `VOLUME con unit "L": passa il volume con umVolume "L"`; `VOLUME con unit "KG": null`; `quantity "0.50" con TON: "0.0005"`.
- [ ] **Step 2: run** FAIL. **Step 3: implementa** (netto in kg sempre; lordo mai disponibile; volume solo da `L`/`MC`→`umVolume` `L`/`M`). **Step 4:** PASS. **Step 5: commit** `feat(legami): scelta delle righe e quantità dal movimento (dominio)`.

## Task 13: dominio — valori congelati, motivi e macchina a stati (puro)

**Files:**
- Create: `src/domain/legami-movimento/valori-legame.ts`, `stato-legame.ts` + spec

**Interfaces:**
- Consumes: Task 2, `importoRiga`, `cascataValida` (`importi-riga.ts:83,61`).
- Produces:
```ts
export interface RigaLegameValori { rigaAddebitoId: string; origine: 'PRINCIPALE'|'PROPOSTA'|'MANUALE'; prezzoSpeciale: boolean; prezzo: string | null; sconto: string | null; quantita: string | null; quantitaOrigine: 'DA_MOVIMENTO'|'MANUALE' | null; codiceIvaId: string | null }
export function motiviRighe(righe: readonly RigaLegameValori[]): MotivoLegame[]            // SENZA_PREZZO (non speciale senza prezzo; zero ESPLICITO "0" è valido), SENZA_QUANTITA
export function copiaValoriDaRiga(r: { prezzo: string | null; prezzoSpeciale: boolean; sconto: string | null; codiceIva: { id: string; aliquota: string; natura: string | null } }): { prezzo: string | null; sconto: string | null; codiceIvaId: string; aliquotaIva: string; naturaIva: string | null }
export type MotiviCompleti = { motivi: MotivoLegame[] }
export function statoDaProposta(i: { motivi: readonly MotivoLegame[]; confermaRichiesta: boolean; completo: boolean }): 'DA_COLLEGARE'|'PROPOSTO'|'CONFERMATO'
export type TipoCorrezione = 'RETTIFICA' | 'ANNULLAMENTO'
export interface InputCorrezione { statoPrima: StatoLegame; tipo: TipoCorrezione; causaleFatturabileDopo: boolean; cerCambiato: boolean; dataDopo: string; fatturazioneDa: string | null; dataPrima: string }
export interface EsitoCorrezione { statoDopo: StatoLegame | 'NESSUN_LEGAME'; ricalcolaProposta: boolean; ricalcolaQuantitaDaMovimento: boolean; aggiornaVigenteEData: boolean; scostamento: boolean; avvisi: AvvisoLegame[]; motivoEsclusione: string | null }
export function esitoCorrezione(i: InputCorrezione): EsitoCorrezione
export function puoAggiornarePrezzi(s: StatoLegame): boolean      // PROPOSTO, CONFERMATO, DA_COLLEGARE
export function transizioneEscludi(s: StatoLegame): StatoLegame | null  // null se FATTURATO/IMPORTATO/ANNULLATO
```

- [ ] **Step 1: test (tabella §7.5 una riga per test).** `prezzo "0" esplicito su riga non speciale: nessun motivo`; `prezzo null su riga non speciale: SENZA_PREZZO`; `prezzo speciale con prezzo null: nessun motivo`; `quantita null: SENZA_QUANTITA`; `copiaValoriDaRiga su riga speciale: prezzo null, IVA copiata`; `rettifica non fatturato stesso CER e causale fatturabile: statoDopo invariato, aggiornaVigenteEData, ricalcolaQuantitaDaMovimento, nessun ricalcolo di prezzo`; `rettifica che cambia il CER: PROPOSTO o DA_COLLEGARE, ricalcolaProposta, avviso CAMBIO_CER_DA_CONFERMARE`; `causale diventa non fatturabile: ESCLUSO con MOTIVO_ESCLUSIONE_CAUSALE`; `ESCLUSO + causale diventa fatturabile: DA_COLLEGARE e ricalcolaProposta`; `NESSUN_LEGAME + causale fatturabile: ricalcolaProposta` (il chiamante decide se crearlo); `data prima di fatturazioneDa: ESCLUSO con MOTIVO_ESCLUSIONE_DATA`; `da prima a dopo fatturazioneDa: DA_COLLEGARE`; `fatturazioneDa null: NESSUN_LEGAME`; `annullamento non fatturato: ANNULLATO`; `FATTURATO e IMPORTATO_FATTURATO: statoDopo invariato, scostamento true, aggiornaVigenteEData true, avviso scostamento`; `transizioneEscludi(FATTURATO) null`; `puoAggiornarePrezzi` falso per ESCLUSO, ANNULLATO, FATTURATO, IMPORTATO_FATTURATO.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(legami): valori congelati, motivi e transizioni di stato (dominio)`.

## Task 14: lock, letture e guardia sul registro (backend, Postgres pesante)

**Files:**
- Create: `src/application/legami-movimento/lock-legame.ts`, `letture-legame.ts`, `lock-legame.postgres.spec.ts`, `letture-legame.postgres.spec.ts`, `guardia-registro.spec.ts`
- Modify: `src/test-support/legami-di-test.ts` (aggiunge `creaScenarioProposta`)

**Interfaces:**
- Consumes: `bloccaContrattoListino`, `impostaTimeoutLock`, `joinLineari` (`lock-listino.ts`).
- Produces:
```ts
export const LOCK_TIMEOUT_AGGANCIO = '2s'
export async function bloccaLegamePerRadice(tx: Prisma.TransactionClient, radiceId: string): Promise<void>   // pg_advisory_xact_lock(hashtext('legame-movimento'), hashtext(radiceId))
export async function bloccaListinoInCondivisione(tx: Prisma.TransactionClient, tenantId: string, contrattoId: string, elencoIds: readonly string[], rigaIds: readonly string[]): Promise<ContrattoBloccato>  // contratto SHARE → elenchi SHARE per id → righe SHARE per id (JOIN unnest + joinLineari)
export async function bloccaRigheLegame(tx: Prisma.TransactionClient, tenantId: string, legameIds: readonly string[]): Promise<void>  // FOR UPDATE per id
export interface DatiPerProposta { /* movimento, FIR→cliente, sede, contratti, elenchi, righe, codici IVA */ }
export async function leggiDatiPerProposta(tx: Prisma.TransactionClient, tenantId: string, i: { cerCode: string; movementDate: string; clienteId: string | null; sedeId: string | null; contrattoId?: string; elencoId?: string }): Promise<DatiPerProposta>
export async function clienteDaFir(tx: Prisma.TransactionClient, tenantId: string, firId: string): Promise<{ cliente: ClienteDaFir | null; sedeId: string | null }>  // FIR.producerId → Produttore.dittaId → Cliente (tenantId, dittaId); sede da FIR.producerSedeId
```
Guardia: `guardia-registro.spec.ts` legge i sorgenti di `src/application/legami-movimento/**` (escluse le spec) e fallisce se trova `wasteMovement.(create|update|updateMany|delete|deleteMany|upsert|createMany)` o SQL `INSERT INTO|UPDATE|DELETE FROM "?waste_movements`.

- [ ] **Step 1: test Postgres.** *Letture:* `FIR → produttore → ditta → cliente attivo`; `FIR senza producerId: cliente null`; `ditta non cliente: null`; `contratti candidati e righe in una query per lista, non per riga`; **`JOIN unnest con 5000 id e piano generico forzato (ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan, ripristinato in finally): termina sotto 5 s`** (modello `variazioni-prezzi.service.postgres.spec.ts:761-778`). *Lock (barriere `pg_stat_activity`, `application_name` = `legami-t14-${pid}`):* `un FOR UPDATE del listino su una riga tiene in attesa bloccaListinoInCondivisione finché non fa commit; dopo il commit procede e legge il valore nuovo`; `viceversa: una modifica del listino (FOR UPDATE sulla stessa riga) aspetta la transazione del legame che tiene FOR SHARE`; `due transazioni del legame in parallelo sulle stesse righe: nessuna in attesa (conteggio sessioni in Lock = 0 mentre entrambe tengono i lock)`; `ordine dei lock senza deadlock: 20 coppie (scrittura di listino, transazione del legame) sugli stessi elenchi e righe in parallelo con Promise.all, nessun 40P01, tutte concluse`; `bloccaLegamePerRadice: due transazioni sulla stessa radice si serializzano, su radici diverse no`. *Guardia:* `nessun file di application/legami-movimento scrive su waste_movements`.
- [ ] **Step 2: run** (sotto `flock`) FAIL. **Step 3: implementa.** **Step 4:** PASS + fine task backend. **Step 5: commit** `feat(legami): lock, letture e guardia sul registro`.

## Task 15: proposta (servizio e persistenza della proposta) (Postgres)

**Files:**
- Create: `src/application/legami-movimento/proposta-legame.service.ts`, `legame-scrittura.ts` + spec + `.postgres.spec.ts`

**Interfaces:**
- Consumes: Task 11-14, `ImpostazioniFatturazioneService.leggi` (Task 5).
- Produces:
```ts
export interface InputProposta { causale: string; type: 'CARICO'|'SCARICO'; cerCode: string; movementDate: string; unit: string; quantity: string; firId?: string | null; producerSedeId?: string | null }
export interface PropostaVista { fatturabile: boolean; attiva: boolean; stato: StatoLegame; cliente: { id: string | null; fonte: 'FIR'|'UTENTE'|null }; contratto: { id: string | null; candidati: { id: string; numero: string; sedeId: string | null }[] }; elenco: { id: string | null; validi: { id: string; codice: string; descrizione: string }[] }; righe: RigaPropostaVista[]; alternativeRighe: RigaPropostaVista[]; motivi: MotivoLegame[]; avvisi: AvvisoLegame[] }
export class PropostaLegameService {
  calcola(tenantId: string, i: InputProposta, scelte?: { clienteId?: string; contrattoId?: string; elencoId?: string; righeIds?: string[] }): Promise<PropostaVista>   // sola lettura
}
// legame-scrittura.ts
export async function scriviProposta(tx: Prisma.TransactionClient, c: { tenantId: string; userId: string | null; registroId: string; verso: 'CARICO'|'SCARICO'; movimentoOriginaleId: string; movimentoVigenteId: string; dataMovimento: string; proposta: PropostaVista }): Promise<{ legameId: string }>   // INSERT testata + righe
```
`attiva` = `fatturazione_da` impostata e `dataMovimento ≥` quella data; se `!fatturabile || !attiva` la proposta ha `stato` `'ESCLUSO'` virtuale e nessuna scrittura.

- [ ] **Step 1: test (Postgres, scenari su `creaScenarioProposta`).** `fatturazione spenta (nessuna riga impostazione): attiva false, niente scritto`; `movimento prima di fatturazione_da: attiva false`; `causale non fatturabile: fatturabile false`; `FIR con produttore cliente + un contratto ATTIVO + un elenco + riga CER con riferimento null + una riga V proposta: stato PROPOSTO, 2 righe, fonte FIR`; `senza FIR: SENZA_CLIENTE, stato DA_COLLEGARE`; `scelte.clienteId dell'utente: fonte UTENTE`; `quantità: 6000 KG con riga PESO_NETTO KG: "6000"`; `unità non di massa con riga PESO_NETTO: SENZA_QUANTITA`; `riga a prezzo speciale: prezzo null e nessun SENZA_PREZZO`; `contratto di un altro cliente tra le scelte: 400`; `elenco di un altro contratto: 400`; `righe di un altro elenco: 400`; `contratto di un altro tenant: 404`; `scriviProposta crea una testata con movimento_originale_id = radice e righe con valori calcolati e congelata_il NULL`; `scriviProposta due volte per la stessa radice: la seconda restituisce il legame esistente (nessun errore sull'unico)`; `candidati con sede diversa: SEDE_SENZA_CONTRATTO`.
- [ ] **Step 2-4:** FAIL → implementa (nessuna scrittura fuori da `scriviProposta`; letture con `bloccaListinoInCondivisione` solo quando scrive) → PASS. **Step 5: commit** `feat(legami): servizio di proposta e scrittura della proposta`.

## Task 16: conferma, modifica, escludi e riammetti (Postgres)

**Files:**
- Create: `src/application/legami-movimento/conferma-legame.service.ts` + spec + `.postgres.spec.ts`

**Interfaces:**
- Consumes: Task 13-15.
- Produces:
```ts
export interface ModificheLegame { clienteId?: string; contrattoId?: string; elencoId?: string; righe?: { rigaAddebitoId: string; quantita?: string | null }[] }
export interface LegameVista { id: string; stato: StatoLegame; versione: number; movimentoOriginaleId: string; movimentoVigenteId: string; dataMovimento: string; cliente: {...} | null; contratto: {...} | null; elenco: {...} | null; righe: RigaLegameVista[]; motivi: MotivoLegame[]; avvisi: AvvisoLegame[]; motivoEsclusione: string | null; scostamentoDopoFattura: boolean; confermatoIl: string | null }
export class LegamiService {
  modifica(tenantId: string, utenteId: string, id: string, versione: number, m: ModificheLegame): Promise<LegameVista>      // → PROPOSTO o DA_COLLEGARE
  conferma(tenantId: string, utenteId: string, id: string, versione: number, m?: ModificheLegame): Promise<LegameVista>  // 409 LEGAME_INCOMPLETO { motivi }
  escludi(tenantId: string, utenteId: string, id: string, versione: number, motivo: string): Promise<LegameVista>
  riammetti(tenantId: string, utenteId: string, id: string, versione: number): Promise<LegameVista>     // → DA_COLLEGARE e ricalcolo
}
```
Ordine: `impostaTimeoutLock` → `bloccaLegamePerRadice` → rilettura testata e controllo `versione`/stato → `bloccaListinoInCondivisione` → ricontrollo di cliente (attivo), contratto (non eliminato, stato, date sulla **data del movimento**), elenco (validità), righe (esistono, dell'elenco) → ricalcolo quantità non `MANUALE` e valori → `bloccaRigheLegame` → scrittura. Cambiare contratto/elenco rigenera le righe. Audit in `activity_log` (id e importi, nessun dato personale).

- [ ] **Step 1: test (Postgres).** *Conferma:* `PROPOSTO completo: CONFERMATO, righe con congelata_il, prezzo/sconto/IVA copiati dal listino, motivi vuoti, confermato_da`; `riga a prezzo speciale: confermata con prezzo NULL`; `prezzo "0" esplicito sulla riga di listino: confermato`; `riga di listino senza prezzo e non speciale: 409 LEGAME_INCOMPLETO con SENZA_PREZZO, nulla scritto`; `modifiche + conferma in una richiesta`; `cambiare contratto rigenera le righe`; **Review 1:** `due conferme concorrenti con la stessa versione (barriera su pg_stat_activity): una 200, una 409 VERSIONE_SUPERATA o OPERAZIONE_CONCORRENTE; congelata_il scritto una volta; 1 sola riga per riga di listino`; `conferma ripetuta su legame già CONFERMATO con versione aggiornata: 200 idempotente senza cambiare congelata_il`; **Review 3:** `cliente disattivato dopo la proposta: 409 con SENZA_CLIENTE, legame invariato`; `contratto SOSPESO/ANNULLATO fra proposta e conferma: 409 CONTRATTO_NON_ATTIVO`; `contratto eliminato (eliminatoIl): 409 SENZA_CONTRATTO`; `elenco con validoAl prima della data del movimento: 409 ELENCO_SCADUTO`; `contratto che scade DOPO la data del movimento ma prima di oggi: confermato (si usa la data del movimento)`; **Review 5 (quantità):** `quantità manuale "0": 400`; `"-3": 400`; `"1,5": 400 (l'API vuole il punto)`; `"1.2345" (4 decimali): 400`; `"12.5": 200 con quantita_origine MANUALE`; `quantità MANUALE non sovrascritta dal ricalcolo alla conferma`; `legame FATTURATO / IMPORTATO_FATTURATO / ANNULLATO: modifica e conferma → 409`; `contratto/elenco di altro cliente o altro tenant: 400/404 e FK composta`; `viewer: il servizio non è raggiungibile (controller)`. *Escludi:* `motivo vuoto o solo spazi: 400`; `motivo di 201 caratteri: 400`; `escludi da CONFERMATO: ESCLUSO con motivo trim`; `escludi FATTURATO: 409`; `riammetti: DA_COLLEGARE e proposta ricalcolata`; `riammetti su non ESCLUSO: 409`. Audit di ogni azione.
- [ ] **Step 2-4:** FAIL → implementa → PASS (fine task backend). **Step 5: commit** `feat(legami): conferma, modifica, esclusione e riammissione del legame`.

## Task 17: «Aggiorna prezzi» (anteprima e conferma) (Postgres)

**Files:**
- Create: `src/application/legami-movimento/aggiorna-prezzi.service.ts` + spec + `.postgres.spec.ts`

**Interfaces:**
- Produces:
```ts
export interface PerimetroAggiornamento { contrattoId?: string; elencoId?: string; dal?: string; al?: string }   // almeno contrattoId o elencoId
export interface AnteprimaAggiornamento { cambiano: number; invariati: number; saltati: { motivo: 'FATTURATO'|'IMPORTATO_FATTURATO'|'ESCLUSO'|'ANNULLATO'|'PREZZO_SPECIALE'|'QUANTITA_MANUALE_NON_COINVOLTA'; n: number }[]; daCollegare: number; firma: string; esempi: { legameId: string; prima: string | null; dopo: string | null }[] }
export class AggiornaPrezziService {
  anteprima(tenantId: string, p: PerimetroAggiornamento): Promise<AnteprimaAggiornamento>
  applica(tenantId: string, utenteId: string, p: PerimetroAggiornamento, firma: string): Promise<{ aggiornati: number; saltati: number; daCollegare: number }>   // 409 ANTEPRIMA_SUPERATA se la firma non coincide
}
```
Una query set-based `UPDATE righe_legame_movimento r SET … FROM unnest($1::uuid[]) …` dopo `joinLineari(tx)`; stato riletto sotto lock (`bloccaRigheLegame`) subito prima di scrivere; riga di listino sparita o cambiata di famiglia → il legame passa a `DA_COLLEGARE` con `SENZA_RIGA_CER`/`SENZA_PREZZO` come da spec §7.4.5.

- [ ] **Step 1: test (Postgres).** `prezzo di listino da 10.000000 a 12.000000: anteprima cambiano 1, applica riscrive prezzo, sconto e IVA e aggiorna congelata_il`; `legami FATTURATO e IMPORTATO_FATTURATO: mai toccati, contati come saltati`; `ESCLUSO e ANNULLATO saltati`; `riga a prezzo speciale saltata`; `riga di listino eliminata: legame a DA_COLLEGARE col motivo`; `quantità MANUALE intatta`; `perimetro per periodo: solo data_movimento fra dal e al`; `anteprima vecchia dopo un cambio di listino: 409 ANTEPRIMA_SUPERATA, nessuna riga scritta`; **concorrenza:** `una transazione tiene FOR UPDATE le righe del legame e lo segna FATTURATO, poi commit; applica() (barriera su pg_stat_activity) rilegge e salta quel legame`; `aggiorna prezzi mentre il listino viene modificato (FOR UPDATE su riga): applica aspetta e poi legge il prezzo nuovo`; **scala:** `5000 legami con piano generico forzato (come Task 14): termina sotto 10 s, una sola UPDATE`; `ADMIN-only` è nel controller (Task 22).
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(legami): aggiorna prezzi con anteprima e conferma`.

## Task 18: lista «da collegare» (Postgres)

**Files:**
- Create: `src/application/legami-movimento/lista-legami.service.ts` + spec + `.postgres.spec.ts`

**Interfaces:**
- Produces:
```ts
export type StatoListaLegame = StatoLegame | 'MANCANTE' | 'DA_RIALLINEARE'
export interface FiltriLista { dal?: string; al?: string; clienteId?: string; registroId?: string; motivo?: MotivoLegame; stati?: StatoListaLegame[]; esclusi?: boolean; pagina?: number; perPagina?: number }  // perPagina ≤ 200
export interface RigaLista { movimentoId: string; legameId: string | null; stato: StatoListaLegame; dataMovimento: string; cer: string; quantita: string; unita: string; clienteNome: string | null; motivi: MotivoLegame[]; avvisi: AvvisoLegame[] }
export class ListaLegamiService { lista(tenantId: string, f: FiltriLista): Promise<{ righe: RigaLista[]; totale: number }>; contatori(tenantId: string): Promise<{ daCollegare: number }> }
```
Entrano: movimenti **vigenti** con causale fatturabile (catalogo risolto per data, raggruppato) e `movementDate ≥ fatturazione_da`, con legame `DA_COLLEGARE`/`PROPOSTO`, oppure senza legame (`MANCANTE`), oppure con `movimento_vigente_id` ≠ vigente (`DA_RIALLINEARE`). Senza `fatturazione_da`: lista vuota. `ESCLUSO` solo con `esclusi: true`.

- [ ] **Step 1: test (Postgres).** `fatturazione spenta: lista vuota, contatore 0`; `movimento storico dopo fatturazione_da senza legame: MANCANTE`; `prima della data: assente`; `causale non fatturabile: assente`; `legame CONFERMATO: assente`; `DA_COLLEGARE con motivi: presente con i motivi`; `catena rettificata con legame indietro: DA_RIALLINEARE`; `movimento importato: assente finché la fatturazione_da lo esclude`; `ESCLUSO: assente, presente con esclusi true`; `filtri cliente, periodo, registro, motivo`; `paginazione: perPagina 201 → 400; totale esatto`; `un altro tenant non compare`; `10.000 movimenti: lista in una query (nessun N+1, misurare il numero di query con $on('query') o con il log del client)`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(legami): lista dei movimenti da collegare`.

## Task 19: azioni di massa e generazione da movimento (Postgres)

**Files:**
- Create: `src/application/legami-movimento/azioni-massa.service.ts` + spec + `.postgres.spec.ts`

**Interfaces:**
- Produces:
```ts
export interface RichiestaAzioneMassa { azione: 'CONFERMA' | 'ESCLUDI'; movimentoIds: string[]; motivo?: string }   // 1..500
export interface EsitoAzioneMassa { riuscite: number; saltate: { movimentoId: string; motivo: string }[] }
export class AzioniMassaService {
  esegui(tenantId: string, utenteId: string, r: RichiestaAzioneMassa): Promise<EsitoAzioneMassa>
  daMovimento(tenantId: string, utenteId: string, movimentoId: string): Promise<LegameVista>   // genera la proposta per un MANCANTE o DA_RIALLINEARE
}
```
Una transazione per movimento (un fallimento non annulla gli altri), id ordinati, lock per radice in ordine di `id`; letture dei movimenti con `JOIN unnest` + `joinLineari`.

- [ ] **Step 1: test (Postgres).** `501 movimenti: 400`; `0 movimenti: 400`; `CONFERMA di 3 proposte complete e 1 incompleta: riuscite 3, saltate 1 con il motivo`; `ESCLUDI senza motivo: 400`; `ESCLUDI di 3: tutti ESCLUSO`; `id di un altro tenant: saltato come non trovato`; `daMovimento su MANCANTE: crea PROPOSTO o DA_COLLEGARE`; `daMovimento su DA_RIALLINEARE: allinea vigente e dati`; `daMovimento su movimento con legame già aggiornato: idempotente`; `due azioni di massa concorrenti sugli stessi movimenti: nessun deadlock (ordine per id), nessun doppio legame`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(legami): azioni di massa e generazione da movimento`.

## Task 20: aggancio alla registrazione con SAVEPOINT (registro, Postgres)

**Files:**
- Create: `src/application/legami-movimento/aggancio-registro.ts` + spec
- Modify: `src/application/registro/use-cases/registra-movimento.use-case.ts` (dopo il punto `abbinaSenzaFallire`, `:372-381`; `RegistraMovimentoCommand` + `legame?: DatiLegameRegistrazione`; esito con `avvisi`), `src/api/registro/dtos/registra-movimento.dto.ts` (campo facoltativo `legame`), `registro.controller.ts` solo per passare il campo
- Test: `registra-movimento.use-case.postgres.spec.ts`, `registra-movimento.use-case.spec.ts`, nuovo `aggancio-registro.postgres.spec.ts`

**Interfaces:**
- Produces:
```ts
export interface DatiLegameRegistrazione { azione: 'CONFERMA' | 'PROPOSTA'; clienteId?: string; contrattoId?: string; elencoId?: string; righe?: { rigaAddebitoId: string; quantita?: string | null }[] }
export async function agganciaLegameSenzaFallire(tx: Prisma.TransactionClient, c: { tenantId: string; userId: string | null; registroId: string; type: 'CARICO'|'SCARICO'; movimentoId: string; fatturabile: boolean; cerCode: string; movementDate: Date; unit: string; quantity: string; firId: string | null; legame?: DatiLegameRegistrazione }): Promise<string[]>   // avvisi per l'utente
```
Comportamento: se `!fatturabile` o fatturazione spenta/non attiva → `[]` senza savepoint. Altrimenti `SAVEPOINT legame`; legge `current_setting('lock_timeout')`, imposta `SET LOCAL lock_timeout = LOCK_TIMEOUT_AGGANCIO`; lock di radice + listino in condivisione; con `azione: 'CONFERMA'` e proposta completa scrive `CONFERMATO` nella stessa transazione, altrimenti `PROPOSTO`/`DA_COLLEGARE`; `RELEASE SAVEPOINT` e ripristino del timeout. In errore (anche SQL e 55P03): `ROLLBACK TO SAVEPOINT legame`, ripristino del timeout, `activity_log` `LEGAME_NON_RIUSCITO` (solo tipo e codice errore), `segnalaErroreJob('legameNuovoMovimento', erroreSicuro, { tenantId })`, avviso «Movimento registrato; il collegamento a cliente e prezzo non è riuscito: lo trovi in "Da collegare".» Modello: `abbinaSenzaFallire` (`registra-movimento.use-case.ts:503-545`).

- [ ] **Step 1: test.** *Unit:* `causale non fatturabile: nessuna query e nessun SAVEPOINT`; `fatturazione spenta: idem`. *Postgres:* `registrazione con causale INGRESSO_ESTERNO fatturabile e dati completi, azione PROPOSTA: movimento e legame PROPOSTO nella stessa transazione`; `azione CONFERMA con dati completi: legame CONFERMATO, righe congelate`; `senza blocco legame: proposta calcolata e salvata, mai confermata`; `CONFERMA con dati incompleti: movimento registrato, legame DA_COLLEGARE, avviso`; `causale non fatturabile: nessun legame`; `errore SQL forzato dentro il savepoint (es. riga di listino cancellata dopo la lettura con un trigger di test o una scrittura che viola un CHECK iniettata con jest.spyOn(scriviProposta) che lancia un errore SQL reale via tx.$executeRaw("SELECT 1/0")): movimento registrato, nessun legame, transazione NON in abort (la query successiva, l'audit, riesce), activity_log LEGAME_NON_RIUSCITO`; **55P03:** `riga di listino tenuta FOR UPDATE da un'altra sessione (barriera): la registrazione attende al massimo 2 s, poi ROLLBACK TO SAVEPOINT, il movimento resta registrato, il lock_timeout è tornato al valore precedente, la lista mostra il movimento come MANCANTE`; **concorrenza:** `due registrazioni in parallelo (stesso registro, stesso CER, stesso cliente) con Promise.all e barriera: due movimenti con progressivi distinti, due legami distinti, nessun 40P01`; `registrazione parallela a una modifica del listino: attende il FOR UPDATE, poi legge il prezzo nuovo`; **Review 2:** `ricopia del FIR registrata due volte (retry): secondo esito giaRegistrato true, un solo movimento, un solo legame, nessun errore`; `due richieste parallele sulla stessa ricopia: un solo movimento e un solo legame`; `scarico con abbinamento FIFO e legame insieme: i due savepoint (abbinamento, legame) non interferiscono`; `guardia: nessun UPDATE su waste_movements (guardia-registro.spec verde)`.
- [ ] **Step 2: run** FAIL. **Step 3: implementa** (il controller passa `legame` solo se presente; client esistenti senza il campo invariati: test `POST /registro` senza `legame` = risposta di prima). **Step 4:** PASS + suite registro intere (`registra-movimento.*`, `registro.controller.*`). **Step 5: commit** `feat(legami): aggancio del legame alla registrazione con savepoint`.

## Task 21: segue la correzione del movimento (registro, Postgres)

**Files:**
- Create: `src/application/legami-movimento/legami-correzioni.ts` + spec
- Modify: `src/application/registro/use-cases/correggi-movimento.use-case.ts` (dopo `riallineaDopoCorrezioneScarico`, `:300`, prima dei saldi), `src/api/registro/dtos/` (blocco `legame` facoltativo nella rettifica), `registro.controller.ts:221` per passarlo
- Test: `legami-correzioni.postgres.spec.ts`, `correggi-movimento.use-case.postgres.spec.ts`

**Interfaces:**
- Consumes: `esitoCorrezione` (Task 13), `bloccaLegamePerRadice` (stesso ordine: i lock del registro li ha già il caso d'uso).
- Produces:
```ts
export async function riallineaLegameDopoCorrezione(tx: Prisma.TransactionClient, c: { tenantId: string; userId: string | null; registroId: string; tipo: 'RETTIFICA' | 'ANNULLAMENTO'; radiceId: string; nuovoVigenteId: string; prima: { cerCode: string; movementDate: Date; fatturabile: boolean }; dopo: { cerCode: string; movementDate: Date; unit: string; quantity: string; fatturabile: boolean; firId: string | null }; legame?: DatiLegameRegistrazione }): Promise<string[]>   // avvisi; mai eccezioni verso il chiamante
```
Dentro `SAVEPOINT legame_correzione` con le stesse regole del Task 20 (timeout, audit, segnalazione). Il lock del legame è sulla **radice**.

- [ ] **Step 1: test (Postgres), una riga per caso di §7.5.** `rettifica di quantità, stesso CER, non fatturato: movimento_vigente_id nuovo, data_movimento aggiornata, quantità DA_MOVIMENTO ricalcolata, prezzo congelato invariato, stato invariato`; `quantità MANUALE resta e compare QUANTITA_MANUALE_NON_DERIVATA`; `rettifica che cambia il CER: torna PROPOSTO o DA_COLLEGARE con CAMBIO_CER_DA_CONFERMARE`; `causale diventa non fatturabile: ESCLUSO col testo fisso, righe conservate`; `da non fatturabile a fatturabile: il legame nasce`; `solo la data cambia e il contratto non è più valido: DA_COLLEGARE con CONTRATTO_NON_ATTIVO`; `annullamento non fatturato: ANNULLATO, righe conservate`; `rettifica con legame FATTURATO: stato, righe e prezzi identici; scostamento_dopo_fattura true, scostamento_il valorizzato, vigente aggiornato, avviso AVVISO_SCOSTAMENTO; il registro si corregge`; `idem IMPORTATO_FATTURATO`; `annullo con legame FATTURATO: stesso scostamento`; **Review 4:** `rettifica, poi seconda rettifica, poi annullo: un solo legame per radice, movimento_vigente_id = l'ultima testa a ogni passo, data_movimento ricalcolata`; `rettifica che porta la data da prima a dopo fatturazione_da: il legame nasce`; `da dopo a prima: ESCLUSO col testo fisso`; `savepoint fallito (errore SQL iniettato): la correzione resta valida, il legame resta indietro, la lista lo mostra DA_RIALLINEARE, audit e segnalazione`; **concorrenza:** `rettifica concorrente a una conferma dello stesso legame (barriera): si serializzano sul lock di radice, esito coerente (conferma poi riallineamento, oppure riallineamento poi conferma con ricalcolo)`; `rettifica di un movimento senza legame (storico): nessun errore, nessun legame se fatturazione spenta`; `guardia-registro verde`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (+ intera suite `correggi-movimento.*`, abbinamenti). **Step 5: commit** `feat(legami): il legame segue rettifiche e annulli del movimento`.

## Task 22: API dei legami (controller, DTO, ruoli) — backend, senza Postgres

**Files:**
- Create: `src/api/legami-movimento/legami-movimento.controller.ts` (`@Controller('legami-movimento')`), `movimento-legame.controller.ts` (`@Controller('registro/movimenti')`, rotta `GET :id/legame`), `dto/{proposta,modifica-legame,conferma,escludi,azione-massa,aggiorna-prezzi,lista-legami}.dto.ts`, spec `*.controller.spec.ts` + `legami-movimento.controller.http.spec.ts`
- Modify: `legami-movimento.module.ts` (provider e controller), `src/api/legami-movimento/ruoli.ts` (riesporta quelli del listino)

**Interfaces:** rotte e ruoli di spec §8.1/§9:
`POST proposta` (lettura), `GET /legami-movimento` (lettura), `GET :id` (lettura), `GET /registro/movimenti/:id/legame` (lettura; 404 se non c'è), `PUT :id` (scrittura, body `{ versione, ...ModificheLegame }`), `POST :id/conferma` (scrittura, `{ versione, modifiche? }`), `POST :id/escludi` (`{ versione, motivo }`), `POST :id/riammetti`, `POST azioni`, `POST aggiorna-prezzi` (`RUOLI_VARIAZIONI`, corpo `{ perimetro, firma? }`: senza `firma` = anteprima), `POST da-movimento/:movimentoId` (scrittura).

- [ ] **Step 1: test.** `ogni rotta ha @Roles esplicito` (verifica per riflessione su tutte le rotte dei due controller); `VIEWER: 403 su tutte le rotte di scrittura, 200 sulle letture`; `OPERATOR: 403 su aggiorna-prezzi`; `ADMIN e SUPER_ADMIN: 200`; `id non UUID: 400`; `ValidationPipe: quantita come numero JSON (non stringa): 400`; `array righe oltre 100: 400`; `azioni con 501 id: 400`; `tenant dal request, mai dal corpo`; `controller-tenant-selezionato.spec.ts e nessun-user-userid.spec.ts verdi`; `risposta di errore LEGAME_INCOMPLETO porta motivi con i messaggi`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (HTTP spec con servizi finti). **Step 5: commit** `feat(legami): API del legame movimento`.

## Task 23: e2e 4.3b via API (Playwright, Postgres)

**Files:**
- Create: `e2e/tests/legami/legami-api.spec.ts`

- [ ] **Step 1: scenario** (dati via API in `beforeAll`: cliente con P.IVA valida, contratto ATTIVO, elenco, riga CER 15 01 01 con prezzo 10 e riga V proposta, causale `INGRESSO_ESTERNO`, `fatturazione_da` oggi-30; pulizia per id esatti): `proposta in sola lettura non scrive`; `registrazione con azione CONFERMA: legame CONFERMATO con prezzi`; `registrazione senza blocco legame: PROPOSTO`; `registrazione con listino incompleto: movimento registrato, DA_COLLEGARE, in lista`; `modifica del prezzo di listino non cambia il legame confermato; aggiorna-prezzi (anteprima, poi conferma con firma) lo cambia`; `rettifica che cambia CER → PROPOSTO con avviso`; `annullo → ANNULLATO`; `escludi con motivo, riammetti`; `azioni di massa`; `VIEWER 403 sulle scritture, OPERATOR 403 su aggiorna-prezzi`; `eliminare la riga di listino usata: 409 RIGA_ADDEBITO_IN_USO`.
- [ ] **Step 2: verifica completa** sotto `flock`: `test:cov`, `tsc`, eslint, tutte le suite Postgres dei Task 14-21 + `rls-catalogo` (67) + suite registro e listino; confronto con la linea di base.
- [ ] **Step 3: commit** `test(legami): e2e API del legame movimento e chiusura 4.3b`.

## Task 24: revisione dell'intero branch — 4.3b

**File:** nessuno.

- [ ] **Step 1:** revisore opus fresco (`typescript-nestjs-reviewer`) sul diff della 4.3b con questi controlli espliciti: ordine dei lock identico in tutti i servizi (grep di `FOR UPDATE`/`FOR SHARE` nel modulo), nessuna scrittura su `waste_movements`, ogni scrittura del legame dentro SAVEPOINT nei due agganci, `lock_timeout` ripristinato dopo il savepoint, nessun ciclo di UPDATE singoli, `joinLineari` prima di ogni `JOIN unnest`, `FATTURATO` mai riscritto, audit senza dati personali, i cinque punti di Review Focus con il loro test. Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto `4-3b-report.md`; PR 4.3b, merge, deploy (nessuna migration).

---

# Pezzo 4.3c — interfaccia

Da master dopo il merge della 4.3b.

## Task 25: frontend — modelli, servizio, vocabolario e permessi

**Files:**
- Modify: `fe/features/legami/legami.model.ts` (aggiunge tutti i tipi di §8.1: `PropostaLegame`, `LegameVista`, `RigaLista`, `AnteprimaAggiornamento`, `FiltriLista`…)
- Create: `fe/features/legami/legami.service.ts` + spec, `vocabolario-legami.ts` + spec (etichette italiane di stati, motivi, avvisi), `permessi-legami.ts` + spec

**Interfaces:**
- Produces: `LegamiService` con un metodo per rotta (`proposta`, `lista`, `contatori`, `dettaglio`, `perMovimento`, `modifica`, `conferma`, `escludi`, `riammetti`, `azioni`, `anteprimaAggiornamento`, `applicaAggiornamento`, `daMovimento`); `etichettaStato(s)`, `etichettaMotivo(m)`, `severitaStato(s): 'success'|'info'|'warn'|'danger'|'secondary'`; `permessiLegami(ruolo): { scrive: boolean; aggiornaPrezzi: boolean; impostaFatturazione: boolean }`.

- [ ] **Step 1: test.** un test per metodo con `HttpTestingController` (URL, metodo, corpo con numeri come stringhe col punto); vocabolario: `ogni stato, motivo e avviso ha etichetta`; permessi: `VIEWER false/false/false`, `OPERATOR true/false/false`, `ADMIN true/true/true`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS. **Step 5: commit** `feat(legami): servizio, modelli e vocabolario frontend`.

## Task 26: frontend — blocco «Fatturazione» nella registrazione

**Files:**
- Create: `fe/features/legami/blocco-fatturazione.component.ts` + `.spec.ts` + `.dom.spec.ts`, `fe/features/legami/righe-legame-tabella.component.ts`
- Modify: `fe/features/registro/registro.component.ts` (form di registrazione; spec `registro.component.causali.spec.ts` estesa)

**Interfaces:**
- Produces: `<app-blocco-fatturazione [datiMovimento]="…" [(scelta)]="scelta">` con `@Output() legameChange: EventEmitter<DatiLegameRegistrazione | null>`; usato da Task 27.
- Regole UI: visibile solo con causale `fatturabile` e fatturazione attiva; chiama `proposta` (con debounce sui campi causale, CER, data, unità, quantità, FIR) ; mostra cliente (badge «da FIR»), contratto, elenco (menu con i candidati), righe con quantità e prezzo, avvisi; pulsanti «Conferma legame» e «Registra senza collegare»; la quantità manuale è un campo con `appNumeroIt`.

- [ ] **Step 1: test.** `causale non fatturabile: blocco nascosto`; `fatturazione spenta: nascosto`; `proposta completa: mostra cliente con «da FIR», contratto, elenco, 2 righe con prezzi`; `CONTRATTO_AMBIGUO: mostra il menu dei candidati e il pulsante Conferma disabilitato finché non se ne sceglie uno`; `«Conferma legame»: la registrazione parte con legame.azione CONFERMA`; `«Registra senza collegare»: parte con azione PROPOSTA`; `quantità manuale "1,5" accettata e inviata come "1.5"; "1.5" mostra «Usa la virgola per i decimali» e blocca il pulsante`; `nessun separatore delle migliaia nel campo modificabile`; `errore della proposta (500): il blocco mostra l'avviso e la registrazione resta possibile`; `viewer: blocco non mostrato`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS. **Step 5: commit** `feat(legami): blocco Fatturazione nella registrazione`.

## Task 27: frontend — rettifica e dettaglio del movimento

**Files:**
- Modify: `fe/features/registro/correggi-movimento-dialog.component.ts` (+ `.dom.spec.ts`), `fe/features/registro/registro.component.ts` (riquadro del legame nel dettaglio)
- Create: `fe/features/legami/riquadro-legame.component.ts` + spec

**Interfaces:** Consumes Task 25-26. `<app-riquadro-legame [movimentoId]>` carica `perMovimento` e mostra stato, valori congelati, importi calcolati con `importoRiga` lato server (campo di vista), avviso `scostamentoDopoFattura`.

- [ ] **Step 1: test.** `rettifica con CER cambiato: avviso «serve una nuova conferma» e blocco rivalutato`; `riquadro CONFERMATO: mostra prezzo, sconto, IVA, quantità`; `riquadro FATTURATO con scostamento: mostra l'avviso AVVISO_SCOSTAMENTO`; `movimento senza legame: riquadro nascosto (404 gestito)`; `annullamento di un movimento fatturato: il dialog mostra l'avviso e consente comunque di procedere` (O1: non si blocca).
- [ ] **Step 2-4** come sopra. **Step 5: commit** `feat(legami): rettifica e dettaglio del movimento col legame`.

## Task 28: frontend — pagina «Da collegare»

**Files:**
- Create: `fe/features/legami/da-collegare.component.ts` + `.spec.ts` + `.dom.spec.ts`, `fe/features/legami/legame-dialog.component.ts` + spec
- Modify: `fe/app.routes.ts` (`legami/da-collegare`), `fe/shared/components/layout.component.ts` (voce di menu con contatore)

**Interfaces:** pagina `pagina-lavoro`: tabella paginata con filtri (periodo, cliente, registro, motivo, «Esclusi»), badge per stato (`severitaStato`) e motivo, selezione multipla, azioni «Conferma» / «Escludi» (motivo obbligatorio) di massa con tetto 500 mostrato in UI, apertura del `legame-dialog` per modifica e conferma singola; un `MANCANTE` o `DA_RIALLINEARE` chiama `daMovimento` all'apertura.

- [ ] **Step 1: test.** `lista vuota con fatturazione spenta: messaggio «Fatturazione non attiva»`; `badge e motivi per riga`; `selezione di 501 righe: azione di massa disabilitata con il messaggio del tetto`; `escludi senza motivo: pulsante disabilitato`; `esito di massa: «3 confermati, 1 saltato» con i motivi`; `409 OPERAZIONE_CONCORRENTE: messaggio «riprova»`; `VIEWER: nessuna azione`; `riammetti dal filtro Esclusi`; `contatore del menu`.
- [ ] **Step 2-4** come sopra. **Step 5: commit** `feat(legami): pagina Da collegare con azioni di massa`.

## Task 29: frontend — finestra «Aggiorna prezzi»

**Files:**
- Create: `fe/features/legami/aggiorna-prezzi-dialog.component.ts` + spec
- Modify: `fe/features/legami/da-collegare.component.ts` (pulsante, solo ADMIN)

- [ ] **Step 1: test.** `solo ADMIN/SUPER_ADMIN vede il pulsante`; `anteprima: «12 cambiano, 3 saltati (2 fatturati, 1 prezzo speciale), 1 passa a Da collegare» e tabella di esempi`; `senza conferma esplicita (checkbox) il pulsante Applica è disabilitato`; `applica invia la firma dell'anteprima`; `409 ANTEPRIMA_SUPERATA: ricarica l'anteprima con messaggio`; perimetro per contratto o elenco obbligatorio.
- [ ] **Step 2-4** come sopra. **Step 5: commit** `feat(legami): finestra Aggiorna prezzi`.

## Task 30: frontend — listino «in uso» e contatore nei clienti

**Files:**
- Modify: `fe/features/listino/listino-contratto.component.ts`, `elenchi-pannello.component.ts` (+ spec), `fe/features/listino/listino.model.ts` (`eliminabile`), `fe/features/contratti-cliente/contratti-cliente-list.component.ts` (contatore «da collegare» per cliente/contratto)

- [ ] **Step 1: test.** `riga o elenco con eliminabile false: pulsante Elimina disabilitato con tooltip «in uso»; restano Disattiva / Chiudi validità`; `409 RIGA_ADDEBITO_IN_USO / ELENCO_ADDEBITI_IN_USO mostra il messaggio del backend`; `contatore nella lista contratti`.
- [ ] **Step 2-4** come sopra. **Step 5: commit** `feat(listino): elimina disattivato per righe ed elenchi usati dai legami`.

## Task 31: e2e 4.3c (Playwright, UI)

**Files:**
- Create: `e2e/tests/legami/legami-ui.spec.ts`, `e2e/pages/legami.page.ts`

- [ ] **Step 1: scenari** (dati via API come nel Task 23): registrazione con proposta e conferma dal form; registrazione «senza collegare» e poi conferma dalla lista «Da collegare»; rettifica che cambia CER (avviso, nuova conferma); annullo (stato ANNULLATO nel riquadro); «Aggiorna prezzi» con anteprima e applica (ADMIN); `OPERATOR` senza il pulsante; quantità manuale con la virgola e rifiuto del punto; riga di listino usata con Elimina disattivato. Selettori `data-testid`, attese da `e2e/utils/attese`.
- [ ] **Step 2: verifica completa:** Karma una volta, `npm run build`, eslint dei file toccati; backend `test:cov` per sicurezza sulle rotte non cambiate.
- [ ] **Step 3: commit** `test(legami): e2e dell'interfaccia del legame movimento`.

## Task 32: revisione dell'intero branch — 4.3c

**File:** nessuno.

- [ ] **Step 1:** revisori in parallelo: `typescript-nestjs-reviewer` (Angular: standalone, unsubscribe, tipi) e `ux-ui-mobile-specialist` (screenshot di blocco, lista e finestra; accessibilità, focus nei dialog, contrasto dei badge). Controlli espliciti: nessun campo numerico modificabile senza `appNumeroIt`, nessun separatore delle migliaia nei campi modificabili, classe `pagina-lavoro` sulle pagine nuove, ruoli coerenti con il backend, nessuna stringa con id o dati personali. Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto `4-3c-report.md`; PR 4.3c, merge, deploy. Aggiornare `STATUS.md` e `COSTS.md`.

---

## Ondate

Regola: **al massimo un task Postgres per ondata**; i processi pesanti di tutti i task passano dal `flock`, quindi in ondata si lavora in parallelo sulla scrittura del codice (un worktree per task: `git worktree add ../rifiuti-wt-43-<task> -b wt/43-<task> <HEAD>`, `node_modules` copiati con `cp -a --reflink=auto`, `prisma generate` solo nel worktree backend) e si serializzano le esecuzioni. Integrazione a fine ondata con `git cherry-pick` backend → frontend, poi revisione opus dell'ondata. Mai Karma e jest insieme.

**File condivisi:** `schema.prisma`, `prisma-rls.extension.ts`, `rls-catalogo…`, `README-tenant-transazione.md`, `ops/README.md`, `app.module.ts` → solo Task 3 (e 5 per `app.module.ts`); `legami-movimento.module.ts` → 5, 22; `legami-di-test.ts` → 3, 14; `registra-movimento.use-case.ts` e `registra-movimento.dto.ts` → solo 20; `correggi-movimento.use-case.ts` → solo 21; `registro.controller.ts` → 20, 21 (ondate diverse); `fe/features/legami/legami.model.ts` → 7, 25; `da-collegare.component.ts` → 28, 29; `registro.component.ts` → 26, 27; `app.routes.ts` e `layout.component.ts` → 7, 28.

| Pezzo | Ondata | Task in parallelo | Tipo | Perché insieme |
|---|---|---|---|---|
| 4.3a | 0 | **0** | PG (verifica) | linea di base |
| 4.3a | 1 | **1** ∥ **2** | backend puro ∥ backend puro | file disgiunti, nessun database |
| 4.3a | 2 | **3** ∥ **7** | **PG (migration)** ∥ frontend | 7 si scrive dalle interfacce del Task 5 |
| 4.3a | 3 | **4** ∥ **8** | **PG** ∥ frontend | 8 dalle interfacce del Task 4 |
| 4.3a | 4 | **5** | **PG** | crea il modulo |
| 4.3a | 5 | **6** | **PG** | dopo il 3 (usa le FK) |
| 4.3a | 6 | **9** | e2e + PG | tutto integrato |
| 4.3a | 7 | **10** | revisione | |
| 4.3b | 1 | **11** ∥ **12** ∥ **13** | backend puro ×3 | solo `src/domain/legami-movimento/`, file propri |
| 4.3b | 2 | **14** | **PG pesante** (concorrenza, 5000 id) | lock e letture che servono a tutto |
| 4.3b | 3 | **15** | **PG** | dopo il 14 |
| 4.3b | 4 | **16** | **PG** | dopo il 15 |
| 4.3b | 5 | **17** | **PG** | usa i lock del 14 e le fixture |
| 4.3b | 6 | **18** | **PG** | lista |
| 4.3b | 7 | **19** | **PG** | usa 16 e 18 |
| 4.3b | 8 | **20** ∥ **22** | **PG** (registro) ∥ backend (controller con servizi finti) | 22 dipende solo dalle firme dei Task 15-19 |
| 4.3b | 9 | **21** | **PG** (registro) | stesso use-case family, dopo il 20 per `DatiLegameRegistrazione` |
| 4.3b | 10 | **23** | e2e + PG | integrato |
| 4.3b | 11 | **24** | revisione | |
| 4.3c | 1 | **25** | frontend | modelli e servizio |
| 4.3c | 2 | **26** ∥ **28** | frontend ∥ frontend | file disgiunti (`registro.component.ts` vs pagina nuova) |
| 4.3c | 3 | **27** ∥ **29** ∥ **30** | frontend ×3 | 27 dopo 26, 29 dopo 28, 30 file propri |
| 4.3c | 4 | **31** | e2e | |
| 4.3c | 5 | **32** | revisione | |

Conteggio: **4.3a 10 task** (Task 1-10, Task 0 a parte), **4.3b 14 task** (11-24), **4.3c 8 task** (25-32); 33 task con la linea di base. Task Postgres pesanti: 3, 14, 20, 21 (migration o concorrenza con barriere).

## Copertura della spec

Decisioni 1-15 → Task 11 (1, 10, 12), 13 (2, 5, 9), 15 (3), 1+3+4 (4, 14, 15), 16 (13), 5 (11); decisione 7 (data del movimento) → Task 13, 15, 21; decisione 8 → Task 3 e 6. O1 → Task 13, 21, 27; O3 → Task 13, 21; O4 → Task 16; O6 → Task 3 (CHECK) e 13; O7 → Task 13 e 16 (dominio, non CHECK); O8 → Task 3, 5. §5.4-5.6 → Task 14, 17, 19. §7.3 → Task 18. §7.6 (contratto dati con la 4.4) → indici del Task 3 e colonne stabili (nessun task di codice: la 4.4 legge, la 4.3 non scrive). §12.7 (piano degli indici con volumi realistici) → Task 18 (test da 10.000 movimenti) e 17 (5000 legami); §12.8 → Task 20; §12.9 → Task 14; §12.3-12.4 (elenchi di contratti figli) → verifica nel Task 14 `leggiDatiPerProposta`: seguire la stessa regola degli elenchi del listino (`elenchi-addebiti.service.ts:206`), con test `contratto allegato: gli elenchi sono quelli del principale se il listino così li espone`.

## Self-review (eseguita)

- **Spec coverage:** ogni sezione ha un task (tabella sopra). Punti non tradotti in task: vedi risposta finale.
- **Type consistency:** `DatiLegameRegistrazione` (Task 20) riusato in 21; `LegameVista` (16) riusato in 19 e 25; `PropostaVista` (15) in 20/21/26; `StatoLegame`/`MotivoLegame` (2) ovunque; `ModificheLegame` (16) in 22.
- **Proportion:** piano ~1,5 volte la spec; nessun corpo di funzione, solo firme, nomi di test e valori.
