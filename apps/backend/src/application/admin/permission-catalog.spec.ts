/**
 * Verifica che il catalogo permessi seedato (`prisma/seeds/permissions.seed.ts`)
 * contenga le voci per le risorse `role`, `audit`, `consultant` — assenti fino
 * alla pipeline P4 del 2026-07-25, causa del 403 sistematico su
 * RoleController/AuditController/ConsultantController per qualunque utente.
 *
 * `@prisma/client` è mockato per evitare di istanziare un client reale
 * all'import del modulo (side effect di `permissions.seed.ts`, riga 3):
 * questo test verifica solo il contenuto statico dell'array esportato.
 */
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $disconnect: jest.fn(),
  })),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DEFAULT_PERMISSIONS } = require('../../../prisma/seeds/permissions.seed')

describe('Catalogo permessi — voci role/audit/consultant (decisione PO 2026-07-25)', () => {
  const has = (resource: string, action: string, scope: string) =>
    DEFAULT_PERMISSIONS.some(
      (p: any) => p.resource === resource && p.action === action && p.scope === scope
    )

  it('contiene role:create/update/delete:all', () => {
    expect(has('role', 'create', 'all')).toBe(true)
    expect(has('role', 'update', 'all')).toBe(true)
    expect(has('role', 'delete', 'all')).toBe(true)
  })

  it('contiene audit:read/export:all', () => {
    expect(has('audit', 'read', 'all')).toBe(true)
    expect(has('audit', 'export', 'all')).toBe(true)
  })

  it('contiene consultant:manage:all', () => {
    expect(has('consultant', 'manage', 'all')).toBe(true)
  })

  it('non introduce scope diversi da own/facility/all (convenzione esistente)', () => {
    const validScopes = new Set(['own', 'facility', 'all'])
    for (const permission of DEFAULT_PERMISSIONS) {
      expect(validScopes.has(permission.scope)).toBe(true)
    }
  })

  it('ogni permesso è univoco su resource+action+scope (nessun duplicato nel seed)', () => {
    const keys = DEFAULT_PERMISSIONS.map((p: any) => `${p.resource}:${p.action}:${p.scope}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
