/**
 * Le feature e il piano mostrati a una figlia sono quelli del contratto della
 * madre: e' la stessa regola dell'enforcement, applicata alla UI.
 */
import { MeFeaturesService } from './me-features.service'
import { ContrattoGruppoService } from '../../application/billing/contratto-gruppo.service'

const RADICE = 'tenant-madre-uuid'
const FIGLIA = 'tenant-figlia-uuid'

function makeService() {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === RADICE
            ? {
                id: RADICE,
                parentTenantId: null,
                subscriptionTier: 'ENTERPRISE',
                subscriptionStatus: 'ACTIVE',
                subscriptionEnd: null,
                firLimitPerMonth: 0,
                userLimitTotal: 50,
                featureFlags: null,
                aziendeLimit: 5,
                ragioneSociale: 'Gruppo Madre Srl',
              }
            : {
                id: FIGLIA,
                parentTenantId: RADICE,
                subscriptionTier: 'TRIAL',
                subscriptionStatus: 'TRIAL',
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
  }
  return new MeFeaturesService(prisma, new ContrattoGruppoService(prisma))
}

describe('MeFeaturesService — gruppo', () => {
  it('una figlia vede il piano e il limite utenti della madre', async () => {
    const service = makeService()

    const risposta = await service.getFeaturesForUser({ tenantId: FIGLIA } as any)

    expect(risposta.tier).toBe('ENTERPRISE')
    expect(risposta.userLimitTotal).toBe(50)
  })
})
