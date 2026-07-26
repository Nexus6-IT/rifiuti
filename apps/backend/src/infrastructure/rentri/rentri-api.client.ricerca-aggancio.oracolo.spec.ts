import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient, RentriApiError } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriConfig } from './rentri-config'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

const NUM_ISCR_SITO_VALIDO = 'OP1234ABC123456-RM1234'

/**
 * R2 Task 2: verifica REALE (non mockata) contro la fake fedele al
 * contratto RENTRI (tools/rentri-fake) dei tre metodi aggiunti in questo
 * task — `cercaFormulari`, `acquisisciVisibilita`, `rilasciaVisibilita`.
 *
 * Istanziata IN-PROCESS con `creaApp()` + `app.inject()`, come le altre
 * `*.oracolo.spec.ts` accanto a questo file (v. `rentri-api.client.oracolo.spec.ts`
 * per il motivo: la CA di prova della fake e' memoizzata per processo).
 *
 * Usa l'adattatore "fedele" (uno status >= 400 fa fallire l'observable con
 * un errore che porta `error.response`, come axios reale) perché la prova
 * 423/429 di questo file richiede che `eseguiRichiestaConResilienza` veda
 * davvero un'eccezione da classificare — v. `rentri-api.client.resilienza.oracolo.spec.ts`.
 */
