import { creaApp } from '../src/app'
import { tokenValido } from './aiuti/token'

/**
 * `GET /credentials/info` risponde con `CredentialsInfoResponse`
 * (ca-rentri.yaml:2779): il certificato sta in `cert.certificates[]`
 * (`CertData`, :2346), scelto dal parametro `certificates` (:2682).
 */
describe('ca-rentri: credentials/info', () => {
  async function info(query: string, app = creaApp()) {
    return app.inject({
      method: 'GET',
      url: `/ca-rentri/v1.0/credentials/info?${query}`,
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })
  }

  it('credentials/info risponde con CertData', async () => {
    const risposta = await info('credentials_id=CRED00001&cert_info=true&certificates=Single')

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(corpo.certificato).toBeUndefined()
    expect(corpo.cert.status).toBe('Valid')
    expect(corpo.cert.certificates).toHaveLength(1)
    expect(typeof corpo.cert.certificates[0]).toBe('string')
  })

  it('certificates=None → nessun certificato', async () => {
    const risposta = await info('credentials_id=CRED00001&cert_info=true&certificates=None')

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json().cert.certificates ?? []).toEqual([])
  })

  it("certificates=Chain → catena con il certificato dell'ente finale per primo", async () => {
    // stessa app: il certificato di firma e' generato per istanza
    const app = creaApp()
    const single = (
      await info('credentials_id=CRED00001&cert_info=true&certificates=Single', app)
    ).json().cert.certificates[0]
    const risposta = await info('credentials_id=CRED00001&cert_info=true&certificates=Chain', app)

    const catena = risposta.json().cert.certificates
    expect(catena.length).toBeGreaterThan(1)
    expect(catena[0]).toBe(single)
  })

  it('senza credentials_id risponde 400', async () => {
    const risposta = await info('cert_info=true')

    expect(risposta.statusCode).toBe(400)
  })

  it('certificates con valore fuori enum risponde 400', async () => {
    const risposta = await info('credentials_id=CRED00001&certificates=Tutti')

    expect(risposta.statusCode).toBe(400)
  })
})
