import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Verifica REALE (non mockata) contro la fake fedele al contratto RENTRI
 * (tools/rentri-fake): dimostra che RENTRIApiClient invia POST sulla radice
 * del servizio `formulari/v1.0` (non `/formulari`) e legge correttamente
 * `transazione_id` e l'header `Location` da una risposta 202 vera.
 *
 * Istanziata IN-PROCESS con `creaApp()` + `app.inject()` anziché contro
 * l'oracolo avviato separatamente su `http://localhost:4010`: la CA di prova
 * della fake è memoizzata per processo (tools/rentri-fake/src/auth/ca-test.ts),
 * quindi un certificato emesso qui non sarebbe mai riconosciuto da un
 * processo diverso. In-process invece si può emettere un certificato
 * realmente accreditato (`creaCertificatoDiTest`) e ottenere un 202 genuino.
 *
 * `httpService.post`/`get` sono cablati su `app.inject()`: eseguono il vero
 * handler di rotta della fake, autenticazione JWT self-issued compresa —
 * non è un doppio che restituisce dati precotti.
 */
describe('RENTRIApiClient — verifica reale contro la fake RENTRI (in-process)', () => {
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
      mode: 'live',
      // Solo host: RENTRIApiClient vi concatena `/formulari/v1.0`. Il valore
      // non è mai risolto in rete: httpService è cablato su app.inject().
      baseUrl: 'https://demoapi.rentri.gov.it',
      clientId: 'operatore-test',
      audience: 'rentrigov.demo.api',
      signatureAudience: 'https://demoapi.rentri.gov.it',
      certificatePem: `-----BEGIN CERTIFICATE-----\n${cert.certificatoBase64Der}\n-----END CERTIFICATE-----`,
      privateKeyPem: cert.chiavePrivataPem,
      algorithm: 'RS256',
      mockApiKey: 'non-usata-in-questo-test',
      jwtTtlSeconds: 300,
      credentialEncKey: 'test-enc-key',
    }

    const credentialService = { getForTenant: jest.fn().mockResolvedValue(null) }
    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    }
    const auth = new RentriAuthService(credentialService as any, config, logger)
    const signature = { buildIntegrityHeaders: jest.fn().mockResolvedValue({}) }
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
    }

    // httpService reale sostituito da un adattatore su app.inject(): esegue
    // il vero codice di rotta della fake (autenticazione compresa), non un
    // mock che restituisce risposte precotte.
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

  it('creaFormulario: POST sulla radice del servizio, 202 reale con transazione_id (uuid) e Location', async () => {
    const client = creaClient()

    // tenantId vuoto: RentriAuthService ricade sul certificato di fallback
    // (config.certificatePem/privateKeyPem) impostato sopra — v.
    // RentriAuthService.risolviCredenziale.
    const risultato = await client.creaFormulario('', { dati: 'qualsiasi' })

    expect(risultato.transazioneId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(risultato.urlStato).toBe(`/formulari/v1.0/${risultato.transazioneId}/status`)
  })

  it('leggiFormulario: GET /{numero_fir}, 200 reale sul formulario salvato in archivio', async () => {
    const client = creaClient()
    ;(app as any).archivio.salvaFormulario({
      numero_fir: 'BCDFGH00001JK',
      stato: 'InserimentoQuantita',
      produttore: 'Produttore di prova SRL',
    })

    const formulario = await client.leggiFormulario('', 'BCDFGH00001JK')

    expect((formulario as any).numero_fir).toBe('BCDFGH00001JK')
    expect((formulario as any).stato).toBe('InserimentoQuantita')
  })
})
