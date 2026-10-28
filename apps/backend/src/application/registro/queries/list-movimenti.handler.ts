import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { Result } from '../../../core/application/result'
import { LoggerService } from '../../../core/logger/logger.service'
import { giornoItaliano } from '../../../core/time/anno-italiano'
import { caricaCatalogoCausali } from '../causali/catalogo-causali.repository'
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
  /** Descrizione della versione della causale (o della riga di sistema); per un codice sconosciuto, il codice. */
  causaleDescrizione: string
  /** Comportamento verso RENTRI della causale (informativo). */
  causaleCodiceRentri: string | null
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

/** Profondita massima della ricorsione che cerca la testa di una catena di correzioni. */
const LIVELLO_MASSIMO = 1000

/**
 * Query handler per la lista del registro cronologico di carico/scarico.
 * Filtri: tipo, CER, causale, periodo (dataFrom/dataTo), FIR.
 * Ordinamento per data operazione DESC (più recente prima).
 */
@Injectable()
export class ListMovimentiHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(ListMovimentiHandler.name)
  }

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

    const conCorrezioni = records.filter(r => r.correzioni.length > 0).map(r => r.id)
    const tipiTesta = await this.tipiDelleTeste(query.tenantId, conCorrezioni)
    // Una riga con una correzione deve avere la testa: senza, lo stato ricadrebbe sul tipo della
    // riga stessa (una rettificata sembrerebbe vigente). Non deve accadere: lo si dice nel log.
    const senzaTesta = conCorrezioni.filter(id => !tipiTesta.has(id))
    if (senzaTesta.length > 0) {
      this.logger.warn(
        'Elenco registro: la query ricorsiva non ha restituito la testa della catena, ' +
          'lo stato ricade sul tipo della riga',
        { righe: senzaTesta.length }
      )
    }

    // Il catalogo si legge UNA volta per pagina; ogni riga lo interroga con la sua versione e il
    // giorno italiano dell'operazione.
    // Pagina vuota: niente da descrivere, il catalogo non si legge.
    const catalogo =
      records.length > 0 ? await caricaCatalogoCausali(this.prisma, query.tenantId) : null

    const items: MovimentoListItem[] = records.map(r => {
      const verso = r.type === 'CARICO' ? 'CARICO' : 'SCARICO'
      const definizione = catalogo?.comportamento(
        verso,
        r.causale,
        giornoItaliano(r.movementDate),
        r.causaleAziendaId
      )
      return {
        id: r.id,
        tenantId: r.tenantId,
        registroId: r.registroId,
        progressiveNumber: r.progressiveNumber,
        progressiveYear: r.progressiveYear,
        type: r.type,
        movementDate: r.movementDate,
        registrationDate: r.registrationDate,
        causale: r.causale,
        causaleDescrizione: definizione?.descrizione ?? r.causale,
        causaleCodiceRentri: definizione?.codiceRentri ?? null,
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
      }
    })

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
    // La condizione `livello < LIVELLO_MASSIMO` e' una guardia contro un ciclo (A corregge B che
    // corregge A), che farebbe girare la ricorsione per sempre: il database non lo vieta del tutto e
    // una catena vera non arriva a quella profondita. Se scatta la ricorsione si ferma a meta' catena
    // e la testa restituita e' SBAGLIATA: per questo si controlla il livello e si registra un warning.
    const righe = await this.prisma.$queryRaw<
      Array<{ partenza: string; tipo_testa: TipoAnnotazioneItem; livello: number }>
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
        WHERE c.livello < ${LIVELLO_MASSIMO}
      )
      SELECT DISTINCT ON (partenza) partenza, tipo_annotazione::text AS tipo_testa, livello
      FROM catena
      ORDER BY partenza, livello DESC
    `)
    for (const r of righe) tipi.set(r.partenza, r.tipo_testa)
    const troncate = righe.filter(r => Number(r.livello) >= LIVELLO_MASSIMO).length
    if (troncate > 0) {
      this.logger.warn(
        'Elenco registro: catena di correzioni arrivata alla profondita massima, la testa ' +
          'restituita non è affidabile',
        { catene: troncate, livelloMassimo: LIVELLO_MASSIMO }
      )
    }
    return tipi
  }
}
