import { oltreTermineDifferita, tipoDocumento } from './tipo-documento'

describe('tipoDocumento', () => {
  it('solo FISSO: TD01', () =>
    expect(tipoDocumento([{ tipoRiga: 'FISSO' }, { tipoRiga: 'BOLLO' }])).toBe('TD01'))
  it('FISSO e MOVIMENTO: TD24', () =>
    expect(tipoDocumento([{ tipoRiga: 'FISSO' }, { tipoRiga: 'MOVIMENTO' }])).toBe('TD24'))
  it('FASCIA_SPECIALE: TD24', () =>
    expect(tipoDocumento([{ tipoRiga: 'FASCIA_SPECIALE' }])).toBe('TD24'))
})

describe('oltreTermineDifferita', () => {
  it('oltre il 15 del mese dopo', () => {
    expect(oltreTermineDifferita('2026-11-16', '2026-10-31')).toBe(true)
    expect(oltreTermineDifferita('2026-11-15', '2026-10-31')).toBe(false)
  })
  it('dicembre passa all anno dopo', () => {
    expect(oltreTermineDifferita('2027-01-16', '2026-12-31')).toBe(true)
    expect(oltreTermineDifferita('2027-01-15', '2026-12-31')).toBe(false)
  })
})
