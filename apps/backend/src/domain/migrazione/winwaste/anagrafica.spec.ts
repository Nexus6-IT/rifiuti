import {
  dataAutorizzazione,
  decodificaIndirizzo,
  decodificaTaraKg,
  esRimorchio,
  normalizzaTarga,
  separaSoggettoUnita,
} from './anagrafica'

describe('anagrafica WinWaste: indirizzo', () => {
  it('accetta un indirizzo completo e normalizza provincia e CAP', () => {
    const r = decodificaIndirizzo({
      via: ' VIA ROMA ',
      civico: '12',
      cap: '80100',
      comune: 'NAPOLI',
      provincia: 'na',
    })
    expect(r).toEqual({
      ok: true,
      valore: { via: 'VIA ROMA', civico: '12', cap: '80100', comune: 'NAPOLI', provincia: 'NA' },
    })
  })
  it('civico mancante: SNC (senza numero civico), mai inventato altro', () => {
    const r = decodificaIndirizzo({
      via: 'VIA ROMA',
      civico: '  ',
      cap: '80100',
      comune: 'NAPOLI',
      provincia: 'NA',
    })
    expect(r.ok && r.valore.civico).toBe('SNC')
  })
  it.each([
    [{ via: '', civico: '1', cap: '80100', comune: 'X', provincia: 'NA' }],
    [{ via: 'V', civico: '1', cap: '801', comune: 'X', provincia: 'NA' }],
    [{ via: 'V', civico: '1', cap: '80100', comune: '', provincia: 'NA' }],
    [{ via: 'V', civico: '1', cap: '80100', comune: 'X', provincia: 'N' }],
    [{ via: 'V', civico: '1', cap: '80100', comune: 'X', provincia: null }],
  ])('rifiuta un indirizzo incompleto %#', c => {
    const r = decodificaIndirizzo(c)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.codice).toBe('INDIRIZZO_INCOMPLETO')
  })
})

describe('anagrafica WinWaste: targa e tara', () => {
  it('toglie spazi, trattini e punti e passa in maiuscolo', () => {
    expect(normalizzaTarga('ab 123-cd')).toBe('AB123CD')
    expect(normalizzaTarga(null)).toBeNull()
    expect(normalizzaTarga('A')).toBeNull()
    expect(normalizzaTarga('AB1234567890123456')).toBeNull()
    expect(normalizzaTarga('AB*123')).toBeNull()
  })
  it('tara in kg interi positivi, altrimenti nulla', () => {
    expect(decodificaTaraKg('7500')).toBe(7500)
    expect(decodificaTaraKg('7.500')).toBe(7500)
    expect(decodificaTaraKg('0')).toBeNull()
    expect(decodificaTaraKg('')).toBeNull()
    expect(decodificaTaraKg('abc')).toBeNull()
  })
  it('RIMORCHIO: vuoto, 0 e N = motrice; altro = rimorchio', () => {
    expect(esRimorchio(null)).toBe(false)
    expect(esRimorchio(' ')).toBe(false)
    expect(esRimorchio('0')).toBe(false)
    expect(esRimorchio('n')).toBe(false)
    expect(esRimorchio('S')).toBe(true)
    expect(esRimorchio('1')).toBe(true)
  })
})

describe('anagrafica WinWaste: date e riferimenti', () => {
  it.each([
    ['31-12-2027', '2027-12-31'],
    ['31/12/2027', '2027-12-31'],
    ['20271231', '2027-12-31'],
    ['2027-12-31', '2027-12-31'],
    ['  ', null],
    ['31-02-2027', null],
    ['boh', null],
    [null, null],
  ])('data %j -> %j', (v, atteso) => {
    expect(dataAutorizzazione(v)).toBe(atteso)
  })
  it('soggetto.unita in 11 caratteri, o solo soggetto', () => {
    expect(separaSoggettoUnita('000123.0002')).toEqual({ soggetto: '000123', unita: '0002' })
    expect(separaSoggettoUnita('000123')).toEqual({ soggetto: '000123', unita: null })
    expect(separaSoggettoUnita('C000123')).toEqual({
      soggetto: '000123',
      unita: null,
      precod: 'C',
    })
    expect(separaSoggettoUnita('')).toBeNull()
    expect(separaSoggettoUnita('0')).toBeNull()
    expect(separaSoggettoUnita('a.b.c')).toBeNull()
  })
})
