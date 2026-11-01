import { test, expect, type Page } from '@playwright/test'
import { aggiungiRata, cliccaEChiudi } from '../../utils/attese'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'
import { apiLogin, apiGet, apiDelete } from '../../utils/api-client'
import { conPrefisso } from '../../utils/run-id'

/**
 * E2E — Tabelle di fatturazione (pezzo 4.1a, R10): dalla pagina `/clienti/tabelle`
 * crea una condizione di pagamento 30-60 fine mese, un conto corrente (IBAN mascherato
 * in elenco), una spesa di bollo, un registro IVA (`1` mostrato come `01`), un testo di
 * fatturazione e una categoria con codice automatico; disattiva e riattiva una riga;
 * verifica che un VIEWER veda la pagina senza pulsanti di scrittura.
 *
 * Mappa letta da:
 * - `apps/frontend/src/app/features/clienti/tabelle/*.component.ts` (schede, dialog, data-testid)
 * - `apps/backend/src/api/clienti/*.controller.ts` (rotte, `DELETE …?versione=`)
 * - `apps/backend/src/domain/clienti/{iban,registro-iva,codice-tabella}.ts` (regole sui codici)
 *
 * Il database di CI viene riusato fra due passate: i codici sono casuali per esecuzione e
 * l'IBAN ha cifre di controllo valide ma numero di conto casuale (l'IBAN e' unico per
 * azienda). Pulizia: questo spec elimina da solo, in `afterAll`, le righe che ha creato
 * (non usa `fixtures/risorse.ts`, che copre solo le anagrafiche del registro).
 */

type Tabella =
  | 'condizioni-pagamento'
  | 'conti-correnti'
  | 'spese-accessorie'
  | 'registri-iva'
  | 'testi-fatturazione'
  | 'codifiche-contratto'

interface RigaApi {
  id: string
  codice: string
  versione: number
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function carattereCasuale(): string {
  return ALFABETO[Math.floor(Math.random() * ALFABETO.length)]
}

/** Codice casuale di `n` caratteri (lettere maiuscole e cifre), con prefisso opzionale. */
function codiceCasuale(n: number, prefisso = ''): string {
  let c = prefisso
  while (c.length < n) c += carattereCasuale()
  return c
}

/**
 * IBAN italiano valido (27 caratteri) con numero di conto casuale: BBAN = CIN + ABI + CAB +
 * 12 cifre, cifre di controllo = 98 - (BBAN + "IT00") mod 97 (lettere A=10 ... Z=35).
 */
function ibanCasualeValido(): string {
  const cifre = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
  const bban = `X${cifre(5)}${cifre(5)}${cifre(12)}`
  const numerico = (bban + 'IT00')
    .split('')
    .map(ch => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch))
    .join('')
  const resto = Number(BigInt(numerico) % 97n)
  const controllo = String(98 - resto).padStart(2, '0')
  return `IT${controllo}${bban}`
}

const codici = {
  condizione: codiceCasuale(8, 'E'),
  conto: codiceCasuale(8, 'E'),
  spesa: codiceCasuale(8, 'E'),
  testo: codiceCasuale(3),
}
const iban = ibanCasualeValido()
const descrizioni = {
  condizione: conPrefisso('Cond 30-60 FM'),
  conto: conPrefisso('Conto di prova'),
  spesa: conPrefisso('Bollo di prova'),
  testo: conPrefisso('Testo di prova'),
  categoria: conPrefisso('Categoria rapida'),
}
let codiceRegistro = ''
let codiceCategoria = ''

/** Cio' che il test ha creato: serve alla pulizia (codice + tabella). */
const creati: { tabella: Tabella; codice: string; query?: string }[] = []

function elencoApi(tabella: Tabella, token: string, query = ''): Promise<RigaApi[]> {
  const sep = query ? `&${query}` : ''
  return apiGet<RigaApi[]>(`/${tabella}?incluseDisattivate=true${sep}`, token)
}

