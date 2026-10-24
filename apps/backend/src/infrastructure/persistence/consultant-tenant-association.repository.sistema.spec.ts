import { PrismaConsultantTenantAssociationRepository } from './consultant-tenant-association.repository'

describe('PrismaConsultantTenantAssociationRepository (letture del consulente)', () => {
  function costruisci() {
    const prisma: any = {
      consultantTenantAssociation: {
        findMany: jest.fn(() => {
          throw new Error('client applicativo: associazioni su piu aziende non ammesse')
        }),
        findFirst: jest.fn(() => {
          throw new Error('client applicativo: associazioni su piu aziende non ammesse')
        }),
      },
    }
    const sistema: any = {
      consultantTenantAssociation: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    }
    return { sistema, repo: new PrismaConsultantTenantAssociationRepository(prisma, sistema) }
  }

  it('findAllByConsultant: dal client di sistema, vincolato al consulente', async () => {
    const { sistema, repo } = costruisci()
    await repo.findAllByConsultant('utente-1')
    expect(sistema.consultantTenantAssociation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { consultantUserId: 'utente-1' } })
    )
  })

  it('findActiveByConsultantAndTenant: dal client di sistema, vincolato al consulente', async () => {
    const { sistema, repo } = costruisci()
    await repo.findActiveByConsultantAndTenant('utente-1', 'azienda-2')
    expect(sistema.consultantTenantAssociation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ consultantUserId: 'utente-1', tenantId: 'azienda-2' }),
      })
    )
  })
})
