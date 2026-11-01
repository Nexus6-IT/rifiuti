import { test, expect, type Locator, type Page } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, getApiUrl } from '../../utils/env'
import { apiLogin, apiGet, apiDelete, ApiClientError } from '../../utils/api-client'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { conPrefissoUnico } from '../../utils/run-id'

/**
 * E2E — Archivio addebiti (pezzo 4.2a, Task 15): dai codici IVA alla variazione dei prezzi.
 *
 * Percorso (un solo addebito, in sequenza):
 *   1. `/clienti/tabelle`: scheda "Codici IVA", un codice con aliquota 22 e uno con aliquota 0 e
 *      natura N6.1 (il backend rifiuta la natura sull'aliquota piena: lo spec lo prova).
 *   2. `/clienti/addebiti` (dal pulsante "Archivio addebiti" dei clienti): addebito "Trasporto"
 *      con il gruppo creato in linea (modalita' rapida), il codice IVA 22 e i listini 1 e 2.
 *   3. `/clienti`: cliente su ditta nuova con il listino 2; riaperto, il listino e' ancora 2.
 *   4. Variazione +10 % dalla riga dell'addebito, solo listino 2: anteprima (10.00 -> 11.00),
 *      riepilogo, conferma. Il listino 1 non cambia.
 *   5. VIEWER: vede schede e archivio senza pulsanti di scrittura ne' colonna Azioni.
 *
 * Isolamento (R18): codici IVA casuali di tre caratteri (con controllo dei codici occupati,
 * anche fra i disattivati), nomi con prefisso di run e suffisso per tentativo, variazione con il
 * filtro `addebitiIds` = solo l'addebito creato (arriva dal pulsante "Varia prezzi" della riga) e
 * `listini = [2]`: l'archivio del resto dell'azienda di prova non viene toccato.
 * La variazione richiede ADMIN (R11): tutto il percorso gira con quel ruolo.
 *
 * Pulizia in `afterAll` via API, in ordine: cliente -> addebito -> gruppo -> codici IVA. Quello
 * che risulta in uso (409) viene DISATTIVATO invece che eliminato.
 */

type Tabella = 'clienti' | 'addebiti' | 'codifiche-addebito' | 'codici-iva'

interface RigaApi {
  id: string
  versione: number
  codice?: string | null
  descrizione?: string
  ditta?: { ragioneSociale: string }
}

interface AddebitoApi extends RigaApi {
  listini: { numero: number; prezzo: string | null }[]
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const carattereCasuale = () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]

function codiceCasuale(n: number): string {
  let c = ''
  while (c.length < n) c += carattereCasuale()
  return c
}

const dati = {
  /** Assegnati in `beforeAll` fra i codici IVA ancora liberi (anche fra i disattivati). */
  iva22: '',
  ivaN61: '',
  partitaIva: partitaIvaCasualeValida(),
}

/** Nomi con suffisso casuale per tentativo: un retry non trova le righe del tentativo prima. */
const nomi = {
  iva22: conPrefissoUnico('IVA ordinaria'),
  ivaN61: conPrefissoUnico('IVA inversione'),
  /** Max 45 caratteri (maxlength del campo): il prefisso di run e il suffisso gia' ne usano 38. */
  gruppo: conPrefissoUnico('Gruppo'),
  addebito: conPrefissoUnico('Trasporto'),
  cliente: conPrefissoUnico('Cliente listino'),
}

/** Cio' che il test ha creato, nell'ordine in cui va ripulito (dal piu' recente). */
const creati: { tabella: Tabella; trova: (r: RigaApi) => boolean; query?: string }[] = []

async function elenco(tabella: Tabella, token: string, query = ''): Promise<RigaApi[]> {
  if (tabella === 'clienti') {
    const r = await apiGet<{ elementi?: RigaApi[] } | RigaApi[]>(
      `/clienti?dimensione=100&testo=${encodeURIComponent(nomi.cliente)}`,
      token
    )
    return Array.isArray(r) ? r : (r.elementi ?? [])
  }
  if (tabella === 'addebiti') {
    const r = await apiGet<{ elementi: RigaApi[] }>(
      `/addebiti?testo=${encodeURIComponent(nomi.addebito)}`,
      token
    )
    return r.elementi
  }
  return apiGet<RigaApi[]>(`/${tabella}?incluseDisattivate=true${query ? `&${query}` : ''}`, token)
}

