import { aggregaOrso } from './aggrega-orso'
import { aggregaOrsoDettagliata } from './aggrega-orso-dettagliata'
import type { MovimentoOrso, SoggettoOrso } from './aggregato'

const P = { anno: 2026, provinciaImpianto: 'MI' }

const I = (codice: string): SoggettoOrso => ({ tipo: 'I', codice })
const C = (istat: string): SoggettoOrso => ({ tipo: 'C', istat })
const NUOVO = (chiave: string, ragioneSociale = `Ditta ${chiave}`): SoggettoOrso => ({
  tipo: 'Inew',
  chiave,
  impianto: {
    ragioneSociale,
    codfisPiva: '01234567890',
    indirizzoUL: { provincia: '015', comune: '146' },
  },
})

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
    soggetto: I('100'),
    ...o,
  }
}

describe('aggregaOrsoDettagliata', () => {
  it('senza movimenti non produce mesi né nuovi impianti', () => {
    expect(aggregaOrsoDettagliata([], P)).toEqual({
      anno: 2026,
      mesi: [],
      avvisi: [],
      bloccato: false,
      nuoviImpianti: [],
    })
  })

  it('divide i carichi per soggetto: In per I, C e Inew, senza Extra', () => {
    const r = aggregaOrsoDettagliata(
      [
        mov({ id: 'a', quantita: 1500, soggetto: I('100') }),
        mov({ id: 'b', quantita: 500, soggetto: I('100') }),
        mov({ id: 'c', quantita: 250, soggetto: C('015146') }),
        mov({ id: 'd', quantita: 100, soggetto: NUOVO('sede-9') }),
      ],
      P
    )
    expect(r.bloccato).toBe(false)
    const nodo = r.mesi[0].ricevuti[0]
    expect(nodo.totale).toBe('2.35')
    expect(nodo.ingressi.map(i => [i.ts, i.s, i.totale])).toEqual([
      ['C', '015146', '0.25'],
      ['I', '100', '2'],
      ['Inew', '1', '0.1'],
    ])
    expect(r.nuoviImpianti).toEqual([
      expect.objectContaining({ id: 1, ragioneSociale: 'Ditta sede-9' }),
    ])
  })

  it('f è per singolo In: 1 solo se almeno un movimento di quel soggetto ha il FIR', () => {
    const r = aggregaOrsoDettagliata(
      [
        mov({ id: 'a', soggetto: I('100'), conFir: false }),
        mov({ id: 'b', soggetto: I('100'), conFir: true }),
        mov({ id: 'c', soggetto: I('200'), conFir: false }),
        mov({ id: 'd', soggetto: C('015146'), conFir: true }),
      ],
      P
    )
    const f = Object.fromEntries(r.mesi[0].ricevuti[0].ingressi.map(i => [`${i.ts}${i.s}`, i.f]))
    expect(f).toEqual({ C015146: 1, I100: 1, I200: 0 })
  })

  it('numera gli Inew per prima comparsa nell’ordine del file, a prescindere dall’ordine dei movimenti', () => {
    const movimenti = [
      mov({ id: '1', mese: 5, cer: '15 01 06', soggetto: NUOVO('b') }),
      mov({ id: '2', mese: 3, cer: '17 04 05', soggetto: NUOVO('c') }),
      mov({ id: '3', mese: 3, cer: '17 04 05', soggetto: NUOVO('a') }),
      mov({ id: '4', mese: 3, cer: '17 09 04', soggetto: NUOVO('a') }),
    ]
    const dritto = aggregaOrsoDettagliata(movimenti, P)
    const rovescio = aggregaOrsoDettagliata([...movimenti].reverse(), P)
    expect(rovescio).toEqual(dritto)
    // mese 3 / CER 170405: ordine per identità (a, c) -> a=1, c=2; poi b nel mese 5 -> 3
    expect(dritto.nuoviImpianti.map(n => [n.id, n.ragioneSociale])).toEqual([
      [1, 'Ditta a'],
      [2, 'Ditta c'],
      [3, 'Ditta b'],
    ])
    const m3 = dritto.mesi[0]
    expect(m3.ricevuti[0].ingressi.map(i => i.s)).toEqual(['1', '2'])
    expect(m3.ricevuti[1].ingressi.map(i => i.s)).toEqual(['1'])
  })

  it('lo stesso soggetto Inew in ingresso e in uscita ha lo stesso progressivo', () => {
    const r = aggregaOrsoDettagliata(
      [
        mov({ id: 'a', soggetto: NUOVO('x') }),
        mov({
          id: 'b',
          verso: 'SCARICO',
          ruoloMud: 'AVVIATO',
          soggetto: NUOVO('x'),
          quantita: 300,
        }),
      ],
      P
    )
    expect(r.nuoviImpianti).toHaveLength(1)
    expect(r.mesi[0].prodotti[0].uscite).toEqual([
      { ts: 'Inew', s: '1', etichetta: 'Ditta x', totale: '0.3' },
    ])
  })

  it('divide gli scarichi per destinatario (I o Inew) e tiene la giacenza del normale', () => {
    const r = aggregaOrsoDettagliata(
      [
        mov({ id: 'a', verso: 'SCARICO', ruoloMud: 'AVVIATO', quantita: 800, soggetto: I('55') }),
        mov({ id: 'b', verso: 'SCARICO', ruoloMud: 'AVVIATO', quantita: 200, soggetto: I('55') }),
        mov({
          id: 'c',
          verso: 'SCARICO',
          ruoloMud: 'PRODOTTO',
          quantita: 50,
          soggetto: NUOVO('z'),
        }),
      ],
      {
        ...P,
        giacenze: [{ mese: 3, cer: '170405', descrizione: 'Ferro e acciaio', kg: 120 }],
      }
    )
    const p = r.mesi[0].prodotti[0]
    expect(p.totale).toBe('1.05')
    expect(p.giacenzaFineMese).toBe('0.12')
    expect(p.uscite.map(u => [u.ts, u.s, u.totale])).toEqual([
      ['I', '55', '1'],
      ['Inew', '1', '0.05'],
    ])
  })

  it('un comune come destinatario non è ammesso: il movimento non è identificato', () => {
    const r = aggregaOrsoDettagliata(
      [mov({ id: 'a', verso: 'SCARICO', ruoloMud: 'AVVIATO', soggetto: C('015146') })],
      P
    )
    expect(r.bloccato).toBe(true)
    expect(r.avvisi).toEqual([
      expect.objectContaining({ codice: 'SOGGETTO_NON_IDENTIFICATO', movimentoIds: ['a'] }),
    ])
  })

  it.each([null, undefined])(
    'soggetto %s: avviso bloccante SOGGETTO_NON_IDENTIFICATO per mese e CER',
    s => {
      const r = aggregaOrsoDettagliata(
        [mov({ id: 'b', soggetto: s }), mov({ id: 'a', soggetto: s }), mov({ id: 'c' })],
        P
      )
      expect(r.bloccato).toBe(true)
      expect(r.avvisi).toEqual([
        {
          codice: 'SOGGETTO_NON_IDENTIFICATO',
          bloccante: true,
          mese: 3,
          cer: '170405',
          movimentoIds: ['a', 'b'],
        },
      ])
    }
  )

  it('la provincia del conferitore non serve (niente Extra): nessun avviso per provincia mancante', () => {
    const r = aggregaOrsoDettagliata([mov({ provinciaConferitore: null })], P)
    expect(r.avvisi).toEqual([])
    expect(aggregaOrso([mov({ provinciaConferitore: null })], P).bloccato).toBe(true)
  })

  it('conserva gli altri avvisi del normale (quantità non convertibile, operazione mancante)', () => {
    const r = aggregaOrsoDettagliata(
      [mov({ id: 'a', unita: 'MC' }), mov({ id: 'b', operazione: null, soggetto: I('7') })],
      P
    )
    expect(r.avvisi.map(a => a.codice).sort()).toEqual([
      'OPERAZIONE_MANCANTE',
      'QUANTITA_NON_CONVERTIBILE',
    ])
    expect(r.bloccato).toBe(true)
  })

  it('i movimenti non conteggiati (carico non ricevuto da terzi, scarico escluso) non servono di soggetto', () => {
    const r = aggregaOrsoDettagliata(
      [
        mov({ id: 'a', ruoloMud: 'PRODOTTO', soggetto: null }),
        mov({ id: 'b', verso: 'SCARICO', ruoloMud: 'ESCLUSO', soggetto: null }),
      ],
      P
    )
    expect(r.avvisi).toEqual([])
    expect(r.mesi).toEqual([])
  })

  it('i mesi oltre ultimoMese non entrano e non consumano progressivi', () => {
    const r = aggregaOrsoDettagliata(
      [
        mov({ id: 'a', mese: 3, soggetto: NUOVO('a') }),
        mov({ id: 'b', mese: 11, soggetto: NUOVO('b') }),
      ],
      { ...P, ultimoMese: 6 }
    )
    expect(r.mesi.map(m => m.mese)).toEqual([3])
    expect(r.nuoviImpianti.map(n => n.ragioneSociale)).toEqual(['Ditta a'])
  })

  it('un movimento senza soggetto in un mese oltre ultimoMese non è un errore', () => {
    const r = aggregaOrsoDettagliata([mov({ id: 'f', mese: 11, soggetto: null })], {
      ...P,
      ultimoMese: 6,
    })
    expect(r.avvisi).toEqual([])
    expect(r.bloccato).toBe(false)
  })

  it('stessi nodi, descrizioni e giacenze della modalità normale', () => {
    const movimenti = [
      mov({ id: 'a', descrizione: 'Ferro', soggetto: I('1') }),
      mov({ id: 'b', descrizione: 'ferro', soggetto: I('2') }),
      mov({ id: 'c', verso: 'SCARICO', ruoloMud: 'AVVIATO', soggetto: I('9') }),
    ]
    const giacenze = [{ mese: 3, cer: '170405', descrizione: null, kg: 10 }]
    const n = aggregaOrso(movimenti, { ...P, giacenze })
    const d = aggregaOrsoDettagliata(movimenti, { ...P, giacenze })
    const senzaDettaglio = d.mesi.map(m => ({
      mese: m.mese,
      ricevuti: m.ricevuti.map(({ ingressi: _i, ...r }) => r),
      prodotti: m.prodotti.map(({ uscite: _u, ...r }) => r),
    }))
    expect(senzaDettaglio).toEqual(n.mesi)
  })

  it('proprietà: la somma degli In di un nodo è il Tot della modalità normale (200 movimenti)', () => {
    // generatore deterministico (LCG): niente dipendenza dal caso
    let seme = 20261114
    const rnd = (n: number) => {
      seme = (seme * 1664525 + 1013904223) % 4294967296
      return seme % n
    }
    const soggetti: SoggettoOrso[] = [
      I('1'),
      I('2'),
      C('015146'),
      NUOVO('a'),
      NUOVO('b'),
      NUOVO('c'),
    ]
    const cer = ['17 04 05', '15 01 06', '20 03 01']
    const movimenti: MovimentoOrso[] = Array.from({ length: 200 }, (_, i) =>
      mov({
        id: `m${i}`,
        mese: 1 + rnd(12),
        cer: cer[rnd(3)],
        quantita: 1 + rnd(5000),
        conFir: rnd(2) === 1,
        soggetto: soggetti[rnd(soggetti.length)],
        provinciaConferitore: 'MI',
      })
    )
    const n = aggregaOrso(movimenti, P)
    const d = aggregaOrsoDettagliata(movimenti, P)
    expect(d.bloccato).toBe(false)
    const grammi = (t: string) => Math.round(Number(t) * 1_000_000)
    for (const mn of n.mesi) {
      const md = d.mesi.find(x => x.mese === mn.mese)
      for (const rn of mn.ricevuti) {
        const rd = md?.ricevuti.find(x => x.cer === rn.cer && x.descrizione === rn.descrizione)
        const somma = (rd?.ingressi ?? []).reduce((t, i) => t + grammi(i.totale), 0)
        expect(somma).toBe(grammi(rn.totale))
      }
    }
  })
})
