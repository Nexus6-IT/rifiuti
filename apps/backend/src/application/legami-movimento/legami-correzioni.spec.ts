import { SOGLIA_BUDGET_LEGAME_MS } from './aggancio-registro'
import {
  AVVISO_LEGAME_DA_RIALLINEARE,
  riallineaLegameDopoCorrezione,
  type DatiCorrezioneLegame,
} from './legami-correzioni'

jest.mock('../../core/monitoring/segnala-errore-job', () => ({ segnalaErroreJob: jest.fn() }))
jest.mock('./impostazioni-fatturazione.service', () => ({ leggiFatturazioneDaInTx: jest.fn() }))
import { leggiFatturazioneDaInTx } from './impostazioni-fatturazione.service'
const fatturazioneDa = leggiFatturazioneDaInTx as jest.MockedFunction<
  typeof leggiFatturazioneDaInTx
>

function txFinta() {
  const eseguiti: string[] = []
  return {
    eseguiti,
    tx: {
      $executeRawUnsafe: jest.fn(async (sql: string) => {
        eseguiti.push(sql)
        return 0
      }),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    },
  }
}

function dati(over: Partial<DatiCorrezioneLegame> = {}): DatiCorrezioneLegame {
  return {
    tenantId: 't-1',
    userId: 'u-1',
    registroId: 'r-1',
    tipo: 'RETTIFICA',
    radiceId: 'o-1',
    nuovoVigenteId: 'n-1',
    dopo: {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      causaleAziendaId: null,
      cerCode: '20 03 01',
      movementDate: new Date('2026-03-10T10:00:00Z'),
      unit: 'KG',
      quantity: '100',
      fatturabile: true,
      firId: null,
    },
    legami: { allineaAlVigente: jest.fn() } as never,
    proposta: { proponiEScrivi: jest.fn() } as never,
    ...over,
  }
}

describe('riallineaLegameDopoCorrezione (unitario)', () => {
  beforeEach(() => fatturazioneDa.mockResolvedValue('2026-01-01'))

  it('I1 budget esaurito ma nessun legame e niente da far nascere: nessun avviso, audit o savepoint', async () => {
    const { tx, eseguiti } = txFinta()
    tx.$queryRaw.mockResolvedValueOnce([]) // nessun legame
    fatturazioneDa.mockResolvedValue(null) // fatturazione spenta
    const r = await riallineaLegameDopoCorrezione(
      tx as never,
      dati({ trascorsoMs: SOGLIA_BUDGET_LEGAME_MS + 1 })
    )
    expect(r).toEqual({ avvisi: [], fatturazione: null })
    expect(eseguiti).toEqual([])
    expect(tx.activityLog.create).not.toHaveBeenCalled()
  })

  it('budget esaurito con un legame esistente: nessun savepoint del legame, avviso, audit e DA_RIALLINEARE', async () => {
    const { tx, eseguiti } = txFinta()
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'l-1' }])
    const r = await riallineaLegameDopoCorrezione(
      tx as never,
      dati({ trascorsoMs: SOGLIA_BUDGET_LEGAME_MS + 1 })
    )
    expect(r.avvisi).toEqual([AVVISO_LEGAME_DA_RIALLINEARE])
    expect(r.fatturazione).toMatchObject({ esito: 'DA_RIALLINEARE', legameId: 'l-1' })
    expect(eseguiti.some(s => s === 'SAVEPOINT legame_correzione')).toBe(false)
    expect(eseguiti).toEqual(['SAVEPOINT legame_audit', 'RELEASE SAVEPOINT legame_audit'])
    expect(tx.activityLog.create.mock.calls[0][0].data.metadata).toMatchObject({
      codice: 'BUDGET_ESAURITO',
      correzione: true,
    })
  })

  it('errore nel riallineamento: ROLLBACK TO + RELEASE del savepoint e nessuna eccezione verso il chiamante', async () => {
    const { tx, eseguiti } = txFinta()
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'l-1' }]) // pre-controllo
      .mockResolvedValueOnce([{ v: '0' }]) // lock_timeout
      .mockResolvedValueOnce([{ id: 'l-1' }]) // legame esistente sotto lock
      .mockRejectedValueOnce(new Error('testa illeggibile con dati personali'))
    const r = await riallineaLegameDopoCorrezione(tx as never, dati())
    expect(r.avvisi).toEqual([AVVISO_LEGAME_DA_RIALLINEARE])
    expect(eseguiti).toContain('ROLLBACK TO SAVEPOINT legame_correzione')
    expect(eseguiti).toContain('RELEASE SAVEPOINT legame_correzione')
    expect(JSON.stringify(tx.activityLog.create.mock.calls[0][0].data)).not.toMatch(
      /dati personali/
    )
  })

  it('annullo senza legame: niente da fare, nessuna query oltre al pre-controllo', async () => {
    const { tx, eseguiti } = txFinta()
    tx.$queryRaw.mockResolvedValueOnce([])
    const d = dati({ tipo: 'ANNULLAMENTO' })
    expect(await riallineaLegameDopoCorrezione(tx as never, d)).toEqual({
      avvisi: [],
      fatturazione: null,
    })
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
    expect(eseguiti).toEqual([])
  })

  it('rettifica senza legame con causale non fatturabile: nessun legame', async () => {
    const { tx } = txFinta()
    tx.$queryRaw.mockResolvedValueOnce([])
    const d = dati()
    d.dopo.fatturabile = false
    expect((await riallineaLegameDopoCorrezione(tx as never, d)).avvisi).toEqual([])
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("rettifica senza legame con data prima di «fatturazione da»: nessun legame ne' savepoint", async () => {
    const { tx, eseguiti } = txFinta()
    tx.$queryRaw.mockResolvedValueOnce([])
    fatturazioneDa.mockResolvedValue('2026-06-01')
    expect(await riallineaLegameDopoCorrezione(tx as never, dati())).toEqual({
      avvisi: [],
      fatturazione: null,
    })
    expect(eseguiti).toEqual([])
  })
})
