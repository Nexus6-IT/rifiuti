import { TrasmettiFIRSecondoModalitaUseCase } from './trasmetti-fir-secondo-modalita.use-case'
import {
  CODICE_CERTIFICATO_MANCANTE,
  MESSAGGIO_CERTIFICATO_MANCANTE,
} from '../../infrastructure/rentri/rentri-credential.resolver'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { FirAnnullatoNelFrattempoError } from '../../core/domain/errors'

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
  let mockFirRepository: any
  let mockFir: FIR

  const FIR_ID = 'fir-123'
  const TENANT_ID = 'tenant-456'

  let mockModuli: { moduliAttivi: jest.Mock }

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

    // FIR reale e gia' EMESSO (come dopo EmettiFIRUseCase): l'esito si verifica sullo stato di dominio.
    mockFir = FIR.create({
      produttoreId: 'produttore-1',
      tenantId: TENANT_ID,
      rifiuto: { cerCode: '13 02 05*', quantita: 120, unitaMisura: UnitaMisura.KG },
      trasportatoreId: 'trasportatore-1',
      destinatarioId: 'destinatario-1',
    })
    mockFir.emetti('FIR-2026-000001', {
      firmatario: 'Mario Rossi',
      timestamp: new Date(),
      certificato: 'firma',
      userId: 'user-1',
      documentHash: 'h1',
      certificateHash: 'h2',
    } as any)
    mockFirRepository = {
      findById: jest.fn().mockResolvedValue(mockFir),
      save: jest.fn().mockResolvedValue(undefined),
    }

    mockModuli = { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) }
    useCase = new TrasmettiFIRSecondoModalitaUseCase(
      mockModalitaLegameService,
      mockRentriSyncQueue,
      mockFirRepository,
      mockLogger,
      mockModuli as any
    )
  })

  it('modulo rentri non attivo: nessuna trasmissione, nessuna lettura della modalita, FIR non toccato', async () => {
    mockModuli.moduliAttivi.mockResolvedValue(['fir', 'registro'])
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'AUTOMATICA',
      certificatoConfigurato: true,
    })

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(esito).toEqual({ avviata: false, motivo: 'MODULO_NON_ATTIVO' })
    expect(mockModuli.moduliAttivi).toHaveBeenCalledWith(TENANT_ID)
    expect(mockRentriSyncQueue.addSyncJob).not.toHaveBeenCalled()
    expect(mockFirRepository.save).not.toHaveBeenCalled()
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

  it('AUTOMATICA senza certificato: FIR PERMANENTLY_FAILED RENTRI_CERTIFICATO_MANCANTE, nessun job', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'AUTOMATICA',
      certificatoConfigurato: false,
    })

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(mockFirRepository.findById).toHaveBeenCalledWith(FIR_ID)
    expect(mockFir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
    expect(mockFir.rentriSyncStatus.getLastErrorCode()).toBe(CODICE_CERTIFICATO_MANCANTE)
    expect(mockFir.rentriSyncStatus.getLastError()).toBe(MESSAGGIO_CERTIFICATO_MANCANTE)
    expect(mockFirRepository.save).toHaveBeenCalledWith(mockFir)
    expect(mockRentriSyncQueue.addSyncJob).not.toHaveBeenCalled()
    expect(esito).toEqual({
      avviata: false,
      motivo: 'CERTIFICATO_MANCANTE',
      esitoRegistrato: true,
    })
  })

  it('IBRIDA senza certificato: stesso esito', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'IBRIDA',
      certificatoConfigurato: false,
    })

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(mockFir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
    expect(mockFir.rentriSyncStatus.getLastErrorCode()).toBe(CODICE_CERTIFICATO_MANCANTE)
    expect(mockFirRepository.save).toHaveBeenCalledWith(mockFir)
    expect(mockRentriSyncQueue.addSyncJob).not.toHaveBeenCalled()
    expect(esito.avviata).toBe(false)
    expect(esito.motivo).toBe('CERTIFICATO_MANCANTE')
    expect(esito.esitoRegistrato).toBe(true)
  })

  it('MANUALE senza certificato: FIR invariato', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'MANUALE',
      certificatoConfigurato: false,
    })

    await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(mockFirRepository.findById).not.toHaveBeenCalled()
    expect(mockFir.rentriSyncStatus.getStatus()).toBe('PENDING')
    expect(mockFirRepository.save).not.toHaveBeenCalled()
  })

  it("salvataggio dell'esito che fallisce: nessuna eccezione, esitoRegistrato false, errore nel log", async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'AUTOMATICA',
      certificatoConfigurato: false,
    })
    mockFirRepository.save.mockRejectedValue(new Error('db giu'))

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(esito).toEqual({
      avviata: false,
      motivo: 'CERTIFICATO_MANCANTE',
      esitoRegistrato: false,
    })
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('FIR annullato nel frattempo: nessuna eccezione, esitoRegistrato false, solo info nel log', async () => {
    mockModalitaLegameService.getForTenant.mockResolvedValue({
      modalitaLegame: 'AUTOMATICA',
      certificatoConfigurato: false,
    })
    mockFirRepository.save.mockRejectedValue(new FirAnnullatoNelFrattempoError(FIR_ID))

    const esito = await useCase.eseguiSeAutomatica({ firId: FIR_ID, tenantId: TENANT_ID })

    expect(esito.esitoRegistrato).toBe(false)
    expect(mockLogger.error).not.toHaveBeenCalled()
    expect(mockLogger.info).toHaveBeenCalled()
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
