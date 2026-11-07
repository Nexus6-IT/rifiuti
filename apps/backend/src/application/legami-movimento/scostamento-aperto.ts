import { Prisma } from '@prisma/client'

/**
 * Scostamento aperto: l'UNICA definizione, per la lista degli scostamenti, il totale, la presa
 * d'atto e il suo UPDATE, e per `scostamentoAperto` della vista del legame. `alias` e' un nome
 * fisso scritto dal chiamante (mai input), vuoto per la tabella senza alias.
 */
export function condizioneScostamentoAperto(alias: string): Prisma.Sql {
  const c = Prisma.raw(alias === '' ? '' : `${alias}.`)
  return Prisma.sql`(${c}scostamento_dopo_fattura AND (${c}scostamento_gestito_il IS NULL OR ${c}scostamento_il > ${c}scostamento_gestito_il))`
}
