import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriVidimazioneClient } from './rentri-vidimazione.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { RentriApiError } from './rentri-http-resilienza'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Verifica "oracolo": `RentriVidimazioneClient` contro la fake fedele al
 * contratto ufficiale `vidimazione-formulari.yaml` (`tools/rentri-fake`),
 * montata in-process con `creaApp()` — stessa strategia di
 * `rentri-trasmissioni.oracolo.spec.ts`/`rentri-anagrafiche.client.oracolo.spec.ts`:
 * nessun mock della forma della risposta, solo un adattatore
 * `HttpService -> app.inject()`.
 *
 * Copre il servizio `vidimazione-formulari` nell'ordine di priorita' del
 * task: (1) vidimazione a blocchi (async, produce `qr_code_bytes`), (2)
 * `/verifica/{numero_fir}`, (3) il resto (elenco blocchi, elenco/dettaglio
 * FIR, annullamento, PDF modello, stato API, certificato).
 */
describe('RentriVidimazioneClient — contro la fake RENTRI (in-process)', () => {
  let app: any

  const IDENTIFICATIVO = '12345678901'
  const CODICE_BLOCCO = 'BLOCCO001'

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await app.inject({ method: 'POST', url: '/__controllo/vidimazione/azzera' })
    await app.inject({
      method: 'POST',
      url: '/__controllo/vidimazione/blocco',
      payload: { codice_blocco: CODICE_BLOCCO, identificativo_soggetto: IDENTIFICATIVO },
    })
  })

  function creaClient(): RentriVidimazioneClient {
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
      post: (
        url: string,
        body: unknown,
        opts: { headers: Record<string, string>; validateStatus?: (s: number) => boolean }
      ) => inietta('POST', url, opts.headers, body, opts.validateStatus),
      get: (
        url: string,
        opts: { headers: Record<string, string>; validateStatus?: (s: number) => boolean }
      ) => inietta('GET', url, opts.headers, undefined, opts.validateStatus),
      put: (
        url: string,
        body: unknown,
        opts: { headers: Record<string, string>; validateStatus?: (s: number) => boolean }
      ) => inietta('PUT', url, opts.headers, body, opts.validateStatus),
    }

    return new RentriVidimazioneClient(httpService, logger, metrics, config, auth, signature as any)
  }

  /**
   * Adattatore `HttpService -> app.inject()`. Come il client reale (axios),
   * onora `validateStatus` quando presente: `interrogaStatoTransazione`/
   * `leggiEsitoTransazione` lo passano (`validateStatus: () => true`) proprio
   * perche' 200/303/400 sono esiti ATTESI del ciclo NONBLOCK_PULL, non
   * errori — senza onorarlo qui l'adattatore li rifiuterebbe tutti come fa
   * per ogni altra chiamata non-2xx.
   */
  function inietta(
    method: string,
    url: string,
    headers: Record<string, string>,
    payload?: unknown,
    validateStatus?: (status: number) => boolean
  ): Observable<AxiosResponse> {
    return new Observable<AxiosResponse>(subscriber => {
      const path = new URL(url).pathname + new URL(url).search
      app
        .inject({ method, url: path, headers, payload: payload as any })
        .then((risposta: any) => {
          const status = risposta.statusCode
          const adattata = adattaRisposta(risposta)
          const ok = validateStatus ? validateStatus(status) : status >= 200 && status < 300
          if (ok) {
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

  /** Vidima un FIR completando SUBITO la transazione, per i test che non esercitano il polling stesso. */
  async function vidimaSubito(client: RentriVidimazioneClient) {
    const { transazioneId } = await client.vidimaFir(CODICE_BLOCCO)
    await app.inject({
      method: 'POST',
      url: '/__controllo/vidimazione/completa-transazione',
      payload: { transazione_id: transazioneId },
    })
    return client.attendiEsitoVidimazione(transazioneId, { intervalloMs: 10, maxTentativi: 5 })
  }

  it('elencaBlocchi: trova il blocco registrato dal canale di controllo, forma BloccoModel', async () => {
    const client = creaClient()

    const elenco = await client.elencaBlocchi(IDENTIFICATIVO)
    expect(elenco.risultati).toHaveLength(1)
    expect(elenco.risultati[0].codice_blocco).toBe(CODICE_BLOCCO)
    expect(elenco.paging.totalRecordCount).toBe(1)
  })

  it('elencaBlocchi senza identificativo: 400 propagato come eccezione (query obbligatoria dal contratto)', async () => {
    const client = creaClient()

    await expect(client.elencaBlocchi('')).rejects.toThrow(/HTTP 400/)
  })

  it('vidimaFir su blocco sconosciuto: 404 (RentriApiError)', async () => {
    const client = creaClient()

    await expect(client.vidimaFir('INESISTENTE')).rejects.toBeInstanceOf(RentriApiError)
  })

  // Priorita' 1 del task: vidimazione a blocchi, ASYNC, produce numero_fir + qr_code_bytes.
  it('vidimaFir + attendiEsitoVidimazione: attraversa 202 -> 200 ("in elaborazione") -> 303 -> /result da solo', async () => {
    const client = creaClient()
    const httpServiceConPolling: any = (client as any).httpService
    // Come `rentri-trasmissioni.oracolo.spec.ts`: il polling usa
    // `validateStatus: () => true` e non deve mai lanciare su 200/303/400 —
    // l'adattatore sopra invece solleva su ogni non-2xx, quindi qui si
    // sostituisce `get` con una versione "always resolve".
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

    const { transazioneId } = await client.vidimaFir(CODICE_BLOCCO)
    expect(transazioneId).toMatch(/^[0-9a-f-]{36}$/i)

    setTimeout(() => {
      void app.inject({
        method: 'POST',
        url: '/__controllo/vidimazione/completa-transazione',
        payload: { transazione_id: transazioneId },
      })
    }, 150)

    const esito = await client.attendiEsitoVidimazione(transazioneId, {
      intervalloMs: 50,
      maxTentativi: 20,
    })

    expect(esito.errore).toBe(false)
    expect(esito.esito?.numero_fir).toContain(CODICE_BLOCCO)
    expect(typeof esito.esito?.qr_code_bytes).toBe('string')
    expect(() => Buffer.from(esito.esito!.qr_code_bytes as string, 'base64')).not.toThrow()
  }, 15000)

  it('vidimaFir con replyTo: nessun header Location restituito', async () => {
    const client = creaClient()

    const { urlStato } = await client.vidimaFir(CODICE_BLOCCO, {
      replyTo: 'https://esempio.it/callback',
    })
    expect(urlStato).toBeUndefined()
  })

  it('elencaFirVidimati + dettaglioFir: il FIR vidimato compare in entrambi, stessa forma EfirModel/EfirPublicModel', async () => {
    const client = creaClient()
    const esito = await vidimaSubito(client)
    const numeroFir = esito.esito!.numero_fir!

    const elenco = await client.elencaFirVidimati(CODICE_BLOCCO)
    expect(elenco.risultati).toHaveLength(1)
    expect(elenco.risultati[0].numero_fir).toBe(numeroFir)

    const dettaglio = await client.dettaglioFir(CODICE_BLOCCO, 1)
    expect(dettaglio.numero_fir).toBe(numeroFir)
    expect(dettaglio.qr_code_bytes).toBe(esito.esito!.qr_code_bytes)
    expect(dettaglio.is_annullato).toBe(false)
  })

  // Priorita' 2 del task: verifica pubblica del numero FIR.
  it('verificaNumeroFir: trova il FIR appena vidimato', async () => {
    const client = creaClient()
    const esito = await vidimaSubito(client)
    const numeroFir = esito.esito!.numero_fir!

    const pubblico = await client.verificaNumeroFir(numeroFir)
    expect(pubblico.numero_fir).toBe(numeroFir)
    expect(pubblico.qr_code_bytes).toBe(esito.esito!.qr_code_bytes)
  })

  it('verificaNumeroFir su numero inesistente: 404 (RentriApiError)', async () => {
    const client = creaClient()

    await expect(client.verificaNumeroFir('NONESISTE')).rejects.toBeInstanceOf(RentriApiError)
  })

  it('annullaFir: non reversibile — il secondo annullamento propaga il 400 come eccezione', async () => {
    const client = creaClient()
    await vidimaSubito(client)

    await client.annullaFir(CODICE_BLOCCO, 1)
    const dettaglio = await client.dettaglioFir(CODICE_BLOCCO, 1)
    expect(dettaglio.is_annullato).toBe(true)

    await expect(client.annullaFir(CODICE_BLOCCO, 1)).rejects.toThrow(/HTTP 400/)
  })

  it('pdfModello: DownloadableBaseResponse con content Base64', async () => {
    const client = creaClient()
    await vidimaSubito(client)

    const pdf = await client.pdfModello(CODICE_BLOCCO, 1)
    expect(pdf.mime).toBe('application/pdf')
    expect(() => Buffer.from(pdf.content as string, 'base64')).not.toThrow()
  })

  it('statoApi: risponde Ok', async () => {
    const client = creaClient()

    const stato = await client.statoApi()
    expect(stato.status).toBe('Ok')
  })

  it('certificato: elenco vuoto (fuori scope dichiarato dalla fake)', async () => {
    const client = creaClient()

    const certificati = await client.certificato('qualsiasi')
    expect(certificati).toEqual([])
  })
})
