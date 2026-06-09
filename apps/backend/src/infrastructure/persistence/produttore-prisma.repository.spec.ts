import { ProduttorePrismaRepository } from './produttore-prisma.repository'
import { TenantContext } from '../../core/context/tenant-context'

/**
 * Verifica l'isolamento per tenant del repository Produttore (blocker #6):
 * findById/delete per sola PK devono comunque essere vincolati al tenant
 * corrente, perché la RLS-extension è no-op su findUnique/delete-by-id.
 */
describe('ProduttorePrismaRepository — tenant scoping', () => {
  let prisma: any
  let repo: ProduttorePrismaRepository

  beforeEach(() => {
    prisma = {
      db: {
        produttore: {
          findFirst: jest.fn().mockResolvedValue(null),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      },
    }
    repo = new ProduttorePrismaRepository(prisma)
  })

  it('findById filtra per tenant corrente (no findUnique per sola PK)', async () => {
    await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, async () => {
      await repo.findById('prod-1')
    })

    expect(prisma.db.produttore.findFirst).toHaveBeenCalledWith({
      where: { id: 'prod-1', tenantId: 'tenant-A' },
    })
  })

  it('delete è scoped per tenant (deleteMany con tenantId)', async () => {
    await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, async () => {
      await repo.delete('prod-1')
    })

    expect(prisma.db.produttore.deleteMany).toHaveBeenCalledWith({
      where: { id: 'prod-1', tenantId: 'tenant-A' },
    })
  })

  it('fail-closed: senza tenant nel contesto findById lancia', async () => {
    await expect(repo.findById('prod-1')).rejects.toThrow()
    expect(prisma.db.produttore.findFirst).not.toHaveBeenCalled()
  })
})
