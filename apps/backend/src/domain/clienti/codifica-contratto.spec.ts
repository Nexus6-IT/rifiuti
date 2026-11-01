import {
  ETICHETTE_GENERE,
  normalizzaCodifica,
  primoCodiceLibero,
  validaCodifica,
  type DatiCodifica,
} from './codifica-contratto'

const valida = (extra: Partial<DatiCodifica> = {}): DatiCodifica => ({
  genere: 'CATEGORIA',
  codice: '001',
  descrizione: 'Industria',
  ...extra,
})

describe('codificaContratto', () => {
  it('valida, anche con codice null', () => {
    expect(validaCodifica(valida())).toEqual([])
    expect(validaCodifica(valida({ codice: null }))).toEqual([])
  })
  it('descrizione vuota e di 61 caratteri', () => {
    expect(validaCodifica(valida({ descrizione: '' }))).toEqual(['Indica la descrizione.'])
    expect(validaCodifica(valida({ descrizione: 'D'.repeat(61) }))).toEqual([
      'La descrizione può avere al massimo 60 caratteri.',
    ])
    expect(validaCodifica(valida({ descrizione: 'D'.repeat(60) }))).toEqual([])
  })
  it('genere sconosciuto', () => {
    expect(validaCodifica(valida({ genere: 'ALTRO' as never }))).toEqual([
      'Il genere della codifica non è ammesso.',
    ])
  })
  it('codice ABCD non valido', () => {
    expect(validaCodifica(valida({ codice: 'ABCD' }))).toEqual([
      'Il codice può contenere solo lettere e cifre (massimo 3 caratteri).',
    ])
  })
  it('normalizza: trim, genere maiuscolo, codice vuoto -> null', () => {
    expect(normalizzaCodifica({ genere: ' tipo ', codice: '  ', descrizione: ' d ' })).toEqual({
      genere: 'TIPO',
      codice: null,
      descrizione: 'd',
    })
    expect(ETICHETTE_GENERE).toEqual({
      CATEGORIA: 'Categoria',
      TIPO: 'Tipo di contratto',
      MOTIVO_ANNULLO: 'Motivo di annullo',
    })
  })
})

describe('primoCodiceLibero', () => {
  it('elenco vuoto -> 001', () => expect(primoCodiceLibero([])).toBe('001'))
  it('primo buco', () => expect(primoCodiceLibero(['001', '002', '004'])).toBe('003'))
  it('codici non numerici ignorati', () => expect(primoCodiceLibero(['A', '001'])).toBe('002'))
  it('codici senza zeri iniziali contano come numeri', () => {
    expect(primoCodiceLibero(['1', '2'])).toBe('003')
  })
  it('001-999 usati -> null', () => {
    const tutti = Array.from({ length: 999 }, (_, i) => String(i + 1).padStart(3, '0'))
    expect(primoCodiceLibero(tutti)).toBeNull()
  })
})
