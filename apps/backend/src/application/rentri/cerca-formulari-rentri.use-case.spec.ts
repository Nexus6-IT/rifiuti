import { CercaFormulariRENTRIUseCase } from './cerca-formulari-rentri.use-case'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * CercaFormulariRENTRIUseCase — TDD (R2 Task 4)
 *
 * Copre i tre requisiti del brief:
 * 1. il CF del tenant è letto dall'anagrafica esistente (Tenant.codiceFiscale),
 *    mai chiesto all'utente;
 * 2. ogni risultato porta sia il flag RENTRI (`visibilitaGiaAcquisita`) sia la
 *    verifica LOCALE (`giaAgganciatoLocalmente`) — un formulario già
 *    agganciato da noi non deve essere riproposto per l'aggancio;
 * 3. senza il prerequisito (nessuna unità locale RENTRI configurata) la
 *    ricerca fallisce PRIMA di contattare RENTRI (fail-closed, R1 Task 2).
 */
describe('CercaFormulariRENTRIUseCase', () => {
  const TENANT_ID = 'tenant-1'
  const CF = 'RSSMRA80A01H501U'

  let useCase: CercaFormulariRENTRIUseCase
  let mockPrisma: any
  let mockUnitaLocaleService: any
  let mockRentriApiClient: any
  let mockFirRepository: any
  let mockLogger: any

  beforeEach(() => {
    mockPrisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ codiceFiscale: CF }),
      },
    }
    mockUnitaLocaleService = {
      getPrincipale: jest
        .fn()
        .mockResolvedValue({ id: 'ul-1', numIscrSito: 'OP1234ABC123456-RM1234' }),
    }
    mockRentriApiClient = {
      cercaFormulari: jest.fn(),
    }
    mockFirRepository = {
      findByRentriNumeroFir: jest.fn().mockResolvedValue(null),
    }
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }

    useCase = new CercaFormulariRENTRIUseCase(
      mockPrisma,
      mockUnitaLocaleService,
      mockRentriApiClient,
      mockFirRepository,
      mockLogger
    )
  })

  it('cerca per identificativo_soggetto = CF del tenant, letto dall’anagrafica', async () => {
    mockRentriApiClient.cercaFormulari.mockResolvedValue({
      risultati: [],
      paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 0 },
    })

    await useCase.execute(TENANT_ID)

    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      select: { codiceFiscale: true },
    })
    expect(mockRentriApiClient.cercaFormulari).toHaveBeenCalledWith(TENANT_ID, {
      identificativoSoggetto: CF,
    })
  })

  it('marca giaAgganciatoLocalmente=true per un numero_fir già agganciato a un FIR di questo tenant', async () => {
    mockRentriApiClient.cercaFormulari.mockResolvedValue({
      risultati: [
        { numero_fir: 'RENTRI-000111', visibilita_sito_acquisita: false },
        { numero_fir: 'RENTRI-000222', visibilita_sito_acquisita: true },
      ],
      paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 2 },
    })
    mockFirRepository.findByRentriNumeroFir.mockImplementation(
      async (_tenantId: string, numeroFir: string) =>
        numeroFir === 'RENTRI-000222' ? { id: 'fir-locale-1' } : null
    )

    const risultato = await useCase.execute(TENANT_ID)

    expect(risultato.risultati).toHaveLength(2)
    const primo = risultato.risultati.find(r => r.numeroFir === 'RENTRI-000111')!
    const secondo = risultato.risultati.find(r => r.numeroFir === 'RENTRI-000222')!

    expect(primo.giaAgganciatoLocalmente).toBe(false)
    expect(primo.firIdLocale).toBeUndefined()
    expect(primo.visibilitaGiaAcquisita).toBe(false)

    expect(secondo.giaAgganciatoLocalmente).toBe(true)
    expect(secondo.firIdLocale).toBe('fir-locale-1')
    expect(secondo.visibilitaGiaAcquisita).toBe(true)
  })

  it('scarta un risultato RENTRI privo di numero_fir (difensivo)', async () => {
    mockRentriApiClient.cercaFormulari.mockResolvedValue({
      risultati: [{ numero_fir: null, visibilita_sito_acquisita: false }],
      paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
    })

    const risultato = await useCase.execute(TENANT_ID)

    expect(risultato.risultati).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('fallisce PRIMA di chiamare RENTRI se il tenant non ha un CF configurato', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ codiceFiscale: null })

    await expect(useCase.execute(TENANT_ID)).rejects.toThrow(DomainException)
    expect(mockRentriApiClient.cercaFormulari).not.toHaveBeenCalled()
  })

  it('fallisce PRIMA di chiamare RENTRI se il tenant non ha nessuna unità locale configurata', async () => {
    mockUnitaLocaleService.getPrincipale.mockResolvedValue(null)

    await expect(useCase.execute(TENANT_ID)).rejects.toThrow(DomainException)
    await expect(useCase.execute(TENANT_ID)).rejects.toThrow(/unità locale/)
    expect(mockRentriApiClient.cercaFormulari).not.toHaveBeenCalled()
  })
})
