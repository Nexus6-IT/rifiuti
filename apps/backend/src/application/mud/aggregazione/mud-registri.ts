import type { PrismaService } from '../../../infrastructure/persistence/prisma.service'

/**
 * Etichette dei registri dell'azienda (id -> sede), SOLO se ne ha più di uno: con un registro
 * solo i movimenti non sono ambigui e i testi restano quelli di sempre (mappa vuota). Serve a
 * distinguere "n. 5/2025" della sede A da quello della sede B negli avvisi e nelle integrazioni.
 */
export async function etichetteRegistri(
  prisma: Pick<PrismaService, 'registroRifiuti'>,
  tenantId: string
): Promise<Map<string, string>> {
  const registri = await prisma.registroRifiuti.findMany({
    where: { tenantId },
    select: { id: true, descrizione: true, unitaLocale: { select: { denominazione: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (registri.length <= 1) return new Map()
  return new Map(registri.map(r => [r.id, r.unitaLocale?.denominazione ?? r.descrizione]))
}
