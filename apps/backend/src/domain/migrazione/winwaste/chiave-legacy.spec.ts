import {
  ChiaveLegacyNonValidaError,
  chiaveLegacyWinwaste,
  PATTERN_CHIAVE_LEGACY,
  TabellaConChiave,
} from './chiave-legacy'

describe('chiaveLegacyWinwaste', () => {
  it('ditta|anno|TABELLA|COD', () => {
    expect(chiaveLegacyWinwaste('0001', 2026, 'MOVIMENTI', 12345)).toBe('0001|2026|MOVIMENTI|12345')
    expect(chiaveLegacyWinwaste('0001', 2026, 'FORMULARI', 1)).toBe('0001|2026|FORMULARI|1')
  })

  it('la chiave prodotta rispetta il pattern D1', () => {
    expect(PATTERN_CHIAVE_LEGACY.test(chiaveLegacyWinwaste('0007', 1990, 'MOVIMENTI', 9))).toBe(
      true
    )
    expect(PATTERN_CHIAVE_LEGACY.test('0001|2026')).toBe(false)
    expect(PATTERN_CHIAVE_LEGACY.test('001|2026|MOVIMENTI|1')).toBe(false)
  })

  it.each([
    ['ditta di 3 cifre', '001', 2026, 'MOVIMENTI', 1],
    ['ditta con lettere', '00A1', 2026, 'MOVIMENTI', 1],
    ['anno troppo basso', '0001', 1989, 'MOVIMENTI', 1],
    ['anno troppo alto', '0001', 2101, 'MOVIMENTI', 1],
    ['anno non intero', '0001', 2026.5, 'MOVIMENTI', 1],
    ['COD zero', '0001', 2026, 'MOVIMENTI', 0],
    ['COD negativo', '0001', 2026, 'MOVIMENTI', -4],
    ['COD non intero', '0001', 2026, 'MOVIMENTI', 1.5],
    ['tabella fuori elenco', '0001', 2026, 'RITIRI', 1],
  ])('errore tipato: %s', (_nome, ditta, anno, tabella, cod) => {
    expect(() => chiaveLegacyWinwaste(ditta, anno, tabella as TabellaConChiave, cod)).toThrow(
      ChiaveLegacyNonValidaError
    )
  })
})
