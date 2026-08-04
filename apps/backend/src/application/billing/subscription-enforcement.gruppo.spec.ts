/**
 * Regole di gruppo sull'enforcement:
 *  - lo STATO dell'abbonamento e i LIMITI vengono dalla madre;
 *  - il CONTEGGIO dei FIR resta della figlia (tetto per azienda, non di gruppo:
 *    una societa' attiva non consuma la quota delle sorelle).
 */
import { ForbiddenException } from '@nestjs/common'
import { SubscriptionEnforcementService } from './subscription-enforcement.service'
import { ContrattoGruppoService } from './contratto-gruppo.service'

const RADICE = 'tenant-madre-uuid'
const FIGLIA = 'tenant-figlia-uuid'

function makeDeps(opts: { statoRadice: string; limiteRadice: number; firDellaFiglia: number }) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === RADICE
            ? {
                id: RADICE,
                parentTenantId: null,
                subscriptionTier: 'PROFESSIONAL',
                subscriptionStatus: opts.statoRadice,
                subscriptionEnd: null,
                firLimitPerMonth: opts.limiteRadice,
                userLimitTotal: 10,
                featureFlags: null,
                aziendeLimit: 5,
                ragioneSociale: 'Gruppo Madre Srl',
              }
            : {
                id: FIGLIA,
                parentTenantId: RADICE,
                subscriptionTier: 'TRIAL',
                subscriptionStatus: 'ACTIVE',
                subscriptionEnd: null,
                firLimitPerMonth: 1,
                userLimitTotal: 1,
                featureFlags: null,
                aziendeLimit: null,
                ragioneSociale: 'Figlia Alfa Srl',
              }
        )
      ),
    },
    fIR: {
      // Conta solo se il filtro e' sulla figlia: e' il punto del test.
      count: jest.fn(({ where }: any) =>
        Promise.resolve(where.tenantId === FIGLIA ? opts.firDellaFiglia : 0)
      ),
    },
    user: { count: jest.fn().mockResolvedValue(0) },
  }
  const contratto = new ContrattoGruppoService(prisma)
  return { prisma, service: new SubscriptionEnforcementService(prisma, contratto) }
}

describe('SubscriptionEnforcementService — gruppo', () => {
  it('la figlia e bloccata se la MADRE e sospesa, anche se lei risulta attiva', async () => {
    const { service } = makeDeps({ statoRadice: 'SUSPENDED', limiteRadice: 100, firDellaFiglia: 0 })

    await expect(service.assertNotSuspended(FIGLIA)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('il tetto FIR viene dalla madre ma conta i soli FIR della figlia', async () => {
    const { service, prisma } = makeDeps({
      statoRadice: 'ACTIVE',
      limiteRadice: 100,
      firDellaFiglia: 99,
    })

    await expect(service.assertFirLimitNotReached(FIGLIA)).resolves.toBeUndefined()
    expect(prisma.fIR.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: FIGLIA }) })
    )
  })

  it('la figlia e bloccata quando raggiunge il tetto del piano della madre', async () => {
    const { service } = makeDeps({
      statoRadice: 'ACTIVE',
      limiteRadice: 100,
      firDellaFiglia: 100,
    })

    await expect(service.assertFirLimitNotReached(FIGLIA)).rejects.toBeInstanceOf(
      ForbiddenException
    )
  })
})
