import { test, expect } from '@playwright/test'
import { conPrefissoUnico, haPrefissoDiRun } from '../../utils/run-id'

/**
 * Self-test di `conPrefissoUnico` (utils/run-id.ts): nessuna rete.
 *
 * Perché esiste: con `conPrefisso('Trasportatore SRL')` due test della stessa
 * run creavano anagrafiche con lo STESSO nome, e la scelta nel dropdown del
 * FIR (`.p-dropdown-item` con `hasText` + `.first()`) prendeva quella del
 * test precedente, senza scadenza: l'avviso di scadenza non compariva mai.
 */
test.describe('conPrefissoUnico', () => {
  test('due chiamate con lo stesso nome danno nomi diversi, entrambi col prefisso di run', () => {
    const a = conPrefissoUnico('Trasportatore SRL')
    const b = conPrefissoUnico('Trasportatore SRL')
    expect(a).not.toBe(b)
    expect(haPrefissoDiRun(a)).toBe(true)
    expect(haPrefissoDiRun(b)).toBe(true)
  })

  test('nessun nome è sottostringa di un altro (il dropdown filtra per sottostringa)', () => {
    const nomi = Array.from({ length: 50 }, () => conPrefissoUnico('Destinatario SRL'))
    for (const x of nomi) {
      for (const y of nomi) {
        if (x !== y) expect(y.includes(x), `${y} contiene ${x}`).toBe(false)
      }
    }
  })
})
