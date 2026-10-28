import { Test, TestingModule } from '@nestjs/testing'
import { GiacenzeService } from './giacenze.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

describe('GiacenzeService', () => {
  let service: GiacenzeService
  let prisma: any
  /** Movimenti vigenti restituiti alla lettura degli eventi del FIFO. */
  let eventi: any[]
  /** Scarichi su FIR annullati restituiti alla lettura dedicata. */
  let scarichiFir: any[]

  beforeEach(async () => {
    const mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any
    eventi = []
    scarichiFir = []
    prisma = {
      wasteMovement: {
        groupBy: jest.fn(),
        // due letture: gli scarichi dei FIR annullati (filtro su firId) e gli eventi del FIFO
        findMany: jest.fn((args: any) =>
          Promise.resolve(args?.where?.firId ? scarichiFir : eventi)
        ),
      },
      fIR: { findMany: jest.fn().mockResolvedValue([]) },
      giacenzaIniziale: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GiacenzeService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()
    service = module.get(GiacenzeService)
  })

  let progressivo = 0
  /** Movimento vigente come lo legge il lettore degli eventi. */
  function mov(
    cerCode: string,
    type: 'CARICO' | 'SCARICO',
    quantity: number,
    giorno: string,
    extra: Record<string, unknown> = {}
  ) {
    progressivo += 1
    return {
      id: `m${progressivo}`,
      registroId: 'reg-A',
      cerCode,
      type,
      unit: 'KG',
      quantity,
      movementDate: new Date(`${giorno}T10:00:00Z`),
      progressiveYear: 2026,
      progressiveNumber: progressivo,
      ...extra,
    }
  }

  /** Instrada il groupBy delle somme (per tipo); `eventiMovimenti` alimenta il FIFO. */
  function mockGroupBy(byType: any[], eventiMovimenti: any[] = []) {
    eventi = eventiMovimenti
    prisma.wasteMovement.groupBy.mockImplementation((args: any) => {
      if (args.by.includes('type')) return Promise.resolve(byType)
      return Promise.resolve([]) // groupBy dell'asterisco
    })
  }

  /** Le chiamate al groupBy delle somme (quelle dell'asterisco non hanno il filtro di registro). */
  const chiamateSomme = () =>
    prisma.wasteMovement.groupBy.mock.calls.filter((c: any[]) => c[0].by.includes('type'))

  it('calcola la giacenza per CER (carico - scarico, clamp a 0)', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } },
        { cerCode: '150101', type: 'SCARICO', unit: 'KG', _sum: { quantity: 30 } },
        { cerCode: '170504', type: 'CARICO', unit: 'KG', _sum: { quantity: 10 } },
        { cerCode: '170504', type: 'SCARICO', unit: 'KG', _sum: { quantity: 25 } }, // scarico > carico
      ],
      [
        mov('150101', 'CARICO', 100, '2026-01-01'),
        mov('150101', 'SCARICO', 30, '2026-01-10'),
        mov('170504', 'CARICO', 10, '2026-05-01'),
        mov('170504', 'SCARICO', 25, '2026-05-02'),
      ]
    )

    const giacenze = await service.getGiacenze('tenant-1')

    const cer15 = giacenze.find(g => g.cerCode === '15 01 01')!
    expect(cer15.giacenzaKg).toBe(70)
    expect(cer15.oldestCaricoDate).toEqual(new Date('2026-01-01T00:00:00Z'))
    const cer17 = giacenze.find(g => g.cerCode === '17 05 04')!
    expect(cer17.giacenzaKg).toBe(0) // clamp: 10-25 → 0
    expect(cer17.oldestCaricoDate).toBeNull() // nessun lotto residuo
  })

  it('G6: il carico vecchio interamente scaricato non fa invecchiare il deposito', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 150 } },
        { cerCode: '150101', type: 'SCARICO', unit: 'KG', _sum: { quantity: 100 } },
      ],
      [
        mov('150101', 'CARICO', 100, '2025-01-01'),
        mov('150101', 'SCARICO', 100, '2025-02-01'),
        mov('150101', 'CARICO', 50, '2026-04-01'),
      ]
    )
    const [g] = await service.getGiacenze('tenant-1')
    expect(g.giacenzaKg).toBe(50)
    expect(g.oldestCaricoDate).toEqual(new Date('2026-04-01T00:00:00Z'))
  })

  it('un CER interamente scaricato ha oldestCaricoDate null', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } },
        { cerCode: '150101', type: 'SCARICO', unit: 'KG', _sum: { quantity: 100 } },
      ],
      [mov('150101', 'CARICO', 100, '2026-01-01'), mov('150101', 'SCARICO', 100, '2026-02-01')]
    )
    const [g] = await service.getGiacenze('tenant-1')
    expect(g.giacenzaKg).toBe(0)
    expect(g.oldestCaricoDate).toBeNull()
  })

  it('senza registroId: minimo dei lotti più vecchi dei registri, FIFO sempre per registro', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 200 } },
        { cerCode: '150101', type: 'SCARICO', unit: 'KG', _sum: { quantity: 100 } },
      ],
      [
        // reg-A: carico del 1/1 mai scaricato nel suo registro
        mov('150101', 'CARICO', 100, '2026-01-01', { registroId: 'reg-A' }),
        // reg-B: scarico del 1/2 e carico del 1/3; lo scarico NON consuma il lotto di reg-A
        mov('150101', 'SCARICO', 100, '2026-02-01', { registroId: 'reg-B' }),
        mov('150101', 'CARICO', 100, '2026-03-01', { registroId: 'reg-B' }),
      ]
    )
    const [g] = await service.getGiacenze('tenant-1')
    expect(g.oldestCaricoDate).toEqual(new Date('2026-01-01T00:00:00Z'))
  })

  it('giacenze: con registroId conta solo quel registro; senza, tutti', async () => {
    mockGroupBy([], [])

    await service.getGiacenze('tenant-1', 'reg-A')
    expect(chiamateSomme()).toHaveLength(1)
    for (const chiamata of chiamateSomme()) {
      expect(chiamata[0].where).toMatchObject({ tenantId: 'tenant-1', registroId: 'reg-A' })
    }
    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where).toMatchObject({
      registroId: 'reg-A',
    })

    prisma.wasteMovement.groupBy.mockClear()
    prisma.wasteMovement.findMany.mockClear()
    await service.getGiacenze('tenant-1')
    for (const chiamata of prisma.wasteMovement.groupBy.mock.calls) {
      expect(chiamata[0].where).not.toHaveProperty('registroId')
    }
    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where).not.toHaveProperty('registroId')
  })

  it('giacenze: gli alert di deposito rispettano il filtro registroId', async () => {
    mockGroupBy([], [])

    await service.getDepositoTemporaneoAlerts('tenant-1', undefined, undefined, 'reg-A')

    expect(chiamateSomme()).toHaveLength(1)
    for (const chiamata of chiamateSomme()) {
      expect(chiamata[0].where).toMatchObject({ registroId: 'reg-A' })
    }
  })

  it('giacenze: gli scarichi su FIR annullati rispettano il filtro registroId', async () => {
    mockGroupBy([], [])
    prisma.fIR.findMany.mockResolvedValue([
      {
        id: 'f1',
        status: 'CANCELLED',
        firNumber: 'F1',
        rentriNumeroFir: null,
        rentriStatoFormulario: null,
      },
    ])

    await service.getGiacenze('tenant-1', 'reg-A')

    const perFir = prisma.wasteMovement.findMany.mock.calls.find((c: any[]) => c[0].where.firId)
    expect(perFir[0].where).toMatchObject({ registroId: 'reg-A' })
  })

  it('alza alert DURATION quando il carico più vecchio supera i giorni massimi', async () => {
    mockGroupBy(
      [{ cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } }],
      [mov('150101', 'CARICO', 100, '2026-01-01')]
    )

    const alerts = await service.getDepositoTemporaneoAlerts(
      'tenant-1',
      { maxDurationDays: 90, maxQuantityKg: 1_000_000 },
      new Date('2026-06-01') // ~151 giorni dopo
    )

    expect(alerts).toHaveLength(1)
    expect(alerts[0].reasons).toContain('DURATION')
    expect(alerts[0].durationDays).toBeGreaterThan(90)
  })

  it('alza alert QUANTITY quando la giacenza supera la soglia in kg', async () => {
    mockGroupBy(
      [{ cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 50000 } }],
      [mov('150101', 'CARICO', 50000, '2026-05-30')]
    )

    const alerts = await service.getDepositoTemporaneoAlerts(
      'tenant-1',
      { maxDurationDays: 90, maxQuantityKg: 30000 },
      new Date('2026-06-01')
    )

    expect(alerts).toHaveLength(1)
    expect(alerts[0].reasons).toEqual(['QUANTITY'])
    expect(alerts[0].giacenzaKg).toBe(50000)
  })

  it('nessun alert se la giacenza è entro le soglie', async () => {
    mockGroupBy(
      [
        { cerCode: '150101', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } },
        { cerCode: '150101', type: 'SCARICO', unit: 'KG', _sum: { quantity: 100 } }, // giacenza 0
      ],
      [mov('150101', 'CARICO', 100, '2020-01-01'), mov('150101', 'SCARICO', 100, '2020-01-02')]
    )

    const alerts = await service.getDepositoTemporaneoAlerts('tenant-1')
    expect(alerts).toEqual([])
  })

  it('converte le tonnellate in kg e tiene i litri fuori dai kg', async () => {
    mockGroupBy([
      { cerCode: '170405', type: 'CARICO', unit: 'T', _sum: { quantity: 1 } },
      { cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 500 } },
      { cerCode: '170405', type: 'SCARICO', unit: 'kg', _sum: { quantity: 200 } },
      { cerCode: '170405', type: 'CARICO', unit: 'LITRI', _sum: { quantity: 30 } },
    ])
    const [g] = await service.getGiacenze('t1')
    expect(g).toMatchObject({ caricoKg: 1500, scaricoKg: 200, giacenzaKg: 1300 })
    expect(g.altreUnita).toEqual([
      { unita: 'LITRI', carico: 30, scarico: 0, giacenza: 30, iniziale: 0 },
    ])
  })

  it('elenca gli scarichi collegati a FIR annullati, senza toglierli dalla giacenza', async () => {
    mockGroupBy([
      { cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 500 } },
      { cerCode: '170405', type: 'SCARICO', unit: 'KG', _sum: { quantity: 200 } },
    ])
    prisma.fIR.findMany.mockResolvedValue([
      {
        id: 'f1',
        status: 'AWAITING_CARRIER',
        firNumber: 'FIR-2026-000003',
        rentriNumeroFir: null,
        rentriStatoFormulario: 'Annullato',
      },
    ])
    scarichiFir = [
      {
        cerCode: '170405',
        progressiveNumber: 9,
        progressiveYear: 2026,
        quantity: 200,
        unit: 'KG',
        firId: 'f1',
      },
    ]
    const [g] = await service.getGiacenze('t1')
    expect(g.giacenzaKg).toBe(300)
    expect(g.scarichiSuFirAnnullati).toEqual([
      { numero: '2026/9', quantita: 200, unita: 'KG', fir: 'FIR-2026-000003' },
    ])
    expect(prisma.fIR.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) })
    )
  })

  it('unisce in una riga lo stesso CER scritto in formati diversi', async () => {
    mockGroupBy(
      [
        { cerCode: '200301', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } },
        { cerCode: '20 03 01', type: 'CARICO', unit: 'KG', _sum: { quantity: 50 } },
        { cerCode: '20 03 01', type: 'SCARICO', unit: 'KG', _sum: { quantity: 30 } },
      ],
      [
        mov('200301', 'CARICO', 100, '2026-03-01'),
        mov('20 03 01', 'CARICO', 50, '2026-02-01'),
        mov('20 03 01', 'SCARICO', 30, '2026-02-10'),
      ]
    )
    const giacenze = await service.getGiacenze('t1')
    expect(giacenze).toHaveLength(1)
    expect(giacenze[0]).toMatchObject({
      cerCode: '20 03 01',
      caricoKg: 150,
      scaricoKg: 30,
      giacenzaKg: 120,
      oldestCaricoDate: new Date('2026-02-01T00:00:00Z'),
    })
  })

  it('non interroga gli scarichi dei FIR se nessun FIR è annullato', async () => {
    mockGroupBy([{ cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 5 } }])
    await service.getGiacenze('t1')
    const perFir = prisma.wasteMovement.findMany.mock.calls.filter((c: any[]) => c[0].where.firId)
    expect(perFir).toHaveLength(0)
  })

  describe('giacenze iniziali (aperture del registro)', () => {
    const apertura = (cerCode: string, quantita: number, unita: string, data: string) => ({
      id: `ap-${cerCode}-${unita}`,
      registroId: 'reg-A',
      cerCode,
      quantita,
      unita,
      dataRiferimento: new Date(`${data}T00:00:00Z`),
    })

    it('un CER con sola apertura compare con caricoKg = inizialeKg', async () => {
      mockGroupBy([], [])
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 06', 120, 'KG', '2026-02-01'),
      ])
      const [g] = await service.getGiacenze('tenant-1')
      expect(g).toMatchObject({
        cerCode: '15 01 06',
        caricoKg: 120,
        inizialeKg: 120,
        scaricoKg: 0,
        giacenzaKg: 120,
        oldestCaricoDate: new Date('2026-02-01T00:00:00Z'),
      })
    })

    it("somma l'apertura (anche in t) ai carichi e la distingue in inizialeKg", async () => {
      mockGroupBy(
        [
          { cerCode: '150106', type: 'CARICO', unit: 'KG', _sum: { quantity: 100 } },
          { cerCode: '150106', type: 'SCARICO', unit: 'KG', _sum: { quantity: 30 } },
        ],
        [mov('150106', 'CARICO', 100, '2026-03-01'), mov('150106', 'SCARICO', 30, '2026-03-02')]
      )
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 06', 2, 'T', '2026-01-15'),
      ])
      const [g] = await service.getGiacenze('tenant-1')
      expect(g).toMatchObject({ caricoKg: 2100, inizialeKg: 2000, giacenzaKg: 2070 })
      // lo scarico consuma l'apertura (più vecchia) ma ne resta: il lotto più vecchio è ancora lei
      expect(g.oldestCaricoDate).toEqual(new Date('2026-01-15T00:00:00Z'))
    })

    it("D9: il carico vecchio interamente scaricato non conta, conta l'apertura", async () => {
      mockGroupBy(
        [
          { cerCode: '150106', type: 'CARICO', unit: 'KG', _sum: { quantity: 10 } },
          { cerCode: '150106', type: 'SCARICO', unit: 'KG', _sum: { quantity: 10 } },
        ],
        [mov('150106', 'CARICO', 10, '2026-01-01'), mov('150106', 'SCARICO', 10, '2026-01-10')]
      )
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 06', 5, 'KG', '2026-02-01'),
      ])
      const [g] = await service.getGiacenze('tenant-1')
      expect(g.giacenzaKg).toBe(5)
      expect(g.oldestCaricoDate).toEqual(new Date('2026-02-01T00:00:00Z'))
    })

    it("l'asterisco vince fra apertura e movimenti", async () => {
      mockGroupBy([{ cerCode: '150110', type: 'CARICO', unit: 'KG', _sum: { quantity: 1 } }], [])
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 10*', 4, 'KG', '2026-02-01'),
      ])
      const giacenze = await service.getGiacenze('tenant-1')
      expect(giacenze).toHaveLength(1)
      expect(giacenze[0].cerCode).toBe('15 01 10*')
    })

    it('le unità non di massa hanno il loro iniziale e non si mescolano ai kg', async () => {
      mockGroupBy([
        { cerCode: '150106', type: 'CARICO', unit: 'LITRI', _sum: { quantity: 30 } },
        { cerCode: '150106', type: 'SCARICO', unit: 'LITRI', _sum: { quantity: 10 } },
      ])
      prisma.giacenzaIniziale.findMany.mockResolvedValue([
        apertura('15 01 06', 50, 'LITRI', '2026-02-01'),
      ])
      const [g] = await service.getGiacenze('tenant-1')
      expect(g.caricoKg).toBe(0)
      expect(g.inizialeKg).toBe(0)
      expect(g.altreUnita).toEqual([
        { unita: 'LITRI', carico: 80, scarico: 10, giacenza: 70, iniziale: 50 },
      ])
    })

    it('le aperture si leggono per tenant e, se indicato, per registro', async () => {
      mockGroupBy([], [])
      await service.getGiacenze('tenant-1', 'reg-A')
      // la prima lettura è quella del FIFO, la seconda quella delle somme: stesso filtro
      for (const i of [0, 1]) {
        expect(prisma.giacenzaIniziale.findMany.mock.calls[i][0].where).toEqual({
          tenantId: 'tenant-1',
          registroId: 'reg-A',
        })
      }
      prisma.giacenzaIniziale.findMany.mockClear()
      await service.getGiacenze('tenant-1')
      for (const i of [0, 1]) {
        expect(prisma.giacenzaIniziale.findMany.mock.calls[i][0].where).toEqual({
          tenantId: 'tenant-1',
        })
      }
    })
  })
})
