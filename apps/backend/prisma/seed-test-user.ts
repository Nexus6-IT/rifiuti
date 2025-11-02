/**
 * Create Test User and Tenant
 * Per modalità sviluppo - crea un tenant e utente di test
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧪 Creating test tenant and user...')

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

  // 2. Create Test User (Admin)
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
      role: 'ADMIN',
    },
  })

  console.log(`✅ Created user: ${testUser.email} (${testUser.role})`)

  // 3. Create Additional Test Users
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
      role: 'OPERATOR',
    },
  })

  console.log(`✅ Created user: ${operatorUser.email} (${operatorUser.role})`)

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
      role: 'VIEWER',
    },
  })

  console.log(`✅ Created user: ${viewerUser.email} (${viewerUser.role})`)

  console.log('\n📊 Summary:')
  console.log(`   Tenant: ${testTenant.ragioneSociale}`)
  console.log(`   Users: 3 (1 ADMIN, 1 OPERATOR, 1 VIEWER)`)
  console.log('\n🎉 Test data created successfully!')
  console.log('\n📝 You can now login with:')
  console.log('   - admin@test.com (ADMIN)')
  console.log('   - operator@test.com (OPERATOR)')
  console.log('   - viewer@test.com (VIEWER)')
}

main()
  .catch(e => {
    console.error('❌ Error creating test data:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
