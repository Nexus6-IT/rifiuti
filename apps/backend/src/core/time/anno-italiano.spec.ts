import {
  eGiornoDiCalendario,
  inizioGiornoItaliano,
  annoSolareItaliano,
  giornoItaliano,
  formattaDataItaliana,
  formattaDataOraItaliana,
} from './anno-italiano'

describe('tempo italiano', () => {
  let tzOriginale: string | undefined

  beforeAll(() => {
    tzOriginale = process.env.TZ
    process.env.TZ = 'UTC'
  })

  afterAll(() => {
    if (tzOriginale === undefined) delete process.env.TZ
    else process.env.TZ = tzOriginale
  })

  it.each([
    ['2025-12-31T22:59:59.999Z', 2025], // 23:59:59 del 31/12 in Italia
    ['2025-12-31T23:00:00.000Z', 2026], // mezzanotte del 1/1 in Italia
    ['2025-12-31T23:30:00.000Z', 2026],
    ['2026-07-01T10:00:00.000Z', 2026], // ora legale: nessun effetto a metà anno
    ['2026-12-31T22:59:59.999Z', 2026],
  ])('annoSolareItaliano(%s) = %i', (iso, anno) => {
    expect(annoSolareItaliano(new Date(iso))).toBe(anno)
  })

  it.each([
    ['2026-03-10T23:30:00.000Z', '2026-03-11'], // 00:30 dell'11/03, ora solare
    ['2026-07-10T22:30:00.000Z', '2026-07-11'], // 00:30 dell'11/07, ora legale
    ['2026-07-10T21:30:00.000Z', '2026-07-10'], // 23:30 del 10/07
    ['2026-03-11T00:00:00.000Z', '2026-03-11'], // data senza ora inviata dal frontend
  ])('giornoItaliano(%s) = %s', (iso, giorno) => {
    expect(giornoItaliano(new Date(iso))).toBe(giorno)
  })

  it('formattaDataItaliana', () => {
    expect(formattaDataItaliana(new Date('2026-03-05T00:00:00Z'))).toBe('05/03/2026')
  })

  it.each([
    ['2026-07-10T08:12:00Z', '10/07/2026 10:12'], // ora legale
    ['2026-01-10T23:30:00Z', '11/01/2026 00:30'], // ora solare, data che cambia
    ['2026-03-29T00:59:00Z', '29/03/2026 01:59'], // ultima domenica di marzo: un minuto prima del cambio
    ['2026-03-29T01:00:00Z', '29/03/2026 03:00'], // salta da 02:00 a 03:00
    ['2026-10-24T23:30:00Z', '25/10/2026 01:30'], // ultima domenica di ottobre, ancora ora legale
    ['2026-10-25T01:00:00Z', '25/10/2026 02:00'], // tornato all'ora solare
    ['2026-12-31T23:00:00Z', '01/01/2027 00:00'], // mezzanotte: 00 e non 24
  ])('formattaDataOraItaliana(%s) = %s', (iso, atteso) => {
    expect(formattaDataOraItaliana(new Date(iso))).toBe(atteso)
  })

  it.each([
    ['2026-01-15', '2026-01-14T23:00:00.000Z'], // ora solare
    ['2026-07-01', '2026-06-30T22:00:00.000Z'], // ora legale
    ['2026-03-29', '2026-03-28T23:00:00.000Z'], // giorno del passaggio all'ora legale: inizia in solare
    ['2026-03-30', '2026-03-29T22:00:00.000Z'],
    ['2026-10-25', '2026-10-24T22:00:00.000Z'], // giorno del ritorno all'ora solare: inizia in legale
    ['2026-10-26', '2026-10-25T23:00:00.000Z'],
  ])('inizioGiornoItaliano(%s) = %s', (giorno, atteso) => {
    expect(inizioGiornoItaliano(giorno).toISOString()).toBe(atteso)
  })

  it.each([
    ['2026-02-28', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-02-30', false],
    ['2026-13-01', false],
    ['2026-1-01', false],
    ['01/01/2026', false],
  ])('eGiornoDiCalendario(%s) = %s', (testo, atteso) => {
    expect(eGiornoDiCalendario(testo)).toBe(atteso)
  })
})
