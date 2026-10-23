import { creaApp } from '../src/app'
import { intestazioniAutenticate } from './aiuti/token'

/**
 * `authorize` e `sign-hash` validano il corpo sugli schemi del contratto
 * (`CredentialsAuthorizeRequest`, `SignatureRequest`): un client che manda
 * un corpo che l'ente rifiuterebbe deve accorgersene qui.
 */
const CREDENTIALS_ID = 'CRED00001' // esattamente 9 caratteri (contratto)
const DIGEST = Buffer.from('digest-di-prova').toString('base64')
const ALGO_FIRMA = '1.2.840.10045.4.3.2'

function corpoAuthorize(sovrascrivi: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    credentials_id: CREDENTIALS_ID,
    num_signatures: 1,
    hashes: [DIGEST],
    hash_algo: '2.16.840.1.101.3.4.2.1',
    description: 'Firma del formulario - operazione accettazione',
    auth_data: null,
    client_data: null,
    ...sovrascrivi,
  }
}

describe('ca-rentri: validazione dei corpi sul contratto', () => {
  async function post(app: ReturnType<typeof creaApp>, url: string, payload: unknown) {
    return app.inject({
      method: 'POST',
      url: `/ca-rentri/v1.0${url}`,
      headers: await intestazioniAutenticate(),
      payload: payload as never,
    })
  }

  it('authorize con un corpo valido: 200', async () => {
    const app = creaApp()
    const r = await post(app, '/credentials/authorize', corpoAuthorize())
    expect(r.statusCode).toBe(200)
  })

  it('authorize con credentials_id di 8 caratteri → 400', async () => {
    const app = creaApp()
    const r = await post(app, '/credentials/authorize', corpoAuthorize({ credentials_id: 'CRED0001' }))
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toContain('credentials_id')
  })

  it('authorize con description contenente — → 400', async () => {
    const app = creaApp()
    const r = await post(
      app,
      '/credentials/authorize',
      corpoAuthorize({ description: 'Firma del formulario — operazione accettazione' })
    )
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toContain('description')
  })

  it('authorize con un campo non previsto → 400', async () => {
    const app = creaApp()
    const r = await post(app, '/credentials/authorize', corpoAuthorize({ campo_inventato: 1 }))
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toContain('campo_inventato')
  })

  it('sign-hash con sign_algo diverso da 1.2.840.10045.4.3.2 → 400', async () => {
    const app = creaApp()
    const r = await post(app, '/signatures/sign-hash', {
      credentials_id: CREDENTIALS_ID,
      sad: 'sad-qualunque',
      hashes: [DIGEST],
      sign_algo: '1.2.840.113549.1.1.11',
    })
    expect(r.statusCode).toBe(400)
    expect(r.json().detail).toContain('sign_algo')
  })

  it('sign-hash con SAD non autorizzato → 422', async () => {
    const app = creaApp()
    const r = await post(app, '/signatures/sign-hash', {
      credentials_id: CREDENTIALS_ID,
      sad: 'sad-mai-emesso',
      hashes: [DIGEST],
      sign_algo: ALGO_FIRMA,
    })
    expect(r.statusCode).toBe(422)
  })

  it('sign-hash con sessione non ancora confermata → 422; con hash diverso da quello autorizzato → 422', async () => {
    const app = creaApp()
    const auth = await post(app, '/credentials/authorize', corpoAuthorize())
    const { sad, handle } = auth.json()

    const nonConfermata = await post(app, '/signatures/sign-hash', {
      credentials_id: CREDENTIALS_ID,
      sad,
      hashes: [DIGEST],
      sign_algo: ALGO_FIRMA,
    })
    expect(nonConfermata.statusCode).toBe(422)

    await app.inject({ method: 'POST', url: `/__controllo/ca-rentri/autorizza/${handle}` })
    const altroHash = await post(app, '/signatures/sign-hash', {
      credentials_id: CREDENTIALS_ID,
      sad,
      hashes: [Buffer.from('altro').toString('base64')],
      sign_algo: ALGO_FIRMA,
    })
    expect(altroHash.statusCode).toBe(422)
  })
})
