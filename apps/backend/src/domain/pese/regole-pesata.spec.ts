import { ANNI_VERIFICAZIONE, validaPesataManuale, verificazioneScaduta } from './regole-pesata'

const ADESSO = new Date('2026-10-31T10:00:00Z')
const strumento = {
  portataMaxKg: 60000,
  divisioneKg: 20,
  dataUltimaVerificazione: '2026-01-15',
  attivo: true,
}
const valida = (o: Partial<Parameters<typeof validaPesataManuale>[0]> = {}) =>
  validaPesataManuale({ pesoKg: 12340, oraStrumento: null, adesso: ADESSO, strumento, ...o })

describe('validaPesataManuale', () => {
  it.each([0, -1, NaN, 100_000_000, 12.345])('peso %p → errore', pesoKg => {
    expect(valida({ pesoKg }).errori.length).toBeGreaterThan(0)
  })

  it('peso valido senza errori né avvisi', () => {
    expect(valida()).toEqual({ errori: [], avvisi: [] })
  })

  it('portata 60.000 e peso 60.000,01 → errore con "portata"', () => {
    const r = valida({ pesoKg: 60000.01 })
    expect(r.errori.some(e => e.includes('portata'))).toBe(true)
  })

  it('strumento non attivo → errore', () => {
    expect(valida({ strumento: { ...strumento, attivo: false } }).errori.length).toBe(1)
  })

  it('ora strumento adesso + 6 min → errore, + 4 min → ok', () => {
    expect(valida({ oraStrumento: new Date(ADESSO.getTime() + 6 * 60000) }).errori.length).toBe(1)
    expect(valida({ oraStrumento: new Date(ADESSO.getTime() + 4 * 60000) }).errori).toEqual([])
  })

  it('seconda pesata prima della prima → errore', () => {
    const r = valida({
      oraStrumento: new Date('2026-10-31T08:00:00Z'),
      oraPrimaPesata: new Date('2026-10-31T09:00:00Z'),
    })
    expect(r.errori.length).toBe(1)
  })

  it('divisione 20 e peso 12.345 → avviso, 12.340 → nessuno', () => {
    expect(valida({ pesoKg: 12345 }).avvisi.length).toBe(1)
    expect(valida({ pesoKg: 12340 }).avvisi).toEqual([])
  })

  it('divisione 0,5 e peso 12,25 → avviso (millesimi)', () => {
    const r = valida({ pesoKg: 12.25, strumento: { ...strumento, divisioneKg: 0.5 } })
    expect(r.avvisi.length).toBe(1)
  })

  it('peso 300 con divisione 20 (< 400) → avviso', () => {
    const r = valida({ pesoKg: 300 })
    expect(r.avvisi.some(a => a.includes('portata minima'))).toBe(true)
  })

  it('verificazione 2023-10-30 con oggi 2026-10-31 → scaduta, 2023-10-31 → non scaduta', () => {
    expect(ANNI_VERIFICAZIONE).toBe(3)
    expect(verificazioneScaduta('2023-10-30', '2026-10-31')).toBe(true)
    expect(verificazioneScaduta('2023-10-31', '2026-10-31')).toBe(false)
    const r = valida({ strumento: { ...strumento, dataUltimaVerificazione: '2023-10-30' } })
    expect(r.avvisi.some(a => a.includes('scaduta'))).toBe(true)
  })

  it('verificazione null → avviso "nessuna verificazione registrata"', () => {
    const r = valida({ strumento: { ...strumento, dataUltimaVerificazione: null } })
    expect(r.avvisi.some(a => /nessuna verificazione registrata/i.test(a))).toBe(true)
  })

  it('strumento esterno (null): nessun errore dagli strumenti', () => {
    expect(valida({ strumento: null })).toEqual({ errori: [], avvisi: [] })
  })
})
