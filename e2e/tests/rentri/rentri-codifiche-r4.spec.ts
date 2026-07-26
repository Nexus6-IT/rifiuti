import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'

/**
 * Verifica end-to-end R4 (unità locali dall'ente, autocomplete CER,
 * aggiornamento manuale) — R4 Task 8 Step 1.
 *
 * Stessa convenzione delle altre spec della suite (`fir-rentri-status.spec.ts`):
 * `test.skip()` condizionale a runtime sulle credenziali (`E2E_ADMIN_USER/PASS`,
 * `E2E_OPERATOR_USER/PASS`), MAI un test vuoto che passa silenziosamente. Le
 * credenziali E2E non sono impostate in questo ambiente locale (v.
 * `e2e/fixtures/auth.ts`): i test qui sotto sono scritti per girare per
 * intero non appena l'ambiente le fornisce (CI/staging), non solo per
 * "esistere".
 */

test.describe('Area RENTRI — unità locali, autocomplete CER, aggiornamento manuale (R4)', () => {
  test("la sezione «Unità locali» mostra i siti letti dall'ente per un tenant admin", async ({
    page,
    context,
  }) => {
    test.skip(!hasRoleCredentials('admin'), skipReason('admin'))
    await loginAndSaveState(page, context, 'admin')

    await page.goto('/rentri/unita-locali')

    // O la tabella è già popolata dalla cache locale, o compare l'invito a
    // configurare il numero di iscrizione (tenant senza certificato RENTRI):
    // in nessuno dei due casi il test deve restare bloccato sul loading.
    await expect(page.getByTestId('rentri-siti-loading')).toBeHidden({ timeout: 15_000 })

    const nonConfigurato = page.getByTestId('rentri-siti-non-configurato')
    test.skip(
      await nonConfigurato.isVisible(),
      'Tenant admin senza numero di iscrizione RENTRI configurato: nessuna unità locale da leggere in questo ambiente.'
    )

    await expect(page.getByTestId('rentri-siti-tabella')).toBeVisible()
    const righe = page.locator('[data-testid^="rentri-siti-row-"]')
    await expect(righe.first()).toBeVisible()
  })

  test("l'autocomplete CER del form di creazione FIR interroga il backend con il filtro presenteInRentri=true", async ({
    page,
    context,
  }) => {
    // Non richiede un tenant admin: qualunque operatore che crei un FIR
    // esercita l'autocomplete. Verifica la richiesta di rete reale invece di
    // dipendere da un codice specifico marcato non-presente nella fixture del
    // tenant (che nessun ambiente E2E garantisce di avere pronto) — v.
    // `apps/frontend/src/app/features/cer/cer-select.component.ts` (default
    // `presenteInRentri=true`) e `cer.service.ts#searchCER`.
    test.skip(!hasRoleCredentials('operator'), skipReason('operator'))
    await loginAndSaveState(page, context, 'operator')

    await page.goto('/fir')
    const nuovoBtn = page.getByRole('button', { name: /nuovo formulario|crea fir|nuovo fir/i })
    if (await nuovoBtn.isVisible().catch(() => false)) {
      await nuovoBtn.click()
    }

    const richiestaCer = page.waitForRequest(
      req => req.url().includes('/cer/search') && req.method() === 'GET',
      { timeout: 15_000 }
    )

    const autocomplete = page.getByTestId('fir-cer-autocomplete').locator('input')
    await autocomplete.click()
    await autocomplete.fill('13')

    const richiesta = await richiestaCer
    const url = new URL(richiesta.url())
    expect(url.searchParams.get('presenteInRentri')).toBe('true')
  })

  test("«Aggiorna dall'ente» aggiorna la data di ultimo aggiornamento visibile in tabella", async ({
    page,
    context,
  }) => {
    test.skip(!hasRoleCredentials('admin'), skipReason('admin'))
    await loginAndSaveState(page, context, 'admin')

    await page.goto('/rentri/unita-locali')
    await expect(page.getByTestId('rentri-siti-loading')).toBeHidden({ timeout: 15_000 })

    const nonConfigurato = page.getByTestId('rentri-siti-non-configurato')
    test.skip(
      await nonConfigurato.isVisible(),
      "Tenant admin senza numero di iscrizione RENTRI configurato: azione «Aggiorna dall'ente» non disponibile."
    )

    const aggiornaBtn = page.getByTestId('rentri-siti-aggiorna-btn')
    await expect(aggiornaBtn).toBeVisible()

    const rispostaAggiorna = page.waitForResponse(
      resp => resp.url().includes('/rentri/siti/aggiorna') && resp.request().method() === 'POST',
      { timeout: 20_000 }
    )
    await aggiornaBtn.click()
    const risposta = await rispostaAggiorna
    expect(risposta.ok()).toBeTruthy()

    // La rilettura completa (aggiornaDaEnte -> load()) rimpiazza la tabella:
    // dopo la risposta, la tabella torna visibile con righe che riportano una
    // colonna "Ultimo aggiornamento" popolata (aggiornata da questo stesso
    // ciclo di sincronizzazione).
    await expect(page.getByTestId('rentri-siti-loading')).toBeHidden({ timeout: 15_000 })

    const tabella = page.getByTestId('rentri-siti-tabella')
    const empty = page.getByTestId('rentri-siti-empty-state')
    test.skip(
      await empty.isVisible().catch(() => false),
      "L'ente non ha restituito alcuna unità locale per questo operatore in questo ambiente."
    )
    await expect(tabella).toBeVisible()
    const primaColonnaData = tabella.locator('tbody tr').first().locator('td').nth(3)
    await expect(primaColonnaData).not.toHaveText('')
  })
})
