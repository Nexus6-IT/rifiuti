# Direzioni demo, filone Studio: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** il consulente vede in una scheda "Scadenze", in testa alla sua dashboard, le scadenze di tutte le aziende a cui ha accesso, raggruppate per vicinanza, e con un clic passa all'azienda giusta sulla pagina giusta.

**Architecture:** le regole nuove (ritardo del registro, FIR senza riscontro, MUD, versamento RENTRI) sono funzioni pure in `application/scadenze/regole/`, alimentate da un solo use case di lettura (`RaccogliScadenzeUseCase`) che restituisce `VoceAttenzione` con due campi nuovi, `dataTermine` e `fonte`. Un servizio di composizione (`AttenzioneAziendaService`) fonde le voci esistenti e quelle nuove: lo usano sia `GET /dashboard/attenzione` (una azienda) sia il nuovo `GET /consultant/scadenze`, che legge ogni azienda accessibile dentro `TenantContext.run({ tenantId })` col client normale. Così i numeri del cruscotto e quelli di Studio coincidono per costruzione. Il frontend raggruppa per `dataTermine` con una funzione pura e cambia azienda con un servizio unico, usato anche dal selettore del layout.

**Tech Stack:** NestJS 10, Prisma 5.22, PostgreSQL 16, Jest; Angular 17 standalone, PrimeNG 17, Karma/Jasmine.

**Spec:** `docs/superpowers/specs/2026-10-28-direzioni-demo-design.md`, sezione "1. Studio", più "Vincoli trasversali", "Sequenza e branch", "Decisioni di Graziano", "Pezzi esterni".

## Global Constraints

