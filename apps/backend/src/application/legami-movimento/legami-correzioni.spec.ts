import { SOGLIA_BUDGET_LEGAME_MS } from './aggancio-registro'
import {
  AVVISO_LEGAME_DA_RIALLINEARE,
  riallineaLegameDopoCorrezione,
  type DatiCorrezioneLegame,
} from './legami-correzioni'

jest.mock('../../core/monitoring/segnala-errore-job', () => ({ segnalaErroreJob: jest.fn() }))

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
  it('budget esaurito: nessun savepoint e nessuna query sul legame, avviso e audit', async () => {
    const { tx, eseguiti } = txFinta()
    const avvisi = await riallineaLegameDopoCorrezione(
      tx as never,
      dati({ trascorsoMs: SOGLIA_BUDGET_LEGAME_MS + 1 })
    )
    expect(avvisi).toEqual([AVVISO_LEGAME_DA_RIALLINEARE])
    expect(eseguiti.some(s => s === 'SAVEPOINT legame_correzione')).toBe(false)
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(eseguiti).toEqual(['SAVEPOINT legame_audit', 'RELEASE SAVEPOINT legame_audit'])
    expect(tx.activityLog.create.mock.calls[0][0].data.metadata).toMatchObject({
      codice: 'BUDGET_ESAURITO',
      correzione: true,
    })
  })

  it('errore nel riallineamento: ROLLBACK TO del savepoint e nessuna eccezione verso il chiamante', async () => {
    const { tx, eseguiti } = txFinta()
    tx.$queryRaw
      .mockResolvedValueOnce([{ v: '0' }]) // lock_timeout
      .mockResolvedValueOnce([{ id: 'l-1' }]) // legame esistente
      .mockRejectedValueOnce(new Error('testa illeggibile con dati personali'))
    const avvisi = await riallineaLegameDopoCorrezione(tx as never, dati())
    expect(avvisi).toEqual([AVVISO_LEGAME_DA_RIALLINEARE])
    expect(eseguiti).toContain('ROLLBACK TO SAVEPOINT legame_correzione')
    // Nell'audit non finisce il messaggio dell'errore originale.
    const audit = JSON.stringify(tx.activityLog.create.mock.calls[0][0].data)
    expect(audit).not.toMatch(/dati personali/)
  })

  it('annullo senza legame: niente da fare, nessun avviso, nessun legame creato', async () => {
    const { tx, eseguiti } = txFinta()
    tx.$queryRaw.mockResolvedValueOnce([{ v: '0' }]).mockResolvedValueOnce([])
    const d = dati({ tipo: 'ANNULLAMENTO' })
    const avvisi = await riallineaLegameDopoCorrezione(tx as never, d)
    expect(avvisi).toEqual([])
    expect(eseguiti).toContain('RELEASE SAVEPOINT legame_correzione')
    expect(
      (d.proposta as never as { proponiEScrivi: jest.Mock }).proponiEScrivi
    ).not.toHaveBeenCalled()
  })

  it('rettifica senza legame con causale non fatturabile: nessun legame', async () => {
    const { tx } = txFinta()
    tx.$queryRaw.mockResolvedValueOnce([{ v: '0' }]).mockResolvedValueOnce([])
    const d = dati()
    d.dopo.fatturabile = false
    expect(await riallineaLegameDopoCorrezione(tx as never, d)).toEqual([])
    expect(
      (d.proposta as never as { proponiEScrivi: jest.Mock }).proponiEScrivi
    ).not.toHaveBeenCalled()
  })
})
