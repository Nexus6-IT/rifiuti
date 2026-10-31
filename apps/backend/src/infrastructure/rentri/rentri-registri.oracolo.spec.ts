import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriRegistriClient } from './rentri-registri.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { RentriApiError } from './rentri-http-resilienza'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Verifica "oracolo": `RentriRegistriClient` contro la fake fedele al
 * contratto ufficiale `dati-registri.yaml` (`tools/rentri-fake`), montata
 * in-process con `creaApp()` — stessa strategia di
 * `rentri-trasmissioni.oracolo.spec.ts`: nessun mock della forma della
 * risposta, solo un adattatore `HttpService -> app.inject()`.
 *
 * Copre le priorita' del task, nell'ordine: trasmissione dei movimenti col
 * suo ciclo NONBLOCK_PULL, lettura (elenco/dettaglio/conteggio), `valida`,
 * rettifica/annullamento (riusano lo stesso `POST .../movimenti`).
 */
describe('RentriRegistriClient — contro la fake RENTRI (in-process)', () => {
  let app: any

  const REGISTRO = 'R1234ABCDEF'
  // Stringa vuota: il resolver ricade sulla credenziale da env (pilota single-operator), come prima.
  const TENANT = ''

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  async function apriRegistro(identificativoRegistro = REGISTRO): Promise<void> {
    await app.inject({
      method: 'POST',
      url: '/__controllo/dati-registri/registro',
      payload: { identificativo_registro: identificativoRegistro },
    })
  }

  async function completaTransazione(transazioneId: string, extra: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST',
      url: '/__controllo/dati-registri/completa-transazione',
      payload: { transazione_id: transazioneId, errore: false, validazione: [], ...extra },
    })
  }

  function movimentoValido(anno: number, progressivo: number): Record<string, unknown> {
    return {
      riferimenti: {
        numero_registrazione: { anno, progressivo },
        data_ora_registrazione: '2026-01-10T08:00:00Z',
        causale_operazione: 'DT',
      },
      rifiuto: {
        codice_eer: '200101',
        stato_fisico: 'S',
        quantita: { valore: 10, unita_misura: 'kg' },
      },
      produttore: {
        denominazione: 'Produttore di prova',
        indirizzo: { citta: { comune_id: '058091' }, indirizzo: 'Via di prova 1' },
      },
    }
  }

  function creaClient(): RentriRegistriClient {
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
    }

    return new RentriRegistriClient(httpService, logger, metrics, config, auth, signature as any)
  }

  function inietta(
    method: string,
    url: string,
    headers: Record<string, string>,
    payload?: unknown
  ): Observable<AxiosResponse> {
    return new Observable<AxiosResponse>(subscriber => {
      const analizzato = new URL(url)
      const path = `${analizzato.pathname}${analizzato.search}`
      app
        .inject({ method, url: path, headers, payload: payload as any })
        .then((risposta: any) => {
          const status = risposta.statusCode
          const adattata = adattaRisposta(risposta)
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

  /**
   * Il polling di `attendiEsito` usa `validateStatus: () => true` e non deve
   * MAI lanciare un'eccezione su 200/303/400 (v. `interrogaStatoTransazione`/
   * `leggiEsitoTransazione`): l'adattatore `inietta` sopra la solleva su ogni
   * risposta non-2xx, quindi qui si sostituisce `get` con una versione
   * "always resolve" — stesso principio di
   * `rentri-trasmissioni.oracolo.spec.ts`.
   */
  function abilitaPollingSempreRisolve(client: RentriRegistriClient): void {
    ;(client as any).httpService.get = (url: string, opts: { headers: Record<string, string> }) =>
      new Observable<AxiosResponse>(subscriber => {
        const analizzato = new URL(url)
        const path = `${analizzato.pathname}${analizzato.search}`
        app
          .inject({ method: 'GET', url: path, headers: opts.headers })
          .then((risposta: any) => {
            subscriber.next(adattaRisposta(risposta))
            subscriber.complete()
          })
          .catch((errore: unknown) => subscriber.error(errore))
      })
  }

  it('inviaMovimenti: 202 e transazioneId', async () => {
    const client = creaClient()
    await apriRegistro()

    const { transazioneId } = await client.inviaMovimenti(
      REGISTRO,
      [movimentoValido(2026, 1)],
      TENANT
    )

    expect(transazioneId).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('inviaMovimenti rifiuta un corpo non conforme: propaga come RentriApiError HTTP 400', async () => {
    const client = creaClient()
    await apriRegistro()

    const errore = await client.inviaMovimenti(REGISTRO, [{}], TENANT).catch(e => e)
    expect(errore).toBeInstanceOf(RentriApiError)
    expect(errore.status).toBe(400)
    expect(errore.retryable).toBe(false)
  })

  it('inviaMovimenti su un registro mai aperto: RentriApiError 404', async () => {
    const client = creaClient()

    await expect(
      client.inviaMovimenti('R0000000000', [movimentoValido(2026, 1)], TENANT)
    ).rejects.toBeInstanceOf(RentriApiError)
  })

  it('attendiEsito: attraversa 202 -> 200 ("in elaborazione") -> 303 -> /result, e la registrazione diventa leggibile', async () => {
    const client = creaClient()
    abilitaPollingSempreRisolve(client)
    await apriRegistro()

    const { transazioneId } = await client.inviaMovimenti(
      REGISTRO,
      [movimentoValido(2026, 10)],
      TENANT
    )

    setTimeout(() => {
      void completaTransazione(transazioneId)
    }, 150)

    const esito: any = await client.attendiEsito(transazioneId, {
      intervalloMs: 50,
      maxTentativi: 20,
    })

    expect(esito.errore).toBe(false)
    expect(esito.esito.numero_registrazioni).toHaveLength(1)
    const identificativo = esito.esito.numero_registrazioni[0].identificativo
    expect(identificativo).toMatch(/^M[0-9A-Z]{19}$/)

    const dettaglio = await client.dettaglioMovimentoPerAnnoProgressivo(REGISTRO, 2026, 10)
    expect(dettaglio.riferimenti?.numero_registrazione?.identificativo).toBe(identificativo)
    expect(dettaglio.rifiuto?.codice_eer).toBe('200101')

    const dettaglioPerId = await client.dettaglioMovimentoPerIdentificativo(
      REGISTRO,
      identificativo
    )
    expect(dettaglioPerId.riferimenti?.numero_registrazione?.anno).toBe(2026)
  }, 15000)

  it('elencaMovimenti + contaMovimenti: trovano la registrazione appena trasmessa, filtrando per anno/progressivo', async () => {
    const client = creaClient()
    await apriRegistro()

    const invio = await client.inviaMovimenti(REGISTRO, [movimentoValido(2026, 20)], TENANT)
    await completaTransazione(invio.transazioneId)

    const elenco = await client.elencaMovimenti(REGISTRO, { anno: 2026, progressivo: 20 })
    expect(elenco.risultati).toHaveLength(1)
    expect(elenco.paging.totalRecordCount).toBe(1)

    const conteggio = await client.contaMovimenti(REGISTRO, { anno: 2026, progressivo: 20 })
    expect(conteggio).toBe(1)
  })

  it('dettaglioMovimentoPerAnnoProgressivo: RentriApiError 404 per una registrazione inesistente', async () => {
    const client = creaClient()
    await apriRegistro()

    await expect(
      client.dettaglioMovimentoPerAnnoProgressivo(REGISTRO, 1999, 1)
    ).rejects.toBeInstanceOf(RentriApiError)
  })

  it('una rettifica (numero_registrazione_rettifica) marca la registrazione originale come rettificata', async () => {
    const client = creaClient()
    await apriRegistro()

    const invioOriginale = await client.inviaMovimenti(
      REGISTRO,
      [movimentoValido(2026, 30)],
      TENANT
    )
    await completaTransazione(invioOriginale.transazioneId)

    const rettifica = movimentoValido(2026, 31)
    ;(rettifica.riferimenti as Record<string, unknown>).numero_registrazione_rettifica = {
      anno: 2026,
      progressivo: 30,
    }
    const invioRettifica = await client.inviaMovimenti(REGISTRO, [rettifica], TENANT)
    await completaTransazione(invioRettifica.transazioneId)

    const dettaglio = await client.dettaglioMovimentoPerAnnoProgressivo(REGISTRO, 2026, 30)
    expect(dettaglio.rettificato).toBe(true)
    expect(dettaglio.variazioni).toHaveLength(1)
  })

  it('un AnnullamentoMovimentoModel marca la registrazione originale come annullata', async () => {
    const client = creaClient()
    await apriRegistro()

    const invioOriginale = await client.inviaMovimenti(
      REGISTRO,
      [movimentoValido(2026, 40)],
      TENANT
    )
    await completaTransazione(invioOriginale.transazioneId)

    const annullamento = {
      numero_registrazione: { anno: 2026, progressivo: 41 },
      numero_registrazione_annullata: { anno: 2026, progressivo: 40 },
      data_ora_registrazione: '2026-01-12T08:00:00Z',
      annotazioni: 'Registrazione errata',
    }
    const invioAnnullamento = await client.inviaMovimenti(REGISTRO, [annullamento], TENANT)
    await completaTransazione(invioAnnullamento.transazioneId)

    const dettaglio = await client.dettaglioMovimentoPerAnnoProgressivo(REGISTRO, 2026, 40)
    expect(dettaglio.annullato).toBe(true)
  })

  it('validaRegistro: 202, ciclo completabile con un esito EsitoValidaRegistroModel arbitrario', async () => {
    const client = creaClient()
    abilitaPollingSempreRisolve(client)
    await apriRegistro()

    const { transazioneId } = await client.validaRegistro(REGISTRO, {
      fileContentBase64: Buffer.from('<registro></registro>').toString('base64'),
      nomeFile: 'registro.xml',
      mime: 'application/xml',
    })
    expect(transazioneId).toMatch(/^[0-9a-f-]{36}$/i)

    setTimeout(() => {
      void completaTransazione(transazioneId, {
        esito: { identificativo_registro: REGISTRO, numero_registrazioni_file: 3 },
      })
    }, 150)

    const esito: any = await client.attendiEsito(transazioneId, {
      intervalloMs: 50,
      maxTentativi: 20,
    })
    expect(esito.esito.numero_registrazioni_file).toBe(3)
  }, 15000)

  it('invio, polling e lettura degli identificativi contro la fake', async () => {
    const client = creaClient()
    abilitaPollingSempreRisolve(client)
    await apriRegistro()

    const { transazioneId } = await client.inviaMovimenti(
      REGISTRO,
      [movimentoValido(2026, 50), movimentoValido(2026, 51)],
      TENANT
    )
    setTimeout(() => {
      void completaTransazione(transazioneId)
    }, 100)

    const esito = await client.attendiEsitoMovimenti(transazioneId, TENANT, {
      intervalloMs: 50,
      maxTentativi: 40,
    })

    expect(esito.errore).toBe(false)
    expect(esito.numeroRegistrazioni.map(r => [r.anno, r.progressivo])).toEqual([
      [2026, 50],
      [2026, 51],
    ])
    for (const r of esito.numeroRegistrazioni) {
      expect(r.identificativo).toMatch(/^M[0-9A-Z]{19}$/)
    }
  }, 15000)

  it('esito con errore: numeroRegistrazioni vuoto e messaggi con indice', async () => {
    const client = creaClient()
    abilitaPollingSempreRisolve(client)
    await apriRegistro()

    const { transazioneId } = await client.inviaMovimenti(
      REGISTRO,
      [movimentoValido(2026, 60), movimentoValido(2026, 61)],
      TENANT
    )
    setTimeout(() => {
      void completaTransazione(transazioneId, {
        errore: true,
        validazione: [
          { indice: 1, campo: 'rifiuto.quantita', tipo: 'Errore', codice_messaggio: 'E123' },
          { indice: null, campo: null, tipo: 'Avvertimento' },
        ],
      })
    }, 100)

    const esito = await client.attendiEsitoMovimenti(transazioneId, TENANT, {
      intervalloMs: 50,
      maxTentativi: 40,
    })

    expect(esito.errore).toBe(true)
    expect(esito.numeroRegistrazioni).toEqual([])
    expect(esito.validazione).toEqual([
      { indice: 1, campo: 'rifiuto.quantita', tipo: 'Errore', codice: 'E123' },
      { indice: null, campo: null, tipo: 'Avvertimento', codice: null },
    ])
  }, 15000)

  it('ultimaTransazioneId: null se non e mai stata inviata alcuna trasmissione, poi il transazione_id dopo un invio', async () => {
    const client = creaClient()
    const registroVergine = 'R0000000001'
    await apriRegistro(registroVergine)

    expect(await client.ultimaTransazioneId(registroVergine)).toBeNull()

    const { transazioneId } = await client.inviaMovimenti(
      registroVergine,
      [movimentoValido(2026, 1)],
      TENANT
    )

    expect(await client.ultimaTransazioneId(registroVergine)).toBe(transazioneId)
  })
})
