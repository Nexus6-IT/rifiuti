// Utilita' per tenere stabili i piani delle query della fatturazione (fase 4.4b1, Task 27a).
// Modulo neutro: lo importano sia la selezione sia la definitiva, l'annullo e lo storno, senza
// creare cicli di import.
import type { Prisma } from '@prisma/client'
import { joinLineari } from '../listino/lock-listino'

/**
 * Esegue `fn` con il nested loop spento (query `JOIN unnest` su liste grandi) e lo RIPRISTINA
 * appena finita (scansione P46): le letture che seguono ritrovano il planner com'era. Il
 * ripristino avviene anche se `fn` lancia: un errore di dominio che il chiamante cattura restando
 * nella transazione non lascia il planner alterato. Se invece l'errore ha abortito la transazione
 * il ripristino fallirebbe e nasconderebbe l'errore vero: lo si ignora, perche' il rollback
 * ripristina da solo il `SET LOCAL`.
 */
export async function conJoinLineari<R>(
  tx: Prisma.TransactionClient,
  fn: () => Promise<R>
): Promise<R> {
  const [{ v }] = await tx.$queryRaw<
    { v: string }[]
  >`SELECT current_setting('enable_nestloop') AS v`
  await joinLineari(tx)
  let risultato: R
  try {
    risultato = await fn()
  } catch (errore) {
    await tx.$queryRaw`SELECT set_config('enable_nestloop', ${v}, true)`.catch(() => undefined)
    throw errore
  }
  await tx.$queryRaw`SELECT set_config('enable_nestloop', ${v}, true)`
  return risultato
}
