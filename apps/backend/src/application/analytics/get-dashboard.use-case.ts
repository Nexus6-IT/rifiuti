import { Injectable } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { LoggerService } from '../../core/logger/logger.service'

/**
 * Get Dashboard Use Case
 *
 * Aggregates all analytics metrics for dashboard display:
 * - Overview statistics (total FIRs, waste quantity, etc.)
 * - Status breakdown
 * - Waste type analysis
 * - RENTRI sync status
 * - Compliance score
 * - Trends and predictions
 *
 * Returns comprehensive dashboard data for frontend visualization.
 */
@Injectable()
export class GetDashboardUseCase {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(GetDashboardUseCase.name)
  }

  /**
   * Execute dashboard query
   */
  async execute(params: {
    tenantId: string
    dateRange?: {
      startDate: Date
      endDate: Date
    }
  }): Promise<DashboardData> {
    this.logger.info(`Fetching dashboard data for tenant ${params.tenantId}`)

    try {
      // Fetch all metrics in parallel
      const [
        totalFIRs,
        firsByStatus,
        totalWaste,
        wasteByCER,
        wasteByDestination,
        rentriSync,
        signatureCompletion,
        avgSignatureTime,
        compliance,
        overdue,
        growth,
        prediction,
        topProducers,
        topCarriers,
      ] = await Promise.all([
        this.analyticsService.getTotalFIRs(params.tenantId),
        this.analyticsService.getFIRsByStatus(params.tenantId),
        this.analyticsService.getTotalWasteQuantity(params.tenantId),
        this.analyticsService.getWasteByCERCode(params.tenantId),
        this.analyticsService.getWasteByDestination(params.tenantId),
        this.analyticsService.getRENTRISyncRate(params.tenantId),
        this.analyticsService.getSignatureCompletionRate(params.tenantId),
        this.analyticsService.getAverageSignatureTime(params.tenantId),
        this.analyticsService.getComplianceScore(params.tenantId),
        this.analyticsService.getOverdueFIRs(params.tenantId),
        this.analyticsService.getMonthOverMonthGrowth(params.tenantId),
        this.analyticsService.predictNextMonthVolume(params.tenantId),
        this.analyticsService.getTopProducers(params.tenantId, 5),
        this.analyticsService.getTopCarriers(params.tenantId, 5),
      ])

      this.logger.info(`Dashboard data fetched successfully for tenant ${params.tenantId}`)

      return {
        overview: {
          totalFIRs,
          totalWasteKg: totalWaste,
          completedFIRs: firsByStatus['COMPLETED'] || 0,
          pendingFIRs:
            (firsByStatus['DRAFT'] || 0) +
            (firsByStatus['SIGNED_BY_PRODUCER'] || 0) +
            (firsByStatus['IN_TRANSIT'] || 0),
          overdueFIRs: overdue,
        },
        status: {
          breakdown: firsByStatus,
          chart: Object.entries(firsByStatus).map(([status, count]) => ({
            status,
            count,
          })),
        },
        waste: {
          totalKg: totalWaste,
          byCERCode: wasteByCER,
          byDestination: wasteByDestination,
          recyclingRate: wasteByDestination.recyclingRate,
        },
        rentri: {
          syncRate: rentriSync.rate,
          totalCompleted: rentriSync.total,
          synced: rentriSync.synced,
          pending: rentriSync.total - rentriSync.synced,
        },
        signatures: {
          completionRate: signatureCompletion.rate,
          total: signatureCompletion.total,
          completed: signatureCompletion.completed,
          averageTimeHours: avgSignatureTime,
        },
        compliance: {
          score: compliance.score,
          level: compliance.level,
          factors: compliance.factors,
        },
        trends: {
          monthOverMonth: growth,
          prediction: {
            nextMonth: prediction,
          },
        },
        top: {
          producers: topProducers,
          carriers: topCarriers,
        },
        generatedAt: new Date(),
      }
    } catch (error) {
      this.logger.error(`Failed to fetch dashboard data for tenant ${params.tenantId}`, error)
      throw error
    }
  }
}

/**
 * Dashboard Data Structure
 */
export interface DashboardData {
  overview: {
    totalFIRs: number
    totalWasteKg: number
    completedFIRs: number
    pendingFIRs: number
    overdueFIRs: number
  }
  status: {
    breakdown: Record<string, number>
    chart: Array<{ status: string; count: number }>
  }
  waste: {
    totalKg: number
    byCERCode: Array<{ cerCode: string; count: number; totalQuantity: number }>
    byDestination: {
      recovery: { count: number; quantity: number }
      disposal: { count: number; quantity: number }
      recyclingRate: number
    }
    recyclingRate: number
  }
  rentri: {
    syncRate: number
    totalCompleted: number
    synced: number
    pending: number
  }
  signatures: {
    completionRate: number
    total: number
    completed: number
    averageTimeHours: number
  }
  compliance: {
    score: number
    level: 'EXCELLENT' | 'GOOD' | 'NEEDS_IMPROVEMENT' | 'CRITICAL'
    factors: {
      signatureCompletionRate: number
      rentriSyncRate: number
      overdueRate: number
    }
  }
  trends: {
    monthOverMonth: {
      current: number
      previous: number
      percentage: number
    }
    prediction: {
      nextMonth: number
    }
  }
  top: {
    producers: Array<{ partitaIva: string; count: number }>
    carriers: Array<{ partitaIva: string; count: number }>
  }
  generatedAt: Date
}
