import type { Prisma } from '@prisma/client'

/**
 * Sede della ditta controparte del movimento (`waste_movements.counterpart_sede_id`): messaggio e
 * controllo di appartenenza condivisi da registrazione e rettifica. Il controllo e' solo di
 * appartenenza all'azienda: una sede disattivata si accetta (era quella scelta) e non si confronta
 * il nome (nessun blocco falso: ci pensa il form).
 */
export const MSG_SEDE_CONTROPARTE_NON_TROVATA = "Sede della controparte non trovata nell'azienda"

export async function sedeControparteEsiste(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sedeId: string
): Promise<boolean> {
  const sede = await tx.sedeDitta.findFirst({
    where: { id: sedeId, tenantId },
    select: { id: true },
  })
  return sede !== null
}
