import { FallimentiAutenticazione } from './fallimenti-autenticazione'

describe('FallimentiAutenticazione', () => {
  it('blocca un IP solo dopo il limite di rifiuti, per il resto della finestra', () => {
    const f = FallimentiAutenticazione.con(3, 60_000)
    for (let i = 0; i < 2; i++) f.registra('1.1.1.1', 1000)
    expect(f.bloccatoPer('1.1.1.1', 1000)).toBeNull()
    f.registra('1.1.1.1', 1000)
    expect(f.bloccatoPer('1.1.1.1', 31_000)).toBe(30)
    expect(f.bloccatoPer('2.2.2.2', 31_000)).toBeNull()
  })

  it('a finestra scaduta il blocco cade e il conteggio riparte', () => {
    const f = FallimentiAutenticazione.con(1, 60_000)
    f.registra('1.1.1.1', 0)
    expect(f.bloccatoPer('1.1.1.1', 59_999)).toBe(1)
    expect(f.bloccatoPer('1.1.1.1', 60_000)).toBeNull()
    f.registra('1.1.1.1', 60_001)
    expect(f.bloccatoPer('1.1.1.1', 60_002)).not.toBeNull()
  })
})
