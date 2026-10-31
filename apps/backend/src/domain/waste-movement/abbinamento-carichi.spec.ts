import {
  classeAttesaScarico,
  classeStoccaggio,
  confrontaAbbinamenti,
  proponiAbbinamenti,
  residui,
  statoCarico,
  statoScarico,
  validaRigheManuali,
  type CaricoAbbinabile,
  type ScaricoAbbinabile,
} from './abbinamento-carichi'
import type { EventoFifo } from './fifo-deposito'

const ANNO = 2026 * 1e7

function ev(
  tipo: 'CARICO' | 'SCARICO',
  id: string,
  giorno: string,
  quantita: number,
  ordine = ANNO + 1,
  origine: 'MOVIMENTO' | 'APERTURA' = 'MOVIMENTO'
): EventoFifo {
  return { tipo, giorno, quantita, origine, ordine, riferimento: { id } }
}
const car = (id: string, giorno: string, q: number, ordine = ANNO + 1) => ({
  chiave: `M:${id}`,
  evento: ev('CARICO', id, giorno, q, ordine),
  residuo: q,
})
const sca = (id: string, giorno: string, q: number, ordine = ANNO + 5) => ({
  radiceId: id,
  evento: ev('SCARICO', id, giorno, q, ordine),
  daCoprire: q,
})

describe('classeStoccaggio e classeAttesaScarico', () => {
  it('riconosce R13 e D15', () => {
    expect(classeStoccaggio('R13')).toBe('R13')
    expect(classeStoccaggio(' r 13 ')).toBe('R13')
    expect(classeStoccaggio('R.13')).toBe('R13')
    expect(classeStoccaggio('D15')).toBe('D15')
    for (const v of ['R1', 'R130', '', null, undefined]) expect(classeStoccaggio(v)).toBeNull()
  })
  it('classe attesa dello scarico', () => {
    expect(classeAttesaScarico('R4', null)).toBe('R13')
    expect(classeAttesaScarico('D9', null)).toBe('D15')
    expect(classeAttesaScarico(null, 'R')).toBe('R13')
    expect(classeAttesaScarico('R13', 'D')).toBe('R13')
    expect(classeAttesaScarico(null, null)).toBeNull()
    expect(classeAttesaScarico('R13/R4', null)).toBe('R13')
    expect(classeAttesaScarico('r 4', 'D')).toBe('R13')
    expect(classeAttesaScarico('D15 R4', null)).toBe('D15')
    expect(classeAttesaScarico('R4 bis', null)).toBe('R13')
  })
})

describe('proponiAbbinamenti', () => {
  it('scarico che copre due carichi', () => {
    const r = proponiAbbinamenti({
      carichi: [car('C1', '2026-03-01', 100), car('C2', '2026-03-05', 100, ANNO + 2)],
      scarichi: [sca('S', '2026-03-10', 150)],
    })
    expect(r.righe).toEqual([
      { scaricoRadiceId: 'S', carico: 'M:C1', quantita: 100 },
      { scaricoRadiceId: 'S', carico: 'M:C2', quantita: 50 },
    ])
    expect(r.scoperti.size).toBe(0)
  })
  it('un carico successivo non copre lo scarico', () => {
    const r = proponiAbbinamenti({
      carichi: [car('C1', '2026-03-01', 100), car('C2', '2026-03-05', 100, ANNO + 2)],
      scarichi: [sca('S', '2026-03-03', 150)],
    })
    expect(r.righe).toEqual([{ scaricoRadiceId: 'S', carico: 'M:C1', quantita: 100 }])
    expect(r.scoperti.get('S')).toBe(50)
  })
  it('due scarichi consumano in FIFO', () => {
    const r = proponiAbbinamenti({
      carichi: [car('C1', '2026-03-01', 100), car('C2', '2026-03-02', 100, ANNO + 2)],
      scarichi: [sca('S2', '2026-03-12', 80, ANNO + 7), sca('S1', '2026-03-10', 60, ANNO + 6)],
    })
    expect(r.righe).toEqual([
      { scaricoRadiceId: 'S1', carico: 'M:C1', quantita: 60 },
      { scaricoRadiceId: 'S2', carico: 'M:C1', quantita: 40 },
      { scaricoRadiceId: 'S2', carico: 'M:C2', quantita: 40 },
    ])
  })
  it('residui gia ridotti', () => {
    const c1 = { ...car('C1', '2026-03-01', 100), residuo: 30 }
    const r = proponiAbbinamenti({
      carichi: [c1, car('C2', '2026-03-02', 100, ANNO + 2)],
      scarichi: [sca('S', '2026-03-10', 50)],
    })
    expect(r.righe).toEqual([
      { scaricoRadiceId: 'S', carico: 'M:C1', quantita: 30 },
      { scaricoRadiceId: 'S', carico: 'M:C2', quantita: 20 },
    ])
  })
  it('salta carichi con residuo 0 e scarichi con daCoprire 0', () => {
    const c0 = { ...car('C0', '2026-03-01', 100), residuo: 0 }
    const s0 = { ...sca('S0', '2026-03-09', 10), daCoprire: 0 }
    const r = proponiAbbinamenti({
      carichi: [c0, car('C1', '2026-03-02', 100, ANNO + 2)],
      scarichi: [s0, sca('S', '2026-03-10', 20)],
    })
    expect(r.righe).toEqual([{ scaricoRadiceId: 'S', carico: 'M:C1', quantita: 20 }])
    expect(r.scoperti.size).toBe(0)
  })
  it('millesimi: 0,1 x 3 contro 0,3 e ordine di input irrilevante', () => {
    const carichi = [0, 1, 2].map(i => car(`C${i}`, '2026-03-01', 0.1, ANNO + i + 1))
    const scarichi = [sca('S', '2026-03-02', 0.3)]
    const a = proponiAbbinamenti({ carichi, scarichi })
    const b = proponiAbbinamenti({ carichi: [...carichi].reverse(), scarichi })
    expect(a.scoperti.size).toBe(0)
    expect(a.righe.map(x => x.quantita)).toEqual([0.1, 0.1, 0.1])
    expect(b).toEqual(a)
  })
})

