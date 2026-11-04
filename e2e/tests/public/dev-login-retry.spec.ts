import { test, expect } from '@playwright/test'
import {
  DEV_LOGIN_ATTESA_MAX_MS,
  RICHIESTA_ATTESA_MAX_MS,
  RICHIESTA_TENTATIVI_MAX,
  decidiRetryDevLogin,
  decidiRetryRichiesta,
  leggiRetryAfterSecondi,
} from '../../utils/dev-login-retry'

/**
 * Self-test della logica di retry del dev-login dopo un 429 (nessuna rete).
 */
test.describe('dev-login — retry su 429', () => {
  test('nessun retry su status diversi da 429', () => {
    for (const status of [400, 401, 403, 404, 500, 503]) {
      expect(decidiRetryDevLogin(status, 1, 0, null).riprova).toBe(false)
    }
  })

  test('429 con header: attende i secondi indicati (più margine)', () => {
    expect(decidiRetryDevLogin(429, 1, 0, 2)).toEqual({ riprova: true, attesaMs: 2100 })
  })

  test('429 senza header: backoff esponenziale 1s, 2s, 4s', () => {
    const attese = [1, 2, 3].map(t => decidiRetryDevLogin(429, t, 0, null))
    expect(attese).toEqual([
      { riprova: true, attesaMs: 1000 },
      { riprova: true, attesaMs: 2000 },
      { riprova: true, attesaMs: 4000 },
    ])
  })

  test('oltre il tetto complessivo non riprova', () => {
    expect(decidiRetryDevLogin(429, 1, 0, 60).riprova).toBe(false)
    expect(decidiRetryDevLogin(429, 5, DEV_LOGIN_ATTESA_MAX_MS - 500, null).riprova).toBe(false)
  })

  test('legge Retry-After e Retry-After-<throttler> (il più alto)', () => {
    expect(leggiRetryAfterSecondi(new Headers())).toBeNull()
    expect(leggiRetryAfterSecondi(new Headers({ 'Retry-After': '3' }))).toBe(3)
    expect(
      leggiRetryAfterSecondi(new Headers({ 'Retry-After-short': '1', 'retry-after-medium': '7' }))
    ).toBe(7)
    expect(leggiRetryAfterSecondi(new Headers({ 'Retry-After': 'abc' }))).toBeNull()
  })
})

test.describe('richieste API — retry su 429', () => {
  test('nessun retry su status diversi da 429', () => {
    for (const status of [400, 401, 404, 409, 500]) {
      expect(decidiRetryRichiesta(status, 1, null).riprova).toBe(false)
    }
  })

  test('backoff breve e crescente: 500, 1000, 2000, 4000 ms, poi basta (5 tentativi)', () => {
    const attese = [1, 2, 3, 4].map(t => decidiRetryRichiesta(429, t, null))
    expect(attese).toEqual([
      { riprova: true, attesaMs: 500 },
      { riprova: true, attesaMs: 1000 },
      { riprova: true, attesaMs: 2000 },
      { riprova: true, attesaMs: 4000 },
    ])
    expect(decidiRetryRichiesta(429, RICHIESTA_TENTATIVI_MAX, null).riprova).toBe(false)
  })

  test("rispetta Retry-After (piu' margine) con un tetto per singola pausa", () => {
    expect(decidiRetryRichiesta(429, 1, 2)).toEqual({ riprova: true, attesaMs: 2100 })
    expect(decidiRetryRichiesta(429, 1, 600)).toEqual({
      riprova: true,
      attesaMs: RICHIESTA_ATTESA_MAX_MS,
    })
  })
})
