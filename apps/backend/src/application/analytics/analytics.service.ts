import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { STATI_ESCLUSI } from '../dashboard/stati-andamento'

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
   * Get FIRs grouped by status.
   *
   * Con `intervallo` conta solo i FIR con `createdAt >= startDate` e `<= endDate`;
   * senza, tutti i FIR del tenant.
   */
  async getFIRsByStatus(
    tenantId: string,
    intervallo?: { startDate: Date; endDate: Date }
  ): Promise<Record<string, number>> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['status'],
      where: {
        tenantId,
        ...(intervallo
          ? { createdAt: { gte: intervallo.startDate, lte: intervallo.endDate } }
          : {}),
      },
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
   * Previsione del volume del mese corrente (il «prossimo» dopo la serie): regressione lineare ai
   * minimi quadrati sui conteggi mensili degli ultimi 6 mesi COMPLETI (mesi UTC, gli stessi di
   * `GET /dashboard/andamento`). Il mese in corso, parziale, non entra mai.
   *
   * - 0 mesi (nessun FIR nei 6 mesi completi): `null`;
   * - 1 o 2 mesi di serie: media arrotondata;
   * - 3 o piu': retta `y = a + b*x` su `x = 0..n-1`, previsione `max(0, round(a + b*n))`.
   *
   * Stessa base di `GET /dashboard/andamento`: bozze, FIR in attesa del produttore e annullati
   * non contano (`STATI_ESCLUSI`). La serie parte dal primo mese con almeno un FIR compiuto; i mesi vuoti dopo di esso valgono 0.
   */
  async predictNextMonthVolume(tenantId: string, oggi: Date = new Date()): Promise<number | null> {
    const inizioMeseCorrente = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), 1))
    const dataInizio = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth() - 6, 1))

    const righe = await this.prisma.$queryRaw<Array<{ mese: Date; conteggio: number }>>`
      SELECT date_trunc('month', created_at) AS mese, COUNT(*)::int AS conteggio
      FROM firs
      WHERE tenant_id = ${tenantId}::uuid
        AND status::text <> ALL(${STATI_ESCLUSI}::text[])
        AND created_at >= ${dataInizio}
        AND created_at < ${inizioMeseCorrente}
      GROUP BY 1
    `

    const chiave = (d: Date): string => `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    const perMese = new Map(righe.map(r => [chiave(new Date(r.mese)), Number(r.conteggio)]))

    const serie: number[] = []
    for (let i = 6; i >= 1; i--) {
      const d = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth() - i, 1))
      serie.push(perMese.get(chiave(d)) ?? 0)
    }
    const primo = serie.findIndex(c => c > 0)
    if (primo === -1) return null
    const y = serie.slice(primo)
    const n = y.length

    if (n < 3) return Math.round(y.reduce((a, b) => a + b, 0) / n)

    const mediaX = (n - 1) / 2
    const mediaY = y.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    y.forEach((v, x) => {
      num += (x - mediaX) * (v - mediaY)
      den += (x - mediaX) ** 2
    })
    const b = num / den
    const a = mediaY - b * mediaX
    return Math.max(0, Math.round(a + b * n))
  }

  /** Piu' frequenti per P. IVA del produttore, col nome dello snapshot piu' recente. */
  async getTopProducers(
    tenantId: string,
    limit: number
  ): Promise<Array<{ partitaIva: string; nome: string | null; count: number }>> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['producerPartitaIva'],
      where: { tenantId, producerPartitaIva: { not: '' } },
      _count: true,
      orderBy: [{ _count: { producerPartitaIva: 'desc' } }, { producerPartitaIva: 'asc' }],
      take: limit,
    })
    const partiteIva = groups.map((g: { producerPartitaIva: string }) => g.producerPartitaIva)
    const nomi = new Map<string, string | null>()
    if (partiteIva.length > 0) {
      const righe = await this.prisma.$queryRaw<
        Array<{ partita_iva: string; nome: string | null }>
      >`
        SELECT DISTINCT ON (producer_partita_iva) producer_partita_iva AS partita_iva, producer_name AS nome
        FROM firs
        WHERE tenant_id = ${tenantId}::uuid AND producer_partita_iva = ANY(${partiteIva}::text[])
        ORDER BY producer_partita_iva, created_at DESC, id DESC
      `
      for (const r of righe) nomi.set(r.partita_iva, nomeOppureNull(r.nome))
    }

    return groups.map((g: { producerPartitaIva: string; _count: number }) => ({
      partitaIva: g.producerPartitaIva,
      nome: nomi.get(g.producerPartitaIva) ?? null,
      count: g._count,
    }))
  }

  /** Piu' frequenti per P. IVA del trasportatore, col nome dello snapshot piu' recente. */
  async getTopCarriers(
    tenantId: string,
    limit: number
  ): Promise<Array<{ partitaIva: string; nome: string | null; count: number }>> {
    const groups = await this.prisma.fIR.groupBy({
      by: ['carrierPartitaIva'],
      where: { tenantId, carrierPartitaIva: { not: '' } },
      _count: true,
      orderBy: [{ _count: { carrierPartitaIva: 'desc' } }, { carrierPartitaIva: 'asc' }],
      take: limit,
    })
    const partiteIva = groups.map((g: { carrierPartitaIva: string }) => g.carrierPartitaIva)
    const nomi = new Map<string, string | null>()
    if (partiteIva.length > 0) {
      const righe = await this.prisma.$queryRaw<
        Array<{ partita_iva: string; nome: string | null }>
      >`
        SELECT DISTINCT ON (carrier_partita_iva) carrier_partita_iva AS partita_iva, carrier_name AS nome
        FROM firs
        WHERE tenant_id = ${tenantId}::uuid AND carrier_partita_iva = ANY(${partiteIva}::text[])
        ORDER BY carrier_partita_iva, created_at DESC, id DESC
      `
      for (const r of righe) nomi.set(r.partita_iva, nomeOppureNull(r.nome))
    }

    return groups.map((g: { carrierPartitaIva: string; _count: number }) => ({
      partitaIva: g.carrierPartitaIva,
      nome: nomi.get(g.carrierPartitaIva) ?? null,
      count: g._count,
    }))
  }
}

/** Stringa vuota o di soli spazi: nessun nome. */
function nomeOppureNull(nome: string | null): string | null {
  const pulito = nome?.trim()
  return pulito ? pulito : null
}
