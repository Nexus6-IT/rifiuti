import {
  COLONNE_ADDEBITO,
  COLONNE_CODICE_IVA,
  COLONNE_CODIFICA_ADDEBITO,
  COLONNE_ELENCO,
  COLONNE_RIGA_LISTINO,
  contaUsiListino,
  contaUsiListinoPerOrigine,
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

  describe('legami dei movimenti (4.3)', () => {
    const clienteFinto = (righe: Array<Record<string, unknown>> = []) =>
      ({
        addebito: { groupBy: jest.fn(async () => []) },
        rigaAddebito: { groupBy: jest.fn(async () => []) },
        rigaLegameMovimento: { groupBy: jest.fn(async () => righe) },
        legameMovimento: { groupBy: jest.fn(async () => righe) },
        documentoFattura: { groupBy: jest.fn(async () => []) },
        rigaDocumentoFattura: { groupBy: jest.fn(async () => []) },
        marcatoreAddebitoFatturato: { groupBy: jest.fn(async () => []) },
        $queryRaw: jest.fn(),
        $executeRaw: jest.fn(),
      }) as any

    it('i referenti sono colonne di righe_legame_movimento (riga, codice IVA) e di legami_movimento (elenco)', () => {
      expect(COLONNE_CODICE_IVA.righeLegame).toEqual(['codiceIvaId'])
      expect(COLONNE_RIGA_LISTINO.righeLegame).toEqual(['rigaAddebitoId'])
      expect(COLONNE_ELENCO.legami).toEqual(['elencoId'])
      expect(COLONNE_ELENCO.righeLegame).toEqual([])
      expect(COLONNE_CODIFICA_ADDEBITO.righeLegame).toEqual([])
      expect(COLONNE_CODIFICA_ADDEBITO.legami).toEqual([])
    })

    it('lista di 1000 id: una sola query per colonna, un solo IN, nessun join né query raw', async () => {
      const ids = Array.from(
        { length: 1000 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      )
      const client = clienteFinto([{ elencoId: ids[3], _count: { _all: 2 } }])
      const usi = await contaUsiListino(client, T, ids, COLONNE_ELENCO)
      expect(client.legameMovimento.groupBy).toHaveBeenCalledTimes(1)
      expect(client.legameMovimento.groupBy.mock.calls[0][0].where).toEqual({
        tenantId: T,
        elencoId: { in: ids },
      })
      expect(client.rigaLegameMovimento.groupBy).not.toHaveBeenCalled()
      expect(client.$queryRaw).not.toHaveBeenCalled()
      expect(client.$executeRaw).not.toHaveBeenCalled()
      expect(usi.get(ids[3])).toBe(2)
      expect(usi.get(ids[4])).toBe(0)
    })

    it('righeLegame: un groupBy per colonna sul modello delle righe dei legami', async () => {
      const client = clienteFinto([{ codiceIvaId: 'x', _count: { _all: 3 } }])
      const usi = await contaUsiListino(client, T, ['x', 'y'], COLONNE_CODICE_IVA)
      expect(client.rigaLegameMovimento.groupBy).toHaveBeenCalledTimes(1)
      expect(client.legameMovimento.groupBy).not.toHaveBeenCalled()
      expect(usi.get('x')).toBe(3)
      expect(usi.get('y')).toBe(0)
    })
  })

  describe('documenti di fattura (4.4a)', () => {
    const cliente = () =>
      ({
        addebito: { groupBy: jest.fn(async () => []) },
        rigaAddebito: { groupBy: jest.fn(async () => []) },
        rigaLegameMovimento: { groupBy: jest.fn(async () => []) },
        legameMovimento: { groupBy: jest.fn(async () => []) },
        rigaDocumentoFattura: {
          groupBy: jest.fn(async (a: any) => [{ [a.by[0]]: 'x', _count: { _all: 2 } }]),
        },
        marcatoreAddebitoFatturato: {
          groupBy: jest.fn(async (a: any) => [{ [a.by[0]]: 'x', _count: { _all: 1 } }]),
        },
      }) as any

    it('i referenti: riga di listino -> righe documento e marcatori; codice IVA -> righe documento', () => {
      expect(COLONNE_RIGA_LISTINO.righeDocumento).toEqual(['rigaAddebitoId'])
      expect(COLONNE_RIGA_LISTINO.marcatori).toEqual(['rigaAddebitoId'])
      expect(COLONNE_CODICE_IVA.righeDocumento).toEqual(['codiceIvaId'])
      expect(COLONNE_CODICE_IVA.marcatori).toEqual([])
    })

    it('una riga di listino citata da una riga di documento e da un marcatore: due citazioni sommate', async () => {
      const c = cliente()
      const usi = await contaUsiListino(c, T, ['x', 'y'], COLONNE_RIGA_LISTINO)
      expect(c.rigaDocumentoFattura.groupBy.mock.calls[0][0].by).toEqual(['rigaAddebitoId'])
      expect(c.marcatoreAddebitoFatturato.groupBy.mock.calls[0][0].by).toEqual(['rigaAddebitoId'])
      expect(usi.get('x')).toBe(3)
      expect(usi.get('y')).toBe(0)
    })

    it('1000 id: una query per colonna referente, mai una per id', async () => {
      const ids = Array.from(
        { length: 1000 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      )
      const c = cliente()
      await contaUsiListino(c, T, ids, COLONNE_RIGA_LISTINO)
      expect(c.rigaLegameMovimento.groupBy).toHaveBeenCalledTimes(1)
      expect(c.rigaDocumentoFattura.groupBy).toHaveBeenCalledTimes(1)
      expect(c.marcatoreAddebitoFatturato.groupBy).toHaveBeenCalledTimes(1)
      expect(c.rigaDocumentoFattura.groupBy.mock.calls[0][0].where.rigaAddebitoId.in).toHaveLength(
        1000
      )
    })
  })

  describe('documenti di fattura: testata (4.4b1, M4)', () => {
    it("l'elenco e' citato anche dalle testate dei documenti con elencoId; altrove nessuna colonna", () => {
      expect(COLONNE_ELENCO.documenti).toEqual(['elencoId'])
      for (const c of [
        COLONNE_ADDEBITO,
        COLONNE_CODICE_IVA,
        COLONNE_CODIFICA_ADDEBITO,
        COLONNE_RIGA_LISTINO,
      ]) {
        expect(c.documenti).toEqual([])
      }
    })

    const cliente = (documenti: number, legami: number) =>
      ({
        legameMovimento: {
          groupBy: jest.fn(async () =>
            legami ? [{ elencoId: 'x', _count: { _all: legami } }] : []
          ),
        },
        documentoFattura: {
          groupBy: jest.fn(async () =>
            documenti ? [{ elencoId: 'x', _count: { _all: documenti } }] : []
          ),
        },
      }) as any

    it('una query sulle testate dei documenti, sommata ai legami; daDocumenti separa la parte dei documenti', async () => {
      const c = cliente(2, 1)
      const usi = await contaUsiListinoPerOrigine(c, T, ['x', 'y'], COLONNE_ELENCO)
      expect(c.documentoFattura.groupBy).toHaveBeenCalledTimes(1)
      expect(c.documentoFattura.groupBy.mock.calls[0][0].where).toEqual({
        tenantId: T,
        elencoId: { in: ['x', 'y'] },
      })
      expect(usi.get('x')).toEqual({ totale: 3, daDocumenti: 2 })
      expect(usi.get('y')).toEqual({ totale: 0, daDocumenti: 0 })
      expect((await contaUsiListino(cliente(2, 1), T, ['x'], COLONNE_ELENCO)).get('x')).toBe(3)
    })

    it('citato solo da un legame: daDocumenti 0', async () => {
      const usi = await contaUsiListinoPerOrigine(cliente(0, 1), T, ['x'], COLONNE_ELENCO)
      expect(usi.get('x')).toEqual({ totale: 1, daDocumenti: 0 })
    })
  })
})
