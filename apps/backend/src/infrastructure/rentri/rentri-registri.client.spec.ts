import { of, throwError } from 'rxjs'
import {
  EsitoRentriMalformatoError,
  EsitoRentriNonDisponibileError,
  RentriRegistriClient,
} from './rentri-registri.client'
import { RentriApiError } from './rentri-http-resilienza'
import {
  TrasmissioneRentriIncertaError,
  TransazioneRentriNonTrovataError,
} from './rentri-api.client'

const TENANT = 'tenant-1'
const REGISTRO = 'R1234ABCDEF'
const TRANSAZIONE = '11111111-1111-4111-8111-111111111111'

function erroreHttp(status: number, headers: Record<string, string> = {}) {
  return { response: { status, data: { status, title: 'T', detail: 'D' }, headers } }
}

/** Unit test con HttpService finto: la POST dei movimenti non si ritenta mai su un esito incerto. */
describe('RentriRegistriClient (HttpService finto)', () => {
  let client: RentriRegistriClient
  let http: { post: jest.Mock; get: jest.Mock }
  let limiter: { acquisisci: jest.Mock }
  let rilascia: jest.Mock

  beforeEach(() => {
    http = { post: jest.fn(), get: jest.fn() }
    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const metrics: any = {
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }
    const auth: any = { creaAuthorizationHeader: jest.fn().mockResolvedValue('Bearer t') }
    const signature: any = { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) }
    rilascia = jest.fn().mockResolvedValue(undefined)
    limiter = { acquisisci: jest.fn().mockResolvedValue({ rilascia }) }
    client = new RentriRegistriClient(
      http as any,
      logger,
      metrics,
      { baseUrl: 'https://demoapi.rentri.gov.it' } as any,
      auth,
      signature,
      limiter as any
    )
  })

  afterEach(() => jest.useRealTimers())

  const invia = () => client.inviaMovimenti(REGISTRO, [{ a: 1 }], TENANT)

  it('5xx sulla POST: nessun secondo tentativo e TrasmissioneRentriIncertaError HTTP_5XX', async () => {
    http.post.mockReturnValue(throwError(() => erroreHttp(503)))
    const errore = await invia().catch(e => e)
    expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
    expect(errore.causa).toBe('HTTP_5XX')
    expect(errore.status).toBe(503)
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('nessuna risposta: TrasmissioneRentriIncertaError NESSUNA_RISPOSTA, senza secondo invio', async () => {
    http.post.mockReturnValue(throwError(() => new Error('timeout of 30000ms exceeded')))
    const errore = await invia().catch(e => e)
    expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
    expect(errore.causa).toBe('NESSUNA_RISPOSTA')
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('202 senza transazione_id: RISPOSTA_SENZA_TRANSAZIONE', async () => {
    http.post.mockReturnValue(of({ status: 202, data: {}, headers: {} }))
    const errore = await invia().catch(e => e)
    expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
    expect(errore.causa).toBe('RISPOSTA_SENZA_TRANSAZIONE')
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('202 con transazione_id: restituisce solo transazioneId', async () => {
    http.post.mockReturnValue(
      of({ status: 202, data: { transazione_id: TRANSAZIONE }, headers: {} })
    )
    await expect(invia()).resolves.toEqual({ transazioneId: TRANSAZIONE })
  })

  it('429 con Retry-After: ritenta e poi riesce', async () => {
    http.post
      .mockReturnValueOnce(throwError(() => erroreHttp(429, { 'retry-after': '0' })))
      .mockReturnValueOnce(of({ status: 202, data: { transazione_id: TRANSAZIONE }, headers: {} }))
    await expect(invia()).resolves.toEqual({ transazioneId: TRANSAZIONE })
    expect(http.post).toHaveBeenCalledTimes(2)
  })

  it('400 e 404: RentriApiError non ritentabile', async () => {
    for (const status of [400, 404]) {
      http.post.mockClear()
      http.post.mockReturnValue(throwError(() => erroreHttp(status)))
      const errore = await invia().catch(e => e)
      expect(errore).toBeInstanceOf(RentriApiError)
      expect(errore.status).toBe(status)
      expect(errore.retryable).toBe(false)
      expect(http.post).toHaveBeenCalledTimes(1)
    }
  })

  it('la POST acquisisce e rilascia il permesso del rate limiter anche in errore', async () => {
    http.post.mockReturnValue(throwError(() => erroreHttp(500)))
    await invia().catch(() => undefined)
    expect(limiter.acquisisci).toHaveBeenCalledWith(TENANT)
    expect(rilascia).toHaveBeenCalledTimes(1)
    http.post.mockReturnValue(
      of({ status: 202, data: { transazione_id: TRANSAZIONE }, headers: {} })
    )
    await invia()
    expect(limiter.acquisisci).toHaveBeenCalledTimes(2)
    expect(rilascia).toHaveBeenCalledTimes(2)
  })

  it('status 404 della transazione: TransazioneRentriNonTrovataError', async () => {
    http.get.mockReturnValue(of({ status: 404, data: {}, headers: {} }))
    await expect(
      client.attendiEsitoMovimenti(TRANSAZIONE, TENANT, { intervalloMs: 1, maxTentativi: 2 })
    ).rejects.toBeInstanceOf(TransazioneRentriNonTrovataError)
  })

  it("attendiEsitoMovimenti attende l'intervallo fra due /status", async () => {
    jest.useFakeTimers()
    http.get
      .mockReturnValueOnce(of({ status: 200, data: {}, headers: {} }))
      .mockReturnValueOnce(of({ status: 303, data: {}, headers: { location: '/r' } }))
      .mockReturnValueOnce(
        of({
          status: 200,
          data: {
            errore: false,
            esito: { numero_registrazioni: [{ anno: 2026, progressivo: 1 }] },
          },
          headers: {},
        })
      )
    const promessa = client.attendiEsitoMovimenti(TRANSAZIONE, TENANT, {
      intervalloMs: 5000,
      maxTentativi: 3,
    })
    await jest.advanceTimersByTimeAsync(4999)
    expect(http.get).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    const esito = await promessa
    expect(http.get).toHaveBeenCalledTimes(3)
    expect(esito).toEqual({
      errore: false,
      validazione: [],
      numeroRegistrazioni: [{ anno: 2026, progressivo: 1, identificativo: null }],
      registrazioniSenzaNumero: 0,
    })
  })

  function rispondi(corpo: unknown) {
    http.get
      .mockReturnValueOnce(of({ status: 303, data: {}, headers: { location: '/r' } }))
      .mockReturnValueOnce(of({ status: 200, data: corpo, headers: {} }))
  }

  it('esito con errore booleano e senza altri campi: liste vuote (valido per il contratto)', async () => {
    rispondi({ errore: false })
    await expect(client.attendiEsitoMovimenti(TRANSAZIONE, TENANT)).resolves.toEqual({
      errore: false,
      validazione: [],
      numeroRegistrazioni: [],
      registrazioniSenzaNumero: 0,
    })
  })

  it.each([
    ['errore assente', {}],
    ['errore non booleano', { errore: 'true' }],
    ['errore null', { errore: null }],
    ['corpo non oggetto (stringa)', 'ok'],
    ['corpo non oggetto (array)', []],
  ])('%s: errore tecnico, mai un esito', async (_nome, corpo) => {
    rispondi(corpo)
    await expect(client.attendiEsitoMovimenti(TRANSAZIONE, TENANT)).rejects.toBeInstanceOf(
      EsitoRentriMalformatoError
    )
  })

  it('registrazione con identificativo ma anno/progressivo nulli: contata, non scartata in silenzio', async () => {
    rispondi({
      errore: true,
      esito: {
        numero_registrazioni: [
          { anno: 2026, progressivo: 1, identificativo: 'X' },
          { anno: null, progressivo: null, identificativo: 'Y' },
        ],
      },
    })
    const e = await client.attendiEsitoMovimenti(TRANSAZIONE, TENANT)
    expect(e.numeroRegistrazioni).toHaveLength(1)
    expect(e.registrazioniSenzaNumero).toBe(1)
  })

  it('esito presente ma non oggetto: registrazione ignota (senzaNumero)', async () => {
    rispondi({ errore: true, esito: 'boh' })
    const e = await client.attendiEsitoMovimenti(TRANSAZIONE, TENANT)
    expect(e.registrazioniSenzaNumero).toBe(1)
  })

  describe('ultimaTransazioneId', () => {
    const risposta = (status: number, data: unknown = {}) =>
      of({ status, data, headers: { 'retry-after': '0' } })

    it('200 -> id; 204 -> null; corpo senza campo -> null', async () => {
      http.get.mockReturnValueOnce(risposta(200, { transazione_id: TRANSAZIONE }))
      expect(await client.ultimaTransazioneId(REGISTRO, TENANT)).toBe(TRANSAZIONE)
      http.get.mockReturnValueOnce(risposta(204, ''))
      expect(await client.ultimaTransazioneId(REGISTRO, TENANT)).toBeNull()
      http.get.mockReturnValueOnce(risposta(200, {}))
      expect(await client.ultimaTransazioneId(REGISTRO, TENANT)).toBeNull()
    })

    it.each([['non-un-uuid'], [42], ['11111111-1111-4111-8111-11111111111Z']])(
      'id non valido (%p): errore tecnico, mai passato al database',
      async id => {
        http.get.mockReturnValueOnce(risposta(200, { transazione_id: id }))
        await expect(client.ultimaTransazioneId(REGISTRO, TENANT)).rejects.toBeInstanceOf(
          EsitoRentriMalformatoError
        )
      }
    )

    it('404 e 403: RentriApiError non ritentabile, una sola chiamata', async () => {
      for (const status of [404, 403, 400]) {
        http.get.mockClear()
        http.get.mockReturnValueOnce(risposta(status))
        const e = await client.ultimaTransazioneId(REGISTRO, TENANT).catch(x => x)
        expect(e).toBeInstanceOf(RentriApiError)
        expect(e).toMatchObject({ status, retryable: false })
        expect(http.get).toHaveBeenCalledTimes(1)
      }
    })

    it('429 e 5xx: RentriApiError ritentabile dopo i tentativi di resilienza', async () => {
      for (const status of [429, 503]) {
        http.get.mockReset()
        http.get.mockReturnValue(risposta(status))
        const e = await client.ultimaTransazioneId(REGISTRO, TENANT).catch(x => x)
        expect(e).toBeInstanceOf(RentriApiError)
        expect(e).toMatchObject({ status, retryable: true })
        expect(http.get).toHaveBeenCalledTimes(5)
      }
    })
  })

  it('polling esaurito: errore dedicato (non un esito)', async () => {
    http.get.mockReturnValue(of({ status: 200, data: {}, headers: {} }))
    await expect(
      client.attendiEsitoMovimenti(TRANSAZIONE, TENANT, { intervalloMs: 1, maxTentativi: 2 })
    ).rejects.toBeInstanceOf(EsitoRentriNonDisponibileError)
  })

  it('303 senza /result leggibile non è un successo', async () => {
    http.get.mockImplementation((url: string) =>
      of(
        url.endsWith('/status')
          ? { status: 303, data: {}, headers: { location: '/dati-registri/v1.0/x/result' } }
          : { status: 400, data: {}, headers: {} }
      )
    )
    await expect(
      client.attendiEsitoMovimenti(TRANSAZIONE, TENANT, { intervalloMs: 1, maxTentativi: 3 })
    ).rejects.toThrow(/Superato il numero massimo di tentativi/)
    http.get.mockReturnValue(of({ status: 303, data: {}, headers: {} }))
    await expect(
      client.attendiEsitoMovimenti(TRANSAZIONE, TENANT, { intervalloMs: 1, maxTentativi: 1 })
    ).rejects.toThrow(/Location/)
  })
})
