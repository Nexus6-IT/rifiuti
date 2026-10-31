import {
  calcolaFifo,
  confrontaEventiFifo,
  famigliaFifo,
  millesimiFifo,
  quantitaFifo,
  type EventoFifo,
} from './fifo-deposito'

const ANNO = 2026 * 1e7

function carico(id: string, giorno: string, quantita: number, ordine = ANNO + 1): EventoFifo {
  return { tipo: 'CARICO', giorno, quantita, origine: 'MOVIMENTO', ordine, riferimento: { id } }
}
function scarico(id: string, giorno: string, quantita: number, ordine = ANNO + 1): EventoFifo {
  return { tipo: 'SCARICO', giorno, quantita, origine: 'MOVIMENTO', ordine, riferimento: { id } }
}
function apertura(id: string, giorno: string, quantita: number): EventoFifo {
  return { tipo: 'CARICO', giorno, quantita, origine: 'APERTURA', ordine: 0, riferimento: { id } }
}

describe('calcolaFifo: casi a mano', () => {
  it('nessun evento: tutto vuoto', () => {
    expect(calcolaFifo([])).toEqual({
      lotti: [],
      residuoTotale: 0,
      scoperto: 0,
      giornoPiuVecchio: null,
      abbinamenti: [],
      debiti: [],
    })
  })

  it('tre carichi e uno scarico che consuma il primo e meta del secondo', () => {
    const esito = calcolaFifo([
      carico('c1', '2026-01-10', 100, ANNO + 1),
      carico('c2', '2026-02-10', 200, ANNO + 2),
      carico('c3', '2026-03-10', 50, ANNO + 3),
      scarico('s1', '2026-04-01', 200, ANNO + 4),
    ])
    expect(esito.lotti).toEqual([
      {
        giorno: '2026-02-10',
        quantita: 200,
        residuo: 100,
        origine: 'MOVIMENTO',
        riferimento: { id: 'c2' },
      },
      {
        giorno: '2026-03-10',
        quantita: 50,
        residuo: 50,
        origine: 'MOVIMENTO',
        riferimento: { id: 'c3' },
      },
    ])
    expect(esito.abbinamenti).toEqual([
      { scarico: { id: 's1' }, carico: { id: 'c1' }, quantita: 100 },
      { scarico: { id: 's1' }, carico: { id: 'c2' }, quantita: 100 },
    ])
    expect(esito.residuoTotale).toBe(150)
    expect(esito.scoperto).toBe(0)
    expect(esito.giornoPiuVecchio).toBe('2026-02-10')
  })

  it("G6: carico scaricato per intero, poi un carico nuovo: l'eta parte dal nuovo", () => {
    const esito = calcolaFifo([
      carico('c1', '2026-01-10', 100, ANNO + 1),
      scarico('s1', '2026-02-20', 100, ANNO + 2),
      carico('c2', '2026-03-01', 40, ANNO + 3),
    ])
    expect(esito.giornoPiuVecchio).toBe('2026-03-01')
    expect(esito.lotti).toHaveLength(1)
    expect(esito.lotti[0].riferimento.id).toBe('c2')
  })

  it("stesso giorno (M3): lo scarico prende il carico dello stesso giorno, a prescindere dall'ordine dell'array", () => {
    const c = carico('C', '2026-03-05', 30, ANNO + 2)
    const s = scarico('S', '2026-03-05', 10, ANNO + 1) // progressivo piu basso, ma e uno scarico
    const dritto = calcolaFifo([c, s])
    const rovescio = calcolaFifo([s, c])
    expect(dritto.abbinamenti).toEqual([
      { scarico: { id: 'S' }, carico: { id: 'C' }, quantita: 10 },
    ])
    expect(dritto.scoperto).toBe(0)
    expect(dritto.lotti[0].residuo).toBe(20)
    expect(rovescio).toEqual(dritto)
  })

  it("apertura e carico nello stesso giorno: lo scarico e abbinato prima all'apertura", () => {
    const esito = calcolaFifo([
      carico('c1', '2026-03-01', 50, ANNO + 1),
      apertura('a1', '2026-03-01', 50),
      scarico('s1', '2026-03-10', 30, ANNO + 2),
    ])
    expect(esito.abbinamenti).toEqual([
      { scarico: { id: 's1' }, carico: { id: 'a1' }, quantita: 30 },
    ])
    expect(esito.lotti.map(l => [l.riferimento.id, l.residuo])).toEqual([
      ['a1', 20],
      ['c1', 50],
    ])
  })

  it('apertura con data successiva a un carico: il carico e piu vecchio e si consuma prima', () => {
    const esito = calcolaFifo([
      apertura('a1', '2026-05-01', 50),
      carico('c1', '2026-03-01', 50, ANNO + 1),
      scarico('s1', '2026-06-01', 60, ANNO + 2),
    ])
    expect(esito.abbinamenti).toEqual([
      { scarico: { id: 's1' }, carico: { id: 'c1' }, quantita: 50 },
      { scarico: { id: 's1' }, carico: { id: 'a1' }, quantita: 10 },
    ])
    expect(esito.lotti.map(l => [l.riferimento.id, l.residuo])).toEqual([['a1', 40]])
  })

  it('debito saldato dai carichi successivi, dal piu vecchio', () => {
    const esito = calcolaFifo([
      scarico('S', '2026-01-05', 100, ANNO + 1),
      carico('C1', '2026-01-10', 60, ANNO + 2),
      carico('C2', '2026-01-20', 80, ANNO + 3),
    ])
    expect(esito.abbinamenti).toEqual([
      { scarico: { id: 'S' }, carico: { id: 'C1' }, quantita: 60 },
      { scarico: { id: 'S' }, carico: { id: 'C2' }, quantita: 40 },
    ])
    expect(esito.lotti).toEqual([
      {
        giorno: '2026-01-20',
        quantita: 80,
        residuo: 40,
        origine: 'MOVIMENTO',
        riferimento: { id: 'C2' },
      },
    ])
    expect(esito.scoperto).toBe(0)
    expect(esito.residuoTotale).toBe(40)
  })

  it('debito mai saldato: scoperto > 0, nessun lotto, abbinamenti solo per la parte coperta', () => {
    const esito = calcolaFifo([
      carico('C1', '2026-01-10', 30, ANNO + 1),
      scarico('S', '2026-01-20', 100, ANNO + 2),
    ])
    expect(esito.scoperto).toBe(70)
    expect(esito.lotti).toEqual([])
    expect(esito.giornoPiuVecchio).toBeNull()
    expect(esito.abbinamenti).toEqual([
      { scarico: { id: 'S' }, carico: { id: 'C1' }, quantita: 30 },
    ])
    const soloDebito = calcolaFifo([scarico('S', '2026-01-20', 100)])
    expect(soloDebito.scoperto).toBe(100)
    expect(soloDebito.abbinamenti).toEqual([])
  })

  it('aritmetica: 0,1 + 0,2 tre volte e scarico di 0,9 lascia residuo esattamente 0', () => {
    const eventi: EventoFifo[] = []
    for (let i = 0; i < 3; i++) {
      eventi.push(carico(`a${i}`, '2026-01-01', 0.1, ANNO + 1 + i * 2))
      eventi.push(carico(`b${i}`, '2026-01-01', 0.2, ANNO + 2 + i * 2))
    }
    eventi.push(scarico('s', '2026-01-02', 0.9, ANNO + 10))
    const esito = calcolaFifo(eventi)
    expect(esito.lotti).toEqual([])
    expect(esito.residuoTotale).toBe(0)
    expect(esito.scoperto).toBe(0)
  })

  it('spareggi (I7): per ordine, poi per id lessicografico', () => {
    const perOrdine = calcolaFifo([
      carico('zzz', '2026-02-01', 10, ANNO + 1),
      carico('aaa', '2026-02-01', 10, ANNO + 2),
      scarico('s', '2026-02-02', 10, ANNO + 3),
    ])
    expect(perOrdine.abbinamenti[0].carico.id).toBe('zzz')

    const perId = calcolaFifo([
      carico('b', '2026-02-01', 10, ANNO + 1),
      carico('a', '2026-02-01', 10, ANNO + 1),
      scarico('s', '2026-02-02', 10, ANNO + 3),
    ])
    expect(perId.abbinamenti[0].carico.id).toBe('a')
  })

  it('errori di programmazione', () => {
    expect(() => calcolaFifo([carico('c', '2026-01-01', 0)])).toThrow()
    expect(() => calcolaFifo([carico('c', '2026-01-01', -1)])).toThrow()
    expect(() => calcolaFifo([carico('c', '2026-01-01', Number.NaN)])).toThrow()
    expect(() => calcolaFifo([carico('c', '2026-01-01', 0.0004)])).toThrow()
    expect(() => calcolaFifo([carico('c', '2026-01-01', 1, Number.NaN)])).toThrow()
    expect(() => calcolaFifo([carico('c', '2026-13-01', 1)])).toThrow()
    expect(() => calcolaFifo([carico('c', '2026-01-32', 1)])).toThrow()
    expect(() => calcolaFifo([carico('c', '2026-3-1', 1)])).toThrow()
    expect(millesimiFifo(0.0004)).toBe(0)
    expect(millesimiFifo(0.1)).toBe(100)
    expect(() => calcolaFifo([carico('', '2026-01-01', 1)])).toThrow()
    expect(() =>
      calcolaFifo([{ ...scarico('s', '2026-01-01', 1), origine: 'APERTURA' as const }])
    ).toThrow()
  })
})

