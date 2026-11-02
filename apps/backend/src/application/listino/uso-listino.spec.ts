import {
  COLONNE_ADDEBITO,
  COLONNE_CODICE_IVA,
  COLONNE_CODIFICA_ADDEBITO,
  contaUsiListino,
} from './uso-listino'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'

describe('contaUsiListino', () => {
  it('ids vuoto: nessuna query', async () => {
    const client: any = { addebito: { groupBy: jest.fn() } }
    const usi = await contaUsiListino(client, T, [], COLONNE_CODICE_IVA)
    expect(usi.size).toBe(0)
    expect(client.addebito.groupBy).not.toHaveBeenCalled()
  })

  it('un groupBy per colonna referente, filtrato per azienda e ids; zero per i non citati', async () => {
    const client: any = {
      addebito: {
        groupBy: jest.fn(async (a: any) =>
          a.by[0] === 'gruppoId' ? [{ gruppoId: 'x', _count: { _all: 2 } }] : []
        ),
      },
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
    }
    expect((await contaUsiListino(client, T, ['x'], COLONNE_CODIFICA_ADDEBITO)).get('x')).toBe(2)
  })

  it('il codice IVA e’ citato dalla sola colonna codiceIvaId', () => {
    expect(COLONNE_CODICE_IVA.addebiti).toEqual(['codiceIvaId'])
  })

  it('addebito: nessuna sorgente finche non esistono le righe (Task 22), zero senza query', async () => {
    const client: any = { addebito: { groupBy: jest.fn() } }
    const usi = await contaUsiListino(client, T, ['x'], COLONNE_ADDEBITO)
    expect(usi.get('x')).toBe(0)
    expect(client.addebito.groupBy).not.toHaveBeenCalled()
  })
})
