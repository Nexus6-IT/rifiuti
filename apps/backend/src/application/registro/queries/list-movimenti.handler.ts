import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { Result } from '../../../core/application/result'
import { ListMovimentiQuery, PaginatedMovimenti } from './list-movimenti.query'

export type TipoAnnotazioneItem = 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
export type StatoMovimento = 'VIGENTE' | 'RETTIFICATO' | 'ANNULLATO'

/** Numero del registro (anno/numero) di un'annotazione collegata, con il suo tipo. */
export interface RiferimentoAnnotazione {
  progressiveNumber: number
  progressiveYear: number
  tipoAnnotazione: TipoAnnotazioneItem
}

export interface MovimentoListItem {
  id: string
  tenantId: string
  registroId: string
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
  tipoAnnotazione: TipoAnnotazioneItem
  motivoAnnotazione?: string
  /** Annotazione che questa rettifica o annullamento corregge (il predecessore diretto). */
  rettificaDi?: RiferimentoAnnotazione
  /** Annotazione che corregge questa (rettifica o annullamento successivo). */
  correttoDa?: RiferimentoAnnotazione
  /**
   * VIGENTE: conta nei calcoli. RETTIFICATO: sostituita da una correzione piu recente.
   * ANNULLATO: la testa della sua catena e un ANNULLAMENTO (compresa la riga di annullamento).
   */
  stato: StatoMovimento
}

const RIFERIMENTO = {
  select: { progressiveNumber: true, progressiveYear: true, tipoAnnotazione: true },
} as const

function riferimento(r: {
  progressiveNumber: number
  progressiveYear: number
  tipoAnnotazione: string
}): RiferimentoAnnotazione {
  return {
    progressiveNumber: r.progressiveNumber,
    progressiveYear: r.progressiveYear,
    tipoAnnotazione: r.tipoAnnotazione as TipoAnnotazioneItem,
  }
}

function statoDi(
  r: { correzioni: unknown[] },
  tipoTesta: TipoAnnotazioneItem | undefined
): StatoMovimento {
  if (tipoTesta === 'ANNULLAMENTO') return 'ANNULLATO'
  return r.correzioni.length > 0 ? 'RETTIFICATO' : 'VIGENTE'
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
    if (query.filters?.registroId) where['registroId'] = query.filters.registroId

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
        include: {
          rettificato: RIFERIMENTO,
          // Al piu una (unico su movimento_rettificato_id): una lista per la relazione 1:n.
          correzioni: RIFERIMENTO,
        },
      }),
    ])

    const tipiTesta = await this.tipiDelleTeste(
      query.tenantId,
      records.filter(r => r.correzioni.length > 0).map(r => r.id)
    )

    const items: MovimentoListItem[] = records.map(r => ({
      id: r.id,
      tenantId: r.tenantId,
      registroId: r.registroId,
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
      tipoAnnotazione: r.tipoAnnotazione,
      motivoAnnotazione: r.motivoAnnotazione ?? undefined,
      rettificaDi: r.rettificato ? riferimento(r.rettificato) : undefined,
      correttoDa: r.correzioni[0] ? riferimento(r.correzioni[0]) : undefined,
      stato: statoDi(r, tipiTesta.get(r.id) ?? (r.tipoAnnotazione as TipoAnnotazioneItem)),
    }))

    return Result.ok({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  }

  /**
   * Tipo dell'annotazione in testa alla catena di ciascun id, con UNA query ricorsiva (niente N+1):
   * si scende da ogni riga seguendo `movimento_rettificato_id` fino alla riga che nessuna
   * corregge. Servono solo gli id con una correzione: gli altri sono la propria testa.
   */
  private async tipiDelleTeste(
    tenantId: string,
    ids: string[]
  ): Promise<Map<string, TipoAnnotazioneItem>> {
    const tipi = new Map<string, TipoAnnotazioneItem>()
    if (ids.length === 0) return tipi
    const righe = await this.prisma.$queryRaw<
      Array<{ partenza: string; tipo_testa: TipoAnnotazioneItem }>
    >(Prisma.sql`
      WITH RECURSIVE catena AS (
        SELECT id AS partenza, id, tipo_annotazione, 0 AS livello
        FROM waste_movements
        WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids}::uuid[])
        UNION ALL
        SELECT c.partenza, n.id, n.tipo_annotazione, c.livello + 1
        FROM catena c
        JOIN waste_movements n
          ON n.movimento_rettificato_id = c.id AND n.tenant_id = ${tenantId}::uuid
        WHERE c.livello < 1000
      )
      SELECT DISTINCT ON (partenza) partenza, tipo_annotazione::text AS tipo_testa
      FROM catena
      ORDER BY partenza, livello DESC
    `)
    for (const r of righe) tipi.set(r.partenza, r.tipo_testa)
    return tipi
  }
}
