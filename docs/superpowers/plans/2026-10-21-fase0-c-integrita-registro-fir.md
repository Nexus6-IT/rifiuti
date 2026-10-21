# Fase 0, piano C: integrità di registro e FIR (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** il registro non va mai sotto zero, nemmeno con due scarichi concorrenti o retrodatati e con unità miste; il numero FIR è unico e progressivo per tenant e anno di emissione anche sotto concorrenza; stato del FIR e firme si salvano insieme o per niente; un FIR si ricopia nel registro al massimo una volta per tipo di movimento.

**Architettura:** il controllo di giacenza entra nella transazione di `RegistraMovimentoUseCase`, dopo un advisory lock per tenant e CER, e diventa una query SQL che calcola il saldo progressivo per data del movimento nella stessa famiglia di unità (kg e t insieme, le altre unità separate). La numerazione FIR si sposta in un nuovo metodo del repository, `emettiConNumerazione`, che in un'unica transaction prende un advisory lock per tenant e anno, ricontrolla lo stato in database, calcola `MAX()+1` numerico sul prefisso `FIR-<anno>-` e salva FIR e firme. `save` diventa atomico. L'unicità della ricopia FIR → registro è garantita da un indice unico `(tenant_id, fir_id, type)` più un controllo idempotente dentro la transaction.

**Tech Stack:** NestJS 10, Prisma 5.8, PostgreSQL 16, Jest 29 + ts-jest (backend), Angular 17 + Karma (frontend, solo Task 5).

**Spec:**
- `C:\Progetti\winwaste\docs\confronto-con-rifiuti.md` §4 punti 3, 4, 5 e §7 Fase 0
- `C:\Progetti\winwaste\docs\confronto-rifiuti\01-registro-fir-giacenze.md`: G1, G7, F3, F9 (§1), §3.1 punti 7-8, D2b, D17, D20, D21 (§4), raccomandazioni 1, 2 e 8 (§6)
- Piano parallelo da non sovrapporre: `docs/superpowers/plans/2026-10-21-fase0-a-mud.md` (il MUD blocca il FIR ricopiato due volte come controllo di export; qui si corregge la causa).

## Decisioni per Graziano

Da confermare prima dell'esecuzione. Il piano è scritto con l'opzione indicata come predefinita.

1. **Quantità della ricopia FIR → registro (NON implementata).** Oggi il form del registro precompila la quantità **dichiarata** del FIR (`registro.component.ts:1266-1275`, `quantity: r.quantita`), non il peso verificato a destino (`effectiveWeight`). Opzioni: (a) usare il peso a destino quando il FIR è `CONSEGNATO`, la quantità dichiarata altrimenti; (b) lasciare la dichiarata e mostrare il peso a destino come suggerimento. Dipende anche dalla revisione della regola ±10% (`fir.aggregate.ts:552`), fuori ambito. Consiglio: (a), ma dopo la decisione sul ±10%.
2. **Ricopia ripetuta dello stesso FIR.** Predefinito: se arriva una seconda richiesta con lo stesso `firId` e tipo e **gli stessi dati** (CER, quantità, unità, data), si restituisce il movimento esistente con `giaRegistrato: true` (retry dopo un timeout); se i dati differiscono, errore `Il FIR è già registrato nel movimento n. N/AAAA`. Alternativa: errore sempre.
3. **Movimenti doppi già presenti.** La migration del Task 4 si ferma con un messaggio se nel database esistono già due movimenti con lo stesso `(tenant_id, fir_id, type)`. Il VPS è di sviluppo (CLAUDE.md globale), ma prima del deploy va eseguita la query di controllo del Task 4, Step 6, e i doppi vanno risolti a mano (quale tenere è una scelta sui dati, non automatizzabile).
4. **Unità di misura.** Predefinito: `KG`/`KILOGRAMMI` ×1 e `T`/`TON`/`TONNELLATE` ×1000 formano la famiglia "kg"; ogni altra unità (`LITRI`, `M3`, …) è una famiglia a sé, confrontata solo con se stessa e senza conversioni. Uno scarico in litri su carichi in kg risulta quindi senza giacenza. Stessa scelta del piano MUD (decisione 6), con la differenza che qui i litri non bloccano: hanno solo una giacenza propria.
5. **Firma senza `userId`.** Oggi `persistSignatures` la salta con un warning e il FIR passa comunque di stato (`fir-prisma.repository.ts:297-303`). Con il salvataggio atomico il piano la rende **bloccante** (`FirmaSenzaUtenteError`, nessuna scrittura). Nel flusso reale non accade (gli use case valorizzano sempre `userId`); se si preferisce il comportamento attuale, il Task 6 Step 1 perde un test e `persistSignatures` resta tollerante.
6. **Anno del numero FIR.** Predefinito: anno solare **italiano** dell'istante di emissione (`annoSolareItaliano`), indipendente dal fuso del processo, che quasi certamente gira in UTC. Il progressivo del **registro** usa ancora `registrationDate.getFullYear()` nel fuso del processo (`registra-movimento.use-case.ts:129`): resta così, è materia della Fase 1 (fuso orario). Quando arriva il piano MUD, `annoSolareItaliano` e `limitiAnnoMud` andrebbero riunite in un solo modulo.

## Global Constraints

