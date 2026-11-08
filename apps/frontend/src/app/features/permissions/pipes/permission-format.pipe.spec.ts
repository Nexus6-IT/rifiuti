import { PermissionFormatPipe } from './permission-format.pipe'

/** Task 15: i permessi si leggono in italiano; nessuna stringa inglese per quelli noti. */
describe('PermissionFormatPipe', () => {
  const pipe = new PermissionFormatPipe()
  /** Elenco chiuso: tutti i permessi dei ruoli di sistema (backend: application/admin/system-roles.ts). */
  const PERMESSI_NOTI = [
    'fir:create:all',
    'fir:create:facility',
    'fir:read:all',
    'fir:read:facility',
    'fir:update:all',
    'fir:update:facility',
    'fir:delete:all',
    'fir:delete:own',
    'fir:sign:own',
    'fir:export:all',
    'facility:create:all',
    'facility:read:all',
    'facility:update:all',
    'facility:delete:all',
    'facility:manage-registry:all',
    'facility:assign-users:all',
    'facility:view-analytics:all',
    'facility:configure:all',
    'user:create:all',
    'user:read:all',
    'user:update:all',
    'user:delete:all',
    'user:manage-roles:all',
    'user:view-activity:all',
    'report:create:all',
    'report:read:all',
    'report:export:all',
    'report:schedule:all',
    'report:share:all',
    'analytics:view-dashboard:all',
    'analytics:view-kpis:all',
    'analytics:export-data:all',
    'analytics:configure-metrics:all',
    'notification:read:own',
    'notification:manage:all',
    'notification:send:all',
    'admin:view-audit-log:all',
    'admin:manage-roles:all',
    'admin:manage-permissions:all',
    'admin:configure-tenant:all',
    'admin:manage-subscriptions:all',
    'admin:view-system-health:all',
    'system:manage-integrations:all',
    'system:manage-backups:all',
    'system:view-logs:all',
    'role:create:all',
    'role:update:all',
    'role:delete:all',
    'audit:read:all',
    'audit:export:all',
    'consultant:manage:all',
    'user:impersonate:all',
  ]
  const PAROLE_INGLESI =
    /\b(create|view|edit|delete|read|manage|export|send|assign|share|schedule|configure|sign|for|own|all|the|users?|roles?|permissions?|impersonate|invalid|data)\b/i

  it('non restituisce mai una stringa inglese per i permessi noti', () => {
    for (const permesso of PERMESSI_NOTI) {
      for (const modo of ['long', 'short'] as const) {
        const testo = pipe.transform(permesso, modo)
        expect(testo).withContext(`${permesso}/${modo}: «${testo}»`).not.toMatch(PAROLE_INGLESI)
      }
    }
  })

  it('usa i nomi attesi', () => {
    expect(pipe.transform('analytics:view-dashboard:all')).toBe('Vedere le analisi della dashboard')
    expect(pipe.transform('fir:create:facility')).toBe('Creare i FIR delle sedi assegnate')
    expect(pipe.transform('fir:create:facility', 'short')).toBe('Creare i FIR')
    expect(pipe.transform('fir:delete:own')).toBe('Eliminare i propri FIR')
    expect(pipe.transform('*')).toBe('Tutti i permessi')
  })

  it('un permesso non censito resta in italiano e non rompe nulla', () => {
    expect(pipe.transform('mud:read:all')).not.toMatch(PAROLE_INGLESI)
    expect(pipe.transform('')).toBe('Permesso non valido')
    expect(pipe.transform('rotto')).toBe('Permesso non valido')
  })
})
