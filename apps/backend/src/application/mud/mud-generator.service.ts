import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

/**
 * MUD Generator Service
 *
 * Generates MUD (Modello Unico Dichiarazione) annual reports.
 * Aggregates FIR data for environmental compliance reporting.
 */
@Injectable()
export class MUDGeneratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(MUDGeneratorService.name)
  }

  async generateMUDReport(tenantId: string, year: number) {
    this.logger.info(`Generating MUD report for tenant ${tenantId}, year ${year}`)

    const startDate = new Date(`${year}-01-01`)
    const endDate = new Date(`${year}-12-31`)

    // Aggregate waste produced
    const wasteProduced = await this.prisma.fIR.groupBy({
      by: ['cerCode'],
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { quantity: true },
      _count: true,
    })

    // Calculate totals - convert Decimal to number
    const totalProduced = wasteProduced.reduce(
      (sum: number, w: { _sum: { quantity: any } }) =>
        sum + (w._sum.quantity ? Number(w._sum.quantity) : 0),
      0
    )

    // Ripartizione recupero (R) / smaltimento (D) basata sul campo reale
    // `wasteOperationType` dei FIR del periodo. Una sola groupBy invece di due
    // aggregate separate.
    const byOperation = await this.prisma.fIR.groupBy({
      by: ['wasteOperationType'],
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { quantity: true },
      _count: true,
    })

    let recovery = 0
    let disposal = 0
    for (const group of byOperation) {
      const quantity = group._sum.quantity ? Number(group._sum.quantity) : 0
      if (group.wasteOperationType === 'RECOVERY') {
        recovery = quantity
      } else if (group.wasteOperationType === 'DISPOSAL') {
        disposal = quantity
      }
    }

    return {
      year,
      tenantId,
      generatedAt: new Date(),
      wasteProduced: wasteProduced.map(
        (w: { cerCode: string; _sum: { quantity: any }; _count: number }) => ({
          cerCode: w.cerCode,
          totalQuantity: w._sum.quantity ? Number(w._sum.quantity) : 0,
          count: w._count,
        })
      ),
      totals: {
        produced: totalProduced,
        recovery,
        disposal,
        recyclingRate: totalProduced > 0 ? recovery / totalProduced : 0,
      },
    }
  }
}
