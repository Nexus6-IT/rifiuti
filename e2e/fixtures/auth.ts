import { test as base, type Page, type BrowserContext } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { LoginPage } from '../pages/login.page'
import { KeycloakLoginPage } from '../pages/keycloak-login.page'
import { getRoleCredentials, getBaseUrl, type Role } from '../utils/env'

/**
 * Fixture di autenticazione — login Keycloak SAML per ruolo, con storage
 * state riutilizzabile su disco (evita di rifare il login per ogni test).
 *
 * STATO ATTUALE: le credenziali di test (E2E_ADMIN_USER/PASS,
 * E2E_OPERATOR_USER/PASS, E2E_VIEWER_USER/PASS, E2E_SUPERADMIN_USER/PASS)
 * NON sono disponibili in questo ambiente. Ogni funzione qui sotto verifica
 * la presenza delle credenziali e, se assenti, lascia che il chiamante
 * faccia skip (vedi `skipIfMissingCredentials` sotto e il suo uso nelle spec
 * in tests/auth, tests/rbac, tests/fir, tests/admin).
 *
 * TODO(credenziali): quando le credenziali saranno disponibili:
 * 1. Verificare che la form Keycloak usi davvero gli id `#username`/`#password`/
 *    `#kc-login` (tema Keycloak potrebbe essere personalizzato — vedi
 *    pages/keycloak-login.page.ts).
 * 2. Verificare se il ritorno da SAML è affidabile in modalità headless
 *    (redirect multipli auth.ignicraft.com → backend → /auth/callback):
 *    se necessario aumentare i timeout di navigazione in playwright.config.ts.
 * 3. Una volta verificato il flusso end-to-end, rimuovere i `test.skip`
 *    condizionali nelle spec e lasciare solo l'assert reale.
 */

const STORAGE_STATE_DIR = path.join(__dirname, '..', '.auth')

function storageStatePath(role: Role): string {
  return path.join(STORAGE_STATE_DIR, `${role}.json`)
}

/** True se lo storage state per il ruolo è già stato generato in questa run/ambiente. */
export function hasStoredSession(role: Role): boolean {
  return fs.existsSync(storageStatePath(role))
}

/**
 * Esegue il login SAML/Keycloak completo per il ruolo indicato e salva lo
 * storage state su disco per riuso. Lancia se le credenziali non sono
 * impostate — il chiamante deve verificare `hasRoleCredentials(role)` prima.
 */
export async function loginAndSaveState(
  page: Page,
  context: BrowserContext,
  role: Role
): Promise<void> {
  const creds = getRoleCredentials(role)
  if (!creds) {
    throw new Error(
      `Credenziali mancanti per il ruolo "${role}". Imposta le variabili d'ambiente ` +
        `corrispondenti (vedi e2e/README.md) prima di chiamare loginAndSaveState().`
    )
  }

  const loginPage = new LoginPage(page)
  await loginPage.goto()
  await loginPage.expectLoaded()
  await loginPage.clickAccedi()

  // Dopo il click, la pagina esce dalla SPA verso Keycloak (full-page redirect).
  const kcLogin = new KeycloakLoginPage(page)
  const isKeycloakForm = await kcLogin.isShowing()
  if (!isKeycloakForm) {
    throw new Error(
      'Atteso il redirect verso la form di login Keycloak dopo "Accedi", ma non è apparsa. ' +
        'Il flusso SPID/SAML potrebbe essere cambiato — vedi TODO in pages/keycloak-login.page.ts.'
    )
  }
  await kcLogin.login(creds.email, creds.password)

  // Attende il ritorno sull'app: /auth/callback (fragment coi token) -> /dashboard.
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true })
  await context.storageState({ path: storageStatePath(role) })
}

/**
 * Test base esteso con una fixture `roleUser` che richiede il ruolo passato
 * via `test.use({ role: 'admin' })` nel file di spec, e fa skip automatico
 * (con messaggio esplicito, non un fallimento silenzioso) se mancano le
 * credenziali per quel ruolo.
 */
export const test = base.extend<{ role: Role | null }>({
  role: [null, { option: true }],
})

export { expect } from '@playwright/test'

/**
 * Helper da chiamare in cima a un test/describe che richiede credenziali per
 * un ruolo: `test.skip(!hasRoleCredentials('admin'), skipReason('admin'))`.
 */
export function skipReason(role: Role): string {
  return (
    `Credenziali mancanti per il ruolo "${role}" (variabili E2E_${role.toUpperCase()}_USER/PASS non impostate). ` +
    `Test saltato volutamente: vedi e2e/README.md "Cosa manca per completare la suite".`
  )
}

export function currentTargetIsProduction(): boolean {
  return getBaseUrl().startsWith('https://rifiuti.ignicraft.com')
}
