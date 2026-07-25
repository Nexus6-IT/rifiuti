import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient, RentriApiError } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Task 4 (P2): verifica REALE (non mockata) della resilienza del client
 * contro la fake fedele al contratto RENTRI (tools/rentri-fake), guasti
 * inclusi. Istanziata IN-PROCESS con `creaApp()` + `app.inject()` — non
 * contro l'oracolo separato su http://localhost:4010 — per lo stesso motivo
 * di `rentri-api.client.oracolo.spec.ts`: la CA di prova della fake è
 * memoizzata per processo, quindi un certificato emesso in un processo
 * diverso non sarebbe mai riconosciuto qui.
 *
 * A differenza dell'adattatore usato in `rentri-api.client.oracolo.spec.ts`
 * (che risolve SEMPRE l'observable, qualunque sia lo status), questo
 * adattatore replica il comportamento reale di axios: una risposta >= 400
 * fa fallire l'observable con un errore che porta `error.response` — a meno
 * che la chiamata passi esplicitamente `validateStatus` (come fa
 * `RENTRIApiClient` per `/status` e `/result`, dove deve poter distinguere
 * 200/303/400 senza che axios sollevi un'eccezione). Senza questa fedeltà,
 * il guasto iniettato dal canale di controllo (`/__controllo/guasto`) non
 * arriverebbe mai al client come un errore da gestire.
 */
describe('RENTRIApiClient — resilienza contro la fake RENTRI (in-process, guasti iniettati)', () => {
  let app: any

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await app.inject({ method: 'POST', url: '/__controllo/azzera' })
  })

  function creaClient(): RENTRIApiClient {
    const cert = creaCertificatoDiTest('operatore-test')

    const config: RentriConfig = {
      baseUrl: 'https://demoapi.rentri.gov.it',
      clientId: 'operatore-test',
      audience: 'rentrigov.demo.api',
      signatureAudience: 'https://demoapi.rentri.gov.it',
      certificatePem: `-----BEGIN CERTIFICATE-----\n${cert.certificatoBase64Der}\n-----END CERTIFICATE-----`,
      privateKeyPem: cert.chiavePrivataPem,
      algorithm: 'RS256',
      jwtTtlSeconds: 300,
      credentialEncKey: 'test-enc-key',
    }

    const credentialService = { getForTenant: jest.fn().mockResolvedValue(null) }
    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const auth = new RentriAuthService(credentialService as any, config, logger)
    const signature = { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) }
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
    }

    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'POST', url: path, headers: opts.headers, payload: body as any })
            .then((risposta: any) => emetti(subscriber, risposta, undefined))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: (
        url: string,
        opts: { headers: Record<string, string>; validateStatus?: (status: number) => boolean }
      ) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'GET', url: path, headers: opts.headers })
            .then((risposta: any) => emetti(subscriber, risposta, opts.validateStatus))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return new RENTRIApiClient(httpService, logger, metrics, config, auth, signature as any)
  }

  /**
   * Adatta la risposta Fastify in un `AxiosResponse` e replica la semantica
   * reale di axios: senza `validateStatus` (o se non soddisfatto), uno
   * status >= 400 fa fallire l'observable con un errore `error.response`.
   */
  function emetti(
    subscriber: {
      next: (r: AxiosResponse) => void
      error: (e: unknown) => void
      complete: () => void
    },
    risposta: any,
    validateStatus?: (status: number) => boolean
  ): void {
    const risposaAdattata: AxiosResponse = {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }

    const okComunque = validateStatus?.(risposaAdattata.status) ?? false
    if (risposaAdattata.status >= 400 && !okComunque) {
      const errore: any = new Error(`Richiesta fallita con status ${risposaAdattata.status}`)
      errore.response = risposaAdattata
      subscriber.error(errore)
      return
    }
    subscriber.next(risposaAdattata)
    subscriber.complete()
  }

  function impostaGuasto(stato: number, volte: number): Promise<unknown> {
    return app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato, volte },
    })
  }

  /**
   * Prova 1: con 429 iniettato due volte, il client ritenta (rispettando
   * l'header `Retry-After` impostato dalla fake, v. app.ts) e alla fine
   * riesce. Nessun fake timer qui: `app.inject()` di Fastify si appoggia a
   * `setImmediate`/microtask interni che i fake timers di Jest
   * bloccherebbero (verificato: il test resta appeso). Si attende quindi
   * realmente il `Retry-After` fisso di 5s x 2 tentativi falliti.
   */
  it('creaFormulario: con 429 iniettato due volte, il client ritenta rispettando Retry-After e alla fine riesce', async () => {
    const client = creaClient()
    await impostaGuasto(429, 2)

    const risultato = await client.creaFormulario('', { dati: 'qualsiasi' })

    expect(risultato.transazioneId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  }, 20000)

  /**
   * Prova 2: con 503 iniettato una volta, il client ritenta (backoff
   * esponenziale, nessun `Retry-After` per un 5xx) e alla fine riesce.
   */
  it('creaFormulario: con 503 iniettato una volta, il client ritenta con backoff e alla fine riesce', async () => {
    const client = creaClient()
    await impostaGuasto(503, 1)

    const risultato = await client.creaFormulario('', { dati: 'qualsiasi' })

    expect(risultato.transazioneId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  }, 15000)

  /**
   * Prova 3: con 403 iniettato, il client NON ritenta e fallisce subito con
   * un esito definitivo (`RentriApiError.retryable === false`). La prova che
   * non ci sia stato alcun ritentativo è che il guasto (impostato per una
   * sola occorrenza) risulta interamente consumato da una SOLA richiesta.
   */
  it('creaFormulario: con 403 iniettato, il client NON ritenta e fallisce subito con esito definitivo', async () => {
    const client = creaClient()
    await impostaGuasto(403, 1)

    const spia = jest.spyOn(app.archivio, 'guastoAttivo')

    let erroreCatturato: unknown
    let sollevato = false
    try {
      await client.creaFormulario('', { dati: 'qualsiasi' })
    } catch (errore) {
      sollevato = true
      erroreCatturato = errore
    }

    expect(sollevato).toBe(true)
    expect(erroreCatturato).toBeInstanceOf(RentriApiError)
    expect(erroreCatturato).toMatchObject({ status: 403, retryable: false })

    // Una sola chiamata HTTP: il client non ha ritentato dopo il 403.
    expect(spia).toHaveBeenCalledTimes(1)

    spia.mockRestore()
  })
})