- **Branch:** `feat/direzioni-studio`, da `master`, nel proprio worktree (lo crea il coordinatore). PR propria.
- **File che NON si toccano** (aperti in `feat/fase2-6-deposito`, `feat/fase2-8-mud-sede`, `feat/fase2-10-controparti`): `prisma/schema.prisma` e ogni migration, `application/giacenze/*`, `application/registro/aperture-registro.ts`, `infrastructure/persistence/prisma-rls.extension.ts`, `infrastructure/persistence/README-tenant-transazione.md`, `core/domain/errors.ts`, `core/filters/http-exception.filter.ts`, `test-support/*`, `jest.config.js`, `tsconfig.json`, `ops/README.md`. In più, per accordo col design, `application/mud/aggregazione/*` e `mud-integrazioni.service.ts` si importano e non si modificano. **Unica eccezione dichiarata:** una voce in `application/registro/lettori-movimenti.spec.ts` (Task 6), lontana dall'hunk di F2-6; il Task 6 verifica con `git merge-tree` che il merge con F2-6 resti senza conflitti.
- **Nessuna migration in questo filone.** Il flag ADR resta fuori (vedi "Scelte").
- **Isolamento:** ogni query nuova porta `tenantId` esplicito e passa da `this.prisma.db.<model>` (client con estensione), tranne `tenant.findUnique({ where: { id } })`. Le letture su più aziende girano in `TenantContext.run({ tenantId }, async () => await ...)` col client normale; nessun file nuovo inietta `PrismaSistemaService` (l'elenco delle aziende viene da `MembershipService.listTenants`, che già lo usa).
- **Una sola fonte per regola:** il confronto "sono io" usa `MudIntegrazioniService.codiciAzienda(tenantId)` e `normalizzaCodiceFiscaleSoggetto` (`domain/shared/codice-fiscale-soggetto.ts`) sul valore del FIR; la vigenza usa `WHERE_VIGENTE` (`domain/waste-movement/vigenza.ts`); la scadenza del MUD usa `MudVersionRegistry.scadenzaPresentazione`; i giorni di calendario di Roma usano `giornoItaliano` (`core/time/anno-italiano.ts`).
- **Date:** ogni `dataTermine` è una stringa `'AAAA-MM-GG'` del calendario di Roma; mai un `Date` serializzato.
- **Orizzonte:** 30 giorni (`ORIZZONTE_SCADENZE_GIORNI = 30`), lo stesso valore di `SOGLIA_AVVISO_GIORNI` già usato dalle voci esistenti. Le scadenze già passate restano visibili.
- **Fonti normative:** stanno tutte in `application/scadenze/regole/fonti.ts`. Prima del merge il coordinatore le riverifica sul testo vigente (regola del design); gli implementatori copiano i testi del piano e non ne inventano.
- **Termine del registro:** solo produttore, 10 giorni lavorativi (art. 190 c. 1). Gli altri casi danno la riga "termine da configurare in base all'attività". Nessuna colonna "attività" sulle causali, il catalogo causali non si tocca.
- **Deposito temporaneo:** non si implementa. Punto di estensione nell'elenco dei raccoglitori di `RaccogliScadenzeUseCase` (Task 6), da riempire dopo il merge di F2-6.
- **Testi:** italiano; termini tecnici in inglese; nessuna dicitura "4ª copia".
- **TDD:** prima il test, eseguito e visto fallire, poi il codice.
- **Comandi** (mai la suite intera):
  - backend: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - Postgres reale: `cd apps/backend && DATABASE_URL=postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public npm run test:postgres -- <pattern>` (Postgres 16 con `npx prisma migrate deploy`);
  - tipi e lint backend: `npx tsc --noEmit -p apps/backend/tsconfig.json`; `cd apps/backend && npx eslint "{src,test}/**/*.ts" --quiet` (0 errori);
  - frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=<spec>`; `cd apps/frontend && npx tsc --noEmit -p tsconfig.app.json`; dalla radice `npx eslint "apps/frontend/src/app/<cartella>/**/*.ts" --max-warnings=-1`.
- **Commit:** stile `feat(studio): ...`, in italiano, **senza** righe di attribuzione AI; mai `git add -A`.

## Scelte prese dove il design lasciava libertà

- **ADR fuori.** Il flag richiede una migration su `schema.prisma`, che F2-6 e F2-10 stanno modificando, e nessun dato oggi dice chi è soggetto ad ADR: la scadenza non comparirebbe comunque. Resta un punto di estensione in `regole/scadenze-annuali.ts`.
- **Sabato lavorativo** nel conto dei giorni lavorativi (domenica e festività nazionali escluse): è la lettura prudente, che dà il termine più vicino. Costante `SABATO_LAVORATIVO = true`, scritta anche nella fonte mostrata. Da confermare con il PO.
- **4 ottobre (San Francesco) festivo dal 2026** (L. 151/2025). Da riverificare.
- **Endpoint:** `GET /consultant/scadenze`, senza paginazione (decine di voci per azienda al massimo). Le aziende sono quelle di `MembershipService.listTenants` (primaria, possedute, associazioni attive, figlie): sono esattamente quelle a cui il cambio azienda porta, quindi ogni riga è raggiungibile con un clic.
- **Voci senza data** (scorta vidimata, formulari da trasmettere, "termine da configurare"): in Studio entrano solo se non sono `informativo`, in un sesto gruppo "Senza data di termine" sotto "Più avanti".
- **"Questa settimana"** = da dopodomani a oggi+7 (finestra mobile); "Più avanti" = da oggi+8 a oggi+30.
- **Ordinamento** nel gruppo: data crescente, poi gravità (critico prima), poi azienda.
- **Versamento RENTRI:** data da variabile d'ambiente `RENTRI_SCADENZA_VERSAMENTO` (`MM-GG`); assente o non valida = nessuna voce. Compare solo prima della data (non sappiamo se è stato pagato), per le aziende con `RentriCredential`.
- **"Scheda"** = un riquadro in testa alla dashboard consulente, non un `p-tabView`: il resto della pagina resta com'è.
- **Conferma dell'azienda dopo il cambio:** toast "Ora stai lavorando su …" dopo la ricarica, oltre al contrassegno già presente nella topbar.

## Review Focus

1. **Movimento annullato:** un FIR la cui ricopia è stata annullata torna "da annotare"; una rettifica (che porta `firId`) lo lascia annotato. Test nel Task 6 (Postgres).
2. **Movimento di un'altra azienda con lo stesso `firId`:** non nasconde il ritardo. Test nel Task 6 (Postgres).
3. **Un'azienda che non si legge** (errore in un raccoglitore): le altre restano in Studio e quella compare in `aziendeNonLette`, con un avviso a schermo. Test nei Task 8 e 11.
4. **Cambio di giorno a Roma:** alle 00:30 italiane (22:30 o 23:30 UTC) "oggi" è già il giorno nuovo, sia nel backend sia nei gruppi del frontend, che usa `oggi` della risposta e non l'orologio del browser. Test nei Task 8 e 9.
5. **Azione su un'azienda già attiva:** niente cambio né ricarica, solo navigazione; cambio fallito: messaggio d'errore e nessuna navigazione (mai una pagina aperta nell'azienda sbagliata). Test nel Task 10.

---

## File

| File | Task | Responsabilità |
|---|---|---|
| `apps/backend/src/core/time/giorni-lavorativi.ts` (+spec) | 1 | calendario: Pasqua, festività nazionali, giorni lavorativi, aritmetica su `'AAAA-MM-GG'` |
| `apps/backend/src/application/scadenze/regole/termine.ts` (+spec), `regole/fonti.ts` | 2 | orizzonte, gravità e testo di un termine; fonti normative |
| `apps/backend/src/application/dashboard/raccogli-attenzione.use-case.ts` (+spec) | 2 | `VoceAttenzione` con `dataTermine`/`fonte`; date sulle 4 voci esistenti |
| `apps/backend/src/application/scadenze/regole/ritardo-registro.ts` (+spec) | 3 | regola art. 190 |
| `apps/backend/src/application/scadenze/regole/fir-senza-riscontro.ts` (+spec) | 4 | regola art. 188 |
| `apps/backend/src/application/scadenze/regole/scadenze-annuali.ts` (+spec) | 5 | MUD, versamento RENTRI |
| `apps/backend/src/application/scadenze/raccogli-scadenze.use-case.ts` (+spec, +postgres spec) | 6 | lettura per una azienda e applicazione delle regole |
| `apps/backend/src/application/mud/mud.module.ts` | 6 | export di `MudIntegrazioniService` e `MudVersionRegistry` |
| `apps/backend/src/application/registro/lettori-movimenti.spec.ts` | 6 | una voce (eccezione dichiarata) |
| `apps/backend/.env.example` | 6 | `RENTRI_SCADENZA_VERSAMENTO` |
| `apps/backend/src/application/dashboard/attenzione-azienda.service.ts` (+spec) | 7 | composizione unica delle voci di una azienda |
| `apps/backend/src/api/dashboard/attenzione.controller.ts`, `dashboard.module.ts` | 7, 8 | uso della composizione, wiring |
| `apps/backend/src/application/dashboard/raccogli-scadenze-aziende.use-case.ts` (+spec) | 8 | aggregazione per il consulente |
| `apps/backend/src/api/dashboard/scadenze-aziende.controller.ts` (+spec), `dashboard.module.spec.ts` | 8 | `GET /consultant/scadenze`, smoke test DI |
| `apps/frontend/src/app/features/dashboard/attenzione.service.ts` | 9 | specchio dei due campi nuovi |
| `apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.model.ts` (+spec), `scadenze-studio.service.ts` (+spec) | 9 | tipi, raggruppamento, tipo di scadenza, client HTTP |
| `apps/frontend/src/app/core/services/cambio-azienda.service.ts` (+spec) | 10 | cambio azienda unico |
| `apps/frontend/src/app/shared/components/layout.component.ts` | 10 | delega del cambio e toast di conferma |
| `apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.component.ts` (+spec) | 11 | la scheda |
| `apps/frontend/src/app/features/permissions/pages/consultant-dashboard/consultant-dashboard.component.ts` (+spec) | 11 | scheda in testa |

---

### Task 1: calendario dei giorni lavorativi

**Files:**
- Create: `apps/backend/src/core/time/giorni-lavorativi.ts`
- Test: `apps/backend/src/core/time/giorni-lavorativi.spec.ts`

**Interfaces:**
- Consumes: niente.
- Produces (tutte su stringhe `'AAAA-MM-GG'`, aritmetica interna con `Date.UTC`, mai con l'ora locale):
  - `SABATO_LAVORATIVO: true`
  - `aggiungiGiorni(giorno: string, n: number): string`
  - `aggiungiMesi(giorno: string, n: number): string` (giorno oltre la fine del mese → ultimo giorno del mese)
  - `differenzaGiorni(da: string, a: string): number` (a − da, in giorni di calendario)
  - `formattaGiorno(giorno: string): string` (`'GG/MM/AAAA'`)
  - `pasqua(anno: number): string`
  - `festivitaNazionali(anno: number): string[]`
  - `eGiornoLavorativo(giorno: string): boolean`
  - `aggiungiGiorniLavorativi(giorno: string, n: number): string` (l'n-esimo giorno lavorativo DOPO `giorno`)

- [ ] **Step 1: scrivere il test che fallisce**

```ts
describe('giorni lavorativi', () => {
  it('pasqua: algoritmo gregoriano', () => {
    expect(pasqua(2024)).toBe('2024-03-31')
    expect(pasqua(2025)).toBe('2025-04-20')
    expect(pasqua(2026)).toBe('2026-04-05')
    expect(pasqua(2027)).toBe('2027-03-28')
  })
  it('festività nazionali 2026: fisse, Pasqua, Pasquetta e 4 ottobre', () => {
    const f = festivitaNazionali(2026)
    for (const g of ['2026-01-01', '2026-01-06', '2026-04-05', '2026-04-06', '2026-04-25',
      '2026-05-01', '2026-06-02', '2026-08-15', '2026-10-04', '2026-11-01', '2026-12-08',
      '2026-12-25', '2026-12-26']) expect(f).toContain(g)
    expect(f).toHaveLength(13)
  })
  it('il 4 ottobre è festivo solo dal 2026', () => {
    expect(festivitaNazionali(2025)).not.toContain('2025-10-04')
    expect(eGiornoLavorativo('2025-10-04')).toBe(true) // sabato, non festivo nel 2025
    expect(eGiornoLavorativo('2027-10-04')).toBe(false) // lunedì festivo
  })
  it('patronali escluse: il 29 giugno (Roma) e il 7 dicembre (Milano) sono lavorativi', () => {
    expect(eGiornoLavorativo('2026-06-29')).toBe(true)
    expect(eGiornoLavorativo('2026-12-07')).toBe(true)
  })
  it('domenica no, sabato sì, Pasquetta no, 2 novembre sì', () => {
    expect(eGiornoLavorativo('2026-11-01')).toBe(false)
    expect(eGiornoLavorativo('2026-10-31')).toBe(true)
    expect(eGiornoLavorativo('2026-04-06')).toBe(false)
    expect(eGiornoLavorativo('2026-11-02')).toBe(true)
  })
  it('10 giorni lavorativi attraverso Pasqua e Pasquetta', () => {
    expect(aggiungiGiorniLavorativi('2026-04-01', 10)).toBe('2026-04-14')
  })
  it('10 giorni lavorativi attraverso Natale, Capodanno ed Epifania', () => {
    expect(aggiungiGiorniLavorativi('2026-12-22', 10)).toBe('2027-01-07')
  })
  it('partenza da un giorno festivo', () => {
    expect(aggiungiGiorniLavorativi('2026-04-05', 1)).toBe('2026-04-07')
  })
  it('aritmetica di calendario', () => {
    expect(aggiungiGiorni('2026-12-31', 1)).toBe('2027-01-01')
    expect(aggiungiMesi('2026-07-15', 3)).toBe('2026-10-15')
    expect(aggiungiMesi('2026-01-31', 1)).toBe('2026-02-28')
    expect(aggiungiMesi('2026-11-30', 3)).toBe('2027-02-28')
    expect(differenzaGiorni('2026-10-28', '2026-11-04')).toBe(7)
    expect(differenzaGiorni('2026-03-28', '2026-03-30')).toBe(2) // cambio d'ora
    expect(formattaGiorno('2026-11-04')).toBe('04/11/2026')
  })
})
```

- [ ] **Step 2: eseguire il test e vederlo fallire**

Run: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit src/core/time/giorni-lavorativi.spec.ts`
Expected: FAIL, modulo `./giorni-lavorativi` inesistente.

- [ ] **Step 3: implementare `core/time/giorni-lavorativi.ts`**

Pasqua con l'algoritmo anonimo gregoriano (Meeus/Jones/Butcher). Commento di testa: festività nazionali italiane (L. 260/1949 e successive, 4 ottobre dalla L. 151/2025 a partire dal 2026), **patronali escluse di proposito**, sabato lavorativo per prudenza.

- [ ] **Step 4: eseguire il test e vederlo passare**

Stesso comando. Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/core/time/giorni-lavorativi.ts apps/backend/src/core/time/giorni-lavorativi.spec.ts
git commit -m "feat(studio): calendario dei giorni lavorativi con le festività nazionali"
```

---

### Task 2: termine comune e date sulle voci esistenti

**Files:**
- Create: `apps/backend/src/application/scadenze/regole/termine.ts`, `apps/backend/src/application/scadenze/regole/fonti.ts`
- Test: `apps/backend/src/application/scadenze/regole/termine.spec.ts`
- Modify: `apps/backend/src/application/dashboard/raccogli-attenzione.use-case.ts:12-21` (interfaccia) e i quattro raccoglitori (`:116-296`)
- Test: `apps/backend/src/application/dashboard/raccogli-attenzione.use-case.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`differenzaGiorni`, `formattaGiorno`, `aggiungiGiorni`); `giornoItaliano` da `core/time/anno-italiano.ts`.
- Produces:
  - in `VoceAttenzione` (backend) due campi facoltativi: `dataTermine?: string | null` (`'AAAA-MM-GG'` di Roma, `null` = senza termine) e `fonte?: string`.
  - `termine.ts`: `type Gravita = VoceAttenzione['gravita']`; `ORIZZONTE_SCADENZE_GIORNI = 30`; `GIORNI_AVVISO = 7`; `entroOrizzonte(dataTermine: string, oggi: string): boolean` (vero per ogni data ≤ oggi+30, passate comprese); `gravitaPerTermine(dataTermine: string, oggi: string): Gravita` (passata → critico, entro oggi+7 → avviso, oltre → informativo); `descriviTermine(dataTermine: string, oggi: string): string`.
  - `fonti.ts`: `export const FONTI = { REGISTRO_PRODUTTORE, REGISTRO_DA_CONFIGURARE, RISCONTRO_FIR, MUD_TRACCIATO, MUD_ORDINARIA, VERSAMENTO_RENTRI, CERTIFICATO_RENTRI, AUTORIZZAZIONE_IMPIANTO, ISCRIZIONE_ALBO, AUTORIZZAZIONE_DESTINATARIO } as const` con questi testi esatti:
    - `REGISTRO_PRODUTTORE`: `"Art. 190 c. 1 D.Lgs. 152/2006: annotazione entro 10 giorni lavorativi dallo scarico (produttore iniziale). Giorni lavorativi contati dal lunedì al sabato, escluse le festività nazionali; le festività patronali non sono considerate."`
    - `REGISTRO_DA_CONFIGURARE`: `"Art. 190 c. 1 D.Lgs. 152/2006: il termine di annotazione dipende dall'attività dell'azienda, non ancora configurata."`
    - `RISCONTRO_FIR`: `"Art. 188 D.Lgs. 152/2006: riscontro (copia controfirmata o chiusura) entro 3 mesi dal conferimento al trasportatore; in mancanza, comunicazione all'ente. Regola generale, applicata anche ai FIR RENTRI."`
    - `MUD_TRACCIATO`: `"L. 70/1994: scadenza di presentazione indicata dal DPCM del modello dell'anno."`
    - `MUD_ORDINARIA`: `"L. 70/1994 e art. 189 c. 3 D.Lgs. 152/2006: presentazione entro il 30 aprile."`
    - `VERSAMENTO_RENTRI`: `"DM 59/2023: diritto di segreteria e contributo annuale RENTRI. Data configurata, da verificare ogni anno."`
    - `CERTIFICATO_RENTRI`: `"Data di fine validità del certificato RENTRI caricato."`
    - `AUTORIZZAZIONE_IMPIANTO`: `"Scadenza registrata nell'anagrafica dell'autorizzazione dell'impianto."`
    - `ISCRIZIONE_ALBO`: `"Scadenza dell'iscrizione all'Albo nazionale gestori ambientali registrata nell'anagrafica del trasportatore."`
    - `AUTORIZZAZIONE_DESTINATARIO`: `"Scadenza dell'autorizzazione registrata nell'anagrafica del destinatario."`