async function disattiva(tabella: Tabella, riga: RigaApi, token: string): Promise<void> {
  const campo = tabella === 'codifiche-addebito' ? 'attiva' : 'attivo'
  const r = await fetch(`${getApiUrl()}/${tabella}/${riga.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ [campo]: false, versione: riga.versione }),
  })
  if (!r.ok) throw new Error(`PATCH ${tabella}/${riga.id} fallita: ${r.status} ${await r.text()}`)
}

/** Tutto cio' che non e' un dialog o un'opzione appesa al body si cerca in `#main-content`. */
function contenuto(page: Page) {
  return page.locator('#main-content')
}

function dialogo(page: Page, nome: string | RegExp): Locator {
  return page.getByRole('dialog', { name: nome })
}

/** Riempie i campi e verifica che `Salva` si abiliti: se il form viene azzerato si riparte. */
async function compilaESalva(dlg: Locator, riempi: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await riempi()
    await expect(dlg.getByRole('button', { name: 'Salva' })).toBeEnabled({ timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
  await dlg.getByRole('button', { name: 'Salva' }).click()
  // Il salvataggio puo' essere lento con la macchina carica: piu' del timeout di default.
  await expect(dlg).toBeHidden({ timeout: 15_000 })
}

/** Sceglie in un `<select>` nativo la voce il cui testo contiene `testo`. */
async function scegliVoce(select: Locator, testo: string): Promise<void> {
  const valore = await select.locator('option', { hasText: testo }).first().getAttribute('value')
  expect(valore, `voce "${testo}" assente dal campo`).toBeTruthy()
  await select.selectOption(valore!)
}

async function apriTabelle(page: Page): Promise<void> {
  await page.goto('/clienti/tabelle')
  await expect(
    contenuto(page).getByRole('heading', { level: 1, name: 'Tabelle di fatturazione' })
  ).toBeVisible()
}

/** Dall'elenco clienti, col pulsante "Archivio addebiti" (non con `goto`). */
async function apriArchivio(page: Page): Promise<void> {
  await page.goto('/clienti')
  await expect(contenuto(page).getByRole('heading', { level: 1, name: 'Clienti' })).toBeVisible()
  await contenuto(page).getByRole('button', { name: 'Archivio addebiti' }).click()
  await expect(
    contenuto(page).getByRole('heading', { level: 1, name: 'Archivio addebiti' })
  ).toBeVisible()
}

/** Cerca l'addebito dello spec e ne restituisce la riga. */
async function rigaAddebito(page: Page): Promise<Locator> {
  await contenuto(page).getByRole('searchbox', { name: 'Cerca un addebito' }).fill(nomi.addebito)
  const riga = contenuto(page).getByRole('row', { name: new RegExp(nomi.addebito) })
  await expect(riga).toHaveCount(1)
  return riga
}

test.describe('Archivio addebiti — admin', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!hasRoleCredentials('admin'), skipReason('admin'))

  test.beforeAll(async () => {
    if (!hasRoleCredentials('admin')) return
    const occupati = new Set(
      (await elenco('codici-iva', await apiLogin('admin'))).map(r => r.codice)
    )
    const libero = (): string => {
      for (;;) {
        const c = codiceCasuale(3)
        if (!occupati.has(c)) {
          occupati.add(c)
          return c
        }
      }
    }
    dati.iva22 = libero()
    dati.ivaN61 = libero()
  })

  test.beforeEach(async ({ page, context }) => {
    await loginAndSaveState(page, context, 'admin')
  })

  test.afterAll(async () => {
    if (!hasRoleCredentials('admin') || creati.length === 0) return
    const token = await apiLogin('admin')
    const errori: string[] = []
    for (const { tabella, trova, query } of [...creati].reverse()) {
      try {
        const riga = (await elenco(tabella, token, query)).find(trova)
        if (!riga) continue
        try {
          await apiDelete(`/${tabella}/${riga.id}?versione=${riga.versione}`, token)
        } catch (e) {
          if (!(e instanceof ApiClientError) || e.status !== 409) throw e
          await disattiva(tabella, riga, token)
        }
      } catch (e) {
        errori.push(`${tabella}: ${(e as Error).message}`)
      }
    }
    expect(errori, 'pulizia delle righe create dallo spec').toEqual([])
  })

  test('tabelle: codice IVA 22 e codice IVA N6.1 con aliquota zero', async ({ page }) => {
    creati.push({ tabella: 'codici-iva', trova: r => r.codice === dati.iva22 })
    creati.push({ tabella: 'codici-iva', trova: r => r.codice === dati.ivaN61 })

    await apriTabelle(page)
    await contenuto(page).getByRole('tab', { name: 'Codici IVA' }).click()

    // Codice IVA con aliquota 22.
    await contenuto(page).getByRole('button', { name: 'Nuovo codice IVA' }).click()
    const ord = dialogo(page, 'Nuovo codice IVA')
    await expect(ord).toBeVisible()
    await compilaESalva(ord, async () => {
      await ord.getByLabel('Codice (da 1 a 3 lettere o cifre)').fill(dati.iva22)
      await ord.getByLabel('Descrizione', { exact: true }).fill(nomi.iva22)
      await ord.getByLabel('Aliquota (%)').fill('22')
    })
    const rigaOrd = contenuto(page).getByTestId(`iva-riga-${dati.iva22}`)
    await expect(rigaOrd).toContainText(nomi.iva22)
    await expect(rigaOrd).toContainText(/^.*22(\.00)?%/)

    // Natura con aliquota piena: il backend rifiuta e il messaggio si vede nel dialog.
    await contenuto(page).getByRole('button', { name: 'Nuovo codice IVA' }).click()
    const inv = dialogo(page, 'Nuovo codice IVA')
    await expect(inv).toBeVisible()
    await inv.getByLabel('Codice (da 1 a 3 lettere o cifre)').fill(dati.ivaN61)
    await inv.getByLabel('Descrizione', { exact: true }).fill(nomi.ivaN61)
    await inv.getByLabel('Aliquota (%)').fill('22')
    // Dropdown di PrimeNG: l'apertura puo' andare persa durante l'animazione del dialog, quindi
    // si riprova la sequenza finche' l'etichetta mostra la scelta.
    const etichettaNatura = inv.locator('p-dropdown .p-dropdown-label')
    await expect(async () => {
      await etichettaNatura.click()
      const opzione = page.getByRole('option', { name: /^N6\.1 - / })
      await expect(opzione).toBeVisible({ timeout: 3_000 })
      await opzione.click()
      await expect(etichettaNatura).toContainText('N6.1', { timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
    await expect(page.getByRole('option', { name: /^N6\.1 - / })).toBeHidden()
    await expect(inv.getByRole('button', { name: 'Salva' })).toBeEnabled()
    await inv.getByRole('button', { name: 'Salva' }).click()
    await expect(inv.getByTestId('iva-dlg-errore')).toContainText(
      'La natura si indica solo con aliquota zero.'
    )
    await expect(inv).toBeVisible()

    // Aliquota zero con la natura N6.1: accettato.
    await inv.getByLabel('Aliquota (%)').fill('0')
    await expect(inv.getByRole('button', { name: 'Salva' })).toBeEnabled()
    await inv.getByRole('button', { name: 'Salva' }).click()
    await expect(inv).toBeHidden()
    const rigaInv = contenuto(page).getByTestId(`iva-riga-${dati.ivaN61}`)
    await expect(rigaInv).toContainText(nomi.ivaN61)
    await expect(rigaInv).toContainText('N6.1')
  })

  test('addebito "Trasporto": gruppo in linea, codice IVA 22, listini 1 e 2', async ({ page }) => {
    creati.push({ tabella: 'addebiti', trova: r => r.descrizione === nomi.addebito })
    creati.push({
      tabella: 'codifiche-addebito',
      trova: r => r.descrizione === nomi.gruppo,
      query: 'genere=GRUPPO',
    })

    await apriArchivio(page)
    await contenuto(page).getByRole('button', { name: 'Nuovo addebito' }).click()
    const dlg = dialogo(page, 'Nuovo addebito')
    await expect(dlg).toBeVisible()
    await expect(dlg.getByText('Caricamento…')).toBeHidden()

    // Gruppo in linea, modalita' rapida: solo la descrizione, il codice lo da' il server.
    await dlg.getByRole('button', { name: 'Nuovo gruppo' }).click()
    const gruppo = dialogo(page, 'Nuovo gruppo')
    await expect(gruppo).toBeVisible()
    await expect(gruppo.getByLabel('Codice', { exact: false })).toHaveCount(0)
    await compilaESalva(gruppo, async () => {
      await gruppo.getByLabel('Descrizione', { exact: true }).fill(nomi.gruppo)
    })
    await expect(dlg.getByLabel('Gruppo', { exact: true })).not.toHaveValue('')

    await scegliVoce(dlg.getByLabel('Codice IVA', { exact: true }), dati.iva22)
    await compilaESalva(dlg, async () => {
      await dlg.getByLabel('Descrizione', { exact: true }).fill(nomi.addebito)
      await dlg.getByLabel('Unità di misura').fill('NR')
      await dlg.getByLabel('Tipo di addebito').selectOption('V')
      await dlg.getByLabel('Prezzo del listino 1').fill('5,00')
      await dlg.getByLabel('Prezzo del listino 2').fill('10,00')
      await expect(dlg.getByLabel('Prezzo del listino 2')).toHaveValue('10,00', { timeout: 1_000 })
      await expect(dlg.getByLabel('Gruppo', { exact: true })).not.toHaveValue('', {
        timeout: 1_000,
      })
    })

    const riga = await rigaAddebito(page)
    await expect(riga).toContainText(nomi.gruppo)
    await expect(riga).toContainText('5.00')
    await expect(riga).toContainText('Sì')
  })

  test('cliente su ditta nuova con il listino 2', async ({ page }) => {
    creati.push({ tabella: 'clienti', trova: r => r.ditta?.ragioneSociale === nomi.cliente })

    await page.goto('/clienti')
    await expect(contenuto(page).getByRole('heading', { level: 1, name: 'Clienti' })).toBeVisible()
    await contenuto(page).getByRole('button', { name: 'Nuovo cliente' }).click()
    const dlg = dialogo(page, 'Nuovo cliente')
    await expect(dlg).toBeVisible()

    await compilaESalva(dlg, async () => {
      await dlg.getByLabel('Ragione sociale').fill(nomi.cliente)
      await dlg.getByLabel('Partita IVA').fill(dati.partitaIva)
      await dlg.getByLabel('Via', { exact: true }).fill('Via delle Prove')
      await dlg.getByLabel('Civico').fill('7')
      await dlg.getByLabel('CAP').fill('20100')
      await dlg.getByLabel('Comune').fill('Milano')
      await dlg.getByLabel('Provincia').fill('MI')
      await dlg.getByLabel('Listino', { exact: true }).selectOption('2')
      await expect(dlg.getByLabel('Listino', { exact: true })).toHaveValue('2', { timeout: 1_000 })
    })

    // Riaperto, il cliente porta ancora il listino 2.
    await contenuto(page).getByRole('searchbox', { name: 'Cerca un cliente' }).fill(nomi.cliente)
    const riga = contenuto(page).getByRole('row', { name: new RegExp(nomi.cliente) })
    await expect(riga).toHaveCount(1)
    await riga.getByRole('button', { name: /^Modifica il cliente/ }).click()
    const modifica = dialogo(page, 'Modifica cliente')
    await expect(modifica).toBeVisible()
    await expect(modifica.getByLabel('Listino', { exact: true })).toHaveValue('2')
    await modifica.getByRole('button', { name: 'Annulla', exact: true }).click()
    await expect(modifica).toBeHidden()
  })

  test('variazione +10 % sul listino 2: anteprima e conferma', async ({ page }) => {
    await apriArchivio(page)
    const riga = await rigaAddebito(page)
    await riga.getByRole('button', { name: /^Varia i prezzi/ }).click()

    const dlg = dialogo(page, /Variazione prezzi/)
    await expect(dlg).toBeVisible()
    // Filtro per addebito: la variazione riguarda solo la riga scelta (R18).
    await expect(dlg.getByTestId('var-solo-addebito')).toBeVisible()

    await dlg.getByLabel('Percentuale (%)').fill('10')
    for (const n of [1, 3, 4, 5, 6]) {
      await dlg.getByRole('checkbox', { name: `Listino ${n}`, exact: true }).uncheck()
    }
    await expect(dlg.getByRole('checkbox', { name: 'Listino 2', exact: true })).toBeChecked()
    await dlg.getByRole('button', { name: 'Anteprima' }).click()

    // Anteprima: un solo prezzo, 10.00 -> 11.00 sul listino 2.
    await expect(dlg.getByRole('heading', { name: /Anteprima: 1 prezzi/ })).toBeVisible()
    const righe = dlg.getByTestId('var-righe').locator('tbody tr')
    await expect(righe).toHaveCount(1)
    await expect(righe.first()).toContainText(nomi.addebito)
    await expect(righe.first()).toContainText('10.00')
    await expect(righe.first()).toContainText('11.00')

    // Riepilogo e conferma.
    await dlg.getByRole('button', { name: 'Applica' }).click()
    await expect(dlg.getByTestId('var-riepilogo')).toContainText('Listini: 2')
    await expect(dlg.getByTestId('var-riepilogo')).toContainText('Solo l’addebito scelto')
    await expect(dlg.getByRole('button', { name: 'Conferma la variazione' })).toBeEnabled()
    await dlg.getByRole('button', { name: 'Conferma la variazione' }).click()
    await expect(dlg.getByTestId('var-esito')).toContainText('Prezzi aggiornati: 1')
    await dlg.getByRole('button', { name: 'Chiudi' }).click()
    await expect(dlg).toBeHidden()

    // Effetto sull'archivio: il listino 2 sale, il listino 1 resta.
    const token = await apiLogin('admin')
    const trovato = (await elenco('addebiti', token)).find(r => r.descrizione === nomi.addebito)
    expect(trovato, 'addebito dello spec').toBeTruthy()
    const addebito = await apiGet<AddebitoApi>(`/addebiti/${trovato!.id}`, token)
    const prezzo = (n: number) => addebito.listini.find(l => l.numero === n)?.prezzo
    expect(prezzo(2)).toBe('11.00')
    expect(prezzo(1)).toBe('5.00')

    // ...e la riga, riaperta in modifica, mostra gli stessi prezzi.
    await riga.getByRole('button', { name: /^Modifica l.addebito/ }).click()
    const modifica = dialogo(page, 'Modifica addebito')
    await expect(modifica).toBeVisible()
    await expect(modifica.getByText('Caricamento…')).toBeHidden()
    await expect(modifica.getByLabel('Prezzo del listino 2')).toHaveValue('11.00')
    await expect(modifica.getByLabel('Prezzo del listino 1')).toHaveValue('5.00')
    await modifica.getByRole('button', { name: 'Annulla', exact: true }).click()
    await expect(modifica).toBeHidden()
  })
})

test.describe('Archivio addebiti — VIEWER', () => {
  test.skip(!hasRoleCredentials('viewer'), skipReason('viewer'))

  test('vede schede e archivio senza pulsanti di scrittura', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'viewer')

    await apriTabelle(page)
    await contenuto(page).getByRole('tab', { name: 'Codici IVA' }).click()
    await expect(contenuto(page).getByRole('table')).toBeVisible()
    await expect(contenuto(page).getByRole('button', { name: 'Nuovo codice IVA' })).toHaveCount(0)
    await expect(
      contenuto(page).getByRole('button', { name: /^(Modifica|Disattiva|Riattiva|Elimina)/ })
    ).toHaveCount(0)

    await contenuto(page).getByRole('tab', { name: 'Gruppi e categorie di addebito' }).click()
    await expect(contenuto(page).getByRole('table')).toBeVisible()
    await expect(contenuto(page).getByRole('button', { name: /^Nuov[oa] / })).toHaveCount(0)

    await apriArchivio(page)
    await expect(contenuto(page).getByRole('table')).toBeVisible()
    await expect(contenuto(page).getByRole('button', { name: 'Nuovo addebito' })).toHaveCount(0)
    await expect(contenuto(page).getByRole('button', { name: 'Variazione prezzi' })).toHaveCount(0)
    await expect(contenuto(page).getByRole('columnheader', { name: 'Azioni' })).toHaveCount(0)
    await expect(
      contenuto(page).getByRole('button', {
        name: /^(Modifica|Varia i prezzi|Disattiva|Riattiva|Elimina)/,
      })
    ).toHaveCount(0)
  })
})
