import { test, expect, type Page } from '@playwright/test'
import { scriviData } from '../../utils/campo-data'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'
import { apiLogin, apiPost, apiGet } from '../../utils/api-client'
import { registra } from '../../fixtures/risorse'
import { conPrefisso, conPrefissoUnico } from '../../utils/run-id'
import { giornoItaliano } from '../../utils/legami-api'
import { AnagrafichePage } from '../../pages/anagrafiche.page'
import { FirListPage } from '../../pages/fir-list.page'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'

/**
 * UAT/E2E — Trasportatore e Destinatario, incluse le scadenze (Task 4 del
 * piano). Mappa e casi in `docs/uat/trasportatore-destinatario.md`.
 *
 * Fonti lette prima di scrivere questo file:
 * - `apps/backend/src/api/registry/dto/create-registry.dto.ts`
 * - `apps/backend/src/domain/registry/entities/{trasportatore,destinatario}.ts`
 * - `apps/backend/src/application/notifications/scadenza-controparte.util.ts` (calcolaScadenza)
 * - `apps/backend/src/api/registry/registry.controller.ts` (campi iscrizioneScaduta/autorizzazioneScaduta/giorniAllaScadenza in GET lista)
 * - `apps/frontend/src/app/features/registry/{trasportatori,destinatari}-list.component.ts`
 * - `apps/frontend/src/app/features/fir/fir-list.component.ts` (righe ~442-521 avviso, ~1610-1627 validateFir)
 * - `apps/backend/src/application/rentri/mappatura/mappa-parti.ts` (normalizzaNumeroIscrizioneAlbo)
 *
 * NOTA SUL PASSO 4 DEL BRIEF, corretta dal committente dopo revisione (vedi
 * report della sessione): il passo originale chiedeva di verificare che
 * "MI/7490" venisse mostrato come "MI/007490" nell'anagrafica. Verificato
 * che questa normalizzazione non esiste lì (esiste solo in
 * `mappa-parti.ts`, sul confine verso RENTRI, dove il formato conta
 * davvero — corretto così, e già coperto da 15 test unitari in
 * `mappa-parti.spec.ts`: ripeterla qui end-to-end sarebbe duplicazione, non
 * copertura). Il punto realmente scoperto e visibile all'utente è un
 * altro: che l'anagrafica ACCETTI "MI/7490" senza rifiutarlo, e che il
 * valore si ritrovi invariato dopo il salvataggio — vedi describe
 * "numero Albo non normalizzato" più sotto.
 */

const SEDE_VALIDA = {
  via: 'Via Roma',
  civico: '1',
  cap: '20100',
  comune: 'Milano',
  provincia: 'MI',
}

function nuovaPartitaIVA(): string {
  return partitaIvaCasualeValida()
}

interface TrasportatoreResponse {
  id: string
  ragioneSociale: string
  numeroIscrizione: string
  scadenzaIscrizione?: string | null
}

interface DestinatarioResponse {
  id: string
  ragioneSociale: string
  numeroAutorizzazione: string
  scadenzaAutorizzazione?: string | null
}

function payloadTrasportatore(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ragioneSociale: conPrefissoUnico('Trasportatore SRL'),
    partitaIVA: nuovaPartitaIVA(),
    sedeLegale: SEDE_VALIDA,
    numeroIscrizione: `MI/${Math.floor(Math.random() * 900000 + 100000)}`,
    pec: 'pec@esempio.it',
    ...overrides,
  }
}

function payloadDestinatario(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ragioneSociale: conPrefissoUnico('Destinatario SRL'),
    partitaIVA: nuovaPartitaIVA(),
    sede: SEDE_VALIDA,
    numeroAutorizzazione: `AUT/${new Date().getFullYear()}/${Math.floor(Math.random() * 9000 + 1000)}`,
    pec: 'pec@esempio.it',
    ...overrides,
  }
}

/** Ieri (scadenza passata) in formato ISO (solo giorno), nel fuso di Roma. */
function ieriIso(): string {
  return giornoItaliano(-1)
}

/** Fra un anno (scadenza futura) in formato ISO (solo giorno), nel fuso di Roma. */
function fraUnAnnoIso(): string {
  const oggi = giornoItaliano()
  return `${Number(oggi.slice(0, 4)) + 1}${oggi.slice(4)}`
}

