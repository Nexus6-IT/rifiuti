import { test, expect } from '@playwright/test'
import {
  hasRoleCredentials,
  canUseDevLogin,
  getDevLoginSeedEmail,
  getApiLoginEmail,
  type Role,
} from '../../utils/env'
import { skipReason } from '../../fixtures/auth'

/**
 * Self-test della logica di scelta fra Keycloak reale e bypass dev-login
 * (Task "rendi eseguibile la suite E2E", punti A/B). Nessuna richiesta di
 * rete, nessun browser: verifica solo `hasRoleCredentials`/`canUseDevLogin`/
 * `skipReason` in utils/env.ts e fixtures/auth.ts al variare delle variabili
 * d'ambiente. Gira SEMPRE (locale e CI), come guardrail-self-test.spec.ts.
 *
 * `test.describe.serial` perché i casi mutano `process.env` (globale al
 * processo worker): con `fullyParallel: true` due test dello stesso file
 * possono finire sullo stesso worker in ordine non deterministico — serial
 * garantisce che un caso non legga le variabili lasciate da un altro.
 */

const ENV_KEYS = [
  'E2E_ADMIN_USER',
  'E2E_ADMIN_PASS',
  'E2E_OPERATOR_USER',
  'E2E_OPERATOR_PASS',
  'E2E_VIEWER_USER',
  'E2E_VIEWER_PASS',
  'E2E_SUPERADMIN_USER',
  'E2E_SUPERADMIN_PASS',
  'E2E_BASE_URL',
  'E2E_DEV_LOGIN_DISABILITATO',
] as const

let snapshot: Record<string, string | undefined>

test.describe.serial('Decisione autenticazione — Keycloak reale vs dev-login', () => {
  test.beforeEach(() => {
    snapshot = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
  })

  test.afterEach(() => {
    for (const k of ENV_KEYS) {
      if (snapshot[k] === undefined) delete process.env[k]
      else process.env[k] = snapshot[k]
    }
  })

  test('target locale, nessuna credenziale: admin/operator/viewer autenticabili via dev-login', () => {
    // E2E_BASE_URL non impostata => default locale (vedi env.ts DEFAULT_LOCAL_BASE_URL).
    for (const role of ['admin', 'operator', 'viewer'] as Role[]) {
      expect(hasRoleCredentials(role), `hasRoleCredentials("${role}")`).toBe(true)
      expect(canUseDevLogin(role), `canUseDevLogin("${role}")`).toBe(true)
      expect(getDevLoginSeedEmail(role)).toBe(`${role === 'operator' ? 'operator' : role}@test.com`)
    }
  })

  test('target locale, nessuna credenziale: superAdmin resta non autenticabile (nessun seed)', () => {
    expect(hasRoleCredentials('superAdmin')).toBe(false)
    expect(canUseDevLogin('superAdmin')).toBe(false)
    expect(getDevLoginSeedEmail('superAdmin')).toBeNull()
    expect(skipReason('superAdmin')).toContain('Nessun utente SUPER_ADMIN nel seed')
  })

  test('target di produzione, nessuna credenziale: dev-login disabilitato per ogni ruolo', () => {
    process.env.E2E_BASE_URL = 'https://rifiuti.ignicraft.com'
    for (const role of ['admin', 'operator', 'viewer', 'superAdmin'] as Role[]) {
      expect(hasRoleCredentials(role), `hasRoleCredentials("${role}")`).toBe(false)
      expect(canUseDevLogin(role), `canUseDevLogin("${role}")`).toBe(false)
    }
    expect(skipReason('admin')).toContain('target corrente è di produzione')
    expect(skipReason('admin')).not.toContain('SUPER_ADMIN')
  })

  test('target di produzione, credenziali reali presenti: il ruolo resta autenticabile (Keycloak)', () => {
    process.env.E2E_BASE_URL = 'https://rifiuti.ignicraft.com'
    process.env.E2E_ADMIN_USER = 'admin@example.it'
    process.env.E2E_ADMIN_PASS = 'segreta'
    expect(hasRoleCredentials('admin')).toBe(true)
    // Il dev-login resta comunque disabilitato in produzione: la
    // precedenza a Keycloak non dipende da un rilassamento di questo check.
    expect(canUseDevLogin('admin')).toBe(false)
  })

  test('target locale, credenziali reali presenti per admin: entrambi i percorsi risultano disponibili', () => {
    process.env.E2E_ADMIN_USER = 'admin@example.it'
    process.env.E2E_ADMIN_PASS = 'segreta'
    expect(hasRoleCredentials('admin')).toBe(true)
    expect(canUseDevLogin('admin')).toBe(true)
    // La precedenza fra i due (Keycloak vince) è decisa in
    // loginAndSaveState() — fixtures/auth.ts — non qui: questo test copre
    // solo la disponibilità dei due percorsi, non quale viene scelto (quel
    // ramo richiede un browser/pagina reale, fuori dallo scopo di un test
    // "nessun server richiesto").
  })

  test('skipReason non mente mai: un ruolo con hasRoleCredentials=true non dovrebbe mai arrivare a produrre lo skip generico', () => {
    // Documenta il contratto: se un chiamante ignorasse hasRoleCredentials
    // e chiamasse comunque skipReason su un ruolo autenticabile, il
    // messaggio lo dice esplicitamente invece di fingere "credenziali
    // mancanti".
    for (const role of ['admin', 'operator', 'viewer'] as Role[]) {
      expect(hasRoleCredentials(role)).toBe(true)
      expect(skipReason(role)).toContain('è autenticabile')
    }
  })

  test("apiLogin senza credenziali su target locale usa l'email del seed (stessa regola dello skip)", () => {
    // Regressione CI 2026-09-17: hasRoleCredentials() era stata estesa al
    // dev-login, apiLogin() no — le spec API non venivano saltate e poi
    // fallivano con "Credenziali mancanti".
    for (const role of ['admin', 'operator', 'viewer'] as Role[]) {
      expect(getApiLoginEmail(role), `getApiLoginEmail("${role}")`).toBe(getDevLoginSeedEmail(role))
    }
    expect(getApiLoginEmail('superAdmin')).toBeNull()
  })

  test("apiLogin con credenziali presenti usa l'email delle credenziali, non quella del seed", () => {
    process.env.E2E_ADMIN_USER = 'admin@example.it'
    process.env.E2E_ADMIN_PASS = 'segreta'
    expect(getApiLoginEmail('admin')).toBe('admin@example.it')
  })

  test('E2E_DEV_LOGIN_DISABILITATO=1: target locale ma backend in produzione, nessun dev-login', () => {
    // Passata 1 della CI: E2E_BASE_URL locale, backend con NODE_ENV=production
    // (la rotta /auth/dev/login non è registrata).
    process.env.E2E_DEV_LOGIN_DISABILITATO = '1'
    for (const role of ['admin', 'operator', 'viewer'] as Role[]) {
      expect(canUseDevLogin(role), `canUseDevLogin("${role}")`).toBe(false)
      expect(hasRoleCredentials(role), `hasRoleCredentials("${role}")`).toBe(false)
      expect(getApiLoginEmail(role), `getApiLoginEmail("${role}")`).toBeNull()
    }
  })
})
