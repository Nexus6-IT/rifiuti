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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { creaCertificatoDiTest } = require('../../../../../tools/rentri-fake/test/aiuti/certificati')
// jose sta solo tra le dipendenze del finto: lo si usa da li' per la verifica crittografica.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { compactVerify, importX509 } = require('../../../../../tools/rentri-fake/node_modules/jose')

/**
 * Pezzo 5, Task 2: prova end-to-end da job con due tenant. Un worker BullMQ non
 * ha TenantContext: la firma di integrita' (Agid-JWT-Signature) deve essere
 * firmata con la credenziale dello STESSO tenant del JWT Authorization, passato
 * in modo esplicito. Il tenant A usa un certificato RSA, il B quello EC del pezzo 4;
 * la credenziale globale da env e' un terzo certificato distinto, cosi' un
 * ripiego silenzioso su env sarebbe riconoscibile dall'x5c.
 * Le chiamate avvengono FUORI da ogni TenantContext.run.
 */
describe("Firma di integrita' con tenant esplicito, da job (fake RENTRI in-process)", () => {
  let app: any
  const richieste: Array<{ headers: Record<string, string> }> = []
  let client: RENTRIApiClient
  let certA: string
  let certB: string
  let certEnv: string

  const pem = (b64: string) => `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----`
  const x5cDi = (jwt: string): string =>
    JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8')).x5c[0]
  const b64Di = (certPem: string): string =>
    certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')

  function adattaRisposta(risposta: any): AxiosResponse {
    return {
      data: risposta.payload ? risposta.json() : undefined,
      status: risposta.statusCode,
      statusText: '',
      headers: risposta.headers as Record<string, string>,
      config: {} as any,
    }
  }

  beforeAll(async () => {
    app = creaApp()
    await app.ready()

    const rsaA = creaCertificatoDiTest('operatore-test')
    const rsaEnv = creaCertificatoDiTest('operatore-test')
    const p12 = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../../tools/rentri-fake/test/fixture/ec/operatore-test-ec.p12'
      )
    )
    const ec = parsePkcs12(p12, 'prova-ec')

    certA = pem(rsaA.certificatoBase64Der)
    certB = ec.certificatePem
    certEnv = pem(rsaEnv.certificatoBase64Der)

    const credenziali: Record<string, any> = {
      'tenant-a': {
        clientId: 'operatore-test',
        certificatePem: certA,
        privateKeyPem: rsaA.chiavePrivataPem,
        algorithm: 'RS256',
      },
      'tenant-b': {
        clientId: 'operatore-test',
        certificatePem: certB,
        privateKeyPem: ec.privateKeyPem,
        algorithm: algoritmoDaChiave(ec.privateKeyPem),
      },
    }

    const config: RentriConfig = {
      baseUrl: 'https://demoapi.rentri.gov.it',
      clientId: 'operatore-test',
      audience: 'rentrigov.demo.api',
      signatureAudience: 'https://demoapi.rentri.gov.it',
      certificatePem: certEnv,
      privateKeyPem: rsaEnv.chiavePrivataPem,
      algorithm: 'RS256',
      jwtTtlSeconds: 300,
      credentialEncKey: 'test-enc-key',
      // La credenziale env e' legata a un'azienda DIVERSA da A, B e C: nessuna delle
      // tre deve poterla usare (se succedesse, il test sui x5c lo vedrebbe).
      envTenantId: 'tenant-env-altro',
    }

    const logger: any = {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    // Credential service in memoria: una credenziale propria per tenant.
    const credentialService = {
      getForTenant: jest.fn(async (t: string) => credenziali[t] ?? null),
    }
    const resolver = new RentriCredentialResolver(credentialService as any, config)
    const auth = new RentriAuthService(resolver, config, logger)
    const signature = new RentriSignatureService(config, resolver)
    const metrics: any = {
      rentriApiRequestDuration: { observe: jest.fn() },
      rentriApiErrors: { inc: jest.fn() },
      rentriTenantLocked: { set: jest.fn() },
    }
    const httpService: any = {
      post: (url: string, body: unknown, opts: { headers: Record<string, string> }) =>
        new Observable<AxiosResponse>(subscriber => {
          // Si catturano gli header effettivamente inviati al finto.
          richieste.push({ headers: opts.headers })
          app
            .inject({
              method: 'POST',
              url: new URL(url).pathname,
              headers: opts.headers,
              payload: body as any,
            })
            .then((risposta: any) => {
              subscriber.next(adattaRisposta(risposta))
              subscriber.complete()
            })
            .catch((errore: unknown) => subscriber.error(errore))
        }),
      get: jest.fn(),
    }
    client = new RENTRIApiClient(httpService, logger, metrics, config, auth, signature)
  }, 30000)

  afterAll(async () => {
    await app.close()
  })

  // Nessun TenantContext.run: come in un worker BullMQ.
  const daJob = (tenant: string) => client.creaFormulario(tenant, corpoFormularioValido())

  it('da job: Authorization e Agid-JWT-Signature dello stesso tenant (stesso x5c)', async () => {
    richieste.length = 0
    const { transazioneId } = await daJob('tenant-a')
    expect(transazioneId).toBeTruthy()

    expect(richieste).toHaveLength(1)
    const h = richieste[0].headers
    const x5cAuth = x5cDi(h['Authorization'].replace('Bearer ', ''))
    const x5cFirma = x5cDi(h['Agid-JWT-Signature'])
    expect(x5cFirma).toBe(x5cAuth)
    expect(x5cFirma).toBe(b64Di(certA))
    expect(x5cFirma).not.toBe(b64Di(certEnv))
  }, 30000)

  it("due tenant consecutivi: nessuna credenziale passa dall'uno all'altro", async () => {
    richieste.length = 0
    await daJob('tenant-a')
    await daJob('tenant-b')
    await daJob('tenant-a')

    expect(richieste).toHaveLength(3)
    const x5c = richieste.map(r => ({
      auth: x5cDi(r.headers['Authorization'].replace('Bearer ', '')),
      firma: x5cDi(r.headers['Agid-JWT-Signature']),
    }))
    expect(b64Di(certA)).not.toBe(b64Di(certB))
    expect(x5c[0]).toEqual({ auth: b64Di(certA), firma: b64Di(certA) })
    expect(x5c[1]).toEqual({ auth: b64Di(certB), firma: b64Di(certB) })
    expect(x5c[2]).toEqual({ auth: b64Di(certA), firma: b64Di(certA) })
  }, 30000)

  it('tenant C senza certificato e non legato all env: errore esplicito, nessuna richiesta parte', async () => {
    richieste.length = 0

    await expect(daJob('tenant-c')).rejects.toThrow(
      "L'azienda non ha un certificato RENTRI configurato"
    )

    expect(richieste).toHaveLength(0)
  }, 30000)

  it('Agid-JWT-Signature verificata con il certificato del tenant (compactVerify)', async () => {
    richieste.length = 0
    await daJob('tenant-a')
    await daJob('tenant-b')

    expect(richieste).toHaveLength(2)
    const jwsA = richieste[0].headers['Agid-JWT-Signature']
    const jwsB = richieste[1].headers['Agid-JWT-Signature']

    const okA = await compactVerify(jwsA, await importX509(certA, 'RS256'))
    expect(okA.protectedHeader.alg).toBe('RS256')
    const okB = await compactVerify(jwsB, await importX509(certB, 'ES256'))
    expect(okB.protectedHeader.alg).toBe('ES256')

    // Non torna con la credenziale globale da env.
    await expect(compactVerify(jwsA, await importX509(certEnv, 'RS256'))).rejects.toThrow()
  }, 30000)
})
