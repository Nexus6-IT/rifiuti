/**
 * Scelta dei pesi specifici per anno nel lettore O.R.SO., con un database finto: un movimento in
 * litri alle 23:30 del 31/12 e uno alle 00:30 del 01/01 (ora di Roma) usano i pesi di anni diversi,
 * sia nei movimenti sia nelle giacenze a fine mese.
 */
import { CatalogoCausali } from '../../domain/waste-movement/catalogo-causali'
import { leggiMovimentiOrso, type LettoreDatabaseOrso } from './lettore-movimenti-orso'

const peso = (kg: number) => ({ '130205|L': { cerCode: '13 02 05', unita: 'L', kgPerUnita: kg } })

function movimento(id: string, istante: string, n: number) {
  return {
    id,
    registroId: 'reg-1',
    type: 'CARICO',
    causale: 'INGRESSO_ESTERNO',
    causaleAziendaId: null,
    cerCode: '13 02 05',
    wasteDescription: 'Olio',
    quantity: 100,
    unit: 'L',
    operationCode: null,
    firId: null,
    movementDate: new Date(istante),
    counterpartAddress: null,
    counterpartName: null,
    movimentoOriginaleId: null,
    progressiveYear: 2025,
    progressiveNumber: n,
  }
}

function dbFinto(): LettoreDatabaseOrso {
  const vuoto = async () => []
  return {
    registroRifiuti: { findMany: async () => [{ id: 'reg-1' }] },
    rentriUnitaLocale: { findFirst: async () => null },
    wasteMovement: {
      findMany: async () => [
        movimento('m-2025', '2025-12-31T22:30:00Z', 1), // 23:30 del 31/12 a Roma
        movimento('m-2026', '2025-12-31T23:30:00Z', 2), // 00:30 del 01/01 a Roma
      ],
    },
    fIR: { findMany: vuoto },
    sedeDitta: { findMany: vuoto },
    cERCode: { findMany: vuoto },
    giacenzaIniziale: { findMany: vuoto },
  } as unknown as LettoreDatabaseOrso
}

const base = {
  tenantId: 't-1',
  unitaLocaleId: 'sede-1',
  da: new Date('2025-12-31T00:00:00Z'),
  a: new Date('2026-01-02T00:00:00Z'),
  catalogo: new CatalogoCausali([], []),
}

describe('leggiMovimentiOrso — pesi specifici per anno (database finto)', () => {
  const perAnno = { 2025: peso(0.5), 2026: peso(2) }

  it('i movimenti a cavallo del capodanno di Roma prendono i pesi del proprio anno', async () => {
    const { movimenti } = await leggiMovimentiOrso(dbFinto(), {
      ...base,
      pesiSpecificiPerAnno: perAnno,
    })
    expect(movimenti.map(m => [m.id, m.kg])).toEqual([
      ['m-2025', 50],
      ['m-2026', 200],
    ])
  })

  it('le giacenze usano gli stessi pesi per anno dei movimenti', async () => {
    const { giacenze } = await leggiMovimentiOrso(dbFinto(), {
      ...base,
      anno: 2026,
      pesiSpecificiPerAnno: perAnno,
    })
    // gennaio 2026: 50 kg del 2025 (peso 0,5) + 200 kg del 2026 (peso 2)
    expect(giacenze.find(g => g.mese === 1)?.kg).toBe(250)
  })

  it('un anno senza pesi per anno ripiega su pesiSpecifici', async () => {
    const { movimenti } = await leggiMovimentiOrso(dbFinto(), {
      ...base,
      pesiSpecifici: peso(3),
      pesiSpecificiPerAnno: { 2026: peso(2) },
    })
    expect(movimenti.map(m => m.kg)).toEqual([300, 200])
  })

  it('senza alcun peso i kg restano null e le giacenze non contano il movimento', async () => {
    const { movimenti, giacenze } = await leggiMovimentiOrso(dbFinto(), { ...base, anno: 2026 })
    expect(movimenti.map(m => m.kg)).toEqual([null, null])
    expect(giacenze).toEqual([])
  })
})
