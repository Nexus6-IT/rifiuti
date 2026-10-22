import { FIR, FIRStato } from '../../shared/models/fir.model'
import { firCollegabileNelRegistro } from './registro-fir'

describe('firCollegabileNelRegistro', () => {
  const casi: Array<[string, Partial<FIR>, boolean]> = [
    ['emesso', { stato: FIRStato.EMESSO }, true],
    ['consegnato', { stato: FIRStato.CONSEGNATO }, true],
    ['bozza con numero RENTRI', { stato: FIRStato.BOZZA, rentriNumeroFir: 'RENTRI-1' }, true],
    ['bozza senza numero RENTRI', { stato: FIRStato.BOZZA, rentriNumeroFir: null }, false],
    [
      'annullato con numero RENTRI',
      { stato: FIRStato.ANNULLATO, rentriNumeroFir: 'RENTRI-1' },
      false,
    ],
    [
      "annullato all'ente",
      { stato: FIRStato.IN_TRANSITO, rentriStatoFormulario: 'Annullato' },
      false,
    ],
    ['stato sconosciuto', { stato: 'SCONOSCIUTO' as any }, false],
  ]
  for (const [nome, fir, atteso] of casi) {
    it(`${nome} → ${atteso}`, () => {
      expect(firCollegabileNelRegistro(fir as any)).toBe(atteso)
    })
  }
})
