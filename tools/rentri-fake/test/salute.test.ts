import { creaApp } from '../src/app'

describe('Salute del servizio', () => {
  it('risponde 200 con il nome del servizio', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/__salute' })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toEqual({ servizio: 'rentri-fake', stato: 'ok' })

    await app.close()
  })
})
