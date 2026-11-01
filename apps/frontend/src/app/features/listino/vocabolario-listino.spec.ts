import {
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
})
