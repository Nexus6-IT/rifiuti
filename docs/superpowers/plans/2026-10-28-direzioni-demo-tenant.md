# Tenant demo: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** uno script, lanciato a mano in produzione, cancella e ricrea un consulente con cinque aziende demo e circa nove mesi di attività verosimile generata dai use case del dominio, con la fake RENTRI come ente per i soli tenant demo e tre utenti Keycloak demo.

**Architecture:** il codice dello script sta in `apps/backend/src/demo/` e viene compilato nell'immagine del backend (`dist/demo/…`); si esegue con un servizio compose `demo-seed` (profilo `demo`) che estende `backend`. Un pianificatore puro produce la sequenza di eventi (FIR, movimenti, scadenze) a partire da `oggi`; un esecutore la applica chiamando i use case dentro `TenantContext` e dentro un orologio simulato, perché i use case leggono l'ora da `new Date()`. L'indirizzo RENTRI diventa per tenant: una credenziale con `environment = 'fake'` instrada verso `RENTRI_FAKE_API_URL`, tutte le altre restano sull'indirizzo globale invariato. La fake (`tools/rentri-fake`) guadagna una modalità dimostrativa (completamento automatico delle transazioni, emissione di certificati) e gira come servizio interno dello stack `/opt/rifiuti/`, senza porte pubblicate.