describe('confrontaEventiFifo', () => {
  it('ordina per giorno, carichi prima degli scarichi, aperture prima dei movimenti, ordine, id', () => {
    const lista = [
      scarico('s', '2026-01-01', 1, ANNO + 1),
      carico('m', '2026-01-01', 1, ANNO + 5),
      apertura('a', '2026-01-01', 1),
      carico('l', '2026-01-01', 1, ANNO + 2),
      carico('x', '2025-12-31', 1, ANNO + 9),
    ]
    expect([...lista].sort(confrontaEventiFifo).map(e => e.riferimento.id)).toEqual([
      'x',
      'a',
      'l',
      'm',
      's',
    ])
  })
})

describe('famigliaFifo e quantitaFifo', () => {
  it('famiglie', () => {
    expect(famigliaFifo('')).toBe('KG')
    expect(famigliaFifo('kg')).toBe('KG')
    expect(famigliaFifo('T')).toBe('KG')
    expect(famigliaFifo('m3')).toBe('M3')
  })
  it('t in kg', () => {
    expect(quantitaFifo(1.5, 't')).toBe(1500)
    expect(quantitaFifo(2.5, 'kg')).toBe(2.5)
    expect(quantitaFifo(3, 'm3')).toBe(3)
  })
})

// --- proprieta con generatore deterministico ---

