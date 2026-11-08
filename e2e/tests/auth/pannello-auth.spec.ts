import { test, expect } from '@playwright/test'

/**
 * Layout del pannello di marca di Login e Richiedi accesso: non supera il 40% sopra i 992 px
 * e sparisce sotto i 768 px (resta il marchio sopra il form). Non richiede credenziali.
 */
const PAGINE = ['/login', '/richiedi-accesso']
const VIEWPORT = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]

for (const percorso of PAGINE) {
  for (const viewport of VIEWPORT) {
    test(`${percorso} a ${viewport.width}px: pannello visibile e al massimo il 40%`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto(percorso)
      const pannello = page.locator('.auth__brand')
      await expect(pannello).toBeVisible()
      const larghezzaPannello = (await pannello.boundingBox())!.width
      const larghezzaPagina = (await page.locator('.auth').boundingBox())!.width
      expect(larghezzaPannello).toBeLessThanOrEqual(larghezzaPagina * 0.4 + 1)
    })
  }

  test(`${percorso} a 390px: pannello nascosto e marchio sopra il form`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(percorso)
    await expect(page.locator('.auth__brand')).toBeHidden()
    await expect(page.locator('.auth__logo-mobile').first()).toBeVisible()
  })
}
