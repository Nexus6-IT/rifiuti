import {
  differenzeModifica,
  etichettaCodiceRentri,
  giornoSuccessivo,
  idUltimeVersioni,
  inizioProposto,
  leggiErroreCausali,
  opzioniCodiceRentri,
  opzioniRuoloMud,
  operazioneAmmessa,
} from './causali-gestione'
import type { CausaleAziendaleGestione } from './causali-registro.service'

const base: CausaleAziendaleGestione = {
  id: 'v1',
  codice: 'AZ_X',
  verso: 'SCARICO',
  descrizione: 'Descrizione',
  ruoloMud: 'AVVIATO',
  codiceRentri: 'aT',
  operazione: 'R',
  ordine: 100,
  validaDal: '2026-01-01',
  validaAl: null,
  usata: false,
  ultimoGiornoUso: null,
}

const valori = {
  descrizione: 'Descrizione',
  ordine: 100,
  ruoloMud: 'AVVIATO' as const,
  codiceRentri: 'aT' as string | null,
  operazione: 'R' as string | null,
  validaDal: '2026-01-01',
}

describe('causali-gestione', () => {
  it('opzioni filtrate per verso, con etichette leggibili', () => {
    expect(opzioniRuoloMud('CARICO').map(o => o.label)).toEqual([
      'Prodotto',
      'Ricevuto da terzi',
      'Escluso dal MUD',
    ])
    expect(opzioniRuoloMud('SCARICO').map(o => o.label)).toEqual([
      'Avviato a recupero o smaltimento',
      'Escluso dal MUD',
    ])
    expect(opzioniCodiceRentri('CARICO').map(o => o.value)).toEqual(['DT', 'NP', 'T*', 'RE'])
    expect(opzioniCodiceRentri('SCARICO').map(o => o.value)).toEqual(['I', 'aT', 'M'])
    expect(etichettaCodiceRentri('T*')).toBe('T* - Ricevuto da terzi')
    expect(operazioneAmmessa('SCARICO', 'AVVIATO')).toBeTrue()
    expect(operazioneAmmessa('SCARICO', 'ESCLUSO')).toBeFalse()
    expect(operazioneAmmessa('CARICO', 'AVVIATO')).toBeFalse()
  })

  it('il PATCH contiene solo i campi cambiati e null per azzerare', () => {
    expect(differenzeModifica(base, valori)).toEqual({})
    expect(differenzeModifica(base, { ...valori, descrizione: '  Altra ' })).toEqual({
      descrizione: 'Altra',
    })
    expect(differenzeModifica(base, { ...valori, codiceRentri: null, operazione: null })).toEqual({
      codiceRentri: null,
      operazione: null,
    })
    expect(differenzeModifica(base, { ...valori, codiceRentri: '' })).toEqual({
      codiceRentri: null,
    })
    expect(
      differenzeModifica(base, {
        ...valori,
        ordine: 5,
        ruoloMud: 'ESCLUSO',
        validaDal: '2026-02-01',
      })
    ).toEqual({ ordine: 5, ruoloMud: 'ESCLUSO', validaDal: '2026-02-01' })
  })

  it('i giorni si calcolano senza fuso, anche a cavallo di mese e anno', () => {
    expect(giornoSuccessivo('2026-12-31')).toBe('2027-01-01')
    expect(giornoSuccessivo('2028-02-28')).toBe('2028-02-29')
    expect(inizioProposto('2026-10-28', null)).toBe('2026-10-28')
    expect(inizioProposto('2026-10-28', '2026-10-28')).toBe('2026-10-29')
    expect(inizioProposto('2026-10-28', '2026-03-10')).toBe('2026-10-28')
  })

  it("legge messaggio e codice dell'errore del backend", () => {
    expect(
      leggiErroreCausali({ error: { message: 'Ciao', error: 'CAUSALE_SOVRAPPOSTA' } })
    ).toEqual({
      messaggio: 'Ciao',
      codice: 'CAUSALE_SOVRAPPOSTA',
    })
    expect(leggiErroreCausali({ error: { message: ['a', 'b'] } }).messaggio).toBe('a · b')
    expect(leggiErroreCausali({}).codice).toBeNull()
  })

  it("riconosce l'ultima versione di ogni causale", () => {
    const v2 = { ...base, id: 'v2', validaDal: '2026-06-01' }
    const altra = { ...base, id: 'w1', codice: 'AZ_Y' }
    expect([...idUltimeVersioni([base, v2, altra])].sort()).toEqual(['v2', 'w1'])
  })
})
