import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed default system roles for the WasteFlow platform
 * 5 system roles: ADMIN, OPERATOR, VIEWER, CONSULTANT, COMPLIANCE_OFFICER
 */
export async function seedRoles() {
  console.log('👥 Seeding default system roles...');

  // Get all permissions to assign to roles
  const allPermissions = await prisma.permission.findMany();

  const permissionMap = allPermissions.reduce(
    (acc, p) => {
      const key = `${p.resource}:${p.action}:${p.scope}`;
      acc[key] = p.id;
      return acc;
    },
    {} as Record<string, string>,
  );

  // Define system roles with their permission sets
  const roles = [
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
      description:
        'Read-only access. Can view FIRs, facilities, and reports but cannot modify data.',
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
  ];

  // Get a system user ID for createdBy (use first user or create placeholder)
  const systemUser = await prisma.user.findFirst();
  if (!systemUser) {
    console.warn(
      '⚠️  No users found in database. Roles will be created without createdBy reference.',
    );
    console.warn(
      '   Run user seed first or manually update createdBy after user creation.',
    );
    return;
  }

  // Create roles for each tenant
  const tenants = await prisma.tenant.findMany();
  let rolesCreated = 0;

  for (const tenant of tenants) {
    for (const roleConfig of roles) {
      // Upsert role
      const role = await prisma.role.upsert({
        where: {
          tenantId_name: {
            tenantId: tenant.id,
            name: roleConfig.name,
          },
        },
        update: {
          description: roleConfig.description,
          isSystemRole: true,
        },
        create: {
          tenantId: tenant.id,
          name: roleConfig.name,
          description: roleConfig.description,
          isSystemRole: true,
          createdBy: systemUser.id,
        },
      });

      // Assign permissions to role
      for (const permissionKey of roleConfig.permissions) {
        const permissionId = permissionMap[permissionKey];
        if (!permissionId) {
          console.warn(`⚠️  Permission not found: ${permissionKey}`);
          continue;
        }

        await prisma.rolePermission.upsert({
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
            grantedBy: systemUser.id,
          },
        });
      }

      rolesCreated++;
    }
  }

  console.log(
    `✅ Seeded ${rolesCreated} system roles across ${tenants.length} tenant(s)`,
  );
}

// Run if executed directly
if (require.main === module) {
  seedRoles()
    .catch((error) => {
      console.error('❌ Error seeding roles:', error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}
