import { test as base, type Page, type BrowserContext } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { LoginPage } from '../pages/login.page'
import { KeycloakLoginPage } from '../pages/keycloak-login.page'
import {
  getRoleCredentials,
  getBaseUrl,
  getDevLoginSeedEmail,
  canUseDevLogin,
  isProductionTarget,
  type Role,
  type RoleCredentials,
} from '../utils/env'
import { devLoginTokens } from '../utils/api-client'

/**
 * Fixture di autenticazione — login per ruolo, con storage state
 * riutilizzabile su disco (evita di rifare il login per ogni test). Due
 * percorsi possibili, scelti da loginAndSaveState():
 *
 * 1. Keycloak SAML reale (loginViaKeycloak) — quando E2E_<RUOLO>_USER/PASS
 *    sono impostate. È il percorso vero, stesso codice della produzione.
 * 2. Bypass di sviluppo (loginViaDevBypass) — quando mancano le credenziali
 *    ma il target NON è di produzione e il ruolo ha un utente nel seed di
 *    sviluppo (apps/backend/prisma/seed-test-user.ts: solo admin/operator/
 *    viewer, MAI superAdmin). Ottiene i token da POST /auth/dev/login e li
 *    scrive dove l'app li cerca (vedi loginViaDevBypass sotto).
 *
 * PRECEDENZA quando sono disponibili entrambi: vince Keycloak (1). Motivo:
 * chi si prende la briga di configurare credenziali reali probabilmente
 * vuole esercitare anche il flusso SAML in sé (redirect, form, ritorno su
 * /auth/callback), non solo il bootstrap della sessione lato frontend — e
 * comunque è l'UNICO percorso per superAdmin, che il bypass non copre mai.
 *
 * TODO(credenziali Keycloak): quando E2E_<RUOLO>_USER/PASS saranno
 * disponibili per la prima volta:
 * 1. Verificare che la form Keycloak usi davvero gli id `#username`/`#password`/
 *    `#kc-login` (tema Keycloak potrebbe essere personalizzato — vedi
 *    pages/keycloak-login.page.ts).
 * 2. Verificare se il ritorno da SAML è affidabile in modalità headless
 *    (redirect multipli auth.ignicraft.com → backend → /auth/callback):
 *    se necessario aumentare i timeout di navigazione in playwright.config.ts.
 */

const STORAGE_STATE_DIR = path.join(__dirname, '..', '.auth')
const DEV_LOGIN_ACCESS_TOKEN_KEY = 'accessToken'
const DEV_LOGIN_REFRESH_TOKEN_KEY = 'refreshToken'

function storageStatePath(role: Role): string {
  return path.join(STORAGE_STATE_DIR, `${role}.json`)
}

/** True se lo storage state per il ruolo è già stato generato in questa run/ambiente. */
export function hasStoredSession(role: Role): boolean {
  return fs.existsSync(storageStatePath(role))
}

/**
 * Esegue il login per il ruolo indicato (Keycloak reale se ci sono
 * credenziali, altrimenti il bypass di sviluppo se disponibile) e salva lo
 * storage state su disco per riuso. Lancia se nessuno dei due percorsi è
 * praticabile — il chiamante deve verificare `hasRoleCredentials(role)`
 * prima (vedi utils/env.ts, che ora copre entrambi i percorsi).
 */
export async function loginAndSaveState(
  page: Page,
  context: BrowserContext,
  role: Role
): Promise<void> {
  const creds = getRoleCredentials(role)
  if (creds) {
    await loginViaKeycloak(page, context, role, creds)
    return
  }

  if (canUseDevLogin(role)) {
    await loginViaDevBypass(page, context, role)
    return
  }

  throw new Error(
    `Impossibile autenticare il ruolo "${role}": mancano sia le credenziali Keycloak ` +
      `(E2E_${role.toUpperCase()}_USER/PASS) sia un percorso di dev-login (nessun utente seed per ` +
      `questo ruolo, oppure il target corrente è di produzione). Il chiamante avrebbe dovuto fare skip ` +
      `via hasRoleCredentials("${role}")/skipReason("${role}") prima di arrivare qui.`
  )
}

