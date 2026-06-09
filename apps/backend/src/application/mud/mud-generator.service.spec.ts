import { Test, TestingModule } from '@nestjs/testing';
import { MUDGeneratorService } from './mud-generator.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { LoggerService } from '../../core/logger/logger.service';

/**
 * MUD Generator Service Tests
 *
 * Verifica l'aggregazione REALE dei dati FIR per il report MUD annuale:
 * - somma quantità per codice CER nel periodo dell'anno richiesto
 * - ripartizione recupero (R) / smaltimento (D) per `wasteOperationType`
 * - calcolo del tasso di riciclo (recyclingRate)
 * - isolamento per tenant e filtro temporale
 */
describe('MUDGeneratorService', () => {
  let service: MUDGeneratorService;
  let prisma: PrismaService;
  let mockLogger: jest.Mocked<LoggerService>;

  beforeEach(async () => {
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MUDGeneratorService,
        {
          provide: PrismaService,
          useValue: {
            fIR: {
              groupBy: jest.fn(),
            },
          },
        },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<MUDGeneratorService>(MUDGeneratorService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  /** Instrada le due groupBy (per cerCode / per wasteOperationType) sui rispettivi dataset. */
  function mockGroupBy(
    byCer: any[],
    byOperation: any[],
  ): void {
    (prisma.fIR.groupBy as jest.Mock).mockImplementation((args: any) => {
      if (args.by.includes('cerCode')) return Promise.resolve(byCer);
      if (args.by.includes('wasteOperationType')) return Promise.resolve(byOperation);
      return Promise.resolve([]);
    });
  }

  it('aggrega per CER e calcola recovery/disposal/recyclingRate reali', async () => {
    mockGroupBy(
      [
        { cerCode: '130205', _sum: { quantity: 100 }, _count: 2 },
        { cerCode: '150101', _sum: { quantity: 50 }, _count: 1 },
      ],
      [
        { wasteOperationType: 'RECOVERY', _sum: { quantity: 90 }, _count: 2 },
        { wasteOperationType: 'DISPOSAL', _sum: { quantity: 60 }, _count: 1 },
      ],
    );

    const report = await service.generateMUDReport('tenant-1', 2026);

    expect(report.totals.produced).toBe(150);
    expect(report.totals.recovery).toBe(90);
    expect(report.totals.disposal).toBe(60);
    expect(report.totals.recyclingRate).toBeCloseTo(0.6, 5);

    expect(report.wasteProduced).toEqual([
      { cerCode: '130205', totalQuantity: 100, count: 2 },
      { cerCode: '150101', totalQuantity: 50, count: 1 },
    ]);
  });

  it('applica il filtro per tenant e per anno (1 gen – 31 dic)', async () => {
    mockGroupBy([], []);

    await service.generateMUDReport('tenant-xyz', 2025);

    const calls = (prisma.fIR.groupBy as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const [args] of calls) {
      expect(args.where.tenantId).toBe('tenant-xyz');
      expect(args.where.createdAt.gte).toEqual(new Date('2025-01-01'));
      expect(args.where.createdAt.lte).toEqual(new Date('2025-12-31'));
    }
  });

  it('restituisce zeri (senza divisione per zero) quando non ci sono FIR', async () => {
    mockGroupBy([], []);

    const report = await service.generateMUDReport('tenant-1', 2026);

    expect(report.totals.produced).toBe(0);
    expect(report.totals.recovery).toBe(0);
    expect(report.totals.disposal).toBe(0);
    expect(report.totals.recyclingRate).toBe(0);
    expect(report.wasteProduced).toEqual([]);
  });

  it('non usa più dati mock hardcoded (nessun warn di stub)', async () => {
    mockGroupBy(
      [{ cerCode: '130205', _sum: { quantity: 10 }, _count: 1 }],
      [{ wasteOperationType: 'RECOVERY', _sum: { quantity: 10 }, _count: 1 }],
    );

    await service.generateMUDReport('tenant-1', 2026);

    const warnArgs = mockLogger.warn.mock.calls.flat().join(' ');
    expect(warnArgs).not.toContain('mock');
    expect(warnArgs).not.toContain('does not exist');
  });
});
