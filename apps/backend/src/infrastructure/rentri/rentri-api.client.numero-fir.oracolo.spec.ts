import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient, estraiNumeroFirDaEsito } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
import { corpoFormularioValido } from '../../application/rentri/mappatura/aiuti-test'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Task 3-bis (R0): il numero ufficiale RENTRI vive annidato in
 * `esito.esito.numero_fir` (`EsitoNuovoFormularioModel`, una delle varianti
 * del `oneOf` di `EsitoFormularioModel.esito` — formulari.yaml righe
 * 9378-9414 e 9503-9512), non al primo livello dell'esito. Questo spec
 * dimostra che `attendiEsito` lo restituisce intatto quando presente, e che
 * `estraiNumeroFirDaEsito` non lo inventa quando assente.
 *
 * **Limite dichiarato**: la fake accetta qualunque corpo sul canale di
 * controllo `/__controllo/completa-transazione` (riserva nota in
 * `docs/contracts/rentri/FEDELTA.md`) — questi test dimostrano che il
 * client LEGGE correttamente `numero_fir` quando è presente nella forma
 * prevista dal contratto, non che l'ente RENTRI restituisca davvero
 * quella forma. È una conformità di lettura, non di contratto.
 *
 * Istanziata IN-PROCESS con `creaApp()` + `app.inject()` (non contro
 * l'oracolo su http://localhost:4010): la CA di prova della fake è
 * memoizzata per processo (tools/rentri-fake/src/auth/ca-test.ts), quindi
 * un certificato emesso qui non sarebbe riconosciuto da un processo
 * diverso — v. le spec sorelle (`rentri-api.client.oracolo.spec.ts`,
 * `rentri-api.client.polling-reale.oracolo.spec.ts`) per lo stesso schema.
 */
describe("RENTRIApiClient — numero_fir emerge dall'esito (contro la fake RENTRI, in-process)", () => {
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
    const auth = new RentriAuthService(credentialService as any, config, logger)
    const signature = { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) }
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }

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

  it('caso positivo: esito con numero_fir — attendiEsito lo restituisce intatto e estraiNumeroFirDaEsito lo legge', async () => {
    const client = creaClient()

    const { transazioneId } = await client.creaFormulario('', corpoFormularioValido())

    // Ogni chiamata verso la fake richiede un JWT nuovo: il registro
    // anti-replay rifiuta un `jti` già visto (v. spec sorelle).
    const completamento = await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: {
        transazione_id: transazioneId,
        errore: false,
        validazione: [],
        esito: { numero_fir: 'RENTRI-NUM-000123' },
      },
    })
    expect(completamento.statusCode).toBe(200)

    // La transazione è già completata: un solo tentativo basta.
    const esito = await client.attendiEsito('', transazioneId, {
      intervalloMs: 0,
      maxTentativi: 1,
    })

    expect(esito.errore).toBe(false)
    expect(esito.esito).toEqual({ numero_fir: 'RENTRI-NUM-000123' })
    expect(estraiNumeroFirDaEsito(esito)).toBe('RENTRI-NUM-000123')
  })

  it('caso negativo: esito senza numero_fir — estraiNumeroFirDaEsito non inventa un legame', async () => {
    const client = creaClient()

    const { transazioneId } = await client.creaFormulario('', corpoFormularioValido())

    // Nessun campo `esito`: rappresenta una variante del `oneOf` diversa
    // dalla creazione di un formulario (es. l'esito "comune", senza
    // numero_fir) — esattamente il caso che il client deve trattare come
    // "nessun numero disponibile", MAI sostituendolo con `transazione_id`.
    const completamento = await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: {
        transazione_id: transazioneId,
        errore: false,
        validazione: [],
      },
    })
    expect(completamento.statusCode).toBe(200)

    const esito = await client.attendiEsito('', transazioneId, {
      intervalloMs: 0,
      maxTentativi: 1,
    })

    expect(esito.errore).toBe(false)
    expect(estraiNumeroFirDaEsito(esito)).toBeUndefined()
  })
})