- **TDD obbligatorio** (regola di progetto): prima il test, poi guardarlo fallire.
- **Memoria della macchina:** mai la suite intera. Unitari: `cd apps/backend && npx jest --runInBand <percorso spec>`. Postgres reale: `cd apps/backend && npm run test:postgres -- <pattern>`, con `DATABASE_URL` verso un Postgres 16 con migration applicate (`npx prisma migrate deploy`). Per averne uno locale come in CI: `docker run -d --rm --name wasteflow-pg-test -p 55432:5432 -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci postgres:16-alpine` e `DATABASE_URL=postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public`. Frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=<percorso spec>`.
- **I file `*.postgres.spec.ts` girano solo nel job CI «Test integrazione Postgres»** (`.gitea/workflows/ci.yml:283-284`), non nel gate unitario (`jest.config.js`). I test di concorrenza stanno lì: un mock non prende lock.
- **Lingua:** commenti, messaggi ed errori in italiano; identificatori come il codice attorno. I termini tecnici non si traducono.
- **Stile:** prettier di `.prettierrc` (`semi: false`, `singleQuote: true`).
- **Isolamento:** ogni query porta `tenant_id`/`tenantId` nel `where`.
- **SQL solo parametrizzato:** `$queryRaw`/`$executeRaw` con template, mai `$queryRawUnsafe`.
- **Ordine dei lock in `RegistraMovimentoUseCase`** (sempre questo, per non creare deadlock): 1) `fir-registro|<tenantId>|<firId>` se c'è un FIR; 2) `<tenantId>-<anno>` (chiave esistente, invariata); 3) `giacenza|<tenantId>|<CER senza asterisco>` se è uno SCARICO. Tutti `pg_advisory_xact_lock(hashtext(...))`.
- **Commit:** `fix(registro): …` / `fix(fir): …` / `test(…): …` in italiano, **senza righe `Co-Authored-By` né altre attribuzioni**.
- **Fuori ambito:** la regola ±10% sul peso a destino (`fir.aggregate.ts:552`), giacenze iniziali, unità locale, rettifiche, il fuso orario del registro, l'età del deposito temporaneo (`giacenze.service.ts:50-54`).

## Review Focus

1. **Due SCARICO concorrenti sullo stesso CER per tutta la giacenza residua** (carico 100 kg, cinque scarichi da 100 kg in `Promise.all`): attesi un solo successo, quattro `Giacenza insufficiente`, saldo finale 0. Test: Task 3, `cinque scarichi concorrenti dell'intera giacenza: ne passa uno solo`.
2. **SCARICO retrodatato prima dell'unico CARICO** (carico del 10/03, scarico del 05/03): atteso il rifiuto, anche se il carico copre la quantità. E uno scarico del 02/03 su carico 01/03 con un altro scarico già registrato al 03/03 che consuma tutto: rifiutato, perché porterebbe sotto zero il saldo del 03/03. Test: Task 2, `non consuma carichi successivi alla data dello scarico` e `non rompe il saldo di uno scarico successivo già registrato`.
3. **kg e t sullo stesso CER** (carico 1 `T`, scarico 600 `KG`, poi scarico 0,5 `t`): il primo passa (residuo 400 kg), il secondo è rifiutato con `disponibili 0.4 t`. Una giacenza in `LITRI` non copre uno scarico in kg. Test: Task 2, `somma kg e tonnellate, tiene separati i litri`; Task 3, `il messaggio riporta la giacenza nell'unità dello scarico`.
4. **Bozza FIR creata il 31/12 ed emessa il 2/1** (bozza A `createdAt` 2026-12-31 emessa come `FIR-2027-000001`, poi bozza B creata nel 2027): B deve prendere `FIR-2027-000002`, non fallire per vincolo unico. Test: Task 7, `una bozza creata a dicembre ed emessa a gennaio conta nel progressivo dell'anno di emissione`.
5. **Due emissioni nello stesso millisecondo** (due bozze dello stesso tenant in `Promise.all`; e la stessa bozza emessa due volte in `Promise.all`): nel primo caso `000001` e `000002`, entrambe riuscite; nel secondo una sola emissione, l'altra `FirNonPiuInBozzaError`, una sola riga in `fir_signatures`. Test: Task 7, `due emissioni concorrenti di bozze diverse prendono numeri consecutivi senza errori` e `la stessa bozza emessa due volte in parallelo: una sola emissione`.
6. **Ricopia nel registro ripetuta dopo un timeout** (stesso comando con `firId` inviato due volte, anche in parallelo): un solo movimento, la seconda risposta restituisce lo stesso `id` con `giaRegistrato: true`, il progressivo non avanza. Con quantità diversa: errore `già registrato`. Test: Task 4, `la stessa ricopia ripetuta restituisce il movimento esistente` e `due ricopie concorrenti dello stesso FIR producono un solo movimento`.

---

## File Structure

| File | Responsabilità |
|---|---|
| `apps/backend/src/domain/waste-movement/unita-misura-registro.ts` (nuovo) | Normalizzazione dell'unità: famiglia e fattore verso l'unità base |
| `apps/backend/src/application/registro/giacenza-disponibile.ts` (nuovo) | Query SQL della giacenza disponibile a una data, dentro una transaction |
| `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts` (modifica) | Lock, controllo di giacenza e ricopia idempotente dentro la transaction |
| `apps/backend/prisma/schema.prisma` + nuova migration (modifica) | `@@unique([tenantId, firId, type])` su `WasteMovement` |
| `apps/backend/src/application/giacenze/giacenze.service.ts` (modifica) + frontend `features/giacenze/*` | Giacenze UI in kg veri, altre unità a parte |
| `apps/backend/src/domain/fir/numero-fir.ts` (nuovo) | Anno italiano e formato del numero FIR |
| `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts` (modifica) | `save` atomico, `emettiConNumerazione` |
| `apps/backend/src/domain/fir/repositories/fir-repository.interface.ts` (modifica) | `emettiConNumerazione` al posto di `generateNumeroProgressivo` |
| `apps/backend/src/core/domain/errors.ts` (modifica) | `FirNonPiuInBozzaError`, `FirmaSenzaUtenteError`, `FirGiaRegistratoError` |
| `apps/backend/src/application/fir/use-cases/emetti-fir.use-case.ts` (modifica) | Emissione tramite il nuovo metodo, errori di dominio come `Result.fail` |

---

### Task 1: unità di misura del registro

**Files:**
- Create: `apps/backend/src/domain/waste-movement/unita-misura-registro.ts`
- Test: `apps/backend/src/domain/waste-movement/unita-misura-registro.spec.ts`

**Interfaces:**
- Produces:
  - `export const ALIAS_KG: readonly string[] = ['KG', 'KILOGRAMMI']`
  - `export const ALIAS_T: readonly string[] = ['T', 'TON', 'TONNELLATE']`
  - `export interface UnitaNormalizzata { famiglia: string; fattore: number }` (`famiglia` = `'KG'` per massa, altrimenti l'unità maiuscola senza spazi; `fattore` verso l'unità base della famiglia)
  - `export function normalizzaUnitaRegistro(unit: string | null | undefined): UnitaNormalizzata`

- [ ] **Step 1: scrivere il test che fallisce**

```ts
describe('normalizzaUnitaRegistro', () => {
  it('kg e tonnellate sono la stessa famiglia, maiuscole e spazi ignorati', () => {
    expect(normalizzaUnitaRegistro('KG')).toEqual({ famiglia: 'KG', fattore: 1 })
    expect(normalizzaUnitaRegistro(' kg ')).toEqual({ famiglia: 'KG', fattore: 1 })
    expect(normalizzaUnitaRegistro('t')).toEqual({ famiglia: 'KG', fattore: 1000 })
    expect(normalizzaUnitaRegistro('Tonnellate')).toEqual({ famiglia: 'KG', fattore: 1000 })
  })
  it('unità vuota = KG (default dello schema e del DTO)', () => {
    for (const u of ['', null, undefined]) {
      expect(normalizzaUnitaRegistro(u as any)).toEqual({ famiglia: 'KG', fattore: 1 })
    }
  })
  it('le altre unità sono famiglie a sé, senza conversione', () => {
    expect(normalizzaUnitaRegistro('litri')).toEqual({ famiglia: 'LITRI', fattore: 1 })
    expect(normalizzaUnitaRegistro('M3')).toEqual({ famiglia: 'M3', fattore: 1 })
  })
})
```

