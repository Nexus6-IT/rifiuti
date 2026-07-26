import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriCodificheClient } from './rentri-codifiche.client'
import { RentriApiError } from '../rentri-http-resilienza'
import { RentriAuthService } from '../rentri-auth.service'
import { RentriConfig } from '../rentri-config'
import { NOME_TABELLE_CODIFICHE_SEMPLICI } from './rentri-codifiche.model'
/* eslint-disable @typescript-eslint/no-var-requires */
const { creaApp } = require('../../../../../../tools/rentri-fake/src/app')
const {
  creaCertificatoDiTest,
} = require('../../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Verifica REALE (non mockata) di {@link RentriCodificheClient} contro la
 * fake fedele al contratto RENTRI (`tools/rentri-fake`, Task 1 di R4):
 * dimostra che il client parla correttamente il servizio `codifiche`
 * (`/codifiche/v1.0/lookup/*`, `/status`) — filtri di `codici-eer` e
 * `comuni/{provincia_id}` compresi — e che la strategia di rate-limiting
 * (concorrenza 1 + pausa 250ms, v. `rentri-codifiche.client.ts`) e la
 * resilienza (403/429/423) si comportano come nella verifica unitaria, ma
 * qui contro il vero codice di rotta della fake, non un doppio.
 *
 * Istanziato IN-PROCESS con `creaApp()` + `app.inject()`, stesso motivo di
 * `rentri-api.client.oracolo.spec.ts`: la CA di prova della fake è
 * memoizzata per processo.
 */
describe('RentriCodificheClient — verifica reale contro la fake RENTRI (in-process)', () => {
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

  function creaClient(): RentriCodificheClient {
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
    const metrics: any = { rentriApiErrors: { inc: jest.fn() } }

    // httpService reale sostituito da un adattatore su app.inject(): esegue
    // il vero handler di rotta della fake (autenticazione compresa). Replica
    // la semantica di axios: uno status >= 400 fa fallire l'observable con
    // un errore che porta `error.response` (stesso adattatore di
    // `rentri-api.client.resilienza.oracolo.spec.ts`).
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

    return new RentriCodificheClient(httpService, logger, metrics, config, auth)
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

  it('leggiTabella: GET /lookup/materiali reale, restituisce il catalogo della fixture', async () => {
    const client = creaClient()

    const materiali = await client.leggiTabella('materiali', '')

    expect(materiali.length).toBeGreaterThan(0)
    expect(materiali.some((m: any) => m.code === 'FE')).toBe(true)
  })

  it('codiciEer: pericoloso=true restituisce solo codici pericolosi reali', async () => {
    const client = creaClient()

    const pericolosi = await client.codiciEer({ pericoloso: true }, '')

    expect(pericolosi.length).toBeGreaterThan(0)
    expect(pericolosi.every((c: any) => c.properties.pericoloso === true)).toBe(true)
  })

  it('codiciEer: escludi00=true esclude le voci di capitolo (130000)', async () => {
    const client = creaClient()

    const tutti = await client.codiciEer(undefined, '')
    expect(tutti.some((c: any) => c.code === '130000')).toBe(true)

    const senzaCapitolo = await client.codiciEer({ escludi00: true }, '')
    expect(senzaCapitolo.some((c: any) => c.code === '130000')).toBe(false)
  })

  it('comuni: include il comune soppresso (fusione comunale) con nuovo-id e fine-validita valorizzati', async () => {
    const client = creaClient()

    const comuni = await client.comuni('')

    const soppresso = comuni.find((c: any) => c.properties.attivo === false)
    expect(soppresso).toBeDefined()
    expect((soppresso as any).properties['nuovo-id']).not.toBeNull()
    expect((soppresso as any).properties['fine-validita']).not.toBeNull()
  })

  it('comuniProvincia: attivi=true (default) esclude il comune soppresso della provincia', async () => {
    const client = creaClient()

    const comuni = await client.comuniProvincia('048', undefined, '')

    expect(comuni.every((c: any) => c.properties.attivo === true)).toBe(true)
    expect(comuni.some((c: any) => c.name === 'Scarperia e San Piero')).toBe(true)
  })

  it('comuniProvincia: attivi=false restituisce anche il comune soppresso', async () => {
    const client = creaClient()

    const comuni = await client.comuniProvincia('048', { attivi: false }, '')

    expect(comuni.some((c: any) => c.name === 'San Piero a Sieve')).toBe(true)
  })

  it('stato: GET /status reale, nessuna autenticazione, riporta Ok', async () => {
    const client = creaClient()

    const stato = await client.stato()

    expect(stato.status).toBe('Ok')
  })

  it('scaricaTutte: scarica in sequenza tutte le 23 tabelle reali (21 semplici + codici-eer + comuni)', async () => {
    const client = creaClient()

    const tabelle = await client.scaricaTutte('')

    expect(tabelle.size).toBe(NOME_TABELLE_CODIFICHE_SEMPLICI.length + 2)
    for (const nomeTabella of NOME_TABELLE_CODIFICHE_SEMPLICI) {
      expect(tabelle.get(nomeTabella)?.length).toBeGreaterThan(0)
    }
    expect(tabelle.get('codici-eer')?.length).toBeGreaterThan(0)
    expect(tabelle.get('comuni')?.length).toBeGreaterThan(0)
    // /lookup/codici-eer è chiamato con escludi00=false esplicito (v. commento
    // di scaricaTutte): la voce di capitolo deve essere presente.
    expect(tabelle.get('codici-eer')?.some((c: any) => c.code === '130000')).toBe(true)
  }, 15000) // Real wait: 22 pause di 250ms tra le 23 chiamate (~5.5s) + latenza reale.

  it('429 iniettato dal canale di controllo: ritenta rispettando Retry-After e alla fine riesce', async () => {
    const client = creaClient()
    await impostaGuasto(429, 1)

    const risultato = await client.leggiTabella('regioni', '')

    expect(risultato.length).toBeGreaterThan(0)
  }, 15000) // Retry-After fisso della fake = 5s (v. tools/rentri-fake/src/app.ts).

  it('423 (ban del chiamante) iniettato: ritenta con backoff esponenziale e alla fine riesce', async () => {
    const client = creaClient()
    await impostaGuasto(423, 1)

    const risultato = await client.leggiTabella('nazioni', '')

    expect(risultato.length).toBeGreaterThan(0)
  }, 10000)

  it('403 iniettato: NON ritenta, fallisce subito con esito definitivo (RentriApiError, retryable=false)', async () => {
    const client = creaClient()
    await impostaGuasto(403, 1)

    const spia = jest.spyOn(app.archivio, 'guastoAttivo')

    let erroreCatturato: unknown
    let sollevato = false
    try {
      await client.leggiTabella('provenienza', '')
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
