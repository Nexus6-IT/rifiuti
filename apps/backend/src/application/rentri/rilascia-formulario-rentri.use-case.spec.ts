import { RilasciaFormularioRENTRIUseCase } from './rilascia-formulario-rentri.use-case'
import { DomainException } from '../../domain/shared/domain-exception'
import { RentriOrigineLegame } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * RilasciaFormularioRENTRIUseCase — TDD (R2 Task 4)
 *
 * Simmetrico ad AcquisisciFormularioRENTRIUseCase: stessa politica d'ordine
 * (RENTRI prima, locale dopo) e stessa cautela sull'incoerenza.
 */
describe('RilasciaFormularioRENTRIUseCase', () => {
  const TENANT_ID = 'tenant-1'
  const USER_ID = 'user-1'
  const FIR_ID = 'fir-1'
  const NUMERO_FIR = 'RENTRI-000999'
  const NUM_ISCR_SITO = 'OP1234ABC123456-RM1234'

  let useCase: RilasciaFormularioRENTRIUseCase
  let mockFirRepository: any
  let mockRentriApiClient: any
  let mockPrisma: any
  let mockLogger: any

  const inputBase = () => ({
    tenantId: TENANT_ID,
    userId: USER_ID,
    userRole: 'OPERATOR',
    firId: FIR_ID,
    numIscrSito: NUM_ISCR_SITO,
    correlationId: 'corr-1',
  })

  function firFinto(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: FIR_ID,
      tenantId: TENANT_ID,
      rentriNumeroFir: NUMERO_FIR,
      rentriOrigineLegame: RentriOrigineLegame.ACQUISITO_DA_TERZI,
      rilasciaLegameRENTRI: jest.fn(),
      ...overrides,
    }
  }

  beforeEach(() => {
    mockFirRepository = {
      findById: jest.fn().mockResolvedValue(firFinto()),
      save: jest.fn().mockResolvedValue(undefined),
    }
    mockRentriApiClient = {
      rilasciaVisibilita: jest.fn().mockResolvedValue(undefined),
    }
    mockPrisma = {
      activityLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    }
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }

    useCase = new RilasciaFormularioRENTRIUseCase(
      mockFirRepository,
      mockRentriApiClient,
      mockPrisma,
      mockLogger
    )
  })

  // --- Autorizzazione ---

  it('rifiuta un VIEWER', async () => {
    await expect(useCase.execute({ ...inputBase(), userRole: 'VIEWER' })).rejects.toThrow(
      DomainException
    )
    expect(mockRentriApiClient.rilasciaVisibilita).not.toHaveBeenCalled()
  })

  it.each(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])('ammette il ruolo %s', async ruolo => {
    await expect(useCase.execute({ ...inputBase(), userRole: ruolo })).resolves.toBeDefined()
  })

  // --- Precondizioni ---

  it('rifiuta se il FIR non esiste', async () => {
    mockFirRepository.findById.mockResolvedValue(null)
    await expect(useCase.execute(inputBase())).rejects.toThrow(DomainException)
    expect(mockRentriApiClient.rilasciaVisibilita).not.toHaveBeenCalled()
  })

  it('rifiuta un FIR di un altro tenant (404)', async () => {
    mockFirRepository.findById.mockResolvedValue(firFinto({ tenantId: 'altro-tenant' }))
    await expect(useCase.execute(inputBase())).rejects.toThrow(DomainException)
    expect(mockRentriApiClient.rilasciaVisibilita).not.toHaveBeenCalled()
  })

  it('rifiuta un FIR senza alcun legame RENTRI', async () => {
    mockFirRepository.findById.mockResolvedValue(
      firFinto({ rentriNumeroFir: null, rentriOrigineLegame: null })
    )
    await expect(useCase.execute(inputBase())).rejects.toThrow(DomainException)
    expect(mockRentriApiClient.rilasciaVisibilita).not.toHaveBeenCalled()
  })

  it('rifiuta un legame TRASMESSO_DA_NOI (non rilasciabile, va annullato dal ciclo di vita RENTRI)', async () => {
    mockFirRepository.findById.mockResolvedValue(
      firFinto({ rentriOrigineLegame: RentriOrigineLegame.TRASMESSO_DA_NOI })
    )
    await expect(useCase.execute(inputBase())).rejects.toThrow(DomainException)
    expect(mockRentriApiClient.rilasciaVisibilita).not.toHaveBeenCalled()
  })

  it.each([RentriOrigineLegame.ACQUISITO_DA_TERZI, RentriOrigineLegame.AGGANCIO_MANUALE])(
    'ammette il rilascio con origine %s',
    async origine => {
      mockFirRepository.findById.mockResolvedValue(firFinto({ rentriOrigineLegame: origine }))
      await expect(useCase.execute(inputBase())).resolves.toBeDefined()
    }
  )

  // --- Ordine delle scritture ---

  it('chiama rilasciaVisibilita PRIMA della scrittura locale', async () => {
    const ordine: string[] = []
    mockRentriApiClient.rilasciaVisibilita.mockImplementation(async () => {
      ordine.push('rilasciaVisibilita')
    })
    mockFirRepository.save.mockImplementation(async () => {
      ordine.push('save')
    })

    await useCase.execute(inputBase())

    expect(ordine).toEqual(['rilasciaVisibilita', 'save'])
  })

  it('invoca rilasciaLegameRENTRI() sull’aggregate e salva il FIR', async () => {
    const fir = firFinto()
    mockFirRepository.findById.mockResolvedValue(fir)

    const risultato = await useCase.execute(inputBase())

    expect(fir.rilasciaLegameRENTRI).toHaveBeenCalledWith('corr-1')
    expect(mockFirRepository.save).toHaveBeenCalledWith(fir)
    expect(risultato.numeroFirRilasciato).toBe(NUMERO_FIR)
  })

  it('se la scrittura locale fallisce DOPO un rilascio riuscito su RENTRI, logga l’incoerenza e rilancia', async () => {
    const erroreDb = new Error('connessione al DB persa')
    mockFirRepository.save.mockRejectedValue(erroreDb)

    await expect(useCase.execute(inputBase())).rejects.toThrow(erroreDb)

    expect(mockRentriApiClient.rilasciaVisibilita).toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringMatching(/INCOERENZA/i),
      erroreDb,
      expect.objectContaining({ tenantId: TENANT_ID, firId: FIR_ID })
    )
  })

  // --- Audit ---

  it('scrive un ActivityLog con action RENTRI_RILASCIO_FORMULARIO', async () => {
    await useCase.execute(inputBase())

    expect(mockPrisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          firId: FIR_ID,
          action: 'RENTRI_RILASCIO_FORMULARIO',
          metadata: expect.objectContaining({
            numeroFir: NUMERO_FIR,
            origineRilasciata: RentriOrigineLegame.ACQUISITO_DA_TERZI,
          }),
        }),
      })
    )
  })

  it('non fallisce l’intera operazione se la sola scrittura dell’ActivityLog fallisce', async () => {
    mockPrisma.activityLog.create.mockRejectedValue(new Error('audit down'))
    await expect(useCase.execute(inputBase())).resolves.toBeDefined()
  })
})
