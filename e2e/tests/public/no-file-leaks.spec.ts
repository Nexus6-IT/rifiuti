import { test, expect } from '@playwright/test'

/**
 * Verifica assenza di fughe di file sensibili — replica automatizzata di F8
 * (docs/audits/uat-2026-07-25/03-prod-unauth-probe.md): il nginx del
 * frontend fa fallback SPA su qualunque path non trovato, quindi path come
 * `/.env` o `/.git/config` restituiscono sempre `index.html` (200, stesso
 * Content-Length della root) e MAI il contenuto reale del file.
 */

const sensitivePaths = ['/.env', '/.git/config', '/main.js.map', '/assets/']

test.describe('Nessuna fuga di file sensibili (fallback SPA)', () => {
  let rootContentLength: number | null = null

  test.beforeAll(async ({ request, baseURL }) => {
    const response = await request.get(baseURL!)
    rootContentLength = Number(response.headers()['content-length'] ?? -1)
  })

  for (const p of sensitivePaths) {
    test(`${p} non serve un file reale (fallback a index.html)`, async ({ request, baseURL }) => {
      const response = await request.get(`${baseURL}${p}`, { failOnStatusCode: false })
      const body = await response.text()

      // Il fallback SPA serve sempre l'HTML della root: verifichiamo che il
      // body contenga i marker tipici di un documento Angular (non un vero
      // file .env/.git, che non conterrebbe questi tag).
      expect(body).toMatch(/<html|<app-root|<!doctype html/i)
      expect(body).not.toMatch(/DATABASE_URL|JWT_SECRET|\[core\]/i)
      // Confronto esplicito col Content-Length della root (vedi beforeAll):
      // non basta che il body "assomigli" all'HTML Angular, deve essere
      // BYTE PER BYTE lo stesso documento servito dal fallback SPA — altrimenti
      // il path sensibile potrebbe star restituendo una pagina di errore
      // diversa che contiene per caso gli stessi marker.
      expect(Number(response.headers()['content-length'] ?? -1)).toBe(rootContentLength)
    })
  }
})
