import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriCopieClient } from './rentri-copie.client'
import { RentriTrasmissioniClient } from './rentri-trasmissioni.client'
import { RentriXfirClient } from './xfir/rentri-xfir.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { RentriRateLimiterService } from './rentri-rate-limiter.service'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Piano FIR in viaggio, P0 T4: i client di copie, trasmissioni e xFIR passano dal
 * limitatore preventivo per tenant, come `RENTRIApiClient`. Si misura quante
 * volte il limitatore e' stato interrogato rispetto alle richieste HTTP che la
 * fake ha davvero ricevuto, con un 429 iniettato dal canale di controllo: il
 * retry per 429 deve consumare un permesso come ogni altra richiesta, e ogni
 * permesso va rilasciato.
 */
describe('Rate limiter per tenant sui client di copie, trasmissioni e xFIR (fake in-process)', () => {
  let app: any
  let richiesteArrivate: number

  const NUM_ISCR_SITO = 'OP1234ABC000002-AB0002'
  const TENANT = 'tenant-a'

  beforeAll(async () => {
    app = creaApp()
    app.addHook('onRequest', async (richiesta: any) => {
      if (!richiesta.url.startsWith('/__controllo')) richiesteArrivate += 1
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    richiesteArrivate = 0
  })

  afterEach(async () => {
    await app.inject({ method: 'POST', url: '/__controllo/azzera' })
  })

  function creaLimitatoreSpia(): {
    limitatore: RentriRateLimiterService
    acquisizioni: string[]
    rilasci: number[]
  } {
    const acquisizioni: string[] = []
    const rilasci: number[] = []
    const limitatore = {
      acquisisci: jest.fn(async (tenantId: string) => {
        acquisizioni.push(tenantId)
        return { rilascia: async () => void rilasci.push(Date.now()) }
      }),
    } as unknown as RentriRateLimiterService
    return { limitatore, acquisizioni, rilasci }
  }

  function dipendenze(): {
    httpService: any
    logger: any
    metrics: any
    config: RentriConfig
    auth: RentriAuthService
    signature: any
  } {
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
    // Credenziale propria del tenant (come in `rentri-rate-limiter.oracolo.spec.ts`).
    const credentialService = {
      getForTenant: jest.fn().mockResolvedValue({
        clientId: config.clientId,
        certificatePem: config.certificatePem,
        privateKeyPem: config.privateKeyPem,
        algorithm: config.algorithm,
        environment: 'demo',
      }),
    }
    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const auth = new RentriAuthService(
      new RentriCredentialResolver(credentialService as any, config),
      config,
      logger
    )
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
      rentriRateLimiterWaitSeconds: { observe: jest.fn() },
    }
    const inietta = (
      method: string,
      url: string,
      headers: Record<string, string>,
      payload?: unknown
    ): Observable<AxiosResponse> =>
      new Observable<AxiosResponse>(subscriber => {
        app
          .inject({ method, url: new URL(url).pathname + new URL(url).search, headers, payload })
          .then((risposta: any) => {
            const adattata = {
              data: risposta.payload ? risposta.json() : undefined,
              status: risposta.statusCode,
              statusText: '',
              headers: risposta.headers,
              config: {},
            } as AxiosResponse
            if (risposta.statusCode >= 200 && risposta.statusCode < 300) {
              subscriber.next(adattata)
              subscriber.complete()
            } else {
              subscriber.error({ response: adattata })
            }
          })
          .catch((errore: unknown) => subscriber.error(errore))
      })
    const httpService = {
      get: (url: string, o: { headers: Record<string, string> }) => inietta('GET', url, o.headers),
      post: (url: string, b: unknown, o: { headers: Record<string, string> }) =>
        inietta('POST', url, o.headers, b),
    }
    return {
      httpService,
      logger,
      metrics,
      config,
      auth,
      signature: { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) },
    }
  }

  const clienti = {
    copie: (limitatore?: RentriRateLimiterService) => {
      const d = dipendenze()
      const client = new RentriCopieClient(
        d.httpService,
        d.logger,
        d.metrics,
        d.config,
        d.auth,
        d.signature,
        limitatore
      )
      return () => client.elencaCopieDigitaliCaricate(NUM_ISCR_SITO, undefined, TENANT)
    },
    trasmissioni: (limitatore?: RentriRateLimiterService) => {
      const d = dipendenze()
      const client = new RentriTrasmissioniClient(
        d.httpService,
        d.logger,
        d.metrics,
        d.config,
        d.auth,
        d.signature,
        limitatore
      )
      return () => client.elencaTrasmissioni(NUM_ISCR_SITO, undefined, TENANT)
    },
    xfir: (limitatore?: RentriRateLimiterService) => {
      const d = dipendenze()
      const client = new RentriXfirClient(
        d.httpService,
        d.logger,
        d.metrics,
        d.config,
        d.auth,
        d.signature,
        limitatore
      )
      return () => client.scaricaXfir(TENANT, 'BCDFGH00030ZD').catch(() => undefined)
    },
  }

  describe.each(Object.entries(clienti))('%s', (_nome, creaChiamata) => {
    it('una richiesta: un permesso acquisito per il tenant giusto e rilasciato', async () => {
      const { limitatore, acquisizioni, rilasci } = creaLimitatoreSpia()

      await creaChiamata(limitatore)()

      expect(richiesteArrivate).toBe(1)
      expect(acquisizioni).toEqual([TENANT])
      expect(rilasci).toHaveLength(1)
    })

    it('con 429 iniettato: il retry consuma un permesso come ogni richiesta, e tutti vengono rilasciati', async () => {
      const { limitatore, acquisizioni, rilasci } = creaLimitatoreSpia()
      await app.inject({
        method: 'POST',
        url: '/__controllo/guasto',
        payload: { stato: 429, volte: 1 },
      })

      await creaChiamata(limitatore)()

      // Il guasto risponde prima dell'hook di conteggio: `richiesteArrivate`
      // vede solo la richiesta riuscita, quindi la prova dei due tentativi e'
      // che il limitatore sia stato interrogato due volte (429 + riuscita).
      expect(richiesteArrivate).toBe(1)
      expect(acquisizioni).toEqual([TENANT, TENANT])
      expect(rilasci).toHaveLength(2)
    }, 30000)

    it('senza limitatore (costruzione diretta) il comportamento resta quello di prima', async () => {
      await creaChiamata(undefined)()

      expect(richiesteArrivate).toBe(1)
    })
  })
})
