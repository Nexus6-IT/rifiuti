import { leggiApertureRegistro, apertureInKg } from './aperture-registro'

describe('leggiApertureRegistro', () => {
  const riga = {
    id: 'a1',
    registroId: 'r1',
    cerCode: '15 01 06',
    quantita: { toString: () => '12.50' },
    unita: 'KG',
    dataRiferimento: new Date('2026-03-01T00:00:00Z'),
  }

  it('filtra per tenant e restituisce numeri e data come stringa', async () => {
    const findMany = jest.fn().mockResolvedValue([riga])
    const r = await leggiApertureRegistro({ giacenzaIniziale: { findMany } } as never, 't1')
    expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1' })
    expect(r).toEqual([
      {
        id: 'a1',
        registroId: 'r1',
        cerCode: '15 01 06',
        quantita: 12.5,
        unita: 'KG',
        dataRiferimento: '2026-03-01',
      },
    ])
  })

  it("seleziona anche l'id della giacenza iniziale", async () => {
    const findMany = jest.fn().mockResolvedValue([])
    await leggiApertureRegistro({ giacenzaIniziale: { findMany } } as never, 't1')
    expect(findMany.mock.calls[0][0].select.id).toBe(true)
  })

  it('applica registro e giorno limite (incluso)', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    await leggiApertureRegistro({ giacenzaIniziale: { findMany } } as never, 't1', {
      registroId: 'r9',
      finoAl: '2026-12-31',
    })
    expect(findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      registroId: 'r9',
      dataRiferimento: { lte: new Date('2026-12-31T00:00:00Z') },
    })
  })
})

describe('apertureInKg', () => {
  it('converte kg e t, null per le altre unità', () => {
    expect(apertureInKg({ quantita: 2, unita: 'T' })).toBe(2000)
    expect(apertureInKg({ quantita: 5, unita: 'KG' })).toBe(5)
    expect(apertureInKg({ quantita: 5, unita: 'LITRI' })).toBeNull()
  })
})
