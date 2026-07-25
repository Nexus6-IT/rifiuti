import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'
import { FirListPage } from '../../pages/fir-list.page'
import { RegistryPage } from '../../pages/registry.page'

/**
 * Verifica lato UI (direttive has-permission/require-permission, cfr. audit
 * frontend §3) che un utente VIEWER non veda/non possa usare i bottoni di
 * scrittura in FIR e Anagrafiche — re-verifica dal lato UI puro dell'audit
 * RBAC già chiuso nel backend (commit 09d8fd5, vedi memoria progetto
 * rifiuti-rbac-write-gap).
 */

test.describe('VIEWER — bottoni di scrittura nascosti/disabilitati', () => {
  test.skip(!hasRoleCredentials('viewer'), skipReason('viewer'))

  test('FIR: "Nuovo FIR" non è cliccabile/visibile per VIEWER', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'viewer')
    const firList = new FirListPage(page)
    await firList.goto()
    await firList.expectLoaded()

    const isVisible = await firList.nuovoFirButton.isVisible().catch(() => false)
    if (isVisible) {
      await expect(firList.nuovoFirButton).toBeDisabled()
    }
    // Se il bottone non è nemmeno renderizzato, va bene altrettanto (nascosto
    // via *ngIf con la direttiva has-permission) — nessuna asserzione ulteriore
    // necessaria in quel caso.
  })

  test('Anagrafiche produttori: bottone "Nuovo" non è cliccabile/visibile per VIEWER', async ({
    page,
    context,
  }) => {
    await loginAndSaveState(page, context, 'viewer')
    const registry = new RegistryPage(page, 'produttori')
    await registry.goto()
    await registry.expectLoaded()

    const isVisible = await registry.nuovoButton.isVisible().catch(() => false)
    if (isVisible) {
      await expect(registry.nuovoButton).toBeDisabled()
    }
  })
})
