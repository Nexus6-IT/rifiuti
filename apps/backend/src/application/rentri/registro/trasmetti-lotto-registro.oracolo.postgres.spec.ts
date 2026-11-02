/**
 * Ciclo d'invio contro un Postgres reale (ruolo wasteflow_app) e un client RENTRI FINTO in-process
 * (`tools/rentri-fake` richiede dipendenze fuori dal runner Postgres: qui il client e' una finta
 * con memoria delle transazioni, che conta le POST ricevute). Prova che non si ritrasmette mai.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { randomUUID } from 'crypto'
import { TrasmissioneRentriIncertaError } from '../../../infrastructure/rentri/rentri-api.client'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'
import { TrasmettiLottoRegistroUseCase } from './trasmetti-lotto-registro.use-case'
import { TrasmissioniRegistroRepository } from './trasmissioni-registro.repository'

class RentriFinto {
  transazioni = new Map<string, Array<{ anno: number; progressivo: number }>>()
  ultimaTransazioneId: string | null = null
  completaConErrore = false
  /** errore=false ma nessuna registrazione confermata (valido per il contratto). */
  senzaConferma = false
  erroreSuPost: Error | null = null
  erroreSuEsito: Error | null = null

  async inviaMovimenti(_reg: string, movimenti: Array<Record<string, unknown>>) {
    if (this.erroreSuPost) throw this.erroreSuPost
    const id = randomUUID()
    this.transazioni.set(
      id,
      movimenti.map(m => ({ anno: m.anno as number, progressivo: m.progressivo as number }))
    )
    this.ultimaTransazioneId = id
    return { transazioneId: id }
  }

  async attendiEsitoMovimenti(id: string) {
    if (this.erroreSuEsito) throw this.erroreSuEsito
    const numeri = this.transazioni.get(id) ?? []
    if (this.senzaConferma) {
      return { errore: false, validazione: [], numeroRegistrazioni: [] }
    }
    return {
      errore: this.completaConErrore,
      validazione: [],
      numeroRegistrazioni: this.completaConErrore
        ? []
        : numeri.map(n => ({
            ...n,
            identificativo: `M${String(n.progressivo).padStart(19, '0')}`,
          })),
    }
  }
}

