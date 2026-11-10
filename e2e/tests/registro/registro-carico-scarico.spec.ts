import { test, expect, type Page } from '@playwright/test'
import {
  accediUiComeAzienda,
  assicuraDbLocale,
  clientDbLocale,
  MOTIVO_DB_NON_LOCALE,
  saltaSeDbNonLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER, attendiRisposta } from '../../utils/attese'
import { CER_A, CER_B, chiama, giornoItaliano, ok } from '../../utils/legami-api'
import { conPrefissoUnico } from '../../utils/run-id'
import { LegamiPage } from '../../pages/legami.page'

/**
 * Registro cronologico C/S (art. 190 D.Lgs 152/2006): elenco, registrazione di un movimento e
 * filtri, dall'interfaccia della pagina «Registro».
 *
 * Isolamento. Il database della CI parte vuoto e quello locale dura nel tempo: `beforeAll` crea
 * un'AZIENDA DI TEST dedicata (admin / operator / viewer) e vi registra via API tre movimenti noti
 * (carico CER A, carico CER B, scarico CER A). Nulla dipende da righe preesistenti.
 *
 * Pulizia. I movimenti del registro sono immutabili (catena di hash, nessuna cancellazione): come
 * negli altri spec con un'azienda dedicata, l'azienda, i suoi utenti e i suoi movimenti RESTANO nel
 * database di test, riconoscibili dal prefisso della run nella ragione sociale. Qui non si creano
 * altri dati.
 *
 * Gli scenari girano in serie: un nuovo accesso dello stesso utente invalida la sessione precedente.
 */

const db = clientDbLocale()

let azienda: AziendaDiTest
let tokenAdmin: string
const ids: { caricoA: string; caricoB: string; scaricoA: string } = {
  caricoA: '',
  caricoB: '',
  scaricoA: '',
}

async function registraMovimento(corpo: Record<string, unknown>): Promise<string> {
  const r = await chiama<{ id?: string; movimento?: { id: string } }>(
    'POST',
    '/registro',
    tokenAdmin,
    {
      movementDate: giornoItaliano(),
      unit: 'KG',
      counterpartName: conPrefissoUnico('Controparte registro'),
      ...corpo,
    }
  )
  expect(r.stato, `POST /registro: ${JSON.stringify(r.corpo)}`).toBe(201)
  return (r.corpo.id ?? r.corpo.movimento?.id)!
}

async function apriRegistro(page: Page): Promise<void> {
  await accediUiComeAzienda(page, azienda, 'operator')
  await new LegamiPage(page).vaiAlRegistro()
}

