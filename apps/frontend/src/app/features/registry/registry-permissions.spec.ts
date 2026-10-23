import { puoGestireAnagrafiche } from './registry-permissions'

/**
 * Chi può creare, modificare o eliminare un'anagrafica.
 *
 * La regola deve rispecchiare ESATTAMENTE il backend: `RegistryController`
 * protegge POST/PUT/DELETE con `@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')`,
 * identico per le tre anagrafiche. Mostrare i pulsanti a un VIEWER significa
 * offrirgli un'azione che il server rifiuterà.
 */
describe('puoGestireAnagrafiche', () => {
  it('consente i ruoli operativi ammessi dal backend', () => {
    expect(puoGestireAnagrafiche('SUPER_ADMIN')).toBe(true)
    expect(puoGestireAnagrafiche('ADMIN')).toBe(true)
    expect(puoGestireAnagrafiche('OPERATOR')).toBe(true)
  })

  it('nega il VIEWER, che ha sola lettura', () => {
    expect(puoGestireAnagrafiche('VIEWER')).toBe(false)
  })

  it('nega quando il ruolo è assente o sconosciuto (fail-closed)', () => {
    expect(puoGestireAnagrafiche(undefined)).toBe(false)
    expect(puoGestireAnagrafiche('')).toBe(false)
    expect(puoGestireAnagrafiche('RUOLO_INVENTATO')).toBe(false)
  })
})