/**
 * Apre l'overlay del p-dropdown identificato da `inputId` (l'attributo
 * `inputId` di `<p-dropdown>`, che PrimeNG applica all'elemento nativo
 * interno) e sceglie l'opzione il cui testo contiene `testoOpzione`. Stesso
 * pattern già in uso nella suite (`.p-dropdown-item`, vedi
 * rentri-ciclo-formulario.spec.ts) — classe strutturale di PrimeNG, non uno
 * stile applicativo.
 *
 * NON usare `page.getByLabel(...)`: in `fir-list.component.ts` l'etichetta
 * «Trasportatore» (e «Destinatario») è una sottostringa che matcha anche i
 * bottoni `aria-label="Nuovo trasportatore"` / `"Modifica trasportatore
 * selezionato"` e le tratte aggiuntive dinamiche «Trasportatore aggiuntivo
 * N» — `getByLabel` è per sottostringa e case-insensitive per default e
 * considera anche `aria-label`, quindi la modalità stretta di Playwright
 * fallisce con più elementi trovati. L'id del controllo (`new-trasportatore`
 * / `new-destinatario`, l'`inputId` dichiarato in `fir-list.component.ts`)
 * è invece univoco nel DOM: si usa un locator per id esatto.
 */
async function selezionaDropdown(page: Page, inputId: string, testoOpzione: string) {
  const combobox = page.locator(`#${inputId}`)
  const etichetta = page.locator(`p-dropdown:has(#${inputId}) .p-dropdown-label`)
  // In CI (job 9325) il click sull'opzione è andato perso: il pannello si
  // chiudeva senza selezionare (etichetta ancora sul placeholder), verosimilmente
  // per il click durante l'animazione di apertura o per un ricaricamento delle
  // opzioni. Si riprova l'intera sequenza finché l'etichetta mostra la scelta.
  await expect(async () => {
    if ((await combobox.getAttribute('aria-expanded')) !== 'true') {
      await combobox.click()
    }
    const opzione = page.locator('.p-dropdown-item', { hasText: testoOpzione }).first()
    await expect(opzione).toBeVisible({ timeout: 3000 })
    await opzione.click()
    await expect(etichetta).toHaveText(testoOpzione, { timeout: 2000 })
  }).toPass({ timeout: 15000 })
}

test.describe('Trasportatore — CRUD via UI (operator)', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('happy path: crea un trasportatore con scadenza iscrizione dalla UI', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const anagrafiche = new AnagrafichePage(page, 'trasportatori')
    await anagrafiche.goto()
    await anagrafiche.expectLoaded()

    const ragioneSociale = conPrefisso('Trasportatore UI SRL')
    const partitaIVA = nuovaPartitaIVA()
    const numeroIscrizione = `MI/${Math.floor(Math.random() * 900000 + 100000)}`
    const scadenza = fraUnAnnoIso()

    await anagrafiche.apriNuovo()
    await page.getByLabel('Ragione sociale').fill(ragioneSociale)
    await page.getByLabel('Partita IVA').fill(partitaIVA)
    await page.getByLabel('N. iscrizione Albo Gestori').fill(numeroIscrizione)
    await scriviData(page, anagrafiche.scadenzaInput, scadenza)
    await page.getByLabel('Via').fill(SEDE_VALIDA.via)
    await page.getByLabel('Civico').fill(SEDE_VALIDA.civico)
    await page.getByLabel('CAP').fill(SEDE_VALIDA.cap)
    await page.getByLabel('Comune').fill(SEDE_VALIDA.comune)
    await page.getByLabel('Provincia').fill(SEDE_VALIDA.provincia)
    await anagrafiche.salva()
    await expect(anagrafiche.formDialog).toBeHidden()

    const token = await apiLogin('operator')
    const lista = await apiGet<{ items: TrasportatoreResponse[] }>('/registry/trasportatori', token)
    const creato = lista.items.find(t => t.numeroIscrizione === numeroIscrizione)
    expect(
      creato,
      'il trasportatore creato dalla UI deve comparire in GET /registry/trasportatori'
    ).toBeTruthy()
    registra('trasportatore', creato!.id)
    // La data scritta nel campo deve essere arrivata al backend, giorno per giorno.
    expect(creato!.scadenzaIscrizione?.slice(0, 10)).toBe(scadenza)

    await expect(anagrafiche.row(creato!.id)).toContainText(ragioneSociale)
  })
})

