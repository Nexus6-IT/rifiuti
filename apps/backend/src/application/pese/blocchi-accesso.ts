// Ordine dei lock sugli accessi (D9). TUTTE le transazioni che toccano un accesso li prendono in
// QUESTO ordine, e nessuna in un altro:
//   1. advisory lock di transazione `accesso-pesa|<id>`  (serializza chi scrive pesate, chiude,
//      annulla, collega);
//   2. `SELECT ... FOR UPDATE` sulla riga dell'accesso    (chi chiude o annulla la tiene fino al
//      commit; i trigger `pesate_controlli`/`collegamenti_accesso_controlli` leggono la stessa
//      riga con `FOR SHARE`, quindi un inserimento che sfuggisse al punto 1 aspetterebbe qui).
// Aperture con tara dichiarata, in questo ordine: chiave di idempotenza -> automezzo
// `FOR NO KEY UPDATE` (PRIMA di creare l'accesso) -> advisory della numerazione -> insert
// dell'accesso -> insert delle pesate. `FOR NO KEY UPDATE` non confligge con il `KEY SHARE` che
// l'FK `accessi_pesa_automezzo_fkey` prende sull'automezzo, ma serializza sia le altre aperture
// dello stesso mezzo sia `impostaTara` (un UPDATE di colonne non chiave); `FOR UPDATE` invece
// avrebbe creato un deadlock fra due aperture dello stesso mezzo su registri diversi (una con
// KEY SHARE da FK, l'altra in attesa di FOR UPDATE).
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

/**
 * Blocca l'automezzo con `FOR NO KEY UPDATE` (vedi sopra). Va chiamato PRIMA di creare l'accesso
 * che lo referenzia; poi la lettura della tara nella stessa transazione e' stabile.
 */
export async function bloccaAutomezzo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  automezzoId: string
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM automezzi
    WHERE id = ${automezzoId}::uuid AND tenant_id = ${tenantId}::uuid FOR NO KEY UPDATE`
}
