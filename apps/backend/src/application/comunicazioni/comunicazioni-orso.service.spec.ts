import type { AggregatoOrso } from '../../domain/comunicazioni/orso/aggregato'
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

  it('distingue gli avvisi bloccanti da quelli informativi', () => {
    expect(eBloccante('PROVINCIA_IMPIANTO_MANCANTE')).toBe(true)
    expect(eBloccante('DESCRIZIONE_VUOTA')).toBe(true)
    expect(eBloccante('TRATTATO_INTERNAMENTE_DEFAULT')).toBe(false)
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
          { cer: '191212', descrizione: 'Scarti', totale: '0.8', trattatoInternamente: '0' },
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
      trattataInternamenteT: '0',
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
})
