import { limitiAnnoMud } from '../mud/aggregazione/mud-regole'
import { chiaveMovimento } from '../mud/aggregazione/mud-integrazioni'
import { WHERE_VIGENTE } from '../../domain/waste-movement/vigenza'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import type { FirBilancio, MovimentoBilancio } from './complementi-bilancio'

// Lettore dei movimenti del bilancio: stessa finestra e stessa vigenza del MUD, così i numeri
// coincidono. Le funzioni pure di complementi-bilancio filtrano solo sulla data `al`: il filtro
// sulla data `dal` (inizio dell'anno italiano) e quello sui movimenti vigenti sono qui.

const SELECT_MOVIMENTO = {
  type: true,
  causale: true,
  causaleAziendaId: true,
  movementDate: true,
  quantity: true,
  unit: true,
  operationCode: true,
  firId: true,
  progressiveNumber: true,
  progressiveYear: true,
  registroId: true,
} as const

const SELECT_FIR = {
  id: true,
  status: true,
  firNumber: true,
  rentriNumeroFir: true,
  rentriStatoFormulario: true,
  wasteOperationCode: true,
} as const

/** Movimenti vigenti dell'anno italiano del tenant, con il FIR collegato (nello stesso tenant). */
export async function leggiMovimentiAnno(
  prisma: PrismaService,
  tenantId: string,
  anno: number
): Promise<MovimentoBilancio[]> {
  const { inizio, fine } = limitiAnnoMud(anno)
  // Client Prisma senza estensione RLS: ogni query porta il tenantId.
  const righe = await prisma.wasteMovement.findMany({
    where: { tenantId, movementDate: { gte: inizio, lt: fine }, ...WHERE_VIGENTE },
    select: SELECT_MOVIMENTO,
    orderBy: [{ movementDate: 'asc' }, { progressiveNumber: 'asc' }],
  })

  const firIds = [...new Set(righe.map(r => r.firId).filter((id): id is string => !!id))]
  const firPerId = new Map<string, FirBilancio>()
  if (firIds.length > 0) {
    const fir = await prisma.fIR.findMany({
      where: { tenantId, id: { in: firIds } },
      select: SELECT_FIR,
    })
    for (const f of fir) firPerId.set(f.id, f)
  }

  return righe.map(r => ({
    type: r.type,
    causale: r.causale,
    causaleAziendaId: r.causaleAziendaId,
    movementDate: r.movementDate,
    quantity: Number(r.quantity),
    unit: r.unit,
    operationCode: r.operationCode,
    chiave: chiaveMovimento(r.progressiveYear, r.progressiveNumber, r.registroId),
    fir: r.firId ? (firPerId.get(r.firId) ?? null) : null,
  }))
}
