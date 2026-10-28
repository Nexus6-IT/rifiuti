# Bilancio (direzioni demo, filone 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una pagina "Bilancio rifiuti" (cruscotto del ruolo sola lettura, voce di menu per gli altri) che mostra per l'azienda selezionata prodotto, recupero/smaltimento, rifiuti principali, quota pericolosi, stato del MUD, mesi con movimenti, segnali aperti e giacenza, con gli stessi numeri del MUD e un PDF informativo.

**Architecture:** il backend non scrive una seconda formula: i totali dell'anno (prodotto, R, D, per EER, pericolosi, quota da verificare, esclusi, giacenza) si leggono dall'uscita pubblica `MudAggregazioneService.aggrega(tenantId, anno)`, cioè dal MUD stesso, senza toccare `mud-aggregazione.service.ts`. Solo tre numeri che il MUD non produce (prodotto dello stesso periodo dell'anno precedente, "di cui R13/D15", mesi con movimenti) passano da funzioni pure nuove costruite sulle regole esportate del MUD (`classificaMovimento`, `operazioneDaCodice`, `operazioneDaCatalogo`, `WHERE_VIGENTE`, `convertiInKg`, `collegabilitaFir`). I segnali aperti arrivano da porte opzionali (token Nest) che Studio e F2-6 riempiranno dopo il loro merge. Frontend: pagina standalone `/bilancio`, guard di atterraggio sulla rotta vuota.

**Tech Stack:** NestJS 10 + Prisma 5 (backend, jest), pdfmake 0.2 (stessa libreria di `infrastructure/pdf/pdf.service.ts`), Angular 17 standalone + PrimeNG 17 (frontend, Karma/Jasmine).

**Spec:** `docs/superpowers/specs/2026-10-28-direzioni-demo-design.md`, sezione "2. Bilancio" (più "Vincoli trasversali" e "Sequenza e branch").

## Discrepanze fra design e codice (decise in questo piano)

1. **`recuperoOSmaltimento` non è esportata**: è un metodo `private` di `MudAggregazioneService` (`mud-aggregazione.service.ts:662`), con tipi privati del file (`Movimento`, `FirCollegato`) e che scrive nei controlli. Non si importa senza modificare il file. Soluzione: R e D si leggono già calcolati da `aggrega()` (pubblico, `:194`), che usa quella precedenza al suo interno. Gli unici punti dove la precedenza serve per movimento ("di cui R13/D15") la ricompongono dalle tre funzioni esportate di `mud-regole.ts`, nello stesso ordine, in una funzione sola con un test per ogni gradino (Task 1). È l'unica regola del MUD ripetuta: va rimossa quando F2-8 o un pezzo successivo esporterà l'operazione per movimento.
2. **La funzione condivisa di F2-8 è annuale**: `totaliMud(aggregato)` e `MUDGeneratorService.totaliAnno(tenantId, anno)` (piano F2-8, D22) lavorano sull'anno intero. Il confronto "stesso periodo dell'anno precedente" per l'anno in corso non può venire da lì: resta sulle funzioni pure del Task 1 anche dopo F2-8, con la lacuna `CONFRONTO_PARZIALE` quando la sua base differisce dal totale MUD.
3. **`esg/report` ha una formula propria** (`application/esg/esg.service.ts:61-113`): somma `FIR.quantity` per `wasteOperationType` filtrando su `createdAt`, senza registro, senza vigenza, senza conversione di unità, con le bozze dentro, e chiama "prodotto" la somma R+D. Il Bilancio non lo usa come fonte. Allinearlo al MUD non è in questo piano (seguito da segnalare).
4. **PDFKit non è nel backend**: tutti i PDF usano `pdfmake` (`pdf.service.ts:13`, `package.json` `"pdfmake": "^0.2.9"`), che sotto usa PDFKit. Il Bilancio usa pdfmake come gli altri PDF; nessuna dipendenza nuova.
5. **Litri e m³**: il MUD li include quando le integrazioni hanno il peso specifico (`CONVERTITO_CON_PESO_SPECIFICO`). Il Bilancio segue il MUD (altrimenti i numeri differirebbero) e lo dichiara come stima; restano fuori solo quelli senza peso specifico (`UNITA_NON_DI_MASSA`).
6. **Scadenza del MUD configurabile**: esiste già, `MudVersionRegistry.scadenzaPresentazione(annoDati)` (`export/mud-version.registry.ts:43`, tracciato dell'anno o 30 aprile). Si riusa; `MudVersionRegistry` non è esportato da `MUDModule`, quindi `BilancioModule` lo fornisce da sé come fa `notifications.module.ts:24` (classe senza dipendenze).
7. **Giacenza a fine periodo**: oggi viene dal saldo del registro che il MUD calcola (`saldiAl31Dicembre`, privato) ed espone nel controllo `GIACENZE_NON_CALCOLATE.kgNonDichiarati`. F2-8 toglie quel controllo nella versione 2 del calcolo (piano F2-8, riga 296): il Task 11 è quindi **obbligatorio** appena F2-8 è in master, altrimenti la giacenza resta a zero in silenzio.
8. **Atterraggio del consulente**: oggi tutti atterrano su `/dashboard` (`auth-callback.component.ts:136`). La guard del Task 10 manda il consulente con aziende associate su `/permissions/consultant-dashboard` (dove Studio aggiungerà la scheda), come dice il design. Se Studio preferisce gestirlo lui, basta cambiare la mappa delle rotte della guard.

## Global Constraints

- Lavoro nel worktree `C:\Progetti\rifiuti-wt-direzioni`, branch `feat/direzioni-demo`. Prima del Task 1, una volta: dalla root `npm ci`, poi `cd apps/backend && npm run prisma:generate` (il worktree non ha `node_modules`). Nessun database serve: tutti i test sono unitari.
- **File da NON modificare** (branch F2-6, F2-8, F2-10 aperti): tutto `apps/backend/src/application/mud/**`, `apps/backend/src/api/mud/**`, `apps/backend/src/infrastructure/pdf/**`, `apps/backend/src/application/giacenze/**`, `apps/backend/prisma/**`, `apps/backend/src/application/registro/aperture-registro.ts`, `apps/backend/src/application/registro/causali/**`, `apps/backend/src/domain/waste-movement/**`, `apps/backend/src/infrastructure/persistence/**`, `apps/backend/src/core/domain/errors.ts`, `apps/backend/src/core/filters/**`, `apps/backend/src/core/monitoring/**`, `apps/backend/src/test-support/**`, `apps/backend/jest.config.js`, `apps/backend/tsconfig.json`, `apps/frontend/src/app/features/mud/**`, `apps/frontend/src/app/features/rentri/**`, `ops/README.md`. Si **importano** soltanto. Nessuna migration.
- Import dal MUD ammessi (solo lettura): `MudAggregazioneService`, `MudAggregato` (`mud-aggregazione.service.ts`); `classificaMovimento`, `operazioneDaCodice`, `operazioneDaCatalogo`, `limitiAnnoMud`, `MovimentoClassificabile` (`mud-regole.ts`); `riepilogaAvvisi`, `CODICI_RIPARTIZIONE_RD`, `MudEsitoControllo` (`mud-controlli.ts`); `MudObbligoService`; `MudVersionRegistry`; `caricaCatalogoCausali` (`registro/causali/catalogo-causali.repository.ts`); `WHERE_VIGENTE` (`domain/waste-movement/vigenza.ts`); `convertiInKg` (`domain/waste-movement/unita-misura-registro.ts`); `chiaveConfrontoCer`, `cerCanonico` (`cer-registro.ts`); `collegabilitaFir`, `FirPerStato` (`domain/fir/stati-fir.ts`); `giornoItaliano`, `formattaDataItaliana`, `formattaDataOraItaliana`, `annoSolareItaliano` (`core/time/anno-italiano.ts`); `formattaQuantita` (`core/format/formatta-quantita.ts`). Nessuna di queste si ridefinisce.
- **Isolamento**: ogni query Prisma del Bilancio porta `tenantId` nel `where` (il `PrismaService` usato dal MUD non ha l'estensione RLS); l'azienda viene **solo** da `requireRequestTenantId(req)`. Le uniche letture senza `tenantId` sono `cERCode` (catalogo EER globale) e, nell'atterraggio, `consultantTenantAssociation` col client di sistema vincolata a `consultantUserId = utente.id`.
- **Stesso controllo di ruolo per pagina e PDF**: `RuoloEffettivoService.accesso(req.user, tenantId)`; `null` → 403 `AZIENDA_NON_ACCESSIBILE`. Tutti e quattro i ruoli applicativi leggono il Bilancio.
- Niente costi in nessuna schermata né nel PDF.
- Testi dell'interfaccia, commenti e messaggi in italiano; termini tecnici in inglese. Numeri all'utente nel backend **solo** con `formattaQuantita`. Il codice dei rifiuti nell'interfaccia si chiama "EER".
- TDD obbligatorio: test prima, eseguito rosso, poi il codice.
- Comandi (mai la suite intera): backend `cd apps/backend && npx jest --runInBand <spec>`; tipi `cd apps/backend && npx tsc --noEmit -p tsconfig.json`; frontend `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=<spec>`; lint dalla root `npx eslint <file…>`. I test Karma non girano in nessun gate di CI: si eseguono qui.
- Stile prettier: `semi: false`, `singleQuote: true`, `printWidth: 100`, `trailingComma: es5`, `arrowParens: avoid`.
- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), stile `feat(bilancio): …` / `test(bilancio): …` / `refactor(bilancio): …`, **senza righe `Co-Authored-By` né altre attribuzioni**. Niente push.

## Review Focus

1. **Azienda senza movimenti nell'anno** (azienda appena creata, titolare VIEWER al primo accesso): la pagina e il PDF mostrano zeri, la lacuna `NESSUN_MOVIMENTO`, variazione e quote "n.d.", mai `NaN` né un errore 500. Test: Task 5 `'anno vuoto: zeri, NESSUN_MOVIMENTO, variazione e quota nulle'`, Task 9 `'anno vuoto: n.d. al posto delle percentuali'`.
2. **Basi a zero nei rapporti** (anno precedente senza prodotto; azienda che scarica senza produrre, cioè trasportatore o impianto): `variazione` e `pericolosi.quota` valgono `null`, i principali sono vuoti con il testo "Nessun rifiuto prodotto nel periodo.". Test: Task 5 `'solo scarichi: quota pericolosi nulla, principali vuoti'`, Task 1 `'variazione nulla con base zero'`.
3. **Anno fuori regola nella query** (`?anno=abc`, `1999`, anno futuro): 400 "Anno non valido" su entrambi gli endpoint con la stessa funzione; senza `anno` vale l'anno italiano corrente. Test: Task 7.
4. **Un contatore di un altro filone che fallisce** (Studio o deposito lanciano): quel segnale vale `null` con la lacuna `SEGNALE_NON_DISPONIBILE`, il resto della pagina c'è. Test: Task 4 `'un contatore che lancia vale null e non blocca gli altri'`.
5. **Nessuna azienda selezionata o nessun accesso** (SUPER_ADMIN in contesto globale, header di un'azienda non associata): 403 su pagina e PDF senza alcuna lettura; l'atterraggio ripiega su `/dashboard`. Test: Task 7 `'senza azienda: 403 e nessuna lettura'`, `'senza accesso: 403 anche sul PDF'`, Task 10 `'errore del backend: /dashboard'`.

---

## File

Backend (`apps/backend/src/`):
- Create `application/bilancio/bilancio.types.ts` — tipi della risposta, condivisi da servizio, PDF e controller.
- Create `application/bilancio/periodo-bilancio.ts` — periodo e confronto, puri.
- Create `application/bilancio/complementi-bilancio.ts` — i tre numeri che il MUD non dà, puri.
- Create `application/bilancio/lettore-movimenti-bilancio.ts` — lettura dei movimenti vigenti di un anno.
- Create `application/bilancio/dal-mud.ts` — sintesi pura di un `MudAggregato`.
- Create `application/bilancio/testi-bilancio.ts` — testi esatti di lacune e fonti.
- Create `application/bilancio/stato-mud-bilancio.service.ts`, `application/bilancio/segnali-aperti.ts`.
- Create `application/bilancio/bilancio.service.ts`, `application/bilancio/bilancio-pdf.ts`, `application/bilancio/atterraggio.service.ts`, `application/bilancio/bilancio.module.ts`.
- Create `api/bilancio/bilancio.controller.ts`.
- Modify `app.module.ts` (import di `BilancioModule`, accanto a `EsgModule` riga 113).
- Ogni file nuovo ha il suo `.spec.ts` accanto.

Frontend (`apps/frontend/src/app/`):
- Create `features/bilancio/bilancio.service.ts`, `features/bilancio/bilancio-formato.ts`, `features/bilancio/bilancio.component.ts`, `core/guards/atterraggio.guard.ts` (+ spec).
- Modify `app.routes.ts` (rotta vuota e `bilancio`), `shared/components/layout.component.ts` (`navMain`, riga 1278), `features/auth/auth-callback.component.ts:136`, `features/auth/login.component.ts:446,455`.

---

### Task 1: tipi, periodo e complementi puri

**Files:**
- Create: `apps/backend/src/application/bilancio/bilancio.types.ts`
- Create: `apps/backend/src/application/bilancio/periodo-bilancio.ts` + `periodo-bilancio.spec.ts`
- Create: `apps/backend/src/application/bilancio/complementi-bilancio.ts` + `complementi-bilancio.spec.ts`

**Interfaces:**
- Consumes: `classificaMovimento`, `operazioneDaCodice`, `operazioneDaCatalogo`, `MovimentoClassificabile` (`mud-regole.ts`); `CatalogoCausali` (`domain/waste-movement/catalogo-causali`); `convertiInKg`; `collegabilitaFir`, `FirPerStato`; `giornoItaliano`; per i test `righeCausaliSistema()` (`registro/causali/catalogo-causali.fixture.ts`) e `new CatalogoCausali(righe, [])`.
- Produces (in `bilancio.types.ts`, esatti):

```ts
export type BloccoBilancio =
  | 'PRODOTTO' | 'DESTINAZIONE' | 'PRINCIPALI' | 'PERICOLOSI'
  | 'MUD' | 'MESI' | 'SEGNALI' | 'GIACENZA'
export type CodiceLacuna =
  | 'NESSUN_MOVIMENTO' | 'UNITA_NON_CONVERTITE' | 'STIMA_PESO_SPECIFICO'
  | 'ESCLUSI_COME_NEL_MUD' | 'CONFRONTO_PARZIALE' | 'OPERAZIONE_DA_VERIFICARE'
  | 'PRELIMINARI_NON_COERENTI' | 'MESI_SENZA_MOVIMENTI' | 'SEGNALE_NON_DISPONIBILE'
export interface LacunaBilancio { blocco: BloccoBilancio; codice: CodiceLacuna; testo: string }
export interface PeriodoBilancio {
  anno: number
  dal: string            // 'AAAA-MM-GG', sempre il 1° gennaio
  al: string             // 'AAAA-MM-GG': oggi (anno in corso) o 31 dicembre
  annoInCorso: boolean
  alAnnoPrecedente: string // stesso giorno e mese di `al` nell'anno prima (29/02 -> 28/02)
  mesiDelPeriodo: number   // 1..12: mese di `al`
}
export type StatoMudBilancio =
  | 'DRAFT' | 'REVIEWING' | 'SUBMITTED' | 'ARCHIVED' | 'NON_INIZIATO' | 'NON_DOVUTO'
export interface RigaStatoMud {
  sede: string | null    // null finché il MUD non è per sede (F2-8)
  annoDati: number
  stato: StatoMudBilancio
  scadenza: string       // 'AAAA-MM-GG'
  fonteScadenza: 'TRACCIATO' | 'ORDINARIA'
  scaduta: boolean
}
export interface ConteggiSegnali {
  ritardiRegistro: number | null
  firSenzaRiscontro: number | null
  avvisiDeposito: number | null
}
export interface BilancioAzienda {
  periodo: PeriodoBilancio
  generatoIl: string     // ISO 8601
  fonti: Record<BloccoBilancio, string>
  prodotto: {
    kg: number
    confronto: { annoPrecedente: number; kgCorrente: number; kgPrecedente: number; variazione: number | null }
  }
  destinazione: {
    recuperoKg: number; smaltimentoKg: number
    diCuiR13Kg: number; diCuiD15Kg: number
    daVerificareKg: number; movimentiDaVerificare: number
  }
  principali: Array<{ cerCode: string; descrizione: string | null; kg: number }>
  pericolosi: { kg: number; quota: number | null }
  mud: { righe: RigaStatoMud[] }
  mesi: { conMovimenti: number[]; delPeriodo: number }
  segnali: ConteggiSegnali
  giacenzaFinePeriodoKg: number
  lacune: LacunaBilancio[]
}
```

- Produces (funzioni):
  - `periodoBilancio(anno: number, oggi: Date): PeriodoBilancio` — lancia `RangeError('Anno non valido')` se `anno < 2000` o `anno > annoSolareItaliano(oggi)`.
  - `variazione(corrente: number, precedente: number): number | null` — `(corrente - precedente) / precedente`, `null` se `precedente <= 0`.
  - In `complementi-bilancio.ts`: `interface FirBilancio extends FirPerStato { wasteOperationCode: string | null }`; `interface MovimentoBilancio extends MovimentoClassificabile { quantity: number; unit: string | null; operationCode: string | null; fir: FirBilancio | null }`; `prodottoNelPeriodo(catalogo: CatalogoCausali, movimenti: MovimentoBilancio[], al: string): number`; `operazionePreliminare(catalogo: CatalogoCausali, m: MovimentoBilancio): 'R13' | 'D15' | null`; `preliminariNelPeriodo(catalogo, movimenti, al): { r13Kg: number; d15Kg: number }`; `mesiConMovimenti(movimenti: Array<{ movementDate: Date }>, al: string): number[]` (mesi 1..12 ordinati, distinti).

- [ ] **Step 1: Write the failing tests**

`periodo-bilancio.spec.ts` (oggi = `new Date('2026-10-28T10:00:00Z')`):
- `'anno in corso: dal 1° gennaio a oggi'` → `{ anno: 2026, dal: '2026-01-01', al: '2026-10-28', annoInCorso: true, alAnnoPrecedente: '2025-10-28', mesiDelPeriodo: 10 }`.
- `'anno passato: anno intero'` (2024) → `al: '2024-12-31'`, `annoInCorso: false`, `alAnnoPrecedente: '2023-12-31'`, `mesiDelPeriodo: 12`.
- `'29 febbraio: l'anno prima si ferma al 28'` (oggi `2028-02-29T12:00:00Z`, anno 2028) → `alAnnoPrecedente: '2027-02-28'`.
- `'oggi in ora italiana: 31/12 alle 23:30 UTC è già il nuovo anno'` (oggi `2026-12-31T23:30:00Z`, anno 2027) → `al: '2027-01-01'`.
- `'anno futuro o prima del 2000: RangeError'` (2027 con oggi 2026-10-28; 1999).
- `'variazione nulla con base zero'` → `variazione(10, 0) === null`, `variazione(150, 100) === 0.5`, `variazione(50, 100) === -0.5`.

`complementi-bilancio.spec.ts` (catalogo = `new CatalogoCausali(righeCausaliSistema(), [])`; costruttore `mov({...})` con default `type: 'CARICO', causale: 'PRODUZIONE_INTERNA', causaleAziendaId: null, movementDate: new Date('2025-03-10T10:00:00Z'), quantity: 100, unit: 'KG', operationCode: null, fir: null`):
- `'prodotto: solo carichi con ruolo PRODOTTO, in kg'` → con `PRODUZIONE_INTERNA` 100 KG + `RECUPERO_PARZIALE` 1 T + `INGRESSO_ESTERNO` 500 KG + `RICLASSIFICAZIONE` carico 50 KG + scarico `AVVIO_RECUPERO` 70 KG: `prodottoNelPeriodo(...,'2025-12-31') === 1100`.
- `'prodotto: litri e m³ fuori'` → 100 KG + 30 `L` → 100.
- `'prodotto: giorno italiano entro al'` → movimento `2025-06-30T22:30:00Z` (è il 1° luglio in Italia) con `al: '2025-06-30'` → 0; con `al: '2025-07-01'` → conteggiato.
- `'preliminare: codice del movimento'` → scarico `CONFERIMENTO_TRASPORTATORE`, `operationCode: 'R 13'` → `'R13'`.
- `'preliminare: senza codice nel movimento vale il FIR, se la lettera coincide con la causale'` → `AVVIO_RECUPERO` (catalogo R), fir `{ status: 'COMPLETED', wasteOperationCode: 'R13', ... }` → `'R13'`; stessa cosa con `AVVIO_SMALTIMENTO` (catalogo D) → `null`.
- `'preliminare: il codice del movimento vince sulla causale'` → `AVVIO_SMALTIMENTO` con `operationCode: 'R13'` → `'R13'`.
- `'preliminare: R1 o D10 non sono preliminari'` → `null`.
- `'preliminare: carico, causale esclusa o FIR annullato -> null'` (fir `status: 'CANCELLED'`).
- `'preliminari: somma in kg per R13 e D15'` → `{ r13Kg, d15Kg }` attesi scritti a mano su 4 scarichi (uno in T).
- `'mesi con movimenti: qualunque tipo vigente, distinti e ordinati, entro al'` → movimenti di gennaio (carico), marzo (scarico), marzo, novembre con `al: '2025-10-31'` → `[1, 3]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx jest --runInBand src/application/bilancio/periodo-bilancio.spec.ts src/application/bilancio/complementi-bilancio.spec.ts`
Expected: FAIL, "Cannot find module './periodo-bilancio'".

- [ ] **Step 3: Implement**

`bilancio.types.ts` come sopra. `periodoBilancio`: `al` = `giornoItaliano(oggi)` se `anno === annoSolareItaliano(oggi)`, altrimenti `${anno}-12-31`; `alAnnoPrecedente` = stessa `MM-GG` in `anno-1`, con `02-29` → `02-28`. `prodottoNelPeriodo`: `m.type === 'CARICO'`, `classificaMovimento(catalogo, m) === 'PRODOTTO'`, `giornoItaliano(m.movementDate) <= al`, `convertiInKg` non nullo; somma arrotondata al grammo. `operazionePreliminare` ricompone la precedenza del MUD (discrepanza 1 sopra; commento che lo dichiara e rimanda a `recuperoOSmaltimento`):

```ts
// Stessa precedenza di MudAggregazioneService.recuperoOSmaltimento (privato, non importabile):
// codice del movimento, poi operazione della causale, poi codice del FIR.
if (m.type !== 'SCARICO' || classificaMovimento(catalogo, m) !== 'AVVIATO') return null
if (m.fir && !collegabilitaFir(m.fir).collegabile) return null
const lettera =
  operazioneDaCodice(m.operationCode) ??
  operazioneDaCatalogo(catalogo, m) ??
  (m.fir ? operazioneDaCodice(m.fir.wasteOperationCode) : undefined)
const codice = normalizza(m.operationCode?.trim() ? m.operationCode : m.fir?.wasteOperationCode)
if (codice === 'R13' && lettera === 'R') return 'R13'
if (codice === 'D15' && lettera === 'D') return 'D15'
return null
```
`normalizza` = maiuscolo senza caratteri diversi da lettere e cifre (`'R 13'` → `'R13'`). `preliminariNelPeriodo` usa `operazionePreliminare`, il filtro su `al` e `convertiInKg`.

- [ ] **Step 4: Run tests to verify they pass**

Run: stesso comando dello Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): periodo e complementi del bilancio sulle regole del MUD" -- apps/backend/src/application/bilancio/bilancio.types.ts apps/backend/src/application/bilancio/periodo-bilancio.ts apps/backend/src/application/bilancio/periodo-bilancio.spec.ts apps/backend/src/application/bilancio/complementi-bilancio.ts apps/backend/src/application/bilancio/complementi-bilancio.spec.ts
```

---

### Task 2: lettore dei movimenti e prova di coerenza col MUD

**Files:**
- Create: `apps/backend/src/application/bilancio/lettore-movimenti-bilancio.ts` + `lettore-movimenti-bilancio.spec.ts`

**Interfaces:**
- Consumes: `MovimentoBilancio`, `FirBilancio`, `prodottoNelPeriodo`, `preliminariNelPeriodo` (Task 1); `limitiAnnoMud`, `WHERE_VIGENTE`, `PrismaService` (`infrastructure/database/prisma.service`); `MudAggregazioneService` (solo nel test).
- Produces: `leggiMovimentiAnno(prisma: PrismaService, tenantId: string, anno: number): Promise<MovimentoBilancio[]>`.

- [ ] **Step 1: Write the failing tests**

Prisma finto con la stessa forma di `mud-aggregazione.service.spec.ts:91-114` (copiare quel blocco di `beforeEach` nel nuovo spec, non importarlo).
- `'legge i movimenti vigenti dell'anno italiano del tenant'` → `wasteMovement.findMany` chiamato con `where: { tenantId: 't1', movementDate: { gte: limitiAnnoMud(2025).inizio, lt: limitiAnnoMud(2025).fine }, ...WHERE_VIGENTE }` e un `select` che contiene `type, causale, causaleAziendaId, movementDate, quantity, unit, operationCode, firId`.
- `'FIR collegati letti nel tenant, solo se ci sono firId'` → senza `firId` nessuna chiamata a `fIR.findMany`; con due `firId` una chiamata con `where: { tenantId: 't1', id: { in: [...] } }` e `select` con `id, status, firNumber, rentriNumeroFir, rentriStatoFormulario, wasteOperationCode`; `quantity` Decimal (`new Prisma.Decimal('12.5')`) restituito come `12.5`; `fir` null se il FIR non si trova.
- `'prodotto e preliminari coerenti con il MUD sugli stessi movimenti'` → stesso prisma finto, 6 movimenti 2025 senza `firId` e in kg/t (produzione, recupero parziale, ricevuto da terzi, scarico `AVVIO_RECUPERO` con `operationCode: 'R13'`, scarico `AVVIO_SMALTIMENTO` con `operationCode: 'D15'`, scarico `AVVIO_RECUPERO` con `operationCode: 'R3'`); `const a = await new MudAggregazioneService(prisma, referenceData, logger).aggrega('t1', 2025)`; `const ms = await leggiMovimentiAnno(prisma, 't1', 2025)`; atteso `prodottoNelPeriodo(catalogo, ms, '2025-12-31')` uguale a `a.righe.reduce((s, r) => s + r.prodottoKg, 0)`, e `r13Kg <= somma recuperoKg`, `d15Kg <= somma smaltimentoKg`, con i valori scritti a mano.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx jest --runInBand src/application/bilancio/lettore-movimenti-bilancio.spec.ts`
Expected: FAIL, modulo mancante.

- [ ] **Step 3: Implement `leggiMovimentiAnno`**

Due query come nei test, ordine `movementDate asc, progressiveNumber asc`; `quantity` con `Number(...)`; `fir` agganciato dalla mappa per id.

- [ ] **Step 4: Run tests to verify they pass**

Run: stesso comando. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): lettura dei movimenti vigenti dell'anno, coerente col MUD" -- apps/backend/src/application/bilancio/lettore-movimenti-bilancio.ts apps/backend/src/application/bilancio/lettore-movimenti-bilancio.spec.ts
```

---

### Task 3: sintesi dal MUD, testi di lacune e fonti

**Files:**
- Create: `apps/backend/src/application/bilancio/dal-mud.ts` + `dal-mud.spec.ts`
- Create: `apps/backend/src/application/bilancio/testi-bilancio.ts` + `testi-bilancio.spec.ts`

**Interfaces:**
- Consumes: `MudAggregato`; `MudEsitoControllo`, `controlliMud` (solo nei test, per costruire controlli veri), `riepilogaAvvisi`, `CODICI_RIPARTIZIONE_RD`; `cerCanonico`; `formattaQuantita`, `formattaDataItaliana`; tipi del Task 1.
- Produces:

```ts
// dal-mud.ts
export interface VoceCerSintesi { cer6: string; cerCode: string; pericoloso: boolean; prodottoKg: number }
export interface SintesiMud {
  prodottoKg: number; recuperoKg: number; smaltimentoKg: number
  perCer: VoceCerSintesi[]        // tutte le righe del MUD, cerCode canonico con * se pericoloso
  pericolosiKg: number            // prodotto dei CER in pericolosiPerCer
  daVerificare: { kg: number; movimenti: number }
  nonConvertiti: number           // movimenti di UNITA_NON_DI_MASSA
  stimatiKg: number               // kg di CONVERTITO_CON_PESO_SPECIFICO
  esclusi: { kg: number; nonQuantificati: number }
  giacenzaKg: number              // GIACENZE_NON_CALCOLATE.kgNonDichiarati, 0 se assente
}
export function sintesiDalMud(a: Pick<MudAggregato, 'righe' | 'pericolosiPerCer' | 'controlli'>): SintesiMud

// testi-bilancio.ts
export function tonnellate(kg: number): string // formattaQuantita(Math.round(kg) / 1000) + ' t'
export const lacune: {
  nessunMovimento(): LacunaBilancio
  unitaNonConvertite(n: number): LacunaBilancio
  stimaPesoSpecifico(kg: number): LacunaBilancio
  esclusiComeNelMud(kg: number, nonQuantificati: number): LacunaBilancio
  confrontoParziale(annoPrecedente: number, anno: number, kgConfronto: number, kgMud: number): LacunaBilancio
  operazioneDaVerificare(kg: number, movimenti: number): LacunaBilancio
  preliminariNonCoerenti(): LacunaBilancio
  mesiSenzaMovimenti(mesi: number[]): LacunaBilancio   // mesi 1..12
  segnaleNonDisponibile(segnale: keyof ConteggiSegnali): LacunaBilancio
}
export function fontiBilancio(periodo: PeriodoBilancio, oggi: Date): Record<BloccoBilancio, string>
```

Testi esatti (copia fissata; `T` = `tonnellate(...)`, `AL` = `al` in `gg/mm/aaaa`, `OGGI` = `formattaDataItaliana(oggi)`):

| Codice | Blocco | Testo |
|---|---|---|
| NESSUN_MOVIMENTO | PRODOTTO | `Nessun movimento vigente nel registro per il periodo: i totali sono a zero.` |
| UNITA_NON_CONVERTITE | PRODOTTO | n=1: `Un movimento in un'unità diversa da kg e t (litri, m³ o altro) non ha il peso specifico: non è nei totali.`; n>1: `${n} movimenti in unità diverse da kg e t (litri, m³ o altro) non hanno il peso specifico: non sono nei totali.` |
| STIMA_PESO_SPECIFICO | PRODOTTO | `${T} vengono da litri o m³ convertiti con il peso specifico delle integrazioni del MUD: sono una stima.` |
| ESCLUSI_COME_NEL_MUD | PRODOTTO | `${T} del registro non sono conteggiati, con le stesse regole del MUD (causali escluse, FIR annullati o in bozza, doppi dello stesso FIR, rifiuti ricevuti da terzi): i motivi sono nella pagina MUD.` + se `nonQuantificati>0`: ` Altri ${nonQuantificati} movimenti esclusi non sono in kg.` (`Un altro movimento escluso non è in kg.` se 1) |
| CONFRONTO_PARZIALE | PRODOTTO | `Il confronto con il ${annoPrecedente} conta solo i movimenti in kg e t, senza pesi specifici e senza togliere i doppi dello stesso FIR: per il ${anno} risultano ${T(kgConfronto)} invece di ${T(kgMud)}.` |
| OPERAZIONE_DA_VERIFICARE | DESTINAZIONE | `${T} (${movimenti} movimenti) hanno recupero o smaltimento dedotto dal FIR o non indicato: sono la quota da verificare.` (`1 movimento` al singolare) |
| PRELIMINARI_NON_COERENTI | DESTINAZIONE | `La quota in operazioni preliminari (R13/D15) supera il totale di recupero o di smaltimento: probabilmente ci sono scarichi doppi dello stesso FIR. Verificare nella pagina MUD.` |
| MESI_SENZA_MOVIMENTI | MESI | `Mesi senza movimenti: ${nomi}. Un mese senza produzione è possibile: verificare che non manchino annotazioni.` (nomi minuscoli italiani separati da `, `) |
| SEGNALE_NON_DISPONIBILE | SEGNALI | `${nome}: conteggio non ancora disponibile.` con nome `Ritardi del registro` / `FIR senza riscontro` / `Avvisi del deposito temporaneo` |

Fonti esatte (`R` = `Dal registro di carico e scarico, movimenti al ${AL}`):
PRODOTTO `${R}: carichi vigenti con causale di produzione, con le regole del MUD.`; DESTINAZIONE `${R}: scarichi vigenti avviati a terzi; recupero o smaltimento dal codice operazione del movimento, poi dalla causale, poi dal FIR, come nel MUD.`; PRINCIPALI `${R}: prodotto per codice EER.`; PERICOLOSI `${R}: prodotto con codice EER pericoloso (asterisco).`; MUD `Stato registrato nella pagina MUD; scadenza dal tracciato dell'anno, altrimenti il 30 aprile.`; MESI `${R}: mesi con almeno un movimento vigente.`; GIACENZA `${R}: carichi e giacenze iniziali meno scarichi, solo kg e t.`; SEGNALI `Conteggi al ${OGGI}.`

- [ ] **Step 1: Write the failing tests**

`dal-mud.spec.ts` (aggregati scritti a mano; controlli costruiti con `controlliMud.*` veri):
- `'totali = somma delle righe del MUD, al grammo'`; `'cerCode canonico con asterisco solo se pericoloso'` (`righe: [{ cerCode: '150101', ... }, { cerCode: '130205', ... }]`, `pericolosiPerCer: { '130205': true }` → `'15 01 01'`, `'13 02 05*'`); `'pericolosi = prodotto dei CER pericolosi'`.
- `'da verificare: kg e movimenti di OPERAZIONE_DEDOTTA_DAL_FIR e OPERAZIONE_NON_INDICATA'`.
- `'non convertiti: movimenti di UNITA_NON_DI_MASSA'`; `'stimati: kg di CONVERTITO_CON_PESO_SPECIFICO'`.
- `'esclusi: kg in meno del riepilogo avvisi, senza le giacenze'` → con `causaleEsclusa` (30 KG) e `giacenzeNonCalcolate(2025, [{ cerCode6: '150101', kg: 200 }])`: `esclusi.kg === 30`, `giacenzaKg === 200`.
- `'senza GIACENZE_NON_CALCOLATE la giacenza è 0'`.

`testi-bilancio.spec.ts`: un `it` per codice che confronta `testo` carattere per carattere con la tabella (singolare e plurale dove previsti); `'tonnellate: 1234567 kg -> "1.234,567 t"'`; `'fonti: ogni blocco ha la sua fonte con la data del periodo'` (periodo 2026 al `2026-10-28` → `PRODOTTO` contiene `movimenti al 28/10/2026`); `'nessun testo usa dichiarazione o attestazione'` (tutti i testi e le fonti non combaciano con `/dichiar|attest|certific/i`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx jest --runInBand src/application/bilancio/dal-mud.spec.ts src/application/bilancio/testi-bilancio.spec.ts`
Expected: FAIL, moduli mancanti.

- [ ] **Step 3: Implement** `sintesiDalMud` (esclusi = `riepilogaAvvisi(controlli.filter(c => c.codice !== 'GIACENZE_NON_CALCOLATE'))`, campi `kgInMeno` e `movimentiNonQuantificati`; da verificare = controlli con codice in `CODICI_RIPARTIZIONE_RD`, somma di `movimenti[].kg` non nulli e numero di movimenti) e `testi-bilancio.ts`.

- [ ] **Step 4: Run tests to verify they pass** — stesso comando, PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): sintesi dall'aggregazione MUD, testi di lacune e fonti" -- apps/backend/src/application/bilancio/dal-mud.ts apps/backend/src/application/bilancio/dal-mud.spec.ts apps/backend/src/application/bilancio/testi-bilancio.ts apps/backend/src/application/bilancio/testi-bilancio.spec.ts
```

---

### Task 4: stato del MUD e porte dei segnali aperti

**Files:**
- Create: `apps/backend/src/application/bilancio/stato-mud-bilancio.service.ts` + spec
- Create: `apps/backend/src/application/bilancio/segnali-aperti.ts` + `segnali-aperti.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `MudVersionRegistry.scadenzaPresentazione(annoDati)`, `MudObbligoService.leggi(tenantId)`, `giornoItaliano`, `LoggerService`; tipi del Task 1.
- Produces:

```ts
@Injectable() export class StatoMudBilancioService {
  constructor(prisma: PrismaService, registry: MudVersionRegistry, obbligo: MudObbligoService)
  righe(tenantId: string, annoDati: number, oggi: Date): Promise<RigaStatoMud[]>
}
export interface ContatoreSegnale { conta(tenantId: string, oggi: Date): Promise<number> }
export const CONTATORE_RITARDI_REGISTRO = Symbol('CONTATORE_RITARDI_REGISTRO')
export const CONTATORE_FIR_SENZA_RISCONTRO = Symbol('CONTATORE_FIR_SENZA_RISCONTRO')
export const CONTATORE_AVVISI_DEPOSITO = Symbol('CONTATORE_AVVISI_DEPOSITO')
@Injectable() export class SegnaliApertiService {
  constructor(
    logger: LoggerService,
    @Optional() @Inject(CONTATORE_RITARDI_REGISTRO) ritardi?: ContatoreSegnale,
    @Optional() @Inject(CONTATORE_FIR_SENZA_RISCONTRO) senzaRiscontro?: ContatoreSegnale,
    @Optional() @Inject(CONTATORE_AVVISI_DEPOSITO) deposito?: ContatoreSegnale
  )
  conteggi(tenantId: string, oggi: Date): Promise<ConteggiSegnali>
}
```

Il contratto per Studio e F2-6 (commento di testa di `segnali-aperti.ts`): `conta` restituisce il numero di segnali **aperti oggi** per **una** azienda, calcolato dallo **stesso servizio** che alimenta `dashboard/attenzione`, mai una seconda regola; deve filtrare per `tenantId`.

- [ ] **Step 1: Write the failing tests**

`stato-mud-bilancio.service.spec.ts` (registry vero `new MudVersionRegistry()`, `oggi = new Date('2026-10-28T10:00:00Z')`):
- `'una riga senza sede, stato da MUDReport dell'anno dei dati'` → `mUDReport.findUnique` chiamato con `{ where: { tenantId_year: { tenantId: 't1', year: 2025 } }, select: { status: true } }`; status `SUBMITTED` → `[{ sede: null, annoDati: 2025, stato: 'SUBMITTED', scadenza: '2026-07-03', fonteScadenza: 'TRACCIATO', scaduta: false }]` (la data viene da `scadenzaPresentazione` di `export/versions/mud-tracciato-v604-2025.ts`: se il file dice altro, vale il file).
- `'nessun record: NON_INIZIATO, scaduto dopo la scadenza'` → `scaduta: true`.
- `'anno non censito: 30 aprile, fonte ORDINARIA'` (annoDati 2030, oggi 2031-03-01 → `scadenza: '2031-04-30'`, `scaduta: false`).
- `'azienda non tenuta: NON_DOVUTO, mai scaduto'` (`obbligo.leggi` → `{ mudNonDovuto: true, ... }`).
- `'DRAFT il giorno della scadenza non è ancora scaduto'` (confronto per giorno italiano: scaduto solo se `giornoItaliano(oggi) > scadenza`).

`segnali-aperti.spec.ts`:
- `'senza contatori: tutti null'`.
- `'con i contatori: i loro conteggi, con tenant e oggi passati'`.
- `'un contatore che lancia vale null e non blocca gli altri'` → `logger.warn` chiamato una volta.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx jest --runInBand src/application/bilancio/stato-mud-bilancio.service.spec.ts src/application/bilancio/segnali-aperti.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** come da interfacce (i tre contatori in parallelo con `Promise.all`, ognuno in un `try/catch` proprio).

- [ ] **Step 4: Run tests to verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): stato del MUD con scadenza del tracciato e porte dei segnali aperti" -- apps/backend/src/application/bilancio/stato-mud-bilancio.service.ts apps/backend/src/application/bilancio/stato-mud-bilancio.service.spec.ts apps/backend/src/application/bilancio/segnali-aperti.ts apps/backend/src/application/bilancio/segnali-aperti.spec.ts
```

---

### Task 5: BilancioService

**Files:**
- Create: `apps/backend/src/application/bilancio/bilancio.service.ts` + `bilancio.service.spec.ts`

**Interfaces:**
- Consumes: tutto dei Task 1-4; `MudAggregazioneService.aggrega(tenantId, anno)`; `caricaCatalogoCausali(prisma, tenantId)`; `chiaveConfrontoCer`.
- Produces:

```ts
@Injectable() export class BilancioService {
  constructor(
    prisma: PrismaService,
    mud: MudAggregazioneService,
    statoMud: StatoMudBilancioService,
    segnali: SegnaliApertiService
  )
  calcola(tenantId: string, anno: number, oggi?: Date): Promise<BilancioAzienda> // oggi default new Date()
  aziendaPerPdf(tenantId: string): Promise<{ ragioneSociale: string; partitaIva: string | null }>
}
```

Composizione (le regole stanno nei Task 1-4, qui solo il cablaggio):
- `periodo = periodoBilancio(anno, oggi)`; `aggregato = await mud.aggrega(tenantId, anno)`; `sintesi = sintesiDalMud(aggregato)`; catalogo una volta; `leggiMovimentiAnno` per `anno` e `anno - 1`.
- `prodotto.kg = sintesi.prodottoKg`; `confronto.kgCorrente = prodottoNelPeriodo(cat, movAnno, periodo.al)`, `kgPrecedente = prodottoNelPeriodo(cat, movPrec, periodo.alAnnoPrecedente)`, `variazione = variazione(kgCorrente, kgPrecedente)`; lacuna `CONFRONTO_PARZIALE` se `|kgCorrente - sintesi.prodottoKg| > 0.5`.
- `destinazione`: R e D dalla sintesi; `diCui*` da `preliminariNelPeriodo(cat, movAnno, periodo.al)`; lacuna `PRELIMINARI_NON_COERENTI` se `r13Kg > recuperoKg + 0.5` o `d15Kg > smaltimentoKg + 0.5`; `OPERAZIONE_DA_VERIFICARE` se `daVerificare.movimenti > 0`.
- `principali`: `sintesi.perCer` con `prodottoKg > 0`, ordine `prodottoKg` desc poi `cer6` asc, primi 3; descrizione da **una** query `prisma.cERCode.findMany({ where: { code: { in: <forme canoniche con e senza *> } }, select: { code: true, description: true } })`, abbinata per `chiaveConfrontoCer`; `null` se assente.
- `pericolosi = { kg: sintesi.pericolosiKg, quota: prodotto > 0 ? pericolosiKg / prodottoKg : null }`.
- `mud.righe = statoMud.righe(tenantId, anno - 1, oggi)`.
- `mesi = { conMovimenti: mesiConMovimenti(movAnno, periodo.al), delPeriodo: periodo.mesiDelPeriodo }`; lacuna `MESI_SENZA_MOVIMENTI` con i mesi `1..delPeriodo` assenti, solo se ce n'è almeno uno **e** l'anno ha movimenti.
- `segnali = segnali.conteggi(tenantId, oggi)`; una lacuna `SEGNALE_NON_DISPONIBILE` per ogni `null`.
- `giacenzaFinePeriodoKg = sintesi.giacenzaKg` (commento: dipende da `GIACENZE_NON_CALCOLATE`; Task 11 obbligatorio dopo F2-8).
- Lacune dalla sintesi: `NESSUN_MOVIMENTO` se `movAnno.length === 0`; `UNITA_NON_CONVERTITE` se `nonConvertiti > 0`; `STIMA_PESO_SPECIFICO` se `stimatiKg > 0`; `ESCLUSI_COME_NEL_MUD` se `esclusi.kg > 0 || esclusi.nonQuantificati > 0`.
- `fonti = fontiBilancio(periodo, oggi)`, `generatoIl = oggi.toISOString()`.
- `aziendaPerPdf`: `prisma.tenant.findUnique({ where: { id: tenantId }, select: { ragioneSociale: true, partitaIva: true } })` — **mai** `codiceFiscale`.

- [ ] **Step 1: Write the failing tests**

Mock di `MudAggregazioneService` (`aggrega: jest.fn()` che restituisce aggregati scritti a mano), di `StatoMudBilancioService`, `SegnaliApertiService`; prisma finto con `causaleRegistro`, `causaleRegistroAzienda`, `wasteMovement.findMany` (per anno, guardando `args.where.movementDate.gte`), `fIR.findMany`, `cERCode.findMany`, `tenant.findUnique`.
- `'i totali del prodotto e di R/D sono quelli del MUD'` → `prodotto.kg`, `recuperoKg`, `smaltimentoKg` uguali alla somma delle `righe` dell'aggregato; `aggrega` chiamato con `('t1', 2025)`.
- `'confronto: stesso periodo dell'anno prima, variazione'` → oggi `2026-10-28`, movimenti 2026 e 2025 con valori a mano; un movimento 2025 del 15/11 non entra.
- `'confronto parziale dichiarato quando la base differisce dal MUD'` → aggregato con prodotto 1000, movimenti per 900 → lacuna `CONFRONTO_PARZIALE` con il testo del Task 3.
- `'tre principali per prodotto con la descrizione del catalogo EER'` (4 CER, uno senza descrizione → `null`; parità di kg ordinata per CER).
- `'anno vuoto: zeri, NESSUN_MOVIMENTO, variazione e quota nulle'` → aggregato con `righe: []`, nessun movimento: `prodotto.kg 0`, `variazione null`, `pericolosi.quota null`, `principali []`, `lacune` con `NESSUN_MOVIMENTO` e **senza** `MESI_SENZA_MOVIMENTI`.
- `'solo scarichi: quota pericolosi nulla, principali vuoti'`.
- `'mesi senza movimenti dichiarati'` → movimenti in 1, 2, 4 con `al` a fine aprile → lacuna con `marzo`.
- `'giacenza dal saldo del registro calcolato dal MUD'` (controllo `giacenzeNonCalcolate` → `giacenzaFinePeriodoKg`).
- `'segnali non disponibili dichiarati uno per uno'`.
- `'MUD: righe dell'anno dei dati precedente'` → `statoMud.righe` chiamato con `('t1', 2025, oggi)` per anno 2026.
- `'isolamento: ogni query del tenant porta tenantId'` → per ogni chiamata di `wasteMovement.findMany`, `fIR.findMany`, `causaleRegistroAzienda.findMany`, `tenant.findUnique` il `where` porta `t1` (`tenantId` o `id`).
- `'azienda per il PDF: solo ragione sociale e partita IVA'` → `select` esattamente `{ ragioneSociale: true, partitaIva: true }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx jest --runInBand src/application/bilancio/bilancio.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `BilancioService`** come sopra.

- [ ] **Step 4: Run tests to verify they pass** — PASS; poi `npx tsc --noEmit -p tsconfig.json` senza errori.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): calcolo del bilancio dall'aggregazione MUD con lacune dichiarate" -- apps/backend/src/application/bilancio/bilancio.service.ts apps/backend/src/application/bilancio/bilancio.service.spec.ts
```

---

### Task 6: PDF informativo

**Files:**
- Create: `apps/backend/src/application/bilancio/bilancio-pdf.ts` + `bilancio-pdf.spec.ts`

**Interfaces:**
- Consumes: `BilancioAzienda` (Task 1), `tonnellate` e testi (Task 3), `formattaDataItaliana`, `formattaDataOraItaliana`, `formattaQuantita`, `TDocumentDefinitions` da `pdfmake/interfaces`, `LoggerService`.
- Produces:

```ts
export const TESTATA_BILANCIO =
  'Documento informativo interno. NON sostituisce il MUD né il registro di carico e scarico.'
export interface AziendaPdf { ragioneSociale: string; partitaIva: string | null }
export function documentoBilancio(b: BilancioAzienda, azienda: AziendaPdf): TDocumentDefinitions
@Injectable() export class BilancioPdfService {
  constructor(logger: LoggerService)
  genera(b: BilancioAzienda, azienda: AziendaPdf): Promise<Buffer>
}
```

Contenuto: `header` (funzione) con `TESTATA_BILANCIO` su ogni pagina; in testa al contenuto titolo `Bilancio rifiuti ${anno}`, `${ragioneSociale}` e `P.IVA ${partitaIva}` (riga omessa se null), `Periodo: dal ${dal} al ${al}` e `Generato il ${formattaDataOraItaliana(generatoIl)}`; un blocco per `BloccoBilancio` nell'ordine del tipo, ognuno con i suoi numeri, la riga `Fonte: ${fonti[blocco]}` e le lacune del blocco come elenco; `footer` `Pagina ${n} di ${tot}`. Stato MUD in italiano: DRAFT `In preparazione`, REVIEWING `In verifica`, SUBMITTED `Presentato`, ARCHIVED `Archiviato`, NON_INIZIATO `Non iniziato`, NON_DOVUTO `Non dovuto`. Segnale `null` → `non disponibile`. Nessuna immagine, nessun logo, nessun costo. Il printer si inizializza come `pdf.service.ts:33-45` (stessi font Roboto da `pdfmake/build/vfs_fonts`) e il buffer si raccoglie come `:389-397`.

- [ ] **Step 1: Write the failing tests** (fixture `BilancioAzienda` completa con almeno una lacuna per blocco; `contenuto = JSON.stringify(documentoBilancio(b, azienda).content)`)
- `'testata esatta su ogni pagina'` → `JSON.stringify((doc.header as Function)(1, 3, {}))` contiene `TESTATA_BILANCIO`, e anche per la pagina 3.
- `'data e ora di generazione e periodo coperto'` → contiene `Generato il 28/10/2026 11:00` (con `generatoIl: '2026-10-28T10:00:00.000Z'`) e `Periodo: dal 01/01/2026 al 28/10/2026`.
- `'la fonte di ogni blocco'` → per ogni valore di `b.fonti` il contenuto lo contiene.
- `'le stesse avvertenze dello schermo'` → ogni `b.lacune[i].testo` è nel contenuto.
- `'nessuna immagine né logo'` → l'intero `JSON.stringify(doc)` non contiene `"image"`.
- `'nessuna formula di dichiarazione o attestazione'` → `JSON.stringify(doc)` non combacia con `/dichiar|attest|certific/i`.
- `'nessun codice fiscale'` → passando `{ ragioneSociale: 'Rossi Mario', partitaIva: '01234567890', codiceFiscale: 'RSSMRA80A01H501U' } as AziendaPdf`, il documento non contiene `RSSMRA80A01H501U`.
- `'nessun costo'` → il documento non contiene `€` né `/costo|prezzo|importo/i`.
- `'genera un PDF'` → `(await new BilancioPdfService(logger).genera(b, azienda)).subarray(0, 4).toString() === '%PDF'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx jest --runInBand src/application/bilancio/bilancio-pdf.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `documentoBilancio` e `BilancioPdfService`.

- [ ] **Step 4: Run tests to verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): PDF informativo con testata, fonti e avvertenze" -- apps/backend/src/application/bilancio/bilancio-pdf.ts apps/backend/src/application/bilancio/bilancio-pdf.spec.ts
```

---

### Task 7: atterraggio, controller e modulo

**Files:**
- Create: `apps/backend/src/application/bilancio/atterraggio.service.ts` + spec
- Create: `apps/backend/src/api/bilancio/bilancio.controller.ts` + `bilancio.controller.spec.ts`
- Create: `apps/backend/src/application/bilancio/bilancio.module.ts` + `bilancio.module.spec.ts`
- Modify: `apps/backend/src/app.module.ts` (import accanto a `EsgModule`, righe 31 e 113)

**Interfaces:**
- Consumes: `BilancioService`, `BilancioPdfService`, `RuoloEffettivoService.accesso`, `associazioneConsulenteValida(consultantUserId)` (`api/me/ruolo-effettivo.service.ts:26`), `PrismaSistemaService`, `requireRequestTenantId`, `resolveRequestTenantId`, `annoSolareItaliano`, `JwtAuthGuard`.
- Produces:

```ts
export type DestinazioneAtterraggio = 'BILANCIO' | 'CONSULENTE' | 'DASHBOARD'
@Injectable() export class AtterraggioService {
  constructor(sistema: PrismaSistemaService, membership: RuoloEffettivoService)
  destinazione(utente: { id: string; role: string; tenantId?: string | null }, tenantId: string | null): Promise<DestinazioneAtterraggio>
}
```
Regole, in quest'ordine: `SUPER_ADMIN` → `DASHBOARD`; almeno una associazione consulente valida (`sistema.consultantTenantAssociation.count({ where: associazioneConsulenteValida(utente.id) })`) → `CONSULENTE`; `tenantId` null → `DASHBOARD`; `accesso(utente, tenantId) === 'VIEWER'` → `BILANCIO`; altrimenti `DASHBOARD`.

Rotte (`@Controller('bilancio')`, `@UseGuards(JwtAuthGuard)`, `@ApiTags('Bilancio')`, `@ApiBearerAuth()`):
- `GET /bilancio?anno=` → `BilancioAzienda`.
- `GET /bilancio/pdf?anno=` → `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="bilancio-rifiuti-${anno}.pdf"`, `Content-Length`, `Cache-Control: no-store`; `res.send(buffer)`.
- `GET /bilancio/atterraggio` → `{ destinazione }` (usa `resolveRequestTenantId`, non fallisce senza azienda).

Le prime due passano, **prima di ogni lettura**, dallo stesso metodo privato `autorizza(req): Promise<string>` (restituisce il `tenantId`) che fa `requireRequestTenantId(req)` e `accesso(req.user, tenantId)`; `null` → `ForbiddenException({ message: "Non hai accesso ai dati di questa azienda.", error: 'AZIENDA_NON_ACCESSIBILE' })`. L'anno passa da una sola funzione `annoDallaQuery(valore: string | undefined, oggi: Date): number`: assente → `annoSolareItaliano(oggi)`; non `^\d{4}$`, `< 2000` o `> annoSolareItaliano(oggi)` → `BadRequestException('Anno non valido')`.

`BilancioModule`: `imports: [PrismaModule, LoggerModule, MUDModule]`; `controllers: [BilancioController]`; `providers: [BilancioService, StatoMudBilancioService, SegnaliApertiService, BilancioPdfService, AtterraggioService, MudVersionRegistry]`. `RuoloEffettivoModule` è globale (`ruolo-effettivo.module.ts:20`), non si importa.

- [ ] **Step 1: Write the failing tests**

`atterraggio.service.spec.ts`: `'SUPER_ADMIN: DASHBOARD'`; `'consulente con associazione valida: CONSULENTE anche se VIEWER'` (verifica il `where` con `consultantUserId: 'u1'`); `'VIEWER senza associazioni: BILANCIO'`; `'ADMIN o OPERATOR: DASHBOARD'`; `'nessuna azienda selezionata: DASHBOARD'`.

`bilancio.controller.spec.ts` (servizi finti, come `esg.controller.spec.ts`; `req = { tenantId: 'B', user: { id: 'u1', tenantId: 'A', role: 'VIEWER' } }`):
- `'usa l'azienda selezionata, non quella del token'` → `calcola('B', 2025, expect.any(Date))`.
- `'senza anno: anno italiano corrente'`.
- `'anno non valido: 400 su entrambi gli endpoint'` (`'abc'`, `'1999'`, anno corrente + 1).
- `'senza azienda: 403 e nessuna lettura'` → `req = { user: { id: 'u1' } }`, `calcola` e `genera` mai chiamati.
- `'senza accesso: 403 anche sul PDF'` → `accesso` → `null` su entrambe le rotte, nessuna lettura.
- `'PDF: intestazioni e corpo'` → `res.set` con i quattro header sopra e `res.send` col buffer; `aziendaPerPdf('B')`.
- `'atterraggio: inoltra utente e azienda selezionata'`.

`bilancio.module.spec.ts`: come `esg.module.spec.ts`, risolve `BilancioService`, `BilancioController`, `SegnaliApertiService`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/backend && npx jest --runInBand src/application/bilancio/atterraggio.service.spec.ts src/api/bilancio/bilancio.controller.spec.ts src/application/bilancio/bilancio.module.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** servizio, controller, modulo; aggiungere `BilancioModule` in `app.module.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: lo stesso comando più le guardie esistenti `src/api/controller-tenant-selezionato.spec.ts src/api/nessun-user-userid.spec.ts src/api/nessuna-shell-esposta.spec.ts`. Expected: PASS. Poi `npx tsc --noEmit -p tsconfig.json` e `npx eslint apps/backend/src/application/bilancio apps/backend/src/api/bilancio` dalla root: nessun errore.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): endpoint del bilancio, PDF e atterraggio con lo stesso controllo di accesso" -- apps/backend/src/application/bilancio/atterraggio.service.ts apps/backend/src/application/bilancio/atterraggio.service.spec.ts apps/backend/src/api/bilancio/bilancio.controller.ts apps/backend/src/api/bilancio/bilancio.controller.spec.ts apps/backend/src/application/bilancio/bilancio.module.ts apps/backend/src/application/bilancio/bilancio.module.spec.ts apps/backend/src/app.module.ts
```

---

### Task 8: client frontend e formattazione

**Files:**
- Create: `apps/frontend/src/app/features/bilancio/bilancio.service.ts` + `bilancio.service.spec.ts`
- Create: `apps/frontend/src/app/features/bilancio/bilancio-formato.ts` + `bilancio-formato.spec.ts`

**Interfaces:**
- Consumes: le rotte del Task 7; `environment.apiUrl`.
- Produces: in `bilancio.service.ts` gli stessi tipi del backend (`BilancioAzienda`, `RigaStatoMud`, `StatoMudBilancio`, `LacunaBilancio`, `BloccoBilancio`, `ConteggiSegnali`, `DestinazioneAtterraggio`) ricopiati come interfacce, e

```ts
@Injectable({ providedIn: 'root' }) export class BilancioService {
  carica(anno?: number): Observable<BilancioAzienda>             // GET `${apiUrl}/bilancio`, param anno se dato
  scaricaPdf(anno: number): Observable<HttpResponse<Blob>>       // GET `${apiUrl}/bilancio/pdf`, blob, observe response
  atterraggio(): Observable<{ destinazione: DestinazioneAtterraggio }> // GET `${apiUrl}/bilancio/atterraggio`
}
```
In `bilancio-formato.ts`: `tonnellate(kg: number): string` (`Intl.NumberFormat('it-IT', { maximumFractionDigits: 3, useGrouping: true })` su `Math.round(kg) / 1000`, più `' t'`); `percentuale(q: number | null): string` (`null` → `'n.d.'`, altrimenti una cifra decimale con segno per le variazioni: `percentuale(0.123, true)` → `'+12,3 %'`; firma `percentuale(q: number | null, conSegno = false)`); `quoteBarra(recuperoKg: number, smaltimentoKg: number): { recupero: number; smaltimento: number }` (percentuali intere che sommano 100; entrambe 0 se il totale è 0); `nomeMese(m: number): string` (`1` → `'gennaio'`); `mesiSenzaMovimenti(conMovimenti: number[], delPeriodo: number): number[]`; `ETICHETTA_STATO_MUD: Record<StatoMudBilancio, string>` (stesse etichette del Task 6); `anniSelezionabili(oggi: Date): number[]` (anno corrente e i quattro precedenti, decrescenti).

- [ ] **Step 1: Write the failing tests**

`bilancio.service.spec.ts` (`HttpTestingController` come `features/mud/mud.service.spec.ts`): `'carica senza anno non manda il parametro'`, `'carica con anno'`, `'scaricaPdf chiede un blob'`, `'atterraggio'`.
`bilancio-formato.spec.ts`: `tonnellate(1234567) === '1.234,567 t'`, `tonnellate(0) === '0 t'`; `percentuale(null) === 'n.d.'`, `percentuale(0.375) === '37,5 %'`, `percentuale(-0.05, true) === '-5 %'`; `quoteBarra(1, 2)` → `{ recupero: 33, smaltimento: 67 }`, `quoteBarra(0, 0)` → `{ 0, 0 }`; `mesiSenzaMovimenti([1, 3], 4)` → `[2, 4]`; `anniSelezionabili(new Date('2026-10-28'))` → `[2026, 2025, 2024, 2023, 2022]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/bilancio/bilancio.service.spec.ts --include=src/app/features/bilancio/bilancio-formato.spec.ts`
Expected: FAIL (errore di compilazione: moduli mancanti).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run tests to verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): client e formattazione del bilancio nel frontend" -- apps/frontend/src/app/features/bilancio/bilancio.service.ts apps/frontend/src/app/features/bilancio/bilancio.service.spec.ts apps/frontend/src/app/features/bilancio/bilancio-formato.ts apps/frontend/src/app/features/bilancio/bilancio-formato.spec.ts
```

---

### Task 9: pagina Bilancio, rotta e voce di menu

**Files:**
- Create: `apps/frontend/src/app/features/bilancio/bilancio.component.ts` + `bilancio.component.spec.ts`
- Modify: `apps/frontend/src/app/app.routes.ts` (rotta `bilancio` accanto a `esg`, riga 116)
- Modify: `apps/frontend/src/app/shared/components/layout.component.ts:1278` (`navMain`: `{ label: 'Bilancio', route: '/bilancio', icon: 'pi pi-chart-pie' }` subito dopo Dashboard, senza `feature`: sempre visibile come la Dashboard)

**Interfaces:**
- Consumes: Task 8; `ToastService` se serve per gli errori del PDF; classi globali del design system (`.page`, `.page-header`, `.stat-grid`, `.stat-card`, `.surface-card`, `.empty-state`) e token `--color-success`, `--color-warning`, `--color-danger` (`styles.scss`), come `dashboard-page.component.ts`.
- Produces: `BilancioComponent` (selector `app-bilancio`, standalone) con `anno = signal<number>`, `dati = signal<BilancioAzienda | null>`, `errore = signal<string | null>`, `cambiaAnno(anno: number): void`, `scaricaPdf(): void`.

Pagina (un solo `h1`: `Bilancio rifiuti`, sottotitolo `Quanto produce l'azienda, dove va e se il MUD è a posto`): selettore anno (`p-dropdown` su `anniSelezionabili`), pulsante `Scarica PDF` (`pi pi-file-pdf`), nota fissa con `TESTATA_BILANCIO` (stessa frase del PDF, ricopiata come costante nel componente). Blocchi in quest'ordine, ognuno in una `surface-card` con titolo, numeri, riga `Fonte: …` e le lacune del blocco (`lacune.filter(l => l.blocco === …)`) in un elenco `role="note"`:
1. **Prodotto**: `tonnellate(prodotto.kg)`; `rispetto allo stesso periodo del ${annoPrecedente}: ${percentuale(variazione, true)}`.
2. **Recupero e smaltimento**: barra a due colori (due `div` con `width` da `quoteBarra`, `role="img"` e `aria-label` `Recupero ${r} %, smaltimento ${s} %`), legenda con tonnellate; `di cui in operazioni preliminari: R13 ${t}, D15 ${t}`; `da verificare: ${t}`.
3. **Rifiuti principali**: tabella EER, descrizione, tonnellate; vuota → `Nessun rifiuto prodotto nel periodo.`
4. **Rifiuti pericolosi**: `percentuale(quota)` e tonnellate.
5. **MUD**: una riga per `mud.righe` (sede o `Azienda`, `MUD sui dati ${annoDati}`, `p-tag` con `ETICHETTA_STATO_MUD`, `entro il ${gg/mm/aaaa}`, `scaduto` in rosso se `scaduta`), link a `/mud`.
6. **Mesi con movimenti**: `${conMovimenti.length} mesi su ${delPeriodo}`.
7. **Segnali aperti**: tre righe con conteggio e link (`/registro`, `/fir`, `/giacenze`), `non ancora disponibile` se `null`.
8. **Giacenza a fine periodo**: tonnellate.

Errori: 403 → `Non hai accesso ai dati di questa azienda, oppure nessuna azienda è selezionata.`; altri → `Impossibile caricare il bilancio.` con `Riprova`. PDF: blob scaricato come `mud.component.ts:1159-1173` (`filenameFrom`, `triggerDownload`, ricopiati in privato nel componente), errore → toast `Impossibile scaricare il PDF del bilancio.`

- [ ] **Step 1: Write the failing test** (`bilancio.component.spec.ts`, `BilancioService` finto con `of(fixture)`, `provideRouter([])`)
- `'mostra prodotto, variazione e fonte'` → testo `12,5 t`, `+10 %`, la fonte PRODOTTO.
- `'barra recupero e smaltimento con aria-label'` → `aria-label` `Recupero 60 %, smaltimento 40 %`.
- `'principali e stato del MUD in italiano'` → `15 01 01`, `In preparazione`, `scaduto` quando `scaduta: true`.
- `'segnali non disponibili'` → `non ancora disponibile` tre volte con fixture tutta `null`.
- `'ogni lacuna sotto il suo blocco'`.
- `'anno vuoto: n.d. al posto delle percentuali'`.
- `'cambio anno ricarica'` → `carica` chiamato con `2025` dopo `cambiaAnno(2025)`.
- `'PDF dell'anno scelto'` → `scaricaPdf(2025)`.
- `'403: messaggio di accesso'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/bilancio/bilancio.component.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** componente, rotta (`path: 'bilancio', loadComponent: () => import('./features/bilancio/bilancio.component').then(m => m.BilancioComponent)`) e voce di menu.

- [ ] **Step 4: Run tests to verify they pass** — il comando dello Step 2 più `--include=src/app/shared/components/layout.component.spec.ts`: PASS. Poi `cd apps/frontend && npx ng build` senza errori e `npx eslint apps/frontend/src/app/features/bilancio` dalla root.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): pagina Bilancio rifiuti con blocchi, lacune e PDF" -- apps/frontend/src/app/features/bilancio/bilancio.component.ts apps/frontend/src/app/features/bilancio/bilancio.component.spec.ts apps/frontend/src/app/app.routes.ts apps/frontend/src/app/shared/components/layout.component.ts
```

---

### Task 10: atterraggio dopo il login

**Files:**
- Create: `apps/frontend/src/app/core/guards/atterraggio.guard.ts` + `atterraggio.guard.spec.ts`
- Modify: `apps/frontend/src/app/app.routes.ts` (la voce `{ path: '', redirectTo: 'dashboard', pathMatch: 'full' }` dentro il layout, righe 55-59)
- Modify: `apps/frontend/src/app/features/auth/auth-callback.component.ts:136` (`['/dashboard']` → `['/']`)
- Modify: `apps/frontend/src/app/features/auth/login.component.ts:446,455` (default `returnUrl` da `'/dashboard'` a `'/'`)

**Interfaces:**
- Consumes: `BilancioService.atterraggio()` (Task 8).
- Produces: `export const atterraggioGuard: CanActivateFn` che restituisce un `UrlTree`: `BILANCIO` → `/bilancio`, `CONSULENTE` → `/permissions/consultant-dashboard`, `DASHBOARD` → `/dashboard`; errore HTTP → `/dashboard`. Rotta: `{ path: '', pathMatch: 'full', canActivate: [atterraggioGuard], children: [] }`.

- [ ] **Step 1: Write the failing test** (`TestBed.runInInjectionContext`, `BilancioService` finto, `provideRouter([])`): `'VIEWER: /bilancio'`, `'consulente: /permissions/consultant-dashboard'`, `'altri ruoli: /dashboard'`, `'errore del backend: /dashboard'` (confronto con `router.serializeUrl`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/core/guards/atterraggio.guard.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** la guard e le tre modifiche.

- [ ] **Step 4: Run tests to verify they pass** — il comando dello Step 2 più `--include=src/app/features/auth/**/*.spec.ts` se esistono: PASS; `npx ng build` senza errori. Prova a mano con `ng serve` e backend locale, se disponibile: login VIEWER → `/bilancio`; la Dashboard resta raggiungibile dal menu; cambio azienda dal selettore (`tenant-selector.component.ts:135` naviga a `/` e poi alla pagina corrente) torna sulla pagina in cui si era.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(bilancio): il ruolo sola lettura atterra sul bilancio, il consulente sulla sua dashboard" -- apps/frontend/src/app/core/guards/atterraggio.guard.ts apps/frontend/src/app/core/guards/atterraggio.guard.spec.ts apps/frontend/src/app/app.routes.ts apps/frontend/src/app/features/auth/auth-callback.component.ts apps/frontend/src/app/features/auth/login.component.ts
```

**Fine della parte che parte subito.** Verifica del branch: tutti gli spec di `src/application/bilancio` e `src/api/bilancio`, `npx tsc --noEmit`, gli spec Karma di `features/bilancio` e della guard, `npx ng build`; `git diff --stat origin/master` non deve toccare nessun file dell'elenco "da NON modificare".

---

## Dopo il merge di altri branch (task separati, da non eseguire prima)

### Task 11: dopo il merge di F2-8, funzione condivisa del MUD (obbligatorio)

**Precondizione:** F2-8 in master e branch del Bilancio aggiornato. Verificare in master che `apps/backend/src/application/mud/mud-totali.ts` esporti `totaliMud(aggregato: MudAggregato): TotaliMud` con la forma di D22 del piano F2-8 (`perCer: VoceTotaliMud[]`, `dichiarazioni: Array<{ codice; unitaLocale; perCer; totali }>`, `totali: SommeMud` con `prodottoKg`, `recuperoKg`, `smaltimentoKg`, `giacenzaRecuperoKg`, `giacenzaSmaltimentoKg`, `movimenti`). Se nomi o forma differiscono, si segue master e si aggiornano qui le interfacce prima di procedere. Il test di uguaglianza fra MUD e totali condivisi è di F2-8 (`'prodotto uguale all'aggregazione MUD sugli stessi movimenti'`); qui si aggiunge solo quello del consumatore.

**Files:**
- Modify: `apps/backend/src/application/bilancio/dal-mud.ts` (+ spec), `bilancio.service.ts` (+ spec), `stato-mud-bilancio.service.ts` (+ spec)
- Modify: `apps/frontend/src/app/features/bilancio/bilancio.component.ts` (+ spec) solo se l'etichetta della sede cambia forma

**Interfaces:**
- Consumes: `totaliMud`, `TotaliMud` (F2-8).
- Produces: `sintesiDalMud(a: MudAggregato)` invariata nella firma, ma con `prodottoKg`, `recuperoKg`, `smaltimentoKg`, `perCer` (`cerCode` e `pericoloso` di `VoceTotaliMud`), `pericolosiKg` e `giacenzaKg = totali.giacenzaRecuperoKg + totali.giacenzaSmaltimentoKg` letti da `totaliMud(a)`; `StatoMudBilancioService.righe(tenantId, annoDati, oggi, sedi?: Array<{ codice: string; unitaLocale: string }>)` con una riga per sede, stessa `stato` (il `MUDReport` resta uno per azienda e anno).

- [ ] **Step 1: Write the failing tests**: `'sintesi: totali uguali a totaliMud sullo stesso aggregato'`; `'giacenza dalle giacenze di totaliMud, non da GIACENZE_NON_CALCOLATE'`; `'MUD: una riga per dichiarazione'` (due sedi → due righe, `sede` = denominazione dell'unità locale); `'prodotto del bilancio uguale a totaliAnno'` (`MudAggregazioneService` vero sul prisma finto del Task 2 e `BilancioService.calcola`: `prodotto.kg === totaliMud(await aggrega('t1', 2025)).totali.prodottoKg`).
- [ ] **Step 2: Run** `cd apps/backend && npx jest --runInBand src/application/bilancio` → FAIL sui nuovi.
- [ ] **Step 3: Implement**; `MudAggregato.righe` non si legge più nel Bilancio. Le funzioni del Task 1 restano per confronto, preliminari e mesi (discrepanza 2).
- [ ] **Step 4: Run** lo stesso comando + Karma di `features/bilancio` → PASS.
- [ ] **Step 5: Commit** `refactor(bilancio): totali dalla funzione condivisa del MUD (F2-8)` con i file toccati.

### Task 12: dopo il merge di F2-6, avvisi del deposito

**Precondizione:** F2-6 in master. Verificare quale servizio espone gli avvisi del deposito per azienda (sul branch F2-6: `GiacenzeService.getDepositoTemporaneoAlerts(tenantId, config?, now?, registroId?)`, con soglie per azienda in `soglie-deposito.service.ts`) e come lo chiama la sua pagina: il Bilancio usa la **stessa** chiamata con la stessa configurazione.

**Files:**
- Modify: `apps/backend/src/application/bilancio/bilancio.module.ts` (+ spec)
- Create: `apps/backend/src/application/bilancio/contatore-avvisi-deposito.ts` + spec

**Interfaces:**
- Produces: `class ContatoreAvvisiDeposito implements ContatoreSegnale` (conta = numero di avvisi PREAVVISO e SUPERATO di oggi per il tenant); nel modulo `{ provide: CONTATORE_AVVISI_DEPOSITO, useClass: ContatoreAvvisiDeposito }` e import di `GiacenzeModule` (che esporta `GiacenzeService`, `giacenze.module.ts:16`).

- [ ] **Step 1:** test `'conta gli avvisi del deposito del tenant'` e, nel module spec, `'il contatore del deposito è cablato'`. **Step 2:** FAIL. **Step 3:** implementare. **Step 4:** PASS. **Step 5:** commit `feat(bilancio): conteggio degli avvisi del deposito temporaneo (F2-6)`.

### Task 13: dopo il merge di Studio, ritardi del registro e FIR senza riscontro

**Precondizione:** il filone Studio in master con i servizi di dominio delle due regole (registro in ritardo, art. 190; FIR senza riscontro, art. 188), gli stessi che alimentano `dashboard/attenzione`.

**Files:**
- Modify: `apps/backend/src/application/bilancio/bilancio.module.ts` (+ spec)
- Create: `apps/backend/src/application/bilancio/contatori-studio.ts` + spec

**Interfaces:**
- Produces: due classi `ContatoreSegnale` che contano, per il solo tenant e a `oggi`, le scadenze aperte (gruppi "Scaduto" e "Oggi" di Studio, cioè `dataTermine <= oggi`) di ciascuna regola; nel modulo `{ provide: CONTATORE_RITARDI_REGISTRO, … }` e `{ provide: CONTATORE_FIR_SENZA_RISCONTRO, … }`. Le righe "termine da configurare in base all'attività" di Studio **non** si contano.

- [ ] **Step 1:** test `'ritardi: stesso numero del cruscotto attenzione per lo stesso tenant'`, `'FIR senza riscontro: solo i termini superati'`, `'righe senza termine non contate'`. **Step 2:** FAIL. **Step 3:** implementare. **Step 4:** PASS. **Step 5:** commit `feat(bilancio): segnali aperti dai servizi di Studio`.
