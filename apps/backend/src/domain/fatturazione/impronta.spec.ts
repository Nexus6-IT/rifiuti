import { improntaElaborazione } from './impronta'

const base = () => ({
  parametri: { dal: '2026-11-01', al: '2026-11-30', raggruppamento: 'PER_CONTRATTO' },
  legami: [
    { id: 'L1', versione: 1 },
    { id: 'L2', versione: 3 },
  ],
  contratti: [{ id: 'C1', versione: 2 }],
  elenchi: [{ id: 'E1', versione: 1 }],
  righeAddebito: [{ id: 'R1', versione: 1 }],
  codiciIva: [{ id: 'I1', versione: 1 }],
})

describe('improntaElaborazione', () => {
  it('sha256 esadecimale di 64 caratteri', () => {
    expect(improntaElaborazione(base())).toMatch(/^[0-9a-f]{64}$/)
  })
  it('ordine degli id diverso: stessa impronta', () => {
    const b = base()
    expect(improntaElaborazione({ ...b, legami: [...b.legami].reverse() })).toBe(
      improntaElaborazione(b)
    )
  })
  it('una versione cambiata: impronta diversa', () => {
    const b = base()
    const x = { ...b, legami: [{ id: 'L1', versione: 2 }, b.legami[1]] }
    expect(improntaElaborazione(x)).not.toBe(improntaElaborazione(b))
  })
  it('parametri con chiavi in ordine diverso (anche annidati): stessa impronta', () => {
    const b = base()
    const x = {
      ...b,
      parametri: { raggruppamento: 'PER_CONTRATTO', al: '2026-11-30', dal: '2026-11-01' },
    }
    expect(improntaElaborazione(x)).toBe(improntaElaborazione(b))
    expect(improntaElaborazione({ ...b, parametri: { a: { x: 1, y: 2 }, b: [1, 2] } })).toBe(
      improntaElaborazione({ ...b, parametri: { b: [1, 2], a: { y: 2, x: 1 } } })
    )
  })
  it('un parametro cambiato: impronta diversa', () => {
    const b = base()
    expect(
      improntaElaborazione({ ...b, parametri: { ...b.parametri, al: '2026-11-29' } })
    ).not.toBe(improntaElaborazione(b))
  })
  it('stesso id con tipo diverso (legame e contratto): impronta diversa', () => {
    const vuoto = {
      parametri: {},
      legami: [],
      contratti: [],
      elenchi: [],
      righeAddebito: [],
      codiciIva: [],
    }
    const comeLegame = improntaElaborazione({ ...vuoto, legami: [{ id: 'X', versione: 1 }] })
    const comeContratto = improntaElaborazione({ ...vuoto, contratti: [{ id: 'X', versione: 1 }] })
    expect(comeLegame).not.toBe(comeContratto)
  })
})
