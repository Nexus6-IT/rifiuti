import { TenantService } from './tenant.service'
import { TenantContext } from '../../core/context/tenant-context'

function costruisci() {
  const prisma: any = {
    tenant: {
      findMany: jest.fn(() => {
        throw new Error('client applicativo: elenco su tutte le aziende non ammesso')
      }),
    },
  }
  const sistema: any = { tenant: { findMany: jest.fn().mockResolvedValue([]) } }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const membership: any = {}
  return { prisma, sistema, service: new TenantService(prisma, sistema, logger, membership) }
}

const superAdmin = { id: 'su', role: 'SUPER_ADMIN', tenantId: 't-casa' } as any

describe('TenantService.list', () => {
  it('super admin senza azienda: elenchi dal client di sistema; con azienda: client normale', async () => {
    const senza = costruisci()
    await TenantContext.run(
      { isSuperAdmin: true },
      async () => await senza.service.list(superAdmin)
    )
    expect(senza.sistema.tenant.findMany).toHaveBeenCalledTimes(1)

    const con = costruisci()
    con.prisma.tenant.findMany = jest.fn().mockResolvedValue([])
    await TenantContext.run(
      { isSuperAdmin: true, tenantId: 't-scelta' },
      async () => await con.service.list(superAdmin)
    )
    expect(con.prisma.tenant.findMany).toHaveBeenCalledTimes(1)
    expect(con.sistema.tenant.findMany).not.toHaveBeenCalled()
  })

  it('ADMIN di tenant: sempre il client normale', async () => {
    const t = costruisci()
    t.prisma.tenant.findMany = jest.fn().mockResolvedValue([])
    await t.service.list({ id: 'a', role: 'ADMIN', tenantId: 't1' } as any)
    expect(t.prisma.tenant.findMany).toHaveBeenCalledTimes(1)
    expect(t.sistema.tenant.findMany).not.toHaveBeenCalled()
  })
})
