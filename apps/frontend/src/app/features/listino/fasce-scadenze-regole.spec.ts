// Spec delle copie lato frontend: i casi di `validaScaglioni`, `validaScadenze`,
// `calendarioAutomatico` e `periodoCompetenza` sono QUELLI del dominio del backend (Task 16a e 18),
// ripresi alla lettera (con `validaFasce(t, conCondizioni)` al posto di `validaScaglioni`), così
// una divergenza fra le due copie fa fallire il test. Poi i casi propri del frontend.
import {
  FrequenzaCalendario,
  calendarioAutomatico,
  dataItaliana,
  descrizioneFascia,
  periodoCompetenza,
  tipiAmmessi,
  validaFasce,
  validaScadenze,
} from './fasce-scadenze-regole'
import { Scadenza, Scaglione, TipoCalcoloScaglione } from './listino.model'

const validaScaglioni = (s: readonly Scaglione[], c: { conCondizioni: boolean }): string[] =>
  validaFasce(s, c.conCondizioni)

const sc = (
  ordine: number,
  finoA: string | null,
  prezzo: string,
  tipoCalcolo: TipoCalcoloScaglione,
  extra: Partial<Scaglione> = {}
): Scaglione => ({ ordine, finoA, prezzo, sconto: null, provvigione: null, tipoCalcolo, ...extra })

const tabella = (tipo: TipoCalcoloScaglione, ultimo: TipoCalcoloScaglione = tipo): Scaglione[] => [
  sc(1, '1000', '0.10', tipo),
  sc(2, '5000', '0.08', tipo),
  sc(7, null, '0.05', ultimo),
]

