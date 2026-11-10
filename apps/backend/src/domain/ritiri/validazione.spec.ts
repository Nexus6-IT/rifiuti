import { validaRitiro, giornoValido } from './validazione'

const base = { dataPrevista: '2026-11-12', quantitaPresunta: 10 }

describe('validaRitiro', () => {
  it('accetta un ritiro programmato valido', () => {
    expect(validaRitiro(base)).toEqual([])
  })

  it.each([0, -1, NaN, Infinity, 100_000_000, 1.005])('rifiuta la quantità %s', q => {
    expect(validaRitiro({ ...base, quantitaPresunta: q })).toEqual(['QUANTITA_NON_VALIDA'])
  })

  it('accetta due decimali e il massimo della colonna', () => {
    expect(validaRitiro({ ...base, quantitaPresunta: 0.01 })).toEqual([])
    expect(validaRitiro({ ...base, quantitaPresunta: 99_999_999.99 })).toEqual([])
    expect(validaRitiro({ ...base, quantitaPresunta: 12.35 })).toEqual([])
  })

  it.each([0, -3, 1.5, 32768])("rifiuta l'ordine nel giro %s", o => {
    expect(validaRitiro({ ...base, ordineGiro: o })).toEqual(['ORDINE_GIRO_NON_VALIDO'])
  })

  it("l'ordine nel giro è facoltativo", () => {
    expect(validaRitiro({ ...base, ordineGiro: null })).toEqual([])
    expect(validaRitiro({ ...base, ordineGiro: 1 })).toEqual([])
  })

  it('NON_ESEGUITO e ANNULLATO vogliono il motivo', () => {
    expect(validaRitiro({ ...base, stato: 'NON_ESEGUITO' })).toEqual(['MOTIVO_OBBLIGATORIO'])
    expect(validaRitiro({ ...base, stato: 'ANNULLATO', motivo: '   ' })).toEqual([
      'MOTIVO_OBBLIGATORIO',
    ])
    expect(validaRitiro({ ...base, stato: 'ANNULLATO', motivo: 'cliente chiuso' })).toEqual([])
  })

  it('PROGRAMMATO non ammette il motivo', () => {
    expect(validaRitiro({ ...base, motivo: 'x' })).toEqual(['MOTIVO_NON_AMMESSO'])
  })

  it('il motivo ha al massimo 500 caratteri', () => {
    expect(validaRitiro({ ...base, stato: 'ANNULLATO', motivo: 'a'.repeat(501) })).toEqual([
      'MOTIVO_TROPPO_LUNGO',
    ])
    expect(validaRitiro({ ...base, stato: 'ANNULLATO', motivo: 'a'.repeat(500) })).toEqual([])
  })

  it('rifiuta data, fascia e stato non validi e li riporta insieme', () => {
    const r = validaRitiro({
      dataPrevista: '2026-02-30',
      quantitaPresunta: 1,
      fascia: 'SERA' as never,
      stato: 'BOH' as never,
    })
    expect(r).toEqual(['DATA_NON_VALIDA', 'FASCIA_NON_VALIDA', 'STATO_NON_VALIDO'])
  })
})

describe('giornoValido', () => {
  it('controlla calendario e formato', () => {
    expect(giornoValido('2028-02-29')).toBe(true)
    expect(giornoValido('2027-02-29')).toBe(false)
    expect(giornoValido('2026-13-01')).toBe(false)
    expect(giornoValido('2026-1-1')).toBe(false)
    expect(giornoValido('12/11/2026')).toBe(false)
  })
})
