import { Injectable } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'
import { LoggerService } from '../../core/logger/logger.service'
import { ModuliAttiviService } from '../admin/moduli-attivi.service'

/** Valori del blocco `rentri` per un'azienda senza il modulo: nessuna lettura, tutto a zero. */
const RENTRI_NON_ATTIVO = { total: 0, synced: 0, rate: 0 }

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
    private readonly logger: LoggerService,
    private readonly moduli: ModuliAttiviService
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
      // Con l'intervallo gli stati si contano due volte: su tutto il tenant per `overview`, nel
      // periodo per `status`. Senza intervallo una sola chiamata.
      const intervallo = params.dateRange
      // Una sola lettura dei moduli per richiesta (fonte unica). Il blocco `rentri` e' del modulo
      // omonimo: senza, non si interroga RENTRI e il blocco resta con tutti i valori a zero (il
      // frontend lo legge sempre: il contratto della risposta non cambia).
      const conRentri = (await this.moduli.moduliAttivi(params.tenantId)).includes('rentri')
      const [
        totalFIRs,
        firsByStatusTotale,
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
        firsByStatusPeriodo,
      ] = await Promise.all([
        this.analyticsService.getTotalFIRs(params.tenantId),
        this.analyticsService.getFIRsByStatus(params.tenantId),
        this.analyticsService.getTotalWasteQuantity(params.tenantId),
        this.analyticsService.getWasteByCERCode(params.tenantId),
        this.analyticsService.getWasteByDestination(params.tenantId),
        conRentri
          ? this.analyticsService.getRENTRISyncRate(params.tenantId)
          : Promise.resolve(RENTRI_NON_ATTIVO),
        this.analyticsService.getSignatureCompletionRate(params.tenantId),
        this.analyticsService.getAverageSignatureTime(params.tenantId),
        this.analyticsService.getComplianceScore(params.tenantId),
        this.analyticsService.getOverdueFIRs(params.tenantId),
        this.analyticsService.getMonthOverMonthGrowth(params.tenantId),
        this.analyticsService.predictNextMonthVolume(params.tenantId),
        this.analyticsService.getTopProducers(params.tenantId, 5),
        this.analyticsService.getTopCarriers(params.tenantId, 5),
        intervallo
          ? this.analyticsService.getFIRsByStatus(params.tenantId, intervallo)
          : Promise.resolve(undefined),
      ])
      const firsByStatus = firsByStatusPeriodo ?? firsByStatusTotale

      this.logger.info(`Dashboard data fetched successfully for tenant ${params.tenantId}`)

      return {
        overview: {
          totalFIRs,
          totalWasteKg: totalWaste,
          completedFIRs: firsByStatusTotale['COMPLETED'] || 0,
          pendingFIRs:
            (firsByStatusTotale['DRAFT'] || 0) +
            (firsByStatusTotale['SIGNED_BY_PRODUCER'] || 0) +
            (firsByStatusTotale['IN_TRANSIT'] || 0),
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
      /** Previsione del MESE CORRENTE (il nome `nextMonth` e' storico: e' il «prossimo» dopo la serie). */
      nextMonth: number | null
    }
  }
  top: {
    producers: Array<{ partitaIva: string; nome: string | null; count: number }>
    carriers: Array<{ partitaIva: string; nome: string | null; count: number }>
  }
  generatedAt: Date
}
