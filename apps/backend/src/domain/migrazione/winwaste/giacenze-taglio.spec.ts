import { calcolaGiacenzeAlTaglio, IngressiGiacenze } from './giacenze-taglio'
import { decodificaOper } from './oper'
import { RecordGiacenzaRifiuti, RecordMovimento } from './record'
import { SegmentoRelaz } from './relaz'

/**
 * I6 T1: ricalcolo puro della giacenza al taglio. Fixture SINTETICHE costruite da `docs/giacenze.md`
 * §2.1-2.3, §4.1-4.2 e §6-7 (nessun `.bak`).
 */
const REG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const REG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TAGLIO = '2026-12-31'
const MAG: Record<string, string> = { '001': REG_A, '002': REG_B, REG1: REG_A }
const registroDi = (c: string): string | null => MAG[c] ?? null

interface Mov {
  cod: number
  oper: string
  data?: string
  mag1?: string
  mag2?: string
  moda?: string
  cer?: string
  pericoloso?: boolean
  sf?: string
  netto?: number
  giascar?: number | null
  relaz?: SegmentoRelaz[]
  registri?: Array<{ registro: string; protocollo: number | null }>
  annullato?: boolean
  stato?: string
}

function mov(m: Mov): RecordMovimento {
  const oper = decodificaOper(m.oper)
  if (!oper.ok) throw new Error('OPER di prova non valido')
  return {
    tabella: 'MOVIMENTI',
    cod: m.cod,
    riga: m.cod,
    legacyKey: `0001|2026|MOVIMENTI|${m.cod}`,
    annullato: m.annullato ?? false,
    causaAnnullo: null,
    data: m.data ?? '2026-03-10',
    causale: 'X',
    oper: oper.valore,
    posizione: '',
    dataRegistrazione: null,
    cliente: '',
    contratto: '',
    produttore: null,
    trasportatore: null,
    destinatario: null,
    intermediario: null,
    mag1: m.mag1 ?? '001',
    mag2: m.mag2 ?? '',
    moda: m.moda ?? '',
    cer: { codice: m.cer ?? '15 01 01', pericoloso: m.pericoloso ?? false },
    tipologia: '',
    statoFisico: m.sf ?? '',
    nettoKg: m.netto ?? 0,
    volumeM3: null,
    lordoKg: null,
    taraKg: null,
    c4: null,
    relaz: m.relaz ?? [],
    avvisi: [],
    grezzo: {},
    registri: m.registri ?? [],
    kgnum: m.netto ?? 0,
    mcnum: null,
    giascar: m.giascar ?? null,
    stato: m.stato ?? '',
    nfatt: '',
  }
}

const C = (
  cod: number,
  kg: number,
  classe: 'T' | 'R' | 'r' | 'D' | 'd' | 'X' = 'R'
): SegmentoRelaz => ({
  tipo: 'C',
  cod,
  classe,
  kg,
  m3: 0,
})
const P = (
  cod: number,
  kg: number,
  classe: 'T' | 'R' | 'r' | 'D' | 'd' | 'X' = 'R'
): SegmentoRelaz => ({
  tipo: 'P',
  cod,
  classe,
  kg,
  m3: 0,
})
const G = (
  riga: 0 | 1 | 2 | 3 | 4 | 5,
  kg: number,
  classe: 'T' | 'R' | 'r' | 'D' | 'd' | 'X'
): SegmentoRelaz => ({ tipo: 'G', riga, classe, kg, m3: 0 })

function riga(
  o: Partial<{
    ul: string
    mag: string
    cer: string
    sf: string
    RR: number
    RL: number
    DR: number
    DL: number
    DT: number
  }>
): RecordGiacenzaRifiuti {
  const ul = o.ul ?? '10001'
  const g = (k: number | undefined) => ({ kg: k ?? 0, m3: 0 })
  return {
    tabella: 'GIACENZE RIFIUTI',
    riga: 1,
    chiaveNaturale: `${ul}|${o.mag ?? '001'}||${o.cer ?? '150101'}|${o.sf ?? ''}|`,
    ul,
    mag: o.mag ?? '001',
    pos: '',
    cer: o.cer ?? '150101',
    sf: o.sf ?? '',
    rif: '',
    compensazione: ul.startsWith('8'),
    giacenze: { RR: g(o.RR), RL: g(o.RL), DR: g(o.DR), DL: g(o.DL), DT: g(o.DT) },
    grezzo: {},
  }
}

