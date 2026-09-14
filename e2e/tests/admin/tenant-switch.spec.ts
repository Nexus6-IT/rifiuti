import { test } from '@playwright/test'
import { loginAndSaveState, skipReason } from '../../fixtures/auth'
import { hasRoleCredentials } from '../../utils/env'

/**
 * UAT critico #5 dell'audit frontend: tenant switch (SUPER_ADMIN / utente
 * multi-azienda). Verificare che l'header X-Tenant-ID raggiunga TUTTE le
 * chiamate, incluse quelle con path assoluto hardcoded (`consultant-dashboard`,
 * `tenant-selector` — possibile inconsistenza segnalata nell'audit §5.7).
 */

test.describe('Tenant switch', () => {
  test.skip(!hasRoleCredentials('superAdmin'), skipReason('superAdmin'))

  test.fixme(
    'cambio tenant ricalcola menu/feature-flag e propaga X-Tenant-ID a tutte le chiamate incluse quelle con path assoluto',
    async ({ page, context }) => {
      await loginAndSaveState(page, context, 'superAdmin')

      const requestsWithoutTenantHeader: string[] = []
      page.on('request', request => {
        const url = request.url()
        if (url.includes('/api/') && !request.headers()['x-tenant-id']) {
          requestsWithoutTenantHeader.push(url)
        }
      })

      // TODO: eseguire lo switch tenant da dropdown, attendere il reload,
      // navigare su /permissions/consultant-dashboard (path assoluto
      // hardcoded /api/v1/consultant/... — vedi audit) e verificare che
      // anche quella chiamata riceva X-Tenant-ID.
    }
  )
})
