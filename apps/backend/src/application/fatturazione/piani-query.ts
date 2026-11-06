// Utilita' per tenere stabili i piani delle query della fatturazione (fase 4.4b1, Task 27a).
// Modulo neutro: lo importano sia la selezione sia la definitiva, l'annullo e lo storno, senza
// creare cicli di import.
import type { Prisma } from '@prisma/client'
import { joinLineari } from '../listino/lock-listino'

/**
 * Esegue `fn` con il nested loop spento (query `JOIN unnest` su liste grandi) e lo RIPRISTINA
 * appena finita (scansione P46): le letture che seguono ritrovano il planner com'era. Se `fn`
 * fallisce la transazione e' abortita e il rollback ripristina da solo il `SET LOCAL`.
 */
export async function conJoinLineari<R>(
  tx: Prisma.TransactionClient,
  fn: () => Promise<R>
): Promise<R> {
  const [{ v }] = await tx.$queryRaw<
    { v: string }[]
  >`SELECT current_setting('enable_nestloop') AS v`
  await joinLineari(tx)
  const risultato = await fn()
  await tx.$queryRaw`SELECT set_config('enable_nestloop', ${v}, true)`
  return risultato
}
