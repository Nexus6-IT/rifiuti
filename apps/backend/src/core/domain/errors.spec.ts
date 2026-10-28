import {
  FirGiaRegistratoError,
  FirGiaRegistratoInAltroRegistroError,
  INDICAZIONE_FIR_ANNULLATO,
} from './errors'

describe('FIR gia registrato dopo un annullamento', () => {
  it('annullato: stessa indicazione nei due messaggi', () => {
    expect(new FirGiaRegistratoError(3, 2026, undefined, 'annullato').message).toContain(
      INDICAZIONE_FIR_ANNULLATO
    )
    expect(
      new FirGiaRegistratoInAltroRegistroError(3, 2026, undefined, 'annullato').message
    ).toContain(INDICAZIONE_FIR_ANNULLATO)
  })
  it('rettificato o vigente: messaggio di sempre', () => {
    const m = new FirGiaRegistratoError(3, 2026, undefined, 'rettificato').message
    expect(m).toContain('poi rettificato')
    expect(m).toContain('verificare quel movimento')
    expect(m).not.toContain(INDICAZIONE_FIR_ANNULLATO)
  })
})