- [ ] **Step 2: eseguire e vederlo fallire**

Run: `cd apps/backend && npx jest --runInBand src/domain/waste-movement/unita-misura-registro.spec.ts`
Expected: FAIL, modulo non trovato.

- [ ] **Step 3: implementare `normalizzaUnitaRegistro`** con `trim().toUpperCase()` e confronto con `ALIAS_KG`/`ALIAS_T`.

- [ ] **Step 4: eseguire il test**

Run: come Step 2. Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/domain/waste-movement/unita-misura-registro.ts apps/backend/src/domain/waste-movement/unita-misura-registro.spec.ts
git commit -m "feat(registro): normalizzazione dell'unità di misura per famiglia (kg/t)"
```

---

### Task 2: giacenza disponibile alla data del movimento

**Files:**
- Create: `apps/backend/src/application/registro/giacenza-disponibile.ts`
- Test: `apps/backend/src/application/registro/giacenza-disponibile.postgres.spec.ts`

**Interfaces:**
- Consumes: `normalizzaUnitaRegistro`, `ALIAS_KG`, `ALIAS_T` (Task 1).
- Produces:
  - `export interface ParametriGiacenza { tenantId: string; cerCode: string; unit: string; alla: Date }`
  - `export async function giacenzaDisponibileAl(tx: Prisma.TransactionClient, p: ParametriGiacenza): Promise<number>`: quantità che uno SCARICO alla data `alla` può consumare **nell'unità base della famiglia** (kg per la massa), arrotondata a 3 decimali. Può essere negativa se i dati sono già incoerenti.

Il valore restituito è `min(saldo a 'alla', minimo dei saldi a ogni data successiva)`: uno scarico retrodatato non deve consumare carichi successivi, né portare sotto zero il saldo di uno scarico già registrato dopo di lui. Il CER si confronta su entrambe le forme, con e senza `*`, perché `normalizzaCerCode` conserva l'asterisco solo se l'operatore lo ha scritto (`registra-movimento.use-case.ts:254-262`). Algoritmo (un solo `$queryRaw`):

```sql
WITH mov AS (
  SELECT movement_date AS d,
         SUM(CASE WHEN type = 'CARICO' THEN 1 ELSE -1 END * quantity * <fattore>) AS delta
  FROM waste_movements
  WHERE tenant_id = ${tenantId}::uuid
    AND cer_code IN (${cerSenzaStella}, ${cerConStella})
    AND <famiglia della riga> = ${famiglia}
  GROUP BY movement_date
),
saldi AS (SELECT d, SUM(delta) OVER (ORDER BY d) AS saldo FROM mov)
SELECT
  COALESCE((SELECT saldo FROM saldi WHERE d <= ${alla} ORDER BY d DESC LIMIT 1), 0) AS al_giorno,
  (SELECT MIN(saldo) FROM saldi WHERE d > ${alla}) AS minimo_successivo
```

`<fattore>` è `CASE WHEN upper(btrim(unit)) = ANY(${ALIAS_T}) THEN 1000 ELSE 1 END` e `<famiglia della riga>` è `CASE WHEN upper(btrim(unit)) = ANY(${ALIAS_KG}) OR upper(btrim(unit)) = ANY(${ALIAS_T}) OR btrim(unit) = '' THEN 'KG' ELSE upper(btrim(unit)) END`, con gli array passati come parametri: le liste di alias restano solo in `unita-misura-registro.ts`. Raggruppare per `movement_date` mette carichi e scarichi dello stesso istante nello stesso saldo, quindi uno scarico alla stessa data e ora di un carico può usarlo.

- [ ] **Step 1: scrivere i test che falliscono** (Postgres reale, schema di `rentri-scorta.repository.postgres.spec.ts`: `new PrismaClient()`, tenant creato in `beforeAll` con `partitaIva: \`GD${Date.now().toString().slice(-9)}\``, `afterAll` che cancella `wasteMovement` e tenant). Helper `carico(data, qty, unit = 'KG', cer = '99 99 01')` e `scarico(...)` che inseriscono direttamente con `prisma.wasteMovement.create` (`progressiveYear: 2026`, `progressiveNumber` da un contatore, `causale: 'ALTRO_CARICO'`/`'ALTRO_SCARICO'`, `registrationDate` = data). Helper `disp(alla, unit = 'KG', cer = '99 99 01')` = `prisma.$transaction(tx => giacenzaDisponibileAl(tx, { tenantId, cerCode: cer, unit, alla }))`. `beforeEach` svuota i movimenti del tenant.

```ts
it('saldo semplice: carichi meno scarichi fino alla data', async () => {
  await carico('2026-03-01', 100)
  await scarico('2026-03-02', 30)
  expect(await disp(new Date('2026-03-05'))).toBe(70)
})
it('non consuma carichi successivi alla data dello scarico', async () => {
  await carico('2026-03-10', 100)
  expect(await disp(new Date('2026-03-05'))).toBe(0)
})
it('non rompe il saldo di uno scarico successivo già registrato', async () => {
  await carico('2026-03-01', 100)
  await scarico('2026-03-03', 100)
  expect(await disp(new Date('2026-03-02'))).toBe(0)
})
it('carico e scarico nello stesso istante si compensano', async () => {
  await carico('2026-03-01T00:00:00Z', 50)
  expect(await disp(new Date('2026-03-01T00:00:00Z'))).toBe(50)
})
it('somma kg e tonnellate, tiene separati i litri', async () => {
  await carico('2026-03-01', 1, 'T')
  await scarico('2026-03-02', 600, 'kg')
  await carico('2026-03-02', 30, 'LITRI')
  expect(await disp(new Date('2026-03-05'), 'KG')).toBe(400)
  expect(await disp(new Date('2026-03-05'), 't')).toBe(400)
  expect(await disp(new Date('2026-03-05'), 'litri')).toBe(30)
})
it('CER con e senza asterisco sono lo stesso rifiuto', async () => {
  await carico('2026-03-01', 80, 'KG', '99 99 01*')
  expect(await disp(new Date('2026-03-05'), 'KG', '99 99 01')).toBe(80)
})
it('ignora i movimenti di un altro tenant', async () => {
  // crea un secondo tenant con un carico di 500 sullo stesso CER
  expect(await disp(new Date('2026-03-05'))).toBe(0)
})
```

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npm run test:postgres -- giacenza-disponibile`
Expected: FAIL, modulo non trovato.

- [ ] **Step 3: implementare `giacenzaDisponibileAl`** con la query sopra; `Number(al_giorno)` e `minimo_successivo` (null = nessun vincolo), risultato `Math.round(min * 1000) / 1000`.

- [ ] **Step 4: eseguire i test**

Run: come Step 2. Expected: PASS (7 test).

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/registro/giacenza-disponibile.ts apps/backend/src/application/registro/giacenza-disponibile.postgres.spec.ts
git commit -m "feat(registro): giacenza disponibile per data del movimento e famiglia di unità"
```

