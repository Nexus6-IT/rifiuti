import { of, throwError } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriApiError } from '../rentri-http-resilienza'
import { RentriCodificheClient } from './rentri-codifiche.client'
import { NOME_TABELLE_CODIFICHE_SEMPLICI } from './rentri-codifiche.model'

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

function rispostaLookup(dati: unknown[]): AxiosResponse {
  return {
    data: dati,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as any,
  }
}

/**
 * Unit test del client `codifiche`: comunicazione HTTP coi doppi (mock di
 * `httpService`/`auth`), path/parametri del contratto ufficiale
 * (`docs/contracts/rentri/codifiche.yaml`) e strategia di rate-limiting di
 * {@link RentriCodificheClient.scaricaTutte}. La verifica REALE (non
 * mockata) contro la fake fedele al contratto è in
 * `rentri-codifiche.client.oracolo.spec.ts`.
 */
describe('RentriCodificheClient', () => {
  let client: RentriCodificheClient
  let mockHttpService: any
  let mockConfig: any
  let mockAuth: any
  let mockLogger: any
  let mockMetrics: any

  beforeEach(() => {
    mockHttpService = { get: jest.fn() }
    mockConfig = { baseUrl: 'https://demoapi.rentri.gov.it' }
    mockAuth = { creaAuthorizationHeader: jest.fn().mockResolvedValue('Bearer test-token') }
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }
    mockMetrics = { rentriApiErrors: { inc: jest.fn() } }

    client = new RentriCodificheClient(
      mockHttpService,
      mockLogger,
      mockMetrics,
      mockConfig,
      mockAuth
    )
  })

  describe('leggiTabella', () => {
    it('GET /codifiche/v1.0/lookup/<nomeTabella> con Bearer self-issued', async () => {
      mockHttpService.get.mockReturnValue(
        of(rispostaLookup([{ id: 1, code: 'R1', name: 'Utilizzazione principale' }]))
      )

      const risultato = await client.leggiTabella('attivita-rs', 'tenant-1')

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/codifiche/v1.0/lookup/attivita-rs',
        (expect as any).objectContaining({
          headers: (expect as any).objectContaining({ Authorization: 'Bearer test-token' }),
        })
      )
      expect(mockAuth.creaAuthorizationHeader).toHaveBeenCalledWith('tenant-1')
      expect(risultato).toEqual([{ id: 1, code: 'R1', name: 'Utilizzazione principale' }])
    })
  })

  describe('codiciEer', () => {
    it('senza opzioni non aggiunge query string', async () => {
      mockHttpService.get.mockReturnValue(of(rispostaLookup([])))

      await client.codiciEer(undefined, 'tenant-1')

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/codifiche/v1.0/lookup/codici-eer',
        (expect as any).anything()
      )
    })

    it('applica pericoloso ed escludi00 come query string', async () => {
      mockHttpService.get.mockReturnValue(of(rispostaLookup([])))

      await client.codiciEer({ pericoloso: true, escludi00: false }, 'tenant-1')

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/codifiche/v1.0/lookup/codici-eer?pericoloso=true&escludi00=false',
        (expect as any).anything()
      )
    })
  })

  describe('comuni / comuniProvincia', () => {
    it('comuni: nessun filtro, intero catalogo', async () => {
      mockHttpService.get.mockReturnValue(of(rispostaLookup([])))

      await client.comuni('tenant-1')

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/codifiche/v1.0/lookup/comuni',
        (expect as any).anything()
      )
    })

    it('comuniProvincia: applica provincia_id nel path e attivi/comune_id in query', async () => {
      mockHttpService.get.mockReturnValue(of(rispostaLookup([])))

      await client.comuniProvincia('048', { attivi: false, comuneId: '048033' }, 'tenant-1')

      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/codifiche/v1.0/lookup/comuni/048?comune_id=048033&attivi=false',
        (expect as any).anything()
      )
    })
  })

  describe('stato', () => {
    it('GET /status senza autenticazione', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          data: { status: 'Ok', warnings: [], planned_notices: [] },
          status: 200,
          statusText: 'OK',
          headers: {},
          config: {} as any,
        })
      )

      const risultato = await client.stato()

      const [, opzioni] = mockHttpService.get.mock.calls[0]
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://demoapi.rentri.gov.it/codifiche/v1.0/status',
        (expect as any).anything()
      )
      expect(opzioni.headers).toBeUndefined()
      expect(mockAuth.creaAuthorizationHeader).not.toHaveBeenCalled()
      expect(risultato.status).toBe('Ok')
    })
  })

  /**
   * Strategia di rate-limiting: concorrenza 1 (mai in parallelo) + pausa
   * minima di 250ms tra una tabella e la successiva (v. commento di testata
   * di `rentri-codifiche.client.ts`). 23 chiamate GET in tutto: le 21
   * tabelle semplici + codici-eer + comuni.
   */
  describe('scaricaTutte — rate limiting sequenziale', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('scarica le 23 tabelle in sequenza, mai in parallelo, con una pausa di 250ms tra una e l’altra', async () => {
      mockHttpService.get.mockReturnValue(of(rispostaLookup([{ id: 1, code: 'X', name: 'Y' }])))

      const promessa = client.scaricaTutte('tenant-1')
      // 22 pause da 250ms (tra le 23 chiamate): 21 tabelle semplici + codici-eer,
      // l'ultima (comuni) non è seguita da altra pausa.
      await jest.advanceTimersByTimeAsync(22 * 250)

      const risultato = await promessa

      expect(mockHttpService.get).toHaveBeenCalledTimes(NOME_TABELLE_CODIFICHE_SEMPLICI.length + 2)
      expect(risultato.size).toBe(NOME_TABELLE_CODIFICHE_SEMPLICI.length + 2)
      for (const nomeTabella of NOME_TABELLE_CODIFICHE_SEMPLICI) {
        expect(risultato.get(nomeTabella)).toEqual([{ id: 1, code: 'X', name: 'Y' }])
      }
      expect(risultato.has('codici-eer')).toBe(true)
      expect(risultato.has('comuni')).toBe(true)

      // codici-eer: escludi00=false esplicito (non silenziosamente escluso).
      expect(mockHttpService.get).toHaveBeenCalledWith(
        (expect as any).stringContaining('escludi00=false'),
        (expect as any).anything()
      )
    })

    it('interrompe il ciclo su un 403 (nessuna tabella successiva viene richiesta)', async () => {
      mockHttpService.get
        .mockReturnValueOnce(of(rispostaLookup([]))) // prima tabella: ok
        .mockReturnValue(
          throwError(() => erroreProblemDetails(403, { title: 'Operazione non consentita' }))
        )

      const promessa = client.scaricaTutte('tenant-1')
      const assertion = expect(promessa).rejects.toThrow(RentriApiError)
      await jest.advanceTimersByTimeAsync(250)
      await assertion

      // Prima tabella + seconda (fallita): mai una terza chiamata dopo il 403.
      expect(mockHttpService.get).toHaveBeenCalledTimes(2)
    })
  })

  describe('resilienza — 403/429/423/5xx (leggiTabella)', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('403 — non ritenta: un solo tentativo, errore definitivo', async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() =>
          erroreProblemDetails(403, {
            title: 'Operazione non consentita',
            detail: 'Certificato non riconosciuto',
          })
        )
      )

      const promessa = client.leggiTabella('materiali', 'tenant-1')
      await expect(promessa).rejects.toThrow(RentriApiError)
      await promessa.catch((errore: RentriApiError) => {
        expect(errore.status).toBe(403)
        expect(errore.retryable).toBe(false)
      })
      expect(mockHttpService.get).toHaveBeenCalledTimes(1)
    })

    it("429 con Retry-After: ritenta rispettando l'header e alla fine riesce", async () => {
      mockHttpService.get
        .mockReturnValueOnce(
          throwError(() =>
            erroreProblemDetails(429, { title: 'Troppe richieste' }, { 'retry-after': '5' })
          )
        )
        .mockReturnValueOnce(of(rispostaLookup([{ id: 1, code: 'FE', name: 'Ferro e acciaio' }])))

      const promessa = client.leggiTabella('materiali', 'tenant-1')
      await jest.advanceTimersByTimeAsync(5000)

      const risultato = await promessa
      expect(risultato).toEqual([{ id: 1, code: 'FE', name: 'Ferro e acciaio' }])
      expect(mockHttpService.get).toHaveBeenCalledTimes(2)
    })

    it('423 (ban del chiamante): ritenta con backoff esponenziale e alla fine riesce', async () => {
      mockHttpService.get
        .mockReturnValueOnce(
          throwError(() => erroreProblemDetails(423, { title: 'Chiamante bloccato' }))
        )
        .mockReturnValueOnce(of(rispostaLookup([{ id: 1, code: 'X', name: 'Y' }])))

      const promessa = client.leggiTabella('province', 'tenant-1')
      await jest.advanceTimersByTimeAsync(1000)

      const risultato = await promessa
      expect(risultato).toEqual([{ id: 1, code: 'X', name: 'Y' }])
      expect(mockHttpService.get).toHaveBeenCalledTimes(2)
    })

    it('esaurisce i tentativi su un 429 persistente: solleva RentriApiError retryable', async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() =>
          erroreProblemDetails(429, { title: 'Troppe richieste' }, { 'retry-after': '0' })
        )
      )

      const promessa = client.leggiTabella('regioni', 'tenant-1')
      const assertion = expect(promessa).rejects.toThrow(RentriApiError)
      await jest.runAllTimersAsync()
      await assertion

      await promessa.catch((errore: RentriApiError) => {
        expect(errore.retryable).toBe(true)
        expect(errore.status).toBe(429)
      })
      expect(mockHttpService.get).toHaveBeenCalledTimes(5) // MAX_TENTATIVI_RESILIENZA
    })
  })
})
