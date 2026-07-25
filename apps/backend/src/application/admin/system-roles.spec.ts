import { SYSTEM_ROLES } from './system-roles'

/**
 * Verifica le decisioni di autorizzazione prese dal committente il 2026-07-25
 * (pipeline P4) per i permessi `role`, `audit`, `consultant`, fino a quel
 * momento assenti dal catalogo e quindi mai raggiungibili da nessun ruolo
 * (RoleController/AuditController/ConsultantController rispondevano 403 a
 * qualunque utente, ADMIN incluso).
 *
 * Decisioni:
 * 1. Gestione ruoli custom → ADMIN del proprio tenant (+ SUPER_ADMIN, che
 *    opera tramite impersonificazione dell'ADMIN del tenant target, non con
 *    un permesso a parte in questo catalogo).
 * 2. Audit trail dei permessi → ADMIN, limitato alla propria azienda.
 * 3. Dashboard consulente → NON gestita da un permesso fisso, ma
 *    dall'esistenza di associazioni ConsultantTenantAssociation (verificato
 *    separatamente in consultant.controller.spec.ts se presente): qui si
 *    verifica solo che 'consultant:manage:all' (le associazioni admin-only)
 *    sia riservato all'ADMIN.
 */
describe('SYSTEM_ROLES — permessi role/audit/consultant (decisione PO 2026-07-25)', () => {
  const findRole = (name: string) => {
    const role = SYSTEM_ROLES.find(r => r.name === name)
    if (!role) throw new Error(`Ruolo di sistema non trovato: ${name}`)
    return role
  }

  it('ADMIN ha i permessi di gestione ruoli custom (create/update/delete, scope tenant)', () => {
    const admin = findRole('ADMIN')
    expect(admin.permissions).toEqual(
      expect.arrayContaining(['role:create:all', 'role:update:all', 'role:delete:all'])
    )
  })

  it("ADMIN ha i permessi di lettura/export dell'audit trail, scope tenant", () => {
    const admin = findRole('ADMIN')
    expect(admin.permissions).toEqual(
      expect.arrayContaining(['audit:read:all', 'audit:export:all'])
    )
  })

  it('ADMIN ha il permesso di gestire le associazioni consulente-tenant', () => {
    const admin = findRole('ADMIN')
    expect(admin.permissions).toEqual(expect.arrayContaining(['consultant:manage:all']))
  })

  it.each(['OPERATOR', 'VIEWER', 'CONSULTANT', 'COMPLIANCE_OFFICER'])(
    "%s NON ha i permessi role:*/audit:*/consultant:manage (riservati all'ADMIN)",
    roleName => {
      const role = findRole(roleName)
      const forbidden = [
        'role:create:all',
        'role:update:all',
        'role:delete:all',
        'audit:read:all',
        'audit:export:all',
        'consultant:manage:all',
      ]
      for (const permission of forbidden) {
        expect(role.permissions).not.toContain(permission)
      }
    }
  )
})
