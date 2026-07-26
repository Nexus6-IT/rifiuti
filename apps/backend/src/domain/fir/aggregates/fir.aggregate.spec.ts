/**
 * FIR Aggregate - TDD Tests
 * Complete coverage of business rules and state transitions
 */

import {
  FIR,
  FIRStato,
  CreateFIRProps,
  FirmaDigitale,
  FIREmessoEvent,
  FIRPresaInCaricoEvent,
  FIRConsegnatoEvent,
} from './fir.aggregate'
import { UnitaMisura } from '../value-objects/quantita'
import {
  DomainError,
  InvalidStateTransitionError,
  InvalidQuantityError,
} from '../../../core/domain/errors'

// Test Fixtures
const createValidFIRProps = (): CreateFIRProps => ({
  produttoreId: 'tenant-producer-123',
  rifiuto: {
    cerCode: '13 02 05*',
    quantita: 120,
    unitaMisura: UnitaMisura.KG,
    statoFisico: 'Liquido',
    caratteristichePericolo: 'HP14',
  },
  trasportatoreId: 'tenant-transporter-456',
  destinatarioId: 'tenant-destination-789',
})

const createMockFirma = (firmatario: string): FirmaDigitale => ({
  firmatario,
  timestamp: new Date(),
  certificato: 'mock-certificate-' + firmatario,
})

