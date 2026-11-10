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
import { DeadlineCheckerService } from '../../application/notifications/deadline-checker.service'
import { EvidenzeDbService } from '../../application/admin/system-health/evidenze-db.service'
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

  it('scadenze certificato, evidenze di sistema e promemoria MUD: contano la radice del gruppo', async () => {
    const madreAttiva = await azienda('ACTIVE')
    const figliaScaduta = await azienda('EXPIRED', madreAttiva)
    const madreSospesa = await azienda('SUSPENDED')
    const figliaAttiva = await azienda('ACTIVE', madreSospesa)
    const mie = new Set([madreAttiva, figliaScaduta, madreSospesa, figliaAttiva])
    const attesi = [madreAttiva, figliaScaduta].sort()

    // Si intercetta la lettura delle credenziali: contano gli id aziende con cui viene chiesta.
    const spia = jest.spyOn(sistema.rentriCredential, 'findMany').mockResolvedValue([] as never)
    const idsPassati = () =>
      (spia.mock.calls.at(-1)?.[0] as { where: { tenantId: { in: string[] } } }).where.tenantId.in
        .filter(id => mie.has(id))
        .sort()

    await new EvidenzeDbService(sistema).credenziali()
    expect(idsPassati()).toEqual(attesi)

    const checker = new DeadlineCheckerService(app, sistema, {} as never, {} as never, logger, {
      scadenzaPresentazione: () => ({ data: '2026-07-09', fonte: 'REGISTRO' }),
    } as never)
    await checker.checkRentriCertificateExpiration()
    expect(idsPassati()).toEqual(attesi)
    spia.mockRestore()

    // Promemoria MUD: la stessa query tenant, con il filtro «MUD dovuto» in AND.
    // La lista resta vuota: nessuna notifica ne' email partono dal database di prova.
    const lette = jest.spyOn(sistema.tenant, 'findMany').mockResolvedValue([] as never)
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval'] })
    jest.setSystemTime(new Date(2026, 6, 2))
    try {
      await checker.checkMudDeadlines()
    } finally {
      jest.useRealTimers()
    }
    const where = (lette.mock.calls[0]?.[0] as { where: object }).where
    const trovate = await owner.tenant.findMany({
      where: { AND: [where, { id: { in: [...mie] } }] },
    })
    expect(trovate.map(t => t.id).sort()).toEqual(attesi)
    lette.mockRestore()
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
