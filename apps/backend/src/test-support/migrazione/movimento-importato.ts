/**
 * Solo per i test (Fase 3, 3.1): crea, col client del PROPRIETARIO, un movimento importato con la sua
 * riga di blocco `DA_RICONCILIARE` nella stessa transazione, come dovra' fare il caricatore (D3). Il
 * trigger differito `waste_movements_importato_bloccato` e' chiuso con `SET CONSTRAINTS ... IMMEDIATE`
 * perche' il client e' nudo: Prisma 5.22 non segnala l'errore del COMMIT e il client esteso di
 * `PrismaService`, che chiude i vincoli da solo, qui non c'e'.
 */
import type { PrismaClient } from '@prisma/client'

let chiaveN = 0
let numeroN = 0

export interface AziendaPerImportati {
  tenantId: string
  registroId: string
  lottoId: string
}

/** Lotto di prova per l'azienda (il proprietario lo scrive; la RLS non lo ferma). */
export async function lottoDiProva(
  owner: PrismaClient,
  tenantId: string,
  archivio = 'WW00012026'
): Promise<string> {
  const lotto = await owner.lottoImport.create({
    data: {
      tenantId,
      importSource: 'WINWASTE',
      archivio,
      ambito: 'REGISTRO',
      formatoStaging: 'winwaste-staging/1',
      hashStaging: 'a'.repeat(64),
    },
  })
  return lotto.id
}

export async function creaMovimentoImportato(
  owner: PrismaClient,
  az: AziendaPerImportati,
  extra: Record<string, unknown> = {}
): Promise<{ movimentoId: string }> {
  const progressivo = 900_000 + ++numeroN
  return await owner.$transaction(async tx => {
    const m = await tx.wasteMovement.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroId,
        progressiveYear: 2026,
        progressiveNumber: progressivo,
        type: 'CARICO',
        movementDate: new Date('2026-03-01T10:00:00Z'),
        registrationDate: new Date('2026-03-01T10:00:00Z'),
        causale: 'PRODUZIONE_INTERNA',
        cerCode: '15 01 01',
        wastePhysicalState: 'Solido',
        quantity: 10,
        unit: 'KG',
        importSource: 'WINWASTE',
        legacyKey: `0001|2026|MOVIMENTI|${++chiaveN}-${progressivo}`,
        lottoImportId: az.lottoId,
        ...extra,
      } as never,
    })
    await tx.movimentoTrasmissioneRentri.create({
      data: {
        tenantId: az.tenantId,
        movimentoId: m.id,
        registroId: az.registroId,
        tipo: 'CARICO',
        origine: 'IMPORTAZIONE',
        stato: 'DA_RICONCILIARE',
        bloccatoInvio: true,
        motivoBlocco: 'Importato: in attesa di riconciliazione',
      },
    })
    await tx.$executeRawUnsafe('SET CONSTRAINTS "waste_movements_importato_bloccato" IMMEDIATE')
    return { movimentoId: m.id }
  })
}