test.describe('Trasportatore — numero Albo non normalizzato', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  /**
   * RULING del committente dopo revisione (vedi report della sessione): il
   * punto visibile all'utente e scoperto non è la normalizzazione (che
   * avviene correttamente sul confine verso RENTRI, non qui — vedi nota in
   * cima al file), ma che l'anagrafica non rifiuti un numero senza zeri
   * davanti e lo conservi esattamente come inserito.
   */
  test('"MI/7490" è accettato e si ritrova invariato dopo il salvataggio', async () => {
    const token = await apiLogin('operator')
    const body = payloadTrasportatore({ numeroIscrizione: 'MI/7490' })

    const creato = await apiPost<TrasportatoreResponse>('/registry/trasportatori', body, token)
    registra('trasportatore', creato.id)

    expect(creato.numeroIscrizione).toBe('MI/7490')

    const riletto = await apiGet<TrasportatoreResponse>(
      `/registry/trasportatori/${creato.id}`,
      token
    )
    expect(riletto.numeroIscrizione).toBe('MI/7490')
  })
})

test.describe('Destinatario — CRUD via UI (operator)', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('happy path: crea un destinatario con scadenza autorizzazione dalla UI', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'operator')
    const anagrafiche = new AnagrafichePage(page, 'destinatari')
    await anagrafiche.goto()
    await anagrafiche.expectLoaded()

    const ragioneSociale = conPrefisso('Destinatario UI SRL')
    const partitaIVA = nuovaPartitaIVA()
    const numeroAutorizzazione = `AUT/${new Date().getFullYear()}/${Math.floor(Math.random() * 9000 + 1000)}`
    const scadenza = fraUnAnnoIso()

    await anagrafiche.apriNuovo()
    await page.getByLabel('Ragione sociale').fill(ragioneSociale)
    await page.getByLabel('Partita IVA').fill(partitaIVA)
    await page.getByLabel('N. autorizzazione').fill(numeroAutorizzazione)
    await scriviData(page, anagrafiche.scadenzaInput, scadenza)
    await page.getByLabel('Via').fill(SEDE_VALIDA.via)
    await page.getByLabel('Civico').fill(SEDE_VALIDA.civico)
    await page.getByLabel('CAP').fill(SEDE_VALIDA.cap)
    await page.getByLabel('Comune').fill(SEDE_VALIDA.comune)
    await page.getByLabel('Provincia').fill(SEDE_VALIDA.provincia)
    await anagrafiche.salva()
    await expect(anagrafiche.formDialog).toBeHidden()

    const token = await apiLogin('operator')
    const lista = await apiGet<{ items: DestinatarioResponse[] }>('/registry/destinatari', token)
    const creato = lista.items.find(d => d.numeroAutorizzazione === numeroAutorizzazione)
    expect(
      creato,
      'il destinatario creato dalla UI deve comparire in GET /registry/destinatari'
    ).toBeTruthy()
    registra('destinatario', creato!.id)
    // La data scritta nel campo deve essere arrivata al backend, giorno per giorno.
    expect(creato!.scadenzaAutorizzazione?.slice(0, 10)).toBe(scadenza)

    await expect(anagrafiche.row(creato!.id)).toContainText(ragioneSociale)
  })
})

test.describe('Scadenze — dato mancante non genera mai un avviso', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test('trasportatore SENZA scadenza: nessun avviso alla scelta in un FIR', async ({
    page,
    context,
  }) => {
    const token = await apiLogin('operator')
    // Nessuna scadenzaIscrizione nel payload: campo assente, non azzerato.
    const body = payloadTrasportatore()
    const trasportatore = await apiPost<TrasportatoreResponse>(
      '/registry/trasportatori',
      body,
      token
    )
    registra('trasportatore', trasportatore.id)

    await loginAndSaveState(page, context, 'operator')
    const firList = new FirListPage(page)
    await firList.goto()
    await firList.openNuovoFirDialog()

    await selezionaDropdown(page, 'new-trasportatore', trasportatore.ragioneSociale)
    // Senza questa attesa "nessun avviso" varrebbe anche se la scelta non fosse mai
    // avvenuta (assenza banale). Si legge l'etichetta SELEZIONATA, non il testo del
    // p-dropdown: i dropdown del FIR non hanno appendTo, quindi a pannello aperto il
    // testo contiene anche la voce della lista e passerebbe senza scelta.
    await expect(page.locator('p-dropdown:has(#new-trasportatore) .p-dropdown-label')).toHaveText(
      trasportatore.ragioneSociale
    )
    await expect(page.getByTestId('fir-trasportatore-iscrizione-scaduta')).toHaveCount(0)
  })

  test('destinatario SENZA scadenza: nessun avviso alla scelta in un FIR', async ({
    page,
    context,
  }) => {
    const token = await apiLogin('operator')
    const body = payloadDestinatario()
    const destinatario = await apiPost<DestinatarioResponse>('/registry/destinatari', body, token)
    registra('destinatario', destinatario.id)

    await loginAndSaveState(page, context, 'operator')
    const firList = new FirListPage(page)
    await firList.goto()
    await firList.openNuovoFirDialog()

    await selezionaDropdown(page, 'new-destinatario', destinatario.ragioneSociale)
    // Vedi sopra: prova che la scelta è avvenuta, altrimenti l'assenza dell'avviso è banale.
    await expect(page.locator('p-dropdown:has(#new-destinatario) .p-dropdown-label')).toHaveText(
      destinatario.ragioneSociale
    )
    await expect(page.getByTestId('fir-destinatario-autorizzazione-scaduta')).toHaveCount(0)
  })
})

