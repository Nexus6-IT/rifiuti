import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common'
import { Request, Response } from 'express'
import * as Sentry from '@sentry/node'
import {
  PrismaClientKnownRequestError,
  PrismaClientValidationError,
} from '@prisma/client/runtime/library'
import { LoggerService } from '../logger/logger.service'
import { mascheraDatiPersonali } from '../monitoring/opzioni-sentry'
import { DomainException } from '../../domain/shared/domain-exception'
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
import { CODICE_CERTIFICATO_MANCANTE } from '../../infrastructure/rentri/rentri-certificato.costanti'

/**
 * Global HTTP Exception Filter
 *
 * Catches all exceptions and formats them into consistent error responses.
 * Handles:
 * - HTTP exceptions from NestJS
 * - Domain exceptions from business logic
 * - Errori Prisma/database (mappati su status corretti, senza esporre dettagli interni)
 * - Unexpected errors
 *
 * Sicurezza (info-disclosure): il body di risposta NON contiene mai messaggi Prisma
 * grezzi, stack trace o path assoluti di file. Gli errori non gestiti/DB restituiscono
 * un messaggio generico in italiano; i dettagli restano solo nei log lato server.
 *
 * Response format:
 * ```json
 * {
 *   "statusCode": 400,
 *   "error": "BAD_REQUEST",
 *   "message": "Validation failed",
 *   "correlationId": "uuid",
 *   "timestamp": "2025-01-18T10:30:00Z",
 *   "path": "/api/v1/fir"
 * }
 * ```
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext('HttpExceptionFilter')
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    const correlationId = (request as any).correlationId || 'unknown'
    const tenantId = (request as any).tenantId
    // JwtStrategy.validate popola request.user.id
    const userId = (request as any).user?.id

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR
    let errorCode = 'INTERNAL_SERVER_ERROR'
    let message = 'An unexpected error occurred'
    let details: any = undefined

    // Handle HTTP exceptions
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus()
      const exceptionResponse = exception.getResponse()

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse
      } else if (typeof exceptionResponse === 'object') {
        const response = exceptionResponse as any
        message = response.message || exception.message
        errorCode = response.error || this.getErrorCodeFromStatus(statusCode)
        details = response.details
      }
    }
    // Handle Domain exceptions
    else if (exception instanceof DomainException) {
      statusCode = HttpStatus.BAD_REQUEST
      errorCode = exception.code || 'DOMAIN_ERROR'
      message = exception.message
      details = exception.metadata
    }
    // Handle Prisma known request errors (mapping su status corretti).
    // NON esporre error.message (contiene dettagli interni di query/colonne).
    else if (exception instanceof PrismaClientKnownRequestError) {
      const mapped = this.mapPrismaKnownError(exception)
      statusCode = mapped.statusCode
      errorCode = mapped.errorCode
      message = mapped.message
    }
    // Prisma validation error (es. argomenti/tipi non validi) → 400 generico.
    else if (exception instanceof PrismaClientValidationError) {
      statusCode = HttpStatus.BAD_REQUEST
      errorCode = 'BAD_REQUEST'
      message = 'Richiesta non valida: dati o formato non corretti.'
    }
    // FIR annullato mentre un'altra operazione lo salvava (FirAnnullatoNelFrattempoError,
    // un DomainError): corsa prevista, si risponde 409 e non si segnala a Bugsink.
    else if (exception instanceof FirAnnullatoNelFrattempoError) {
      statusCode = HttpStatus.CONFLICT
      errorCode = FirAnnullatoNelFrattempoError.CODICE
      message = FirAnnullatoNelFrattempoError.MESSAGGIO_UTENTE
    }
    // Lock ottimistico sul FIR (versione diversa da quella letta): 409, nessuna segnalazione.
    else if (exception instanceof FirModificatoNelFrattempoError) {
      statusCode = HttpStatus.CONFLICT
      errorCode = FirModificatoNelFrattempoError.CODICE
      message = FirModificatoNelFrattempoError.MESSAGGIO_UTENTE
    }
    // Bozza non modificabile: 409 col messaggio del motivo (senza id).
    else if (exception instanceof FirNonModificabileError) {
      statusCode = HttpStatus.CONFLICT
      errorCode = FirNonModificabileError.CODICE
      message = exception.message
    }
    // FIR assente o di un'altra azienda: 404 senza id.
    else if (exception instanceof FirNonTrovatoError) {
      statusCode = HttpStatus.NOT_FOUND
      errorCode = FirNonTrovatoError.CODICE
      message = FirNonTrovatoError.MESSAGGIO_UTENTE
    }
    // Ditte e sedi delle controparti (F2-10): errori attesi, senza segnalazione a Bugsink e con
    // messaggi che non riportano mai identificativi fiscali ne' id.
    else if (exception instanceof DatiControparteNonValidiError) {
      statusCode = HttpStatus.BAD_REQUEST
      errorCode = DatiControparteNonValidiError.CODICE
      message = exception.message
    } else if (exception instanceof IdentificativoNonCorrispondenteError) {
      statusCode = HttpStatus.BAD_REQUEST
      errorCode = IdentificativoNonCorrispondenteError.CODICE
      message = exception.message
    } else if (exception instanceof DittaIdentificativiInConflittoError) {
      statusCode = HttpStatus.CONFLICT
      errorCode = DittaIdentificativiInConflittoError.CODICE
      message = exception.message
    } else if (exception instanceof SedeNonModificabileError) {
      statusCode = HttpStatus.CONFLICT
      errorCode = SedeNonModificabileError.CODICE
      message = exception.message
    } else if (exception instanceof DittaNonTrovataError) {
      statusCode = HttpStatus.NOT_FOUND
      errorCode = DittaNonTrovataError.CODICE
      message = DittaNonTrovataError.MESSAGGIO_UTENTE
    } else if (exception instanceof SedeNonTrovataError) {
      statusCode = HttpStatus.NOT_FOUND
      errorCode = SedeNonTrovataError.CODICE
      message = SedeNonTrovataError.MESSAGGIO_UTENTE
    }
    // Azienda senza certificato RENTRI: non e' un guasto del server ma serve un'azione
    // dell'utente (caricare il certificato). 422 col messaggio gia' pensato per l'utente
    // (senza id del tenant) e nessuna segnalazione a Bugsink (sotto 500).
    else if (exception instanceof TenantSenzaCertificatoRentriError) {
      statusCode = HttpStatus.UNPROCESSABLE_ENTITY
      errorCode = CODICE_CERTIFICATO_MANCANTE
      message = exception.message
    }
    // Corpo oltre il limite: `PayloadTooLargeError` di body-parser non e` una HttpException, ma
    // porta `type: 'entity.too.large'` e status 413. E` un errore del client, non un guasto.
    else if (eCorpoTroppoGrande(exception)) {
      statusCode = HttpStatus.PAYLOAD_TOO_LARGE
      errorCode = 'PAYLOAD_TROPPO_GRANDE'
      message = 'La richiesta è troppo grande: riduci i dati inviati.'
    }
    // Handle unexpected errors — messaggio generico, nessun leak di dettagli interni.
    else if (exception instanceof Error) {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR
      errorCode = 'INTERNAL_SERVER_ERROR'
      message = 'Si è verificato un errore imprevisto. Riprova più tardi.'
    }

    // Percorso senza query string e senza dati personali: una query puo' contenere un CF.
    // Limite noto: il mascheramento non copre nome e cognome dei privati, che compaiono negli
    // argomenti stampati da PrismaClientValidationError (D12).
    const percorsoSenzaQuery = mascheraDatiPersonali(request.url.split('?')[0])

    // Log the error
    this.logger.error(
      `HTTP ${request.method} ${percorsoSenzaQuery} - ${statusCode} ${errorCode}`,
      exception instanceof Error ? this.erroreSenzaDatiPersonali(exception) : undefined,
      {
        correlationId,
        tenantId,
        userId,
        statusCode,
        errorCode,
        path: percorsoSenzaQuery,
        method: request.method,
      }
    )

    // Segnalazione a Bugsink dei soli 5xx. Senza SENTRY_DSN l'SDK non è inizializzato e la
    // chiamata non fa nulla. I 503 delle rotte di health restano fuori (Decisione 4): sono
    // il segnale normale di un controllo che fallisce, non un errore imprevisto.
    if (statusCode >= 500 && !/\/health(\/|$)/.test(percorsoSenzaQuery)) {
      try {
        Sentry.captureException(exception, {
          tags: { correlationId, statusCode: String(statusCode) },
          user: userId ? { id: userId } : undefined,
          extra: { tenantId, path: percorsoSenzaQuery, method: request.method },
        })
      } catch {
        /* Bugsink irraggiungibile: la risposta al client non deve cambiare */
      }
    }

    // Send error response
    const errorResponse = {
      statusCode,
      error: errorCode,
      message,
      ...(details && { details }),
      correlationId,
      timestamp: new Date().toISOString(),
      path: percorsoSenzaQuery,
    }

    response.status(statusCode).json(errorResponse)
  }

  /**
   * Copia dell'errore per il log con messaggio e stack mascherati: i messaggi di Postgres
   * (`Failing row contains (...)`, `DETAIL: Key (...)`) riportano i valori della riga, codice
   * fiscale compreso (D12).
   */
  private erroreSenzaDatiPersonali(errore: Error): Error {
    const copia = new Error(mascheraDatiPersonali(errore.message))
    copia.name = errore.name
    copia.stack = errore.stack ? mascheraDatiPersonali(errore.stack) : undefined
    return copia
  }

  /**
   * Mappa i codici errore Prisma noti su status HTTP corretti con messaggi
   * generici in italiano (nessun dettaglio interno esposto al client).
   */
  private mapPrismaKnownError(error: PrismaClientKnownRequestError): {
    statusCode: number
    errorCode: string
    message: string
  } {
    switch (error.code) {
      case 'P2023': // Identificativo/colonna malformata (es. UUID non valido)
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: 'BAD_REQUEST',
          message: 'Identificativo o formato non valido.',
        }
      case 'P2025': // Record non trovato
        return {
          statusCode: HttpStatus.NOT_FOUND,
          errorCode: 'NOT_FOUND',
          message: 'Risorsa non trovata.',
        }
      case 'P2002': // Violazione vincolo di unicità
        return {
          statusCode: HttpStatus.CONFLICT,
          errorCode: 'CONFLICT',
          message: 'Esiste già un record con questi dati.',
        }
      case 'P2003': // Violazione vincolo di chiave esterna
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: 'BAD_REQUEST',
          message: 'Operazione non consentita: esistono record collegati.',
        }
      case 'P2014': // Violazione di relazione richiesta
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: 'BAD_REQUEST',
          message: 'Relazione non valida nella richiesta.',
        }
      default:
        // Qualsiasi altro errore DB → 500 generico, dettagli solo nei log.
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          errorCode: 'INTERNAL_SERVER_ERROR',
          message: 'Si è verificato un errore del database.',
        }
    }
  }

  /**
   * Map HTTP status code to error code
   */
  private getErrorCodeFromStatus(statusCode: number): string {
    const statusMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
      504: 'GATEWAY_TIMEOUT',
    }

    return statusMap[statusCode] || 'UNKNOWN_ERROR'
  }
}

/** Errore di body-parser per corpo oltre il limite (o qualunque errore con stato 413). */
function eCorpoTroppoGrande(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const x = e as Error & { type?: unknown; status?: unknown; statusCode?: unknown }
  return x.type === 'entity.too.large' || x.status === 413 || x.statusCode === 413
}
