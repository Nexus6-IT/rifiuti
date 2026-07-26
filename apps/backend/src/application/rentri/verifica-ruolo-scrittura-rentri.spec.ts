import {
  assertRuoloScritturaRentri,
  RUOLI_SCRITTURA_RENTRI,
} from './verifica-ruolo-scrittura-rentri'
import { DomainException } from '../../domain/shared/domain-exception'

describe('assertRuoloScritturaRentri', () => {
  it.each(RUOLI_SCRITTURA_RENTRI)('ammette il ruolo %s', ruolo => {
    expect(() => assertRuoloScritturaRentri(ruolo)).not.toThrow()
  })

  it('rifiuta VIEWER (escluso esplicitamente dal contratto del task)', () => {
    expect(() => assertRuoloScritturaRentri('VIEWER')).toThrow(DomainException)
    try {
      assertRuoloScritturaRentri('VIEWER')
    } catch (error) {
      expect((error as DomainException).code).toBe('UNAUTHORIZED')
    }
  })

  it('rifiuta un ruolo assente (fail-closed, mai permesso di default)', () => {
    expect(() => assertRuoloScritturaRentri(undefined)).toThrow(DomainException)
    expect(() => assertRuoloScritturaRentri(null)).toThrow(DomainException)
    expect(() => assertRuoloScritturaRentri('')).toThrow(DomainException)
  })

  it('rifiuta un ruolo sconosciuto', () => {
    expect(() => assertRuoloScritturaRentri('QUALCOSA_DI_INVENTATO')).toThrow(DomainException)
  })
})
