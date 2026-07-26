import { TrasmettiFIRSecondoModalitaUseCase } from './trasmetti-fir-secondo-modalita.use-case'

/**
 * TrasmettiFIRSecondoModalitaUseCase — TDD (R1 Task 2)
 *
 * I quattro scenari che contano per l'orchestrazione secondo la modalità del
 * tenant:
 * - AUTOMATICA + certificato → la trasmissione parte da sola (nessuna
 *   chiamata esplicita oltre a questa, che è quella che EmettiFIRUseCase fa
 *   già in automatico dopo l'emissione).
 * - MANUALE → nulla parte da solo.
 * - IBRIDA + certificato → la trasmissione parte, ma segnalata come "da
 *   confermare" (richiedeConferma).
 * - Nessun certificato (AUTOMATICA o IBRIDA) → fail-closed: nessuna
 *   trasmissione accodata, per non rischiare il ban RENTRI (423) su
 *   richieste che l'ente rifiuterebbe comunque.
 */
describe('TrasmettiFIRSecondoModalitaUseCase', () => {
  let useCase: TrasmettiFIRSecondoModalitaUseCase
  let mockModalitaLegameService: any
  let mockRentriSyncQueue: any
  let mockLogger: any

  const FIR_ID = 'fir-123'
  const TENANT_ID = 'tenant-456'

  beforeEach(() => {
    mockModalitaLegameService = {
      getForTenant: jest.fn(),
    }
    mockRentriSyncQueue = {
      addSyncJob: jest.fn().mockResolvedValue('job-789'),
    }
    mockLogger = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    useCase = new TrasmettiFIRSecondoModalitaUseCase(
      mockModalitaLegameService,
      mockRentriSyncQueue,
      mockLogger
    )
  })

  it('AUTOMATICA + certificato configurato: accoda la trasmissione senza richiedere conferma', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'AUTOMATICA',
      certificatoConfigurato: true,
    })

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(esito.avviata).toBe(true)
    expect(esito.richiedeConferma).toBe(false)
    expect(esito.jobId).toBe('job-789')
    expect(mockRentriSyncQueue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        firId: FIR_ID,
        tenantId: TENANT_ID,
        richiedeConferma: false,
      })
    )
  })

  it('MANUALE: non accoda nulla, qualunque sia lo stato del certificato', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'MANUALE',
      certificatoConfigurato: true,
    })

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(esito.avviata).toBe(false)
    expect(esito.motivo).toBe('MANUALE')
    expect(mockRentriSyncQueue.addSyncJob).not.toHaveBeenCalled()
  })

  it('IBRIDA + certificato configurato: accoda la trasmissione segnalando che richiederà conferma', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'IBRIDA',
      certificatoConfigurato: true,
    })

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(esito.avviata).toBe(true)
    expect(esito.richiedeConferma).toBe(true)
    expect(mockRentriSyncQueue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ richiedeConferma: true })
    )
  })

  it('AUTOMATICA senza certificato: fail-closed, nessuna trasmissione accodata', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'AUTOMATICA',
      certificatoConfigurato: false,
    })

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(esito.avviata).toBe(false)
    expect(esito.motivo).toBe('CERTIFICATO_MANCANTE')
    expect(mockRentriSyncQueue.addSyncJob).not.toHaveBeenCalled()
  })

  it('IBRIDA senza certificato: fail-closed, nessuna trasmissione accodata', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'IBRIDA',
      certificatoConfigurato: false,
    })

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(esito.avviata).toBe(false)
    expect(esito.motivo).toBe('CERTIFICATO_MANCANTE')
    expect(mockRentriSyncQueue.addSyncJob).not.toHaveBeenCalled()
  })

  it('passa il correlationId ricevuto alla coda, quando presente', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'AUTOMATICA',
      certificatoConfigurato: true,
    })

    await useCase.eseguiSeAutomatica({
      firId: FIR_ID,
      tenantId: TENANT_ID,
      correlationId: 'correlazione-1',
    })

    expect(mockRentriSyncQueue.addSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'correlazione-1' })
    )
  })
})
