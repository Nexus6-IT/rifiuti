/**
 * eREGI E7: il job dell'esportazione mensile con il vero `GeneraEsportazioneRegistroRentriUseCase`
 * contro un Postgres reale, COME `wasteflow_app` (RLS). I client RENTRI sono finti (nessuna rete).
 * Prova: nessun doppione, mesi chiusi esportati e mese corrente no, annotazioni non confermate
 * che fermano l'esportazione, un anello alla volta.
 */
import { PrismaClient, type StatoTrasmissioneRentri } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { RentriRegistroEsportazioneJob } from '../../../infrastructure/jobs/rentri-registro-esportazione.job'
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import {
  aggiungiAnnotazioni,
  eregiDiProva,
  materialeFirmaDiProva,
  scenarioEsportazioni,
  type ScenarioEsportazioni,
} from '../../../test-support/esportazioni-registro-di-prova'
import { VARIABILE_ESPORTAZIONI_AUTOMATICHE } from './esportazioni-automatiche-attive'
import { GeneraEsportazioneRegistroRentriUseCase } from './genera-esportazione-registro-rentri.use-case'
import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'

/** Giro del job con «oggi» fissato. */
class JobConOggi extends RentriRegistroEsportazioneJob {
  oggi = new Date('2026-11-28T10:00:00Z')
  protected override adesso(): Date {
    return this.oggi
  }
}

