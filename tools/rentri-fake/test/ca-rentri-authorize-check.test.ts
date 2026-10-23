import { creaApp } from '../src/app'
import { intestazioniAutenticate } from './aiuti/token'

/**
 * `authorize` e `authorize-check` con la semantica del contratto
 * (ca-rentri.yaml:825-987, `CredentialsAuthorizeResponse` :2665): `authorize`
 * restituisce solo `handle`; `authorize-check` risponde 202 in attesa, 200 con
 * `sad` ed `expires_in` se concessa, 400 se scaduta, 403 se non concessa.
 */
const DIGEST = Buffer.from('digest-di-prova').toString('base64')
const ALGO_FIRMA = '1.2.840.10045.4.3.2'

const corpoAuthorize = (extra: Record<string, unknown> = {}) => ({
  credentials_id: 'CRED00001',
  num_signatures: 1,
  hashes: [DIGEST],
  hash_algo: '2.16.840.1.101.3.4.2.1',
  description: 'Firma del formulario - operazione accettazione',
  auth_data: null,
  client_data: null,
  ...extra,
})

async function creaSessione(app: ReturnType<typeof creaApp>, extra: Record<string, unknown> = {}) {
  const r = await app.inject({
    method: 'POST',
    url: '/ca-rentri/v1.0/credentials/authorize',
    headers: await intestazioniAutenticate(),
    payload: corpoAuthorize(extra) as never,
  })
  return r
}

async function controlla(app: ReturnType<typeof creaApp>, handle: string) {
  return app.inject({
    method: 'GET',
    url: `/ca-rentri/v1.0/credentials/authorize-check/${handle}`,
    headers: await intestazioniAutenticate(),
  })
}

const controllo = (app: ReturnType<typeof creaApp>, azione: string, handle: string) =>
  app.inject({ method: 'POST', url: `/__controllo/ca-rentri/${azione}/${handle}` })

describe('ca-rentri: authorize e authorize-check', () => {
  it('authorize risponde 200 con il solo handle (niente sad né expires_in)', async () => {
    const app = creaApp()
    const r = await creaSessione(app)

    expect(r.statusCode).toBe(200)
    const corpo = r.json()
    expect(typeof corpo.handle).toBe('string')
    expect(corpo).not.toHaveProperty('sad')
    expect(corpo).not.toHaveProperty('expires_in')
  })

  it('authorize-check in attesa → 202 con handle', async () => {
    const app = creaApp()
    const { handle } = (await creaSessione(app)).json()

    const r = await controlla(app, handle)
    expect(r.statusCode).toBe(202)
    expect(r.json()).toEqual({ handle })
  })

  it('authorize-check concessa → 200 con sad, expires_in intero e handle', async () => {
    const app = creaApp()
    const { handle } = (await creaSessione(app)).json()
    await controllo(app, 'autorizza', handle)

    const r = await controlla(app, handle)
    expect(r.statusCode).toBe(200)
    const corpo = r.json()
    expect(corpo.handle).toBe(handle)
    expect(typeof corpo.sad).toBe('string')
    expect(Number.isInteger(corpo.expires_in)).toBe(true)
    expect(corpo.expires_in).toBeGreaterThan(0)
  })

  it('il sad di authorize-check firma davvero con sign-hash', async () => {
    const app = creaApp()
    const { handle } = (await creaSessione(app)).json()
    await controllo(app, 'autorizza', handle)
    const { sad } = (await controlla(app, handle)).json()

    const r = await app.inject({
      method: 'POST',
      url: '/ca-rentri/v1.0/signatures/sign-hash',
      headers: await intestazioniAutenticate(),
      payload: { credentials_id: 'CRED00001', sad, hashes: [DIGEST], sign_algo: ALGO_FIRMA },
    })
    expect(r.statusCode).toBe(200)
  })

  it('authorize-check scaduta → 400', async () => {
    const app = creaApp()
    const { handle } = (await creaSessione(app)).json()
    await controllo(app, 'scadi', handle)

    expect((await controlla(app, handle)).statusCode).toBe(400)
  })

  it('authorize-check non concessa → 403', async () => {
    const app = creaApp()
    const { handle } = (await creaSessione(app)).json()
    await controllo(app, 'rifiuta', handle)

    expect((await controlla(app, handle)).statusCode).toBe(403)
  })

  it('sign-hash con SAD scaduto → 422 (il contratto non ha 410)', async () => {
    const app = creaApp()
    const { handle } = (await creaSessione(app)).json()
    await controllo(app, 'autorizza', handle)
    const { sad } = (await controlla(app, handle)).json()
    await controllo(app, 'scadi', handle)

    const r = await app.inject({
      method: 'POST',
      url: '/ca-rentri/v1.0/signatures/sign-hash',
      headers: await intestazioniAutenticate(),
      payload: { credentials_id: 'CRED00001', sad, hashes: [DIGEST], sign_algo: ALGO_FIRMA },
    })
    expect(r.statusCode).toBe(422)
  })
})
