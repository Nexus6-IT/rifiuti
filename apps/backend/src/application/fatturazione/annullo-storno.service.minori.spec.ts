/**
 * Minori m1 e m2 del Task 20, chiusi dal Task 25a (senza database: la transazione e` finta).
 * m1: solo il 23505 dell'indice dello storno diventa STORNO_GIA_PRESENTE.
 * m2: un controllo di coppia (registro, anno) fallito su una BOZZA esce 409 col codice di dominio.
 */
import { HttpException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { AnnulloStornoService } from './annullo-storno.service'
import { DocumentiFatturaService } from './documenti-fattura.service'

jest.mock('./numerazione', () => ({
  ...jest.requireActual('./numerazione'),
  bloccaNumerazioni: jest.fn().mockResolvedValue(new Map()),
}))

const ID = '11111111-1111-4111-8111-111111111111'
const REGISTRO_A = '22222222-2222-4222-8222-222222222222'
const REGISTRO_B = '33333333-3333-4333-8333-333333333333'

/** Esito leggibile: `409 CODICE`, oppure `Error: messaggio` per un errore non HTTP (500 in produzione). */
async function esito(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ok'
  } catch (e) {
    if (e instanceof HttpException) {
      const r = e.getResponse() as { error: string; details?: { motivo?: string } }
      return `${e.getStatus()} ${r.error}${r.details?.motivo ? ` ${r.details.motivo}` : ''}`
    }
    return `Error: ${(e as Error).message}`
  }
}

const violazione = (vincolo: string) =>
  new Prisma.PrismaClientKnownRequestError('Raw query failed', {
    code: 'P2010',
    clientVersion: 'test',
    meta: {
      code: '23505',
      message: `ERROR: duplicate key value violates unique constraint "${vincolo}"`,
    },
  })

const STORNO = { motivo: 'reso', dataDocumento: '2026-04-20', rifatturabile: true, versione: 1 }

describe('AnnulloStornoService: minori del Task 20', () => {
  const transaction = jest.fn()
  const prisma = { $transaction: transaction } as never
  const service = new AnnulloStornoService(prisma, new DocumentiFatturaService(prisma))
  service.orologio = () => new Date('2026-05-01T10:00:00Z')

  beforeEach(() => transaction.mockReset())

  describe('m1: il 23505 dello storno', () => {
    it('quello dell`indice documenti_fattura_un_storno diventa 409 STORNO_GIA_PRESENTE', async () => {
      transaction.mockRejectedValueOnce(violazione('documenti_fattura_un_storno'))
      expect(await esito(service.storna('t', 'u', ID, STORNO))).toBe('409 STORNO_GIA_PRESENTE')
    })

    it.each(['documenti_fattura_numero_definitivo', 'marcatori_addebiti_fatturati_unico'])(
      'quello di %s resta un errore interno',
      async vincolo => {
        transaction.mockRejectedValueOnce(violazione(vincolo))
        const e = await esito(service.storna('t', 'u', ID, STORNO))
        expect(e.startsWith('Error:')).toBe(true)
      }
    )

    it('P2002 con target nominato come l`indice: STORNO_GIA_PRESENTE; con target di un altro indice: interno', async () => {
      const p2002 = (target: unknown) =>
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target },
        })
      transaction.mockRejectedValueOnce(p2002(['documenti_fattura_un_storno']))
      expect(await esito(service.storna('t', 'u', ID, STORNO))).toBe('409 STORNO_GIA_PRESENTE')
      transaction.mockRejectedValueOnce(p2002('documenti_fattura_numero_definitivo'))
      expect((await esito(service.storna('t', 'u', ID, STORNO))).startsWith('Error:')).toBe(true)
      // Con la RLS Prisma puo` riportare `target: null`: senza il nome dell'indice non si decide.
      transaction.mockRejectedValueOnce(p2002(null))
      expect((await esito(service.storna('t', 'u', ID, STORNO))).startsWith('Error:')).toBe(true)
    })
  })

  describe('m2: coppia (registro, anno) cambiata su una BOZZA', () => {
    /** Lettura semplice: registro A; documento sotto lock: BOZZA ora sul registro B. */
    function transazioneConBozzaSpostata() {
      const risposte: unknown[][] = [
        [{ registroIvaId: REGISTRO_A, anno: 2026 }],
        [
          {
            id: ID,
            stato: 'BOZZA',
            tipoDocumento: 'TD01',
            registroIvaId: REGISTRO_B,
            anno: 2026,
            numero: null,
            numeroTesto: null,
            dataDocumento: '2026-04-20',
            totaleDocumento: '10.00',
            emessoIl: null,
            versione: 1,
          },
        ],
        [{ esiste: false }],
      ]
      const tx = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(0),
        $executeRaw: jest.fn().mockResolvedValue(0),
        $queryRaw: jest.fn().mockImplementation(async () => risposte.shift() ?? []),
      }
      transaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx))
      return tx
    }

    it('annullo: 409 ANNULLO_NON_AMMESSO con motivo NON_DEFINITIVO, mai 500', async () => {
      const tx = transazioneConBozzaSpostata()
      expect(await esito(service.annulla('t', 'u', ID, { motivo: 'errore', versione: 1 }))).toBe(
        '409 ANNULLO_NON_AMMESSO NON_DEFINITIVO'
      )
      expect(tx.$executeRaw).not.toHaveBeenCalled()
    })

    it('storno: 409 STORNO_NON_AMMESSO con motivo NON_DEFINITIVO, mai 500', async () => {
      const tx = transazioneConBozzaSpostata()
      expect(await esito(service.storna('t', 'u', ID, STORNO))).toBe(
        '409 STORNO_NON_AMMESSO NON_DEFINITIVO'
      )
      expect(tx.$executeRaw).not.toHaveBeenCalled()
    })
  })
})
