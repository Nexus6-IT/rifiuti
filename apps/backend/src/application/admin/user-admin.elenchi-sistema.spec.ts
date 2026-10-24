import { UserAdminService } from './user-admin.service'
import { TenantContext } from '../../core/context/tenant-context'

function costruisci() {
  const viste: { op: string; store: string | null }[] = []
  const prisma: any = {
    user: {
      findMany: jest.fn(async () => {
        viste.push({ op: 'findMany', store: TenantContext.getStoreTenantId() })
        return []
      }),
      findUnique: jest.fn(() => {
        throw new Error(
          'client applicativo: lookup per id prima di conoscere l’azienda non ammesso'
        )
      }),
      update: jest.fn(async () => {
        viste.push({ op: 'update', store: TenantContext.getStoreTenantId() })
        return {}
      }),
    },
  }
  const sistema: any = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', tenantId: 't-altro', keycloakId: 'k' }),
    },
  }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  return {
    prisma,
    sistema,
    viste,
    service: new UserAdminService(prisma, sistema, {} as any, logger, {} as any),
  }
}

const superAdmin = { id: 'su', role: 'SUPER_ADMIN', tenantId: 't-casa' } as any
// Stato reale del middleware: store = tenant di casa (o dell'header).
const comeSuperAdmin = <T>(fn: () => Promise<T>) =>
  TenantContext.run({ isSuperAdmin: true, tenantId: 't-casa' }, async () => await fn())

describe('UserAdminService (super admin e client di sistema)', () => {
  it('listUsers senza azienda richiesta: tutte le aziende dal client di sistema', async () => {
    const t = costruisci()
    await comeSuperAdmin(() => t.service.listUsers(superAdmin))
    expect(t.sistema.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
    expect(t.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('listUsers con azienda richiesta: client normale nel contesto di quell’azienda', async () => {
    const t = costruisci()
    await comeSuperAdmin(() => t.service.listUsers(superAdmin, 't-richiesta'))
    expect(t.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't-richiesta' } })
    )
    expect(t.viste[0].store).toBe('t-richiesta')
    expect(t.sistema.user.findMany).not.toHaveBeenCalled()
  })

  it('ADMIN di tenant: client normale, filtrato sul proprio tenant', async () => {
    const t = costruisci()
    await t.service.listUsers({ id: 'a', role: 'ADMIN', tenantId: 't1' } as any, 'altro')
    expect(t.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1' } })
    )
    expect(t.sistema.user.findMany).not.toHaveBeenCalled()
  })

  it('updateRole del super admin: lookup dal sistema, scrittura nel contesto dell’azienda dell’utente', async () => {
    const t = costruisci()
    await comeSuperAdmin(() => t.service.updateRole(superAdmin, 'u1', 'ADMIN' as any))
    expect(t.sistema.user.findUnique).toHaveBeenCalledTimes(1)
    expect(t.viste).toEqual([{ op: 'update', store: 't-altro' }])
  })

  it('setCompanyLimit: lookup dal sistema, scrittura nel contesto dell’azienda dell’utente', async () => {
    const t = costruisci()
    await comeSuperAdmin(() => t.service.setCompanyLimit(superAdmin, 'u1', 5))
    expect(t.viste).toEqual([{ op: 'update', store: 't-altro' }])
  })
})
