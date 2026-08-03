import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { RENTRISyncLog } from '../../domain/rentri/rentri-sync-log.aggregate'
import { ITenantRepository } from '../../domain/shared/repository.interface'
import { TenantContext } from '../../core/context/tenant-context'

/**
 * RENTRI Sync Log Repository
 *
 * Persists RENTRI sync logs using Prisma.
 * Implements tenant isolation via RLS extension.
 *
 * De-stubbato nel Task 3 (R0): il modello `RENTRISyncLog` è stato creato nel
 * Task 1 (migrazione 20260726055703_legame_rentri) proprio per corrispondere
 * a queste chiamate — l'accessor generato da Prisma è `prisma.rENTRISyncLog`
 * (prima lettera del nome modello abbassata), vedi commento sul modello in
 * schema.prisma.
 *
 * Cablaggio R0 Task 4: il costruttore accettava un `tenantId: string`
 * primitivo fissato per istanza — incompatibile con un provider Nest
 * singleton in un contesto multi-tenant (Nest non sa risolvere una stringa
 * grezza, e un solo tenant "congelato" nell'istanza sarebbe comunque sbagliato
 * per un repository condiviso da tutte le richieste). Sostituito da
 * `TenantContext.requireTenantId()`, lo stesso pattern già usato dagli altri
 * repository del progetto (v. `produttore-prisma.repository.ts`) proprio per
 * questo motivo: fail-closed, risolto per-richiesta da AsyncLocalStorage.
 */
@Injectable()
export class RENTRISyncLogRepository implements ITenantRepository<RENTRISyncLog> {
  constructor(private readonly prisma: PrismaClient) {}

  getTenantId(): string {
    return TenantContext.requireTenantId()
  }

  /**
   * Save sync log
   */
  async save(syncLog: RENTRISyncLog): Promise<RENTRISyncLog> {
    const data = {
      id: syncLog.id,
      firId: syncLog.firId,
      tenantId: syncLog.tenantId,
      status: syncLog.status,
      attempt: syncLog.attempt,
      requestPayload: syncLog.requestPayload,
      responsePayload: syncLog.responsePayload,
      errorMessage: syncLog.errorMessage,
      errorCode: syncLog.errorCode,
      protocolNumber: syncLog.protocolNumber,
      syncedAt: syncLog.syncedAt,
      durationMs: syncLog.durationMs,
      createdAt: syncLog.createdAt,
      origine: syncLog.origine,
    }

    // I log sono immutabili (un record per tentativo, mai aggiornato): upsert
    // sull'id gestisce sia la creazione iniziale (createPending) sia il
    // successivo save dello stesso aggregate con l'esito finale
    // (markAsSuccess/markAsFailure), che è lo stesso `id` con più campi
    // valorizzati — senza upsert un secondo `create` fallirebbe sulla PK.
    await this.prisma.rENTRISyncLog.upsert({
      where: { id: syncLog.id },
      create: data,
      update: data,
    })

    return syncLog
  }

  /**
   * Find sync log by ID
   */
  async findById(id: string): Promise<RENTRISyncLog | null> {
    // `findFirst` con il tenant, non `findUnique` per solo id: l'id è una PK
    // globale e una lookup non filtrata restituirebbe il log di un'altra
    // azienda a chi ne conoscesse (o indovinasse) l'identificativo.
    const record = await this.prisma.rENTRISyncLog.findFirst({
      where: { id, tenantId: this.getTenantId() },
    })

    if (!record) {
      return null
    }

    return this.toDomain(record)
  }

  /**
   * Find all sync logs for a FIR
   */
  async findByFIRId(firId: string): Promise<RENTRISyncLog[]> {
    const records = await this.prisma.rENTRISyncLog.findMany({
      where: { firId, tenantId: this.getTenantId() },
      orderBy: { createdAt: 'desc' },
    })

    return records.map(r => this.toDomain(r))
  }

  /**
   * Find logs with pagination and filters
   */
  async findPaginated(
    limit: number,
    offset: number,
    criteria?: {
      firId?: string
      status?: 'SUCCESS' | 'FAILURE' | 'PENDING'
      dateFrom?: Date
      dateTo?: Date
    }
  ): Promise<{ data: RENTRISyncLog[]; total: number }> {
    const where: any = {
      tenantId: this.getTenantId(),
    }

    if (criteria?.firId) {
      where.firId = criteria.firId
    }

    if (criteria?.status) {
      where.status = criteria.status
    }

    if (criteria?.dateFrom || criteria?.dateTo) {
      where.createdAt = {}
      if (criteria.dateFrom) {
        where.createdAt.gte = criteria.dateFrom
      }
      if (criteria.dateTo) {
        where.createdAt.lte = criteria.dateTo
      }
    }

    const [records, total] = await Promise.all([
      this.prisma.rENTRISyncLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.rENTRISyncLog.count({ where }),
    ])

    return {
      data: records.map((r: any) => this.toDomain(r)),
      total,
    }
  }

  /**
   * Find all logs (for tenant)
   */
  async findAll(criteria?: any): Promise<RENTRISyncLog[]> {
    const records = await this.prisma.rENTRISyncLog.findMany({
      where: { tenantId: this.getTenantId(), ...criteria },
      orderBy: { createdAt: 'desc' },
    })

    return records.map(r => this.toDomain(r))
  }

  async findByTenant(criteria?: any): Promise<RENTRISyncLog[]> {
    return this.findAll(criteria)
  }

  async update(_id: string, _data: Partial<RENTRISyncLog>): Promise<RENTRISyncLog> {
    throw new Error('Sync logs are immutable - cannot update')
  }

  async delete(_id: string): Promise<boolean> {
    throw new Error('Sync logs are immutable - cannot delete')
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.rENTRISyncLog.count({
      where: { id, tenantId: this.getTenantId() },
    })

    return count > 0
  }

  async count(criteria?: any): Promise<number> {
    return this.prisma.rENTRISyncLog.count({
      where: { tenantId: this.getTenantId(), ...criteria },
    })
  }

  /**
   * Create pending log entry
   */
  async createPending(params: {
    id: string
    firId: string
    tenantId: string
    attempt: number
    requestPayload: string
    origine?: 'TRASMISSIONE' | 'RICONCILIAZIONE'
  }): Promise<RENTRISyncLog> {
    const syncLog = RENTRISyncLog.createPending(params)
    return this.save(syncLog)
  }

  /**
   * Convert Prisma record to domain entity
   */
  private toDomain(record: any): RENTRISyncLog {
    return new RENTRISyncLog(
      record.id,
      record.firId,
      record.tenantId,
      record.status,
      record.attempt,
      record.requestPayload,
      record.responsePayload,
      record.errorMessage,
      record.errorCode,
      record.protocolNumber,
      record.syncedAt,
      record.durationMs,
      record.createdAt,
      record.origine
    )
  }
}
