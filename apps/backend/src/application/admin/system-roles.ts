import { PrismaClient } from '@prisma/client'

/**
 * System roles — definizione canonica dei 5 ruoli di sistema WasteFlow e
 * helper di seeding per-tenant.
 *
 * Sorgente di verità UNICA, riusata sia dal seed CLI (`prisma/seeds/roles.seed.ts`)
 * sia a runtime dalla creazione tenant via API (`TenantService.create`), così che
 * ogni nuovo tenant nasca già con i propri ruoli (ADMIN/OPERATOR/VIEWER/
 * CONSULTANT/COMPLIANCE_OFFICER) e relativi permessi.
 *
 * NB: vive in `src/` (non in `prisma/seeds/`) per essere importabile dal codice
 * applicativo senza trascinare l'istanza `PrismaClient` standalone del seed né
 * file fuori dalla compilazione `nest build`.
 */

/**
 * Forma minima del client Prisma necessaria al seeding dei ruoli.
 * Compatibile sia con `PrismaClient` (seed CLI) sia con `PrismaService`
 * (chiamata runtime dal TenantService).
 */
export type RoleSeedClient = Pick<PrismaClient, 'permission' | 'role' | 'rolePermission'>

/** Configurazione di un singolo ruolo di sistema (nome + permessi). */
export interface SystemRoleConfig {
  name: string
  description: string
  permissions: string[]
}

/**
 * Definizione canonica dei 5 ruoli di sistema della piattaforma WasteFlow.
 * Permessi espressi come `resource:action:scope` (risolti su `Permission`).
 */
export const SYSTEM_ROLES: SystemRoleConfig[] = [
  {
    name: 'ADMIN',
    description:
      'Full administrative access to tenant. Can manage users, roles, permissions, and all resources.',
    permissions: [
      // FIR - Full access
      'fir:create:all',
      'fir:read:all',
      'fir:update:all',
      'fir:delete:all',
      'fir:sign:own',
      'fir:export:all',
      // Facility - Full access
      'facility:create:all',
      'facility:read:all',
      'facility:update:all',
      'facility:delete:all',
      'facility:manage-registry:all',
      'facility:assign-users:all',
      'facility:view-analytics:all',
      'facility:configure:all',
      // User - Full access
      'user:create:all',
      'user:read:all',
      'user:update:all',
      'user:delete:all',
      'user:manage-roles:all',
      'user:view-activity:all',
      // Report - Full access
      'report:create:all',
      'report:read:all',
      'report:export:all',
      'report:schedule:all',
      'report:share:all',
      // Analytics - Full access
      'analytics:view-dashboard:all',
      'analytics:view-kpis:all',
      'analytics:export-data:all',
      'analytics:configure-metrics:all',
      // Notification - Full access
      'notification:read:own',
      'notification:manage:all',
      'notification:send:all',
      // Admin - Full access
      'admin:view-audit-log:all',
      'admin:manage-roles:all',
      'admin:manage-permissions:all',
      'admin:configure-tenant:all',
      'admin:manage-subscriptions:all',
      'admin:view-system-health:all',
      // System - Full access
      'system:manage-integrations:all',
      'system:manage-backups:all',
      'system:view-logs:all',
    ],
  },
  {
    name: 'OPERATOR',
    description:
      'Standard operational access. Can create and manage FIRs for assigned facilities, view reports.',
    permissions: [
      // FIR - Facility-scoped
      'fir:create:facility',
      'fir:read:facility',
      'fir:update:facility',
      'fir:delete:own',
      'fir:sign:own',
      'fir:export:all',
      // Facility - Read access
      'facility:read:all',
      'facility:manage-registry:all',
      'facility:view-analytics:all',
      // User - View only
      'user:read:all',
      // Report - View and export
      'report:read:all',
      'report:export:all',
      // Analytics - View access
      'analytics:view-dashboard:all',
      'analytics:view-kpis:all',
      // Notification - Own only
      'notification:read:own',
      'notification:manage:all',
    ],
  },
  {
    name: 'VIEWER',
    description: 'Read-only access. Can view FIRs, facilities, and reports but cannot modify data.',
    permissions: [
      // FIR - Read only
      'fir:read:all',
      'fir:export:all',
      // Facility - Read only
      'facility:read:all',
      'facility:view-analytics:all',
      // User - Read only
      'user:read:all',
      // Report - Read and export
      'report:read:all',
      'report:export:all',
      // Analytics - View only
      'analytics:view-dashboard:all',
      'analytics:view-kpis:all',
      // Notification - Own only
      'notification:read:own',
    ],
  },
  {
    name: 'CONSULTANT',
    description:
      'Environmental consultant managing multiple client tenants. Cross-tenant access with scoped permissions.',
    permissions: [
      // FIR - Full tenant access
      'fir:create:all',
      'fir:read:all',
      'fir:update:all',
      'fir:sign:own',
      'fir:export:all',
      // Facility - Full access
      'facility:create:all',
      'facility:read:all',
      'facility:update:all',
      'facility:manage-registry:all',
      'facility:view-analytics:all',
      'facility:configure:all',
      // User - Limited management
      'user:read:all',
      'user:create:all',
      'user:update:all',
      'user:manage-roles:all',
      'user:view-activity:all',
      // Report - Full access
      'report:create:all',
      'report:read:all',
      'report:export:all',
      'report:schedule:all',
      'report:share:all',
      // Analytics - Full access
      'analytics:view-dashboard:all',
      'analytics:view-kpis:all',
      'analytics:export-data:all',
      'analytics:configure-metrics:all',
      // Notification
      'notification:read:own',
      'notification:manage:all',
      // Admin - Limited access
      'admin:view-audit-log:all',
      'admin:view-system-health:all',
      // System
      'system:view-logs:all',
    ],
  },
  {
    name: 'COMPLIANCE_OFFICER',
    description:
      'Compliance and audit specialist. Full read access, audit log access, report generation.',
    permissions: [
      // FIR - Read and export
      'fir:read:all',
      'fir:export:all',
      // Facility - Read and analytics
      'facility:read:all',
      'facility:view-analytics:all',
      // User - View activity
      'user:read:all',
      'user:view-activity:all',
      // Report - Full reporting access
      'report:create:all',
      'report:read:all',
      'report:export:all',
      'report:schedule:all',
      'report:share:all',
      // Analytics - Full access
      'analytics:view-dashboard:all',
      'analytics:view-kpis:all',
      'analytics:export-data:all',
      'analytics:configure-metrics:all',
      // Notification
      'notification:read:own',
      'notification:manage:all',
      // Admin - Audit access
      'admin:view-audit-log:all',
      'admin:view-system-health:all',
      // System
      'system:view-logs:all',
    ],
  },
]

