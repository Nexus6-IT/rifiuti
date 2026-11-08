import type { Locator, Page } from '@playwright/test'

/**
 * Azioni di riga delle liste (componente `app-azioni-riga`): l'azione principale e' un bottone sulla
 * riga, le altre stanno nel menu aperto dal bottone ⋯ («Altre azioni per <nome>»), appeso al body.
 * Questi helper trattano le due forme allo stesso modo, cosi' un test non dipende da quale azione
 * e' la principale e funziona prima e dopo la conversione di una pagina al pattern.
 */

/** Bottone ⋯ della riga, se la riga ha un menu. */
function kebab(riga: Locator): Locator {
  return riga.locator('button[aria-haspopup="menu"]')
}

/** Voci del menu aperto (il menu sta nel body, non dentro la riga). */
function vociMenu(page: Page): Locator {
  return page.getByRole('menuitem')
}

async function apriMenu(page: Page, riga: Locator): Promise<void> {
  await kebab(riga).click()
  await vociMenu(page).first().waitFor({ state: 'visible' })
}

async function chiudiMenu(page: Page, riga: Locator): Promise<void> {
  if (await vociMenu(page).first().isVisible()) {
    await page.keyboard.press('Escape')
    await vociMenu(page).first().waitFor({ state: 'hidden' })
  }
  await kebab(riga).waitFor({ state: 'visible' })
}

/**
 * Esegue un'azione della riga: clicca il bottone con quel nome se c'e' sulla riga, altrimenti apre
 * il menu ⋯ e sceglie la voce.
 * @param nome testo o espressione regolare del nome accessibile (bottone) o dell'etichetta (voce)
 */
export async function eseguiAzioneRiga(
  page: Page,
  riga: Locator,
  nome: string | RegExp
): Promise<void> {
  const bottone = riga.getByRole('button', { name: nome })
  if ((await bottone.count()) > 0) {
    await bottone.first().click()
    return
  }
  await apriMenu(page, riga)
  await vociMenu(page).filter({ hasText: nome }).first().click()
}

/**
 * Nomi di tutte le azioni della riga: i bottoni (senza il ⋯) e le voci del menu. Apre il menu per
 * leggerle e lo richiude, lasciando il focus sul ⋯.
 */
export async function nomiAzioniRiga(page: Page, riga: Locator): Promise<string[]> {
  const bottoni = await riga
    .locator('button:not([aria-haspopup="menu"])')
    .evaluateAll(els =>
      els
        .map(e => (e.getAttribute('aria-label') ?? e.textContent ?? '').trim())
        .filter(t => t.length > 0)
    )
  if ((await kebab(riga).count()) === 0) {
    return bottoni
  }
  await apriMenu(page, riga)
  const voci = (await vociMenu(page).allTextContents()).map(t => t.trim())
  await chiudiMenu(page, riga)
  return [...bottoni, ...voci]
}
