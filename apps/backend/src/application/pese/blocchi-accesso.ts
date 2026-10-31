// Ordine dei lock sugli accessi (D9). TUTTE le transazioni che toccano un accesso li prendono in
// QUESTO ordine, e nessuna in un altro:
//   1. advisory lock di transazione `accesso-pesa|<id>`  (serializza chi scrive pesate, chiude,
//      annulla, collega);
//   2. `SELECT ... FOR UPDATE` sulla riga dell'accesso    (chi chiude o annulla la tiene fino al
//      commit; i trigger `pesate_controlli`/`collegamenti_accesso_controlli` leggono la stessa
//      riga con `FOR SHARE`, quindi un inserimento che sfuggisse al punto 1 aspetterebbe qui).
// Con il punto 1 sempre per primo non esiste un ciclo di attese: niente deadlock fra
// `FOR SHARE` (trigger) e l'`UPDATE` successivo sulla stessa riga. Mai `FOR UPDATE` su pesate,
// rettifiche e allegati (il ruolo applicativo non ha UPDATE: D4).
import { Prisma } from '@prisma/client'
import { AccessoNonTrovatoError } from './errori-pese'

export async function bloccaAccessoAdvisory(
  tx: Prisma.TransactionClient,
  accessoId: string
): Promise<void> {
  const chiave = `accesso-pesa|${accessoId}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
}

/**
 * Advisory lock + `FOR UPDATE` sulla riga dell'accesso dell'azienda, poi rilegge la riga
 * (rilettura dopo il lock: vede lo stato committato da chi ci ha preceduto).
 */
export async function bloccaAccesso(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  await bloccaAccessoAdvisory(tx, id)
  const righe = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM accessi_pesa
    WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`
  if (righe.length === 0) throw new AccessoNonTrovatoError()
  const accesso = await tx.accessoPesa.findFirst({ where: { id, tenantId } })
  if (!accesso) throw new AccessoNonTrovatoError()
  return accesso
}

/** Lock per la sola chiave di idempotenza (doppio clic prima che esista l'accesso). */
export async function bloccaChiaveIdempotenza(
  tx: Prisma.TransactionClient,
  tenantId: string,
  chiave: string
): Promise<void> {
  const k = `pesata-chiave|${tenantId}|${chiave}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))`
}
