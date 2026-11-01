import { NATURE_IVA, normalizzaCodiceIva, validaCodiceIva, type DatiCodiceIva } from './codice-iva'

const base: DatiCodiceIva = {
  codice: '22',
  descrizione: 'IVA ordinaria 22%',
  aliquota: '22.00',
  natura: null,
  attivo: true,
}

const MSG_NATURA_OBBLIGATORIA = "Con aliquota zero indica la natura dell'operazione (N1-N7)."
const MSG_NATURA_VIETATA = 'La natura si indica solo con aliquota zero.'
const MSG_NATURA_NON_AMMESSA =
  'La natura indicata non è ammessa nella fattura elettronica (usa N1, N2.1-N2.2, N3.1-N3.6, N4, N5, N6.1-N6.9 o N7).'
const MSG_ALIQUOTA = "L'aliquota deve essere un numero da 0 a 100 con al massimo due decimali."
const MSG_CODICE = 'Il codice IVA ha da 1 a 3 lettere o cifre.'

describe('NATURE_IVA', () => {
  it('elenca le nature della fattura elettronica', () => {
    expect([...NATURE_IVA]).toEqual([
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
  })
})

describe('validaCodiceIva', () => {
  it('22 senza natura è valido', () => {
    expect(validaCodiceIva(base)).toEqual([])
  })
  it('0 senza natura: messaggio D3', () => {
    expect(validaCodiceIva({ ...base, codice: 'N61', aliquota: '0.00' })).toEqual([
      MSG_NATURA_OBBLIGATORIA,
    ])
  })
  it('0 con N6.1 è valido', () => {
    expect(validaCodiceIva({ ...base, codice: 'N61', aliquota: '0.00', natura: 'N6.1' })).toEqual(
      []
    )
  })
  it('10 con natura: messaggio', () => {
    expect(validaCodiceIva({ ...base, aliquota: '10.00', natura: 'N4' })).toEqual([
      MSG_NATURA_VIETATA,
    ])
  })
  it('N2 generica rifiutata', () => {
    expect(validaCodiceIva({ ...base, aliquota: '0.00', natura: 'N2' })).toEqual([
      MSG_NATURA_NON_AMMESSA,
    ])
  })
  it.each(['100.01', '-1', 'abc', '', '1.234'])('aliquota %p: messaggio', aliquota => {
    expect(validaCodiceIva({ ...base, aliquota })).toEqual([MSG_ALIQUOTA])
  })
  it('aliquota 100.00 è valida', () => {
    expect(validaCodiceIva({ ...base, aliquota: '100.00' })).toEqual([])
  })
  it('codice di 4 caratteri o con simboli: messaggio', () => {
    expect(validaCodiceIva({ ...base, codice: 'ABCD' })).toEqual([MSG_CODICE])
    expect(validaCodiceIva({ ...base, codice: '' })).toEqual([MSG_CODICE])
    expect(validaCodiceIva({ ...base, codice: 'A-1' })).toEqual([MSG_CODICE])
  })
  it('descrizione vuota o > 60: messaggio', () => {
    expect(validaCodiceIva({ ...base, descrizione: '' })).toEqual(['Indica la descrizione.'])
    expect(validaCodiceIva({ ...base, descrizione: 'x'.repeat(61) })).toEqual([
      'La descrizione può avere al massimo 60 caratteri.',
    ])
    expect(validaCodiceIva({ ...base, descrizione: 'x'.repeat(60) })).toEqual([])
  })
  it("più errori nell'ordine dei campi", () => {
    expect(
      validaCodiceIva({
        codice: 'ABCD',
        descrizione: '',
        aliquota: 'abc',
        natura: 'N9',
        attivo: true,
      })
    ).toEqual([MSG_CODICE, 'Indica la descrizione.', MSG_ALIQUOTA, MSG_NATURA_NON_AMMESSA])
  })
  it('aliquota non valida non produce errori di natura', () => {
    expect(validaCodiceIva({ ...base, aliquota: 'abc', natura: 'N4' })).toEqual([MSG_ALIQUOTA])
  })
})

describe('normalizzaCodiceIva', () => {
  it('"22,5" diventa "22.50"', () => {
    expect(normalizzaCodiceIva({ ...base, aliquota: '22,5' }).aliquota).toBe('22.50')
  })
  it('"22" diventa "22.00" e un numero è accettato', () => {
    expect(normalizzaCodiceIva({ aliquota: '22' }).aliquota).toBe('22.00')
    expect(normalizzaCodiceIva({ aliquota: 10 }).aliquota).toBe('10.00')
  })
  it('un valore non numerico resta com’è, per farlo rifiutare', () => {
    expect(normalizzaCodiceIva({ aliquota: 'abc' }).aliquota).toBe('abc')
    expect(normalizzaCodiceIva({}).aliquota).toBe('')
  })
  it('codice e descrizione senza spazi ai bordi', () => {
    const n = normalizzaCodiceIva({ codice: ' n61 ', descrizione: '  Esente ' })
    expect(n.codice).toBe('N61')
    expect(n.descrizione).toBe('Esente')
  })
  it('un codice minuscolo e uno maiuscolo non possono coesistere', () => {
    expect(normalizzaCodiceIva({ codice: 'n61' }).codice).toBe(
      normalizzaCodiceIva({ codice: 'N61' }).codice
    )
  })
  it('aliquote con zeri iniziali o finali: confronto senza number', () => {
    expect(validaCodiceIva({ ...base, aliquota: '022.00' })).toEqual([])
    expect(validaCodiceIva({ ...base, aliquota: '000.00', natura: 'N1' })).toEqual([])
    expect(validaCodiceIva({ ...base, aliquota: '100.10' })).toHaveLength(1)
  })
  it('natura: maiuscola, vuota o assente → null', () => {
    expect(normalizzaCodiceIva({ natura: ' n6.1 ' }).natura).toBe('N6.1')
    expect(normalizzaCodiceIva({ natura: '' }).natura).toBeNull()
    expect(normalizzaCodiceIva({ natura: null }).natura).toBeNull()
    expect(normalizzaCodiceIva({}).natura).toBeNull()
  })
  it('attivo: true se non indicato, false solo se esplicito', () => {
    expect(normalizzaCodiceIva({}).attivo).toBe(true)
    expect(normalizzaCodiceIva({ attivo: false }).attivo).toBe(false)
    expect(normalizzaCodiceIva({ attivo: 'false' }).attivo).toBe(false)
  })
})