---

### Task 3: controllo di giacenza dentro la transaction, sotto lock

**Files:**
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts:116-147` (controllo e lock), `:278-293` (`getGiacenzaCer` rimosso)
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.spec.ts` (test di giacenza: `:238-335`, `:404-470`)
- Create: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.postgres.spec.ts`

**Interfaces:**
- Consumes: `giacenzaDisponibileAl` (Task 2), `normalizzaUnitaRegistro` (Task 1).
- Produces: nessuna firma pubblica nuova. Dentro la transaction lo use case lancia `GiacenzaInsufficienteError` (classe privata del file, `extends Error`), che il `catch` di `execute` trasforma in `Result.fail(err.message)` **senza** il prefisso `Errore durante la registrazione:`.

Nella transaction, dopo il lock `<tenantId>-<anno>` già esistente e **prima** del `MAX(progressive_number)`: se `command.type === 'SCARICO'`, prendere `pg_advisory_xact_lock(hashtext('giacenza|' + tenantId + '|' + cerSenzaStella))`, poi `giacenzaDisponibileAl(tx, { tenantId, cerCode, unit: command.unit, alla: command.movementDate })`. Confronto in unità base: `richiesto = command.quantity * fattore`; se `disponibile + 1e-9 < richiesto`, errore. Messaggio, con la giacenza riconvertita nell'unità dello scarico (`disponibile / fattore`) e la data in `YYYY-MM-DD`:

`Giacenza insufficiente per CER ${cerCode} al ${data}: disponibili ${disponibileNellUnita} ${command.unit}, richiesti ${command.quantity} ${command.unit}. Verifica i movimenti di carico registrati.`

- [ ] **Step 1: adattare e scrivere i test unitari.** In testa allo spec: `jest.mock('../giacenza-disponibile')` e `const giacenzaMock = giacenzaDisponibileAl as jest.MockedFunction<typeof giacenzaDisponibileAl>`. I tre test che oggi impostano `prisma.wasteMovement.groupBy` passano a `giacenzaMock.mockResolvedValue(...)` e a una `$transaction` mockata (helper `_mockTransazione` esistente). Il test `la query giacenza filtra per tenantId` diventa:

```ts
it('calcola la giacenza dentro la transaction, per tenant, CER, unità e data dello scarico', async () => {
  giacenzaMock.mockResolvedValue(50)
  _mockTransazione(recordScarico)
  await useCase.execute(scaricoCmd({ quantity: 10, unit: 'KG', movementDate: TODAY }))
  expect(giacenzaMock).toHaveBeenCalledWith(
    expect.anything(),
    { tenantId: TENANT, cerCode: '20 03 01', unit: 'KG', alla: TODAY }
  )
  expect(prisma.wasteMovement.groupBy).not.toHaveBeenCalled()
})
it('prende il lock della giacenza dopo quello del progressivo e prima di leggere la giacenza', async () => {
  // tx.$executeRaw registra l'ordine delle chiamate insieme a giacenzaMock
  // atteso: [lock '<TENANT>-2026', lock 'giacenza|<TENANT>|20 03 01', giacenzaDisponibileAl]
})
it('il messaggio riporta la giacenza nell\'unità dello scarico', async () => {
  giacenzaMock.mockResolvedValue(400) // kg
  _mockTransazione(recordScarico)
  const r = await useCase.execute(scaricoCmd({ quantity: 0.5, unit: 't' }))
  expect(r.isFailure).toBe(true)
  expect(r.error).toContain('disponibili 0.4 t, richiesti 0.5 t')
  expect(r.error).not.toContain('Errore durante la registrazione')
})
it('un CARICO non legge la giacenza e non prende il lock della giacenza', async () => {
  _mockTransazione(recordCarico)
  await useCase.execute(buildCommand())
  expect(giacenzaMock).not.toHaveBeenCalled()
})
```

(`scaricoCmd(over)` è un helper nuovo dello spec che costruisce un `RegistraMovimentoCommand` SCARICO `CONFERIMENTO_TRASPORTATORE` sul CER `20 03 01`, quantità 100 `KG`, `movementDate` = `TODAY`, **senza `firId`**, con gli override indicati; `recordScarico`/`recordCarico` sono i record già presenti nei test esistenti, estratti in costanti.)

- [ ] **Step 2: scrivere il test di concorrenza su Postgres reale.** `registra-movimento.use-case.postgres.spec.ts`: `new RegistraMovimentoUseCase(prisma as any, loggerStub as any)` con `loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }`; in `beforeAll` tenant nuovo e `prisma.cERCode.upsert({ where: { code: '99 99 01' }, create: { code: '99 99 01', description: 'CER di test', category: '99', subcategory: '' }, update: {} })`; `afterAll` cancella movimenti, tenant e il CER di test.

```ts
it("cinque scarichi concorrenti dell'intera giacenza: ne passa uno solo", async () => {
  expect((await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2026-03-01'))).isSuccess).toBe(true)
  const esiti = await Promise.all(
    Array.from({ length: 5 }, () =>
      useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 100, '2026-03-02'))
    )
  )
  expect(esiti.filter(e => e.isSuccess)).toHaveLength(1)
  expect(esiti.filter(e => e.isFailure).every(e => e.error.includes('Giacenza insufficiente'))).toBe(true)
  const scarichi = await prisma.wasteMovement.count({ where: { tenantId, type: 'SCARICO' } })
  expect(scarichi).toBe(1)
})
it("uno scarico retrodatato prima dell'unico carico è rifiutato", async () => {
  await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2026-03-10'))
  const r = await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 50, '2026-03-05'))
  expect(r.isFailure).toBe(true)
  expect(r.error).toContain('al 2026-03-05')
})
```

(`cmd(type, causale, qty, data, unit = 'KG')` costruisce il comando con CER `99 99 01`, `movementDate` = `registrationDate` = `new Date(data)`; `beforeEach` svuota i movimenti del tenant.)

- [ ] **Step 3: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/application/registro/use-cases/registra-movimento.use-case.spec.ts` (FAIL sui test nuovi) e `npm run test:postgres -- registra-movimento` (FAIL: passa più di uno scarico).

- [ ] **Step 4: implementare** lo spostamento descritto sopra; rimuovere `getGiacenzaCer` e il blocco `:116-126`.

- [ ] **Step 5: eseguire i test**

Run: entrambi i comandi dello Step 3. Expected: PASS.

- [ ] **Step 6: commit**

```bash
git add apps/backend/src/application/registro/use-cases/
git commit -m "fix(registro): controllo di giacenza sotto lock, per data dello scarico e per unità"
```

---

### Task 4: ricopia FIR → registro idempotente

