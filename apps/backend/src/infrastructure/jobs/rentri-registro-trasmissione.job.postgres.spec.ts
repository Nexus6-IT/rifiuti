/**
 * Il job contro un Postgres reale (ruolo wasteflow_app) con client RENTRI finto che conta le POST:
 * righe bloccate, INCERTA, TRASMESSA e movimenti senza riga di un registro manuale non producono
 * nessuna chiamata a `inviaMovimenti`.
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

import { PrismaService, creaPrismaServiceApplicativo } from '../persistence/prisma.service'
import { partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { LettoreAnnotazioniRentri } from '../../application/rentri/registro/lettore-annotazioni-rentri'
import { TrasmettiLottoRegistroUseCase } from '../../application/rentri/registro/trasmetti-lotto-registro.use-case'
import { TrasmissioniRegistroRepository } from '../../application/rentri/registro/trasmissioni-registro.repository'
import { RentriRegistroTrasmissioneJob } from './rentri-registro-trasmissione.job'

describe('RentriRegistroTrasmissioneJob — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  const logger: any = {
    setContext: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('righe bloccate, INCERTA, TRASMESSA e movimenti senza riga di un registro manuale non producono POST', async () => {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaValida(Date.now()),
        ragioneSociale: 'Job RENTRI SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: 'OP0001JB000001-MI0001',
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede.id,
        descrizione: 'Registro manuale',
        identificativoRentri: 'RABCDE12345',
      },
    })
    const casi: Array<{ stato?: 'INCERTA' | 'TRASMESSA'; bloccato?: boolean }> = [
      { stato: 'INCERTA', bloccato: true },
      { stato: 'TRASMESSA', bloccato: true },
      {}, // movimento senza riga
    ]
    let prog = 0
    for (const c of casi) {
      const m = await owner.wasteMovement.create({
        data: {
          tenantId: t.id,
          registroId: registro.id,
          progressiveYear: 2026,
          progressiveNumber: ++prog,
          cerCode: '15 01 01',
          unit: 'KG',
          wastePhysicalState: 'Solido',
          type: 'CARICO',
          movementDate: new Date('2026-03-01T10:00:00Z'),
          registrationDate: new Date('2026-03-01T10:00:00Z'),
          causale: 'PRODUZIONE_INTERNA',
          quantity: 100,
        },
      })
      if (c.stato) {
        await owner.movimentoTrasmissioneRentri.create({
          data: {
            tenantId: t.id,
            movimentoId: m.id,
            registroId: registro.id,
            tipo: 'CARICO',
            origine: 'MANUALE',
            stato: c.stato,
            bloccatoInvio: c.bloccato ?? false,
            motivoBlocco: 'Bloccata di prova',
          },
        })
      }
    }

    const posts = jest.fn()
    const client: any = { inviaMovimenti: posts, attendiEsitoMovimenti: posts }
    const repo = new TrasmissioniRegistroRepository(app, logger)
    const trasmetti = new TrasmettiLottoRegistroUseCase(
      repo,
      new LettoreAnnotazioniRentri(logger),
      client,
      logger
    )
    const sistema: any = { tenant: { findMany: async () => [{ id: t.id }] } }
    const credenziali: any = { haCredenziale: async () => true }
    const job = new RentriRegistroTrasmissioneJob(
      sistema,
      app,
      credenziali,
      repo,
      trasmetti,
      logger
    )

    await job.eseguiTrasmissione()
    await job.eseguiTrasmissione()

    expect(posts).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    const righe = await owner.movimentoTrasmissioneRentri.findMany({ where: { tenantId: t.id } })
    expect(righe).toHaveLength(2)
    expect(righe.map(r => r.stato).sort()).toEqual(['INCERTA', 'TRASMESSA'])
  })
})