**Tech Stack:** NestJS 10 + Prisma 5 (backend), Fastify + node-forge (fake), Angular 17 + PrimeNG 17 (banner), Jest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-28-direzioni-demo-design.md`, sezione "5. Tenant demo" (più "Vincoli trasversali" e "Anti-obiettivi").

## Global Constraints

- Testi in italiano, termini tecnici in inglese (branch, commit, deploy, seed, tenant, endpoint...). Commit nello stile `feat(demo): …`, `test(demo): …`, `feat(rentri-fake): …`, **senza righe di attribuzione AI**.
- **File da NON toccare** (in diff con F2-6, F2-8, F2-10): `apps/backend/prisma/schema.prisma`, qualunque `prisma/migrations/**`, `apps/backend/jest.config.js`, `apps/backend/tsconfig.json`, `ops/README.md`, `apps/backend/src/core/domain/errors.ts`, `apps/backend/src/core/filters/http-exception.filter.ts`, `apps/backend/src/core/monitoring/opzioni-sentry.ts`, `apps/backend/src/infrastructure/persistence/prisma-rls.extension.ts`, `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md`, `apps/backend/src/infrastructure/persistence/rls-catalogo.postgres.spec.ts`, `apps/backend/src/application/giacenze/**`, `apps/backend/src/application/registro/aperture-registro*.ts`, `apps/backend/src/application/registro/lettori-*.ts`, `apps/backend/src/application/registry/ditte/**`, `apps/backend/src/domain/registry/**`, `apps/backend/src/domain/waste-movement/deposito-temporaneo*.ts`, `fifo-deposito*.ts`, `apps/backend/src/test-support/**`. Niente migration: il tenant demo si riconosce senza colonne nuove.
- **Nessun dato reale**: P.IVA con codice ufficio `000` (inesistente, quindi nessuna azienda reale può averla), codici fiscali delle persone con comune `Z999` (inesistente), PEC ed email sul dominio `demo.wasteflow.invalid` (TLD `.invalid` riservato, RFC 2606), ragione sociale che termina con ` (demo)`.
- **Marcatore del tenant demo** = PEC che termina con `@demo.wasteflow.invalid`. **Marcatore dell'utente Keycloak demo** = username in `demo-consulente | demo-titolare | demo-piazzale` **e** email che termina con `@demo.wasteflow.invalid`. Nessun'altra regola decide cosa si cancella.
- Lo script **non** è lanciato dal deploy. In `docker-compose.prod.yml` i servizi nuovi stanno nel profilo `demo` e le variabili nuove si interpolano con `${VAR:-}` (mai `:?`: compose interpola tutto il file anche per i profili spenti e il deploy si fermerebbe).
- La fake non pubblica porte sull'host: solo rete `wasteflow`.
- Tenant senza credenziale fake: comportamento RENTRI **identico** a oggi (stesso `baseUrl`, stessa `signatureAudience`).
- Le operazioni sul VPS (Task 14, 15, 16) sono **operazioni manuali del coordinatore**, non degli implementatori.

## Review Focus

1. **Un tenant reale instradato verso la fake** (credenziale `demo`/`live`, credenziale assente, chiamate di piattaforma senza tenant): deve restare sull'indirizzo globale; e un tenant `fake` senza `RENTRI_FAKE_API_URL` deve fallire chiuso, mai ripiegare sull'ente vero. Test nel Task 5.
2. **La pulizia che cancella qualcosa di non demo**: un utente con email reale dentro un tenant marcato, una credenziale `live` in un tenant marcato, più di 10 tenant marcati → rifiuto senza cancellare nulla. Test nel Task 9.
3. **Un utente Keycloak `demo-*` creato a mano da qualcuno con un'email vera**: non si tocca e il ripristino si ferma prima di ogni cancellazione. Test nel Task 8.
4. **Fake irraggiungibile o password demo mancanti al lancio**: il ripristino si ferma prima di cancellare la demo esistente (altrimenti la demo sparisce e non torna). Test nel Task 13.
5. **Script lanciato in un'altra data** (a cavallo di Natale, a Ferragosto, a gennaio): ogni scenario di Studio deve comparire comunque, con margini che non dipendono dal calendario delle festività. Test nel Task 3.

Più: email reali verso gli indirizzi demo (Task 8, guardia sul dominio `.invalid`).

---

## Decisioni del piano (da controllare dal coordinatore)

- **D1. Indirizzo RENTRI oggi è globale.** `loadRentriConfig` (`apps/backend/src/infrastructure/rentri/rentri-config.ts:66`) legge `RENTRI_API_URL` e ogni client concatena `this.config.baseUrl` (circa 40 punti in 9 file). Le credenziali invece sono già per tenant (`RentriCredentialResolver.resolve(tenantId)`). L'override per tenant usa la colonna esistente `RentriCredential.environment` (VarChar(10), oggi `demo`/`live`): il valore riservato `fake` instrada verso `RENTRI_FAKE_API_URL`. Nessuna modifica di schema (lo schema è conteso da F2-6 e F2-10). L'API pubblica rifiuta `environment = 'fake'`: lo scrive solo lo script.
- **D2. Service account Keycloak.** Il backend usa `KeycloakUserAdapter` con `client_credentials` del client `rifiuti-admin` (`KEYCLOAK_CLIENT_ID`, `docker-compose.prod.yml`), che ha `manage-users`, `view-users`, `query-users`, `query-groups` sul realm `ignicraft` (memoria di progetto, provisioning del 2026-06-16): può creare e cancellare utenti e impostare password. Il Task 14 lo verifica sul VPS prima del primo lancio. Limite: `createUser` oggi forza `username = codice fiscale`; si aggiunge un `username` facoltativo (additivo). Il marcatore Keycloak sta nell'email e non in un attributo, perché il realm (Keycloak 24+ con User Profile) scarta gli attributi non dichiarati e dichiararne uno richiede `manage-realm`, che il service account non ha.
- **D3. Il login trova l'utente per codice fiscale** (`SpidStrategy.validate`): ogni utente demo ha un codice fiscale sintetico unico, scritto sia nell'attributo Keycloak `fiscalCode` (già dichiarato nel User Profile) sia nella riga `users`.
- **D4. Orologio simulato.** I use case FIR (`FIR.create`, `confermaConsegna`, firme) e l'ActivityLog prendono l'ora da `new Date()`. Lo storico si genera dentro `eseguiAllIstante(istante, fn)`, che sostituisce `globalThis.Date` per la durata della chiamata. Le chiamate RENTRI e Keycloak avvengono **solo** a orologio reale (JWT con `iat`/`exp` verificati). `created_at` di FIR e movimenti è scritto dal motore Prisma/dal database con l'ora reale: dopo lo storico lo script lo riallinea all'istante simulato (solo `firs.created_at` e `waste_movements.created_at` dei tenant demo, client proprietario). È l'unica scrittura diretta su tabelle di dominio, riguarda un timestamp tecnico e non un numero; senza, l'elenco FIR (ordinato per `createdAt`) e i grafici mensili mostrerebbero nove mesi di attività compressi in un giorno.
- **D5. Finestra temporale.** `inizio = min(oggi − 9 mesi, 1 ottobre dell'anno precedente)`. Studio cerca il MUD dell'anno `oggi.anno − 1` (piano Studio, `annoDati = anno − 1`): senza almeno un trimestre dell'anno precedente il "MUD in bozza" sarebbe vuoto. Al 28/10/2026 la finestra è di 13 mesi, a marzo è di 9.
- **D6. Sei tenant, non cinque.** Il consulente ha una sua azienda "Studio Ambiente (demo)" come tenant di appartenenza e un'associazione `CONSULTANT` verso ciascuna delle cinque aziende: tre produttori (officine, falegnameria, edilizia), un trasportatore, un impianto. Il destinatario di smaltimento (D) è solo un'anagrafica fittizia, non un tenant.
- **D7. Ruoli di sistema del primo tenant.** `TenantService.create` semina i ruoli con `createdBy` = utente chiamante, con vincolo di chiave esterna verso `users`. Per il primo tenant (lo Studio) non esiste ancora un utente demo: si usa come attore il primo utente `SUPER_ADMIN` della piattaforma (solo per `roles.created_by` dello Studio, cancellati con lo Studio). Dal secondo tenant l'attore è `demo-consulente`. Se non esiste un `SUPER_ADMIN`, lo script si ferma con un messaggio.
- **D8. Righe `users` demo create con Prisma** dentro il `TenantContext` del tenant, come fa `UserAdminService.createUser` al passo 5: quel servizio non si può riusare perché forza lo username Keycloak uguale al codice fiscale.
- **D9. MUD in bozza** via `MudIntegrazioniService.salva(tenantId, anno − 1, userId, dati)`, che crea il `MUDReport` in `DRAFT`. Non via export: il tracciato dell'anno in corso non esiste.
- **D10. Generatore P.IVA.** Quello di F2-10 (`e2e/utils/partita-iva.ts`, `partitaIvaCasualeValida()`) è casuale e sta nel workspace Playwright, fuori dal contesto di build del backend (`./apps/backend`): non è importabile nell'immagine. Il generatore resta locale e deterministico; dopo il merge di F2-10 si allineano solo i vettori di prova (seguito, non un task).
- **D11. FIR RENTRI acquisiti dall'impianto nascono in BOZZA** (`CreaFIRDaDettaglioRENTRIUseCase` → `FIR.create`). Il piano Piazzale (D3) li include già (legato, BOZZA, `rentriStatoFormulario` nullo). Il seed non forza lo stato.
- **D12. Stato della fake in memoria.** Archivio e CA di prova si perdono a ogni riavvio del container della fake: dopo un riavvio si rilancia il ripristino. Lo si dichiara nel Task 15.
- **D13. Scadenze seminate oltre le due richieste**: autorizzazione del destinatario e iscrizione Albo del trasportatore in scadenza entro 30 giorni, certificato RENTRI (fake) in scadenza tra 25 giorni, FIR consegnato all'impianto senza carico (riga "termine da configurare"), MUD in bozza. Non seminate: scorta vidimata e ADR (il flag ADR non esiste).

## File toccati

| File | Task | Note |
|---|---|---|
| `apps/backend/src/demo/identificativi-demo.ts` (+spec) | 1 | nuovo |
| `apps/backend/src/demo/marcatori-demo.ts` (+spec) | 1 | nuovo |
| `apps/backend/src/demo/orologio-simulato.ts` (+spec) | 2 | nuovo |
| `apps/backend/src/demo/aziende-demo.ts`, `piano-attivita.ts` (+spec) | 3 | nuovi |
| `tools/rentri-fake/src/app.ts`, `server.ts`, `src/routes/controllo.ts`, `src/routes/formulari.ts`, `src/stato/archivio.ts`, `src/auth/soggetti-accreditati.ts`, nuovo `src/dimostrativa.ts`, test | 4 | fake |
| `apps/backend/src/infrastructure/rentri/rentri-ambiente.ts`, `rentri-endpoint.resolver.ts` (+spec, +guardia) | 5 | nuovi |
| `rentri-config.ts`, `rentri-credential.service.ts`, `rentri-signature.service.ts`, `rentri.module.ts`, i 9 client (`rentri-api.client.ts`, `rentri-anagrafiche.client.ts`, `rentri-copie.client.ts`, `rentri-registri.client.ts`, `rentri-trasmissioni.client.ts`, `rentri-vidimazione.client.ts`, `codifiche/rentri-codifiche.client.ts`, `xfir/rentri-xfir.client.ts`) | 5 | condivisi con l'area RENTRI |
| `apps/backend/src/api/rentri/dto/set-rentri-credential.dto.ts`, `rentri-credential.controller.ts` (+spec) | 6 | |
| `apps/frontend/src/app/features/rentri/rentri-credential.service.ts`, nuovo `rentri-ambiente-dimostrativo.component.ts` (+spec), `rentri-credential.component.ts`, `rentri-formulari.component.ts`, `rentri-modalita-legame.component.ts` | 6 | |
| `apps/backend/src/infrastructure/rentri/ciclo-dimostrativo.oracolo.spec.ts` | 7 | nuovo |
| `apps/backend/src/infrastructure/keycloak/keycloak-user.adapter.ts` (+ nuovo spec), `apps/backend/src/infrastructure/email/email.service.ts` (+ nuovo spec), `apps/backend/src/demo/utenti-demo-keycloak.ts` (+spec) | 8 | adapter ed email condivisi |
| `apps/backend/src/demo/pulizia-demo.ts` (+`.postgres.spec.ts`) | 9 | nuovo |
| `apps/backend/src/demo/preparazione-aziende.ts` (+spec) | 10 | nuovo |
| `apps/backend/src/demo/esecutore-storico.ts` (+spec) | 11 | nuovo |
| `apps/backend/src/demo/fase-presente.ts` (+spec) | 12 | nuovo |
| `apps/backend/src/demo/demo-seed.module.ts`, `ripristino-demo.ts` (+spec), `ripristina-tenant-demo.main.ts`, `docker-compose.prod.yml`, `.env.example` | 13 | compose condiviso |

---

### Task 1: Identificativi e marcatori demo

**Files:**
- Create: `apps/backend/src/demo/identificativi-demo.ts`, `apps/backend/src/demo/marcatori-demo.ts`
- Test: `apps/backend/src/demo/identificativi-demo.spec.ts`, `apps/backend/src/demo/marcatori-demo.spec.ts`

**Interfaces:**
- Produces:
  - `partitaIvaDemo(progressivo: number): string` — matricola `'99' + progressivo` su 5 cifre, ufficio `'000'`, cifra di controllo (algoritmo di `PartitaIva.isValid`, `domain/shared/partita-iva.vo.ts`). `RangeError` fuori da 1..99999.
  - `codiceFiscaleDemo(progressivo: number): string` — `'DMOUTN00A' + giorno(progressivo su 2 cifre) + 'Z999' + carattere di controllo` (tabelle ufficiali dispari/pari). `RangeError` fuori da 1..28.
  - `numIscrSitoDemo(progressivo: number): string` — `` `OP0000DMO${p6}-DM${p4}` `` (`p6`/`p4` = progressivo con zeri a sinistra a 6 e 4 cifre); rispetta `NUM_ISCR_SITO_PATTERN`. `RangeError` fuori da 1..9999.
  - `DOMINIO_DEMO = 'demo.wasteflow.invalid'`, `indirizzoDemo(locale: string): string` (`` `${locale}@${DOMINIO_DEMO}` ``), `eIndirizzoDemo(indirizzo: string | null | undefined): boolean` (case-insensitive, `false` per null), `USERNAME_DEMO = ['demo-consulente', 'demo-titolare', 'demo-piazzale'] as const`, `type UsernameDemo = typeof USERNAME_DEMO[number]`, `eUtenteKeycloakDemo(u: { username: string; email?: string | null }): boolean`, `SUFFISSO_RAGIONE_SOCIALE_DEMO = ' (demo)'`.

- [ ] **Step 1: test che falliscono.**

```ts
// identificativi-demo.spec.ts
it.each([[1, '99000010001'], [2, '99000020000'], [6, '99000060006']])('partitaIvaDemo(%i) = %s', (n, atteso) =>
  expect(partitaIvaDemo(n)).toBe(atteso))
it('ogni P.IVA demo supera PartitaIva.isValid e ha ufficio 000', () => {
  for (let n = 1; n <= 50; n++) { const p = partitaIvaDemo(n); expect(PartitaIva.isValid(p)).toBe(true); expect(p.slice(7, 10)).toBe('000') }
})
it('progressivo fuori intervallo: RangeError', () => { expect(() => partitaIvaDemo(0)).toThrow(RangeError); expect(() => partitaIvaDemo(100000)).toThrow(RangeError) })
it.each([[1, 'DMOUTN00A01Z999Z'], [2, 'DMOUTN00A02Z999E'], [3, 'DMOUTN00A03Z999G']])('codiceFiscaleDemo(%i) = %s', (n, atteso) =>
  expect(codiceFiscaleDemo(n)).toBe(atteso))
it('ogni CF demo supera FiscalCode.isValid e ha comune Z999', ...)   // 1..28
it('numIscrSitoDemo rispetta NUM_ISCR_SITO_PATTERN', ...)            // 1, 9, 9999 → pattern; 'OP0000DMO000001-DM0001' per 1
// marcatori-demo.spec.ts
it('eIndirizzoDemo: dominio demo sì (anche maiuscolo), altri no, null no', ...)
it('eUtenteKeycloakDemo: username demo + email demo → true', ...)
it('eUtenteKeycloakDemo: username demo + email reale → false', ...)
it('eUtenteKeycloakDemo: username non demo + email demo → false', ...)
```

- [ ] **Step 2: eseguire.** Run: `cd apps/backend && npx jest src/demo/identificativi-demo src/demo/marcatori-demo` — Expected: FAIL, moduli assenti.
- [ ] **Step 3: implementare i due file** con le firme sopra (funzioni pure, nessuna dipendenza oltre ai VO usati nei test).
- [ ] **Step 4: eseguire.** Stesso comando — Expected: PASS.
- [ ] **Step 5: commit.** `git add apps/backend/src/demo/identificativi-demo* apps/backend/src/demo/marcatori-demo*` — `feat(demo): identificativi sintetici e marcatori del tenant demo`

### Task 2: Orologio simulato

**Files:**
- Create: `apps/backend/src/demo/orologio-simulato.ts`
- Test: `apps/backend/src/demo/orologio-simulato.spec.ts`

**Interfaces:**
- Produces: `eseguiAllIstante<T>(istante: Date, fn: () => Promise<T>): Promise<T>`; `orologioSimulatoAttivo(): boolean`.
- Comportamento: per la durata di `fn`, `globalThis.Date` è una sottoclasse di quella originale in cui `new Date()` senza argomenti e `Date.now()` valgono `istante + (tempo reale trascorso dall'ingresso)`; con argomenti si comporta come l'originale; `instanceof Date` resta vero per date create dentro e fuori. Ripristino in `finally`. Chiamata annidata → `Error('orologio simulato già attivo')`.

- [ ] **Step 1: test che falliscono.**

```ts
it('dentro: new Date() e Date.now() partono dall istante simulato', async () => {
  const t = new Date('2026-02-03T09:00:00Z')
  await eseguiAllIstante(t, async () => {
    expect(Math.abs(new Date().getTime() - t.getTime())).toBeLessThan(1000)
    expect(Math.abs(Date.now() - t.getTime())).toBeLessThan(1000)
  })
})
it('il tempo scorre dentro la finestra (ordine delle scritture preservato)', ...)  // due new Date() separate da 5 ms: la seconda > la prima
it('con argomenti si comporta come Date originale', ...)  // new Date(0).toISOString() === '1970-01-01T00:00:00.000Z'; Date.UTC invariato
it('instanceof Date vale per date create dentro e fuori', ...)
it('ripristina l orologio reale anche se fn lancia', ...)  // dopo rejects: |Date.now() - realeAtteso| < 1000 e orologioSimulatoAttivo() === false
it('chiamata annidata: errore', ...)
```

- [ ] **Step 2:** Run `npx jest src/demo/orologio-simulato` — Expected: FAIL.
- [ ] **Step 3: implementare `eseguiAllIstante` e `orologioSimulatoAttivo`.**
- [ ] **Step 4:** stesso comando — Expected: PASS.
- [ ] **Step 5: commit.** `feat(demo): orologio simulato per generare lo storico con i use case`

### Task 3: Catalogo aziende e piano delle attività

**Files:**
- Create: `apps/backend/src/demo/aziende-demo.ts`, `apps/backend/src/demo/piano-attivita.ts`
- Test: `apps/backend/src/demo/piano-attivita.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`partitaIvaDemo`, `codiceFiscaleDemo`, `numIscrSitoDemo`, `indirizzoDemo`, `SUFFISSO_RAGIONE_SOCIALE_DEMO`); `SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO`, `calcolaScostamentoPeso` (`domain/fir/scostamento-peso.ts`); `giornoItaliano` (`core/time/anno-italiano.ts`).
- Produces (`aziende-demo.ts`):
  - `type ChiaveAzienda = 'studio' | 'officine' | 'falegnameria' | 'edilizia' | 'trasporti' | 'recuperi'`; `type ChiaveAnagrafica = ChiaveAzienda | 'smaltimenti'`.
  - `interface AziendaDemo { chiave: ChiaveAzienda; ruolo: 'STUDIO' | 'PRODUTTORE' | 'TRASPORTATORE' | 'IMPIANTO'; ragioneSociale: string; partitaIva: string; pec: string; indirizzo: string; civico: string; cap: string; comune: string; provincia: string; ateco: string; rentri: { numIscrSito: string } | null }`
  - `AZIENDE_DEMO: readonly AziendaDemo[]` — sei voci, progressivi IVA 1..6 nell'ordine della chiave; `rentri` solo per `officine` (numIscrSito 1) e `recuperi` (numIscrSito 2). Comuni reali (Brescia BS, Bergamo BG, Lodi LO, Cremona CR, Milano MI), vie fittizie ("Via della Prova").
  - `ANAGRAFICA_SMALTIMENTI` (progressivo IVA 7, `Smaltimenti (demo) Srl`, operazione D15).
  - `interface UtenteDemo { username: UsernameDemo; nome: string; cognome: string; codiceFiscale: string; email: string; azienda: ChiaveAzienda; ruolo: 'ADMIN' | 'OPERATOR' | 'VIEWER'; variabilePassword: 'DEMO_PASSWORD_CONSULENTE' | 'DEMO_PASSWORD_TITOLARE' | 'DEMO_PASSWORD_PIAZZALE' }`; `UTENTI_DEMO`: consulente (studio, ADMIN, CF 1), titolare (officine, VIEWER, CF 2), piazzale (recuperi, OPERATOR, CF 3). L'associazione `CONSULTANT` del consulente verso le cinque aziende la crea il Task 10.
  - `CER_PER_AZIENDA: Record<'officine' | 'falegnameria' | 'edilizia', { cer: string; descrizione: string; destinatario: 'recuperi' | 'smaltimenti'; codiceOperazione: string; kgSettimanaliMedi: number }[]>` — officine: `12 01 01`→recuperi R4, `13 02 05*`→smaltimenti D15, `15 01 01`→recuperi R3; falegnameria: `03 01 05`→recuperi R3, `15 01 03`→recuperi R3, `08 01 11*`→smaltimenti D15; edilizia: `17 09 04`→recuperi R5, `17 04 05`→recuperi R4, `17 06 03*`→smaltimenti D15.
- Produces (`piano-attivita.ts`):

```ts
export type ScenarioDemo =
  | 'SCARICO_MANCANTE_SCADUTO' | 'SCARICO_MANCANTE_IN_SCADENZA'
  | 'RISCONTRO_MANCANTE_SCADUTO' | 'RISCONTRO_MANCANTE_IN_PREAVVISO'
  | 'SCOSTAMENTO_OLTRE_SOGLIA' | 'SCOSTAMENTO_ENTRO_SOGLIA'
  | 'CARICO_IMPIANTO_MANCANTE' | 'FIR_LOCALE_IN_ARRIVO' | 'FIR_RENTRI_IN_ARRIVO'
  | 'MUD_BOZZA' | 'AUTORIZZAZIONE_IN_SCADENZA' | 'ISCRIZIONE_ALBO_IN_SCADENZA' | 'CERTIFICATO_IN_SCADENZA'

export interface FirPiano {
  rif: string                          // es. 'officine-2026-03-02', univoco nel piano
  azienda: ChiaveAzienda               // tenant in cui vive il FIR
  produttore: ChiaveAnagrafica; trasportatore: 'trasporti'; destinatario: ChiaveAnagrafica
  cer: string; kgDichiarati: number; codiceOperazione: string
  creazione: Date                      // creazione + emissione
  presaInCarico: Date | null
  consegna: { istante: Date; kgEffettivi: number } | null
  scaricoProduttore: Date | null       // SCARICO 'CONFERIMENTO_TRASPORTATORE' con firId, nel tenant del produttore
  caricoImpianto: Date | null          // CARICO 'INGRESSO_ESTERNO' col peso verificato, solo per FIR che vivono in 'recuperi'
  rentri: boolean                      // true solo nella fase presente (orologio reale)
}
export type EventoStorico =
  | { tipo: 'CARICO_PRODUZIONE'; azienda: ChiaveAzienda; istante: Date; cer: string; kg: number }
  | { tipo: 'FIR'; fir: FirPiano }
export interface PianoDemo {
  oggi: Date; inizio: Date
  storico: EventoStorico[]             // ordinato per istante; eseguito a orologio simulato
  presente: FirPiano[]                 // FIR in arrivo all'impianto, a orologio reale
  scadenze: { autorizzazioneSmaltimenti: Date; iscrizioneAlboTrasporti: Date; giorniValiditaCertificatoOfficine: number }
  annoMudBozza: number                 // anno(oggi) - 1
  scenari: Record<ScenarioDemo, string[]>  // rif dei FIR (o chiave simbolica) che realizzano ciascuno scenario
}
export function pianificaDemo(oggi: Date, seme?: number): PianoDemo   // seme default 20261028
```

Regole che il piano fissa (i test le verificano):
- `inizio = min(oggi − 9 mesi di calendario, 1 ottobre dell'anno precedente)` (D5); nessun istante dello storico prima di `inizio` né dopo `oggi`.
- Ogni produttore: un `CARICO_PRODUZIONE` per CER a settimana (giorno lavorativo, ore 10:00 Europe/Rome), quantità attorno a `kgSettimanaliMedi` (±30%, PRNG deterministico dal seme, per esempio mulberry32); un FIR per CER ogni 3-5 settimane con `kgDichiarati` ≤ giacenza accumulata per quel CER; presa in carico 1 giorno lavorativo dopo la creazione, consegna 1-2 giorni dopo, scarico del produttore 2-4 giorni dopo la presa in carico. Peso effettivo tra −4% e +4% del dichiarato, tranne gli scenari di scostamento.
- Scenari con margini indipendenti dalle festività: `SCARICO_MANCANTE_SCADUTO` = FIR (officine e falegnameria) con presa in carico a `oggi − 28 giorni` e `scaricoProduttore: null`; `SCARICO_MANCANTE_IN_SCADENZA` = presa in carico a `oggi − 5 giorni`, senza scarico; `RISCONTRO_MANCANTE_SCADUTO` = presa in carico a `oggi − 3 mesi − 10 giorni`, `consegna: null`, scarico presente; `RISCONTRO_MANCANTE_IN_PREAVVISO` = presa in carico a `oggi − 3 mesi + 15 giorni`, `consegna: null`, scarico presente; `SCOSTAMENTO_OLTRE_SOGLIA` = due FIR consegnati con peso effettivo −2×soglia e +1,5×soglia; `SCOSTAMENTO_ENTRO_SOGLIA` = uno a −soglia/2; `CARICO_IMPIANTO_MANCANTE` = un FIR che vive in `recuperi` (produttore `falegnameria`, destinatario `recuperi`) consegnato a `oggi − 20 giorni` con `caricoImpianto: null`; `FIR_LOCALE_IN_ARRIVO` = due FIR di `presente` in `recuperi`, `rentri: false`, presa in carico e nessuna consegna; `FIR_RENTRI_IN_ARRIVO` = tre FIR di `presente` in `officine` verso `recuperi`, `rentri: true`, presa in carico e nessuna consegna; `MUD_BOZZA` = `['officine']`; `AUTORIZZAZIONE_IN_SCADENZA` = `oggi + 20 giorni`; `ISCRIZIONE_ALBO_IN_SCADENZA` = `oggi + 25 giorni`; `CERTIFICATO_IN_SCADENZA` = 25 giorni di validità.
- Tutti gli altri FIR storici sono consegnati e hanno lo scarico; quelli che vivono in `recuperi` hanno `caricoImpianto` il giorno della consegna con `kgEffettivi`.

- [ ] **Step 1: test che falliscono** (`OGGI = new Date('2026-10-28T09:00:00Z')`).

```ts
it('copre ogni scenario almeno una volta', () => {
  const p = pianificaDemo(OGGI)
  for (const s of TUTTI_GLI_SCENARI) expect(p.scenari[s].length).toBeGreaterThan(0)
})
it('finestra: inizio 2025-10-01 al 28/10/2026, 2026-06-01 al 01/03/2027', ...)
it('nessun evento fuori da [inizio, oggi]', ...)
it('storico ordinato per istante', ...)
it('giacenza per azienda e CER mai negativa (carichi produzione − kg dichiarati dei FIR con scarico)', ...)
it('deterministico: stesso oggi e seme → JSON identico; seme diverso → diverso', ...)
it('scostamenti: calcolaScostamentoPeso supera la soglia per OLTRE e non per ENTRO', ...)
it.each(['2027-01-07T09:00:00Z', '2026-08-18T09:00:00Z', '2026-12-27T09:00:00Z'])(
  'con oggi=%s i margini degli scenari reggono', iso => {
    const oggi = new Date(iso); const p = pianificaDemo(oggi); const fir = trovaFir(p)
    for (const r of p.scenari.SCARICO_MANCANTE_SCADUTO) expect(giorni(oggi, fir(r).presaInCarico!)).toBeGreaterThanOrEqual(28)
    for (const r of p.scenari.RISCONTRO_MANCANTE_SCADUTO) expect(fir(r).presaInCarico! < menoMesi(oggi, 3)).toBe(true)
    for (const r of p.scenari.RISCONTRO_MANCANTE_IN_PREAVVISO) expect(fir(r).presaInCarico! > menoMesi(oggi, 3)).toBe(true)
  })
it('i FIR del presente sono tutti verso recuperi, presi in carico e non consegnati', ...)
it('AZIENDE_DEMO: P.IVA distinte, PEC demo, ragione sociale con suffisso (demo)', ...)
```

- [ ] **Step 2:** Run `npx jest src/demo/piano-attivita` — Expected: FAIL.
- [ ] **Step 3: implementare `aziende-demo.ts` e `pianificaDemo`.**
- [ ] **Step 4:** stesso comando — Expected: PASS.
- [ ] **Step 5: commit.** `feat(demo): catalogo delle aziende demo e piano delle attivita`

### Task 4: Fake RENTRI, modalità dimostrativa

**Files:**
- Create: `tools/rentri-fake/src/dimostrativa.ts`, `tools/rentri-fake/test/dimostrativa.test.ts`
- Modify: `tools/rentri-fake/src/app.ts` (`creaApp(opzioni?: OpzioniApp)`), `src/server.ts` (legge le variabili d'ambiente), `src/routes/controllo.ts`, `src/routes/formulari.ts` (ricerca), `src/stato/archivio.ts` (gancio dopo `creaTransazione`, dati completi del formulario), `src/auth/soggetti-accreditati.ts` (nessuna modifica se `accreditaSoggetto` basta)

**Interfaces:**
- Produces:
  - `interface OpzioniApp { dimostrativa?: { completamentoMs: number } }`; `creaApp()` senza opzioni = comportamento attuale, byte per byte (le suite esistenti non cambiano).
  - `server.ts`: `RENTRI_FAKE_DIMOSTRATIVA=1` attiva la modalità, `RENTRI_FAKE_COMPLETAMENTO_MS` (default `1500`).
  - `POST /__controllo/certificato` body `{ commonName: string; giorniValidita: number }` → `{ certificatoPem: string; chiavePrivataPem: string }`: certificato firmato dalla CA di processo (`emettiCertificatoAccreditato`, esteso con la validità in giorni), e `commonName` accreditato come soggetto. Registrata **solo** in modalità dimostrativa (404 altrimenti).
  - In modalità dimostrativa, ogni transazione creata da `POST /formulari/v1.0/` (creazione), `…/accettazione` e `…/acquisizione-firma` si completa da sola dopo `completamentoMs` con esito positivo: per la creazione un `numero_fir` nuovo che rispetta `PATTERN_NUMERO_FIR` (es. `DMFR` + progressivo + `DM`), e il formulario salvato conserva **l'intero corpo della creazione**, così che il dettaglio letto da `RENTRIApiClient.leggiFormulario` contenga produttore, trasportatori, destinatario, rifiuto e quantità; lo stato iniziale è quello in cui il contratto ammette l'`Accettazione` da parte del destinatario (l'implementatore lo ricava da `dominio/operazione.ts`, `STATI_ACCETTAZIONE`). Le altre transazioni restano manuali.
  - In modalità dimostrativa, `GET /formulari/v1.0/?identificativo_soggetto=X` trova i formulari in cui X è produttore, destinatario o uno dei trasportatori in `dati_partenza`.

- [ ] **Step 1: test che falliscono** (`tools/rentri-fake/test/dimostrativa.test.ts`, stesso stile delle suite vicine, aiuti in `test/aiuti`).

```ts
it('senza modalita dimostrativa /__controllo/certificato risponde 404', ...)
it('emette un certificato accreditato: un JWT firmato con quella chiave passa verificaJwt', ...)
it('giorniValidita: notAfter tra giorniValidita-1 e giorniValidita+1 giorni', ...)
it('la creazione si completa da sola: status completata e numero_fir valido entro completamentoMs + 500 ms', ...)
it('il formulario creato e ricercabile dal codice fiscale del destinatario e del trasportatore', ...)
it('il dettaglio GET /{numero_fir} contiene rifiuto, quantita e destinatario della richiesta', ...)
it('accettazione su quel formulario: transazione completata da sola, stato FirmaAccettazione', ...)
it('senza modalita dimostrativa la creazione resta in_elaborazione (regressione)', ...)
```

- [ ] **Step 2:** Run `cd tools/rentri-fake && npx jest test/dimostrativa.test.ts` — Expected: FAIL.
- [ ] **Step 3: implementare** `src/dimostrativa.ts` (registrazione della rotta di controllo e del completamento automatico, chiamata da `creaApp` solo con l'opzione) e i ganci minimi in `archivio.ts` e `formulari.ts`.
- [ ] **Step 4:** Run `npx jest` (suite intera della fake) — Expected: PASS, nessuna suite esistente modificata.
- [ ] **Step 5: commit.** `feat(rentri-fake): modalita dimostrativa con completamento automatico e certificati`

### Task 5: Indirizzo RENTRI per tenant

**Files:**
- Create: `apps/backend/src/infrastructure/rentri/rentri-ambiente.ts`, `rentri-endpoint.resolver.ts`
- Modify: `rentri-config.ts`, `rentri-credential.service.ts`, `rentri-signature.service.ts`, `rentri.module.ts`, i nove client (elenco nella tabella "File toccati")
- Test: `rentri-endpoint.resolver.spec.ts`, `rentri-endpoint.guardia.spec.ts`, `rentri-config.spec.ts` (estendere), `rentri.module.spec.ts` (estendere)

**Interfaces:**
- Produces:
  - `rentri-ambiente.ts`: `AMBIENTE_RENTRI_DIMOSTRATIVO = 'fake'`; `class AmbienteDimostrativoNonConfiguratoError extends Error` (messaggio: "Azienda demo collegata al simulatore RENTRI, ma RENTRI_FAKE_API_URL non è impostata: nessuna chiamata parte.").
  - `RentriConfig.fakeBaseUrl?: string` da `RENTRI_FAKE_API_URL` (trim, senza `/` finale, `undefined` se vuota).
  - `RentriCredentialService.getAmbiente(tenantId: string): Promise<string | null>` — legge solo `environment` (come `getCredentialsIdFirmaRemota`, senza decifrare la chiave).
  - `interface EndpointRentri { baseUrl: string; signatureAudience: string; dimostrativo: boolean }`
  - `@Injectable() class RentriEndpointResolver { constructor(credenziali: RentriCredentialService, @Inject(RENTRI_CONFIG) config: RentriConfig); perTenant(tenantId: string | undefined): Promise<EndpointRentri> }`
  - Helper esportato `baseUrlPer(endpoint: RentriEndpointResolver | undefined, config: RentriConfig, tenantId: string | undefined): Promise<string>`: senza resolver → `config.baseUrl`.
- Regole: `tenantId` assente → globale; `getAmbiente` null o diverso da `fake` → `{ baseUrl: config.baseUrl, signatureAudience: config.signatureAudience, dimostrativo: false }`; `fake` con `fakeBaseUrl` → `{ fakeBaseUrl, fakeBaseUrl, true }`; `fake` senza → `AmbienteDimostrativoNonConfiguratoError`. Nessuna cache (una lettura di una colonna per chiamata; il rate limiter per tenant già limita il volume).
- Nei client il resolver è l'**ultimo** parametro del costruttore, `@Optional()`, così le spec esistenti che costruiscono i client a mano restano invariate; ogni `` `${this.config.baseUrl}…` `` diventa `` `${await baseUrlPer(this.endpoint, this.config, tenantEffettivo)}…` `` con lo stesso tenant già usato per `creaAuthorizationHeader`. `RentriSignatureService` usa `signatureAudience` dell'endpoint del tenant; `RentriAuthService` (`aud`) resta su `config.audience`.

- [ ] **Step 1: test che falliscono.**

```ts
// rentri-endpoint.resolver.spec.ts — credenziali e config finti
it('senza tenant: indirizzo globale', ...)
it('tenant senza credenziale: indirizzo e signatureAudience globali, dimostrativo false', ...)
it.each(['demo', 'live'])('tenant con ambiente %s: globale anche se RENTRI_FAKE_API_URL e impostata', ...)
it('tenant fake con RENTRI_FAKE_API_URL: baseUrl e signatureAudience della fake, dimostrativo true', ...)
it('tenant fake senza RENTRI_FAKE_API_URL: AmbienteDimostrativoNonConfiguratoError, mai l indirizzo globale', ...)
// rentri-endpoint.guardia.spec.ts — legge i sorgenti non-spec di infrastructure/rentri/**
it('nessun client concatena config.baseUrl: solo rentri-config.ts e rentri-endpoint.resolver.ts lo leggono', ...)
// rentri-config.spec.ts
it('RENTRI_FAKE_API_URL: trim e slash finale tolto; vuota → undefined', ...)
// rentri.module.spec.ts
it('RentriEndpointResolver e iniettato in RENTRIApiClient e RentriTrasmissioniClient', ...)
```

- [ ] **Step 2:** Run `npx jest src/infrastructure/rentri` — Expected: FAIL sui test nuovi.
- [ ] **Step 3: implementare** resolver, config, `getAmbiente`, registrazione nel modulo, sostituzione nei client e nella signature.
- [ ] **Step 4:** Run `npx jest src/infrastructure/rentri src/application/rentri` — Expected: PASS, nessuna spec esistente modificata.
- [ ] **Step 5: non regressione contro l'oracolo.** Run `npm run test:oracolo` (fake installata, Redis di test come in `deploy.yml`) — Expected: PASS invariato.
- [ ] **Step 6: commit.** `feat(rentri): indirizzo RENTRI per tenant, il simulatore solo per le credenziali dimostrative`

### Task 6: Ambiente dimostrativo dichiarato (API e pagine RENTRI)

**Files:**
- Modify: `apps/backend/src/api/rentri/dto/set-rentri-credential.dto.ts`, `apps/backend/src/api/rentri/rentri-credential.controller.ts` (anche la classe DTO PKCS#12 a riga ~61)
- Modify: `apps/frontend/src/app/features/rentri/rentri-credential.service.ts`, `rentri-credential.component.ts`, `rentri-formulari.component.ts`, `rentri-modalita-legame.component.ts`
- Create: `apps/frontend/src/app/features/rentri/rentri-ambiente-dimostrativo.component.ts`
- Test: `rentri-credential.controller.spec.ts` (estendere), `rentri-ambiente-dimostrativo.component.spec.ts`

**Interfaces:**
- Consumes: `AMBIENTE_RENTRI_DIMOSTRATIVO` (Task 5).
- Produces: `GET /rentri/credential` aggiunge `ambienteDimostrativo: boolean`; `PUT` con `environment: 'fake'` → 400 (`@NotEquals(AMBIENTE_RENTRI_DIMOSTRATIVO)`, messaggio "Ambiente riservato all'azienda dimostrativa"). Frontend: `RentriCredentialStatus.ambienteDimostrativo?: boolean`; componente standalone `app-rentri-ambiente-dimostrativo` (nessun input) che legge lo stato e, se vero, mostra un `p-message` severity `warn` con il testo esatto: **"Ambiente dimostrativo: questa azienda è collegata a un simulatore RENTRI interno. Nessun dato arriva all'ente e i numeri dei formulari non hanno valore legale."**; nella pagina del certificato, con `ambienteDimostrativo` il blocco "Sostituisci certificato" è nascosto.

- [ ] **Step 1: test che falliscono.**

```ts
// controller spec
it('GET: ambienteDimostrativo true per environment fake, false per demo', ...)
it('PUT con environment fake: 400 e upsertForTenant non chiamato', ...)
it('PUT con environment demo: invariato', ...)
// banner spec (TestBed, servizio finto)
it('ambienteDimostrativo true: mostra il testo dell ambiente dimostrativo', ...)
it('ambienteDimostrativo false o assente: nessun messaggio', ...)
it('errore nella lettura dello stato: nessun messaggio, nessuna eccezione', ...)
```

- [ ] **Step 2:** Run `cd apps/backend && npx jest src/api/rentri/rentri-credential` — Expected: FAIL. Frontend: `cd apps/frontend && npx ng test --watch=false --include='**/rentri-ambiente-dimostrativo.component.spec.ts'` — Expected: FAIL (richiede un browser locale; il gate CI non esegue i test frontend).
- [ ] **Step 3: implementare** DTO, controller, servizio, componente, inserimento in testa alle tre pagine.
- [ ] **Step 4:** stessi comandi — Expected: PASS. Più `cd apps/frontend && npx ng build` — Expected: build riuscita.
- [ ] **Step 5: commit.** `feat(rentri): le pagine RENTRI dichiarano l'ambiente dimostrativo`

