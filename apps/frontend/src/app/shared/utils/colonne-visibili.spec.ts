import { colonneConDati } from './colonne-visibili'

interface Riga {
  nome: string | null
  piva?: string | null
  note?: unknown
  totale?: number | null
}

const colonne = {
  nome: (r: Riga) => r.nome,
  piva: (r: Riga) => r.piva,
  note: (r: Riga) => r.note,
  totale: (r: Riga) => r.totale,
}

describe('colonneConDati', () => {
  it("esclude una colonna che e' null, undefined, stringa vuota o solo spazi su tutte le righe", () => {
    const righe: Riga[] = [
      { nome: 'A', piva: null, note: '', totale: undefined as unknown as null },
      { nome: 'B', piva: '', note: '  ', totale: null },
    ]
    const visibili = colonneConDati(righe, colonne)
    expect(visibili.has('nome')).toBeTrue()
    expect(visibili.has('piva')).toBeFalse()
    expect(visibili.has('note')).toBeFalse()
    expect(visibili.has('totale')).toBeFalse()
  })

  it('include la colonna se una sola riga ha un valore', () => {
    const righe: Riga[] = [
      { nome: 'A', piva: null },
      { nome: 'B', piva: '01234567890' },
    ]
    expect(colonneConDati(righe, colonne).has('piva')).toBeTrue()
  })

  it('considera valorizzati lo zero e false: sono dati, non assenze', () => {
    const righe: Riga[] = [{ nome: 'A', totale: 0, note: false }]
    const visibili = colonneConDati(righe, colonne)
    expect(visibili.has('totale')).toBeTrue()
    expect(visibili.has('note')).toBeTrue()
  })

  it("con zero righe restituisce l'insieme vuoto", () => {
    expect(colonneConDati([], colonne).size).toBe(0)
  })
})
