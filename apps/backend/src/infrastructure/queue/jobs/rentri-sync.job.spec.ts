import { RENTRISyncJobProcessor } from './rentri-sync.job'
import { Job, UnrecoverableError } from 'bullmq'

/**
 * Integration tests for RENTRI Sync Job Processor
 *
 * Tests BullMQ job processing, retry logic, and error handling.
 */
describe('RENTRISyncJobProcessor', () => {
  let processor: RENTRISyncJobProcessor
  let mockConfigService: any
  let mockLogger: any
  let mockMetrics: any
  let mockSyncUseCase: any
  let mockModuli: { moduliAttivi: jest.Mock }
  let mockRentriSyncQueue: any

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'REDIS_HOST') return 'localhost'
        if (key === 'REDIS_PORT') return 6379
        if (key === 'RENTRI_SYNC_CONCURRENCY') return 5
        return null
      }),
    }

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }

    mockMetrics = {
      firSyncDuration: {
        observe: jest.fn(),
      },
    }

    mockSyncUseCase = {
      execute: jest.fn(),
    }

    mockRentriSyncQueue = {}
    mockModuli = { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) }

    // Directly instantiate the processor with mocks
    processor = new RENTRISyncJobProcessor(
      mockConfigService,
      mockLogger,
      mockMetrics,
      mockSyncUseCase,
      mockRentriSyncQueue,
      mockModuli as any
    )
  })

  describe('modulo rentri ricontrollato (D4b)', () => {
    const jobDi = (data: Record<string, unknown>) =>
      ({
        id: 'job-m',
        name: 'rentri-sync',
        data,
        attemptsMade: 0,
        updateProgress: jest.fn(),
      }) as unknown as Job

    it('modulo tolto con il job gia in coda: UnrecoverableError MODULO_NON_ATTIVO, nessuna sync', async () => {
      mockModuli.moduliAttivi.mockResolvedValue(['fir'])
      const errore = await (processor as any)
        .processJob(jobDi({ type: 'single', firId: 'f1', tenantId: 't1' }))
        .catch((e: unknown) => e)
      expect(errore).toBeInstanceOf(UnrecoverableError)
      expect((errore as Error).message).toContain('MODULO_NON_ATTIVO')
      expect(mockSyncUseCase.execute).not.toHaveBeenCalled()
    })

    it('errore del database sul controllo: errore normale (si ritenta)', async () => {
      mockModuli.moduliAttivi.mockRejectedValue(new Error('db giu'))
      const errore = await (processor as any)
        .processJob(jobDi({ type: 'single', firId: 'f1', tenantId: 't1' }))
        .catch((e: unknown) => e)
      expect(errore).toBeInstanceOf(Error)
      expect(errore).not.toBeInstanceOf(UnrecoverableError)
    })
  })

  describe('Single FIR Processing', () => {
    it('should process single FIR sync successfully', async () => {
      const mockJob = {
        id: 'job-123',
        name: 'rentri-sync',
        data: {
          type: 'single',
          firId: 'fir-456',
          tenantId: 'tenant-789',
        },
        attemptsMade: 0,
        updateProgress: jest.fn(),
      } as unknown as Job

      mockSyncUseCase.execute.mockResolvedValue({
        success: true,
        protocolNumber: 'RENTRI-2025-123456',
        attempts: 1,
      })

      const result = await processor['processSingleSync'](mockJob)

      expect(result.success).toBe(true)
      expect(result.protocolNumber).toBe('RENTRI-2025-123456')
      expect(mockSyncUseCase.execute).toHaveBeenCalledWith('fir-456', 'tenant-789', undefined)
      expect(mockMetrics.firSyncDuration.observe).toHaveBeenCalled()
      expect(mockJob.updateProgress).toHaveBeenCalledWith(10)
      expect(mockJob.updateProgress).toHaveBeenCalledWith(100)
    })

    it('should handle sync failure with proper error', async () => {
      const mockJob = {
        id: 'job-123',
        name: 'rentri-sync',
        data: {
          type: 'single',
          firId: 'fir-456',
          tenantId: 'tenant-789',
        },
        attemptsMade: 1,
        updateProgress: jest.fn(),
      } as unknown as Job

      const error = new Error('RENTRI service unavailable')
      mockSyncUseCase.execute.mockRejectedValue(error)

      await expect(processor['processSingleSync'](mockJob)).rejects.toThrow(
        'RENTRI service unavailable'
      )

      expect(mockMetrics.firSyncDuration.observe).toHaveBeenCalled()
    })

    /**
     * Task 4 (P2): il use case non rilancia mai per un errore RENTRI — resta
     * sempre un risultato con `willRetry` esplicito. Il job deve tradurre
     * `willRetry: true` in un rilancio, così BullMQ applica il backoff
     * esponenziale della coda; `willRetry: false` (es. 403, esito negativo
     * della transazione) NON deve far ritentare il job.
     */
    it('willRetry: true (errore transitorio) — rilancia perché BullMQ ritenti il job', async () => {
      const mockJob = {
        id: 'job-403',
        name: 'rentri-sync',
        data: { type: 'single', firId: 'fir-456', tenantId: 'tenant-789' },
        attemptsMade: 0,
        updateProgress: jest.fn(),
      } as unknown as Job

      mockSyncUseCase.execute.mockResolvedValue({
        success: false,
        error: 'RENTRI ha risposto 503: tentativi di resilienza esauriti',
        willRetry: true,
        attempts: 1,
      })

      await expect(processor['processSingleSync'](mockJob)).rejects.toThrow(
        'RENTRI ha risposto 503'
      )
    })

    /**
     * R1 Task 2 (modalità IBRIDA): il job accodato da
     * `TrasmettiFIRSecondoModalitaUseCase` porta `richiedeConferma: true` nei
     * dati — deve arrivare come opzione esplicita al use case di sync, senza
     * intaccare l'invocazione a 3 argomenti dei job esistenti (v. test sopra).
     */
    it('richiedeConferma: true — passa l’opzione esplicita al use case di sync', async () => {
      const mockJob = {
        id: 'job-ibrida',
        name: 'rentri-sync',
        data: {
          type: 'single',
          firId: 'fir-456',
          tenantId: 'tenant-789',
          richiedeConferma: true,
        },
        attemptsMade: 0,
        updateProgress: jest.fn(),
      } as unknown as Job

      mockSyncUseCase.execute.mockResolvedValue({
        success: true,
        protocolNumber: 'RENTRI-2025-999',
        attempts: 1,
        inAttesaDiConferma: true,
      })

      const result = await processor['processSingleSync'](mockJob)

      expect(result.success).toBe(true)
      expect(mockSyncUseCase.execute).toHaveBeenCalledWith('fir-456', 'tenant-789', undefined, {
        richiedeConferma: true,
      })
    })

    it('giaInCorso: il job non lancia', async () => {
      const mockJob = {
        id: 'job-1',
        data: { type: 'single', firId: 'fir-456', tenantId: 'tenant-789' },
        attemptsMade: 0,
        updateProgress: jest.fn(),
      } as unknown as Job
      mockSyncUseCase.execute.mockResolvedValue({
        success: false,
        willRetry: true,
        giaInCorso: true,
        error: 'trasmissione di un altro job',
      })

      const result = await processor['processSingleSync'](mockJob)

      expect(result.success).toBe(false)
      expect(mockLogger.info).toHaveBeenCalled()
      expect(mockJob.updateProgress).not.toHaveBeenCalledWith(100)
      expect(mockMetrics.firSyncDuration.observe).not.toHaveBeenCalled()
    })

    it('retry di un job con confermaNuovaTrasmissione nel data: nessuna riapertura, solo la sync', async () => {
      // La conferma si consuma nel controller (RiapriTrasmissioneRentriUseCase):
      // un job rimasto in Redis col vecchio flag, al secondo tentativo, non deve
      // riaprire nulla né forzare una nuova POST.
      const mockJob = {
        id: 'job-1',
        data: {
          type: 'single',
          firId: 'fir-456',
          tenantId: 'tenant-789',
          confermaNuovaTrasmissione: true,
        },
        attemptsMade: 1,
        updateProgress: jest.fn(),
      } as unknown as Job
      mockSyncUseCase.execute.mockResolvedValue({ success: true })

      await processor['processSingleSync'](mockJob)

      expect(mockSyncUseCase.execute).toHaveBeenCalledWith('fir-456', 'tenant-789', undefined)
    })

    it('willRetry: false (fallimento definitivo, es. 403) — NON rilancia: il job si considera concluso', async () => {
      const mockJob = {
        id: 'job-forbidden',
        name: 'rentri-sync',
        data: { type: 'single', firId: 'fir-456', tenantId: 'tenant-789' },
        attemptsMade: 0,
        updateProgress: jest.fn(),
      } as unknown as Job

      mockSyncUseCase.execute.mockResolvedValue({
        success: false,
        error: 'Certificato non riconosciuto',
        willRetry: false,
        attempts: 1,
      })

      const result = await processor['processSingleSync'](mockJob)

      expect(result.success).toBe(false)
      expect(mockJob.updateProgress).toHaveBeenCalledWith(100)
    })
  })

  // Removed tests for private methods (calculateBackoff, getRetryOptions, onCompleted, onFailed)
  // These are implementation details tested indirectly through job processing tests

  describe('Batch Processing', () => {
    it('should process batch sync job', async () => {
      const mockJob = {
        id: 'batch-job-123',
        name: 'rentri-batch-sync',
        data: {
          type: 'batch',
          firIds: ['fir-1', 'fir-2', 'fir-3'],
          tenantId: 'tenant-789',
        },
        attemptsMade: 0,
        updateProgress: jest.fn(),
      } as unknown as Job

      mockSyncUseCase.execute
        .mockResolvedValueOnce({ success: true, protocolNumber: 'RENTRI-1', attempts: 1 })
        .mockResolvedValueOnce({ success: true, protocolNumber: 'RENTRI-2', attempts: 1 })
        .mockResolvedValueOnce({ success: true, protocolNumber: 'RENTRI-3', attempts: 1 })

      const result = await processor['processBatchSync'](mockJob)

      expect(result.total).toBe(3)
      expect(result.successCount).toBe(3)
      expect(result.failureCount).toBe(0)
      expect(mockSyncUseCase.execute).toHaveBeenCalledTimes(3)
    })

    it('should handle partial batch failures', async () => {
      const mockJob = {
        id: 'batch-job-123',
        name: 'rentri-batch-sync',
        data: {
          type: 'batch',
          firIds: ['fir-1', 'fir-2', 'fir-3'],
          tenantId: 'tenant-789',
        },
        attemptsMade: 0,
        updateProgress: jest.fn(),
      } as unknown as Job

      mockSyncUseCase.execute
        .mockResolvedValueOnce({ success: true, protocolNumber: 'RENTRI-1', attempts: 1 })
        .mockResolvedValueOnce({ success: false, error: 'Failed', willRetry: false, attempts: 1 })
        .mockResolvedValueOnce({ success: true, protocolNumber: 'RENTRI-3', attempts: 1 })

      const result = await processor['processBatchSync'](mockJob)

      expect(result.total).toBe(3)
      expect(result.successCount).toBe(2)
      expect(result.failureCount).toBe(1)
    })
  })
})