### Task 7: Ciclo RENTRI dimostrativo contro la fake (oracolo)

**Files:**
- Create: `apps/backend/src/infrastructure/rentri/ciclo-dimostrativo.oracolo.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`creaApp({ dimostrativa: { completamentoMs: 50 } })`, `/__controllo/certificato`), Task 5 (`RentriEndpointResolver` con una credenziale finta `environment: 'fake'` e `fakeBaseUrl` = indirizzo della fake in ascolto su porta 0). Costruzione dei client e dei payload come nelle spec oracolo vicine (`rentri-trasmissioni.oracolo.spec.ts`, aiuti di `tools/rentri-fake/test/aiuti`).

- [ ] **Step 1: test** (deve fallire solo se Task 4 o 5 mancano: è il collaudo del loro incastro).

```ts
it('produttore crea il formulario: esito positivo senza intervento sul canale di controllo, numero_fir valido', ...)
it('impianto cerca per il proprio codice fiscale e trova il formulario', ...)
it('impianto legge il dettaglio: CER, quantita e P.IVA del destinatario coincidono con la richiesta', ...)
it('impianto registra l accettazione A con quantita: transazione completata, stato FirmaAccettazione', ...)
it('una credenziale demo (non fake) nello stesso processo chiama l indirizzo globale, non la fake', ...)  // HttpService spiato: nessuna richiesta verso la porta della fake
```

- [ ] **Step 2:** Run `cd apps/backend && npx jest -c jest.oracolo.config.js ciclo-dimostrativo` — Expected: PASS (con Task 4 e 5 fatti). Se un passo fallisce per una lacuna della fake, si corregge nel Task 4 (stesso branch) e si annota nel commit.
- [ ] **Step 3: commit.** `test(rentri): ciclo dimostrativo produttore-impianto contro la fake`

### Task 8: Utenti demo in Keycloak e guardia email

**Files:**
- Modify: `apps/backend/src/infrastructure/keycloak/keycloak-user.adapter.ts`, `apps/backend/src/infrastructure/email/email.service.ts`
- Create: `apps/backend/src/demo/utenti-demo-keycloak.ts`
- Test: `apps/backend/src/infrastructure/keycloak/keycloak-user.adapter.spec.ts` (nuovo), `apps/backend/src/infrastructure/email/email.service.spec.ts` (nuovo), `apps/backend/src/demo/utenti-demo-keycloak.spec.ts`

**Interfaces:**
- Produces:
  - `KeycloakUserAdapter.findUserByUsername(username: string): Promise<{ id: string; username: string; email: string | null } | null>` — `GET /admin/realms/{realm}/users?username=…&exact=true`.
  - `KeycloakUserAdapter.createUser(params)` accetta `username?: string` (default `fiscalCode`, comportamento attuale invariato).
  - `EmailService.sendEmail`: destinatario con dominio che termina in `.invalid` → nessun invio, log `info` "Email non inviata: indirizzo dimostrativo", nessuna eccezione.
  - `class UtentiDemoKeycloak { constructor(adapter: KeycloakUserAdapter); verificaRimovibili(): Promise<void>; rimuoviUtentiDemo(): Promise<UsernameDemo[]>; creaUtenteDemo(u: UtenteDemo, password: string): Promise<string /* keycloakId */> }` e `class UtenteKeycloakNonDemoError extends Error` (con lo username).
- Regole: `verificaRimovibili` cerca i tre username; se uno esiste senza il marcatore (`eUtenteKeycloakDemo` falso) lancia `UtenteKeycloakNonDemoError`. `rimuoviUtentiDemo` chiama prima `verificaRimovibili` e poi cancella quelli marcati. `creaUtenteDemo` crea con `username`, email demo, `firstName`/`lastName`, attributo `fiscalCode`, `emailVerified: true`, `requiredActions: []`, poi `setPassword(id, password, false)`; password < 10 caratteri → errore prima di chiamare Keycloak; se `setPassword` fallisce cancella l'utente appena creato e rilancia.

- [ ] **Step 1: test che falliscono** (HttpService finto con `of({ data, headers })`).

```ts
// adapter
it('findUserByUsername: exact=true, mappa id/username/email; lista vuota → null', ...)
it('createUser con username: lo usa al posto del codice fiscale', ...)
it('createUser senza username: username = codice fiscale (invariato)', ...)
// email
it('dominio .invalid: transporter.sendMail non chiamato', ...)
it('dominio reale: invio invariato', ...)
// utenti-demo-keycloak
it('rimuove solo gli utenti con username e email demo', ...)
it('demo-titolare con email reale: UtenteKeycloakNonDemoError e nessuna deleteUser chiamata', ...)
it('nessun utente presente: nessuna cancellazione, nessun errore', ...)
it('creaUtenteDemo: password non temporanea, attributo fiscalCode, username demo', ...)
it('password corta: errore senza chiamare createUser', ...)
it('setPassword fallisce: deleteUser sull id appena creato e rilancio', ...)
```

- [ ] **Step 2:** Run `npx jest src/infrastructure/keycloak src/infrastructure/email src/demo/utenti-demo-keycloak` — Expected: FAIL.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** stesso comando — Expected: PASS.
- [ ] **Step 5: commit.** `feat(demo): utenti Keycloak demo riconosciuti dal marcatore, nessuna email verso indirizzi .invalid`

### Task 9: Pulizia del tenant demo

**Files:**
- Create: `apps/backend/src/demo/pulizia-demo.ts`
- Test: `apps/backend/src/demo/pulizia-demo.postgres.spec.ts`

**Interfaces:**
- Consumes: `eIndirizzoDemo`, `DOMINIO_DEMO` (Task 1), `AMBIENTE_RENTRI_DIMOSTRATIVO` (Task 5).
- Produces: `class PuliziaDemo { constructor(proprietario: PrismaClient); trovaTenantDemo(): Promise<string[]>; verifica(): Promise<string[] /* id dei tenant demo */>; cancella(): Promise<RiepilogoPulizia> }`, `interface RiepilogoPulizia { tenant: number; righePerTabella: Record<string, number> }`, `class PuliziaRifiutataError extends Error`.
- Regole di `verifica` (rifiuto senza toccare nulla): più di 10 tenant marcati; un utente di un tenant marcato con email non demo; una `rentri_credentials` di un tenant marcato con `environment` diverso da `fake`; un'associazione consulente che lega un utente di un tenant marcato a un tenant **non** marcato.
- Algoritmo di `cancella` (una sola transazione interattiva, client proprietario che ignora la RLS): `verifica()`; elenco da `information_schema.columns` delle tabelle di `public` con colonna `tenant_id` (esclusa `tenants`) e da `pg_constraint` delle chiavi esterne; poi fino a 10 passate: per ogni tabella con `tenant_id`, `DELETE … WHERE tenant_id = ANY($ids)`; per ogni tabella **senza** `tenant_id` che referenzia una tabella con `tenant_id`, `DELETE … WHERE <fk> IN (SELECT <pk> FROM <padre> WHERE tenant_id = ANY($ids))`; ogni istruzione dentro un `SAVEPOINT` (violazione di chiave esterna → `ROLLBACK TO SAVEPOINT`, si ritenta alla passata dopo); si ferma quando una passata non cancella nulla e non fallisce nulla. Poi `consultant_tenant_associations` con `consultant_user_id` fra gli utenti demo, poi `DELETE FROM tenants WHERE id = ANY($ids)`. Se dopo 10 passate resta un errore → `PuliziaRifiutataError` con le tabelle, e la transazione si annulla.

- [ ] **Step 1: test** contro Postgres reale (modello `application/registro/giacenze-iniziali.postgres.spec.ts`: client proprietario, pulizia finale delle sole righe create).

```ts
it('cancella ogni riga dei tenant demo in ogni tabella con tenant_id e lascia intatto il tenant di controllo', async () => {
  // semina: tenant di controllo + 2 tenant con PEC demo; per ciascuno users, roles, firs, registri_rifiuti + waste_movements,
  // consultant_tenant_associations, rentri_credentials (fake per i demo), mud_reports, activity_logs (con user_id e fir_id)
  // conteggi del controllo prima; cancella(); per ogni tabella con tenant_id: count(tenant_id IN demo) === 0; conteggi del controllo invariati
})
it('seconda esecuzione: riepilogo con 0 tenant, nessun errore (idempotente)', ...)
it('utente con email reale in un tenant demo: PuliziaRifiutataError e nessuna riga cancellata', ...)
it('credenziale RENTRI live in un tenant demo: PuliziaRifiutataError', ...)
it('undici tenant marcati: PuliziaRifiutataError', ...)
```

- [ ] **Step 2:** Run `cd apps/backend && npm run test:postgres -- pulizia-demo` (Postgres locale su 55432 come le altre spec postgres) — Expected: FAIL.
- [ ] **Step 3: implementare `PuliziaDemo`.**
- [ ] **Step 4:** stesso comando — Expected: PASS.
- [ ] **Step 5: commit.** `feat(demo): pulizia dei soli tenant demo, rifiutata davanti a dati non demo`

### Task 10: Preparazione di aziende, utenti e anagrafiche

**Files:**
- Create: `apps/backend/src/demo/preparazione-aziende.ts`
- Test: `apps/backend/src/demo/preparazione-aziende.spec.ts`

**Interfaces:**
- Consumes: `AZIENDE_DEMO`, `UTENTI_DEMO`, `ANAGRAFICA_SMALTIMENTI`, `PianoDemo.scadenze` (Task 3); `UtentiDemoKeycloak` (Task 8); `TenantService.create` (`application/admin/tenant.service.ts`); `seedRolesForTenant` (`application/admin/system-roles.ts`); `ConsultantTenantAssociation.create` + repository (`domain/identity-access/…`); `CreateProduttoreUseCase`, `CreateTrasportatoreUseCase`, `CreateDestinatarioUseCase` (`application/registry/use-cases`); `RegistriService.preparaRegistri` (`application/registro/registri.service.ts`); `TenantContext.run`.
- Produces:

```ts
export interface ContestoDemo {
  tenant: Record<ChiaveAzienda, string>                      // id dei tenant
  utente: Record<ChiaveAzienda, string>                      // id dell'utente che opera in quell'azienda (consulente o utente locale)
  anagrafiche: Record<ChiaveAzienda, Record<ChiaveAnagrafica, { produttoreId?: string; trasportatoreId?: string; destinatarioId?: string }>>
  keycloakId: Record<UsernameDemo, string>
}
export class PreparazioneAziende {
  constructor(deps: { tenantService: TenantService; utentiKeycloak: UtentiDemoKeycloak | null; prisma: PrismaService; sistema: PrismaClient; associazioni: ConsultantTenantAssociationRepository; creaProduttore: CreateProduttoreUseCase; creaTrasportatore: CreateTrasportatoreUseCase; creaDestinatario: CreateDestinatarioUseCase; registri: RegistriService })
  esegui(piano: PianoDemo, password: Record<UsernameDemo, string>): Promise<ContestoDemo>
}
```

- Ordine: (1) attore per lo Studio = primo utente `SUPER_ADMIN` (`sistema.user.findFirst({ where: { role: 'SUPER_ADMIN' } })`), assente → errore (D7); (2) `TenantService.create` dello Studio come SUPER_ADMIN con `subscriptionTier: 'ENTERPRISE'`, `subscriptionStatus: 'ACTIVE'`, `firLimitPerMonth: 0`, `userLimitTotal: 0`, PEC e anagrafica da `AZIENDE_DEMO`, `codiceFiscale` = P.IVA; (3) utente `demo-consulente` (Keycloak, poi riga `users` ADMIN nello Studio con `keycloakId`, CF, email demo); con `utentiKeycloak === null` (esecuzione locale) `keycloakId = 'locale-' + username`; (4) le cinque aziende con attore `demo-consulente`, stessa configurazione; (5) associazione `CONSULTANT` del consulente verso ciascuna (ruolo `CONSULTANT` del tenant, `addedBy` = consulente); (6) `demo-titolare` VIEWER in `officine`, `demo-piazzale` OPERATOR in `recuperi`; (7) in ogni azienda, dentro il suo `TenantContext`: anagrafica Produttore di sé stessa (per i produttori; per `recuperi` quelle di `falegnameria` e di sé stessa come destinatario), Trasportatore `trasporti` con `scadenzaIscrizione` = `piano.scadenze.iscrizioneAlboTrasporti` solo in `falegnameria` e una data a +2 anni altrove, Destinatari `recuperi` e `smaltimenti` con `scadenzaAutorizzazione` = `piano.scadenze.autorizzazioneSmaltimenti` per `smaltimenti` in `officine` e +2 anni altrove; (8) `preparaRegistri` per ogni azienda. Un `Result` non ok di un use case → errore con azienda e anagrafica.
- `ContestoDemo.utente[chiave]` = consulente per le cinque aziende (opera tramite associazione), ADMIN dello Studio per lo Studio.

- [ ] **Step 1: test che falliscono** (dipendenze finte che registrano le chiamate).

```ts
it('crea lo Studio con l attore SUPER_ADMIN e le altre aziende con l attore demo-consulente', ...)
it('nessun SUPER_ADMIN: errore prima di creare qualunque tenant', ...)
it('ogni tenant: ENTERPRISE, ACTIVE, PEC demo, ragione sociale con (demo), codiceFiscale = P.IVA', ...)
it('associazione CONSULTANT del consulente verso le cinque aziende, non verso lo Studio', ...)
it('demo-titolare VIEWER in officine, demo-piazzale OPERATOR in recuperi', ...)
it('le anagrafiche sono create dentro il TenantContext della loro azienda', ...)
it('scadenze: autorizzazione di smaltimenti in officine e iscrizione Albo in falegnameria dalle date del piano', ...)
it('senza Keycloak (esecuzione locale): keycloakId locale-<username>, nessuna chiamata Keycloak', ...)
it('Result non ok di CreateProduttoreUseCase: errore con azienda e P.IVA', ...)
```

- [ ] **Step 2:** Run `npx jest src/demo/preparazione-aziende` — Expected: FAIL.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** stesso comando — Expected: PASS.
- [ ] **Step 5: commit.** `feat(demo): aziende, utenti e anagrafiche della demo dai servizi del dominio`

### Task 11: Esecutore dello storico

**Files:**
- Create: `apps/backend/src/demo/esecutore-storico.ts`
- Test: `apps/backend/src/demo/esecutore-storico.spec.ts`

**Interfaces:**
- Consumes: `PianoDemo`, `EventoStorico`, `FirPiano` (Task 3); `eseguiAllIstante` (Task 2); `ContestoDemo` (Task 10); `CreateFIRUseCase` + `CreateFIRCommand`, `EmettiFIRUseCase`, `PresaInCaricoFIRUseCase`, `ConfermaConsegnaFIRUseCase` (`application/fir/use-cases`), `RegistraMovimentoUseCase` + `RegistraMovimentoCommand` (`application/registro`), `MudIntegrazioniService.salva`.
- Produces:

```ts
export interface IstantiCreazione { fir: Map<string, Date>; movimenti: Map<string, Date> }   // id → istante simulato
export class EsecutoreStorico {
  constructor(deps: { creaFir: CreateFIRUseCase; emetti: EmettiFIRUseCase; presaInCarico: PresaInCaricoFIRUseCase; confermaConsegna: ConfermaConsegnaFIRUseCase; registraMovimento: RegistraMovimentoUseCase; integrazioniMud: MudIntegrazioniService; proprietario: PrismaClient })
  eseguiStorico(piano: PianoDemo, ctx: ContestoDemo): Promise<IstantiCreazione>
  // FIR in arrivo, a orologio reale: crea ed emette, attende `dopoEmissione` (la trasmissione RENTRI), poi presa in carico
  eseguiFirPresente(fir: FirPiano, ctx: ContestoDemo, dopoEmissione?: (firId: string) => Promise<void>): Promise<string /* firId */>
  creaMudBozza(piano: PianoDemo, ctx: ContestoDemo): Promise<void>
  allineaTimestampTecnici(ctx: ContestoDemo, istanti: IstantiCreazione): Promise<void>
}
```

- Regole: ogni evento gira in `eseguiAllIstante(istante del passo, …)` dentro `TenantContext.run({ tenantId: ctx.tenant[azienda], userId: ctx.utente[azienda] }, …)`; un FIR: `creaFir` (anagrafiche dal contesto, `provenienza: 'SPECIALE'`, `tipoTrattaPrincipale` stradale, `codiceOperazione` del piano) ed `emetti` all'istante `creazione`, `presaInCarico` all'istante suo, `confermaConsegna(kgEffettivi)` all'istante suo, `SCARICO` con causale `CONFERIMENTO_TRASPORTATORE`, `firId`, `movementDate` = `registrationDate` = istante dello scarico, `CARICO` dell'impianto con causale `INGRESSO_ESTERNO` e `kgEffettivi`; `CARICO_PRODUZIONE` con causale `PRODUZIONE_INTERNA`. Firmatario = nome e cognome dell'utente che opera. Un `Result` non ok → errore con il `rif` del FIR o l'istante del movimento (lo storico non prosegue con dati a metà). `creaMudBozza` chiama `salva(tenant officine, piano.annoMudBozza, utente, dati)` con le integrazioni minime accettate dal DTO (dichiarante: legale rappresentante e numero addetti dell'azienda). `allineaTimestampTecnici` usa il client proprietario: `UPDATE firs SET created_at = $istante WHERE id = $id AND tenant_id = ANY($demo)` e lo stesso per `waste_movements`, **solo** per id presenti in `istanti`.

- [ ] **Step 1: test che falliscono** (use case finti che registrano `{ nome, istante: new Date(), tenant: TenantContext.getTenantId() }`).

```ts
it('un FIR completo: crea, emetti, presa in carico, consegna e scarico in ordine, ognuno al proprio istante simulato', ...)
it('ogni chiamata gira nel TenantContext dell azienda del FIR', ...)
it('FIR senza scarico nel piano: nessun RegistraMovimento per quel FIR', ...)
it('FIR che vive in recuperi con caricoImpianto: CARICO INGRESSO_ESTERNO col peso effettivo e firId', ...)
it('Result non ok di EmettiFIRUseCase: errore con il rif, nessun evento successivo eseguito', ...)
it('dopo eseguiStorico l orologio e reale', ...)
it('eseguiFirPresente non usa l orologio simulato e chiama dopoEmissione fra emissione e presa in carico', ...)
it('allineaTimestampTecnici aggiorna solo gli id registrati e vincola tenant_id ai tenant demo', ...)  // $executeRaw finto, parametri ispezionati
it('creaMudBozza: salva su officine per annoMudBozza', ...)
```

- [ ] **Step 2:** Run `npx jest src/demo/esecutore-storico` — Expected: FAIL.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** stesso comando — Expected: PASS.
- [ ] **Step 5: commit.** `feat(demo): storico di FIR e movimenti generato dai use case a orologio simulato`

### Task 12: Fase presente e RENTRI della demo

**Files:**
- Create: `apps/backend/src/demo/fase-presente.ts`
- Test: `apps/backend/src/demo/fase-presente.spec.ts`

**Interfaces:**
- Consumes: Task 3 (`PianoDemo.presente`, `scadenze.giorniValiditaCertificatoOfficine`), Task 4 (`POST {RENTRI_FAKE_API_URL}/__controllo/certificato`, `POST /__controllo/azzera`, `GET /__salute`), Task 5 (`AMBIENTE_RENTRI_DIMOSTRATIVO`), Task 10 (`ContestoDemo`), Task 11 (`eseguiFirPresente`); `RentriCredentialService.upsertForTenant`, `RentriUnitaLocaleService` (metodo di creazione della sede), `SyncFIRToRENTRIUseCase.execute(firId, tenantId)`, `CercaFormulariRENTRIUseCase.execute(tenantId)`, `AcquisisciFormularioRENTRIUseCase.execute({ …, scelta: { tipo: 'NUOVO' } })`.
- Produces:

```ts
export interface ClientControlloFake { salute(): Promise<void>; azzera(): Promise<void>; emettiCertificato(commonName: string, giorniValidita: number): Promise<{ certificatoPem: string; chiavePrivataPem: string }> }
export function clientControlloFake(baseUrl: string, http?: typeof fetch): ClientControlloFake
export class FasePresente {
  constructor(deps: { fake: ClientControlloFake; credenziali: RentriCredentialService; unitaLocali: RentriUnitaLocaleService; esecutore: EsecutoreStorico; sincronizza: SyncFIRToRENTRIUseCase; cerca: CercaFormulariRENTRIUseCase; acquisisci: AcquisisciFormularioRENTRIUseCase })
  esegui(piano: PianoDemo, ctx: ContestoDemo): Promise<RiepilogoPresente>
}
export interface RiepilogoPresente { firLocaliInArrivo: string[]; firRentriTrasmessi: { firId: string; numeroFir: string }[]; firRentriAcquisiti: string[] }
```

- Regole: `azzera()` della fake; per `officine` e `recuperi` certificato con `commonName` = `demo-<chiave>`, validità 25 giorni per `officine` e 365 per `recuperi`, `upsertForTenant(tenant, { clientId: commonName, certificatePem, privateKeyPem, environment: AMBIENTE_RENTRI_DIMOSTRATIVO })`; unità locale principale con `numIscrSito` del catalogo; la modalità di legame resta `MANUALE` (la trasmissione la fa lo script come il pulsante "Trasmetti a RENTRI"). Poi: i FIR locali in arrivo (`eseguiFirPresente`); i FIR RENTRI di `officine` (`eseguiFirPresente(fir, ctx, firId => sincronizza.execute(firId, tenantOfficine))`, con esito atteso un `numeroFir`; la presa in carico locale avviene dopo la trasmissione); infine in `recuperi`: `cerca.execute`, e per ogni formulario trasmesso `acquisisci.execute` con `numIscrSito` di `recuperi`, `visibilitaGiaAcquisita` come riportato dalla ricerca, ruolo dell'utente `demo-piazzale`. Un FIR non trasmesso o non trovato dalla ricerca → errore con il `rif`.

- [ ] **Step 1: test che falliscono** (dipendenze finte).

```ts
it('azzera la fake prima di caricare i certificati', ...)
it('credenziali di officine e recuperi con environment fake e validita 25 e 365 giorni', ...)
it('nessun certificato per falegnameria, edilizia, trasporti, studio', ...)
it('trasmette i FIR RENTRI di officine e li acquisisce in recuperi con scelta NUOVO', ...)
it('formulario trasmesso ma non trovato dalla ricerca dell impianto: errore con il rif', ...)
it('clientControlloFake: GET /__salute non 200 → errore leggibile con l indirizzo', ...)
```

- [ ] **Step 2:** Run `npx jest src/demo/fase-presente` — Expected: FAIL.
- [ ] **Step 3: implementare.**
- [ ] **Step 4:** stesso comando — Expected: PASS.
- [ ] **Step 5: commit.** `feat(demo): FIR in arrivo all'impianto, locali e RENTRI tramite la fake`

