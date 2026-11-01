import {
  ETICHETTE_GENERE_ADDEBITO,
  normalizzaCodificaAddebito,
  validaCodificaAddebito,
  type GenereCodificaAddebito,
} from './codifica-addebito'

const GENERI: GenereCodificaAddebito[] = [
  'GRUPPO',
  'CATEGORIA',
  'CATEGORIA_STATISTICA_1',
  'CATEGORIA_STATISTICA_2',
  'CENTRO_RICAVO',
]

describe('codifica di addebito', () => {
  it("ha un'etichetta italiana per ogni genere", () => {
    expect(ETICHETTE_GENERE_ADDEBITO).toEqual({
      GRUPPO: 'Gruppo',
      CATEGORIA: 'Categoria di addebito',
      CATEGORIA_STATISTICA_1: 'Categoria statistica 1',
      CATEGORIA_STATISTICA_2: 'Categoria statistica 2',
      CENTRO_RICAVO: 'Centro di ricavo',
    })
  })

  describe('normalizza', () => {
    it('riempie il codice a tre cifre (7 -> 007)', () => {
      expect(
        normalizzaCodificaAddebito({ genere: 'GRUPPO', codice: '7', descrizione: 'x' }).codice
      ).toBe('007')
      expect(
        normalizzaCodificaAddebito({ genere: 'GRUPPO', codice: ' 42 ', descrizione: 'x' }).codice
      ).toBe('042')
    })
    it('codice vuoto o mancante diventa null', () => {
      expect(
        normalizzaCodificaAddebito({ genere: 'GRUPPO', codice: '  ', descrizione: 'x' }).codice
      ).toBeNull()
      expect(normalizzaCodificaAddebito({ genere: 'GRUPPO', descrizione: 'x' }).codice).toBeNull()
    })
    it('non altera un codice non numerico (lo rifiuta la validazione)', () => {
      expect(
        normalizzaCodificaAddebito({ genere: 'GRUPPO', codice: 'A1', descrizione: 'x' }).codice
      ).toBe('A1')
    })
    it('maiuscolo sul genere e trim sulla descrizione', () => {
      const d = normalizzaCodificaAddebito({
        genere: ' gruppo ',
        codice: '1',
        descrizione: '  Rifiuti  ',
      })
      expect(d.genere).toBe('GRUPPO')
      expect(d.descrizione).toBe('Rifiuti')
    })
    it('valori non stringa diventano vuoti', () => {
      const d = normalizzaCodificaAddebito({ genere: 5, codice: 7, descrizione: null })
      expect(d).toEqual({ genere: '', codice: null, descrizione: '' })
    })
  })

  describe('valida', () => {
    const ok = (codice: string | null) =>
      validaCodificaAddebito({ genere: 'GRUPPO', codice, descrizione: 'Gruppo' })

    it.each(GENERI)('accetta il genere %s', genere => {
      expect(validaCodificaAddebito({ genere, codice: '001', descrizione: 'x' })).toEqual([])
    })
    it('rifiuta un genere sconosciuto', () => {
      const e = validaCodificaAddebito({
        genere: 'TIPO' as GenereCodificaAddebito,
        codice: '001',
        descrizione: 'x',
      })
      expect(e).toEqual(['Il genere della codifica non è ammesso.'])
    })
    it('accetta 001 e 999 e il codice assente (assegnato dal servizio)', () => {
      expect(ok('001')).toEqual([])
      expect(ok('999')).toEqual([])
      expect(ok(null)).toEqual([])
    })
    it('rifiuta 1000, lettere e simboli con il messaggio di R2', () => {
      for (const c of ['1000', 'A1', '1A', '1.5', '0001', '7']) {
        expect(ok(c)).toEqual(['Il codice ha da 1 a 3 cifre.'])
      }
    })
    it('rifiuta 000', () => {
      expect(ok('000')).toEqual(['Il codice deve essere compreso tra 001 e 999.'])
    })
    it('descrizione obbligatoria', () => {
      expect(validaCodificaAddebito({ genere: 'GRUPPO', codice: '001', descrizione: '' })).toEqual([
        'Indica la descrizione.',
      ])
    })
    it('descrizione fino a 45 caratteri, oltre rifiutata', () => {
      const d = (n: number) =>
        validaCodificaAddebito({ genere: 'GRUPPO', codice: '001', descrizione: 'a'.repeat(n) })
      expect(d(45)).toEqual([])
      expect(d(46)).toEqual(['La descrizione può avere al massimo 45 caratteri.'])
    })
  })
})
