import {
  COLONNE_ADDEBITO,
  COLONNE_CODICE_IVA,
  COLONNE_CODIFICA_ADDEBITO,
  contaUsiListino,
} from './uso-listino'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'

describe('contaUsiListino', () => {
  it('ids vuoto: nessuna query', async () => {
    const client: any = { addebito: { groupBy: jest.fn() }, rigaAddebito: { groupBy: jest.fn() } }
    const usi = await contaUsiListino(client, T, [], COLONNE_CODICE_IVA)
    expect(usi.size).toBe(0)
    expect(client.addebito.groupBy).not.toHaveBeenCalled()
    expect(client.rigaAddebito.groupBy).not.toHaveBeenCalled()
  })

  it('un groupBy per colonna referente, filtrato per azienda e ids; zero per i non citati', async () => {
    const client: any = {
      addebito: {
        groupBy: jest.fn(async (a: any) =>
          a.by[0] === 'gruppoId' ? [{ gruppoId: 'x', _count: { _all: 2 } }] : []
        ),
      },
      rigaAddebito: { groupBy: jest.fn(async () => []) },
    }
    const usi = await contaUsiListino(client, T, ['x', 'y'], COLONNE_CODIFICA_ADDEBITO)
    expect(client.addebito.groupBy.mock.calls.map((c: any) => c[0].by[0])).toEqual([
      'gruppoId',
      'categoriaId',
      'centroRicavoId',
      'categoriaStatistica1Id',
      'categoriaStatistica2Id',
    ])
    expect(client.addebito.groupBy.mock.calls[0][0].where).toEqual({
      tenantId: T,
      gruppoId: { in: ['x', 'y'] },
    })
    expect(usi.get('x')).toBe(2)
    expect(usi.get('y')).toBe(0)
  })

  it('somma le citazioni di colonne diverse', async () => {
    const client: any = {
      addebito: {
        groupBy: jest.fn(async (a: any) =>
          ['gruppoId', 'categoriaId'].includes(a.by[0])
            ? [{ [a.by[0]]: 'x', _count: { _all: 1 } }]
            : []
        ),
      },
      rigaAddebito: { groupBy: jest.fn(async () => []) },
    }
    expect((await contaUsiListino(client, T, ['x'], COLONNE_CODIFICA_ADDEBITO)).get('x')).toBe(2)
  })

  it('le righe dei listini sono una seconda sorgente: categoria e centro di ricavo, sommate agli addebiti', async () => {
    const client: any = {
      addebito: {
        groupBy: jest.fn(async (a: any) =>
          a.by[0] === 'categoriaId' ? [{ categoriaId: 'x', _count: { _all: 1 } }] : []
        ),
      },
      rigaAddebito: {
        groupBy: jest.fn(async (a: any) =>
          a.by[0] === 'categoriaId'
            ? [{ categoriaId: 'x', _count: { _all: 3 } }]
            : a.by[0] === 'centroRicavoId'
              ? [{ centroRicavoId: 'y', _count: { _all: 2 } }]
              : []
        ),
      },
    }
    const usi = await contaUsiListino(client, T, ['x', 'y'], COLONNE_CODIFICA_ADDEBITO)
    expect(client.rigaAddebito.groupBy.mock.calls.map((c: any) => c[0].by[0])).toEqual([
      'categoriaId',
      'centroRicavoId',
    ])
    expect(client.rigaAddebito.groupBy.mock.calls[0][0].where).toEqual({
      tenantId: T,
      categoriaId: { in: ['x', 'y'] },
    })
    expect(usi.get('x')).toBe(4)
    expect(usi.get('y')).toBe(2)
  })

  it('il codice IVA e’ citato da addebiti e righe, dalla sola colonna codiceIvaId', () => {
    expect(COLONNE_CODICE_IVA.addebiti).toEqual(['codiceIvaId'])
    expect(COLONNE_CODICE_IVA.righe).toEqual(['codiceIvaId'])
  })

  it('la codifica e’ citata dalle righe solo come categoria e centro di ricavo', () => {
    expect(COLONNE_CODIFICA_ADDEBITO.righe).toEqual(['categoriaId', 'centroRicavoId'])
  })

  it('addebito: nessuna colonna sugli addebiti, le righe lo citano con addebitoId', async () => {
    expect(COLONNE_ADDEBITO.addebiti).toEqual([])
    const client: any = {
      addebito: { groupBy: jest.fn() },
      rigaAddebito: {
        groupBy: jest.fn(async () => [{ addebitoId: 'x', _count: { _all: 5 } }]),
      },
    }
    const usi = await contaUsiListino(client, T, ['x', 'y'], COLONNE_ADDEBITO)
    expect(usi.get('x')).toBe(5)
    expect(usi.get('y')).toBe(0)
    expect(client.addebito.groupBy).not.toHaveBeenCalled()
    expect(client.rigaAddebito.groupBy).toHaveBeenCalledTimes(1)
  })
})
