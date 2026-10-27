import { RateLimitMiddleware } from './rate-limit.middleware'

// NOTA: oggi il middleware NON e' registrato in nessun modulo (e, se lo fosse, girerebbe prima
// del JwtAuthGuard, quindi `req.user` sarebbe vuoto). La correzione dell'identificatore non
// cambia nulla in produzione: e' coperta qui solo perche' il codice resti corretto se verra' attivato.
describe('RateLimitMiddleware: identificatore', () => {
  const cache = {
    getQueryResult: jest.fn(),
    cacheQueryResult: jest.fn(),
  }
  let middleware: RateLimitMiddleware

  const res = () => ({ setHeader: jest.fn() }) as any
  const req = (user?: any): any => ({
    path: '/api/v1/fir',
    method: 'GET',
    headers: { 'x-forwarded-for': '10.0.0.9' },
    socket: { remoteAddress: '127.0.0.1' },
    user,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    cache.getQueryResult.mockResolvedValue(null)
    middleware = new RateLimitMiddleware(cache as any)
  })

  it("un utente autenticato (req.user.id) e' contato per user:<id>, non per IP", async () => {
    const next = jest.fn()
    await middleware.use(req({ id: 'utente-1', role: 'OPERATOR' }), res(), next)
    expect(next).toHaveBeenCalled()
    const chiavi = cache.cacheQueryResult.mock.calls.map(c => c[0])
    expect(chiavi).toContain('rate-limit:user:utente-1')
    expect(chiavi.some((k: string) => k.includes(':ip:'))).toBe(false)
  })

  it('senza utente si conta per IP', async () => {
    await middleware.use(req(), res(), jest.fn())
    expect(cache.cacheQueryResult.mock.calls.map(c => c[0])).toContain('rate-limit:ip:10.0.0.9')
  })
})
