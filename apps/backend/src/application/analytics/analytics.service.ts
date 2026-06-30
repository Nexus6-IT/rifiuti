import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

/**
 * Analytics Service
 *
 * Calculates dashboard metrics for Italian waste management:
 * - FIR statistics and trends
 * - Waste type breakdown by CER code
 * - RENTRI sync status
 * - Signature completion metrics
 * - Environmental impact indicators
 * - Compliance scoring
 *
 * All metrics are tenant-scoped for multi-tenancy support.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(AnalyticsService.name)
  }

  /**
   * Get total FIRs for tenant
   */
  async getTotalFIRs(tenantId: string): Promise<number> {
    return await this.prisma.fIR.count({
      where: { tenantId },
    })
  }

  /**
   * Get FIRs grouped by status
   */
  async getFIRsByStatus(tenantId: string): Promise<Record<string, number>> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: true,
    })

    const result: Record<string, number> = {}
    for (const group of groups) {
      result[group.status] = group._count
    }

    return result
  }

  /**
   * Get FIRs by time period
   */
  async getFIRsByPeriod(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ date: Date; count: number }>> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['createdAt'],
      where: {
        tenantId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _count: true,
    })

    return groups.map((g: { createdAt: Date; _count: number }) => ({
      date: g.createdAt,
      count: g._count,
    }))
  }

  /**
   * Get waste breakdown by CER code
   */
  async getWasteByCERCode(
    tenantId: string
  ): Promise<Array<{ cerCode: string; count: number; totalQuantity: number }>> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['cerCode'],
      where: { tenantId },
      _count: true,
      _sum: {
        quantity: true,
      },
    })

    return groups.map((g: { cerCode: string; _count: number; _sum: { quantity: any } }) => ({
      cerCode: g.cerCode,
      count: g._count,
      totalQuantity: g._sum.quantity ? Number(g._sum.quantity) : 0,
    }))
  }

  /**
   * Get total waste quantity
   */
  async getTotalWasteQuantity(tenantId: string): Promise<number> {
    const result = await this.prisma.fIR.aggregate({
      where: { tenantId },
      _sum: {
        quantity: true,
      },
    })

    return result._sum.quantity ? Number(result._sum.quantity) : 0
  }

  /**
   * Ripartizione dei rifiuti per tipo di operazione di destinazione:
   * recupero (R) vs smaltimento (D), con tasso di riciclo.
   * Basato sul campo reale `wasteOperationType` dei FIR.
   */
  async getWasteByDestination(tenantId: string): Promise<{
    recovery: { count: number; quantity: number }
    disposal: { count: number; quantity: number }
    recyclingRate: number
  }> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['wasteOperationType'],
      where: { tenantId },
      _count: true,
      _sum: {
        quantity: true,
      },
    })

    let recovery = { count: 0, quantity: 0 }
    let disposal = { count: 0, quantity: 0 }

    for (const group of groups) {
      const entry = {
        count: group._count,
        quantity: Number(group._sum.quantity) || 0,
      }
      if (group.wasteOperationType === 'RECOVERY') {
        recovery = entry
      } else if (group.wasteOperationType === 'DISPOSAL') {
        disposal = entry
      }
    }

    const total = recovery.count + disposal.count
    const recyclingRate = total > 0 ? recovery.count / total : 0

    return { recovery, disposal, recyclingRate }
  }

  /**
   * Get RENTRI sync success rate
   */
  async getRENTRISyncRate(tenantId: string): Promise<{
    total: number
    synced: number
    rate: number
  }> {
    const total = await this.prisma.fIR.count({
      where: {
        tenantId,
        status: 'COMPLETED',
      },
    })

    const synced = await this.prisma.fIR.count({
      where: {
        tenantId,
        status: 'COMPLETED',
        rentriSyncStatus: 'SYNCED',
      },
    })

    const rate = total > 0 ? synced / total : 0

    return { total, synced, rate }
  }

  /**
   * Get pending RENTRI syncs
   */
  async getPendingRENTRISyncs(tenantId: string): Promise<number> {
    return await this.prisma.fIR.count({
      where: {
        tenantId,
        status: 'COMPLETED',
        rentriSyncStatus: 'PENDING',
      },
    })
  }

  /**
   * Get failed RENTRI syncs
   */
  async getFailedRENTRISyncs(tenantId: string): Promise<number> {
    return await this.prisma.fIR.count({
      where: {
        tenantId,
        rentriSyncStatus: 'FAILED',
      },
    })
  }

  /**
   * Get signature completion rate
   */
  async getSignatureCompletionRate(tenantId: string): Promise<{
    total: number
    completed: number
    rate: number
  }> {
    const total = await this.prisma.fIR.count({
      where: { tenantId },
    })

    const completed = await this.prisma.fIR.count({
      where: {
        tenantId,
        status: 'COMPLETED',
      },
    })

    const rate = total > 0 ? parseFloat((completed / total).toFixed(3)) : 0

    return { total, completed, rate }
  }

  /**
   * Get average time to complete signatures (in hours)
   */
  async getAverageSignatureTime(tenantId: string): Promise<number> {
    const firs = await (this.prisma.fIR as any).findMany({
      where: {
        tenantId,
        status: 'COMPLETED',
        completedAt: { not: null },
      },
      select: {
        createdAt: true,
        completedAt: true,
      },
    })

    if (firs.length === 0) return 0

    const totalHours = firs.reduce((sum: number, fir: any) => {
      const hours = (fir.completedAt.getTime() - fir.createdAt.getTime()) / 1000 / 60 / 60
      return sum + hours
    }, 0)

    return Math.round(totalHours / firs.length)
  }

  /**
   * Calculate compliance score (0-1)
   */
  async getComplianceScore(tenantId: string): Promise<{
    score: number
    level: 'EXCELLENT' | 'GOOD' | 'NEEDS_IMPROVEMENT' | 'CRITICAL'
    totalFIRs: number
    factors: {
      signatureCompletionRate: number
      rentriSyncRate: number
      overdueRate: number
    }
  }> {
    const totalFIRs = await this.prisma.fIR.count({
      where: { tenantId },
    })

    const withSignatures = await this.prisma.fIR.count({
      where: {
        tenantId,
        status: 'COMPLETED',
      },
    })

    const syncedToRENTRI = await this.prisma.fIR.count({
      where: {
        tenantId,
        rentriSyncStatus: 'SYNCED',
      },
    })

    // TODO: SIGNED_BY_PRODUCER and IN_TRANSIT don't exist in Prisma schema
    // Valid statuses are: DRAFT, AWAITING_PRODUCER, AWAITING_CARRIER, AWAITING_RECEIVER, COMPLETED, SYNCED_TO_RENTRI, CANCELLED
    const overdue = await this.prisma.fIR.count({
      where: {
        tenantId,
        status: { in: ['DRAFT', 'AWAITING_PRODUCER', 'AWAITING_CARRIER', 'AWAITING_RECEIVER'] },
        createdAt: {
          lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days old
        },
      },
    })

    const signatureRate = totalFIRs > 0 ? withSignatures / totalFIRs : 0
    const syncRate = totalFIRs > 0 ? syncedToRENTRI / totalFIRs : 0
    const overdueRate = totalFIRs > 0 ? overdue / totalFIRs : 0

    // Weighted score: 40% signatures, 40% RENTRI sync, 20% timeliness
    const score = signatureRate * 0.4 + syncRate * 0.4 + (1 - overdueRate) * 0.2

    let level: 'EXCELLENT' | 'GOOD' | 'NEEDS_IMPROVEMENT' | 'CRITICAL'
    if (score >= 0.9) level = 'EXCELLENT'
    else if (score >= 0.7) level = 'GOOD'
    else if (score >= 0.5) level = 'NEEDS_IMPROVEMENT'
    else level = 'CRITICAL'

    return {
      score,
      level,
      totalFIRs,
      factors: {
        signatureCompletionRate: signatureRate,
        rentriSyncRate: syncRate,
        overdueRate,
      },
    }
  }

  /**
   * Get overdue FIRs count
   */
  async getOverdueFIRs(tenantId: string): Promise<number> {
    // TODO: Use valid Prisma status values
    return await this.prisma.fIR.count({
      where: {
        tenantId,
        status: { in: ['DRAFT', 'AWAITING_PRODUCER', 'AWAITING_CARRIER', 'AWAITING_RECEIVER'] },
        createdAt: {
          lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    })
  }

  /**
   * Calculate month-over-month growth
   */
  async getMonthOverMonthGrowth(tenantId: string): Promise<{
    current: number
    previous: number
    percentage: number
  }> {
    const now = new Date()
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

    const current = await this.prisma.fIR.count({
      where: {
        tenantId,
        createdAt: { gte: currentMonthStart },
      },
    })

    const previous = await this.prisma.fIR.count({
      where: {
        tenantId,
        createdAt: {
          gte: previousMonthStart,
          lte: previousMonthEnd,
        },
      },
    })

    const percentage = previous > 0 ? (current - previous) / previous : 0

    return { current, previous, percentage }
  }

  /**
   * Predict next month volume using simple linear regression
   */
  async predictNextMonthVolume(tenantId: string): Promise<number> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['createdAt'],
      where: {
        tenantId,
        createdAt: {
          gte: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), // Last 4 months
        },
      },
      _count: true,
    })

    if (groups.length < 2) {
      return 0 // Not enough data
    }

    // Simple linear trend
    const counts = groups.map((g: { _count: number }) => g._count)
    const _avg = counts.reduce((a: number, b: number) => a + b, 0) / counts.length
    const trend = counts[counts.length - 1] - counts[0]

    return Math.max(0, Math.round(counts[counts.length - 1] + trend / counts.length))
  }

  /**
   * Get top waste producers
   */
  async getTopProducers(
    tenantId: string,
    limit: number
  ): Promise<Array<{ partitaIva: string; count: number }>> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['producerPartitaIva'],
      where: { tenantId },
      _count: true,
      orderBy: {
        _count: {
          producerPartitaIva: 'desc',
        },
      },
      take: limit,
    })

    return groups.map((g: { producerPartitaIva: string; _count: number }) => ({
      partitaIva: g.producerPartitaIva,
      count: g._count,
    }))
  }

  /**
   * Get top carriers
   */
  async getTopCarriers(
    tenantId: string,
    limit: number
  ): Promise<Array<{ partitaIva: string; count: number }>> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['carrierPartitaIva'],
      where: { tenantId },
      _count: true,
      orderBy: {
        _count: {
          carrierPartitaIva: 'desc',
        },
      },
      take: limit,
    })

    return groups.map((g: { carrierPartitaIva: string; _count: number }) => ({
      partitaIva: g.carrierPartitaIva,
      count: g._count,
    }))
  }
}
