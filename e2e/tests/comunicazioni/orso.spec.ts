import { readFileSync } from 'fs'
import { join } from 'path'
import { test, expect } from '@playwright/test'
import type { PrismaClient } from '@prisma/client'
import { validateXML } from 'xmllint-wasm'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  eliminaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER, attendiRisposta, percorsoApi } from '../../utils/attese'
import { chiama } from '../../utils/legami-api'
import { conPrefissoUnico } from '../../utils/run-id'

/**
 * E2E delle comunicazioni O.R.SO. (4.9a, T7), contro backend, Postgres e Redis reali.
 *
 * Due aziende di prova create qui: ENTERPRISE (ha il modulo `comunicazioni`) e PROFESSIONAL
 * (non lo ha). Nell'ENTERPRISE: una sede con provincia, tre scarichi nell'anno corrente creati
 * via API (due CER, due mesi) -> anteprima con mesi e CER -> Genera -> scarica l'XML e lo valida
 * contro l'XSD in fixture -> Segna inviata. Nella PROFESSIONAL: la pagina non si apre e nessuna
 * chiamata API viene respinta con 403.
 *
 * Pulizia per id esatti: comunicazioni (e le istantanee, a cascata) e sede-registro non si
 * cancellano dall'API; i movimenti del registro sono immutabili e restano, come per gli altri
 * spec, nell'azienda di prova riconoscibile dal prefisso della run.
 */

const XSD = readFileSync(
  join(
    __dirname,
    '../../../apps/backend/src/domain/comunicazioni/orso/__fixtures__/ImpiantoMesi.xsd'
  ),
  'utf8'
)
const db = clientDbLocale()
const ANNO = new Date().getFullYear()
const MESSAGGIO = "Il modulo non è attivo per l'azienda selezionata."

function numeroSito(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  const r = (n: number, s = A) =>
    Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('')
  return `OP${r(4, '0123456789')}${r(3)}${r(6, '0123456789')}-MI${r(4, '0123456789')}`
}

