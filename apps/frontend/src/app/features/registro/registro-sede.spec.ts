import { etichettaRegistro, registroPredefinito } from './registro-sede'
import { RegistroVista } from './registro.service'

function reg(parziale: Partial<RegistroVista>): RegistroVista {
  return {
    id: 'r1',
    unitaLocaleId: 'u1',
    numIscrSito: null,
    denominazione: 'Registro',
    codice: 'CARICO_SCARICO',
    attivo: true,
    principale: false,
    ...parziale,
  }
}

describe('registro-sede', () => {
  it('etichettaRegistro: sede con numero RENTRI → "Sede di Milano (OP…)"', () => {
    expect(etichettaRegistro(reg({ denominazione: 'Sede di Milano', numIscrSito: 'OP123' }))).toBe(
      'Sede di Milano (OP123)'
    )
  })

  it('etichettaRegistro: senza sede → "Registro senza sede"', () => {
    expect(etichettaRegistro(reg({ unitaLocaleId: null }))).toBe('Registro senza sede')
  })

  it('registroPredefinito: un solo registro → lui', () => {
    expect(registroPredefinito([reg({ id: 'solo' })])).toBe('solo')
  })

  it('registroPredefinito: due registri e uno principale → quello della principale', () => {
    expect(registroPredefinito([reg({ id: 'a' }), reg({ id: 'b', principale: true })])).toBe('b')
  })

  it('registroPredefinito: due registri senza principale → undefined', () => {
    expect(registroPredefinito([reg({ id: 'a' }), reg({ id: 'b' })])).toBeUndefined()
  })
})
