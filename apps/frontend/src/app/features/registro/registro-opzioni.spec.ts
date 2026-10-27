import { causaleSelezionabile, opzioniCausali } from './registro-opzioni'

const righe = [
  { codice: 'PRODUZIONE_INTERNA', descrizione: 'Produzione interna' },
  { codice: 'AZ_RESO', descrizione: 'Reso da cliente' },
]

describe('opzioniCausali (dalle righe dell’API)', () => {
  it('etichetta ogni riga con la descrizione e tiene il codice come valore', () => {
    expect(opzioniCausali(righe)).toEqual([
      { label: 'Produzione interna', value: 'PRODUZIONE_INTERNA' },
      { label: 'Reso da cliente', value: 'AZ_RESO' },
    ])
  })

  it('una causale corrente fuori elenco si aggiunge con la sua descrizione, o con il codice', () => {
    expect(opzioniCausali(righe, { codice: 'AZ_VECCHIA', descrizione: 'Vecchia' }).pop()).toEqual({
      label: 'Vecchia',
      value: 'AZ_VECCHIA',
    })
    expect(opzioniCausali(righe, { codice: 'AZ_VECCHIA' }).pop()).toEqual({
      label: 'AZ_VECCHIA',
      value: 'AZ_VECCHIA',
    })
  })

  it('una causale corrente già presente non si duplica', () => {
    expect(opzioniCausali(righe, { codice: 'AZ_RESO', descrizione: 'x' }).length).toBe(2)
  })

  it('causaleSelezionabile guarda solo i codici delle righe', () => {
    expect(causaleSelezionabile(righe, 'AZ_RESO')).toBeTrue()
    expect(causaleSelezionabile(righe, 'AZ_ALTRA')).toBeFalse()
    expect(causaleSelezionabile(righe, null)).toBeFalse()
  })
})
