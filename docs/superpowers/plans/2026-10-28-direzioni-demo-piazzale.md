# Piazzale (direzioni demo, sezione 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** una modalità tablet `/piazzale` con cui l'addetto dell'impianto di destino sceglie un FIR in arrivo, ne verifica il peso e registra l'esito (A/P/R su RENTRI, solo peso per i FIR locali), lasciando la firma dell'accettazione all'ufficio.

**Architecture:** il backend aggiunge un endpoint di sola lettura `GET /piazzale/arrivi` (FIR del tenant selezionato destinati all'azienda stessa, riconosciuta con `codiciAzienda()` del MUD), un'opzione `firmaInUfficio` sull'accettazione RENTRI esistente e un endpoint `POST /rentri/fir/:id/firma-accettazione` per la firma remota fatta dopo, dall'ufficio. Il frontend aggiunge una rotta fuori dal layout d'ufficio, con logica pura (tastierino, flusso a passi) separata dai componenti e testata da sola; esito e peso passano solo dagli endpoint esistenti `conferma-consegna` e `accettazione`.

**Tech Stack:** NestJS 10 + Prisma 5.22 (jest), Angular 17 standalone + PrimeNG 17 (karma/jasmine, ChromeHeadless), Playwright per l'e2e.

**Spec:** `docs/superpowers/specs/2026-10-28-direzioni-demo-design.md`, sezione "4. Piazzale" (più "Vincoli trasversali" e "Non obiettivi").

## Global Constraints

- Branch `feat/direzioni-demo` (o il branch del filone Piazzale che il coordinatore indica), worktree `C:\Progetti\rifiuti-wt-direzioni`. Non fare merge né push.
- **File vietati** (in diff con `feat/fase2-6-deposito`, `feat/fase2-8-mud-sede`, `feat/fase2-10-controparti`): fra gli altri `apps/backend/prisma/schema.prisma`, `apps/backend/src/core/domain/errors.ts`, `apps/backend/src/core/filters/http-exception.filter.ts`, `apps/backend/src/infrastructure/persistence/prisma-rls.extension.ts`, `apps/backend/src/test-support/**`, `apps/backend/jest.config.js`, `apps/backend/tsconfig.json`, `apps/backend/src/application/giacenze/**`, `apps/backend/src/application/registro/**`, `apps/backend/src/domain/registry/**`, `ops/README.md`. Elenco completo: `git diff --name-only origin/master...feat/fase2-6-deposito` (e gli altri due). Se un task scopre di doverne toccare uno, si ferma e lo segnala.
- **File condivisi con piani futuri**: `features/fir/fir-detail.component.ts` (+spec) e `shared/models/fir.model.ts` sono nel Task 7 del piano F2-10 (`docs/superpowers/plans/2026-10-28-fase2-10-controparti.md` sul branch `feat/fase2-10-controparti`), non ancora nel suo diff. Il Task 12 tocca `fir-detail` solo con un pulsante e due metodi accanto a `Accetta il carico`; `fir.model.ts` non si tocca. Dopo il merge di F2-10 (`ParteFIR.codiceFiscale`), `eArrivoPiazzale` dovrà confrontare anche il codice fiscale del destinatario: seguito dichiarato.
- Nessuna migration, nessuna libreria nuova, nessuna simulazione di esiti nel frontend.
- Isolamento per tenant: ogni lettura usa il tenant dell'azienda selezionata (`requireRequestTenantId(req)` / `@TenantId()`), mai il tenant del token.
- Ruolo: le scritture e l'elenco richiedono il ruolo effettivo `SUPER_ADMIN`, `ADMIN` o `OPERATOR` nell'azienda selezionata (`richiediRuoloEffettivo`, default `RUOLI_SCRITTURA`).
- Lo scostamento del peso si calcola SOLO con `calcolaScostamentoPeso` / `SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO` / `testoAvvisoScostamento` di `apps/frontend/src/app/features/fir/scostamento-peso.ts` e si presenta come avviso, mai come limite di legge.
- "Sono io" = P.IVA/CF del destinatario normalizzati ∈ `MudIntegrazioniService.codiciAzienda(tenantId)` (regola A-W-13). Nessun secondo confronto.
- Nessuna schermata presenta la firma come firma valida: il Piazzale scrive "da firmare in ufficio"; la consegna locale si dice "registrata", non "firmata".
- Testi dell'interfaccia in italiano; termini tecnici non tradotti; nessuna dicitura "4ª copia".
- Commit nello stile del repo (`feat(piazzale): ...`, `feat(rentri): ...`, `fix(frontend): ...`), **senza** righe di attribuzione AI.
- TDD: ogni task scrive prima il test e lo vede fallire.
- **Comandi**:
  - backend unitari: `cd apps/backend && npx jest <percorso spec>`; prima di chiudere un task backend anche `npx tsc --noEmit -p tsconfig.json` e `npm run lint` (applica `--fix`: rileggere il diff);
  - backend Postgres: ambiente e controllo della porta 55434 come nella sezione "Ambiente" di `docs/superpowers/plans/2026-10-28-fase2-4-7-fir.md`, poi `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`;
  - backend oracolo (fake RENTRI): `cd apps/backend && npx jest -c jest.oracolo.config.js --runInBand --forceExit <spec>` (richiede `npm ci` in `tools/rentri-fake`);
  - frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=<spec>`; a fine task anche `npm run build`.

## Review Focus

1. **Rete che cade durante l'invio** (richiesta partita, risposta mai arrivata, HTTP status 0): l'esito presso il backend/RENTRI è ignoto. Ci si aspetta "esito non noto, non ripetere, verifica in ufficio", non un "riprova" che rischia un doppio invio. Test nel Task 11.
2. **Doppio tocco sul pulsante principale**: una sola richiesta HTTP. Test nel Task 11.
3. **FIR RENTRI con quantità dichiarata in tonnellate o litri**: RENTRI vuole la quantità accettata in kg. Tonnellate convertite per il confronto, litri dichiarati "scostamento non calcolabile", nessun avviso inventato. Test nel Task 6.
4. **FIR che un'altra postazione ha già registrato** (scheda aperta, su RENTRI non c'è più l'azione `Accettazione`; oppure FIR locale non più IN_TRANSITO): nessun invio, messaggio chiaro. Test nel Task 11.
5. **Tastierino**: seconda virgola, terzo decimale, oltre `99999999.99`, zero e meno sotto lo zero non devono produrre un peso inviabile. Test nel Task 6.

---

## Decisioni del piano (e scostamenti dai fatti forniti)

Riletti sul codice di `feat/direzioni-demo` (= master `a2bf11e` + spec):

- **D1. L'accettazione RENTRI oggi firma sempre.** `AccettaORespingiFIRUseCase.execute` (`application/rentri/accetta-o-respingi-fir.use-case.ts:154`) chiama `CompletaOperazioneConFirmaUseCase` subito dopo `inviaAccettazione`. Il "default: firma all'ufficio" quindi non esiste: si aggiunge `firmaInUfficio?: boolean` (default `false`, comportamento attuale invariato) che si ferma dopo l'invio dei dati e rilegge lo stato dall'ente (Task 3). Senza un modo per firmare dopo, il FIR resterebbe in `FirmaAccettazione`: si aggiunge `POST rentri/fir/:id/firma-accettazione` (Task 4) e il pulsante in ufficio nel dettaglio FIR (Task 12).
- **D2. Il codice non sa se un utente è firmatario.** La credenziale di firma remota è **per tenant** (`RentriCredentialService.getCredentialsIdFirmaRemota(tenantId)`, colonna `credentialsIdFirmaRemota` su `RentriCredential`), non per utente. Il Piazzale fa quindi solo il default (firma in ufficio) e non offre mai la firma dal tablet.
- **D3. Un FIR acquisito da RENTRI (ramo NUOVO) nasce in BOZZA** (`FIR.create` + `agganciaFormularioAcquisito`, che non cambia lo stato) e resta tale finché qualcuno non riconcilia (`/azioni` o il job, che però campiona solo i `SYNCED`). Filtrare solo `IN_TRANSITO` lo nasconderebbe. Regola dell'elenco (Task 1): non legato → `IN_TRANSITO`; legato → `IN_TRANSITO` con `rentriStatoFormulario` fuori da `FirmaAccettazione`/`FirmaAnnullamento`, **oppure** `BOZZA` con `rentriStatoFormulario` nullo (mai riconciliato, mostrato "stato RENTRI da verificare"). La scheda rilegge `/azioni` (che riconcilia) e procede solo se c'è `Accettazione`.
- **D4. `connection-monitor.service.ts` è codice morto e rotto.** Nessuno lo istanzia (né `app-offline-indicator` né `OfflineHighRiskGuard` sono usati), e usa `filter` senza importarlo, coperto da due `@ts-expect-error`: alla prima istanziazione lancia `ReferenceError`. `isOnline$` guarda solo `navigator.onLine` (il heartbeat è calcolato e ignorato). Task 5 lo ripara. `offline-indicator` **non** si riusa: parla della sincronizzazione dei permessi offline ("Modalità offline - ultimo sync"), non dell'invio; il Piazzale ha la sua barra di rete.
- **D5. Sede.** Nessun endpoint usato dal Piazzale prende una sede (né `conferma-consegna` né `accettazione`) e il FIR non memorizza l'unità locale del destinatario. La scelta della sede non ha consumatori: non si implementa ed è dichiarata come limite.
- **D6. Targa.** `crea-fir-da-dettaglio-rentri.use-case.ts` (`mappaParte`) non copia la targa dal formulario RENTRI: per i FIR acquisiti la ricerca per targa trova solo ciò che lo snapshot contiene. Limite dichiarato, non si corregge qui.
- **D7. Messaggi di `conferma-consegna`.** Lo use case restituisce errori in inglese ("Failed to confirm delivery of FIR: ..."): il Piazzale non li mostra e usa un testo italiano fisso (Task 11).
- **D8. Peso.** FIR locale: peso nell'unità del FIR (`ConfermaConsegnaFIRDto.pesoEffettivo`, 2 decimali, `0.01..99999999.99`). FIR RENTRI: peso in kg (`quantitaAccettataKg`, contratto `QuantitaKgModel`). Motivo del respingimento: massimo 1000 caratteri (`formulari.yaml`, `motivo_respingimento`).
- Confermati: `POST fir/:id/conferma-consegna` (`api/fir/fir.controller.v2.ts:372-408`, `@Roles('SUPER_ADMIN','ADMIN','OPERATOR')` valutato sul ruolo effettivo dal `RolesGuard`), `noteDestinatario` assente; `POST rentri/fir/:id/accettazione` (`api/rentri/rentri-fir-lifecycle.controller.ts:145`); stati `InserimentoAccettazione`/`FirmaAccettazione` in `fir.aggregate.ts:59-81`; mappatura a CONSEGNATO in `fir.aggregate.ts:94-104`; `calcolaScostamentoPeso` nel backend (`domain/fir/scostamento-peso.ts`) e nel frontend (`features/fir/scostamento-peso.ts`); `codiciAzienda()` in `application/mud/mud-integrazioni.service.ts:116`.
- Layout: in `app.routes.ts` c'è un solo layout (`shared/components/layout.component.ts`, rotta `''` con figli). `/piazzale` diventa una rotta di primo livello con `authGuard` e un proprio guscio.

## File

Backend (nuovi): `application/piazzale/arrivo-piazzale.ts` (+spec), `application/piazzale/arrivi-piazzale.service.ts` (+spec, +`.postgres.spec`), `application/piazzale/piazzale.module.ts`, `api/piazzale/piazzale.controller.ts` (+spec), `application/rentri/firma-accettazione.use-case.ts` (+spec).
Backend (modificati, condivisi): `application/mud/mud.module.ts` (solo `exports`), `app.module.ts` (solo `imports`), `api/rentri/dto/accetta-fir-rentri.dto.ts`, `application/rentri/accetta-o-respingi-fir.use-case.ts` (+spec), `api/rentri/rentri-fir-lifecycle.controller.ts` (+spec), `application/rentri/rentri-sync.module.ts`, `infrastructure/rentri/rentri-accettazione.oracolo.spec.ts`.
Frontend (nuovi, in `features/piazzale/`): `peso-piazzale.ts`, `flusso-piazzale.ts`, `arrivo-piazzale.ts`, `piazzale.service.ts`, `piazzale-tastierino.component.ts`, `piazzale-arrivi.component.ts`, `piazzale-conferimento.component.ts`, `piazzale-shell.component.ts`, ognuno col suo spec; `features/rentri/esito-firma-remota.ts` (+spec), `features/rentri/rentri-fir-lifecycle.service.spec.ts`, `core/services/connection-monitor.service.spec.ts`.
Frontend (modificati, condivisi): `core/services/connection-monitor.service.ts`, `features/rentri/rentri-fir-lifecycle.service.ts`, `features/fir/fir-detail.component.ts` (+spec), `app.routes.ts`, `shared/components/layout.component.ts` (una voce di menu).
E2E: `e2e/tests/piazzale/piazzale.spec.ts`.

Tutti i percorsi backend sono relativi a `apps/backend/src/`, quelli frontend a `apps/frontend/src/app/`.

---

### Task 1: regola "arrivo al piazzale" e servizio dell'elenco

**Files:**
- Create: `application/piazzale/arrivo-piazzale.ts`, `application/piazzale/arrivo-piazzale.spec.ts`
- Create: `application/piazzale/arrivi-piazzale.service.ts`, `application/piazzale/arrivi-piazzale.service.spec.ts`
- Modify: `application/mud/mud.module.ts` (aggiungere `MudIntegrazioniService` a `exports`, nient'altro)

**Interfaces:**
- Consumes: `FIR`, `FIRStato`, `StatoFormulario` (`domain/fir/aggregates/fir.aggregate.ts`); `normalizzaCodiceFiscaleSoggetto` (`domain/shared/codice-fiscale-soggetto.ts`); `MudIntegrazioniService.codiciAzienda(tenantId): Promise<string[]>`; `FIRPrismaRepository.findByTenant(tenantId, { stato })` (`infrastructure/persistence/fir-prisma.repository.ts:163`); `PrismaService` (`infrastructure/persistence/prisma.service`).
- Produces:
  - `STATI_RENTRI_FUORI_PIAZZALE: readonly StatoFormulario[] = ['FirmaAccettazione', 'FirmaAnnullamento']`
  - `eArrivoPiazzale(fir: FIR, codiciAzienda: ReadonlySet<string>): boolean`
  - `normalizzaRicercaPiazzale(testo: string | null | undefined): string` (toglie gli spazi, maiuscolo)
  - `corrispondeRicercaPiazzale(fir: FIR, cercaNormalizzata: string): boolean`
  - `interface ArriviPiazzale { azienda: { id: string; ragioneSociale: string }; codiciAziendaConfigurati: boolean; arrivi: FIR[] }`
  - `class ArriviPiazzaleService { constructor(firRepository: FIRPrismaRepository, integrazioniMud: MudIntegrazioniService, prisma: PrismaService); elenca(tenantId: string, cerca?: string): Promise<ArriviPiazzale> }`

- [ ] **Step 1: test della regola pura** in `arrivo-piazzale.spec.ts`. FIR costruiti con `FIR.create` (props `destinatario`/`trasportatore` come in `crea-fir-da-dettaglio-rentri.use-case.ts:156-168`, destinatario con `partitaIva`) e portati di stato con i metodi dell'aggregate: locali con `emetti(numero, firma)` e `presaInCarico(data, firma)`; legati con `agganciaFormularioAcquisito(numeroFir)` e poi, se serve, `applyRentriStato('InserimentoAccettazione' | 'FirmaAccettazione')` (su un FIR legato `presaInCarico` lancia `MetodoLocaleNonConsentitoSuFirLegatoError`). Firma di prova come in `application/rentri/accetta-o-respingi-fir.use-case.spec.ts:15-35`. Codici `new Set(['01234567897'])`.

```ts
it('locale IN_TRANSITO destinato a me: entra', ...)                      // true
it('locale IN_TRANSITO con P.IVA "IT01234567897" e spazi: entra (normalizzazione A-W-13)', ...) // true
it('locale IN_TRANSITO destinato ad altri: non entra', ...)              // false
it('locale EMESSO o CONSEGNATO: non entra', ...)                         // false, false
it('legato IN_TRANSITO in InserimentoAccettazione: entra', ...)          // true
it('legato in FirmaAccettazione: non entra (accettazione gia registrata)', ...) // false
it('legato in BOZZA mai riconciliato (rentriStatoFormulario null): entra', ...) // true
it('locale in BOZZA: non entra', ...)                                    // false
it('codici vuoti: nessun FIR entra', ...)                                // false
it('ricerca: numero progressivo, numero RENTRI, targa principale e mezzo di una tratta', () => {
  expect(corrispondeRicercaPiazzale(fir, normalizzaRicercaPiazzale('ab 123 cd'))).toBe(true) // targa 'AB123CD'
  expect(corrispondeRicercaPiazzale(fir, normalizzaRicercaPiazzale(''))).toBe(true)
  expect(corrispondeRicercaPiazzale(fir, normalizzaRicercaPiazzale('ZZ999'))).toBe(false)
})
```

- [ ] **Step 2:** `npx jest src/application/piazzale/arrivo-piazzale.spec.ts` → FAIL (modulo inesistente).
- [ ] **Step 3: implementare `arrivo-piazzale.ts`.** Regola (D3): destinatario `normalizzaCodiceFiscaleSoggetto(fir.destinatario?.partitaIva)` ∈ codici; poi se `!fir.rentriNumeroFir` → `stato === IN_TRANSITO`; se legato → (`stato === IN_TRANSITO` e `rentriStatoFormulario` ∉ `STATI_RENTRI_FUORI_PIAZZALE`) oppure (`stato === BOZZA` e `rentriStatoFormulario === null`). Ricerca: sottostringa della ricerca normalizzata in `numeroProgressivo`, `rentriNumeroFir`, `trasportatore.targaVeicolo`, ogni `trasportatoriAggiuntivi[].mezzo`, tutti normalizzati con la stessa funzione.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: test del servizio** in `arrivi-piazzale.service.spec.ts`, con mock di `findByTenant`, `codiciAzienda`, `prisma.tenant.findUnique`:

```ts
it('legge IN_TRANSITO e BOZZA del solo tenant richiesto e filtra con la regola', async () => {
  // findByTenant chiamato esattamente con ('t1', { stato: FIRStato.IN_TRANSITO }) e ('t1', { stato: FIRStato.BOZZA })
  // arrivi = solo i FIR per cui eArrivoPiazzale e' vero
})
it('applica la ricerca', ...)                          // elenca('t1', ' ab123 ') restituisce il solo FIR con targa AB123CD
it('azienda senza codici: codiciAziendaConfigurati false e arrivi []', ...)
it('restituisce id e ragione sociale dell azienda', ...) // { id: 't1', ragioneSociale: 'Impianto SRL' }
it('azienda inesistente: NotFoundException', ...)
```

- [ ] **Step 6:** `npx jest src/application/piazzale` → FAIL.
- [ ] **Step 7: implementare `ArriviPiazzaleService`** (`@Injectable()`), con `prisma.tenant.findUnique({ where: { id }, select: { id: true, ragioneSociale: true } })`, `codiciAzienda` una sola volta, le due letture in parallelo, filtro e ricerca dal Step 3. Aggiungere `MudIntegrazioniService` agli `exports` di `MUDModule`.
- [ ] **Step 8:** `npx jest src/application/piazzale src/application/mud` → PASS; `npx tsc --noEmit -p tsconfig.json` pulito.
- [ ] **Step 9: commit** `feat(piazzale): regola dei FIR in arrivo e servizio dell'elenco`

### Task 2: endpoint `GET /piazzale/arrivi` e isolamento su Postgres

**Files:**
- Create: `api/piazzale/piazzale.controller.ts`, `api/piazzale/piazzale.controller.spec.ts`
- Create: `application/piazzale/piazzale.module.ts`
- Create: `application/piazzale/arrivi-piazzale.service.postgres.spec.ts`
- Modify: `app.module.ts` (import di `PiazzaleModule` accanto a `FIRModule`)

**Interfaces:**
- Consumes: `ArriviPiazzaleService.elenca` (Task 1); `FIRResponseDto.fromDomain` (`api/fir/dtos/fir-response.dto.ts:276`); `requireRequestTenantId` (`core/context/resolve-request-tenant`); `richiediRuoloEffettivo` (`api/me/richiedi-ruolo-effettivo.ts`); `RuoloEffettivoService`.
- Produces: `GET /api/v1/piazzale/arrivi?cerca=<testo>` → `{ azienda: { id: string; ragioneSociale: string }; codiciAziendaConfigurati: boolean; arrivi: FIRResponseDto[] }`. 403 `RUOLO_AZIENDA_SELEZIONATA_INSUFFICIENTE` per VIEWER; 400 se `cerca` supera 50 caratteri.

- [ ] **Step 1: test del controller** (modello: `api/fir/fir.controller.v2.spec.ts`, servizi mockati):

```ts
it('usa il tenant dell azienda selezionata, non quello del token', ...) // elenca chiamato con requireRequestTenantId(req)
it('VIEWER nell azienda selezionata: 403 e nessuna lettura', ...)       // ruoloEffettivo -> 'VIEWER'; elenca non chiamato
it('OPERATOR: arrivi mappati con FIRResponseDto.fromDomain', ...)
it('cerca oltre 50 caratteri: BadRequestException', ...)
```

- [ ] **Step 2:** `npx jest src/api/piazzale` → FAIL.
- [ ] **Step 3: implementare** `@Controller('piazzale') @UseGuards(JwtAuthGuard, RolesGuard) @ApiTags('piazzale') @ApiBearerAuth()`, metodo `@Get('arrivi') arrivi(@Query('cerca') cerca: string | undefined, @Req() req: any)`: tenant, `await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)`, controllo lunghezza (messaggio `'La ricerca accetta al massimo 50 caratteri.'`), `elenca`, mappatura. `PiazzaleModule`: `imports: [PrismaModule (infrastructure/persistence), MUDModule, RuoloEffettivoModule]`, `controllers: [PiazzaleController]`, `providers: [FIRPrismaRepository, ArriviPiazzaleService]`. Registrarlo in `AppModule`.
- [ ] **Step 4:** `npx jest src/api/piazzale src/application/piazzale` → PASS; `npx tsc --noEmit -p tsconfig.json` pulito.
- [ ] **Step 5: test Postgres di isolamento** (modello `application/registro/registro-per-sede.postgres.spec.ts`: ruolo `wasteflow_app`, `creaPrismaServiceApplicativo()`, `TenantContext.run`, pulizia per `tenantId` col client proprietario). Due aziende A e B; in B un FIR IN_TRANSITO con destinatario = P.IVA di A (FIR salvati con `FIRPrismaRepository.save` dentro `TenantContext.run`, costruzione come in `infrastructure/persistence/fir-prisma.repository.postgres.spec.ts:75-90`). `MudIntegrazioniService` costruito con `new MudIntegrazioniService(app, {} as any, loggerStub as any)` (il registry non serve a `codiciAzienda`).

```ts
it('A non vede il FIR di B anche se il destinatario ha la P.IVA di A', ...) // elenca(A) -> arrivi []
it('B vede il proprio FIR solo se il destinatario e B', ...)
```

- [ ] **Step 6:** suite Postgres del file → PASS (prima del fix il file non esiste: il FAIL atteso è "Cannot find module", poi PASS).
- [ ] **Step 7: commit** `feat(piazzale): endpoint dei FIR in arrivo per l'azienda selezionata`

### Task 3: accettazione RENTRI con firma rimandata all'ufficio

**Files:**
- Modify: `api/rentri/dto/accetta-fir-rentri.dto.ts`
- Modify: `application/rentri/accetta-o-respingi-fir.use-case.ts`, `application/rentri/accetta-o-respingi-fir.use-case.spec.ts`
- Modify: `api/rentri/rentri-fir-lifecycle.controller.ts` (metodo `accettaORespingi`), `api/rentri/rentri-fir-lifecycle.controller.spec.ts`
- Modify: `infrastructure/rentri/rentri-accettazione.oracolo.spec.ts`

**Interfaces:**
- Produces:
  - DTO: `firmaInUfficio?: boolean` (`@IsOptional() @IsBoolean()`, `@ApiPropertyOptional({ default: false, description: "Registra i dati di accettazione e rimanda la firma remota all'ufficio." })`)
  - `ComandoAccettaORespingiFIR.firmaInUfficio?: boolean`
  - `type EsitoAccettazioneFirmata = { tipoAccettazione: 'A'|'P'|'R'; esitoFirma: EsitoCompletamentoFirma }`
  - `type EsitoAccettazioneDaFirmareInUfficio = { tipoAccettazione: 'A'|'P'|'R'; firmaInUfficio: true; statoFormulario: StatoFormulario | null }`
  - `type EsitoAccettaORespingiFIR = EsitoAccettazioneFirmata | EsitoAccettazioneDaFirmareInUfficio` (la forma senza `firmaInUfficio` resta identica a oggi)

- [ ] **Step 1: test dello use case** (dipendenze di `creaDipendenze` già nello spec):

```ts
it('firmaInUfficio: invia i dati, NON chiama la firma, rilegge lo stato e lo restituisce', async () => {
  // getAzioniDisponibili.execute: prima chiamata stato InserimentoAccettazione (precondizione),
  // seconda chiamata { stato: 'FirmaAccettazione', ... }
  // risultato toEqual({ tipoAccettazione: 'A', firmaInUfficio: true, statoFormulario: 'FirmaAccettazione' })
  // completaOperazioneConFirmaUseCase.execute non chiamato; getAzioniDisponibili chiamato 2 volte
})
it('firmaInUfficio: se la rilettura fallisce l accettazione resta registrata (statoFormulario null, nessun errore)', ...)
it('firmaInUfficio: se l ente rifiuta i dati lancia ACCETTAZIONE_RENTRI_RIFIUTATA e non rilegge', ...)
it('senza firmaInUfficio il risultato resta { tipoAccettazione, esitoFirma }', ...) // regressione
```

E nel controller spec: `firmaInUfficio: true` del DTO arriva tale e quale al comando.
- [ ] **Step 2:** `npx jest src/application/rentri/accetta-o-respingi-fir.use-case.spec.ts src/api/rentri/rentri-fir-lifecycle.controller.spec.ts` → FAIL.
- [ ] **Step 3: implementare.** Dopo il log "Accettazione RENTRI inviata", se `comando.firmaInUfficio`: `getAzioniDisponibiliUseCase.execute(firId, tenantId, correlationId)` dentro try/catch (in errore `logger.warn` e `statoFormulario: null`), poi `return { tipoAccettazione, firmaInUfficio: true, statoFormulario }`. Aggiornare il commento di classe (passo 5 condizionato). Il controller passa `firmaInUfficio: dto.firmaInUfficio`.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: oracolo.** Nuovo caso accanto a "ciclo completo, accettazione intera (A)" (riga ~355), stesso schema di semina e `creaUseCase`: con `firmaInUfficio: true` la fake passa a `FirmaAccettazione`, il FIR locale ha `rentriStatoFormulario === 'FirmaAccettazione'` e `stato === IN_TRANSITO`, nessuna chiamata a `/hash`.
- [ ] **Step 6:** `npx jest -c jest.oracolo.config.js --runInBand --forceExit src/infrastructure/rentri/rentri-accettazione.oracolo.spec.ts` → PASS (tutti i casi, anche i preesistenti).
- [ ] **Step 7: commit** `feat(rentri): accettazione con firma rimandata all'ufficio`

### Task 4: firma dell'accettazione dall'ufficio

**Files:**
- Create: `application/rentri/firma-accettazione.use-case.ts`, `application/rentri/firma-accettazione.use-case.spec.ts`
- Modify: `application/rentri/rentri-sync.module.ts` (provider con `useFactory`, stesso schema di `AccettaORespingiFIRUseCase` a riga ~422, ed export)
- Modify: `api/rentri/rentri-fir-lifecycle.controller.ts`, `api/rentri/rentri-fir-lifecycle.controller.spec.ts`
- Modify: `infrastructure/rentri/rentri-accettazione.oracolo.spec.ts`

**Interfaces:**
- Consumes: `GetAzioniDisponibiliUseCase.execute(firId, tenantId, correlationId?)`, `CompletaOperazioneConFirmaUseCase.execute({ firId, tenantId, tipoOperazione, correlationId })`, `IFIRRepository.findById`.
- Produces:
  - `interface ComandoFirmaAccettazione { firId: string; tenantId: string; correlationId?: string }`
  - `class FirmaAccettazioneUseCase { constructor(firRepository: IFIRRepository, getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase, completaOperazioneConFirmaUseCase: CompletaOperazioneConFirmaUseCase, logger: LoggerService); execute(c: ComandoFirmaAccettazione): Promise<EsitoCompletamentoFirma> }`
  - `POST /api/v1/rentri/fir/:id/firma-accettazione` (body vuoto) → `EsitoCompletamentoFirma`, con `richiediRuoloEffettivo` e `mappaErroreDominio`.

- [ ] **Step 1: test dello use case:**

```ts
it('FIR inesistente: NOT_FOUND; altro tenant: UNAUTHORIZED; non legato: FIR_NON_LEGATO_RENTRI', ...)
it('stato riletto diverso da FirmaAccettazione: FIRMA_ACCETTAZIONE_NON_DISPONIBILE e nessuna firma', ...)
it('stato FirmaAccettazione: firma con tipoOperazione ACCETTAZIONE e restituisce l esito senza alterarlo', ...)
// esito IN_ATTESA restituito tale e quale (nessuna ripetizione)
```

E nel controller spec: VIEWER → 403 senza chiamare lo use case; OPERATOR → esito restituito.
- [ ] **Step 2:** `npx jest src/application/rentri/firma-accettazione.use-case.spec.ts src/api/rentri/rentri-fir-lifecycle.controller.spec.ts` → FAIL.
- [ ] **Step 3: implementare.** Precondizioni con gli stessi errori di `AccettaORespingiFIRUseCase` (righe 99-111); poi `getAzioniDisponibili` (riconcilia); se `stato !== 'FirmaAccettazione'` → `DomainException.businessRuleViolation('FIRMA_ACCETTAZIONE_NON_DISPONIBILE', "Questo formulario non ha un'accettazione in attesa di firma: nessuna richiesta è stata inviata al dispositivo.")`; altrimenti `completaOperazioneConFirmaUseCase.execute({ ..., tipoOperazione: 'ACCETTAZIONE' })`. Commento di classe che richiama il limite di `CompletaOperazioneConFirmaUseCase`: su `IN_ATTESA` il chiamante non deve ripetere.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: oracolo.** Prosegue il caso del Task 3: dopo l'accettazione con `firmaInUfficio`, `FirmaAccettazioneUseCase` con il completatore automatico già usato dal caso A (`agganciaConfermaAutomatica`) → `{ esito: 'COMPLETATA', statoFormulario: 'Accettato' }` e FIR locale CONSEGNATO.
- [ ] **Step 6:** oracolo del file → PASS; `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, suite unitaria completa `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov` → verde.
- [ ] **Step 7: commit** `feat(rentri): firma dell'accettazione dall'ufficio`

### Task 5: riparare `ConnectionMonitorService`

**Files:**
- Modify: `core/services/connection-monitor.service.ts`
- Create: `core/services/connection-monitor.service.spec.ts`

**Interfaces:**
- Produces (invariato): `ConnectionMonitorService.isOnline$: Observable<boolean>`, `isOnline(): boolean`.

- [ ] **Step 1: test:**

```ts
it('si istanzia senza errori', () => { expect(() => TestBed.inject(ConnectionMonitorService)).not.toThrow() })
it('isOnline$ emette false dopo l evento offline', fakeAsync(() => {
  const onLine = spyOnProperty(Object.getPrototypeOf(navigator), 'onLine', 'get').and.returnValue(true)
  // sottoscrivi, onLine.and.returnValue(false), window.dispatchEvent(new Event('offline')), tick(300)
  // ultimo valore === false; poi discardPeriodicTasks()
}))
```

- [ ] **Step 2:** `npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/core/services/connection-monitor.service.spec.ts` → FAIL (`filter is not defined`).
- [ ] **Step 3:** importare `filter` da `rxjs/operators` e togliere i due `@ts-expect-error`; se il tipo non torna, predicato tipizzato `filter((v): v is void => v !== null)`. Nessun altro cambiamento di comportamento.
- [ ] **Step 4:** stesso comando → PASS; `npm run build` verde.
- [ ] **Step 5: commit** `fix(frontend): ConnectionMonitorService si istanzia (filter non importato)`

### Task 6: logica pura del peso

**Files:**
- Create: `features/piazzale/peso-piazzale.ts`, `features/piazzale/peso-piazzale.spec.ts`

**Interfaces:**
- Produces:
  - `PESO_MASSIMO = 99999999.99`
  - `type TastoPeso = '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|','|'CANCELLA'`
  - `applicaTasto(testo: string, tasto: TastoPeso): string`
  - `testoInNumero(testo: string): number | null`
  - `numeroInTesto(n: number): string` (virgola decimale, niente zeri finali inutili)
  - `passoPeso(unita: string): number` (`'kg'` → 10, `'litri'` → 10, `'t'` → 0.01)
  - `variaPeso(testo: string, passo: number, verso: 1 | -1): string`
  - `pesoValido(n: number | null): boolean` (`> 0`, `<= PESO_MASSIMO`, al più 2 decimali)
  - `quantitaDichiarataPerConfronto(quantita: number, unita: string, legatoRentri: boolean): { valore: number; unita: string } | null`

- [ ] **Step 1: test** (valori esatti):

```ts
expect(applicaTasto('', '5')).toBe('5'); expect(applicaTasto('0', '5')).toBe('5')
expect(applicaTasto('', ',')).toBe('0,'); expect(applicaTasto('12,', ',')).toBe('12,')
expect(applicaTasto('12,34', '5')).toBe('12,34')            // terzo decimale ignorato
expect(applicaTasto('99999999', '9')).toBe('99999999')      // oltre il massimo ignorato
expect(applicaTasto('12,3', 'CANCELLA')).toBe('12,'); expect(applicaTasto('', 'CANCELLA')).toBe('')
expect(testoInNumero('12,5')).toBe(12.5); expect(testoInNumero('')).toBeNull(); expect(testoInNumero('0,')).toBe(0)
expect(numeroInTesto(12.5)).toBe('12,5'); expect(numeroInTesto(10)).toBe('10')
expect(variaPeso('', 10, 1)).toBe('10'); expect(variaPeso('5', 10, -1)).toBe('0')
expect(variaPeso('0,03', 0.01, -1)).toBe('0,02')            // niente errori di virgola mobile
expect(variaPeso('99999999,99', 10, 1)).toBe('99999999,99')
expect(pesoValido(0)).toBe(false); expect(pesoValido(0.01)).toBe(true); expect(pesoValido(null)).toBe(false)
expect(pesoValido(1.234)).toBe(false); expect(pesoValido(100000000)).toBe(false)
expect(quantitaDichiarataPerConfronto(500, 'kg', false)).toEqual({ valore: 500, unita: 'kg' })
expect(quantitaDichiarataPerConfronto(2, 't', false)).toEqual({ valore: 2, unita: 't' })     // locale: unita del FIR
expect(quantitaDichiarataPerConfronto(2.5, 't', true)).toEqual({ valore: 2500, unita: 'kg' }) // RENTRI: kg
expect(quantitaDichiarataPerConfronto(300, 'litri', true)).toBeNull()
expect(quantitaDichiarataPerConfronto(300, 'litri', false)).toEqual({ valore: 300, unita: 'litri' })
```

- [ ] **Step 2:** `npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/piazzale/peso-piazzale.spec.ts` → FAIL.
- [ ] **Step 3: implementare** lavorando in centesimi interi per `variaPeso` e la conversione t→kg (stesso accorgimento di `calcolaScostamentoPeso`); al più 8 cifre intere.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: commit** `feat(piazzale): tastierino e regole del peso`

### Task 7: flusso a passi e dati dell'arrivo

**Files:**
- Create: `features/piazzale/flusso-piazzale.ts`, `features/piazzale/flusso-piazzale.spec.ts`
- Create: `features/piazzale/arrivo-piazzale.ts`, `features/piazzale/arrivo-piazzale.spec.ts`

**Interfaces:**
- Consumes: `pesoValido` (Task 6); `AccettaFirRentriPayload` (`features/rentri/rentri-fir-lifecycle.service.ts`); `FIR`, `FIRStato` (`shared/models/fir.model.ts`).
- Produces (`flusso-piazzale.ts`):
  - `type EsitoPiazzale = 'A' | 'P' | 'R'`; `type CausaleRespingimento = 'NC' | 'IR' | 'A'`
  - `type PassoPiazzale = 'SCHEDA' | 'PESO' | 'ESITO' | 'QUANTITA_ACCETTATA' | 'CAUSALE' | 'MOTIVO' | 'RIEPILOGO' | 'FATTO'`
  - `interface StatoConferimento { legatoRentri: boolean; pesoVerificato: number | null; esito: EsitoPiazzale | null; quantitaAccettataKg: number | null; causale: CausaleRespingimento | null; motivo: string }`
  - `MOTIVO_MASSIMO = 1000`
  - `statoIniziale(legatoRentri: boolean): StatoConferimento`
  - `passiDelFlusso(s: StatoConferimento): PassoPiazzale[]`
  - `passoSuccessivo(s: StatoConferimento, corrente: PassoPiazzale): PassoPiazzale | null`
  - `passoPrecedente(s: StatoConferimento, corrente: PassoPiazzale): PassoPiazzale | null`
  - `puoProseguire(s: StatoConferimento, corrente: PassoPiazzale): boolean`
  - `payloadAccettazione(s: StatoConferimento): AccettaFirRentriPayload` (lancia `Error` se lo stato non è completo)
  - `ETICHETTE_ESITO: Record<EsitoPiazzale, string> = { A: 'Accettato per intero', P: 'Accettato parzialmente', R: 'Respinto' }`
  - `ETICHETTE_CAUSALE: Record<CausaleRespingimento, string> = { NC: 'Non conforme', IR: 'Irricevibile', A: 'Altro motivo' }`
- Produces (`arrivo-piazzale.ts`):
  - `numeroArrivo(fir: FIR): string` (`numeroProgressivo` ?? `rentriNumeroFir` ?? `'Senza numero'`)
  - `targheArrivo(fir: FIR): string[]` (targa del trasportatore e mezzi delle tratte, senza vuoti)
  - `statoRentriDaVerificare(fir: FIR): boolean` (legato e `rentriStatoFormulario` nullo)
  - `unitaInserimento(fir: FIR): string` (`'kg'` se legato, altrimenti `fir.rifiuto.unitaMisura`)

- [ ] **Step 1: test:**

```ts
expect(passiDelFlusso(statoIniziale(false))).toEqual(['SCHEDA', 'PESO', 'RIEPILOGO', 'FATTO'])
expect(passiDelFlusso(statoIniziale(true))).toEqual(['SCHEDA', 'PESO', 'ESITO'])
expect(passiDelFlusso({ ...statoIniziale(true), esito: 'A' })).toEqual(['SCHEDA', 'PESO', 'ESITO', 'RIEPILOGO', 'FATTO'])
expect(passiDelFlusso({ ...statoIniziale(true), esito: 'P' }))
  .toEqual(['SCHEDA', 'PESO', 'ESITO', 'QUANTITA_ACCETTATA', 'CAUSALE', 'MOTIVO', 'RIEPILOGO', 'FATTO'])
expect(passiDelFlusso({ ...statoIniziale(true), esito: 'R' }))
  .toEqual(['SCHEDA', 'PESO', 'ESITO', 'CAUSALE', 'MOTIVO', 'RIEPILOGO', 'FATTO'])
// puoProseguire: PESO falso con peso 0 o null; MOTIVO falso con '   ' e con 1001 caratteri
// payloadAccettazione:
//  A -> { tipoAccettazione: 'A', quantitaAccettataKg: 980 }
//  P -> { tipoAccettazione: 'P', quantitaAccettataKg: 500, causaleRespingimento: 'NC', motivoRespingimento: 'Imballi rotti' } (motivo trim)
//  R -> { tipoAccettazione: 'R', causaleRespingimento: 'IR', motivoRespingimento: 'Non autorizzato' } senza quantitaAccettataKg
//  R con causale null -> toThrow
// tornare da P ad A: payload A senza causale e motivo
// arrivo-piazzale: numeroArrivo, targheArrivo (['AB123CD', 'NAVE1']), statoRentriDaVerificare, unitaInserimento ('kg' per legato in 't')
```

- [ ] **Step 2:** `npx ng test --watch=false --browsers=ChromeHeadless --include=src/app/features/piazzale/flusso-piazzale.spec.ts --include=src/app/features/piazzale/arrivo-piazzale.spec.ts` → FAIL.
- [ ] **Step 3: implementare** (funzioni pure, nessun Angular). `payloadAccettazione` non mette `firmaInUfficio`: lo aggiunge il servizio del Task 8.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: commit** `feat(piazzale): flusso a passi del conferimento`

### Task 8: client HTTP

**Files:**
- Create: `features/piazzale/piazzale.service.ts`, `features/piazzale/piazzale.service.spec.ts`
- Modify: `features/rentri/rentri-fir-lifecycle.service.ts`
- Create: `features/rentri/rentri-fir-lifecycle.service.spec.ts`

**Interfaces:**
- Produces:
  - `interface ArriviPiazzale { azienda: { id: string; ragioneSociale: string }; codiciAziendaConfigurati: boolean; arrivi: FIR[] }`
  - `PiazzaleService.arrivi(cerca?: string): Observable<ArriviPiazzale>` → `GET ${environment.apiUrl}/piazzale/arrivi`, parametro `cerca` solo se non vuoto dopo `trim()`
  - `interface EsitoAccettazioneInUfficio { tipoAccettazione: 'A' | 'P' | 'R'; firmaInUfficio: true; statoFormulario: string | null }`
  - `RentriFirLifecycleService.accettaConFirmaInUfficio(firId: string, payload: AccettaFirRentriPayload): Observable<EsitoAccettazioneInUfficio>` → `POST .../rentri/fir/:id/accettazione` con `{ ...payload, firmaInUfficio: true }`
  - `RentriFirLifecycleService.firmaAccettazione(firId: string): Observable<EsitoFirmaRemota>` → `POST .../rentri/fir/:id/firma-accettazione` con `{}`
  - `AccettaFirRentriPayload` riceve il campo facoltativo `firmaInUfficio?: boolean`; `accettaORespingi` non cambia.

- [ ] **Step 1: test** con `HttpTestingController`: URL, metodo, corpo esatto (`firmaInUfficio: true` presente nel solo nuovo metodo), `cerca` assente con `'  '` e presente con `'AB1'`.
- [ ] **Step 2:** `npx ng test ... --include=src/app/features/piazzale/piazzale.service.spec.ts --include=src/app/features/rentri/rentri-fir-lifecycle.service.spec.ts` → FAIL.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: commit** `feat(piazzale): client HTTP dell'elenco e dell'accettazione in ufficio`

### Task 9: componente tastierino

**Files:**
- Create: `features/piazzale/piazzale-tastierino.component.ts`, `features/piazzale/piazzale-tastierino.component.spec.ts`

**Interfaces:**
- Consumes: `applicaTasto`, `variaPeso`, `passoPeso`, `numeroInTesto` (Task 6).
- Produces: `<app-piazzale-tastierino [valore]="testo" [unita]="'kg'" (valoreChange)="..." />`, standalone, selettore `app-piazzale-tastierino`; `data-testid`: `tastierino-display`, `tastierino-meno`, `tastierino-piu`, `tastierino-tasto-<0..9|virgola|cancella>`.

- [ ] **Step 1: test:**

```ts
it('1, virgola, 5 emette "1", "1,", "1,5"', ...)
it('piu con unita kg emette "10"; meno da "5" emette "0"', ...)
it('display mostra valore e unita ("1,5 t")', ...)
it('ogni pulsante e alto e largo almeno 56 px', () => {
  fixture.nativeElement.querySelectorAll('button').forEach((b: HTMLElement) => {
    expect(b.getBoundingClientRect().height).toBeGreaterThanOrEqual(56)
    expect(b.getBoundingClientRect().width).toBeGreaterThanOrEqual(56)
  })
})
it('meno e piu hanno aria-label con passo e unita ("Diminuisci di 10 kg")', ...)
```

- [ ] **Step 2:** `npx ng test ... --include=src/app/features/piazzale/piazzale-tastierino.component.spec.ts` → FAIL.
- [ ] **Step 3: implementare.** Griglia 3×4 per i tasti, meno e più ai lati del display; `min-height`/`min-width` da `var(--piazzale-bersaglio, 56px)`; solo token del tema (nessun colore letterale). Il tastierino non ha l'azione principale: niente giallo.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: commit** `feat(piazzale): tastierino del peso con più e meno`

### Task 10: elenco dei FIR in arrivo

**Files:**
- Create: `features/piazzale/piazzale-arrivi.component.ts`, `features/piazzale/piazzale-arrivi.component.spec.ts`

**Interfaces:**
- Consumes: `PiazzaleService.arrivi` (Task 8); `numeroArrivo`, `targheArrivo`, `statoRentriDaVerificare` (Task 7); `contrassegnoAzienda(id, nome)` (`shared/utils/contrassegno-azienda.ts`); `formattaNumero` (`features/fir/scostamento-peso.ts`).
- Produces: componente standalone `PiazzaleArriviComponent` (selettore `app-piazzale-arrivi`), naviga a `['/piazzale', fir.id]`. `data-testid`: `piazzale-azienda`, `piazzale-cerca-input`, `piazzale-cerca-bottone`, `piazzale-aggiorna`, `piazzale-arrivo-<id>`, `piazzale-vuoto`, `piazzale-errore`.

Testi fissi:
- codici mancanti: `Mancano partita IVA e codice fiscale dell'azienda: il piazzale non può riconoscere i FIR destinati a voi. Completa i dati dell'azienda.`
- vuoto: `Nessun FIR in arrivo.`; vuoto con ricerca: `Nessun FIR in arrivo corrisponde a «<testo>».`
- 403: `Il tuo ruolo nell'azienda selezionata non consente di registrare i conferimenti.`
- status 0: `Senza rete: impossibile caricare l'elenco.`; altro errore: `Elenco non disponibile. Riprova tra poco.`

- [ ] **Step 1: test** (servizio e router finti):

```ts
it('mostra contrassegno e ragione sociale dell azienda', ...)
it('una riga per FIR: numero, produttore, EER, quantita dichiarata, targa, badge "RENTRI"/"Locale"', ...)
it('FIR legato mai riconciliato: "Stato RENTRI da verificare"', ...)
it('cerca chiama arrivi con il testo inserito; Aggiorna rilegge', ...)
it('tocco su una riga naviga a /piazzale/<id>', ...)
it('i tre stati vuoti e i tre errori mostrano i testi fissi', ...)
it('righe, ricerca e aggiorna sono alte almeno 56 px', ...)
```

- [ ] **Step 2:** `npx ng test ... --include=src/app/features/piazzale/piazzale-arrivi.component.spec.ts` → FAIL.
- [ ] **Step 3: implementare.** Una colonna, righe come pulsanti a tutta larghezza; nessun giallo (l'elenco non ha un'azione principale: la scelta è la decisione).
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: commit** `feat(piazzale): elenco dei FIR in arrivo con ricerca per numero o targa`

### Task 11: conferimento (scheda, peso, esito, invio)

**Files:**
- Create: `features/piazzale/piazzale-conferimento.component.ts`, `features/piazzale/piazzale-conferimento.component.spec.ts`

**Interfaces:**
- Consumes: `FirService.getFIRById(id)`, `FirService.confermaConsegna(id, pesoEffettivo)` (`features/fir/fir.service.ts`); `RentriFirLifecycleService.azioniDisponibili(id)`, `.accettaConFirmaInUfficio(id, payload)` (Task 8); flusso e arrivo (Task 7); peso (Task 6); `calcolaScostamentoPeso`, `testoAvvisoScostamento` (`features/fir/scostamento-peso.ts`); `ConnectionMonitorService.isOnline$` (Task 5, con `toSignal`); `<app-piazzale-tastierino>` (Task 9).
- Produces: `PiazzaleConferimentoComponent` (selettore `app-piazzale-conferimento`), legge `:id` dalla rotta. `data-testid`: `piazzale-passo-<passo minuscolo>`, `piazzale-azione-principale`, `piazzale-indietro`, `piazzale-esito-<A|P|R>`, `piazzale-causale-<NC|IR|A>`, `piazzale-motivo`, `piazzale-avviso-scostamento`, `piazzale-blocco-rete`, `piazzale-errore`.

Comportamento:
- Apertura: FIR locale non `IN_TRANSITO`, o legato non `IN_TRANSITO`/`BOZZA` → `Questo FIR non è più in arrivo (stato: <stato>).` e nessun passo. FIR legato → `azioniDisponibili`; senza `Accettazione` → `Su RENTRI questo formulario non è in fase di accettazione (stato: <stato>). Dal piazzale non c'è nulla da registrare.`; errore della lettura → messaggio del backend (`err.error.message`).
- SCHEDA: produttore (ragione sociale e P.IVA), EER + descrizione, quantità dichiarata con unità, trasportatore e targhe. Azione principale `Pesa il carico`.
- PESO: tastierino nell'unità `unitaInserimento(fir)`; sotto, con `quantitaDichiarataPerConfronto` e `calcolaScostamentoPeso`: se `oltreSoglia` → `testoAvvisoScostamento(s, dichiarata)` preceduto da `Avviso, non un limite di legge.`; se il confronto è `null` → `Scostamento non calcolabile: quantità dichiarata in litri, peso in kg.` Azione principale `Avanti` (disabilitata se `!puoProseguire`).
- ESITO / CAUSALE: tre pulsanti grandi con `ETICHETTE_ESITO` / `ETICHETTE_CAUSALE`; il tocco sceglie e passa al passo successivo (nessun pulsante giallo su questi passi).
- QUANTITA_ACCETTATA: tastierino in kg, precompilato col peso verificato. MOTIVO: textarea `maxlength=1000` con contatore. Azione principale `Avanti`.
- RIEPILOGO: riassunto; azione principale `Conferma consegna` (locale) o `Registra accettazione` (RENTRI). Con rete assente il pulsante è disabilitato e compare `Senza rete l'invio è bloccato: ricollegati e premi di nuovo. I dati non vengono salvati sul tablet.`
- Invio: un solo invio in corso (`inCorso` signal, pulsante disabilitato). Locale → `confermaConsegna(id, pesoVerificato)`; RENTRI → `accettaConFirmaInUfficio(id, payloadAccettazione(stato))`.
- Errori d'invio: status 0 → `La connessione si è interrotta durante l'invio: l'esito non è noto. Non ripetere: verifica in ufficio se il conferimento risulta registrato.` e l'azione principale sparisce (resta solo `Torna all'elenco`); 403 → testo ruolo del Task 10; locale 400/404/409 → `Consegna non registrata: il FIR potrebbe essere già stato confermato o non essere più in transito. Torna all'elenco e ricaricalo.`; RENTRI 4xx → `err.error.message`.
- FATTO: locale → `Consegna registrata.` + peso verificato e, se presente, l'avviso di scostamento dalla risposta (`fir.scostamentoPeso`); RENTRI → `Accettazione registrata, da firmare in ufficio.` + `Esito: <ETICHETTE_ESITO[risposta.tipoAccettazione]>` + `Stato RENTRI: <risposta.statoFormulario ?? 'da rileggere in ufficio'>`. Azione principale `Prossimo FIR` → `/piazzale`.
- `Indietro` su ogni passo tranne SCHEDA (→ elenco) e FATTO; `passoPrecedente` per gli altri.
- Una sola `.azione-principale` per passo: sfondo `var(--piazzale-azione)`, testo `var(--on-piazzale-azione)`.

- [ ] **Step 1: test** (servizi finti, `ConnectionMonitorService` sostituito da `{ isOnline$: new BehaviorSubject(true) }`):

```ts
it('FIR locale: scheda -> peso -> riepilogo -> conferma: confermaConsegna(id, 980) e "Consegna registrata."', ...)
it('FIR RENTRI A: accettaConFirmaInUfficio(id, { tipoAccettazione: "A", quantitaAccettataKg: 980 }) e mostra "Accettazione registrata, da firmare in ufficio."', ...)
it('FIR RENTRI R: dopo ESITO chiede causale e motivo, non invia quantita', ...)
it('FIR RENTRI P: chiede quantita accettata precompilata col peso', ...)
it('FIR locale: nessun pulsante A/P/R in nessun passo', ...)
it('scostamento oltre soglia: avviso con "Avviso, non un limite di legge."; entro soglia: nessun avviso', ...)
it('FIR RENTRI in litri: "Scostamento non calcolabile..."', ...)
it('senza rete: azione principale disabilitata, messaggio di blocco, nessuna chiamata', ...)
it('doppio tocco su Registra: una sola chiamata', ...)                        // Review Focus 2
it('status 0 durante l invio: messaggio "esito non noto" e nessun pulsante per ripetere', ...) // Review Focus 1
it('azioni senza Accettazione: messaggio e nessun passo', ...)               // Review Focus 4
it('FIR locale gia CONSEGNATO: "Questo FIR non è più in arrivo"', ...)       // Review Focus 4
it('errore 400 di conferma-consegna: testo italiano fisso, mai il messaggio inglese del backend', ...)
it('in ogni passo una sola .azione-principale e ogni pulsante e alto almeno 56 px', ...)
```

- [ ] **Step 2:** `npx ng test ... --include=src/app/features/piazzale/piazzale-conferimento.component.spec.ts` → FAIL.
- [ ] **Step 3: implementare.** Stato del flusso in un `signal<StatoConferimento>` e passo corrente in un `signal<PassoPiazzale>`; nessuna logica di passi fuori da `flusso-piazzale.ts`.
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: commit** `feat(piazzale): conferimento con peso, esito e firma rimandata all'ufficio`

### Task 12: guscio, rotta, voce di menu e firma in ufficio nel dettaglio FIR

**Files:**
- Create: `features/piazzale/piazzale-shell.component.ts`, `features/piazzale/piazzale-shell.component.spec.ts`
- Modify: `app.routes.ts` (nuova rotta di primo livello **prima** della rotta `''` del layout)
- Modify: `shared/components/layout.component.ts` (solo una voce in `navMain`)
- Create: `features/rentri/esito-firma-remota.ts`, `features/rentri/esito-firma-remota.spec.ts`
- Modify: `features/fir/fir-detail.component.ts`, `features/fir/fir-detail.component.spec.ts`

**Interfaces:**
- Consumes: `ConnectionMonitorService.isOnline$`; i componenti dei Task 10 e 11; `RentriFirLifecycleService.firmaAccettazione` e `EsitoFirmaRemota` (Task 8).
- Produces:
  - rotta `{ path: 'piazzale', canActivate: [authGuard], loadComponent: PiazzaleShellComponent, children: [{ path: '', loadComponent: PiazzaleArriviComponent }, { path: ':id', loadComponent: PiazzaleConferimentoComponent }] }`
  - voce `{ label: 'Piazzale', route: '/piazzale', icon: 'pi pi-tablet' }` in `navMain`, dopo `FIR`
  - guscio: `:host { --piazzale-azione: #facc15; --on-piazzale-azione: #111111; --piazzale-bersaglio: 56px; }` (giallo identico nei due temi, testo quasi nero); barra in testa `data-testid="piazzale-rete"`, `role="status"`, `aria-live="polite"`, testi `In linea` / `Senza rete: l'invio è bloccato`; collegamento `Esci dal piazzale` → `/dashboard`; `<router-outlet>`; nessuna sidebar né header del layout d'ufficio
  - `messaggioEsitoFirma(esito: EsitoFirmaRemota): { severity: 'success' | 'info' | 'warn' | 'error'; summary: string; detail: string }`:
    - COMPLETATA → `success`, `Accettazione firmata`, `RENTRI ha acquisito la firma. Stato del formulario: <statoFormulario>.`
    - IN_ATTESA → `info`, `In attesa di conferma sul dispositivo`, `Conferma la firma nell'app RENTRI FIR Digitale. Non ripetere l'operazione: ricarica la pagina tra qualche minuto per vedere l'esito.`
    - SCADUTA → `warn`, `Firma scaduta`, `La richiesta non è stata confermata in tempo. Puoi richiederla di nuovo.` (+ ` Dettaglio: <dettaglioEnte>` se presente)
    - RIFIUTATA → `error`, `Firma rifiutata`, `La firma non è stata autorizzata.` (+ ` Dettaglio: <dettaglioEnte>` se presente)
  - in `FirDetailComponent`: `canFirmareAccettazione(fir: FIR): boolean` (legato, `canManageRENTRI()`, `rentriStatoFormulario === 'FirmaAccettazione'`, nessuna richiesta già in attesa), `firmaAccettazione(): void`, signal `firmaAccettazioneInCorso`, `firmaAccettazioneInAttesa`; pulsante `Firma l'accettazione` con `data-testid="fir-detail-rentri-firma-accettazione"` accanto a `Accetta il carico` (riga ~468)

- [ ] **Step 1: test:**

```ts
// shell
it('mostra "In linea" e poi "Senza rete: l invio è bloccato" quando isOnline$ emette false', ...)
it('non contiene la sidebar del layout (nessun nav.sidebar) e ha "Esci dal piazzale"', ...)
// esito-firma-remota: i quattro casi con i testi sopra, con e senza dettaglioEnte
// fir-detail
it('FirmaAccettazione: compare "Firma l accettazione"; altrimenti no', ...)
it('click: chiama firmaAccettazione e mostra il messaggio di messaggioEsitoFirma', ...)
it('dopo IN_ATTESA il pulsante sparisce fino al ricaricamento (nessuna seconda richiesta)', ...)
```

- [ ] **Step 2:** `npx ng test ... --include=src/app/features/piazzale/piazzale-shell.component.spec.ts --include=src/app/features/rentri/esito-firma-remota.spec.ts --include=src/app/features/fir/fir-detail.component.spec.ts` → FAIL.
- [ ] **Step 3: implementare** guscio, rotta, voce di menu, `messaggioEsitoFirma`, pulsante nel dettaglio (al successo `this.reload()` come `confermaAccettazione`).
- [ ] **Step 4:** stesso comando → PASS; poi l'intera suite `npx ng test --watch=false --browsers=ChromeHeadless`, `npm run build` e dalla root `npx eslint "apps/frontend/src/**/*.ts"` → verdi.
- [ ] **Step 5: commit** `feat(piazzale): rotta tablet senza sidebar e firma dell'accettazione in ufficio`

### Task 13: e2e e verifica finale

**Files:**
- Create: `e2e/tests/piazzale/piazzale.spec.ts`

**Interfaces:**
- Consumes: `loginAndSaveState(page, context, 'operator')`, `skipReason('operator')` (`e2e/fixtures/auth.ts`), `hasRoleCredentials('operator')` (`e2e/utils/env.ts`); i `data-testid` dei Task 10-12.

- [ ] **Step 1: scrivere la spec** (sola lettura: nessun invio, quindi sicura su ogni ambiente):

```ts
test.describe('Piazzale', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))
  test('apre /piazzale senza sidebar, con la barra di rete e l elenco (o il suo stato vuoto)', ...)
  test('senza rete la barra dice "Senza rete: l invio è bloccato"', async ({ page, context }) => {
    // context.setOffline(true) dopo il caricamento; expect(getByTestId('piazzale-rete')).toContainText('Senza rete')
  })
})
```

- [ ] **Step 2:** con backend e frontend locali accesi, `cd e2e && npx playwright test tests/piazzale` → prima dell'implementazione FAIL; ora PASS (o SKIP motivato se mancano le credenziali `operator`: in quel caso dichiararlo nel report, non spacciarlo per verde).
- [ ] **Step 3: verifica completa.** Backend: suite unitaria completa (`NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov`), `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, Postgres `arrivi-piazzale.service.postgres.spec.ts` + `fir-prisma.repository.postgres.spec.ts` + `rls-catalogo.postgres.spec.ts`, oracolo `rentri-accettazione.oracolo.spec.ts`. Frontend: suite completa e `npm run build`. Controllo dei file vietati: `git diff --name-only master... | grep -F -f <(for b in feat/fase2-6-deposito feat/fase2-8-mud-sede feat/fase2-10-controparti; do git diff --name-only origin/master...$b; done)` → nessuna riga.
- [ ] **Step 4: commit** `test(piazzale): e2e della rotta tablet e del blocco senza rete`

---

## Limiti dichiarati (da riportare nella PR)

- Firma dal tablet: mai, perché il codice non sa quale utente è firmatario (D2). Seguito: credenziale di firma per utente.
- Sede del destinatario non scelta né memorizzata (D5); targa assente sui FIR acquisiti da RENTRI (D6).
- Stato interno: parziale e respinto restano CONSEGNATO; l'esito mostrato viene dalla risposta di RENTRI (`tipoAccettazione` accettato dall'ente e `statoFormulario` riletto).
- La rete è dedotta da `navigator.onLine` (D4): un Wi-Fi senza internet risulta "in linea"; in quel caso l'invio fallisce con status 0 e scatta il messaggio "esito non noto".
- Coda offline e notifica dello scostamento al produttore: seguiti, come da spec.
