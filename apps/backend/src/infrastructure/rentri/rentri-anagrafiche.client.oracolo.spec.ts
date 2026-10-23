import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriAnagraficheClient } from './rentri-anagrafiche.client'
import { RentriApiError } from './rentri-http-resilienza'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Verifica REALE (non mockata) di {@link RentriAnagraficheClient} contro la
 * fake fedele al contratto RENTRI (`tools/rentri-fake`, Task 1 di R4):
 * dimostra che il client parla correttamente il servizio `anagrafiche`
 * (`/anagrafiche/v1.0/operatore/{num_iscr}/siti[...]`) — paginazione,
 * dettaglio, controllo-iscrizione, 404 su chiave inesistente e resilienza
 * (403/429/423) comprese — contro il vero codice di rotta della fake, non un
 * doppio.
 *
 * Istanziato IN-PROCESS con `creaApp()` + `app.inject()`, stesso motivo di
 * `rentri-api.client.oracolo.spec.ts` e `codifiche/rentri-codifiche.client.oracolo.spec.ts`.
 *
 * Fixture di riferimento (`tools/rentri-fake/src/stato/fixture-anagrafiche.ts`):
 * operatore `MI00001234` con due unità locali (`MI00001234-001` sede legale a
 * Milano, `MI00001234-002` deposito a Roma).
 */
describe('RentriAnagraficheClient — verifica reale contro la fake RENTRI (in-process)', () => {
  let app: any

  const NUM_ISCR_OPERATORE = 'MI00001234'

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

  function creaClient(): RentriAnagraficheClient {
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
    const metrics: any = { rentriApiErrors: { inc: jest.fn() } }

    // httpService reale sostituito da un adattatore su app.inject(): esegue
    // il vero handler di rotta della fake (autenticazione compresa). Stessa
    // semantica di axios: uno status >= 400 fa fallire l'observable con un
    // errore che porta `error.response`.
    const httpService: any = {
      get: (url: string, opts: { headers?: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const parsed = new URL(url)
          const path = parsed.pathname + parsed.search
          app
            .inject({ method: 'GET', url: path, headers: opts.headers })
            .then((risposta: any) => emetti(subscriber, risposta))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return new RentriAnagraficheClient(httpService, logger, metrics, config, auth)
  }

  function emetti(
    subscriber: {
      next: (r: AxiosResponse) => void
      error: (e: unknown) => void
      complete: () => void
    },
    risposta: any
  ): void {
    const risposaAdattata: AxiosResponse = {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }

    if (risposaAdattata.status >= 400) {
      const errore: any = new Error(`Richiesta fallita con status ${risposaAdattata.status}`)
      errore.response = risposaAdattata
      subscriber.error(errore)
      return
    }
    subscriber.next(risposaAdattata)
    subscriber.complete()
  }

  function impostaGuasto(stato: number, volte: number): Promise<unknown> {
    return app.inject({ method: 'POST', url: '/__controllo/guasto', payload: { stato, volte } })
  }

  it('elencaSiti: restituisce i num_iscr_sito reali della fixture', async () => {
    const client = creaClient()

    const esito = await client.elencaSiti(NUM_ISCR_OPERATORE, undefined, '')

    expect(esito.risultati.length).toBe(2)
    expect(esito.risultati.map(s => s.num_iscr_sito).sort()).toEqual([
      'MI00001234-001',
      'MI00001234-002',
    ])
    expect(esito.risultati.some(s => s.is_sede_legale === true)).toBe(true)
  })

  it('elencaSiti: paginazione rispettata (Paging-Page/PageSize inviati come richiesti, PageCount/TotalRecordCount riportati dalla fake)', async () => {
    const client = creaClient()

    // La fake (come l'analogo elenco formulari) echeggia gli header di
    // paginazione dichiarati dal contratto ma non affetta il corpo (non
    // implementa lo slicing): il client deve comunque leggere correttamente
    // page/pageSize dalla richiesta e pageCount/totalRecordCount dalla
    // risposta, non dare per scontati i default.
    const esito = await client.elencaSiti(
      NUM_ISCR_OPERATORE,
      { paging: { page: 1, pageSize: 1 } },
      ''
    )

    expect(esito.paging.page).toBe(1)
    expect(esito.paging.pageSize).toBe(1)
    expect(esito.paging.totalRecordCount).toBe(2)
    expect(esito.paging.pageCount).toBe(2)
  })

  it('elencaSiti: 404 su operatore inesistente, non ritentabile', async () => {
    const client = creaClient()

    let erroreCatturato: unknown
    try {
      await client.elencaSiti('MI99999999', undefined, '')
    } catch (errore) {
      erroreCatturato = errore
    }

    expect(erroreCatturato).toBeInstanceOf(RentriApiError)
    expect(erroreCatturato).toMatchObject({ status: 404, retryable: false })
  })

  it('dettaglioSito: restituisce il dettaglio reale della sede legale', async () => {
    const client = creaClient()

    const sito = await client.dettaglioSito(NUM_ISCR_OPERATORE, 'MI00001234-001', '')

    expect(sito.num_iscr_sito).toBe('MI00001234-001')
    expect(sito.is_sede_legale).toBe(true)
    expect(sito.comune_id).toBe('015146')
  })

  it('dettaglioSito: 404 su unità locale inesistente', async () => {
    const client = creaClient()

    let erroreCatturato: unknown
    try {
      await client.dettaglioSito(NUM_ISCR_OPERATORE, 'MI00001234-999', '')
    } catch (errore) {
      erroreCatturato = errore
    }

    expect(erroreCatturato).toBeInstanceOf(RentriApiError)
    expect(erroreCatturato).toMatchObject({ status: 404, retryable: false })
  })

  it('controlloIscrizione: true per un codice fiscale iscritto reale', async () => {
    const client = creaClient()

    const iscritto = await client.controlloIscrizione('RSSMRA80A01F205X', '')

    expect(iscritto).toBe(true)
  })

  it('controlloIscrizione: false per un codice fiscale non iscritto', async () => {
    const client = creaClient()

    const iscritto = await client.controlloIscrizione('XXXYYY00A01Z000X', '')

    expect(iscritto).toBe(false)
  })

  it('429 iniettato dal canale di controllo: ritenta rispettando Retry-After e alla fine riesce', async () => {
    const client = creaClient()
    await impostaGuasto(429, 1)

    const esito = await client.elencaSiti(NUM_ISCR_OPERATORE, undefined, '')

    expect(esito.risultati.length).toBe(2)
  }, 15000) // Retry-After fisso della fake = 5s (v. tools/rentri-fake/src/app.ts).

  it('423 (ban del chiamante) iniettato: ritenta con backoff esponenziale e alla fine riesce', async () => {
    const client = creaClient()
    await impostaGuasto(423, 1)

    const sito = await client.dettaglioSito(NUM_ISCR_OPERATORE, 'MI00001234-001', '')

    expect(sito.num_iscr_sito).toBe('MI00001234-001')
  }, 10000)

  it('403 iniettato: NON ritenta, fallisce subito con esito definitivo (RentriApiError, retryable=false)', async () => {
    const client = creaClient()
    await impostaGuasto(403, 1)

    const spia = jest.spyOn(app.archivio, 'guastoAttivo')

    let erroreCatturato: unknown
    let sollevato = false
    try {
      await client.elencaSiti(NUM_ISCR_OPERATORE, undefined, '')
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