/**
 * Crea/aggiorna i 5 ruoli di sistema per UN singolo tenant e assegna i relativi
 * permessi. Idempotente (upsert). Riusato sia dal seed globale sia dalla
 * creazione tenant via API.
 *
 * @param db        client Prisma (PrismaClient o PrismaService).
 * @param tenantId  tenant per cui creare i ruoli.
 * @param createdBy id utente da registrare come autore (createdBy/grantedBy).
 * @returns numero di ruoli creati/aggiornati.
 */
export async function seedRolesForTenant(
  db: RoleSeedClient,
  tenantId: string,
  createdBy: string
): Promise<number> {
  // Map permessi (resource:action:scope) → id, una sola query.
  const allPermissions = await db.permission.findMany()
  const permissionMap = allPermissions.reduce(
    (acc, p) => {
      acc[`${p.resource}:${p.action}:${p.scope}`] = p.id
      return acc
    },
    {} as Record<string, string>
  )

  let rolesCreated = 0

  for (const roleConfig of SYSTEM_ROLES) {
    // Upsert role
    const role = await db.role.upsert({
      where: {
        tenantId_name: {
          tenantId,
          name: roleConfig.name,
        },
      },
      update: {
        description: roleConfig.description,
        isSystemRole: true,
      },
      create: {
        tenantId,
        name: roleConfig.name,
        description: roleConfig.description,
        isSystemRole: true,
        createdBy,
      },
    })

    // Assign permissions to role
    for (const permissionKey of roleConfig.permissions) {
      const permissionId = permissionMap[permissionKey]
      if (!permissionId) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️  Permission not found: ${permissionKey}`)
        continue
      }

      await db.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId,
          grantedBy: createdBy,
        },
      })
    }

    rolesCreated++
  }

  return rolesCreated
}
