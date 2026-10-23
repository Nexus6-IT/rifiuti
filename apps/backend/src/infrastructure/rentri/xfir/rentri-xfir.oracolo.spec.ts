import * as fs from 'fs'
import * as path from 'path'
import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import JSZip from 'jszip'
import { RentriXfirClient } from './rentri-xfir.client'
import { costruisciAsicE, MaterialeFirmaTest } from './costruisci-asice'
import { RentriAuthService } from '../rentri-auth.service'
import { RentriSignatureService } from '../rentri-signature.service'
import { RentriCredentialResolver } from '../rentri-credential.resolver'
import { RentriConfig } from '../rentri-config'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../../tools/rentri-fake/src/app')
const AIUTO_CERTIFICATI = '../../../../../../tools/rentri-fake/test/aiuti/certificati'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest, creaCertificatoAutofirmato } = require(AIUTO_CERTIFICATI)

/**
 * Test di INTEGRAZIONE (oracolo): monta il finto RENTRI in-process
 * (`creaApp()`, stesso pattern di `rentri-api.client.polling-reale.oracolo.spec.ts`)
 * e verifica che `RentriXfirClient`, parlando SOLO la propria API pubblica
 * (mai `app.inject()` diretto a pilotare il ciclo), sappia:
 * 1. validare con successo un xFIR costruito da `costruisciAsicE` (caso
 *    positivo — la PROVA che conta, end-to-end via HTTP);
 * 2. ottenere un esito di errore per un xFIR manomesso dopo la firma (caso
 *    corrotto — stessa garanzia end-to-end lato rifiuto);
 * 3. caricare un xFIR per un formulario specifico e scaricarlo di nuovo.
 *
 * L'operazione di validazione della fake si completa SUBITO (v. commento di
 * `tools/rentri-fake/src/routes/xfir.ts`, `validaEApriTransazione`): non
 * serve alcun timer/completamento manuale come nello spec sorella del
 * polling di `creaFormulario` — qui il primo `/status` e' gia' un 303.
 */
