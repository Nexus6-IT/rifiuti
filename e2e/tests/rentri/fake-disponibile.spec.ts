import { test, expect } from '@playwright/test'
import { getRentriFakeUrl } from '../../utils/env'

/**
 * Verifica che l'oracolo di conformita' sia in piedi e si comporti come
 * RENTRI sui due punti che invalidano l'integrazione attuale: assenza di
 * /token e rifiuto delle chiamate non autenticate.
 */
test.describe('Fake API RENTRI', () => {
  test('risponde alla salute', async ({ request }) => {
    const risposta = await request.get(`${getRentriFakeUrl()}/__salute`, {
      failOnStatusCode: false,
    })

    expect(risposta.status()).toBe(200)
    expect(await risposta.json()).toEqual({ servizio: 'rentri-fake', stato: 'ok' })
  })

  test('non espone /token, come RENTRI', async ({ request }) => {
    const risposta = await request.post(`${getRentriFakeUrl()}/token`, {
      data: { grant_type: 'client_credentials' },
      failOnStatusCode: false,
    })

    expect(risposta.status()).toBe(404)
  })

  test('rifiuta con 403 una chiamata senza JWT', async ({ request }) => {
    // Il contratto ufficiale documenta 403 "Operazione non consentita" per
    // credenziale mancante o non valida, mai 401 (vedi FEDELTA.md e i
    // commenti in tools/rentri-fake/src/routes/formulari.ts). La fake è
    // stata corretta di conseguenza: il test verifica il comportamento
    // fedele al contratto, non quello (401) di una versione precedente.
    const risposta = await request.get(`${getRentriFakeUrl()}/formulari/v1.0/`, {
      failOnStatusCode: false,
    })

    expect(risposta.status()).toBe(403)
  })
})
