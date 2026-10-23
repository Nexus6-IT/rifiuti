import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RentriCopieClient } from './rentri-copie.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriConfig } from './rentri-config'
import { RentriApiError } from './rentri-http-resilienza'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')

/**
 * Verifica "oracolo": `RentriCopieClient` contro la fake fedele al contratto
 * ufficiale (`tools/rentri-fake`), montata in-process con `creaApp()` —
 * stessa strategia di `rentri-trasmissioni.oracolo.spec.ts`.
 *
 * Copre i gruppi "Copia FIR digitale" (formulari.yaml righe 3628-4451) e
 * "Copia FIR cartaceo" (righe 2898-3627): caricamento (ASYNC, ciclo
 * NONBLOCK_PULL canonico), elenco/dettaglio/documento, cancellazione e
 * conferma. I path deprecati (`/copia-{cartacea,digitale}/{transazione_id}/...`)
 * restano fuori dall'ambito di `RentriCopieClient` (v. suo commento di
 * testata), quindi non hanno una controparte qui.
 *
 * Priorita' dichiarata: la copia DIGITALE e' coperta per intero (l'unica
 * obbligatoria dopo il 15/09/2026); la cartacea copre il percorso
 * caricamento -> elenco -> conferma, senza duplicare ogni ramo di errore
 * gia' verificato lato fake in `tools/rentri-fake/test/copie.test.ts`.
 */