describe('TrasmettiLottoRegistroUseCase — Postgres reale + RENTRI finto', () => {
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
  let n = 0
  let progressivo = 0

  async function scenario(quanti = 3) {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Ciclo RENTRI SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    const sede = await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001CI${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const registro = await owner.registroRifiuti.create({
      data: {
        tenantId: t.id,
        unitaLocaleId: sede.id,
        descrizione: 'Registro di prova',
        identificativoRentri: 'RABCDE12345',
      },
    })
    const ids: string[] = []
    for (let i = 0; i < quanti; i++) {
      const m = await owner.wasteMovement.create({
        data: {
          tenantId: t.id,
          registroId: registro.id,
          progressiveYear: 2026,
          progressiveNumber: ++progressivo,
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
          movimentoId: m.id,
          registroId: registro.id,
          tipo: 'CARICO',
          origine: 'MANUALE',
        },
      })
      ids.push(m.id)
    }
    const finto = new RentriFinto()
    const repo = new TrasmissioniRegistroRepository(app, logger)
    const uc = new TrasmettiLottoRegistroUseCase(
      repo,
      new LettoreAnnotazioniRentri(logger),
      finto as any,
      logger,
      a => ({
        ok: true,
        corpo: { anno: a.numero.anno, progressivo: a.numero.progressivo },
      })
    )
    return { tenantId: t.id, registroId: registro.id, ids, finto, uc }
  }

  const righe = (tenantId: string) =>
    owner.movimentoTrasmissioneRentri.findMany({ where: { tenantId } })

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

  it('tre annotazioni: TRASMESSA con gli identificativi; un secondo giro non ritrasmette', async () => {
    const s = await scenario()
    const r = await s.uc.trasmettiRegistro(s.tenantId, s.registroId)
    expect(r).toMatchObject({ esito: 'INVIATO', trasmesse: 3, rifiutate: 0 })
    const rr = await righe(s.tenantId)
    expect(rr.every(x => x.stato === 'TRASMESSA' && x.bloccatoInvio)).toBe(true)
    expect(rr.every(x => /^M\d{19}$/.test(x.identificativoRentri ?? ''))).toBe(true)
    expect(s.finto.transazioni.size).toBe(1)
    expect((await s.uc.trasmettiRegistro(s.tenantId, s.registroId)).esito).toBe('NIENTE')
    expect(s.finto.transazioni.size).toBe(1)
  })

  it('esito con errore: RIFIUTATA, sbloccata e riaccodabile', async () => {
    const s = await scenario(2)
    s.finto.completaConErrore = true
    const r = await s.uc.trasmettiRegistro(s.tenantId, s.registroId)
    expect(r).toMatchObject({ esito: 'RIFIUTATO', trasmesse: 0, rifiutate: 2 })
    const rr = await righe(s.tenantId)
    expect(rr.every(x => x.stato === 'RIFIUTATA' && !x.bloccatoInvio)).toBe(true)
  })

  it('errore=false senza conferma: INCERTA e bloccata, mai riaccodabile ne selezionabile', async () => {
    const s = await scenario(2)
    s.finto.senzaConferma = true
    const r = await s.uc.trasmettiRegistro(s.tenantId, s.registroId)
    expect(r).toMatchObject({ esito: 'INCERTO', trasmesse: 0, rifiutate: 0 })
    const rr = await righe(s.tenantId)
    expect(rr.every(x => x.stato === 'INCERTA' && x.bloccatoInvio)).toBe(true)
    // nessun nuovo giro le rimanda
    expect((await s.uc.trasmettiRegistro(s.tenantId, s.registroId)).esito).toBe('NIENTE')
    expect(s.finto.transazioni.size).toBe(1)
  })

  it('POST incerta: INCERTA e nessun giro successivo la rimanda', async () => {
    const s = await scenario(2)
    s.finto.erroreSuPost = new TrasmissioneRentriIncertaError('NESSUNA_RISPOSTA')
    expect((await s.uc.trasmettiRegistro(s.tenantId, s.registroId)).esito).toBe('INCERTO')
    s.finto.erroreSuPost = null
    expect((await righe(s.tenantId)).every(x => x.stato === 'INCERTA' && x.bloccatoInvio)).toBe(
      true
    )
    expect((await s.uc.trasmettiRegistro(s.tenantId, s.registroId)).esito).toBe('NIENTE')
    expect(s.finto.transazioni.size).toBe(0)
  })

  it('un errore nel polling lascia ATTESA_ESITO e il giro dopo non fa POST', async () => {
    const s = await scenario(2)
    s.finto.erroreSuEsito = new Error('rete')
    const r1 = await s.uc.trasmettiRegistro(s.tenantId, s.registroId)
    expect(r1.esito).toBe('INVIATO')
    expect((await righe(s.tenantId)).every(x => x.stato === 'ATTESA_ESITO')).toBe(true)
    expect((await s.uc.trasmettiRegistro(s.tenantId, s.registroId)).esito).toBe('GIA_IN_CORSO')
    s.finto.erroreSuEsito = null
    expect(await s.uc.riprendiAttese(s.tenantId)).toEqual({ riletti: 1, incerte: 0 })
    expect((await righe(s.tenantId)).every(x => x.stato === 'TRASMESSA')).toBe(true)
    expect(s.finto.transazioni.size).toBe(1)
  })

  it('ATTESA_ESITO oltre 7 giorni diventa INCERTA', async () => {
    const s = await scenario(1)
    s.finto.erroreSuEsito = new Error('rete')
    await s.uc.trasmettiRegistro(s.tenantId, s.registroId)
    await owner.movimentoTrasmissioneRentri.updateMany({
      where: { tenantId: s.tenantId },
      data: { prenotatoIl: new Date(Date.now() - 8 * 24 * 3600_000) },
    })
    expect(await s.uc.riprendiAttese(s.tenantId)).toEqual({ riletti: 0, incerte: 1 })
    expect((await righe(s.tenantId))[0].stato).toBe('INCERTA')
  })
})
