import { TenantService } from './tenant.service'
import { TenantContext } from '../../core/context/tenant-context'

function costruisci() {
  const prisma: any = {
    tenant: {
      findMany: jest.fn(() => {
        throw new Error('client applicativo: elenco su tutte le aziende non ammesso')
      }),
      findUnique: jest.fn(async () => ({ id: 't-x', _count: { users: 2 } })),
    },
  }
  const sistema: any = { tenant: { findMany: jest.fn().mockResolvedValue([]) } }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const membership: any = {}
  return { prisma, sistema, service: new TenantService(prisma, sistema, logger, membership) }
}

const superAdmin = { id: 'su', role: 'SUPER_ADMIN', tenantId: 't-casa' } as any

describe('TenantService.list', () => {
  // Stati reali del middleware: il super admin ha SEMPRE un tenant nello store
  // (il proprio, oppure quello di X-Tenant-ID).
  it.each([
    ['store = tenant di casa', 't-casa'],
    ['store = tenant da X-Tenant-ID', 't-header'],
  ])('super admin (%s): elenco su tutte le aziende dal client di sistema', async (_n, store) => {
    const t = costruisci()
    await TenantContext.run(
      { isSuperAdmin: true, tenantId: store },
      async () => await t.service.list(superAdmin)
    )
    expect(t.sistema.tenant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
  })

  it('ADMIN di tenant: sempre il client normale', async () => {
    const t = costruisci()
    t.prisma.tenant.findMany = jest.fn().mockResolvedValue([{ id: 'x1' }])
    const visti: (string | null)[] = []
    t.prisma.user = {
      count: jest.fn(async () => {
        visti.push(TenantContext.getStoreTenantId())
        return 3
      }),
    }
    const elenco = await t.service.list({ id: 'a', role: 'ADMIN', tenantId: 't1' } as any)
    expect(elenco).toEqual([{ id: 'x1', _count: { users: 3 } }])
    expect(visti).toEqual(['x1'])
    expect(t.prisma.tenant.findMany).toHaveBeenCalledTimes(1)
    expect(t.sistema.tenant.findMany).not.toHaveBeenCalled()
  })

  it('getById: il conteggio utenti si legge nel contesto del tenant richiesto', async () => {
    const t = costruisci()
    let visto: string | null = null
    t.prisma.tenant.findUnique = jest.fn(async () => {
      visto = TenantContext.getStoreTenantId()
      return { id: 't-x', _count: { users: 2 } }
    })
    await TenantContext.run(
      { isSuperAdmin: true, tenantId: 't-casa' },
      async () => await t.service.getById('t-x', true)
    )
    expect(visto).toBe('t-x')
  })

  it('update: un ADMIN non proprietario riceve 403 senza leggere nel contesto dell altra azienda', async () => {
    const t = costruisci()
    const store: (string | null)[] = []
    t.prisma.tenant.findUnique = jest.fn(async () => {
      store.push(TenantContext.getStoreTenantId())
      return { id: 't-altro', ownerUserId: 'un-altro', _count: { users: 1 } }
    })

    await expect(
      TenantContext.run(
        { tenantId: 't-casa' },
        async () =>
          await t.service.update(
            { id: 'a', role: 'ADMIN', tenantId: 't-casa' } as any,
            't-altro',
            {}
          )
      )
    ).rejects.toThrow('Non sei autorizzato')
    expect(store).toEqual(['t-casa'])
  })

  it('lista ADMIN: conteggi con concorrenza limitata', async () => {
    const t = costruisci()
    const aziende = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}` }))
    t.prisma.tenant.findMany = jest.fn().mockResolvedValue(aziende)
    let inCorso = 0
    let massimo = 0
    t.prisma.user = {
      count: jest.fn(async () => {
        inCorso++
        massimo = Math.max(massimo, inCorso)
        await new Promise(r => setTimeout(r, 5))
        inCorso--
        return 1
      }),
    }
    const elenco = await t.service.list({ id: 'a', role: 'ADMIN', tenantId: 't1' } as any)
    expect(massimo).toBeLessThanOrEqual(4)
    expect(elenco.map((a: any) => a.id)).toEqual(aziende.map(a => a.id))
    expect(elenco.every((a: any) => a._count.users === 1)).toBe(true)
  })
})
