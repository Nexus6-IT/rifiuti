// Il «giorno italiano» di un movimento in SQL (fase 4.3, decisione 7). Un'unica definizione per il
// conteggio dei movimenti toccati da «fatturazione da», per la proposta e per la lista «da
// collegare»: in codice si usa `giornoItaliano` (`core/time/anno-italiano.ts`), qui la stessa cosa
// per le query. Il test `giorno-movimento.postgres.spec.ts` le confronta sui bordi.
import { Prisma } from '@prisma/client'

/**
 * Frammento SQL: giorno di calendario di Roma di `<alias>.movement_date` (colonna `timestamp`
 * senza fuso che contiene l'istante UTC), come `date`. `alias` è un nome di tabella semplice.
 */
export function sqlGiornoMovimento(alias: string): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error('sqlGiornoMovimento: alias non valido')
  }
  return Prisma.raw(
    `((${alias}.movement_date AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date`
  )
}