**Files:**
- Modify: `apps/backend/prisma/schema.prisma:1753` (aggiungere `@@unique([tenantId, firId, type])` a `WasteMovement`)
- Create: `apps/backend/prisma/migrations/20261021120000_registro_un_movimento_per_fir_e_tipo/migration.sql`
- Modify: `apps/backend/src/core/domain/errors.ts` (`FirGiaRegistratoError`)
- Modify: `apps/backend/src/application/registro/use-cases/registra-movimento.use-case.ts` (`MovimentoRegistrato`, transaction)
- Test: `registra-movimento.use-case.spec.ts`, `registra-movimento.use-case.postgres.spec.ts` (Task 3)

**Interfaces:**
- Consumes: ordine dei lock (Global Constraints).
- Produces:
  - `MovimentoRegistrato.giaRegistrato: boolean` (nuovo campo, `false` sui movimenti nuovi)
  - `export class FirGiaRegistratoError extends DomainError { constructor(progressiveNumber: number, progressiveYear: number) }`, messaggio: `Il FIR è già registrato nel movimento n. ${progressiveNumber}/${progressiveYear} con dati diversi: verificare quel movimento invece di registrarne un secondo`

Migration (scritta a mano, perché senza database non si può generare):

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM waste_movements WHERE fir_id IS NOT NULL
    GROUP BY tenant_id, fir_id, type HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'waste_movements: lo stesso FIR risulta ricopiato piu'' volte nel registro con lo stesso tipo. Risolvere i doppi prima di applicare questa migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "waste_movements_tenant_id_fir_id_type_key"
  ON "waste_movements"("tenant_id", "fir_id", "type");
```

Basta un indice unico normale: in Postgres i `NULL` sono distinti, quindi i movimenti senza FIR non collidono.

Nella transaction, **per primi** (prima del lock del progressivo e del controllo di giacenza, così un retry di uno scarico non viene respinto per la giacenza che lui stesso ha consumato): se `command.firId`, lock `fir-registro|<tenantId>|<firId>`, poi `tx.wasteMovement.findFirst({ where: { tenantId, firId, type } })`. Se esiste e coincidono `cerCode` (normalizzato), `quantity`, unità normalizzata (famiglia e fattore) e `movementDate.getTime()`, si restituisce il movimento esistente con `giaRegistrato: true`, `fuoriTermine`/`ritardoGg` ricalcolati come per un movimento nuovo e nessun insert; altrimenti `throw new FirGiaRegistratoError(...)`. Nel `catch` di `execute`, `DomainError` → `Result.fail(err.message)` senza prefisso; un `P2002` il cui `meta.target` contiene `fir_id` → `Result.fail` con lo stesso testo di `FirGiaRegistratoError` (rete di sicurezza, il lock lo rende raro).

- [ ] **Step 1: scrivere i test unitari che falliscono.** L'helper `_mockTransazione` e le `$transaction` mockate dei test esistenti aggiungono `wasteMovement.findFirst: jest.fn().mockResolvedValue(null)` al `tx`. L'helper `cmd(...)` dello spec Postgres del Task 3 prende un sesto parametro opzionale `firId?: string`.

```ts
it('la stessa ricopia ripetuta restituisce il movimento esistente', async () => {
  // tx.wasteMovement.findFirst → movimento n. 7/2026 con stessi CER, quantità, unità, data
  const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
  expect(r.isSuccess).toBe(true)
  expect(r.value).toMatchObject({ progressiveNumber: 7, giaRegistrato: true })
  expect(tx.wasteMovement.create).not.toHaveBeenCalled()
  expect(giacenzaMock).not.toHaveBeenCalled()
})
it('una seconda ricopia con quantità diversa è rifiutata', async () => {
  // findFirst → movimento 7/2026 con quantity 100; comando con quantity 90
  const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001', quantity: 90 }))
  expect(r.error).toBe(new FirGiaRegistratoError(7, 2026).message)
})
it('un movimento nuovo ha giaRegistrato false', async () => { /* findFirst → null */ })
```

- [ ] **Step 2: scrivere i test Postgres** (in coda a `registra-movimento.use-case.postgres.spec.ts`; serve un FIR reale del tenant, creato come in `fir-prisma.repository.postgres.spec.ts:66-77` con un utente del tenant e `repo.save`):

```ts
it('la stessa ricopia ripetuta restituisce il movimento esistente', async () => {
  await useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 100, '2026-03-01', 'KG', firId))
  const a = await useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 100, '2026-03-01', 'KG', firId))
  expect(a.value.giaRegistrato).toBe(true)
  expect(await prisma.wasteMovement.count({ where: { tenantId, firId } })).toBe(1)
})
it('due ricopie concorrenti dello stesso FIR producono un solo movimento', async () => {
  const [x, y] = await Promise.all([
    useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 100, '2026-03-01', 'KG', firId)),
    useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 100, '2026-03-01', 'KG', firId)),
  ])
  expect(x.isSuccess && y.isSuccess).toBe(true)
  expect(x.value.id).toBe(y.value.id)
  expect([x.value.giaRegistrato, y.value.giaRegistrato].sort()).toEqual([false, true])
})
it("l'indice unico rifiuta un doppio scritto senza passare dallo use case", async () => {
  // due prisma.wasteMovement.create con stesso tenantId, firId, type → il secondo rejects P2002
})
```

- [ ] **Step 3: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/application/registro/use-cases/registra-movimento.use-case.spec.ts`. Expected: FAIL sui tre test nuovi.

- [ ] **Step 4: schema, migration, errore e use case.** Poi `cd apps/backend && npx prisma validate && npx prisma generate`.

- [ ] **Step 5: eseguire i test**

Run: lo Step 3, poi (con il database locale) `npx prisma migrate deploy && npm run test:postgres -- registra-movimento`. Expected: PASS.

- [ ] **Step 6: query di controllo da eseguire sul database del VPS prima del deploy** (riportarla nella descrizione della PR; se restituisce righe, vedi Decisione 3):

```sql
SELECT tenant_id, fir_id, type, array_agg(progressive_year || '/' || progressive_number) AS movimenti
FROM waste_movements WHERE fir_id IS NOT NULL
GROUP BY tenant_id, fir_id, type HAVING COUNT(*) > 1;
```

