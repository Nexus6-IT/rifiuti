import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { Result } from '../../../core/application/result'
import { ListMovimentiQuery, PaginatedMovimenti } from './list-movimenti.query'

export interface MovimentoListItem {
  id: string
  tenantId: string
  progressiveNumber: number
  progressiveYear: number
  type: string
  movementDate: Date
  registrationDate: Date
  causale: string
  cerCode: string
  wasteDescription?: string
  quantity: number
  unit: string
  wastePhysicalState?: string
  wasteHazardClasses?: string
  operationCode?: string
  counterpartName?: string
  counterpartAddress?: string
  firId?: string
  recordedByUserId?: string
  entryHash: string
  notes?: string
  createdAt: Date
}

/**
 * Query handler per la lista del registro cronologico di carico/scarico.
 * Filtri: tipo, CER, causale, periodo (dataFrom/dataTo), FIR.
 * Ordinamento per data operazione DESC (più recente prima).
 */
@Injectable()
export class ListMovimentiHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: ListMovimentiQuery): Promise<Result<PaginatedMovimenti<MovimentoListItem>>> {
    const page = query.pagination?.page ?? 1
    const limit = Math.min(query.pagination?.limit ?? 20, 100)
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = { tenantId: query.tenantId }

    if (query.filters?.type) where['type'] = query.filters.type
    if (query.filters?.cerCode)
      where['cerCode'] = { contains: query.filters.cerCode, mode: 'insensitive' }
    if (query.filters?.causale) where['causale'] = query.filters.causale
    if (query.filters?.firId) where['firId'] = query.filters.firId

    if (query.filters?.dataFrom || query.filters?.dataTo) {
      where['movementDate'] = {
        ...(query.filters.dataFrom ? { gte: query.filters.dataFrom } : {}),
        ...(query.filters.dataTo ? { lte: query.filters.dataTo } : {}),
      }
    }

    const [total, records] = await Promise.all([
      this.prisma.wasteMovement.count({ where }),
      this.prisma.wasteMovement.findMany({
        where,
        orderBy: [{ movementDate: 'desc' }, { progressiveNumber: 'desc' }],
        skip,
        take: limit,
      }),
    ])

    const items: MovimentoListItem[] = records.map(r => ({
      id: r.id,
      tenantId: r.tenantId,
      progressiveNumber: r.progressiveNumber,
      progressiveYear: r.progressiveYear,
      type: r.type,
      movementDate: r.movementDate,
      registrationDate: r.registrationDate,
      causale: r.causale,
      cerCode: r.cerCode,
      wasteDescription: r.wasteDescription ?? undefined,
      quantity: Number(r.quantity),
      unit: r.unit,
      wastePhysicalState: r.wastePhysicalState ?? undefined,
      wasteHazardClasses: r.wasteHazardClasses ?? undefined,
      operationCode: r.operationCode ?? undefined,
      counterpartName: r.counterpartName ?? undefined,
      counterpartAddress: r.counterpartAddress ?? undefined,
      firId: r.firId ?? undefined,
      recordedByUserId: r.recordedByUserId ?? undefined,
      entryHash: r.entryHash,
      notes: r.notes ?? undefined,
      createdAt: r.createdAt,
    }))

    return Result.ok({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  }
}
