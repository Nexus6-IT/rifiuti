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

    // la lettura porta anche ditta e sede (F2-10): il filtro per tenant resta nel `where`
    expect(prisma.db.produttore.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod-1', tenantId: 'tenant-A' },
        include: expect.objectContaining({ ditta: expect.anything(), sede: true }),
      })
    )
  })

  it('delete è scoped per tenant (deleteMany con tenantId)', async () => {
    await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, async () => {
      await repo.delete('prod-1')
    })

    expect(prisma.db.produttore.deleteMany).toHaveBeenCalledWith({
      where: { id: 'prod-1', tenantId: 'tenant-A' },
    })
  })

  it('findByTenantId ordina per ragione sociale della ditta', async () => {
    prisma.db.produttore.findMany = jest.fn().mockResolvedValue([])
    await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, async () => {
      await repo.findByTenantId('tenant-A')
    })

    expect(prisma.db.produttore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-A' },
        orderBy: { ditta: { ragioneSociale: 'asc' } },
      })
    )
  })

  it('findByDittaId usa il client della transazione e filtra per tenant', async () => {
    const tx = { produttore: { findFirst: jest.fn().mockResolvedValue(null) } }
    await TenantContext.run({ tenantId: 'tenant-A', userId: 'u1' }, async () => {
      await repo.findByDittaId(tx as any, 'ditta-1')
    })

    expect(tx.produttore.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dittaId: 'ditta-1', tenantId: 'tenant-A' } })
    )
    expect(prisma.db.produttore.findFirst).not.toHaveBeenCalled()
  })

  it('fail-closed: senza tenant nel contesto findById lancia', async () => {
    await expect(repo.findById('prod-1')).rejects.toThrow()
    expect(prisma.db.produttore.findFirst).not.toHaveBeenCalled()
  })
})