- [ ] **Step 7: commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/20261021120000_registro_un_movimento_per_fir_e_tipo apps/backend/src/core/domain/errors.ts apps/backend/src/application/registro/use-cases/
git commit -m "fix(registro): un FIR si ricopia una sola volta per tipo, il retry restituisce il movimento esistente"
```

---

### Task 5: giacenze della pagina in kg veri, altre unità a parte

**Files:**
- Modify: `apps/backend/src/application/giacenze/giacenze.service.ts:6-84`
- Modify: `apps/backend/src/application/giacenze/giacenze.service.spec.ts`
- Modify: `apps/frontend/src/app/features/giacenze/giacenze.service.ts:7-13` (interfaccia `Giacenza`)
- Modify: `apps/frontend/src/app/features/giacenze/giacenze.component.ts:138-152` (tabella)
- Create: `apps/frontend/src/app/features/giacenze/giacenze.component.spec.ts`

**Interfaces:**
- Consumes: `normalizzaUnitaRegistro` (Task 1).
- Produces: `GiacenzaCer.altreUnita: Array<{ unita: string; carico: number; scarico: number; giacenza: number }>` (backend e interfaccia frontend `Giacenza`). `caricoKg`/`scaricoKg`/`giacenzaKg` contengono solo la famiglia `KG`, con le tonnellate ×1000.

Il primo `groupBy` diventa `by: ['cerCode', 'type', 'unit']`; ogni riga si somma, tramite `normalizzaUnitaRegistro`, nei campi kg o nella voce di `altreUnita` della sua famiglia. Gli alert (`getDepositoTemporaneoAlerts`) restano sui kg, ora corretti.

- [ ] **Step 1: scrivere i test che falliscono**

```ts
it('converte le tonnellate in kg e tiene i litri fuori dai kg', async () => {
  mockGroupBy(
    [
      { cerCode: '170405', type: 'CARICO', unit: 'T', _sum: { quantity: 1 } },
      { cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 500 } },
      { cerCode: '170405', type: 'SCARICO', unit: 'kg', _sum: { quantity: 200 } },
      { cerCode: '170405', type: 'CARICO', unit: 'LITRI', _sum: { quantity: 30 } },
    ],
    []
  )
  const [g] = await service.getGiacenze('t1')
  expect(g).toMatchObject({ caricoKg: 1500, scaricoKg: 200, giacenzaKg: 1300 })
  expect(g.altreUnita).toEqual([{ unita: 'LITRI', carico: 30, scarico: 0, giacenza: 30 }])
})
```

Frontend, `giacenze.component.spec.ts` (schema di `features/dashboard/dashboard.component.spec.ts`, `GiacenzeService` sostituito da uno stub con `of(...)`):

```ts
it('mostra le giacenze in unità diverse dal kg accanto alla riga del CER', () => {
  // getGiacenze → [{ cerCode: '170405', caricoKg: 0, scaricoKg: 0, giacenzaKg: 0, oldestCaricoDate: null,
  //                  altreUnita: [{ unita: 'LITRI', carico: 30, scarico: 0, giacenza: 30 }] }]
  expect(fixture.nativeElement.textContent).toContain('30 LITRI')
})
```

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/application/giacenze/giacenze.service.spec.ts`; `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/giacenze/giacenze.component.spec.ts`. Expected: FAIL.

- [ ] **Step 3: implementare** il servizio e, nella cella "Giacenza (kg)", una riga per ogni voce di `altreUnita` nel formato `{{ a.giacenza | number: '1.0-2' }} {{ a.unita }}`. Adeguare i test esistenti di `giacenze.service.spec.ts` aggiungendo `unit: 'KG'` alle righe mockate.

- [ ] **Step 4: eseguire i test** (comandi dello Step 2). Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/giacenze/ apps/frontend/src/app/features/giacenze/
git commit -m "fix(giacenze): kg e tonnellate sommati correttamente, le altre unità a parte"
```

---

### Task 6: salvataggio atomico di FIR e firme

**Files:**
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts:201-341` (`save`, `persistSignatures`)
- Modify: `apps/backend/src/core/domain/errors.ts` (`FirmaSenzaUtenteError`)
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.spec.ts:75-92` (mock), `:338-345`
- Test: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.postgres.spec.ts`

**Interfaces:**
- Produces:
  - `private async salvaCon(client: Prisma.TransactionClient, fir: FIR): Promise<void>`: upsert + firme sullo stesso client; usato da `save` e dal Task 7.
  - `save(fir)` = `this.prisma.$transaction(tx => this.salvaCon(tx, fir))`, firma pubblica invariata.
  - `persistSignatures(client: Prisma.TransactionClient, fir: FIR)`.
  - `export class FirmaSenzaUtenteError extends DomainError { constructor(ruolo: string, firId: string) }`, messaggio: `La firma ${ruolo} del FIR ${firId} non indica l'utente che l'ha apposta: il FIR non viene salvato` (Decisione 5).

La traduzione `translateUniqueConstraintError` resta attorno all'upsert, dentro `salvaCon`.

- [ ] **Step 1: test unitari.** Nel mock di `beforeEach` aggiungere `$transaction: jest.fn(async (fn: any) => fn(prisma))`. Il test `non tenta di persistere una firma priva di userId` diventa:

```ts
it('rifiuta il salvataggio di una firma priva di userId, senza scrivere nulla', async () => {
  const fir = buildFirWithFirmaProduttore()
  ;(fir.firme.produttore as any).userId = undefined
  await expect(repo.save(fir)).rejects.toThrow(FirmaSenzaUtenteError)
  expect(prisma.fIRSignature.create).not.toHaveBeenCalled()
})
it('save esegue upsert e firme nella stessa transaction', async () => {
  await repo.save(buildFirWithFirmaProduttore())
  expect(prisma.$transaction).toHaveBeenCalledTimes(1)
})
```

Il controllo su `userId` va fatto per tutte le firme **prima** dell'upsert.

- [ ] **Step 2: test Postgres** (in `fir-prisma.repository.postgres.spec.ts`, nuovo `describe`, stesso setup del file):

```ts
it('se la firma non si può scrivere, lo stato del FIR non cambia', async () => {
  const fir = FIR.create({ /* come buildFirAgganciato, senza aggancio */ })
  await repo.save(fir) // BOZZA
  fir.emetti('FIR-2099-000001', {
    firmatario: 'Mario Rossi',
    timestamp: new Date(),
    certificato: 'x',
    userId: '99999999-9999-4999-8999-999999999999', // utente inesistente: viola la FK
  })
  await expect(repo.save(fir)).rejects.toThrow()
  const riletto = await prisma.fIR.findUniqueOrThrow({ where: { id: fir.id } })
  expect(riletto.status).toBe('DRAFT')
  expect(riletto.firNumber).toBeNull()
})
```

