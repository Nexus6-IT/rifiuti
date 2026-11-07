import { messaggioDaCodice } from './messaggio-da-codice'

describe('messaggioDaCodice', () => {
  it('codice noto: etichetta del vocabolario', () => {
    expect(
      messaggioDaCodice(
        { status: 409, error: { error: 'DEFINITIVE_NON_ATTIVE', message: 'x' } },
        'r'
      )
    ).toBe('Le fatture definitive non sono ancora attive per questa azienda')
  })

  it('codice sconosciuto o assente: ripiego, mai il testo del backend', () => {
    expect(messaggioDaCodice({ error: { error: 'BOH', message: 'id 123' } }, 'ripiego')).toBe(
      'ripiego'
    )
    expect(messaggioDaCodice({ error: { message: 'id 123' } }, 'ripiego')).toBe('ripiego')
    expect(messaggioDaCodice(null, 'ripiego')).toBe('ripiego')
  })
})
