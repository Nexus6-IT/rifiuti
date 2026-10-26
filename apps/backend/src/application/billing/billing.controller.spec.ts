import { ForbiddenException } from '@nestjs/common'
import { BillingController } from './billing.controller'

/**
 * BillingController riceveva già l'azienda attiva dal `CurrentUser` di `auth/decorators` (il valore
 * selezionato, non quello del token): questi test sono una guardia contro regressioni, non la
 * prova di un difetto trovato.
 */
describe('BillingController — azienda selezionata', () => {
  // switch di azienda: il token resta sul tenant A, l'azienda selezionata è B
  const req: any = {
    tenantId: 'B',
    user: { id: 'u1', tenantId: 'A', role: 'SUPER_ADMIN' },
    headers: {},
  }
  let billing: Record<string, jest.Mock>
  let controller: BillingController

  beforeEach(() => {
    billing = {
      getStatus: jest.fn().mockResolvedValue({}),
      createCheckoutSession: jest.fn().mockResolvedValue('https://stripe/x'),
      createBillingPortalSession: jest.fn().mockResolvedValue('https://stripe/p'),
    }
    controller = new BillingController(
      billing as any,
      { isEnabled: true } as any,
      { get: () => 'https://app.example' } as any
    )
  })

  it("status: usa l'azienda selezionata", async () => {
    await controller.getStatus(req)
    expect(billing.getStatus).toHaveBeenCalledWith('B')
  })

  it("checkout: usa l'azienda selezionata", async () => {
    await controller.createCheckout(req, { plan: 'PROFESSIONAL' })
    expect(billing.createCheckoutSession).toHaveBeenCalledWith(
      'B',
      'PROFESSIONAL',
      'https://app.example'
    )
  })

  it("portal: usa l'azienda selezionata", async () => {
    await controller.createPortal(req)
    expect(billing.createBillingPortalSession).toHaveBeenCalledWith('B', 'https://app.example')
  })

  it('senza azienda determinabile: 403, nessuna operazione', async () => {
    await expect(controller.getStatus({ user: { id: 'u1' } })).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(billing.getStatus).not.toHaveBeenCalled()
  })
})
