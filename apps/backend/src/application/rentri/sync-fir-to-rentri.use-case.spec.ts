import { SyncFIRToRENTRIUseCase, SOGLIA_STALLO_RENTRI_MS } from './sync-fir-to-rentri.use-case'
import { costruttorePayloadFinto } from './mappatura/aiuti-test'
import {
  RentriApiError,
  TrasmissioneRentriIncertaError,
  TransazioneRentriNonTrovataError,
} from '../../infrastructure/rentri/rentri-api.client'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { RENTRISyncLog } from '../../domain/rentri/rentri-sync-log.aggregate'
import { FirAnnullatoNelFrattempoError } from '../../core/domain/errors'
import { TenantSenzaCertificatoRentriError } from '../../infrastructure/rentri/rentri-credential.resolver'

/**
 * Unit tests for SyncFIRToRENTRI Use Case
 *
 * Tests the application logic for synchronizing a single FIR to RENTRI.
 * Uses mocks for dependencies (repository, API client, event bus).
 *
 * Il client RENTRI non espone alcun endpoint sincrono di sottomissione (il
 * contratto ufficiale è asincrono): questi test mockano perciò la coppia
 * `creaFormulario` (crea la transazione, 202 + transazione_id) +
 * `attendiEsito` (polling NONBLOCK_PULL fino all'esito), non il vecchio
 * `submitFIR`.
 */