### Task 13: Modulo, orchestratore, compose ed esecuzione locale

**Files:**
- Create: `apps/backend/src/demo/demo-seed.module.ts`, `apps/backend/src/demo/ripristino-demo.ts`, `apps/backend/src/demo/ripristina-tenant-demo.main.ts`
- Modify: `docker-compose.prod.yml`, `.env.example`
- Test: `apps/backend/src/demo/ripristino-demo.spec.ts`

**Interfaces:**
- Consumes: Task 3, 8, 9, 10, 11, 12.
- Produces:
  - `DemoSeedModule`: importa `ConfigModule.forRoot({ isGlobal: true })`, `EventEmitterModule.forRoot({ global: true })`, `PrismaModule`, `KeycloakModule`, `AdminTenantModule`, `PermissionsModule`, `RegistryModule`, `FIRModule`, `RegistroModule`, `MUDModule`, `RentriModule`, `RentriSyncModule`; **non** importa `ScheduleModule.forRoot()` (nessun cron nel processo dello script) né `NotificationsModule`; fornisce le classi dei Task 8-12.
  - `class RipristinoDemo { constructor(…); esegui(oggi?: Date): Promise<RiepilogoRipristino> }` con `RiepilogoRipristino { tenantRimossi: number; utentiKeycloakRimossi: string[]; scenari: Record<ScenarioDemo, number>; fir: number; movimenti: number; durataMs: number }`.
  - `ripristina-tenant-demo.main.ts`: `NestFactory.createApplicationContext(DemoSeedModule)`, `esegui()`, stampa il riepilogo come JSON, `app.close()`, exit code 0; errore → messaggio, exit code 1.