async function apriTabelle(page: Page, scheda: string): Promise<void> {
  await page.goto('/clienti/tabelle')
  await expect(
    contenuto(page).getByRole('heading', { level: 1, name: 'Tabelle di fatturazione' })
  ).toBeVisible()
  await contenuto(page).getByRole('tab', { name: scheda }).click()
}

/**
 * Il titolo della pagina compare due volte (topbar + `<h1>` del contenuto) e il menu ha una
 * voce omonima: tutto cio' che non e' un dialog o un'opzione di dropdown (appese al body)
 * si cerca dentro `#main-content`.
 */
function contenuto(page: Page) {
  return page.locator('#main-content')
}

function dialogo(page: Page) {
  return page.getByRole('dialog')
}

test.describe('Tabelle di fatturazione — operatore', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test.beforeEach(async ({ page, context }) => {
    await loginAndSaveState(page, context, 'operator')
  })

  test.afterAll(async () => {
    if (!hasRoleCredentials('operator') || creati.length === 0) return
    const token = await apiLogin('operator')
    const errori: string[] = []
    for (const { tabella, codice, query } of creati) {
      try {
        const riga = (await elencoApi(tabella, token, query)).find(r => r.codice === codice)
        if (!riga) continue
        await apiDelete(`/${tabella}/${riga.id}?versione=${riga.versione}`, token)
      } catch (e) {
        errori.push(`${tabella}/${codice}: ${(e as Error).message}`)
      }
    }
    expect(errori, 'pulizia delle righe create dallo spec').toEqual([])
  })

  test('condizione di pagamento 30-60 fine mese', async ({ page }) => {
    await apriTabelle(page, 'Condizioni di pagamento')
    await contenuto(page).getByRole('button', { name: 'Nuova condizione' }).click()
    const dlg = dialogo(page)
    creati.push({ tabella: 'condizioni-pagamento', codice: codici.condizione })
    // Campi compilati durante l'apertura del dialog possono andare persi su un runner lento
    // (visto: `Salva` spento per 30 s con form vuoto): si ricompila finche' i valori restano.
    await expect(async () => {
      await dlg.getByLabel('Codice').fill(codici.condizione)
      await dlg.getByLabel('Descrizione').fill(descrizioni.condizione)
      await expect(dlg.getByLabel('Codice')).toHaveValue(codici.condizione, { timeout: 1_000 })
      await expect(dlg.getByRole('button', { name: 'Salva' })).toBeEnabled({ timeout: 1_000 })
    }).toPass({ timeout: 20_000 })
    await aggiungiRata(dlg, '30')
    await aggiungiRata(dlg, '60')
    await dlg.getByText('Fine mese', { exact: true }).click()
    await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)

    const riga = contenuto(page).getByRole('row', { name: new RegExp(codici.condizione) })
    await expect(riga).toContainText(descrizioni.condizione)
    await expect(riga).toContainText('30-60 gg fine mese')
    await expect(riga).toContainText('Attiva')
  })

  test('disattiva e riattiva la condizione', async ({ page }) => {
    await apriTabelle(page, 'Condizioni di pagamento')
    const riga = contenuto(page).getByRole('row', { name: new RegExp(codici.condizione) })
    await riga.getByRole('button', { name: 'Disattiva' }).click()
    await expect(riga).toContainText('Disattivata')
    await riga.getByRole('button', { name: 'Riattiva' }).click()
    await expect(riga).toContainText('Attiva')
    await expect(riga).not.toContainText('Disattivata')
  })

  test('conto corrente con IBAN mascherato in elenco', async ({ page }) => {
    await apriTabelle(page, 'Conti correnti')
    await contenuto(page).getByRole('button', { name: 'Nuovo conto' }).click()
    const dlg = dialogo(page)
    await dlg.getByLabel('Codice').fill(codici.conto)
    creati.push({ tabella: 'conti-correnti', codice: codici.conto })
    await dlg.getByLabel('Descrizione').fill(descrizioni.conto)
    await dlg.getByLabel('Banca').fill('Banca di prova')
    await dlg.getByLabel('IBAN').fill(iban)
    await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)

    const riga = contenuto(page).getByRole('row', { name: new RegExp(codici.conto) })
    await expect(riga).toContainText(`${iban.slice(0, 4)} **** **** ${iban.slice(-4)}`)
    // L'IBAN completo non compare mai nell'elenco.
    await expect(riga).not.toContainText(iban)
    await expect(riga).not.toContainText(iban.slice(4, 14))
  })

  test('spesa di bollo', async ({ page }) => {
    await apriTabelle(page, 'Spese e bollo')
    await contenuto(page).getByTestId('spesa-filtro').click()
    const opzioneBollo = page.getByRole('option', { name: 'Bollo', exact: true })
    await opzioneBollo.click()
    // Il pannello del filtro si chiude con un'animazione e il dropdown rimette il fuoco su di
    // se': si apre il dialog solo a pannello sparito, altrimenti su un runner lento i due si
    // sovrappongono.
    await expect(opzioneBollo).toBeHidden()
    await contenuto(page).getByRole('button', { name: 'Nuova spesa' }).click()
    const dlg = dialogo(page)
    await expect(dlg.getByTestId('spesa-dlg-tipo-fisso')).toHaveText('Bollo')
    creati.push({ tabella: 'spese-accessorie', codice: codici.spesa })
    // Riempie e verifica che Salva si abiliti: se il form viene reinizializzato dopo il
    // riempimento (apertura del dialog che completa dopo il primo fill) si riparte da capo,
    // invece di attendere per sempre un pulsante disabilitato.
    await expect(async () => {
      await dlg.getByLabel('Codice').fill(codici.spesa)
      await dlg.getByLabel('Descrizione').fill(descrizioni.spesa)
      await dlg.getByLabel('Importo (euro)').fill('2,00')
      await expect(dlg.getByLabel('Codice')).toHaveValue(codici.spesa, { timeout: 1_000 })
      await expect(dlg.getByRole('button', { name: 'Salva' })).toBeEnabled({ timeout: 1_000 })
    }).toPass({ timeout: 10_000 })
    await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)

    const riga = contenuto(page).getByRole('row', { name: new RegExp(codici.spesa) })
    await expect(riga).toContainText('Bollo')
    await expect(riga).toContainText(descrizioni.spesa)
    await expect(riga).toContainText('2.00')
  })

  test('registro IVA: "1" diventa "01"', async ({ page }) => {
    const token = await apiLogin('operator')
    const occupati = new Set((await elencoApi('registri-iva', token)).map(r => r.codice))
    const libero = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].find(n => !occupati.has(`0${n}`))
    test.skip(
      libero === undefined,
      'registri 01-09 tutti occupati nell azienda di prova: impossibile provare l inserimento di una sola cifra'
    )
    codiceRegistro = `0${libero}`

    await apriTabelle(page, 'Registri IVA')
    await contenuto(page).getByRole('button', { name: 'Nuovo registro' }).click()
    const dlg = dialogo(page)
    await dlg.getByLabel('Codice').fill(libero!)
    creati.push({ tabella: 'registri-iva', codice: codiceRegistro })
    await dlg.getByLabel('Descrizione').fill(conPrefisso('Registro di prova'))
    await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)

    await expect(contenuto(page).getByTestId(`registro-riga-${codiceRegistro}`)).toBeVisible()
    await expect(contenuto(page).getByTestId(`registro-riga-${codiceRegistro}`)).toContainText(
      conPrefisso('Registro di prova')
    )
  })

  test('testo di fatturazione', async ({ page }) => {
    const token = await apiLogin('operator')
    const occupati = new Set((await elencoApi('testi-fatturazione', token)).map(r => r.codice))
    while (occupati.has(codici.testo)) codici.testo = codiceCasuale(3)

    await apriTabelle(page, 'Testi di fatturazione')
    await contenuto(page).getByRole('button', { name: 'Nuovo testo' }).click()
    const dlg = dialogo(page)
    creati.push({ tabella: 'testi-fatturazione', codice: codici.testo })
    // Se il dialog si inizializza in ritardo (runner lento) azzera i campi gia' compilati: si
    // ricompila finche' i valori restano e `Salva` e' abilitato, prima di salvare.
    await expect(async () => {
      await dlg.getByLabel('Codice').fill(codici.testo)
      await dlg.getByLabel('Titolo').fill(descrizioni.testo)
      await dlg.getByLabel('Riga 1', { exact: true }).fill('Pagamento tramite bonifico bancario.')
      await expect(dlg.getByLabel('Codice')).toHaveValue(codici.testo, { timeout: 1_000 })
      await expect(dlg.getByRole('button', { name: 'Salva' })).toBeEnabled({ timeout: 1_000 })
    }).toPass({ timeout: 20_000 })
    await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)

    await expect(
      contenuto(page).getByRole('row', { name: new RegExp(descrizioni.testo) })
    ).toBeVisible()
  })

  test('categoria con codice assegnato dal server', async ({ page }) => {
    await apriTabelle(page, 'Categorie e tipi')
    await contenuto(page).getByTestId('codifica-nuova-CATEGORIA').click()
    const dlg = dialogo(page)
    // Il codice e' proposto: lo si svuota, cosi' lo assegna il server (come nella modalita' rapida).
    await dlg.getByLabel('Codice').fill('')
    await dlg.getByLabel('Descrizione').fill(descrizioni.categoria)
    await cliccaEChiudi(page, dlg.getByRole('button', { name: 'Salva' }), dlg)

    const riga = contenuto(page).getByRole('row', { name: new RegExp(descrizioni.categoria) })
    await expect(riga).toBeVisible()
    const token = await apiLogin('operator')
    const lista = await apiGet<(RigaApi & { descrizione: string })[]>(
      '/codifiche-contratto?genere=CATEGORIA&incluseDisattivate=true',
      token
    )
    const creata = lista.find(r => r.descrizione === descrizioni.categoria)
    expect(creata, 'la categoria creata deve comparire in elenco').toBeTruthy()
    codiceCategoria = creata!.codice
    creati.push({
      tabella: 'codifiche-contratto',
      codice: codiceCategoria,
      query: 'genere=CATEGORIA',
    })
    expect(codiceCategoria).not.toBe('')
    await expect(riga).toContainText(codiceCategoria)
  })
})

