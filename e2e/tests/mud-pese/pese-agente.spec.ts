import { test, expect, type Page } from '@playwright/test'
import {
  accediUiComeAzienda,
  assicuraDbLocale,
  clientDbLocale,
  creaAziendaDiTest,
  creaSuperAdminDiTest,
  eliminaAziendaDiTest,
  saltaSeDbNonLocale,
  MOTIVO_DB_NON_LOCALE,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { devLoginTokens } from '../../utils/api-client'
import { getApiUrl } from '../../utils/env'
import { AgenteFinto } from '../../utils/agente-finto'
import { ATTESA_SERVER } from '../../utils/attese'

/**
 * E2E dell'agente di pesa (4.8b), tutto con pesate SIMULATE e un agente FINTO in Node
 * (`utils/agente-finto.ts`): il SUPER_ADMIN ammette la simulazione per l'azienda di prova; l'ADMIN
 * crea un agente e legge il codice; l'agente si abbina e manda il battito; l'ADMIN gli assegna lo
 * strumento; l'agente invia due letture SIMULATE; l'agente risulta «In linea»; l'operatore apre un
 * accesso a DOPPIA pesata scegliendo la prima lettura e poi la seconda; il netto e' calcolato e il
 * badge e' «Simulata»; l'ADMIN revoca l'agente e l'agente riceve 403.
 *
 * Lavora in un'AZIENDA DI TEST PROPRIA. Le pesate non si cancellano (immutabili): l'azienda resta
 * nel database di test, riconoscibile dal prefisso della run.
 */
const db = clientDbLocale()
const LORDO = '24880.00'
const TARA = '12540.00'

let azienda: AziendaDiTest
let superAdminId: string | null = null
let strumentoId = ''
const problemiPulizia: string[] = []

async function api<T = unknown>(
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH',
  percorso: string,
  token: string,
  corpo?: unknown
): Promise<{ stato: number; corpo: T }> {
  const r = await fetch(`${getApiUrl()}${percorso}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const testo = await r.text()
  return { stato: r.status, corpo: (testo ? JSON.parse(testo) : null) as T }
}

async function apriAgenti(page: Page): Promise<void> {
  await page.goto('/pese')
  await expect(page.getByRole('heading', { level: 1, name: 'Pese' })).toBeVisible({
    timeout: ATTESA_SERVER,
  })
  await page.getByTestId('pese-scheda-agenti').click()
  await expect(page.getByTestId('ag-tabella')).toBeVisible({ timeout: ATTESA_SERVER })
}

test.describe.serial('Agente di pesa simulato: dall’abbinamento al netto', () => {
  test.skip(saltaSeDbNonLocale(db), MOTIVO_DB_NON_LOCALE)

  let agente: AgenteFinto

  test.beforeAll(async () => {
    assicuraDbLocale(db)
    azienda = await creaAziendaDiTest(db, 'pese agente')
    // Un registro (sede): l'accesso ne richiede uno; con una sola il dialogo lo sceglie da solo.
    await db.registroRifiuti.create({
      data: { tenantId: azienda.tenantId, descrizione: 'Registro e2e', codice: 'A' },
    })
    const sa = await creaSuperAdminDiTest(db, azienda.tenantId, 'pese agente')
    superAdminId = sa.id

    // SUPER_ADMIN: ammette le pesate simulate per questa azienda di prova.
    const tkSa = (await devLoginTokens(sa.email)).accessToken
    const r = await api('PATCH', `/admin/tenants/${azienda.tenantId}/pese-simulazione`, tkSa, {
      ammessa: true,
    })
    expect(r.stato, `pese-simulazione: ${JSON.stringify(r.corpo)}`).toBe(200)

    // Setup via API (il passo sotto test e' l'agente, non l'anagrafica dello strumento).
    const tkAdmin = await tokenAzienda(azienda, 'admin')
    const s = await api<{ id: string }>('POST', '/pese/strumenti', tkAdmin, {
      descrizione: 'Pesa a ponte e2e',
      attivo: true,
    })
    expect(s.stato, `strumento: ${JSON.stringify(s.corpo)}`).toBe(201)
    strumentoId = s.corpo.id
  })

  test.afterAll(async () => {
    if (db) {
      problemiPulizia.push(
        ...(await eliminaAziendaDiTest(db, azienda, superAdminId ? [superAdminId] : []))
      )
      if (problemiPulizia.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[pese-agente] pulizia incompleta (warning): ${problemiPulizia.join(' | ')}`)
      }
      await db.$disconnect()
    }
  })

  test('l’ADMIN crea l’agente e legge il codice; l’agente si abbina e risulta «In linea»', async ({
    page,
  }) => {
    await accediUiComeAzienda(page, azienda, 'admin')
    await apriAgenti(page)
    await page.getByTestId('ag-nuovo').click()
    await page.getByTestId('ag-descrizione').fill('PC pesa e2e')
    await page.getByTestId('ag-salva').click()

    const codiceUi = page.getByTestId('ag-codice')
    await expect(codiceUi).toBeVisible({ timeout: ATTESA_SERVER })
    const codice = ((await codiceUi.textContent()) ?? '').replace(/[^A-Za-z0-9]/g, '')
    expect(codice).toMatch(/^[A-Z0-9]{12}$/)
    await page.getByTestId('ag-chiudi').click()

    agente = await AgenteFinto.abbina(codice)
    expect((await agente.battito()).stato).toBe(200)

    await apriAgenti(page)
    await expect(page.getByTestId(`ag-stato-${agente.agenteId}`)).toHaveText('In linea', {
      timeout: ATTESA_SERVER,
    })

    // L'ADMIN assegna lo strumento all'agente dalla scheda Agenti.
    await page.getByTestId(`ag-assegna-${agente.agenteId}`).selectOption(strumentoId)
    await expect(page.getByTestId(`ag-libera-${strumentoId}`)).toBeVisible({
      timeout: ATTESA_SERVER,
    })
  })

  test('l’agente invia due letture SIMULATE e l’operatore le usa in un accesso a doppia pesata', async ({
    page,
  }) => {
    const battito = await agente.battito([{ strumentoId, stato: 'OK' }])
    expect(battito.stato).toBe(200)
    const invio = await agente.inviaLetture(strumentoId, [LORDO, TARA])
    expect(invio.stato, JSON.stringify(invio.corpo)).toBe(200)
    expect(invio.corpo.esiti.map(e => e.esito)).toEqual(['ACCETTATA', 'ACCETTATA'])

    await accediUiComeAzienda(page, azienda, 'operator')
    await page.goto('/pese')
    await page.getByTestId('ac-nuovo').click()
    await page.getByTestId('na-modo').selectOption('DOPPIA')
    await page.getByTestId('na-targa').fill('EE123FF')

    const elenco = page.getByTestId('ls-elenco')
    await expect(elenco).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(elenco.getByTestId('ls-simulata')).toHaveCount(2)
    await elenco
      .locator('label', { hasText: /24\.880/ })
      .locator('input[type="radio"]')
      .check()
    await page.getByTestId('na-salva').click()

    // Dettaglio dell'accesso: seconda pesata con la seconda lettura.
    await expect(page.getByTestId('ad-seconda')).toBeVisible({ timeout: ATTESA_SERVER })
    await page.getByTestId('ad-seconda').click()
    const elenco2 = page.getByTestId('ls-elenco')
    await expect(elenco2).toBeVisible({ timeout: ATTESA_SERVER })
    await elenco2
      .locator('label', { hasText: /12\.540/ })
      .locator('input[type="radio"]')
      .check()
    await page.getByTestId('sp-salva').click()

    await expect(page.getByTestId('ad-netto-valore')).toContainText(/12\.340/, {
      timeout: ATTESA_SERVER,
    })
    await expect(page.getByTestId('ad-avviso-simulata')).toBeVisible()
    await expect(page.getByTestId('ad-pesate')).toContainText('Simulata')
  })

  test('l’ADMIN revoca l’agente e l’agente riceve 403', async ({ page }) => {
    await accediUiComeAzienda(page, azienda, 'admin')
    await apriAgenti(page)
    await page.getByTestId(`ag-revoca-${agente.agenteId}`).click()
    await page.getByTestId('md-motivo').fill('PC dismesso (prova e2e)')
    await page.getByTestId('md-conferma').click()
    await expect(page.getByTestId(`ag-stato-${agente.agenteId}`)).toContainText('Revocato', {
      timeout: ATTESA_SERVER,
    })

    expect((await agente.battito()).stato).toBe(403)
    expect((await agente.inviaLetture(strumentoId, [LORDO])).stato).toBe(403)
  })
})
