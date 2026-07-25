import { test, expect } from '@playwright/test'
import { getApiUrl } from '../../utils/env'

/**
 * Verifica header di sicurezza HTTP, documentando lo stato attuale rilevato
 * nell'audit produzione (docs/audits/uat-2026-07-25/03-prod-unauth-probe.md,
 * F2): l'API (Helmet, NestJS) ha un set completo di header di sicurezza; il
 * documento HTML principale servito da nginx frontend NE È PRIVO.
 *
 * NOTA: il secondo test qui sotto documenta un gap noto (F2), non lo impone
 * come requisito — se il team aggiunge gli header nginx, il test andrà
 * aggiornato per riflettere lo stato corretto (asserzioni invertite).
 */

test.describe('Header di sicurezza HTTP', () => {
  test('le risposte API hanno gli header Helmet attesi', async ({ request }) => {
    const apiBase = getApiUrl().replace(/\/api\/v1\/?$/, '')
    const response = await request.get(`${apiBase}/api/v1/health`, { failOnStatusCode: false })
    const headers = response.headers()

    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBeTruthy()
    // HSTS solo su HTTPS (produzione) — su http locale non ci si aspetta.
    if (apiBase.startsWith('https://')) {
      expect(headers['strict-transport-security']).toBeTruthy()
    }
  })

  test('[F2] il documento HTML principale espone gli header di sicurezza (nginx frontend)', async ({
    page,
  }) => {
    // Fix rilasciato in produzione il 2026-07-25 (`apps/frontend/nginx.conf`):
    // il test e' tornato un controllo attivo, non piu' atteso-rosso.
    const response = await page.goto('/')
    expect(response).not.toBeNull()
    const headers = response!.headers()

    for (const header of [
      'strict-transport-security',
      'content-security-policy',
      'x-frame-options',
      'x-content-type-options',
    ]) {
      expect(headers[header], `header ${header} mancante sul documento HTML`).toBeTruthy()
    }
  })
})
