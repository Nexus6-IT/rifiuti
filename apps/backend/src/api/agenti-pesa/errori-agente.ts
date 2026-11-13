import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

/** Codici stabili letti dall'agente (Go): 401 = token da rifare, 403 = agente revocato. */
export const TOKEN_NON_VALIDO = 'TOKEN_NON_VALIDO'
export const AGENTE_REVOCATO = 'AGENTE_REVOCATO'

export const tokenNonValido = (): UnauthorizedException =>
  new UnauthorizedException({
    error: TOKEN_NON_VALIDO,
    message: "Token dell'agente non valido.",
  })

export const agenteRevocato = (): ForbiddenException =>
  new ForbiddenException({
    error: AGENTE_REVOCATO,
    message: "L'agente e' stato revocato: non puo' piu' inviare letture.",
  })