- [ ] **Step 3: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/infrastructure/persistence/fir-prisma.repository.spec.ts` e `npm run test:postgres -- fir-prisma`. Expected: FAIL (oggi il FIR resta `AWAITING_CARRIER` con numero assegnato).

- [ ] **Step 4: implementare** `salvaCon` e il nuovo `save`.

- [ ] **Step 5: eseguire i test** (comandi dello Step 3). Expected: PASS.

- [ ] **Step 6: commit**

```bash
git add apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts apps/backend/src/infrastructure/persistence/fir-prisma.repository.spec.ts apps/backend/src/infrastructure/persistence/fir-prisma.repository.postgres.spec.ts apps/backend/src/core/domain/errors.ts
git commit -m "fix(fir): stato e firme salvati nella stessa transaction"
```

---

### Task 7: numerazione FIR serializzata per tenant e anno di emissione

**Files:**
- Create: `apps/backend/src/domain/fir/numero-fir.ts` + `numero-fir.spec.ts`
- Modify: `apps/backend/src/domain/fir/repositories/fir-repository.interface.ts:77-80`
- Modify: `apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts:376-404` (`generateNumeroProgressivo` rimosso, `emettiConNumerazione` nuovo)
- Modify: `apps/backend/src/core/domain/errors.ts` (`FirNonPiuInBozzaError`)
- Modify (doppi di test che implementano `IFIRRepository`): `src/application/fir/queries/get-fir-by-id.handler.spec.ts`, `queries/list-firs.handler.spec.ts`, `use-cases/conferma-consegna-fir.use-case.spec.ts`, `use-cases/create-fir.use-case.spec.ts`, `use-cases/emetti-fir.use-case.spec.ts`, `use-cases/presa-in-carico-fir.use-case.spec.ts`, `src/application/rentri/aggancio-formulari-ciclo-completo.oracolo.spec.ts`
- Test: `fir-prisma.repository.postgres.spec.ts`

**Interfaces:**
- Consumes: `salvaCon` (Task 6).
- Produces:
  - `export function annoSolareItaliano(istante: Date): number`: `new Date(istante.getTime() + 3_600_000).getUTCFullYear()` (a Capodanno l'Italia è sempre UTC+1; l'ora legale non sposta mai l'anno)
  - `export function formattaNumeroFir(anno: number, progressivo: number): string` → `FIR-2027-000001` (6 cifre minime, nessun troncamento oltre)
  - `IFIRRepository.emettiConNumerazione(fir: FIR, anno: number, applicaEmissione: (numeroProgressivo: string) => void): Promise<string>`: restituisce il numero assegnato. Sostituisce `generateNumeroProgressivo`, che sparisce da interfaccia e repository.
  - `export class FirNonPiuInBozzaError extends DomainError { constructor(firId: string) }`, messaggio: `Il FIR ${firId} non è più in bozza: è già stato emesso o annullato da un'altra operazione`

