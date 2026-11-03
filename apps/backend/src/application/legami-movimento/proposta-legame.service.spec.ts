import { BadRequestException } from '@nestjs/common'
import { giornoDelMovimento, importoVista, normalizzaDecimale } from './proposta-legame.service'

describe('proposta del legame: funzioni pure', () => {
  describe('giornoDelMovimento', () => {
    it('una data senza ora è già il giorno', () => {
      expect(giornoDelMovimento('2026-03-01')).toBe('2026-03-01')
    })
    it('un istante si porta al giorno italiano (mezzanotte e mezza di Roma è il giorno dopo)', () => {
      expect(giornoDelMovimento('2026-03-28T23:30:00.000Z')).toBe('2026-03-29')
      expect(giornoDelMovimento('2026-07-14T21:30:00.000Z')).toBe('2026-07-14')
      expect(giornoDelMovimento('2026-07-14T22:30:00.000Z')).toBe('2026-07-15')
    })
    it.each(['ieri', '', '2026-13-40', '2026-02-30'])('%j: 400', v => {
      expect(() => giornoDelMovimento(v)).toThrow(BadRequestException)
    })
  })

  describe('normalizzaDecimale', () => {
    it('toglie gli zeri finali della scala della colonna e non usa l’esponente', () => {
      expect(normalizzaDecimale('1.000000')).toBe('1')
      expect(normalizzaDecimale('22.00')).toBe('22')
      expect(normalizzaDecimale('10.500000')).toBe('10.5')
      expect(normalizzaDecimale('0.0000001')).toBe('0.0000001')
    })
    it('il nullo resta nullo', () => {
      expect(normalizzaDecimale(null)).toBeNull()
    })
  })

  describe('importoVista', () => {
    it('importo netto con lo sconto a cascata', () => {
      expect(importoVista('100', '1', null)).toBe('100.00')
      expect(importoVista('100', '1', '10')).toBe('90.00')
      expect(importoVista('100', '1', '10+10')).toBe('81.00')
    })
    it('senza quantità o senza prezzo non c’è importo', () => {
      expect(importoVista(null, '1', null)).toBeNull()
      expect(importoVista('100', null, null)).toBeNull()
    })
    it('uno sconto illeggibile non fa cadere la proposta: nessun importo', () => {
      expect(importoVista('100', '1', 'abc')).toBeNull()
    })
  })
})
