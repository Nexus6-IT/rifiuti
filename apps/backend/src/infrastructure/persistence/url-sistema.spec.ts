import { risolviUrlSistema } from './url-sistema'

describe('url-sistema', () => {
  it('seed: usa DATABASE_URL_SISTEMA quando presente', () => {
    expect(
      risolviUrlSistema({ DATABASE_URL_SISTEMA: 'postgresql://s', DATABASE_URL: 'postgresql://a' })
    ).toEqual({ url: 'postgresql://s', fallback: false })
  })

  it('ripiega su DATABASE_URL e lo segnala quando DATABASE_URL_SISTEMA manca o e vuota', () => {
    expect(risolviUrlSistema({ DATABASE_URL: 'postgresql://a' })).toEqual({
      url: 'postgresql://a',
      fallback: true,
    })
    expect(
      risolviUrlSistema({ DATABASE_URL_SISTEMA: '', DATABASE_URL: 'postgresql://a' }).fallback
    ).toBe(true)
  })

  it('senza nessuna delle due restituisce url undefined', () => {
    expect(risolviUrlSistema({})).toEqual({ url: undefined, fallback: true })
  })
})
