import { AcquisisciFormularioRENTRIUseCase } from './acquisisci-formulario-rentri.use-case'
import { DomainException } from '../../domain/shared/domain-exception'
import { RentriOrigineLegame } from '../../domain/fir/aggregates/fir.aggregate'

/**
 * AcquisisciFormularioRENTRIUseCase — TDD (R2 Task 4)
 *
 * Copre il "punto delicato" del brief: l'ordine delle due scritture
 * (RENTRI, poi locale) e come si comporta quando la seconda fallisce dopo
 * che la prima è riuscita (v. test "incoerenza").
 */
describe('AcquisisciFormularioRENTRIUseCase', () => {
  const TENANT_ID = 'tenant-1'
  const USER_ID = 'user-1'
  const NUMERO_FIR = 'RENTRI-000999'
  const NUM_ISCR_SITO = 'OP1234ABC123456-RM1234'

  let useCase: AcquisisciFormularioRENTRIUseCase
  let mockFirRepository: any
  let mockRentriApiClient: any
  let mockPrisma: any
  let mockCreaFirPort: any
  let mockLogger: any

  const inputBase = () => ({
    tenantId: TENANT_ID,
    userId: USER_ID,
    userRole: 'OPERATOR',
    numeroFir: NUMERO_FIR,
    numIscrSito: NUM_ISCR_SITO,
    visibilitaGiaAcquisita: false,
    scelta: { tipo: 'NUOVO' as const },
    correlationId: 'corr-1',
  })

  beforeEach(() => {
    mockFirRepository = {
      findByRentriNumeroFir: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    }
    mockRentriApiClient = {
      acquisisciVisibilita: jest.fn().mockResolvedValue(undefined),
      leggiFormulario: jest.fn().mockResolvedValue({ stato_formulario: 'EMESSO' }),
    }
    mockPrisma = {
      activityLog: {
        create: jest.fn().mockResolvedValue(undefined),
      },
    }
    mockCreaFirPort = {
      creaDaDettaglio: jest.fn(),
    }
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }

    useCase = new AcquisisciFormularioRENTRIUseCase(
      mockFirRepository,
      mockRentriApiClient,
      mockPrisma,
      mockCreaFirPort,
      mockLogger
    )
  })

  function nuovoFirFinto() {
    return {
      id: 'fir-nuovo-1',
      tenantId: TENANT_ID,
      rentriNumeroFir: null,
      agganciaFormularioAcquisito: jest.fn(),
    }
  }

  function firEsistenteFinto(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'fir-esistente-1',
      tenantId: TENANT_ID,
      rentriNumeroFir: null,
      agganciaManualmente: jest.fn(),
      ...overrides,
    }
  }

  // --- Autorizzazione ---

  it('rifiuta un VIEWER (ruolo escluso dalle scritture RENTRI)', async () => {
    await expect(useCase.execute({ ...inputBase(), userRole: 'VIEWER' })).rejects.toThrow(
      DomainException
    )
    expect(mockRentriApiClient.acquisisciVisibilita).not.toHaveBeenCalled()
  })

  it.each(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])('ammette il ruolo %s', async ruolo => {
    const nuovoFir = nuovoFirFinto()
    mockCreaFirPort.creaDaDettaglio.mockResolvedValue(nuovoFir)

    await expect(useCase.execute({ ...inputBase(), userRole: ruolo })).resolves.toBeDefined()
  })

  // --- Precondizione: già agganciato localmente ---

  it('rifiuta se il numero_fir è già agganciato a un FIR locale del tenant (errore di dominio, non un P2002)', async () => {
    mockFirRepository.findByRentriNumeroFir.mockResolvedValue({ id: 'fir-altro' })

    await expect(useCase.execute(inputBase())).rejects.toThrow(DomainException)
    expect(mockRentriApiClient.acquisisciVisibilita).not.toHaveBeenCalled()
  })

  // --- Ramo COLLEGA_ESISTENTE ---

  it('collega al FIR locale indicato con agganciaManualmente', async () => {
    const firEsistente = firEsistenteFinto()
    mockFirRepository.findById.mockResolvedValue(firEsistente)

    const risultato = await useCase.execute({
      ...inputBase(),
      scelta: { tipo: 'COLLEGA_ESISTENTE', firId: firEsistente.id },
    })

    expect(firEsistente.agganciaManualmente).toHaveBeenCalledWith(NUMERO_FIR, 'corr-1')
    expect(mockFirRepository.save).toHaveBeenCalledWith(firEsistente)
    expect(risultato.firId).toBe(firEsistente.id)
    expect(risultato.numeroFir).toBe(NUMERO_FIR)
  })

  it('rifiuta COLLEGA_ESISTENTE su un FIR di un altro tenant (404, non 403 — non conferma l’esistenza)', async () => {
    mockFirRepository.findById.mockResolvedValue(firEsistenteFinto({ tenantId: 'altro-tenant' }))

    await expect(
      useCase.execute({ ...inputBase(), scelta: { tipo: 'COLLEGA_ESISTENTE', firId: 'fir-x' } })
    ).rejects.toThrow(DomainException)
    expect(mockRentriApiClient.acquisisciVisibilita).not.toHaveBeenCalled()
  })

  it('rifiuta COLLEGA_ESISTENTE su un FIR già legato a un altro numero_fir', async () => {
    mockFirRepository.findById.mockResolvedValue(
      firEsistenteFinto({ rentriNumeroFir: 'RENTRI-ALTRO' })
    )

    await expect(
      useCase.execute({ ...inputBase(), scelta: { tipo: 'COLLEGA_ESISTENTE', firId: 'fir-x' } })
    ).rejects.toThrow(DomainException)
    expect(mockRentriApiClient.acquisisciVisibilita).not.toHaveBeenCalled()
  })

  // --- Ramo NUOVO ---

  it('nel ramo NUOVO delega la creazione alla porta Task 5 e poi aggancia con agganciaFormularioAcquisito', async () => {
    const nuovoFir = nuovoFirFinto()
    mockCreaFirPort.creaDaDettaglio.mockResolvedValue(nuovoFir)

    const risultato = await useCase.execute(inputBase())

    expect(mockRentriApiClient.leggiFormulario).toHaveBeenCalledWith(TENANT_ID, NUMERO_FIR)
    expect(mockCreaFirPort.creaDaDettaglio).toHaveBeenCalledWith(
      TENANT_ID,
      USER_ID,
      { stato_formulario: 'EMESSO' },
      NUMERO_FIR
    )
    expect(nuovoFir.agganciaFormularioAcquisito).toHaveBeenCalledWith(NUMERO_FIR, 'corr-1')
    expect(mockFirRepository.save).toHaveBeenCalledWith(nuovoFir)
    expect(risultato.firId).toBe(nuovoFir.id)
  })

  // --- Il punto delicato: ordine delle scritture + visibilità già acquisita ---

  it('NON richiama acquisisciVisibilita se il flag era già true nel risultato di ricerca (evita una chiamata ridondante)', async () => {
    const nuovoFir = nuovoFirFinto()
    mockCreaFirPort.creaDaDettaglio.mockResolvedValue(nuovoFir)

    await useCase.execute({ ...inputBase(), visibilitaGiaAcquisita: true })

    expect(mockRentriApiClient.acquisisciVisibilita).not.toHaveBeenCalled()
    expect(mockRentriApiClient.leggiFormulario).toHaveBeenCalled()
  })

  it('chiama acquisisciVisibilita PRIMA di leggiFormulario e della scrittura locale', async () => {
    const nuovoFir = nuovoFirFinto()
    mockCreaFirPort.creaDaDettaglio.mockResolvedValue(nuovoFir)

    const ordine: string[] = []
    mockRentriApiClient.acquisisciVisibilita.mockImplementation(async () => {
      ordine.push('acquisisciVisibilita')
    })
    mockRentriApiClient.leggiFormulario.mockImplementation(async () => {
      ordine.push('leggiFormulario')
      return { stato_formulario: 'EMESSO' }
    })
    mockFirRepository.save.mockImplementation(async () => {
      ordine.push('save')
    })

    await useCase.execute(inputBase())

    expect(ordine).toEqual(['acquisisciVisibilita', 'leggiFormulario', 'save'])
  })

  it('se la scrittura locale fallisce DOPO un’acquisizione riuscita su RENTRI, logga l’incoerenza esplicitamente e rilancia', async () => {
    const nuovoFir = nuovoFirFinto()
    mockCreaFirPort.creaDaDettaglio.mockResolvedValue(nuovoFir)
    const erroreDb = new Error('connessione al DB persa')
    mockFirRepository.save.mockRejectedValue(erroreDb)

    await expect(useCase.execute(inputBase())).rejects.toThrow(erroreDb)

    // La chiamata a RENTRI è comunque avvenuta (non annullabile): il log deve
    // renderlo esplicito, non lasciare che l'errore generico DB nasconda che
    // la visibilità è ORMAI acquisita sull'ente.
    expect(mockRentriApiClient.acquisisciVisibilita).toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringMatching(/INCOERENZA/i),
      erroreDb,
      expect.objectContaining({ tenantId: TENANT_ID, numeroFir: NUMERO_FIR })
    )
  })

  // --- Audit ---

  it('scrive un ActivityLog con action RENTRI_AGGANCIO_FORMULARIO dopo un aggancio riuscito', async () => {
    const firEsistente = firEsistenteFinto()
    mockFirRepository.findById.mockResolvedValue(firEsistente)

    await useCase.execute({
      ...inputBase(),
      scelta: { tipo: 'COLLEGA_ESISTENTE', firId: firEsistente.id },
    })

    expect(mockPrisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          firId: firEsistente.id,
          action: 'RENTRI_AGGANCIO_FORMULARIO',
          metadata: expect.objectContaining({
            numeroFir: NUMERO_FIR,
            origine: RentriOrigineLegame.AGGANCIO_MANUALE,
          }),
        }),
      })
    )
  })

  it('non fallisce l’intera operazione se la sola scrittura dell’ActivityLog fallisce (audit non bloccante)', async () => {
    const firEsistente = firEsistenteFinto()
    mockFirRepository.findById.mockResolvedValue(firEsistente)
    mockPrisma.activityLog.create.mockRejectedValue(new Error('audit down'))

    await expect(
      useCase.execute({
        ...inputBase(),
        scelta: { tipo: 'COLLEGA_ESISTENTE', firId: firEsistente.id },
      })
    ).resolves.toBeDefined()
  })
})
