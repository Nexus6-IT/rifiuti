import { arrotonda6, decodificaDecimaleSql, decodificaNumeroIt } from './numero-it'

// docs/schema-db-winwaste.md §1: pesi, prezzi e quantita' sono `varchar`; formato it-IT.
describe('decodificaNumeroIt', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['0,001', 0.001],
    ['-12,5', -12.5],
    ['1000', 1000],
    ['-7', -7],
    ['  12,5 ', 12.5],
    ['1.234.567,89', 1234567.89],
    ['0', 0],
    ['-0', 0],
    ['-0,0', 0],
  ])('%s -> %s', (testo, atteso) => {
    expect(decodificaNumeroIt(testo)).toEqual({ ok: true, valore: atteso })
    const r = decodificaNumeroIt(testo)
    expect(r.ok && Object.is(r.valore, -0)).toBe(false)
  })

  it.each([[''], [null], ['   ']])('vuoto (%p) = nessun valore', v => {
    expect(decodificaNumeroIt(v)).toEqual({ ok: true, valore: null })
  })

  it.each([
    ['1,234.56', 'formato anglosassone'],
    ['1.234', 'ambiguo: migliaia o decimali'],
    ['1.234.567', 'ambiguo senza virgola'],
    ['12.5', 'punto decimale'],
    [',5', 'senza parte intera'],
    ['5,', 'senza decimali'],
    ['1,2,3', 'due virgole'],
    ['12a', 'lettere'],
    ['+5', 'segno piu'],
    ['1.23,4', 'migliaia malformate'],
  ])('scarta %s (%s)', testo => {
    expect(decodificaNumeroIt(testo)).toMatchObject({ ok: false, codice: 'NUMERO_IT' })
  })
})

describe('decodificaDecimaleSql', () => {
  it.each([
    ['1000.000000', 1000],
    ['-2.5', -2.5],
    ['7', 7],
    ['0.000000', 0],
  ])('%s', (t, atteso) => {
    expect(decodificaDecimaleSql(t)).toEqual({ ok: true, valore: atteso })
  })
  it.each([[''], [null]])('vuoto (%p)', v => {
    expect(decodificaDecimaleSql(v)).toEqual({ ok: true, valore: null })
  })
  it.each([['1,5'], ['1.2.3'], ['abc']])('scarta %s', t => {
    expect(decodificaDecimaleSql(t)).toMatchObject({ ok: false, codice: 'DECIMALE_SQL' })
  })
})

describe('arrotonda6', () => {
  it('toglie il rumore dei decimali', () => {
    expect(arrotonda6(0.1 + 0.2)).toBe(0.3)
  })
})
