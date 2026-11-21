import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { RentriApiError } from '../../infrastructure/rentri/rentri-http-resilienza'

/**
 * Errore dell'ente (`RentriApiError`) -> eccezione HTTP con un messaggio in italiano, senza dati
 * fiscali ne' dettagli tecnici. `undefined` se `err` non e' un errore dell'ente (lo traduce il chiamante).
 */
export function traduciRentriApiError(err: unknown): unknown {
  if (err instanceof RentriApiError) {
    if (err.status === 403) {
      return new ForbiddenException(
        "RENTRI non consente l'accesso a questa risorsa: verifica il certificato della tua azienda e che il registro appartenga alla tua azienda."
      )
    }
    if (err.retryable || err.status >= 500) {
      return new ServiceUnavailableException(
        'RENTRI non risponde in questo momento: riprova tra qualche minuto.'
      )
    }
    if (err.status === 400 || err.status === 404 || err.status === 422) {
      return new BadRequestException(
        `RENTRI ha rifiutato la richiesta${err.problemTitle ? `: ${err.problemTitle}` : '.'}`
      )
    }
    return new BadGatewayException('RENTRI ha risposto in modo inatteso: riprova più tardi.')
  }
  return undefined
}
