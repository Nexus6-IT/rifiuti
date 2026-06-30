import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { RENTRISyncLog } from '../../domain/rentri/rentri-sync-log.aggregate'
import { ITenantRepository } from '../../domain/shared/repository.interface'

/**
 * RENTRI Sync Log Repository
 *
 * Persists RENTRI sync logs using Prisma.
 * Implements tenant isolation via RLS extension.
 */
@Injectable()
export class RENTRISyncLogRepository implements ITenantRepository<RENTRISyncLog> {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenantId: string
  ) {}

  getTenantId(): string {
    return this.tenantId
  }

  /**
   * Save sync log
   * TODO: rENTRISyncLog model doesn't exist in Prisma schema
   */
  async save(syncLog: RENTRISyncLog): Promise<RENTRISyncLog> {
    // const data = {
    //   id: syncLog.id,
    //   firId: syncLog.firId,
    //   tenantId: syncLog.tenantId,
    //   status: syncLog.status,
    //   attempt: syncLog.attempt,
    //   requestPayload: syncLog.requestPayload,
    //   responsePayload: syncLog.responsePayload,
    //   errorMessage: syncLog.errorMessage,
    //   errorCode: syncLog.errorCode,
    //   protocolNumber: syncLog.protocolNumber,
    //   syncedAt: syncLog.syncedAt,
    //   durationMs: syncLog.durationMs,
    //   createdAt: syncLog.createdAt,
    // };

    // await this.prisma.rENTRISyncLog.create({ data } as any);

    return syncLog
  }

  /**
   * Find sync log by ID
   * TODO: rENTRISyncLog model doesn't exist in Prisma schema
   */
  async findById(_id: string): Promise<RENTRISyncLog | null> {
    // const record = await this.prisma.rENTRISyncLog.findUnique({
    //   where: { id },
    // }) as any;

    // if (!record) {
    //   return null;
    // }

    // return this.toDomain(record);
    return null
  }

  /**
   * Find all sync logs for a FIR
   * TODO: rENTRISyncLog model doesn't exist in Prisma schema
   */
  async findByFIRId(_firId: string): Promise<RENTRISyncLog[]> {
    // const records = await this.prisma.rENTRISyncLog.findMany({
    //   where: { firId, tenantId: this.tenantId },
    //   orderBy: { createdAt: 'desc' },
    // }) as any[];

    // return records.map(r => this.toDomain(r));
    return []
  }

  /**
   * Find logs with pagination and filters
   * TODO: rENTRISyncLog model doesn't exist in Prisma schema
   */
  async findPaginated(
    _limit: number,
    _offset: number,
    _criteria?: {
      firId?: string
      status?: 'SUCCESS' | 'FAILURE' | 'PENDING'
      dateFrom?: Date
      dateTo?: Date
    }
  ): Promise<{ data: RENTRISyncLog[]; total: number }> {
    // const where: any = {
    //   tenantId: this.tenantId,
    // };

    // if (criteria?.firId) {
    //   where.firId = criteria.firId;
    // }

    // if (criteria?.status) {
    //   where.status = criteria.status;
    // }

    // if (criteria?.dateFrom || criteria?.dateTo) {
    //   where.createdAt = {};
    //   if (criteria.dateFrom) {
    //     where.createdAt.gte = criteria.dateFrom;
    //   }
    //   if (criteria.dateTo) {
    //     where.createdAt.lte = criteria.dateTo;
    //   }
    // }

    // const [records, total] = await Promise.all([
    //   this.prisma.rENTRISyncLog.findMany({
    //     where,
    //     take: limit,
    //     skip: offset,
    //     orderBy: { createdAt: 'desc' },
    //   }) as any,
    //   this.prisma.rENTRISyncLog.count({ where }) as any,
    // ]);

    // return {
    //   data: records.map((r: any) => this.toDomain(r)),
    //   total,
    // };

    return {
      data: [],
      total: 0,
    }
  }

  /**
   * Find all logs (for tenant)
   * TODO: rENTRISyncLog model doesn't exist in Prisma schema
   */
  async findAll(_criteria?: any): Promise<RENTRISyncLog[]> {
    // const records = await this.prisma.rENTRISyncLog.findMany({
    //   where: { tenantId: this.tenantId, ...criteria },
    //   orderBy: { createdAt: 'desc' },
    // }) as any[];

    // return records.map(r => this.toDomain(r));
    return []
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

  async exists(_id: string): Promise<boolean> {
    // TODO: rENTRISyncLog model doesn't exist in Prisma schema
    // const count = await this.prisma.rENTRISyncLog.count({
    //   where: { id, tenantId: this.tenantId },
    // }) as any;

    // return count > 0;
    return false
  }

  async count(_criteria?: any): Promise<number> {
    // TODO: rENTRISyncLog model doesn't exist in Prisma schema
    // return this.prisma.rENTRISyncLog.count({
    //   where: { tenantId: this.tenantId, ...criteria },
    // }) as any;
    return 0
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
      record.createdAt
    )
  }
}
