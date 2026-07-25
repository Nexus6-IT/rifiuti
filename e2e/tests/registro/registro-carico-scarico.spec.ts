import { test } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'
import { RegistroPage } from '../../pages/registro.page'

/** Registro cronologico C/S (art. 190 D.Lgs 152/2006) — scheletro dei flussi principali. */

test.describe('Registro carico/scarico', () => {
  test.skip(!hasRoleCredentials('operator'), skipReason('operator'))

  test.fixme('elenco movimenti paginato è consultabile', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'operator')
    const registro = new RegistroPage(page)
    await registro.goto()
    await registro.expectLoaded()
  })

  test.fixme('inserimento nuovo movimento di carico/scarico', async ({ page, context }) => {
    await loginAndSaveState(page, context, 'operator')
    const registro = new RegistroPage(page)
    await registro.goto()
    await registro.nuovoMovimentoButton.click()
    // TODO: compilare form movimento (CER, quantità, causale) — richiede
    // dati di fixture stabili.
  })

  test.fixme('filtro elenco movimenti per periodo/CER', async () => {
    // TODO: da completare quando saranno note le opzioni di filtro esposte
    // dal componente RegistroComponent.
  })
})
