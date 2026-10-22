import { FIRStatus } from '@prisma/client'
import {
  collegabilitaFir,
  etichettaFir,
  FirPerStato,
  STATI_FIR_EMESSI,
  STATI_FIR_IN_BOZZA,
  STATO_FIR_ANNULLATO,
} from './stati-fir'

const fir = (p: Partial<FirPerStato>): FirPerStato => ({
  id: 'abcdef12-3456',
  status: 'DRAFT',
  firNumber: 'FIR-2026-000007',
  rentriNumeroFir: null,
  rentriStatoFormulario: null,
  ...p,
})

describe('stati-fir', () => {
  it('emessi, bozza e annullato coprono tutto FIRStatus, senza sovrapporsi', () => {
    expect([...STATI_FIR_EMESSI, ...STATI_FIR_IN_BOZZA, STATO_FIR_ANNULLATO].sort()).toEqual(
      Object.values(FIRStatus).sort()
    )
  })

  it('un FIR emesso in locale è collegabile', () => {
    expect(collegabilitaFir(fir({ status: 'AWAITING_CARRIER' }))).toEqual({
      collegabile: true,
      base: 'EMESSO',
    })
  })

  it('un FIR in bozza locale con numero RENTRI è collegabile', () => {
    expect(collegabilitaFir(fir({ status: 'DRAFT', rentriNumeroFir: 'RENTRI-1' }))).toEqual({
      collegabile: true,
      base: 'NUMERO_RENTRI',
    })
  })

  it('una bozza senza numero RENTRI non è collegabile', () => {
    expect(collegabilitaFir(fir({ status: 'AWAITING_PRODUCER' }))).toEqual({
      collegabile: false,
      motivo: 'BOZZA',
    })
  })

  it("annullato all'ente vale come annullato", () => {
    expect(
      collegabilitaFir(fir({ status: 'AWAITING_CARRIER', rentriStatoFormulario: 'Annullato' }))
    ).toEqual({ collegabile: false, motivo: 'ANNULLATO' })
    expect(collegabilitaFir(fir({ status: 'CANCELLED', rentriNumeroFir: 'RENTRI-1' }))).toEqual({
      collegabile: false,
      motivo: 'ANNULLATO',
    })
  })

  it.each(['QUALCOSA', undefined, null])(
    'uno stato sconosciuto o assente (%p) non è collegabile',
    status => {
      expect(collegabilitaFir(fir({ status: status as any, rentriNumeroFir: 'RENTRI-1' }))).toEqual(
        { collegabile: false, motivo: 'STATO_SCONOSCIUTO' }
      )
    }
  )

  it("etichettaFir preferisce il numero RENTRI, poi il riferimento interno, poi l'id abbreviato", () => {
    expect(
      etichettaFir({ id: 'abcdef12-3456', firNumber: 'FIR-9', rentriNumeroFir: 'RENTRI-1' })
    ).toBe('RENTRI-1')
    expect(etichettaFir({ id: 'abcdef12-3456', firNumber: 'FIR-9', rentriNumeroFir: null })).toBe(
      'FIR-9'
    )
    expect(etichettaFir({ id: 'abcdef12-3456', firNumber: null })).toBe('id abcdef12')
  })
})
