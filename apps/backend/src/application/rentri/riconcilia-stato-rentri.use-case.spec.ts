import { RiconciliaStatoRentriUseCase } from './riconcilia-stato-rentri.use-case'
import { RentriApiError } from '../../infrastructure/rentri/rentri-api.client'
import { FirAnnullatoNelFrattempoError } from '../../core/domain/errors'
import { SOGLIA_STALLO_RENTRI_MS } from './sync-fir-to-rentri.use-case'

/**
 * Test unitari di RiconciliaStatoRentriUseCase (R5 Task 4).
 *
 * Copre:
 * - il vincolo numerico del campionamento (Step 1 del piano): 500 FIR SYNCED
 *   nel tenant producono al massimo 20 controlli (`leggiFormulario`), MAI
 *   500 — senza questo test il limite è un'intenzione, non un vincolo. La
 *   fake di `findMany` simula davvero l'effetto di `take`: se il codice
 *   dimenticasse di passarlo, il test fallirebbe (vedrebbe tutti i 500).
 * - le due classificazioni ("corregge"/"segnala") sui tre lotti.
 * - che nessuna lettura bypassi il client iniettato (nessuna chiamata HTTP
 *   diretta: qui verificato per costruzione, dato che l'unico modo del use
 *   case di raggiungere RENTRI è `mockRentriApiClient`).
 */