test.describe('Registro carico/scarico', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 })
  test.skip(saltaSeDbNonLocale(db), MOTIVO_DB_NON_LOCALE)

  test.beforeAll(async () => {
    assicuraDbLocale(db)
    azienda = await creaAziendaDiTest(db, 'registro C/S')
    tokenAdmin = await tokenAzienda(azienda, 'admin')
    await ok('POST', '/registro/registri/assicura', tokenAdmin)
    ids.caricoA = await registraMovimento({
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: CER_A,
      quantity: 20,
    })
    ids.caricoB = await registraMovimento({
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: CER_B,
      quantity: 5,
    })
    ids.scaricoA = await registraMovimento({
      type: 'SCARICO',
      causale: 'ALTRO_SCARICO',
      cerCode: CER_A,
      quantity: 3,
    })
  })

  test.afterAll(async () => {
    await db?.$disconnect()
  })

  test('elenco movimenti consultabile: i movimenti dell’azienda, con tipo, CER e quantità', async ({
    page,
  }) => {
    await apriRegistro(page)

    for (const id of [ids.caricoA, ids.caricoB, ids.scaricoA]) {
      await expect(page.getByTestId(`registro-riga-${id}`)).toBeVisible({ timeout: ATTESA_SERVER })
    }
    const caricoA = page.getByTestId(`registro-riga-${ids.caricoA}`)
    await expect(caricoA.getByTestId('registro-tipo')).toHaveText(/Carico/)
    await expect(caricoA).toContainText(CER_A)
    await expect(
      page.getByTestId(`registro-riga-${ids.scaricoA}`).getByTestId('registro-tipo')
    ).toHaveText(/Scarico/)
    // L'elenco coincide con quello del server (3 righe, tutte e sole quelle dell'azienda).
    const elenco = await ok<{ total: number; items: { id: string }[] }>(
      'GET',
      '/registro?limit=50',
      tokenAdmin
    )
    expect(elenco.total).toBe(3)
    await expect(page.locator('[data-testid^="registro-riga-"]')).toHaveCount(elenco.items.length)
  })

  test('inserimento di un nuovo movimento di carico dal form «Registra movimento»', async ({
    page,
  }) => {
    await apriRegistro(page)
    const legami = new LegamiPage(page)
    const controparte = conPrefissoUnico('Controparte inserimento UI')
    await legami.compilaCarico({ cer: CER_B, quantita: '7,5', controparte })

    // Senza listino/cliente il blocco «Fatturazione» non propone nulla: si registra e basta.
    const registra = page.getByTestId('registra').or(page.getByTestId('registra-senza-collegare'))
    const risposta = await attendiRisposta(page, () => registra.first().click(), {
      metodo: 'POST',
      percorso: /^\/registro(\?|$)/,
    })
    const creato = (await risposta.json()) as { id?: string; movimento?: { id: string } }
    const id = (creato.id ?? creato.movimento?.id)!
    expect(id).toBeTruthy()

    await expect(page.locator('form.mov-form')).toBeHidden({ timeout: ATTESA_SERVER })
    const riga = page.getByTestId(`registro-riga-${id}`)
    await expect(riga).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(riga.getByTestId('registro-tipo')).toHaveText(/Carico/)
    await expect(riga).toContainText(CER_B)
    await expect(riga).toContainText(controparte)

    const elenco = await ok<{
      items: { id: string; quantity: number | string; type: string }[]
    }>('GET', '/registro?limit=50', tokenAdmin)
    const salvato = elenco.items.find(m => m.id === id)!
    expect(Number(salvato.quantity)).toBe(7.5)
    expect(salvato.type).toBe('CARICO')
  })

  test('filtro dell’elenco per tipo e per codice CER', async ({ page }) => {
    await apriRegistro(page)
    const righe = page.locator('[data-testid^="registro-riga-"]')
    await expect(page.getByTestId(`registro-riga-${ids.caricoA}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })

    // Tipo = Scarico: resta solo lo scarico.
    await page.locator('p-dropdown:has(#filtro-tipo)').click()
    await attendiRisposta(
      page,
      () => page.getByRole('option', { name: 'Scarico', exact: true }).click(),
      {
        metodo: 'GET',
        percorso: /^\/registro\?/,
      }
    )
    await expect(page.getByTestId(`registro-riga-${ids.scaricoA}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId(`registro-riga-${ids.caricoA}`)).toHaveCount(0)
    await expect(page.getByTestId(`registro-riga-${ids.caricoB}`)).toHaveCount(0)

    // Azzera: tornano tutti.
    await attendiRisposta(page, () => page.getByRole('button', { name: 'Azzera filtri' }).click(), {
      metodo: 'GET',
      percorso: /^\/registro\?/,
    })
    await expect(page.getByTestId(`registro-riga-${ids.caricoA}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })

    // CER = 15 01 07: restano solo le righe di quel codice (il carico B e quello inserito prima).
    await page.getByLabel('Filtra per codice CER').fill(CER_B)
    await attendiRisposta(
      page,
      () => page.getByRole('button', { name: 'Applica filtri' }).click(),
      {
        metodo: 'GET',
        percorso: /^\/registro\?/,
      }
    )
    await expect(page.getByTestId(`registro-riga-${ids.caricoB}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId(`registro-riga-${ids.caricoA}`)).toHaveCount(0)
    await expect(page.getByTestId(`registro-riga-${ids.scaricoA}`)).toHaveCount(0)
    for (const cella of await righe.all()) {
      await expect(cella).toContainText(CER_B)
    }
  })
})