- [ ] **Step 1: scrivere i test che falliscono**

`termine.spec.ts`, con `const OGGI = '2026-10-28'`:

```ts
it('gravità: passata critico, entro 7 giorni avviso, oltre informativo', () => {
  expect(gravitaPerTermine('2026-10-27', OGGI)).toBe('critico')
  expect(gravitaPerTermine('2026-10-28', OGGI)).toBe('avviso')
  expect(gravitaPerTermine('2026-11-04', OGGI)).toBe('avviso')
  expect(gravitaPerTermine('2026-11-05', OGGI)).toBe('informativo')
})
it('orizzonte di 30 giorni, le passate restano', () => {
  expect(entroOrizzonte('2026-11-27', OGGI)).toBe(true)
  expect(entroOrizzonte('2026-11-28', OGGI)).toBe(false)
  expect(entroOrizzonte('2025-01-01', OGGI)).toBe(true)
})
it('descrizione del termine', () => {
  expect(descriviTermine('2026-10-25', OGGI)).toBe('scaduto da 3 giorni (termine 25/10/2026)')
  expect(descriviTermine('2026-10-27', OGGI)).toBe('scaduto da 1 giorno (termine 27/10/2026)')
  expect(descriviTermine('2026-10-28', OGGI)).toBe('scade oggi (28/10/2026)')
  expect(descriviTermine('2026-10-29', OGGI)).toBe('scade domani (29/10/2026)')
  expect(descriviTermine('2026-11-04', OGGI)).toBe('scade fra 7 giorni (04/11/2026)')
})
```

In `raccogli-attenzione.use-case.spec.ts` aggiungere, riusando `buildPrisma` e `validToFraGiorni` del file:
- `'certificato in scadenza fra 12 giorni: dataTermine = oggi di Roma + 12 e fonte CERTIFICATO_RENTRI'` → `expect(voce.dataTermine).toBe(aggiungiGiorni(giornoItaliano(new Date()), 12))`, `expect(voce.fonte).toBe(FONTI.CERTIFICATO_RENTRI)`;
- `'certificato non leggibile: dataTermine null'`;
- `'autorizzazione impianto: dataTermine è il giorno di Roma di dataScadenza'` → con `dataScadenza = new Date('2026-11-10T00:00:00Z')` (e `jest.useFakeTimers().setSystemTime(new Date('2026-10-28T10:00:00Z'))`, ripristinati in `afterEach`), `expect(voce.dataTermine).toBe('2026-11-10')` e `fonte` `FONTI.AUTORIZZAZIONE_IMPIANTO`;
- lo stesso per trasportatore (`FONTI.ISCRIZIONE_ALBO`) e destinatario (`FONTI.AUTORIZZAZIONE_DESTINATARIO`).

- [ ] **Step 2: eseguire i test e vederli fallire**

Run: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit src/application/scadenze/regole/termine.spec.ts src/application/dashboard/raccogli-attenzione.use-case.spec.ts`
Expected: FAIL (modulo `termine` inesistente; `dataTermine` undefined).

- [ ] **Step 3: implementare**

`termine.ts` e `fonti.ts` come da Interfaces. In `raccogli-attenzione.use-case.ts`: i due campi nell'interfaccia (con commento: `dataTermine` è il campo da cui il frontend di Studio raggruppa); nei quattro raccoglitori aggiungere `dataTermine` e `fonte`. Il certificato: `aggiungiGiorni(giornoItaliano(new Date()), giorni)`; non leggibile: `null`. Le altre: `giornoItaliano(<data di scadenza>)`. Nessun altro cambiamento di logica, gravità o testi.

- [ ] **Step 4: eseguire i test e vederli passare**

Stesso comando. Expected: PASS, compresi i test già esistenti del file.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/scadenze/regole/termine.ts apps/backend/src/application/scadenze/regole/termine.spec.ts apps/backend/src/application/scadenze/regole/fonti.ts apps/backend/src/application/dashboard/raccogli-attenzione.use-case.ts apps/backend/src/application/dashboard/raccogli-attenzione.use-case.spec.ts
git commit -m "feat(studio): data di termine e fonte sulle voci di attenzione"
```

---

### Task 3: regola del registro di carico e scarico

