import { calcolaAttesaRetryMs } from './rentri-http-resilienza'

describe('calcolaAttesaRetryMs', () => {
  const backoff = { baseMs: 1000, maxMs: 30000 }

  it('rispetta un Retry-After ragionevole', () => {
    expect(calcolaAttesaRetryMs(1, '5', backoff)).toBe(5000)
    expect(calcolaAttesaRetryMs(1, '0', backoff)).toBe(0)
  })

  it('un Retry-After enorme e` limitato al tetto del backoff', () => {
    expect(calcolaAttesaRetryMs(1, '86400', backoff)).toBe(30000)
  })

  it('senza header o con header non valido: backoff esponenziale con tetto', () => {
    expect(calcolaAttesaRetryMs(3, undefined, backoff)).toBe(4000)
    expect(calcolaAttesaRetryMs(10, 'abc', backoff)).toBe(30000)
  })
})