describe('RentriRegistroEsportazioneJob — Postgres reale, ruolo wasteflow_app', () => {
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
  const valida = { valida: jest.fn(), rivalida: jest.fn() }
  const salvato = process.env[VARIABILE_ESPORTAZIONI_AUTOMATICHE]

  function creaJob(s: ScenarioEsportazioni): JobConOggi {
    const genera = new GeneraEsportazioneRegistroRentriUseCase(
      app,
      new LettoreAnnotazioniRentri(logger),
      {
        scaricaVidimazioneXml: jest
          .fn()
          .mockResolvedValue({ nomeFile: 'e.xml', mime: 'application/xml', xml: eregiDiProva() }),
      } as never,
      { resolve: jest.fn().mockResolvedValue({ ...materialeFirmaDiProva(), source: 'tenant' }) } as never,
      valida as never,
      logger
    )
    return new JobConOggi(
      { tenant: { findMany: async () => [{ id: s.tenantId }] } } as never,
      app,
      { haCredenziale: async () => true } as never,
      genera,
      valida as never,
      logger,
      { tenantConModulo: async (ids: string[]) => new Set(ids) } as never
    )
  }

  async function scenario(): Promise<ScenarioEsportazioni> {
    const s = await scenarioEsportazioni(owner)
    tenantCreati.push(s.tenantId)
    return s
  }

  /** Annotazioni 1..n del 2026 con data di annotazione nel mese indicato (0-based). */
  async function annotazioni(s: ScenarioEsportazioni, da: number, a: number, mese: number) {
    const ids = await aggiungiAnnotazioni(owner, s, 2026, da, a)
    await owner.wasteMovement.updateMany({
      where: { id: { in: ids } },
      data: { registrationDate: new Date(Date.UTC(2026, mese, 10, 10, 0, 0)) },
    })
    return ids
  }

  async function trasmissione(s: ScenarioEsportazioni, movimentoId: string, stato: StatoTrasmissioneRentri) {
    const bloccata = ['TRASMESSA', 'GIA_SU_RENTRI'].includes(stato)
    await owner.movimentoTrasmissioneRentri.create({
      data: {
        tenantId: s.tenantId,
        movimentoId,
        registroId: s.registroId,
        tipo: 'CARICO',
        origine: 'MANUALE',
        stato,
        bloccatoInvio: bloccata,
        motivoBlocco: bloccata ? 'prova' : null,
      } as never,
    })
  }

  const righe = (s: ScenarioEsportazioni) =>
    owner.esportazioneRegistroRentri.findMany({
      where: { registroId: s.registroId },
      orderBy: { createdAt: 'asc' },
    })

  async function confermaUltima(s: ScenarioEsportazioni) {
    const tutte = await righe(s)
    await owner.esportazioneRegistroRentri.update({
      where: { id: tutte[tutte.length - 1].id },
      data: { stato: 'VALIDATA' },
    })
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
  })
  beforeEach(() => {
    process.env[VARIABILE_ESPORTAZIONI_AUTOMATICHE] = 'true'
    valida.valida.mockReset().mockResolvedValue(undefined)
    valida.rivalida.mockReset().mockResolvedValue(undefined)
    jest.clearAllMocks()
  })
  afterAll(async () => {
    if (salvato === undefined) delete process.env[VARIABILE_ESPORTAZIONI_AUTOMATICHE]
    else process.env[VARIABILE_ESPORTAZIONI_AUTOMATICHE] = salvato
    if (tenantCreati.length > 0) await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('interruttore spento: nessun file, nemmeno con annotazioni di mesi chiusi', async () => {
    const s = await scenario()
    await annotazioni(s, 1, 3, 2)
    delete process.env[VARIABILE_ESPORTAZIONI_AUTOMATICHE]
    await creaJob(s).eseguiEsportazione()
    expect(await righe(s)).toHaveLength(0)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('esporta i mesi chiusi, non il corrente, e non crea doppioni a giri ripetuti', async () => {
    const s = await scenario()
    const marzo = await annotazioni(s, 1, 3, 2)
    for (const id of marzo) await trasmissione(s, id, 'TRASMESSA')
    await annotazioni(s, 4, 5, 10) // novembre: mese corrente, non si esporta
    const job = creaJob(s)

    await job.eseguiEsportazione()
    let dopo = await righe(s)
    expect(dopo).toHaveLength(1)
    expect(dopo[0]).toMatchObject({ progressivoDa: 1, progressivoA: 3, creataDa: null })

    // Stessi giri ripetuti: nessun doppione (l'ultima non ha ancora esito, poi e confermata).
    await job.eseguiEsportazione()
    expect(await righe(s)).toHaveLength(1)
    await confermaUltima(s)
    await job.eseguiEsportazione()
    await job.eseguiEsportazione()
    dopo = await righe(s)
    expect(dopo).toHaveLength(1)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('a inizio mese successivo esporta il mese appena chiuso, con la catena', async () => {
    const s = await scenario()
    for (const id of await annotazioni(s, 1, 2, 2)) await trasmissione(s, id, 'TRASMESSA')
    for (const id of await annotazioni(s, 3, 4, 9)) await trasmissione(s, id, 'GIA_SU_RENTRI')
    const job = creaJob(s)
    job.oggi = new Date('2026-10-01T05:00:00Z') // ottobre non e ancora chiuso: solo marzo
    await job.eseguiEsportazione()
    expect(await righe(s)).toHaveLength(1)
    await confermaUltima(s)
    job.oggi = new Date('2026-11-02T05:00:00Z') // ora ottobre e chiuso
    await job.eseguiEsportazione()
    const tutte = await righe(s)
    expect(tutte).toHaveLength(2)
    expect(tutte[1]).toMatchObject({ progressivoDa: 3, progressivoA: 4, precedenteId: tutte[0].id })
  })

  it('un annotazione non confermata ferma l esportazione prima del suo mese', async () => {
    const s = await scenario()
    for (const id of await annotazioni(s, 1, 2, 2)) await trasmissione(s, id, 'TRASMESSA')
    const [sett] = await annotazioni(s, 3, 3, 8) // settembre, rifiutata da RENTRI
    await trasmissione(s, sett, 'RIFIUTATA')
    for (const id of await annotazioni(s, 4, 5, 9)) await trasmissione(s, id, 'TRASMESSA')
    const job = creaJob(s)
    await job.eseguiEsportazione()
    const tutte = await righe(s)
    expect(tutte).toHaveLength(1)
    expect(tutte[0]).toMatchObject({ progressivoDa: 1, progressivoA: 2 })
    await confermaUltima(s)
    await job.eseguiEsportazione()
    expect(await righe(s)).toHaveLength(1)
  })

  it('una esportazione rifiutata da RENTRI: il job non ne genera altre e non da errore', async () => {
    const s = await scenario()
    for (const id of await annotazioni(s, 1, 2, 2)) await trasmissione(s, id, 'TRASMESSA')
    const job = creaJob(s)
    await job.eseguiEsportazione()
    const [prima] = await righe(s)
    await owner.esportazioneRegistroRentri.update({
      where: { id: prima.id },
      data: { stato: 'RIFIUTATA' },
    })
    for (const id of await annotazioni(s, 3, 3, 9)) await trasmissione(s, id, 'TRASMESSA')
    await job.eseguiEsportazione()
    expect(await righe(s)).toHaveLength(1)
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn.mock.calls.some((c: unknown[]) => /rifiutata/i.test(String(c[0])))).toBe(true)
  })

  it('un registro chiuso su RENTRI o in chiusura non viene esportato dal job', async () => {
    const s = await scenario()
    for (const id of await annotazioni(s, 1, 2, 2)) await trasmissione(s, id, 'TRASMESSA')
    await owner.registroRifiuti.update({
      where: { id: s.registroId },
      data: { rentriChiusuraRichiestaIl: new Date('2026-11-01T00:00:00Z') },
    })
    await creaJob(s).eseguiEsportazione()
    expect(await righe(s)).toHaveLength(0)
  })
})