**Files:**
- Create: `apps/backend/src/application/scadenze/regole/ritardo-registro.ts`
- Test: `apps/backend/src/application/scadenze/regole/ritardo-registro.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`aggiungiGiorniLavorativi`), Task 2 (`entroOrizzonte`, `gravitaPerTermine`, `descriviTermine`, `FONTI`), `giornoItaliano`, `normalizzaCodiceFiscaleSoggetto`, `VoceAttenzione`.
- Produces:
  - `interface FirPerScadenze { id: string; firNumber: string | null; status: FIRStatus; transportDate: Date; producerPartitaIva: string; receiverPartitaIva: string; rentriStatoFormulario: RentriStatoFormulario | null }` (enum da `@prisma/client`). Lo usano anche i Task 4 e 6.
  - `chiaveMovimento(firId: string, tipo: 'CARICO' | 'SCARICO'): string` → `` `${firId}|${tipo}` ``.
  - `type RuoloNelFir = 'PRODUTTORE' | 'DESTINATARIO'`; `termineAnnotazione(ruolo: RuoloNelFir): { giorniLavorativi: number } | null` → `PRODUTTORE: { giorniLavorativi: 10 }`, `DESTINATARIO: null`. È **l'unico punto** da cambiare quando l'attività arriverà dalla causale (commento che lo dice).
  - `vociRitardoRegistro(p: { firs: FirPerScadenze[]; codiciAzienda: ReadonlySet<string>; movimentiVigenti: ReadonlySet<string>; oggi: string }): VoceAttenzione[]`.
- Regole:
  - stati considerati: `AWAITING_CARRIER`, `AWAITING_RECEIVER`, `COMPLETED`, `SYNCED_TO_RENTRI`; gli altri si ignorano;
  - **produttore** (`codiciAzienda.has(normalizza(producerPartitaIva))`) senza `SCARICO` vigente: una voce per FIR, chiave `'registro-annotazione'`, termine = `aggiungiGiorniLavorativi(giornoItaliano(transportDate), 10)`, solo se `entroOrizzonte`; `titolo` `` `Registro: scarico del FIR ${firNumber ?? 'senza numero'} da annotare` ``, `dettaglio` `descriviTermine(...)`, `gravita` `gravitaPerTermine(...)`, `fonte` `FONTI.REGISTRO_PRODUTTORE`, `azione` `{ etichetta: 'Apri il registro', rotta: '/registro' }`;
  - **destinatario** con FIR consegnato (`COMPLETED`/`SYNCED_TO_RENTRI`) o accettato da RENTRI (`rentriStatoFormulario` `Accettato` o `RespintoAccettatoParzialmente`) senza `CARICO` vigente: **una sola** voce per azienda, chiave `'registro-termine-da-configurare'`, `gravita: 'avviso'`, `dataTermine: null`, `titolo` `` `Registro: ${n} formulari ricevuti senza carico annotato` `` (`1 formulario ricevuto` al singolare), `dettaglio` `"termine da configurare in base all'attività"`, `fonte` `FONTI.REGISTRO_DA_CONFIGURARE`, stessa `azione`;
  - un FIR in cui l'azienda è produttore e destinatario passa da entrambi i controlli.

- [ ] **Step 1: scrivere il test che fallisce**

Con `OGGI = '2026-10-28'`, codici `new Set(['01234567897'])` e un costruttore `fir(parziale)` con default `status: 'AWAITING_RECEIVER'`, `transportDate: new Date('2026-10-14T08:00:00Z')`, `producerPartitaIva: '01234567897'`, `receiverPartitaIva: '09876543210'`, `rentriStatoFormulario: null`:
- `'produttore senza SCARICO vigente: voce critica con termine 26/10/2026'` → una voce, `chiave 'registro-annotazione'`, `dataTermine '2026-10-26'`, `gravita 'critico'`, `fonte FONTI.REGISTRO_PRODUTTORE`, `azione.rotta '/registro'`;
- `'produttore con SCARICO vigente: nessuna voce'` (`movimentiVigenti` con `chiaveMovimento('f1','SCARICO')`);
- `'P.IVA del produttore di un altro: nessuna voce'`;
- `'bozza e annullato: nessuna voce'` (`DRAFT`, `CANCELLED`);
- `'trasporto futuro oltre i 30 giorni: nessuna voce'` (`transportDate 2026-12-20`);
- `'destinatario: due FIR consegnati senza CARICO danno una sola voce senza termine'` → `dataTermine null`, `gravita 'avviso'`, `dettaglio "termine da configurare in base all'attività"`, titolo contiene `'2 formulari'`;
- `'destinatario con FIR in transito e nessun esito RENTRI: nessuna voce'`;
- `'destinatario con esito RENTRI Accettato e stato interno in transito: voce'`;
- `'termineAnnotazione: 10 giorni per il produttore, nessun termine per il destinatario'`.

- [ ] **Step 2: eseguire il test e vederlo fallire**

Run: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit src/application/scadenze/regole/ritardo-registro.spec.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: implementare `vociRitardoRegistro` e gli altri export in `ritardo-registro.ts`**

- [ ] **Step 4: eseguire il test e vederlo passare.** Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/scadenze/regole/ritardo-registro.ts apps/backend/src/application/scadenze/regole/ritardo-registro.spec.ts
git commit -m "feat(studio): regola del ritardo di annotazione nel registro"
```

---

### Task 4: FIR senza riscontro

**Files:**
- Create: `apps/backend/src/application/scadenze/regole/fir-senza-riscontro.ts`
- Test: `apps/backend/src/application/scadenze/regole/fir-senza-riscontro.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`aggiungiMesi`, `formattaGiorno`), Task 2, Task 3 (`FirPerScadenze`), `giornoItaliano`, `normalizzaCodiceFiscaleSoggetto`.
- Produces: `MESI_RISCONTRO = 3`; `vociFirSenzaRiscontro(p: { firs: FirPerScadenze[]; codiciAzienda: ReadonlySet<string>; oggi: string }): VoceAttenzione[]`.
- Regole: solo FIR di cui l'azienda è produttore, in stato `AWAITING_CARRIER` o `AWAITING_RECEIVER`, con `rentriStatoFormulario` diverso da `Accettato` e `RespintoAccettatoParzialmente`. Termine = `aggiungiMesi(giornoItaliano(transportDate), 3)`, solo se `entroOrizzonte`. Chiave `'fir-senza-riscontro'`, `fonte FONTI.RISCONTRO_FIR`, `azione { etichetta: 'Apri il formulario', rotta: `/fir/${id}` }`, gravità da `gravitaPerTermine`. Titolo: termine passato → `` `FIR ${n} senza riscontro: comunicazione all'ente da fare` ``; altrimenti `` `FIR ${n}: riscontro atteso entro ${formattaGiorno(termine)}` ``. `dettaglio` = `descriviTermine`.

- [ ] **Step 1: scrivere il test che fallisce** (`OGGI = '2026-10-28'`, stesso costruttore `fir()` del Task 3)
  - `'trasporto del 20/07/2026 senza riscontro: critico, comunicazione all ente'` → `dataTermine '2026-10-20'`, `gravita 'critico'`, titolo contiene `"comunicazione all'ente"`, `azione.rotta '/fir/f1'`;
  - `'trasporto del 10/08/2026: informativo, riscontro atteso entro 10/11/2026'`;
  - `'trasporto del 15/09/2026: termine oltre 30 giorni, nessuna voce'`;
  - `'consegnato (COMPLETED) o esito RENTRI RespintoAccettatoParzialmente: nessuna voce'`;
  - `'FIR di cui l azienda non è produttore: nessuna voce'`;
  - `'fine mese: trasporto del 31/05/2026 → termine 31/08/2026'` (con `OGGI` `'2026-08-20'`).
