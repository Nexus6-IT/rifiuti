import { Prisma } from '@prisma/client'

/**
 * Riga di audit nella transazione del chiamante (D11). Il testo `description` non contiene id
 * d'azienda, dati fiscali o testo libero: i dettagli stanno in `metadata` (numeri, id di pesata,
 * lunghezze dei testi).
 */
export async function scriviAuditPese(
  tx: Prisma.TransactionClient,
  tenantId: string,
  userId: string,
  action: string,
  description: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await tx.activityLog.create({
    data: { tenantId, userId, action, description, metadata: metadata as Prisma.InputJsonValue },
  })
}
