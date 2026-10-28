# Direzioni demo, filone Modulo: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una seconda impaginazione ("Vista modulo") del dialog di creazione e modifica della bozza FIR, con sezioni numerate, dati in blu, campo mancante segnato in rosso nel punto in cui andrebbe scritto e tavola da cianografia in modalità scura, sopra lo stesso modello del form di oggi.

**Architecture:** tutto il Modulo vive in file nuovi sotto `apps/frontend/src/app/features/fir/modulo/`. `fir-list.component.ts` riceve solo l'aggancio (interruttore, `<app-fir-modulo>` legato agli stessi `newFIR`, `trasportatoriAggiuntivi` e `firErrors`, form classico nascosto con uno stile) e la delega di `validateFir` all'unica lista dei controlli di creazione. I campi mancanti arrivano da una `SorgentePrerequisiti` iniettata con un token: oggi i controlli di creazione del DTO, domani l'endpoint "prerequisiti di emissione", cambiando solo la factory del token. La scelta delle parti sta in componenti isolati sotto `modulo/parti/`, da adattare dopo F2-10.

**Tech Stack:** Angular 17 standalone, PrimeNG 17 (`dropdown`, `inputnumber`, `inputswitch`, `inputtextarea`, `message`, `button`, `tooltip`), RxJS, Karma/Jasmine. Nessuna libreria nuova.

**Spec:** `docs/superpowers/specs/2026-10-28-direzioni-demo-design.md`, sezione "3. Modulo" (più "Vincoli trasversali").

## Global Constraints

- Lavoro nel branch del filone Modulo creato dal coordinatore da `master` (worktree `C:\Progetti\rifiuti-wt-direzioni` o un suo derivato). Percorsi frontend relativi a `apps/frontend/src/app/` salvo indicazione.
- **File condivisi.** Si tocca **solo** `features/fir/fir-list.component.ts`, e solo nel Task 7, nei tre punti indicati lì. Non si toccano: `features/fir/fir-form.ts`, `fir-form.spec.ts`, `fir.service.ts`, `shared/models/fir.model.ts`, `fir-detail.component.ts`, `fir-list.component.spec.ts`, `shared/models/registry.model.ts`, `features/registry/**`, `features/contracts/**`, `styles.scss`, nessun file backend. Motivo: sono nel piano del Task 7 di F2-10 (`feat/fase2-10-controparti`, `docs/superpowers/plans/2026-10-28-fase2-10-controparti.md:855-872`) o nei diff di F2-6/F2-8/F2-10.
- **Testi**: italiano, termini tecnici in inglese. Mai "4ª copia". Mai "conforme al modello ufficiale" né diciture equivalenti finché `NUMERAZIONE_UFFICIALE_VERIFICATA` è `false`.
- **Colori**: solo token del tema (`var(--…)` di `styles.scss`). Nessun letterale `#…`, `rgb(`, `hsl(` nei file di `features/fir/modulo/`.
- **Id degli elementi** del Modulo con prefisso `mod-` (il form classico resta nel DOM, nascosto: gli id `new-*` non vanno duplicati).
- Nessuna seconda lista dei requisiti RENTRI nel frontend. I controlli di creazione esistono in un solo punto (`modulo/controlli-creazione.ts`), usato sia dal Modulo sia da `validateFir`.
- Vincoli F2-4/F2-7 restano quelli già implementati in `fir-list.component.ts`: modifica solo con `modificabile`, PUT con `versione` e `unitaMisura`, 409 gestiti da `gestisciErroreModifica`, tratte senza `trasportatoreId` rifiutate da `showEditDialog`. Il Modulo non li reimplementa: li attraversa, e il Task 7 lo prova.
- TDD: prima lo spec che fallisce. Spec mirato: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include="<percorso dello spec da apps/frontend>"`. Suite intera **una volta** a fine task: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless`. Poi `cd apps/frontend && npm run build` e, dalla root, `npx prettier --write <file toccati>` e `npx eslint "apps/frontend/src/**/*.ts" --max-warnings=-1` (zero errori).
- Commit nello stile del repo (`feat(modulo): …`, `test(modulo): …`), **senza** righe `Co-Authored-By` o altre attribuzioni AI.

## Review Focus

