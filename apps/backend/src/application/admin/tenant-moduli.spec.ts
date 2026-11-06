/**
 * Moduli di un'azienda: `featureFlags` = aggiunti oltre al piano, `featureTolte` = tolti dal piano.
 * Il SUPER_ADMIN manda la selezione completa; il service calcola i due insiemi sul piano risultante.
 * Un ADMIN non tocca né le colonne né le vede nelle risposte.
 */
import { Prisma, SubscriptionTier } from '@prisma/client'
import { TenantService } from './tenant.service'
import { PLAN_FEATURES } from './feature-catalog'

const TENANT = 'tenant-uuid'
const ADMIN = 'utente-admin-uuid'

function makeService(tier: SubscriptionTier = SubscriptionTier.TRIAL) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        id: TENANT,
        ownerUserId: ADMIN,
        subscriptionTier: tier,
        featureFlags: null,
        featureTolte: null,
      }),
      update: jest.fn(({ data }: any) =>
        Promise.resolve({
          id: TENANT,
          subscriptionTier: data.subscriptionTier ?? tier,
          featureFlags: data.featureFlags ?? null,
          featureTolte: data.featureTolte ?? null,
        })
      ),
      create: jest.fn(({ data }: any) =>
        Promise.resolve({
          id: TENANT,
          subscriptionTier: data.subscriptionTier ?? 'TRIAL',
          featureFlags: data.featureFlags ?? null,
          featureTolte: data.featureTolte ?? null,
        })
      ),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ companyLimit: 5 }) },
  }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const membership: any = { checkAccess: jest.fn().mockResolvedValue(true) }
  const service = new TenantService(prisma, prisma, logger, membership)
  jest.spyOn(service as any, 'seedRoles').mockResolvedValue(undefined)
  jest.spyOn(service as any, 'associateOwner').mockResolvedValue(undefined)
  jest.spyOn(service as any, 'inAzienda').mockImplementation(async (_id: any, fn: any) => fn())
  return { prisma, service }
}

const admin = { id: ADMIN, role: 'ADMIN', tenantId: TENANT } as any
const superAdmin = { id: 'super-uuid', role: 'SUPER_ADMIN', tenantId: TENANT } as any

describe('TenantService — moduli aggiunti e tolti', () => {
  it('update SUPER_ADMIN: selezione senza un modulo del piano -> featureTolte lo contiene', async () => {
    const { service, prisma } = makeService()
    await service.update(superAdmin, TENANT, { featureFlags: ['fir', 'cer', 'anagrafiche'] } as any)
    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data.featureTolte).toEqual(['registro'])
    expect(data.featureFlags).toEqual([])
  })

  it('update SUPER_ADMIN: selezione con un extra -> featureFlags lo contiene', async () => {
    const { service, prisma } = makeService()
    await service.update(superAdmin, TENANT, {
      featureFlags: [...PLAN_FEATURES.TRIAL, 'esg'],
    } as any)
    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data.featureFlags).toEqual(['esg'])
    expect(data.featureTolte).toEqual([])
  })

  it('update SUPER_ADMIN: cambio di piano con selezione nella stessa richiesta -> calcolo sul nuovo piano', async () => {
    const { service, prisma } = makeService(SubscriptionTier.TRIAL)
    // 'mud' e' extra rispetto a TRIAL ma del piano PROFESSIONAL: non deve finire fra gli aggiunti.
    await service.update(superAdmin, TENANT, {
      subscriptionTier: 'PROFESSIONAL',
      featureFlags: ['fir', 'mud'],
    } as any)
    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data.featureFlags).toEqual([])
    expect(data.featureTolte).toContain('cer')
    expect(data.featureTolte).not.toContain('mud')
    expect(data.featureTolte).not.toContain('fir')
  })

  it('update SUPER_ADMIN senza featureFlags: le colonne non si toccano', async () => {
    const { service, prisma } = makeService()
    await service.update(superAdmin, TENANT, { telefono: '06' } as any)
    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data).not.toHaveProperty('featureFlags')
    expect(data).not.toHaveProperty('featureTolte')
  })

  it('create SUPER_ADMIN: calcola aggiunti e tolti sul piano indicato', async () => {
    const { service, prisma } = makeService()
    prisma.tenant.findUnique.mockResolvedValue(null)
    await service.create(superAdmin, {
      partitaIva: '12345678901',
      ragioneSociale: 'X',
      featureFlags: ['fir', 'esg'],
    } as any)
    const [{ data }] = prisma.tenant.create.mock.calls[0]
    expect(data.featureFlags).toEqual(['esg'])
    expect(data.featureTolte).toEqual(['cer', 'anagrafiche', 'registro'])
  })

  it('ADMIN: update non cambia le colonne e la risposta non le riporta', async () => {
    const { service, prisma } = makeService()
    const res: any = await service.update(admin, TENANT, {
      featureFlags: ['fir'],
      telefono: '06',
    } as any)
    const [{ data }] = prisma.tenant.update.mock.calls[0]
    expect(data).not.toHaveProperty('featureFlags')
    expect(data).not.toHaveProperty('featureTolte')
    expect(res).not.toHaveProperty('featureFlags')
    expect(res).not.toHaveProperty('featureTolte')
    expect(res).not.toHaveProperty('moduliEffettivi')
  })

  it('ADMIN: create non imposta le colonne e la risposta non le riporta', async () => {
    const { service, prisma } = makeService()
    prisma.tenant.findUnique.mockResolvedValue(null)
    const res: any = await service.create(admin, {
      partitaIva: '12345678901',
      ragioneSociale: 'X',
      featureFlags: ['esg'],
    } as any)
    const [{ data }] = prisma.tenant.create.mock.calls[0]
    expect(data.featureTolte).toBe(Prisma.DbNull)
    expect(res).not.toHaveProperty('featureFlags')
    expect(res).not.toHaveProperty('featureTolte')
  })

  it('SUPER_ADMIN: la risposta di update ha moduliEffettivi', async () => {
    const { service } = makeService()
    const res: any = await service.update(superAdmin, TENANT, {
      featureFlags: ['fir', 'esg'],
    } as any)
    expect([...res.moduliEffettivi].sort()).toEqual(['esg', 'fir'])
  })

  it('list: ADMIN senza i campi, SUPER_ADMIN con moduliEffettivi', async () => {
    const { service, prisma } = makeService()
    const riga = {
      id: TENANT,
      subscriptionTier: 'TRIAL',
      featureFlags: ['esg'],
      featureTolte: ['cer'],
      _count: { users: 1 },
    }
    prisma.tenant.findMany = jest.fn().mockResolvedValue([riga])
    prisma.user.count = jest.fn().mockResolvedValue(1)
    const comeAdmin: any = await service.list(admin)
    expect(comeAdmin[0]).not.toHaveProperty('featureFlags')
    expect(comeAdmin[0]).not.toHaveProperty('featureTolte')
    const comeSuper: any = await service.list(superAdmin)
    expect(comeSuper[0].moduliEffettivi).toContain('esg')
    expect(comeSuper[0].moduliEffettivi).not.toContain('cer')
  })
})