function lcg(seme: number): () => number {
  let s = seme >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const mill = (q: number): number => Math.round(q * 1000)

function giornoDa(n: number): string {
  return new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10)
}

function generaSequenza(rnd: () => number): EventoFifo[] {
  const n = 1 + Math.floor(rnd() * 40)
  const eventi: EventoFifo[] = []
  for (let i = 0; i < n; i++) {
    const giorno = giornoDa(Math.floor(rnd() * 60))
    const quantita = (1 + Math.floor(rnd() * 5000)) / 100
    const r = rnd()
    if (r < 0.1) {
      eventi.push(apertura(`ev-${i}`, giorno, quantita))
    } else if (r < 0.55) {
      eventi.push(carico(`ev-${i}`, giorno, quantita, ANNO + i + 1))
    } else {
      eventi.push(scarico(`ev-${i}`, giorno, quantita, ANNO + i + 1))
    }
  }
  return eventi
}

function mescola<T>(v: readonly T[], rnd: () => number): T[] {
  const a = [...v]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

describe('calcolaFifo: proprieta su 500 sequenze casuali', () => {
  it('rispetta gli invarianti di D1', () => {
    const rnd = lcg(20261028)
    for (let k = 0; k < 500; k++) {
      const eventi = generaSequenza(rnd)
      const esito = calcolaFifo(eventi)
      const perId = new Map(eventi.map(e => [e.riferimento.id, e]))

      const carichi = eventi.filter(e => e.tipo === 'CARICO')
      const scarichi = eventi.filter(e => e.tipo === 'SCARICO')
      const totCarichi = carichi.reduce((s, e) => s + mill(e.quantita), 0)
      const totScarichi = scarichi.reduce((s, e) => s + mill(e.quantita), 0)

      // saldo
      expect(mill(esito.residuoTotale) - mill(esito.scoperto)).toBe(totCarichi - totScarichi)

      // carico = abbinamenti + residuo del lotto
      for (const c of carichi) {
        const abb = esito.abbinamenti
          .filter(a => a.carico.id === c.riferimento.id)
          .reduce((s, a) => s + mill(a.quantita), 0)
        const lotto = esito.lotti.find(l => l.riferimento.id === c.riferimento.id)
        expect(abb + (lotto ? mill(lotto.residuo) : 0)).toBe(mill(c.quantita))
      }

      // scarico = abbinamenti + parte scoperta
      let scopertoSomma = 0
      for (const s of scarichi) {
        const abb = esito.abbinamenti
          .filter(a => a.scarico.id === s.riferimento.id)
          .reduce((x, a) => x + mill(a.quantita), 0)
        const scoperta = mill(s.quantita) - abb
        expect(scoperta).toBeGreaterThanOrEqual(0)
        scopertoSomma += scoperta
      }
      expect(scopertoSomma).toBe(mill(esito.scoperto))

      // lotti in ordine FIFO, residui positivi, solo il primo puo essere parziale
      const lottiEv = esito.lotti.map(l => perId.get(l.riferimento.id) as EventoFifo)
      for (let i = 1; i < lottiEv.length; i++) {
        expect(confrontaEventiFifo(lottiEv[i - 1], lottiEv[i])).toBeLessThan(0)
      }
      esito.lotti.forEach((l, i) => {
        expect(l.residuo).toBeGreaterThan(0)
        if (i > 0) expect(l.residuo).toBe(l.quantita)
      })
      expect(esito.giornoPiuVecchio).toBe(esito.lotti[0]?.giorno ?? null)

      // invarianza alla permutazione dell'input, abbinamenti compresi
      expect(calcolaFifo(mescola(eventi, rnd))).toEqual(esito)
    }
  })
})

describe('saldaDebiti: false', () => {
  const senzaSaldo = { saldaDebiti: false }

  it('scarico senza lotti, poi un carico: nessun abbinamento, il debito resta', () => {
    const esito = calcolaFifo(
      [scarico('S', '2026-01-05', 100, ANNO + 1), carico('C1', '2026-01-10', 60, ANNO + 2)],
      senzaSaldo
    )
    expect(esito.abbinamenti).toEqual([])
    expect(esito.debiti).toEqual([{ scarico: { id: 'S' }, quantita: 100 }])
    expect(esito.scoperto).toBe(100)
    expect(esito.lotti).toHaveLength(1)
    expect(esito.lotti[0].riferimento.id).toBe('C1')
    expect(esito.lotti[0].residuo).toBe(60)
  })

  it('carico 50, scarico 80, carico 40: un abbinamento, debito 30, lotto C2 intero', () => {
    const esito = calcolaFifo(
      [
        carico('C1', '2026-03-01', 50, ANNO + 1),
        scarico('S', '2026-03-02', 80, ANNO + 2),
        carico('C2', '2026-03-03', 40, ANNO + 3),
      ],
      senzaSaldo
    )
    expect(esito.abbinamenti).toEqual([
      { scarico: { id: 'S' }, carico: { id: 'C1' }, quantita: 50 },
    ])
    expect(esito.debiti).toEqual([{ scarico: { id: 'S' }, quantita: 30 }])
    expect(esito.lotti.map(l => [l.riferimento.id, l.residuo])).toEqual([['C2', 40]])
  })

  it('stesso giorno: il carico precede lo scarico anche senza saldo dei debiti', () => {
    const esito = calcolaFifo(
      [scarico('S', '2026-03-02', 30, ANNO + 1), carico('C', '2026-03-02', 50, ANNO + 2)],
      senzaSaldo
    )
    expect(esito.abbinamenti).toEqual([{ scarico: { id: 'S' }, carico: { id: 'C' }, quantita: 30 }])
    expect(esito.debiti).toEqual([])
  })

  it('debiti esposti anche col predefinito, con la stessa somma di scoperto', () => {
    const esito = calcolaFifo([
      carico('C1', '2026-01-10', 30, ANNO + 1),
      scarico('S', '2026-01-20', 100, ANNO + 2),
    ])
    expect(esito.debiti).toEqual([{ scarico: { id: 'S' }, quantita: 70 }])
    expect(esito.debiti.reduce((s, d) => s + mill(d.quantita), 0)).toBe(mill(esito.scoperto))
  })

  it('proprieta su 300 sequenze casuali', () => {
    const rnd = lcg(20261031)
    for (let k = 0; k < 300; k++) {
      const eventi = generaSequenza(rnd)
      const perId = new Map(eventi.map(e => [e.riferimento.id, e]))
      const esito = calcolaFifo(eventi, senzaSaldo)

      for (const a of esito.abbinamenti) {
        const c = perId.get(a.carico.id) as EventoFifo
        const s = perId.get(a.scarico.id) as EventoFifo
        expect(confrontaEventiFifo(c, s)).toBeLessThan(0)
      }
      expect(esito.debiti.reduce((x, d) => x + mill(d.quantita), 0)).toBe(mill(esito.scoperto))
      for (const s of eventi.filter(e => e.tipo === 'SCARICO')) {
        const abb = esito.abbinamenti
          .filter(a => a.scarico.id === s.riferimento.id)
          .reduce((x, a) => x + mill(a.quantita), 0)
        const deb = esito.debiti
          .filter(d => d.scarico.id === s.riferimento.id)
          .reduce((x, d) => x + mill(d.quantita), 0)
        expect(abb + deb).toBe(mill(s.quantita))
      }
    }
  })
})