- Un requisito con `percorsoCampo` che non corrisponde a nessuna sezione (succederà con l'endpoint futuro, che conosce campi RENTRI assenti dal form) deve comparire nel riquadro "Altri dati da completare", non sparire. Test nel Task 5.
- Il modello cambiato dal genitore senza passare dal Modulo (anagrafica salvata dal sotto-dialog, rilettura dopo un 409, `showEditDialog` che sostituisce `newFIR`) deve ricalcolare i segni rossi. Test nei Task 5 e 7.
- Una tratta aggiunta e lasciata senza trasportatore viene scartata in silenzio dal salvataggio di oggi: il Modulo lo deve dire sulla riga. Test nel Task 4.
- In modifica l'unità di misura non deve potersi svuotare (il PUT la richiede): la tendina del Modulo non ha il pulsante di cancellazione. Test nel Task 5.
- La preferenza "Vista modulo" di un utente non deve valere per un altro utente sullo stesso browser, e uno storage bloccato non deve rompere il dialog. Test nel Task 3.

---

## Esito della ricerca del modello ufficiale (fatta scrivendo il piano, da riportare nel Task 1)

- **Il modello del formulario del DM 4 aprile 2023 n. 59 non è nel repo.** Cercato in `docs/contracts/rentri/` (contratti OpenAPI: `formulari.yaml` descrive l'API, non il modulo cartaceo; nessuna occorrenza di "allegato", "riquadro" o di una numerazione di sezioni), in `docs/audits/rentri-lacune-modello-fir-2026-09-10.md` (corrispondenza campo per campo con `NuovoFormularioModel`, nessuna numerazione), in `api/fir/dtos/create-fir.dto.ts` e in `infrastructure/pdf/pdf.service.ts`.
- **I "Campo N" sparsi nel codice si contraddicono** e non vanno usati: "Campo 1" è la provenienza in `shared/models/fir.model.ts:68`, `fir.service.ts:9`, `fir-list.component.ts:1282`, ma "Produttore o Detentore" in `docs/audits/attriti-utenti-rentri-2026-09-11.md:95`; "Campo 4" è la tratta principale in `create-fir.dto.ts:206` e `schema.prisma:360`, ma il produttore è "Campo 4/6", il trasportatore "Campo 7" e il destinatario "Campo 9/10" in `domain/fir/fir.aggregate.ts:28-40`; restano "Campo 2" (rifiuto), "Campo 3" (operazione R/D), "Campo 17" (annotazioni), di provenienza non documentata.
- **Numerazione provvisoria adottata:** l'ordine delle proprietà di `DatiPartenzaModel` nel contratto ufficiale (`docs/contracts/rentri/formulari.yaml:7491` e seguenti: `produttore`, `destinatario`, `trasportatori`, `intermediari`, `rifiuto`, `trasbordo_parziale_origine`, `annotazioni`), senza le sezioni che il form non ha (intermediari, trasbordo). L'operazione R/D va nella sezione del destinatario perché il contratto la porta in `destinatario.attivita` (`DatiDestinatarioFormularioBaseModel`, `formulari.yaml:7062`); l'ordine dei campi del rifiuto segue `DatiRifiutoModel` (`formulari.yaml:7892`). È marcata come provvisoria nel codice e nell'interfaccia, in un solo file.

## File

| File | Responsabilità | Task |
|---|---|---|
| `features/fir/modulo/sezioni-modulo.ts` (+ spec) | unica mappatura sezioni → campi, numerazione provvisoria e sua fonte | 1 |
| `docs/superpowers/specs/2026-10-28-direzioni-demo-design.md` | esito della ricerca del modello ufficiale | 1 |
| `features/fir/modulo/prerequisiti.ts` | interfacce `PrerequisitoMancante`, `ContestoPrerequisiti`, `SorgentePrerequisiti` | 2 |
| `features/fir/modulo/controlli-creazione.ts` (+ spec) | i controlli di creazione del DTO (unica lista) e la sorgente che li espone | 2 |
| `features/fir/modulo/sorgente-prerequisiti.token.ts` (+ spec) | token `SORGENTE_PREREQUISITI`: il solo punto da cambiare per l'endpoint futuro | 2 |
| `features/fir/modulo/vista-modulo.service.ts` (+ spec) | preferenza "Vista modulo" per utente | 3 |
| `features/fir/modulo/fir-vista-modulo-interruttore.component.ts` (+ spec) | interruttore nel dialog | 3 |
| `features/fir/modulo/tipi-modulo.ts` | tipi condivisi dai componenti del Modulo | 4 |
| `features/fir/modulo/parti/fir-modulo-parte.component.ts` (+ spec) | tendina di una parte (produttore, trasportatore, destinatario), isolata per F2-10 | 4 |
| `features/fir/modulo/parti/fir-modulo-tratte.component.ts` (+ spec) | righe delle tratte intermodali, isolate per F2-10 | 4 |
| `features/fir/modulo/fir-modulo.component.ts` (+ spec) | impaginazione, segni dei mancanti, sola lettura | 5, 6 |
| `features/fir/fir-list.component.ts` | aggancio e delega di `validateFir` (eccezione dichiarata) | 7 |
| `features/fir/fir-list.vista-modulo.spec.ts` | integrazione col dialog (spec nuovo, non quello esistente) | 7 |

---

### Task 1: sezioni del Modulo e fonte della numerazione

**Files:**
- Create: `apps/frontend/src/app/features/fir/modulo/sezioni-modulo.ts`
- Test: `apps/frontend/src/app/features/fir/modulo/sezioni-modulo.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-28-direzioni-demo-design.md` (sezione "### Fonte dell'impaginazione", in coda)

**Interfaces:**
- Produces:
  - `export type IdSezioneModulo = 'produttore' | 'destinatario' | 'trasportatori' | 'rifiuto' | 'annotazioni'`
  - `export interface CampoModulo { readonly percorso: string; readonly etichetta: string }`
  - `export interface SezioneModulo { readonly id: IdSezioneModulo; readonly numero: string; readonly titolo: string; readonly campi: readonly CampoModulo[] }`
  - `export const NUMERAZIONE_UFFICIALE_VERIFICATA: boolean` (oggi `false`)
  - `export const FONTE_NUMERAZIONE: string`
  - `export const SEZIONI_MODULO: readonly SezioneModulo[]`
  - `export function sezioneDelCampo(percorso: string): SezioneModulo | null`
  - I percorsi sono quelli di `CreateFIRDto` in notazione puntata (`'rifiuto.cerCode'`); `'trasportatoriAggiuntivi'` indica l'intero blocco delle tratte.

Contenuto fissato (ordine compreso):

| numero | id | titolo | campi (percorso → etichetta) |
|---|---|---|---|
| 1 | produttore | Produttore | `produttoreId` → Produttore |
| 2 | destinatario | Destinatario | `destinatarioId` → Destinatario; `rifiuto.codiceOperazione` → Operazione di recupero o smaltimento (R/D) |
| 3 | trasportatori | Trasportatori | `trasportatoreId` → Trasportatore; `tipoTrattaPrincipale` → Modalità di trasporto; `trasportatoriAggiuntivi` → Tratte aggiuntive (trasporto intermodale) |
| 4 | rifiuto | Rifiuto | `rifiuto.cerCode` → Codice CER; `provenienza` → Provenienza; `rifiuto.caratteristichePericolo` → Caratteristiche di pericolo (HP); `rifiuto.statoFisico` → Stato fisico; `rifiuto.quantita` → Quantità dichiarata; `rifiuto.unitaMisura` → Unità di misura; `rifiuto.numeroColli` → Numero colli |
| 5 | annotazioni | Annotazioni | `annotazioni` → Annotazioni |

`FONTE_NUMERAZIONE` = `'Numerazione provvisoria: ordine di DatiPartenzaModel nel contratto RENTRI (docs/contracts/rentri/formulari.yaml). Il modello del formulario del DM 59/2023 non è ancora stato verificato.'`

- [ ] **Step 1: scrivere lo spec che fallisce** (`sezioni-modulo.spec.ts`)

```ts
const PERCORSI_FORM = [
  'produttoreId', 'destinatarioId', 'rifiuto.codiceOperazione', 'trasportatoreId',
  'tipoTrattaPrincipale', 'trasportatoriAggiuntivi', 'rifiuto.cerCode', 'provenienza',
  'rifiuto.caratteristichePericolo', 'rifiuto.statoFisico', 'rifiuto.quantita',
  'rifiuto.unitaMisura', 'rifiuto.numeroColli', 'annotazioni',
]
it('cinque sezioni numerate da 1 a 5 nell’ordine di DatiPartenzaModel', () => {
  expect(SEZIONI_MODULO.map(s => s.id)).toEqual(['produttore', 'destinatario', 'trasportatori', 'rifiuto', 'annotazioni'])
  expect(SEZIONI_MODULO.map(s => s.numero)).toEqual(['1', '2', '3', '4', '5'])
})
it('ogni campo del form sta in una e una sola sezione', () => {
  const tutti = SEZIONI_MODULO.flatMap(s => s.campi.map(c => c.percorso))
  expect([...tutti].sort()).toEqual([...PERCORSI_FORM].sort())
})
it('l’operazione R/D sta col destinatario, come destinatario.attivita nel contratto', () => {
  expect(sezioneDelCampo('rifiuto.codiceOperazione')?.id).toBe('destinatario')
})
it('sezioneDelCampo: null per un percorso che il form non ha', () => {
  expect(sezioneDelCampo('produttore.indirizzo.comune')).toBeNull()
})
it('la numerazione è dichiarata provvisoria, con la sua fonte', () => {
  expect(NUMERAZIONE_UFFICIALE_VERIFICATA).toBeFalse()
  expect(FONTE_NUMERAZIONE).toContain('provvisoria')
  expect(FONTE_NUMERAZIONE).toContain('formulari.yaml')
})
```

- [ ] **Step 2:** `npx ng test … --include="src/app/features/fir/modulo/sezioni-modulo.spec.ts"` → FAIL (modulo inesistente).
- [ ] **Step 3: implementare `sezioni-modulo.ts`** con la tabella sopra. In testa al file un commento che riassume l'esito della ricerca (le tre righe del paragrafo "Esito della ricerca" di questo piano) e dice che **questo è l'unico file da correggere** quando il modello ufficiale sarà verificato: si cambiano tabella e costante, nient'altro.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: aggiornare il design.** In coda a "### Fonte dell'impaginazione" aggiungere il paragrafo "**Esito (2026-10-28).**" con i tre punti dell'esito della ricerca di questo piano e il rimando a `features/fir/modulo/sezioni-modulo.ts`.
- [ ] **Step 6:** suite intera, build, prettier, eslint (Global Constraints).
- [ ] **Step 7: commit**

```bash
git add apps/frontend/src/app/features/fir/modulo/sezioni-modulo.ts apps/frontend/src/app/features/fir/modulo/sezioni-modulo.spec.ts docs/superpowers/specs/2026-10-28-direzioni-demo-design.md
git commit -m "feat(modulo): sezioni del formulario con numerazione provvisoria dichiarata"
```

### Task 2: prerequisiti mancanti, controlli di creazione e sorgente sostituibile

**Files:**
- Create: `features/fir/modulo/prerequisiti.ts`, `features/fir/modulo/controlli-creazione.ts`, `features/fir/modulo/sorgente-prerequisiti.token.ts`
- Test: `features/fir/modulo/controlli-creazione.spec.ts`, `features/fir/modulo/sorgente-prerequisiti.token.spec.ts`

**Interfaces:**
- Consumes: `CreateFIRDto` da `features/fir/fir.service.ts` (sola importazione di tipo).
- Produces (`prerequisiti.ts`, solo tipi):
  - `export interface PrerequisitoMancante { readonly codice: string; readonly percorsoCampo: string; readonly messaggio: string }` — `percorsoCampo` è un percorso di `CreateFIRDto` come in `sezioni-modulo.ts`; una sorgente futura che conosce campi assenti dal form usa un suo percorso, e il Modulo lo mostra a parte.
  - `export interface ContestoPrerequisiti { readonly modello: CreateFIRDto; readonly firId: string | null }`
  - `export interface SorgentePrerequisiti { readonly completa: boolean; prerequisiti(contesto: ContestoPrerequisiti): Observable<readonly PrerequisitoMancante[]> }` — `completa: false` significa "non copre i requisiti RENTRI".
- Produces (`controlli-creazione.ts`):
  - `export function controlliCreazione(modello: CreateFIRDto): PrerequisitoMancante[]`
  - `export function chiaveErroreDaPercorso(percorso: string): string` e `export function percorsoDaChiaveErrore(chiave: string): string` — le chiavi sono quelle di `firErrors` di oggi: `'rifiuto.cerCode' ↔ 'cerCode'`, `'rifiuto.quantita' ↔ 'quantita'`, ogni altro percorso uguale alla chiave.
  - `export function erroriDaPrerequisiti(lista: readonly PrerequisitoMancante[]): Record<string, string>` (chiave = `chiaveErroreDaPercorso`, valore = `messaggio`; a parità di chiave vince il primo).
  - `export class SorgenteControlliCreazione implements SorgentePrerequisiti` con `completa = false` e `prerequisiti(c) = of(controlliCreazione(c.modello))`.
- Produces (`sorgente-prerequisiti.token.ts`): `export const SORGENTE_PREREQUISITI = new InjectionToken<SorgentePrerequisiti>('SORGENTE_PREREQUISITI', { providedIn: 'root', factory: () => new SorgenteControlliCreazione() })`. Commento: "Quando esisterà l'endpoint dei prerequisiti di emissione, si cambia solo questa factory."

I controlli, in quest'ordine (è l'ordine di `validateFir` oggi, `fir-list.component.ts:1650-1667`; i messaggi restano identici):

| codice | percorsoCampo | messaggio | mancante quando |
|---|---|---|---|
| `CREAZIONE_PRODUTTORE_MANCANTE` | `produttoreId` | Seleziona un produttore. | valore falsy |
| `CREAZIONE_TRASPORTATORE_MANCANTE` | `trasportatoreId` | Seleziona un trasportatore. | valore falsy |
| `CREAZIONE_DESTINATARIO_MANCANTE` | `destinatarioId` | Seleziona un destinatario. | valore falsy |
| `CREAZIONE_CER_MANCANTE` | `rifiuto.cerCode` | Il codice CER è obbligatorio. | vuoto dopo `trim()` |
| `CREAZIONE_QUANTITA_NON_VALIDA` | `rifiuto.quantita` | Indica una quantità maggiore di zero. | non è un numero `>= 0.01` (il DTO ha `@Min(0.01)`; oggi il frontend accetta `0.005`) |
| `CREAZIONE_PROVENIENZA_MANCANTE` | `provenienza` | Seleziona la provenienza del rifiuto. | valore falsy |
| `CREAZIONE_MODALITA_TRASPORTO_MANCANTE` | `tipoTrattaPrincipale` | Seleziona la modalità di trasporto. | valore falsy |

- [ ] **Step 1: spec che fallisce** (`controlli-creazione.spec.ts`), con un `modelloCompleto()` di supporto (p1/t1/d1, `'150101'`, `10`, `'kg'`, `'SPECIALE'`, `'TERRESTRE'`):
  - `'modello vuoto: sette mancanti nell’ordine di validateFir'` → `controlliCreazione(vuoto).map(p => p.codice)` uguale ai sette codici nell'ordine della tabella;
  - `'modello completo: nessun mancante'` → `[]`;
  - `'CER di soli spazi è mancante'` → contiene `CREAZIONE_CER_MANCANTE` con `percorsoCampo: 'rifiuto.cerCode'`;
  - `'quantità sotto 0,01 è non valida come nel DTO'` → `0.005` e `null as any` danno `CREAZIONE_QUANTITA_NON_VALIDA`; `0.01` no;
  - `'erroriDaPrerequisiti usa le chiavi di firErrors'` → sul modello vuoto restituisce esattamente `{ produttoreId: 'Seleziona un produttore.', trasportatoreId: 'Seleziona un trasportatore.', destinatarioId: 'Seleziona un destinatario.', cerCode: 'Il codice CER è obbligatorio.', quantita: 'Indica una quantità maggiore di zero.', provenienza: 'Seleziona la provenienza del rifiuto.', tipoTrattaPrincipale: 'Seleziona la modalità di trasporto.' }`;
  - `'chiavi e percorsi si convertono nei due sensi'` → `chiaveErroreDaPercorso('rifiuto.cerCode') === 'cerCode'`, `percorsoDaChiaveErrore('quantita') === 'rifiuto.quantita'`, `percorsoDaChiaveErrore('produttoreId') === 'produttoreId'`;
  - `'SorgenteControlliCreazione è parziale ed emette gli stessi controlli'` → `completa === false`, la prima emissione di `prerequisiti({ modello: vuoto, firId: null })` è uguale a `controlliCreazione(vuoto)`.
  - In `sorgente-prerequisiti.token.spec.ts`: `'per default la sorgente è quella dei controlli di creazione'` → `TestBed.inject(SORGENTE_PREREQUISITI)` è `instanceof SorgenteControlliCreazione`.
- [ ] **Step 2:** spec mirati → FAIL.
- [ ] **Step 3:** implementare i tre file con le firme sopra.
- [ ] **Step 4:** spec mirati → PASS.
- [ ] **Step 5:** suite intera, build, prettier, eslint.
- [ ] **Step 6: commit** — `git add` dei cinque file; `git commit -m "feat(modulo): prerequisiti mancanti con sorgente sostituibile, oggi i controlli di creazione"`

### Task 3: preferenza "Vista modulo" per utente e interruttore

**Files:**
- Create: `features/fir/modulo/vista-modulo.service.ts`, `features/fir/modulo/fir-vista-modulo-interruttore.component.ts`
- Test: `features/fir/modulo/vista-modulo.service.spec.ts`, `features/fir/modulo/fir-vista-modulo-interruttore.component.spec.ts`

**Interfaces:**
- Consumes: `AuthService.currentUser()` (`core/services/auth.service.ts:43`, `User.id`).
- Produces:
  - `export const PREFISSO_CHIAVE_VISTA_MODULO = 'wf_vista_modulo:'`; `export function chiaveVistaModulo(userId: string): string` (prefisso + id).
  - `@Injectable({ providedIn: 'root' }) export class VistaModuloService { readonly attiva: Signal<boolean>; imposta(attiva: boolean): void }`
  - `FirVistaModuloInterruttoreComponent`, selector `app-fir-vista-modulo-interruttore`, nessun input.

Regole: valore salvato in `localStorage` con chiave `chiaveVistaModulo(id)`, `'1'` se attiva, chiave rimossa se spenta; utente diverso → valore di quell'utente; nessun utente → solo in memoria, nulla scritto; `localStorage` che lancia → solo in memoria, nessuna eccezione (stesso schema `try/catch` di `core/services/tema.service.ts:59-75`). Default spento. Niente preferenze lato backend: non esiste un archivio delle preferenze utente e non è materia di questo filone.

Interruttore: `p-inputSwitch` con `inputId="fir-vista-modulo"`, `<label for="fir-vista-modulo">Vista modulo</label>`, `data-testid="fir-vista-modulo"`, stato da `attiva()`, cambio → `imposta(valore)`.

- [ ] **Step 1: spec che fallisce.** `AuthService` sostituito da `{ currentUser: signal<{ id: string } | null>({ id: 'u1' }) }`; `afterEach` rimuove le chiavi col prefisso.
  - `'spenta per default'`;
  - `'imposta(true) la ricorda per l’utente'` → `localStorage.getItem('wf_vista_modulo:u1') === '1'`; un'istanza nuova (dopo `TestBed.resetTestingModule()` e nuova configurazione) ha `attiva() === true`;
  - `'imposta(false) toglie la chiave'`;
  - `'un altro utente non eredita la preferenza'` → dopo `imposta(true)` per u1, `currentUser.set({ id: 'u2' })` → `false`; di nuovo u1 → `true`;
  - `'senza utente vale solo in memoria'` → `currentUser.set(null)`, `imposta(true)` → `attiva()` true e nessuna chiave col prefisso in `localStorage`;
  - `'storage bloccato: nessuna eccezione, vale in memoria'` → `spyOn(Storage.prototype, 'setItem').and.throwError('bloccato')`, `imposta(true)` non lancia e `attiva()` è true;
  - interruttore: `'riflette lo stato e lo cambia'` → con `imposta(true)` prima del render lo switch è acceso; click sullo switch (`.p-inputswitch`) → `attiva()` false; `'ha l’etichetta Vista modulo associata'` → `label[for="fir-vista-modulo"]` con testo `Vista modulo`.
- [ ] **Step 2:** spec mirati → FAIL.
- [ ] **Step 3:** implementare servizio e componente.
- [ ] **Step 4:** spec mirati → PASS.
- [ ] **Step 5:** suite intera, build, prettier, eslint.
- [ ] **Step 6: commit** — `git commit -m "feat(modulo): interruttore Vista modulo ricordato per utente"`

### Task 4: scelta delle parti e delle tratte in componenti isolati

Riusano la configurazione delle tendine di oggi (`fir-list.component.ts:349-372`, `407-432`, `477-502`, `563-601`) **copiandola** in file nuovi: estrarla da `fir-list` vorrebbe dire toccare le righe che il Task 7 di F2-10 riscrive. Dopo F2-10 si adattano qui (sede, codice fiscale) e `fir-list` potrà eventualmente adottarli.

**Files:**
- Create: `features/fir/modulo/tipi-modulo.ts`, `features/fir/modulo/parti/fir-modulo-parte.component.ts`, `features/fir/modulo/parti/fir-modulo-tratte.component.ts`
- Test: `features/fir/modulo/parti/fir-modulo-parte.component.spec.ts`, `features/fir/modulo/parti/fir-modulo-tratte.component.spec.ts`

**Interfaces:**
- Consumes: `Produttore`, `Trasportatore`, `Destinatario` (`shared/models/registry.model.ts`); `TipoAnagrafica`, `ModalitaAnagrafica` (`features/registry/anagrafica-form-dialog.component.ts:17-18`); `TipoTratta` (`features/fir/fir.service.ts:7`).
- Produces (`tipi-modulo.ts`):
  - `export interface OpzioneModulo { readonly label: string; readonly value: string | null; readonly disabled?: boolean }`
  - `export interface OpzioniModulo { readonly tipoTratta: readonly OpzioneModulo[]; readonly statoFisico: readonly OpzioneModulo[]; readonly provenienza: readonly OpzioneModulo[]; readonly hp: readonly OpzioneModulo[]; readonly operazioneRD: readonly OpzioneModulo[]; readonly unitaMisura: readonly OpzioneModulo[] }`
  - `export interface RichiestaAnagrafica { readonly tipo: TipoAnagrafica; readonly modalita: ModalitaAnagrafica; readonly id?: string }`
  - `export interface TrattaModulo { trasportatoreId: string | null; tipoTratta: TipoTratta }` (stessa forma di `trasportatoriAggiuntivi` in `fir-list.component.ts:1263`)
- Produces (`FirModuloParteComponent`, selector `app-fir-modulo-parte`):
  - `@Input({ required: true }) ruolo!: TipoAnagrafica`; `@Input({ required: true }) inputId!: string`; `@Input() opzioni: readonly (Produttore | Trasportatore | Destinatario)[] = []`; `@Input() valore: string | null | undefined`; `@Input() caricamento = false`; `@Input() messaggioErrore: string | null = null`; `@Input() disabilitato = false`
  - `@Output() valoreChange = new EventEmitter<string | null>()`; `@Output() apriAnagrafica = new EventEmitter<RichiestaAnagrafica>()`
  - `seleziona(id: string | null): void` (emette `valoreChange`), legato a `(onChange)` della tendina.
- Produces (`FirModuloTratteComponent`, selector `app-fir-modulo-tratte`):
  - `@Input() tratte: TrattaModulo[] = []` (lo stesso array del genitore: le righe legano `ngModel` direttamente ai suoi oggetti); `@Input() trasportatori: readonly Trasportatore[] = []`; `@Input() opzioniTipoTratta: readonly OpzioneModulo[] = []`; `@Input() disabilitato = false`
  - `@Output() aggiungi = new EventEmitter<void>()`; `@Output() rimuovi = new EventEmitter<number>()`

Markup della parte: tendina con `inputId`, `optionLabel="ragioneSociale"`, `optionValue="id"`, `[filter]="true"`, `filterBy="ragioneSociale,partitaIVA"`, `[showClear]="true"`, segnaposto `Cerca <ruolo>…`, voce "ragione sociale + P.IVA …" come oggi; pulsanti `Nuovo <ruolo>` (emette `{ tipo: ruolo, modalita: 'create' }`) e `Modifica <ruolo> selezionato` (disabilitato senza valore, emette `{ tipo, modalita: 'edit', id: valore }`); con `messaggioErrore` classe `p-invalid`, `aria-invalid="true"`, `aria-describedby="<inputId>-err"` e `<small id="<inputId>-err" role="alert">`. Avvisi copiati alla lettera da `fir-list.component.ts:462-469` e `531-538`, con `data-testid` `mod-trasportatore-iscrizione-scaduta` e `mod-destinatario-autorizzazione-scaduta`, mostrati solo per il ruolo giusto. `disabilitato` disabilita tendina e pulsanti.

Markup delle tratte: una riga per tratta (tipo tratta + trasportatore, aria-label `Tipo tratta trasportatore <i+2>` e `Trasportatore aggiuntivo <i+2>` come oggi, pulsante `Rimuovi trasportatore aggiuntivo <i+2>`), pulsante `Aggiungi trasportatore`; riga con `trasportatoreId` nullo → `<small data-testid="mod-tratta-vuota-<i>">Tratta senza trasportatore: non verrà salvata.</small>`.

- [ ] **Step 1: spec che fallisce.**
  - parte: `'scegliere una voce emette valoreChange'` (`triggerEventHandler('onChange', { value: 'p1' })` sulla `p-dropdown` → emesso `'p1'`); `'Nuovo emette la richiesta di creazione'` → `{ tipo: 'produttore', modalita: 'create' }`; `'Modifica è disabilitato senza valore e con valore emette edit con l’id'`; `'messaggioErrore: testo, aria-invalid e aria-describedby'`; `'avviso di iscrizione scaduta solo per il trasportatore'` (stesse opzioni con `iscrizioneScaduta: true` e ruolo `destinatario` → nessun avviso); `'avviso di autorizzazione scaduta per il destinatario'`; `'disabilitato blocca tendina e pulsanti'`.
  - tratte: `'una riga per tratta con le etichette di oggi'` (due tratte → `[aria-label="Trasportatore aggiuntivo 3"]` presente); `'Aggiungi emette aggiungi'`; `'Rimuovi emette l’indice'` (secondo pulsante → `1`); `'riga senza trasportatore: avviso che non verrà salvata'` (solo sulla riga con `null`); `'disabilitato blocca righe e pulsanti'`.
- [ ] **Step 2:** spec mirati → FAIL.
- [ ] **Step 3:** implementare i tre file.
- [ ] **Step 4:** spec mirati → PASS.
- [ ] **Step 5:** suite intera, build, prettier, eslint.
- [ ] **Step 6: commit** — `git commit -m "feat(modulo): scelta delle parti e delle tratte in componenti isolati"`

### Task 5: il Modulo, impaginazione e segni dei campi mancanti

**Files:**
- Create: `features/fir/modulo/fir-modulo.component.ts`
- Test: `features/fir/modulo/fir-modulo.component.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`SEZIONI_MODULO`, `sezioneDelCampo`, `NUMERAZIONE_UFFICIALE_VERIFICATA`, `FONTE_NUMERAZIONE`), Task 2 (`SORGENTE_PREREQUISITI`, `PrerequisitoMancante`, `chiaveErroreDaPercorso`), Task 4 (componenti e tipi), `CerSelectComponent` (`features/cer/cer-select.component.ts`, `ControlValueAccessor`, input `inputId`, `ariaLabel`, `invalid`, `ariaDescribedBy`).
- Produces (`FirModuloComponent`, selector `app-fir-modulo`):
  - Input: `@Input({ required: true }) modello!: CreateFIRDto`; `@Input() tratte: TrattaModulo[] = []`; `@Input() firId: string | null = null`; `@Input() errori: Record<string, string> = {}`; `@Input() produttori: readonly Produttore[] = []`; `@Input() trasportatori: readonly Trasportatore[] = []`; `@Input() destinatari: readonly Destinatario[] = []`; `@Input() caricamentoAnagrafiche = false`; `@Input({ required: true }) opzioni!: OpzioniModulo`; `@Input() solaLettura = false`
  - Output: `campoModificato = new EventEmitter<string>()` (emette la **chiave di `firErrors`**, cioè `chiaveErroreDaPercorso(percorso)`); `apriAnagrafica = new EventEmitter<RichiestaAnagrafica>()`; `aggiungiTratta = new EventEmitter<void>()`; `rimuoviTratta = new EventEmitter<number>()`
  - Pubblici: `readonly mancanti: Signal<readonly PrerequisitoMancante[]>`; `messaggioPer(percorso: string): string | null`; `altriRequisiti(): readonly PrerequisitoMancante[]`; `readonly sorgenteCompleta: boolean`.

Comportamento:
- **Ricalcolo.** In `ngDoCheck` si confronta `JSON.stringify({ modello, firId })` con l'ultimo valore; se cambia si spinge in un `Subject`, che con `switchMap` chiama `sorgente.prerequisiti({ modello, firId })` e aggiorna `mancanti` (sottoscrizione chiusa con `takeUntilDestroyed`). Così i segni seguono ogni cambiamento: dal Modulo, dal genitore che muta l'oggetto, dal genitore che lo sostituisce. Il debounce, se servirà, lo farà la sorgente dell'endpoint.
- `messaggioPer(p)` = `errori[chiaveErroreDaPercorso(p)]` se presente (errore del salvataggio o del backend), altrimenti il `messaggio` del primo mancante con `percorsoCampo === p`, altrimenti `null`. Con `solaLettura` restituisce sempre `null`.
- `altriRequisiti()` = mancanti con `sezioneDelCampo(percorsoCampo) === null`.
- **Struttura.** Contenitore `<div class="modulo" data-testid="fir-modulo">`; testata "Formulario di identificazione dei rifiuti" con, se `!NUMERAZIONE_UFFICIALE_VERIFICATA`, l'etichetta `Numerazione provvisoria` (`data-testid="mod-numerazione-provvisoria"`, `pTooltip` = `FONTE_NUMERAZIONE`); se `!sorgenteCompleta`, `<p role="note" data-testid="mod-controllo-parziale">Controllo parziale: i requisiti RENTRI sono verificati all'emissione.</p>`; se `altriRequisiti()` non è vuoto, riquadro `data-testid="mod-altri-requisiti"` titolato "Altri dati da completare" con un elemento per requisito (`messaggio`). Poi, per ogni sezione di `SEZIONI_MODULO` in ordine, `<section [attr.data-sezione]="id" [attr.aria-labelledby]="'mod-sez-' + id">` con `<h3 id="mod-sez-<id>">{{ numero }}. {{ titolo }}</h3>` e, per ogni campo, uno slot `<div class="campo" [attr.data-campo]="percorso" [class.campo--mancante]="!!messaggioPer(percorso)">` con etichetta (dalla configurazione), controllo e, se c'è un messaggio, `<small class="campo__nota" role="alert" [id]="'mod-' + <id controllo> + '-err'">`. Il controllo si sceglie con `@switch (campo.percorso)`; un percorso della configurazione senza `@case` è un errore di sviluppo (lo prova il test "ogni campo della configurazione ha il suo controllo").
- **Controlli** (stessi `ngModel` sul `modello` e stesse opzioni del form classico; ogni `(ngModelChange)` o `(onChange)` emette `campoModificato`): `produttoreId`, `destinatarioId`, `trasportatoreId` → `app-fir-modulo-parte` (`inputId` `mod-produttore`, `mod-destinatario`, `mod-trasportatore`, `[valore]` dal campo e `(valoreChange)` verso un metodo `impostaParte(campo: 'produttoreId' | 'trasportatoreId' | 'destinatarioId', id: string | null): void` che scrive `id ?? ''` (i tre campi di `CreateFIRDto` sono `string`: un two-way diretto con `string | null` non passa lo strict template check) ed emette `campoModificato`; `messaggioErrore` = `messaggioPer`, `apriAnagrafica` rilanciato); `rifiuto.codiceOperazione` → tendina `mod-op-code` (filtro, clear); `tipoTrattaPrincipale` → `mod-tipo-tratta-principale`; `trasportatoriAggiuntivi` → `app-fir-modulo-tratte` (`[tratte]="tratte"`, eventi rilanciati); `rifiuto.cerCode` → `app-cer-select` `mod-cer`; `provenienza` → `mod-provenienza`; `rifiuto.caratteristichePericolo` → `mod-hp`; `rifiuto.statoFisico` → `mod-stato-fisico`; `rifiuto.quantita` → `p-inputNumber` `mod-qta` (`minFractionDigits` 2); `rifiuto.unitaMisura` → tendina `mod-um` **senza** `showClear`; `rifiuto.numeroColli` → `p-inputNumber` `mod-colli` (`min` 1, senza raggruppamento); `annotazioni` → `textarea` `mod-annotazioni`. Asterisco obbligatorio sui sette campi dei controlli di creazione, come nel form classico.
- **Sola lettura**: tutti i controlli e i componenti delle parti disabilitati, nessuno slot `campo--mancante`, banner e numerazione restano.
- In questo task gli stili sono solo strutturali (griglia, spaziature con i token `--spacing-*`); colori e tavola da cianografia nel Task 6.

- [ ] **Step 1: spec che fallisce.** `TestBed` con `FirModuloComponent`, `NoopAnimationsModule`, `HttpClientTestingModule` (lo richiede `CerSelectComponent`); un `modelloVuoto()` come `showCreateDialog` (`fir-list.component.ts:1601-1617`) e `opzioni` minime.
  - `'cinque sezioni nell’ordine della configurazione'` → `[data-sezione]` in ordine `produttore, destinatario, trasportatori, rifiuto, annotazioni`; titoli `1. Produttore` … `5. Annotazioni`;
  - `'ogni campo della configurazione ha il suo controllo nella sua sezione'` → per ogni campo di `SEZIONI_MODULO`, `[data-sezione="<id>"] [data-campo="<percorso>"]` esiste e contiene un elemento con id che comincia per `mod-` (o il componente delle tratte);
  - `'numerazione provvisoria dichiarata, nessuna conformità vantata'` → `mod-numerazione-provvisoria` presente; il testo del componente non contiene `conforme` né `4ª copia`;
  - `'controllo parziale dichiarato con la sorgente di default'` → `mod-controllo-parziale` con il testo esatto; `'nessun avviso con una sorgente completa'` → provider `{ provide: SORGENTE_PREREQUISITI, useValue: { completa: true, prerequisiti: () => of([]) } }` → assente;
  - `'campo mancante segnato nel suo slot'` → modello vuoto: `[data-campo="rifiuto.cerCode"]` ha `campo--mancante` e testo `Il codice CER è obbligatorio.`; `[data-campo="annotazioni"]` non ha la classe;
  - `'il genitore cambia l’oggetto: il segno sparisce'` → `component.modello.produttoreId = 'p1'`, `detectChanges()` → `[data-campo="produttoreId"]` senza classe;
  - `'il genitore sostituisce il modello: si ricalcola'` → `fixture.componentRef.setInput('modello', modelloCompleto())` → nessuno slot `campo--mancante`;
  - `'l’errore del salvataggio vince sul controllo locale'` → `setInput('errori', { cerCode: 'Codice CER non valido.' })` → lo slot mostra `Codice CER non valido.`;
  - `'requisito di un campo che il modulo non ha: riquadro Altri dati da completare'` → sorgente finta che emette `[{ codice: 'X', percorsoCampo: 'produttore.indirizzo.comune', messaggio: 'Manca il comune del produttore.' }]` → `mod-altri-requisiti` contiene quel messaggio;
  - `'modificare la quantità emette la chiave di firErrors'` → `triggerEventHandler('ngModelChange', 5)` su `p-inputNumber#mod-qta` (o l'elemento con `inputId`) → `campoModificato` emette `'quantita'`;
  - `'l’unità di misura non si può svuotare'` → la tendina con `inputId="mod-um"` ha `showClear` falso (`By.directive(Dropdown)` filtrata per `inputId`);
  - `'sola lettura: controlli disabilitati e nessun segno rosso'` → `setInput('solaLettura', true)` → nessun `campo--mancante`, `textarea#mod-annotazioni` disabilitata, tendine con classe `p-disabled`.
- [ ] **Step 2:** spec mirato → FAIL.
- [ ] **Step 3:** implementare `fir-modulo.component.ts`.
- [ ] **Step 4:** spec mirato → PASS.
- [ ] **Step 5:** suite intera, build, prettier, eslint.
- [ ] **Step 6: commit** — `git commit -m "feat(modulo): impaginazione per sezioni e campi mancanti segnati nel punto da compilare"`

### Task 6: carta, inchiostro blu, rosso e cianografia coi token del tema

**Files:**
- Modify: `features/fir/modulo/fir-modulo.component.ts` (solo `styles`)
- Test: `features/fir/modulo/fir-modulo.component.spec.ts` (nuovo `describe` "tema del modulo")

**Interfaces:**
- Produces: proprietà CSS sull'host di `app-fir-modulo`, lette anche dai componenti figli (ereditate): `--modulo-carta`, `--modulo-linea`, `--modulo-etichetta`, `--modulo-inchiostro`, `--modulo-mancante`, `--modulo-mancante-fondo`, `--modulo-griglia`.

Valori fissati:

| proprietà | chiaro (`:host`) | scuro (`:host-context([data-theme='dark'])`) |
|---|---|---|
| `--modulo-carta` | `var(--surface-card)` | `var(--color-info-bg)` |
| `--modulo-linea` | `var(--surface-border-strong)` | `color-mix(in srgb, var(--color-info) 40%, transparent)` |
| `--modulo-etichetta` | `var(--text-secondary)` | `var(--color-info)` |
| `--modulo-inchiostro` | `var(--color-info)` | `var(--text-primary)` |
| `--modulo-mancante` | `var(--color-danger)` | `var(--color-danger)` |
| `--modulo-mancante-fondo` | `var(--color-danger-bg)` | `var(--color-danger-bg)` |
| `--modulo-griglia` | `transparent` | `color-mix(in srgb, var(--color-info) 15%, transparent)` |

Uso: `.modulo` ha fondo `--modulo-carta` e, in scuro, una quadrettatura da 16px con due `linear-gradient` di `--modulo-griglia`; bordi di sezioni e slot `--modulo-linea`; numeri e titoli di sezione e etichette `--modulo-etichetta` (numeri in `--font-family-mono`); il testo dei valori (`.p-inputtext`, `.p-dropdown-label:not(.p-placeholder)`, `textarea`, via `::ng-deep` dentro `.modulo`) in `--modulo-inchiostro`; slot `campo--mancante`: bordo `--modulo-mancante`, fondo `--modulo-mancante-fondo`, nota in `--modulo-mancante`. In scuro i valori sono chiari sulla carta blu: il blu resta per righe ed etichette, come in una cianografia. Contrasti già garantiti AA dalle coppie del tema (`styles.scss:225-260`).

- [ ] **Step 1: spec che fallisce.** Aiuti: `token(el, nome) = getComputedStyle(el).getPropertyValue(nome).trim()`; `coloreDi(valoreCss)` crea uno `span` nel `body` con `style.color = valoreCss` e ne legge il `color` calcolato. `afterEach` rimuove `data-theme` da `document.documentElement`.
  - `'in chiaro carta e inchiostro vengono dai token'` → `token(host, '--modulo-carta') === token(document.documentElement, '--surface-card')`; idem `--modulo-inchiostro` con `--color-info`;
  - `'in scuro la carta è blu e i dati chiari'` → `document.documentElement.setAttribute('data-theme', 'dark')` prima di `createComponent` → `--modulo-carta` uguale a `--color-info-bg`, `--modulo-inchiostro` uguale a `--text-primary`;
  - `'il valore scritto è in inchiostro blu'` → in chiaro, `getComputedStyle(textarea#mod-annotazioni).color === coloreDi('var(--color-info)')`;
  - `'lo slot mancante è rosso'` → modello vuoto, `getComputedStyle([data-campo="rifiuto.cerCode"]).borderTopColor === coloreDi('var(--color-danger)')`.
- [ ] **Step 2:** spec mirato → FAIL.
- [ ] **Step 3:** scrivere gli stili.
- [ ] **Step 4:** spec mirato → PASS. Poi `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" apps/frontend/src/app/features/fir/modulo -r` → nessuna riga.
- [ ] **Step 5:** suite intera, build, prettier, eslint.
- [ ] **Step 6: commit** — `git commit -m "feat(modulo): dati in blu, mancanti in rosso, cianografia in modalità scura"`

### Task 7: aggancio nel dialog FIR (unica modifica a `fir-list.component.ts`)

**Eccezione dichiarata.** `fir-list.component.ts` è nel piano del Task 7 di F2-10, che riscrive le quattro tendine (`:349-372`, `:407-432`, `:477-502`, `:575-591`), `showEditDialog` e il modello. Qui si cambiano **solo** tre punti, lontani da quelle righe: (a) import e `imports` del decoratore più un `inject`; (b) un blocco inserito fra la riga 326 (fine del tag di apertura di `p-dialog`) e la 327 (`<div class="fir-form p-fluid">`), più un attributo su quella riga; (c) il corpo di `validateFir` (`:1649-1667`). Il form classico **non** si avvolge in un `@if`: con Prettier sui template sarebbero ~530 righe reindentate, cioè un conflitto sicuro con F2-10. `fir-list.component.spec.ts` non si tocca: i test vanno in uno spec nuovo.

**Files:**
- Modify: `apps/frontend/src/app/features/fir/fir-list.component.ts` (tre punti sopra)
- Test: `apps/frontend/src/app/features/fir/fir-list.vista-modulo.spec.ts` (nuovo)

**Interfaces:**
- Consumes: `FirModuloComponent` e i suoi input/output (Task 5), `FirVistaModuloInterruttoreComponent` e `VistaModuloService` (Task 3), `controlliCreazione` ed `erroriDaPrerequisiti` (Task 2).

Modifiche:
- (a) `imports` del decoratore: `FirModuloComponent`, `FirVistaModuloInterruttoreComponent`; nella classe `protected readonly vistaModulo = inject(VistaModuloService)`.
- (b) Prima di `<div class="fir-form p-fluid">`: `<app-fir-vista-modulo-interruttore />` e

```html
@if (vistaModulo.attiva()) {
  <app-fir-modulo
    [modello]="newFIR"
    [tratte]="trasportatoriAggiuntivi"
    [firId]="firInModifica?.id ?? null"
    [errori]="firErrors"
    [produttori]="produttori()"
    [trasportatori]="trasportatori()"
    [destinatari]="destinatari()"
    [caricamentoAnagrafiche]="loadingAnagrafiche"
    [opzioni]="{ tipoTratta: tipoTrattaOptions, statoFisico: statoFisicoOptions, provenienza: provenienzaOptions, hp: hpOptions, operazioneRD: operazioneRDOptions, unitaMisura: unitaMisuraOptions }"
    [solaLettura]="saving"
    (campoModificato)="clearFirError($event)"
    (apriAnagrafica)="openAnagraficaDialog($event.tipo, $event.modalita, $event.id)"
    (aggiungiTratta)="addTrasportatoreAggiuntivo()"
    (rimuoviTratta)="removeTrasportatoreAggiuntivo($event)"
  />
}
```

  e sulla `div` del form classico `[style.display]="vistaModulo.attiva() ? 'none' : null"` (con `[hidden]` non basta: `.fir-form` ha `display: flex`). Il footer (`fir-dialog-salva`, `salvaFIR`) resta unico: creazione, PUT con `versione`, 409 e chiusura passano dal codice di oggi.
- (c) `validateFir` diventa: `const mancanti = controlliCreazione(this.newFIR); this.firErrors = erroriDaPrerequisiti(mancanti); return mancanti.length === 0`. Unico cambiamento di comportamento: una quantità sotto 0,01 ora è segnalata subito, come farebbe il DTO.

- [ ] **Step 1: spec che fallisce** (`fir-list.vista-modulo.spec.ts`). `setup()` copiato da `fir-list.component.spec.ts:526-620` (stessi spy, stessa `bozza()` con `unitaMisura: 't'` e `versione: 3`), con un'opzione `vistaModulo: boolean` che chiama `TestBed.inject(VistaModuloService).imposta(...)` prima di `createComponent`; `afterEach` toglie le chiavi `wf_vista_modulo:`. Aiuto `modulo()` = `fixture.debugElement.query(By.directive(FirModuloComponent))`.
  - `'interruttore spento: form classico visibile, nessun modulo'` → dopo `showCreateDialog()` e `detectChanges()`, `modulo()` nullo, `.fir-form` senza `display: none`;
  - `'interruttore acceso: il modulo prende il posto del form nello stesso dialog'` → `modulo()` presente, `(.fir-form).style.display === 'none'`, `modulo().componentInstance.modello === component.newFIR`;
  - `'creazione: stessi controlli, gli errori compaiono nel modulo'` → modulo acceso, click su `[data-testid="fir-dialog-salva"]` col form vuoto → `createFIR` non chiamato, `component.firErrors` uguale all'oggetto letterale dei sette messaggi del Task 2, `[data-campo="rifiuto.cerCode"]` con `Il codice CER è obbligatorio.`;
  - `'creazione: il modello compilato nel modulo va nel DTO'` → valorizzare i sette campi su `component.newFIR`, salvare → `createFIR` chiamato con `provenienza` e `tipoTrattaPrincipale` del modello;
  - `'modifica dal modulo: PUT con versione e unità di misura del FIR'` → `apriModifica(firList[0])`, `newFIR.rifiuto.quantita = 12`, `salvaFIR()` → `modificaFIR` chiamato con `'f1'` e un DTO con `versione: 3`, `rifiuto.unitaMisura: 't'`, senza `descrizione`;
  - `'409 FIR_MODIFICATO_NEL_FRATTEMPO: il modulo mostra i dati riletti'` → come lo spec esistente (`:691-718`) ma col modulo acceso; dopo, `modulo().componentInstance.modello.rifiuto.quantita === 99` e `component.firInModifica` con `versione: 4`;
  - `'409 FIR_NON_MODIFICABILE: il dialog si chiude anche in vista modulo'`;
  - `'tratte senza trasportatore: la modifica non si apre neanche in vista modulo'` → `bozza({ trasportatoriAggiuntivi: [{ tipoTratta: 'TERRESTRE', ordine: 1 }] })` → `displayCreateDialog` falso;
  - `'durante il salvataggio il modulo è in sola lettura'` → `component.saving = true`, `detectChanges()` → `modulo().componentInstance.solaLettura` vero;
  - `'il sotto-dialog anagrafica si apre dal modulo'` → `modulo().triggerEventHandler('apriAnagrafica', { tipo: 'produttore', modalita: 'create' })` → `showAnagraficaDialog` vero, `anagraficaTipo === 'produttore'`.
- [ ] **Step 2:** spec mirato → FAIL.
- [ ] **Step 3:** applicare (a), (b), (c), niente altro. Controllo: `git diff --stat -- apps/frontend/src/app/features/fir/fir-list.component.ts` sotto le 50 righe, e `git diff -U0 -- apps/frontend/src/app/features/fir/fir-list.component.ts` senza hunk fra le righe 340 e 615 del file originale.
- [ ] **Step 4:** spec mirato e `fir-list.component.spec.ts` (`--include` su entrambi) → PASS, nessun test esistente modificato.
- [ ] **Step 5:** suite intera, build, prettier, eslint.
- [ ] **Step 6: commit** — `git add apps/frontend/src/app/features/fir/fir-list.component.ts apps/frontend/src/app/features/fir/fir-list.vista-modulo.spec.ts`; `git commit -m "feat(modulo): Vista modulo nel dialog della bozza FIR, controlli di creazione in un solo punto"`

### Task 8: chiusura e controllo delle sovrapposizioni

**Files:** nessuno nuovo (solo verifiche; correzioni eventuali nei file dei task precedenti).

- [ ] **Step 1:** suite Karma intera, `npm run build` del frontend, eslint dalla root: tutti verdi, nessun test esistente modificato (`git diff --stat master...HEAD -- '*.spec.ts'` elenca solo spec nuovi).
- [ ] **Step 2:** `git diff --name-only master...HEAD` → solo `features/fir/modulo/**`, `features/fir/fir-list.vista-modulo.spec.ts`, `features/fir/fir-list.component.ts`, il design. Poi, per ciascun branch `feat/fase2-6-deposito`, `feat/fase2-8-mud-sede`, `feat/fase2-10-controparti`: `comm -12 <(git diff --name-only master...HEAD | sort) <(git diff --name-only master...<branch> | sort)` → vuoto. Annotare che il Task 7 di F2-10 (non ancora scritto nel branch) toccherà `fir-list.component.ts`: la sovrapposizione attesa è quella e solo quella.
- [ ] **Step 3:** `grep -rn -E "4ª copia|conforme al modello" apps/frontend/src/app/features/fir/modulo apps/frontend/src/app/features/fir/fir-list.vista-modulo.spec.ts` → nessuna riga (gli spec che verificano l'assenza usano la stringa in un `not.toContain`: è l'unica eccezione ammessa).
- [ ] **Step 4:** prova a mano con `npm start` (backend locale o di test): apertura di "Nuovo FIR", interruttore acceso, campi rossi che spariscono compilando, salvataggio; modifica di una bozza in Vista modulo; modalità scura. Esito nel rapporto del task, con eventuali difetti visivi.
- [ ] **Step 5: commit** solo se lo Step 1-4 ha richiesto correzioni: `git commit -m "fix(modulo): …"`.

---

## Aggancio dopo F2-10 e dopo l'endpoint dei prerequisiti (fuori da questo piano)

- **F2-10 in master:** si adattano `modulo/parti/*` (sede del produttore e del destinatario con più sedi attive, "P.IVA …" o "C.F. …", filtro anche sul codice fiscale) e il Modulo manda la sede **solo se l'utente l'ha cambiata** (regola I4 di F2-10). Si valuta se `fir-list` adotti `FirModuloParteComponent` per le sue tendine.
- **Endpoint "prerequisiti di emissione":** una classe nuova che implementa `SorgentePrerequisiti` con `completa: true`, chiama l'endpoint con `firId` (per un FIR non ancora salvato decide lei se ripiegare sui controlli di creazione) e traduce i percorsi RENTRI in percorsi di `CreateFIRDto` dove esiste un campo; si cambia solo la factory in `sorgente-prerequisiti.token.ts`. Il banner "controllo parziale" sparisce da solo.
- **Modello ufficiale verificato:** si correggono tabella e costante in `sezioni-modulo.ts` e il paragrafo del design.
- **Vista in sola lettura dopo l'emissione nel dettaglio FIR:** richiede `fir-detail.component.ts`, che è nel Task 7 di F2-10. L'input `solaLettura` del Modulo è già pronto e provato.
