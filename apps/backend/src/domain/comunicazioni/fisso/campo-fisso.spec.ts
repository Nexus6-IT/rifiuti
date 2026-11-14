import {
  caratteriNonRappresentabili,
  dataAaaammgg,
  decimaleFisso,
  layout,
  normalizzaTesto,
  numeroSegnato,
  numeroZeri,
  spazi,
  testo,
} from './campo-fisso'
import { codificaCp1252 } from './codifica-cp1252'

describe('campo-fisso', () => {
  describe('normalizzaTesto', () => {
    it('NFC, controlli → spazio, spazi multipli e bordi ridotti', () => {
      expect(normalizzaTesto('  Rossi \t\r\n  S.r.l.  ')).toBe('Rossi S.r.l.')
      expect(normalizzaTesto('é')).toBe('é') // e + accento combinante → é
    })
    it('null/undefined → vuoto', () => {
      expect(normalizzaTesto(null)).toBe('')
      expect(normalizzaTesto(undefined)).toBe('')
    })
  })

  describe('testo', () => {
    it('riempie a destra di spazi', () => {
      expect(testo('ab', 5)).toBe('ab   ')
    })
    it('tronca alla lunghezza', () => {
      expect(testo('abcdefgh', 3)).toBe('abc')
    })
    it('vuoto → solo spazi', () => {
      expect(testo(null, 4)).toBe('    ')
      expect(spazi(3)).toBe('   ')
    })
    it('la lunghezza in byte dopo la codifica coincide con quella richiesta', () => {
      const s = testo('Società “Alfa” € – Città', 30)
      expect(codificaCp1252(s)).toHaveLength(30)
    })
    it('non spezza una coppia surrogata (resta un carattere, poi bloccato dalla code page)', () => {
      expect(Array.from(testo('a😀b', 2))).toEqual(['a', '😀'])
    })
  })

  describe('numeroZeri', () => {
    it('zeri a sinistra', () => expect(numeroZeri(42, 6)).toBe('000042'))
    it('lancia se non entra o se negativo o non intero', () => {
      expect(() => numeroZeri(1234567, 6)).toThrow(RangeError)
      expect(() => numeroZeri(-1, 6)).toThrow(RangeError)
      expect(() => numeroZeri(1.5, 6)).toThrow(RangeError)
    })
  })

  describe('numeroSegnato', () => {
    it('a sinistra, spazi a destra, segno - in testa', () => {
      expect(numeroSegnato(1200, 11)).toBe('1200       ')
      expect(numeroSegnato(-350, 11)).toBe('-350       ')
    })
    it('-0 → 0; lancia se non entra', () => {
      expect(numeroSegnato(-0, 3)).toBe('0  ')
      expect(() => numeroSegnato(-12345, 5)).toThrow(RangeError)
      expect(() => numeroSegnato(1.2, 5)).toThrow(RangeError)
    })
  })

  describe('decimaleFisso', () => {
    it('7 decimali col punto, giustificato a destra su 14', () => {
      expect(decimaleFisso(1.5, 7, 14)).toBe('     1.5000000')
      expect(decimaleFisso(0, 7, 14)).toBe('     0.0000000')
    })
    it('lancia se non entra o non finito', () => {
      expect(() => decimaleFisso(123456789.5, 7, 14)).toThrow(RangeError)
      expect(() => decimaleFisso(Number.NaN, 7, 14)).toThrow(RangeError)
    })
    it('-0 → 0', () => {
      expect(decimaleFisso(-0, 2, 6)).toBe('  0.00')
    })
  })

  describe('dataAaaammgg', () => {
    it('da YYYY-MM-DD e da Date (UTC)', () => {
      expect(dataAaaammgg('2026-03-07')).toBe('20260307')
      expect(dataAaaammgg(new Date('2026-03-07T00:00:00Z'))).toBe('20260307')
    })
    it('vuota → 8 spazi; non valida → lancia', () => {
      expect(dataAaaammgg(null)).toBe('        ')
      expect(dataAaaammgg('')).toBe('        ')
      expect(() => dataAaaammgg('7/3/2026')).toThrow(RangeError)
    })
  })

  describe('layout', () => {
    it('calcola gli offset contigui', () => {
      expect(
        layout(
          [
            { nome: 'a', lunghezza: 3 },
            { nome: 'b', lunghezza: 2 },
          ],
          5
        )
      ).toEqual([
        { nome: 'a', lunghezza: 3, offset: 0 },
        { nome: 'b', lunghezza: 2, offset: 3 },
      ])
    })
    it('lancia se la somma non è la lunghezza del record o una lunghezza è non valida', () => {
      expect(() => layout([{ nome: 'a', lunghezza: 3 }], 4)).toThrow(/somma 3/)
      expect(() => layout([{ nome: 'a', lunghezza: 0 }], 0)).toThrow(/lunghezza non valida/)
    })
  })

  describe('caratteriNonRappresentabili', () => {
    it('vuota se tutto rappresentabile, altrimenti un avviso con l’etichetta', () => {
      expect(caratteriNonRappresentabili('Città', 'Ragione sociale')).toEqual([])
      expect(caratteriNonRappresentabili('A→B', 'Ragione sociale')).toEqual([
        'Ragione sociale: carattere non rappresentabile in Windows-1252 (→)',
      ])
    })
  })
})