function calcola(i: Partial<IngressiGiacenze>) {
  return calcolaGiacenzeAlTaglio({
    movimenti: [],
    righeGiacenza: [],
    dataTaglio: TAGLIO,
    registroDi,
    ...i,
  })
}
const avviso = (r: ReturnType<typeof calcola>, c: string) =>
  r.avvisi.find(a => a.codice === c)?.conteggio ?? 0
const scarto = (r: ReturnType<typeof calcola>, c: string) =>
  r.scarti.find(a => a.codice === c)?.conteggio ?? 0

describe('I6 T1: giacenza al taglio (ricalcolo indipendente)', () => {
  it('carico aperto: residuo = netto meno i segmenti C degli scarichi; origine con anno e protocollo', () => {
    const r = calcola({
      movimenti: [
        mov({
          cod: 1,
          oper: '20',
          mag2: '001',
          moda: 'R13',
          netto: 1000,
          giascar: 400,
          registri: [{ registro: 'REG1', protocollo: 12 }],
        }),
        mov({ cod: 2, oper: '21', relaz: [C(1, 400)], netto: 400 }),
      ],
    })
    expect(r.famiglie).toHaveLength(1)
    expect(r.famiglie[0]).toMatchObject({
      registroId: REG_A,
      cerCode: '15 01 01',
      statoFisico: null,
      quantitaKg: 600,
      origini: [{ anno: 2026, protocollo: 12, quantita: 600 }],
    })
    expect(r.differenzeGiascar).toEqual([])
  })

  it('differenza GIASCAR: nel rapporto con i due valori, mai corretta in silenzio', () => {
    const r = calcola({
      movimenti: [
        mov({ cod: 7, oper: '20', mag2: '001', moda: 'R13', netto: 1000, giascar: 250 }),
        mov({ cod: 8, oper: '21', relaz: [C(7, 400)], netto: 400 }),
        // entro la soglia di 0,001 kg: nessuna differenza
        mov({ cod: 9, oper: '20', mag2: '001', moda: 'D15', netto: 50, giascar: 0.0005 }),
      ],
    })
    expect(r.differenzeGiascar).toEqual([{ cod: 7, giascarKg: 250, ricalcolatoKg: 400 }])
    // il residuo caricato e' quello RICALCOLATO da RELAZ
    expect(r.famiglie[0].quantitaKg).toBe(650)
  })

  it('i segmenti degli scarichi oltre il taglio non riducono il residuo al taglio ma contano per GIASCAR', () => {
    const r = calcola({
      dataTaglio: '2026-06-30',
      movimenti: [
        mov({ cod: 1, oper: '20', mag2: '001', moda: 'R13', netto: 1000, giascar: 300 }),
        mov({ cod: 2, oper: '21', data: '2026-06-01', relaz: [C(1, 100)], netto: 100 }),
        mov({ cod: 3, oper: '21', data: '2026-09-01', relaz: [C(1, 200)], netto: 200 }),
        // carico dopo il taglio: non e' di I6
        mov({ cod: 4, oper: '20', data: '2026-07-01', mag2: '001', moda: 'R13', netto: 500 }),
      ],
    })
    expect(r.famiglie[0].quantitaKg).toBe(900)
    expect(r.differenzeGiascar).toEqual([])
    expect(avviso(r, 'CARICO_DOPO_IL_TAGLIO')).toBe(1)
  })

  it('annullati ignorati; magazzino del carico: T e X da MAG1, R/D da MAG2', () => {
    const r = calcola({
      movimenti: [
        mov({ cod: 1, oper: '10', mag1: '001', mag2: '002', netto: 100 }), // T: mag1 -> A
        mov({ cod: 2, oper: '14', mag1: '001', mag2: '002', moda: 'D15', netto: 70 }), // R/D: mag2 -> B
        mov({ cod: 3, oper: '10', mag1: '001', netto: 999, annullato: true }),
      ],
    })
    expect(r.famiglie.map(f => [f.registroId, f.quantitaKg])).toEqual([
      [REG_A, 100],
      [REG_B, 70],
    ])
  })

  it('giacenza iniziale: riga normale meno i segmenti G e P degli scarichi, per classe', () => {
    const r = calcola({
      righeGiacenza: [riga({ RR: 500, DR: 100, DT: 40 })],
      movimenti: [
        // scarico che usa G1 (R13 da terzi) e un carico dell'anno precedente (P, anche R)
        mov({ cod: 1, oper: '21', relaz: [G(1, 120, 'R'), P(55, 30, 'R')], netto: 150 }),
        mov({ cod: 2, oper: '11', relaz: [G(5, 10, 'T')], netto: 10 }),
      ],
    })
    expect(r.famiglie).toHaveLength(1)
    // (500-120-30) + 100 + (40-10) = 480
    expect(r.famiglie[0].quantitaKg).toBe(480)
    expect(r.famiglie[0].origini).toEqual([])
    expect(avviso(r, 'ORIGINI_APERTURA_NON_NOTE')).toBe(1)
  })

  it('compensazione: un residuo negativo da terzi si compensa con quello da nostre lavorazioni (R con R, D con D)', () => {
    const r = calcola({
      righeGiacenza: [riga({ RR: 100, RL: 300, DR: 50, DL: 80 })],
      movimenti: [mov({ cod: 1, oper: '21', relaz: [G(1, 150, 'R'), G(3, 20, 'D')], netto: 170 })],
    })
    // RR: 100-150 = -50 compensato da RL 300 -> RL 250; D: 30 + 80
    expect(r.famiglie[0].quantitaKg).toBe(250 + 30 + 80)
    expect(avviso(r, 'GIACENZA_INIZIALE_NEGATIVA')).toBe(0)
  })

  it("un residuo negativo non compensabile non e' caricato e si segnala (D8)", () => {
    const r = calcola({
      righeGiacenza: [riga({ RR: 100, DR: 80 })],
      movimenti: [mov({ cod: 1, oper: '21', relaz: [G(1, 130, 'R')], netto: 130 })],
    })
    // RR: -30 (nessuna RL per compensare) -> 0 con avviso; DR: 80 resta
    expect(r.famiglie[0].quantitaKg).toBe(80)
    expect(avviso(r, 'GIACENZA_INIZIALE_NEGATIVA')).toBe(1)
  })

  it('modalita G e modalita P danno lo stesso totale; le righe di compensazione (UL che comincia per 8) non si sommano', () => {
    const normale = riga({ RR: 1000 })
    const compensazione = riga({ ul: '80001', RR: -300 })
    // modalita G: lo scarico consuma G1
    const g = calcola({
      righeGiacenza: [normale, compensazione],
      movimenti: [mov({ cod: 1, oper: '21', relaz: [G(1, 200, 'R')], netto: 200 })],
    })
    // modalita P: lo stesso scarico consuma 200 di un carico dell'anno precedente (P)
    const p = calcola({
      righeGiacenza: [normale, compensazione],
      movimenti: [mov({ cod: 1, oper: '21', relaz: [P(9, 200, 'R')], netto: 200 })],
    })
    expect(g.famiglie[0].quantitaKg).toBe(800)
    expect(p.famiglie[0].quantitaKg).toBe(800)
    expect(avviso(g, 'RIGHE_COMPENSAZIONE_NON_SOMMATE')).toBe(1)
  })

  it('apertura e carichi della stessa famiglia si sommano in una riga, con le origini dei soli carichi', () => {
    const r = calcola({
      righeGiacenza: [riga({ RR: 100 })],
      movimenti: [
        mov({
          cod: 1,
          oper: '20',
          mag2: '001',
          moda: 'R13',
          netto: 50,
          registri: [{ registro: 'REG1', protocollo: 3 }],
        }),
        mov({
          cod: 2,
          oper: '20',
          mag2: '001',
          moda: 'R13',
          netto: 25.5,
          registri: [{ registro: 'REG1', protocollo: 4 }],
        }),
        mov({ cod: 3, oper: '20', mag2: '001', moda: 'R13', netto: 10 }), // senza protocollo
      ],
    })
    expect(r.famiglie).toHaveLength(1)
    expect(r.famiglie[0].quantitaKg).toBe(185.5)
    expect(r.famiglie[0].origini).toEqual([
      { anno: 2026, protocollo: 3, quantita: 50 },
      { anno: 2026, protocollo: 4, quantita: 25.5 },
    ])
    expect(avviso(r, 'CARICO_SENZA_PROTOCOLLO')).toBe(1)
  })

  it("stato fisico e CER distinti restano famiglie distinte; pericoloso porta l'asterisco", () => {
    const r = calcola({
      movimenti: [
        mov({ cod: 1, oper: '20', mag2: '001', moda: 'R13', netto: 10, sf: 'S' }),
        mov({ cod: 2, oper: '20', mag2: '001', moda: 'R13', netto: 20, sf: 'L' }),
        mov({
          cod: 3,
          oper: '20',
          mag2: '001',
          moda: 'R13',
          netto: 30,
          cer: '13 02 05*',
          pericoloso: true,
        }),
      ],
    })
    expect(r.famiglie.map(f => [f.cerCode, f.statoFisico, f.quantitaKg])).toEqual([
      ['13 02 05*', null, 30],
      ['15 01 01', 'L', 20],
      ['15 01 01', 'S', 10],
    ])
  })

  it('magazzino non in mappa: non si carica e si conta fra gli scarti', () => {
    const r = calcola({
      righeGiacenza: [riga({ mag: '009', RR: 10 })],
      movimenti: [mov({ cod: 1, oper: '20', mag2: '009', moda: 'R13', netto: 10 })],
    })
    expect(r.famiglie).toEqual([])
    expect(scarto(r, 'MAGAZZINO_NON_IN_MAPPA')).toBe(2)
  })

  it('carichi senza classe di giacenza, ENTRAMBI, moda sconosciuta, deposito del produttore: segnalati', () => {
    const r = calcola({
      movimenti: [
        mov({ cod: 1, oper: '16', mag1: '001', netto: 10 }), // CARICO senza classe
        mov({ cod: 2, oper: '15', mag1: '001', netto: 10, relaz: [] }), // ENTRAMBI senza STATO
        mov({ cod: 3, oper: '20', mag2: '001', moda: '', netto: 10 }), // R/D senza moda
        mov({ cod: 4, oper: '50', mag1: '001', netto: 10 }), // X
        mov({ cod: 5, oper: '51', relaz: [G(0, 5, 'X')], netto: 5 }),
      ],
    })
    expect(avviso(r, 'CARICO_SENZA_CLASSE_DI_GIACENZA')).toBe(1)
    expect(avviso(r, 'OPERAZIONE_ENTRAMBI_NON_CONTATA_COME_CARICO')).toBe(1)
    expect(scarto(r, 'MODA_NON_RICONOSCIUTA')).toBe(1)
    expect(avviso(r, 'DEPOSITO_PRODUTTORE_APERTURA_NON_NELLO_STAGING')).toBe(1)
    // il carico X (OPER 50) e' contato (classe X, MAG1)
    expect(r.famiglie.map(f => f.quantitaKg)).toEqual([10])
  })

  it('carico scaricato oltre il netto: residuo 0 e avviso; quantita sotto il centesimo trascurate', () => {
    const r = calcola({
      movimenti: [
        mov({ cod: 1, oper: '20', mag2: '001', moda: 'R13', netto: 100 }),
        mov({ cod: 2, oper: '21', relaz: [C(1, 130)], netto: 130 }),
        mov({ cod: 3, oper: '20', mag2: '001', moda: 'R13', netto: 0.004, cer: '20 01 01' }),
      ],
    })
    expect(r.famiglie).toEqual([])
    expect(avviso(r, 'CARICO_SCARICATO_OLTRE_IL_NETTO')).toBe(1)
  })

  it('segmento C verso un carico inesistente: segnalato', () => {
    const r = calcola({
      movimenti: [mov({ cod: 2, oper: '21', relaz: [C(99, 10)], netto: 10 })],
    })
    expect(avviso(r, 'SEGMENTO_C_SENZA_CARICO')).toBe(1)
  })

  it('piu di 200 origini: quantita caricata, origini omesse con avviso', () => {
    const movimenti = Array.from({ length: 201 }, (_, i) =>
      mov({
        cod: i + 1,
        oper: '20',
        mag2: '001',
        moda: 'R13',
        netto: 1,
        registri: [{ registro: 'REG1', protocollo: i + 1 }],
      })
    )
    const r = calcola({ movimenti })
    expect(r.famiglie[0].quantitaKg).toBe(201)
    expect(r.famiglie[0].origini).toEqual([])
    expect(avviso(r, 'ORIGINI_OLTRE_IL_LIMITE')).toBe(1)
  })

  it('le origini non superano mai la quantita (arrotondamento al centesimo componente per componente)', () => {
    const r = calcola({
      movimenti: [
        mov({
          cod: 1,
          oper: '20',
          mag2: '001',
          moda: 'R13',
          netto: 0.333,
          registri: [{ registro: 'REG1', protocollo: 1 }],
        }),
        mov({
          cod: 2,
          oper: '20',
          mag2: '001',
          moda: 'R13',
          netto: 0.333,
          registri: [{ registro: 'REG1', protocollo: 2 }],
        }),
      ],
    })
    const f = r.famiglie[0]
    const somma = f.origini.reduce((t, o) => t + Math.round(o.quantita * 100), 0)
    expect(somma).toBeLessThanOrEqual(Math.round(f.quantitaKg * 100))
    expect(f.quantitaKg).toBe(0.66)
  })

  it('D1: OPER 13 e anche un carico R/D (MAG2): residuo = netto meno i segmenti C, nessun SEGMENTO_C_SENZA_CARICO', () => {
    const r = calcola({
      movimenti: [
        mov({ cod: 1, oper: '13', mag1: '001', mag2: '002', moda: 'R13', netto: 100, giascar: 40 }),
        mov({ cod: 2, oper: '21', relaz: [C(1, 40)], netto: 40 }),
      ],
    })
    expect(r.famiglie.map(f => [f.registroId, f.quantitaKg])).toEqual([[REG_B, 60]])
    expect(avviso(r, 'SEGMENTO_C_SENZA_CARICO')).toBe(0)
    expect(avviso(r, 'OPERAZIONE_ENTRAMBI_NON_CONTATA_COME_CARICO')).toBe(0)
    expect(r.differenzeGiascar).toEqual([])
  })

  it("D1: OPER 15/24 e 16/26 decidono il lato carico da STATO; senza classe resta l'avviso", () => {
    const r = calcola({
      movimenti: [
        mov({ cod: 1, oper: '24', mag2: '001', moda: 'D15', netto: 10, stato: 'D001' }),
        mov({ cod: 2, oper: '15', mag1: '001', netto: 20, stato: 'T001' }),
        mov({ cod: 3, oper: '15', mag1: '001', netto: 30, stato: '' }),
        mov({ cod: 4, oper: '16', mag1: '001', netto: 5, stato: 'T001' }),
        mov({ cod: 5, oper: '26', mag1: '001', netto: 7, stato: '' }),
      ],
    })
    expect(r.famiglie.map(f => f.quantitaKg)).toEqual([35])
    expect(avviso(r, 'OPERAZIONE_ENTRAMBI_NON_CONTATA_COME_CARICO')).toBe(1)
    expect(avviso(r, 'CARICO_SENZA_CLASSE_DI_GIACENZA')).toBe(1)
  })
})
