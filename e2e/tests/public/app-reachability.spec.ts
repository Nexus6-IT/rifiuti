import { test, expect } from '@playwright/test'

/**
 * Raggiungibilità base dell'app e redirect a /login per rotte protette senza
 * sessione (authGuard su LayoutComponent — vedi
 * docs/audits/uat-2026-07-25/02-frontend-flows.md §5.9).
 */

test.describe('Raggiungibilità applicazione', () => {
  test('la root risponde ed è la SPA Angular WasteFlow', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBeLessThan(400)
    // La SPA fa redirect a /login se non autenticati (root -> /dashboard -> authGuard -> /login)
    await page.waitForURL(/\/login/, { timeout: 10_000 })
  })

  test('/login mostra il bottone di accesso', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: /accedi/i })).toBeVisible()
  })

  test.describe('deep-link su rotta protetta senza sessione redirige a /login', () => {
    const protectedRoutes = ['/dashboard', '/fir', '/registro', '/admin/tenants', '/admin/utenti']

    for (const route of protectedRoutes) {
      test(`${route} -> /login`, async ({ page }) => {
        await page.goto(route)
        await page.waitForURL(/\/login/, { timeout: 10_000 })
      })
    }
  })

  test('rotta inesistente fa redirect a /dashboard (wildcard) o a /login se non autenticato', async ({
    page,
  }) => {
    await page.goto('/questa-rotta-non-esiste-xyz')
    // Wildcard route redirige a /dashboard, che a sua volta (senza sessione)
    // viene bloccato da authGuard e reindirizzato a /login.
    await page.waitForURL(/\/login|\/dashboard/, { timeout: 10_000 })
  })
})
