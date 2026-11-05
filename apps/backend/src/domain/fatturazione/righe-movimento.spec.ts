import type { Scaglione } from '../listino/prezzo-speciale'
import { Prisma } from '@prisma/client'
import { descrizioneRigaMovimento, righeDaLegami } from './righe-movimento'
import type { RigaLegameDaFatturare, RigaListinoDaFatturare } from './tipi'

const legame = (o: Partial<RigaLegameDaFatturare> = {}): RigaLegameDaFatturare => ({
  legameId: 'L1',
  rigaLegameId: 'RL1',
  legameVersione: 1,
  elencoId: 'E1',
  movimentoVigenteId: 'M1',
  dataMovimento: '2026-11-03',
  quantitaMovimento: '1000',
  unitaMovimento: 'KG',
  cerCode: '150101',
  numeroFir: 'ABC123',
  rigaAddebitoId: 'A1',
  tipo: 'CER',
  descrizione: 'Imballaggi',
  unitaMisura: 'KG',
  quantita: '1000',
  prezzo: '0.10',
  prezzoSpeciale: false,
  sconto: null,
  codiceIvaId: 'IVA22',
  aliquotaIva: '22.00',
  naturaIva: null,
  ...o,
})

const sc = (ordine: number, finoA: string | null, prezzo: string, tipo: 'A' | 'D'): Scaglione => ({
  ordine,
  finoA,
  prezzo,
  sconto: null,
  provvigione: null,
  tipoCalcolo: tipo,
})
const tabella = (tipo: 'A' | 'D'): Scaglione[] => [
  sc(1, '1000', '0.10', tipo),
  sc(2, '5000', '0.08', tipo),
  sc(7, null, '0.05', tipo),
]

const voceListino = (o: Partial<RigaListinoDaFatturare> = {}): RigaListinoDaFatturare => ({
  id: 'A1',
  versione: 1,
  elencoId: 'E1',
  daAllegato: false,
  tipo: 'CER',
  descrizione: null,
  categoriaId: null,
  categoriaCodice: null,
  unitaMisura: 'KG',
  prezzo: null,
  quantitaFissa: null,
  sconto: null,
  prezzoSpeciale: true,
  applicaA: 'DOCUMENTO',
  condizione: null,
  condizioniRiferite: null,
  scaglioni: tabella('A'),
  scadenze: [],
  periodoScadenze: null,
  minimoFatturabile: null,
  minimoPerCategoria: false,
  codiceIva: { id: 'IVA22', versione: 1, aliquota: '22.00', natura: null, descrizione: 'IVA 22%' },
  ...o,
})

const mappa = (...l: RigaListinoDaFatturare[]) => new Map(l.map(x => [x.id, x]))
const speciale = (o: Partial<RigaLegameDaFatturare> = {}) =>
  legame({ prezzoSpeciale: true, prezzo: null, ...o })

describe('descrizioneRigaMovimento', () => {
  it('descrizione, CER, data e FIR', () => {
    expect(
      descrizioneRigaMovimento({
        descrizione: 'Imballaggi',
        cerCode: '150101',
        dataMovimento: '2026-11-03',
        numeroFir: 'ABC123',
      })
    ).toBe('Imballaggi CER 150101 del 03/11/2026 FIR ABC123')
  })

  it('senza FIR: niente «FIR»', () => {
    const t = descrizioneRigaMovimento({
      descrizione: 'Imballaggi',
      cerCode: '150101',
      dataMovimento: '2026-11-03',
      numeroFir: null,
    })
    expect(t).toBe('Imballaggi CER 150101 del 03/11/2026')
    expect(t).not.toContain('FIR')
  })
})

describe('righeDaLegami: prezzo singolo', () => {
  it('quantità 1234.567 × 0.123456 con sconto 10+5: lordo arrotondato prima dello sconto', () => {
    const { righe, errori } = righeDaLegami(
      [legame({ quantita: '1234.567', prezzo: '0.123456', sconto: '10+5' })],
      new Map()
    )
    expect(errori).toEqual([])
    // lordo 152.41 (arrotondato prima dello sconto); sconto a cascata sul lordo: 22.10
    expect(righe).toHaveLength(1)
    expect(righe[0]).toMatchObject({
      tipoRiga: 'MOVIMENTO',
      importoLordo: '152.41',
      importoSconto: '22.10',
      prezzoTotale: '130.31',
      prezzoUnitario: '0.123456',
      sconto: '10+5',
      descrizione: 'Imballaggi CER 150101 del 03/11/2026 FIR ABC123',
    })
  })

  it('RIGA_LEGAME_INCOMPLETA con quantità o prezzo null', () => {
    for (const o of [{ quantita: null }, { prezzo: null }]) {
      const e = righeDaLegami([legame(o)], new Map())
      expect(e.righe).toEqual([])
      expect(e.errori).toEqual([{ codice: 'RIGA_LEGAME_INCOMPLETA' }])
    }
  })
})

