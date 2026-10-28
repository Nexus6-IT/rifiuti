import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriTrasmissioniClient } from './rentri-trasmissioni.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { RentriApiError } from './rentri-http-resilienza'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const aiutoTrasmissioneDati = require('../../../../../tools/rentri-fake/test/aiuti/trasmissione-dati')
const corpoTrasmissioneDatiValido: () => Record<string, unknown> =
  aiutoTrasmissioneDati.corpoTrasmissioneDatiValido

/**
 * Verifica "oracolo": `RentriTrasmissioniClient` contro la fake fedele al
 * contratto ufficiale (`tools/rentri-fake`), montata in-process con
 * `creaApp()` — stessa strategia di `rentri-anagrafiche.client.oracolo.spec.ts`
 * e `rentri-api.client.polling-reale.oracolo.spec.ts`: nessun mock della
 * forma della risposta, solo un adattatore `HttpService -> app.inject()`.
 *
 * Copre il gruppo "Trasmissione dati operatore" (formulari.yaml righe
 * 5149-5577): invio (sincrono, 201), elenco, dettaglio, annullamento
 * (non reversibile) e il ciclo NONBLOCK_PULL di `.../estrai` tramite i path
 * canonici `/{transazione_id}/status` e `/result`.
 */
describe('RentriTrasmissioniClient — contro la fake RENTRI (in-process)', () => {
  let app: any

  const NUM_ISCR_SITO = 'OP1234ABC000001-AB0001'

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  function creaClient(): RentriTrasmissioniClient {
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

    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        inietta('POST', url, opts.headers, body),
      get: (url: string, opts: { headers: Record<string, string> }) =>
        inietta('GET', url, opts.headers),
      delete: (url: string, opts: { headers: Record<string, string> }) =>
        inietta('DELETE', url, opts.headers),
    }

    return new RentriTrasmissioniClient(
      httpService,
      logger,
      metrics,
      config,
      auth,
      signature as any
    )
  }

  function inietta(
    method: string,
    url: string,
    headers: Record<string, string>,
    payload?: unknown
  ): Observable<AxiosResponse> {
    return new Observable<AxiosResponse>(subscriber => {
      const path = new URL(url).pathname
      app
        .inject({ method, url: path, headers, payload: payload as any })
        .then((risposta: any) => {
          const status = risposta.statusCode
          const adattata = adattaRisposta(risposta)
          // `firstValueFrom(this.httpService.xxx(...))` nel client si aspetta
          // che axios sollevi un'eccezione su risposta non-2xx (v.
          // `RentriAnagraficheClient`/`RentriTrasmissioniClient` — `post`/
          // `get`/`delete_` catturano `error.response`): un `Observable` che
          // completasse sempre con `next()` non riprodurrebbe questo
          // comportamento, a differenza dell'adattatore "always resolve" di
          // `rentri-api.client.polling-reale.oracolo.spec.ts`, che serve solo
          // al polling status/result con `validateStatus: () => true` (qui
          // replicato allo stesso modo per quelle due chiamate, sotto).
          if (status >= 200 && status < 300) {
            subscriber.next(adattata)
            subscriber.complete()
          } else {
            subscriber.error({ response: adattata })
          }
        })
        .catch((errore: unknown) => subscriber.error(errore))
    })
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

  it('inviaTrasmissione: 201, identificativo restituito, leggibile poi da dettaglioTrasmissione', async () => {
    const client = creaClient()

    const { identificativo } = await client.inviaTrasmissione(
      NUM_ISCR_SITO,
      corpoTrasmissioneDatiValido()
    )
    expect(identificativo).toMatch(/^[0-9a-f-]{36}$/i)

    const dettaglio = await client.dettaglioTrasmissione(NUM_ISCR_SITO, identificativo!)
    expect(dettaglio.identificativo).toBe(identificativo)
    expect(dettaglio.numero_fir).toBe('TSTB12345XY')
    expect(dettaglio.stato).toBe('Attivo')
    expect(dettaglio.formulario).toEqual(corpoTrasmissioneDatiValido())
  })

  it('inviaTrasmissione rifiuta un corpo non conforme a DatiTrasmissioneFormularioModel: 400 propagato come eccezione', async () => {
    const client = creaClient()

    // Come `RENTRIApiClient` (v. commento di `delete_` in
    // `rentri-trasmissioni.client.ts`), un 400 non e' rimappato su un errore
    // tipizzato: propaga come eccezione generica "Risposta inattesa".
    await expect(client.inviaTrasmissione(NUM_ISCR_SITO, {})).rejects.toThrow(/HTTP 400/)
  })

  it('elencaTrasmissioni: trova la trasmissione appena inviata, con la paginazione dichiarata dal contratto', async () => {
    const client = creaClient()

    await client.inviaTrasmissione(NUM_ISCR_SITO, corpoTrasmissioneDatiValido())

    const elenco = await client.elencaTrasmissioni(NUM_ISCR_SITO)
    expect(elenco.risultati.length).toBeGreaterThanOrEqual(1)
    expect(elenco.risultati[0]).not.toHaveProperty('formulario')
    expect(elenco.paging.totalRecordCount).toBeGreaterThanOrEqual(1)
  })

  it('dettaglioTrasmissione: 404 (RentriApiError) per un identificativo inesistente', async () => {
    const client = creaClient()

    await expect(
      client.dettaglioTrasmissione(NUM_ISCR_SITO, '00000000-0000-0000-0000-000000000000')
    ).rejects.toBeInstanceOf(RentriApiError)
  })

  it('annullaTrasmissione: non reversibile — il secondo annullamento propaga il 400 come eccezione', async () => {
    const client = creaClient()

    const { identificativo } = await client.inviaTrasmissione(
      NUM_ISCR_SITO,
      corpoTrasmissioneDatiValido()
    )

    await client.annullaTrasmissione(NUM_ISCR_SITO, identificativo!)
    const dettaglio = await client.dettaglioTrasmissione(NUM_ISCR_SITO, identificativo!)
    expect(dettaglio.stato).toBe('Annullato')

    await expect(client.annullaTrasmissione(NUM_ISCR_SITO, identificativo!)).rejects.toThrow(
      /HTTP 400/
    )
  })

  // Ciclo NONBLOCK_PULL di .../estrai, tramite i path CANONICI /status e
  // /result (v. commento di testata di `rentri-trasmissioni.client.ts`):
  // stesso principio dimostrativo di
  // `rentri-api.client.polling-reale.oracolo.spec.ts`, qui coi metodi
  // pubblici di `RentriTrasmissioniClient` (nessun `app.inject()` manuale a
  // pilotare il polling).
  it('estraiDatiXfir + attendiEsitoEstrazione: attraversa 202 -> 200 ("in elaborazione") -> 303 -> /result da solo', async () => {
    const client = creaClient()
    const httpServiceConPolling: any = (client as any).httpService
    // Il polling usa `validateStatus: () => true` e non deve MAI lanciare
    // un'eccezione su 200/303/400 (v. `interrogaStatoTransazione`/
    // `leggiEsitoTransazione`): l'adattatore sopra la solleva su ogni
    // risposta non-2xx, quindi qui si sostituisce `get` con una versione
    // "always resolve", esattamente come fa l'oracolo del polling reale di
    // `RENTRIApiClient`.
    httpServiceConPolling.get = (url: string, opts: { headers: Record<string, string> }) =>
      new Observable<AxiosResponse>(subscriber => {
        const path = new URL(url).pathname
        app
          .inject({ method: 'GET', url: path, headers: opts.headers })
          .then((risposta: any) => {
            subscriber.next(adattaRisposta(risposta))
            subscriber.complete()
          })
          .catch((errore: unknown) => subscriber.error(errore))
      })

    const { transazioneId } = await client.estraiDatiXfir(
      NUM_ISCR_SITO,
      'TSTB12345XY',
      Buffer.from('contenuto-xfir-di-prova').toString('base64')
    )
    expect(transazioneId).toMatch(/^[0-9a-f-]{36}$/i)

    setTimeout(() => {
      void app.inject({
        method: 'POST',
        url: '/__controllo/completa-transazione',
        payload: {
          transazione_id: transazioneId,
          errore: false,
          validazione: [],
        },
      })
    }, 150)

    const esito = await client.attendiEsitoEstrazione(transazioneId, {
      intervalloMs: 50,
      maxTentativi: 20,
    })

    expect(esito).toEqual({
      transazione_id: transazioneId,
      errore: false,
      validazione: [],
    })
  }, 15000)
})
