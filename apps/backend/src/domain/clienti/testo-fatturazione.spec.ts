import { normalizzaTesto, validaTesto, type DatiTestoFatturazione } from './testo-fatturazione'

const valido = (extra: Partial<DatiTestoFatturazione> = {}): DatiTestoFatturazione => ({
  codice: 'T1',
  titolo: 'Pagamento',
  righe: ['Prima riga'],
  ...extra,
})
const MSG_RIGHE = 'Il testo di fatturazione ha da 1 a 16 righe di al massimo 60 caratteri.'

describe('testoFatturazione', () => {
  it('valido con 1 e con 16 righe', () => {
    expect(validaTesto(valido())).toEqual([])
    expect(validaTesto(valido({ righe: Array.from({ length: 16 }, () => 'riga') }))).toEqual([])
  })
  it('17 righe, nessuna riga, riga di 61 caratteri', () => {
    expect(validaTesto(valido({ righe: Array.from({ length: 17 }, () => 'riga') }))).toEqual([
      MSG_RIGHE,
    ])
    expect(validaTesto(valido({ righe: [] }))).toEqual([MSG_RIGHE])
    expect(validaTesto(valido({ righe: ['x'.repeat(61)] }))).toEqual([MSG_RIGHE])
    expect(validaTesto(valido({ righe: ['x'.repeat(60)] }))).toEqual([])
  })
  it('titolo vuoto o di 61 caratteri', () => {
    expect(validaTesto(valido({ titolo: '' }))).toEqual(['Indica il titolo.'])
    expect(validaTesto(valido({ titolo: 'T'.repeat(61) }))).toEqual([
      'Il titolo può avere al massimo 60 caratteri.',
    ])
  })
  it('codice ABCD e A-1 non validi', () => {
    const m = 'Il codice può contenere solo lettere e cifre (massimo 3 caratteri).'
    expect(validaTesto(valido({ codice: 'ABCD' }))).toEqual([m])
    expect(validaTesto(valido({ codice: 'A-1' }))).toEqual([m])
  })
  it('normalizza: righe con trimEnd, vuote in coda tolte, vuote in mezzo conservate', () => {
    const d = normalizzaTesto({
      codice: ' T1 ',
      titolo: ' Titolo ',
      righe: ['  uno  ', '', 'tre   ', '', '   '],
    })
    expect(d).toEqual({ codice: 'T1', titolo: 'Titolo', righe: ['  uno', '', 'tre'] })
    expect(normalizzaTesto({}).righe).toEqual([])
  })
})
