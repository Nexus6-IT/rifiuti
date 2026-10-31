import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { DomainError } from '../../core/domain/errors'
import {
  AccessoNonTrovatoError,
  AlibiGiaUsatoError,
  AllegatoNonTrovatoError,
  AllegatoNonValidoError,
  AutomezzoDuplicatoError,
  AutomezzoNonTrovatoError,
  CollegamentoNonTrovatoError,
  CollegamentoNonValidoError,
  DatiPesaNonValidiError,
  FirNonTrovatoError,
  PesataNonTrovataError,
  RegolaPesataError,
  RuoloPesaInsufficienteError,
  StatoAccessoNonValidoError,
  StrumentoDuplicatoError,
  StrumentoNonTrovatoError,
  TrasportatoreNonTrovatoError,
} from '../../application/pese/errori-pese'
import { RegistroNonTrovatoError } from '../../application/registro/registri.service'

/** Errori di dominio delle pese tradotti in HTTP, con messaggi senza id. */
export async function comeHttpPese<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof DatiPesaNonValidiError) {
      throw new BadRequestException({
        message: err.message,
        error: 'PESE_DATI_NON_VALIDI',
        details: { messaggi: err.messaggi },
      })
    }
    if (err instanceof RegolaPesataError) {
      throw new UnprocessableEntityException({
        message: err.message,
        error: 'PESE_REGOLA_NON_RISPETTATA',
        details: { messaggi: err.messaggi },
      })
    }
    if (
      err instanceof AutomezzoDuplicatoError ||
      err instanceof StrumentoDuplicatoError ||
      err instanceof AlibiGiaUsatoError ||
      err instanceof StatoAccessoNonValidoError
    ) {
      throw new ConflictException(err.message)
    }
    if (err instanceof CollegamentoNonValidoError) {
      throw new UnprocessableEntityException({
        message: err.message,
        error: 'PESE_COLLEGAMENTO_NON_VALIDO',
      })
    }
    if (err instanceof RuoloPesaInsufficienteError) {
      throw new ForbiddenException({ message: err.message, error: 'PESE_RUOLO_INSUFFICIENTE' })
    }
    if (err instanceof AllegatoNonValidoError) {
      throw new BadRequestException(err.message)
    }
    if (
      err instanceof AutomezzoNonTrovatoError ||
      err instanceof StrumentoNonTrovatoError ||
      err instanceof TrasportatoreNonTrovatoError ||
      err instanceof PesataNonTrovataError ||
      err instanceof AccessoNonTrovatoError ||
      err instanceof AllegatoNonTrovatoError ||
      err instanceof CollegamentoNonTrovatoError ||
      err instanceof FirNonTrovatoError
    ) {
      throw new NotFoundException(err.message)
    }
    if (err instanceof RegistroNonTrovatoError) throw new NotFoundException('Registro non trovato.')
    if (err instanceof DomainError) throw new BadRequestException(err.message)
    throw err
  }
}
