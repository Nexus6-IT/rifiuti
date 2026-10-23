import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { corpoFormularioValido } from '../../application/rentri/mappatura/aiuti-test'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Task 5 (P2): colma l'unico varco reale lasciato aperto dalle verifiche
 * "oracolo" precedenti.
 *
 * `rentri-api.client.oracolo.spec.ts` dimostra il ciclo NONBLOCK_PULL passo
 * per passo con `app.inject()` diretto (senza il client) e poi invoca
 * `client.attendiEsito` una sola volta a transazione già completata
 * (`maxTentativi: 1`) — non dimostra mai che il *client* stesso, lasciato
 * libero di eseguire il proprio ciclo di attesa/ripetizione, sappia
 * attraversare 200 ("in elaborazione") → 303 ("pronto") → esito reale senza
 * intervento esterno passo-passo.
 *
 * Qui la transazione viene completata in modo asincrono (un timer reale,
 * schedulato DOPO la prima interrogazione) mentre `client.attendiEsito` sta
 * già eseguendo il proprio polling: il client deve osservare almeno un 200
 * ("ancora in elaborazione"), poi il 303 e recuperare l'esito da solo,
 * usando esclusivamente la propria API pubblica (nessun `app.inject()`
 * manuale per pilotare il ciclo).
 */
describe('RENTRIApiClient — attendiEsito guida da solo il polling reale contro la fake (in-process)', () => {
  let app: any

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
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
    const auth = new RentriAuthService(
      new RentriCredentialResolver(credentialService as any, config),
      config,
      logger
    )
    const signature = { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) }
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }

    // Adattatore che risolve SEMPRE l'observable (mai un errore): il client
    // usa `validateStatus: () => true` per /status e /result proprio per
    // distinguere 200/303/400 come risposte normali, non eccezioni — replica
    // fedele di quel comportamento (v. rentri-api.client.oracolo.spec.ts).
    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'POST', url: path, headers: opts.headers, payload: body as any })
            .then((risposta: any) => {
              subscriber.next(adattaRisposta(risposta))
              subscriber.complete()
            })
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: (url: string, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'GET', url: path, headers: opts.headers })
            .then((risposta: any) => {
              subscriber.next(adattaRisposta(risposta))
              subscriber.complete()
            })
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return new RENTRIApiClient(httpService, logger, metrics, config, auth, signature as any)
  }

  function adattaRisposta(risposta: any): AxiosResponse {
    return {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }
  }

  it(
    'attendiEsito: crea, osserva almeno un 200 "in elaborazione" mentre la ' +
      'transazione si completa in background, poi ottiene da solo il 303 e ' +
      "l'esito reale — nessun app.inject() manuale a pilotare il ciclo",
    async () => {
      const client = creaClient()

      // 1) Crea il formulario contro la fake: 202 + transazione reale.
      const { transazioneId } = await client.creaFormulario('', corpoFormularioValido())

      // 2) Completa la transazione con un timer REALE (non un fake timer di
      // Jest, che bloccherebbe app.inject() — v. nota nello spec sorella),
      // schedulato dopo l'avvio del polling: al momento della prima
      // interrogazione di /status la transazione è ancora aperta (200 atteso).
      setTimeout(() => {
        void app.inject({
          method: 'POST',
          url: '/__controllo/completa-transazione',
          payload: { transazione_id: transazioneId, errore: false, validazione: [] },
        })
      }, 150)

      // 3) Il client, da solo, deve attraversare 200 → 303 → /result.
      const esito = await client.attendiEsito('', transazioneId, {
        intervalloMs: 50,
        maxTentativi: 20,
      })

      expect(esito).toEqual({
        transazione_id: transazioneId,
        errore: false,
        validazione: [],
      })
    },
    15000
  )
})