test.describe('Tabelle di fatturazione — VIEWER', () => {
  test.skip(!hasRoleCredentials('viewer'), skipReason('viewer'))

  test('vede le schede senza pulsanti di scrittura', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'viewer')
    await page.goto('/clienti/tabelle')
    await expect(
      contenuto(page).getByRole('heading', { level: 1, name: 'Tabelle di fatturazione' })
    ).toBeVisible()

    const schede: { scheda: string; nuovo: string }[] = [
      { scheda: 'Condizioni di pagamento', nuovo: 'Nuova condizione' },
      { scheda: 'Conti correnti', nuovo: 'Nuovo conto' },
      { scheda: 'Spese e bollo', nuovo: 'Nuova spesa' },
      { scheda: 'Registri IVA', nuovo: 'Nuovo registro' },
      { scheda: 'Testi di fatturazione', nuovo: 'Nuovo testo' },
    ]
    for (const { scheda, nuovo } of schede) {
      await contenuto(page).getByRole('tab', { name: scheda }).click()
      await expect(contenuto(page).getByRole('tabpanel').getByRole('table')).toBeVisible()
      await expect(contenuto(page).getByRole('button', { name: nuovo })).toHaveCount(0)
      await expect(contenuto(page).getByRole('button', { name: 'Modifica' })).toHaveCount(0)
      await expect(
        contenuto(page).getByRole('button', { name: /^(Disattiva|Riattiva)$/ })
      ).toHaveCount(0)
      await expect(contenuto(page).getByRole('button', { name: 'Elimina' })).toHaveCount(0)
    }
    await contenuto(page).getByRole('tab', { name: 'Categorie e tipi' }).click()
    await expect(contenuto(page).getByRole('button', { name: /^Nuov[oa]$/ })).toHaveCount(0)
    await contenuto(page).getByRole('tab', { name: 'Motivi di annullo' }).click()
    await expect(contenuto(page).getByRole('button', { name: /^Nuov[oa]$/ })).toHaveCount(0)
  })
})
