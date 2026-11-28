import * as Sentry from '@sentry/node'
import { RentriRegistroEsportazioneJob } from './rentri-registro-esportazione.job'
import {
  CatenaEsportazioniNonCoerenteError,
  EsportazioneRifiutataInCatenaError,
} from '../../application/rentri/registro/errori-esportazioni-registro-rentri'
import { VARIABILE_INVII_REGISTRO } from '../../application/rentri/registro/invii-registro-attivi'
import { VARIABILE_ESPORTAZIONI_AUTOMATICHE } from '../../application/rentri/registro/esportazioni-automatiche-attive'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))
jest.mock('../../application/rentri/registro/limite-esportazione-mensile', () => ({
  ...jest.requireActual('../../application/rentri/registro/limite-esportazione-mensile'),
  piuVecchiaNonConfermataPerRegistro: jest.fn(),
}))
import { piuVecchiaNonConfermataPerRegistro } from '../../application/rentri/registro/limite-esportazione-mensile'

const OGGI = new Date('2026-11-28T10:00:00Z')
const INIZIO_NOVEMBRE = '2026-10-31T23:00:00.000Z'

/** Stato dell'ultima esportazione VIVA di ogni registro (`null` = nessuna esportazione). */
type Ultime = Record<string, string | null>

describe('RentriRegistroEsportazioneJob', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }
  const salvate: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const v of [VARIABILE_ESPORTAZIONI_AUTOMATICHE, VARIABILE_INVII_REGISTRO]) {
      salvate[v] = process.env[v]
      delete process.env[v]
    }
    ;(piuVecchiaNonConfermataPerRegistro as jest.Mock).mockResolvedValue(new Map())
  })
  afterEach(() => {
    for (const [v, valore] of Object.entries(salvate)) {
      if (valore === undefined) delete process.env[v]
      else process.env[v] = valore
    }
    jest.clearAllMocks()
  })

  function build(
    registriPerTenant: Record<string, string[]>,
    opzioni: {
      senzaCertificato?: string[]
      senzaModulo?: string[]
      ultime?: Ultime
      pendenti?: Array<{ id: string; stato: string }>
    } = {}
  ) {
    const sistema = {
      tenant: {
        findMany: jest.fn().mockResolvedValue(Object.keys(registriPerTenant).map(id => ({ id }))),
      },
    }
    const prisma = {
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
      registroRifiuti: {
        findMany: jest.fn(({ where }: { where: { tenantId: string } }) =>
          Promise.resolve((registriPerTenant[where.tenantId] ?? []).map(id => ({ id })))
        ),
      },
      esportazioneRegistroRentri: {
        findFirst: jest.fn(({ where }: { where: { registroId: string } }) => {
          const stato = opzioni.ultime?.[where.registroId]
          return Promise.resolve(stato ? { stato } : null)
        }),
        findMany: jest.fn(() => Promise.resolve(opzioni.pendenti ?? [])),
      },
    }
    const resolver = {
      haCredenziale: jest.fn((t: string) =>
        Promise.resolve(!(opzioni.senzaCertificato ?? []).includes(t))
      ),
    }
    const moduli = {
      tenantConModulo: jest.fn(
        async (ids: readonly string[]) =>
          new Set(ids.filter(id => !(opzioni.senzaModulo ?? []).includes(id)))
      ),
    }
    const genera = {
      genera: jest.fn().mockResolvedValue({ esito: 'NIENTE_DA_ESPORTARE', esportazione: null }),
    }
    const valida = {
      valida: jest.fn().mockResolvedValue({}),
      rivalida: jest.fn().mockResolvedValue({}),
    }
    const job = new RentriRegistroEsportazioneJob(
      sistema as never,
      prisma as never,
      resolver as never,
      genera as never,
      valida as never,
      logger as never,
      moduli as never
    )
    jest.spyOn(job as never, 'adesso' as never).mockReturnValue(OGGI as never)
    return { job, sistema, prisma, resolver, moduli, genera, valida }
  }

  describe('interruttore spento (predefinito)', () => {
    it('assente: non legge nemmeno le aziende, nessuna chiamata, nessun errore', async () => {
      const { job, sistema, genera, valida } = build({ t1: ['r1'] })
      await job.eseguiEsportazione()
      expect(sistema.tenant.findMany).not.toHaveBeenCalled()
      expect(genera.genera).not.toHaveBeenCalled()
      expect(valida.valida).not.toHaveBeenCalled()
      expect(valida.rivalida).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })

    it.each(['false', 'TRUE', '1', ''])('con il valore %j resta spento', async valore => {
      process.env[VARIABILE_ESPORTAZIONI_AUTOMATICHE] = valore
      const { job, genera } = build({ t1: ['r1'] })
      await job.eseguiEsportazione()
      expect(genera.genera).not.toHaveBeenCalled()
    })
  })

  describe('interruttore acceso', () => {
    beforeEach(() => {
      process.env[VARIABILE_ESPORTAZIONI_AUTOMATICHE] = 'true'
    })

    it('invii del registro sospesi: il job non fa nulla e lo dice una volta', async () => {
      process.env[VARIABILE_INVII_REGISTRO] = 'false'
      const { job, genera, valida, sistema } = build({ t1: ['r1'], t2: ['r2'] })
      await job.eseguiEsportazione()
      expect(sistema.tenant.findMany).not.toHaveBeenCalled()
      expect(genera.genera).not.toHaveBeenCalled()
      expect(valida.rivalida).not.toHaveBeenCalled()
      expect(logger.warn.mock.calls.filter(c => /sospesi/i.test(c[0]))).toHaveLength(1)
    })

    it('genera col limite di data: inizio del mese corrente se tutto e confermato', async () => {
      const { job, genera } = build({ t1: ['r1'] })
      await job.eseguiEsportazione()
      expect(genera.genera).toHaveBeenCalledTimes(1)
      const [tenant, registro, opzioni] = genera.genera.mock.calls[0]
      expect([tenant, registro]).toEqual(['t1', 'r1'])
      expect(opzioni.creataDa).toBeNull()
      expect(opzioni.valida).not.toBe(false)
      expect(opzioni.fino.toISOString()).toBe(INIZIO_NOVEMBRE)
    })

    it('con annotazioni non confermate in un mese precedente il limite arretra a quel mese', async () => {
      ;(piuVecchiaNonConfermataPerRegistro as jest.Mock).mockResolvedValue(
        new Map([['r1', new Date('2026-09-12T10:00:00Z')]])
      )
      const { job, genera } = build({ t1: ['r1', 'r2'] })
      await job.eseguiEsportazione()
      const limiti = Object.fromEntries(
        genera.genera.mock.calls.map(c => [c[1], c[2].fino.toISOString()])
      )
      expect(limiti).toEqual({ r1: '2026-08-31T22:00:00.000Z', r2: INIZIO_NOVEMBRE })
    })

    it('un solo file per registro e per giro (niente anelli impilati senza esito)', async () => {
      const { job, genera } = build({ t1: ['r1'] })
      genera.genera.mockResolvedValue({
        esito: 'CREATA',
        esportazione: { id: 'e1' },
        fermataA: null,
      })
      await job.eseguiEsportazione()
      expect(genera.genera).toHaveBeenCalledTimes(1)
    })

    it.each(['GENERATA', 'IN_VALIDAZIONE', 'VALIDAZIONE_NON_DISPONIBILE', 'RIFIUTATA'])(
      'ultima esportazione %s: non si genera la successiva',
      async stato => {
        const { job, genera } = build({ t1: ['r1'] }, { ultime: { r1: stato } })
        await job.eseguiEsportazione()
        expect(genera.genera).not.toHaveBeenCalled()
      }
    )

    it.each(['VALIDATA', 'VALIDATA_CON_AVVISI'])(
      'ultima esportazione %s: si genera la successiva',
      async stato => {
        const { job, genera } = build({ t1: ['r1'] }, { ultime: { r1: stato } })
        await job.eseguiEsportazione()
        expect(genera.genera).toHaveBeenCalledTimes(1)
      }
    )

    it('una rifiutata fa un avviso (serve una persona), non un errore', async () => {
      const { job } = build({ t1: ['r1'] }, { ultime: { r1: 'RIFIUTATA' } })
      await job.eseguiEsportazione()
      expect(logger.warn.mock.calls.some(c => /rifiutata/i.test(c[0]))).toBe(true)
      expect(logger.error).not.toHaveBeenCalled()
      expect(Sentry.captureException).not.toHaveBeenCalled()
    })

    it('rivalida le esportazioni senza esito: GENERATA con valida, le altre con rivalida', async () => {
      const { job, valida } = build(
        { t1: [] },
        {
          pendenti: [
            { id: 'e1', stato: 'GENERATA' },
            { id: 'e2', stato: 'IN_VALIDAZIONE' },
            { id: 'e3', stato: 'VALIDAZIONE_NON_DISPONIBILE' },
          ],
        }
      )
      await job.eseguiEsportazione()
      expect(valida.valida.mock.calls).toEqual([['t1', 'e1']])
      expect(valida.rivalida.mock.calls).toEqual([
        ['t1', 'e2'],
        ['t1', 'e3'],
      ])
    })

    it('aziende senza certificato o senza modulo rentri: saltate, nessun errore', async () => {
      const { job, genera, resolver } = build(
        { t1: ['r1'], t2: ['r2'], t3: ['r3'] },
        { senzaCertificato: ['t2'], senzaModulo: ['t3'] }
      )
      await job.eseguiEsportazione()
      expect(resolver.haCredenziale).not.toHaveBeenCalledWith('t3')
      expect(genera.genera.mock.calls.map(c => c[1])).toEqual(['r1'])
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('legge solo i registri collegati, non chiusi e non in chiusura', async () => {
      const { job, prisma } = build({ t1: ['r1'] })
      await job.eseguiEsportazione()
      expect(prisma.registroRifiuti.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 't1',
            identificativoRentri: { not: null },
            rentriChiusoIl: null,
            rentriChiusuraRichiestaIl: null,
          },
        })
      )
    })

    it('chiede la generazione solo se l ultima e confermata (controllo sotto lock)', async () => {
      const { job, genera } = build({ t1: ['r1'] })
      await job.eseguiEsportazione()
      expect(genera.genera.mock.calls[0][2].richiediUltimaConfermata).toBe(true)
    })

    it.each([
      ['rifiutata in mezzo alla catena', () => new EsportazioneRifiutataInCatenaError()],
      ['catena non coerente', () => new CatenaEsportazioniNonCoerenteError('prova')],
    ])('%s: un avviso, non un errore segnalato', async (_nome, crea) => {
      const { job, genera } = build({ t1: ['r1', 'r2'] })
      genera.genera.mockRejectedValueOnce(crea())
      await job.eseguiEsportazione()
      expect(genera.genera).toHaveBeenCalledTimes(2)
      expect(logger.error).not.toHaveBeenCalled()
      expect(Sentry.captureException).not.toHaveBeenCalled()
      expect(logger.warn.mock.calls.some(c => /serve una decisione/i.test(c[0]))).toBe(true)
    })

    it('limite arretrato da annotazioni non confermate: avviso con registro e mese', async () => {
      ;(piuVecchiaNonConfermataPerRegistro as jest.Mock).mockResolvedValue(
        new Map([['r1', new Date('2026-09-12T10:00:00Z')]])
      )
      const { job } = build({ t1: ['r1', 'r2'] })
      await job.eseguiEsportazione()
      const avvisi = logger.warn.mock.calls.filter(c => /ferma al mese/i.test(c[0]))
      expect(avvisi).toHaveLength(1)
      expect(avvisi[0][1]).toMatchObject({ registroId: 'r1', mese: '2026-09' })
    })

    it('un errore su un registro non ferma gli altri e viene segnalato', async () => {
      const { job, genera } = build({ t1: ['r1', 'r2'] })
      genera.genera.mockRejectedValueOnce(new Error('guasto')).mockResolvedValue({
        esito: 'NIENTE_DA_ESPORTARE',
        esportazione: null,
      })
      await job.eseguiEsportazione()
      expect(genera.genera).toHaveBeenCalledTimes(2)
      expect(logger.error).toHaveBeenCalled()
      expect(Sentry.captureException).toHaveBeenCalled()
    })

    it('un giro sovrapposto nello stesso processo si salta', async () => {
      const { job, genera } = build({ t1: ['r1'] })
      let sblocca!: () => void
      genera.genera.mockImplementationOnce(
        () =>
          new Promise(
            r => (sblocca = () => r({ esito: 'NIENTE_DA_ESPORTARE', esportazione: null }))
          )
      )
      const primo = job.eseguiEsportazione()
      await new Promise(r => setImmediate(r))
      await job.eseguiEsportazione()
      expect(genera.genera).toHaveBeenCalledTimes(1)
      sblocca()
      await primo
    })

    it('i log non contengono dati dell esportazione, solo id tecnici e conteggi', async () => {
      const { job, genera } = build({ t1: ['r1'] })
      genera.genera.mockResolvedValue({
        esito: 'CREATA',
        esportazione: { id: 'e1', digestValue: 'SEGRETO' },
        fermataA: { anno: 2026, progressivo: 7, motivi: ['Dato mancante'] },
      })
      await job.eseguiEsportazione()
      const tutto = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])
      expect(tutto).not.toContain('SEGRETO')
    })
  })
})
