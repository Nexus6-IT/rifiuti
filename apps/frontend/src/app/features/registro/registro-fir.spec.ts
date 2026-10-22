import { FIR, FIRStato } from '../../shared/models/fir.model'
import {
  causalePredefinitaDaFir,
  dataOperazioneDaFir,
  firCollegabileNelRegistro,
  quantitaDaFir,
  SUGGERIMENTO_SENZA_ARRIVO,
  SUGGERIMENTO_SENZA_PRESA_IN_CARICO,
} from './registro-fir'

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

describe('dataOperazioneDaFir', () => {
  it('lo scarico usa la presa in carico registrata in WasteFlow', () => {
    expect(
      dataOperazioneDaFir(
        { dataPresaCaricoEffettiva: '2025-12-28T09:00:00.000Z', dataConsegna: null },
        'SCARICO'
      )
    ).toEqual({ data: new Date('2025-12-28T09:00:00.000Z'), suggerimento: null })
  })

  it('senza presa in carico registrata nessuna data', () => {
    // FIR EMESSO mai preso in carico, o acquisito da RENTRI: dataPresaCarico c'è (ripiego) ma non conta
    const fir: Partial<FIR> = {
      stato: FIRStato.EMESSO,
      dataPresaCarico: '2026-01-08T10:00:00.000Z',
      dataPresaCaricoEffettiva: null,
      dataConsegna: null,
    }
    expect(dataOperazioneDaFir(fir, 'SCARICO')).toEqual({
      data: null,
      suggerimento: SUGGERIMENTO_SENZA_PRESA_IN_CARICO,
    })
  })

  it('il carico usa la data di arrivo', () => {
    expect(
      dataOperazioneDaFir(
        {
          dataPresaCaricoEffettiva: '2025-12-30T08:00:00.000Z',
          dataConsegna: '2026-01-02T15:00:00.000Z',
        },
        'CARICO'
      )
    ).toEqual({ data: new Date('2026-01-02T15:00:00.000Z'), suggerimento: null })
    expect(
      dataOperazioneDaFir(
        { dataPresaCaricoEffettiva: '2025-12-30T08:00:00.000Z', dataConsegna: null },
        'CARICO'
      )
    ).toEqual({ data: null, suggerimento: SUGGERIMENTO_SENZA_ARRIVO })
  })
})

describe('causalePredefinitaDaFir', () => {
  it('nessuna causale se il ruolo non si riconosce', () => {
    expect(causalePredefinitaDaFir('CARICO', null)).toBeNull()
    expect(causalePredefinitaDaFir('SCARICO', null)).toBeNull()
    expect(causalePredefinitaDaFir('SCARICO', 'PRODUTTORE')).toBe('CONFERIMENTO_TRASPORTATORE')
    expect(causalePredefinitaDaFir('CARICO', 'DESTINATARIO')).toBe('INGRESSO_ESTERNO')
  })
})

describe('quantitaDaFir', () => {
  const fir = (pesoEffettivo: number | null) =>
    ({
      rifiuto: { cerCode: '150101', quantita: 1234.5, unitaMisura: 'kg' },
      pesoEffettivo,
    }) as FIR

  it('CARICO del destinatario con peso verificato usa il peso a destino', () => {
    expect(quantitaDaFir(fir(1200), 'CARICO', 'DESTINATARIO')).toEqual({
      quantita: 1200,
      unita: 'KG',
      suggerimento:
        'Quantità dal peso verificato a destino (1.200 KG); il FIR dichiarava 1.234,5 KG.',
    })
  })

  it('SCARICO del produttore usa la quantità dichiarata anche con il peso verificato', () => {
    expect(quantitaDaFir(fir(1200), 'SCARICO', 'PRODUTTORE')).toEqual({
      quantita: 1234.5,
      unita: 'KG',
      suggerimento: null,
    })
  })

  it('CARICO senza peso verificato usa la dichiarata', () => {
    expect(quantitaDaFir(fir(null), 'CARICO', 'DESTINATARIO')).toEqual({
      quantita: 1234.5,
      unita: 'KG',
      suggerimento: null,
    })
    expect(quantitaDaFir(fir(0), 'CARICO', 'DESTINATARIO').quantita).toBe(1234.5)
  })

  it('CARICO di ruolo non determinato usa la dichiarata', () => {
    expect(quantitaDaFir(fir(1200), 'CARICO', null)).toEqual({
      quantita: 1234.5,
      unita: 'KG',
      suggerimento: null,
    })
  })

  it("il peso a destino resta nell'unità del FIR; senza unità vale KG", () => {
    const inLitri = {
      rifiuto: { cerCode: '130205', quantita: 500, unitaMisura: 'l' },
      pesoEffettivo: 480,
    } as FIR
    expect(quantitaDaFir(inLitri, 'CARICO', 'DESTINATARIO')).toEqual({
      quantita: 480,
      unita: 'L',
      suggerimento: 'Quantità dal peso verificato a destino (480 L); il FIR dichiarava 500 L.',
    })
    const senzaUnita = {
      rifiuto: { cerCode: '150101', quantita: 10, unitaMisura: '' },
      pesoEffettivo: null,
    } as FIR
    expect(quantitaDaFir(senzaUnita, 'SCARICO', 'PRODUTTORE').unita).toBe('KG')
  })
})
