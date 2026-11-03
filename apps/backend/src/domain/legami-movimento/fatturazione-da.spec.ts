import {
  dataFatturazioneValida,
  movimentiToccati,
  movimentoInFatturazione,
} from './fatturazione-da'

describe('fatturazione da — dominio', () => {
  describe('dataFatturazioneValida', () => {
    it.each(['2026-01-01', '2024-02-29', '2026-12-31'])('%s: valida', d => {
      expect(dataFatturazioneValida(d)).toBe(true)
    })
    it.each([
      '2026-13-40',
      '2026-02-30',
      '2025-02-29',
      '2026-1-1',
      '01/01/2026',
      '2026-01-01T00:00:00Z',
      '',
      ' 2026-01-01',
    ])('%j: non valida', d => {
      expect(dataFatturazioneValida(d)).toBe(false)
    })
  })

  describe('movimentiToccati', () => {
    it('nessun cambio: nessun intervallo', () => {
      expect(movimentiToccati(null, null)).toBeNull()
      expect(movimentiToccati('2026-03-01', '2026-03-01')).toBeNull()
    })
    it('da spenta a una data: tutto da quella data in poi', () => {
      expect(movimentiToccati(null, '2026-03-01')).toEqual({ da: '2026-03-01', a: null })
    })
    it('da una data a spenta: tutto da quella data in poi', () => {
      expect(movimentiToccati('2026-03-01', null)).toEqual({ da: '2026-03-01', a: null })
    })
    it('indietro o avanti: solo l’intervallo [min, max)', () => {
      expect(movimentiToccati('2026-03-01', '2026-01-01')).toEqual({
        da: '2026-01-01',
        a: '2026-03-01',
      })
      expect(movimentiToccati('2026-01-01', '2026-03-01')).toEqual({
        da: '2026-01-01',
        a: '2026-03-01',
      })
    })
  })

  describe('movimentoInFatturazione', () => {
    it('fatturazione spenta: nessun movimento entra', () => {
      expect(movimentoInFatturazione('2026-03-01', null)).toBe(false)
    })
    it('il giorno di partenza compreso, il precedente escluso', () => {
      expect(movimentoInFatturazione('2026-03-01', '2026-03-01')).toBe(true)
      expect(movimentoInFatturazione('2026-03-02', '2026-03-01')).toBe(true)
      expect(movimentoInFatturazione('2026-02-28', '2026-03-01')).toBe(false)
    })
  })
})
