import {
  calendarioAutomatico,
  periodoCompetenza,
  scadenzeNelPeriodo,
  validaScadenze,
  type Scadenza,
} from './scadenze-fisse'

const sc = (
  ordine: number,
  giorno: number,
  mese: number,
  anno: number | null = null
): Scadenza => ({
  ordine,
  giorno,
  mese,
  anno,
})
const NESSUN_EXTRA = { dal: null, al: null }

describe('validaScadenze', () => {
  it('29/02 con anno vuoto e con 2024 sono valide, con 2025 no', () => {
    expect(validaScadenze([sc(1, 29, 2)], null, NESSUN_EXTRA)).toEqual([])
    expect(validaScadenze([sc(1, 29, 2, 2024)], null, NESSUN_EXTRA)).toEqual([])
    expect(validaScadenze([sc(1, 29, 2, 2025)], null, NESSUN_EXTRA)).toEqual([
      'Scadenza 1: data non valida.',
    ])
  })

  it('31/04 non è valida', () => {
    expect(validaScadenze([sc(1, 31, 4)], null, NESSUN_EXTRA)).toEqual([
      'Scadenza 1: data non valida.',
    ])
  })

  it('rifiuta il doppione, anche fra anno vuoto e anno esplicito', () => {
    expect(validaScadenze([sc(1, 15, 3), sc(2, 15, 3)], null, NESSUN_EXTRA)).toEqual([
      'Scadenza 2: data ripetuta (uguale alla scadenza 1).',
    ])
    expect(validaScadenze([sc(1, 15, 3), sc(2, 15, 3, 2026)], null, NESSUN_EXTRA)).toHaveLength(1)
    expect(validaScadenze([sc(1, 15, 3, 2026), sc(2, 15, 3, 2027)], null, NESSUN_EXTRA)).toEqual([])
  })

  it('al massimo 12 scadenze, ordine 1-12 non ripetuto, date in ordine', () => {
    const tredici = Array.from({ length: 13 }, (_, i) => sc(i + 1, 1, (i % 12) + 1, 2000 + i))
    expect(validaScadenze(tredici, null, NESSUN_EXTRA)).toContain('Al massimo 12 scadenze.')
    expect(validaScadenze([sc(1, 1, 1), sc(1, 1, 2)], null, NESSUN_EXTRA)).toContain(
      "Scadenza 2: il numero d'ordine 1 è ripetuto."
    )
    expect(validaScadenze([sc(0, 1, 1)], null, NESSUN_EXTRA)).toContain(
      "Scadenza 1: il numero d'ordine deve essere da 1 a 12."
    )
    expect(validaScadenze([sc(1, 1, 5), sc(2, 1, 3)], null, NESSUN_EXTRA)).toEqual([
      'Scadenza 2: le scadenze vanno in ordine di data.',
    ])
  })

  it('XA, XD e YC senza periodo extra: messaggio; con periodo valido: nessun errore', () => {
    for (const p of ['XA', 'XD', 'YC'] as const) {
      expect(validaScadenze([sc(1, 1, 1)], p, NESSUN_EXTRA)).toEqual([
        'Per una scadenza extra indica il periodo dal … al ….',
      ])
      expect(validaScadenze([sc(1, 1, 1)], p, { dal: '2026-01-01', al: '2026-03-31' })).toEqual([])
    }
    expect(validaScadenze([], 'XA', { dal: '2026-01-01', al: null })).toHaveLength(1)
  })

  it('periodo extra con date incoerenti o su un periodo ordinario', () => {
    expect(validaScadenze([], 'XA', { dal: '2026-04-01', al: '2026-03-31' })).toEqual([
      "Il periodo extra non è valido: l'inizio non può seguire la fine.",
    ])
    expect(validaScadenze([], 'XA', { dal: '2026-02-30', al: '2026-03-31' })).toEqual([
      'Il periodo extra non è valido: le date non sono corrette.',
    ])
    expect(validaScadenze([], 'TA', { dal: '2026-01-01', al: '2026-03-31' })).toEqual([
      'Il periodo extra si indica solo per una scadenza extra.',
    ])
    expect(validaScadenze([], null, { dal: '2026-01-01', al: null })).toHaveLength(1)
    expect(validaScadenze([sc(1, 1, 1)], 'TA', NESSUN_EXTRA)).toEqual([])
  })
})

