import { SyncFIRToRENTRIUseCase } from './sync-fir-to-rentri.use-case'
import { RentriApiError } from '../../infrastructure/rentri/rentri-api.client'

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
    mockFIRRepository = {
      findById: jest.fn(),
      save: jest.fn(),
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
      mockLogger
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
        startRENTRISync: jest.fn(),
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
      expect(mockFIR.startRENTRISync).toHaveBeenCalled()
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
        startRENTRISync: jest.fn(),
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
        startRENTRISync: jest.fn(),
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
        startRENTRISync: jest.fn(),
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
        startRENTRISync: jest.fn(),
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
        startRENTRISync: jest.fn(),
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
        startRENTRISync: jest.fn(),
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
          startRENTRISync: jest.fn(),
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
        startRENTRISync: jest.fn(),
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
        startRENTRISync: jest.fn(),
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
        startRENTRISync: jest.fn(),
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
        startRENTRISync: jest.fn(),
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
})
