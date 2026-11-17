import { proteggiMetriche } from './proteggi-metriche'

function esegui(env: NodeJS.ProcessEnv, authorization?: string) {
  const res: any = { statusCode: 0, intestazioni: {} as Record<string, string> }
  res.status = (c: number) => ((res.statusCode = c), res)
  res.set = (k: string, v: string) => ((res.intestazioni[k] = v), res)
  res.end = () => res
  const next = jest.fn()
  proteggiMetriche(env)({ headers: authorization ? { authorization } : {} } as any, res, next)
  return { res, next }
}

describe('proteggiMetriche', () => {
  it('senza variabili lascia passare (comportamento storico sul VPS in esercizio)', () => {
    expect(esegui({}).next).toHaveBeenCalled()
  })

  it('con METRICS_REQUIRE_TOKEN e senza token risponde 404 e non passa', () => {
    const { res, next } = esegui({ METRICS_REQUIRE_TOKEN: 'true' }, 'Bearer qualcosa')
    expect(res.statusCode).toBe(404)
    expect(next).not.toHaveBeenCalled()
  })

  it('con token: senza intestazione 401', () => {
    const { res, next } = esegui({ METRICS_TOKEN: 's3greto' })
    expect(res.statusCode).toBe(401)
    expect(res.intestazioni['WWW-Authenticate']).toBe('Bearer')
    expect(next).not.toHaveBeenCalled()
  })

  it('con token: token sbagliato, di lunghezza diversa o schema diverso 401', () => {
    for (const h of ['Bearer sbagliato', 'Bearer s3gret', 'Basic s3greto', 's3greto', 'Bearer ']) {
      const { res, next } = esegui({ METRICS_TOKEN: 's3greto' }, h)
      expect(res.statusCode).toBe(401)
      expect(next).not.toHaveBeenCalled()
    }
  })

  it('con token: Bearer corretto passa', () => {
    const { next } = esegui(
      { METRICS_TOKEN: 's3greto', METRICS_REQUIRE_TOKEN: 'true' },
      'Bearer s3greto'
    )
    expect(next).toHaveBeenCalled()
  })
})
