import { ProviderSdiNonDisponibileError, RegistroProviderSdi } from './registro-provider-sdi'
import { ProviderSdiFake } from '../../../infrastructure/sdi/fake/provider-sdi-fake'

describe('RegistroProviderSdi', () => {
  const fake = new ProviderSdiFake()
  const registro = new RegistroProviderSdi([fake])

  it('trova il fake fuori produzione', () => {
    expect(registro.trova('fake', 'test')).toBe(fake)
    expect(registro.trova('fake', undefined)).toBe(fake)
  })

  it('rifiuta il fake in produzione (come SIGNATURE_PROVIDER=sandbox)', () => {
    expect(() => registro.trova('fake', 'production')).toThrow(ProviderSdiNonDisponibileError)
    expect(registro.codiciDisponibili('production')).toEqual([])
    expect(registro.codiciDisponibili('test')).toEqual(['fake'])
  })

  it('un provider non registrato e sconosciuto (anche se valido nel catalogo)', () => {
    expect(() => registro.trova('openapi', 'test')).toThrow(/non disponibile/)
  })

  it('due adattatori con lo stesso codice: errore', () => {
    expect(() => new RegistroProviderSdi([fake, new ProviderSdiFake()])).toThrow(/duplicato/)
  })
})
