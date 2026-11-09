/**
 * ModuliAttiviService contro un Postgres reale: madre e figlia, `featureTolte`, tenant assente,
 * cambio piano senza riavvio. Il proprietario prepara e pulisce solo le righe create qui, per id.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient, SubscriptionTier } from '@prisma/client'
import { ModuliAttiviService } from './moduli-attivi.service'
import { ContrattoGruppoService } from '../billing/contratto-gruppo.service'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const url =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'

describe('ModuliAttiviService (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: url })
  const creati: string[] = []
  const sfx = Date.now().toString().slice(-8)
  const servizio = new ModuliAttiviService(new ContrattoGruppoService(owner as never))

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(url)).toBe(true)
  })
  afterAll(async () => {
    // Prima le figlie (FK sulla madre), poi le madri: l'ordine inverso di creazione.
    for (const id of [...creati].reverse()) await owner.tenant.deleteMany({ where: { id } })
    await owner.$disconnect()
  })

  async function crea(sigla: string, data: Record<string, unknown> = {}) {
    const t = await owner.tenant.create({
      data: {
        partitaIva: `MA${sfx}${sigla}`,
        ragioneSociale: `Moduli ${sigla}`,
        country: 'IT',
        ...data,
      },
    })
    creati.push(t.id)
    return t
  }

  it('madre: piano PROFESSIONAL meno i tolti, piu gli aggiunti', async () => {
    const madre = await crea('1', {
      subscriptionTier: SubscriptionTier.PROFESSIONAL,
      featureFlags: ['rentri'],
      featureTolte: ['esg'],
    })
    const m = await servizio.moduliAttivi(madre.id)
    expect(m).toContain('mud')
    expect(m).toContain('rentri')
    expect(m).not.toContain('esg')
  })

  it('figlia: valgono i moduli della madre, non il piano proprio', async () => {
    const madre = await crea('2', {
      subscriptionTier: SubscriptionTier.ENTERPRISE,
      featureTolte: ['pese'],
    })
    const figlia = await crea('3', {
      parentTenantId: madre.id,
      subscriptionTier: SubscriptionTier.TRIAL,
    })
    const m = await servizio.moduliAttivi(figlia.id)
    expect(m).toContain('rentri')
    expect(m).not.toContain('pese')
    const piano = await servizio.pianoAzienda(figlia.id)
    expect(piano?.tier).toBe('ENTERPRISE')
  })

  it('un cambio di piano vale alla richiesta successiva, senza riavvio', async () => {
    const t = await crea('4', { subscriptionTier: SubscriptionTier.TRIAL })
    expect(await servizio.moduliAttivi(t.id)).not.toContain('mud')
    await owner.tenant.update({
      where: { id: t.id },
      data: { subscriptionTier: SubscriptionTier.PROFESSIONAL },
    })
    expect(await servizio.moduliAttivi(t.id)).toContain('mud')
  })

  it('tenant assente: nessun modulo e piano null', async () => {
    const id = randomUUID()
    expect(await servizio.moduliAttivi(id)).toEqual([])
    expect(await servizio.pianoAzienda(id)).toBeNull()
  })
})