- Ordine di `esegui` (ogni controllo prima di qualunque cancellazione): (1) variabili: le tre `DEMO_PASSWORD_*` lunghe almeno 10, `RENTRI_FAKE_API_URL` presente; `DEMO_SALTA_KEYCLOAK=1` ammessa solo con `NODE_ENV !== 'production'`; (2) `fake.salute()`; (3) `pulizia.verifica()` e `utentiKeycloak.verificaRimovibili()`; (4) `rimuoviUtentiDemo()`; (5) `pulizia.cancella()`; (6) `pianificaDemo(oggi)`; (7) `PreparazioneAziende.esegui`; (8) `eseguiStorico`; (9) `allineaTimestampTecnici`; (10) `FasePresente.esegui`; (11) `creaMudBozza`; (12) riepilogo.
- Compose (`docker-compose.prod.yml`): nel `backend.environment` aggiungere `RENTRI_FAKE_API_URL: ${RENTRI_FAKE_API_URL:-}`. Nuovi servizi:

```yaml
  rentri-fake:
    profiles: ["demo"]
    build: ./tools/rentri-fake
    image: rifiuti-rentri-fake:locale
    restart: unless-stopped
    logging: *logging
    environment:
      RENTRI_FAKE_DIMOSTRATIVA: "1"
      RENTRI_FAKE_COMPLETAMENTO_MS: "1500"
      RENTRI_AUDIENCE: ${RENTRI_AUDIENCE:-rentrigov.demo.api}
    networks:
      - wasteflow
  demo-seed:
    profiles: ["demo"]
    extends:
      service: backend
    restart: "no"
    command: ["node", "dist/demo/ripristina-tenant-demo.main.js"]
    environment:
      DEMO_PASSWORD_CONSULENTE: ${DEMO_PASSWORD_CONSULENTE:-}
      DEMO_PASSWORD_TITOLARE: ${DEMO_PASSWORD_TITOLARE:-}
      DEMO_PASSWORD_PIAZZALE: ${DEMO_PASSWORD_PIAZZALE:-}
```

  Nessuna `ports:` sulla fake. `.env.example`: le quattro variabili nuove commentate ("solo per il tenant demo; il deploy non le usa").

