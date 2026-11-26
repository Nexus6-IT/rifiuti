import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { DomainError } from '../../core/domain/errors'
import {
  AutistaDatiNonValidiError,
  AutistaDuplicatoError,
  AutistaNonCollegatoError,
  AutistaNonTrovatoError,
  EventoCampoDiAltroUtenteError,
  PushEndpointDiAltroUtenteError,
  PushEndpointNonAmmessoError,
  PushNonDisponibileError,
  RicevutaAlterataError,
  RicevutaDiAltroUtenteError,
  RicevutaLimiteRitiroError,
  RicevutaNonConsentitaError,
  RicevutaNonTrovataError,
  RicevutaTroppoGrandeError,
  EventoCampoNonTrovatoError,
  FotoCampoGiaUsataError,
  FotoCampoHashNonCorrispondenteError,
  FotoCampoLimiteEventoError,
  FotoCampoNonTrovataError,
  FotoCampoNonValidaError,
  FotoCampoTipoNonAmmessoError,
  FotoCampoTroppoGrandeError,
} from '../../application/campo/errori-campo'
import {
  RitiroDatiNonValidiError,
  RitiroNonTrovatoError,
} from '../../application/ritiri/errori-ritiri'

/** Errori di dominio dell'app campo tradotti in HTTP, con messaggi senza id. */
export async function comeHttpCampo<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpException) throw err
    if (
      err instanceof AutistaNonTrovatoError ||
      err instanceof RitiroNonTrovatoError ||
      err instanceof RicevutaNonTrovataError ||
      err instanceof EventoCampoNonTrovatoError ||
      err instanceof FotoCampoNonTrovataError
    ) {
      throw new NotFoundException(err.message)
    }
    if (err instanceof FotoCampoTroppoGrandeError) {
      throw new PayloadTooLargeException({ message: err.message, error: err.code })
    }
    if (err instanceof FotoCampoTipoNonAmmessoError) {
      throw new UnsupportedMediaTypeException({ message: err.message, error: err.code })
    }
    if (
      err instanceof FotoCampoHashNonCorrispondenteError ||
      err instanceof FotoCampoLimiteEventoError
    ) {
      throw new UnprocessableEntityException({ message: err.message, error: err.code })
    }
    if (err instanceof FotoCampoGiaUsataError) {
      throw new ConflictException({ message: err.message, error: err.code })
    }
    if (err instanceof PushNonDisponibileError) {
      throw new ServiceUnavailableException({ message: err.message, error: err.code })
    }
    if (err instanceof PushEndpointDiAltroUtenteError) {
      throw new ConflictException({ message: err.message, error: err.code })
    }
    if (err instanceof PushEndpointNonAmmessoError) {
      throw new BadRequestException({ message: err.message, error: err.code })
    }
    if (err instanceof FotoCampoNonValidaError) {
      throw new BadRequestException({
        message: err.message,
        error: 'CAMPO_DATI_NON_VALIDI',
        details: { messaggi: err.messaggi },
      })
    }
    if (
      err instanceof EventoCampoDiAltroUtenteError ||
      err instanceof RicevutaDiAltroUtenteError ||
      err instanceof RicevutaNonConsentitaError ||
      err instanceof RicevutaLimiteRitiroError ||
      err instanceof RicevutaAlterataError
    ) {
      throw new ConflictException({ message: err.message, error: err.code })
    }
    if (err instanceof RicevutaTroppoGrandeError) {
      throw new UnprocessableEntityException({ message: err.message, error: err.code })
    }
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
