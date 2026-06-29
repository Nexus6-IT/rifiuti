import { Test, TestingModule } from '@nestjs/testing'
import { RegistraMovimentoUseCase } from './registra-movimento.use-case'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'

describe('RegistraMovimentoUseCase', () => {
  let useCase: RegistraMovimentoUseCase
  let prisma: any

  const mockLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  const TENANT = 'tenant-uuid-001'
  const USER   = 'user-uuid-001'
  const TODAY  = new Date('2026-06-29T10:00:00.000Z')

  function buildPrisma(overrides: Partial<typeof prisma> = {}) {
    return {
      wasteMovement: {
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
      ...overrides,
    }
  }

  function buildCommand(): RegistraMovimentoCommand {
    return new RegistraMovimentoCommand(
      TENANT, USER, 'CARICO', TODAY, TODAY,
      'PRODUZIONE_INTERNA', '20 03 01', 'Rifiuti urbani misti',
      100, 'KG', 'Solido',
      undefined, undefined, undefined, undefined, undefined, undefined,
    )
  }

  /** Helper che simula la transazione Prisma con un singolo progressivo disponibile. */
  function mockTransazione(record: object) {
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
        wasteMovement: {
          create: jest.fn().mockResolvedValue(record),
        },
      }
      return fn(tx)
    })
  }

  beforeEach(async () => {
    prisma = buildPrisma()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistraMovimentoUseCase,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()

    useCase = module.get(RegistraMovimentoUseCase)
  })

  afterEach(() => jest.clearAllMocks())

  // ─── Numero progressivo ──────────────────────────────────────────────────────

  it('assegna progressivo 1 al primo movimento dell\'anno', async () => {
    let capturedData: any
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
        wasteMovement: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedData = args.data
            return {
              ...args.data,
              id: 'id-001',
              createdAt: TODAY,
              updatedAt: TODAY,
              quantity: args.data.quantity,
              wasteDescription: null,
              wastePhysicalState: null,
              wasteHazardClasses: null,
              operationCode: null,
              counterpartName: null,
              counterpartAddress: null,
              firId: null,
              recordedByUserId: USER,
              notes: null,
            }
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT, USER, 'CARICO', TODAY, TODAY,
      'PRODUZIONE_INTERNA', '20 03 01', 'Rifiuti misti', 100, 'KG',
      'Solido', undefined, undefined, undefined, undefined, undefined, undefined,
    )
    const result = await useCase.execute(cmd)

    expect(result.isSuccess).toBe(true)
    expect(capturedData.progressiveNumber).toBe(1)
    expect(capturedData.progressiveYear).toBe(2026)
  })

  it('assegna progressivo n+1 quando esistono già movimenti nell\'anno', async () => {
    let capturedData: any
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: 42 }]),
        wasteMovement: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedData = args.data
            return { ...args.data, id: 'id-002', createdAt: TODAY, updatedAt: TODAY }
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT, USER, 'CARICO', TODAY, TODAY,
      'PRODUZIONE_INTERNA', '20 03 01', undefined, 50, 'KG',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    )
    const result = await useCase.execute(cmd)

    expect(result.isSuccess).toBe(true)
    expect(capturedData.progressiveNumber).toBe(43)
  })

  // ─── Hash vidimazione ────────────────────────────────────────────────────────

  it('persiste un entryHash SHA-256 non vuoto', async () => {
    let capturedData: any
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
        wasteMovement: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedData = args.data
            return { ...args.data, id: 'id-003', createdAt: TODAY, updatedAt: TODAY }
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT, USER, 'CARICO', TODAY, TODAY,
      'PRODUZIONE_INTERNA', '20 03 01', undefined, 100, 'KG',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    )
    await useCase.execute(cmd)

    expect(capturedData.entryHash).toMatch(/^[0-9a-f]{64}$/)
  })

  // ─── Giacenza insufficiente ──────────────────────────────────────────────────

  it('restituisce errore se lo scarico supera la giacenza disponibile', async () => {
    // Giacenza: 80 kg, scarico richiesto: 100 kg
    prisma.wasteMovement.groupBy.mockResolvedValue([
      { type: 'CARICO',  _sum: { quantity: 80 } },
      { type: 'SCARICO', _sum: { quantity: 0 } },
    ])

    const cmd = new RegistraMovimentoCommand(
      TENANT, USER, 'SCARICO', TODAY, TODAY,
      'CONFERIMENTO_TRASPORTATORE', '20 03 01', undefined, 100, 'KG',
      undefined, undefined, undefined, undefined, undefined, 'fir-id-001', undefined,
    )
    const result = await useCase.execute(cmd)

    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('Giacenza insufficiente')
  })

  it('permette lo scarico se la giacenza è sufficiente', async () => {
    prisma.wasteMovement.groupBy.mockResolvedValue([
      { type: 'CARICO',  _sum: { quantity: 200 } },
      { type: 'SCARICO', _sum: { quantity: 50 } },
    ])
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: 5 }]),
        wasteMovement: {
          create: jest.fn().mockResolvedValue({
            id: 'id-004',
            tenantId: TENANT,
            progressiveNumber: 6,
            progressiveYear: 2026,
            type: 'SCARICO',
            movementDate: TODAY,
            registrationDate: TODAY,
            causale: 'CONFERIMENTO_TRASPORTATORE',
            cerCode: '20 03 01',
            wasteDescription: null,
            quantity: 100,
            unit: 'KG',
            wastePhysicalState: null,
            wasteHazardClasses: null,
            operationCode: null,
            counterpartName: null,
            counterpartAddress: null,
            firId: 'fir-id-001',
            recordedByUserId: USER,
            entryHash: 'a'.repeat(64),
            notes: null,
            createdAt: TODAY,
            updatedAt: TODAY,
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT, USER, 'SCARICO', TODAY, TODAY,
      'CONFERIMENTO_TRASPORTATORE', '20 03 01', undefined, 100, 'KG',
      undefined, undefined, undefined, undefined, undefined, 'fir-id-001', undefined,
    )
    const result = await useCase.execute(cmd)

    expect(result.isSuccess).toBe(true)
    expect(result.value.type).toBe('SCARICO')
  })

  // ─── Ritardo registrazione ───────────────────────────────────────────────────

  it('segnala fuoriTermine se la data di registrazione supera i 14 gg dalla data operazione', async () => {
    const movDate = new Date('2026-06-01T00:00:00.000Z')
    const regDate = new Date('2026-06-20T00:00:00.000Z') // 19 gg dopo

    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
        wasteMovement: {
          create: jest.fn().mockResolvedValue({
            id: 'id-005',
            tenantId: TENANT,
            progressiveNumber: 1,
            progressiveYear: 2026,
            type: 'CARICO',
            movementDate: movDate,
            registrationDate: regDate,
            causale: 'PRODUZIONE_INTERNA',
            cerCode: '20 03 01',
            wasteDescription: null,
            quantity: 50,
            unit: 'KG',
            wastePhysicalState: null,
            wasteHazardClasses: null,
            operationCode: null,
            counterpartName: null,
            counterpartAddress: null,
            firId: null,
            recordedByUserId: USER,
            entryHash: 'b'.repeat(64),
            notes: null,
            createdAt: TODAY,
            updatedAt: TODAY,
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT, USER, 'CARICO', movDate, regDate,
      'PRODUZIONE_INTERNA', '20 03 01', undefined, 50, 'KG',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    )
    const result = await useCase.execute(cmd)

    expect(result.isSuccess).toBe(true)
    expect(result.value.fuoriTermine).toBe(true)
    expect(result.value.ritardoGg).toBeGreaterThan(0)
  })

  // ─── Isolamento multi-tenant ─────────────────────────────────────────────────

  it('la query giacenza filtra per tenantId — no leak cross-tenant', async () => {
    prisma.wasteMovement.groupBy.mockResolvedValue([])
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
        wasteMovement: {
          create: jest.fn().mockResolvedValue({
            id: 'id-006', tenantId: TENANT, progressiveNumber: 1, progressiveYear: 2026,
            type: 'SCARICO', movementDate: TODAY, registrationDate: TODAY,
            causale: 'AVVIO_RECUPERO', cerCode: '20 03 01',
            wasteDescription: null, quantity: 10, unit: 'KG',
            wastePhysicalState: null, wasteHazardClasses: null, operationCode: null,
            counterpartName: null, counterpartAddress: null,
            firId: null, recordedByUserId: USER, entryHash: 'c'.repeat(64),
            notes: null, createdAt: TODAY, updatedAt: TODAY,
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT, USER, 'SCARICO', TODAY, TODAY,
      'AVVIO_RECUPERO', '20 03 01', undefined, 10, 'KG',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    )
    await useCase.execute(cmd)

    // La chiamata groupBy deve includere tenantId (non altri tenant)
    expect(prisma.wasteMovement.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT }),
      }),
    )
  })

  // ─── Causali ─────────────────────────────────────────────────────────────────

  it('rifiuta una causale di carico non valida', async () => {
    const cmd = new RegistraMovimentoCommand(
      TENANT, USER, 'CARICO', TODAY, TODAY,
      'CONFERIMENTO_TRASPORTATORE' as any, // causale di scarico su tipo CARICO
      '20 03 01', undefined, 100, 'KG',
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    )
    const result = await useCase.execute(cmd)
    // Il dominio lancia un'eccezione che la use-case cattura come Result.fail
    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('Causale non valida per CARICO')
  })
})
