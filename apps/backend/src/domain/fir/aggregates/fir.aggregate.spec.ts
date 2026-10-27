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
  FIRAnnullatoEvent,
  StatoFormulario,
  RentriStatoRiconciliato,
  ProvenienzaRifiuto,
  TipoTratta,
  ParteFIR,
  ContenutoBozzaFIR,
} from './fir.aggregate'
import { UnitaMisura } from '../value-objects/quantita'
import {
  DomainError,
  InvalidStateTransitionError,
  InvalidQuantityError,
  FIRNonLegatoRentriError,
  MetodoLocaleNonConsentitoSuFirLegatoError,
  FirNonModificabileError,
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
  describe('versione', () => {
    it('un FIR appena creato non è mai stato salvato: versione 0', () => {
      expect(FIR.create(createValidFIRProps()).versione).toBe(0)
    })

    it('registraVersioneSalvata allinea la versione', () => {
      const fir = FIR.create(createValidFIRProps())
      fir.registraVersioneSalvata(3)
      expect(fir.versione).toBe(3)
    })
  })

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

    it('should default provenienza and tipoTrattaPrincipale to null when not provided', () => {
      const fir = FIR.create(createValidFIRProps())

      expect(fir.provenienza).toBeNull()
      expect(fir.tipoTrattaPrincipale).toBeNull()
    })

    it('should capture provenienza and tipoTrattaPrincipale when provided', () => {
      const props = createValidFIRProps()
      props.provenienza = ProvenienzaRifiuto.SPECIALE
      props.tipoTrattaPrincipale = TipoTratta.FERROVIARIA

      const fir = FIR.create(props)

      expect(fir.provenienza).toBe(ProvenienzaRifiuto.SPECIALE)
      expect(fir.tipoTrattaPrincipale).toBe(TipoTratta.FERROVIARIA)
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

    const firInTransito = (): FIR => {
      const fir = FIR.create(createValidFIRProps()) // 120 kg
      fir.emetti('FIR-2025-001234', createMockFirma('Produttore'))
      fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))
      return fir
    }

    it.each([
      [150, 30, 25, true], // +25%
      [60, -60, -50, true], // -50%
      [1200, 1080, 900, true], // peso 10 volte la dichiarata
      [132, 12, 10, false], // +10% esatto: nessun avviso
      [108, -12, -10, false], // -10% esatto: nessun avviso
    ])('accetta il peso %s e calcola lo scostamento', (peso, differenza, percentuale, oltre) => {
      const fir = firInTransito()

      fir.confermaConsegna(peso, createMockFirma('Destinatario'))

      expect(fir.stato).toBe(FIRStato.CONSEGNATO)
      expect(fir.pesoEffettivo).toBe(peso)
      expect(fir.scostamentoPeso).toEqual({
        differenza,
        percentuale,
        unita: UnitaMisura.KG,
        oltreSoglia: oltre,
      })
    })

    it("scostamentoPeso è null finché non c'è il peso a destino", () => {
      expect(firInTransito().scostamentoPeso).toBeNull()
    })

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 100000000])(
      'rifiuta il peso non valido %s e lascia il FIR IN_TRANSITO',
      peso => {
        const fir = firInTransito()

        expect(() => fir.confermaConsegna(peso, createMockFirma('Destinatario'))).toThrow(
          DomainError
        )
        expect(fir.stato).toBe(FIRStato.IN_TRANSITO)
        expect(fir.pesoEffettivo).toBeNull()
      }
    )

    it('accetta il peso massimo della colonna (99.999.999,99)', () => {
      const fir = firInTransito()
      fir.confermaConsegna(99999999.99, createMockFirma('Destinatario'))
      expect(fir.stato).toBe(FIRStato.CONSEGNATO)
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

    it('conserva il motivo di annullamento su un FIR NON legato a RENTRI', () => {
      const fir = FIR.create(createValidFIRProps())

      fir.annulla('errore di pesatura')

      expect(fir.motivoAnnullamento).toBe('errore di pesatura')
      expect(fir.stato).toBe(FIRStato.ANNULLATO)
    })

    it('rifiuta un annullamento senza motivo', () => {
      const fir = FIR.create(createValidFIRProps())

      expect(() => fir.annulla('   ')).toThrow(DomainError)
      expect(fir.stato).toBe(FIRStato.BOZZA)
    })

    it("emette l'evento di dominio fir.annullato con il motivo", () => {
      const fir = FIR.create(createValidFIRProps())

      fir.annulla('errore di pesatura')

      const evento = fir.domainEvents.find(e => e instanceof FIRAnnullatoEvent) as FIRAnnullatoEvent
      expect(evento).toBeDefined()
      expect(evento.motivo).toBe('errore di pesatura')
      expect(evento.firId).toBe(fir.id)
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

    describe('avviaTentativoRentri', () => {
      it('should transition sync status to SYNCING when allowed', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        expect(fir.rentriSyncStatus.getStatus()).toBe('SYNCING')
      })

      it('should throw when the FIR cannot be synced (still in BOZZA)', () => {
        const fir = FIR.create(createValidFIRProps())
        expect(() => fir.avviaTentativoRentri(new Date())).toThrow(DomainError)
      })
    })

    describe('transazione in attesa e trasmissione incerta', () => {
      it('avviaTentativoRentri riprende un SYNCING', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date('2026-10-23T10:00:00Z'))
        const ora = new Date('2026-10-23T10:05:00Z')

        fir.avviaTentativoRentri(ora)

        expect(fir.rentriSyncStatus.getStatus()).toBe('SYNCING')
        expect(fir.rentriSyncAvviatoAt).toEqual(ora)
      })

      it('avviaTentativoRentri rifiuta un FIR legato', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-1', 'tx-1')

        expect(() => fir.avviaTentativoRentri(new Date())).toThrow(DomainError)
      })

      it('registraTransazioneInAttesa imposta attesa e transazioneId', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())

        fir.registraTransazioneInAttesa('tx-attesa')

        expect(fir.rentriTransazioneInAttesa).toBe('tx-attesa')
        expect(fir.rentriTransazioneId).toBe('tx-attesa')
      })

      it('markRENTRISynced azzera la transazione in attesa', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.registraTransazioneInAttesa('tx-attesa')

        fir.markRENTRISynced('RENTRI-NUM-2', 'tx-attesa')

        expect(fir.rentriTransazioneInAttesa).toBeNull()
      })

      it('proporreLegameRENTRI azzera la transazione in attesa', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.registraTransazioneInAttesa('tx-attesa')

        fir.proporreLegameRENTRI('RENTRI-NUM-3', 'tx-attesa')

        expect(fir.rentriTransazioneInAttesa).toBeNull()
      })

      it('chiudiTransazioneInAttesa azzera la transazione in attesa', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.registraTransazioneInAttesa('tx-attesa')

        fir.chiudiTransazioneInAttesa()

        expect(fir.rentriTransazioneInAttesa).toBeNull()
      })

      it('segnaTrasmissioneIncerta: PERMANENTLY_FAILED, codice RENTRI_TRASMISSIONE_INCERTA, transazione in attesa null', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.registraTransazioneInAttesa('tx-attesa')

        fir.segnaTrasmissioneIncerta('timeout in creazione')

        expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
        expect(fir.rentriSyncStatus.getLastErrorCode()).toBe('RENTRI_TRASMISSIONE_INCERTA')
        expect(fir.rentriTransazioneInAttesa).toBeNull()
      })

      it('riapriTrasmissioneDopoVerifica: canSyncToRENTRI torna true', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.segnaTrasmissioneIncerta('timeout in creazione')
        expect(fir.canSyncToRENTRI()).toBe(false)

        fir.riapriTrasmissioneDopoVerifica()

        expect(fir.canSyncToRENTRI()).toBe(true)
      })

      it('riapriTrasmissioneDopoVerifica rifiuta un FIR già legato', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-4', 'tx-1')

        expect(() => fir.riapriTrasmissioneDopoVerifica()).toThrow(DomainError)
      })
    })

    describe('markRENTRISynced — regola 4: registra il numero ufficiale', () => {
      it('should store the numero ufficiale (rentriNumeroFir), not only the transazioneId', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())

        fir.markRENTRISynced('RENTRI-NUM-000123', 'tx-abc-789')

        expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-000123')
        expect(fir.rentriTransazioneId).toBe('tx-abc-789')
        expect(fir.rentriNumeroFir).not.toBe(fir.rentriTransazioneId)
        expect(fir.rentriSyncStatus.getStatus()).toBe('SYNCED')
        expect(fir.rentriOrigineLegame).toBe('TRASMESSO_DA_NOI')
      })

      it('should throw if numero ufficiale is missing/empty', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())

        expect(() => fir.markRENTRISynced('')).toThrow(DomainError)
      })

      it('should work without a transazioneId (optional)', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())

        fir.markRENTRISynced('RENTRI-NUM-000999')

        expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-000999')
        expect(fir.rentriTransazioneId).toBeNull()
      })
    })

    describe('regola 2: un FIR già legato non è ritrasmissibile (anti-duplicazione)', () => {
      it('should reject a second sync attempt after a successful markRENTRISynced', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123', 'tx-1')

        expect(fir.canSyncToRENTRI()).toBe(false)
        expect(() => fir.avviaTentativoRentri(new Date())).toThrow(DomainError)
      })
    })

    describe('markRENTRISyncFailed / needsRENTRIRetry / getNextRENTRIRetryAt — regola 3: tentativi e backoff', () => {
      it('should allow retry after a first failure (attempts below the max)', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())

        fir.markRENTRISyncFailed('Errore di rete', 'RENTRI_API_ERROR')

        expect(fir.rentriSyncStatus.getStatus()).toBe('FAILED')
        expect(fir.needsRENTRIRetry()).toBe(true)
        expect(fir.canSyncToRENTRI()).toBe(true) // non ancora legato, può ritentare
      })

      it('should schedule the next retry strictly in the future using exponential backoff', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        const before = Date.now()

        fir.markRENTRISyncFailed('Errore di rete', 'RENTRI_API_ERROR')

        const nextRetryAt = fir.getNextRENTRIRetryAt()
        // Backoff conservativo (base 60s): non deve essere un ritentativo immediato,
        // altrimenti si rischia di martellare l'ente e farsi bannare con un 423.
        expect(nextRetryAt.getTime()).toBeGreaterThan(before + 30_000)
      })

      it('should stop allowing retries after exhausting the maximum number of attempts', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())

        // RENTRISyncStatus.MAX_ATTEMPTS = 5: il quinto fallimento consecutivo
        // porta a PERMANENTLY_FAILED (richiede intervento manuale).
        for (let i = 0; i < 5; i++) {
          fir.markRENTRISyncFailed('Errore persistente', 'RENTRI_API_ERROR')
        }

        expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
        expect(fir.needsRENTRIRetry()).toBe(false)
        expect(fir.canSyncToRENTRI()).toBe(false)
      })

      /**
       * Difetto R1: `needsRENTRIRetry()` guardava solo il conteggio dei
       * tentativi, non il codice dell'ultimo errore. Un 403 (credenziale non
       * valida) veniva ritentato fino a esaurimento invece di fermarsi al
       * primo colpo — esattamente il comportamento che rischia di far
       * bandire l'azienda (423) per troppe richieste non valide.
       */
      it('un errore non ritentabile (403 → RENTRI_FORBIDDEN) ferma il ciclo al primo fallimento, senza consumare tutti i tentativi', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())

        fir.markRENTRISyncFailed('Certificato non valido', 'RENTRI_FORBIDDEN')

        expect(fir.rentriSyncStatus.getStatus()).toBe('PERMANENTLY_FAILED')
        expect(fir.rentriSyncStatus.getAttempts()).toBe(1)
        expect(fir.needsRENTRIRetry()).toBe(false)
        expect(fir.canSyncToRENTRI()).toBe(false) // richiede intervento manuale
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
        fir.avviaTentativoRentri(new Date())

        fir.proporreLegameRENTRI('RENTRI-NUM-000555', 'tx-ibrida-1')

        expect(fir.rentriNumeroFirProposto).toBe('RENTRI-NUM-000555')
        expect(fir.rentriNumeroFir).toBeNull()
        expect(fir.rentriOrigineLegame).toBeNull()
        expect(fir.rentriTransazioneId).toBe('tx-ibrida-1')
      })

      it('proporreLegameRENTRI blocca nuovi tentativi automatici mentre la proposta è pendente', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())

        fir.proporreLegameRENTRI('RENTRI-NUM-000555')

        expect(fir.rentriSyncStatus.getStatus()).toBe('SYNCED')
        expect(fir.canSyncToRENTRI()).toBe(false)
      })

      it('proporreLegameRENTRI rifiuta un numero ufficiale mancante/vuoto', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())

        expect(() => fir.proporreLegameRENTRI('')).toThrow(DomainError)
      })

      it('confermaLegameRENTRI promuove la proposta al legame ufficiale (origine TRASMESSO_DA_NOI)', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
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
        fir.avviaTentativoRentri(new Date())
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

    /**
     * R2 Task 3 — i due modi (distinti) di legare un FIR interno a un
     * formulario RENTRI nato altrove:
     * - agganciaFormularioAcquisito: il FIR locale è appena stato creato da
     *   zero a partire dal dettaglio RENTRI (Task 5), su un formulario di cui
     *   si è appena acquisita la visibilità (creato da un'altra controparte).
     * - agganciaManualmente: un FIR locale preesistente (tipicamente una
     *   bozza) viene riconciliato a mano dall'operatore con un numero_fir
     *   che l'operatore riconosce essere lo stesso movimento.
     * Entrambi condividono la stessa precondizione (nessun legame già
     * presente) e la stessa forma di rifiuto.
     */
    describe('agganciaFormularioAcquisito / agganciaManualmente — aggancio a un formulario altrui', () => {
      it('agganciaFormularioAcquisito lega un FIR (anche in BOZZA) senza legame preesistente', () => {
        const fir = FIR.create(createValidFIRProps()) // ancora in BOZZA: nasce dal dettaglio RENTRI

        fir.agganciaFormularioAcquisito('RENTRI-NUM-ACQ-001')

        expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-ACQ-001')
        expect(fir.rentriOrigineLegame).toBe('ACQUISITO_DA_TERZI')
      })

      it('agganciaManualmente lega un FIR preesistente (tipicamente una bozza incompleta)', () => {
        const fir = FIR.create(createValidFIRProps())

        fir.agganciaManualmente('RENTRI-NUM-MAN-002')

        expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-MAN-002')
        expect(fir.rentriOrigineLegame).toBe('AGGANCIO_MANUALE')
      })

      it('agganciaFormularioAcquisito rifiuta un numero FIR mancante/vuoto', () => {
        const fir = FIR.create(createValidFIRProps())
        expect(() => fir.agganciaFormularioAcquisito('')).toThrow(DomainError)
      })

      it('agganciaManualmente rifiuta un numero FIR mancante/vuoto', () => {
        const fir = FIR.create(createValidFIRProps())
        expect(() => fir.agganciaManualmente('  ')).toThrow(DomainError)
      })

      it("agganciaFormularioAcquisito rifiuta un FIR già legato, citando l'origine esistente nel messaggio", () => {
        const fir = FIR.create(createValidFIRProps())
        fir.agganciaManualmente('RENTRI-NUM-GIA-LEGATO')

        expect(() => fir.agganciaFormularioAcquisito('RENTRI-NUM-ALTRO')).toThrow(
          /RENTRI-NUM-GIA-LEGATO/
        )
      })

      it("agganciaManualmente rifiuta un FIR già legato (anche da TRASMESSO_DA_NOI), citando l'origine esistente", () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-NOSTRO')

        expect(() => fir.agganciaManualmente('RENTRI-NUM-ALTRO')).toThrow(/TRASMESSO_DA_NOI/)
      })

      it('un FIR agganciato (acquisito o manuale) non è più trasmissibile a RENTRI (anti-duplicazione)', () => {
        const fir = emettiFIR()
        fir.agganciaFormularioAcquisito('RENTRI-NUM-ACQ-003')

        expect(fir.canSyncToRENTRI()).toBe(false)
      })
    })

    /**
     * Lo sgancio (rilascio-visibilità): l'operazione inversa dell'aggancio.
     * Riporta il FIR a "non legato" (rentriNumeroFir = null) SOLO se il
     * legame non è nato da una nostra trasmissione — un formulario che
     * abbiamo creato noi non si "rilascia", si annullerebbe con gli
     * endpoint del ciclo di vita (R3): confondere le due cose lascerebbe
     * pensare a un utente di poter far perdere la codifica ufficiale a un
     * documento che invece resta un formulario reale creato da questo
     * gestionale.
     */
    describe('rilasciaLegameRENTRI — lo sgancio', () => {
      it('rilascia un legame ACQUISITO_DA_TERZI: torna a rentriNumeroFir null', () => {
        const fir = FIR.create(createValidFIRProps())
        fir.agganciaFormularioAcquisito('RENTRI-NUM-ACQ-004')

        fir.rilasciaLegameRENTRI()

        expect(fir.rentriNumeroFir).toBeNull()
        expect(fir.rentriOrigineLegame).toBeNull()
      })

      it('rilascia un legame AGGANCIO_MANUALE: torna a rentriNumeroFir null', () => {
        const fir = FIR.create(createValidFIRProps())
        fir.agganciaManualmente('RENTRI-NUM-MAN-005')

        fir.rilasciaLegameRENTRI()

        expect(fir.rentriNumeroFir).toBeNull()
        expect(fir.rentriOrigineLegame).toBeNull()
      })

      it('rifiuta il rilascio di un legame TRASMESSO_DA_NOI', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-NOSTRO-006')

        expect(() => fir.rilasciaLegameRENTRI()).toThrow(DomainError)
        // Il legame non deve essere stato toccato dal tentativo rifiutato.
        expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-NOSTRO-006')
      })

      it('rifiuta il rilascio su un FIR senza alcun legame (niente da rilasciare)', () => {
        const fir = FIR.create(createValidFIRProps())
        expect(() => fir.rilasciaLegameRENTRI()).toThrow(DomainError)
      })

      it('dopo il rilascio, il FIR può essere agganciato di nuovo (nessuna traccia bloccante)', () => {
        const fir = FIR.create(createValidFIRProps())
        fir.agganciaFormularioAcquisito('RENTRI-NUM-ACQ-007')
        fir.rilasciaLegameRENTRI()

        fir.agganciaManualmente('RENTRI-NUM-MAN-008')

        expect(fir.rentriNumeroFir).toBe('RENTRI-NUM-MAN-008')
        expect(fir.rentriOrigineLegame).toBe('AGGANCIO_MANUALE')
      })
    })

    /**
     * Task 1 (R3) — riconciliazione dello stato ente. `FIRStato` (interno) e
     * `StatoFormulario` (RENTRI) sono due cicli di vita distinti: finché il
     * FIR non è legato comanda WasteFlow; da quando è legato, `applyRentriStato`
     * rispecchia l'esito dell'ente. Tabella di mappatura completa dei 21
     * valori del contratto (formulari.yaml, schema StatoFormulario).
     */
    describe('applyRentriStato — riconciliazione StatoFormulario → FIRStato', () => {
      const statiIntermedi: StatoFormulario[] = [
        'InserimentoQuantita',
        'InserimentoQuantitaTrasportoIniziale',
        'InserimentoTrasportoIniziale',
        'FirmaProduttoreTrasportatoreIniziale',
        'FirmaTrasportatoreIniziale',
        'FirmaProduttore',
        'InserimentoTrasportoSuccessivo',
        'FirmaTrasportatoreSuccessivo',
        'FirmaAnnotazione',
        'FirmaTrasbordoParziale',
        'FirmaTrasbordoTotale',
        'FirmaSostaTecnica',
        'FirmaAllegato',
        'InserimentoAccettazione',
        'FirmaAccettazione',
        'FirmaDestinatarioSuccessivo',
        'FirmaAccettazioneSuccessiva',
        'FirmaAnnullamento',
        'Indeterminato',
      ]

      it('conta esattamente 19 stati intermedi (21 totali - 2 stati finali)', () => {
        expect(statiIntermedi).toHaveLength(19)
      })

      it.each(statiIntermedi)(
        "'%s' → FIRStato.IN_TRANSITO (il FIR è in lavorazione presso l'ente)",
        statoRentri => {
          const fir = emettiFIR()
          fir.avviaTentativoRentri(new Date())
          fir.markRENTRISynced('RENTRI-NUM-000123')

          fir.applyRentriStato(statoRentri)

          expect(fir.stato).toBe(FIRStato.IN_TRANSITO)
          expect(fir.rentriStatoFormulario).toBe(statoRentri)
        }
      )

      it.each<StatoFormulario>(['Accettato', 'RespintoAccettatoParzialmente'])(
        "'%s' → FIRStato.CONSEGNATO (esito finale di accettazione)",
        statoRentri => {
          const fir = emettiFIR()
          fir.avviaTentativoRentri(new Date())
          fir.markRENTRISynced('RENTRI-NUM-000123')

          fir.applyRentriStato(statoRentri)

          expect(fir.stato).toBe(FIRStato.CONSEGNATO)
          expect(fir.rentriStatoFormulario).toBe(statoRentri)
        }
      )

      it("'Annullato' → FIRStato.ANNULLATO", () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')

        fir.applyRentriStato('Annullato')

        expect(fir.stato).toBe(FIRStato.ANNULLATO)
        expect(fir.rentriStatoFormulario).toBe('Annullato')
      })

      it('rifiuta la riconciliazione su un FIR non legato a RENTRI (rentriNumeroFir assente)', () => {
        const fir = emettiFIR()

        expect(() => fir.applyRentriStato('FirmaAnnotazione')).toThrow(FIRNonLegatoRentriError)
      })

      it('emette RentriStatoRiconciliato con il payload atteso', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')
        fir.clearDomainEvents() // pulizia eventi pregressi (emissione, sync, ecc.)

        fir.applyRentriStato('FirmaAnnotazione', 'corr-1')

        const eventi = fir
          .getDomainEvents()
          .filter((e): e is RentriStatoRiconciliato => e instanceof RentriStatoRiconciliato)
        const evento = eventi[eventi.length - 1]
        expect(evento).toBeDefined()
        expect(evento.numeroFir).toBe('RENTRI-NUM-000123')
        expect(evento.statoRentriPrecedente).toBeNull()
        expect(evento.statoRentriNuovo).toBe('FirmaAnnotazione')
        expect(evento.statoInternoRisultante).toBe(FIRStato.IN_TRANSITO)
        expect(evento.correlationId).toBe('corr-1')
      })

      it('registra sempre statoRentriPrecedente = valore precedente su una seconda riconciliazione', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')
        fir.applyRentriStato('FirmaAnnotazione')

        fir.applyRentriStato('FirmaTrasbordoParziale')

        const eventi = fir
          .getDomainEvents()
          .filter((e): e is RentriStatoRiconciliato => e instanceof RentriStatoRiconciliato)
        const ultimo = eventi[eventi.length - 1]
        expect(ultimo.statoRentriPrecedente).toBe('FirmaAnnotazione')
        expect(ultimo.statoRentriNuovo).toBe('FirmaTrasbordoParziale')
      })

      /**
       * Il nodo della regressione: una race fra polling (risposta obsoleta
       * arrivata dopo una più recente) non deve far tornare indietro
       * `FIRStato` da uno stato terminale (CONSEGNATO/ANNULLATO) a
       * IN_TRANSITO. `rentriStatoFormulario`, invece, è "l'ultimo stato noto
       * dell'ente" — non un derivato monotono — e si aggiorna comunque.
       */
      it('non fa regredire FIRStato da CONSEGNATO a IN_TRANSITO per una risposta di polling obsoleta', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')
        fir.applyRentriStato('Accettato') // FIRStato → CONSEGNATO (terminale)

        fir.applyRentriStato('FirmaAnnotazione') // race: risposta vecchia, mapperebbe a IN_TRANSITO

        expect(fir.stato).toBe(FIRStato.CONSEGNATO) // FIRStato NON regredisce
        expect(fir.rentriStatoFormulario).toBe('FirmaAnnotazione') // ma l'ultimo stato noto SI aggiorna
      })

      it('non fa regredire FIRStato da ANNULLATO a IN_TRANSITO per una risposta di polling obsoleta', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')
        fir.applyRentriStato('Annullato') // FIRStato → ANNULLATO (terminale)

        fir.applyRentriStato('InserimentoAccettazione')

        expect(fir.stato).toBe(FIRStato.ANNULLATO)
        expect(fir.rentriStatoFormulario).toBe('InserimentoAccettazione')
      })

      /**
       * Il rovescio della protezione: fra DUE stati terminali il passaggio
       * deve avvenire. `Accettato` → `Annullato` non è una risposta obsoleta,
       * è l'ente che annulla un formulario già accettato — un evento
       * legittimo. Bloccarlo lascerebbe il gestionale su CONSEGNATO mentre
       * l'ente dice Annullato: le due verità divergenti che questo disegno
       * esiste per impedire.
       */
      it('accetta il passaggio fra due stati terminali: un formulario accettato che l’ente annulla diventa ANNULLATO', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')
        fir.applyRentriStato('Accettato')
        expect(fir.stato).toBe(FIRStato.CONSEGNATO)

        fir.applyRentriStato('Annullato')

        expect(fir.stato).toBe(FIRStato.ANNULLATO)
        expect(fir.rentriStatoFormulario).toBe('Annullato')
      })

      it('accetta anche il passaggio inverso fra terminali (annullato poi accettato dall’ente)', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')
        fir.applyRentriStato('Annullato')

        fir.applyRentriStato('RespintoAccettatoParzialmente')

        expect(fir.stato).toBe(FIRStato.CONSEGNATO)
        expect(fir.rentriStatoFormulario).toBe('RespintoAccettatoParzialmente')
      })
    })

    /**
     * Task 1 (R3) — i vecchi metodi locali del ciclo di vita non hanno più
     * l'ultima parola una volta che il FIR è legato a RENTRI: da quel momento
     * comanda l'ente (v. applyRentriStato). Un click locale indipendente
     * (presaInCarico/confermaConsegna/annulla) deve essere rifiutato, non
     * ignorato silenziosamente.
     */
    describe('metodi locali bloccati su un FIR legato a RENTRI', () => {
      it('presaInCarico rifiuta un FIR legato', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')

        expect(() => fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))).toThrow(
          MetodoLocaleNonConsentitoSuFirLegatoError
        )
      })

      it('confermaConsegna rifiuta un FIR legato', () => {
        const fir = emettiFIR()
        fir.presaInCarico(new Date(), createMockFirma('Trasportatore'))
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')

        expect(() => fir.confermaConsegna(120, createMockFirma('Destinatario'))).toThrow(
          MetodoLocaleNonConsentitoSuFirLegatoError
        )
      })

      it('annulla rifiuta un FIR legato', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')

        expect(() => fir.annulla('tentativo locale')).toThrow(
          MetodoLocaleNonConsentitoSuFirLegatoError
        )
      })
    })

    /**
     * Task 5 (R3) — il testo delle note di annullamento trasmesso all'ente
     * con `POST /{numero_fir}/note-annullamento` va registrato anche da noi.
     */
    describe('registraNoteAnnullamentoRentri', () => {
      const firLegatoEAnnullato = (): FIR => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')
        fir.applyRentriStato('Annullato')
        return fir
      }

      it('registra la nota su un FIR legato e già ANNULLATO', () => {
        const fir = firLegatoEAnnullato()

        fir.registraNoteAnnullamentoRentri('errore di pesatura alla partenza')

        expect(fir.motivoAnnullamento).toBe('errore di pesatura alla partenza')
        expect(fir.stato).toBe(FIRStato.ANNULLATO)
      })

      it('rifiuta un FIR non legato a RENTRI', () => {
        const fir = emettiFIR()

        expect(() => fir.registraNoteAnnullamentoRentri('motivo')).toThrow(DomainError)
      })

      it('rifiuta un FIR legato ma non ancora ANNULLATO', () => {
        const fir = emettiFIR()
        fir.avviaTentativoRentri(new Date())
        fir.markRENTRISynced('RENTRI-NUM-000123')

        expect(() => fir.registraNoteAnnullamentoRentri('motivo')).toThrow(
          /richiedono che il FIR sia già ANNULLATO/
        )
      })

      it('rifiuta una nota vuota', () => {
        const fir = firLegatoEAnnullato()

        expect(() => fir.registraNoteAnnullamentoRentri('   ')).toThrow(/non può essere vuota/)
        expect(fir.motivoAnnullamento).toBeNull()
      })
    })
  })
  describe('modifica della bozza', () => {
    const parte = (id: string, nome = `Parte ${id}`): ParteFIR => ({
      registroId: id,
      ragioneSociale: nome,
      partitaIva: '12345678901',
      indirizzo: 'Via Roma 1',
      contatto: `${id}@pec.it`,
    })
    const firBozza = (
      extra: Partial<CreateFIRProps> = {},
      rifiutoExtra: Partial<CreateFIRProps['rifiuto']> = {}
    ): FIR =>
      FIR.create({
        ...createValidFIRProps(),
        produttoreId: 'p-1',
        trasportatoreId: 't-1',
        destinatarioId: 'd-1',
        tenantId: 'tenant-1',
        creatoDaUserId: 'user-1',
        produttore: parte('p-1'),
        trasportatore: parte('t-1'),
        destinatario: parte('d-1'),
        annotazioni: 'note',
        provenienza: ProvenienzaRifiuto.SPECIALE,
        tipoTrattaPrincipale: TipoTratta.TERRESTRE,
        ...extra,
        rifiuto: {
          ...createValidFIRProps().rifiuto,
          numeroColli: 3,
          codiceOperazione: 'R1',
          descrizione: 'Oli esausti',
          categoria: 'SPECIALE',
          tipoOperazione: 'RECOVERY',
          ...rifiutoExtra,
        },
      })
    const contenutoDi = (fir: FIR, mod: Partial<ContenutoBozzaFIR> = {}): ContenutoBozzaFIR => ({
      produttoreId: fir.produttoreId,
      trasportatoreId: fir.trasportatoreId,
      destinatarioId: fir.destinatarioId,
      produttore: fir.produttore as ParteFIR,
      trasportatore: fir.trasportatore as ParteFIR,
      destinatario: fir.destinatario as ParteFIR,
      rifiuto: {
        cerCode: fir.rifiuto.cerCode,
        quantita: fir.rifiuto.quantita.valore,
        unitaMisura: fir.rifiuto.quantita.unitaMisura,
        statoFisico: fir.rifiuto.statoFisico,
        caratteristichePericolo: fir.rifiuto.caratteristichePericolo,
        numeroColli: fir.rifiuto.numeroColli,
        codiceOperazione: fir.rifiuto.codiceOperazione,
      },
      trasportatoriAggiuntivi: fir.trasportatoriAggiuntivi,
      annotazioni: fir.annotazioni,
      provenienza: fir.provenienza as ProvenienzaRifiuto,
      tipoTrattaPrincipale: fir.tipoTrattaPrincipale as TipoTratta,
      ...mod,
    })
    const imposta = (fir: FIR, campi: Record<string, unknown>): FIR =>
      Object.assign(fir, campi) as FIR

    describe('motivoNonModificabile', () => {
      it('bozza libera: null', () => {
        expect(firBozza().motivoNonModificabile()).toBeNull()
      })
      it('legata a RENTRI, anche se firmata e non in bozza: LEGATO_RENTRI', () => {
        const fir = imposta(firBozza(), {
          _rentriNumeroFir: 'N-1',
          _firmePresenti: true,
          _stato: FIRStato.EMESSO,
          _inAttesaFirmaProduttore: true,
        })
        expect(fir.motivoNonModificabile()).toBe('LEGATO_RENTRI')
      })
      it('emessa e firmata: NON_BOZZA', () => {
        const fir = imposta(firBozza(), { _stato: FIRStato.EMESSO, _firmePresenti: true })
        expect(fir.motivoNonModificabile()).toBe('NON_BOZZA')
      })
      it.each([FIRStato.IN_TRANSITO, FIRStato.CONSEGNATO, FIRStato.ANNULLATO])(
        'stato %s: NON_BOZZA',
        stato => {
          expect(imposta(firBozza(), { _stato: stato }).motivoNonModificabile()).toBe('NON_BOZZA')
        }
      )
      it('in attesa del produttore e con firma: FIRMATO (viene prima)', () => {
        const fir = imposta(firBozza(), { _firmePresenti: true, _inAttesaFirmaProduttore: true })
        expect(fir.motivoNonModificabile()).toBe('FIRMATO')
      })
      it('solo in attesa del produttore: IN_ATTESA_FIRMA_PRODUTTORE', () => {
        const fir = imposta(firBozza(), { _inAttesaFirmaProduttore: true })
        expect(fir.motivoNonModificabile()).toBe('IN_ATTESA_FIRMA_PRODUTTORE')
      })
    })

    describe('modificaBozza', () => {
      it('FIR legato: errore del guard RENTRI, prima di ogni altro motivo', () => {
        const fir = imposta(firBozza(), { _rentriNumeroFir: 'N-1', _firmePresenti: true })
        expect(() => fir.modificaBozza(contenutoDi(fir))).toThrow(
          MetodoLocaleNonConsentitoSuFirLegatoError
        )
      })
      it.each([
        ['NON_BOZZA', { _stato: FIRStato.EMESSO, _firmePresenti: true }],
        ['FIRMATO', { _firmePresenti: true, _inAttesaFirmaProduttore: true }],
        ['IN_ATTESA_FIRMA_PRODUTTORE', { _inAttesaFirmaProduttore: true }],
      ])('motivo %s: FirNonModificabileError', (motivo, campi) => {
        const fir = imposta(firBozza(), campi)
        let errore: unknown
        try {
          fir.modificaBozza(contenutoDi(fir))
        } catch (e) {
          errore = e
        }
        expect(errore).toBeInstanceOf(FirNonModificabileError)
        expect((errore as FirNonModificabileError).motivo).toBe(motivo)
      })

      it('contenuto identico: [] e nessuna scrittura', () => {
        const fir = firBozza()
        expect(fir.modificaBozza(contenutoDi(fir))).toEqual([])
        expect(fir.tratteModificate).toBe(false)
      })

      it('restituisce i nomi dei campi cambiati e li scrive', () => {
        const fir = firBozza()
        const base = contenutoDi(fir)
        const campi = fir.modificaBozza({
          ...base,
          rifiuto: {
            ...base.rifiuto,
            cerCode: '20 01 21*',
            quantita: 200,
            unitaMisura: UnitaMisura.TONNELLATE,
            statoFisico: 'Solido',
            caratteristichePericolo: 'HP3',
            numeroColli: 5,
            codiceOperazione: 'R3',
          },
          annotazioni: 'altre note',
          provenienza: ProvenienzaRifiuto.URBANO,
          tipoTrattaPrincipale: TipoTratta.FERROVIARIA,
        })
        expect(campi).toEqual([
          'cerCode',
          'quantita',
          'unitaMisura',
          'statoFisico',
          'caratteristichePericolo',
          'numeroColli',
          'codiceOperazione',
          'annotazioni',
          'provenienza',
          'tipoTrattaPrincipale',
        ])
        expect(fir.rifiuto.cerCode).toBe('20 01 21*')
        expect(fir.rifiuto.quantita.valore).toBe(200)
        expect(fir.rifiuto.quantita.unitaMisura).toBe(UnitaMisura.TONNELLATE)
        expect(fir.annotazioni).toBe('altre note')
        expect(fir.provenienza).toBe(ProvenienzaRifiuto.URBANO)
        expect(fir.tipoTrattaPrincipale).toBe(TipoTratta.FERROVIARIA)
      })

      it('stringa vuota, null e undefined dei facoltativi sono equivalenti: nessun cambiamento', () => {
        const fir = firBozza(
          { annotazioni: undefined },
          {
            statoFisico: undefined,
            caratteristichePericolo: undefined,
            numeroColli: undefined,
            codiceOperazione: undefined,
          }
        )
        const base = contenutoDi(fir)
        expect(
          fir.modificaBozza({
            ...base,
            annotazioni: '',
            rifiuto: {
              ...base.rifiuto,
              statoFisico: '',
              caratteristichePericolo: null,
              numeroColli: null,
              codiceOperazione: '',
            },
          })
        ).toEqual([])
      })

      it('svuotare annotazioni, HP e colli è un cambiamento e riporta i campi a vuoto', () => {
        const fir = firBozza({}, { caratteristichePericolo: 'HP14' })
        const base = contenutoDi(fir)
        const campi = fir.modificaBozza({
          ...base,
          annotazioni: '',
          rifiuto: { ...base.rifiuto, caratteristichePericolo: '', numeroColli: undefined },
        })
        expect(campi).toEqual(['caratteristichePericolo', 'numeroColli', 'annotazioni'])
        expect(fir.annotazioni).toBeNull()
        expect(fir.rifiuto.caratteristichePericolo).toBeUndefined()
        expect(fir.rifiuto.numeroColli).toBeUndefined()
      })

      it('quantità <= 0: errore di dominio e nessun campo cambiato', () => {
        const fir = firBozza()
        const base = contenutoDi(fir)
        expect(() =>
          fir.modificaBozza({
            ...base,
            annotazioni: 'x',
            rifiuto: { ...base.rifiuto, quantita: 0 },
          })
        ).toThrow(InvalidQuantityError)
        expect(fir.annotazioni).toBe('note')
        expect(fir.rifiuto.quantita.valore).toBe(120)
      })

      it('quantità non numerica: errore di dominio', () => {
        const fir = firBozza()
        const base = contenutoDi(fir)
        expect(() =>
          fir.modificaBozza({ ...base, rifiuto: { ...base.rifiuto, quantita: NaN } })
        ).toThrow(DomainError)
      })

      it('cambio di parte: id e snapshot sostituiti, solo quella parte segnalata', () => {
        const fir = firBozza()
        const campi = fir.modificaBozza(
          contenutoDi(fir, { destinatarioId: 'd-2', destinatario: parte('d-2') })
        )
        expect(campi).toEqual(['destinatario'])
        expect(fir.destinatarioId).toBe('d-2')
        expect(fir.destinatario?.registroId).toBe('d-2')
        expect(fir.produttore?.registroId).toBe('p-1')
      })

      it('stesso id ma snapshot diverso è un cambiamento della parte', () => {
        const fir = firBozza()
        expect(
          fir.modificaBozza(contenutoDi(fir, { produttore: parte('p-1', 'Nuovo nome') }))
        ).toEqual(['produttore'])
      })

      it('tratte: elenco identico lascia le righe esistenti, elenco diverso le sostituisce', () => {
        const tratta = {
          ordine: 1,
          tipoTratta: TipoTratta.TERRESTRE,
          trasportatoreId: 'ta-1',
          denominazione: 'A',
          mezzo: 'AB123CD',
        }
        const fir = firBozza({ trasportatoriAggiuntivi: [tratta] })
        // stessa chiave (trasportatoreId, tipo, ordine) ma denominazione diversa: invariato
        expect(
          fir.modificaBozza(
            contenutoDi(fir, {
              trasportatoriAggiuntivi: [{ ...tratta, denominazione: 'B', mezzo: undefined }],
            })
          )
        ).toEqual([])
        expect(fir.tratteModificate).toBe(false)
        expect(fir.trasportatoriAggiuntivi[0].mezzo).toBe('AB123CD')

        const nuove = [{ ...tratta, trasportatoreId: 'ta-2', denominazione: 'C', mezzo: undefined }]
        expect(fir.modificaBozza(contenutoDi(fir, { trasportatoriAggiuntivi: nuove }))).toEqual([
          'trasportatoriAggiuntivi',
        ])
        expect(fir.tratteModificate).toBe(true)
        expect(fir.trasportatoriAggiuntivi).toEqual(nuove)
        // la chiamata seguente senza cambiamenti azzera il segnale
        fir.modificaBozza(contenutoDi(fir))
        expect(fir.tratteModificate).toBe(false)
      })

      it('conserva descrizione, categoria e tipoOperazione del rifiuto', () => {
        const fir = firBozza()
        const base = contenutoDi(fir)
        fir.modificaBozza({
          ...base,
          rifiuto: { ...base.rifiuto, cerCode: '20 01 21*', quantita: 5 },
        })
        expect(fir.rifiuto.descrizione).toBe('Oli esausti')
        expect(fir.rifiuto.categoria).toBe('SPECIALE')
        expect(fir.rifiuto.tipoOperazione).toBe('RECOVERY')
      })

      it('non tocca stato, numero, firme, campi RENTRI, tenant, creatore, id, data di creazione', () => {
        const fir = firBozza()
        const foto = (): object => ({
          id: fir.id,
          stato: fir.stato,
          numero: fir.numeroProgressivo,
          firme: fir.firme,
          rentri: fir.rentriNumeroFir,
          sync: fir.rentriSyncStatus,
          tenant: fir.tenantId,
          creatore: fir.creatoDaUserId,
          creato: fir.createdAt,
          versione: fir.versione,
        })
        const prima = foto()
        const base = contenutoDi(fir)
        fir.modificaBozza({
          ...base,
          rifiuto: { ...base.rifiuto, quantita: 999 },
          annotazioni: 'z',
        })
        expect(foto()).toEqual(prima)
      })
    })
  })
})
