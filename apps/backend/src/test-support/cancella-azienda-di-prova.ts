import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Cancellazione di aziende di prova (I3, protezione del registro dalla cascata).
 *
 * Il trigger `tenants_registro_protetto` rifiuta `DELETE FROM tenants` se l'azienda ha movimenti, FIR
 * o lotti di import. Le pulizie dei test e gli script di manutenzione lo superano impostando nella
 * transazione `app.consenti_cancellazione_azienda = 'on'` (`SET LOCAL`: vale solo per quella
 * transazione). Il trigger accetta il flag SOLO da una sessione superuser, cioe' dal proprietario del
 * database di test: il client `wasteflow_app` lo puo' impostare ma non ottiene nulla.
 */
export const GUC_CONSENTI_CANCELLAZIONE_AZIENDA = 'app.consenti_cancellazione_azienda'

/** Cancella UN'azienda dentro la transazione `tx` (che deve essere del proprietario). */
export async function cancellaAziendaDiProva(
  tx: Prisma.TransactionClient,
  id: string
): Promise<void> {
  await tx.$executeRawUnsafe(`SET LOCAL ${GUC_CONSENTI_CANCELLAZIONE_AZIENDA} = 'on'`)
  await tx.tenant.delete({ where: { id } })
}

/**
 * Cancella una o piu' aziende (id esatti) in una sola transazione del client proprietario.
 * Nessuna azienda mancante e' un errore: come `deleteMany`, gli id gia' assenti si ignorano.
 */
export async function cancellaAziendeDiProva(
  owner: Pick<PrismaClient, '$transaction'>,
  ids: string | readonly string[] | { in: readonly string[] }
): Promise<void> {
  const elenco =
    typeof ids === 'string'
      ? [ids]
      : Array.isArray(ids)
        ? [...ids]
        : [...(ids as { in: readonly string[] }).in]
  if (elenco.length === 0) return
  await owner.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL ${GUC_CONSENTI_CANCELLAZIONE_AZIENDA} = 'on'`)
    // Le figlie prima delle madri (FK `Restrict` su `parent_tenant_id`).
    await tx.tenant.deleteMany({ where: { id: { in: elenco }, parentTenantId: { not: null } } })
    await tx.tenant.deleteMany({ where: { id: { in: elenco } } })
  })
}
