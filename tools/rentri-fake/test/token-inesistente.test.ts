import { creaApp } from '../src/app'

describe('Endpoint /token — non esiste in RENTRI', () => {
  it('risponde 404 a POST /token, come farebbe RENTRI', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: '/token',
      payload: { grant_type: 'client_credentials', client_id: 'x', client_secret: 'y' },
    })

    expect(risposta.statusCode).toBe(404)
    expect(risposta.json()).toMatchObject({
      titolo: 'Risorsa non trovata',
    })

    await app.close()
  })

  it('risponde 404 anche a GET /token', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/token' })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })
})
