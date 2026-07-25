import { test, expect } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { getApiUrl } from '../../utils/env'

/**
 * Verifica READ-ONLY (solo GET, senza header Authorization) che gli endpoint
 * protetti da JwtAuthGuard rispondano davvero 401 senza credenziali.
 *
 * Fonte: docs/audits/uat-2026-07-25/01-api-surface.json (audit statico dei
 * controller, branch develop) — non chiamiamo MAI endpoint WRITE qui, solo
 * GET, e mai path della blacklist distruttiva.
 *
 * Questo è lo stesso tipo di verifica del probe manuale
 * docs/audits/uat-2026-07-25/03-prod-unauth-probe.md (39/45 endpoint
 * applicativi correttamente protetti da 401 in produzione) — qui la
 * rendiamo una regressione automatizzata.
 */

interface ApiSurfaceEntry {
  method: string
  path: string
  guards: string[]
  rolesOrPermissions: string[]
  type: 'R' | 'W'
  destructive: boolean
}

const surfacePath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'docs',
  'audits',
  'uat-2026-07-25',
  '01-api-surface.json',
)
const surface: ApiSurfaceEntry[] = JSON.parse(fs.readFileSync(surfacePath, 'utf-8'))

const DUMMY_UUID = '00000000-0000-0000-0000-000000000000'

function resolvePath(p: string): string {
  return p.replace(/:[a-zA-Z]+/g, DUMMY_UUID)
}

// Solo GET, solo endpoint con JwtAuthGuard (protetti), esclusi quelli
// esplicitamente pubblici-by-design (CER, health, verify-url — vedi audit).
const protectedGetEndpoints = surface.filter(
  (e) => e.method === 'GET' && e.guards.includes('JwtAuthGuard') && e.type === 'R',
)

test.describe('API protetta — 401 senza credenziali (GET-only, read-only)', () => {
  test(`inventario endpoint da audit non è vuoto (sanity check del fixture)`, () => {
    expect(protectedGetEndpoints.length).toBeGreaterThan(20)
  })

  for (const endpoint of protectedGetEndpoints) {
    test(`GET ${endpoint.path} -> 401 senza Authorization`, async ({ request }) => {
      const apiBase = getApiUrl().replace(/\/api\/v1\/?$/, '')
      const resolved = resolvePath(endpoint.path)
      const response = await request.get(`${apiBase}/${resolved}`, {
        failOnStatusCode: false,
      })
      // Alcuni path con :id fittizio potrebbero rispondere 400 (validazione
      // formato) prima ancora del guard — accettiamo 400/401 ma MAI 200/403
      // silenzioso (403 senza auth indicherebbe un guard rotto in modo diverso
      // dall'atteso, va investigato, non è equivalente a "protetto").
      expect(
        [400, 401].includes(response.status()),
        `Atteso 400 o 401 per ${endpoint.path}, ricevuto ${response.status()}. ` +
          `Se è 200: possibile regressione RBAC (endpoint dovrebbe richiedere JwtAuthGuard).`,
      ).toBeTruthy()
    })
  }
})
