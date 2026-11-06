/**
 * Moduli di un'azienda contro un Postgres reale: le colonne `feature_flags` (aggiunti) e
 * `feature_tolte` (tolti) si salvano, si rileggono, e `effectiveFeatures` applica la formula
 * (piano + aggiunti - tolti). Una figlia legge il contratto della madre, tolti compresi.
 * Il proprietario (`wasteflow`) prepara e pulisce solo le righe create qui, per id.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { PrismaClient, SubscriptionTier } from '@prisma/client'
import { TenantService } from './tenant.service'
import { effectiveFeatures } from './feature-catalog'
import { ContrattoGruppoService } from '../billing/contratto-gruppo.service'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'

describe('Moduli azienda: featureFlags + featureTolte (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const creati: string[] = []
  const sfx = Date.now().toString().slice(-8)

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
  })

  afterAll(async () => {
    if (creati.length) {
      await owner.tenant.deleteMany({ where: { id: { in: creati } } })
    }
    await owner.$disconnect()
  })

  it('salva e rilegge le due colonne, e la formula le applica', async () => {
    const t = await owner.tenant.create({
      data: {
        partitaIva: `MD${sfx}1`,
        ragioneSociale: 'Moduli test SRL',
        country: 'IT',
        subscriptionTier: SubscriptionTier.TRIAL,
        featureFlags: ['esg'],
        featureTolte: ['cer'],
      },
    })
    creati.push(t.id)

    const riletto = await owner.tenant.findUniqueOrThrow({ where: { id: t.id } })
    expect(riletto.featureFlags).toEqual(['esg'])
    expect(riletto.featureTolte).toEqual(['cer'])

    const f = effectiveFeatures(riletto)
    expect(f).toContain('esg')
    expect(f).not.toContain('cer')
    expect(f).toContain('fir')
  })

  it('un array vuoto di tolti resta un array vuoto (non diventa null)', async () => {
    const t = await owner.tenant.create({
      data: {
        partitaIva: `MD${sfx}2`,
        ragioneSociale: 'Moduli test vuoti SRL',
        country: 'IT',
        featureFlags: [],
        featureTolte: [],
      },
    })
    creati.push(t.id)
    const riletto = await owner.tenant.findUniqueOrThrow({ where: { id: t.id } })
    expect(riletto.featureTolte).toEqual([])
    expect(riletto.featureFlags).toEqual([])
  })

  it('i tenant senza la colonna valorizzata hanno featureTolte null', async () => {
    const t = await owner.tenant.create({
      data: { partitaIva: `MD${sfx}3`, ragioneSociale: 'Moduli test null SRL', country: 'IT' },
    })
    creati.push(t.id)
    const riletto = await owner.tenant.findUniqueOrThrow({ where: { id: t.id } })
    expect(riletto.featureTolte).toBeNull()
  })

  it('una figlia eredita dalla madre aggiunti e tolti', async () => {
    const madre = await owner.tenant.create({
      data: {
        partitaIva: `MD${sfx}4`,
        ragioneSociale: 'Madre moduli SRL',
        country: 'IT',
        featureFlags: ['mud'],
        featureTolte: ['registro'],
      },
    })
    creati.push(madre.id)
    const figlia = await owner.tenant.create({
      data: {
        partitaIva: `MD${sfx}5`,
        ragioneSociale: 'Figlia moduli SRL',
        country: 'IT',
        parentTenantId: madre.id,
      },
    })
    creati.push(figlia.id)

    const contratto = await new ContrattoGruppoService(owner as any).caricaContratto(figlia.id)
    const f = effectiveFeatures(contratto!)
    expect(f).toContain('mud')
    expect(f).not.toContain('registro')
  })

  it('list del SUPER_ADMIN: la figlia mostra i moduli della madre, tolti compresi', async () => {
    const madre = await owner.tenant.create({
      data: {
        partitaIva: `MD${sfx}6`,
        ragioneSociale: 'Madre list SRL',
        country: 'IT',
        subscriptionTier: SubscriptionTier.PROFESSIONAL,
        featureTolte: ['esg'],
      },
    })
    creati.push(madre.id)
    const figlia = await owner.tenant.create({
      data: {
        partitaIva: `MD${sfx}7`,
        ragioneSociale: 'Figlia list SRL',
        country: 'IT',
        parentTenantId: madre.id,
      },
    })
    creati.push(figlia.id)

    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const service = new TenantService(
      owner as never,
      owner as never,
      logger,
      {} as never,
      new ContrattoGruppoService(owner as never)
    )
    const righe: any[] = await service.list({
      id: 'super',
      role: 'SUPER_ADMIN',
      tenantId: madre.id,
    })
    const rigaFiglia = righe.find(r => r.id === figlia.id)
    const rigaMadre = righe.find(r => r.id === madre.id)
    expect(rigaMadre.moduliEffettivi).not.toContain('esg')
    expect(rigaFiglia.moduliEffettivi).toContain('mud')
    expect(rigaFiglia.moduliEffettivi).not.toContain('esg')
  })
})
