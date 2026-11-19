import { test, expect } from '@playwright/test'
import { ibanValido } from '../../../apps/backend/src/domain/clienti/iban'
import { ibanCasualeValido } from '../../utils/iban-di-test'

// Prova pura (nessun browser, nessun server): il generatore degli IBAN dei test deve produrre solo
// valori che il backend accetta, con qualunque numero di conto casuale.
test.describe('ibanCasualeValido', () => {
  test('20000 campioni: tutti validi per il backend, di 27 caratteri e senza spazi', () => {
    const rifiutati: string[] = []
    for (let i = 0; i < 20_000; i++) {
      const iban = ibanCasualeValido()
      if (!/^IT\d{2}X\d{22}$/.test(iban) || !ibanValido(iban)) rifiutati.push(iban)
    }
    expect(rifiutati.slice(0, 5)).toEqual([])
  })

  test('cifre di controllo agli estremi (02 e 98) comprese', () => {
    // Un solo campione per estremo basta a mostrare che il riempimento a due cifre regge.
    const visti = new Set<string>()
    for (let i = 0; i < 200_000 && visti.size < 2; i++) {
      const c = ibanCasualeValido().slice(2, 4)
      if (c === '02' || c === '98') visti.add(c)
    }
    expect([...visti].sort()).toEqual(['02', '98'])
  })

  test('valori diversi a ogni chiamata (l IBAN e unico per azienda)', () => {
    const insieme = new Set(Array.from({ length: 1000 }, () => ibanCasualeValido()))
    expect(insieme.size).toBe(1000)
  })
})