- [ ] **Step 2: eseguire e vederlo fallire.** Run: `... npx jest --runInBand --forceExit src/application/scadenze/regole/fir-senza-riscontro.spec.ts`. Expected: FAIL, modulo inesistente.
- [ ] **Step 3: implementare `vociFirSenzaRiscontro`.**
- [ ] **Step 4: eseguire e vederlo passare.** Expected: PASS.
- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/scadenze/regole/fir-senza-riscontro.ts apps/backend/src/application/scadenze/regole/fir-senza-riscontro.spec.ts
git commit -m "feat(studio): FIR senza riscontro entro tre mesi dal conferimento"
```

---

### Task 5: scadenze annuali (MUD e versamento RENTRI)

**Files:**
- Create: `apps/backend/src/application/scadenze/regole/scadenze-annuali.ts`
- Test: `apps/backend/src/application/scadenze/regole/scadenze-annuali.spec.ts`

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces:
  - `voceMud(p: { oggi: string; annoDati: number; scadenza: { data: string; fonte: 'TRACCIATO' | 'ORDINARIA' }; statoReport: MUDStatus | null; mudNonDovuto: boolean }): VoceAttenzione[]` (`MUDStatus` da `@prisma/client`). Nessuna voce se `mudNonDovuto`, se `statoReport === 'SUBMITTED'` o se fuori orizzonte. Chiave `'mud-presentazione'`, titolo `` `MUD ${annoDati + 1} (dati ${annoDati}) da presentare` ``, `dettaglio` = `descriviTermine` + `' · '` + stato (`DRAFT` → `'in bozza'`, `REVIEWING` → `'in revisione'`, `ARCHIVED` → `'archiviato'`, `null` → `'non ancora iniziato'`), `fonte` `FONTI.MUD_TRACCIATO` o `FONTI.MUD_ORDINARIA`, `azione { etichetta: 'Apri il MUD', rotta: '/mud' }`. (`ARCHIVED` resta aperto come nella vista di gruppo esistente, che esclude solo `SUBMITTED`.)
  - `leggiMeseGiornoVersamento(valore: string | undefined): string | null` → accetta solo `/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/`.
  - `voceVersamentoRentri(p: { oggi: string; meseGiorno: string | null; iscrittaRentri: boolean }): VoceAttenzione[]`: termine `` `${anno di oggi}-${meseGiorno}` ``, voce solo se `iscrittaRentri` e `0 ≤ differenzaGiorni(oggi, termine) ≤ 30`; gravità `avviso` entro 7 giorni, altrimenti `informativo`; mai `critico`. Chiave `'rentri-versamento-annuale'`, titolo `'RENTRI: diritto di segreteria e contributo annuale'`, `dettaglio` `descriviTermine(...) + ' · verificare il versamento'`, `fonte FONTI.VERSAMENTO_RENTRI`, senza `azione`.
  - Commento in testa al file: **punto di estensione ADR** (relazione annuale del consulente per la sicurezza entro il 28 febbraio) da aggiungere quando l'azienda avrà il flag, con una migration additiva fuori da questo lavoro.

- [ ] **Step 1: scrivere il test che fallisce** (scadenza `{ data: '2026-07-03', fonte: 'TRACCIATO' }` come dà oggi `MudVersionRegistry` per i dati 2025)
  - `'MUD dati 2025 in bozza al 28/10/2026: critico'` → `chiave 'mud-presentazione'`, `gravita 'critico'`, `dettaglio` contiene `'in bozza'`, `fonte FONTI.MUD_TRACCIATO`;
  - `'MUD presentato: nessuna voce'`; `'azienda non tenuta al MUD: nessuna voce'`;
  - `'nessun report: non ancora iniziato'`;
  - `'dati 2026 non censiti, oggi 05/04/2027: 30 aprile, informativo, fonte ordinaria'` (`scadenza { data: '2027-04-30', fonte: 'ORDINARIA' }`);
  - `'oggi 01/02/2027: 30 aprile oltre l orizzonte, nessuna voce'`;
  - `'versamento: 11-15 al 28/10/2026 → informativo; 11-01 → avviso; 04-30 → passato, nessuna voce'`;
  - `'versamento: senza data, data non valida (13-45) o azienda non iscritta: nessuna voce'` (via `leggiMeseGiornoVersamento('13-45') === null`).
- [ ] **Step 2: eseguire e vederlo fallire.** Run: `... npx jest --runInBand --forceExit src/application/scadenze/regole/scadenze-annuali.spec.ts`. Expected: FAIL, modulo inesistente.
- [ ] **Step 3: implementare le tre funzioni.**
- [ ] **Step 4: eseguire e vederlo passare.** Expected: PASS.
- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/scadenze/regole/scadenze-annuali.ts apps/backend/src/application/scadenze/regole/scadenze-annuali.spec.ts
git commit -m "feat(studio): scadenze annuali del MUD e del versamento RENTRI"
```

---

### Task 6: lettura delle scadenze di una azienda

**Files:**
- Create: `apps/backend/src/application/scadenze/raccogli-scadenze.use-case.ts`
- Test: `apps/backend/src/application/scadenze/raccogli-scadenze.use-case.spec.ts`, `apps/backend/src/application/scadenze/raccogli-scadenze.use-case.postgres.spec.ts`
- Modify: `apps/backend/src/application/mud/mud.module.ts:34-40` (exports), `apps/backend/src/application/registro/lettori-movimenti.spec.ts` (una voce in `LETTORI`, in ordine alfabetico subito prima di `'infrastructure/rentri/rentri-unita-locale.service.ts'`), `apps/backend/.env.example` (sezione RENTRI)

