import { LOTTO_MASSIMO_RENTRI, selezionaLotto, type CandidataLotto } from './selezione-lotto-rentri'

function c(
  id: string,
  anno: number,
  progressivo: number,
  extra: Partial<CandidataLotto> = {}
): CandidataLotto {
  return {
    movimentoId: id,
    numero: { anno, progressivo },
    predecessoreId: null,
    statoPredecessore: null,
    ...extra,
  }
}

describe('selezionaLotto', () => {
  it('ordina per (anno, progressivo) anche fra due anni', () => {
    const r = selezionaLotto([c('c', 2026, 1), c('a', 2025, 9), c('b', 2025, 10)], 100)
    expect(r.lotto).toEqual(['a', 'b', 'c'])
    expect(r.inAttesa).toEqual([])
  })

  it('rettifica col predecessore TRASMESSA entra', () => {
    const r = selezionaLotto(
      [c('r', 2026, 5, { predecessoreId: 'o', statoPredecessore: 'TRASMESSA' })],
      100
    )
    expect(r.lotto).toEqual(['r'])
  })

  it('rettifica col predecessore nello stesso lotto o DA_TRASMETTERE resta in attesa', () => {
    const r = selezionaLotto(
      [
        c('o', 2026, 1),
        c('r1', 2026, 2, { predecessoreId: 'o', statoPredecessore: 'DA_TRASMETTERE' }),
        c('r2', 2026, 3, { predecessoreId: 'x', statoPredecessore: 'NON_TRASMESSA' }),
        c('r3', 2026, 4, { predecessoreId: 'y', statoPredecessore: 'INCERTA' }),
        c('r4', 2026, 5, { predecessoreId: 'z', statoPredecessore: null }),
      ],
      100
    )
    expect(r.lotto).toEqual(['o'])
    expect(r.inAttesa).toEqual(['r1', 'r2', 'r3', 'r4'])
  })

  it('predecessore GIA_SU_RENTRI vale come trasmesso', () => {
    const r = selezionaLotto(
      [c('r', 2026, 5, { predecessoreId: 'o', statoPredecessore: 'GIA_SU_RENTRI' })],
      100
    )
    expect(r.lotto).toEqual(['r'])
  })

  it('limite a 100: i primi 100 in ordine, gli altri restano DA_TRASMETTERE (né lotto né inAttesa)', () => {
    expect(LOTTO_MASSIMO_RENTRI).toBe(100)
    const tutte = Array.from({ length: 150 }, (_, i) => c(`m${i + 1}`, 2026, 150 - i))
    const r = selezionaLotto(tutte, LOTTO_MASSIMO_RENTRI)
    expect(r.lotto).toHaveLength(100)
    expect(r.lotto[0]).toBe('m150')
    expect(r.inAttesa).toEqual([])
  })

  it('una correzione in attesa si segnala anche a lotto pieno', () => {
    const r = selezionaLotto(
      [
        c('a', 2026, 1),
        c('r', 2026, 2, { predecessoreId: 'a', statoPredecessore: 'DA_TRASMETTERE' }),
      ],
      1
    )
    expect(r).toEqual({ lotto: ['a'], inAttesa: ['r'] })
  })

  it('massimo non valido: errore', () => {
    expect(() => selezionaLotto([], 0)).toThrow(RangeError)
    expect(() => selezionaLotto([], 1.5)).toThrow(RangeError)
  })

  it("non modifica l'input", () => {
    const input = [c('b', 2026, 2), c('a', 2026, 1)]
    selezionaLotto(input, 100)
    expect(input.map(x => x.movimentoId)).toEqual(['b', 'a'])
  })
})
