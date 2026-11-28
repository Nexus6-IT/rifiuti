import { inizioMeseItaliano, limiteEsportazioneMensile } from './limite-esportazione-mensile'

describe('inizioMeseItaliano', () => {
  it('novembre (ora solare): la mezzanotte di Roma e alle 23:00 UTC del 31 ottobre', () => {
    expect(inizioMeseItaliano(new Date('2026-11-28T12:00:00Z')).toISOString()).toBe(
      '2026-10-31T23:00:00.000Z'
    )
  })
  it('luglio (ora legale): le 22:00 UTC del 30 giugno', () => {
    expect(inizioMeseItaliano(new Date('2026-07-15T08:00:00Z')).toISOString()).toBe(
      '2026-06-30T22:00:00.000Z'
    )
  })
  it('l ultimo istante di ottobre a Roma e ancora ottobre, il primo di novembre e novembre', () => {
    expect(inizioMeseItaliano(new Date('2026-10-31T22:59:59Z')).toISOString()).toBe(
      '2026-09-30T22:00:00.000Z'
    )
    expect(inizioMeseItaliano(new Date('2026-10-31T23:00:00Z')).toISOString()).toBe(
      '2026-10-31T23:00:00.000Z'
    )
  })
})

describe('limiteEsportazioneMensile', () => {
  const oggi = new Date('2026-11-28T12:00:00Z')
  const inizioNovembre = '2026-10-31T23:00:00.000Z'

  it('tutto confermato: il limite e l inizio del mese corrente (esporta fino a fine ottobre)', () => {
    expect(limiteEsportazioneMensile(null, oggi).toISOString()).toBe(inizioNovembre)
  })
  it('un mese precedente con annotazioni ancora non confermate ferma l esportazione prima di quel mese', () => {
    expect(limiteEsportazioneMensile(new Date('2026-09-12T10:00:00Z'), oggi).toISOString()).toBe(
      '2026-08-31T22:00:00.000Z'
    )
  })
  it('una non confermata del mese corrente non anticipa il limite', () => {
    expect(limiteEsportazioneMensile(new Date('2026-11-03T10:00:00Z'), oggi).toISOString()).toBe(
      inizioNovembre
    )
  })
  it('una data non valida e un errore, mai un limite inventato', () => {
    expect(() => limiteEsportazioneMensile(new Date('x'), oggi)).toThrow()
  })
})
