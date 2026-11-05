import { normalizzaTesto } from './normalizza-testo'

describe('normalizzaTesto', () => {
  it('traslittera virgolette, lineette ed euro; le vocali accentate italiane restano', () => {
    expect(normalizzaTesto('Società “Rossi” – 10 €', 80)).toBe('Società "Rossi" - 10 EUR')
  })

  it('Łódź diventa Lodz', () => {
    expect(normalizzaTesto('Łódź', 80)).toBe('Lodz')
  })

  it('tronca alla lunghezza massima', () => {
    expect(normalizzaTesto('a'.repeat(90), 80)).toHaveLength(80)
  })

  it('toglie emoji e caratteri CJK', () => {
    expect(normalizzaTesto('Ciao 😀 世界 mondo', 80)).toBe('Ciao mondo')
  })

  it('riduce gli spazi multipli, i ritorni a capo e i caratteri di controllo', () => {
    expect(normalizzaTesto('  a \n\t b\u0000  c  ', 80)).toBe('a b c')
  })

  it('apostrofi tipografici e puntini', () => {
    expect(normalizzaTesto('l’altro… ‘x’', 80)).toBe("l'altro... 'x'")
  })

  it('il troncamento non lascia uno spazio in coda', () => {
    expect(normalizzaTesto('abcd efgh', 5)).toBe('abcd')
  })

  it('lettere accentate non italiane diventano la lettera base', () => {
    expect(normalizzaTesto('Müller Ångström ß Æ', 80)).toBe('Muller Angstrom ss AE')
  })

  it('conserva i simboli Latin-1 ammessi', () => {
    expect(normalizzaTesto('5° n. 3 ± 2 £', 80)).toBe('5° n. 3 ± 2 £')
  })
})
