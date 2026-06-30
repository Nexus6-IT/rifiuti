import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { co2FactorForCer } from './emission-factors'

export interface EsgReportRange {
  startDate?: Date
  endDate?: Date
}

export interface EsgCerBreakdown {
  cerCode: string
  recoveryKg: number
  disposalKg: number
  co2AvoidedKg: number
}

export interface EsgReport {
  period: { from: Date; to: Date } | null
  totals: {
    producedKg: number
    recoveryKg: number
    disposalKg: number
    /** Tasso di recupero/riciclo: recoveryKg / producedKg (0..1). */
    recyclingRate: number
  }
  /** kg deviati dalla discarica/smaltimento (= quota avviata a recupero). */
  landfillDivertedKg: number
  /** CO₂ equivalente evitata stimata (kg) — vedi emission-factors.ts. */
  co2AvoidedKg: number
  byCer: EsgCerBreakdown[]
}

/**
 * ESG Service — rendicontazione ambientale derivata dal dato RENTRI (FIR).
 *
 * Trasforma i movimenti FIR (con `wasteOperationType` recupero/smaltimento) in
 * indicatori ESG: tasso di recupero, kg deviati da discarica e **CO₂ evitata**
 * stimata. È il differenziatore "ESG dal dato RENTRI": i dati sono già in casa,
 * qui vengono aggregati e convertiti.
 *
 * Tutte le query sono tenant-scoped.
 */
@Injectable()
export class EsgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(EsgService.name)
  }

  async getEnvironmentalReport(tenantId: string, range: EsgReportRange = {}): Promise<EsgReport> {
    const where: any = { tenantId }
    if (range.startDate || range.endDate) {
      where.createdAt = {}
      if (range.startDate) where.createdAt.gte = range.startDate
      if (range.endDate) where.createdAt.lte = range.endDate
    }

    // Aggregazione per CER + tipo operazione: una sola groupBy.
    const groups = await this.prisma.fIR.groupBy({
      by: ['cerCode', 'wasteOperationType'],
      where,
      _sum: { quantity: true },
    })

    // Accumula per CER.
    const perCer = new Map<string, { recoveryKg: number; disposalKg: number }>()
    for (const g of groups) {
      const qty = g._sum.quantity ? Number(g._sum.quantity) : 0
      const entry = perCer.get(g.cerCode) ?? { recoveryKg: 0, disposalKg: 0 }
      if (g.wasteOperationType === 'RECOVERY') {
        entry.recoveryKg += qty
      } else if (g.wasteOperationType === 'DISPOSAL') {
        entry.disposalKg += qty
      }
      perCer.set(g.cerCode, entry)
    }

    let recoveryKg = 0
    let disposalKg = 0
    let co2AvoidedKg = 0
    const byCer: EsgCerBreakdown[] = []

    for (const [cerCode, { recoveryKg: rec, disposalKg: dis }] of perCer) {
      const cerCo2 = rec * co2FactorForCer(cerCode)
      recoveryKg += rec
      disposalKg += dis
      co2AvoidedKg += cerCo2
      byCer.push({ cerCode, recoveryKg: rec, disposalKg: dis, co2AvoidedKg: cerCo2 })
    }

    // Ordina per maggior CO₂ evitata (più rilevanti in cima).
    byCer.sort((a, b) => b.co2AvoidedKg - a.co2AvoidedKg)

    const producedKg = recoveryKg + disposalKg
    const recyclingRate = producedKg > 0 ? recoveryKg / producedKg : 0

    return {
      period:
        range.startDate && range.endDate ? { from: range.startDate, to: range.endDate } : null,
      totals: {
        producedKg,
        recoveryKg,
        disposalKg,
        recyclingRate,
      },
      landfillDivertedKg: recoveryKg,
      co2AvoidedKg,
      byCer,
    }
  }
}
