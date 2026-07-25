import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Catalogo dei permessi atomici seedati.
 *
 * Esportato (invece di restare una `const` locale) per essere riusato dai test
 * di unità senza dover istanziare un `PrismaClient` reale — stesso pattern di
 * `SYSTEM_ROLES` in `src/application/admin/system-roles.ts`.
 */
export const DEFAULT_PERMISSIONS = [
  // FIR Module (14 permissions)
  {
    resource: 'fir',
    action: 'create',
    scope: 'own',
    description: 'Create FIR documents owned by user',
    isSensitive: false,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'create',
    scope: 'facility',
    description: 'Create FIR documents for assigned facilities',
    isSensitive: false,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'create',
    scope: 'all',
    description: 'Create FIR documents for entire tenant',
    isSensitive: true,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'read',
    scope: 'own',
    description: 'View own FIR documents',
    isSensitive: false,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'read',
    scope: 'facility',
    description: 'View FIR documents for assigned facilities',
    isSensitive: false,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'read',
    scope: 'all',
    description: 'View all FIR documents in tenant',
    isSensitive: false,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'update',
    scope: 'own',
    description: 'Update own FIR documents',
    isSensitive: false,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'update',
    scope: 'facility',
    description: 'Update FIR documents for assigned facilities',
    isSensitive: false,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'update',
    scope: 'all',
    description: 'Update any FIR document in tenant',
    isSensitive: true,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'delete',
    scope: 'own',
    description: 'Delete own draft FIR documents',
    isSensitive: false,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'delete',
    scope: 'facility',
    description: 'Delete FIR documents for assigned facilities',
    isSensitive: true,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'delete',
    scope: 'all',
    description: 'Delete any FIR document in tenant',
    isSensitive: true,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'sign',
    scope: 'own',
    description: 'Digitally sign FIR documents',
    isSensitive: true,
    module: 'FIR',
  },
  {
    resource: 'fir',
    action: 'export',
    scope: 'all',
    description: 'Export FIR documents to PDF/XML',
    isSensitive: false,
    module: 'FIR',
  },

  // Facility Module (8 permissions)
  {
    resource: 'facility',
    action: 'create',
    scope: 'all',
    description: 'Create new facilities',
    isSensitive: false,
    module: 'Facility',
  },
  {
    resource: 'facility',
    action: 'read',
    scope: 'all',
    description: 'View facility information',
    isSensitive: false,
    module: 'Facility',
  },
  {
    resource: 'facility',
    action: 'update',
    scope: 'all',
    description: 'Update facility information',
    isSensitive: false,
    module: 'Facility',
  },
  {
    resource: 'facility',
    action: 'delete',
    scope: 'all',
    description: 'Delete facilities',
    isSensitive: true,
    module: 'Facility',
  },
  {
    resource: 'facility',
    action: 'manage-registry',
    scope: 'all',
    description: 'Manage facility waste registry',
    isSensitive: false,
    module: 'Facility',
  },
  {
    resource: 'facility',
    action: 'assign-users',
    scope: 'all',
    description: 'Assign users to facilities',
    isSensitive: true,
    module: 'Facility',
  },
  {
    resource: 'facility',
    action: 'view-analytics',
    scope: 'all',
    description: 'View facility analytics and reports',
    isSensitive: false,
    module: 'Facility',
  },
  {
    resource: 'facility',
    action: 'configure',
    scope: 'all',
    description: 'Configure facility settings',
    isSensitive: true,
    module: 'Facility',
  },

  // User Module (7 permissions)
  {
    resource: 'user',
    action: 'create',
    scope: 'all',
    description: 'Create new users in tenant',
    isSensitive: true,
    module: 'User',
  },
  {
    resource: 'user',
    action: 'read',
    scope: 'all',
    description: 'View user information',
    isSensitive: false,
    module: 'User',
  },
  {
    resource: 'user',
    action: 'update',
    scope: 'all',
    description: 'Update user information',
    isSensitive: true,
    module: 'User',
  },
  {
    resource: 'user',
    action: 'delete',
    scope: 'all',
    description: 'Delete users from tenant',
    isSensitive: true,
    module: 'User',
  },
  {
    resource: 'user',
    action: 'manage-roles',
    scope: 'all',
    description: 'Assign and revoke user roles',
    isSensitive: true,
    module: 'User',
  },
  {
    resource: 'user',
    action: 'view-activity',
    scope: 'all',
    description: 'View user activity logs',
    isSensitive: false,
    module: 'User',
  },
  {
    resource: 'user',
    action: 'impersonate',
    scope: 'all',
    description: 'Impersonate users for support',
    isSensitive: true,
    module: 'User',
  },

  // Report Module (5 permissions)
  {
    resource: 'report',
    action: 'create',
    scope: 'all',
    description: 'Create custom reports',
    isSensitive: false,
    module: 'Report',
  },
  {
    resource: 'report',
    action: 'read',
    scope: 'all',
    description: 'View reports',
    isSensitive: false,
    module: 'Report',
  },
  {
    resource: 'report',
    action: 'export',
    scope: 'all',
    description: 'Export reports to PDF/Excel',
    isSensitive: false,
    module: 'Report',
  },
  {
    resource: 'report',
    action: 'schedule',
    scope: 'all',
    description: 'Schedule automated reports',
    isSensitive: false,
    module: 'Report',
  },
  {
    resource: 'report',
    action: 'share',
    scope: 'all',
    description: 'Share reports with external parties',
    isSensitive: true,
    module: 'Report',
  },

  // Analytics Module (4 permissions)
  {
    resource: 'analytics',
    action: 'view-dashboard',
    scope: 'all',
    description: 'View analytics dashboard',
    isSensitive: false,
    module: 'Analytics',
  },
  {
    resource: 'analytics',
    action: 'view-kpis',
    scope: 'all',
    description: 'View key performance indicators',
    isSensitive: false,
    module: 'Analytics',
  },
  {
    resource: 'analytics',
    action: 'export-data',
    scope: 'all',
    description: 'Export analytics data',
    isSensitive: true,
    module: 'Analytics',
  },
  {
    resource: 'analytics',
    action: 'configure-metrics',
    scope: 'all',
    description: 'Configure custom metrics',
    isSensitive: false,
    module: 'Analytics',
  },

  // Notification Module (3 permissions)
  {
    resource: 'notification',
    action: 'read',
    scope: 'own',
    description: 'View own notifications',
    isSensitive: false,
    module: 'Notification',
  },
  {
    resource: 'notification',
    action: 'manage',
    scope: 'all',
    description: 'Manage notification settings',
    isSensitive: false,
    module: 'Notification',
  },
  {
    resource: 'notification',
    action: 'send',
    scope: 'all',
    description: 'Send notifications to users',
    isSensitive: true,
    module: 'Notification',
  },

  // Admin Module (6 permissions)
  {
    resource: 'admin',
    action: 'view-audit-log',
    scope: 'all',
    description: 'View system audit logs',
    isSensitive: true,
    module: 'Admin',
  },
  {
    resource: 'admin',
    action: 'manage-roles',
    scope: 'all',
    description: 'Create and manage custom roles',
    isSensitive: true,
    module: 'Admin',
  },
  {
    resource: 'admin',
    action: 'manage-permissions',
    scope: 'all',
    description: 'Manage permission policies',
    isSensitive: true,
    module: 'Admin',
  },
  {
    resource: 'admin',
    action: 'configure-tenant',
    scope: 'all',
    description: 'Configure tenant settings',
    isSensitive: true,
    module: 'Admin',
  },
  {
    resource: 'admin',
    action: 'manage-subscriptions',
    scope: 'all',
    description: 'Manage tenant subscriptions',
    isSensitive: true,
    module: 'Admin',
  },
  {
    resource: 'admin',
    action: 'view-system-health',
    scope: 'all',
    description: 'View system health and monitoring',
    isSensitive: false,
    module: 'Admin',
  },

  // System Module (3 permissions)
  {
    resource: 'system',
    action: 'manage-integrations',
    scope: 'all',
    description: 'Manage RENTRI and external integrations',
    isSensitive: true,
    module: 'System',
  },
  {
    resource: 'system',
    action: 'manage-backups',
    scope: 'all',
    description: 'Manage backup schedules',
    isSensitive: true,
    module: 'System',
  },
  {
    resource: 'system',
    action: 'view-logs',
    scope: 'all',
    description: 'View system logs',
    isSensitive: false,
    module: 'System',
  },

  // Modulo Role (3 permessi) — gestione ruoli custom del tenant.
  // Decisione PO 2026-07-25 (pipeline P4): l'ADMIN gestisce i ruoli custom
  // della propria azienda; il SUPER_ADMIN ovunque, tramite impersonificazione
  // dell'ADMIN del tenant target (non un permesso a parte in questo catalogo,
  // coerente con `admin:manage-roles:all` già esistente per lo stesso motivo).
  // Scope "all" = intero tenant (nessun concetto di scope cross-tenant in
  // questo catalogo, come per gli altri permessi amministrativi).
  {
    resource: 'role',
    action: 'create',
    scope: 'all',
    description: 'Creare ruoli personalizzati per il tenant',
    isSensitive: true,
    module: 'Role',
  },
  {
    resource: 'role',
    action: 'update',
    scope: 'all',
    description: 'Modificare ruoli personalizzati del tenant (incluse le assegnazioni di permessi)',
    isSensitive: true,
    module: 'Role',
  },
  {
    resource: 'role',
    action: 'delete',
    scope: 'all',
    description: 'Eliminare ruoli personalizzati del tenant',
    isSensitive: true,
    module: 'Role',
  },

  // Modulo Audit (2 permessi) — audit trail dei permessi.
  // Decisione PO 2026-07-25: l'ADMIN è responsabile del trattamento e deve
  // poter ricostruire chi ha autorizzato cosa nella propria azienda, in caso
  // di contestazione. Limitato al proprio tenant (scope "all" = tenant, non
  // cross-tenant).
  {
    resource: 'audit',
    action: 'read',
    scope: 'all',
    description: "Consultare l'audit trail dei permessi del tenant",
    isSensitive: true,
    module: 'Audit',
  },
  {
    resource: 'audit',
    action: 'export',
    scope: 'all',
    description: "Esportare l'audit trail dei permessi in CSV (es. ispezioni ARPA)",
    isSensitive: true,
    module: 'Audit',
  },

  // Modulo Consultant (1 permesso) — gestione associazioni multi-tenant dei
  // consulenti. Decisione PO 2026-07-25: l'ADMIN del tenant concede/revoca
  // l'accesso di un consulente alla propria azienda. NB: la dashboard e
  // l'elenco tenant del consulente NON richiedono questo permesso (sono
  // determinati dall'esistenza di associazioni ConsultantTenantAssociation,
  // non da un ruolo fisso) — vedi ConsultantController.listTenants/getDashboard.
  {
    resource: 'consultant',
    action: 'manage',
    scope: 'all',
    description: "Associare o revocare l'accesso di un consulente al tenant",
    isSensitive: true,
    module: 'Consultant',
  },
]

/**
 * Seed default permissions for the WasteFlow platform
 * 56 atomic permissions across 11 modules (idempotente: upsert).
 */
export async function seedPermissions() {
  console.log('🔐 Seeding default permissions...')

  // Upsert permissions (idempotent)
  for (const permission of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: {
        resource_action_scope: {
          resource: permission.resource,
          action: permission.action,
          scope: permission.scope,
        },
      },
      update: {
        description: permission.description,
        isSensitive: permission.isSensitive,
        module: permission.module,
      },
      create: permission,
    })
  }

  console.log(`✅ Seeded ${DEFAULT_PERMISSIONS.length} permissions`)
}

// Run if executed directly
if (require.main === module) {
  seedPermissions()
    .catch(error => {
      console.error('❌ Error seeding permissions:', error)
      process.exit(1)
    })
    .finally(() => {
      prisma.$disconnect()
    })
}
