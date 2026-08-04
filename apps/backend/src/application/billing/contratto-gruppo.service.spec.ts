/**
 * Il contratto (piano, limiti, feature, Stripe) vive SOLO sulla madre: una
 * figlia non ha un abbonamento proprio, lo eredita. Senza questa regola due
 * societa' dello stesso gruppo potrebbero avere piani incoerenti.
 */
import { ContrattoGruppoService } from './contratto-gruppo.service'

const RADICE = 'tenant-madre-uuid'
const FIGLIA = 'tenant-figlia-uuid'

/** Prisma finto che si comporta come il DB: risolve per id. */
function makePrisma() {
  const righe: Record<string, any> = {
    [RADICE]: {
      id: RADICE,
      parentTenantId: null,
      subscriptionTier: 'PROFESSIONAL',
      subscriptionStatus: 'ACTIVE',
      subscriptionEnd: null,
      firLimitPerMonth: 100,
      userLimitTotal: 10,
      featureFlags: null,
      aziendeLimit: 5,
      ragioneSociale: 'Gruppo Madre Srl',
    },
    [FIGLIA]: {
      id: FIGLIA,
      parentTenantId: RADICE,
      // Valori volutamente diversi: NON devono essere letti.
      subscriptionTier: 'TRIAL',
      subscriptionStatus: 'TRIAL',
      subscriptionEnd: null,
      firLimitPerMonth: 1,
      userLimitTotal: 1,
      featureFlags: null,
      aziendeLimit: null,
      ragioneSociale: 'Figlia Alfa Srl',
    },
  }
  return {
    tenant: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(righe[where.id] ?? null)),
    },
  } as any
}

describe('ContrattoGruppoService', () => {
  it('per una figlia risolve la radice', async () => {
    const service = new ContrattoGruppoService(makePrisma())

    await expect(service.risolviRadice(FIGLIA)).resolves.toBe(RADICE)
  })

  it('per una radice risolve se stessa', async () => {
    const service = new ContrattoGruppoService(makePrisma())

    await expect(service.risolviRadice(RADICE)).resolves.toBe(RADICE)
  })

  it('il contratto di una figlia e quello della madre, non il suo', async () => {
    const service = new ContrattoGruppoService(makePrisma())

    const contratto = await service.caricaContratto(FIGLIA)

    expect(contratto!.tenantIdRadice).toBe(RADICE)
    expect(contratto!.subscriptionTier).toBe('PROFESSIONAL')
    expect(contratto!.firLimitPerMonth).toBe(100)
    expect(contratto!.userLimitTotal).toBe(10)
    expect(contratto!.aziendeLimit).toBe(5)
  })

  it('tenant inesistente: nessun contratto', async () => {
    const service = new ContrattoGruppoService(makePrisma())

    await expect(service.caricaContratto('non-esiste')).resolves.toBeNull()
  })

  it('per una radice: una sola query', async () => {
    const prisma = makePrisma()
    const service = new ContrattoGruppoService(prisma)

    await service.caricaContratto(RADICE)

    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(1)
  })

  it('per una figlia: due query (tenant + madre)', async () => {
    const prisma = makePrisma()
    const service = new ContrattoGruppoService(prisma)

    await service.caricaContratto(FIGLIA)

    expect(prisma.tenant.findUnique).toHaveBeenCalledTimes(2)
  })
})
