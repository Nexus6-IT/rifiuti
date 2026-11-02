import {
  CAMPI_PER_FAMIGLIA,
  CampoRiga,
  ETICHETTE_APPLICA_A,
  ETICHETTE_PERIODO_SCADENZE,
  ETICHETTE_TIPO_CALCOLO,
  ETICHETTE_TIPO_QUANTITA,
  OPZIONI_APPLICA_A,
  OPZIONI_TIPO_CALCOLO,
  OPZIONI_TIPO_QUANTITA,
  PERIODI_EXTRA,
  campoAbilitato,
  CONCORDANZA_GENERE_ADDEBITO,
  ETICHETTE_FAMIGLIA,
  ETICHETTE_GENERE_ADDEBITO,
  ETICHETTE_NATURA_IVA,
  ETICHETTE_TIPO_PROVVIGIONE,
  ETICHETTE_TIPO_VARIAZIONE,
  NATURE_IVA,
  OPZIONI_GENERE_ADDEBITO,
  TIPI_ELENCABILI,
  etichettaTipo,
  famigliaTipo,
  tipoAddebitoValido,
} from './vocabolario-listino'

/** Tutti i tipi di E5, con `T…` e `M…` nelle due forme (fissa e per categoria). */
const TIPI_E5 = [
  'CER',
  'V',
  'F',
  'TS',
  'TP',
  'TR',
  'TQ',
  'TT',
  'TF',
  'T020',
  'NM',
  'NP',
  'NG',
  'NR',
  'MF',
  'MW',
  'M020',
  '$A',
  '$D',
  '$R',
]

