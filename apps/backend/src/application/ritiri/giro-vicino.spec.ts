import { dataNellaFinestraGiro } from './giro-vicino'

describe('dataNellaFinestraGiro (oggi e domani, ora di Roma)', () => {
  const adesso = new Date('2026-12-01T10:00:00.000Z') // 11:00 a Roma

  it('oggi e domani si, ieri e dopodomani no', () => {
    expect(dataNellaFinestraGiro('2026-12-01', adesso)).toBe(true)
    expect(dataNellaFinestraGiro('2026-12-02', adesso)).toBe(true)
    expect(dataNellaFinestraGiro('2026-11-30', adesso)).toBe(false)
    expect(dataNellaFinestraGiro('2026-12-03', adesso)).toBe(false)
    expect(dataNellaFinestraGiro('2027-01-15', adesso)).toBe(false)
  })

  it('usa la data di Roma, non quella UTC (23:30 UTC = 00:30 del giorno dopo a Roma)', () => {
    const tardi = new Date('2026-12-01T23:30:00.000Z')
    expect(dataNellaFinestraGiro('2026-12-01', tardi)).toBe(false)
    expect(dataNellaFinestraGiro('2026-12-02', tardi)).toBe(true)
    expect(dataNellaFinestraGiro('2026-12-03', tardi)).toBe(true)
  })

  it('cambio mese e anno', () => {
    expect(dataNellaFinestraGiro('2027-01-01', new Date('2026-12-31T10:00:00Z'))).toBe(true)
    expect(dataNellaFinestraGiro('2026-03-01', new Date('2026-02-28T10:00:00Z'))).toBe(true)
  })

  it('data malformata: false, mai un errore', () => {
    expect(dataNellaFinestraGiro('domani', adesso)).toBe(false)
    expect(dataNellaFinestraGiro('', adesso)).toBe(false)
  })
})
