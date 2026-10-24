import { UserAdminService } from './user-admin.service'
import { TenantContext } from '../../core/context/tenant-context'

function costruisci() {
  const prisma: any = { user: { findMany: jest.fn().mockResolvedValue([]) } }
  const sistema: any = { user: { findMany: jest.fn().mockResolvedValue([]) } }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return {
    prisma,
    sistema,
    service: new UserAdminService(prisma, sistema, {} as any, logger, {} as any),
  }
}

const superAdmin = { id: 'su', role: 'SUPER_ADMIN', tenantId: 't-casa' } as any

describe('UserAdminService.listUsers', () => {
  it('super admin senza azienda: elenchi dal client di sistema; con azienda: client normale', async () => {
    const senza = costruisci()
    await TenantContext.run(
      { isSuperAdmin: true },
      async () => await senza.service.listUsers(superAdmin)
    )
    expect(senza.sistema.user.findMany).toHaveBeenCalledTimes(1)
    expect(senza.prisma.user.findMany).not.toHaveBeenCalled()

    const con = costruisci()
    await TenantContext.run(
      { isSuperAdmin: true, tenantId: 't-scelta' },
      async () => await con.service.listUsers(superAdmin)
    )
    expect(con.prisma.user.findMany).toHaveBeenCalledTimes(1)
    expect(con.sistema.user.findMany).not.toHaveBeenCalled()
  })

  it('ADMIN di tenant: sempre il client normale, filtrato sul proprio tenant', async () => {
    const t = costruisci()
    await t.service.listUsers({ id: 'a', role: 'ADMIN', tenantId: 't1' } as any, 'altro')
    expect(t.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1' } })
    )
    expect(t.sistema.user.findMany).not.toHaveBeenCalled()
  })
})
