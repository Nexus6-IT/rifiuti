import { Test, TestingModule } from '@nestjs/testing'
import { AnomalyDetectionService } from './anomaly-detection.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

describe('AnomalyDetectionService', () => {
  let service: AnomalyDetectionService
  let prisma: any

  beforeEach(async () => {
    const mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any
    prisma = {
      fIR: { findMany: jest.fn() },
      cERCode: { findMany: jest.fn() },
      wasteMovement: { groupBy: jest.fn() },
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnomalyDetectionService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()
    service = module.get(AnomalyDetectionService)
  })

  function setup(firs: any[], catalog: string[], movements: any[] = []) {
    prisma.fIR.findMany.mockResolvedValue(firs)
    prisma.cERCode.findMany.mockResolvedValue(catalog.map(code => ({ code })))
    prisma.wasteMovement.groupBy.mockResolvedValue(movements)
  }

  it('non segnala nulla per un FIR valido', async () => {
    setup(
      [
        {
          id: 'f1',
          firNumber: 'FIR-1',
          cerCode: '150101',
          quantity: 100,
          wasteDescription: 'carta',
        },
      ],
      ['15 01 01']
    )
    expect(await service.detectAnomalies('t1')).toEqual([])
  })

  it('segnala CER non in catalogo, quantità non positiva e descrizione mancante', async () => {
    setup(
      [{ id: 'f1', firNumber: 'FIR-1', cerCode: '999999', quantity: 0, wasteDescription: '' }],
      ['150101']
    )
    const types = (await service.detectAnomalies('t1')).map(a => a.type)
    expect(types).toContain('INVALID_CER')
    expect(types).toContain('NON_POSITIVE_QUANTITY')
    expect(types).toContain('MISSING_DESCRIPTION')
  })

  it('segnala quantità eccessiva oltre soglia', async () => {
    setup(
      [
        {
          id: 'f1',
          firNumber: 'FIR-1',
          cerCode: '150101',
          quantity: 5_000_000,
          wasteDescription: 'x',
        },
      ],
      ['150101']
    )
    const anomalies = await service.detectAnomalies('t1', { maxQuantityKg: 1_000_000 })
    expect(anomalies.find(a => a.type === 'EXCESSIVE_QUANTITY')).toBeDefined()
  })

  it('segnala giacenza impossibile (scarico > carico)', async () => {
    setup(
      [],
      ['150101'],
      [
        { cerCode: '150101', type: 'CARICO', _sum: { quantity: 10 } },
        { cerCode: '150101', type: 'SCARICO', _sum: { quantity: 40 } },
      ]
    )
    const anomalies = await service.detectAnomalies('t1')
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toMatchObject({ type: 'NEGATIVE_STOCK', cerCode: '15 01 01' })
  })

  describe('giacenza impossibile con le regole del registro', () => {
    it('raggruppa per CER e unità', async () => {
      setup([], ['150101'])
      await service.detectAnomalies('t1')
      expect(prisma.wasteMovement.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['cerCode', 'type', 'unit'] })
      )
    })

    it('1 t caricata e 600 kg scaricati: nessuna anomalia', async () => {
      setup(
        [],
        ['150101'],
        [
          { cerCode: '15 01 01', type: 'CARICO', unit: 'T', _sum: { quantity: 1 } },
          { cerCode: '15 01 01', type: 'SCARICO', unit: 'KG', _sum: { quantity: 600 } },
        ]
      )
      expect(await service.detectAnomalies('t1')).toEqual([])
    })

    it("'200301' caricato e '20 03 01' scaricato sono lo stesso CER", async () => {
      setup(
        [],
        ['200301'],
        [
          { cerCode: '200301', type: 'CARICO', unit: 'kg', _sum: { quantity: 100 } },
          { cerCode: '20 03 01', type: 'SCARICO', unit: 'KG', _sum: { quantity: 80 } },
        ]
      )
      expect(await service.detectAnomalies('t1')).toEqual([])
    })

    it('segnala la giacenza negativa reale in kg, anche fra tonnellate e kg', async () => {
      setup(
        [],
        ['200301'],
        [
          { cerCode: '200301', type: 'CARICO', unit: 'TONNELLATE', _sum: { quantity: 1 } },
          { cerCode: '20 03 01', type: 'SCARICO', unit: 'kg', _sum: { quantity: 1500 } },
        ]
      )
      const anomalies = await service.detectAnomalies('t1')
      expect(anomalies).toHaveLength(1)
      expect(anomalies[0]).toMatchObject({ type: 'NEGATIVE_STOCK', cerCode: '20 03 01' })
      expect(anomalies[0].message).toContain('1.500 kg')
      expect(anomalies[0].message).toContain('1.000 kg')
    })

    it('le unità non di massa si valutano a parte, mai sommate ai kg', async () => {
      setup(
        [],
        ['130205'],
        [
          { cerCode: '130205*', type: 'CARICO', unit: 'L', _sum: { quantity: 500 } },
          { cerCode: '13 02 05*', type: 'SCARICO', unit: 'kg', _sum: { quantity: 100 } },
          { cerCode: '130205*', type: 'SCARICO', unit: 'l', _sum: { quantity: 200 } },
          { cerCode: '130205*', type: 'CARICO', unit: 'M3', _sum: { quantity: 1 } },
          { cerCode: '130205*', type: 'SCARICO', unit: 'M3', _sum: { quantity: 3 } },
        ]
      )
      const anomalies = await service.detectAnomalies('t1')
      const messaggi = anomalies.map(a => a.message)
      expect(anomalies).toHaveLength(2)
      expect(anomalies.every(a => a.cerCode === '13 02 05*')).toBe(true)
      // kg: 100 scaricati, 0 caricati (i 500 L non contano come massa)
      expect(messaggi.some(m => m.includes('100 kg'))).toBe(true)
      // M3: 3 scaricati su 1 caricato; i litri (200 su 500) sono coerenti
      expect(messaggi.some(m => m.includes('3 M3'))).toBe(true)
      expect(messaggi.some(m => m.includes(' L'))).toBe(false)
    })
  })
})