**Interfaces:**
- Consumes: Task 2-5; `PrismaService` (`infrastructure/persistence/prisma.service`), `MudIntegrazioniService.codiciAzienda(tenantId): Promise<string[]>`, `MudVersionRegistry.scadenzaPresentazione(annoDati): { data: string; fonte: 'TRACCIATO' | 'ORDINARIA' }`, `WHERE_VIGENTE`, `giornoItaliano`.
- Produces: `@Injectable() class RaccogliScadenzeUseCase` con `constructor(prisma: PrismaService, integrazioniMud: MudIntegrazioniService, registroMud: MudVersionRegistry)` e `raccogli(tenantId: string, adesso: Date = new Date()): Promise<VoceAttenzione[]>`. Le chiavi delle voci (`registro-annotazione`, `registro-termine-da-configurare`, `fir-senza-riscontro`, `mud-presentazione`, `rentri-versamento-annuale`) sono stabili: il Bilancio le conterà. `MUDModule` esporta anche `MudIntegrazioniService` e `MudVersionRegistry`.
- Letture (tutte con `tenantId` esplicito, `this.prisma.db` dove c'è il model):
  - `db.fIR.findMany({ where: { tenantId, status: { notIn: ['DRAFT', 'AWAITING_PRODUCER', 'CANCELLED'] } }, select: <i campi di FirPerScadenze> })`;
  - solo se ci sono FIR: `db.wasteMovement.findMany({ where: { tenantId, firId: { in: ids }, ...WHERE_VIGENTE }, select: { firId: true, type: true } })` → `Set` di `chiaveMovimento`;
  - `db.mUDReport.findUnique({ where: { tenantId_year: { tenantId, year: annoDati } }, select: { status: true } })` con `annoDati = Number(oggi.slice(0, 4)) - 1`;
  - `prisma.tenant.findUnique({ where: { id: tenantId }, select: { mudNonDovuto: true } })`;
  - `db.rentriCredential.findUnique({ where: { tenantId }, select: { tenantId: true } })` → `iscrittaRentri`;
  - `process.env.RENTRI_SCADENZA_VERSAMENTO` via `leggiMeseGiornoVersamento`.
- I raccoglitori stanno in un array con un commento `// F2-6: qui il raccoglitore del deposito temporaneo, dopo il merge (servizio di F2-6, nessuna implementazione provvisoria).`

- [ ] **Step 1: scrivere i test che falliscono**

Unit (`raccogli-scadenze.use-case.spec.ts`), prisma finto con `db.fIR.findMany`, `db.wasteMovement.findMany`, `db.mUDReport.findUnique`, `db.rentriCredential.findUnique`, `tenant.findUnique`; `MudVersionRegistry` vero; `codiciAzienda` mock che risolve `['01234567897']`; `ADESSO = new Date('2026-10-28T10:00:00Z')`; `RENTRI_SCADENZA_VERSAMENTO` salvata e ripristinata in `afterEach`:
- `'legge FIR e movimenti solo dell azienda e solo vigenti'` → `expect(db.fIR.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'T1', status: { notIn: ['DRAFT', 'AWAITING_PRODUCER', 'CANCELLED'] } } }))`; `expect(db.wasteMovement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: 'T1', firId: { in: ['f1'] }, tipoAnnotazione: { not: 'ANNULLAMENTO' }, correzioni: { none: {} } }) }))`;
- `'senza FIR non interroga i movimenti'`;
- `'un FIR del produttore senza scarico e un MUD in bozza: voci registro-annotazione e mud-presentazione'` (FIR `f1` con `producerPartitaIva '01234567897'`, `status 'AWAITING_RECEIVER'`, `transportDate new Date('2026-10-14T08:00:00Z')`; `wasteMovement.findMany` → `[]`; `mUDReport.findUnique` → `{ status: 'DRAFT' }`, chiamato con `tenantId_year: { tenantId: 'T1', year: 2025 }`);
- `'senza RENTRI_SCADENZA_VERSAMENTO nessuna voce di versamento; con 11-15 e credenziale presente sì'`;
- `'codiciAzienda chiamato con il tenant della richiesta'`.

Postgres (`raccogli-scadenze.use-case.postgres.spec.ts`), stesso impianto di `application/registro/lettori-vigenti.postgres.spec.ts` (client proprietario per gli insert, `PrismaService` come `wasteflow_app`, ogni chiamata in `TenantContext.run`, pulizia dei tenant creati), `RaccogliScadenzeUseCase` costruito con `new MudIntegrazioniService(app, new MudVersionRegistry(), loggerStub)`:
- `'FIR del produttore: senza scarico voce, con scarico vigente nessuna voce, con la ricopia annullata di nuovo voce, con la ricopia rettificata nessuna voce'`;
- `'uno scarico di un altra azienda con lo stesso firId non nasconde il ritardo'` (tenant B, insert col proprietario);
- `'le voci di un altra azienda non compaiono'` (FIR del produttore in B, lettura nel contesto di A: nessuna voce).

- [ ] **Step 2: eseguire i test e vederli fallire**

Run: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit src/application/scadenze/raccogli-scadenze.use-case.spec.ts src/application/registro/lettori-movimenti.spec.ts`
Expected: FAIL (modulo inesistente). Il test Postgres: `cd apps/backend && DATABASE_URL=... npm run test:postgres -- raccogli-scadenze`, Expected: FAIL.

- [ ] **Step 3: implementare**

Use case come da Interfaces. In `LETTORI`: `'application/scadenze/raccogli-scadenze.use-case.ts': { scelta: 'vigenti', motivo: 'FIR senza movimento vigente collegato: una ricopia annullata non vale come annotazione' }`. In `mud.module.ts` aggiungere `MudIntegrazioniService` e `MudVersionRegistry` agli `exports`. In `.env.example`, sotto la sezione RENTRI: `# Data (MM-GG) del diritto di segreteria e contributo annuale RENTRI, da verificare ogni anno. Assente = nessun promemoria.` e `RENTRI_SCADENZA_VERSAMENTO=""`.

- [ ] **Step 4: eseguire i test e vederli passare**

I due comandi dello Step 2 più `npx jest --runInBand --forceExit src/application/mud/mud.module.spec.ts`. Expected: PASS.

- [ ] **Step 5: verificare il merge con F2-6**

Run: `git merge-tree --write-tree HEAD feat/fase2-6-deposito > /dev/null; echo $?`
Expected: `0` (nessun conflitto, in particolare su `lettori-movimenti.spec.ts`). Se esce `1`, fermarsi e avvisare il coordinatore.

- [ ] **Step 6: commit**

```bash
git add apps/backend/src/application/scadenze/raccogli-scadenze.use-case.ts apps/backend/src/application/scadenze/raccogli-scadenze.use-case.spec.ts apps/backend/src/application/scadenze/raccogli-scadenze.use-case.postgres.spec.ts apps/backend/src/application/mud/mud.module.ts apps/backend/src/application/registro/lettori-movimenti.spec.ts apps/backend/.env.example
git commit -m "feat(studio): scadenze di una azienda dai FIR, dal registro vigente e dal MUD"
```

---

### Task 7: una sola composizione per il cruscotto e per Studio

**Files:**
- Create: `apps/backend/src/application/dashboard/attenzione-azienda.service.ts`
- Test: `apps/backend/src/application/dashboard/attenzione-azienda.service.spec.ts`
- Modify: `apps/backend/src/api/dashboard/attenzione.controller.ts:31-75`, `apps/backend/src/api/dashboard/dashboard.module.ts:40-48`

**Interfaces:**
- Consumes: `RaccogliAttenzioneUseCase.raccogli(tenantId)`, `RaccogliIndicatoriAzioneUseCase.raccogli(tenantId)`, `RaccogliScadenzeUseCase.raccogli(tenantId, adesso)` (Task 6), `ordinaVociPerGravita`.
- Produces: `@Injectable() class AttenzioneAziendaService` con `raccogli(tenantId: string, adesso: Date = new Date()): Promise<AttenzioneResult>` (le tre fonti in parallelo, ordinate con `ordinaVociPerGravita`). `AttenzioneController.getAttenzione` delega a questo servizio con `requireRequestTenantId(req)`. `DashboardModule` importa `MUDModule` e fornisce `RaccogliScadenzeUseCase` e `AttenzioneAziendaService`.

- [ ] **Step 1: scrivere il test che fallisce**
  - `'fonde le voci delle tre fonti ordinate per gravità'` (un `informativo` dalle scadenze, un `critico` dagli indicatori, un `avviso` dall'attenzione → ordine critico, avviso, informativo);
  - `'passa lo stesso tenantId alle tre fonti e lo stesso adesso alle scadenze'`.
- [ ] **Step 2: eseguire e vederlo fallire.** Run: `... npx jest --runInBand --forceExit src/application/dashboard/attenzione-azienda.service.spec.ts`. Expected: FAIL, modulo inesistente.
- [ ] **Step 3: implementare il servizio, la delega nel controller e il wiring del modulo.** Il commento del controller cita le tre fonti.
- [ ] **Step 4: eseguire e vederlo passare**, poi `npx tsc --noEmit -p apps/backend/tsconfig.json`. Expected: PASS, nessun errore di tipi.
- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/dashboard/attenzione-azienda.service.ts apps/backend/src/application/dashboard/attenzione-azienda.service.spec.ts apps/backend/src/api/dashboard/attenzione.controller.ts apps/backend/src/api/dashboard/dashboard.module.ts
git commit -m "feat(studio): il cruscotto dell'azienda mostra anche le scadenze nuove"
```

---

### Task 8: endpoint consulente `GET /consultant/scadenze`

**Files:**
- Create: `apps/backend/src/application/dashboard/raccogli-scadenze-aziende.use-case.ts`, `apps/backend/src/api/dashboard/scadenze-aziende.controller.ts`
- Test: `apps/backend/src/application/dashboard/raccogli-scadenze-aziende.use-case.spec.ts`, `apps/backend/src/api/dashboard/scadenze-aziende.controller.spec.ts`, `apps/backend/src/api/dashboard/dashboard.module.spec.ts`
- Modify: `apps/backend/src/api/dashboard/dashboard.module.ts` (import `MeModule`, controller nuovo)

**Interfaces:**
- Consumes: `AttenzioneAziendaService.raccogli(tenantId, adesso)` (Task 7); `MembershipService.listTenants(user: CurrentUserPayload): Promise<{ tenants: Array<{ id: string; ragioneSociale: string; parentTenantId: string | null }>; currentTenantId: string | null }>`; `TenantContext.run`; `mapConLimite` (`core/utils/map-con-limite.ts`); `resolveRequestTenantId` (`core/context/resolve-request-tenant.ts`); `giornoItaliano`.
- Produces:
  - `interface ScadenzaAzienda extends VoceAttenzione { aziendaId: string; aziendaNome: string }`
  - `interface ScadenzeAziendeResult { oggi: string; scadenze: ScadenzaAzienda[]; aziende: Array<{ id: string; nome: string }>; aziendeNonLette: Array<{ id: string; nome: string }> }`
  - `RaccogliScadenzeAziendeUseCase.raccogli(aziende: Array<{ id: string; nome: string }>, adesso: Date = new Date()): Promise<ScadenzeAziendeResult>`: al massimo 4 aziende insieme (`LIMITE_AZIENDE_IN_PARALLELO = 4`, come la vista di gruppo, con commento sul pool); ogni azienda in `TenantContext.run({ tenantId: id }, async () => await servizio.raccogli(id, adesso))`; un errore di una azienda la mette in `aziendeNonLette` (log `warn` con l'id) senza fermare le altre; scarta le voci con `dataTermine` null e `gravita 'informativo'`; ordina per `dataTermine` crescente (null in fondo), poi gravità, poi `aziendaNome`; `oggi = giornoItaliano(adesso)`.
  - `GET /consultant/scadenze` (`@Controller('consultant')`, `@UseGuards(JwtAuthGuard)` importato come in `attenzione.controller.ts`) → `ScadenzeAziendeResult & { aziendaAttivaId: string | null }`; le aziende vengono da `membership.listTenants(user)` (`{ id, nome: ragioneSociale }`), `aziendaAttivaId` da `resolveRequestTenantId(req)`. Il controller non legge `user.tenantId` (guardia `controller-tenant-selezionato.spec.ts`).

- [ ] **Step 1: scrivere i test che falliscono**

Use case:
- `'ogni azienda è letta nel proprio contesto'` → il finto `raccogli` registra `TenantContext.getStoreTenantId()` e lo confronta col tenantId ricevuto, per due aziende;
- `'aggiunge azienda a ogni voce e scarta le informative senza data'`;
- `'ordina per data di termine, le voci senza data in fondo'`;
- `'un azienda che fallisce finisce in aziendeNonLette e le altre restano'`;
- `'oggi è il giorno di Roma'` → `adesso = new Date('2026-10-27T23:30:00Z')` → `oggi '2026-10-28'`;
- `'nessuna azienda: risposta vuota senza chiamate'`.

Controller: `'passa al use case le aziende accessibili dell utente e restituisce l azienda attiva della richiesta'` (`listTenants` finto, `req = { tenantId: 'T2', user }` → `aziendaAttivaId 'T2'`).

Modulo (`dashboard.module.spec.ts`, come `api/permissions/permissions.module.spec.ts`: `ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })`, `EventEmitterModule.forRoot()` se richiesto, `.compile()` senza `.init()`): `'risolve AttenzioneController, ScadenzeAziendeController, AttenzioneAziendaService e RaccogliScadenzeAziendeUseCase'`.

- [ ] **Step 2: eseguire i test e vederli fallire**

Run: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit src/application/dashboard/raccogli-scadenze-aziende.use-case.spec.ts src/api/dashboard`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: implementare use case, controller e wiring** (`DashboardModule` importa `MeModule` per `MembershipService`).
- [ ] **Step 4: eseguire i test, le guardie statiche, i tipi e il lint**

