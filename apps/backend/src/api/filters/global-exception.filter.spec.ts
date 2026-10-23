import { ArgumentsHost } from '@nestjs/common'
import { GlobalExceptionFilter } from './global-exception.filter'
import { TenantSenzaCertificatoRentriError } from '../../infrastructure/rentri/rentri-credential.resolver'

describe('GlobalExceptionFilter', () => {
  function esegui(eccezione: unknown) {
    const json = jest.fn()
    const status = jest.fn().mockReturnValue({ json })
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/x', method: 'POST' }),
      }),
    } as unknown as ArgumentsHost
    new GlobalExceptionFilter().catch(eccezione, host)
    return { status, corpo: json.mock.calls[0][0] }
  }

  it('filtro globale: TenantSenzaCertificatoRentriError → 422 col messaggio', () => {
    const errore = new TenantSenzaCertificatoRentriError()

    const { status, corpo } = esegui(errore)

    expect(status).toHaveBeenCalledWith(422)
    expect(corpo.error.statusCode).toBe(422)
    expect(corpo.error.message).toBe(errore.message)
    expect(corpo.error.error).toBe('RENTRI_CERTIFICATO_MANCANTE')
  })
})
