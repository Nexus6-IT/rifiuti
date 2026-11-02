// Traduzione degli errori di concorrenza delle variazioni di prezzo (R46), condivisa fra la
// variazione dell'archivio (Task 10) e quella dei contratti (Task 24).
import { ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { MSG_OPERAZIONE_CONCORRENTE } from '../clienti/anagrafica-versionata'

export const MSG_VARIAZIONE_SUPERATA = 'I prezzi sono cambiati dopo l’anteprima: rifai l’anteprima.'
export { MSG_OPERAZIONE_CONCORRENTE }

/**
 * Deadlock (P2034 o 40P01 dal raw) e lock timeout (55P03) valgono "i dati sono cambiati": si rifa
 * l'anteprima (409 `VARIAZIONE_SUPERATA`). Il timeout della transazione (P2028) non dice che i
 * dati sono cambiati, solo che l'operazione e' stata interrotta: 409 `OPERAZIONE_CONCORRENTE`
 * ("riprova"). Ogni altro errore passa com'e'.
 */
export function traduciConflitto(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const codiceDb = (err.meta as { code?: unknown } | undefined)?.code
    if (err.code === 'P2028') {
      throw new ConflictException({
        message: MSG_OPERAZIONE_CONCORRENTE,
        error: 'OPERAZIONE_CONCORRENTE',
      })
    }
    if (err.code === 'P2034' || codiceDb === '40P01' || codiceDb === '55P03') {
      throw new ConflictException({
        message: MSG_VARIAZIONE_SUPERATA,
        error: 'VARIAZIONE_SUPERATA',
      })
    }
  }
  throw err
}
