import { rateLimitDisattivato } from './rate-limit.config'

describe('rateLimitDisattivato', () => {
  it('di default il rate limit resta attivo', () => {
    expect(rateLimitDisattivato({})).toBe(false)
    expect(rateLimitDisattivato({ NODE_ENV: 'development' })).toBe(false)
  })

  it('con RATE_LIMIT_DISATTIVATO=1 fuori produzione viene disattivato', () => {
    expect(rateLimitDisattivato({ RATE_LIMIT_DISATTIVATO: '1' })).toBe(true)
    expect(rateLimitDisattivato({ RATE_LIMIT_DISATTIVATO: '1', NODE_ENV: 'test' })).toBe(true)
  })

  it('in produzione resta attivo anche con la variabile impostata', () => {
    expect(rateLimitDisattivato({ RATE_LIMIT_DISATTIVATO: '1', NODE_ENV: 'production' })).toBe(
      false
    )
  })

  it('valori diversi da "1" non lo disattivano', () => {
    expect(rateLimitDisattivato({ RATE_LIMIT_DISATTIVATO: 'true' })).toBe(false)
    expect(rateLimitDisattivato({ RATE_LIMIT_DISATTIVATO: '0' })).toBe(false)
  })
})
