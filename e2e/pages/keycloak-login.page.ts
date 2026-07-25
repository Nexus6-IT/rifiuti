import { type Page, type Locator } from '@playwright/test'

/**
 * Page Object per la form di login del tema Keycloak "roads" (realm
 * `ignicraft`, client `rifiuti` — vedi memoria progetto rifiuti-keycloak-auth).
 *
 * TODO(credenziali): questa pagina non è mai stata esercitata end-to-end da
 * questa suite perché le credenziali di test (E2E_ADMIN_USER/PASS ecc.) non
 * sono ancora disponibili in questo ambiente. Gli id dei campi (`username`,
 * `password`, `kc-login`) sono gli id standard del template Keycloak
 * `login.ftl` così come duplicato per il tema `roads` (cfr. nota globale
 * CLAUDE.md "Per-progetto login theme" — il tema `rifiuti` NON è ancora
 * elencato tra i temi esistenti, quindi potrebbe star usando il tema
 * `roads`/default: DA VERIFICARE con le prime credenziali reali).
 * Se gli id non corrispondono, aggiornare qui — è l'unico punto da toccare.
 */
export class KeycloakLoginPage {
  readonly page: Page
  readonly usernameInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator

  constructor(page: Page) {
    this.page = page
    this.usernameInput = page.locator('#username')
    this.passwordInput = page.locator('#password')
    this.submitButton = page.locator('#kc-login, button[type="submit"]')
  }

  async isShowing(): Promise<boolean> {
    try {
      await this.usernameInput.waitFor({ state: 'visible', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  async login(username: string, password: string) {
    await this.usernameInput.fill(username)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }
}