describe('RentriXfirClient — validazione/upload/download xFIR contro la fake (in-process)', () => {
  let app: any

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  function materialeFirmaDiTest(): MaterialeFirmaTest {
    const cert = creaCertificatoAutofirmato('operatore-xfir-oracolo')
    return {
      certificatoPem: `-----BEGIN CERTIFICATE-----\n${cert.certificatoBase64Der}\n-----END CERTIFICATE-----`,
      chiavePrivataPem: cert.chiavePrivataPem,
    }
  }

  function creaClient(): RentriXfirClient {
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

    // Ogni azienda del test ha un certificato proprio (uguale a quello di prova): la
    // credenziale env e' legata a una sola azienda (RENTRI_ENV_TENANT_ID).
    const credentialService = {
      getForTenant: jest.fn().mockResolvedValue({
        clientId: config.clientId,
        certificatePem: config.certificatePem,
        privateKeyPem: config.privateKeyPem,
        algorithm: config.algorithm,
        environment: 'demo',
      }),
    }
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
    const credentialResolver = new RentriCredentialResolver(credentialService as any, config)
    const signature = new RentriSignatureService(config, credentialResolver)
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }

    // Stesso adattatore in-process di rentri-api.client.polling-reale.oracolo.spec.ts:
    // risolve sempre l'observable (mai un errore) cosi' il client puo' usare
    // `validateStatus: () => true` per distinguere 200/303/400 come dati.
    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const path = new URL(url).pathname
          app
            .inject({ method: 'POST', url: path, headers: opts.headers, payload: body as any })
            .then((risposta: any) => {
              subscriber.next(adattaRisposta(risposta))
              subscriber.complete()
            })
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: (url: string, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          const target = new URL(url)
          app
            .inject({
              method: 'GET',
              url: `${target.pathname}${target.search}`,
              headers: opts.headers,
            })
            .then((risposta: any) => {
              subscriber.next(adattaRisposta(risposta))
              subscriber.complete()
            })
            .catch((errore: unknown) => subscriber.error(errore))
        }),
    }

    return new RentriXfirClient(httpService, logger, metrics, config, auth, signature)
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

  it('valida con successo un xFIR costruito da costruisciAsicE (caso positivo, end-to-end via HTTP)', async () => {
    const client = creaClient()
    const buffer = await costruisciAsicE({
      documenti: [{ nome: 'formulario.xml', contenuto: '<formulario numeroFir="BCDF123456B"/>' }],
      firma: materialeFirmaDiTest(),
    })

    const { transazioneId } = await client.validaXfir('operatore-test', buffer.toString('base64'))
    const esito = await client.attendiEsitoValidazione('operatore-test', transazioneId, {
      intervalloMs: 20,
      maxTentativi: 10,
    })

    expect(esito.errore).toBe(false)
    expect(esito.validazione ?? []).toEqual([])
  })

  it('xFIR firmato con certificato EC P-256 (ecdsa-sha256, P1363): validato dal vero validatore del finto', async () => {
    const dir = path.resolve(__dirname, '../../../../../../tools/rentri-fake/test/fixture/ec')
    const client = creaClient()
    const buffer = await costruisciAsicE({
      documenti: [{ nome: 'formulario.xml', contenuto: '<formulario numeroFir="BCDF111111B"/>' }],
      firma: {
        certificatoPem: fs.readFileSync(path.join(dir, 'operatore-test-ec.crt'), 'utf8'),
        chiavePrivataPem: fs.readFileSync(path.join(dir, 'operatore-test-ec.key'), 'utf8'),
      },
    })

    const { transazioneId } = await client.validaXfir('operatore-test', buffer.toString('base64'))
    const esito = await client.attendiEsitoValidazione('operatore-test', transazioneId, {
      intervalloMs: 20,
      maxTentativi: 10,
    })

    expect(esito.errore).toBe(false)
    expect(esito.validazione ?? []).toEqual([])
  })

  it('CASO CORROTTO: un xFIR manomesso dopo la firma produce un esito di errore end-to-end', async () => {
    const client = creaClient()
    const buffer = await costruisciAsicE({
      documenti: [{ nome: 'formulario.xml', contenuto: '<formulario numeroFir="BCDF654321B"/>' }],
      firma: materialeFirmaDiTest(),
    })

    const zip = await JSZip.loadAsync(buffer)
    zip.file('formulario.xml', '<formulario numeroFir="MANOMESSO" />')
    const corrotto = await zip.generateAsync({ type: 'nodebuffer' })

    const { transazioneId } = await client.validaXfir('operatore-test', corrotto.toString('base64'))
    const esito = await client.attendiEsitoValidazione('operatore-test', transazioneId, {
      intervalloMs: 20,
      maxTentativi: 10,
    })

    expect(esito.errore).toBe(true)
    expect(esito.validazione?.[0]?.codice_messaggio).toMatch(/DigestValue non corrispondente/)
  })

  it('carica un xFIR valido per un formulario specifico (POST /{numero_fir}/xfir, stesso ciclo NONBLOCK_PULL)', async () => {
    const client = creaClient()
    const buffer = await costruisciAsicE({
      documenti: [{ nome: 'formulario.xml', contenuto: '<formulario numeroFir="BCDF111111B"/>' }],
      firma: materialeFirmaDiTest(),
    })
    const xfirBase64 = buffer.toString('base64')

    const { transazioneId } = await client.caricaXfir(
      'operatore-test',
      'BCDF111111B',
      'OP0001ABC123456-XX0001',
      xfirBase64
    )
    const esito = await client.attendiEsitoValidazione('operatore-test', transazioneId, {
      intervalloMs: 20,
      maxTentativi: 10,
    })

    expect(esito.errore).toBe(false)

    // `scaricaXfir` (GET /{numero_fir}/xfir) NON e' verificabile qui: il finto
    // NON implementa questa rotta (verificato leggendo
    // `tools/rentri-fake/src/routes/xfir.ts` — registra solo le due `POST` —
    // e `src/routes/formulari.ts`, che non la registra nemmeno lei). E' un
    // limite noto della fake, non di questo client: `scaricaXfir` segue lo
    // stesso schema sincrono gia' verificato per `scaricaAllegato`/`scaricaPdf`
    // in `RENTRIApiClient` (stesso `DownloadableBaseResponse`), ma non ha qui
    // un oracolo contro cui dimostrarsi end-to-end.
  })

  it('rifiuta caricaXfir senza num_iscr_sito o xfir, senza contattare la fake', async () => {
    const client = creaClient()
    await expect(
      client.caricaXfir('operatore-test', 'BCDF111111B', '', 'contenuto')
    ).rejects.toThrow(/obbligatori/)
    await expect(
      client.caricaXfir('operatore-test', 'BCDF111111B', 'OP0001ABC123456-XX0001', '')
    ).rejects.toThrow(/obbligatori/)
  })
})