test.describe('Scadenze — avviso alla scelta della parte, emissione non impedita', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  /**
   * "Emissione non impedita" verificato qui SENZA completare l'intera
   * creazione del FIR (CER/quantità/provenienza/tratta): quel percorso non
   * ha ancora una copertura E2E stabile in questa suite (vedi
   * `e2e/tests/fir/fir-lifecycle.spec.ts`, ancora `test.fixme` per lo
   * stesso motivo — "richiede dati di fixture stabili") e costruirlo da
   * zero qui, senza poterlo eseguire in questa sessione (vincolo
   * d'ambiente), sarebbe un test complesso mai verificato. Si esercita
   * invece il vero codice di validazione del form (`validateFir()`,
   * fir-list.component.ts righe ~1610-1627): letto prima di scrivere questo
   * test, NON controlla mai `iscrizioneScaduta`/`autorizzazioneScaduta`. Il
   * test lo conferma clic-per-clic sul componente reale, non sulla sola
   * lettura del sorgente: seleziona il trasportatore scaduto e clicca
   * "Crea FIR" lasciando vuoti gli altri campi obbligatori — se la scadenza
   * bloccasse l'emissione comparirebbe un errore sul campo trasportatore;
   * invece compaiono SOLO gli errori sugli altri campi obbligatori.
   */
  test('trasportatore con iscrizione scaduta: avviso mostrato, selezione non bloccata', async ({
    page,
    context,
  }) => {
    const token = await apiLogin('operator')
    const body = payloadTrasportatore({ scadenzaIscrizione: ieriIso() })
    const trasportatore = await apiPost<TrasportatoreResponse>(
      '/registry/trasportatori',
      body,
      token
    )
    registra('trasportatore', trasportatore.id)

    await loginAndSaveState(page, context, 'operator')
    const firList = new FirListPage(page)
    await firList.goto()
    await firList.openNuovoFirDialog()

    await selezionaDropdown(page, 'new-trasportatore', trasportatore.ragioneSociale)
    await expect(page.getByTestId('fir-trasportatore-iscrizione-scaduta')).toBeVisible()

    await page.getByRole('button', { name: /crea fir/i }).click()
    await expect(page.locator('#new-trasportatore-err')).toHaveCount(0)
    // Gli altri campi obbligatori restano vuoti: la validazione normale
    // deve comunque scattare su di loro, a riprova che il form valida
    // davvero (non è semplicemente "tutto disabilitato").
    await expect(page.locator('#new-cer-err, #new-provenienza-err')).not.toHaveCount(0)
  })

  test('destinatario con autorizzazione scaduta: avviso mostrato, selezione non bloccata', async ({
    page,
    context,
  }) => {
    const token = await apiLogin('operator')
    const body = payloadDestinatario({ scadenzaAutorizzazione: ieriIso() })
    const destinatario = await apiPost<DestinatarioResponse>('/registry/destinatari', body, token)
    registra('destinatario', destinatario.id)

    await loginAndSaveState(page, context, 'operator')
    const firList = new FirListPage(page)
    await firList.goto()
    await firList.openNuovoFirDialog()

    await selezionaDropdown(page, 'new-destinatario', destinatario.ragioneSociale)
    await expect(page.getByTestId('fir-destinatario-autorizzazione-scaduta')).toBeVisible()

    await page.getByRole('button', { name: /crea fir/i }).click()
    await expect(page.locator('#new-destinatario-err')).toHaveCount(0)
  })
})
