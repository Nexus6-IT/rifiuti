import { motivoValido, valutaChiusura } from './chiusura'

const voce = (esito: 'OK' | 'DIFFERENZA', chiave = 'x') => ({
  chiave,
  descrizione: 'd',
  sorgente: 1,
  destinazione: 2,
  esito,
})
const c = (voci: ReturnType<typeof voce>[]) => ({
  numero: 1 as const,
  titolo: 't',
  esito: 'DIFFERENZE' as const,
  voci,
})
const campioni = { totale: 0, senzaEsito: 0, nonCorrispondono: 0 }

describe('valutaChiusura', () => {
  it('tutti OK e campione completo: chiudibile', () => {
    expect(
      valutaChiusura({ confronti: [c([voce('OK')])], accettazioni: {} }, campioni).chiudibile
    ).toBe(true)
  })
  it('una differenza non accettata elenca la chiave', () => {
    const v = valutaChiusura(
      { confronti: [c([voce('DIFFERENZA', 'a')])], accettazioni: {} },
      campioni
    )
    expect(v.differenzeAperte).toEqual(['1:a'])
  })
  it('motivo vuoto o troppo corto non vale', () => {
    expect(motivoValido('   ')).toBeNull()
  })
})
