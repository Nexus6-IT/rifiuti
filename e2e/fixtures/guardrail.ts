import { test as base, type Page, expect } from '@playwright/test'
import { isProductionTarget, getBaseUrl } from '../utils/env'
import { matchBlacklist } from '../utils/blacklist'

/**
 * GUARDRAIL DI SICUREZZA OBBLIGATORIO
 * ------------------------------------------------------------------
 * Quando la suite gira contro un baseURL di produzione (o comunque non
 * localhost — vedi `isProductionTarget`), questa fixture installa una
 * route interception globale su `page` che ABORTISCE qualunque richiesta
 * verso gli endpoint della blacklist distruttiva (vedi utils/blacklist.ts)
 * e fa fallire il test con un messaggio esplicito.
 *
 * Contro un ambiente locale il guardrail resta attivo ma non blocca nulla
 * di più severo di un log: in locale è lecito esercitare i path distruttivi
 * con dati di test throwaway (seed/reset del DB locale), quindi il blocco
 * è specificamente condizionato a `isProductionTarget()`.
 *
 * Vedi e2e/README.md § "Guardrail di sicurezza" per la policy completa.
 */

let blockedAttempt: { method: string; url: string; label: string } | null = null

async function installGuardrail(page: Page) {
  blockedAttempt = null
  const productionRun = isProductionTarget()

  await page.route('**/*', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = request.url()
    const hit = matchBlacklist(method, url)

    if (hit && productionRun) {
      blockedAttempt = { method, url, label: hit.label }
      // eslint-disable-next-line no-console
      console.error(
        `[GUARDRAIL] Richiesta BLOCCATA verso endpoint distruttivo in produzione: ${method} ${url} (${hit.label})`,
      )
      await route.abort('blockedbyclient')
      return
    }

    await route.continue()
  })
}

export const test = base.extend<{ guardedPage: Page }>({
  guardedPage: async ({ page }, use) => {
    await installGuardrail(page)
    await use(page)
    if (blockedAttempt) {
      // Se un test ha effettivamente tentato di invocare un endpoint della
      // blacklist mentre puntavamo a produzione, il test DEVE fallire con un
      // messaggio chiaro invece di proseguire silenziosamente.
      const attempt = blockedAttempt
      blockedAttempt = null
      expect(
        false,
        `Il test ha tentato di invocare un endpoint distruttivo su produzione: ` +
          `${attempt.method} ${attempt.url} (${attempt.label}). ` +
          `Operazione abortita dal guardrail (e2e/fixtures/guardrail.ts). ` +
          `Questo tipo di richiesta NON deve mai essere eseguito contro ${getBaseUrl()}.`,
      ).toBe(true)
    }
  },
})

export { expect } from '@playwright/test'
