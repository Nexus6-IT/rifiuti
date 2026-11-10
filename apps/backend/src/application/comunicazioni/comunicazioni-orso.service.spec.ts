import type { AggregatoOrso } from '../../domain/comunicazioni/orso/aggregato'
import type { MeseDati } from '../../domain/comunicazioni/orso/impianto-mesi'
import {
  anteprimaMesi,
  eBloccante,
  hashDatiOrso,
  raggruppaAvvisi,
} from './comunicazioni-orso.service'

describe('raggruppaAvvisi', () => {
  it('un avviso per codice con i movimenti uniti e ordinati, i bloccanti per primi', () => {
    const r = raggruppaAvvisi([
      { codice: 'OPERAZIONE_MANCANTE', movimentoIds: ['b'] },
      { codice: 'QUANTITA_NON_CONVERTIBILE', movimentoIds: ['z', 'a'] },
      { codice: 'QUANTITA_NON_CONVERTIBILE', movimentoIds: ['a', 'c'] },
    ])
    expect(r.map(a => a.codice)).toEqual(['QUANTITA_NON_CONVERTIBILE', 'OPERAZIONE_MANCANTE'])
    expect(r[0].movimentoIds).toEqual(['a', 'c', 'z'])
    expect(r[0].messaggio).toContain('non convertibile')
  })

  it('i messaggi parlano di province (extra-provinciale), non di regioni', () => {
    const r = raggruppaAvvisi([
      { codice: 'PROVINCIA_CONFERITORE_MANCANTE', movimentoIds: [] },
      { codice: 'PROVINCIA_IMPIANTO_MANCANTE', movimentoIds: [] },
    ])
    for (const a of r) {
      expect(a.messaggio).toMatch(/extra-provincial/)
      expect(a.messaggio).not.toMatch(/regional/)
    }
  })

  it('allega ai movimenti dell avviso data, numero e CER quando li conosce', () => {
    const r = raggruppaAvvisi(
      [{ codice: 'OPERAZIONE_MANCANTE', movimentoIds: ['b', 'a'] }],
      new Map([
        ['a', { id: 'a', data: '2025-03-10', numero: '4/2025', cer: '150101' }],
        ['b', { id: 'b', data: '2025-03-11', numero: '5/2025', cer: '150107' }],
      ])
    )
    expect(r[0].movimenti).toEqual([
      { id: 'a', data: '2025-03-10', numero: '4/2025', cer: '150101' },
      { id: 'b', data: '2025-03-11', numero: '5/2025', cer: '150107' },
    ])
  })

  it('distingue gli avvisi bloccanti da quelli informativi', () => {
    expect(eBloccante('PROVINCIA_IMPIANTO_MANCANTE')).toBe(true)
    expect(eBloccante('DESCRIZIONE_VUOTA')).toBe(true)
    expect(eBloccante('PROVINCIA_DA_INDIRIZZO')).toBe(false)
    expect(eBloccante('OPERAZIONE_MANCANTE')).toBe(false)
  })
})

describe('anteprimaMesi', () => {
  const aggregato: AggregatoOrso = {
    anno: 2025,
    avvisi: [],
    bloccato: false,
    mesi: [
      {
        mese: 3,
        ricevuti: [
          {
            cer: '200301',
            descrizione: 'Urbani',
            operazioni: ['R13'],
            totale: '1.5',
            extra: '0.5',
            f: 1,
          },
        ],
        prodotti: [
          { cer: '191212', descrizione: 'Scarti', totale: '0.8', giacenzaFineMese: '1.2' },
        ],
      },
    ],
  }

  it('restituisce sempre 12 mesi, quelli senza movimenti vuoti', () => {
    const mesi = anteprimaMesi(aggregato)
    expect(mesi.map(m => m.mese)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(mesi[0]).toEqual({ mese: 1, ricevuti: [], prodotti: [] })
  })

  it('usa i nomi del contratto API', () => {
    const m = anteprimaMesi(aggregato)[2]
    expect(m.ricevuti[0]).toEqual({
      cer: '200301',
      descrizione: 'Urbani',
      operazioni: ['R13'],
      totT: '1.5',
      extraT: '0.5',
      conFir: true,
    })
    expect(m.prodotti[0]).toEqual({
      cer: '191212',
      descrizione: 'Scarti',
      operazioni: [],
      totT: '0.8',
      giacenzaFineMeseT: '1.2',
    })
  })
})

describe('hashDatiOrso', () => {
  it('è stabile per gli stessi dati e cambia se cambia una quantità', () => {
    const base = { anni: [{ anno: 2025, mesi: [] }] }
    expect(hashDatiOrso(base)).toBe(hashDatiOrso({ anni: [{ anno: 2025, mesi: [] }] }))
    expect(hashDatiOrso(base)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashDatiOrso(base)).not.toBe(hashDatiOrso({ anni: [{ anno: 2026, mesi: [] }] }))
  })

  it('non cambia se cambiano solo i mesi vuoti dichiarati (anno in corso, passa un mese)', () => {
    const mese = (n: number, pieno: boolean): MeseDati => ({
      mese: n,
      ricevuti: pieno ? [{ cer: '200301', descrizione: 'x', operazioni: [], ingressi: [] }] : [],
      prodotti: [],
    })
    const finoANovembre = {
      anni: [{ anno: 2026, mesi: [mese(1, false), mese(3, true), mese(11, false)] }],
    }
    const finoADicembre = {
      anni: [
        { anno: 2026, mesi: [mese(1, false), mese(3, true), mese(11, false), mese(12, false)] },
      ],
    }
    expect(hashDatiOrso(finoADicembre)).toBe(hashDatiOrso(finoANovembre))
    const conMovimentoADicembre = {
      anni: [{ anno: 2026, mesi: [mese(3, true), mese(12, true)] }],
    }
    expect(hashDatiOrso(conMovimentoADicembre)).not.toBe(hashDatiOrso(finoANovembre))
  })
})
