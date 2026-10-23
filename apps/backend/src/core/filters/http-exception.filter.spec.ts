import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import * as Sentry from '@sentry/node'
import { HttpExceptionFilter } from './http-exception.filter'
import { FirAnnullatoNelFrattempoError } from '../domain/errors'
import { TenantSenzaCertificatoRentriError } from '../../infrastructure/rentri/rentri-credential.resolver'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

describe('HttpExceptionFilter - segnalazione a Bugsink', () => {
  let filter: HttpExceptionFilter
  let logger: { setContext: jest.Mock; error: jest.Mock }
  let response: { status: jest.Mock; json: jest.Mock }
  let host: ArgumentsHost

  function creaHost(url: string): ArgumentsHost {
    const request = {
      method: 'GET',
      url,
      correlationId: 'corr-1',
      tenantId: 't-1',
      user: { id: 'u-1' },
    }
    return {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ArgumentsHost
  }

  beforeEach(() => {
    jest.clearAllMocks()
    logger = { setContext: jest.fn(), error: jest.fn() }
    response = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() }
    filter = new HttpExceptionFilter(logger as any)
    host = creaHost('/api/v1/fir?search=RSSMRA80A01H501U')
  })

  it('invia a Bugsink un errore imprevisto (500) con l utente e il path senza query', () => {
    filter.catch(new Error('boom'), host)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { correlationId: 'corr-1', statusCode: '500' },
        user: { id: 'u-1' },
        extra: expect.objectContaining({ path: '/api/v1/fir' }),
      })
    )
  })

  it('registra nel log l utente letto da req.user.id', () => {
    filter.catch(new Error('boom'), host)
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Error),
      expect.objectContaining({ userId: 'u-1' })
    )
  })

  it('invia a Bugsink una HttpException 503', () => {
    filter.catch(new ServiceUnavailableException(), host)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
  })

  it('non invia a Bugsink i 503 delle rotte di health', () => {
    filter.catch(new ServiceUnavailableException(), creaHost('/api/v1/health/db'))
    expect(Sentry.captureException).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(503)
    expect(logger.error).toHaveBeenCalled()
  })

  it('non invia a Bugsink i 4xx', () => {
    filter.catch(new NotFoundException(), host)
    filter.catch(new BadRequestException('x'), host)
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('risponde al client come prima anche se Sentry lancia', () => {
    ;(Sentry.captureException as jest.Mock).mockImplementationOnce(() => {
      throw new Error('rete')
    })
    filter.catch(new Error('boom'), host)
    expect(response.status).toHaveBeenCalledWith(500)
  })

  it('un FIR annullato nel frattempo è un conflitto (409), non un errore imprevisto', () => {
    filter.catch(new FirAnnullatoNelFrattempoError('fir-1'), host)

    expect(response.status).toHaveBeenCalledWith(409)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        error: 'FIR_ANNULLATO_NEL_FRATTEMPO',
        message:
          "Il FIR è stato annullato nel frattempo da un'altra operazione: ricarica la pagina per vedere lo stato aggiornato.",
      })
    )
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('un tenant senza certificato RENTRI è un 422 azionabile, non un errore imprevisto', () => {
    const errore = new TenantSenzaCertificatoRentriError()
    filter.catch(errore, host)

    expect(response.status).toHaveBeenCalledWith(422)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        error: 'RENTRI_CERTIFICATO_MANCANTE',
        message: errore.message,
        correlationId: 'corr-1',
        path: expect.any(String),
      })
    )
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})
