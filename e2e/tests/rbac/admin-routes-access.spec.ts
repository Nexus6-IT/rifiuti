import { test, expect } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials, type Role } from '../../utils/env'

/**
 * UAT critico #3 dell'audit frontend: nessuna rotta admin ha `canActivate`
 * di ruolo in app.routes.ts — il nascondimento è solo nel menu, l'enforcement
 * reale è delegato al backend (atteso 401/403 sulle chiamate API
 * sottostanti). Login come OPERATOR/VIEWER e navigazione diretta via URL a
 * rotte admin deve quantomeno impedire l'accesso ai dati (verificato sulla
 * risposta di rete, non sull'assenza di crash della UI).
 *
 * Skip condizionale per ruolo se mancano le credenziali corrispondenti.
 */

/**
 * NB: il frammento include il prefisso `/api/v1` di proposito. Senza, il
 * filtro su `page.on('response')` cattura anche il DOCUMENTO HTML della
 * navigazione — `page.goto('/admin/tenants')` produce una risposta 200 il cui
 * URL contiene `/admin/tenants` — e il test fallisce sempre, segnalando un
 * "buco RBAC" che non esiste. Verificato il 2026-08-05 chiamando direttamente
 * gli endpoint come operator e viewer: `/admin/tenants`, `/admin/tenants/mine`
 * e `/admin/tenants/:id` rispondono tutti 403.
 */
const adminOnlyRoutes: { route: string; apiPathFragment: string }[] = [
  { route: '/admin/tenants', apiPathFragment: '/api/v1/admin/tenants' },
  { route: '/admin/utenti', apiPathFragment: '/api/v1/admin/users' },
  { route: '/rentri/certificato', apiPathFragment: '/api/v1/rentri/credential' },
]

const nonAdminRoles: Role[] = ['operator', 'viewer']

for (const role of nonAdminRoles) {
  test.describe(`Accesso a rotte admin come ${role} (nessuna route guard, solo backend RBAC)`, () => {
    test.skip(!hasRoleCredentials(role), skipReason(role))

    for (const { route, apiPathFragment } of adminOnlyRoutes) {
      test(`${route} — la chiamata API sottostante risponde 401/403, non 200`, async ({
        page,
        context,
      }) => {
        await loginAndSaveState(page, context, role)

        const apiResponses: number[] = []
        page.on('response', response => {
          if (response.url().includes(apiPathFragment)) {
            apiResponses.push(response.status())
          }
        })

        await page.goto(route)
        await page.waitForLoadState('networkidle')

        expect(
          apiResponses.every(status => status === 401 || status === 403),
          `Attese solo risposte 401/403 dalla API ${apiPathFragment} per il ruolo ${role}, ` +
            `ricevute: [${apiResponses.join(', ')}]. Un 200 qui sarebbe un buco RBAC.`
        ).toBeTruthy()
      })
    }
  })
}

// Comportamento UI dopo il 403 (redirect a /permissions/denied? messaggio?
// pagina vuota?) non è deducibile dal solo routing (vedi audit §3) — da
// osservare empiricamente con le prime credenziali reali.
test.fixme(
  'la UI gestisce il 403 su rotta admin mostrando un feedback coerente (redirect a /permissions/denied o messaggio)',
  async () => {
    // Da completare quando le credenziali OPERATOR/VIEWER saranno disponibili
    // e si potrà osservare il comportamento reale (vedi TODO in fixtures/auth.ts).
  }
)
