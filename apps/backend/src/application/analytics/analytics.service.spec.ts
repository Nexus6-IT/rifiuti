import { Test, TestingModule } from '@nestjs/testing'
import { AnalyticsService } from './analytics.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

/**
 * Analytics Service Tests
 *
 * Tests for dashboard metrics calculation:
 * - FIR statistics (total, by status, by period)
 * - Waste type breakdown (CER codes)
 * - RENTRI sync metrics
 * - Signature completion rates
 * - Environmental impact metrics
 * - Compliance indicators
 */
describe('AnalyticsService', () => {
  let service: AnalyticsService
  let prisma: PrismaService
  let mockLogger: jest.Mocked<LoggerService>

  beforeEach(async () => {
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: PrismaService,
          useValue: {
            fIR: {
              count: jest.fn(),
              groupBy: jest.fn(),
              aggregate: jest.fn(),
            },
            $queryRaw: jest.fn(),
          },
        },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()

    service = module.get<AnalyticsService>(AnalyticsService)
    prisma = module.get<PrismaService>(PrismaService)
  })

  describe('FIR Statistics', () => {
    it('should calculate total FIRs for tenant', async () => {
      ;(prisma.fIR.count as jest.Mock).mockResolvedValue(150)

      const total = await service.getTotalFIRs('tenant-1')

      expect(total).toBe(150)
      expect(prisma.fIR.count).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
      })
    })

    it('should calculate FIRs by status', async () => {
      ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([
        { status: 'DRAFT', _count: 20 },
        { status: 'SIGNED_BY_PRODUCER', _count: 30 },
        { status: 'IN_TRANSIT', _count: 50 },
        { status: 'COMPLETED', _count: 100 },
      ])

      const byStatus = await service.getFIRsByStatus('tenant-1')

      expect(byStatus).toEqual({
        DRAFT: 20,
        SIGNED_BY_PRODUCER: 30,
        IN_TRANSIT: 50,
        COMPLETED: 100,
      })
    })

    it('should calculate FIRs by time period', async () => {
      const mockData = [
        { date: new Date('2025-01-01'), count: 10 },
        { date: new Date('2025-01-02'), count: 15 },
        { date: new Date('2025-01-03'), count: 12 },
      ]

      ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue(
        mockData.map(d => ({
          createdAt: d.date,
          _count: d.count,
        }))
      )

      const byPeriod = await service.getFIRsByPeriod(
        'tenant-1',
        new Date('2025-01-01'),
        new Date('2025-01-03')
      )

      expect(byPeriod.length).toBe(3)
      expect(byPeriod[0].count).toBe(10)
    })
  })

  describe('Waste Type Analytics', () => {
    it('should calculate waste by CER code', async () => {
      ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([
        { cerCode: '150101', _count: 50, _sum: { quantity: 5000 } },
        { cerCode: '150102', _count: 30, _sum: { quantity: 3000 } },
        { cerCode: '200301', _count: 20, _sum: { quantity: 2000 } },
      ])

      const byCER = await service.getWasteByCERCode('tenant-1')

      expect(byCER.length).toBe(3)
      expect(byCER[0].cerCode).toBe('150101')
      expect(byCER[0].totalQuantity).toBe(5000)
    })

    it('should calculate total waste quantity', async () => {
      ;(prisma.fIR.aggregate as jest.Mock).mockResolvedValue({
        _sum: { quantity: 125000 },
      })

      const total = await service.getTotalWasteQuantity('tenant-1')

      expect(total).toBe(125000)
    })

    it('should calculate waste by destination type (recovery vs disposal)', async () => {
      ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([
        { wasteOperationType: 'RECOVERY', _count: 80, _sum: { quantity: 8000 } },
        { wasteOperationType: 'DISPOSAL', _count: 20, _sum: { quantity: 2000 } },
      ])

      const byDestination = await service.getWasteByDestination('tenant-1')

      expect(byDestination.recovery).toEqual({ count: 80, quantity: 8000 })
      expect(byDestination.disposal).toEqual({ count: 20, quantity: 2000 })
      // 80 recupero su 100 totali = 0.8
      expect(byDestination.recyclingRate).toBeCloseTo(0.8, 5)
      expect(prisma.fIR.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['wasteOperationType'], where: { tenantId: 'tenant-1' } })
      )
    })
  })

  describe('RENTRI Sync Metrics', () => {
    it('should calculate RENTRI sync success rate', async () => {
      ;(prisma.fIR.count as jest.Mock)
        .mockResolvedValueOnce(100) // total completed
        .mockResolvedValueOnce(95) // successfully synced

      const syncRate = await service.getRENTRISyncRate('tenant-1')

      expect(syncRate.total).toBe(100)
      expect(syncRate.synced).toBe(95)
      expect(syncRate.rate).toBe(0.95)
    })

    it('should get pending RENTRI syncs', async () => {
      ;(prisma.fIR.count as jest.Mock).mockResolvedValue(5)

      const pending = await service.getPendingRENTRISyncs('tenant-1')

      expect(pending).toBe(5)
    })

    it('should get failed RENTRI syncs', async () => {
      ;(prisma.fIR.count as jest.Mock).mockResolvedValue(3)

      const failed = await service.getFailedRENTRISyncs('tenant-1')

      expect(failed).toBe(3)
    })
  })

  describe('Signature Metrics', () => {
    it('should calculate signature completion rate', async () => {
      ;(prisma.fIR.count as jest.Mock)
        .mockResolvedValueOnce(150) // total
        .mockResolvedValueOnce(100) // completed

      const completionRate = await service.getSignatureCompletionRate('tenant-1')

      expect(completionRate.total).toBe(150)
      expect(completionRate.completed).toBe(100)
      expect(completionRate.rate).toBe(0.667)
    })

    it('should calculate average signature time', async () => {
      const mockFIRs = [
        {
          createdAt: new Date('2025-01-01T10:00:00'),
          completedAt: new Date('2025-01-01T12:00:00'), // 2 hours
        },
        {
          createdAt: new Date('2025-01-02T10:00:00'),
          completedAt: new Date('2025-01-02T14:00:00'), // 4 hours
        },
      ]

      ;(prisma.fIR.findMany as any) = jest.fn().mockResolvedValue(mockFIRs)

      const avgTime = await service.getAverageSignatureTime('tenant-1')

      expect(avgTime).toBe(3) // average 3 hours
    })
  })

  describe('Compliance Metrics', () => {
    it('should calculate compliance score', async () => {
      // Mock various compliance checks
      ;(prisma.fIR.count as jest.Mock)
        .mockResolvedValueOnce(100) // total FIRs
        .mockResolvedValueOnce(95) // with all signatures
        .mockResolvedValueOnce(90) // synced to RENTRI
        .mockResolvedValueOnce(0) // overdue

      const score = await service.getComplianceScore('tenant-1')

      expect(score.totalFIRs).toBe(100)
      expect(score.score).toBeGreaterThan(0.9)
      expect(score.level).toBe('EXCELLENT')
    })

    it('senza modulo rentri: pesi ripesati (0,4/0,2 -> 2/3 e 1/3), rentriSyncRate 0, nessun conteggio SYNCED', async () => {
      ;(prisma.fIR.count as jest.Mock)
        .mockResolvedValueOnce(100) // total FIRs
        .mockResolvedValueOnce(100) // firmati
        .mockResolvedValueOnce(0) // in ritardo

      const r = await service.getComplianceScore('tenant-1', { conRentri: false })

      // Tutto firmato e nulla in ritardo: 1, non il tetto di 0,6 dei pesi con RENTRI.
      expect(r.score).toBeCloseTo(1, 10)
      expect(r.level).toBe('EXCELLENT')
      expect(r.factors.rentriSyncRate).toBe(0)
      expect(prisma.fIR.count).toHaveBeenCalledTimes(3)
      expect(prisma.fIR.count).not.toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', rentriSyncStatus: 'SYNCED' },
      })
    })

    it('senza modulo rentri: metà firmati e un quarto in ritardo', async () => {
      ;(prisma.fIR.count as jest.Mock)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(25)

      const r = await service.getComplianceScore('tenant-1', { conRentri: false })

      expect(r.score).toBeCloseTo(0.5 * (2 / 3) + 0.75 * (1 / 3), 10)
    })

    it('should identify overdue FIRs', async () => {
      ;(prisma.fIR.count as jest.Mock).mockResolvedValue(5)

      const overdue = await service.getOverdueFIRs('tenant-1')

      expect(overdue).toBe(5)
    })
  })

  describe('Trends Analysis', () => {
    it('should calculate month-over-month growth', async () => {
      ;(prisma.fIR.count as jest.Mock)
        .mockResolvedValueOnce(100) // current month
        .mockResolvedValueOnce(80) // previous month

      const growth = await service.getMonthOverMonthGrowth('tenant-1')

      expect(growth.current).toBe(100)
      expect(growth.previous).toBe(80)
      expect(growth.percentage).toBe(0.25) // 25% growth
    })
  })

  describe('Previsione del mese (regressione lineare sugli ultimi 6 mesi completi)', () => {
    // «oggi» = 15 novembre 2026: i mesi completi sono maggio..ottobre 2026
    const oggi = new Date(Date.UTC(2026, 10, 15, 12))
    const mesi = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
    const righe = (conteggi: Array<number | undefined>) =>
      conteggi.flatMap((c, i) =>
        c === undefined ? [] : [{ mese: new Date(`${mesi[i]}-01T00:00:00.000Z`), conteggio: c }]
      )
    const prevedi = async (conteggi: Array<number | undefined>) => {
      ;(prisma.$queryRaw as jest.Mock).mockResolvedValue(righe(conteggi))
      return service.predictNextMonthVolume('tenant-1', oggi)
    }

    it('serie lineare [10..20] -> 22', async () => {
      expect(await prevedi([10, 12, 14, 16, 18, 20])).toBe(22)
    })

    it('serie costante -> la stessa', async () => {
      expect(await prevedi([20, 20, 20, 20, 20, 20])).toBe(20)
    })

    it('serie in calo [30, 20, 10] -> 0 esatto', async () => {
      expect(await prevedi([undefined, undefined, undefined, 30, 20, 10])).toBe(0)
    })

    it('serie in calo [30, 15, 5]: la retta darebbe -8,33, il risultato e 0 (mai negativo)', async () => {
      expect(await prevedi([undefined, undefined, undefined, 30, 15, 5])).toBe(0)
    })

    it('si parte dal primo mese con un FIR: [0, 0, 5] dopo il primo FIR -> 5 (un mese)', async () => {
      expect(await prevedi([undefined, undefined, undefined, undefined, undefined, 5])).toBe(5)
    })

    it('un solo mese completo [7] -> 7; due mesi -> media arrotondata', async () => {
      expect(await prevedi([undefined, undefined, undefined, undefined, undefined, 7])).toBe(7)
      expect(await prevedi([undefined, undefined, undefined, undefined, 3, 4])).toBe(4)
    })

    it('mesi vuoti dopo il primo FIR valgono 0: [10,0,0,0,0,0] -> grezza -3,33, limitata a 0', async () => {
      expect(await prevedi([10])).toBe(0)
    })

    it('nessun mese completo -> null', async () => {
      expect(await prevedi([])).toBeNull()
    })

    it('il mese in corso non entra: limite < primo giorno del mese corrente', async () => {
      await prevedi([])
      const args = (prisma.$queryRaw as jest.Mock).mock.calls[0]
      expect(args).toContainEqual(new Date(Date.UTC(2026, 10, 1)))
      expect(args).toContainEqual(new Date(Date.UTC(2026, 4, 1)))
      const sql = (args[0] as string[]).join('?')
      expect(sql).toContain('created_at >= ?')
      expect(sql).toContain('created_at < ?')
      expect(sql).not.toContain('<=')
      // stessa base dell'andamento: bozze e annullati fuori
      expect(args.some((a: unknown) => String(JSON.stringify(a)).includes('CANCELLED'))).toBe(true)
    })
  })

  describe('Top Producers/Carriers', () => {
    it("unisce il nome alle P. IVA del groupBy mantenendo l'ordine; senza riga -> null", async () => {
      ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([
        { producerPartitaIva: '12345678901', _count: 50 },
        { producerPartitaIva: '98765432109', _count: 30 },
        { producerPartitaIva: '11122233344', _count: 20 },
      ])
      ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { partita_iva: '11122233344', nome: 'Terza SRL' },
        { partita_iva: '12345678901', nome: 'Prima SRL' },
      ])

      const top = await service.getTopProducers('tenant-1', 10)

      expect(top).toEqual([
        { partitaIva: '12345678901', nome: 'Prima SRL', count: 50 },
        { partitaIva: '98765432109', nome: null, count: 30 },
        { partitaIva: '11122233344', nome: 'Terza SRL', count: 20 },
      ])
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
      const chiamata = (prisma.fIR.groupBy as jest.Mock).mock.calls[0][0]
      expect(chiamata.orderBy).toEqual([
        { _count: { producerPartitaIva: 'desc' } },
        { producerPartitaIva: 'asc' },
      ])
      expect(chiamata.where).toEqual({ tenantId: 'tenant-1', producerPartitaIva: { not: '' } })
    })

    it('nome vuoto o di soli spazi -> null', async () => {
      ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([
        { producerPartitaIva: '12345678901', _count: 5 },
        { producerPartitaIva: '98765432109', _count: 4 },
      ])
      ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { partita_iva: '12345678901', nome: '' },
        { partita_iva: '98765432109', nome: '   ' },
      ])
      const top = await service.getTopProducers('tenant-1', 10)
      expect(top.map(t => t.nome)).toEqual([null, null])
    })

    it('groupBy vuoto -> nessuna $queryRaw', async () => {
      ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([])
      expect(await service.getTopProducers('tenant-1', 5)).toEqual([])
      expect(await service.getTopCarriers('tenant-1', 5)).toEqual([])
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('trasportatori: nome unito, P. IVA vuota esclusa dal where', async () => {
      ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([
        { carrierPartitaIva: '12345678901', _count: 40 },
        { carrierPartitaIva: '98765432109', _count: 35 },
      ])
      ;(prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { partita_iva: '98765432109', nome: 'Trasporti Bis' },
      ])
      const top = await service.getTopCarriers('tenant-1', 10)
      expect(top).toEqual([
        { partitaIva: '12345678901', nome: null, count: 40 },
        { partitaIva: '98765432109', nome: 'Trasporti Bis', count: 35 },
      ])
      expect((prisma.fIR.groupBy as jest.Mock).mock.calls[0][0].where).toEqual({
        tenantId: 'tenant-1',
        carrierPartitaIva: { not: '' },
      })
    })
  })

  describe('getFIRsByStatus con intervallo', () => {
    it('passa createdAt gte/lte; senza intervallo nessun filtro sulla data', async () => {
      ;(prisma.fIR.groupBy as jest.Mock).mockResolvedValue([{ status: 'COMPLETED', _count: 2 }])
      const startDate = new Date('2026-11-01T00:00:00Z')
      const endDate = new Date('2026-11-30T23:59:59Z')

      expect(await service.getFIRsByStatus('t', { startDate, endDate })).toEqual({ COMPLETED: 2 })
      expect((prisma.fIR.groupBy as jest.Mock).mock.calls[0][0].where).toEqual({
        tenantId: 't',
        createdAt: { gte: startDate, lte: endDate },
      })

      await service.getFIRsByStatus('t')
      expect((prisma.fIR.groupBy as jest.Mock).mock.calls[1][0].where).toEqual({ tenantId: 't' })
    })
  })
})
