/**
 * Le feature e il piano mostrati a una figlia sono quelli del contratto della
 * madre: e' la stessa regola dell'enforcement, applicata alla UI.
 */
import { MeFeaturesService } from './me-features.service'
import { ContrattoGruppoService } from '../../application/billing/contratto-gruppo.service'

const RADICE = 'tenant-madre-uuid'
const FIGLIA = 'tenant-figlia-uuid'

function makeService() {
  // La madre arriva in join sulla riga della figlia: e' la forma restituita
  // dalla `select` con relazione di ContrattoGruppoService (una sola query).
  const rigaRadice = {
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
  const prisma: any = {
    tenant: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === RADICE
            ? { ...rigaRadice, madre: null }
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
                madre: { ...rigaRadice },
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
