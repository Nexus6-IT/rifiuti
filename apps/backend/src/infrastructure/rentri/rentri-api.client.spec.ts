import { RENTRIApiClient, RentriApiError } from './rentri-api.client'
import { of, throwError } from 'rxjs'
import { AxiosResponse } from 'axios'

/** Costruisce un errore axios-like con corpo `application/problem+json`. */
function erroreProblemDetails(
  status: number,
  problema: { title?: string; detail?: string } = {},
  headers: Record<string, string> = {}
) {
  return {
    response: {
      status,
      data: { status, ...problema },
      headers,
    },
  }
}

/**
 * Unit test del client RENTRI: comunicazione HTTP coi doppi (mock di
 * `httpService`/`auth`/`signature`), path/verbi del contratto ufficiale,
 * ciclo NONBLOCK_PULL e resilienza (403/429/423/5xx). La verifica REALE
 * (non mockata) contro la fake fedele al contratto è nei file
 * `*.oracolo.spec.ts` accanto a questo.
 */
describe('RENTRIApiClient', () => {
  let client: RENTRIApiClient
  let mockHttpService: any
  let mockConfig: any
  let mockAuth: any
  let mockSignature: any
  let mockLogger: any
  let mockMetrics: any

  beforeEach(() => {
    mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    }

    // Il client opera sempre in modalità live (autenticazione Bearer self-issued).
    mockConfig = {
      baseUrl: 'https://demoapi.rentri.gov.it',
    }

    mockAuth = {
      creaAuthorizationHeader: jest.fn().mockResolvedValue('Bearer test-token'),
    }

    mockSignature = {
      buildIntegrityHeaders: jest.fn().mockReturnValue({}),
    }

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }

    mockMetrics = {
      rentriApiRequestDuration: {
        observe: jest.fn(),
      },
      rentriApiErrors: {
        inc: jest.fn(),
      },
    }

    // Directly instantiate the client with mocks (new constructor order)
    client = new RENTRIApiClient(
      mockHttpService,
      mockLogger,
      mockMetrics,
      mockConfig,
      mockAuth,
      mockSignature
    )
  })

  /**
   * Metodi allineati al contratto ufficiale RENTRI (docs/contracts/rentri/formulari.yaml):
   * autenticazione Bearer self-issued + firma di integrità su ogni chiamata.
   */
  describe('creaFormulario', () => {
    it('invia POST sulla radice del servizio (non /formulari) e legge transazione_id e Location da una risposta 202', async () => {
      const mockResponse: AxiosResponse = {
        data: { transazione_id: '9f8b3c1a-1234-4abc-8def-0123456789ab' },
        status: 202,
        statusText: 'Accepted',
        headers: {
          location: '/formulari/v1.0/9f8b3c1a-1234-4abc-8def-0123456789ab/status',
        },
        config: {} as any,
      }
      mockHttpService.post.mockReturnValue(of(mockResponse))

      const dati = { numero_fir: null }
      const risultato = await client.creaFormulario('tenant-1', dati)

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/formulari/v1.0/',
        dati,
        (expect as any).objectContaining({
          headers: (expect as any).objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
      // Mai /formulari né /trasmissione: la creazione è sulla radice del servizio.
      expect(mockHttpService.post).not.toHaveBeenCalledWith(
        (expect as any).stringContaining('/formulari/v1.0/formulari'),
        (expect as any).anything(),
        (expect as any).anything()
      )
      expect(mockHttpService.post).not.toHaveBeenCalledWith(
        (expect as any).stringContaining('/trasmissione'),
        (expect as any).anything(),
        (expect as any).anything()
      )

      expect(risultato.transazioneId).toBe('9f8b3c1a-1234-4abc-8def-0123456789ab')
      expect(risultato.urlStato).toBe('/formulari/v1.0/9f8b3c1a-1234-4abc-8def-0123456789ab/status')
      expect(mockAuth.creaAuthorizationHeader).toHaveBeenCalledWith('tenant-1')
    })
  })

  /**
   * `cercaFormulari` (`GET /`, formulari.yaml righe 15-172): i due filtri
   * sono mutuamente esclusivi (righe 29, 45), la paginazione è dichiarata
   * come header di richiesta/risposta.
   */
  describe('cercaFormulari', () => {
    it('rifiuta la chiamata (errore locale, nessuna richiesta HTTP) se non è indicato alcun filtro', async () => {
      await expect(client.cercaFormulari('tenant-1', {})).rejects.toThrow(
        /identificativoSoggetto.*numIscrSito|numIscrSito.*identificativoSoggetto/
      )
      expect(mockHttpService.get).not.toHaveBeenCalled()
    })

    it('rifiuta la chiamata (errore locale) se sono indicati entrambi i filtri', async () => {
      await expect(
        client.cercaFormulari('tenant-1', {
          identificativoSoggetto: 'RSSMRA80A01H501U',
          numIscrSito: 'OP1234ABC123456-RM1234',
        })
      ).rejects.toThrow(/mutuamente esclusivi/)
      expect(mockHttpService.get).not.toHaveBeenCalled()
    })

    it('invia GET su / con identificativo_soggetto e la paginazione di default (Paging-Page=1, Paging-PageSize=100)', async () => {
      const mockResponse: AxiosResponse = {
        data: [{ numero_fir: 'BCDFGH00001JK', visibilita_sito_acquisita: false }],
        status: 200,
        statusText: 'OK',
        headers: {
          'paging-page': '1',
          'paging-pagesize': '100',
          'paging-pagecount': '1',
          'paging-totalrecordcount': '1',
        },
        config: {} as any,
      }
      mockHttpService.get.mockReturnValue(of(mockResponse))

      const risultato = await client.cercaFormulari('tenant-1', {
        identificativoSoggetto: 'RSSMRA80A01H501U',
      })

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/formulari/v1.0/?identificativo_soggetto=RSSMRA80A01H501U',
        (expect as any).objectContaining({
          headers: (expect as any).objectContaining({
            'Paging-Page': '1',
            'Paging-PageSize': '100',
          }),
        })
      )
      expect(risultato.risultati).toEqual([
        { numero_fir: 'BCDFGH00001JK', visibilita_sito_acquisita: false },
      ])
      expect(risultato.paging).toEqual({
        page: 1,
        pageSize: 100,
        pageCount: 1,
        totalRecordCount: 1,
      })
    })

    it('invia GET su / con num_iscr_sito e la paginazione esplicita indicata dal chiamante', async () => {
      const mockResponse: AxiosResponse = {
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {
          'paging-page': '2',
          'paging-pagesize': '50',
          'paging-pagecount': '3',
          'paging-totalrecordcount': '120',
        },
        config: {} as any,
      }
      mockHttpService.get.mockReturnValue(of(mockResponse))

      const risultato = await client.cercaFormulari('tenant-1', {
        numIscrSito: 'OP1234ABC123456-RM1234',
        paging: { page: 2, pageSize: 50 },
      })

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/formulari/v1.0/?num_iscr_sito=OP1234ABC123456-RM1234',
        (expect as any).objectContaining({
          headers: (expect as any).objectContaining({
            'Paging-Page': '2',
            'Paging-PageSize': '50',
          }),
        })
      )
      expect(risultato.paging).toEqual({
        page: 2,
        pageSize: 50,
        pageCount: 3,
        totalRecordCount: 120,
      })
    })
  })

  /**
   * `acquisisciVisibilita`/`rilasciaVisibilita`: il contratto dichiara SOLO
   * `200` immediato per queste due operazioni (formulari.yaml righe 657-703
   * e 2030-2075) — nessun `202`/NONBLOCK_PULL come per `creaFormulario`
   * (l'unica marcata "🔁[ASYNC]" nel `summary`). Verificato qui che il
   * client non tenti alcun polling: una singola risposta 200 basta.
   */
  describe('acquisisciVisibilita', () => {
    it('invia POST su /{numero_fir}/acquisizione-visibilita/{num_iscr_sito} (non /acquisizione/, deprecato) e si risolve su 200 sincrono', async () => {
      const mockResponse: AxiosResponse = {
        data: undefined,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      }
      mockHttpService.post.mockReturnValue(of(mockResponse))

      await client.acquisisciVisibilita(
        'tenant-1',
        'BCDFGH00001JK',
        'OP1234ABC123456-RM1234',
        'correlazione-1'
      )

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/formulari/v1.0/BCDFGH00001JK/acquisizione-visibilita/OP1234ABC123456-RM1234',
        {},
        (expect as any).objectContaining({
          headers: (expect as any).objectContaining({ Authorization: 'Bearer test-token' }),
        })
      )
      expect(mockHttpService.post).not.toHaveBeenCalledWith(
        (expect as any).stringContaining('/acquisizione/'),
        (expect as any).anything(),
        (expect as any).anything()
      )
    })

    it('403: non ritenta, errore definitivo (nessun incarico sul soggetto/unità locale)', async () => {
      jest.useFakeTimers()
      mockHttpService.post.mockReturnValue(
        throwError(() => erroreProblemDetails(403, { title: 'Operazione non consentita' }))
      )

      const promessa = client.acquisisciVisibilita(
        'tenant-1',
        'BCDFGH00001JK',
        'OP1234ABC123456-RM1234'
      )
      await expect(promessa).rejects.toThrow(RentriApiError)
      expect(mockHttpService.post).toHaveBeenCalledTimes(1)
      jest.useRealTimers()
    })
  })

  describe('rilasciaVisibilita', () => {
    it('invia POST su /{numero_fir}/rilascio-visibilita/{num_iscr_sito} (non /respingi, deprecato) e si risolve su 200 sincrono', async () => {
      const mockResponse: AxiosResponse = {
        data: undefined,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      }
      mockHttpService.post.mockReturnValue(of(mockResponse))

      await client.rilasciaVisibilita(
        'tenant-1',
        'BCDFGH00001JK',
        'OP1234ABC123456-RM1234',
        'correlazione-2'
      )

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/formulari/v1.0/BCDFGH00001JK/rilascio-visibilita/OP1234ABC123456-RM1234',
        {},
        (expect as any).objectContaining({
          headers: (expect as any).objectContaining({ Authorization: 'Bearer test-token' }),
        })
      )
      expect(mockHttpService.post).not.toHaveBeenCalledWith(
        (expect as any).stringContaining('/respingi'),
        (expect as any).anything(),
        (expect as any).anything()
      )
    })

    it('423: non ritenta subito ma applica backoff esponenziale come le altre scritture', async () => {
      jest.useFakeTimers()
      const successResponse: AxiosResponse = {
        data: undefined,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      }
      mockHttpService.post
        .mockReturnValueOnce(
          throwError(() => erroreProblemDetails(423, { title: 'Risorsa bloccata' }))
        )
        .mockReturnValueOnce(of(successResponse))

      const promessa = client.rilasciaVisibilita(
        'tenant-1',
        'BCDFGH00001JK',
        'OP1234ABC123456-RM1234'
      )
      await jest.advanceTimersByTimeAsync(1000)

      await expect(promessa).resolves.toBeUndefined()
      expect(mockHttpService.post).toHaveBeenCalledTimes(2)
      jest.useRealTimers()
    })
  })

  describe('leggiFormulario', () => {
    it('invia GET su /{numero_fir} e restituisce il DettaglioFormulario', async () => {
      const mockResponse: AxiosResponse = {
        data: {
          stato_formulario: 'InserimentoQuantita',
          versione: 1,
          data_creazione: '2026-07-25T10:00:00Z',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      }
      mockHttpService.get.mockReturnValue(of(mockResponse))

      const risultato = await client.leggiFormulario('tenant-1', 'BCDFGH00001JK')

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/formulari/v1.0/BCDFGH00001JK',
        (expect as any).objectContaining({
          headers: (expect as any).objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
      expect(risultato.stato_formulario).toBe('InserimentoQuantita')
      expect(mockAuth.creaAuthorizationHeader).toHaveBeenCalledWith('tenant-1')
    })
  })

  /**
   * Task 4 (P2): gestione degli errori RENTRI dichiarati dal contratto per
   * `creaFormulario`/`leggiFormulario` (403/429/423/5xx, `ProblemDetails`).
   * Le attese di backoff usano i fake timers di Jest: nessun test aspetta
   * realmente secondi di wall-clock.
   */
  describe('resilienza — creaFormulario/leggiFormulario', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('403 — non ritenta: un solo tentativo, errore definitivo con title/detail dal ProblemDetails', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() =>
          erroreProblemDetails(403, {
            title: 'Operazione non consentita',
            detail: 'Certificato non riconosciuto',
          })
        )
      )

      const promessa = client.creaFormulario('tenant-1', { dati: 'x' })
      await expect(promessa).rejects.toThrow(RentriApiError)
      await promessa.catch((errore: RentriApiError) => {
        expect(errore.status).toBe(403)
        expect(errore.retryable).toBe(false)
        expect(errore.problemTitle).toBe('Operazione non consentita')
        expect(errore.problemDetail).toBe('Certificato non riconosciuto')
      })

      expect(mockHttpService.post).toHaveBeenCalledTimes(1)
    })

    it("429 con Retry-After: ritenta rispettando l'header e alla fine riesce", async () => {
      const successResponse: AxiosResponse = {
        data: { transazione_id: 'tx-429' },
        status: 202,
        statusText: 'Accepted',
        headers: { location: '/formulari/v1.0/tx-429/status' },
        config: {} as any,
      }

      mockHttpService.post
        .mockReturnValueOnce(
          throwError(() =>
            erroreProblemDetails(429, { title: 'Troppe richieste' }, { 'retry-after': '5' })
          )
        )
        .mockReturnValueOnce(
          throwError(() =>
            erroreProblemDetails(429, { title: 'Troppe richieste' }, { 'retry-after': '5' })
          )
        )
        .mockReturnValueOnce(of(successResponse))

      const promessa = client.creaFormulario('tenant-1', { dati: 'x' })
      // Due attese da 5s (Retry-After) prima del successo al 3° tentativo.
      await jest.advanceTimersByTimeAsync(5000)
      await jest.advanceTimersByTimeAsync(5000)

      const risultato = await promessa
      expect(risultato.transazioneId).toBe('tx-429')
      expect(mockHttpService.post).toHaveBeenCalledTimes(3)
    })

    it('423 (risorsa bloccata): ritenta con backoff esponenziale e alla fine riesce', async () => {
      const successResponse: AxiosResponse = {
        data: { transazione_id: 'tx-423' },
        status: 202,
        statusText: 'Accepted',
        headers: { location: '/formulari/v1.0/tx-423/status' },
        config: {} as any,
      }

      mockHttpService.post
        .mockReturnValueOnce(
          throwError(() => erroreProblemDetails(423, { title: 'Risorsa bloccata' }))
        )
        .mockReturnValueOnce(of(successResponse))

      const promessa = client.creaFormulario('tenant-1', { dati: 'x' })
      await jest.advanceTimersByTimeAsync(1000) // backoff esponenziale, 1° tentativo: base 1000ms

      const risultato = await promessa
      expect(risultato.transazioneId).toBe('tx-423')
      expect(mockHttpService.post).toHaveBeenCalledTimes(2)
    })

    it('5xx: ritenta con backoff esponenziale e alla fine riesce', async () => {
      const successResponse: AxiosResponse = {
        data: { stato_formulario: 'InserimentoQuantita' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      }

      mockHttpService.get
        .mockReturnValueOnce(
          throwError(() => erroreProblemDetails(503, { title: 'Servizio non disponibile' }))
        )
        .mockReturnValueOnce(of(successResponse))

      const promessa = client.leggiFormulario('tenant-1', 'BCDFGH00001JK')
      await jest.advanceTimersByTimeAsync(1000)

      const risultato = await promessa
      expect((risultato as any).stato_formulario).toBe('InserimentoQuantita')
      expect(mockHttpService.get).toHaveBeenCalledTimes(2)
    })

    it('esaurisce i tentativi su un 429 persistente: solleva RentriApiError retryable', async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() =>
          erroreProblemDetails(429, { title: 'Troppe richieste' }, { 'retry-after': '0' })
        )
      )

      const promessa = client.creaFormulario('tenant-1', { dati: 'x' })
      const assertion = expect(promessa).rejects.toThrow(RentriApiError)
      await jest.runAllTimersAsync()
      await assertion

      await promessa.catch((errore: RentriApiError) => {
        expect(errore.retryable).toBe(true)
        expect(errore.status).toBe(429)
      })

      expect(mockHttpService.post).toHaveBeenCalledTimes(5) // MAX_TENTATIVI_RESILIENZA
    })
  })

  /**
   * Ciclo NONBLOCK_PULL (formulari.yaml righe 2801-2897): `GET /status`
   * risponde 200 senza corpo finché l'elaborazione è in corso e 303 con
   * header `Location` quando l'esito è pronto; `GET /result` risponde 400
   * se interrogato in anticipo. Il client NON deve delegare il follow del
   * redirect all'HTTP client (altrimenti 200 e 303 sarebbero indistinguibili):
   * per questo ogni chiamata a /status verifica esplicitamente `maxRedirects: 0`.
   */
  describe('attendiEsito', () => {
    function statusResponse(status: number, location?: string): AxiosResponse {
      return {
        data: undefined,
        status,
        statusText: '',
        headers: location ? { location } : {},
        config: {} as any,
      }
    }

    function resultResponse(status: number, data?: unknown): AxiosResponse {
      return {
        data,
        status,
        statusText: '',
        headers: {},
        config: {} as any,
      }
    }

    /** Risposta di errore RENTRI (`ProblemDetails`) con header opzionali (es. `Retry-After`). */
    function resultResponseConHeader(
      status: number,
      problema: { title?: string; detail?: string },
      headers: Record<string, string> = {}
    ): AxiosResponse {
      return {
        data: { status, ...problema },
        status,
        statusText: '',
        headers,
        config: {} as any,
      }
    }

    it('200 su /status significa "ancora in elaborazione": riprova senza seguire redirect automaticamente', async () => {
      mockHttpService.get
        .mockReturnValueOnce(of(statusResponse(200))) // 1° tentativo: ancora in corso
        .mockReturnValueOnce(of(statusResponse(303, '/formulari/v1.0/tx-1/result'))) // 2° tentativo: pronto
        .mockReturnValueOnce(of(resultResponse(200, { errore: false, validazione: [] })))

      const esito = await client.attendiEsito('tenant-1', 'tx-1', {
        intervalloMs: 0,
        maxTentativi: 5,
      })

      expect(esito).toEqual({ errore: false, validazione: [] })
      expect(mockHttpService.get).toHaveBeenCalledTimes(3)

      // La richiesta di stato non deve delegare il follow del redirect al
      // client HTTP: deve poter osservare 200 e 303 come stati distinti.
      expect(mockHttpService.get).toHaveBeenNthCalledWith(
        1,
        'https://demoapi.rentri.gov.it/formulari/v1.0/tx-1/status',
        (expect as any).objectContaining({ maxRedirects: 0 })
      )
      expect(mockHttpService.get).toHaveBeenNthCalledWith(
        2,
        'https://demoapi.rentri.gov.it/formulari/v1.0/tx-1/status',
        (expect as any).objectContaining({ maxRedirects: 0 })
      )
    })

    it("303 su /status: segue l'header Location e restituisce l'esito letto da /result", async () => {
      mockHttpService.get
        .mockReturnValueOnce(of(statusResponse(303, '/formulari/v1.0/tx-2/result')))
        .mockReturnValueOnce(
          of(resultResponse(200, { errore: true, validazione: [{ tipo: 'Errore' }] }))
        )

      const esito = await client.attendiEsito('tenant-1', 'tx-2', {
        intervalloMs: 0,
        maxTentativi: 3,
      })

      expect(esito).toEqual({ errore: true, validazione: [{ tipo: 'Errore' }] })
      expect(mockHttpService.get).toHaveBeenNthCalledWith(
        2,
        'https://demoapi.rentri.gov.it/formulari/v1.0/tx-2/result',
        (expect as any).anything()
      )
      expect(mockAuth.creaAuthorizationHeader).toHaveBeenCalledWith('tenant-1')
    })

    it("400 su /result e' trattato come richiesta anticipata (non errore definitivo): il polling continua", async () => {
      mockHttpService.get
        .mockReturnValueOnce(of(statusResponse(303, '/formulari/v1.0/tx-3/result')))
        .mockReturnValueOnce(of(resultResponse(400, { title: 'Richiesta non ancora elaborata' })))
        .mockReturnValueOnce(of(statusResponse(303, '/formulari/v1.0/tx-3/result')))
        .mockReturnValueOnce(of(resultResponse(200, { errore: false, validazione: [] })))

      const esito = await client.attendiEsito('tenant-1', 'tx-3', {
        intervalloMs: 0,
        maxTentativi: 5,
      })

      expect(esito).toEqual({ errore: false, validazione: [] })
      expect(mockHttpService.get).toHaveBeenCalledTimes(4)
    })

    it('supera il numero massimo di tentativi: solleva un errore esplicito (mai un polling infinito)', async () => {
      mockHttpService.get.mockReturnValue(of(statusResponse(200))) // sempre "in elaborazione"

      await expect(
        client.attendiEsito('tenant-1', 'tx-4', { intervalloMs: 0, maxTentativi: 3 })
      ).rejects.toThrow(/tentativi/i)

      expect(mockHttpService.get).toHaveBeenCalledTimes(3)
    })

    it('usa i default di intervallo/tentativi quando le opzioni non sono indicate', async () => {
      mockHttpService.get
        .mockReturnValueOnce(of(statusResponse(303, '/formulari/v1.0/tx-5/result')))
        .mockReturnValueOnce(of(resultResponse(200, { errore: false, validazione: [] })))

      const esito = await client.attendiEsito('tenant-1', 'tx-5')

      expect(esito).toEqual({ errore: false, validazione: [] })
    })

    /**
     * Task 4 (P2): 403/429/423/5xx durante il polling `/status`/`/result`.
     * Qui `httpService.get` risolve (mai un errore axios) perché il client
     * usa `validateStatus: () => true`: la classificazione avviene quindi
     * sullo `status` della risposta, non su un'eccezione.
     */
    describe('resilienza — 403/429/423/5xx durante il polling', () => {
      beforeEach(() => {
        jest.useFakeTimers()
      })

      afterEach(() => {
        jest.useRealTimers()
      })

      it('403 su /status: non ritenta, errore definitivo', async () => {
        mockHttpService.get.mockReturnValue(
          of(resultResponseConHeader(403, { title: 'Operazione non consentita' }))
        )

        const promessa = client.attendiEsito('tenant-1', 'tx-403', {
          intervalloMs: 0,
          maxTentativi: 5,
        })
        await expect(promessa).rejects.toThrow(RentriApiError)
        await promessa.catch((errore: RentriApiError) => {
          expect(errore.retryable).toBe(false)
          expect(errore.status).toBe(403)
        })

        expect(mockHttpService.get).toHaveBeenCalledTimes(1)
      })

      it('429 su /status con Retry-After: ritenta e alla fine legge lo stato pronto', async () => {
        mockHttpService.get
          .mockReturnValueOnce(
            of(resultResponseConHeader(429, { title: 'Troppe richieste' }, { 'retry-after': '5' }))
          )
          .mockReturnValueOnce(of(statusResponse(303, '/formulari/v1.0/tx-429/result')))
          .mockReturnValueOnce(of(resultResponse(200, { errore: false, validazione: [] })))

        const promessa = client.attendiEsito('tenant-1', 'tx-429', {
          intervalloMs: 0,
          maxTentativi: 5,
        })
        await jest.advanceTimersByTimeAsync(5000)

        const esito = await promessa
        expect(esito).toEqual({ errore: false, validazione: [] })
        expect(mockHttpService.get).toHaveBeenCalledTimes(3)
      })

      it("503 su /result: ritenta con backoff esponenziale e alla fine legge l'esito", async () => {
        mockHttpService.get
          .mockReturnValueOnce(of(statusResponse(303, '/formulari/v1.0/tx-503/result')))
          .mockReturnValueOnce(
            of(resultResponseConHeader(503, { title: 'Servizio non disponibile' }))
          )
          .mockReturnValueOnce(of(resultResponse(200, { errore: false, validazione: [] })))

        const promessa = client.attendiEsito('tenant-1', 'tx-503', {
          intervalloMs: 0,
          maxTentativi: 5,
        })
        await jest.advanceTimersByTimeAsync(1000)

        const esito = await promessa
        expect(esito).toEqual({ errore: false, validazione: [] })
        expect(mockHttpService.get).toHaveBeenCalledTimes(3)
      })
    })
  })
})