describe('righeDaLegami: prezzo speciale', () => {
  it('DOCUMENTO: fasce per il singolo legame con legameId; MOVIMENTO a zero', () => {
    const { righe, errori } = righeDaLegami([speciale({ quantita: '6000' })], mappa(voceListino()))
    expect(errori).toEqual([])
    expect(righe.map(r => r.tipoRiga)).toEqual([
      'MOVIMENTO',
      'FASCIA_SPECIALE',
      'FASCIA_SPECIALE',
      'FASCIA_SPECIALE',
    ])
    expect(righe[0]).toMatchObject({
      rigaLegameId: 'RL1',
      quantita: '6000',
      unitaMisura: 'KG',
      prezzoUnitario: '0',
      prezzoTotale: '0.00',
    })
    expect(righe.slice(1).every(r => r.legameId === 'L1' && r.rigaAddebitoId === 'A1')).toBe(true)
    expect(righe.slice(1).map(r => r.prezzoTotale)).toEqual(['100.00', '320.00', '50.00'])
  })

  it('PERIODO: tabella A/D sulla somma dei legami, fasce con legameId null', () => {
    const legami = [
      speciale({ legameId: 'L1', rigaLegameId: 'RL1', quantita: '2500' }),
      speciale({
        legameId: 'L2',
        rigaLegameId: 'RL2',
        quantita: '3500',
        dataMovimento: '2026-11-04',
      }),
    ]
    const a = righeDaLegami(legami, mappa(voceListino({ applicaA: 'PERIODO' })))
    expect(a.errori).toEqual([])
    const fasce = a.righe.filter(r => r.tipoRiga === 'FASCIA_SPECIALE')
    expect(fasce.every(r => r.legameId === null)).toBe(true)
    expect(fasce.reduce((s, r) => s.plus(r.prezzoTotale), new Prisma.Decimal(0)).toFixed(2)).toBe(
      '470.00'
    )
    // le fasce seguono l'ultima riga MOVIMENTO
    expect(a.righe.map(r => r.tipoRiga)).toEqual([
      'MOVIMENTO',
      'MOVIMENTO',
      'FASCIA_SPECIALE',
      'FASCIA_SPECIALE',
      'FASCIA_SPECIALE',
    ])
    const d = righeDaLegami(
      legami,
      mappa(voceListino({ applicaA: 'PERIODO', scaglioni: tabella('D') }))
    )
    const fd = d.righe.filter(r => r.tipoRiga === 'FASCIA_SPECIALE')
    expect(fd).toHaveLength(1)
    expect(fd[0].prezzoTotale).toBe('300.00')
  })

  it.each(['DOCUMENTO', 'PERIODO'] as const)(
    '%s: ogni riga di legame ha la sua MOVIMENTO; Σ prezzoTotale = Σ fasce',
    applicaA => {
      const legami = [
        speciale({ legameId: 'L1', rigaLegameId: 'RL1', quantita: '2500' }),
        speciale({
          legameId: 'L2',
          rigaLegameId: 'RL2',
          quantita: '3500',
          dataMovimento: '2026-11-04',
        }),
      ]
      const { righe } = righeDaLegami(legami, mappa(voceListino({ applicaA })))
      const mov = righe.filter(r => r.tipoRiga === 'MOVIMENTO')
      expect(mov.map(r => r.rigaLegameId)).toEqual(['RL1', 'RL2'])
      for (const m of mov) {
        expect(m).toMatchObject({ prezzoUnitario: '0', prezzoTotale: '0.00', importoLordo: '0.00' })
        expect(m.quantita).not.toBeNull()
        expect(m.unitaMisura).toBe('KG')
        expect(m.numeroFir).toBe('ABC123')
      }
      const somma = (xs: typeof righe) =>
        xs.reduce((s, r) => s.plus(r.prezzoTotale), new Prisma.Decimal(0)).toFixed(2)
      expect(somma(righe)).toBe(somma(righe.filter(r => r.tipoRiga === 'FASCIA_SPECIALE')))
      if (applicaA === 'DOCUMENTO') {
        expect(
          righe.filter(r => r.tipoRiga === 'FASCIA_SPECIALE').every(r => r.legameId !== null)
        ).toBe(true)
      }
    }
  )

  it('PERIODO con due UM diverse: UM_NON_UNIVOCA, nessuna riga', () => {
    const r = righeDaLegami(
      [
        speciale({ rigaLegameId: 'RL1', unitaMisura: 'KG' }),
        speciale({ legameId: 'L2', rigaLegameId: 'RL2', unitaMisura: 'LT' }),
      ],
      mappa(voceListino({ applicaA: 'PERIODO' }))
    )
    expect(r.righe).toEqual([])
    expect(r.errori.map(e => e.codice)).toEqual(['UM_NON_UNIVOCA'])
  })

  it('scaglioni non validi: PREZZO_SPECIALE_NON_VALIDO', () => {
    const r = righeDaLegami(
      [speciale()],
      mappa(voceListino({ scaglioni: [sc(1, '1000', '0.10', 'A'), sc(2, '500', '0.08', 'A')] }))
    )
    expect(r.righe).toEqual([])
    expect(r.errori.map(e => e.codice)).toEqual(['PREZZO_SPECIALE_NON_VALIDO'])
  })

  it.each([
    [{ applicaA: 'PROGRESSIVO_DA_DATA' }, 'PROGRESSIVO_DA_DATA riga 1'],
    [{ applicaA: 'CONGUAGLIO_365' }, 'CONGUAGLIO_365 riga 1'],
    [{ applicaA: 'GIORNO' }, 'GIORNO riga 1'],
    [{ applicaA: 'DOCUMENTO', condizione: 2 }, 'condizionata riga 1'],
    [{ applicaA: 'DOCUMENTO', condizioniRiferite: '1C' }, 'condizionata riga 1'],
  ] as const)('FAMIGLIA_NON_CALCOLATA %j', (o, dettaglio) => {
    const r = righeDaLegami([speciale()], mappa(voceListino(o)))
    expect(r.righe).toEqual([])
    expect(r.errori).toEqual([{ codice: 'FAMIGLIA_NON_CALCOLATA', dettaglio }])
    expect(JSON.stringify(r.errori)).not.toContain('A1')
  })

  it('una famiglia non calcolata non impedisce il calcolo delle altre righe', () => {
    const r = righeDaLegami(
      [
        speciale({ rigaAddebitoId: 'A2', rigaLegameId: 'RL2' }),
        legame({ rigaLegameId: 'RL3', legameId: 'L3', dataMovimento: '2026-11-05' }),
      ],
      mappa(voceListino({ id: 'A2', applicaA: 'GIORNO' }))
    )
    expect(r.errori.map(e => e.codice)).toEqual(['FAMIGLIA_NON_CALCOLATA'])
    expect(r.righe).toHaveLength(1)
    expect(r.righe[0].rigaLegameId).toBe('RL3')
  })
})