describe('RentriCopieClient — contro la fake RENTRI (in-process)', () => {
  let app: any

  const NUMERO_FIR = 'TSTB12345XY'
  const NUM_ISCR_SITO_DESTINATARIO = 'OP1234ABC000002-AB0002'
  const NUM_ISCR_SITO_TRASPORTATORE = 'OP1234ABC000003-AB0003'
  const PRODUTTORE_CF = 'RSSMRA80A01F205X'

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  function creaClient(): RentriCopieClient {
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
      put: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        inietta('PUT', url, opts.headers, body),
      delete: (url: string, opts: { headers: Record<string, string> }) =>
        inietta('DELETE', url, opts.headers),
    }

    return new RentriCopieClient(httpService, logger, metrics, config, auth, signature as any)
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

  async function seminaFormularioConProduttore(produttore: string): Promise<void> {
    await app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: { numero_fir: NUMERO_FIR, stato: 'Accettato', produttore },
    })
  }

  function corpoCopiaCartaceaValida(): {
    file_content: string
    nome_file: string
    mime: string
    numero_fir: string
    data_emissione: string
    produttore: { codice_fiscale: string; denominazione: string }
  } {
    return {
      file_content: Buffer.from('contenuto-pdf-di-prova').toString('base64'),
      nome_file: 'copia-fir.pdf',
      mime: 'application/pdf',
      numero_fir: NUMERO_FIR,
      data_emissione: '2026-09-01T10:00:00Z',
      produttore: { codice_fiscale: PRODUTTORE_CF, denominazione: 'Produttore Ambiente S.r.l.' },
    }
  }

  // ---- Copia digitale -------------------------------------------------------

  describe('copia digitale', () => {
    it('caricaCopiaDigitale + attendiEsitoCaricamento: attraversa 202 -> "in elaborazione" -> completamento', async () => {
      await seminaFormularioConProduttore(PRODUTTORE_CF)
      const client = creaClient()
      const httpServiceConPolling: any = (client as any).httpService
      // Il polling usa `validateStatus: () => true` e non deve mai lanciare
      // un'eccezione: stessa sostituzione "always resolve" gia' vista in
      // `rentri-trasmissioni.oracolo.spec.ts`.
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

      const { transazioneId } = await client.caricaCopiaDigitale(
        NUMERO_FIR,
        NUM_ISCR_SITO_DESTINATARIO,
        Buffer.from('contenuto-xfir-di-prova').toString('base64')
      )
      expect(transazioneId).toMatch(/^[0-9a-f-]{36}$/i)

      setTimeout(() => {
        void app.inject({
          method: 'POST',
          url: '/__controllo/completa-transazione',
          payload: { transazione_id: transazioneId, errore: false, validazione: [] },
        })
      }, 150)

      const esito = await client.attendiEsitoCaricamento(transazioneId, {
        intervalloMs: 50,
        maxTentativi: 20,
      })
      expect(esito).toEqual({ transazione_id: transazioneId, errore: false, validazione: [] })

      // La copia e' gia' consultabile (v. divergenza dichiarata in
      // `routes/copie.ts`): il dettaglio riporta il produttore risolto dal
      // formulario seminato sopra.
      const dettaglio = await client.dettaglioCopiaDigitaleCaricata(
        NUM_ISCR_SITO_DESTINATARIO,
        transazioneId
      )
      expect(dettaglio.numero_fir).toBe(NUMERO_FIR)
      expect(dettaglio.produttore?.codice_fiscale).toBe(PRODUTTORE_CF)
    }, 15000)

    it('caricaCopiaDigitale rifiuta un corpo non conforme a CopiaDigitaleModel: 400 propagato come eccezione', async () => {
      const client = creaClient()

      await expect(
        client.caricaCopiaDigitale(NUMERO_FIR, 'non-un-num-iscr-sito', 'YQ==')
      ).rejects.toThrow(/HTTP 400/)
    })

    it('elencaCopieDigitaliCaricate: trova la copia appena caricata', async () => {
      const client = creaClient()

      await client.caricaCopiaDigitale(
        NUMERO_FIR,
        NUM_ISCR_SITO_DESTINATARIO,
        Buffer.from('altro-xfir').toString('base64')
      )

      const elenco = await client.elencaCopieDigitaliCaricate(NUM_ISCR_SITO_DESTINATARIO)
      expect(elenco.risultati.length).toBeGreaterThanOrEqual(1)
      expect(elenco.paging.totalRecordCount).toBeGreaterThanOrEqual(1)
    })

    it('dettaglioCopiaDigitaleCaricata: 404 (RentriApiError) per un identificativo inesistente', async () => {
      const client = creaClient()

      await expect(
        client.dettaglioCopiaDigitaleCaricata(
          NUM_ISCR_SITO_DESTINATARIO,
          '00000000-0000-0000-0000-000000000000'
        )
      ).rejects.toBeInstanceOf(RentriApiError)
    })

    it('documentoCopiaDigitaleCaricata: restituisce il contenuto xfir caricato', async () => {
      const client = creaClient()
      const xfirBase64 = Buffer.from('xfir-unico-per-documento').toString('base64')

      const { transazioneId } = await client.caricaCopiaDigitale(
        NUMERO_FIR,
        NUM_ISCR_SITO_DESTINATARIO,
        xfirBase64
      )

      const documento = await client.documentoCopiaDigitaleCaricata(
        NUM_ISCR_SITO_DESTINATARIO,
        transazioneId
      )
      expect(documento?.content).toBe(xfirBase64)
    })

    it('confermaCopiaDigitale + elencaCopieDigitaliPerSoggetto: la copia risulta confermata per il produttore', async () => {
      await seminaFormularioConProduttore(PRODUTTORE_CF)
      const client = creaClient()

      const { transazioneId } = await client.caricaCopiaDigitale(
        NUMERO_FIR,
        NUM_ISCR_SITO_DESTINATARIO,
        Buffer.from('xfir-conferma').toString('base64')
      )

      await client.confermaCopiaDigitale('OP0000AAA000000-AA0000', transazioneId, {
        ruolo: 'Produttore',
      })

      const elenco = await client.elencaCopieDigitaliPerSoggetto(PRODUTTORE_CF, {
        confermate: true,
      })
      expect(elenco.risultati.map(r => r.identificativo)).toContain(transazioneId)
    })

    it('eliminaCopiaDigitaleCaricata: 204, poi il dettaglio risponde 404', async () => {
      const client = creaClient()

      const { transazioneId } = await client.caricaCopiaDigitale(
        NUMERO_FIR,
        NUM_ISCR_SITO_DESTINATARIO,
        Buffer.from('xfir-da-cancellare').toString('base64')
      )

      await client.eliminaCopiaDigitaleCaricata(NUM_ISCR_SITO_DESTINATARIO, transazioneId)

      await expect(
        client.dettaglioCopiaDigitaleCaricata(NUM_ISCR_SITO_DESTINATARIO, transazioneId)
      ).rejects.toBeInstanceOf(RentriApiError)
    })
  })

  // ---- Copia cartacea --------------------------------------------------------

  describe('copia cartacea', () => {
    it('caricaCopiaCartacea: 202, poi leggibile da elencaCopieCartaceeCaricate e dettaglioCopiaCartaceaCaricata', async () => {
      const client = creaClient()

      const { transazioneId } = await client.caricaCopiaCartacea(
        NUM_ISCR_SITO_TRASPORTATORE,
        corpoCopiaCartaceaValida()
      )
      expect(transazioneId).toMatch(/^[0-9a-f-]{36}$/i)

      const elenco = await client.elencaCopieCartaceeCaricate(NUM_ISCR_SITO_TRASPORTATORE)
      expect(elenco.risultati.map(r => r.identificativo)).toContain(transazioneId)

      const dettaglio = await client.dettaglioCopiaCartaceaCaricata(
        NUM_ISCR_SITO_TRASPORTATORE,
        transazioneId
      )
      expect(dettaglio.numero_fir).toBe(NUMERO_FIR)
      expect(dettaglio.produttore?.codice_fiscale).toBe(PRODUTTORE_CF)
    })

    it('caricaCopiaCartacea rifiuta un corpo non conforme a CopiaCartaceaModel: 400 propagato come eccezione', async () => {
      const client = creaClient()
      const corpo = corpoCopiaCartaceaValida()
      delete (corpo as any).produttore

      await expect(
        client.caricaCopiaCartacea(NUM_ISCR_SITO_TRASPORTATORE, corpo as any)
      ).rejects.toThrow(/HTTP 400/)
    })

    it('confermaCopiaCartacea + elencaCopieCartaceePerSoggetto: la copia risulta confermata per il produttore', async () => {
      const client = creaClient()

      const { transazioneId } = await client.caricaCopiaCartacea(
        NUM_ISCR_SITO_TRASPORTATORE,
        corpoCopiaCartaceaValida()
      )

      await client.confermaCopiaCartacea(PRODUTTORE_CF, {
        identificativo: transazioneId,
        ruolo: 'Produttore',
      })

      const elenco = await client.elencaCopieCartaceePerSoggetto(PRODUTTORE_CF, {
        confermate: true,
      })
      expect(elenco.risultati.map(r => r.identificativo)).toContain(transazioneId)
    })

    it('confermaCopiaCartacea per un soggetto non pertinente: 404 (RentriApiError)', async () => {
      const client = creaClient()

      const { transazioneId } = await client.caricaCopiaCartacea(
        NUM_ISCR_SITO_TRASPORTATORE,
        corpoCopiaCartaceaValida()
      )

      await expect(
        client.confermaCopiaCartacea('UNALTROCF00X000Y', { identificativo: transazioneId })
      ).rejects.toBeInstanceOf(RentriApiError)
    })
  })
})