describe('residui', () => {
  it('sottrae le righe dal vigente', () => {
    const c: CaricoAbbinabile = {
      chiave: 'M:C1',
      evento: ev('CARICO', 'C1', '2026-03-01', 100),
      classe: 'R13',
      numero: '1/2026',
    }
    const m = residui(
      [c],
      [
        { scaricoRadiceId: 'S', carico: 'M:C1', quantita: 0.3, origine: 'MANUALE' },
        { scaricoRadiceId: 'T', carico: 'M:C1', quantita: 0.4, origine: 'AUTOMATICO' },
      ]
    )
    expect(m.get('M:C1')).toBe(99.3)
  })
})

describe('validaRigheManuali', () => {
  const c1: CaricoAbbinabile = {
    chiave: 'M:C1',
    evento: ev('CARICO', 'C1', '2026-03-01', 100),
    classe: 'R13',
    numero: '3/2026',
  }
  const c2: CaricoAbbinabile = {
    chiave: 'M:C2',
    evento: ev('CARICO', 'C2', '2026-03-20', 100, ANNO + 2),
    classe: 'D15',
    numero: '4/2026',
  }
  const g: CaricoAbbinabile = {
    chiave: 'A:G',
    evento: ev('CARICO', 'G', '2026-03-25', 100, 0, 'APERTURA'),
    classe: null,
  }
  const s: ScaricoAbbinabile = {
    radiceId: 'S',
    evento: ev('SCARICO', 'S', '2026-03-10', 50, ANNO + 5),
    classeAttesa: 'R13',
    numero: '9/2026',
  }
  const residuo = new Map([
    ['M:C1', 100],
    ['M:C2', 100],
    ['A:G', 100],
  ])
  const val = (righe: Array<{ carico: string; quantita: number }>, sc = s) =>
    validaRigheManuali({
      scarico: sc,
      righe,
      candidati: [c1, c2, g],
      residuoEsclusoScarico: residuo,
    })

  it('riga valida: nessun errore', () => {
    expect(val([{ carico: 'M:C1', quantita: 50 }])).toEqual({ errori: [], avvisi: [] })
  })
  it('carico estraneo', () => {
    expect(val([{ carico: 'M:X', quantita: 5 }]).errori).toEqual([
      'Il carico indicato non appartiene a questo rifiuto e registro.',
    ])
  })
  it('carico successivo', () => {
    expect(val([{ carico: 'M:C2', quantita: 5 }]).errori).toEqual([
      'Il carico n. 4/2026 è successivo allo scarico: si possono abbinare solo carichi con data uguale o precedente.',
    ])
    expect(val([{ carico: 'A:G', quantita: 5 }]).errori).toEqual([
      'La giacenza iniziale del 25/03/2026 è successiva allo scarico: si possono abbinare solo carichi con data uguale o precedente.',
    ])
  })
  it('quantita non valida', () => {
    const msg = 'La quantità deve essere maggiore di zero, con al massimo 3 decimali.'
    expect(val([{ carico: 'M:C1', quantita: 0 }]).errori).toContain(msg)
    expect(val([{ carico: 'M:C1', quantita: -1 }]).errori).toContain(msg)
    expect(val([{ carico: 'M:C1', quantita: 1.2345 }]).errori).toContain(msg)
  })
  it('carico duplicato', () => {
    expect(
      val([
        { carico: 'M:C1', quantita: 10 },
        { carico: 'M:C1', quantita: 10 },
      ]).errori
    ).toEqual(['Lo stesso carico è indicato due volte.'])
  })
  it('totale oltre lo scarico', () => {
    expect(
      val([
        { carico: 'M:C1', quantita: 40 },
        { carico: 'A:G', quantita: 20 },
      ]).errori
    ).toContain('Il totale abbinato (60) supera la quantità dello scarico (50).')
  })
  it('residuo insufficiente', () => {
    const r = validaRigheManuali({
      scarico: s,
      righe: [{ carico: 'M:C1', quantita: 30 }],
      candidati: [c1],
      residuoEsclusoScarico: new Map([['M:C1', 20.5]]),
    })
    expect(r.errori).toEqual(['Il carico n. 3/2026 ha un residuo di 20,5: non basta per 30.'])
  })
  it('elenco vuoto: avviso dedicato, non il parziale', () => {
    expect(val([])).toEqual({ errori: [], avvisi: ['Lo scarico resta senza abbinamento.'] })
  })
  it('tutte le righe invalide: nessun parziale', () => {
    const r = val([{ carico: 'M:C1', quantita: 0 }])
    expect(r.errori).toHaveLength(1)
    expect(r.avvisi).toEqual(['Lo scarico resta senza abbinamento.'])
  })
  it('carico senza numero: ripiego con la data', () => {
    const senza: CaricoAbbinabile = { ...c1, chiave: 'M:N', numero: undefined }
    const r = validaRigheManuali({
      scarico: s,
      righe: [{ carico: 'M:N', quantita: 30 }],
      candidati: [senza],
      residuoEsclusoScarico: new Map([['M:N', 20]]),
    })
    expect(r.errori).toEqual(['Il carico del 01/03/2026 ha un residuo di 20: non basta per 30.'])
  })
  it('avvisi: classe diversa e parziale', () => {
    const sd = {
      ...s,
      evento: ev('SCARICO', 'S', '2026-03-30', 50, ANNO + 5),
      classeAttesa: 'D15' as const,
    }
    expect(val([{ carico: 'M:C1', quantita: 20 }], sd).avvisi).toEqual([
      "Il carico n. 3/2026 è in stoccaggio R13, lo scarico è un'operazione D15.",
      'Abbinamento parziale: restano 30 da abbinare.',
    ])
  })
})

