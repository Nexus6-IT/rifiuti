import { opzioniSentry, ripulisciEventoSentry } from './opzioni-sentry'

describe('opzioni-sentry', () => {
  it('opzioniSentry spegne i dati personali e il tracing', () => {
    const o = opzioniSentry({
      SENTRY_DSN: 'http://k@bugsink:8000/9',
      APP_VERSION: 'sha-1',
      NODE_ENV: 'production',
    })
    expect(o).toMatchObject({
      dsn: 'http://k@bugsink:8000/9',
      release: 'sha-1',
      environment: 'production',
      sendDefaultPii: false,
    })
    expect(o.tracesSampleRate).toBeUndefined()
    expect(o.beforeSend).toBe(ripulisciEventoSentry)
    expect((o.integrations as Array<{ name: string }>).map(i => i.name).sort()).toEqual([
      'Http',
      'RequestData',
    ])
  })

  it('ripulisciEventoSentry toglie corpo, header, cookie e query', () => {
    const evento: any = {
      request: {
        url: '/api/v1/fir?search=RSSMRA80A01H501U',
        query_string: 'search=RSSMRA80A01H501U',
        data: '{"cf":"RSSMRA80A01H501U"}',
        cookies: { s: '1' },
        headers: { authorization: 'Bearer x', cookie: 's=1' },
        method: 'POST',
      },
      user: { id: 'u-1', email: 'a@b.it', ip_address: '1.2.3.4' },
      breadcrumbs: [
        { category: 'http', data: { url: 'https://api.rentri.gov.it/x?cf=RSSMRA80A01H501U' } },
      ],
    }
    const r = ripulisciEventoSentry(evento)
    expect(JSON.stringify(r)).not.toContain('RSSMRA80A01H501U')
    expect(JSON.stringify(r)).not.toMatch(/authorization|Bearer|a@b\.it|1\.2\.3\.4/)
    expect(r.request).toEqual({ url: '/api/v1/fir', method: 'POST' })
    expect(r.user).toEqual({ id: 'u-1' })
    expect(r.breadcrumbs![0].data!.url).toBe('https://api.rentri.gov.it/x')
  })

  it('ripulisciEventoSentry non lancia su un evento senza request né user', () => {
    expect(() => ripulisciEventoSentry({ type: undefined } as any)).not.toThrow()
  })
})