- [ ] **Step 1: test che falliscono** (`ripristino-demo.spec.ts`, collaboratori finti).

```ts
it('ordine: verifiche, rimozione Keycloak, pulizia, piano, preparazione, storico, allineamento, presente, MUD', ...)
it('fake irraggiungibile: errore e nessuna rimozione Keycloak ne pulizia', ...)
it('password demo mancante o corta: errore prima di ogni cancellazione', ...)
it('RENTRI_FAKE_API_URL assente: errore prima di ogni cancellazione', ...)
it('DEMO_SALTA_KEYCLOAK in produzione: errore', ...)
it('utente Keycloak demo non marcato: nessuna pulizia del database', ...)
it('riepilogo: conteggio per scenario uguale a piano.scenari', ...)
```

- [ ] **Step 2:** Run `npx jest src/demo` — Expected: FAIL solo su `ripristino-demo`.
- [ ] **Step 3: implementare modulo, orchestratore, main, compose, `.env.example`.**
- [ ] **Step 4:** Run `npx jest src/demo && npm run build && ls dist/demo/ripristina-tenant-demo.main.js` — Expected: PASS e file presente.
- [ ] **Step 5: compose valido e deploy invariato.** Run dalla radice:
  `DB_PASSWORD=x REDIS_PASSWORD=x JWT_SECRET=x JWT_REFRESH_SECRET=x RENTRI_CREDENTIAL_ENC_KEY=x SIGNATURE_PROVIDER=sandbox TSA_PROVIDER=mock PERMISSION_CACHE_HMAC_SECRET=x docker compose -f docker-compose.prod.yml config --services` — Expected: `postgres redis backend frontend` (profilo spento). Con `--profile demo` — Expected: anche `rentri-fake demo-seed`. `docker compose … --profile demo config | grep -A3 'rentri-fake:'` — Expected: nessuna chiave `ports`.
