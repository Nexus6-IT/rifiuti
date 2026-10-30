import {
  ValoriFormSoglie,
  giorniEffettivi,
  messaggiErroreSoglie,
  validaFormSoglie,
} from './soglie-deposito-dialog.component'

const valido: ValoriFormSoglie = {
  livello: '',
  criterio: 'TEMPORALE',
  usaGiorni: false,
  giorniMax: null,
  kgMaxTotale: 30000,
  kgMaxPericolosi: 10000,
  preavvisoGiorni: 15,
  preavvisoPercentuale: 80,
  note: null,
}

describe('validaFormSoglie', () => {
  it('accetta valori validi', () => {
    expect(validaFormSoglie(valido)).toEqual({})
  })

  it('la soglia in giorni va da 1 a 92 e solo se la casella è accesa', () => {
    expect(validaFormSoglie({ ...valido, usaGiorni: true, giorniMax: 93 }).giorniMax).toContain(
      'al massimo 92 giorni'
    )
    expect(validaFormSoglie({ ...valido, usaGiorni: true, giorniMax: 0 }).giorniMax).toBeDefined()
    expect(validaFormSoglie({ ...valido, usaGiorni: true, giorniMax: 92 })).toEqual({})
    // casella spenta: il valore residuo non conta
    expect(validaFormSoglie({ ...valido, usaGiorni: false, giorniMax: 500 })).toEqual({})
  })

  it('con criterio QUANTITATIVO i giorni non si inviano', () => {
    const v = { ...valido, criterio: 'QUANTITATIVO' as const, usaGiorni: true, giorniMax: 30 }
    expect(giorniEffettivi(v)).toBeNull()
    expect(giorniEffettivi({ ...v, criterio: 'TEMPORALE' })).toBe(30)
  })

  it('pericolosi oltre il totale è un errore sul campo dei pericolosi', () => {
    const e = validaFormSoglie({ ...valido, kgMaxTotale: 100, kgMaxPericolosi: 200 })
    expect(e.kgMaxPericolosi).toBe('La soglia dei pericolosi non può superare la soglia totale.')
  })

  it('kg: positivi, al massimo 10.000.000 e 2 decimali', () => {
    expect(validaFormSoglie({ ...valido, kgMaxTotale: 0 }).kgMaxTotale).toBeDefined()
    expect(validaFormSoglie({ ...valido, kgMaxTotale: 10_000_001 }).kgMaxTotale).toBeDefined()
    expect(validaFormSoglie({ ...valido, kgMaxTotale: 100.123 }).kgMaxTotale).toContain(
      '2 decimali'
    )
    expect(validaFormSoglie({ ...valido, kgMaxPericolosi: null }).kgMaxPericolosi).toBeDefined()
  })

  it('preavvisi: giorni 0-88 e inferiori ai giorni, percentuale 0-99', () => {
    expect(validaFormSoglie({ ...valido, preavvisoGiorni: 89 }).preavvisoGiorni).toBeDefined()
    expect(
      validaFormSoglie({ ...valido, usaGiorni: true, giorniMax: 10, preavvisoGiorni: 10 })
        .preavvisoGiorni
    ).toBe('Il preavviso in giorni deve essere inferiore alla soglia in giorni.')
    expect(
      validaFormSoglie({ ...valido, preavvisoPercentuale: 100 }).preavvisoPercentuale
    ).toBeDefined()
    expect(validaFormSoglie({ ...valido, preavvisoPercentuale: 0 })).toEqual({})
  })

  it('la nota ha al massimo 500 caratteri', () => {
    expect(validaFormSoglie({ ...valido, note: 'x'.repeat(501) }).note).toBeDefined()
    expect(validaFormSoglie({ ...valido, note: 'x'.repeat(500) })).toEqual({})
  })
})

describe('messaggiErroreSoglie', () => {
  it('preferisce details.messaggi', () => {
    expect(
      messaggiErroreSoglie({ error: { message: 'x', details: { messaggi: ['a', 'b'] } } })
    ).toEqual(['a', 'b'])
  })
  it('ripiega su message (stringa o array) e poi su un testo generico', () => {
    expect(messaggiErroreSoglie({ error: { message: 'm' } })).toEqual(['m'])
    expect(messaggiErroreSoglie({ error: { message: ['p', 'q'] } })).toEqual(['p', 'q'])
    expect(messaggiErroreSoglie({})).toEqual(['Salvataggio delle soglie non riuscito.'])
  })
})