async function loginViaKeycloak(
  page: Page,
  context: BrowserContext,
  role: Role,
  creds: RoleCredentials
): Promise<void> {
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
 * Bypass di sviluppo: ottiene i token da POST /auth/dev/login (vedi
 * devLoginTokens in utils/api-client.ts) e li scrive dove l'app Angular li
 * cerca DAVVERO, per finire nello stesso stato di un login riuscito senza
 * passare dalla form/redirect Keycloak.
 *
 * Il punto verificato sul sorgente frontend (non indovinato): AuthService
 * (apps/frontend/src/app/core/services/auth.service.ts) legge/scrive i
 * token in `localStorage` con le chiavi letterali "accessToken" e
 * "refreshToken" (vedi getAccessToken/getRefreshToken/completeSpidLogin) —
 * sono le STESSE chiavi che AuthCallbackComponent
 * (features/auth/auth-callback.component.ts) scrive dopo il vero redirect
 * da /auth/callback#accessToken=...&refreshToken=.... authGuard
 * (core/guards/auth.guard.ts) decide solo in base a isTokenValid(), che
 * legge l'access token da lì e ne controlla il claim `exp` — nessuno stato
 * server-side (cookie di sessione) è necessario per superare il guard.
 * Replichiamo quindi lo stesso identico side-effect: scriviamo le due
 * chiavi in localStorage e navighiamo a una rotta protetta, cosa che fa
 * ripartire AuthService.initializeAuth() (nel costruttore, al bootstrap
 * dell'app) esattamente come al refresh di una pagina con sessione attiva.
 */
async function loginViaDevBypass(page: Page, context: BrowserContext, role: Role): Promise<void> {
  const email = getDevLoginSeedEmail(role)
  if (!email) {
    // Difesa in profondità: canUseDevLogin(role) (verificato dal chiamante)
    // garantisce già che questo branch non scatti mai per "superAdmin".
    throw new Error(
      `Nessuna email di seed per il ruolo "${role}" — il bypass di sviluppo non lo copre (vedi ` +
        'getDevLoginSeedEmail in utils/env.ts).'
    )
  }

  const { accessToken, refreshToken } = await devLoginTokens(email)

  // localStorage è per-origine: serve prima una navigazione verso l'app
  // (qualunque rotta pubblica va bene) per avere un document dell'origine
  // giusta su cui eseguire page.evaluate.
  await page.goto('/login')
  await page.evaluate(
    ({ accessToken, refreshToken, accessKey, refreshKey }) => {
      localStorage.setItem(accessKey, accessToken)
      localStorage.setItem(refreshKey, refreshToken)
    },
    {
      accessToken,
      refreshToken,
      accessKey: DEV_LOGIN_ACCESS_TOKEN_KEY,
      refreshKey: DEV_LOGIN_REFRESH_TOKEN_KEY,
    }
  )

  await page.goto('/dashboard')
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
 *
 * Il messaggio riflette il VERO motivo dello skip, non un template unico —
 * uno skip che mente sul motivo è peggio di uno skip (vedi il caso
 * "superAdmin": non sono "credenziali mancanti", è che il seed di sviluppo
 * non crea nessun utente con quel ruolo).
 */
export function skipReason(role: Role): string {
  if (role === 'superAdmin' && !getRoleCredentials('superAdmin')) {
    return (
      'Nessun utente SUPER_ADMIN nel seed di sviluppo (apps/backend/prisma/seed-test-user.ts crea solo ' +
      'admin@test.com/operator@test.com/viewer@test.com): il bypass dev-login non copre questo ruolo, serve ' +
      'per forza Keycloak reale. Imposta E2E_SUPERADMIN_USER/PASS per eseguire questi test. ' +
      'Test saltato volutamente.'
    )
  }

  if (getRoleCredentials(role) || canUseDevLogin(role)) {
    // Non dovrebbe capitare in pratica: se uno dei due percorsi è
    // disponibile, hasRoleCredentials(role) è già true e il chiamante non
    // arriva a fare skip. Messaggio comunque esplicito, per non mentire.
    return `Il ruolo "${role}" è autenticabile (credenziali reali o dev-login): questo skip non dovrebbe scattare.`
  }

  if (isProductionTarget()) {
    return (
      `Credenziali mancanti per il ruolo "${role}" (variabili E2E_${role.toUpperCase()}_USER/PASS non impostate) ` +
      'e il target corrente è di produzione: il bypass dev-login è disabilitato per sicurezza su quel target ' +
      '(vedi apps/backend/src/auth/auth.module.ts). Test saltato volutamente.'
    )
  }

  return (
    `Credenziali mancanti per il ruolo "${role}" (variabili E2E_${role.toUpperCase()}_USER/PASS non impostate) ` +
    `e nessun utente seed disponibile per il bypass dev-login. ` +
    `Test saltato volutamente: vedi e2e/README.md "Cosa manca per completare la suite".`
  )
}

export function currentTargetIsProduction(): boolean {
  return getBaseUrl().startsWith('https://rifiuti.ignicraft.com')
}