describe('RiconciliaStatoRentriUseCase', () => {
  let useCase: RiconciliaStatoRentriUseCase
  let mockFIRRepository: any
  let mockPrisma: any
  let mockRentriApiClient: any
  let mockSyncLogRepository: any
  let mockDomainEvents: any
  let mockLogger: any
  let mockMetrics: any
  let mockModalita: any

  const tenantId = 'tenant-1'

  function firFake(overrides: Partial<Record<string, any>> = {}): any {
    return {
      id: overrides.id ?? 'fir-1',
      tenantId,
      rentriTransazioneId: overrides.rentriTransazioneId ?? null,
      rentriNumeroFir: overrides.rentriNumeroFir ?? null,
      rentriNumeroFirProposto: overrides.rentriNumeroFirProposto ?? null,
      rentriStatoFormulario: overrides.rentriStatoFormulario ?? null,
      markRENTRISynced: jest.fn(),
      proporreLegameRENTRI: jest.fn(),
      applyRentriStato: jest.fn(),
      confermaLegameRENTRI: jest.fn(),
      getDomainEvents: jest.fn().mockReturnValue([]),
      clearDomainEvents: jest.fn(),
      ...overrides,
    }
  }

  beforeEach(() => {
    mockFIRRepository = {
      findById: jest.fn(),
      save: jest.fn(),
    }

    mockPrisma = {
      fIR: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    }

    mockRentriApiClient = {
      leggiFormulario: jest.fn(),
      attendiEsito: jest.fn(),
    }

    const pendingLog = {
      markAsSuccess: jest.fn().mockReturnValue({ id: 'log-1', status: 'SUCCESS' }),
      markAsFailure: jest.fn().mockReturnValue({ id: 'log-1', status: 'FAILURE' }),
    }

    mockSyncLogRepository = {
      createPending: jest.fn().mockResolvedValue(pendingLog),
      save: jest.fn(),
    }

    mockDomainEvents = { publish: jest.fn() }

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }

    mockMetrics = {
      rentriReconciliationDivergences: { inc: jest.fn() },
    }

    mockModalita = {
      getForTenant: jest
        .fn()
        .mockResolvedValue({ modalitaLegame: 'AUTOMATICA', certificatoConfigurato: true }),
    }

    useCase = new RiconciliaStatoRentriUseCase(
      mockFIRRepository,
      mockPrisma,
      mockRentriApiClient,
      mockSyncLogRepository,
      mockDomainEvents,
      mockLogger,
      mockMetrics,
      mockModalita
    )
  })

  describe('campionamento SYNCED (Step 1 del piano)', () => {
    it('con 500 FIR SYNCED nel tenant, controlla al massimo 20 FIR (non 500)', async () => {
      const totaleDisponibile = 500

      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        // Simula il comportamento reale di Postgres/Prisma con `take`: se il
        // use case NON passasse `take: 20`, questa fake restituirebbe le 500
        // righe e il test fallirebbe sull'asserzione sotto.
        if (args.where.rentriSyncStatus === 'SYNCED') {
          const tutte = Array.from({ length: totaleDisponibile }, (_, i) => ({ id: `synced-${i}` }))
          const take = args.take ?? tutte.length
          return Promise.resolve(tutte.slice(0, take))
        }
        return Promise.resolve([]) // altri due lotti: nessun candidato
      })

      mockFIRRepository.findById.mockImplementation((id: string) =>
        Promise.resolve(
          firFake({ id, rentriNumeroFir: `NUM-${id}`, rentriStatoFormulario: 'InAttesa' })
        )
      )
      mockRentriApiClient.leggiFormulario.mockResolvedValue({ stato_formulario: 'InAttesa' })

      const risultato = await useCase.execute(tenantId)

      expect(mockPrisma.fIR.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId, rentriSyncStatus: 'SYNCED' }),
          take: RiconciliaStatoRentriUseCase.MAX_CAMPIONI_SYNCED_PER_TENANT,
        })
      )
      expect(RiconciliaStatoRentriUseCase.MAX_CAMPIONI_SYNCED_PER_TENANT).toBe(20)
      expect(mockRentriApiClient.leggiFormulario).toHaveBeenCalledTimes(20)
      expect(risultato.controllati).toBe(20)
    })
  })

  describe('lotto SYNCING bloccato', () => {
    it("CORREGGE quando l'ente conferma la creazione con un numero_fir (riempie un buco)", async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCING') {
          return Promise.resolve([{ id: 'fir-syncing' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({ id: 'fir-syncing', rentriTransazioneId: 'trans-1' })
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: { numero_fir: 'NUM-999' },
      })

      const risultato = await useCase.execute(tenantId)

      expect(mockRentriApiClient.attendiEsito).toHaveBeenCalledWith(
        tenantId,
        'trans-1',
        expect.objectContaining({ maxTentativi: 1 })
      )
      expect(fir.markRENTRISynced).toHaveBeenCalledWith('NUM-999', 'trans-1', expect.any(String))
      expect(mockFIRRepository.save).toHaveBeenCalledWith(fir)
      expect(risultato.corretti).toBe(1)
      expect(risultato.segnalati).toBe(0)

      const logSalvato = mockSyncLogRepository.createPending.mock.calls[0][0]
      expect(logSalvato.origine).toBe('RICONCILIAZIONE')
    })

    it('seleziona i SYNCING sulla prenotazione (rentri_sync_avviato_at oltre la soglia di stallo o assente), non su updatedAt', async () => {
      mockPrisma.fIR.findMany.mockResolvedValue([])
      const prima = Date.now()

      await useCase.execute(tenantId)

      const chiamata = mockPrisma.fIR.findMany.mock.calls
        .map((c: any[]) => c[0])
        .find((a: any) => a.where.rentriSyncStatus === 'SYNCING')
      expect(chiamata.where.updatedAt).toBeUndefined()
      const [scaduta, assente] = chiamata.where.OR
      expect(assente).toEqual({ rentriSyncAvviatoAt: null })
      // La stessa soglia del cron di ripresa: una trasmissione viva (POST +
      // polling) non sembra mai "bloccata".
      expect(
        Math.abs(scaduta.rentriSyncAvviatoAt.lt.getTime() - (prima - SOGLIA_STALLO_RENTRI_MS))
      ).toBeLessThan(5000)
    })

    it('tenant IBRIDA: la correzione propone il legame invece di chiuderlo', async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) =>
        Promise.resolve(args.where.rentriSyncStatus === 'SYNCING' ? [{ id: 'fir-ibrida' }] : [])
      )
      mockModalita.getForTenant.mockResolvedValue({
        modalitaLegame: 'IBRIDA',
        certificatoConfigurato: true,
      })
      const fir = firFake({ id: 'fir-ibrida', rentriTransazioneId: 'trans-ib' })
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: { numero_fir: 'NUM-IB' },
      })

      const risultato = await useCase.execute(tenantId)

      expect(mockModalita.getForTenant).toHaveBeenCalledWith(tenantId)
      expect(fir.proporreLegameRENTRI).toHaveBeenCalledWith(
        'NUM-IB',
        'trans-ib',
        expect.any(String)
      )
      expect(fir.markRENTRISynced).not.toHaveBeenCalled()
      expect(mockFIRRepository.save).toHaveBeenCalledWith(fir)
      expect(risultato.corretti).toBe(1)
    })

    it('SEGNALA (non corregge) senza rentriTransazioneId noto', async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCING') {
          return Promise.resolve([{ id: 'fir-syncing-senza-transazione' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({ id: 'fir-syncing-senza-transazione', rentriTransazioneId: null })
      mockFIRRepository.findById.mockResolvedValue(fir)

      const risultato = await useCase.execute(tenantId)

      expect(mockRentriApiClient.attendiEsito).not.toHaveBeenCalled()
      expect(fir.markRENTRISynced).not.toHaveBeenCalled()
      expect(mockFIRRepository.save).not.toHaveBeenCalled()
      expect(risultato.segnalati).toBe(1)
      expect(risultato.corretti).toBe(0)
    })

    it('SEGNALA quando la transazione risulta ancora priva di numero_fir', async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCING') {
          return Promise.resolve([{ id: 'fir-syncing-ambiguo' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({ id: 'fir-syncing-ambiguo', rentriTransazioneId: 'trans-2' })
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: {},
      })

      const risultato = await useCase.execute(tenantId)

      expect(fir.markRENTRISynced).not.toHaveBeenCalled()
      expect(mockFIRRepository.save).not.toHaveBeenCalled()
      expect(risultato.segnalati).toBe(1)
    })

    it('un FIR annullato in locale mentre era in SYNCING è segnalato come tale, non come errore di trasporto', async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCING') {
          return Promise.resolve([{ id: 'fir-annullato' }])
        }
        return Promise.resolve([])
      })
      const fir = firFake({ id: 'fir-annullato', rentriTransazioneId: 'trans-3' })
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: { numero_fir: 'NUM-111' },
      })
      mockFIRRepository.save.mockRejectedValue(new FirAnnullatoNelFrattempoError('fir-annullato'))

      const risultato = await useCase.execute(tenantId)

      expect(risultato.segnalati).toBe(1)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ errorCode: 'RENTRI_RICONCILIAZIONE_FIR_ANNULLATO_IN_LOCALE' })
      )
    })
  })

  describe('lotto SYNCED campionato', () => {
    it('nessuna divergenza: aggiorna solo rentriLastReconciledAt, nessuna scrittura di dominio', async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCED') {
          return Promise.resolve([{ id: 'fir-allineato' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({
        id: 'fir-allineato',
        rentriNumeroFir: 'NUM-1',
        rentriStatoFormulario: 'Accettato',
      })
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.leggiFormulario.mockResolvedValue({ stato_formulario: 'Accettato' })

      const risultato = await useCase.execute(tenantId)

      expect(mockPrisma.fIR.update).toHaveBeenCalledWith({
        where: { id: 'fir-allineato' },
        data: { rentriLastReconciledAt: expect.any(Date) },
      })
      expect(mockFIRRepository.save).not.toHaveBeenCalled()
      expect(risultato.nessunaDivergenza).toBe(1)
      expect(risultato.segnalati).toBe(0)
      expect(risultato.corretti).toBe(0)
    })

    it("SEGNALA (non applica applyRentriStato) quando l'ente mostra uno stato diverso da quello locale", async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCED') {
          return Promise.resolve([{ id: 'fir-divergente' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({
        id: 'fir-divergente',
        rentriNumeroFir: 'NUM-2',
        rentriStatoFormulario: 'Accettato',
      })
      fir.applyRentriStato = jest.fn()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.leggiFormulario.mockResolvedValue({ stato_formulario: 'Annullato' })

      const risultato = await useCase.execute(tenantId)

      expect(fir.applyRentriStato).not.toHaveBeenCalled()
      expect(mockFIRRepository.save).not.toHaveBeenCalled()
      expect(risultato.segnalati).toBe(1)

      const failureCall = mockSyncLogRepository.save.mock.calls[0][0]
      expect(failureCall.status).toBe('FAILURE')
    })

    it("SEGNALA quando l'ente non trova più il formulario (404)", async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCED') {
          return Promise.resolve([{ id: 'fir-scomparso' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({ id: 'fir-scomparso', rentriNumeroFir: 'NUM-3' })
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.leggiFormulario.mockRejectedValue(
        new RentriApiError(404, 'Not Found', undefined, false)
      )

      const risultato = await useCase.execute(tenantId)

      expect(risultato.segnalati).toBe(1)
      expect(mockFIRRepository.save).not.toHaveBeenCalled()
      // Anche in errore, la verifica va comunque registrata: altrimenti questo
      // FIR resterebbe sempre in cima al campione (mai avanzato).
      expect(mockPrisma.fIR.update).toHaveBeenCalledWith({
        where: { id: 'fir-scomparso' },
        data: { rentriLastReconciledAt: expect.any(Date) },
      })
    })
  })

  describe('lotto IBRIDA in attesa di conferma', () => {
    it("SEGNALA sempre, anche se l'ente conferma il formulario: la conferma resta un'azione umana", async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriNumeroFirProposto) {
          return Promise.resolve([{ id: 'fir-ibrida' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({ id: 'fir-ibrida', rentriNumeroFirProposto: 'NUM-PROPOSTO' })
      fir.confermaLegameRENTRI = jest.fn()
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.leggiFormulario.mockResolvedValue({ stato_formulario: 'InAttesa' })

      const risultato = await useCase.execute(tenantId)

      expect(fir.confermaLegameRENTRI).not.toHaveBeenCalled()
      expect(mockFIRRepository.save).not.toHaveBeenCalled()
      expect(risultato.segnalati).toBe(1)
    })
  })

  describe('metrica rentriReconciliationDivergences (R5 Task 5)', () => {
    it('incrementa con esito "corretto" quando la riconciliazione ripara un FIR SYNCING bloccato', async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCING') {
          return Promise.resolve([{ id: 'fir-syncing' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({ id: 'fir-syncing', rentriTransazioneId: 'trans-1' })
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.attendiEsito.mockResolvedValue({
        errore: false,
        validazione: [],
        esito: { numero_fir: 'NUM-999' },
      })

      await useCase.execute(tenantId)

      expect(mockMetrics.rentriReconciliationDivergences.inc).toHaveBeenCalledWith({
        tenant_id: tenantId,
        esito: 'corretto',
      })
    })

    it('incrementa con esito "segnalato" quando la riconciliazione trova una divergenza non correggibile', async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCED') {
          return Promise.resolve([{ id: 'fir-divergente' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({
        id: 'fir-divergente',
        rentriNumeroFir: 'NUM-2',
        rentriStatoFormulario: 'Accettato',
      })
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.leggiFormulario.mockResolvedValue({ stato_formulario: 'Annullato' })

      await useCase.execute(tenantId)

      expect(mockMetrics.rentriReconciliationDivergences.inc).toHaveBeenCalledWith({
        tenant_id: tenantId,
        esito: 'segnalato',
      })
    })

    it("NON incrementa la metrica quando non c'è alcuna divergenza", async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCED') {
          return Promise.resolve([{ id: 'fir-allineato' }])
        }
        return Promise.resolve([])
      })

      const fir = firFake({
        id: 'fir-allineato',
        rentriNumeroFir: 'NUM-1',
        rentriStatoFormulario: 'Accettato',
      })
      mockFIRRepository.findById.mockResolvedValue(fir)
      mockRentriApiClient.leggiFormulario.mockResolvedValue({ stato_formulario: 'Accettato' })

      await useCase.execute(tenantId)

      expect(mockMetrics.rentriReconciliationDivergences.inc).not.toHaveBeenCalled()
    })
  })

  describe('isolamento per FIR', () => {
    it('un errore inatteso su un candidato non blocca gli altri dello stesso lotto', async () => {
      mockPrisma.fIR.findMany.mockImplementation((args: any) => {
        if (args.where.rentriSyncStatus === 'SYNCED') {
          return Promise.resolve([{ id: 'fir-rotto' }, { id: 'fir-ok' }])
        }
        return Promise.resolve([])
      })

      mockFIRRepository.findById.mockImplementation((id: string) => {
        if (id === 'fir-rotto') {
          return Promise.reject(new Error('errore inatteso di infrastruttura'))
        }
        return Promise.resolve(
          firFake({ id, rentriNumeroFir: 'NUM-OK', rentriStatoFormulario: 'Accettato' })
        )
      })
      mockRentriApiClient.leggiFormulario.mockResolvedValue({ stato_formulario: 'Accettato' })

      const risultato = await useCase.execute(tenantId)

      expect(risultato.controllati).toBe(2)
      expect(risultato.segnalati).toBe(1) // fir-rotto
      expect(risultato.nessunaDivergenza).toBe(1) // fir-ok, comunque processato
    })
  })
})