Run: il comando dello Step 2, poi `npx jest --runInBand --forceExit src/api/controller-tenant-selezionato.spec.ts src/api/nessun-user-userid.spec.ts src/infrastructure/persistence/punti-di-sistema.spec.ts src/infrastructure/persistence/letture-tenants.spec.ts src/core/context/azienda-piattaforma-esclusione.spec.ts`, `npx tsc --noEmit -p apps/backend/tsconfig.json`, `cd apps/backend && npx eslint "{src,test}/**/*.ts" --quiet`.
Expected: PASS, 0 errori.

- [ ] **Step 5: commit**

```bash
git add apps/backend/src/application/dashboard/raccogli-scadenze-aziende.use-case.ts apps/backend/src/application/dashboard/raccogli-scadenze-aziende.use-case.spec.ts apps/backend/src/api/dashboard/scadenze-aziende.controller.ts apps/backend/src/api/dashboard/scadenze-aziende.controller.spec.ts apps/backend/src/api/dashboard/dashboard.module.ts apps/backend/src/api/dashboard/dashboard.module.spec.ts
git commit -m "feat(studio): scadenze di tutte le aziende del consulente, ognuna nel suo contesto"
```

---

### Task 9: modello e raggruppamento nel frontend

**Files:**
- Create: `apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.model.ts`, `.../scadenze-studio/scadenze-studio.service.ts`
- Test: `.../scadenze-studio/scadenze-studio.model.spec.ts`, `.../scadenze-studio/scadenze-studio.service.spec.ts`
- Modify: `apps/frontend/src/app/features/dashboard/attenzione.service.ts:14-23`

**Interfaces:**
- Consumes: forma di `GET /consultant/scadenze` (Task 8).
- Produces:
  - in `VoceAttenzione` del frontend: `dataTermine?: string | null`, `fonte?: string`;
  - `interface ScadenzaAzienda extends VoceAttenzione { aziendaId: string; aziendaNome: string }`;
  - `interface ScadenzeAziendeRisposta { oggi: string; scadenze: ScadenzaAzienda[]; aziende: Array<{ id: string; nome: string }>; aziendeNonLette: Array<{ id: string; nome: string }>; aziendaAttivaId: string | null }`;
  - `type CodiceGruppo = 'scaduto' | 'oggi' | 'domani' | 'settimana' | 'avanti' | 'senza-termine'`; `interface GruppoScadenze { codice: CodiceGruppo; etichetta: string; scadenze: ScadenzaAzienda[] }`;
  - `raggruppaScadenze(scadenze: ScadenzaAzienda[], oggi: string): GruppoScadenze[]` — etichette `Scaduto`, `Oggi`, `Domani`, `Questa settimana` (da oggi+2 a oggi+7), `Più avanti` (oltre), `Senza data di termine`; ordine fisso, gruppi vuoti omessi; nel gruppo data crescente, poi critico/avviso/informativo, poi `aziendaNome`. Differenza fra giorni con `Date.UTC` sulle stringhe.
  - `tipoDiScadenza(chiave: string): { codice: string; etichetta: string }` per prefisso, nell'ordine: `registro-` → `registro`/`Registro di carico e scarico`; `fir-senza-riscontro` → `riscontro`/`FIR senza riscontro`; `mud-` → `mud`/`MUD`; `rentri-versamento` → `versamento-rentri`/`Versamento RENTRI`; `certificato-rentri` → `certificato`/`Certificato RENTRI`; `autorizzazione` → `autorizzazione`/`Autorizzazioni impianto`; `trasportatore-iscrizione` → `albo`/`Iscrizione Albo trasportatori`; `destinatario-autorizzazione` → `destinatario`/`Autorizzazioni destinatari`; `scorta-vidimata` → `scorta`/`Numeri vidimati`; `formulari-da-trasmettere` → `trasmissione`/`Formulari da trasmettere`; altrimenti `{ codice: chiave, etichetta: 'Altro' }`.
  - `@Injectable({ providedIn: 'root' }) class ScadenzeStudioService` con `carica(): Observable<ScadenzeAziendeRisposta>` → GET `${environment.apiUrl}/consultant/scadenze`.

- [ ] **Step 1: scrivere i test che falliscono** (`OGGI = '2026-10-28'`)
  - `'mette ogni scadenza nel suo gruppo'`: `'2026-10-20'` scaduto, `'2026-10-28'` oggi, `'2026-10-29'` domani, `'2026-10-30'` e `'2026-11-04'` settimana, `'2026-11-05'` avanti, `null` senza-termine;
  - `'ordine dei gruppi fisso e gruppi vuoti omessi'`;
  - `'nel gruppo: data crescente, poi critico prima di avviso'`;
  - `'il giorno viene da oggi della risposta, non dall orologio del browser'` (`jasmine.clock().mockDate(new Date('2026-10-27T22:30:00Z'))`, `oggi '2026-10-28'`: `'2026-10-28'` è in `Oggi`);
  - `'tipoDiScadenza: prefissi noti e Altro'` (`'scorta-vidimata-123'` → `scorta`; `'sconosciuta'` → `Altro`);
  - service: `'carica chiama GET /consultant/scadenze'` con `HttpTestingController`.
- [ ] **Step 2: eseguire e vederli fallire.** Run: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/permissions/pages/consultant-dashboard/scadenze-studio`. Expected: FAIL, moduli inesistenti.
- [ ] **Step 3: implementare model e service; aggiungere i due campi a `VoceAttenzione` di `attenzione.service.ts`.**
- [ ] **Step 4: eseguire e vederli passare**, poi `cd apps/frontend && npx tsc --noEmit -p tsconfig.app.json`. Expected: PASS.
- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.model.ts apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.model.spec.ts apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.service.ts apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.service.spec.ts apps/frontend/src/app/features/dashboard/attenzione.service.ts
git commit -m "feat(studio): raggruppamento delle scadenze per vicinanza nel frontend"
```

---

### Task 10: cambio azienda unico, con conferma

**Files:**
- Create: `apps/frontend/src/app/core/services/cambio-azienda.service.ts`
- Test: `apps/frontend/src/app/core/services/cambio-azienda.service.spec.ts`
- Modify: `apps/frontend/src/app/shared/components/layout.component.ts` (`ngOnInit` `:1467`, `onUserTenantChange` `:1529-1553`, `onTenantChange` `:1560-1569`)

**Interfaces:**
- Consumes: `POST ${environment.apiUrl}/me/switch-tenant` (`{ tenantId }` → `{ accessToken, refreshToken? }`), `AdminTenantContextService.set(id, name)`, `AuthService.currentUser()` (ruolo `SUPER_ADMIN`), `MessageService`, `Router`.
- Produces:
  - `APRI_CON_RICARICA = new InjectionToken<(url: string | null) => void>('APRI_CON_RICARICA', { providedIn: 'root', factory: () => url => (url ? window.location.assign(url) : window.location.reload()) })` (stesso schema di `RICARICA_PAGINA` in `core/interceptors/tenant.interceptor.ts`);
  - `CHIAVE_AZIENDA_APPENA_APERTA = 'wf_azienda_appena_aperta'` (sessionStorage);
  - `@Injectable({ providedIn: 'root' }) class CambioAziendaService`:
    - `cambia(destinazione: { aziendaId: string; aziendaNome: string; rotta: string | null }, aziendaAttivaId: string | null): void` — stessa azienda e rotta presente: `router.navigateByUrl(rotta)`, niente altro. Super admin: `tenantContext.set(id, nome)`, nome in sessionStorage, `apriConRicarica(rotta)`. Altri: POST `/me/switch-tenant`, `accessToken`/`refreshToken` in `localStorage` come fa oggi il layout, nome in sessionStorage, `apriConRicarica(rotta)`. Errore: toast `severity 'error'`, `summary 'Cambio azienda non riuscito'`, `detail 'Impossibile cambiare azienda. Riprova più tardi.'`, nessuna navigazione e nessun nome salvato.
    - `mostraConfermaInSospeso(): void` — se c'è il nome in sessionStorage: toast `severity 'info'`, `summary 'Azienda attiva'`, `detail` `` `Ora stai lavorando su ${nome}` ``, poi lo toglie. Accessi a storage in `try/catch`.
  - Layout: `ngOnInit` chiama `mostraConfermaInSospeso()`; `onUserTenantChange` e `onTenantChange` delegano a `cambia({ aziendaId, aziendaNome, rotta: null }, null)` con il nome preso dagli elenchi che il layout ha già (`userTenants()`, `adminTenants()`). `onTenantClear` resta com'è.

