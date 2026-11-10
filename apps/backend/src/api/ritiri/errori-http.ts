import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common'
import { DomainError } from '../../core/domain/errors'
import {
  RitiroConFirError,
  RitiroDatiNonValidiError,
  RitiroModificatoError,
  RitiroNonTrovatoError,
  RitiroStatoNonValidoError,
} from '../../application/ritiri/errori-ritiri'

/**
 * Errori di dominio dei ritiri tradotti in HTTP, con messaggi senza id. I 409 portano il codice
 * macchina in `error` (il filtro globale lo rimanda nel corpo).
 */
export async function comeHttpRitiri<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpException) throw err
    if (err instanceof RitiroNonTrovatoError) throw new NotFoundException(err.message)
    if (err instanceof RitiroDatiNonValidiError) {
      throw new BadRequestException({
        message: err.message,
        error: 'RITIRI_DATI_NON_VALIDI',
        details: { messaggi: err.messaggi },
      })
    }
    if (
      err instanceof RitiroModificatoError ||
      err instanceof RitiroConFirError ||
      err instanceof RitiroStatoNonValidoError
    ) {
      throw new ConflictException({ message: err.message, error: err.code })
    }
    if (err instanceof DomainError) throw new BadRequestException(err.message)
    throw err
  }
}
