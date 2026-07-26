import { ConfermaLegameRENTRIUseCase } from './conferma-legame-rentri.use-case'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * ConfermaLegameRENTRIUseCase — TDD (R1 Task 2)
 *
 * Chiude il ciclo aperto dalla modalità IBRIDA: senza questo use case
 * `FIR.proporreLegameRENTRI` non avrebbe mai un modo di concludersi.
 */
describe('ConfermaLegameRENTRIUseCase', () => {
  let useCase: ConfermaLegameRENTRIUseCase
  let mockFIRRepository: any
  let mockLogger: any

  const FIR_ID = 'fir-123'
  const TENANT_ID = 'tenant-456'

  beforeEach(() => {
    mockFIRRepository = {
      findById: jest.fn(),
      save: jest.fn(),
    }
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    useCase = new ConfermaLegameRENTRIUseCase(mockFIRRepository, mockLogger)
  })

  it('conferma una proposta pendente, legando ufficialmente il FIR', async () => {
    const mockFIR: any = {
      id: FIR_ID,
      tenantId: TENANT_ID,
      rentriNumeroFirProposto: 'RENTRI-NUM-000555',
      rentriNumeroFir: null,
      confermaLegameRENTRI: jest.fn(function (this: any) {
        this.rentriNumeroFir = 'RENTRI-NUM-000555'
      }),
    }
    mockFIRRepository.findById.mockResolvedValue(mockFIR)

    const result = await useCase.execute(FIR_ID, TENANT_ID, 'correlazione-1')

    expect(mockFIR.confermaLegameRENTRI).toHaveBeenCalledWith('correlazione-1')
    expect(mockFIRRepository.save).toHaveBeenCalledWith(mockFIR)
    expect(result.numeroFir).toBe('RENTRI-NUM-000555')
  })

  it('rifiuta se il FIR non esiste', async () => {
    mockFIRRepository.findById.mockResolvedValue(null)

    await expect(useCase.execute(FIR_ID, TENANT_ID)).rejects.toThrow(DomainException)
    expect(mockFIRRepository.save).not.toHaveBeenCalled()
  })

  it('rifiuta un tenant diverso da quello proprietario del FIR', async () => {
    const mockFIR: any = {
      id: FIR_ID,
      tenantId: 'altro-tenant',
      rentriNumeroFirProposto: 'RENTRI-NUM-000555',
    }
    mockFIRRepository.findById.mockResolvedValue(mockFIR)

    await expect(useCase.execute(FIR_ID, TENANT_ID)).rejects.toThrow(DomainException)
    expect(mockFIRRepository.save).not.toHaveBeenCalled()
  })

  it('rifiuta se non esiste alcuna proposta pendente', async () => {
    const mockFIR: any = {
      id: FIR_ID,
      tenantId: TENANT_ID,
      rentriNumeroFirProposto: null,
    }
    mockFIRRepository.findById.mockResolvedValue(mockFIR)

    await expect(useCase.execute(FIR_ID, TENANT_ID)).rejects.toThrow(DomainException)
    expect(mockFIRRepository.save).not.toHaveBeenCalled()
  })
})