describe('validaScaglioni', () => {
  const ok = tabella('A')

  it('tabella valida: nessun messaggio', () => {
    expect(validaScaglioni(ok, { conCondizioni: false })).toEqual([])
  })

  it('tabella con tutte le sette righe valida', () => {
    const t = [
      sc(1, '10', '1', 'A'),
      sc(2, '20', '1', 'A'),
      sc(3, '30', '1', 'A'),
      sc(4, '40', '1', 'A'),
      sc(5, '50', '1', 'A'),
      sc(6, '60', '1', 'A'),
      sc(7, null, '1', 'E'),
    ]
    expect(validaScaglioni(t, { conCondizioni: false })).toEqual([])
  })

  it('con un buco fra le fasce', () => {
    const t = [
      sc(1, '10', '1', 'A'),
      sc(2, '20', '1', 'A'),
      sc(4, '40', '1', 'A'),
      sc(7, null, '1', 'A'),
    ]
    expect(validaScaglioni(t, { conCondizioni: false })).toContain(
      'Le fasce del prezzo speciale devono essere consecutive e con soglie crescenti.'
    )
  })

  it('soglie non crescenti', () => {
    const t = [sc(1, '100', '1', 'A'), sc(2, '100', '1', 'A'), sc(7, null, '1', 'A')]
    expect(validaScaglioni(t, { conCondizioni: false })).toContain(
      'Le fasce del prezzo speciale devono essere consecutive e con soglie crescenti.'
    )
    const t2 = [sc(1, '100', '1', 'A'), sc(2, '50', '1', 'A'), sc(7, null, '1', 'A')]
    expect(validaScaglioni(t2, { conCondizioni: false })).toContain(
      'Le fasce del prezzo speciale devono essere consecutive e con soglie crescenti.'
    )
  })

  it('riga 1 senza soglia o con soglia zero', () => {
    const msg =
      'La tabella del prezzo speciale è incompleta: ogni fascia ha soglia, prezzo e tipo di calcolo.'
    expect(
      validaScaglioni([sc(1, null, '1', 'A'), sc(7, null, '1', 'A')], { conCondizioni: false })
    ).toContain(msg)
    expect(validaScaglioni([sc(7, null, '1', 'A')], { conCondizioni: false })).toContain(msg)
    expect(
      validaScaglioni([sc(1, '0', '1', 'A'), sc(7, null, '1', 'A')], { conCondizioni: false })
    ).toContain('La prima fascia del prezzo speciale deve avere una soglia maggiore di zero.')
  })

  it('riga 7 senza prezzo o mancante', () => {
    const msg =
      'La tabella del prezzo speciale è incompleta: ogni fascia ha soglia, prezzo e tipo di calcolo.'
    expect(
      validaScaglioni([sc(1, '10', '1', 'A'), sc(7, null, '', 'A')], { conCondizioni: false })
    ).toContain(msg)
    expect(validaScaglioni([sc(1, '10', '1', 'A')], { conCondizioni: false })).toContain(msg)
  })

  it('fascia intermedia senza soglia o senza prezzo', () => {
    const msg =
      'La tabella del prezzo speciale è incompleta: ogni fascia ha soglia, prezzo e tipo di calcolo.'
    const t = [sc(1, '10', '1', 'A'), sc(2, null, '1', 'A'), sc(7, null, '1', 'A')]
    expect(validaScaglioni(t, { conCondizioni: false })).toContain(msg)
    const t2 = [sc(1, '10', '1', 'A'), sc(2, '20', '', 'A'), sc(7, null, '1', 'A')]
    expect(validaScaglioni(t2, { conCondizioni: false })).toContain(msg)
  })

  it('la riga 7 non ha soglia', () => {
    expect(
      validaScaglioni([sc(1, '10', '1', 'A'), sc(7, '99', '1', 'A')], { conCondizioni: false })
    ).toContain('L’ultima fascia del prezzo speciale è «oltre»: non ha soglia.')
  })

  it('ordine fuori da 1-7 o ripetuto', () => {
    const m = 'Le fasce del prezzo speciale sono al massimo sette, ciascuna con il proprio numero.'
    expect(validaScaglioni([...ok, sc(8, '99999', '1', 'A')], { conCondizioni: false })).toContain(
      m
    )
    expect(validaScaglioni([...ok, sc(2, '6000', '1', 'A')], { conCondizioni: false })).toContain(m)
  })

  it('dopo una fascia D o W non possono seguire fasce A o X (Q7)', () => {
    const msg = (n: number): string =>
      `Fascia ${n}: dopo una fascia «tutta la quantità» (D/W) non può seguire una fascia a prezzo per quantità (A/X), altrimenti la stessa quantità si pagherebbe due volte.`
    const msg1 = msg(7)
    expect(
      validaScaglioni([sc(1, '5000', '0.08', 'D'), sc(7, null, '0.05', 'A')], {
        conCondizioni: false,
      })
    ).toEqual([msg1])
    expect(
      validaScaglioni([sc(1, '10', '1', 'W'), sc(2, '20', '1', 'X'), sc(7, null, '1', 'B')], {
        conCondizioni: true,
      })
    ).toEqual([msg(2)])
    expect(
      validaScaglioni([sc(1, '5000', '0.08', 'D'), sc(7, null, '0.05', 'E')], {
        conCondizioni: false,
      })
    ).toEqual([])
  })

  it('tipi di calcolo ammessi per fascia', () => {
    expect(
      validaScaglioni([sc(1, '10', '1', 'E'), sc(7, null, '1', 'A')], { conCondizioni: false })
    ).toContain('Fascia 1: il tipo di calcolo non è ammesso.')
    expect(
      validaScaglioni([sc(1, '10', '1', 'A'), sc(7, null, '1', 'E')], { conCondizioni: false })
    ).toEqual([])
    expect(
      validaScaglioni([sc(1, '10', '1', 'X'), sc(7, null, '1', 'A')], { conCondizioni: false })
    ).toContain('Fascia 1: il tipo di calcolo non è ammesso.')
    expect(
      validaScaglioni([sc(1, '10', '1', 'X'), sc(7, null, '1', 'H')], { conCondizioni: true })
    ).toEqual([])
    expect(
      validaScaglioni([sc(1, '10', '1', 'H'), sc(7, null, '1', 'A')], { conCondizioni: true })
    ).toContain('Fascia 1: il tipo di calcolo non è ammesso.')
    expect(
      validaScaglioni([sc(1, '10', '1', 'A'), sc(7, null, '1', 'H')], { conCondizioni: false })
    ).toContain('Fascia 7: il tipo di calcolo non è ammesso.')
  })

  it('formati di prezzo, soglia, sconto e provvigione (R6)', () => {
    const t = [
      sc(1, '10.5555', '1', 'A'),
      sc(2, '20', '1.1234567', 'A', { sconto: '10+5+5+5', provvigione: ',5' }),
      sc(7, null, '-1', 'A'),
    ]
    const m = validaScaglioni(t, { conCondizioni: false })
    expect(m).toEqual(
      jasmine.arrayContaining([
        'Fascia 1: la soglia deve essere un numero positivo con al massimo tre decimali.',
        'Fascia 2: il prezzo deve essere un numero non negativo con al massimo sei decimali.',
        'Fascia 2: lo sconto si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.',
        'Fascia 2: la provvigione si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.',
        'Fascia 7: il prezzo deve essere un numero non negativo con al massimo sei decimali.',
      ])
    )
  })
})

