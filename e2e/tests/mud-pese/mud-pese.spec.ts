import { test, expect, type Page } from '@playwright/test'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { ATTESA_SERVER } from '../../utils/attese'

/**
 * E2E minimo di Pese e MUD (seguito della revisione del Task 13): le due pagine si aprono con il
 * loro titolo, le schede di Pese si scorrono, l'interruttore dell'obbligo del MUD dice a parole
 * «Tenuta» / «Non tenuta» (non solo col colore) e a 390 px nessuna delle due scorre di lato.
 * Lavora in un'AZIENDA DI TEST PROPRIA e non salva nulla: l'interruttore si prova solo nella UI.
 */
const db = clientDbLocale()
let azienda: AziendaDiTest

async function senzaScrollOrizzontale(page: Page): Promise<void> {
  const [largo, visibile] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ])
  expect(largo, 'scrollWidth della pagina').toBeLessThanOrEqual(visibile)
}

test.describe('Pese e MUD: apertura delle pagine', () => {
  test.skip(!db, 'serve un database locale (DATABASE_URL) per creare l’azienda di test')

  test.beforeAll(async () => {
    if (!db) return
    azienda = await creaAziendaDiTest(db, 'mud pese')
  })

  test.afterAll(async () => {
    await db?.$disconnect()
  })

  test.beforeEach(async ({ page }) => {
    await accediUiComeAzienda(page, azienda, 'admin')
  })

  test('Pese: si apre col titolo, ha le tre schede e si passa dall’una all’altra', async ({
    page,
  }) => {
    await page.goto('/pese')
    await expect(page.getByRole('heading', { level: 1, name: 'Pese' })).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    const schede = page.getByRole('tablist', { name: 'Sezioni delle pese' }).getByRole('tab')
    await expect(schede).toHaveCount(3)
    await expect(page.getByTestId('pese-scheda-accessi')).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('pese-scheda-strumenti').click()
    await expect(page.getByTestId('pese-scheda-strumenti')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('pese-scheda-accessi')).toHaveAttribute('aria-selected', 'false')
  })

  test('MUD: si apre col titolo e l’interruttore dell’obbligo dice «Tenuta» / «Non tenuta»', async ({
    page,
  }) => {
    await page.goto('/mud')
    await expect(
      page.getByRole('heading', { level: 1, name: /MUD — Dichiarazione Ambientale/ })
    ).toBeVisible({ timeout: ATTESA_SERVER })
    const stato = page.getByTestId('mud-obbligo-stato')
    await expect(stato).toBeVisible({ timeout: ATTESA_SERVER })
    await expect(stato).toHaveText('Tenuta')
    await page.getByTestId('mud-obbligo-interruttore').click()
    await expect(stato).toHaveText('Non tenuta')
    await page.getByTestId('mud-obbligo-interruttore').click()
    await expect(stato).toHaveText('Tenuta')
  })

  test('a 390 px né Pese né MUD scorrono di lato', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/pese')
    await expect(page.getByRole('heading', { level: 1, name: 'Pese' })).toBeVisible({
      timeout: ATTESA_SERVER,
    })
    await senzaScrollOrizzontale(page)
    await page.goto('/mud')
    await expect(page.getByTestId('mud-obbligo-stato')).toBeVisible({ timeout: ATTESA_SERVER })
    await senzaScrollOrizzontale(page)
  })
})