describe('vocabolario listino', () => {
  it('ogni tipo di E5 ha etichetta e famiglia', () => {
    for (const t of TIPI_E5) {
      expect(tipoAddebitoValido(t)).withContext(t).toBeTrue()
      expect(etichettaTipo(t).length).withContext(t).toBeGreaterThan(3)
      expect(ETICHETTE_FAMIGLIA[famigliaTipo(t)]).withContext(t).toBeTruthy()
    }
  })

  it('famiglie di D5', () => {
    expect(famigliaTipo('CER')).toBe('CER')
    expect(famigliaTipo('V')).toBe('VARIABILE')
    expect(famigliaTipo('F')).toBe('FISSO')
    expect(famigliaTipo('TS')).toBe('QUANTITA_MOVIMENTI')
    expect(famigliaTipo('T020')).toBe('QUANTITA_MOVIMENTI')
    expect(famigliaTipo('NG')).toBe('CONTEGGIO')
    expect(famigliaTipo('MW')).toBe('MINIMO')
    expect(famigliaTipo('M020')).toBe('MINIMO')
    expect(famigliaTipo('$R')).toBe('ACCONTO')
  })

  it('etichette copiate dal dominio, categoria compresa', () => {
    expect(etichettaTipo('F')).toBe('Importo fisso periodico')
    expect(etichettaTipo('T020')).toBe(
      'Peso netto di tutti i rifiuti di cat. 020 del presente elenco'
    )
    expect(etichettaTipo('$D')).toBe('Detrazione da applicare alla prossima fattura')
  })

  it('un tipo non ammesso è rifiutato', () => {
    expect(tipoAddebitoValido('XX')).toBeFalse()
    expect(tipoAddebitoValido('T12')).toBeFalse()
    expect(() => famigliaTipo('XX')).toThrowError('Il tipo di addebito non è ammesso.')
  })

  it('i menu escludono CER e portano i modelli T??? e M???', () => {
    const tipi = TIPI_ELENCABILI.map(t => t.tipo)
    expect(tipi).not.toContain('CER')
    expect(tipi).toContain('T???')
    expect(tipi).toContain('M???')
    expect(tipi.length).toBe(19)
    expect(TIPI_ELENCABILI.find(t => t.tipo === 'T???')!.etichetta).toBe(
      'Peso netto di tutti i rifiuti di cat. ??? del presente elenco'
    )
  })

  it('cinque generi di codifica, ognuno con la concordanza', () => {
    expect(Object.keys(ETICHETTE_GENERE_ADDEBITO)).toEqual([
      'GRUPPO',
      'CATEGORIA',
      'CATEGORIA_STATISTICA_1',
      'CATEGORIA_STATISTICA_2',
      'CENTRO_RICAVO',
    ])
    expect(OPZIONI_GENERE_ADDEBITO.map(o => o.value).length).toBe(5)
    for (const g of Object.keys(ETICHETTE_GENERE_ADDEBITO)) {
      expect(
        CONCORDANZA_GENERE_ADDEBITO[g as keyof typeof CONCORDANZA_GENERE_ADDEBITO]
      ).toBeDefined()
    }
  })

  it('nature IVA ammesse in fattura elettronica, tutte con etichetta', () => {
    expect(NATURE_IVA).toEqual([
      'N1',
      'N2.1',
      'N2.2',
      'N3.1',
      'N3.2',
      'N3.3',
      'N3.4',
      'N3.5',
      'N3.6',
      'N4',
      'N5',
      'N6.1',
      'N6.2',
      'N6.3',
      'N6.4',
      'N6.5',
      'N6.6',
      'N6.7',
      'N6.8',
      'N6.9',
      'N7',
    ])
    for (const n of NATURE_IVA) expect(ETICHETTE_NATURA_IVA[n]).withContext(n).toBeTruthy()
    expect(NATURE_IVA).not.toContain('N2')
    expect(NATURE_IVA).not.toContain('N3')
  })

  it('tipi di provvigione e di variazione', () => {
    expect(Object.keys(ETICHETTE_TIPO_PROVVIGIONE)).toEqual(['SCONTATO', 'LORDO'])
    expect(Object.keys(ETICHETTE_TIPO_VARIAZIONE).length).toBe(5)
  })

  describe('campi per famiglia (D9)', () => {
    const solo = (f: keyof typeof CAMPI_PER_FAMIGLIA, ...altre: CampoRiga[]) =>
      altre.every(c => !CAMPI_PER_FAMIGLIA[f].includes(c))

    it('ogni famiglia ha i campi comuni e nessun doppione', () => {
      for (const f of Object.keys(CAMPI_PER_FAMIGLIA) as (keyof typeof CAMPI_PER_FAMIGLIA)[]) {
        const campi = CAMPI_PER_FAMIGLIA[f]
        expect(new Set(campi).size).withContext(f).toBe(campi.length)
        for (const c of ['tipo', 'unitaMisura', 'prezzo', 'codiceIvaId', 'appunti'] as CampoRiga[])
          expect(campi).withContext(`${f} ${c}`).toContain(c)
      }
    })

    it("CER: il CER e non l'addebito; V, F, T, N, M e $: l'addebito e non il CER", () => {
      expect(CAMPI_PER_FAMIGLIA.CER).toContain('cerCode')
      expect(CAMPI_PER_FAMIGLIA.CER).not.toContain('addebitoId')
      for (const f of [
        'VARIABILE',
        'FISSO',
        'QUANTITA_MOVIMENTI',
        'CONTEGGIO',
        'MINIMO',
        'ACCONTO',
      ] as const) {
        expect(CAMPI_PER_FAMIGLIA[f]).toContain('addebitoId')
        expect(CAMPI_PER_FAMIGLIA[f]).not.toContain('cerCode')
      }
    })

    it('tipo di quantità solo per CER e V; quantità fissa e scadenze solo per F', () => {
      expect(CAMPI_PER_FAMIGLIA.CER).toContain('tipoQuantita')
      expect(CAMPI_PER_FAMIGLIA.VARIABILE).toContain('tipoQuantita')
      expect(CAMPI_PER_FAMIGLIA.FISSO).toContain('quantitaFissa')
      expect(CAMPI_PER_FAMIGLIA.FISSO).toContain('scadenze')
      for (const f of ['QUANTITA_MOVIMENTI', 'CONTEGGIO', 'MINIMO', 'ACCONTO'] as const)
        expect(solo(f, 'tipoQuantita', 'quantitaFissa', 'scadenze'))
          .withContext(f)
          .toBeTrue()
    })

    it('stato fisico, operazione, tipologia e CER proposti: CER; CER di proposta: V', () => {
      for (const c of [
        'statoFisico',
        'operazione',
        'tipologiaRifiuto',
        'addebitiProposti',
      ] as const)
        expect(CAMPI_PER_FAMIGLIA.CER).toContain(c)
      expect(CAMPI_PER_FAMIGLIA.VARIABILE).toContain('cerProposta')
      expect(CAMPI_PER_FAMIGLIA.CER).not.toContain('cerProposta')
      expect(solo('FISSO', 'statoFisico', 'operazione', 'tipologiaRifiuto')).toBeTrue()
    })

    it('fasce: CER, V, T e N; condizione anche in F; minimo solo CER e V', () => {
      for (const f of ['CER', 'VARIABILE', 'QUANTITA_MOVIMENTI', 'CONTEGGIO'] as const) {
        expect(CAMPI_PER_FAMIGLIA[f]).toContain('scaglioni')
        expect(CAMPI_PER_FAMIGLIA[f]).toContain('applicaA')
        expect(CAMPI_PER_FAMIGLIA[f]).toContain('condizioniRiferite')
      }
      expect(CAMPI_PER_FAMIGLIA.FISSO).toContain('condizione')
      expect(CAMPI_PER_FAMIGLIA.FISSO).not.toContain('scaglioni')
      expect(CAMPI_PER_FAMIGLIA.MINIMO).not.toContain('condizione')
      expect(CAMPI_PER_FAMIGLIA.ACCONTO).not.toContain('scaglioni')
      expect(CAMPI_PER_FAMIGLIA.CER).toContain('minimoFatturabile')
      expect(CAMPI_PER_FAMIGLIA.VARIABILE).toContain('minimoPerCategoria')
      expect(CAMPI_PER_FAMIGLIA.CONTEGGIO).not.toContain('minimoFatturabile')
    })

    it('periodo delle scadenze e periodo extra solo per F', () => {
      for (const c of ['periodoScadenze', 'periodoExtraDal', 'periodoExtraAl'] as const) {
        expect(CAMPI_PER_FAMIGLIA.FISSO).toContain(c)
        expect(CAMPI_PER_FAMIGLIA.CER).not.toContain(c)
      }
    })

    it('campoAbilitato e la famiglia di un tipo', () => {
      expect(campoAbilitato(famigliaTipo('F'), 'quantitaFissa')).toBeTrue()
      expect(campoAbilitato(famigliaTipo('V'), 'quantitaFissa')).toBeFalse()
      expect(campoAbilitato(famigliaTipo('M020'), 'prezzo')).toBeTrue()
    })
  })

  describe('liste dei menu (E13, E15, R50, D14)', () => {
    it('tipi di quantità (E15)', () => {
      expect(OPZIONI_TIPO_QUANTITA.map(o => o.value)).toEqual([
        'PESO_NETTO',
        'PESO_LORDO',
        'VOLUME',
        'UNO',
        'ALTRO',
      ])
      expect(ETICHETTE_TIPO_QUANTITA.PESO_NETTO).toBe('Peso netto')
    })

    it('"applica a" con le cinque voci di E13', () => {
      expect(OPZIONI_APPLICA_A.length).toBe(5)
      expect(ETICHETTE_APPLICA_A.CONGUAGLIO_365).toContain('365')
    })

    it('tipi di calcolo: dieci, E e H dicono "tutta la quantità" senza fasce precedenti (R50)', () => {
      expect(OPZIONI_TIPO_CALCOLO.map(o => o.value)).toEqual([
        'A',
        'B',
        'C',
        'D',
        'E',
        'X',
        'Y',
        'Z',
        'W',
        'H',
      ])
      expect(ETICHETTE_TIPO_CALCOLO.E).toContain('tutta la quantità')
      expect(ETICHETTE_TIPO_CALCOLO.E).toContain('come D')
      expect(ETICHETTE_TIPO_CALCOLO.H).toContain('come E')
    })

    it('periodi delle scadenze: 13 ordinari e 3 extra', () => {
      expect(Object.keys(ETICHETTE_PERIODO_SCADENZE).length).toBe(16)
      expect(PERIODI_EXTRA).toEqual(['XA', 'XD', 'YC'])
      for (const p of PERIODI_EXTRA) expect(ETICHETTE_PERIODO_SCADENZE[p]).toBeTruthy()
    })
  })
})
