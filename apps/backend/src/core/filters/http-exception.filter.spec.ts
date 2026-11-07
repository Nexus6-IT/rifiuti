import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import * as Sentry from '@sentry/node'
import {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/library'
import { HttpExceptionFilter } from './http-exception.filter'
import {
  DatiControparteNonValidiError,
  DittaIdentificativiInConflittoError,
  DittaNonTrovataError,
  FirAnnullatoNelFrattempoError,
  FirModificatoNelFrattempoError,
  FirNonModificabileError,
  FirNonTrovatoError,
  IdentificativoNonCorrispondenteError,
  SedeNonModificabileError,
  SedeNonTrovataError,
} from '../domain/errors'
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

  it('un corpo oltre il limite (PayloadTooLargeError di body-parser) e` 413, non 500', () => {
    const errore = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
      statusCode: 413,
    })
    filter.catch(errore, host)
    expect(response.status).toHaveBeenCalledWith(413)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 413,
        error: 'PAYLOAD_TROPPO_GRANDE',
        message: expect.stringContaining('troppo grande'),
      })
    )
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('anche un errore con solo statusCode 413 e` 413', () => {
    filter.catch(Object.assign(new Error('x'), { statusCode: 413 }), host)
    expect(response.status).toHaveBeenCalledWith(413)
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

  it('un FIR modificato nel frattempo è un conflitto (409), senza segnalazione', () => {
    filter.catch(new FirModificatoNelFrattempoError('fir-1'), host)

    expect(response.status).toHaveBeenCalledWith(409)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        error: 'FIR_MODIFICATO_NEL_FRATTEMPO',
        message: FirModificatoNelFrattempoError.MESSAGGIO_UTENTE,
      })
    )
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('una bozza non modificabile è un conflitto (409) col messaggio del motivo, senza id', () => {
    filter.catch(new FirNonModificabileError('FIRMATO'), host)

    expect(response.status).toHaveBeenCalledWith(409)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        error: 'FIR_NON_MODIFICABILE',
        message: FirNonModificabileError.MESSAGGI.FIRMATO,
      })
    )
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('un FIR non trovato è un 404 senza id, senza segnalazione', () => {
    filter.catch(new FirNonTrovatoError(), host)

    expect(response.status).toHaveBeenCalledWith(404)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        error: 'FIR_NON_TROVATO',
        message: 'FIR non trovato',
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

  describe('ditte e sedi delle controparti (F2-10)', () => {
    const casi: Array<[string, Error, number, string]> = [
      [
        'dati non validi',
        new DatiControparteNonValidiError('Codice fiscale non valido.'),
        400,
        'DATI_CONTROPARTE_NON_VALIDI',
      ],
      [
        'identificativo contraddittorio',
        new IdentificativoNonCorrispondenteError('Non corrisponde.'),
        400,
        'IDENTIFICATIVO_NON_CORRISPONDENTE',
      ],
      [
        'identificativi in conflitto',
        new DittaIdentificativiInConflittoError(),
        409,
        'DITTA_IDENTIFICATIVI_IN_CONFLITTO',
      ],
      [
        'sede non modificabile',
        new SedeNonModificabileError('È la sede principale.'),
        409,
        'SEDE_NON_MODIFICABILE',
      ],
      ['ditta non trovata', new DittaNonTrovataError(), 404, 'DITTA_NON_TROVATA'],
      ['sede non trovata', new SedeNonTrovataError(), 404, 'SEDE_NON_TROVATA'],
    ]
    it.each(casi)(
      '%s: status e codice, senza segnalazione a Bugsink',
      (_nome, errore, status, codice) => {
        filter.catch(errore, host)
        expect(response.status).toHaveBeenCalledWith(status)
        expect(response.json).toHaveBeenCalledWith(
          expect.objectContaining({ statusCode: status, error: codice, message: errore.message })
        )
        expect(Sentry.captureException).not.toHaveBeenCalled()
      }
    )
  })

  it('la query string non finisce ne nella risposta ne nel log ne in Bugsink (host con CF in query)', () => {
    filter.catch(new Error('boom'), host) // host: /api/v1/fir?search=<CF>
    const risposta = JSON.stringify(response.json.mock.calls[0][0])
    expect(risposta).not.toContain('RSSMRA80A01H501U')
    expect(response.json.mock.calls[0][0].path).toBe('/api/v1/fir')
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('RSSMRA80A01H501U')
    expect(JSON.stringify((Sentry.captureException as jest.Mock).mock.calls)).not.toContain(
      'RSSMRA80A01H501U'
    )
  })

  describe('violazioni di vincoli Postgres: nessun dato della riga (M5)', () => {
    const CF = 'RSSMRA80A01H501U'
    const messaggioPg =
      'new row for relation "ditte" violates check constraint "ditte_codice_fiscale_forma"\n' +
      `DETAIL: Failing row contains (abc, ${CF}, Rossi Mario).`

    const errori: Array<[string, () => Error]> = [
      [
        'PrismaClientUnknownRequestError',
        () =>
          new PrismaClientUnknownRequestError(`Raw query failed. Message: ${messaggioPg}`, {
            clientVersion: '5.22.0',
          }),
      ],
      [
        'P2010',
        () =>
          new PrismaClientKnownRequestError(
            `Raw query failed. Code: 23514. Message: ${messaggioPg}`,
            {
              code: 'P2010',
              clientVersion: '5.22.0',
              meta: { code: '23514', message: messaggioPg },
            }
          ),
      ],
    ]

    it.each(errori)('%s: la risposta e il log non contengono il codice fiscale', (_nome, crea) => {
      filter.catch(crea(), creaHost('/api/v1/registry/ditte/cerca'))
      expect(response.status).toHaveBeenCalledWith(500)
      const risposta = JSON.stringify(response.json.mock.calls[0][0])
      expect(risposta).not.toContain(CF)
      expect(risposta).not.toContain('Failing row')
      const registrato = JSON.stringify(
        logger.error.mock.calls.map(c => [c[0], c[1]?.message, c[1]?.stack])
      )
      expect(registrato).not.toContain(CF)
      expect(registrato).not.toContain('Rossi Mario')
    })
  })
})
