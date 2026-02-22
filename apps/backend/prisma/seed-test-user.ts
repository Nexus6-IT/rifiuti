/**
 * Create Test User and Tenant
 * Per modalità sviluppo - crea un tenant e utente di test
 *
 * UPDATED: Now uses new Roles & Permissions system (Phase 10)
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧪 Creating test tenant and user with NEW Roles & Permissions system...')

  // 1. Create Test Tenant
  const testTenant = await prisma.tenant.upsert({
    where: { partitaIva: '12345678901' },
    update: {},
    create: {
      partitaIva: '12345678901',
      ragioneSociale: 'Azienda Test SRL',
      pec: 'test@pec.aziendatest.it',
      address: 'Via Roma 123',
      city: 'Milano',
      province: 'MI',
      postalCode: '20100',
      country: 'IT',
      subscriptionTier: 'PROFESSIONAL',
      subscriptionStatus: 'ACTIVE',
      firLimitPerMonth: 1000,
      userLimitTotal: 10,
    },
  })

  console.log(`✅ Created tenant: ${testTenant.ragioneSociale} (${testTenant.id})`)

  // 2. Create Test Users (without old role enum - we'll use new system)
  const testUser = await prisma.user.upsert({
    where: { keycloakId: 'dev-user-admin' },
    update: {
      email: 'admin@test.com',
      firstName: 'Admin',
      lastName: 'Test',
    },
    create: {
      tenantId: testTenant.id,
      keycloakId: 'dev-user-admin',
      fiscalCode: 'TSTADM00A01H501Z',
      firstName: 'Admin',
      lastName: 'Test',
      email: 'admin@test.com',
      phone: '+39 333 1234567',
      role: 'ADMIN', // Keep for backward compatibility
    },
  })

  console.log(`✅ Created user: ${testUser.email}`)

  const operatorUser = await prisma.user.upsert({
    where: { keycloakId: 'dev-user-operator' },
    update: {
      email: 'operator@test.com',
    },
    create: {
      tenantId: testTenant.id,
      keycloakId: 'dev-user-operator',
      fiscalCode: 'TSTOPR00A01H501Z',
      firstName: 'Operatore',
      lastName: 'Test',
      email: 'operator@test.com',
      phone: '+39 333 2345678',
      role: 'OPERATOR', // Keep for backward compatibility
    },
  })

  console.log(`✅ Created user: ${operatorUser.email}`)

  const viewerUser = await prisma.user.upsert({
    where: { keycloakId: 'dev-user-viewer' },
    update: {
      email: 'viewer@test.com',
    },
    create: {
      tenantId: testTenant.id,
      keycloakId: 'dev-user-viewer',
      fiscalCode: 'TSTVWR00A01H501Z',
      firstName: 'Lettore',
      lastName: 'Test',
      email: 'viewer@test.com',
      role: 'VIEWER', // Keep for backward compatibility
    },
  })

  console.log(`✅ Created user: ${viewerUser.email}`)

  // 3. Create/recreate the SQL function first (workaround for function update issues)
  console.log('\n🔧 Creating SQL function for role seeding...')

  // Drop existing function first
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS seed_default_roles_for_tenant(UUID, UUID);`)

  // Create the function
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION seed_default_roles_for_tenant(
        p_tenant_id UUID,
        p_created_by_user_id UUID
    )
    RETURNS TABLE (
        role_id UUID,
        role_name VARCHAR(100)
    )
    LANGUAGE plpgsql
    AS $$
    DECLARE
        v_admin_role_id UUID;
        v_operator_role_id UUID;
        v_viewer_role_id UUID;
        v_consultant_role_id UUID;
        v_compliance_officer_role_id UUID;
    BEGIN
        INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
        VALUES (gen_random_uuid(), p_tenant_id, 'ADMIN', 'Full administrative access to tenant', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id INTO v_admin_role_id;

        INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
        VALUES (gen_random_uuid(), p_tenant_id, 'OPERATOR', 'Standard operational access for facility-scoped FIR management', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id INTO v_operator_role_id;

        INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
        VALUES (gen_random_uuid(), p_tenant_id, 'VIEWER', 'Read-only access to facility data', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id INTO v_viewer_role_id;

        INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
        VALUES (gen_random_uuid(), p_tenant_id, 'CONSULTANT', 'Environmental consultant managing multiple client tenants', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id INTO v_consultant_role_id;

        INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
        VALUES (gen_random_uuid(), p_tenant_id, 'COMPLIANCE_OFFICER', 'Compliance auditor with audit trail access', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id INTO v_compliance_officer_role_id;

        INSERT INTO role_permissions (role_id, permission_id, granted_by)
        SELECT v_admin_role_id, p.id, p_created_by_user_id
        FROM permissions p
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permissions (role_id, permission_id, granted_by)
        SELECT v_operator_role_id, p.id, p_created_by_user_id
        FROM permissions p
        WHERE p.resource IN ('fir', 'registry', 'reports')
          AND p.action IN ('read', 'create', 'update')
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permissions (role_id, permission_id, granted_by)
        SELECT v_viewer_role_id, p.id, p_created_by_user_id
        FROM permissions p
        WHERE p.action = 'read'
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permissions (role_id, permission_id, granted_by)
        SELECT v_consultant_role_id, p.id, p_created_by_user_id
        FROM permissions p
        WHERE p.resource IN ('fir', 'registry', 'reports', 'analytics')
          AND p.action IN ('read', 'export')
        ON CONFLICT DO NOTHING;

        INSERT INTO role_permissions (role_id, permission_id, granted_by)
        SELECT v_compliance_officer_role_id, p.id, p_created_by_user_id
        FROM permissions p
        WHERE p.resource IN ('audit', 'reports', 'compliance')
        ON CONFLICT DO NOTHING;

        RETURN QUERY
        SELECT v_admin_role_id, 'ADMIN'::VARCHAR(100)
        UNION ALL SELECT v_operator_role_id, 'OPERATOR'::VARCHAR(100)
        UNION ALL SELECT v_viewer_role_id, 'VIEWER'::VARCHAR(100)
        UNION ALL SELECT v_consultant_role_id, 'CONSULTANT'::VARCHAR(100)
        UNION ALL SELECT v_compliance_officer_role_id, 'COMPLIANCE_OFFICER'::VARCHAR(100);
    END;
    $$;
  `)
  console.log('✅ SQL function created')

  // 4. Seed default roles for tenant using SQL function
  console.log('\n📦 Seeding default roles for tenant...')

  const rolesResult = await prisma.$queryRaw<Array<{ role_name: string; role_id: string }>>`
    SELECT * FROM seed_default_roles_for_tenant(
      ${testTenant.id}::UUID,
      ${testUser.id}::UUID
    );
  `

  console.log(`✅ Created ${rolesResult.length} system roles:`)
  rolesResult.forEach(role => {
    console.log(`   - ${role.role_name} (${role.role_id})`)
  })

  // 4. Assign roles to users using new UserRoleAssignment system
  console.log('\n🔐 Assigning roles to users...')

  // Find the created roles
  const adminRole = await prisma.role.findFirst({
    where: { tenantId: testTenant.id, name: 'ADMIN' }
  })

  const operatorRole = await prisma.role.findFirst({
    where: { tenantId: testTenant.id, name: 'OPERATOR' }
  })

  const viewerRole = await prisma.role.findFirst({
    where: { tenantId: testTenant.id, name: 'VIEWER' }
  })

  if (!adminRole || !operatorRole || !viewerRole) {
    throw new Error('Failed to find created roles')
  }

  // Assign ADMIN role to admin user
  await prisma.userRoleAssignment.upsert({
    where: {
      userId_roleId_tenantId: {
        userId: testUser.id,
        roleId: adminRole.id,
        tenantId: testTenant.id,
      }
    },
    update: {},
    create: {
      userId: testUser.id,
      roleId: adminRole.id,
      tenantId: testTenant.id,
      assignedBy: testUser.id, // Self-assigned for seed
      assignedAt: new Date(),
    }
  })
  console.log(`   ✓ ${testUser.email} → ADMIN`)

  // Assign OPERATOR role to operator user
  await prisma.userRoleAssignment.upsert({
    where: {
      userId_roleId_tenantId: {
        userId: operatorUser.id,
        roleId: operatorRole.id,
        tenantId: testTenant.id,
      }
    },
    update: {},
    create: {
      userId: operatorUser.id,
      roleId: operatorRole.id,
      tenantId: testTenant.id,
      assignedBy: testUser.id, // Assigned by admin
      assignedAt: new Date(),
    }
  })
  console.log(`   ✓ ${operatorUser.email} → OPERATOR`)

  // Assign VIEWER role to viewer user
  await prisma.userRoleAssignment.upsert({
    where: {
      userId_roleId_tenantId: {
        userId: viewerUser.id,
        roleId: viewerRole.id,
        tenantId: testTenant.id,
      }
    },
    update: {},
    create: {
      userId: viewerUser.id,
      roleId: viewerRole.id,
      tenantId: testTenant.id,
      assignedBy: testUser.id, // Assigned by admin
      assignedAt: new Date(),
    }
  })
  console.log(`   ✓ ${viewerUser.email} → VIEWER`)

  console.log('\n📊 Summary:')
  console.log(`   Tenant: ${testTenant.ragioneSociale}`)
  console.log(`   Users: 3 (1 ADMIN, 1 OPERATOR, 1 VIEWER)`)
  console.log(`   System Roles: ${rolesResult.length} (ADMIN, OPERATOR, VIEWER, CONSULTANT, COMPLIANCE_OFFICER)`)
  console.log(`   Permissions: 60+ seeded via SQL`)
  console.log('\n🎉 Test data created successfully with NEW Roles & Permissions system!')
  console.log('\n📝 You can now login with:')
  console.log('   - admin@test.com (ADMIN - full access)')
  console.log('   - operator@test.com (OPERATOR - facility-scoped)')
  console.log('   - viewer@test.com (VIEWER - read-only)')
  console.log('\n💡 Note: These users use keycloakId bypass for development')
}

main()
  .catch(e => {
    console.error('❌ Error creating test data:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
