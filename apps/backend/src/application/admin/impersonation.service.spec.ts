import { ImpersonationService } from './impersonation.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { TenantContext } from '../../core/context/tenant-context'

describe('ImpersonationService', () => {
  it("impersonation: utente di un'altra azienda trovato", async () => {
    // Il super admin opera sull'azienda A (X-Tenant-ID); l'utente da impersonare e' dell'azienda B.
    const sistema: any = {
      user: {
        findUnique: jest.fn(() => {
          return Promise.resolve({
            id: 'target',
            email: 't@b.it',
            fiscalCode: null,
            firstName: 'T',
            lastName: 'B',
            tenantId: 'azienda-b',
            role: 'ADMIN',
          })
        }),
      },
    }
    const jwt: any = { generateTokenPair: jest.fn().mockReturnValue({ accessToken: 'a' }) }
    const service = new ImpersonationService(sistema, jwt)

    const risposta = await TenantContext.run(
      { tenantId: 'azienda-a', isSuperAdmin: true },
      async () =>
        service.impersonate({ id: 'sa', role: 'SUPER_ADMIN', tenantId: '' } as any, 'target')
    )

    expect(risposta.user.tenantId).toBe('azienda-b')
    expect(sistema.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'target' } })
    )
    expect(Reflect.getMetadata('design:paramtypes', ImpersonationService)[0]).toBe(
      PrismaSistemaService
    )
  })
})
