import { aggregaOrso, grammiInTonnellate } from './aggrega-orso'
import type { MovimentoOrso } from './aggregato'

const P = { anno: 2026, provinciaImpianto: 'MI' }

function mov(o: Partial<MovimentoOrso>): MovimentoOrso {
  return {
    id: 'm1',
    mese: 3,
    verso: 'CARICO',
    ruoloMud: 'RICEVUTO_DA_TERZI',
    cer: '17 04 05',
    descrizione: 'Ferro e acciaio',
    quantita: 1000,
    unita: 'KG',
    kgPerUnita: null,
    operazione: 'R13',
    conFir: true,
    provinciaConferitore: 'MI',
    ...o,
  }
}

describe('grammiInTonnellate', () => {
  it('formatta senza zeri finali e senza errori di virgola mobile', () => {
    expect(grammiInTonnellate(0)).toBe('0')
    expect(grammiInTonnellate(1_000_000)).toBe('1')
    expect(grammiInTonnellate(1_234_500)).toBe('1.2345')
    expect(grammiInTonnellate(1)).toBe('0.000001')
  })
})

describe('aggregaOrso', () => {
  it('senza movimenti non produce mesi', () => {
    expect(aggregaOrso([], P)).toEqual({ anno: 2026, mesi: [], avvisi: [], bloccato: false })
  })

  it('somma i carichi per mese e CER in tonnellate con Extra da altre province', () => {
    const r = aggregaOrso(
      [
        mov({ id: 'a', quantita: 1500 }),
        mov({ id: 'b', quantita: 500, provinciaConferitore: 'BG', operazione: 'R12' }),
      ],
      P
    )
    expect(r.mesi).toHaveLength(1)
    expect(r.mesi[0].ricevuti).toEqual([
      {
        cer: '170405',
        descrizione: 'Ferro e acciaio',
        operazioni: ['R12', 'R13'],
        totale: '2',
        extra: '0.5',
        f: 1,
      },
    ])
    expect(r.bloccato).toBe(false)
  })

  it('stesso CER con descrizioni diverse resta in nodi diversi', () => {
    const r = aggregaOrso([mov({ id: 'a' }), mov({ id: 'b', descrizione: 'Rottami' })], P)
    expect(r.mesi[0].ricevuti.map(x => x.descrizione)).toEqual(['Ferro e acciaio', 'Rottami'])
  })

  it('tronca la descrizione a 100 caratteri', () => {
    const r = aggregaOrso([mov({ descrizione: 'x'.repeat(150) })], P)
    expect(r.mesi[0].ricevuti[0].descrizione).toHaveLength(100)
  })

  it('converte tonnellate e unità non di massa col peso specifico', () => {
    const r = aggregaOrso(
      [
        mov({ id: 'a', quantita: 2, unita: 'T' }),
        mov({ id: 'b', quantita: 100, unita: 'L', kgPerUnita: 0.9 }),
      ],
      P
    )
    expect(r.mesi[0].ricevuti[0].totale).toBe('2.09')
  })

  it('unità non di massa senza peso specifico: avviso bloccante, movimento escluso', () => {
    const r = aggregaOrso([mov({ id: 'a', unita: 'L', kgPerUnita: null })], P)
    expect(r.mesi).toEqual([])
    expect(r.bloccato).toBe(true)
    expect(r.avvisi[0]).toMatchObject({ codice: 'QUANTITA_NON_CONVERTIBILE', movimentoIds: ['a'] })
  })

  it('provincia del conferitore mancante: avviso bloccante con i movimenti, nessun Extra', () => {
    const r = aggregaOrso(
      [mov({ id: 'b', provinciaConferitore: null }), mov({ id: 'a', provinciaConferitore: ' ' })],
      P
    )
    expect(r.bloccato).toBe(true)
    expect(r.avvisi).toEqual([
      {
        codice: 'PROVINCIA_CONFERITORE_MANCANTE',
        bloccante: true,
        mese: 3,
        cer: '170405',
        movimentoIds: ['a', 'b'],
      },
    ])
    expect(r.mesi[0].ricevuti[0].extra).toBe('0')
  })

  it('la provincia si confronta senza badare a maiuscole e spazi', () => {
    const r = aggregaOrso([mov({ provinciaConferitore: ' mi ' })], P)
    expect(r.mesi[0].ricevuti[0].extra).toBe('0')
  })

  it('operazione mancante: avviso non bloccante e nodo senza operazioni', () => {
    const r = aggregaOrso([mov({ operazione: null })], P)
    expect(r.bloccato).toBe(false)
    expect(r.mesi[0].ricevuti[0].operazioni).toEqual([])
    expect(r.avvisi[0].codice).toBe('OPERAZIONE_MANCANTE')
  })

  it('f vale 0 se nessun movimento del nodo ha il FIR', () => {
    const r = aggregaOrso([mov({ conFir: false })], P)
    expect(r.mesi[0].ricevuti[0].f).toBe(0)
  })

  it('gli scarichi diventano prodotti con giacenza a fine mese 0 se non ce n e', () => {
    const r = aggregaOrso(
      [mov({ id: 's', verso: 'SCARICO', ruoloMud: 'AVVIATO', quantita: 250, mese: 4 })],
      P
    )
    expect(r.mesi).toEqual([
      {
        mese: 4,
        ricevuti: [],
        prodotti: [
          {
            cer: '170405',
            descrizione: 'Ferro e acciaio',
            totale: '0.25',
            giacenzaFineMese: '0',
          },
        ],
      },
    ])
    expect(r.avvisi).toEqual([])
  })

  it('la giacenza a fine mese entra nel nodo prodotto del CER (nel primo per descrizione)', () => {
    const r = aggregaOrso(
      [
        mov({ id: 's1', verso: 'SCARICO', ruoloMud: 'AVVIATO', quantita: 250, mese: 4 }),
        mov({
          id: 's2',
          verso: 'SCARICO',
          ruoloMud: 'AVVIATO',
          quantita: 100,
          mese: 4,
          descrizione: 'Rottami',
        }),
      ],
      { ...P, giacenze: [{ mese: 4, cer: '17 04 05', descrizione: 'Ferro e acciaio', kg: 1500 }] }
    )
    expect(r.mesi[0].prodotti.map(x => [x.descrizione, x.giacenzaFineMese])).toEqual([
      ['Ferro e acciaio', '1.5'],
      ['Rottami', '0'],
    ])
  })

  it('una giacenza negativa non entra nel file ma produce un avviso non bloccante', () => {
    const r = aggregaOrso([], {
      ...P,
      giacenze: [{ mese: 4, cer: '17 04 05', descrizione: 'Ferro e acciaio', kg: -300 }],
    })
    expect(r.mesi.flatMap(m => m.prodotti)).toEqual([])
    expect(r.avvisi).toEqual([
      { codice: 'GIACENZA_NEGATIVA', bloccante: false, mese: 4, cer: '170405', movimentoIds: [] },
    ])
    expect(r.bloccato).toBe(false)
  })

  it('un CER in giacenza senza uscite nel mese compare come prodotto senza uscite', () => {
    const r = aggregaOrso([], {
      ...P,
      giacenze: [
        { mese: 5, cer: '17 04 05', descrizione: 'Ferro  e acciaio', kg: 2000 },
        { mese: 6, cer: '17 04 05', descrizione: 'Ferro e acciaio', kg: 0 },
      ],
    })
    expect(r.mesi).toEqual([
      {
        mese: 5,
        ricevuti: [],
        prodotti: [
          { cer: '170405', descrizione: 'Ferro e acciaio', totale: '0', giacenzaFineMese: '2' },
        ],
      },
    ])
  })

  it('le descrizioni che differiscono solo per maiuscole formano un solo nodo', () => {
    const r = aggregaOrso(
      [
        mov({ id: 'a', descrizione: 'Imballaggi misti' }),
        mov({ id: 'b', descrizione: 'imballaggi MISTI' }),
      ],
      P
    )
    expect(r.mesi[0].ricevuti).toHaveLength(1)
    expect(r.mesi[0].ricevuti[0]).toMatchObject({ descrizione: 'Imballaggi misti', totale: '2' })
  })

  it('ignora i movimenti esclusi, i carichi non ricevuti da terzi e i mesi non validi', () => {
    const r = aggregaOrso(
      [
        mov({ id: 'a', ruoloMud: 'PRODOTTO' }),
        mov({ id: 'b', verso: 'SCARICO', ruoloMud: 'ESCLUSO' }),
        mov({ id: 'c', mese: 13 }),
      ],
      P
    )
    expect(r.mesi).toEqual([])
  })

  it('ordina i mesi e distingue i mesi fra loro', () => {
    const r = aggregaOrso([mov({ id: 'a', mese: 5 }), mov({ id: 'b', mese: 2 })], P)
    expect(r.mesi.map(m => m.mese)).toEqual([2, 5])
  })

  it('somma senza deriva in virgola mobile', () => {
    const r = aggregaOrso(
      Array.from({ length: 10 }, (_, i) => mov({ id: `m${i}`, quantita: 0.1 })),
      P
    )
    expect(r.mesi[0].ricevuti[0].totale).toBe('0.001')
  })
})
