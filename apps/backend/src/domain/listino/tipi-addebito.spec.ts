import {
  TIPI_ELENCABILI,
  etichettaTipo,
  famigliaTipo,
  tipoAddebitoValido,
  tipoAmmessoInAllegato,
  tipoAmmessoInArchivio,
  type FamigliaAddebito,
} from './tipi-addebito'

const FAMIGLIE: [string, FamigliaAddebito][] = [
  ['CER', 'CER'],
  ['V', 'VARIABILE'],
  ['F', 'FISSO'],
  ...['TS', 'TP', 'TR', 'TQ', 'TT', 'TF', 'T123'].map((t): [string, FamigliaAddebito] => [
    t,
    'QUANTITA_MOVIMENTI',
  ]),
  ...['NM', 'NP', 'NG', 'NR'].map((t): [string, FamigliaAddebito] => [t, 'CONTEGGIO']),
  ...['MF', 'MW', 'M001'].map((t): [string, FamigliaAddebito] => [t, 'MINIMO']),
  ...['$A', '$D', '$R'].map((t): [string, FamigliaAddebito] => [t, 'ACCONTO']),
]

describe('tipi di addebito', () => {
  it.each(FAMIGLIE)("%s e' valido con famiglia %s", (tipo, famiglia) => {
    expect(tipoAddebitoValido(tipo)).toBe(true)
    expect(famigliaTipo(tipo)).toBe(famiglia)
    expect(etichettaTipo(tipo)).not.toBe('')
    expect(etichettaTipo(tipo)).not.toContain('?')
  })

  it.each([
    'T12',
    'T1234',
    'TX',
    'TA',
    '$X',
    'CERX',
    'M12',
    'MX',
    'NX',
    'v',
    'VV',
    '',
    ' V',
    'T12a',
    'CER ',
  ])("%j non e' valido", tipo => {
    expect(tipoAddebitoValido(tipo)).toBe(false)
  })

  it('famigliaTipo rifiuta un tipo non valido', () => {
    expect(() => famigliaTipo('TX')).toThrow('Il tipo di addebito non è ammesso.')
  })

  it('etichettaTipo rifiuta un tipo non valido', () => {
    expect(() => etichettaTipo('TX')).toThrow('Il tipo di addebito non è ammesso.')
  })

  it('sostituisce ??? con la categoria', () => {
    expect(etichettaTipo('T005')).toBe('Peso netto di cat. 005 del presente elenco')
    expect(etichettaTipo('M005')).toBe('Minimo di cat. 005 del presente elenco')
  })

  it('le etichette dei tipi fissi sono tutte diverse', () => {
    const e = FAMIGLIE.map(([t]) => etichettaTipo(t))
    expect(new Set(e).size).toBe(e.length)
  })

  it("CER non e' ammesso in archivio, tutti gli altri si", () => {
    expect(tipoAmmessoInArchivio('CER')).toBe(false)
    for (const [t] of FAMIGLIE.filter(([t]) => t !== 'CER'))
      expect(tipoAmmessoInArchivio(t)).toBe(true)
    expect(tipoAmmessoInArchivio('TX')).toBe(false)
  })

  it('in allegato solo T...', () => {
    for (const [t, f] of FAMIGLIE) {
      expect(tipoAmmessoInAllegato(t)).toBe(f === 'QUANTITA_MOVIMENTI')
    }
    expect(tipoAmmessoInAllegato('TX')).toBe(false)
  })

  it('TIPI_ELENCABILI: tutti validi (T??? e M??? come modelli), senza CER, senza doppioni', () => {
    const tipi = TIPI_ELENCABILI.map(t => t.tipo)
    expect(tipi).toContain('T???')
    expect(tipi).toContain('M???')
    expect(tipi).not.toContain('CER')
    expect(new Set(tipi).size).toBe(tipi.length)
    for (const t of TIPI_ELENCABILI) {
      expect(tipoAddebitoValido(t.tipo.replace('???', '000'))).toBe(true)
      expect(t.etichetta).toBe(etichettaTipo(t.tipo.replace('???', '000')).replace('000', '???'))
    }
    expect(tipi).toHaveLength(19)
  })
})
