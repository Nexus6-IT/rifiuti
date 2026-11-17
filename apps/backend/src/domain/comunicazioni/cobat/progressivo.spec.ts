import { assegnaProgressiviCobat, progressivoCobat } from './progressivo'

describe('progressivoCobat (D9, Q1)', () => {
  it('nel 2026 funziona (la formula di WinWaste si ferma al 2025: ERRORE 245)', () => {
    expect(progressivoCobat(1, 2026)).toBe('000001')
    expect(progressivoCobat(123, 2027)).toBe('000123')
  })
  it('e unico oltre 100 000 movimenti (WinWaste: Debugger.Break inerte)', () => {
    expect(progressivoCobat(100_001, 2026)).toBe('100001')
  })
  it('oltre 999 999 -> errore', () => {
    expect(progressivoCobat(999_999, 2026)).toBe('999999')
    expect(() => progressivoCobat(1_000_000, 2026)).toThrow(/999999/)
  })
  it('valori non validi -> errore', () => {
    expect(() => progressivoCobat(0, 2026)).toThrow()
    expect(() => progressivoCobat(1.5, 2026)).toThrow()
    expect(() => progressivoCobat(1, 2009)).toThrow()
  })
})

describe('assegnaProgressiviCobat', () => {
  it('un solo registro e anno: il progressivo e quello del registro', () => {
    const r = assegnaProgressiviCobat([
      { registroId: 'R1', progressivoRegistro: 7, anno: 2026 },
      { registroId: 'R1', progressivoRegistro: 9, anno: 2026 },
    ])
    expect(r).toEqual(['000007', '000009'])
  })
  it('due registri della stessa sede: 1..n nell ordine del file', () => {
    const r = assegnaProgressiviCobat([
      { registroId: 'R1', progressivoRegistro: 7, anno: 2026 },
      { registroId: 'R2', progressivoRegistro: 7, anno: 2026 },
      { registroId: 'R1', progressivoRegistro: 9, anno: 2026 },
    ])
    expect(r).toEqual(['000001', '000002', '000003'])
  })
  it('due anni: 1..n', () => {
    const r = assegnaProgressiviCobat([
      { registroId: 'R1', progressivoRegistro: 400, anno: 2025 },
      { registroId: 'R1', progressivoRegistro: 1, anno: 2026 },
    ])
    expect(r).toEqual(['000001', '000002'])
  })
  it('nessun movimento: lista vuota', () => {
    expect(assegnaProgressiviCobat([])).toEqual([])
  })
})
