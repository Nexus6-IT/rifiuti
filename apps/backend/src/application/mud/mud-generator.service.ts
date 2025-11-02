import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { LoggerService } from '../../core/logger/logger.service';

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
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MUDGeneratorService.name);
  }

  async generateMUDReport(tenantId: string, year: number) {
    this.logger.info(`Generating MUD report for tenant ${tenantId}, year ${year}`);

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    // Aggregate waste produced
    const wasteProduced = await this.prisma.fIR.groupBy({
      by: ['cerCode'],
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { quantity: true },
      _count: true,
    });

    // Calculate totals - convert Decimal to number
    const totalProduced = wasteProduced.reduce((sum: number, w: { _sum: { quantity: any } }) =>
      sum + (w._sum.quantity ? Number(w._sum.quantity) : 0), 0);

    // TODO: Field 'destinationType' does not exist in Prisma schema - needs to be added
    // Temporarily returning mock recovery/disposal data
    this.logger.warn('generateMUDReport: destinationType field does not exist in schema, using mock data');

    const recovery = { _sum: { quantity: 0 } };
    const disposal = { _sum: { quantity: 0 } };

    /* Original implementation - restore after schema is updated with destinationType field:
    const recovery = await this.prisma.fIR.aggregate({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        destinationType: 'RECOVERY',
      },
      _sum: { quantity: true },
    });

    const disposal = await this.prisma.fIR.aggregate({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        destinationType: 'DISPOSAL',
      },
      _sum: { quantity: true },
    });
    */

    return {
      year,
      tenantId,
      generatedAt: new Date(),
      wasteProduced: wasteProduced.map((w: { cerCode: string; _sum: { quantity: any }; _count: number }) => ({
        cerCode: w.cerCode,
        totalQuantity: w._sum.quantity ? Number(w._sum.quantity) : 0,
        count: w._count,
      })),
      totals: {
        produced: totalProduced,
        recovery: recovery._sum.quantity ? Number(recovery._sum.quantity) : 0,
        disposal: disposal._sum.quantity ? Number(disposal._sum.quantity) : 0,
        recyclingRate: totalProduced > 0 ? (recovery._sum.quantity ? Number(recovery._sum.quantity) : 0) / totalProduced : 0,
      },
    };
  }
}
