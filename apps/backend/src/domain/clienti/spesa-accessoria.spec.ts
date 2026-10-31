import {
  ETICHETTE_TIPO_SPESA,
  normalizzaSpesa,
  validaSpesa,
  type DatiSpesaAccessoria,
} from './spesa-accessoria'

const valida = (extra: Partial<DatiSpesaAccessoria> = {}): DatiSpesaAccessoria => ({
  tipo: 'INCASSO',
  codice: 'SP1',
  descrizione: 'Spese di incasso',
  importo: '2.50',
  ...extra,
})
const MSG_IMPORTO = "L'importo deve essere un numero non negativo con al massimo due decimali."

describe('spesaAccessoria', () => {
  it('spesa valida', () => expect(validaSpesa(valida())).toEqual([]))
  it('tipo ALTRO non ammesso', () => {
    expect(validaSpesa(valida({ tipo: 'ALTRO' as never }))).toEqual([
      'Il tipo di spesa non è ammesso.',
    ])
  })
  it('importo "-1", "1.234", "123456789" non validi; "0" valido', () => {
    expect(validaSpesa(valida({ importo: '-1' }))).toEqual([MSG_IMPORTO])
    expect(validaSpesa(valida({ importo: '1.234' }))).toEqual([MSG_IMPORTO])
    expect(validaSpesa(valida({ importo: '123456789' }))).toEqual([MSG_IMPORTO])
    expect(validaSpesa(valida({ importo: '' }))).toEqual([MSG_IMPORTO])
    expect(validaSpesa(valida({ importo: '0' }))).toEqual([])
  })
  it('codice e descrizione', () => {
    expect(validaSpesa(valida({ codice: 'A B' }))).toHaveLength(1)
    expect(validaSpesa(valida({ descrizione: '' }))).toEqual(['Indica la descrizione.'])
    expect(validaSpesa(valida({ descrizione: 'D'.repeat(101) }))).toHaveLength(1)
  })
  it('normalizza: importo con virgola a 2 decimali, tipo maiuscolo', () => {
    expect(
      normalizzaSpesa({ tipo: ' bollo ', codice: ' b ', descrizione: ' d ', importo: '2,5' })
    ).toEqual({
      tipo: 'BOLLO',
      codice: 'b',
      descrizione: 'd',
      importo: '2.50',
    })
    expect(normalizzaSpesa({}).importo).toBe('')
    expect(ETICHETTE_TIPO_SPESA).toEqual({ INCASSO: 'Spese di incasso', BOLLO: 'Bollo' })
  })
})
