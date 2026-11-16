import { test, expect } from '@playwright/test'
import type { PrismaClient } from '@prisma/client'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  eliminaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER, percorsoApi } from '../../utils/attese'
import { chiama, giornoItaliano } from '../../utils/legami-api'
import { conPrefissoUnico } from '../../utils/run-id'

/**
 * E2E O.R.SO. modalità dettagliata (4.9e): la sede passa a «dettagliata» dalla configurazione, la
 * pagina mostra la nota sull'identificazione dei soggetti e, senza FIR, i movimenti risultano
 * «soggetto non identificato» (bloccante: «Genera» resta disabilitato).
 *
 * Il file completo (I, C, Inew, NuovoImpianto) validato sull'XSD è coperto dallo spec Postgres del
 * servizio (`comunicazioni-orso-dettagliata.service.postgres.spec.ts`): qui non si costruiscono
 * FIR con ditte e anagrafiche via API, che richiederebbe decine di chiamate.
 */

const db = clientDbLocale()
const ANNO = Number(giornoItaliano().slice(0, 4)) - 1

function numeroSito(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'
  const r = (n: number, s = A) =>
    Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('')
  return `OP${r(4, '0123456789')}${r(3)}${r(6, '0123456789')}-MI${r(4, '0123456789')}`
}

test.describe('Comunicazioni O.R.SO. dettagliata', () => {
  test.skip(!db, 'DATABASE_URL non e` un database locale')
  test.describe.configure({ mode: 'serial' })

  let owner: PrismaClient
  let azienda: AziendaDiTest
  let sedeId = ''

  test.beforeAll(async () => {
    owner = db!
    azienda = await creaAziendaDiTest(owner, 'Orso dettagliata', 'ENTERPRISE')
    const tk = await tokenAzienda(azienda, 'admin')
    const sede = await chiama<{ id: string }>('POST', '/rentri/unita-locali', tk, {
      numIscrSito: numeroSito(),
      denominazione: conPrefissoUnico('Sede O.R.SO. dettagliata'),
      principale: true,
    })
    expect(sede.stato, JSON.stringify(sede.corpo)).toBe(201)
    sedeId = sede.corpo.id
    await chiama('PUT', `/rentri/unita-locali/${sedeId}`, tk, { provincia: 'MI' })
    const registri = await chiama<Array<{ id: string; unitaLocaleId: string | null }>>(
      'POST',
      '/registro/registri/assicura',
      tk
    )
    const registro = registri.corpo.find(r => r.unitaLocaleId === sedeId)
    expect(registro, 'registro della sede').toBeTruthy()
    const carico = await chiama('POST', '/registro', tk, {
      type: 'CARICO',
      movementDate: `${ANNO}-01-05`,
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '15 01 01',
      wasteDescription: 'Imballaggi di prova',
      quantity: 3000,
      unit: 'KG',
      counterpartName: conPrefissoUnico('Fonte'),
      registroId: registro!.id,
    })
    expect(carico.stato, JSON.stringify(carico.corpo)).toBe(201)
    const scarico = await chiama('POST', '/registro', tk, {
      type: 'SCARICO',
      movementDate: `${ANNO}-02-10`,
      causale: 'AVVIO_RECUPERO',
      cerCode: '15 01 01',
      wasteDescription: 'Imballaggi di prova',
      quantity: 1200,
      unit: 'KG',
      operationCode: 'R13',
      counterpartName: conPrefissoUnico('Destinatario'),
      registroId: registro!.id,
    })
    expect(scarico.stato, JSON.stringify(scarico.corpo)).toBe(201)
    const config = await chiama('PUT', `/comunicazioni/dati/sedi/${sedeId}/ORSO`, tk, {
      modalita: 'DETTAGLIATA',
    })
    expect(config.stato, JSON.stringify(config.corpo)).toBe(200)
  })

  test.afterAll(async () => {
    if (!owner) return
    if (azienda) await eliminaAziendaDiTest(owner, azienda)
    await owner.$disconnect()
  })

  test('nota sui soggetti, movimento senza FIR non identificato e Genera disabilitato', async ({
    page,
  }) => {
    await accediUiComeAzienda(page, azienda, 'admin')
    await page.goto('/comunicazioni')
    const anteprimaAnno = page.waitForResponse(
      r =>
        percorsoApi(r.url())?.startsWith('/comunicazioni/orso/anteprima') === true &&
        new URL(r.url()).searchParams.get('anno') === String(ANNO),
      { timeout: ATTESA_SERVER }
    )
    anteprimaAnno.catch(() => undefined)
    await page.getByTestId('comunicazioni-anno').click()
    await page.getByRole('option', { name: String(ANNO), exact: true }).click()
    const risposta = await anteprimaAnno
    expect(risposta.status()).toBe(200)
    const corpo = (await risposta.json()) as {
      modalita: string
      bloccanti: boolean
      avvisi: Array<{ codice: string }>
    }
    expect(corpo.modalita).toBe('DETTAGLIATA')
    expect(corpo.bloccanti).toBe(true)
    expect(corpo.avvisi.map(a => a.codice)).toContain('SOGGETTO_NON_IDENTIFICATO')

    await expect(page.getByTestId('comunicazioni-nota-dettagliata')).toContainText(
      'ricavata da WinWaste',
      { timeout: ATTESA_SERVER }
    )
    await expect(page.getByTestId('comunicazioni-avvisi')).toContainText(
      'SOGGETTO_NON_IDENTIFICATO'
    )
    await expect(page.getByTestId('comunicazioni-bloccanti')).toBeVisible()
    await expect(page.getByTestId('comunicazioni-genera')).toBeDisabled()
  })
})
