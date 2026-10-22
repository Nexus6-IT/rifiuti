/**
 * FIRResponseDto - TDD per l'esposizione dello stato RENTRI (R1 Task 3)
 *
 * Finché questi campi non compaiono nel DTO, il frontend non ha modo di
 * mostrare lo stato RENTRI nella lista dei formulari: la view-model del
 * dominio (FIR aggregate) esiste già, ma non attraversa il confine HTTP.
 */
import { FIRResponseDto } from './fir-response.dto'
import {
  FIR,
  FirmaDigitale,
  RentriOrigineLegame,
} from '../../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'

const createValidFIRProps = () => ({
  produttoreId: 'tenant-producer-123',
  rifiuto: {
    cerCode: '13 02 05*',
    quantita: 120,
    unitaMisura: UnitaMisura.KG,
  },
  trasportatoreId: 'tenant-transporter-456',
  destinatarioId: 'tenant-destination-789',
})

const createMockFirma = (firmatario: string): FirmaDigitale => ({
  firmatario,
  timestamp: new Date(),
  certificato: 'mock-certificate-' + firmatario,
})

describe('FIRResponseDto.fromDomain — stato RENTRI', () => {
  it('espone lo stato PENDING e canSyncToRENTRI=false per un FIR in BOZZA', () => {
    const fir = FIR.create(createValidFIRProps())

    const dto = FIRResponseDto.fromDomain(fir)

    expect(dto.rentriSyncStatus).toBe('PENDING')
    expect(dto.rentriNumeroFir).toBeNull()
    expect(dto.rentriNumeroFirProposto).toBeNull()
    expect(dto.rentriOrigineLegame).toBeNull()
    expect(dto.rentriLastSyncError).toBeNull()
    // BOZZA non è trasmissibile: la lista non deve proporre l'azione.
    expect(dto.canSyncToRENTRI).toBe(false)
  })

  it('espone canSyncToRENTRI=true per un FIR emesso non ancora legato', () => {
    const fir = FIR.create(createValidFIRProps())
    fir.emetti('FIR-2026-000001', createMockFirma('Produttore SRL'))

    const dto = FIRResponseDto.fromDomain(fir)

    expect(dto.rentriSyncStatus).toBe('PENDING')
    expect(dto.canSyncToRENTRI).toBe(true)
  })

  it('espone il numero ufficiale dopo la sincronizzazione riuscita', () => {
    const fir = FIR.create(createValidFIRProps())
    fir.emetti('FIR-2026-000002', createMockFirma('Produttore SRL'))
    fir.startRENTRISync()
    fir.markRENTRISynced('RENTRI-999')

    const dto = FIRResponseDto.fromDomain(fir)

    expect(dto.rentriSyncStatus).toBe('SYNCED')
    expect(dto.rentriNumeroFir).toBe('RENTRI-999')
    expect(dto.rentriOrigineLegame).toBe(RentriOrigineLegame.TRASMESSO_DA_NOI)
    expect(dto.rentriNumeroFirProposto).toBeNull()
    // Già legato: non ritrasmissibile.
    expect(dto.canSyncToRENTRI).toBe(false)
  })

  it('distingue il legame proposto (modalità ibrida) dal numero ufficiale', () => {
    const fir = FIR.create(createValidFIRProps())
    fir.emetti('FIR-2026-000003', createMockFirma('Produttore SRL'))
    fir.startRENTRISync()
    fir.proporreLegameRENTRI('RENTRI-PROPOSTO-1')

    const dto = FIRResponseDto.fromDomain(fir)

    // Una proposta NON è un legame ufficiale: rentriNumeroFir resta null.
    expect(dto.rentriNumeroFir).toBeNull()
    expect(dto.rentriNumeroFirProposto).toBe('RENTRI-PROPOSTO-1')
  })

  it("espone l'ultimo errore e resta trasmissibile dopo un fallimento con tentativi residui", () => {
    const fir = FIR.create(createValidFIRProps())
    fir.emetti('FIR-2026-000004', createMockFirma('Produttore SRL'))
    fir.startRENTRISync()
    fir.markRENTRISyncFailed('Timeout verso RENTRI')

    const dto = FIRResponseDto.fromDomain(fir)

    expect(dto.rentriSyncStatus).toBe('FAILED')
    expect(dto.rentriLastSyncError).toBe('Timeout verso RENTRI')
    expect(dto.rentriSyncAttempts).toBe(1)
    expect(dto.canSyncToRENTRI).toBe(true)
  })
})

describe('FIRResponseDto.fromDomain — data di presa in carico effettiva', () => {
  it('dataPresaCaricoEffettiva è nulla senza la firma del trasportatore', () => {
    const fir = FIR.create(createValidFIRProps())
    fir.emetti('FIR-2026-000005', createMockFirma('Produttore SRL'))
    // Come fa il repository: emesso, mai preso in carico, ma `transport_date` contiene il
    // ripiego `new Date()` del primo salvataggio.
    Object.assign(fir, { _dataPresaCarico: new Date('2026-01-08T10:00:00Z') })

    const dto = FIRResponseDto.fromDomain(fir)

    expect(dto.dataPresaCaricoEffettiva).toBeNull()
    expect(dto.dataPresaCarico).toEqual(new Date('2026-01-08T10:00:00Z'))
  })

  it('dataPresaCaricoEffettiva è la data della presa in carico registrata in WasteFlow', () => {
    const fir = FIR.create(createValidFIRProps())
    fir.emetti('FIR-2026-000006', createMockFirma('Produttore SRL'))
    fir.presaInCarico(new Date('2025-12-28T09:00:00Z'), createMockFirma('TRASPORTATORE'))

    expect(FIRResponseDto.fromDomain(fir).dataPresaCaricoEffettiva).toEqual(
      new Date('2025-12-28T09:00:00Z')
    )
  })
})
