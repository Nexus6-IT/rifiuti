import * as fs from 'fs'
import * as path from 'path'
import { Observable } from 'rxjs'
import { AxiosResponse } from 'axios'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriSignatureService } from './rentri-signature.service'
import { RentriConfig } from './rentri-config'
import { parsePkcs12 } from './rentri-pkcs12.util'
import { algoritmoDaChiave } from './certificato/algoritmo-da-chiave'
import { corpoFormularioValido } from '../../application/rentri/mappatura/aiuti-test'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaApp } = require('../../../../../tools/rentri-fake/src/app')
// jose sta solo tra le dipendenze del finto: lo si usa da li' per la verifica crittografica.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { compactVerify, importX509 } = require('../../../../../tools/rentri-fake/node_modules/jose')

/**
 * Pezzo 4, Task 3: prova end-to-end con certificato EC. Il .p12 EC P-256 di
 * fixture (emesso dalla CA di prova fissa, di cui il simulatore si fida) passa
 * per parsePkcs12 e algoritmoDaChiave; il client firma JWT di autenticazione e
 * firma di integrita' (Agid-JWT-Signature) con ES256 e il simulatore, in-process
 * come nelle spec sorelle, risponde 202. Il clientId e' 'operatore-test', l'unico
 * soggetto accreditato di default nel simulatore.
 */
describe('RENTRIApiClient con certificato EC (contro la fake RENTRI, in-process)', () => {
  let app: any

  beforeAll(async () => {
    app = creaApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  function adattaRisposta(risposta: any): AxiosResponse {
    return {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }
  }

  it('creaFormulario con certificato EC: 202 dal simulatore', async () => {
    const p12 = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../../tools/rentri-fake/test/fixture/ec/operatore-test-ec.p12'
      )
    )
    const { certificatePem, privateKeyPem } = parsePkcs12(p12, 'prova-ec')
    const algorithm = algoritmoDaChiave(privateKeyPem)
    expect(algorithm).toBe('ES256')

    const config: RentriConfig = {
      baseUrl: 'https://demoapi.rentri.gov.it',
      clientId: 'operatore-test',
      audience: 'rentrigov.demo.api',
      signatureAudience: 'https://demoapi.rentri.gov.it',
      certificatePem,
      privateKeyPem,
      algorithm,
      jwtTtlSeconds: 300,
      credentialEncKey: 'test-enc-key',
    }

    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const credentialService = { getForTenant: jest.fn().mockResolvedValue(null) }
    const auth = new RentriAuthService(
      new RentriCredentialResolver(credentialService as any, config),
      config,
      logger
    )
    // Firma di integrita' REALE (non mockata): e' lei che porta ES256 nell'header Agid-JWT-Signature.
    const resolver: any = {
      resolve: jest.fn().mockResolvedValue({
        clientId: config.clientId,
        certificatePem,
        privateKeyPem,
        algorithm,
        source: 'tenant',
      }),
    }
    const signature = new RentriSignatureService(config, resolver)
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }

    let intestazioniInviate: Record<string, string> = {}
    let statoRisposta = 0
    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          intestazioniInviate = opts.headers
          app
            .inject({
              method: 'POST',
              url: new URL(url).pathname,
              headers: opts.headers,
              payload: body as any,
            })
            .then((risposta: any) => {
              statoRisposta = risposta.statusCode
              subscriber.next(adattaRisposta(risposta))
              subscriber.complete()
            })
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: jest.fn(),
    }

    const client = new RENTRIApiClient(httpService, logger, metrics, config, auth, signature)
    const { transazioneId } = await client.creaFormulario('tenant-ec', corpoFormularioValido())

    expect(statoRisposta).toBe(202)
    expect(transazioneId).toBeTruthy()
    // Entrambi i JWT (Authorization e firma di integrita') dichiarano ES256.
    const alg = (jwt: string) =>
      JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8')).alg
    expect(alg(intestazioniInviate['Authorization'].replace('Bearer ', ''))).toBe('ES256')
    expect(alg(intestazioniInviate['Agid-JWT-Signature'])).toBe('ES256')

    // Verifica crittografica dell'header Agid-JWT-Signature: la firma ES256 deve
    // tornare con la chiave pubblica del certificato (non basta che l'alg dichiari ES256)
    // ed essere in formato IEEE P1363 (r||s, 64 byte per P-256), non DER.
    const jws = intestazioniInviate['Agid-JWT-Signature']
    const verificato = await compactVerify(jws, await importX509(certificatePem, 'ES256'))
    expect(verificato.protectedHeader.alg).toBe('ES256')
    expect(Buffer.from(jws.split('.')[2], 'base64url')).toHaveLength(64)
  }, 30000)
})
