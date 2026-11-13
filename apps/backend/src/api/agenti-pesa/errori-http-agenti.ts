import { NotFoundException, UnauthorizedException } from '@nestjs/common'
import {
  AgentePesaNonTrovatoError,
  CodiceAbbinamentoNonValidoError,
} from '../../application/pese/errori-pese'
import { comeHttpPese } from '../pese/errori-http'

export const CODICE_NON_VALIDO = 'CODICE_NON_VALIDO'

/**
 * Errori dell'ingresso dell'agente tradotti in HTTP; gli altri passano da `comeHttpPese`.
 * Ogni codice di abbinamento non valido ha lo STESSO corpo (nessun indizio su quale sia il caso).
 */
export function comeHttpAgente<R>(fn: () => Promise<R>): Promise<R> {
  return comeHttpPese(async () => {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof CodiceAbbinamentoNonValidoError) {
        throw new UnauthorizedException({ error: CODICE_NON_VALIDO, message: err.message })
      }
      if (err instanceof AgentePesaNonTrovatoError) throw new NotFoundException(err.message)
      throw err
    }
  })
}