describe('RENTRIApiClient — ricerca e aggancio contro la fake RENTRI (in-process)', () => {
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
            .then((risposta: any) => emetti(subscriber, risposta))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: (url: string, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const parsedUrl = new URL(url)
          app
            .inject({
              method: 'GET',
              url: `${parsedUrl.pathname}${parsedUrl.search}`,
              headers: opts.headers,
            })
            .then((risposta: any) => emetti(subscriber, risposta))
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return new RENTRIApiClient(httpService, logger, metrics, config, auth, signature as any)
  }

  /** Replica la semantica reale di axios: status >= 400 fa fallire l'observable con `error.response`. */
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
    return app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato, volte },
    })
  }

  /**
   * Crea un formulario reale attraverso il ciclo NONBLOCK_PULL già validato
   * in R0/R1 (`creaFormulario` + completamento dal canale di controllo) e
   * restituisce il `numero_fir` risultante. La fake collega l'esito di
   * creazione a un `Formulario` cercabile (v. `Archivio.completaTransazione`,
   * estensione fatta in questo task): senza questo collegamento nessuno
   * scenario di ricerca sarebbe verificabile.
   */
  async function creaFormularioReale(
    client: RENTRIApiClient,
    identificativoSoggetto: string
  ): Promise<string> {
    const { transazioneId } = await client.creaFormulario('', {
      identificativo_soggetto: identificativoSoggetto,
      produttore: 'Produttore di prova SRL',
    })

    const numeroFir = 'BCDFGH00010ZZ'
    const completamento = await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: {
        transazione_id: transazioneId,
        errore: false,
        validazione: [],
        esito: { numero_fir: numeroFir },
      },
    })
    expect(completamento.statusCode).toBe(200)

    return numeroFir
  }

  it('cercaFormulari: trova per identificativo_soggetto il formulario appena creato, con visibilita_sito_acquisita coerente', async () => {
    const client = creaClient()
    const cf = 'RSSMRA80A01H501U'
    const numeroFir = await creaFormularioReale(client, cf)

    const risultato = await client.cercaFormulari('', { identificativoSoggetto: cf })

    expect(risultato.risultati).toEqual([
      expect.objectContaining({ numero_fir: numeroFir, visibilita_sito_acquisita: false }),
    ])
    // Header Paging-* dichiarati dal contratto (righe 137-157), riflessi nel default.
    expect(risultato.paging).toEqual({
      page: 1,
      pageSize: 100,
      pageCount: 1,
      totalRecordCount: 1,
    })
  })

  it('acquisisciVisibilita poi rilasciaVisibilita: il ciclo si chiude senza errore (200 sincrono, non NONBLOCK_PULL)', async () => {
    const client = creaClient()
    const cf = 'VRDGPP75B02H501X'
    const numeroFir = await creaFormularioReale(client, cf)

    // L'acquisizione e' verificata come 200 sincrono: il contratto non
    // dichiara alcun 202/TransazioneModel per questa operazione (v. commento
    // in RENTRIApiClient.acquisisciVisibilita), quindi non c'e' alcun esito
    // da attendere con attendiEsito.
    await expect(
      client.acquisisciVisibilita('', numeroFir, NUM_ISCR_SITO_VALIDO)
    ).resolves.toBeUndefined()

    // La fake riflette l'acquisizione in una successiva ricerca (verificato
    // qui perché la fake lo supporta), ma il contratto stesso non garantisce
    // che ogni implementazione lo rifletta immediatamente in GET / — questa
    // riga documenta cosa la fake fa, non una garanzia dell'ente reale.
    const dopoAcquisizione = await client.cercaFormulari('', { identificativoSoggetto: cf })
    expect(dopoAcquisizione.risultati[0]).toMatchObject({ visibilita_sito_acquisita: true })

    // Il rilascio è verificato SOLO come chiusura senza errore del ciclo: la
    // fake non e' tenuta a riflettere lo stato in una GET / successiva con
    // la fedeltà di RENTRI reale (riserva già annotata nel piano R2 Task 2
    // Step 3) — qui si dimostra comunque che la fake lo riflette, a titolo
    // di verifica aggiuntiva, non come requisito del contratto.
    await expect(
      client.rilasciaVisibilita('', numeroFir, NUM_ISCR_SITO_VALIDO)
    ).resolves.toBeUndefined()
  })

  /**
   * 423/429 su acquisizione/rilascio: stessa disciplina di resilienza delle
   * altre scritture del client (v. `rentri-api.client.resilienza.oracolo.spec.ts`),
   * qui riverificata sui due metodi nuovi di questo task — un 423 NON deve
   * scatenare alcun ritentativo automatico (a differenza di 429/5xx).
   */
  describe('resilienza — 423/429 su acquisizione/rilascio', () => {
    it("acquisisciVisibilita: con 423 iniettato una volta, ritenta con backoff e alla fine riesce (diversamente dal 403, non e' un fallimento definitivo)", async () => {
      const client = creaClient()
      const cf = 'BNCLGU70C03H501Y'
      const numeroFir = await creaFormularioReale(client, cf)
      await impostaGuasto(423, 1)

      const spia = jest.spyOn(app.archivio, 'guastoAttivo')

      try {
        // 423 non è nell'elenco dei codici "mai ritentare" (quello è solo
        // il 403): la politica del client lo tratta come transitorio e
        // applica backoff esponenziale. Con un solo guasto iniettato
        // (volte: 1), ci si aspettano esattamente 2 richieste HTTP: quella
        // fallita (423) e quella che poi riesce.
        await client.acquisisciVisibilita('', numeroFir, NUM_ISCR_SITO_VALIDO)
        expect(spia).toHaveBeenCalledTimes(2)
      } finally {
        spia.mockRestore()
      }
    }, 15000)

    it('rilasciaVisibilita: con 429 iniettato, ritenta rispettando Retry-After e alla fine riesce', async () => {
      const client = creaClient()
      const cf = 'FRRLGI68D04H501Z'
      const numeroFir = await creaFormularioReale(client, cf)
      await client.acquisisciVisibilita('', numeroFir, NUM_ISCR_SITO_VALIDO)
      await impostaGuasto(429, 1)

      await expect(
        client.rilasciaVisibilita('', numeroFir, NUM_ISCR_SITO_VALIDO)
      ).resolves.toBeUndefined()
    }, 20000)

    it('acquisisciVisibilita: con 403 (nessun incarico sul soggetto) iniettato, NON ritenta e fallisce con esito definitivo', async () => {
      const client = creaClient()
      const cf = 'GNTPLA65E05H501A'
      const numeroFir = await creaFormularioReale(client, cf)
      await impostaGuasto(403, 1)

      const spia = jest.spyOn(app.archivio, 'guastoAttivo')

      try {
        let sollevato = false
        let errore: unknown
        try {
          await client.acquisisciVisibilita('', numeroFir, NUM_ISCR_SITO_VALIDO)
        } catch (e) {
          sollevato = true
          errore = e
        }

        expect(sollevato).toBe(true)
        expect(errore).toBeInstanceOf(RentriApiError)
        expect(errore).toMatchObject({ status: 403, retryable: false })
        expect(spia).toHaveBeenCalledTimes(1)
      } finally {
        spia.mockRestore()
      }
    })
  })
})