const sd = (
  ordine: number,
  giorno: number,
  mese: number,
  anno: number | null = null
): Scadenza => ({ ordine, giorno, mese, anno })
const NESSUN_EXTRA = { dal: null, al: null }

describe('validaScadenze', () => {
  it('29/02 con anno vuoto e con 2024 sono valide, con 2025 no', () => {
    expect(validaScadenze([sd(1, 29, 2)], null, NESSUN_EXTRA)).toEqual([])
    expect(validaScadenze([sd(1, 29, 2, 2024)], null, NESSUN_EXTRA)).toEqual([])
    expect(validaScadenze([sd(1, 29, 2, 2025)], null, NESSUN_EXTRA)).toEqual([
      'Scadenza 1: data non valida.',
    ])
  })

  it('31/04 non è valida', () => {
    expect(validaScadenze([sd(1, 31, 4)], null, NESSUN_EXTRA)).toEqual([
      'Scadenza 1: data non valida.',
    ])
  })

  it('rifiuta il doppione, anche fra anno vuoto e anno esplicito', () => {
    expect(validaScadenze([sd(1, 15, 3), sd(2, 15, 3)], null, NESSUN_EXTRA)).toEqual([
      'Scadenza 2: data ripetuta (uguale alla scadenza 1).',
    ])
    expect(validaScadenze([sd(1, 15, 3), sd(2, 15, 3, 2026)], null, NESSUN_EXTRA)).toEqual([
      'Scadenza 2: data ripetuta (uguale alla scadenza 1).',
    ])
    expect(validaScadenze([sd(1, 15, 3, 2026), sd(2, 15, 3, 2027)], null, NESSUN_EXTRA)).toEqual([])
  })

  it('28/02 e 29/02 senza anno (o 28/02 in anno non bisestile) sono lo stesso giorno', () => {
    const dup = ['Scadenza 2: data ripetuta (uguale alla scadenza 1).']
    expect(validaScadenze([sd(1, 28, 2), sd(2, 29, 2)], null, NESSUN_EXTRA)).toEqual(dup)
    expect(validaScadenze([sd(1, 29, 2), sd(2, 28, 2)], null, NESSUN_EXTRA)).toEqual(dup)
    expect(validaScadenze([sd(1, 29, 2), sd(2, 28, 2, 2025)], null, NESSUN_EXTRA)).toEqual(dup)
    expect(validaScadenze([sd(1, 29, 2), sd(2, 28, 2, 2024)], null, NESSUN_EXTRA)).toEqual([])
  })

  it("l'ordine non si aggira mescolando anno vuoto ed esplicito", () => {
    expect(
      validaScadenze([sd(1, 15, 6), sd(2, 1, 1, 2026), sd(3, 1, 3)], null, NESSUN_EXTRA)
    ).toEqual(['Scadenza 3: le scadenze vanno in ordine di data.'])
  })

  it('al massimo 12 scadenze, ordine 1-12 non ripetuto, date in ordine', () => {
    const tredici = Array.from({ length: 13 }, (_, i) => sd(i + 1, 1, (i % 12) + 1, 2000 + i))
    expect(validaScadenze(tredici, null, NESSUN_EXTRA)).toContain('Al massimo 12 scadenze.')
    expect(validaScadenze([sd(1, 1, 1), sd(1, 1, 2)], null, NESSUN_EXTRA)).toContain(
      "Scadenza 2: il numero d'ordine 1 è ripetuto."
    )
    expect(validaScadenze([sd(0, 1, 1)], null, NESSUN_EXTRA)).toContain(
      "Scadenza 1: il numero d'ordine deve essere da 1 a 12."
    )
    expect(validaScadenze([sd(1, 1, 5), sd(2, 1, 3)], null, NESSUN_EXTRA)).toEqual([
      'Scadenza 2: le scadenze vanno in ordine di data.',
    ])
  })

  it('XA, XD e YC senza periodo extra: messaggio; con periodo valido: nessun errore', () => {
    for (const p of ['XA', 'XD', 'YC'] as const) {
      expect(validaScadenze([sd(1, 1, 1)], p, NESSUN_EXTRA)).toEqual([
        'Per una scadenza extra indica il periodo dal … al ….',
      ])
      expect(validaScadenze([sd(1, 1, 1)], p, { dal: '2026-01-01', al: '2026-03-31' })).toEqual([])
    }
    expect(validaScadenze([], 'XA', { dal: '2026-01-01', al: null }).length).toBe(1)
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
    expect(validaScadenze([], null, { dal: '2026-01-01', al: null }).length).toBe(1)
    expect(validaScadenze([sd(1, 1, 1)], 'TA', NESSUN_EXTRA)).toEqual([])
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
    const e = (f: FrequenzaCalendario, mese: number): string =>
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
    const n = (f: FrequenzaCalendario): number => {
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

  it('limiti ammessi con anno vuoto: 15/03 trimestrale, 30/04 quadrimestrale, 30/06 semestrale', () => {
    expect(
      'scadenze' in calendarioAutomatico({ giorno: 15, mese: 3, anno: null }, 'TRIMESTRALE')
    ).toBe(true)
    expect(
      'scadenze' in calendarioAutomatico({ giorno: 30, mese: 4, anno: null }, 'QUADRIMESTRALE')
    ).toBe(true)
    expect(
      'scadenze' in calendarioAutomatico({ giorno: 30, mese: 6, anno: null }, 'SEMESTRALE')
    ).toBe(true)
    expect(
      'errore' in calendarioAutomatico({ giorno: 1, mese: 4, anno: null }, 'TRIMESTRALE')
    ).toBe(true)
  })

  it('il calendario generato supera validaScadenze (tutte le frequenze, mesi, anni)', () => {
    const frequenze = [
      'MENSILE',
      'BIMESTRALE',
      'TRIMESTRALE',
      'QUADRIMESTRALE',
      'SEMESTRALE',
    ] as const
    for (const f of frequenze) {
      for (const anno of [null, 2026, 2028]) {
        for (let mese = 1; mese <= 12; mese++) {
          for (const giorno of [1, 15, 28, 29, 30, 31]) {
            const r = calendarioAutomatico({ giorno, mese, anno }, f)
            if ('scadenze' in r) {
              expect({
                f,
                anno,
                mese,
                giorno,
                e: validaScadenze(r.scadenze, null, NESSUN_EXTRA),
              }).toEqual({ f, anno, mese, giorno, e: [] })
            }
          }
        }
      }
    }
  })

  it('prima data non valida', () => {
    expect(calendarioAutomatico({ giorno: 31, mese: 4, anno: null }, 'MENSILE')).toEqual({
      errore: 'La prima scadenza non è una data valida.',
    })
  })
})

describe('periodoCompetenza', () => {
  it('TA su 01/04: 01/04-30/06', () => {
    expect(periodoCompetenza(sd(1, 1, 4), 'TA', 2026)).toEqual({
      dal: '2026-04-01',
      al: '2026-06-30',
    })
  })
  it('TP su 30/06: 01/04-30/06', () => {
    expect(periodoCompetenza(sd(1, 30, 6), 'TP', 2026)).toEqual({
      dal: '2026-04-01',
      al: '2026-06-30',
    })
  })
  it('mensile, febbraio bisestile', () => {
    expect(periodoCompetenza(sd(1, 10, 2), 'MP', 2028)).toEqual({
      dal: '2028-02-01',
      al: '2028-02-29',
    })
    expect(periodoCompetenza(sd(1, 10, 2), 'MP', 2026)).toEqual({
      dal: '2026-02-01',
      al: '2026-02-28',
    })
  })
  it("anticipato a cavallo d'anno e posticipato all'indietro", () => {
    expect(periodoCompetenza(sd(1, 1, 11), 'TA', 2026)).toEqual({
      dal: '2026-11-01',
      al: '2027-01-31',
    })
    expect(periodoCompetenza(sd(1, 31, 1), 'TP', 2026)).toEqual({
      dal: '2025-11-01',
      al: '2026-01-31',
    })
  })
  it('annuale e biennale', () => {
    expect(periodoCompetenza(sd(1, 1, 1), 'AA', 2026)).toEqual({
      dal: '2026-01-01',
      al: '2026-12-31',
    })
    expect(periodoCompetenza(sd(1, 31, 12), 'AP', 2026)).toEqual({
      dal: '2026-01-01',
      al: '2026-12-31',
    })
    expect(periodoCompetenza(sd(1, 1, 3), 'DA', 2026)).toEqual({
      dal: '2026-03-01',
      al: '2028-02-29',
    })
    expect(periodoCompetenza(sd(1, 28, 2), 'DP', 2026)).toEqual({
      dal: '2024-03-01',
      al: '2026-02-28',
    })
  })
  it("anno della scadenza esplicito e diverso dall'anno richiesto: null", () => {
    expect(periodoCompetenza(sd(1, 1, 4, 2025), 'TA', 2026)).toBeNull()
    expect(periodoCompetenza(sd(1, 1, 4, 2026), 'TA', 2026)).not.toBeNull()
  })
  it('periodi extra: null (li dà il periodo extra della riga)', () => {
    expect(periodoCompetenza(sd(1, 1, 4), 'XA', 2026)).toBeNull()
    expect(periodoCompetenza(sd(1, 1, 4), 'YC', 2026)).toBeNull()
  })
})

describe('Task 28: casi propri del frontend', () => {
  describe('descrizioneFascia (R50)', () => {
    const t = (tipo: TipoCalcoloScaglione, ultimo: TipoCalcoloScaglione = tipo) => [
      sc(1, '1000', '0.10', tipo),
      sc(2, '5000', '0.08', tipo),
      sc(7, null, '0.05', ultimo),
    ]

    it('ogni tipo comincia con la sua lettera e dice cosa fa', () => {
      const attese: Record<TipoCalcoloScaglione, string> = {
        A: 'Prezzo × quantità',
        B: 'Importo fisso della fascia più alta raggiunta',
        C: 'Importo fisso di ogni fascia raggiunta',
        D: 'Prezzo della fascia raggiunta × tutta la quantità',
        E: "tutta la quantità al prezzo dell'ultima fascia (come D)",
        X: 'Prezzo × quantità',
        Y: 'Importo fisso della fascia più alta raggiunta',
        Z: 'Importo fisso di ogni fascia raggiunta',
        W: 'Prezzo della fascia raggiunta × tutta la quantità',
        H: 'come E, con condizione',
      }
      for (const tipo of Object.keys(attese) as TipoCalcoloScaglione[]) {
        const f = [sc(1, '1000', '0.1', 'A'), sc(7, null, '0.05', tipo)]
        const d = descrizioneFascia(f, 1, 'KG')
        expect(d.startsWith(`${tipo} = `))
          .withContext(tipo)
          .toBeTrue()
        expect(d).withContext(tipo).toContain(attese[tipo])
      }
    })

    it('E e H dicono la semantica del Task 16a: come D e come E, mai due volte la quantità', () => {
      const e = descrizioneFascia(t('A', 'E'), 2, 'KG')
      expect(e).toContain('come D')
      expect(e).not.toContain('Prezzo ×')
      expect(descrizioneFascia(t('A', 'H'), 2, 'KG')).toContain('come E, con condizione')
    })

    it('le soglie vengono dalle fasce vicine, con la virgola decimale e il punto delle migliaia', () => {
      const f = [sc(1, '1000', '0.1', 'A'), sc(2, '5000.5', '0.08', 'A'), sc(7, null, '0.05', 'A')]
      expect(descrizioneFascia(f, 0, 'KG')).toContain('fino a KG 1.000')
      expect(descrizioneFascia(f, 1, 'KG')).toContain('oltre KG 1.000 e fino a 5.000,5')
      expect(descrizioneFascia(f, 2, 'KG')).toContain('oltre KG 5.000,5')
    })

    it('soglia ancora vuota: puntini, senza errori', () => {
      expect(descrizioneFascia([sc(1, null, '', 'A')], 0, '')).toContain('fino a …')
    })

    it('le varianti con condizione lo dicono', () => {
      expect(descrizioneFascia(t('X'), 0, 'KG')).toContain('Se la condizione è verificata')
      expect(descrizioneFascia(t('A'), 0, 'KG')).not.toContain('condizione')
    })
  })

  describe('tipiAmmessi', () => {
    it('senza condizioni: A-D, e anche E sulla fascia 7', () => {
      expect(tipiAmmessi(1, false)).toEqual(['A', 'B', 'C', 'D'])
      expect(tipiAmmessi(7, false)).toEqual(['A', 'B', 'C', 'D', 'E'])
    })
    it('con le condizioni si aggiungono X Y Z W, e H sulla 7', () => {
      expect(tipiAmmessi(2, true)).toEqual(['A', 'B', 'C', 'D', 'X', 'Y', 'Z', 'W'])
      expect(tipiAmmessi(7, true)).toEqual(['A', 'B', 'C', 'D', 'E', 'X', 'Y', 'Z', 'W', 'H'])
    })
  })

  it('dataItaliana', () => {
    expect(dataItaliana('2026-01-31')).toBe('31/01/2026')
    expect(dataItaliana('boh')).toBe('boh')
  })

  describe('Task 28 fix: descrizioni con la quantità precedente (R30, Q8)', () => {
    const t = (tipo: TipoCalcoloScaglione) => [
      sc(1, '1000', '0.10', 'A'),
      sc(7, null, '0.05', tipo),
    ]
    const d = (tipo: TipoCalcoloScaglione, applica: string) =>
      descrizioneFascia(t(tipo), 1, 'KG', applica)

    it('senza «da data» le descrizioni non cambiano', () => {
      for (const x of ['DOCUMENTO', 'PERIODO', 'GIORNO', '']) {
        expect(d('D', x)).not.toContain('già fatturata')
        expect(d('B', x)).not.toContain('prima volta')
      }
    })

    it('progressivo da data e conguaglio: D ed E fatturano la sola quantità nuova', () => {
      // Esempio: [A fino a 1000 a 0,10; D oltre a 0,05], 6.000 kg già fatturati e 1.000 nuovi:
      // si fattura 1.000 x 0,05 (la parte nuova), non 7.000 x 0,05.
      for (const x of ['PROGRESSIVO_DA_DATA', 'CONGUAGLIO_365']) {
        expect(d('D', x)).toContain('sola quantità nuova')
        expect(d('E', x)).toContain('sola quantità nuova')
        expect(d('E', x)).toContain('(come D)')
      }
    })

    it('D ed E con la quantità precedente non dicono «tutta la quantità» (voce 17)', () => {
      expect(d('D', 'PROGRESSIVO_DA_DATA')).not.toContain('tutta la quantità')
      expect(d('E', 'PROGRESSIVO_DA_DATA')).not.toContain('tutta la quantità')
      expect(d('D', '')).toContain('tutta la quantità')
    })

    it('X, Y, Z, W e H non hanno mai la frase «da data» (voce 16)', () => {
      for (const x of ['X', 'Y', 'Z', 'W', 'H'] as TipoCalcoloScaglione[]) {
        const senza = d(x, '')
        expect(d(x, 'PROGRESSIVO_DA_DATA')).toBe(senza)
        expect(d(x, 'CONGUAGLIO_365')).toBe(senza)
      }
    })

    it('B: il fisso solo nella fattura in cui la fascia è raggiunta per la prima volta', () => {
      expect(d('B', 'PROGRESSIVO_DA_DATA')).toContain('per la prima volta')
    })

    it('C: il fisso delle sole fasce raggiunte per la prima volta', () => {
      expect(d('C', 'PROGRESSIVO_DA_DATA')).toContain('sole fasce raggiunte per la prima volta')
    })

    it('A: la quantità già fatturata si scala dalle fasce', () => {
      expect(descrizioneFascia(t('A'), 0, 'KG', 'PROGRESSIVO_DA_DATA')).toContain('si scala')
    })

    it('H dice «con condizione» una volta sola (m8)', () => {
      const h = descrizioneFascia(t('H'), 1, 'KG', '')
      expect(h.match(/condizione/g)?.length).toBe(1)
    })

    it('periodoCompetenza come il dominio: 31/02 non è scartato qui (m1)', () => {
      expect(periodoCompetenza(sd(1, 31, 2), 'MP', 2026)).toEqual({
        dal: '2026-02-01',
        al: '2026-02-28',
      })
    })
  })
})
