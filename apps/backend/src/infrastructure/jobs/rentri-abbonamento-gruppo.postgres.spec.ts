/**
 * Job RENTRI e stato dell'abbonamento di un gruppo: conta quello della RADICE, non la colonna
 * propria della figlia (non autorevole, vedi `ContrattoGruppoService`). Postgres reale: client
 * applicativo per i contratti, client di sistema per l'elenco delle aziende, come in produzione.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { ContrattoGruppoService } from '../../application/billing/contratto-gruppo.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'
import { PrismaService, creaPrismaServiceApplicativo } from '../persistence/prisma.service'
import { RentriRiconciliazioneJob } from './rentri-riconciliazione.job'

type Stato = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED'

describe('Job RENTRI: abbonamento del gruppo — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  const creati: string[] = []
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.$connect()
    sistema = new PrismaSistemaService()
    await sistema.$connect()
  })

  afterAll(async () => {
    // Prima le figlie (FK `Restrict` sulla madre), solo per id esatti.
    for (const id of [...creati].reverse()) await owner.tenant.deleteMany({ where: { id } })
    await app.$disconnect()
    await sistema.$disconnect()
    await owner.$disconnect()
  })

  async function azienda(stato: Stato, madreId?: string): Promise<string> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Gruppo abbonamento SRL',
        country: 'IT',
        subscriptionTier: 'ENTERPRISE',
        subscriptionStatus: stato,
        ...(madreId ? { parentTenantId: madreId } : {}),
      },
    })
    creati.push(t.id)
    return t.id
  }

  it('riconciliazione: la figlia segue lo stato della madre, in entrambe le direzioni', async () => {
    const madreAttiva = await azienda('ACTIVE')
    const figliaScaduta = await azienda('EXPIRED', madreAttiva) // colonna propria divergente
    const madreSospesa = await azienda('SUSPENDED')
    const figliaAttiva = await azienda('ACTIVE', madreSospesa) // colonna propria divergente
    const madreProva = await azienda('TRIAL')
    const figliaSospesa = await azienda('SUSPENDED', madreProva)

    const trattate: string[] = []
    const job = new RentriRiconciliazioneJob(
      sistema,
      {
        execute: jest.fn(async (id: string) => {
          trattate.push(id)
          return { divergenze: 0 }
        }),
      } as any,
      logger,
      { haCredenziale: jest.fn(async () => true) } as any,
      new ModuliAttiviService(new ContrattoGruppoService(app))
    )
    await job.riconcilia()

    const nostre = trattate.filter(id => creati.includes(id)).sort()
    expect(nostre).toEqual([madreAttiva, figliaScaduta, madreProva, figliaSospesa].sort())
    expect(trattate).not.toContain(madreSospesa)
    expect(trattate).not.toContain(figliaAttiva)
  })

  it('il filtro e` una sola query con join sulla madre (nessun N+1)', async () => {
    const madre = await azienda('ACTIVE')
    await azienda('SUSPENDED', madre)
    const query: string[] = []
    const client = new PrismaClient({
      datasourceUrl: urlProprietario,
      log: [{ emit: 'event', level: 'query' }],
    })
    ;(client as any).$on('query', (e: { query: string }) => query.push(e.query))
    const { escludiPiattaforma } = await import('../../core/context/azienda-piattaforma')
    const { ABBONAMENTO_OPERATIVO_DEL_GRUPPO } = await import(
      '../../application/billing/contratto-gruppo.service'
    )
    await client.tenant.findMany({
      where: escludiPiattaforma({ OR: ABBONAMENTO_OPERATIVO_DEL_GRUPPO }),
      select: { id: true },
    })
    await client.$disconnect()
    const select = query.filter(q => /^SELECT/i.test(q))
    expect(select).toHaveLength(1)
    expect(select[0]).toMatch(/JOIN|EXISTS/i)
  })
})
