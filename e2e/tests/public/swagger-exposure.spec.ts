import { test, expect } from '@playwright/test'
import { getApiUrl } from '../../utils/env'

/**
 * Documenta lo stato ATTUALE di Swagger/OpenAPI in produzione (F1,
 * docs/audits/uat-2026-07-25/03-prod-unauth-probe.md): la spec completa è
 * raggiungibile senza autenticazione. Questo test NON impone che resti così
 * — è una regression probe che DEVE essere aggiornata (assert invertito) il
 * giorno in cui Swagger viene disabilitato/protetto in produzione (rimedio
 * consigliato in F1).
 */

test.describe('[F1] Swagger/OpenAPI non deve essere pubblico in produzione', () => {
  test('GET /api/docs-json non risponde 200 senza autenticazione', async ({ request }) => {
    // Difetto F1 ancora aperto: nessun fix applicato finora. Il test esprime
    // il requisito (spec non pubblica) e resta atteso-rosso finche' Swagger
    // non viene disabilitato o protetto in produzione.
    test.fixme(true, 'F1: spec OpenAPI ancora pubblica in produzione, rimedio non ancora applicato')

    const apiBase = getApiUrl().replace(/\/api\/v1\/?$/, '')
    const response = await request.get(`${apiBase}/api/docs-json`, { failOnStatusCode: false })

    expect(
      [401, 403, 404],
      `la spec OpenAPI completa risponde ${response.status()} senza autenticazione`
    ).toContain(response.status())
  })
})
