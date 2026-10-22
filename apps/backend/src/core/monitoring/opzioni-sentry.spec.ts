import { mascheraDatiPersonali, opzioniSentry, ripulisciEventoSentry } from './opzioni-sentry'

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

  it('ripulisciEventoSentry toglie query e fragment di un breadcrumb nella forma dell SDK', () => {
    const evento: any = {
      breadcrumbs: [
        {
          category: 'http',
          data: {
            url: 'https://api.rentri.gov.it/x',
            'http.query': '?cf=RSSMRA80A01H501U',
            'http.fragment': '#a',
          },
        },
      ],
    }
    const r = ripulisciEventoSentry(evento)
    expect(JSON.stringify(r)).not.toContain('RSSMRA80A01H501U')
    expect(r.breadcrumbs![0].data).not.toHaveProperty('http.query')
    expect(r.breadcrumbs![0].data).not.toHaveProperty('http.fragment')
    expect(r.breadcrumbs![0].data!.url).toBe('https://api.rentri.gov.it/x')
  })

  describe('testo delle eccezioni (D-C-07, D-W-08)', () => {
    // dati finti: il CF d'esempio di "Mario Rossi" e una partita IVA di prova, mai dati reali
    const CF = 'RSSMRA80A01H501U'
    const PIVA = '12345678903'

    it('un errore Prisma P2010 arriva senza il testo di Postgres', () => {
      const evento: any = {
        exception: {
          values: [
            {
              type: 'PrismaClientKnownRequestError',
              value: `Raw query failed. Code: 23505. Key (codice_fiscale)=(${CF}) already exists`,
              stacktrace: { frames: [{ filename: 'app:///dist/fir.service.js', lineno: 12 }] },
            },
          ],
        },
      }
      const r = ripulisciEventoSentry(evento, { originalException: { code: 'P2010' } })
      expect(r.exception!.values![0].value).toBe('PrismaClientKnownRequestError P2010')
      expect(r.exception!.values![0].stacktrace!.frames![0].lineno).toBe(12)
    })

    it('un errore Prisma senza codice resta col solo nome della classe', () => {
      const evento: any = {
        exception: {
          values: [
            { type: 'PrismaClientUnknownRequestError', value: `Failing row contains (${CF}, x)` },
          ],
        },
      }
      const r = ripulisciEventoSentry(evento)
      expect(r.exception!.values![0].value).toBe('PrismaClientUnknownRequestError')
    })

    it('RentriApiError con un CF nel messaggio viene mascherato', () => {
      const evento: any = {
        exception: {
          values: [
            {
              type: 'RentriApiError',
              value: `RENTRI 422: soggetto ${CF} con partita IVA ${PIVA} non valido`,
            },
          ],
        },
      }
      const r = ripulisciEventoSentry(evento, { originalException: { code: 'X' } })
      const v = r.exception!.values![0].value!
      expect(v).toContain('***CF***')
      expect(v).toContain('***PIVA***')
      expect(v).not.toContain(CF)
      expect(v).not.toContain(PIVA)
      expect(v).toContain('RENTRI 422')
    })

    it('messaggio dei breadcrumb e extra mascherati', () => {
      const evento: any = {
        breadcrumbs: [{ category: 'console', message: `invio a mario.rossi@example.it per ${CF}` }],
        extra: {
          tenantId: '3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b',
          path: `/api/v1/soggetti/${CF}`,
          method: 'GET',
          tentativi: 3,
        },
      }
      const r = ripulisciEventoSentry(evento)
      expect(r.breadcrumbs![0].message).toBe('invio a ***@*** per ***CF***')
      expect(r.extra).toEqual({
        tenantId: '3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b',
        path: '/api/v1/soggetti/***CF***',
        method: 'GET',
        tentativi: 3,
      })
    })

    it('un evento senza exception non lancia', () => {
      expect(() => ripulisciEventoSentry({ exception: {} } as any)).not.toThrow()
      expect(() =>
        ripulisciEventoSentry({ exception: { values: [null, { type: 'Error' }] } } as any)
      ).not.toThrow()
    })

    it('mascheraDatiPersonali toglie i valori di Key (…)=(…) e Failing row contains', () => {
      expect(
        mascheraDatiPersonali(
          'duplicate key value violates unique constraint "u_cf": Key (tenant_id, codice_fiscale)=(t1, Rossi (Mario)) already exists.'
        )
      ).toBe(
        'duplicate key value violates unique constraint "u_cf": Key (tenant_id, codice_fiscale)=(***) already exists.'
      )
      expect(
        mascheraDatiPersonali(
          'insert or update on table "fir" violates foreign key constraint "fk": Key (produttore_id)=(abc) is not present in table "soggetto".'
        )
      ).toBe(
        'insert or update on table "fir" violates foreign key constraint "fk": Key (produttore_id)=(***) is not present in table "soggetto".'
      )
      expect(
        mascheraDatiPersonali(
          'duplicate key value violates unique constraint "u_email": Key (lower(email::text))=(mario@example.it) already exists.'
        )
      ).toBe(
        'duplicate key value violates unique constraint "u_email": Key (lower(email::text))=(***) already exists.'
      )
      expect(
        mascheraDatiPersonali(
          'new row for relation "soggetto" violates check constraint "ck": Failing row contains (1, Mario Rossi, Via Roma (int. 2), null).'
        )
      ).toBe(
        'new row for relation "soggetto" violates check constraint "ck": Failing row contains (***).'
      )
    })

    it('mascheraDatiPersonali riconosce il CF in minuscolo e con omocodia', () => {
      expect(mascheraDatiPersonali('cf rssmra80a01h501u')).toBe('cf ***CF***')
      expect(mascheraDatiPersonali('cf RSSMRAULALMHRLMU')).toBe('cf ***CF***')
    })

    it('mascheraDatiPersonali non tocca UUID, hash, codici Prisma, stack e route', () => {
      const intatti = [
        'tenant 3f2a9c1e-7b4d-4e8a-9f10-2c3d4e5f6a7b',
        'sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        'commit 8f21b06a3c1d2e4f5a6b7c8d9e0f1a2b3c4d5e6f',
        'span a1b2c3d4e5f60718',
        'PrismaClientKnownRequestError P2002',
        'at FirService.emetti (/app/dist/fir/fir.service.js:120:15)',
        'GET /api/v1/fir/:id/ricopia',
        'timestamp 1729584000000 durata 1234 ms',
        'DSN http://k@bugsink:8000/9',
        'RENTRI 422 VALIDATION_ERROR',
      ]
      for (const t of intatti) expect(mascheraDatiPersonali(t)).toBe(t)
    })

    it('mascheraDatiPersonali maschera email e partita IVA anche col prefisso IT', () => {
      expect(mascheraDatiPersonali('a: Mario.Rossi+fir@posta.example.it')).toBe('a: ***@***')
      expect(mascheraDatiPersonali(`piva ${PIVA} e IT${PIVA}`)).toBe('piva ***PIVA*** e ***PIVA***')
    })
  })
})
