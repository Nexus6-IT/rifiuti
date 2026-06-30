import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { PermissionAuditLog } from '../../domain/identity-access/permission-audit-log.entity'
import { PermissionAuditLogRepository } from '../../domain/identity-access/permission-audit-log.repository.interface'

/**
 * PermissionAuditLogRepository Implementation (Prisma)
 * T142: Implements audit log persistence with PostgreSQL + monthly partitioning
 *
 * Requirements from spec.md:
 * - 10-year retention for ARPA compliance (D.Lgs. 152/2006)
 * - Cryptographic chain validation
 * - <500ms P95 query latency with indexed lookups
 * - Support 1M+ audit logs per tenant
 *
 * Requirements from plan.md:
 * - Monthly table partitioning for performance
 * - Immutable storage (no updates, only inserts)
 * - Support CSV export for ARPA inspections
 */
@Injectable()
export class PrismaPermissionAuditLogRepository implements PermissionAuditLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(log: PermissionAuditLog): Promise<void> {
    const data = log.toPersistence()

    await this.prisma.permissionAuditLog.create({
      data: {
        id: data.id,
        tenantId: data.tenantId,
        userId: data.userId,
        spidFiscalCode: data.spidFiscalCode,
        actionAttempted: data.actionAttempted,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        decision: data.decision,
        evaluatedPolicies: data.evaluatedPolicies,
        contextAttributes: data.contextAttributes,
        timestamp: data.timestamp,
        sessionId: data.sessionId,
        previousEntryHash: data.previousHash,
        currentHash: data.hash,
      },
    })
  }

  async saveBatch(logs: PermissionAuditLog[]): Promise<void> {
    const data = logs.map(log => {
      const persistence = log.toPersistence()
      return {
        id: persistence.id,
        tenantId: persistence.tenantId,
        userId: persistence.userId,
        spidFiscalCode: persistence.spidFiscalCode,
        actionAttempted: persistence.actionAttempted,
        resourceType: persistence.resourceType,
        resourceId: persistence.resourceId,
        decision: persistence.decision,
        evaluatedPolicies: persistence.evaluatedPolicies,
        contextAttributes: persistence.contextAttributes,
        timestamp: persistence.timestamp,
        sessionId: persistence.sessionId,
        previousEntryHash: persistence.previousHash,
        currentHash: persistence.hash,
      }
    })

    await this.prisma.permissionAuditLog.createMany({
      data,
    })
  }

  async getLatestLog(tenantId: string): Promise<PermissionAuditLog | null> {
    const result = await this.prisma.permissionAuditLog.findFirst({
      where: { tenantId },
      orderBy: { timestamp: 'desc' },
    })

    if (!result) return null

    return PermissionAuditLog.fromPersistence({
      id: result.id,
      tenantId: result.tenantId,
      userId: result.userId,
      spidFiscalCode: result.spidFiscalCode,
      actionAttempted: result.actionAttempted,
      resourceType: result.resourceType,
      resourceId: result.resourceId,
      decision: result.decision as 'ALLOW' | 'DENY',
      evaluatedPolicies: result.evaluatedPolicies,
      contextAttributes: result.contextAttributes,
      timestamp: result.timestamp,
      sessionId: result.sessionId,
      previousHash: result.previousEntryHash,
      hash: result.currentHash,
    })
  }

  async findWithFilters(filters: {
    tenantId: string
    userId?: string
    startDate?: Date
    endDate?: Date
    decision?: 'ALLOW' | 'DENY'
    resourceType?: string
    resourceId?: string
    actionAttempted?: string
    page?: number
    pageSize?: number
  }): Promise<{
    logs: PermissionAuditLog[]
    total: number
    page?: number
    pageSize?: number
  }> {
    const where: any = {
      tenantId: filters.tenantId,
    }

    if (filters.userId) {
      where.userId = filters.userId
    }

    if (filters.decision) {
      where.decision = filters.decision
    }

    if (filters.resourceType) {
      where.resourceType = filters.resourceType
    }

    if (filters.resourceId) {
      where.resourceId = filters.resourceId
    }

    if (filters.actionAttempted) {
      where.actionAttempted = {
        contains: filters.actionAttempted,
        mode: 'insensitive',
      }
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {}
      if (filters.startDate) {
        where.timestamp.gte = filters.startDate
      }
      if (filters.endDate) {
        where.timestamp.lte = filters.endDate
      }
    }

    const page = filters.page || 1
    const pageSize = filters.pageSize || 100
    const skip = (page - 1) * pageSize

    const [results, total] = await Promise.all([
      this.prisma.permissionAuditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.permissionAuditLog.count({ where }),
    ])

    const logs = results.map((result: any) =>
      PermissionAuditLog.fromPersistence({
        id: result.id,
        tenantId: result.tenantId,
        userId: result.userId,
        spidFiscalCode: result.spidFiscalCode,
        actionAttempted: result.actionAttempted,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        decision: result.decision as 'ALLOW' | 'DENY',
        evaluatedPolicies: result.evaluatedPolicies,
        contextAttributes: result.contextAttributes,
        timestamp: result.timestamp,
        sessionId: result.sessionId,
        previousHash: result.previousEntryHash,
        hash: result.currentHash,
      })
    )

    return {
      logs,
      total,
      page,
      pageSize,
    }
  }

  async findByTenant(
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]> {
    const results = await this.prisma.permissionAuditLog.findMany({
      where: { tenantId },
      orderBy: { timestamp: 'desc' },
      skip: options?.offset,
      take: options?.limit,
    })

    return results.map((result: any) =>
      PermissionAuditLog.fromPersistence({
        id: result.id,
        tenantId: result.tenantId,
        userId: result.userId,
        spidFiscalCode: result.spidFiscalCode,
        actionAttempted: result.actionAttempted,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        decision: result.decision as 'ALLOW' | 'DENY',
        evaluatedPolicies: result.evaluatedPolicies,
        contextAttributes: result.contextAttributes,
        timestamp: result.timestamp,
        sessionId: result.sessionId,
        previousHash: result.previousEntryHash,
        hash: result.currentHash,
      })
    )
  }

  async findByUser(
    userId: string,
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]> {
    const results = await this.prisma.permissionAuditLog.findMany({
      where: { userId, tenantId },
      orderBy: { timestamp: 'desc' },
      skip: options?.offset,
      take: options?.limit,
    })

    return results.map((result: any) =>
      PermissionAuditLog.fromPersistence({
        id: result.id,
        tenantId: result.tenantId,
        userId: result.userId,
        spidFiscalCode: result.spidFiscalCode,
        actionAttempted: result.actionAttempted,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        decision: result.decision as 'ALLOW' | 'DENY',
        evaluatedPolicies: result.evaluatedPolicies,
        contextAttributes: result.contextAttributes,
        timestamp: result.timestamp,
        sessionId: result.sessionId,
        previousHash: result.previousEntryHash,
        hash: result.currentHash,
      })
    )
  }

  async findByResource(
    resourceType: string,
    resourceId: string,
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]> {
    const results = await this.prisma.permissionAuditLog.findMany({
      where: { resourceType, resourceId, tenantId },
      orderBy: { timestamp: 'desc' },
      skip: options?.offset,
      take: options?.limit,
    })

    return results.map((result: any) =>
      PermissionAuditLog.fromPersistence({
        id: result.id,
        tenantId: result.tenantId,
        userId: result.userId,
        spidFiscalCode: result.spidFiscalCode,
        actionAttempted: result.actionAttempted,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        decision: result.decision as 'ALLOW' | 'DENY',
        evaluatedPolicies: result.evaluatedPolicies,
        contextAttributes: result.contextAttributes,
        timestamp: result.timestamp,
        sessionId: result.sessionId,
        previousHash: result.previousEntryHash,
        hash: result.currentHash,
      })
    )
  }

  async findByDateRange(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]> {
    const results = await this.prisma.permissionAuditLog.findMany({
      where: {
        tenantId,
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { timestamp: 'desc' },
      skip: options?.offset,
      take: options?.limit,
    })

    return results.map((result: any) =>
      PermissionAuditLog.fromPersistence({
        id: result.id,
        tenantId: result.tenantId,
        userId: result.userId,
        spidFiscalCode: result.spidFiscalCode,
        actionAttempted: result.actionAttempted,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        decision: result.decision as 'ALLOW' | 'DENY',
        evaluatedPolicies: result.evaluatedPolicies,
        contextAttributes: result.contextAttributes,
        timestamp: result.timestamp,
        sessionId: result.sessionId,
        previousHash: result.previousEntryHash,
        hash: result.currentHash,
      })
    )
  }

  async findByDecision(
    tenantId: string,
    decision: 'ALLOW' | 'DENY',
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]> {
    const results = await this.prisma.permissionAuditLog.findMany({
      where: { tenantId, decision },
      orderBy: { timestamp: 'desc' },
      skip: options?.offset,
      take: options?.limit,
    })

    return results.map((result: any) =>
      PermissionAuditLog.fromPersistence({
        id: result.id,
        tenantId: result.tenantId,
        userId: result.userId,
        spidFiscalCode: result.spidFiscalCode,
        actionAttempted: result.actionAttempted,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        decision: result.decision as 'ALLOW' | 'DENY',
        evaluatedPolicies: result.evaluatedPolicies,
        contextAttributes: result.contextAttributes,
        timestamp: result.timestamp,
        sessionId: result.sessionId,
        previousHash: result.previousEntryHash,
        hash: result.currentHash,
      })
    )
  }

  async count(filters: {
    tenantId: string
    userId?: string
    startDate?: Date
    endDate?: Date
    decision?: 'ALLOW' | 'DENY'
    resourceType?: string
  }): Promise<number> {
    const where: any = {
      tenantId: filters.tenantId,
    }

    if (filters.userId) {
      where.userId = filters.userId
    }

    if (filters.decision) {
      where.decision = filters.decision
    }

    if (filters.resourceType) {
      where.resourceType = filters.resourceType
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {}
      if (filters.startDate) {
        where.timestamp.gte = filters.startDate
      }
      if (filters.endDate) {
        where.timestamp.lte = filters.endDate
      }
    }

    return this.prisma.permissionAuditLog.count({ where })
  }

  async validateChainIntegrity(
    tenantId: string,
    options?: {
      startDate?: Date
      endDate?: Date
    }
  ): Promise<{
    isValid: boolean
    totalLogs: number
    firstInvalidLogId?: string
    error?: string
  }> {
    const logs = await this.getLogsInChronologicalOrder(tenantId, options)

    if (logs.length === 0) {
      return {
        isValid: true,
        totalLogs: 0,
      }
    }

    // Check first log has no previous hash
    if (logs[0].previousHash !== null) {
      return {
        isValid: false,
        totalLogs: logs.length,
        firstInvalidLogId: logs[0].id,
        error: 'First log should not have a previous hash',
      }
    }

    // Validate chain
    for (let i = 1; i < logs.length; i++) {
      const currentLog = logs[i]
      const previousLog = logs[i - 1]

      if (!currentLog.isChainValid(previousLog)) {
        return {
          isValid: false,
          totalLogs: logs.length,
          firstInvalidLogId: currentLog.id,
          error: `Chain broken at log ${i + 1}: expected previousHash=${previousLog.hash}, got ${currentLog.previousHash}`,
        }
      }
    }

    return {
      isValid: true,
      totalLogs: logs.length,
    }
  }

  async getLogsInChronologicalOrder(
    tenantId: string,
    options?: {
      startDate?: Date
      endDate?: Date
      limit?: number
    }
  ): Promise<PermissionAuditLog[]> {
    const where: any = { tenantId }

    if (options?.startDate || options?.endDate) {
      where.timestamp = {}
      if (options.startDate) {
        where.timestamp.gte = options.startDate
      }
      if (options.endDate) {
        where.timestamp.lte = options.endDate
      }
    }

    const results = await this.prisma.permissionAuditLog.findMany({
      where,
      orderBy: { timestamp: 'asc' }, // Chronological order
      take: options?.limit,
    })

    return results.map((result: any) =>
      PermissionAuditLog.fromPersistence({
        id: result.id,
        tenantId: result.tenantId,
        userId: result.userId,
        spidFiscalCode: result.spidFiscalCode,
        actionAttempted: result.actionAttempted,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        decision: result.decision as 'ALLOW' | 'DENY',
        evaluatedPolicies: result.evaluatedPolicies,
        contextAttributes: result.contextAttributes,
        timestamp: result.timestamp,
        sessionId: result.sessionId,
        previousHash: result.previousEntryHash,
        hash: result.currentHash,
      })
    )
  }

  async exportToCsv(filters: {
    tenantId: string
    startDate?: Date
    endDate?: Date
    userId?: string
  }): Promise<string> {
    const where: any = { tenantId: filters.tenantId }

    if (filters.userId) {
      where.userId = filters.userId
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {}
      if (filters.startDate) {
        where.timestamp.gte = filters.startDate
      }
      if (filters.endDate) {
        where.timestamp.lte = filters.endDate
      }
    }

    const results = await this.prisma.permissionAuditLog.findMany({
      where,
      orderBy: { timestamp: 'asc' },
    })

    // CSV header
    const headers = [
      'ID',
      'Timestamp',
      'User ID',
      'SPID Fiscal Code',
      'Action Attempted',
      'Resource Type',
      'Resource ID',
      'Decision',
      'Session ID',
      'Hash',
    ]

    // CSV rows
    const rows = results.map((result: any) => [
      result.id,
      result.timestamp.toISOString(),
      result.userId,
      result.spidFiscalCode,
      result.actionAttempted,
      result.resourceType,
      result.resourceId || '',
      result.decision,
      result.sessionId,
      result.currentHash,
    ])

    // Format as CSV
    const csvLines = [
      headers.join(','),
      ...rows.map((row: any) =>
        row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ]

    return csvLines.join('\n')
  }

  async archiveLogs(
    tenantId: string,
    olderThan: Date
  ): Promise<{
    archivedCount: number
  }> {
    // In a real implementation, this would move logs to S3 cold storage
    // For now, we just count the logs that would be archived
    const count = await this.prisma.permissionAuditLog.count({
      where: {
        tenantId,
        timestamp: {
          lt: olderThan,
        },
      },
    })

    // TODO: Implement actual archival to S3
    // await this.s3Service.archiveAuditLogs(...)

    return {
      archivedCount: count,
    }
  }

  async getStatistics(
    tenantId: string,
    options?: {
      startDate?: Date
      endDate?: Date
    }
  ): Promise<{
    totalLogs: number
    allowedCount: number
    deniedCount: number
    uniqueUsers: number
    topDeniedActions: Array<{ action: string; count: number }>
  }> {
    const where: any = { tenantId }

    if (options?.startDate || options?.endDate) {
      where.timestamp = {}
      if (options.startDate) {
        where.timestamp.gte = options.startDate
      }
      if (options.endDate) {
        where.timestamp.lte = options.endDate
      }
    }

    const [totalLogs, allowedCount, deniedCount, uniqueUsersResult, deniedActions] =
      await Promise.all([
        this.prisma.permissionAuditLog.count({ where }),
        this.prisma.permissionAuditLog.count({
          where: { ...where, decision: 'ALLOW' },
        }),
        this.prisma.permissionAuditLog.count({
          where: { ...where, decision: 'DENY' },
        }),
        this.prisma.permissionAuditLog.findMany({
          where,
          select: { userId: true },
          distinct: ['userId'],
        }),
        this.prisma.permissionAuditLog.groupBy({
          by: ['actionAttempted'],
          where: { ...where, decision: 'DENY' },
          _count: true,
          orderBy: {
            _count: {
              actionAttempted: 'desc',
            },
          },
          take: 10,
        }),
      ])

    const topDeniedActions = deniedActions.map((item: any) => ({
      action: item.actionAttempted,
      count: item._count,
    }))

    return {
      totalLogs,
      allowedCount,
      deniedCount,
      uniqueUsers: uniqueUsersResult.length,
      topDeniedActions,
    }
  }
}
