import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { DepositoTemporaneoConfig, DEFAULT_DEPOSITO_TEMPORANEO } from './deposito-temporaneo.config'

export interface GiacenzaCer {
  cerCode: string
  caricoKg: number
  scaricoKg: number
  /** Giacenza attuale in deposito = carico - scarico (>= 0). */
  giacenzaKg: number
  /** Data del carico più vecchio ancora "in giacenza" (per il criterio temporale). */
  oldestCaricoDate: Date | null
}

export type DepositoTemporaneoAlertReason = 'DURATION' | 'QUANTITY'

export interface DepositoTemporaneoAlert {
  cerCode: string
  giacenzaKg: number
  reasons: DepositoTemporaneoAlertReason[]
  /** Giorni trascorsi dal carico più vecchio (se disponibile). */
  durationDays?: number
  oldestCaricoDate: Date | null
}

/**
 * Giacenze e monitoraggio del deposito temporaneo, calcolati dal registro
 * cronologico di carico/scarico (WasteMovement). Tutte le query sono
 * tenant-scoped.
 */
@Injectable()
export class GiacenzeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(GiacenzeService.name)
  }

  /** Giacenza corrente per CER (carico - scarico) con data del carico più vecchio. */
  async getGiacenze(tenantId: string): Promise<GiacenzaCer[]> {
    const byType = await this.prisma.wasteMovement.groupBy({
      by: ['cerCode', 'type'],
      where: { tenantId },
      _sum: { quantity: true },
    })

    // Data del carico più vecchio per CER (criterio temporale del deposito).
    const oldestCarico = await this.prisma.wasteMovement.groupBy({
      by: ['cerCode'],
      where: { tenantId, type: 'CARICO' },
      _min: { movementDate: true },
    })
    const oldestByCer = new Map<string, Date | null>()
    for (const row of oldestCarico) {
      oldestByCer.set(row.cerCode, row._min.movementDate ?? null)
    }

    const perCer = new Map<string, { caricoKg: number; scaricoKg: number }>()
    for (const row of byType) {
      const qty = row._sum.quantity ? Number(row._sum.quantity) : 0
      const entry = perCer.get(row.cerCode) ?? { caricoKg: 0, scaricoKg: 0 }
      if (row.type === 'CARICO') entry.caricoKg += qty
      else if (row.type === 'SCARICO') entry.scaricoKg += qty
      perCer.set(row.cerCode, entry)
    }

    const result: GiacenzaCer[] = []
    for (const [cerCode, { caricoKg, scaricoKg }] of perCer) {
      result.push({
        cerCode,
        caricoKg,
        scaricoKg,
        // Non negativa: scarichi > carichi indicano dati incoerenti (gestiti
        // a parte dall'anomaly detection), qui clampiamo a 0.
        giacenzaKg: Math.max(0, caricoKg - scaricoKg),
        oldestCaricoDate: oldestByCer.get(cerCode) ?? null,
      })
    }

    result.sort((a, b) => b.giacenzaKg - a.giacenzaKg)
    return result
  }

  /**
   * Alert di deposito temporaneo: per ogni CER con giacenza > 0, segnala il
   * superamento del limite temporale e/o quantitativo (soglie configurabili).
   */
  async getDepositoTemporaneoAlerts(
    tenantId: string,
    config: DepositoTemporaneoConfig = DEFAULT_DEPOSITO_TEMPORANEO,
    now: Date = new Date()
  ): Promise<DepositoTemporaneoAlert[]> {
    const giacenze = await this.getGiacenze(tenantId)
    const alerts: DepositoTemporaneoAlert[] = []

    for (const g of giacenze) {
      if (g.giacenzaKg <= 0) continue

      const reasons: DepositoTemporaneoAlertReason[] = []
      let durationDays: number | undefined

      if (g.oldestCaricoDate) {
        durationDays = Math.floor(
          (now.getTime() - g.oldestCaricoDate.getTime()) / (24 * 60 * 60 * 1000)
        )
        if (durationDays > config.maxDurationDays) reasons.push('DURATION')
      }
      if (g.giacenzaKg > config.maxQuantityKg) reasons.push('QUANTITY')

      if (reasons.length > 0) {
        alerts.push({
          cerCode: g.cerCode,
          giacenzaKg: g.giacenzaKg,
          reasons,
          durationDays,
          oldestCaricoDate: g.oldestCaricoDate,
        })
      }
    }

    if (alerts.length > 0) {
      this.logger.warn(
        `Deposito temporaneo: ${alerts.length} CER oltre soglia per tenant ${tenantId}`
      )
    }
    return alerts
  }
}
