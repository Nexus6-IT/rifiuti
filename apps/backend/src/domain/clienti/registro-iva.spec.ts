import {
  motivoRegistroNonUsabile,
  normalizzaRegistro,
  validaRegistro,
  type DatiRegistroIva,
} from './registro-iva'

const valido = (extra: Partial<DatiRegistroIva> = {}): DatiRegistroIva => ({
  codice: '01',
  descrizione: 'Vendite',
  ricevuteSplit: false,
  ...extra,
})
const MSG_CODICE = 'Il codice del registro IVA è di due cifre, da 01 a 99.'

describe('registroIva', () => {
  it('registro valido', () => expect(validaRegistro(valido())).toEqual([]))
  it('"1" normalizzato a "01"', () => {
    expect(normalizzaRegistro({ codice: ' 1 ', descrizione: 'V' }).codice).toBe('01')
    expect(normalizzaRegistro({ codice: '12' }).codice).toBe('12')
    expect(normalizzaRegistro({}).ricevuteSplit).toBe(false)
  })
  it('"00", "100", "A1" non validi', () => {
    for (const c of ['00', '100', 'A1', '']) {
      expect(validaRegistro(valido({ codice: c }))).toEqual([MSG_CODICE])
    }
  })
  it('descrizione vuota e di 61 caratteri', () => {
    expect(validaRegistro(valido({ descrizione: '' }))).toEqual(['Indica la descrizione.'])
    expect(validaRegistro(valido({ descrizione: 'D'.repeat(61) }))).toEqual([
      'La descrizione può avere al massimo 60 caratteri.',
    ])
    expect(validaRegistro(valido({ descrizione: 'D'.repeat(60) }))).toEqual([])
  })
  it('motivoRegistroNonUsabile: messaggi di D24', () => {
    expect(motivoRegistroNonUsabile(null)).toBe(
      'Il registro IVA scelto non esiste o è disattivato.'
    )
    expect(motivoRegistroNonUsabile({ attivo: false, ricevuteSplit: false })).toBe(
      'Il registro IVA scelto non esiste o è disattivato.'
    )
    expect(motivoRegistroNonUsabile({ attivo: true, ricevuteSplit: true })).toBe(
      'Il registro delle ricevute split payment non si usa per le fatture del contratto.'
    )
    expect(motivoRegistroNonUsabile({ attivo: true, ricevuteSplit: false })).toBeNull()
  })
})
