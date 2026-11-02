import { Prisma } from '@prisma/client'
import { importoRiga } from './importi-riga'
import {
  applicaScaglioni,
  validaPrezzoSpeciale,
  validaScaglioni,
  type ApplicaPrezzoSpeciale,
  type Scaglione,
  type TipoCalcoloScaglione,
} from './prezzo-speciale'

const sc = (
  ordine: number,
  finoA: string | null,
  prezzo: string,
  tipoCalcolo: TipoCalcoloScaglione,
  extra: Partial<Scaglione> = {}
): Scaglione => ({ ordine, finoA, prezzo, sconto: null, provvigione: null, tipoCalcolo, ...extra })

/** Esempio di fatturazione.md 4.5: righe 1, 2 e 7. */
const tabella = (tipo: TipoCalcoloScaglione, ultimo: TipoCalcoloScaglione = tipo): Scaglione[] => [
  sc(1, '1000', '0.10', tipo),
  sc(2, '5000', '0.08', tipo),
  sc(7, null, '0.05', ultimo),
]

const ESITO_ERRORE = { errore: 'Errore nel calcolo del prezzo speciale.' }

describe('applicaScaglioni', () => {
  it('A: ogni fascia raggiunta fattura la sua parte (470,00 in tre righe)', () => {
    const r = applicaScaglioni(tabella('A'), '6000', 'KG')
    expect(r).toEqual({
      righe: [
        {
          descrizione: 'Per q.tà fino a KG 1000',
          quantita: '1000',
          prezzo: '0.10',
          sconto: null,
          provvigione: null,
        },
        {
          descrizione: 'Per q.tà oltre KG 1000 e fino a 5000',
          quantita: '4000',
          prezzo: '0.08',
          sconto: null,
          provvigione: null,
        },
        {
          descrizione: 'Per q.tà oltre KG 5000',
          quantita: '1000',
          prezzo: '0.05',
          sconto: null,
          provvigione: null,
        },
      ],
      condizioneVerificata: false,
    })
    if ('errore' in r) throw new Error(r.errore)
    const totale = r.righe.reduce(
      (s, x) => s + Number(importoRiga(x.quantita, x.prezzo, null).netto),
      0
    )
    expect(totale.toFixed(2)).toBe('470.00')
  })

  it('A: quantità dentro la seconda fascia, senza la terza', () => {
    const r = applicaScaglioni(tabella('A'), '3000', 'KG')
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.descrizione, x.quantita])).toEqual([
      ['Per q.tà fino a KG 1000', '1000'],
      ['Per q.tà oltre KG 1000', '2000'],
    ])
  })

  it('D: tutta la quantità al prezzo della fascia più alta (300,00 in una riga)', () => {
    const r = applicaScaglioni(tabella('D'), '6000', 'KG')
    expect(r).toEqual({
      righe: [
        {
          descrizione: 'Per q.tà oltre KG 5000',
          quantita: '6000',
          prezzo: '0.05',
          sconto: null,
          provvigione: null,
        },
      ],
      condizioneVerificata: false,
    })
    if ('errore' in r) throw new Error(r.errore)
    expect(importoRiga(r.righe[0].quantita, r.righe[0].prezzo, null).netto).toBe('300.00')
  })

  it('B: solo la fascia più alta, quantità 1, imp.fisso', () => {
    const r = applicaScaglioni(tabella('B'), '6000', 'KG')
    expect(r).toEqual({
      righe: [
        {
          descrizione: 'Per q.tà oltre KG 5000: imp.fisso',
          quantita: '1',
          prezzo: '0.05',
          sconto: null,
          provvigione: null,
        },
      ],
      condizioneVerificata: false,
    })
  })

  it('C: un fisso per ogni fascia raggiunta', () => {
    const r = applicaScaglioni(tabella('C'), '6000', 'KG')
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.descrizione, x.quantita, x.prezzo])).toEqual([
      ['Per q.tà fino a KG 1000: imp.fisso', '1', '0.10'],
      ['Per q.tà oltre KG 1000 e fino a 5000: imp.fisso', '1', '0.08'],
      ['Per q.tà oltre KG 5000: imp.fisso', '1', '0.05'],
    ])
  })

  it('E azzera le fasce precedenti come D (differenza voluta, 02/11)', () => {
    const t = [sc(1, '1000', '0.10', 'A'), sc(7, null, '0.05', 'E')]
    const r = applicaScaglioni(t, '6000', 'KG')
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.quantita, x.prezzo])).toEqual([['6000', '0.05']])
  })

  it('D + E: una sola riga (differenza voluta, 02/11)', () => {
    const t = [sc(1, '5000', '0.08', 'D'), sc(7, null, '0.05', 'E')]
    const r = applicaScaglioni(t, '6000', 'KG')
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.quantita, x.prezzo])).toEqual([['6000', '0.05']])
  })

  it('D con quantità precedente fattura solo la quantità nuova (differenza voluta, 02/11)', () => {
    // 2.000 già passati, 1.000 nuovi: totale 3.000 in fascia 2, si fatturano le sole 1.000 nuove
    const r = applicaScaglioni(tabella('D'), '1000', 'KG', { quantitaPrecedente: '2000' })
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.descrizione, x.quantita, x.prezzo])).toEqual([
      ['Per q.tà oltre KG 1000', '1000', '0.08'],
    ])
  })

  it('E con quantità precedente: solo la quantità nuova al prezzo della riga 7', () => {
    const t = [sc(1, '1000', '0.10', 'A'), sc(7, null, '0.05', 'E')]
    const r = applicaScaglioni(t, '500', 'KG', { quantitaPrecedente: '5800' })
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.descrizione, x.quantita, x.prezzo])).toEqual([
      ['Per q.tà oltre KG 1000', '500', '0.05'],
    ])
  })

  it('C con quantità precedente: solo le fasce raggiunte per la prima volta', () => {
    // 800 già passati, 1.000 nuovi: totale 1.800; la fascia 1 era già raggiunta
    const r = applicaScaglioni(tabella('C'), '1000', 'KG', { quantitaPrecedente: '800' })
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.descrizione, x.quantita, x.prezzo])).toEqual([
      ['Per q.tà oltre KG 1000: imp.fisso', '1', '0.08'],
    ])
  })

  it('B con quantità precedente: il fisso solo alla prima volta che la fascia è raggiunta (Q8)', () => {
    const prima = applicaScaglioni(tabella('B'), '1000', 'KG', { quantitaPrecedente: '800' })
    if ('errore' in prima) throw new Error(prima.errore)
    expect(prima.righe.map(x => [x.descrizione, x.quantita, x.prezzo])).toEqual([
      ['Per q.tà oltre KG 1000: imp.fisso', '1', '0.08'],
    ])
    const gia = applicaScaglioni(tabella('B'), '100', 'KG', { quantitaPrecedente: '1200' })
    if ('errore' in gia) throw new Error(gia.errore)
    expect(gia.righe).toEqual([])
  })

  it('C + A con quantità precedente: i kg nuovi della fascia A si fatturano', () => {
    const t = [sc(1, '1000', '50', 'C'), sc(7, null, '0.08', 'A')]
    const r = applicaScaglioni(t, '1000', 'KG', { quantitaPrecedente: '800' })
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.descrizione, x.quantita, x.prezzo])).toEqual([
      ['Per q.tà oltre KG 1000', '800', '0.08'],
    ])
  })

  it('B + A con quantità precedente: 3.000 kg nuovi oltre la soglia', () => {
    const t = [sc(1, '1000', '50', 'B'), sc(7, null, '0.08', 'A')]
    const r = applicaScaglioni(t, '3000', 'KG', { quantitaPrecedente: '2000' })
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.quantita, x.prezzo])).toEqual([['3000', '0.08']])
  })

  it('C + A + A con quantità precedente: ogni kg nuovo una volta', () => {
    const t = [sc(1, '1000', '50', 'C'), sc(2, '5000', '0.08', 'A'), sc(7, null, '0.05', 'A')]
    const r = applicaScaglioni(t, '4000', 'KG', { quantitaPrecedente: '800' })
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.quantita, x.prezzo])).toEqual([['3800', '0.08']])
  })

  it('C + A con la quantità precedente esattamente sulla soglia', () => {
    const t = [sc(1, '1000', '50', 'C'), sc(7, null, '0.08', 'A')]
    const r = applicaScaglioni(t, '500', 'KG', { quantitaPrecedente: '1000' })
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe.map(x => [x.quantita, x.prezzo])).toEqual([['500', '0.08']])
  })

  it('quantità nuova zero da data: nessun fisso', () => {
    for (const tipo of ['B', 'C'] as const) {
      const r = applicaScaglioni(tabella(tipo), '0', 'KG', { quantitaPrecedente: '0' })
      if ('errore' in r) throw new Error(r.errore)
      expect(r.righe).toEqual([])
    }
  })

  it('quantità nuova negativa da data: errore', () => {
    expect(applicaScaglioni(tabella('D'), '-100', 'KG', { quantitaPrecedente: '2000' })).toEqual(
      ESITO_ERRORE
    )
  })

  describe('invariante: una fattura sul totale = somma di più fatture', () => {
    const tabelle: Record<string, Scaglione[]> = {
      A: tabella('A'),
      C: tabella('C'),
      'C+A': [sc(1, '1000', '50', 'C'), sc(7, null, '0.08', 'A')],
      'B+A': [sc(1, '1000', '50', 'B'), sc(7, null, '0.08', 'A')],
      'C+A+A': [sc(1, '1000', '50', 'C'), sc(2, '5000', '0.08', 'A'), sc(7, null, '0.05', 'A')],
      'A+C': [sc(1, '1000', '0.10', 'A'), sc(7, null, '50', 'C')],
    }
    // Include parti a zero, un precedente esattamente a 5.000 e quantita' decimali a cavallo delle soglie.
    const divisioni: string[][] = [
      ['800', '1000'],
      ['1000', '4000'],
      ['1200', '100', '3000'],
      ['500', '500', '500', '2000'],
      ['3000', '3000'],
      ['6000'],
      ['0', '800', '1000'],
      ['1000', '0', '500'],
      ['5000', '500'],
      ['4999.999', '0.002'],
      ['999.5', '0.5', '4000.5', '1'],
    ]
    const importoDi = (r: ReturnType<typeof applicaScaglioni>): Prisma.Decimal => {
      if ('errore' in r) throw new Error(r.errore)
      return r.righe.reduce(
        (m, x) => m.plus(new Prisma.Decimal(x.quantita).times(x.prezzo)),
        new Prisma.Decimal(0)
      )
    }
    const importo = (t: Scaglione[], q: string, prec: string): Prisma.Decimal =>
      importoDi(applicaScaglioni(t, q, 'KG', { quantitaPrecedente: prec }))
    // Riferimento: la fattura unica sul totale SENZA quantita' precedente (il percorso "porta" di
    // WinWaste), cosi' la proprieta' lega i due percorsi e non il percorso a se' stesso.
    const importoUnico = (t: Scaglione[], q: string): Prisma.Decimal =>
      importoDi(applicaScaglioni(t, q, 'KG'))
    for (const [nome, t] of Object.entries(tabelle)) {
      it(`${nome}: stesso importo comunque si divida la quantità`, () => {
        for (const parti of divisioni) {
          let cum = new Prisma.Decimal(0)
          let somma = new Prisma.Decimal(0)
          for (const p of parti) {
            somma = somma.plus(importo(t, p, cum.toFixed()))
            cum = cum.plus(p)
          }
          expect(somma.toFixed(4)).toBe(importoUnico(t, cum.toFixed()).toFixed(4))
        }
      })
    }

    it('D ed E: ogni kg si fattura una volta sola', () => {
      for (const t of [tabella('D'), [sc(1, '1000', '0.10', 'A'), sc(7, null, '0.05', 'E')]]) {
        for (const parti of divisioni) {
          let cum = new Prisma.Decimal(0)
          let kg = new Prisma.Decimal(0)
          for (const p of parti) {
            const r = applicaScaglioni(t, p, 'KG', { quantitaPrecedente: cum.toFixed() })
            if ('errore' in r) throw new Error(r.errore)
            kg = r.righe.reduce((m, x) => m.plus(x.quantita), kg)
            cum = cum.plus(p)
          }
          expect(kg.toFixed()).toBe(cum.toFixed())
        }
      }
    })
  })

  it('quantità nuova zero con D: nessuna riga', () => {
    const r = applicaScaglioni(tabella('D'), '0', 'KG', { quantitaPrecedente: '2000' })
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe).toEqual([])
  })

  it('quantità zero: prima fascia', () => {
    const r = applicaScaglioni(tabella('A'), '0', 'KG')
    expect(r).toEqual({
      righe: [
        {
          descrizione: 'Per q.tà fino a KG 1000',
          quantita: '0',
          prezzo: '0.10',
          sconto: null,
          provvigione: null,
        },
      ],
      condizioneVerificata: false,
    })
  })

  it('sconto e provvigione della fascia passano alla riga', () => {
    const t = [
      sc(1, '1000', '0.10', 'D', { sconto: '10+5', provvigione: '3' }),
      sc(7, null, '0.05', 'D'),
    ]
    const r = applicaScaglioni(t, '500', 'KG')
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe[0]).toMatchObject({ sconto: '10+5', provvigione: '3', quantita: '500' })
  })

  it('prezzi in forma di uscita unica (almeno due decimali, senza zeri finali)', () => {
    const t = [sc(1, '10', '0.800000', 'D'), sc(7, null, '10.5', 'D')]
    const r = applicaScaglioni(t, '5', 'KG')
    if ('errore' in r) throw new Error(r.errore)
    expect(r.righe[0].prezzo).toBe('0.80')
    const r2 = applicaScaglioni(t, '50', 'KG')
    if ('errore' in r2) throw new Error(r2.errore)
    expect(r2.righe[0].prezzo).toBe('10.50')
  })

  describe('quantità precedente (progressivo da data)', () => {
    it('scala la quantità già passata fascia per fascia', () => {
      // 800 già passati, 700 nuovi: totale 1500 -> 200 nella prima fascia, 500 nella seconda
      const r = applicaScaglioni(tabella('A'), '700', 'KG', { quantitaPrecedente: '800' })
      if ('errore' in r) throw new Error(r.errore)
      expect(r.righe.map(x => [x.descrizione, x.quantita, x.prezzo])).toEqual([
        ['Per q.tà fino a KG 1000', '200', '0.10'],
        ['Per q.tà oltre KG 1000', '500', '0.08'],
      ])
    })

    it('una fascia interamente già passata non compare', () => {
      const r = applicaScaglioni(tabella('A'), '1000', 'KG', { quantitaPrecedente: '2000' })
      if ('errore' in r) throw new Error(r.errore)
      expect(r.righe.map(x => [x.quantita, x.prezzo])).toEqual([['1000', '0.08']])
    })

    it('quantità precedente con condizione: errore', () => {
      expect(
        applicaScaglioni(tabella('D', 'W'), '10', 'KG', {
          condizione: 'P',
          quantitaPrecedente: '5',
        })
      ).toEqual({
        errore: 'Il prezzo speciale con le condizioni non ammette la quantità precedente.',
      })
    })

    it('quantità precedente negativa: errore', () => {
      expect(applicaScaglioni(tabella('A'), '10', 'KG', { quantitaPrecedente: '-1' })).toEqual(
        ESITO_ERRORE
      )
    })
  })

  describe('varianti con condizione', () => {
    it('X: progressivo e condizione verificata (somma dei condizionati)', () => {
      const r = applicaScaglioni(tabella('X', 'X'), '10', 'KG', {
        condizione: 'C',
        quantitaCondizionati: '6000',
      })
      if ('errore' in r) throw new Error(r.errore)
      expect(r.condizioneVerificata).toBe(true)
      expect(r.righe.map(x => x.quantita)).toEqual(['1000', '4000', '1000'])
    })

    it('P: la quantità di riferimento è quella della riga stessa', () => {
      const r = applicaScaglioni(tabella('D', 'W'), '6000', 'KG', { condizione: 'P' })
      if ('errore' in r) throw new Error(r.errore)
      expect(r.condizioneVerificata).toBe(true)
      expect(r.righe).toHaveLength(1)
    })

    it('Y: fisso della sola fascia più alta', () => {
      const r = applicaScaglioni(tabella('Y'), '6000', 'KG', { condizione: 'P' })
      if ('errore' in r) throw new Error(r.errore)
      expect(r.condizioneVerificata).toBe(true)
      expect(r.righe).toEqual([
        expect.objectContaining({
          quantita: '1',
          descrizione: 'Per q.tà oltre KG 5000: imp.fisso',
        }),
      ])
    })

    it('Z: un fisso per fascia, condizione verificata', () => {
      const r = applicaScaglioni(tabella('Z'), '6000', 'KG', { condizione: 'P' })
      if ('errore' in r) throw new Error(r.errore)
      expect(r.condizioneVerificata).toBe(true)
      expect(r.righe).toHaveLength(3)
    })

    it('H azzera le fasce precedenti (differenza voluta, 02/11)', () => {
      const t = [sc(1, '1000', '0.10', 'A'), sc(7, null, '0.05', 'H')]
      const r = applicaScaglioni(t, '6000', 'KG', { condizione: 'P' })
      if ('errore' in r) throw new Error(r.errore)
      expect(r.condizioneVerificata).toBe(true)
      expect(r.righe.map(x => x.quantita)).toEqual(['6000'])
    })

    it('fascia raggiunta di tipo normale: condizione non verificata', () => {
      const t = [sc(1, '1000', '0.10', 'A'), sc(2, '5000', '0.08', 'A'), sc(7, null, '0.05', 'A')]
      const r = applicaScaglioni(t, '6000', 'KG', { condizione: 'P' })
      if ('errore' in r) throw new Error(r.errore)
      expect(r.condizioneVerificata).toBe(false)
    })

    it('X senza condizione: errore', () => {
      expect(applicaScaglioni(tabella('X'), '6000', 'KG')).toEqual(ESITO_ERRORE)
    })

    it('condizione C senza quantità dei condizionati: errore', () => {
      expect(applicaScaglioni(tabella('A'), '6000', 'KG', { condizione: 'C' })).toEqual(
        ESITO_ERRORE
      )
    })
  })

  it('tabella non valida o quantità negativa: errore', () => {
    expect(applicaScaglioni([sc(1, '1000', '0.10', 'A')], '10', 'KG')).toEqual(ESITO_ERRORE)
    expect(applicaScaglioni(tabella('A'), '-1', 'KG')).toEqual(ESITO_ERRORE)
    expect(applicaScaglioni(tabella('A'), 'abc', 'KG')).toEqual(ESITO_ERRORE)
  })
})

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
      expect.arrayContaining([
        'Fascia 1: la soglia deve essere un numero positivo con al massimo tre decimali.',
        'Fascia 2: il prezzo deve essere un numero non negativo con al massimo sei decimali.',
        'Fascia 2: lo sconto si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.',
        'Fascia 2: la provvigione si scrive come percentuali a cascata, al massimo tre (es. 10+5), ciascuna fino a 99,99.',
        'Fascia 7: il prezzo deve essere un numero non negativo con al massimo sei decimali.',
      ])
    )
  })
})

