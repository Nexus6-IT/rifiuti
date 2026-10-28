import { puoCreareFir, puoModificareFir } from './fir-permissions'

/**
 * Chi può creare un FIR.
 *
 * La regola deve rispecchiare ESATTAMENTE il backend: `FIRControllerV2.create`
 * è protetto da `@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')`. Mostrare il
 * bottone a un VIEWER significa offrirgli un'azione che il server rifiuterà.
 */
describe('puoCreareFir', () => {
  it('consente i ruoli operativi ammessi dal backend', () => {
    expect(puoCreareFir('SUPER_ADMIN')).toBe(true)
    expect(puoCreareFir('ADMIN')).toBe(true)
    expect(puoCreareFir('OPERATOR')).toBe(true)
  })

  it('nega il VIEWER, che ha sola lettura', () => {
    expect(puoCreareFir('VIEWER')).toBe(false)
  })

  it('nega quando il ruolo è assente o sconosciuto (fail-closed)', () => {
    expect(puoCreareFir(undefined)).toBe(false)
    expect(puoCreareFir('')).toBe(false)
    expect(puoCreareFir('RUOLO_INVENTATO')).toBe(false)
  })
})

describe('puoModificareFir', () => {
  it('ha la stessa regola della creazione', () => {
    for (const ruolo of ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER', 'X', '', undefined, null]) {
      expect(puoModificareFir(ruolo)).toBe(puoCreareFir(ruolo))
    }
    expect(puoModificareFir('OPERATOR')).toBe(true)
    expect(puoModificareFir('VIEWER')).toBe(false)
  })
})
