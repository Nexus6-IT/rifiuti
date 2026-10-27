import { Prisma } from '@prisma/client'

/**
 * Vigenza di un'annotazione del registro (Fase 2 pezzo 3, R2): definizione UNICA, usata da ogni
 * lettore che calcola giacenze, MUD o anomalie.
 *
 * Una rettifica sostituisce la precedente; un annullamento toglie dai conteggi l'intera catena.
 * Vigente = non e' un ANNULLAMENTO e nessuna riga la indica come predecessore
 * (`movimento_rettificato_id`). Di una catena e' vigente al piu' la testa, e solo se non e'
 * un ANNULLAMENTO.
 */

/** Filtro Prisma per `findMany`/`count`/`aggregate` e anche per `groupBy`. */
export const WHERE_VIGENTE = {
  tipoAnnotazione: { not: 'ANNULLAMENTO' },
  correzioni: { none: {} },
} satisfies Prisma.WasteMovementWhereInput

/** Alias di tabella ammessi nello SQL grezzo: costanti nel codice, mai input utente. */
const ALIAS_AMMESSO = /^[a-z_][a-z0-9_]*$/

/**
 * Condizione SQL equivalente a `WHERE_VIGENTE`, per le query grezze su `waste_movements`.
 * `alias` e' l'alias con cui la tabella compare nella query (es. `m`); non deve mai venire
 * da input dell'utente (e infatti si accetta solo un identificatore semplice). La sottoquery usa
 * l'alias interno `c_vig`, quindi non confligge con quello del chiamante.
 */
export function sqlVigente(alias: string): Prisma.Sql {
  if (!ALIAS_AMMESSO.test(alias)) {
    throw new Error('Alias SQL non valido per sqlVigente')
  }
  const a = Prisma.raw(alias)
  return Prisma.sql`(${a}.tipo_annotazione <> 'ANNULLAMENTO' AND NOT EXISTS (SELECT 1 FROM waste_movements c_vig WHERE c_vig.movimento_rettificato_id = ${a}.id))`
}
