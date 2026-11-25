import type { Page } from '@playwright/test'

/**
 * Le notifiche push (P7) fanno una lettura a ogni apertura del giro: `GET /api/v1/push/configurazione`.
 * Le spec dell'app campo che non provano le notifiche non la simulano: la richiesta arriverebbe al
 * backend vero con un token finto, il 401 farebbe finire la sessione e il giro sparirebbe dalla
 * schermata (login al posto dell'elenco). Qui il server dichiara le push non disponibili: la scheda
 * notifiche resta quieta e il resto della spec non se ne accorge.
 *
 * Va registrata PRIMA delle route della spec: in Playwright vince l'ultima registrata, quindi una
 * spec che prova le push puo' ridefinire questi endpoint.
 */
export async function pushNonDisponibile(page: Page): Promise<void> {
  await page.context().route('**/api/v1/push/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ disponibile: false, chiavePubblica: null }),
    })
  )
}
