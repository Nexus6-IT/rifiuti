import { verificaCerPerFormulario, normalizzaCerCode } from './verifica-cer-formulario'
import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'

function repo(esiste: boolean, utilizzabile: boolean) {
  return {
    exists: jest.fn().mockResolvedValue(esiste),
    isUtilizzabilePerNuovoFormulario: jest.fn().mockResolvedValue(utilizzabile),
  } as unknown as jest.Mocked<ICERRepository>
}

describe('verificaCerPerFormulario', () => {
  it('normalizza il codice senza spazi e lo restituisce', async () => {
    const r = repo(true, true)
    const res = await verificaCerPerFormulario(r, '200301')
    expect(res.isSuccess).toBe(true)
    expect(res.value).toBe('20 03 01')
    expect(r.exists).toHaveBeenCalledWith('20 03 01')
    expect(r.isUtilizzabilePerNuovoFormulario).toHaveBeenCalledWith('20 03 01')
  })

  it('codice inesistente: messaggio con il valore originale, senza la seconda verifica', async () => {
    const r = repo(false, true)
    const res = await verificaCerPerFormulario(r, '999999')
    expect(res.isFailure).toBe(true)
    expect(res.error).toBe('CER code not found: 999999')
    expect(r.isUtilizzabilePerNuovoFormulario).not.toHaveBeenCalled()
  })

  it('codice non più utilizzabile: messaggio sulla sostituzione', async () => {
    const res = await verificaCerPerFormulario(repo(true, false), '20 03 01')
    expect(res.isFailure).toBe(true)
    expect(res.error).toMatch(/non è più valido secondo il registro dell'ente/)
  })

  it('normalizzaCerCode lascia invariato un valore vuoto', () => {
    expect(normalizzaCerCode('')).toBe('')
  })
})
