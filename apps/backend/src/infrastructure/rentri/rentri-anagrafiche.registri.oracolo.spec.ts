import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriAnagraficheClient } from './rentri-anagrafiche.client'
import { RentriApiError } from './rentri-http-resilienza'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriSignatureService } from './rentri-signature.service'
import { RentriConfig } from './rentri-config'
import { TrasmissioneRentriIncertaError } from './rentri-api.client'
import { EsitoRentriMalformatoError } from './rentri-registri.client'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Oracolo dei registri dell'operatore (pezzo E1 del registro eREGI):
 * `RentriAnagraficheClient` contro la fake RENTRI in-process (`creaApp()` +
 * `app.inject()`), come `rentri-anagrafiche.client.oracolo.spec.ts`. La firma di
 * integrità è quella VERA (`RentriSignatureService` sul tenant di prova), la
 * fake però non la verifica (FEDELTA.md §3.7).
 *
 * Unità locali di fixture: `MI00001234-002` (Trasporto + Recupero, nessuna
 * autorizzazione: nessun codice R/D dichiarato) e `MI00001234-001` (Produzione).
 */
describe('RentriAnagraficheClient (registri) — contro la fake RENTRI (in-process)', () => {
  let app: any
  let chiamateHttp: Array<{ metodo: string; url: string }>

  const OPERATORE = 'MI00001234'
  const SITO = 'MI00001234-002'
  const TENANT = 'tenant-oracolo'

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    chiamateHttp = []
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
    const credentialService = {
      getForTenant: jest.fn().mockResolvedValue({
        clientId: 'operatore-test',
        certificatePem: config.certificatePem,
        privateKeyPem: config.privateKeyPem,
        algorithm: 'RS256',
      }),
    }
    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const resolver = new RentriCredentialResolver(credentialService as any, config)
    const auth = new RentriAuthService(resolver, config, logger)
    const signature = new RentriSignatureService(config, resolver)
    const metrics: any = {
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }

    const httpService: any = {
      get: (url: string, opts: { headers: Record<string, string> }) =>
        inietta('GET', url, opts.headers),
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        inietta('POST', url, opts.headers, body),
      put: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        inietta('PUT', url, opts.headers, body),
      delete: (url: string, opts: { headers: Record<string, string> }) =>
        inietta('DELETE', url, opts.headers),
    }
    return new RentriAnagraficheClient(httpService, logger, metrics, config, auth, signature)
  }

  /** Stessa semantica di axios: status >= 400 -> errore con `response`; nessuna risposta -> errore senza `response`. */
  function inietta(
    metodo: string,
    url: string,
    headers: Record<string, string>,
    payload?: unknown
  ): Observable<AxiosResponse> {
    return new Observable<AxiosResponse>(subscriber => {
      const analizzato = new URL(url)
      chiamateHttp.push({ metodo, url: analizzato.pathname })
      app
        .inject({
          method: metodo,
          url: `${analizzato.pathname}${analizzato.search}`,
          headers,
          payload: payload as any,
        })
        .then((risposta: any) => {
          const adattata: AxiosResponse = {
            data: risposta.payload ? risposta.json() : undefined,
            status: risposta.statusCode,
            statusText: '',
            headers: risposta.headers as Record<string, string>,
            config: {} as any,
          }
          if (adattata.status >= 400) {
            const errore: any = new Error(`Richiesta fallita con status ${adattata.status}`)
            errore.response = adattata
            subscriber.error(errore)
            return
          }
          subscriber.next(adattata)
          subscriber.complete()
        })
        .catch((errore: unknown) => subscriber.error(errore))
    })
  }

  function esitoPerso(operazione: string, tipo: '5xx' | 'timeout', stato = 503) {
    return app.inject({
      method: 'POST',
      url: '/__controllo/registri/esito-perso',
      payload: { operazione, tipo, stato, volte: 1 },
    })
  }

  const richiesta = { numIscrSito: SITO, attivita: ['Trasporto'], descrizione: 'Registro di prova' }
  const post = () => chiamateHttp.filter(c => c.metodo === 'POST')

  it('apriRegistro: restituisce un identificativo nel formato del contratto e il registro compare in elenco e dettaglio', async () => {
    const client = creaClient()

    const { identificativo } = await client.apriRegistro(richiesta, TENANT)

    expect(identificativo).toMatch(/^R[0-9A-Z]{10}$/)
    const dettaglio = await client.dettaglioRegistro(identificativo, TENANT)
    expect(dettaglio).toMatchObject({
      identificativo,
      descrizione: 'Registro di prova',
      num_iscr_sito: SITO,
      attivita: ['Trasporto'],
      stato: 'Attivo',
      data_chiusura: null,
    })
    const elenco = await client.elencaRegistriSito(OPERATORE, SITO, undefined, TENANT)
    expect(elenco.risultati.map(r => r.identificativo)).toEqual([identificativo])
    expect(elenco.paging.totalRecordCount).toBe(1)
  })

  it('apriRegistro: attivita non prevista dal sito -> RentriApiError 400 con il motivo dell ente, non ritentabile', async () => {
    const client = creaClient()

    const errore = await client
      .apriRegistro({ numIscrSito: 'MI00001234-001', attivita: ['Trasporto'] }, TENANT)
      .catch(e => e)

    expect(errore).toBeInstanceOf(RentriApiError)
    expect(errore).toMatchObject({ status: 400, retryable: false })
    expect(errore.problemDetail).toContain('prevista')
    expect(post()).toHaveLength(1)
  })

  it('apriRegistro: Recupero senza codici R/D -> 400', async () => {
    const errore = await creaClient()
      .apriRegistro({ numIscrSito: SITO, attivita: ['Recupero'] }, TENANT)
      .catch(e => e)
    expect(errore).toMatchObject({ status: 400 })
  })

  it('apriRegistro: sito inesistente -> RentriApiError 404', async () => {
    const errore = await creaClient()
      .apriRegistro({ numIscrSito: 'NON-ESISTE', attivita: ['Trasporto'] }, TENANT)
      .catch(e => e)
    expect(errore).toBeInstanceOf(RentriApiError)
    expect(errore).toMatchObject({ status: 404, retryable: false })
    expect(errore.problemDetail).toBe('Sito non trovato a registro')
  })

  it('apriRegistro: 5xx DOPO l elaborazione -> esito incerto, nessun secondo POST, il registro esiste davvero', async () => {
    const client = creaClient()
    await esitoPerso('apri', '5xx', 502)

    const errore = await client.apriRegistro(richiesta, TENANT).catch(e => e)

    expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
    expect(errore).toMatchObject({ causa: 'HTTP_5XX', status: 502 })
    expect(post()).toHaveLength(1)
    const elenco = await client.elencaRegistriSito(OPERATORE, SITO, undefined, TENANT)
    expect(elenco.risultati).toHaveLength(1)
  })

  it('apriRegistro: nessuna risposta (connessione chiusa) -> esito incerto NESSUNA_RISPOSTA, nessun secondo POST', async () => {
    const client = creaClient()
    await esitoPerso('apri', 'timeout')

    const errore = await client.apriRegistro(richiesta, TENANT).catch(e => e)

    expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
    expect(errore.causa).toBe('NESSUNA_RISPOSTA')
    expect(post()).toHaveLength(1)
    expect(
      (await client.elencaRegistriSito(OPERATORE, SITO, undefined, TENANT)).risultati
    ).toHaveLength(1)
  })

  it('apriRegistro: 5xx PRIMA dell elaborazione (guasto) -> comunque incerto e nessun registro creato', async () => {
    const client = creaClient()
    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 503, volte: 1 },
    })

    const errore = await client.apriRegistro(richiesta, TENANT).catch(e => e)

    expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
    expect(post()).toHaveLength(1)
    expect((await client.elencaRegistriSito(OPERATORE, SITO, undefined, TENANT)).risultati).toEqual(
      []
    )
  })

  it('apriRegistro: 423 (richiesta non elaborata) viene ritentato e crea UN solo registro', async () => {
    const client = creaClient()
    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 423, volte: 1 },
    })

    const { identificativo } = await client.apriRegistro(richiesta, TENANT)

    expect(identificativo).toMatch(/^R[0-9A-Z]{10}$/)
    expect(post()).toHaveLength(2)
    expect(
      (await client.elencaRegistriSito(OPERATORE, SITO, undefined, TENANT)).risultati
    ).toHaveLength(1)
  }, 15000)

  it('apriRegistro senza tenant esplicito: errore prima di toccare la rete', async () => {
    const errore = await creaClient()
      .apriRegistro(richiesta, '')
      .catch(e => e)
    expect(errore.message).toContain('tenant')
    expect(chiamateHttp).toHaveLength(0)
  })

  it('elencaRegistriSito: filtri chiuso/identificativo e paginazione applicati dalla fake', async () => {
    const client = creaClient()
    const a = (await client.apriRegistro(richiesta, TENANT)).identificativo
    const b = (await client.apriRegistro(richiesta, TENANT)).identificativo
    await client.chiudiRegistro(a, TENANT)

    const chiusi = await client.elencaRegistriSito(OPERATORE, SITO, { chiuso: true }, TENANT)
    expect(chiusi.risultati.map(r => r.identificativo)).toEqual([a])
    const aperti = await client.elencaRegistriSito(OPERATORE, SITO, { chiuso: false }, TENANT)
    expect(aperti.risultati.map(r => r.identificativo)).toEqual([b])
    const singolo = await client.elencaRegistriSito(OPERATORE, SITO, { identificativo: b }, TENANT)
    expect(singolo.risultati).toHaveLength(1)
    const pagina2 = await client.elencaRegistriSito(
      OPERATORE,
      SITO,
      { paging: { page: 2, pageSize: 1 } },
      TENANT
    )
    expect(pagina2.risultati.map(r => r.identificativo)).toEqual([b])
    expect(pagina2.paging).toMatchObject({
      page: 2,
      pageSize: 1,
      pageCount: 2,
      totalRecordCount: 2,
    })
  })

  it('elencaRegistriSito: 404 su operatore o unità locale inesistenti', async () => {
    const client = creaClient()
    const errore = await client
      .elencaRegistriSito(OPERATORE, 'MI00001234-999', undefined, TENANT)
      .catch(e => e)
    expect(errore).toMatchObject({ status: 404, retryable: false })
  })

  it('dettaglioRegistro: 404 con messaggio dedicato', async () => {
    const errore = await creaClient()
      .dettaglioRegistro('RZZZZZZZZZZ', TENANT)
      .catch(e => e)
    expect(errore).toBeInstanceOf(RentriApiError)
    expect(errore).toMatchObject({ status: 404, problemDetail: 'Registro non trovato' })
  })

  it('modificaRegistro: aggiorna la descrizione; i codici R/D non dichiarati richiedono forza', async () => {
    const client = creaClient()
    const { identificativo } = await client.apriRegistro(richiesta, TENANT)

    await expect(
      client.modificaRegistro(identificativo, { descrizione: 'Nuova descrizione' }, TENANT)
    ).resolves.toEqual({ identificativo })
    expect((await client.dettaglioRegistro(identificativo, TENANT)).descrizione).toBe(
      'Nuova descrizione'
    )

    // registro con Recupero seminato come dal portale
    const r = await app.inject({
      method: 'POST',
      url: '/__controllo/registri/registro',
      payload: { num_iscr_sito: SITO, attivita: ['Recupero'], attivita_rec_smalt: ['R12'] },
    })
    const idRecupero = r.json().identificativo
    const senzaForza = await client
      .modificaRegistro(idRecupero, { attivitaRecSmalt: ['R13'] }, TENANT)
      .catch(e => e)
    expect(senzaForza).toMatchObject({ status: 400, retryable: false })
    await client.modificaRegistro(idRecupero, { attivitaRecSmalt: ['R13'], forza: true }, TENANT)
    expect((await client.dettaglioRegistro(idRecupero, TENANT)).attivita_rec_smalt).toEqual(['R13'])
  })

  it('modificaRegistro: 404 su registro inesistente; 400 su registro chiuso', async () => {
    const client = creaClient()
    expect(
      await client.modificaRegistro('RZZZZZZZZZZ', { descrizione: 'x' }, TENANT).catch(e => e)
    ).toMatchObject({ status: 404 })

    const { identificativo } = await client.apriRegistro(richiesta, TENANT)
    await client.chiudiRegistro(identificativo, TENANT)
    expect(
      await client.modificaRegistro(identificativo, { descrizione: 'x' }, TENANT).catch(e => e)
    ).toMatchObject({ status: 400 })
  })

  it('chiudiRegistro: chiude (data_chiusura valorizzata); una seconda chiusura è un 400 non ritentabile', async () => {
    const client = creaClient()
    const { identificativo } = await client.apriRegistro(richiesta, TENANT)

    await expect(client.chiudiRegistro(identificativo, TENANT)).resolves.toBeUndefined()
    const dettaglio = await client.dettaglioRegistro(identificativo, TENANT)
    expect(dettaglio.stato).toBe('Chiuso')
    expect(dettaglio.data_chiusura).not.toBeNull()
    expect(await client.chiudiRegistro(identificativo, TENANT).catch(e => e)).toMatchObject({
      status: 400,
      retryable: false,
    })
    expect(await client.chiudiRegistro('RZZZZZZZZZZ', TENANT).catch(e => e)).toMatchObject({
      status: 404,
    })
  })

  it('chiudiRegistro: 5xx dopo l elaborazione -> esito incerto senza secondo DELETE; il dettaglio mostra la chiusura', async () => {
    const client = creaClient()
    const { identificativo } = await client.apriRegistro(richiesta, TENANT)
    await esitoPerso('chiudi', '5xx', 504)

    const errore = await client.chiudiRegistro(identificativo, TENANT).catch(e => e)

    expect(errore).toBeInstanceOf(TrasmissioneRentriIncertaError)
    expect(errore).toMatchObject({ causa: 'HTTP_5XX', status: 504 })
    expect(chiamateHttp.filter(c => c.metodo === 'DELETE')).toHaveLength(1)
    expect((await client.dettaglioRegistro(identificativo, TENANT)).stato).toBe('Chiuso')
  })

  it('modificaRegistro: 5xx dopo l elaborazione viene ritentato (PUT idempotente) e alla fine riesce', async () => {
    const client = creaClient()
    const { identificativo } = await client.apriRegistro(richiesta, TENANT)
    await esitoPerso('modifica', '5xx', 503)

    await expect(
      client.modificaRegistro(identificativo, { descrizione: 'Dopo il 5xx' }, TENANT)
    ).resolves.toEqual({ identificativo })
    expect(chiamateHttp.filter(c => c.metodo === 'PUT')).toHaveLength(2)
  }, 15000)

  it('scaricaVidimazioneXml: XML eREGI decodificato, con Id e Reference attesi', async () => {
    const client = creaClient()
    const { identificativo } = await client.apriRegistro(richiesta, TENANT)

    const vidimazione = await client.scaricaVidimazioneXml(identificativo, TENANT)

    expect(vidimazione.mime).toBe('application/xml')
    expect(vidimazione.nomeFile).toContain(identificativo)
    expect(vidimazione.xml).toContain('Id="eREGI-CS-0"')
    expect(vidimazione.xml).toContain('<ds:Reference URI="#eREGI-CS-0">')
    expect(vidimazione.xml).toContain(`<reg:Identificativo>${identificativo}</reg:Identificativo>`)
  })

  it('scaricaVidimazioneXml: 404 su registro inesistente; risposta senza content -> EsitoRentriMalformatoError', async () => {
    const client = creaClient()
    expect(await client.scaricaVidimazioneXml('RZZZZZZZZZZ', TENANT).catch(e => e)).toMatchObject({
      status: 404,
    })
    ;(client as any).get = jest
      .fn()
      .mockResolvedValue({ data: { nome_file: 'x.xml', mime: 'application/xml' } })
    expect(await client.scaricaVidimazioneXml('R1234ABCDEF', TENANT).catch(e => e)).toBeInstanceOf(
      EsitoRentriMalformatoError
    )
  })
})
