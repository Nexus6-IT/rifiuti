import { normalizzaTesto } from './normalizza-testo'

describe('normalizzaTesto', () => {
  it('traslittera virgolette, lineette ed euro; le vocali accentate italiane restano', () => {
    expect(normalizzaTesto('Società “Rossi” – 10 €', 80)).toBe('Società "Rossi" - 10 EUR')
  })

  it('Łódź diventa Lódz: ó e Latin-1 e resta', () => {
    expect(normalizzaTesto('Łódź', 80)).toBe('Lódz')
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

  it('le lettere Latin-1 restano, anche non italiane', () => {
    expect(normalizzaTesto('Müller Ångström ß Æ François Ñ', 80)).toBe(
      'Müller Ångström ß Æ François Ñ'
    )
    expect(normalizzaTesto('Řeka Šárka', 80)).toBe('Reka Sárka')
  })

  it('conserva i simboli Latin-1 ammessi', () => {
    expect(normalizzaTesto('5° n. 3 ± 2 £', 80)).toBe('5° n. 3 ± 2 £')
  })

  it('toglie il trattino morbido', () => {
    expect(normalizzaTesto('ab\u00adcd', 80)).toBe('abcd')
  })
})

describe('normalizzaTesto, insieme BASIC (campi String*Type)', () => {
  const b = (s: string, max = 80) => normalizzaTesto(s, max, 'BASIC')

  it('trascrive gradi, apici e accenti', () => {
    expect(b('Det. n° 45')).toBe('Det. n. 45')
    expect(b('m³')).toBe('m3')
    expect(b('1/2026-à')).toBe('1/2026-a')
    expect(b('RM-123°')).toBe('RM-123.')
    expect(b('Müller ß Æ')).toBe('Muller ss AE')
  })

  it('il risultato e solo Basic Latin', () => {
    const r = b('àèéìòù ÀÈ ç ñ ° ² ± £ € « » 😀 世 Łódź')
    expect(r).toMatch(/^[\x20-\x7e]*$/)
  })
})