describe('SyncFIRToRENTRIUseCase', () => {
  let useCase: SyncFIRToRENTRIUseCase
  let mockFIRRepository: any
  let mockRENTRIApiClient: any
  let mockSyncLogRepository: any
  let mockDomainEvents: any
  let mockLogger: any

  beforeEach(() => {
    // Create mocks
    // Prenotazione e registrazione della transazione riescono per default: i
    // test che ne verificano il fallimento lo dichiarano esplicitamente.
    mockFIRRepository = {
      findById: jest.fn(),
      save: jest.fn(),
      prenotaTrasmissioneRentri: jest.fn().mockResolvedValue(true),
      registraTransazioneInAttesa: jest.fn().mockResolvedValue(true),
    }

    mockRENTRIApiClient = {
      creaFormulario: jest.fn(),
      attendiEsito: jest.fn(),
    }

    mockSyncLogRepository = {
      createPending: jest.fn(),
      save: jest.fn(),
    }

    mockDomainEvents = {
      publish: jest.fn(),
    }

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    }

    // Directly instantiate the use case with mocks
    useCase = new SyncFIRToRENTRIUseCase(
      mockFIRRepository,
      mockRENTRIApiClient,
      mockSyncLogRepository,
      mockDomainEvents,
      mockLogger,
      costruttorePayloadFinto()
    )
  })

  describe('Successful Sync', () => {
    it('should sync FIR to RENTRI successfully', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-001',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISynced: jest.fn(),
        getDomainEvents: jest
          .fn()
          .mockReturnValue([{ eventType: 'FIRSyncedToRENTRI', aggregateId: firId }]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsSuccess: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'SUCCESS',
        }),
      }

      const transazioneId = '9f8b3c1a-1234-4abc-8def-0123456789ab'

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({
        transazioneId,
        urlStato: `/formulari/v1.0/${transazioneId}/status`,
      })
      const numeroFir = 'RENTRI-NUM-000123'

      mockRENTRIApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: { numero_fir: numeroFir },
      })
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      const result = await useCase.execute(firId, tenantId)

      expect(result.success).toBe(true)
      expect(result.protocolNumber).toBe(numeroFir)
      expect(mockFIRRepository.findById).toHaveBeenCalledWith(firId)
      expect(mockFIR.canSyncToRENTRI).toHaveBeenCalled()
      expect(mockFIR.avviaTentativoRentri).toHaveBeenCalled()
      expect(mockRENTRIApiClient.creaFormulario).toHaveBeenCalledWith(
        tenantId,
        (expect as any).anything()
      )
      expect(mockRENTRIApiClient.attendiEsito).toHaveBeenCalledWith(tenantId, transazioneId)
      expect(mockFIR.markRENTRISynced).toHaveBeenCalledWith(numeroFir, transazioneId, undefined)
      expect(mockFIRRepository.save).toHaveBeenCalledWith(mockFIR)
      expect(mockSyncLogRepository.save).toHaveBeenCalled()
      expect(mockDomainEvents.publish).toHaveBeenCalled()
    })

    /**
     * Modalità IBRIDA (R1 Task 2): un esito positivo non deve legare subito
     * il FIR (`markRENTRISynced`), ma registrare una proposta in attesa di
     * conferma esplicita (`proporreLegameRENTRI`).
     */
    it('opzioni.richiedeConferma true: propone il legame invece di chiuderlo subito', async () => {
      const firId = 'fir-ibrida'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISynced: jest.fn(),
        proporreLegameRENTRI: jest.fn(),
        getDomainEvents: jest.fn().mockReturnValue([]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsSuccess: jest.fn().mockReturnValue({ id: 'log-ibrida', status: 'SUCCESS' }),
      }

      const transazioneId = 'tx-ibrida-1'
      const numeroFir = 'RENTRI-NUM-000777'

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({ transazioneId })
      mockRENTRIApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: { numero_fir: numeroFir },
      })

      const result = await useCase.execute(firId, tenantId, undefined, { richiedeConferma: true })

      expect(result.success).toBe(true)
      expect(result.inAttesaDiConferma).toBe(true)
      expect(mockFIR.proporreLegameRENTRI).toHaveBeenCalledWith(numeroFir, transazioneId, undefined)
      expect(mockFIR.markRENTRISynced).not.toHaveBeenCalled()
    })

    it('should handle sync after retries', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-002',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('FAILED'),
          getAttempts: jest.fn().mockReturnValue(2), // Previous failures
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISynced: jest.fn(),
        getDomainEvents: jest
          .fn()
          .mockReturnValue([{ eventType: 'FIRSyncedToRENTRI', aggregateId: firId }]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsSuccess: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'SUCCESS',
        }),
      }

      const transazioneId = 'tx-retry-789'

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({
        transazioneId,
        urlStato: `/formulari/v1.0/${transazioneId}/status`,
      })
      mockRENTRIApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: { numero_fir: 'RENTRI-NUM-000456' },
      })
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      const result = await useCase.execute(firId, tenantId)

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(2) // Current attempts value
    })
  })

  describe('Validation Errors', () => {
    it('should throw if FIR not found', async () => {
      const firId = 'nonexistent-fir'
      const tenantId = 'tenant-456'

      mockFIRRepository.findById.mockResolvedValue(null)

      await expect(useCase.execute(firId, tenantId)).rejects.toThrow('FIR')
    })

    it('should throw if FIR belongs to different tenant', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId: 'different-tenant', // Different tenant
        status: 'COMPLETED',
      }

      mockFIRRepository.findById.mockResolvedValue(mockFIR)

      await expect(useCase.execute(firId, tenantId)).rejects.toThrow('Unauthorized')
    })

    it('should throw if FIR not in completed status', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'DRAFT', // Not completed
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(false),
      }

      mockFIRRepository.findById.mockResolvedValue(mockFIR)

      await expect(useCase.execute(firId, tenantId)).rejects.toThrow()
    })

    it('should throw if FIR already synced', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('SYNCED'),
          getProtocolNumber: jest.fn().mockReturnValue('RENTRI-EXISTING'),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(false),
      }

      mockFIRRepository.findById.mockResolvedValue(mockFIR)

      await expect(useCase.execute(firId, tenantId)).rejects.toThrow()
    })
  })

  describe('Sync Failures', () => {
    it('should handle RENTRI API errors with retry (fallimento di creaFormulario)', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-003',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        needsRENTRIRetry: jest.fn().mockReturnValue(true),
        getNextRENTRIRetryAt: jest.fn().mockReturnValue(new Date()),
        getDomainEvents: jest
          .fn()
          .mockReturnValue([{ eventType: 'FIRSyncFailed', aggregateId: firId }]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      }

      const apiError = new Error('RENTRI service unavailable')

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockRejectedValue(apiError)
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      const result = await useCase.execute(firId, tenantId)

      expect(result.success).toBe(false)
      expect(result.willRetry).toBe(true)
      expect(result.error).toBe('RENTRI service unavailable')
      expect(mockFIR.markRENTRISyncFailed).toHaveBeenCalledWith(
        'RENTRI service unavailable',
        'RENTRI_API_ERROR',
        undefined
      )
      expect(mockDomainEvents.publish).toHaveBeenCalled() // FIRSyncFailedEvent
    })

    it('should handle RENTRI API errors with retry (superamento tentativi di attendiEsito)', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-003b',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        needsRENTRIRetry: jest.fn().mockReturnValue(true),
        getNextRENTRIRetryAt: jest.fn().mockReturnValue(new Date()),
        getDomainEvents: jest
          .fn()
          .mockReturnValue([{ eventType: 'FIRSyncFailed', aggregateId: firId }]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      }

      const transazioneId = 'tx-timeout'

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({
        transazioneId,
        urlStato: `/formulari/v1.0/${transazioneId}/status`,
      })
      // Simula il superamento del numero massimo di tentativi di polling:
      // attendiEsito solleva un errore esplicito invece di restare bloccato.
      mockRENTRIApiClient.attendiEsito.mockRejectedValue(
        new Error(`Superato il numero massimo di tentativi (30) in attesa dell'esito.`)
      )
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      const result = await useCase.execute(firId, tenantId)

      expect(result.success).toBe(false)
      expect(result.willRetry).toBe(true)
      expect(result.error).toContain('tentativi')
      expect(mockFIR.markRENTRISyncFailed).toHaveBeenCalledWith(
        (expect as any).stringContaining('tentativi'),
        'RENTRI_API_ERROR',
        undefined
      )
    })

    it('should mark as permanently failed after max retries', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-004',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('FAILED'),
          getAttempts: jest.fn().mockReturnValue(4), // One more attempt will hit max (5)
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        needsRENTRIRetry: jest.fn().mockReturnValue(false), // Max retries reached
        getDomainEvents: jest
          .fn()
          .mockReturnValue([{ eventType: 'FIRSyncFailed', aggregateId: firId }]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      }

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockRejectedValue(new Error('Persistent error'))
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      const result = await useCase.execute(firId, tenantId)

      expect(result.success).toBe(false)
      expect(result.willRetry).toBe(false)
      expect(result.attempts).toBe(4)
    })

    /**
     * Task 4 (P2): un RentriApiError 403 (credenziale non valida/operazione
     * non consentita) è SEMPRE un fallimento definitivo, anche se
     * `fir.needsRENTRIRetry()` direbbe "ritenta pure" — ritentare con una
     * credenziale che non funzionerà mai non ha senso. Il messaggio riportato
     * è `detail`/`title` del ProblemDetails (mai il corpo grezzo).
     */
    it('403 (RentriApiError non-retryable): esito SEMPRE definitivo, indipendentemente da needsRENTRIRetry', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-403',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        // Anche se il dominio direbbe "ritenta pure", il 403 deve prevalere.
        needsRENTRIRetry: jest.fn().mockReturnValue(true),
        getNextRENTRIRetryAt: jest.fn().mockReturnValue(new Date()),
        getDomainEvents: jest
          .fn()
          .mockReturnValue([{ eventType: 'FIRSyncFailed', aggregateId: firId }]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({ id: 'log-1', status: 'FAILURE' }),
      }

      const apiError = new RentriApiError(
        403,
        'Operazione non consentita',
        'Certificato non riconosciuto',
        false
      )

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockRejectedValue(apiError)
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      const result = await useCase.execute(firId, tenantId)

      expect(result.success).toBe(false)
      expect(result.willRetry).toBe(false)
      expect(result.error).toBe('Certificato non riconosciuto')
      expect(mockFIR.markRENTRISyncFailed).toHaveBeenCalledWith(
        'Certificato non riconosciuto',
        'RENTRI_FORBIDDEN',
        undefined
      )
      // needsRENTRIRetry non deve nemmeno influenzare l'esito: il 403 prevale.
    })

    /**
     * R1 Task 5: 429/423 sono una famiglia a parte rispetto a 5xx/rete —
     * l'utente non deve vedere «Riprova» (peggiorerebbe la situazione, v.
     * rentri-error-presentation.ts), quindi l'errorCode deve distinguerli
     * dal generico RENTRI_API_ERROR usato per 5xx/timeout/rete.
     */
    it.each([429, 423])(
      '%i (RentriApiError retryable): errorCode RENTRI_RATE_LIMITED, distinto da RENTRI_API_ERROR',
      async status => {
        const firId = 'fir-123'
        const tenantId = 'tenant-456'
        const mockFIR = {
          id: firId,
          tenantId,
          status: 'COMPLETED',
          firNumber: 'FIR-2025-429',
          rentriSyncStatus: {
            getStatus: jest.fn().mockReturnValue('PENDING'),
            getAttempts: jest.fn().mockReturnValue(0),
          },
          canSyncToRENTRI: jest.fn().mockReturnValue(true),
          avviaTentativoRentri: jest.fn(),
          registraTransazioneInAttesa: jest.fn(),
          chiudiTransazioneInAttesa: jest.fn(),
          markRENTRISyncFailed: jest.fn(),
          needsRENTRIRetry: jest.fn().mockReturnValue(true),
          getNextRENTRIRetryAt: jest.fn().mockReturnValue(new Date()),
          getDomainEvents: jest
            .fn()
            .mockReturnValue([{ eventType: 'FIRSyncFailed', aggregateId: firId }]),
          clearDomainEvents: jest.fn(),
        }

        const mockSyncLog = {
          markAsFailure: jest.fn().mockReturnValue({ id: 'log-1', status: 'FAILURE' }),
        }

        const apiError = new RentriApiError(status, 'Too Many Requests', undefined, true)

        mockFIRRepository.findById.mockResolvedValue(mockFIR)
        mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
        mockRENTRIApiClient.creaFormulario.mockRejectedValue(apiError)
        mockFIRRepository.save.mockResolvedValue(undefined)
        mockSyncLogRepository.save.mockResolvedValue(undefined)

        const result = await useCase.execute(firId, tenantId)

        expect(result.success).toBe(false)
        expect(mockFIR.markRENTRISyncFailed).toHaveBeenCalledWith(
          expect.any(String),
          'RENTRI_RATE_LIMITED',
          undefined
        )
      }
    )

    /**
     * Task 3-bis (R0): l'esito può dichiarare `errore: false` ed essere
     * comunque privo del numero ufficiale (`esito.esito.numero_fir`, v.
     * `estraiNumeroFirDaEsito`). In quel caso NON va chiamato
     * `markRENTRISynced` con un identificativo inventato (es. la
     * `transazione_id`): meglio nessun legame che uno inventato.
     */
    it('should NOT link the FIR when esito.errore=false but numero_fir is missing', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-008',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISynced: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        needsRENTRIRetry: jest.fn().mockReturnValue(true),
        getNextRENTRIRetryAt: jest.fn().mockReturnValue(new Date()),
        getDomainEvents: jest
          .fn()
          .mockReturnValue([{ eventType: 'FIRSyncFailed', aggregateId: firId }]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      }

      const transazioneId = 'tx-senza-numero-fir'

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({
        transazioneId,
        urlStato: `/formulari/v1.0/${transazioneId}/status`,
      })
      // errore: false, ma l'esito non è quello di una creazione di
      // formulario (nessun campo `esito.numero_fir`).
      mockRENTRIApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
      })
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      const result = await useCase.execute(firId, tenantId)

      expect(mockFIR.markRENTRISynced).not.toHaveBeenCalled()
      expect(mockFIR.markRENTRISyncFailed).toHaveBeenCalledWith(
        (expect as any).stringContaining('numero ufficiale'),
        'RENTRI_MISSING_NUMERO_FIR',
        undefined
      )
      expect(result.success).toBe(false)
    })

    it('should handle validation errors from RENTRI (esito.errore = true)', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-005',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        getDomainEvents: jest
          .fn()
          .mockReturnValue([{ eventType: 'FIRSyncFailed', aggregateId: firId }]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      }

      const transazioneId = 'tx-esito-negativo'

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({
        transazioneId,
        urlStato: `/formulari/v1.0/${transazioneId}/status`,
      })
      mockRENTRIApiClient.attendiEsito.mockResolvedValue({
        errore: true,
        validazione: [{ campo: 'cerCode', codice_messaggio: 'Invalid CER code' }],
      })
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      const result = await useCase.execute(firId, tenantId)

      expect(result.success).toBe(false)
      expect(result.willRetry).toBe(false) // Validation errors don't retry
      expect(result.error).toContain('Invalid CER code')
      expect(mockFIR.markRENTRISyncFailed).toHaveBeenCalledWith(
        (expect as any).stringContaining('Invalid CER code'),
        'RENTRI_VALIDATION_ERROR',
        undefined
      )
    })
  })

  describe('Event Publishing', () => {
    it('should publish FIRSyncedToRENTRIEvent on success', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-006',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISynced: jest.fn(),
        getDomainEvents: jest
          .fn()
          .mockReturnValue([{ eventType: 'FIRSyncedToRENTRI', aggregateId: firId }]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsSuccess: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'SUCCESS',
        }),
      }

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({
        transazioneId: 'tx-123',
        urlStato: '/formulari/v1.0/tx-123/status',
      })
      mockRENTRIApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: { numero_fir: 'RENTRI-NUM-000789' },
      })
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      await useCase.execute(firId, tenantId)

      const publishedEvent = mockDomainEvents.publish.mock.calls[0][0]
      expect(publishedEvent.eventType).toBe('FIRSyncedToRENTRI')
      expect(publishedEvent.aggregateId).toBe(firId)
    })

    it('should publish FIRSyncFailedEvent on failure', async () => {
      const firId = 'fir-123'
      const tenantId = 'tenant-456'
      const mockFIR = {
        id: firId,
        tenantId,
        status: 'COMPLETED',
        firNumber: 'FIR-2025-007',
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(0),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        needsRENTRIRetry: jest.fn().mockReturnValue(true),
        getNextRENTRIRetryAt: jest.fn().mockReturnValue(new Date()),
        getDomainEvents: jest
          .fn()
          .mockReturnValue([
            { eventType: 'FIRSyncFailed', aggregateId: firId, payload: { willRetry: true } },
          ]),
        clearDomainEvents: jest.fn(),
      }

      const mockSyncLog = {
        markAsFailure: jest.fn().mockReturnValue({
          id: 'log-1',
          status: 'FAILURE',
        }),
      }

      mockFIRRepository.findById.mockResolvedValue(mockFIR)
      mockSyncLogRepository.createPending.mockResolvedValue(mockSyncLog)
      mockRENTRIApiClient.creaFormulario.mockRejectedValue(new Error('API Error'))
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.save.mockResolvedValue(undefined)

      await useCase.execute(firId, tenantId)

      const publishedEvent = mockDomainEvents.publish.mock.calls[0][0]
      expect(publishedEvent.eventType).toBe('FIRSyncFailed')
      expect(publishedEvent.payload.willRetry).toBe(true)
    })
  })

  describe('FIR annullato in locale durante la trasmissione', () => {
    const firId = 'fir-ann'
    const tenantId = 'tenant-456'

    function firFinto() {
      return {
        id: firId,
        tenantId,
        rentriSyncStatus: {
          getStatus: jest.fn().mockReturnValue('PENDING'),
          getAttempts: jest.fn().mockReturnValue(1),
        },
        canSyncToRENTRI: jest.fn().mockReturnValue(true),
        avviaTentativoRentri: jest.fn(),
        registraTransazioneInAttesa: jest.fn(),
        chiudiTransazioneInAttesa: jest.fn(),
        markRENTRISynced: jest.fn(),
        markRENTRISyncFailed: jest.fn(),
        needsRENTRIRetry: jest.fn().mockReturnValue(true),
        getNextRENTRIRetryAt: jest.fn().mockReturnValue(new Date()),
        getDomainEvents: jest.fn().mockReturnValue([]),
        clearDomainEvents: jest.fn(),
      }
    }

    const logRiuscito = { id: 'log-ok', status: 'SUCCESS' }
    const logFallito = { id: 'log-ko', status: 'FAILURE' }

    beforeEach(() => {
      mockFIRRepository.findById.mockResolvedValue(firFinto())
      mockSyncLogRepository.createPending.mockResolvedValue({
        markAsSuccess: jest.fn().mockReturnValue(logRiuscito),
        markAsFailure: jest.fn().mockReturnValue(logFallito),
      })
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({
        transazioneId: 'tx-ann',
        urlStato: '/formulari/v1.0/tx-ann/status',
      })
      mockFIRRepository.save.mockRejectedValue(new FirAnnullatoNelFrattempoError(firId))
    })

    it('la sync segnala il FIR annullato nel frattempo', async () => {
      mockRENTRIApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: { numero_fir: 'RENTRI-NUM-ANN' },
      })

      const result = await useCase.execute(firId, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false, attempts: 1 })
      expect(result.error).toContain(firId)
      expect(mockFIRRepository.save).toHaveBeenCalledTimes(1)
      // L'ente ha il formulario: il log di sincronizzazione riuscito si conserva.
      expect(mockSyncLogRepository.save).toHaveBeenCalledWith(logRiuscito)
      expect(mockLogger.error).toHaveBeenCalledWith(
        "FIR annullato in locale durante la trasmissione: sull'ente esiste il formulario",
        expect.any(FirAnnullatoNelFrattempoError),
        expect.objectContaining({ firId, protocolNumber: 'RENTRI-NUM-ANN' })
      )
    })

    it("con esito negativo dell'ente il FIR annullato nel frattempo non si ritenta", async () => {
      mockRENTRIApiClient.attendiEsito.mockResolvedValue({
        errore: true,
        validazione: [{ campo: 'cerCode', codice_messaggio: 'Invalid CER code' }],
      })

      const result = await useCase.execute(firId, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(mockFIRRepository.save).toHaveBeenCalledTimes(1)
      expect(mockSyncLogRepository.save).toHaveBeenCalledWith(logFallito)
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('un FIR annullato nel frattempo che risale al catch esterno non si registra come errore', async () => {
      mockRENTRIApiClient.creaFormulario.mockRejectedValue(new FirAnnullatoNelFrattempoError(firId))

      await expect(useCase.execute(firId, tenantId)).rejects.toBeInstanceOf(
        FirAnnullatoNelFrattempoError
      )
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        'Failed to sync FIR to RENTRI',
        expect.anything(),
        expect.anything()
      )
    })

    it('con un errore di rete il FIR annullato nel frattempo non si ritenta', async () => {
      mockRENTRIApiClient.attendiEsito.mockRejectedValue(new Error('timeout'))

      const result = await useCase.execute(firId, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(result.nextRetryAt).toBeUndefined()
      expect(mockFIRRepository.save).toHaveBeenCalledTimes(1)
      expect(mockSyncLogRepository.save).toHaveBeenCalledWith(logFallito)
    })
  })

  /**
   * Piano B RENTRI, pezzo 1: al massimo un formulario per FIR. Qui il FIR è
   * l'aggregate vero (non un mock), così gli stati SYNCING/FAILED/
   * PERMANENTLY_FAILED e la non ritentabilità vengono dal dominio e non da
   * un `needsRENTRIRetry` finto.
   */
  describe('Trasmissione idempotente', () => {
    const tenantId = 'tenant-idem'
    const esitoPositivo = {
      errore: false,
      validazione: [],
      esito: { numero_fir: 'RENTRI-NUM-IDEM' },
    }

    function firReale(): FIR {
      const fir = FIR.create({
        produttoreId: 'produttore-1',
        rifiuto: {
          cerCode: '13 02 05*',
          quantita: 120,
          unitaMisura: UnitaMisura.KG,
          statoFisico: 'Liquido',
          caratteristichePericolo: 'HP14',
        },
        trasportatoreId: 'trasportatore-1',
        destinatarioId: 'destinatario-1',
        tenantId,
      })
      fir.emetti('FIR-2026-000001', {
        firmatario: 'Produttore',
        timestamp: new Date(),
        certificato: 'cert',
      })
      fir.clearDomainEvents()
      return fir
    }

    /** Tentativo avviato un'ora fa e mai concluso: oltre la soglia di stallo. */
    const unOraFa = () => new Date(Date.now() - 60 * 60 * 1000)

    function firConTransazioneFallita(transazioneId: string): FIR {
      const fir = firReale()
      fir.avviaTentativoRentri(unOraFa())
      fir.registraTransazioneInAttesa(transazioneId)
      fir.markRENTRISyncFailed('timeout del polling', 'RENTRI_API_ERROR')
      fir.clearDomainEvents()
      return fir
    }

    beforeEach(() => {
      mockSyncLogRepository.createPending.mockImplementation(async (p: any) =>
        RENTRISyncLog.createPending(p)
      )
      mockSyncLogRepository.save.mockImplementation(async (l: any) => l)
      mockFIRRepository.save.mockResolvedValue(undefined)
    })

    it('prenotazione persa: giaInCorso, nessuna chiamata a creaFormulario né ad attendiEsito', async () => {
      mockFIRRepository.findById.mockResolvedValue(firReale())
      mockFIRRepository.prenotaTrasmissioneRentri.mockResolvedValue(false)

      const result = await useCase.execute('fir-x', tenantId)

      expect(result).toMatchObject({ success: false, giaInCorso: true, willRetry: false })
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
      expect(mockRENTRIApiClient.attendiEsito).not.toHaveBeenCalled()
      expect(mockSyncLogRepository.createPending).not.toHaveBeenCalled()
      expect(mockFIRRepository.save).not.toHaveBeenCalled()
    })

    it('transazione salvata prima del polling', async () => {
      const fir = firReale()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({ transazioneId: 't-1' })
      mockRENTRIApiClient.attendiEsito.mockResolvedValue(esitoPositivo)

      const result = await useCase.execute(fir.id, tenantId)

      expect(result.success).toBe(true)
      const [, , ora, soglia] = mockFIRRepository.prenotaTrasmissioneRentri.mock.calls[0]
      expect(ora.getTime() - soglia.getTime()).toBe(SOGLIA_STALLO_RENTRI_MS)
      // Stesso istante della prenotazione: è il testimone del tentativo.
      expect(mockFIRRepository.registraTransazioneInAttesa).toHaveBeenCalledWith(
        fir.id,
        tenantId,
        't-1',
        ora
      )
      expect(fir.rentriSyncAvviatoAt).toBe(ora)
      expect(
        mockFIRRepository.registraTransazioneInAttesa.mock.invocationCallOrder[0]
      ).toBeLessThan(mockRENTRIApiClient.attendiEsito.mock.invocationCallOrder[0])
      expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-IDEM')
    })

    it('timeout del polling: willRetry true e transazione ancora in attesa', async () => {
      const fir = firReale()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({ transazioneId: 't-1' })
      mockRENTRIApiClient.attendiEsito.mockRejectedValue(
        new Error('Superato il numero massimo di tentativi (30) interrogando /status')
      )

      const result = await useCase.execute(fir.id, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: true })
      expect(fir.rentriSyncStatus.getStatus()).toBe('FAILED')
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_API_ERROR')
      expect(fir.rentriTransazioneInAttesa).toBe('t-1')
      expect(mockFIRRepository.save).toHaveBeenCalledWith(fir)
    })

    it('ripresa: FIR FAILED con transazione in attesa → attendiEsito su quella, creaFormulario mai chiamato', async () => {
      const fir = firConTransazioneFallita('t-vecchia')
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.attendiEsito.mockResolvedValue(esitoPositivo)

      const result = await useCase.execute(fir.id, tenantId)

      expect(result.success).toBe(true)
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
      expect(mockRENTRIApiClient.attendiEsito).toHaveBeenCalledWith(tenantId, 't-vecchia')
      expect(mockFIRRepository.registraTransazioneInAttesa).not.toHaveBeenCalled()
      expect(mockSyncLogRepository.createPending).toHaveBeenCalledWith(
        expect.objectContaining({
          requestPayload: JSON.stringify({ ripresaTransazione: 't-vecchia' }),
        })
      )
      expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-IDEM')
      expect(fir.rentriTransazioneInAttesa).toBeNull()
    })

    it('ripresa da SYNCING scaduto con transazione in attesa → attendiEsito, nessuna POST', async () => {
      const fir = firReale()
      fir.avviaTentativoRentri(unOraFa())
      fir.registraTransazioneInAttesa('t-stallo')
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.attendiEsito.mockResolvedValue(esitoPositivo)

      const result = await useCase.execute(fir.id, tenantId)

      expect(result.success).toBe(true)
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
      expect(mockRENTRIApiClient.attendiEsito).toHaveBeenCalledWith(tenantId, 't-stallo')
      expect(fir.rentriSyncStatus.getStatus()).toBe('SYNCED')
    })

    it('SYNCING scaduto senza transazione → RENTRI_TRASMISSIONE_INCERTA, nessuna POST', async () => {
      const fir = firReale()
      fir.avviaTentativoRentri(unOraFa())
      mockFIRRepository.findById.mockResolvedValue(fir)

      const result = await useCase.execute(fir.id, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
      expect(mockRENTRIApiClient.attendiEsito).not.toHaveBeenCalled()
      expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_TRASMISSIONE_INCERTA')
      expect(mockFIRRepository.save).toHaveBeenCalledWith(fir)
    })

    it('5xx sulla creazione → PERMANENTLY_FAILED RENTRI_TRASMISSIONE_INCERTA, willRetry false', async () => {
      const fir = firReale()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.creaFormulario.mockRejectedValue(
        new TrasmissioneRentriIncertaError('HTTP_5XX', 503)
      )

      const result = await useCase.execute(fir.id, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_TRASMISSIONE_INCERTA')
      expect(mockSyncLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'FAILURE', errorCode: 'RENTRI_TRASMISSIONE_INCERTA' })
      )
      expect(mockRENTRIApiClient.attendiEsito).not.toHaveBeenCalled()
    })

    it('404 della transazione in attesa → RENTRI_TRASMISSIONE_INCERTA', async () => {
      const fir = firConTransazioneFallita('t-sconosciuta')
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.attendiEsito.mockRejectedValue(
        new TransazioneRentriNonTrovataError('t-sconosciuta')
      )

      const result = await useCase.execute(fir.id, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_TRASMISSIONE_INCERTA')
      expect(fir.rentriTransazioneInAttesa).toBeNull()
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
    })

    it('esito senza numero_fir → willRetry false', async () => {
      const fir = firReale()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({ transazioneId: 't-1' })
      mockRENTRIApiClient.attendiEsito.mockResolvedValue({ errore: false, validazione: [] })

      const result = await useCase.execute(fir.id, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(result.nextRetryAt).toBeUndefined()
      expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_MISSING_NUMERO_FIR')
      expect(fir.rentriTransazioneInAttesa).toBeNull()
    })

    it('trasmissione incerta già riaperta (dal controller) → nuova POST', async () => {
      const fir = firReale()
      fir.avviaTentativoRentri(unOraFa())
      fir.segnaTrasmissioneIncerta('esito incerto')
      fir.riapriTrasmissioneDopoVerifica()
      fir.clearDomainEvents()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({ transazioneId: 't-nuova' })
      mockRENTRIApiClient.attendiEsito.mockResolvedValue(esitoPositivo)

      const result = await useCase.execute(fir.id, tenantId)

      expect(result.success).toBe(true)
      expect(mockRENTRIApiClient.creaFormulario).toHaveBeenCalledTimes(1)
    })

    it('trasmissione incerta non riaperta (es. retry di un job) → CANNOT_SYNC_FIR, nessuna POST', async () => {
      const fir = firReale()
      fir.avviaTentativoRentri(unOraFa())
      fir.segnaTrasmissioneIncerta('esito incerto')
      fir.clearDomainEvents()
      mockFIRRepository.findById.mockResolvedValue(fir)

      await expect(useCase.execute(fir.id, tenantId)).rejects.toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        metadata: expect.objectContaining({ rule: 'CANNOT_SYNC_FIR' }),
      })
      expect(mockFIRRepository.save).not.toHaveBeenCalled()
      expect(mockFIRRepository.prenotaTrasmissioneRentri).not.toHaveBeenCalled()
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
    })

    it('prenotazione persa dopo la POST: si prosegue il polling e il legame si salva', async () => {
      const fir = firReale()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockFIRRepository.registraTransazioneInAttesa.mockResolvedValue(false)
      mockRENTRIApiClient.creaFormulario.mockResolvedValue({ transazioneId: 't-1' })
      mockRENTRIApiClient.attendiEsito.mockResolvedValue(esitoPositivo)

      const result = await useCase.execute(fir.id, tenantId)

      expect(result.success).toBe(true)
      expect(mockRENTRIApiClient.attendiEsito).toHaveBeenCalledWith(tenantId, 't-1')
      // L'id della transazione non va perso: finisce subito nel log di sync.
      const primoSalvataggioLog = mockSyncLogRepository.save.mock.calls[0][0]
      expect(primoSalvataggioLog.responsePayload).toContain('t-1')
      expect(mockSyncLogRepository.save.mock.invocationCallOrder[0]).toBeLessThan(
        mockRENTRIApiClient.attendiEsito.mock.invocationCallOrder[0]
      )
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ firId: fir.id, transazioneId: 't-1' })
      )
      expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-IDEM')
      expect(mockFIRRepository.save).toHaveBeenCalledWith(fir)
      // Anche il log finale conserva la transazione (l'esito sovrascrive il
      // responsePayload intermedio).
      const logFinale = mockSyncLogRepository.save.mock.calls.at(-1)[0]
      expect(logFinale.status).toBe('SUCCESS')
      expect(logFinale.responsePayload).toContain('t-1')
    })

    it('prenotazione riuscita ma il FIR riletto ha una transazione in attesa: ripresa, creaFormulario mai chiamato', async () => {
      // Prima lettura: nessuna transazione. Fra lettura e prenotazione un altro
      // job ha creato il formulario (t-altro) ed è fallito sul polling.
      mockFIRRepository.findById
        .mockResolvedValueOnce(firReale())
        .mockResolvedValueOnce(firConTransazioneFallita('t-altro'))
      mockRENTRIApiClient.attendiEsito.mockResolvedValue(esitoPositivo)

      const result = await useCase.execute('fir-x', tenantId)

      expect(result.success).toBe(true)
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
      expect(mockRENTRIApiClient.attendiEsito).toHaveBeenCalledWith(tenantId, 't-altro')
      expect(mockFIRRepository.findById).toHaveBeenCalledTimes(2)
    })

    /** FIR al quinto tentativo con la transazione t-x ancora da leggere. */
    function firAlQuintoTentativo(): FIR {
      const fir = firReale()
      fir.registraTransazioneInAttesa('t-x')
      for (let i = 0; i < 4; i++) {
        fir.avviaTentativoRentri(unOraFa())
        fir.markRENTRISyncFailed('timeout del polling', 'RENTRI_API_ERROR')
      }
      fir.clearDomainEvents()
      return fir
    }

    it('quinto timeout del polling con transazione in attesa → RENTRI_ESITO_NON_ACQUISITO, transazione conservata', async () => {
      const fir = firAlQuintoTentativo()
      expect(fir.rentriTransazioneInAttesa).toBe('t-x')
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.attendiEsito.mockRejectedValue(new Error('Superato il numero massimo'))

      const result = await useCase.execute(fir.id, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_ESITO_NON_ACQUISITO')
      // L'ente ha la transazione: la si rilegge, non si rifà la POST.
      expect(fir.rentriTransazioneInAttesa).toBe('t-x')
      expect(mockFIRRepository.save).toHaveBeenCalledWith(fir)
      expect(mockSyncLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 'RENTRI_ESITO_NON_ACQUISITO' })
      )
      // Non è un vicolo cieco: «Rileggi esito» lo riapre.
      expect(() => fir.riapriTrasmissioneDopoVerifica()).not.toThrow()
    })

    it('403 sulla ripresa con transazione in attesa → RENTRI_ESITO_NON_ACQUISITO, transazione conservata', async () => {
      const fir = firConTransazioneFallita('t-x')
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.attendiEsito.mockRejectedValue(
        new RentriApiError(403, 'Operazione non consentita', 'Certificato non riconosciuto', false)
      )

      const result = await useCase.execute(fir.id, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_ESITO_NON_ACQUISITO')
      expect(fir.rentriTransazioneInAttesa).toBe('t-x')
      expect(mockSyncLogRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ errorCode: 'RENTRI_ESITO_NON_ACQUISITO' })
      )
    })

    it('esito non acquisito riaperto («Rileggi esito») → ripresa della stessa transazione, nessuna POST', async () => {
      const fir = firAlQuintoTentativo()
      fir.avviaTentativoRentri(unOraFa())
      fir.markRENTRISyncFailed('esito non leggibile', 'RENTRI_ESITO_NON_ACQUISITO')
      fir.riapriTrasmissioneDopoVerifica()
      fir.clearDomainEvents()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.attendiEsito.mockResolvedValue(esitoPositivo)

      const result = await useCase.execute(fir.id, tenantId)

      expect(result.success).toBe(true)
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
      expect(mockRENTRIApiClient.attendiEsito).toHaveBeenCalledWith(tenantId, 't-x')
      expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-IDEM')
    })

    it('esito non acquisito riaperto ma la transazione è sconosciuta (404) → RENTRI_TRASMISSIONE_INCERTA, transazione azzerata', async () => {
      const fir = firAlQuintoTentativo()
      fir.avviaTentativoRentri(unOraFa())
      fir.markRENTRISyncFailed('esito non leggibile', 'RENTRI_ESITO_NON_ACQUISITO')
      fir.riapriTrasmissioneDopoVerifica()
      fir.clearDomainEvents()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.attendiEsito.mockRejectedValue(
        new TransazioneRentriNonTrovataError('t-x')
      )

      const result = await useCase.execute(fir.id, tenantId)

      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_TRASMISSIONE_INCERTA')
      expect(fir.rentriTransazioneInAttesa).toBeNull()
    })

    it('errore fra prenotazione e POST: FAILED ritentabile, nessuna POST', async () => {
      const fir = firReale()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockSyncLogRepository.createPending.mockRejectedValue(new Error('database irraggiungibile'))

      await expect(useCase.execute(fir.id, tenantId)).rejects.toThrow('database irraggiungibile')

      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
      expect(fir.rentriSyncStatus.getStatus()).toBe('FAILED')
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_API_ERROR')
      expect(fir.needsRENTRIRetry()).toBe(true)
      expect(mockFIRRepository.save).toHaveBeenCalledWith(fir)
    })
  })

  describe('Errore prima della POST: evento di dominio', () => {
    it("errore fra prenotazione e POST generico: si pubblica l'evento di sync fallito", async () => {
      const fir = FIR.create({
        produttoreId: 'p1',
        rifiuto: {
          cerCode: '13 02 05*',
          quantita: 1,
          unitaMisura: UnitaMisura.KG,
          statoFisico: 'Liquido',
          caratteristichePericolo: 'HP14',
        },
        trasportatoreId: 't1',
        destinatarioId: 'd1',
        tenantId: 'tenant-ev',
      })
      fir.emetti('FIR-2026-000010', { firmatario: 'P', timestamp: new Date(), certificato: 'c' })
      fir.clearDomainEvents()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.createPending.mockRejectedValue(new Error('db giu'))

      await expect(useCase.execute(fir.id, 'tenant-ev')).rejects.toThrow('db giu')

      expect(mockDomainEvents.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: 'fir.rentri_sync_fallito',
          errorCode: 'RENTRI_API_ERROR',
        })
      )
    })
  })

  describe('Pubblicazione evento prima della POST', () => {
    it("publish fallita: l'errore originale risale e il log non parla di rilascio", async () => {
      const fir = FIR.create({
        produttoreId: 'p1',
        rifiuto: {
          cerCode: '13 02 05*',
          quantita: 1,
          unitaMisura: UnitaMisura.KG,
          statoFisico: 'Liquido',
          caratteristichePericolo: 'HP14',
        },
        trasportatoreId: 't1',
        destinatarioId: 'd1',
        tenantId: 'tenant-ev2',
      })
      fir.emetti('FIR-2026-000011', { firmatario: 'P', timestamp: new Date(), certificato: 'c' })
      fir.clearDomainEvents()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockFIRRepository.save.mockResolvedValue(undefined)
      mockSyncLogRepository.createPending.mockRejectedValue(new Error('db giu'))
      mockDomainEvents.publish.mockRejectedValue(new Error('bus giu'))

      await expect(useCase.execute(fir.id, 'tenant-ev2')).rejects.toThrow('db giu')

      const messaggi = mockLogger.error.mock.calls.map((c: any[]) => String(c[0]))
      expect(messaggi.some((m: string) => m.includes('Pubblicazione'))).toBe(true)
      expect(messaggi.some((m: string) => m.includes('Rilascio della prenotazione'))).toBe(false)
    })
  })

  describe('Azienda senza certificato RENTRI', () => {
    const tenantId = 'tenant-senza-cert'

    function firReale(): FIR {
      const fir = FIR.create({
        produttoreId: 'produttore-1',
        rifiuto: {
          cerCode: '13 02 05*',
          quantita: 120,
          unitaMisura: UnitaMisura.KG,
          statoFisico: 'Liquido',
          caratteristichePericolo: 'HP14',
        },
        trasportatoreId: 'trasportatore-1',
        destinatarioId: 'destinatario-1',
        tenantId,
      })
      fir.emetti('FIR-2026-000009', {
        firmatario: 'Produttore',
        timestamp: new Date(),
        certificato: 'cert',
      })
      fir.clearDomainEvents()
      return fir
    }

    function attesoDefinitivo(fir: FIR, result: any) {
      expect(result).toMatchObject({ success: false, willRetry: false })
      expect(result.error).toContain('non ha un certificato RENTRI')
      expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
      expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_CERTIFICATO_MANCANTE')
      expect(mockFIRRepository.save).toHaveBeenCalledWith(fir)
      expect(mockRENTRIApiClient.attendiEsito).not.toHaveBeenCalled()
    }

    beforeEach(() => {
      mockSyncLogRepository.createPending.mockImplementation(async (p: any) =>
        RENTRISyncLog.createPending(p)
      )
      mockSyncLogRepository.save.mockImplementation(async (l: any) => l)
      mockFIRRepository.save.mockResolvedValue(undefined)
    })

    it('resolver senza certificato: PERMANENTLY_FAILED RENTRI_CERTIFICATO_MANCANTE, nessuna POST, willRetry false', async () => {
      const fir = firReale()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRENTRIApiClient.creaFormulario.mockRejectedValue(new TenantSenzaCertificatoRentriError())

      const result = await useCase.execute(fir.id, tenantId)

      attesoDefinitivo(fir, result)
      expect(mockRENTRIApiClient.creaFormulario).toHaveBeenCalledTimes(1)
    })

    it('errore prima della prenotazione (costruzione del corpo): stato definitivo salvato comunque', async () => {
      const fir = firReale()
      mockFIRRepository.findById.mockResolvedValue(fir)
      const uc = new SyncFIRToRENTRIUseCase(
        mockFIRRepository,
        mockRENTRIApiClient,
        mockSyncLogRepository,
        mockDomainEvents,
        mockLogger,
        { costruisci: jest.fn().mockRejectedValue(new TenantSenzaCertificatoRentriError()) } as any
      )

      const result = await uc.execute(fir.id, tenantId)

      attesoDefinitivo(fir, result)
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
    })

    it('errore fra prenotazione e POST: stato definitivo, non FAILED ritentabile', async () => {
      const fir = firReale()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockSyncLogRepository.createPending.mockRejectedValue(new TenantSenzaCertificatoRentriError())

      const result = await useCase.execute(fir.id, tenantId)

      attesoDefinitivo(fir, result)
      expect(mockRENTRIApiClient.creaFormulario).not.toHaveBeenCalled()
    })
  })
})