`emettiConNumerazione` in una sola `this.prisma.$transaction(async tx => ...)`:
1. `pg_advisory_xact_lock(hashtext('fir-numero|' + tenantId + '|' + anno))`, con `tenantId = fir.tenantId ?? fir.produttoreId` come oggi;
2. `SELECT status::text FROM firs WHERE id = ${fir.id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`: se la riga manca o lo stato non è `DRAFT`/`AWAITING_PRODUCER` (entrambi mappati su `BOZZA`, `DB_TO_STATO`), `throw new FirNonPiuInBozzaError(fir.id)`;
3. `SELECT MAX(CAST(substring(fir_number FROM '^FIR-[0-9]{4}-([0-9]+)$') AS integer)) AS max_num FROM firs WHERE tenant_id = ${tenantId}::uuid AND fir_number LIKE ${'FIR-' + anno + '-%'}`: l'anno si legge dal **numero**, non da `createdAt`, e il massimo è numerico, non sull'ordine delle stringhe;
4. `numero = formattaNumeroFir(anno, (max_num ?? 0) + 1)`; `applicaEmissione(numero)` (un'eccezione del dominio annulla tutto);
5. `await this.salvaCon(tx, fir)`; `return numero`.

Doppi di test: in ognuna delle sette classi, `generateNumeroProgressivo` diventa

```ts
async emettiConNumerazione(fir: FIR, anno: number, applica: (n: string) => void): Promise<string> {
  this.progressiveCounter = (this.progressiveCounter ?? 0) + 1
  const numero = formattaNumeroFir(anno, this.progressiveCounter)
  applica(numero)
  await this.save(fir)
  return numero
}
```

(se la classe non ha `progressiveCounter`, aggiungere `private progressiveCounter = 0`).

- [ ] **Step 1: test unitari di `numero-fir`**

```ts
it('annoSolareItaliano: 31/12 23:30 a Roma è ancora l\'anno vecchio, 00:30 del 1/1 il nuovo', () => {
  expect(annoSolareItaliano(new Date('2026-12-31T22:30:00Z'))).toBe(2026)
  expect(annoSolareItaliano(new Date('2026-12-31T23:30:00Z'))).toBe(2027)
  expect(annoSolareItaliano(new Date('2026-07-01T23:30:00Z'))).toBe(2026)
})
it('formattaNumeroFir', () => {
  expect(formattaNumeroFir(2027, 1)).toBe('FIR-2027-000001')
  expect(formattaNumeroFir(2027, 1234567)).toBe('FIR-2027-1234567')
})
```

- [ ] **Step 2: test Postgres** (nuovo `describe` in `fir-prisma.repository.postgres.spec.ts`, con un tenant dedicato per non contare i FIR degli altri test; `firma(userId)` costruisce una `FirmaDigitale` valida; `bozza()` crea e salva un FIR in BOZZA):

```ts
it("una bozza creata a dicembre ed emessa a gennaio conta nel progressivo dell'anno di emissione", async () => {
  const a = await bozza()
  await prisma.fIR.update({ where: { id: a.id }, data: { createdAt: new Date('2026-12-31T10:00:00Z') } })
  expect(await repo.emettiConNumerazione(a, 2027, n => a.emetti(n, firma(userId)))).toBe('FIR-2027-000001')
  const b = await bozza()
  expect(await repo.emettiConNumerazione(b, 2027, n => b.emetti(n, firma(userId)))).toBe('FIR-2027-000002')
})
it('due emissioni concorrenti di bozze diverse prendono numeri consecutivi senza errori', async () => {
  const [x, y] = [await bozza(), await bozza()]
  const numeri = await Promise.all([
    repo.emettiConNumerazione(x, 2028, n => x.emetti(n, firma(userId))),
    repo.emettiConNumerazione(y, 2028, n => y.emetti(n, firma(userId))),
  ])
  expect(numeri.sort()).toEqual(['FIR-2028-000001', 'FIR-2028-000002'])
})
it('la stessa bozza emessa due volte in parallelo: una sola emissione', async () => {
  const f = await bozza()
  const copia1 = (await repo.findById(f.id))!
  const copia2 = (await repo.findById(f.id))!
  const esiti = await Promise.allSettled([
    repo.emettiConNumerazione(copia1, 2029, n => copia1.emetti(n, firma(userId))),
    repo.emettiConNumerazione(copia2, 2029, n => copia2.emetti(n, firma(userId))),
  ])
  expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
  const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
  expect(rifiutato.reason).toBeInstanceOf(FirNonPiuInBozzaError)
  expect(await prisma.fIRSignature.count({ where: { firId: f.id } })).toBe(1)
})
it('il progressivo ignora i numeri che non hanno il formato FIR-AAAA-N', async () => {
  // un FIR del tenant con firNumber 'FIR-2030-ABC' non fa fallire il calcolo: la prima emissione 2030 è 000001
})
```

- [ ] **Step 3: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/domain/fir/numero-fir.spec.ts` e `npm run test:postgres -- fir-prisma`. Expected: FAIL (modulo e metodo inesistenti).

- [ ] **Step 4: implementare** `numero-fir.ts`, errore, interfaccia, repository e i sette doppi.

- [ ] **Step 5: eseguire i test**

Run: lo Step 3, poi `cd apps/backend && npx jest --runInBand src/application/fir src/application/rentri/aggancio-formulari-ciclo-completo.oracolo.spec.ts` e `npx tsc -p tsconfig.json --noEmit`. Expected: PASS, nessun errore di tipo. Lo spec `oracolo` è escluso dal gate CI (`jest.config.js`): qui basta che compili e passi. `emetti-fir.use-case.spec.ts` può fallire finché il Task 8 non cambia lo use case: è atteso, ma deve almeno compilare.

- [ ] **Step 6: commit**

```bash
git add apps/backend/src/domain/fir/ apps/backend/src/infrastructure/persistence/ apps/backend/src/core/domain/errors.ts apps/backend/src/application/fir apps/backend/src/application/rentri/aggancio-formulari-ciclo-completo.oracolo.spec.ts
git commit -m "fix(fir): numero FIR assegnato sotto lock per tenant e anno di emissione"
```

---

### Task 8: emissione tramite la numerazione serializzata

**Files:**
- Modify: `apps/backend/src/application/fir/use-cases/emetti-fir.use-case.ts:64-79`
- Modify: `apps/backend/src/application/fir/use-cases/emetti-fir.use-case.spec.ts:359-404`

**Interfaces:**
- Consumes: `IFIRRepository.emettiConNumerazione`, `annoSolareItaliano` (Task 7), `DomainError`.
- Produces: nessuna firma nuova.

I passi 3-5 attuali diventano: `const anno = annoSolareItaliano(new Date())`; `await this.firRepository.emettiConNumerazione(fir, anno, numero => fir.emetti(numero, firma))` dentro un `try`: un `DomainError` (stato non valido, `FirNonPiuInBozzaError`, `FirmaSenzaUtenteError`) → `Result.fail(\`Failed to emit FIR: ${error.message}\`)` come oggi per l'errore di `fir.emetti`; ogni altro errore si rilancia. La trasmissione RENTRI parte solo dopo un'emissione riuscita, come oggi.

- [ ] **Step 1: adattare e scrivere i test.** `due FIR sullo stesso tenant generano progressivi distinti e crescenti` spia `emettiConNumerazione` invece di `generateNumeroProgressivo` (`calls[0][0].tenantId === TENANT_ID`, `calls[0][1] === annoSolareItaliano(new Date())`). Nuovi:

```ts
it("usa l'anno italiano dell'istante di emissione", async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-12-31T23:30:00Z'))
  const r = await useCase.execute(new EmettiFIRCommand(fir.id, 'user-123', 'Test'))
  expect(r.value.numeroProgressivo).toMatch(/^FIR-2027-/)
  jest.useRealTimers()
})
it("un FIR non più in bozza nel database dà un errore leggibile e non avvia RENTRI", async () => {
  jest.spyOn(repository, 'emettiConNumerazione').mockRejectedValue(new FirNonPiuInBozzaError(fir.id))
  const r = await useCase.execute(new EmettiFIRCommand(fir.id, 'user-123', 'Test'))
  expect(r.isFailure).toBe(true)
  expect(r.error).toContain('non è più in bozza')
  expect(trasmissioneRentri.eseguiSeAutomatica).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: eseguire e vederli fallire**

Run: `cd apps/backend && npx jest --runInBand src/application/fir/use-cases/emetti-fir.use-case.spec.ts`. Expected: FAIL.

- [ ] **Step 3: implementare** come descritto.

- [ ] **Step 4: eseguire i test** (comando dello Step 2). Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/fir/use-cases/emetti-fir.use-case.ts apps/backend/src/application/fir/use-cases/emetti-fir.use-case.spec.ts
git commit -m "fix(fir): emissione con numero e firma nella stessa transaction, anno italiano"
```

---

## Verifica finale (dopo il Task 8)

- [ ] `cd apps/backend && npx jest --runInBand src/domain/waste-movement src/domain/fir src/application/registro src/application/giacenze src/application/fir src/infrastructure/persistence/fir-prisma.repository.spec.ts`: tutto PASS.
- [ ] `cd apps/backend && npx prisma migrate deploy && npm run test:postgres`: tutti i `*.postgres.spec.ts` PASS, compresi quelli già esistenti (isolamento sorelle, gerarchia, CER, scorta).
- [ ] `cd apps/backend && npx tsc -p tsconfig.json --noEmit`: nessun errore.
- [ ] `git grep -n "generateNumeroProgressivo\|getGiacenzaCer" -- apps/backend/src`: nessun risultato.
- [ ] `git grep -n "createdAt: {" -- apps/backend/src/infrastructure/persistence/fir-prisma.repository.ts`: nessun filtro per anno su `createdAt`.

## Fuori ambito (follow-up espliciti)

- **Peso a destino nella ricopia** (Decisione 1) e **regola ±10%** (`fir.aggregate.ts:552`).
- **Autocompletamento del registro che nasconde i FIR già ricopiati**: oggi il backend rifiuta o restituisce il movimento esistente, ma l'interfaccia continua a proporre il FIR. Il frontend potrebbe anche mostrare un avviso quando la risposta ha `giaRegistrato: true`.
- **Anomalia `NEGATIVE_STOCK`** (`anomaly-detection.service.ts:104-127`): somma ancora unità diverse; da riallineare a `normalizzaUnitaRegistro`.
- **Età del deposito temporaneo** sul primo carico di sempre (`giacenze.service.ts:50-54`) e soglie fisse: raccomandazione 4 del rapporto 01.
- **`existsNumeroProgressivo`** (`fir-prisma.repository.ts:369-374`) non filtra per tenant; oggi non ha chiamanti in `src/`.
- **Controllo di versione sulle altre transizioni del FIR** (presa in carico, consegna, annullamento: D17, last-write-wins): qui si protegge solo l'emissione.
- **CER salvato con e senza asterisco** nel registro: il controllo di giacenza li unisce, ma pagina giacenze e MUD li vedono come due CER diversi. Conviene normalizzare sempre con `*` per i pericolosi in `normalizeCerCode`.
- **Fuso orario del progressivo del registro** (Decisione 6).
