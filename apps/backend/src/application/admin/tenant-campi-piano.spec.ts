/**
 * Campi di piano (subscriptionTier, subscriptionStatus, firLimitPerMonth,
 * userLimitTotal, aziendeLimit, featureFlags): li imposta solo il SUPER_ADMIN.
 * Per un ADMIN, in modifica vengono ignorati; in creazione il piano resta
 * quello di default (TRIAL/TRIAL, feature derivate dal piano).
 */
import { ForbiddenException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TenantService } from './tenant.service'

const TENANT = 'tenant-uuid'
const ADMIN = 'utente-admin-uuid'
const ALTRO_ADMIN = 'altro-admin-uuid'

function makeService(ownerUserId: string = ADMIN) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: TENANT, ownerUserId }),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: TENANT, ...data })),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: TENANT, ...data })),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ companyLimit: 5 }) },
  }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const membership: any = { checkAccess: jest.fn().mockResolvedValue(true) }
  const service = new TenantService(prisma, prisma, logger, membership)
  // Seeding ruoli e associazione del proprietario non c'entrano con il piano.
  jest.spyOn(service as any, 'seedRoles').mockResolvedValue(undefined)
  jest.spyOn(service as any, 'associateOwner').mockResolvedValue(undefined)
  jest.spyOn(service as any, 'inAzienda').mockImplementation(async (_id: any, fn: any) => fn())
  return { prisma, service }
}

const admin = { id: ADMIN, role: 'ADMIN', tenantId: TENANT } as any
const superAdmin = { id: 'super-uuid', role: 'SUPER_ADMIN', tenantId: TENANT } as any

const CAMPI_PIANO = [
  'subscriptionTier',
  'subscriptionStatus',
  'firLimitPerMonth',
  'userLimitTotal',
  'aziendeLimit',
  'featureFlags',
]

const dtoPiano = {
  subscriptionTier: 'ENTERPRISE',
  subscriptionStatus: 'ACTIVE',
  firLimitPerMonth: 9999,
  userLimitTotal: 999,
  aziendeLimit: 99,
  featureFlags: ['fir'],
}

describe('TenantService — campi di piano', () => {
  it('update: un ADMIN proprietario salva solo i campi anagrafici', async () => {
    const { service, prisma } = makeService()

    await service.update(admin, TENANT, {
      ...dtoPiano,
      telefono: '0612345678',
      reaNumber: 'RM123456',
    } as any)

    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data).toEqual({ telefono: '0612345678', reaNumber: 'RM123456' })
    for (const campo of CAMPI_PIANO) {
      expect(data).not.toHaveProperty(campo)
    }
  })

  it('update: un ADMIN non proprietario riceve Forbidden e nessun update', async () => {
    const { service, prisma } = makeService(ALTRO_ADMIN)

    await expect(
      service.update(admin, TENANT, { telefono: '0612345678' } as any)
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.tenant.update).not.toHaveBeenCalled()
  })

  it('update: il SUPER_ADMIN salva anche i campi di piano', async () => {
    const { service, prisma } = makeService(ALTRO_ADMIN)

    await service.update(superAdmin, TENANT, { ...dtoPiano, telefono: '0612345678' } as any)

    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data).toEqual({ ...dtoPiano, telefono: '0612345678' })
  })

  it('create: per un ADMIN il piano resta TRIAL/TRIAL e le feature derivate dal piano', async () => {
    const { service, prisma } = makeService()
    prisma.tenant.findUnique.mockResolvedValue(null) // partita IVA non ancora registrata

    await service.create(admin, {
      partitaIva: '12345678901',
      ragioneSociale: 'Nuova Srl',
      address: 'Via Roma',
      city: 'Roma',
      province: 'RM',
      postalCode: '00100',
      ...dtoPiano,
    } as any)

    const [{ data }] = prisma.tenant.create.mock.calls[0]
    expect(data.subscriptionTier).toBe('TRIAL')
    expect(data.subscriptionStatus).toBe('TRIAL')
    expect(data.featureFlags).toBe(Prisma.DbNull)
    expect(data).not.toHaveProperty('firLimitPerMonth')
    expect(data).not.toHaveProperty('userLimitTotal')
    expect(data).not.toHaveProperty('aziendeLimit')
  })
})
