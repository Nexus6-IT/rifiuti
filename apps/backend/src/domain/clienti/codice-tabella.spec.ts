import { validaCodiceTabella } from './codice-tabella'

describe('validaCodiceTabella', () => {
  it('validaCodiceTabella: valido, charset e lunghezza', () => {
    expect(validaCodiceTabella('A.b-1_', 10, 'Il codice')).toBeNull()
    expect(validaCodiceTabella('A B', 10, 'Il codice')).toBe(
      'Il codice può contenere solo lettere, cifre, punto, trattino e trattino basso (massimo 10 caratteri).'
    )
    expect(validaCodiceTabella('', 10, 'Il codice')).not.toBeNull()
    expect(validaCodiceTabella('A'.repeat(11), 10, 'Il codice')).not.toBeNull()
    expect(validaCodiceTabella('A-1', 3, 'Il codice', '[A-Za-z0-9]')).toBe(
      'Il codice può contenere solo lettere e cifre (massimo 3 caratteri).'
    )
    expect(validaCodiceTabella('A1b', 3, 'Il codice', '[A-Za-z0-9]')).toBeNull()
  })
})
