import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common'
import { DomainError } from '../../core/domain/errors'
import {
  AutistaDatiNonValidiError,
  AutistaDuplicatoError,
  AutistaNonCollegatoError,
  AutistaNonTrovatoError,
} from '../../application/campo/errori-campo'
import { RitiroDatiNonValidiError } from '../../application/ritiri/errori-ritiri'

/** Errori di dominio dell'app campo tradotti in HTTP, con messaggi senza id. */
export async function comeHttpCampo<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpException) throw err
    if (err instanceof AutistaNonTrovatoError) throw new NotFoundException(err.message)
    if (err instanceof AutistaNonCollegatoError) {
      throw new ForbiddenException({ message: err.message, error: err.code })
    }
    if (err instanceof AutistaDuplicatoError) {
      throw new ConflictException({ message: err.message, error: err.code })
    }
    if (err instanceof AutistaDatiNonValidiError || err instanceof RitiroDatiNonValidiError) {
      throw new BadRequestException({
        message: err.message,
        error: 'CAMPO_DATI_NON_VALIDI',
        details: { messaggi: err.messaggi },
      })
    }
    if (err instanceof DomainError) throw new BadRequestException(err.message)
    throw err
  }
}
