import { PrismaClient } from '@prisma/client';
import { seedRolesForTenant } from '../../src/application/admin/system-roles';

// Re-export per retro-compatibilità con eventuali import esistenti.
export {
  SYSTEM_ROLES,
  seedRolesForTenant,
  type SystemRoleConfig,
} from '../../src/application/admin/system-roles';

const prisma = new PrismaClient();

/**
 * Seed default system roles for the WasteFlow platform
 * 5 system roles: ADMIN, OPERATOR, VIEWER, CONSULTANT, COMPLIANCE_OFFICER
 *
 * Seed globale: applica i ruoli a TUTTI i tenant esistenti, delegando a
 * `seedRolesForTenant` (sorgente di verità in `src/application/admin/system-roles.ts`).
 */
export async function seedRoles() {
  console.log('👥 Seeding default system roles...');

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
    rolesCreated += await seedRolesForTenant(prisma, tenant.id, systemUser.id);
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