describe('FIR Aggregate', () => {
  describe('create', () => {
    it('should create FIR in BOZZA state', () => {
      const fir = FIR.create(createValidFIRProps())

      expect(fir.id).toBeDefined()
      expect(fir.stato).toBe(FIRStato.BOZZA)
      expect(fir.numeroProgressivo).toBeNull()
      expect(fir.produttoreId).toBe('tenant-producer-123')
      expect(fir.trasportatoreId).toBe('tenant-transporter-456')
      expect(fir.destinatarioId).toBe('tenant-destination-789')
    })

    it('should create FIR with rifiuto details', () => {
      const fir = FIR.create(createValidFIRProps())

      expect(fir.rifiuto.cerCode).toBe('13 02 05*')
      expect(fir.rifiuto.quantita.valore).toBe(120)
      expect(fir.rifiuto.quantita.unitaMisura).toBe(UnitaMisura.KG)
      expect(fir.rifiuto.statoFisico).toBe('Liquido')
      expect(fir.rifiuto.caratteristichePericolo).toBe('HP14')
    })

    it('should throw error for invalid quantita', () => {
      const props = createValidFIRProps()
      props.rifiuto.quantita = -50

      expect(() => FIR.create(props)).toThrow(InvalidQuantityError)
    })

    it('should default to KG if unitaMisura not specified', () => {
      const props = createValidFIRProps()
      delete props.rifiuto.unitaMisura

      const fir = FIR.create(props)

      expect(fir.rifiuto.quantita.unitaMisura).toBe(UnitaMisura.KG)
    })

    it('should initialize with empty firme', () => {
      const fir = FIR.create(createValidFIRProps())

      expect(fir.firme.produttore).toBeUndefined()
      expect(fir.firme.trasportatore).toBeUndefined()
      expect(fir.firme.destinatario).toBeUndefined()
    })
  })

  describe('emetti', () => {
    it('should transition from BOZZA to EMESSO with firma', () => {
      const fir = FIR.create(createValidFIRProps())
      const firma = createMockFirma('Mario Rossi')

      fir.emetti('FIR-2025-001234', firma)

      expect(fir.stato).toBe(FIRStato.EMESSO)
      expect(fir.numeroProgressivo).toBe('FIR-2025-001234')
      expect(fir.firme.produttore).toEqual(firma)
    })

    it('should emit FIREmessoEvent', () => {
      const fir = FIR.create(createValidFIRProps())
      const firma = createMockFirma('Mario Rossi')

      fir.emetti('FIR-2025-001234', firma)

      const events = fir.domainEvents
      expect(events.length).toBe(1)
      expect(events[0]).toBeInstanceOf(FIREmessoEvent)
      expect((events[0] as FIREmessoEvent).firId).toBe(fir.id)
      expect((events[0] as FIREmessoEvent).numeroProgressivo).toBe('FIR-2025-001234')
    })

    it('should throw error if not in BOZZA state', () => {
      const fir = FIR.create(createValidFIRProps())
      const firma = createMockFirma('Mario Rossi')
      fir.emetti('FIR-2025-001234', firma)

      // Try to emit again
      expect(() => fir.emetti('FIR-2025-001235', firma)).toThrow(InvalidStateTransitionError)
    })

    it('should throw error if firma produttore not provided', () => {
      const fir = FIR.create(createValidFIRProps())

      expect(() => fir.emetti('FIR-2025-001234', null as any)).toThrow(DomainError)
    })
  })

  describe('presaInCarico', () => {
    it('should transition from EMESSO to IN_TRANSITO', () => {
      const fir = FIR.create(createValidFIRProps())
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))

      const dataPresaCarico = new Date('2025-10-13T10:00:00Z')
      const firmaTrasportatore = createMockFirma('Trasportatore')

      fir.presaInCarico(dataPresaCarico, firmaTrasportatore)

      expect(fir.stato).toBe(FIRStato.IN_TRANSITO)
      expect(fir.dataPresaCarico).toEqual(dataPresaCarico)
      expect(fir.firme.trasportatore).toEqual(firmaTrasportatore)
    })

    it('should emit FIRPresaInCaricoEvent', () => {
      const fir = FIR.create(createValidFIRProps())
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.clearDomainEvents() // Clear previous events

      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))

      const events = fir.domainEvents
      expect(events.length).toBe(1)
      expect(events[0]).toBeInstanceOf(FIRPresaInCaricoEvent)
    })

    it('should throw error if not in EMESSO state', () => {
      const fir = FIR.create(createValidFIRProps())

      expect(() => fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))).toThrow(
        InvalidStateTransitionError
      )
    })
  })

  describe('confermaConsegna', () => {
    it('should transition from IN_TRANSITO to CONSEGNATO with peso within tolerance', () => {
      const fir = FIR.create(createValidFIRProps()) // 120 kg
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))
      fir.clearDomainEvents()

      const firmaDestinatario = createMockFirma('Destinatario')
      fir.confermaConsegna(130, firmaDestinatario) // +8.3% within tolerance

      expect(fir.stato).toBe(FIRStato.CONSEGNATO)
      expect(fir.pesoEffettivo).toBe(130)
      expect(fir.dataConsegna).toBeInstanceOf(Date)
      expect(fir.firme.destinatario).toEqual(firmaDestinatario)
    })

    it('should emit FIRConsegnatoEvent', () => {
      const fir = FIR.create(createValidFIRProps())
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))
      fir.clearDomainEvents()

      fir.confermaConsegna(120, createMockFirma('Destinatario'))

      const events = fir.domainEvents
      expect(events.length).toBe(1)
      expect(events[0]).toBeInstanceOf(FIRConsegnatoEvent)
      expect((events[0] as FIRConsegnatoEvent).pesoEffettivo).toBe(120)
    })

    it('should accept peso at +10% tolerance boundary', () => {
      const fir = FIR.create(createValidFIRProps()) // 120 kg
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))

      fir.confermaConsegna(132, createMockFirma('Destinatario')) // Exactly +10%

      expect(fir.stato).toBe(FIRStato.CONSEGNATO)
    })

    it('should accept peso at -10% tolerance boundary', () => {
      const fir = FIR.create(createValidFIRProps()) // 120 kg
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))

      fir.confermaConsegna(108, createMockFirma('Destinatario')) // Exactly -10%

      expect(fir.stato).toBe(FIRStato.CONSEGNATO)
    })

    it('should throw error if peso exceeds +10% tolerance', () => {
      const fir = FIR.create(createValidFIRProps()) // 120 kg
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))

      expect(
        () => fir.confermaConsegna(135, createMockFirma('Destinatario')) // +12.5%
      ).toThrow(DomainError)
      expect(() => fir.confermaConsegna(135, createMockFirma('Destinatario'))).toThrow(
        /eccede tolleranza/
      )
    })

    it('should throw error if peso exceeds -10% tolerance', () => {
      const fir = FIR.create(createValidFIRProps()) // 120 kg
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))

      expect(
        () => fir.confermaConsegna(105, createMockFirma('Destinatario')) // -12.5%
      ).toThrow(DomainError)
    })

    it('should throw error if not in IN_TRANSITO state', () => {
      const fir = FIR.create(createValidFIRProps())
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))

      expect(() => fir.confermaConsegna(120, createMockFirma('Destinatario'))).toThrow(
        InvalidStateTransitionError
      )
    })
  })

  describe('annulla', () => {
    it('should annul FIR from BOZZA state', () => {
      const fir = FIR.create(createValidFIRProps())

      fir.annulla('Errore inserimento dati')

      expect(fir.stato).toBe(FIRStato.ANNULLATO)
    })

    it('should annul FIR from EMESSO state', () => {
      const fir = FIR.create(createValidFIRProps())
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))

      fir.annulla('Annullamento richiesto da cliente')

      expect(fir.stato).toBe(FIRStato.ANNULLATO)
    })

    it('should annul FIR from IN_TRANSITO state', () => {
      const fir = FIR.create(createValidFIRProps())
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))

      fir.annulla('Trasporto annullato')

      expect(fir.stato).toBe(FIRStato.ANNULLATO)
    })

    it('should throw error when trying to annul completed FIR', () => {
      const fir = FIR.create(createValidFIRProps())
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))
      fir.confermaConsegna(120, createMockFirma('Destinatario'))

      expect(() => fir.annulla('Tentativo annullamento')).toThrow(DomainError)
      expect(() => fir.annulla('Tentativo annullamento')).toThrow(/Cannot annull a completed FIR/)
    })
  })

  describe('Complete workflow', () => {
    it('should follow complete FIR lifecycle: BOZZA → EMESSO → IN_TRANSITO → CONSEGNATO', () => {
      // 1. Create FIR
      const fir = FIR.create(createValidFIRProps())
      expect(fir.stato).toBe(FIRStato.BOZZA)

      // 2. Emit FIR (producer signs)
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      expect(fir.stato).toBe(FIRStato.EMESSO)
      expect(fir.numeroProgressivo).toBe('FIR-2025-001234')

      // 3. Transporter takes charge
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))
      expect(fir.stato).toBe(FIRStato.IN_TRANSITO)

      // 4. Destination confirms delivery
      fir.confermaConsegna(118, createMockFirma('Destinatario')) // -1.7% variance
      expect(fir.stato).toBe(FIRStato.CONSEGNATO)
      expect(fir.pesoEffettivo).toBe(118)

      // 5. Verify all signatures present
      expect(fir.firme.produttore).toBeDefined()
      expect(fir.firme.trasportatore).toBeDefined()
      expect(fir.firme.destinatario).toBeDefined()
    })

    it('should track all domain events throughout lifecycle', () => {
      const fir = FIR.create(createValidFIRProps())

      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))
      fir.confermaConsegna(120, createMockFirma('Destinatario'))

      const events = fir.domainEvents
      expect(events.length).toBe(3)
      expect(events[0]).toBeInstanceOf(FIREmessoEvent)
      expect(events[1]).toBeInstanceOf(FIRPresaInCaricoEvent)
      expect(events[2]).toBeInstanceOf(FIRConsegnatoEvent)
    })
  })

  describe('RENTRI sync', () => {
    const emettiFIR = (): FIR => {
      const fir = FIR.create(createValidFIRProps())
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      return fir
    }

    describe('canSyncToRENTRI — regola 1: solo un FIR emesso è trasmissibile', () => {
      it('should reject a FIR still in BOZZA', () => {
        const fir = FIR.create(createValidFIRProps())
        expect(fir.canSyncToRENTRI()).toBe(false)
      })

      it('should allow a FIR in EMESSO', () => {
        const fir = emettiFIR()
        expect(fir.canSyncToRENTRI()).toBe(true)
      })

      it('should allow a FIR in IN_TRANSITO', () => {
        const fir = emettiFIR()
        fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))
        expect(fir.canSyncToRENTRI()).toBe(true)
      })

      it('should allow a FIR in CONSEGNATO', () => {
        const fir = emettiFIR()
        fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))
        fir.confermaConsegna(120, createMockFirma('Destinatario'))
        expect(fir.canSyncToRENTRI()).toBe(true)
      })

      it('should reject a FIR that has been annullato', () => {
        const fir = emettiFIR()
        fir.annulla('errore di compilazione')
        expect(fir.canSyncToRENTRI()).toBe(false)
      })
    })

    describe('startRENTRISync', () => {
      it('should transition sync status to SYNCING when allowed', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()
        expect(fir.rentriSyncStatus.getStatus()).toBe('SYNCING')
      })

      it('should throw when the FIR cannot be synced (still in BOZZA)', () => {
        const fir = FIR.create(createValidFIRProps())
        expect(() => fir.startRENTRISync()).toThrow(DomainError)
      })
    })

    describe('markRENTRISynced — regola 4: registra il numero ufficiale', () => {
      it('should store the numero ufficiale (rentriNumeroFir), not only the transazioneId', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()

        fir.markRENTRISynced('RENTRI-NUM-000123', 'tx-abc-789')

        expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-000123')
        expect(fir.rentriTransazioneId).toBe('tx-abc-789')
        expect(fir.rentriNumeroFir).not.toBe(fir.rentriTransazioneId)
        expect(fir.rentriSyncStatus.getStatus()).toBe('SYNCED')
        expect(fir.rentriOrigineLegame).toBe('TRASMESSO_DA_NOI')
      })

      it('should throw if numero ufficiale is missing/empty', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()

        expect(() => fir.markRENTRISynced('')).toThrow(DomainError)
      })

      it('should work without a transazioneId (optional)', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()

        fir.markRENTRISynced('RENTRI-NUM-000999')

        expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-000999')
        expect(fir.rentriTransazioneId).toBeNull()
      })
    })

    describe('regola 2: un FIR già legato non è ritrasmissibile (anti-duplicazione)', () => {
      it('should reject a second sync attempt after a successful markRENTRISynced', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()
        fir.markRENTRISynced('RENTRI-NUM-000123', 'tx-1')

        expect(fir.canSyncToRENTRI()).toBe(false)
        expect(() => fir.startRENTRISync()).toThrow(DomainError)
      })
    })

    describe('markRENTRISyncFailed / needsRENTRIRetry / getNextRENTRIRetryAt — regola 3: tentativi e backoff', () => {
      it('should allow retry after a first failure (attempts below the max)', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()

        fir.markRENTRISyncFailed('Errore di rete', 'RENTRI_API_ERROR')

        expect(fir.rentriSyncStatus.getStatus()).toBe('FAILED')
        expect(fir.needsRENTRIRetry()).toBe(true)
        expect(fir.canSyncToRENTRI()).toBe(true) // non ancora legato, può ritentare
      })

      it('should schedule the next retry strictly in the future using exponential backoff', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()
        const before = Date.now()

        fir.markRENTRISyncFailed('Errore di rete', 'RENTRI_API_ERROR')

        const nextRetryAt = fir.getNextRENTRIRetryAt()
        // Backoff conservativo (base 60s): non deve essere un ritentativo immediato,
        // altrimenti si rischia di martellare l'ente e farsi bannare con un 423.
        expect(nextRetryAt.getTime()).toBeGreaterThan(before + 30_000)
      })

      it('should stop allowing retries after exhausting the maximum number of attempts', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()

        // RENTRISyncStatus.MAX_ATTEMPTS = 5: il quinto fallimento consecutivo
        // porta a PERMANENTLY_FAILED (richiede intervento manuale).
        for (let i = 0; i < 5; i++) {
          fir.markRENTRISyncFailed('Errore persistente', 'RENTRI_API_ERROR')
        }

        expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
        expect(fir.needsRENTRIRetry()).toBe(false)
        expect(fir.canSyncToRENTRI()).toBe(false)
      })
    })

    /**
     * R1 Task 2 — modalità IBRIDA: la trasmissione parte da sola, ma il
     * legame ufficiale richiede una conferma esplicita dell'utente. Lo stato
     * intermedio ("in attesa di conferma") è rappresentato da
     * `rentriNumeroFirProposto`, distinto da `rentriNumeroFir`: finché è
     * valorizzato il FIR NON è legato a tutti gli effetti.
     */
    describe('proporreLegameRENTRI / confermaLegameRENTRI / rifiutaLegameRENTRI — modalità IBRIDA', () => {
      it('proporreLegameRENTRI registra il numero proposto senza legare ancora il FIR', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()

        fir.proporreLegameRENTRI('RENTRI-NUM-000555', 'tx-ibrida-1')

        expect(fir.rentriNumeroFirProposto).toBe('RENTRI-NUM-000555')
        expect(fir.rentriNumeroFir).toBeNull()
        expect(fir.rentriOrigineLegame).toBeNull()
        expect(fir.rentriTransazioneId).toBe('tx-ibrida-1')
      })

      it('proporreLegameRENTRI blocca nuovi tentativi automatici mentre la proposta è pendente', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()

        fir.proporreLegameRENTRI('RENTRI-NUM-000555')

        expect(fir.rentriSyncStatus.getStatus()).toBe('SYNCED')
        expect(fir.canSyncToRENTRI()).toBe(false)
      })

      it('proporreLegameRENTRI rifiuta un numero ufficiale mancante/vuoto', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()

        expect(() => fir.proporreLegameRENTRI('')).toThrow(DomainError)
      })

      it('confermaLegameRENTRI promuove la proposta al legame ufficiale (origine TRASMESSO_DA_NOI)', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()
        fir.proporreLegameRENTRI('RENTRI-NUM-000555', 'tx-ibrida-1')

        fir.confermaLegameRENTRI()

        expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-000555')
        expect(fir.rentriOrigineLegame).toBe('TRASMESSO_DA_NOI')
        expect(fir.rentriNumeroFirProposto).toBeNull()
      })

      it('confermaLegameRENTRI senza una proposta pendente lancia un errore', () => {
        const fir = emettiFIR()
        expect(() => fir.confermaLegameRENTRI()).toThrow(DomainError)
      })

      it('rifiutaLegameRENTRI cancella la proposta e riporta il FIR a PENDING (ritrasmissibile)', () => {
        const fir = emettiFIR()
        fir.startRENTRISync()
        fir.proporreLegameRENTRI('RENTRI-NUM-000555')

        fir.rifiutaLegameRENTRI()

        expect(fir.rentriNumeroFirProposto).toBeNull()
        expect(fir.rentriNumeroFir).toBeNull()
        expect(fir.rentriSyncStatus.getStatus()).toBe('PENDING')
        expect(fir.canSyncToRENTRI()).toBe(true)
      })

      it('rifiutaLegameRENTRI senza una proposta pendente lancia un errore', () => {
        const fir = emettiFIR()
        expect(() => fir.rifiutaLegameRENTRI()).toThrow(DomainError)
      })
    })
  })
})
