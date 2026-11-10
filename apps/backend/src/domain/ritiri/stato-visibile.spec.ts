import { statoVisibile, type StatoFirDb } from './stato-visibile'

describe('statoVisibile', () => {
  it('ANNULLATO e NON_ESEGUITO vengono dalla colonna, qualunque sia il FIR', () => {
    expect(statoVisibile('ANNULLATO', null)).toBe('ANNULLATO')
    expect(statoVisibile('ANNULLATO', 'COMPLETED')).toBe('ANNULLATO')
    expect(statoVisibile('NON_ESEGUITO', null)).toBe('NON_ESEGUITO')
    expect(statoVisibile('NON_ESEGUITO', 'DRAFT')).toBe('NON_ESEGUITO')
  })

  it('senza FIR attivo è DA_GENERARE', () => {
    expect(statoVisibile('PROGRAMMATO', null)).toBe('DA_GENERARE')
    expect(statoVisibile('PROGRAMMATO', undefined)).toBe('DA_GENERARE')
  })

  it.each<[StatoFirDb, string]>([
    ['DRAFT', 'FIR_BOZZA'],
    ['AWAITING_PRODUCER', 'FIR_BOZZA'],
    ['AWAITING_CARRIER', 'FIR_EMESSO'],
    ['AWAITING_RECEIVER', 'IN_TRASPORTO'],
    ['COMPLETED', 'CONSEGNATO'],
    ['SYNCED_TO_RENTRI', 'CONSEGNATO'],
    ['CANCELLED', 'DA_GENERARE'],
  ])('FIR %s → %s', (fir, atteso) => {
    expect(statoVisibile('PROGRAMMATO', fir)).toBe(atteso)
  })

  it('uno stato FIR sconosciuto è un errore, non un valore inventato', () => {
    expect(() => statoVisibile('PROGRAMMATO', 'NUOVO' as StatoFirDb)).toThrow(/sconosciuto/)
  })
})