describe('validaPrezzoSpeciale', () => {
  const base = {
    applicaA: 'DOCUMENTO' as ApplicaPrezzoSpeciale | null,
    condizioniRiferite: null as string | null,
    unitaMisura: 'KG',
    riferimentoGiorno: null as number | null,
    riferimentoMese: null as number | null,
    condizione: null as number | null,
    sconto: null as string | null,
    provvigione: null as string | null,
    minimoFatturabile: null as string | null,
    tipoProvvigione: null as string | null,
  }
  const t = tabella('A')

  it('riga valida', () => {
    expect(validaPrezzoSpeciale(base, t)).toEqual([])
    expect(validaPrezzoSpeciale({ ...base, applicaA: 'PERIODO' }, t)).toEqual([])
  })

  it('applicaA obbligatorio', () => {
    expect(validaPrezzoSpeciale({ ...base, applicaA: null }, t)).toContain(
      'Indica a cosa si applica il prezzo speciale.'
    )
  })

  it('addebito condizionato', () => {
    expect(validaPrezzoSpeciale({ ...base, condizione: 2 }, t)).toContain(
      'Il prezzo speciale non si usa negli addebiti condizionati.'
    )
  })

  it('unità HR', () => {
    expect(validaPrezzoSpeciale({ ...base, unitaMisura: 'HR' }, t)).toContain(
      'Il prezzo speciale non si usa con l’unità di misura HR.'
    )
  })

  it('sconto o provvigione di riga', () => {
    const m = 'Con il prezzo speciale lo sconto e la provvigione si indicano nelle fasce.'
    expect(validaPrezzoSpeciale({ ...base, sconto: '5' }, t)).toContain(m)
    expect(
      validaPrezzoSpeciale({ ...base, provvigione: '5', tipoProvvigione: 'LORDO' }, t)
    ).toContain(m)
  })

  it('minimo fatturabile', () => {
    expect(validaPrezzoSpeciale({ ...base, minimoFatturabile: '10.00' }, t)).toContain(
      'Con il prezzo speciale non si indica il minimo fatturabile.'
    )
  })

  it('K/M e K/L solo con DOCUMENTO', () => {
    const m = 'Con l’unità K/M o K/L il prezzo speciale si applica al documento.'
    expect(validaPrezzoSpeciale({ ...base, unitaMisura: 'K/M', applicaA: 'PERIODO' }, t)).toContain(
      m
    )
    expect(
      validaPrezzoSpeciale({ ...base, unitaMisura: 'K/L', applicaA: 'DOCUMENTO' }, t)
    ).not.toContain(m)
  })

  it('condizioni riferite: forma e applicaA', () => {
    const s = tabella('X', 'X')
    expect(validaPrezzoSpeciale({ ...base, condizioniRiferite: '12C' }, s)).toEqual([])
    expect(
      validaPrezzoSpeciale({ ...base, applicaA: 'PERIODO', condizioniRiferite: '3P' }, s)
    ).toEqual([])
    expect(
      validaPrezzoSpeciale(
        { ...base, applicaA: 'PROGRESSIVO_DA_DATA', condizioniRiferite: '12C' },
        s
      )
    ).toContain('Con le condizioni il prezzo speciale si applica al documento o al periodo.')
    for (const cattiva of ['12', '0C', '11C', 'C', '1234567890C', '12X']) {
      expect(validaPrezzoSpeciale({ ...base, condizioniRiferite: cattiva }, s)).toContain(
        'Le condizioni si scrivono come cifre da 1 a 9 tutte diverse seguite da C o P (es. 12C).'
      )
    }
  })

  it('le varianti X-H senza condizioni sono rifiutate', () => {
    expect(validaPrezzoSpeciale(base, tabella('X', 'X'))).toContain(
      'Fascia 1: il tipo di calcolo non è ammesso.'
    )
  })

  it('progressivo da data: riferimento facoltativo ma intero', () => {
    const r = { ...base, applicaA: 'PROGRESSIVO_DA_DATA' as const }
    expect(validaPrezzoSpeciale(r, t)).toEqual([])
    expect(validaPrezzoSpeciale({ ...r, riferimentoGiorno: 1, riferimentoMese: 7 }, t)).toEqual([])
    expect(validaPrezzoSpeciale({ ...r, riferimentoGiorno: 1 }, t)).toContain(
      'Il riferimento si indica con giorno e mese insieme.'
    )
    expect(validaPrezzoSpeciale({ ...r, riferimentoGiorno: 31, riferimentoMese: 4 }, t)).toContain(
      'Il riferimento non è una data valida.'
    )
  })

  it('conguaglio senza data', () => {
    const r = { ...base, applicaA: 'CONGUAGLIO_365' as const }
    expect(validaPrezzoSpeciale(r, t)).toContain(
      'Per il conguaglio indica la data (giorno e mese).'
    )
    expect(validaPrezzoSpeciale({ ...r, riferimentoGiorno: 31, riferimentoMese: 12 }, t)).toEqual(
      []
    )
  })

  it('riferimento di data con altri applicaA', () => {
    expect(
      validaPrezzoSpeciale({ ...base, riferimentoGiorno: 1, riferimentoMese: 1 }, t)
    ).toContain('La data di riferimento vale solo per il progressivo da data e per il conguaglio.')
  })

  it('provvigione in una fascia: tipo di provvigione obbligatorio', () => {
    const conProv = [sc(1, '10', '1', 'A', { provvigione: '3' }), sc(7, null, '1', 'A')]
    expect(validaPrezzoSpeciale(base, conProv)).toContain(
      'Indica su cosa si calcola la provvigione.'
    )
    expect(validaPrezzoSpeciale({ ...base, tipoProvvigione: 'LORDO' }, conProv)).toEqual([])
  })

  it('include i messaggi delle fasce', () => {
    expect(validaPrezzoSpeciale(base, [sc(1, '10', '1', 'A')])).toContain(
      'La tabella del prezzo speciale è incompleta: ogni fascia ha soglia, prezzo e tipo di calcolo.'
    )
  })
})