describe('calendarioAutomatico', () => {
  const date = (r: ReturnType<typeof calendarioAutomatico>): string[] =>
    'scadenze' in r ? r.scadenze.map(x => `${x.giorno}/${x.mese}/${x.anno}`) : [r.errore]

  it('trimestrale da 15/02 con anno vuoto', () => {
    expect(date(calendarioAutomatico({ giorno: 15, mese: 2, anno: null }, 'TRIMESTRALE'))).toEqual([
      '15/2/null',
      '15/5/null',
      '15/8/null',
      '15/11/null',
    ])
  })

  it('trimestrale da 15/04 con anno vuoto: errore di E19', () => {
    expect(calendarioAutomatico({ giorno: 15, mese: 4, anno: null }, 'TRIMESTRALE')).toEqual({
      errore:
        'Con scadenze trimestrali e anno vuoto la prima data va tra il 1° gennaio e il 31 marzo.',
    })
  })

  it('messaggi di E19 per ogni frequenza con anno vuoto', () => {
    const e = (f: Parameters<typeof calendarioAutomatico>[1], mese: number): string =>
      date(calendarioAutomatico({ giorno: 1, mese, anno: null }, f))[0]
    expect(e('MENSILE', 2)).toBe('Con scadenze mensili e anno vuoto la prima data va in gennaio.')
    expect(e('BIMESTRALE', 3)).toBe(
      'Con scadenze bimestrali e anno vuoto la prima data va in gennaio o febbraio.'
    )
    expect(e('QUADRIMESTRALE', 5)).toBe(
      'Con scadenze quadrimestrali e anno vuoto la prima data va tra il 1° gennaio e il 30 aprile.'
    )
    expect(e('SEMESTRALE', 7)).toBe(
      'Con scadenze semestrali e anno vuoto la prima data va tra il 1° gennaio e il 30 giugno.'
    )
  })

  it('mensile da 31/01/2026: fine mese se il giorno manca', () => {
    const r = calendarioAutomatico({ giorno: 31, mese: 1, anno: 2026 }, 'MENSILE')
    expect(date(r).slice(0, 4)).toEqual(['31/1/2026', '28/2/2026', '31/3/2026', '30/4/2026'])
    expect('scadenze' in r && r.scadenze.map(x => x.ordine)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
  })

  it('anno vuoto: il 28/02 e non il 29 (vale in ogni anno)', () => {
    expect(date(calendarioAutomatico({ giorno: 31, mese: 1, anno: null }, 'MENSILE'))[1]).toBe(
      '28/2/null'
    )
  })

  it('anno bisestile: 29/02', () => {
    expect(date(calendarioAutomatico({ giorno: 31, mese: 1, anno: 2028 }, 'MENSILE'))[1]).toBe(
      '29/2/2028'
    )
  })

  it("con anno esplicito il calendario passa all'anno dopo", () => {
    expect(date(calendarioAutomatico({ giorno: 10, mese: 11, anno: 2026 }, 'TRIMESTRALE'))).toEqual(
      ['10/11/2026', '10/2/2027', '10/5/2027', '10/8/2027']
    )
  })

  it('numero di scadenze per frequenza', () => {
    const n = (f: Parameters<typeof calendarioAutomatico>[1]): number => {
      const r = calendarioAutomatico({ giorno: 1, mese: 1, anno: null }, f)
      return 'scadenze' in r ? r.scadenze.length : -1
    }
    expect([
      n('MENSILE'),
      n('BIMESTRALE'),
      n('TRIMESTRALE'),
      n('QUADRIMESTRALE'),
      n('SEMESTRALE'),
    ]).toEqual([12, 6, 4, 3, 2])
  })

  it('prima data non valida', () => {
    expect(calendarioAutomatico({ giorno: 31, mese: 4, anno: null }, 'MENSILE')).toEqual({
      errore: 'La prima scadenza non è una data valida.',
    })
  })
})

describe('periodoCompetenza', () => {
  it('TA su 01/04: 01/04-30/06', () => {
    expect(periodoCompetenza(sc(1, 1, 4), 'TA', 2026)).toEqual({
      dal: '2026-04-01',
      al: '2026-06-30',
    })
  })
  it('TP su 30/06: 01/04-30/06', () => {
    expect(periodoCompetenza(sc(1, 30, 6), 'TP', 2026)).toEqual({
      dal: '2026-04-01',
      al: '2026-06-30',
    })
  })
  it('mensile, febbraio bisestile', () => {
    expect(periodoCompetenza(sc(1, 10, 2), 'MP', 2028)).toEqual({
      dal: '2028-02-01',
      al: '2028-02-29',
    })
    expect(periodoCompetenza(sc(1, 10, 2), 'MP', 2026)).toEqual({
      dal: '2026-02-01',
      al: '2026-02-28',
    })
  })
  it("anticipato a cavallo d'anno e posticipato all'indietro", () => {
    expect(periodoCompetenza(sc(1, 1, 11), 'TA', 2026)).toEqual({
      dal: '2026-11-01',
      al: '2027-01-31',
    })
    expect(periodoCompetenza(sc(1, 31, 1), 'TP', 2026)).toEqual({
      dal: '2025-11-01',
      al: '2026-01-31',
    })
  })
  it('annuale e biennale', () => {
    expect(periodoCompetenza(sc(1, 1, 1), 'AA', 2026)).toEqual({
      dal: '2026-01-01',
      al: '2026-12-31',
    })
    expect(periodoCompetenza(sc(1, 31, 12), 'AP', 2026)).toEqual({
      dal: '2026-01-01',
      al: '2026-12-31',
    })
    expect(periodoCompetenza(sc(1, 1, 3), 'DA', 2026)).toEqual({
      dal: '2026-03-01',
      al: '2028-02-29',
    })
    expect(periodoCompetenza(sc(1, 28, 2), 'DP', 2026)).toEqual({
      dal: '2024-03-01',
      al: '2026-02-28',
    })
  })
  it("anno della scadenza esplicito e diverso dall'anno richiesto: null", () => {
    expect(periodoCompetenza(sc(1, 1, 4, 2025), 'TA', 2026)).toBeNull()
    expect(periodoCompetenza(sc(1, 1, 4, 2026), 'TA', 2026)).not.toBeNull()
  })
  it('periodi extra: null (li dà il periodo extra della riga)', () => {
    expect(periodoCompetenza(sc(1, 1, 4), 'XA', 2026)).toBeNull()
    expect(periodoCompetenza(sc(1, 1, 4), 'YC', 2026)).toBeNull()
  })
})

describe('scadenzeNelPeriodo', () => {
  const contratto = { dataInizio: '2026-03-01', dataFine: '2027-06-30' }
  const dati = (r: ReturnType<typeof scadenzeNelPeriodo>): string[] =>
    r.map(x => `${x.scadenza.ordine}:${x.data}`)

  it("esclude le scadenze fuori dal contratto e fuori dall'intervallo", () => {
    const s = [sc(1, 15, 2), sc(2, 15, 5), sc(3, 15, 9), sc(4, 15, 12)]
    expect(dati(scadenzeNelPeriodo(s, '2026-01-01', '2026-12-31', contratto))).toEqual([
      '2:2026-05-15',
      '3:2026-09-15',
      '4:2026-12-15',
    ])
    expect(dati(scadenzeNelPeriodo(s, '2026-04-01', '2026-06-30', contratto))).toEqual([
      '2:2026-05-15',
    ])
  })

  it("l'anno vuoto vale per ogni anno dell'intervallo; l'anno esplicito solo per il suo", () => {
    const s = [sc(1, 15, 5), sc(2, 20, 5, 2027)]
    expect(dati(scadenzeNelPeriodo(s, '2026-01-01', '2027-12-31', contratto))).toEqual([
      '1:2026-05-15',
      '1:2027-05-15',
      '2:2027-05-20',
    ])
  })

  it('contratto senza fine; 29/02 non bisestile scivola al 28/02', () => {
    const aperto = { dataInizio: '2026-01-01', dataFine: null }
    expect(dati(scadenzeNelPeriodo([sc(1, 29, 2)], '2027-01-01', '2028-12-31', aperto))).toEqual([
      '1:2027-02-28',
      '1:2028-02-29',
    ])
  })

  it('contratto che finisce prima; intervallo invertito', () => {
    expect(scadenzeNelPeriodo([sc(1, 15, 5)], '2028-01-01', '2028-12-31', contratto)).toEqual([])
    expect(scadenzeNelPeriodo([sc(1, 15, 5)], '2026-12-31', '2026-01-01', contratto)).toEqual([])
  })

  it('ordina per data poi per ordine', () => {
    const r = scadenzeNelPeriodo([sc(2, 1, 8), sc(1, 1, 3)], '2026-01-01', '2026-12-31', {
      dataInizio: '2026-01-01',
      dataFine: null,
    })
    expect(dati(r)).toEqual(['1:2026-03-01', '2:2026-08-01'])
  })
})
