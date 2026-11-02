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

import { randomUUID } from 'crypto'
import { PrismaService, creaPrismaServiceApplicativo } from '../persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
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
        partitaIva: partitaIvaUnica(),
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

    // Controllo positivo: stessa azienda, secondo registro con identificativo e una riga sbloccata.
    const sede2 = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: 'OP0001JB000002-MI0001',
        denominazione: 'Sede 2',
        principale: false,
      },
    })
    const registro2 = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede2.id,
        descrizione: 'Registro con riga da inviare',
        identificativoRentri: 'RFGHIJ67890',
      },
    })
    const progDaInviare = 100
    const mDaInviare = await owner.wasteMovement.create({
      data: {
        tenantId: t.id,
        registroId: registro2.id,
        progressiveYear: 2026,
        progressiveNumber: progDaInviare,
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
    await owner.movimentoTrasmissioneRentri.create({
      data: {
        tenantId: t.id,
        movimentoId: mDaInviare.id,
        registroId: registro2.id,
        tipo: 'CARICO',
        origine: 'MANUALE',
      },
    })

    const posts = jest.fn(
      async (_id: string, movimenti: Array<Record<string, unknown>>, ..._resto: unknown[]) => ({
        transazioneId: randomUUID(),
        movimenti,
      })
    )
    const client: any = {
      inviaMovimenti: posts,
      attendiEsitoMovimenti: async () => ({
        errore: false,
        validazione: [],
        numeroRegistrazioni: [
          { anno: 2026, progressivo: progDaInviare, identificativo: `M${'1'.padStart(19, '0')}` },
        ],
      }),
    }
    const repo = new TrasmissioniRegistroRepository(app, logger)
    const trasmetti = new TrasmettiLottoRegistroUseCase(
      repo,
      new LettoreAnnotazioniRentri(logger),
      client,
      logger,
      a => ({ ok: true, corpo: { anno: a.numero.anno, progressivo: a.numero.progressivo } })
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

    // Esattamente una POST, solo per il registro sbloccato e solo con la sua riga: le righe
    // INCERTA/TRASMESSA e il movimento senza riga del primo registro non partono.
    expect(posts).toHaveBeenCalledTimes(1)
    expect(posts.mock.calls[0][0]).toBe('RFGHIJ67890')
    expect(posts.mock.calls[0][1]).toEqual([{ anno: 2026, progressivo: progDaInviare }])
    expect(JSON.stringify(posts.mock.calls[0][1])).not.toMatch(/"progressivo":[1-4]\b/)
    expect(logger.error).not.toHaveBeenCalled()
    const righe = await owner.movimentoTrasmissioneRentri.findMany({ where: { tenantId: t.id } })
    expect(righe).toHaveLength(3)
    expect(righe.map(r => r.stato).sort()).toEqual(['INCERTA', 'TRASMESSA', 'TRASMESSA'])
    const primoRegistro = righe.filter(r => r.registroId === registro.id)
    expect(primoRegistro.map(r => r.stato).sort()).toEqual(['INCERTA', 'TRASMESSA'])
  })
})