- [ ] **Step 6: esecuzione locale, due volte di fila** (Postgres locale migrato, Redis locale, fake avviata con `cd tools/rentri-fake && RENTRI_FAKE_DIMOSTRATIVA=1 RENTRI_FAKE_COMPLETAMENTO_MS=300 npm run dev`). Run `cd apps/backend && DEMO_SALTA_KEYCLOAK=1 RENTRI_FAKE_API_URL=http://127.0.0.1:4010 DEMO_PASSWORD_CONSULENTE=locale-1234567 DEMO_PASSWORD_TITOLARE=locale-1234567 DEMO_PASSWORD_PIAZZALE=locale-1234567 npx ts-node -r tsconfig-paths/register src/demo/ripristina-tenant-demo.main.ts`, poi di nuovo. Expected: due riepiloghi con gli stessi conteggi, ogni scenario ≥ 1, `tenantRimossi` 0 la prima volta (database pulito) e 6 la seconda; `SELECT count(*) FROM tenants WHERE pec NOT ILIKE '%@demo.wasteflow.invalid'` invariato fra prima e dopo. Una tabella che la pulizia non svuota emerge qui come `PuliziaRifiutataError`: si corregge nel Task 9.
- [ ] **Step 7: commit.** `feat(demo): ripristino del tenant demo lanciabile a mano, fake RENTRI nel profilo demo`