- [ ] **Step 1: scrivere il test che fallisce** (`HttpClientTestingModule`, `APRI_CON_RICARICA` sostituito da una spia, `AuthService` finto, `MessageService` con spia su `add`, `localStorage`/`sessionStorage` puliti in `afterEach`)
  - `'azienda già attiva: naviga senza cambio e senza ricarica'`;
  - `'utente standard: switch-tenant, token salvati, nome in sospeso, ricarica sulla rotta'` → `expectOne` POST con body `{ tenantId: 'A' }`, flush `{ accessToken: 'tok', refreshToken: 'ref' }`, `localStorage.getItem('accessToken') === 'tok'`, `sessionStorage.getItem(CHIAVE_AZIENDA_APPENA_APERTA) === 'Alfa Srl'`, spia chiamata con `'/registro'`;
  - `'super admin: AdminTenantContextService.set e ricarica, nessuna POST'`;
  - `'cambio fallito: toast di errore, nessuna navigazione, nessun nome in sospeso'`;
  - `'mostraConfermaInSospeso: toast Ora stai lavorando su Alfa Srl una sola volta'`.
- [ ] **Step 2: eseguire e vederlo fallire.** Run: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/core/services/cambio-azienda.service.spec.ts`. Expected: FAIL, modulo inesistente.
- [ ] **Step 3: implementare il servizio e la delega nel layout.**
- [ ] **Step 4: eseguire il test, quello del layout, i tipi e il lint**

Run: il comando dello Step 2, poi `--include=src/app/shared/components/layout.component.spec.ts`, `cd apps/frontend && npx tsc --noEmit -p tsconfig.app.json`, dalla radice `npx eslint "apps/frontend/src/app/core/services/**/*.ts" "apps/frontend/src/app/shared/components/layout.component.ts" --max-warnings=-1`. Expected: PASS, nessun errore.

- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/core/services/cambio-azienda.service.ts apps/frontend/src/app/core/services/cambio-azienda.service.spec.ts apps/frontend/src/app/shared/components/layout.component.ts
git commit -m "feat(studio): cambio azienda unico con conferma dell'azienda attiva"
```

---

### Task 11: la scheda Scadenze nella dashboard consulente

**Files:**
- Create: `apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.component.ts`
- Test: `.../scadenze-studio/scadenze-studio.component.spec.ts`
- Modify: `apps/frontend/src/app/features/permissions/pages/consultant-dashboard/consultant-dashboard.component.ts:31-41` (imports e template, subito dopo l'header), `.../consultant-dashboard.component.spec.ts` (`beforeEach`)

**Interfaces:**
- Consumes: Task 9 (`ScadenzeStudioService.carica`, `raggruppaScadenze`, `tipoDiScadenza`, tipi), Task 10 (`CambioAziendaService.cambia`), `contrassegnoAzienda(id, nome)` (`shared/utils/contrassegno-azienda.ts`).
- Produces: `ScadenzeStudioComponent`, selector `app-scadenze-studio`, standalone, PrimeNG `TagModule`, `ButtonModule`, `TooltipModule`, `DropdownModule`, `FormsModule`. Signals: `risposta`, `filtroAzienda: string | null`, `filtroTipo: string | null`, `gruppi` (computed: filtri poi `raggruppaScadenze(..., risposta().oggi)`), `stato: 'caricamento' | 'pronto' | 'errore'`.
- Contenuto:
  - `<section class="surface-card mb-section" aria-label="Scadenze">`, titolo "Scadenze";
  - due `p-dropdown` (`Tutte le aziende` + `risposta.aziende`; `Tutti i tipi` + i tipi presenti via `tipoDiScadenza`), `[showClear]="true"`;
  - per gruppo un `<h3>` con l'etichetta e il conteggio; per riga: contrassegno (`span` con iniziali e `[style.background]` = colore, `aria-hidden`, nome dell'azienda in chiaro accanto), `p-tag` della gravità con le stesse etichette e severità del cruscotto (`critico` → `danger`, `avviso` → `warning`, `informativo` → `info`), titolo, riga secondaria `dettaglio · fonte` con `pTooltip` = `fonte`, pulsante con `azione.etichetta` (o `'Apri azienda'` verso `'/dashboard'` se l'azione manca) che chiama `cambia({ aziendaId, aziendaNome, rotta }, risposta.aziendaAttivaId)`; `aria-label` del pulsante `` `${etichetta}: ${aziendaNome}, ${titolo}` ``;
  - vuoto senza filtri: "Nessuna scadenza nei prossimi 30 giorni"; vuoto con filtri: "Nessuna scadenza con questi filtri";
  - `aziendeNonLette` non vuoto: avviso "Scadenze non disponibili per: <nomi>";
  - errore: "Impossibile caricare le scadenze" con pulsante "Riprova".
- Nella dashboard consulente `<app-scadenze-studio />` è il primo elemento dopo `page-header`.

- [ ] **Step 1: scrivere i test che falliscono**

Componente (`HttpClientTestingModule`, `CambioAziendaService` con spia, risposta con `oggi '2026-10-28'`, due aziende `Alfa Servizi Srl` e `Beta Recuperi Srl`, cinque voci con date nei cinque gruppi):
- `'mostra i gruppi nell ordine Scaduto, Oggi, Domani, Questa settimana, Più avanti'` (indici crescenti nel `textContent`);
- `'ogni riga ha il contrassegno dell azienda con iniziali e colore'` → `AS` e `style.background` uguale a `contrassegnoAzienda(id, 'Alfa Servizi Srl').colore` normalizzato dal browser (confrontare via un elemento di prova con lo stesso colore);
- `'la fonte è nella riga secondaria'`;
- `'il filtro per azienda e quello per tipo restringono l elenco'`;
- `'stato vuoto: Nessuna scadenza nei prossimi 30 giorni'`;
- `'aziende non lette: avviso con i nomi'`;
- `'l azione cambia azienda e apre la rotta della voce'` → `cambia` chiamato con `({ aziendaId: 'A', aziendaNome: 'Alfa Servizi Srl', rotta: '/registro' }, 'B')`;
- `'errore di caricamento: messaggio e Riprova che ricarica'`.

Dashboard consulente: nel `beforeEach` esistente, dopo il flush di `/api/v1/consultant/dashboard`, aggiungere `http.expectOne(`${environment.apiUrl}/consultant/scadenze`).flush({ oggi: '2026-10-28', scadenze: [], aziende: [], aziendeNonLette: [], aziendaAttivaId: null })`; nuovo test `'la scheda Scadenze è la prima sezione della pagina'` (`querySelector('section')` ha `aria-label` `Scadenze`).

- [ ] **Step 2: eseguire e vederli fallire.** Run: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/permissions/pages/consultant-dashboard`. Expected: FAIL.
- [ ] **Step 3: implementare il componente e inserirlo nella dashboard consulente.** Lo stile del contrassegno (cerchio, testo bianco, iniziali) come `.contrassegno--sm` del layout, con i token del tema; nessun colore fisso fuori dalla tavolozza del contrassegno.
- [ ] **Step 4: eseguire test, tipi e lint**

Run: il comando dello Step 2, `cd apps/frontend && npx tsc --noEmit -p tsconfig.app.json`, dalla radice `npx eslint "apps/frontend/src/app/features/permissions/pages/consultant-dashboard/**/*.ts" --max-warnings=-1`. Expected: PASS, nessun errore.

- [ ] **Step 5: commit**

```bash
git add apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.component.ts apps/frontend/src/app/features/permissions/pages/consultant-dashboard/scadenze-studio/scadenze-studio.component.spec.ts apps/frontend/src/app/features/permissions/pages/consultant-dashboard/consultant-dashboard.component.ts apps/frontend/src/app/features/permissions/pages/consultant-dashboard/consultant-dashboard.component.spec.ts
git commit -m "feat(studio): scheda Scadenze in testa alla dashboard consulente"
```

---

## Dopo il merge dei branch esterni (non in questo piano)

- **F2-6:** un raccoglitore del deposito nell'array di `RaccogliScadenzeUseCase` (Task 6), che consuma il servizio di F2-6; tipo `deposito-` in `tipoDiScadenza` (Task 9).
- **Colonna "attività" sulle causali:** `termineAnnotazione` (Task 3) prende il termine dalla causale del movimento (10 giorni lavorativi dall'evento del ruolo, 2 per la gestione dell'impianto); la riga "termine da configurare" sparisce.
- **Flag ADR:** una voce in `regole/scadenze-annuali.ts` con la sua migration additiva.
