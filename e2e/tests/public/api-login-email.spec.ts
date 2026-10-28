import { test, expect } from '@playwright/test'
import { scegliEmailApiLogin } from '../../utils/api-client'
import { hasRoleCredentials, type Role } from '../../utils/env'

/**
 * Self-test della scelta dell'email di `apiLogin` (utils/api-client.ts):
 * nessuna rete, nessun backend. Fissa che apiLogin accetti esattamente i ruoli
 * che `hasRoleCredentials` dichiara autenticabili (prima lo skip usava il
 * dev-login ma apiLogin pretendeva le credenziali reali: "Credenziali mancanti
 * per il ruolo admin" in passata 2 su un target locale).
 *
 * `test.describe.serial` perché i casi mutano `process.env` (vedi
 * dev-login-decisione.spec.ts, stesso schema snapshot/ripristino).
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
] as const

let snapshot: Record<string, string | undefined>

test.describe.serial('apiLogin — scelta dell’email', () => {
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

  test('target locale, nessuna credenziale: email del seed dev-login', () => {
    expect(scegliEmailApiLogin('admin')).toBe('admin@test.com')
    expect(scegliEmailApiLogin('operator')).toBe('operator@test.com')
    expect(scegliEmailApiLogin('viewer')).toBe('viewer@test.com')
  })

  test('credenziali reali presenti: vincono sul seed (locale e produzione)', () => {
    process.env.E2E_ADMIN_USER = 'admin@example.it'
    process.env.E2E_ADMIN_PASS = 'segreta'
    expect(scegliEmailApiLogin('admin')).toBe('admin@example.it')

    process.env.E2E_BASE_URL = 'https://rifiuti.ignicraft.com'
    expect(scegliEmailApiLogin('admin')).toBe('admin@example.it')
  })

  test('target di produzione senza credenziali: mai dev-login, errore', () => {
    process.env.E2E_BASE_URL = 'https://rifiuti.ignicraft.com'
    for (const role of ['admin', 'operator', 'viewer', 'superAdmin'] as Role[]) {
      expect(() => scegliEmailApiLogin(role), role).toThrow(/Credenziali mancanti/)
    }
  })

  test('superAdmin senza credenziali (nessun seed): errore anche in locale', () => {
    expect(() => scegliEmailApiLogin('superAdmin')).toThrow(/Credenziali mancanti/)
  })

  test('coerenza con hasRoleCredentials: lancia se e solo se il ruolo non è autenticabile', () => {
    for (const base of [undefined, 'https://rifiuti.ignicraft.com']) {
      if (base) process.env.E2E_BASE_URL = base
      else delete process.env.E2E_BASE_URL
      for (const role of ['admin', 'operator', 'viewer', 'superAdmin'] as Role[]) {
        const autenticabile = hasRoleCredentials(role)
        let lancia = false
        try {
          scegliEmailApiLogin(role)
        } catch {
          lancia = true
        }
        expect(lancia, `${role} @ ${base ?? 'locale'}`).toBe(!autenticabile)
      }
    }
  })
})