---

### Task 14: [OPERAZIONE MANUALE SUL VPS, coordinatore] Prerequisiti e avvio della fake

Dopo il merge in master e il deploy riuscito (l'immagine del backend contiene `dist/demo`). `COMPOSE="docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml"`, da `/opt/rifiuti/site`.

- [ ] **Baseline prima:** `$COMPOSE ps`; `curl -fsS http://127.0.0.1:3017/api/v1/health/db`; `$COMPOSE exec -T postgres psql -U wasteflow -d wasteflow_prod -Atc "select count(*) from tenants; select count(*) from firs;"` (annotare).
- [ ] **Service account Keycloak:** token `client_credentials` di `rifiuti-admin` e `GET https://auth.ignicraft.com/admin/realms/ignicraft/users?username=demo-consulente&exact=true` → atteso `200 []`. Un 403 = mancano `view-users`/`manage-users`: assegnarli al service account dalla console prima di proseguire (prerequisito, non lo fa lo script). Controllare che la password policy del realm accetti le password scelte e che il User Profile non renda obbligatori campi oltre email, nome, cognome, `fiscalCode`.
- [ ] **`.env` (backup prima: `cp /opt/rifiuti/.env /opt/rifiuti/.env.bak-$(date +%F)-demo`):** aggiungere `RENTRI_FAKE_API_URL=http://rentri-fake:4010` e le tre `DEMO_PASSWORD_*` (`openssl rand -base64 18` ciascuna). Mode 600 invariato.
- [ ] **Avvio:** `$COMPOSE --profile demo build rentri-fake && $COMPOSE --profile demo up -d rentri-fake && $COMPOSE up -d backend` (ricrea il backend con la variabile nuova).
- [ ] **Isolamento:** `docker port rifiuti-rentri-fake-1` vuoto; `ss -tlnp | grep 4010` vuoto; `$COMPOSE exec -T backend wget -qO- http://rentri-fake:4010/__salute` → `{"servizio":"rentri-fake","stato":"ok"}`.
- [ ] **Baseline dopo:** stessi comandi della baseline; il backend è healthy, i conteggi invariati, e la diagnostica RENTRI di un tenant reale mostra ancora l'indirizzo globale.

### Task 15: [OPERAZIONE MANUALE SUL VPS, coordinatore] Esecuzione del ripristino

- [ ] `$COMPOSE --profile demo run --rm demo-seed` → riepilogo JSON, exit 0, ogni scenario ≥ 1.
- [ ] Rilanciarlo subito: stessi conteggi, `tenantRimossi: 6`, `utentiKeycloakRimossi` con i tre username.
- [ ] `select count(*) from tenants where pec not ilike '%@demo.wasteflow.invalid'` e il conteggio dei FIR dei tenant non demo: uguali alla baseline.
- [ ] Annotare nel runbook di progetto (memoria): dopo **ogni** riavvio del container `rentri-fake` (o del VPS) si rilancia questo task, perché archivio e CA della fake vivono in memoria (D12). Si lancia anche prima di ogni demo: i FIR "in scadenza" sono relativi al giorno del lancio.

### Task 16: [OPERAZIONE MANUALE, dopo il merge di Studio, Bilancio, Modulo e Piazzale] Verifica end-to-end

Tre profili browser distinti (sessione singola per utente).

- [ ] **`demo-consulente`:** atterra sulla dashboard consulente; la scheda Scadenze mostra, fra le cinque aziende: scarico da annotare scaduto (officine, falegnameria) e in scadenza; FIR senza riscontro scaduto e in preavviso; MUD dati `anno−1` in bozza di officine; autorizzazione di Smaltimenti (demo) e iscrizione Albo di Trasporti (demo) in scadenza; certificato RENTRI di officine in scadenza; per recuperi la riga "termine da configurare". Il clic su una voce cambia azienda attiva e mostra il contrassegno giusto.
- [ ] **`demo-titolare`:** atterra sul Bilancio di Officine Meccaniche (demo): tonnellate prodotte non nulle con confronto sull'anno precedente, barra R/D, tre rifiuti principali, quota pericolosi (`13 02 05*`), stato MUD, mesi con movimenti; il prodotto dell'anno coincide con il riepilogo MUD dello stesso anno.
- [ ] **`demo-piazzale`:** `/piazzale` elenca i due FIR locali e i tre FIR RENTRI in arrivo a Recuperi (demo); su un FIR RENTRI un'accettazione parziale (P) con peso diverso mostra l'avviso di scostamento e si conclude con "accettazione registrata, da firmare in ufficio"; su un FIR locale la conferma del peso lo porta a consegnato.
- [ ] Le pagine RENTRI di officine e recuperi mostrano "Ambiente dimostrativo"; quelle di un tenant reale no.
- [ ] Esito annotato; un difetto apre una correzione nel filone a cui appartiene, non nel seed, a meno che manchi un dato.

---

## Seguiti dichiarati

- Dopo il merge di F2-10: allineare i vettori di prova di `partitaIvaDemo` con `e2e/utils/partita-iva.ts` (stesso algoritmo di controllo) e verificare che `CreateProduttoreUseCase` e affini passino ancora dalle righe di ruolo con ditta e sede (gli id restano, piano F2-10); se la creazione delle anagrafiche si sposta in `DitteService`, il Task 10 cambia sorgente.
- Dopo il merge di F2-6: aggiungere al piano uno scenario di deposito temporaneo in preavviso (oggi Studio non lo mostra, quindi non serve).
- Scorta vidimata e ADR non seminati (D13).