describe('righeDaLegami: ordine', () => {
  it('stesso insieme in ordine diverso: stesse righe nello stesso ordine', () => {
    const l = [
      legame({ legameId: 'L2', rigaLegameId: 'RL3', dataMovimento: '2026-11-03' }),
      legame({ legameId: 'L1', rigaLegameId: 'RL2', dataMovimento: '2026-11-03' }),
      legame({ legameId: 'L1', rigaLegameId: 'RL1', dataMovimento: '2026-11-03' }),
      legame({ legameId: 'L0', rigaLegameId: 'RL9', dataMovimento: '2026-11-05' }),
      legame({ legameId: 'L9', rigaLegameId: 'RL0', dataMovimento: '2026-11-01' }),
    ]
    const a = righeDaLegami(l, new Map())
    const b = righeDaLegami([...l].reverse(), new Map())
    expect(b).toEqual(a)
    expect(a.righe.map(r => r.rigaLegameId)).toEqual(['RL0', 'RL1', 'RL2', 'RL3', 'RL9'])
  })
})

describe('righeDaLegami: correzioni del giro 1', () => {
  const periodo = () => voceListino({ applicaA: 'PERIODO' })

  it("PERIODO: l'IVA delle fasce e' quella congelata nei legami, non quella del listino", () => {
    const iva = { codiceIvaId: 'IVA10', aliquotaIva: '10.00', naturaIva: null }
    const { righe, errori } = righeDaLegami(
      [
        speciale({ rigaLegameId: 'RL1', quantita: '2500', ...iva }),
        speciale({ legameId: 'L2', rigaLegameId: 'RL2', quantita: '3500', ...iva }),
      ],
      mappa(periodo())
    )
    expect(errori).toEqual([])
    const fasce = righe.filter(r => r.tipoRiga === 'FASCIA_SPECIALE')
    expect(fasce.length).toBeGreaterThan(0)
    expect(fasce.every(r => r.codiceIvaId === 'IVA10' && r.aliquotaIva === '10.00')).toBe(true)
  })

  it('PERIODO: IVA diverse fra i legami: errore, nessuna riga', () => {
    const r = righeDaLegami(
      [
        speciale({ rigaLegameId: 'RL1' }),
        speciale({
          legameId: 'L2',
          rigaLegameId: 'RL2',
          codiceIvaId: 'IVA10',
          aliquotaIva: '10.00',
        }),
      ],
      mappa(periodo())
    )
    expect(r.righe).toEqual([])
    expect(r.errori).toEqual([
      { codice: 'PREZZO_SPECIALE_NON_VALIDO', dettaglio: 'codice IVA non univoco riga 1' },
    ])
  })

  it('PERIODO con ultima riga incompleta: le fasce escono dopo la prima MOVIMENTO', () => {
    const r = righeDaLegami(
      [
        speciale({ rigaLegameId: 'RL1', quantita: '6000' }),
        speciale({
          legameId: 'L2',
          rigaLegameId: 'RL2',
          quantita: null,
          dataMovimento: '2026-11-04',
        }),
      ],
      mappa(periodo())
    )
    expect(r.errori).toEqual([{ codice: 'RIGA_LEGAME_INCOMPLETA' }])
    expect(r.righe.map(x => x.tipoRiga)).toEqual([
      'MOVIMENTO',
      'FASCIA_SPECIALE',
      'FASCIA_SPECIALE',
      'FASCIA_SPECIALE',
    ])
  })

  it('DOCUMENTO con quantità negativa: errore e nessuna MOVIMENTO', () => {
    const r = righeDaLegami([speciale({ quantita: '-5' })], mappa(voceListino()))
    expect(r.righe).toEqual([])
    expect(r.errori.map(e => e.codice)).toEqual(['PREZZO_SPECIALE_NON_VALIDO'])
  })

  it('riga di listino assente: PREZZO_SPECIALE_NON_VALIDO, nessuna riga', () => {
    const r = righeDaLegami([speciale()], new Map())
    expect(r.righe).toEqual([])
    expect(r.errori).toEqual([
      { codice: 'PREZZO_SPECIALE_NON_VALIDO', dettaglio: 'riga di listino assente' },
    ])
  })

  it('«riga <n>» e la posizione nel listino in ingresso; applicaA nullo ha nome proprio', () => {
    const l = mappa(
      voceListino({ id: 'A0', applicaA: 'DOCUMENTO' }),
      voceListino({ id: 'A1', applicaA: 'GIORNO' }),
      voceListino({ id: 'A2', applicaA: null })
    )
    const r = righeDaLegami(
      [speciale({ rigaAddebitoId: 'A2', rigaLegameId: 'RL2' }), speciale({ rigaLegameId: 'RL1' })],
      l
    )
    expect(r.errori).toEqual([
      { codice: 'FAMIGLIA_NON_CALCOLATA', dettaglio: 'GIORNO riga 2' },
      { codice: 'FAMIGLIA_NON_CALCOLATA', dettaglio: 'prezzo speciale senza regola riga 3' },
    ])
  })

  it('determinismo con prezzo speciale DOCUMENTO e PERIODO misti', () => {
    const l = [
      speciale({ legameId: 'L1', rigaLegameId: 'RL1', rigaAddebitoId: 'A1', quantita: '2000' }),
      speciale({ legameId: 'L2', rigaLegameId: 'RL2', rigaAddebitoId: 'A2', quantita: '3000' }),
      speciale({
        legameId: 'L3',
        rigaLegameId: 'RL3',
        rigaAddebitoId: 'A2',
        quantita: '4000',
        dataMovimento: '2026-11-04',
      }),
    ]
    const m = mappa(voceListino(), voceListino({ id: 'A2', applicaA: 'PERIODO' }))
    expect(righeDaLegami([...l].reverse(), m)).toEqual(righeDaLegami(l, m))
  })
})
