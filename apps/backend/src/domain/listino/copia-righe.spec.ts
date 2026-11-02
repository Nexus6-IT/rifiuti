import { scegliRigheDaCopiare, cifreCondizioni, type RigaCopiabile } from './copia-righe'

const riga = (o: Partial<RigaCopiabile> & { tipo: string }): RigaCopiabile => ({
  cerCode: null,
  addebitoId: 'a1',
  riferimento: null,
  unitaMisura: 'KG',
  condizione: null,
  condizioniRiferite: null,
  applicaA: null,
  ...o,
})

describe('scegliRigheDaCopiare (D18, R45)', () => {
  it('esclude i minimi, gli acconti e i conguagli e li conta', () => {
    const r = scegliRigheDaCopiare(
      [
        riga({ tipo: 'V', addebitoId: 'v1' }),
        riga({ tipo: 'MW', addebitoId: 'm1' }),
        riga({ tipo: 'M001', addebitoId: 'm2' }),
        riga({ tipo: '$A', addebitoId: 'd1' }),
        riga({ tipo: '$D', addebitoId: 'd2' }),
        riga({ tipo: 'V', addebitoId: 'v2', applicaA: 'CONGUAGLIO_365' }),
        // un minimo con il conguaglio conta solo come minimo
        riga({ tipo: 'MF', addebitoId: 'm3', applicaA: 'CONGUAGLIO_365' }),
      ],
      []
    )
    expect(r.scelte.map(s => s.addebitoId)).toEqual(['v1'])
    expect(r.escluse).toEqual({ minimi: 3, acconti: 2, conguagli: 1, duplicate: 0, condizioni: 0 })
  })

  it('salta i duplicati rispetto alle righe esistenti e fra le scelte', () => {
    const r = scegliRigheDaCopiare(
      [
        riga({ tipo: 'V', addebitoId: 'v1', riferimento: 'X' }),
        riga({ tipo: 'V', addebitoId: 'v1', riferimento: 'X' }),
        riga({ tipo: 'V', addebitoId: 'v2' }),
        riga({ tipo: 'CER', addebitoId: null, cerCode: '20 03 01' }),
      ],
      [riga({ tipo: 'V', addebitoId: 'v2' })]
    )
    expect(r.scelte).toHaveLength(2)
    expect(r.escluse.duplicate).toBe(2)
  })

  it('il riferimento vuoto e null coincidono', () => {
    const r = scegliRigheDaCopiare(
      [riga({ tipo: 'V', addebitoId: 'v1', riferimento: '' })],
      [riga({ tipo: 'V', addebitoId: 'v1', riferimento: null })]
    )
    expect(r.escluse.duplicate).toBe(1)
  })

  it('una riga con condizioni riferite entra se i condizionati ci sono, anche se vengono dopo', () => {
    const r = scegliRigheDaCopiare(
      [
        riga({ tipo: 'V', addebitoId: 'somma', condizioniRiferite: '12S' }),
        riga({ tipo: 'V', addebitoId: 'c1', condizione: 1 }),
        riga({ tipo: 'V', addebitoId: 'c2', condizione: 2 }),
      ],
      []
    )
    expect(r.scelte).toHaveLength(3)
    expect(r.escluse.condizioni).toBe(0)
  })

  it('senza condizionati con la stessa unità di misura la riga è esclusa e contata', () => {
    const r = scegliRigheDaCopiare(
      [
        riga({ tipo: 'V', addebitoId: 'somma', condizioniRiferite: '1S', unitaMisura: 'KG' }),
        riga({ tipo: 'V', addebitoId: 'c1', condizione: 1, unitaMisura: 'LT' }),
      ],
      []
    )
    expect(r.scelte.map(s => s.addebitoId)).toEqual(['c1'])
    expect(r.escluse.condizioni).toBe(1)
  })

  it('una cifra già sommata da un’altra riga dell’elenco di arrivo esclude la riga (I1 della review 21)', () => {
    const r = scegliRigheDaCopiare(
      [
        riga({ tipo: 'V', addebitoId: 'nuova', condizioniRiferite: '23S' }),
        riga({ tipo: 'V', addebitoId: 'c2', condizione: 2 }),
        riga({ tipo: 'V', addebitoId: 'c3', condizione: 3 }),
      ],
      [riga({ tipo: 'V', addebitoId: 'vecchia', condizioniRiferite: '12S' })]
    )
    expect(r.scelte.map(s => s.addebitoId)).toEqual(['c2', 'c3'])
    expect(r.escluse.condizioni).toBe(1)
  })

  it('due righe scelte che sommano la stessa cifra: entra solo la prima', () => {
    const r = scegliRigheDaCopiare(
      [
        riga({ tipo: 'V', addebitoId: 's1', condizioniRiferite: '1S' }),
        riga({ tipo: 'V', addebitoId: 's2', condizioniRiferite: '1S' }),
        riga({ tipo: 'V', addebitoId: 'c1', condizione: 1 }),
      ],
      []
    )
    expect(r.scelte.map(s => s.addebitoId).sort()).toEqual(['c1', 's1'])
    expect(r.escluse.condizioni).toBe(1)
  })

  it('un condizionato già nell’elenco di arrivo basta', () => {
    const r = scegliRigheDaCopiare(
      [riga({ tipo: 'V', addebitoId: 's1', condizioniRiferite: '4S' })],
      [riga({ tipo: 'V', addebitoId: 'c4', condizione: 4 })]
    )
    expect(r.scelte).toHaveLength(1)
  })
})

describe('cifreCondizioni', () => {
  it('toglie l’ultimo carattere e restituisce le cifre', () => {
    expect(cifreCondizioni('123S')).toEqual([1, 2, 3])
    expect(cifreCondizioni(null)).toEqual([])
  })
})
