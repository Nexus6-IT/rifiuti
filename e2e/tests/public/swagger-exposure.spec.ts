import { test, expect } from '@playwright/test'
import { getApiUrl } from '../../utils/env'

/**
 * Verifica il rimedio al difetto F1 (docs/audits/uat-2026-07-25/03-prod-unauth-probe.md):
 * la spec OpenAPI completa non deve essere raggiungibile senza autenticazione
 * in produzione. Da F1, Swagger viene registrato solo se NODE_ENV non è
 * 'production' oppure se SWAGGER_ENABLED=true è impostato esplicitamente per
 * diagnosi (apps/backend/src/main.ts).
 */

test.describe('[F1] Swagger/OpenAPI non deve essere pubblico in produzione', () => {
  test('GET /api/docs-json non risponde 200 senza autenticazione', async ({ request }) => {
    const apiBase = getApiUrl().replace(/\/api\/v1\/?$/, '')
    const response = await request.get(`${apiBase}/api/docs-json`, { failOnStatusCode: false })

    expect(
      [401, 403, 404],
      `la spec OpenAPI completa risponde ${response.status()} senza autenticazione`
    ).toContain(response.status())
  })
})
