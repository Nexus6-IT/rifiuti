import { of, throwError } from 'rxjs'
import { RentriAnagraficheClient } from './rentri-anagrafiche.client'
import { RentriApiError } from './rentri-http-resilienza'
import { TrasmissioneRentriIncertaError } from './rentri-api.client'
import { EsitoRentriMalformatoError } from './rentri-registri.client'

const TENANT = 'tenant-1'
const REGISTRO = 'R1234ABCDEF'

function erroreHttp(
  status: number,
  headers: Record<string, string> = {},
  data: unknown = { status, title: 'T', detail: 'D' }
) {
  return { response: { status, data, headers } }
}

/** Unit test con HttpService finto: apertura e chiusura non si ritentano mai su un esito incerto. */
describe('RentriAnagraficheClient — registri (HttpService finto)', () => {
  let client: RentriAnagraficheClient
  let http: { get: jest.Mock; post: jest.Mock; put: jest.Mock; delete: jest.Mock }
  let signature: { buildIntegrityHeaders: jest.Mock }
  let limiter: { acquisisci: jest.Mock }
  let rilascia: jest.Mock
  let auth: { creaAuthorizationHeader: jest.Mock }

  function creaClient(opzioni: { conFirma?: boolean } = {}): RentriAnagraficheClient {
    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const metrics: any = {
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }
    return new RentriAnagraficheClient(
      http as any,
      logger,
      metrics,
      { baseUrl: 'https://demoapi.rentri.gov.it' } as any,
      auth as any,
      opzioni.conFirma === false ? undefined : (signature as any),
      limiter as any
    )
  }

  beforeEach(() => {
    http = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }
    auth = { creaAuthorizationHeader: jest.fn().mockResolvedValue('Bearer t') }
    signature = {
      buildIntegrityHeaders: jest
        .fn()
        .mockResolvedValue({ Digest: 'SHA-256=x', 'Agid-JWT-Signature': 'jws' }),
    }
    rilascia = jest.fn().mockResolvedValue(undefined)
    limiter = { acquisisci: jest.fn().mockResolvedValue({ rilascia }) }
    client = creaClient()
  })

  const apri = () =>
    client.apriRegistro({ numIscrSito: 'OP-1', attivita: ['Trasporto'], descrizione: 'd' }, TENANT)

  describe('apriRegistro', () => {
    it('201: invia il corpo del contratto con firma di integrità e restituisce l identificativo', async () => {
      http.post.mockReturnValue(
        of({ status: 201, data: { identificativo: REGISTRO }, headers: {} })
      )
      await expect(apri()).resolves.toEqual({ identificativo: REGISTRO })

      const [url, corpo, opzioni] = http.post.mock.calls[0]
      expect(url).toBe('https://demoapi.rentri.gov.it/anagrafiche/v1.0/operatore/registri')
      expect(corpo).toEqual({ num_iscr_sito: 'OP-1', attivita: ['Trasporto'], descrizione: 'd' })
      expect(opzioni.headers).toMatchObject({
        Authorization: 'Bearer t',
        'Content-Type': 'application/json',
        Digest: 'SHA-256=x',
        'Agid-JWT-Signature': 'jws',
      })
      expect(signature.buildIntegrityHeaders).toHaveBeenCalledWith(JSON.stringify(corpo), TENANT)
      expect(rilascia).toHaveBeenCalledTimes(1)
    })

    it('non invia i campi opzionali non indicati, e attivita_rec_smalt quando c e', async () => {
      http.post.mockReturnValue(
        of({ status: 201, data: { identificativo: REGISTRO }, headers: {} })
      )
      await client.apriRegistro(
        { numIscrSito: 'OP-1', attivita: ['Recupero'], attivitaRecSmalt: ['R13'] },
        TENANT
      )
      expect(http.post.mock.calls[0][1]).toEqual({
        num_iscr_sito: 'OP-1',
        attivita: ['Recupero'],
        attivita_rec_smalt: ['R13'],
      })
    })

    it.each([500, 502, 503, 504])(
      '%i: nessun secondo tentativo, TrasmissioneRentriIncertaError HTTP_5XX',
      async stato => {
        http.post.mockReturnValue(throwError(() => erroreHttp(stato)))
        const errore = await apri().catch(e => e)
        expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
        expect(errore).toMatchObject({ causa: 'HTTP_5XX', status: stato })
        expect(http.post).toHaveBeenCalledTimes(1)
        expect(rilascia).toHaveBeenCalledTimes(1)
      }
    )

    it('timeout/errore di rete: NESSUNA_RISPOSTA, nessun secondo tentativo', async () => {
      http.post.mockReturnValue(throwError(() => new Error('timeout of 30000ms exceeded')))
      const errore = await apri().catch(e => e)
      expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
      expect(errore.causa).toBe('NESSUNA_RISPOSTA')
      expect(http.post).toHaveBeenCalledTimes(1)
    })

    it('201 senza identificativo: RISPOSTA_SENZA_TRANSAZIONE (esito incerto)', async () => {
      http.post.mockReturnValue(of({ status: 201, data: {}, headers: {} }))
      const errore = await apri().catch(e => e)
      expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
      expect(errore.causa).toBe('RISPOSTA_SENZA_TRANSAZIONE')
      expect(http.post).toHaveBeenCalledTimes(1)
    })

    it('429 con Retry-After e 423: ritenta (nuova firma a ogni giro) e poi riesce', async () => {
      http.post
        .mockReturnValueOnce(throwError(() => erroreHttp(429, { 'retry-after': '0' })))
        .mockReturnValueOnce(throwError(() => erroreHttp(423)))
        .mockReturnValueOnce(of({ status: 201, data: { identificativo: REGISTRO }, headers: {} }))
      jest.useFakeTimers()
      const promessa = apri()
      await jest.runAllTimersAsync()
      await expect(promessa).resolves.toEqual({ identificativo: REGISTRO })
      jest.useRealTimers()
      expect(http.post).toHaveBeenCalledTimes(3)
      expect(signature.buildIntegrityHeaders).toHaveBeenCalledTimes(3)
      expect(rilascia).toHaveBeenCalledTimes(3)
    })

    it('403: RentriApiError non ritentabile, una sola chiamata', async () => {
      http.post.mockReturnValue(throwError(() => erroreHttp(403)))
      const errore = await apri().catch(e => e)
      expect(errore).toBeInstanceOf(RentriApiError)
      expect(errore).toMatchObject({ status: 403, retryable: false })
      expect(http.post).toHaveBeenCalledTimes(1)
    })

    it('400: RentriApiError con title/detail dell ente, non ritentabile', async () => {
      http.post.mockReturnValue(
        throwError(() => erroreHttp(400, {}, { title: 'Modello non valido', detail: 'attivita' }))
      )
      const errore = await apri().catch(e => e)
      expect(errore).toBeInstanceOf(RentriApiError)
      expect(errore).toMatchObject({
        status: 400,
        problemTitle: 'Modello non valido',
        problemDetail: 'attivita',
        retryable: false,
      })
      expect(http.post).toHaveBeenCalledTimes(1)
    })

    it('404: sito non trovato, non ritentabile', async () => {
      http.post.mockReturnValue(throwError(() => erroreHttp(404)))
      const errore = await apri().catch(e => e)
      expect(errore).toMatchObject({
        status: 404,
        problemDetail: 'Sito non trovato a registro',
        retryable: false,
      })
    })

    it('tenant vuoto o servizio di firma assente: errore prima di qualunque chiamata', async () => {
      await expect(
        client.apriRegistro({ numIscrSito: 'OP-1', attivita: ['Trasporto'] }, '')
      ).rejects.toThrow(/tenant/)
      await expect(
        creaClient({ conFirma: false }).apriRegistro(
          { numIscrSito: 'OP-1', attivita: ['Trasporto'] },
          TENANT
        )
      ).rejects.toThrow(/firma/)
      expect(http.post).not.toHaveBeenCalled()
      expect(limiter.acquisisci).not.toHaveBeenCalled()
    })

    it('errore del rate limiter o della firma: rilanciato invariato, RENTRI non raggiunto', async () => {
      signature.buildIntegrityHeaders.mockRejectedValue(new Error('firma ko'))
      await expect(apri()).rejects.toThrow('firma ko')
      expect(http.post).not.toHaveBeenCalled()
      expect(rilascia).toHaveBeenCalledTimes(1)
    })
  })

  describe('chiudiRegistro', () => {
    it('200: DELETE senza corpo e senza firma di integrità', async () => {
      http.delete.mockReturnValue(of({ status: 200, data: undefined, headers: {} }))
      await expect(client.chiudiRegistro(REGISTRO, TENANT)).resolves.toBeUndefined()
      const [url, opzioni] = http.delete.mock.calls[0]
      expect(url).toBe(
        `https://demoapi.rentri.gov.it/anagrafiche/v1.0/operatore/registri/${REGISTRO}`
      )
      expect(opzioni.headers).toEqual({ Authorization: 'Bearer t' })
      expect(signature.buildIntegrityHeaders).not.toHaveBeenCalled()
    })

    it('5xx e assenza di risposta: incerto, nessun secondo DELETE', async () => {
      http.delete.mockReturnValue(throwError(() => erroreHttp(500)))
      expect(await client.chiudiRegistro(REGISTRO, TENANT).catch(e => e)).toMatchObject({
        causa: 'HTTP_5XX',
        status: 500,
      })
      http.delete.mockReturnValue(throwError(() => new Error('socket hang up')))
      expect(await client.chiudiRegistro(REGISTRO, TENANT).catch(e => e)).toMatchObject({
        causa: 'NESSUNA_RISPOSTA',
      })
      expect(http.delete).toHaveBeenCalledTimes(2)
    })

    it('404 e 400: RentriApiError non ritentabili', async () => {
      http.delete.mockReturnValueOnce(throwError(() => erroreHttp(404)))
      expect(await client.chiudiRegistro(REGISTRO, TENANT).catch(e => e)).toMatchObject({
        status: 404,
        problemDetail: 'Registro non trovato',
      })
      http.delete.mockReturnValueOnce(throwError(() => erroreHttp(400)))
      expect(await client.chiudiRegistro(REGISTRO, TENANT).catch(e => e)).toMatchObject({
        status: 400,
        retryable: false,
      })
    })
  })

  describe('modificaRegistro', () => {
    it('200: PUT con i nomi di campo del contratto', async () => {
      http.put.mockReturnValue(of({ status: 200, data: { identificativo: REGISTRO }, headers: {} }))
      await expect(
        client.modificaRegistro(
          REGISTRO,
          { descrizione: 'n', attivitaRecSmalt: ['R13'], forza: true },
          TENANT
        )
      ).resolves.toEqual({ identificativo: REGISTRO })
      expect(http.put.mock.calls[0][1]).toEqual({
        descrizione: 'n',
        attivita_rec_smalt: ['R13'],
        forza_salvataggio_attivita_rec_smalt: true,
      })
    })

    it('5xx: ritentato come ogni PUT idempotente (a differenza di POST e DELETE)', async () => {
      http.put
        .mockReturnValueOnce(throwError(() => erroreHttp(503, { 'retry-after': '0' })))
        .mockReturnValueOnce(of({ status: 200, data: { identificativo: REGISTRO }, headers: {} }))
      jest.useFakeTimers()
      const promessa = client.modificaRegistro(REGISTRO, { descrizione: 'n' }, TENANT)
      await jest.runAllTimersAsync()
      await expect(promessa).resolves.toEqual({ identificativo: REGISTRO })
      jest.useRealTimers()
      expect(http.put).toHaveBeenCalledTimes(2)
    })

    it('risposta senza identificativo: EsitoRentriMalformatoError', async () => {
      http.put.mockReturnValue(of({ status: 200, data: {}, headers: {} }))
      await expect(client.modificaRegistro(REGISTRO, {}, TENANT)).rejects.toBeInstanceOf(
        EsitoRentriMalformatoError
      )
    })
  })

  describe('letture', () => {
    it('elencaRegistriSito: costruisce query e header di paginazione, legge i Paging-*', async () => {
      http.get.mockReturnValue(
        of({
          status: 200,
          data: [{ identificativo: REGISTRO }],
          headers: {
            'paging-page': '2',
            'paging-pagesize': '5',
            'paging-pagecount': '3',
            'paging-totalrecordcount': '12',
          },
        })
      )
      const esito = await client.elencaRegistriSito(
        'MI1',
        'OP-1',
        {
          identificativoOperatore: 'RSS',
          identificativo: REGISTRO,
          chiuso: false,
          paging: { page: 2, pageSize: 5 },
        },
        TENANT
      )
      const [url, opzioni] = http.get.mock.calls[0]
      expect(url).toBe(
        `https://demoapi.rentri.gov.it/anagrafiche/v1.0/operatore/MI1/siti/OP-1/registri?identificativo_operatore=RSS&identificativo=${REGISTRO}&chiuso=false`
      )
      expect(opzioni.headers).toMatchObject({ 'Paging-Page': '2', 'Paging-PageSize': '5' })
      expect(esito.risultati).toHaveLength(1)
      expect(esito.paging).toEqual({ page: 2, pageSize: 5, pageCount: 3, totalRecordCount: 12 })
    })

    it('elencaRegistriSito senza filtri: nessuna query; corpo non array -> elenco vuoto', async () => {
      http.get.mockReturnValue(of({ status: 200, data: null, headers: {} }))
      const esito = await client.elencaRegistriSito('MI1', 'OP-1', undefined, TENANT)
      expect(http.get.mock.calls[0][0]).toBe(
        'https://demoapi.rentri.gov.it/anagrafiche/v1.0/operatore/MI1/siti/OP-1/registri'
      )
      expect(esito.risultati).toEqual([])
    })

    it('dettaglioRegistro: 404 con messaggio dedicato', async () => {
      http.get.mockReturnValueOnce(throwError(() => erroreHttp(404)))
      expect(await client.dettaglioRegistro(REGISTRO, TENANT).catch(e => e)).toMatchObject({
        status: 404,
        problemDetail: 'Registro non trovato',
        retryable: false,
      })
    })

    it('scaricaVidimazioneXml: decodifica il base64 UTF-8 senza alterare i byte', async () => {
      const xml = '<?xml version="1.0"?><reg:eREGI Id="eREGI-CS-0">è</reg:eREGI>'
      http.get.mockReturnValue(
        of({
          status: 200,
          data: {
            nome_file: 'e.xml',
            mime: 'application/xml',
            content: Buffer.from(xml, 'utf8').toString('base64'),
          },
          headers: {},
        })
      )
      await expect(client.scaricaVidimazioneXml(REGISTRO, TENANT)).resolves.toEqual({
        nomeFile: 'e.xml',
        mime: 'application/xml',
        xml,
      })
    })

    it.each([
      { content: undefined },
      { content: '' },
      { content: 'non base64 !!' },
      { content: null },
    ])('scaricaVidimazioneXml: contenuto %j -> EsitoRentriMalformatoError', async dati => {
      http.get.mockReturnValue(
        of({ status: 200, data: { nome_file: 'e.xml', ...dati }, headers: {} })
      )
      await expect(client.scaricaVidimazioneXml(REGISTRO, TENANT)).rejects.toBeInstanceOf(
        EsitoRentriMalformatoError
      )
    })
  })

  describe('difesa in profondita sui parametri e sulle risposte', () => {
    it.each([
      '',
      'r1234abcdef',
      'R123',
      '../R1234ABCDEF',
      'R1234ABCDEF/xml',
      'R1234ABCDEF?x=1',
      'R1234ABCDEFG',
    ])(
      'identificativo registro %j: rifiutato prima di qualunque chiamata (DELETE irreversibile compresa)',
      async id => {
        await expect(client.chiudiRegistro(id, TENANT)).rejects.toThrow(/identificativo/i)
        await expect(client.modificaRegistro(id, { descrizione: 'x' }, TENANT)).rejects.toThrow(
          /identificativo/i
        )
        await expect(client.dettaglioRegistro(id, TENANT)).rejects.toThrow(/identificativo/i)
        await expect(client.scaricaVidimazioneXml(id, TENANT)).rejects.toThrow(/identificativo/i)
        expect(http.delete).not.toHaveBeenCalled()
        expect(http.put).not.toHaveBeenCalled()
        expect(http.get).not.toHaveBeenCalled()
      }
    )

    it('elencaRegistriSito codifica i segmenti di path', async () => {
      http.get.mockReturnValue(of({ status: 200, data: [], headers: {} }))
      await client.elencaRegistriSito('MI/1', 'OP 1/../x', undefined, TENANT)
      expect(http.get.mock.calls[0][0]).toBe(
        'https://demoapi.rentri.gov.it/anagrafiche/v1.0/operatore/MI%2F1/siti/OP%201%2F..%2Fx/registri'
      )
    })

    it.each(['X', 'r1234abcdef', 'R123', '../R1234ABCDEF'])(
      'apriRegistro: identificativo %j nel 201 -> esito incerto (il registro potrebbe esistere)',
      async id => {
        http.post.mockReturnValue(of({ status: 201, data: { identificativo: id }, headers: {} }))
        const errore = await apri().catch(e => e)
        expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
        expect(errore.causa).toBe('RISPOSTA_SENZA_TRANSAZIONE')
        expect(http.post).toHaveBeenCalledTimes(1)
      }
    )

    it('scaricaVidimazioneXml: contenuto non UTF-8 -> EsitoRentriMalformatoError (niente U+FFFD in silenzio)', async () => {
      const nonUtf8 = Buffer.from([0x3c, 0x61, 0x3e, 0xe8, 0x3c, 0x2f, 0x61, 0x3e]) // <a>\xe8</a> in latin1
      http.get.mockReturnValue(
        of({ status: 200, data: { content: nonUtf8.toString('base64') }, headers: {} })
      )
      await expect(client.scaricaVidimazioneXml(REGISTRO, TENANT)).rejects.toBeInstanceOf(
        EsitoRentriMalformatoError
      )
    })

    it('scaricaVidimazioneXml: BOM UTF-8 conservato byte per byte', async () => {
      const originale = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('<a>è</a>', 'utf8'),
      ])
      http.get.mockReturnValue(
        of({ status: 200, data: { content: originale.toString('base64') }, headers: {} })
      )
      const { xml } = await client.scaricaVidimazioneXml(REGISTRO, TENANT)
      expect(Buffer.from(xml, 'utf8').equals(originale)).toBe(true)
    })
  })
})
