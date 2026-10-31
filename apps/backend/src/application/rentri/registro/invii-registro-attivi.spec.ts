import { inviiRegistroAttivi, VARIABILE_INVII_REGISTRO } from './invii-registro-attivi'

describe('inviiRegistroAttivi (interruttore di emergenza degli invii del registro a RENTRI)', () => {
  const originale = process.env[VARIABILE_INVII_REGISTRO]
  afterEach(() => {
    if (originale === undefined) delete process.env[VARIABILE_INVII_REGISTRO]
    else process.env[VARIABILE_INVII_REGISTRO] = originale
  })

  it('variabile assente: attivi (default)', () => {
    delete process.env[VARIABILE_INVII_REGISTRO]
    expect(inviiRegistroAttivi()).toBe(true)
  })

  it('solo il testo esatto "false" li spegne', () => {
    process.env[VARIABILE_INVII_REGISTRO] = 'false'
    expect(inviiRegistroAttivi()).toBe(false)
  })

  it.each(['true', '', ' ', 'FALSE', 'False', '0', 'no', 'off', 'false ', ' false'])(
    'valore %p: restano attivi (nessuna interpretazione creativa)',
    valore => {
      process.env[VARIABILE_INVII_REGISTRO] = valore
      expect(inviiRegistroAttivi()).toBe(true)
    }
  )
})
