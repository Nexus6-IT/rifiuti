import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

async function tokenValido(): Promise<string> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', x5c: [certificatoBase64Der] } as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience('rentrigov.demo.api')
    .setIssuedAt()
    .setExpirationTime('300s')
    .sign(chiave)
}

describe('Asincronia NONBLOCK_PULL', () => {
  it('la trasmissione restituisce 202 con un transazione_id, non il risultato', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/FIR-0001/trasmissione',
      headers: { authorization: `Bearer ${await tokenValido()}` },
      payload: { dati: 'qualsiasi' },
    })

    expect(risposta.statusCode).toBe(202)
    expect(risposta.json()).toHaveProperty('transazione_id')
    expect(risposta.json()).not.toHaveProperty('risultato')

    await app.close()
  })

  it('lo stato è in_elaborazione finché non si completa', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/FIR-0002/trasmissione',
      headers: intestazioni,
      payload: {},
    })
    const id = creazione.json().transazione_id

    const stato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/status`,
      headers: intestazioni,
    })

    expect(stato.statusCode).toBe(200)
    expect(stato.json().stato).toBe('in_elaborazione')

    await app.close()
  })

  it('il risultato non è disponibile finché la transazione è in corso', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/FIR-0003/trasmissione',
      headers: intestazioni,
      payload: {},
    })
    const id = creazione.json().transazione_id

    const risultato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/result`,
      headers: intestazioni,
    })

    expect(risultato.statusCode).toBe(409)

    await app.close()
  })

  it('status di una transazione inesistente risponde 404', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/transazione-inesistente/status',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })
})
