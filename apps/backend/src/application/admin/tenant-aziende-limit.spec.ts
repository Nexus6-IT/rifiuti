/**
 * `Tenant.aziendeLimit` (quota di aziende del gruppo) deve essere impostabile
 * dall'API, altrimenti la quota introdotta resta inerte e servirebbe una UPDATE
 * a mano in produzione.
 *
 * E' un campo di piano: stesso trattamento di subscriptionTier, userLimitTotal
 * e firLimitPerMonth — solo il SUPER_ADMIN lo imposta, per un ADMIN viene
 * ignorato anche se presente nel payload.
 */
import { TenantService } from './tenant.service'

const TENANT = 'tenant-madre-uuid'
const ADMIN = 'utente-admin-uuid'

function makeService() {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: TENANT, ownerUserId: ADMIN }),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: TENANT, ...data })),
    },
  }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const membership: any = { checkAccess: jest.fn().mockResolvedValue(true) }
  return { prisma, service: new TenantService(prisma, logger, membership) }
}

const adminCorrente = { id: ADMIN, role: 'ADMIN', tenantId: TENANT } as any
const superAdminCorrente = { id: 'super-uuid', role: 'SUPER_ADMIN', tenantId: TENANT } as any

describe('TenantService.update — aziendeLimit', () => {
  it('il SUPER_ADMIN imposta la quota aziende del gruppo', async () => {
    const { service, prisma } = makeService()

    await service.update(superAdminCorrente, TENANT, { aziendeLimit: 10 } as any)

    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data.aziendeLimit).toBe(10)
  })

  it('il SUPER_ADMIN puo azzerare la quota con null (torna a valere companyLimit)', async () => {
    const { service, prisma } = makeService()

    await service.update(superAdminCorrente, TENANT, { aziendeLimit: null } as any)

    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data.aziendeLimit).toBeNull()
  })

  it('per un ADMIN proprietario il campo viene ignorato, come gli altri campi di piano', async () => {
    const { service, prisma } = makeService()

    await service.update(adminCorrente, TENANT, {
      aziendeLimit: 99,
      userLimitTotal: 99,
      ragioneSociale: 'Nuova Ragione Srl',
    } as any)

    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data).not.toHaveProperty('aziendeLimit')
    expect(data).not.toHaveProperty('userLimitTotal')
    expect(data.ragioneSociale).toBe('Nuova Ragione Srl')
  })
})