describe('stati', () => {
  it('scarico', () => {
    expect(statoScarico(100, 0)).toBe('NON_ABBINATO')
    expect(statoScarico(100, 40)).toBe('PARZIALE')
    expect(statoScarico(100, 100)).toBe('ABBINATO')
    expect(statoScarico(100, 100.001)).toBe('INCOERENTE')
    expect(statoScarico(100, 99.9995)).toBe('ABBINATO')
    expect(statoScarico(100, 99.999)).toBe('PARZIALE')
  })
  it('carico', () => {
    expect(statoCarico(100, 0)).toBe('APERTO')
    expect(statoCarico(100, 99.999)).toBe('APERTO')
    expect(statoCarico(100, 100)).toBe('ESAURITO')
    expect(statoCarico(100, 100.001)).toBe('INCOERENTE')
    expect(statoCarico(100, 99.9995)).toBe('ESAURITO')
  })
})

describe('confrontaAbbinamenti', () => {
  const r = (s: string, c: string, q: number) => ({ scaricoRadiceId: s, carico: c, quantita: q })
  it('uguali: nessuna differenza', () => {
    expect(confrontaAbbinamenti([r('S', 'M:A', 5)], [r('S', 'M:A', 5)])).toEqual([])
  })
  it('quantita diverse e righe presenti da una parte sola, ordinate', () => {
    expect(
      confrontaAbbinamenti(
        [r('S2', 'M:B', 1), r('S1', 'M:A', 5), r('S1', 'M:C', 2)],
        [r('S1', 'M:A', 4), r('S3', 'M:A', 7), r('S2', 'M:B', 1)]
      )
    ).toEqual([
      { scaricoRadiceId: 'S1', carico: 'M:A', quantitaA: 5, quantitaB: 4 },
      { scaricoRadiceId: 'S1', carico: 'M:C', quantitaA: 2, quantitaB: 0 },
      { scaricoRadiceId: 'S3', carico: 'M:A', quantitaA: 0, quantitaB: 7 },
    ])
  })
})