test.describe('Comunicazioni O.R.SO.', () => {
  test.skip(
    !db,
    'DATABASE_URL non e` un database locale: senza il client del proprietario non si creano le aziende di prova'
  )
  test.describe.configure({ mode: 'serial' })

  let owner: PrismaClient
  let conModulo: AziendaDiTest
  let senzaModulo: AziendaDiTest
  let sedeId = ''
  const comunicazioniIds: string[] = []
  const problemiPulizia: string[] = []

  const token = (a: AziendaDiTest) => tokenAzienda(a, 'admin')

  /** Carico (produzione interna) o scarico (avvio a recupero): lo scarico richiede la giacenza. */
  async function registra(
    tk: string,
    registroId: string,
    tipo: 'CARICO' | 'SCARICO',
    data: string,
    cer: string,
    kg: number
  ) {
    const r = await chiama<{ id?: string }>('POST', '/registro', tk, {
      type: tipo,
      movementDate: data,
      causale: tipo === 'CARICO' ? 'PRODUZIONE_INTERNA' : 'AVVIO_RECUPERO',
      cerCode: cer,
      wasteDescription: 'Imballaggi di prova',
      quantity: kg,
      unit: 'KG',
      ...(tipo === 'SCARICO' ? { operationCode: 'R13' } : {}),
      counterpartName: conPrefissoUnico('Destinatario O.R.SO.'),
      registroId,
    })
    expect(r.stato, `POST /registro: ${JSON.stringify(r.corpo)}`).toBe(201)
  }

  test.beforeAll(async () => {
    owner = db!
    conModulo = await creaAziendaDiTest(owner, 'Orso con modulo', 'ENTERPRISE')
    senzaModulo = await creaAziendaDiTest(owner, 'Orso senza modulo', 'PROFESSIONAL')
    const tk = await token(conModulo)
    const sede = await chiama<{ id: string }>('POST', '/rentri/unita-locali', tk, {
      numIscrSito: numeroSito(),
      denominazione: conPrefissoUnico('Sede O.R.SO.'),
      principale: true,
    })
    expect(sede.stato, JSON.stringify(sede.corpo)).toBe(201)
    sedeId = sede.corpo.id
    const agg = await chiama('PUT', `/rentri/unita-locali/${sedeId}`, tk, { provincia: 'MI' })
    expect(agg.stato, JSON.stringify(agg.corpo)).toBe(200)
    const registri = await chiama<Array<{ id: string; unitaLocaleId: string | null }>>(
      'POST',
      '/registro/registri/assicura',
      tk
    )
    expect(registri.stato, JSON.stringify(registri.corpo)).toBe(200)
    const registro = registri.corpo.find(r => r.unitaLocaleId === sedeId)
    expect(registro, 'registro della sede').toBeTruthy()
    await registra(tk, registro!.id, 'CARICO', `${ANNO}-01-05`, '15 01 01', 3000)
    await registra(tk, registro!.id, 'CARICO', `${ANNO}-01-05`, '15 01 07', 1000)
    await registra(tk, registro!.id, 'SCARICO', `${ANNO}-02-10`, '15 01 01', 1200)
    await registra(tk, registro!.id, 'SCARICO', `${ANNO}-03-12`, '15 01 01', 800)
    await registra(tk, registro!.id, 'SCARICO', `${ANNO}-03-20`, '15 01 07', 500)
  })

  test.afterAll(async () => {
    if (!owner) return
    try {
      if (comunicazioniIds.length > 0) {
        await owner.comunicazioneConsorzioMovimento.deleteMany({
          where: { comunicazioneId: { in: comunicazioniIds } },
        })
        await owner.comunicazioneConsorzio.deleteMany({ where: { id: { in: comunicazioniIds } } })
      }
    } catch (e) {
      problemiPulizia.push(`comunicazioni: ${(e as Error).message.split('\n').pop()}`)
    }
    if (conModulo) problemiPulizia.push(...(await eliminaAziendaDiTest(owner, conModulo)))
    if (senzaModulo) problemiPulizia.push(...(await eliminaAziendaDiTest(owner, senzaModulo)))
    if (problemiPulizia.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[orso] pulizia incompleta (warning): ${problemiPulizia.join(' | ')}`)
    }
    await owner.$disconnect()
  })

  test('anteprima, genera, scarica un XML valido sull XSD, segna inviata', async ({ page }) => {
    await accediUiComeAzienda(page, conModulo, 'admin')
    const anteprima = page.waitForResponse(
      r => percorsoApi(r.url())?.startsWith('/comunicazioni/orso/anteprima') === true,
      { timeout: ATTESA_SERVER }
    )
    await page.goto('/comunicazioni')
    expect((await anteprima).status()).toBe(200)

    // Anteprima: mesi (febbraio, marzo) e CER, con uscite e giacenza a fine mese, senza bloccanti.
    await expect(page.getByTestId('comunicazioni-tabella')).toBeVisible({ timeout: ATTESA_SERVER })
    const righe = page.getByTestId('comunicazioni-riga')
    const riga = (mese: RegExp, cer: RegExp) =>
      righe.filter({ hasText: mese }).filter({ hasText: cer })
    await expect(riga(/Febbraio/, /15\s?01\s?01/)).toContainText('1,200 t')
    await expect(riga(/Febbraio/, /15\s?01\s?01/)).toContainText('giacenza a fine mese 1,800 t')
    await expect(riga(/Marzo/, /15\s?01\s?01/)).toContainText('0,800 t')
    await expect(riga(/Marzo/, /15\s?01\s?01/)).toContainText('giacenza a fine mese 1,000 t')
    await expect(riga(/Marzo/, /15\s?01\s?07/)).toContainText('0,500 t')
    await expect(riga(/Marzo/, /15\s?01\s?07/)).toContainText('giacenza a fine mese 0,500 t')
    await expect(page.getByTestId('comunicazioni-bloccanti')).toHaveCount(0)

    // Genera
    const genera = page.getByTestId('comunicazioni-genera')
    await expect(genera).toBeEnabled()
    const risposta = await attendiRisposta(page, () => genera.click(), {
      metodo: 'POST',
      percorso: '/comunicazioni/orso',
    })
    comunicazioniIds.push(((await risposta.json()) as { id: string }).id)
    const storico = page.getByTestId('comunicazioni-storico-riga')
    await expect(storico).toHaveCount(1, { timeout: ATTESA_SERVER })
    await expect(storico.first()).toContainText('Generata')

    // Scarica e valida sull'XSD
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: ATTESA_SERVER }),
      page.getByTestId('comunicazioni-scarica').first().click(),
    ])
    const percorso = await download.path()
    expect(percorso).toBeTruthy()
    const xml = readFileSync(percorso!, 'utf8')
    const esito = await validateXML({ xml: [{ fileName: 'f.xml', contents: xml }], schema: [XSD] })
    expect(esito.errors, JSON.stringify(esito.errors)).toEqual([])
    expect(esito.valid).toBe(true)
    expect(xml).toContain('<Mese value="2"')
    expect(xml).toContain('<Mese value="3"')

    // Segna inviata
    await page.getByTestId('comunicazioni-segna-inviata').first().click()
    await attendiRisposta(
      page,
      () => page.getByRole('button', { name: 'Segna inviata', exact: true }).last().click(),
      { metodo: 'POST', percorso: '/inviata' }
    )
    await expect(storico.first()).toContainText('Inviata', { timeout: ATTESA_SERVER })
    await expect(page.getByTestId('comunicazioni-segna-inviata')).toHaveCount(0)
  })

  test('senza il modulo: la pagina non si apre e nessuna chiamata riceve 403', async ({ page }) => {
    const respinte: string[] = []
    const errori: string[] = []
    page.on('response', r => {
      if (r.status() === 403 && percorsoApi(r.url())) respinte.push(percorsoApi(r.url())!)
    })
    page.on('console', m => {
      if (m.type() === 'error' && /403/.test(m.text())) errori.push(m.text())
    })
    await accediUiComeAzienda(page, senzaModulo, 'admin')
    await page.goto('/comunicazioni')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: ATTESA_SERVER })
    await expect(page.getByText(MESSAGGIO).first()).toBeVisible({ timeout: ATTESA_SERVER })
    await page.waitForLoadState('networkidle')
    expect(respinte, 'nessuna chiamata respinta con 403').toEqual([])
    expect(errori, 'nessun 403 in console').toEqual([])
  })
})
