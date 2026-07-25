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

describe('Canale di controllo', () => {
  it('forza un 503 per il numero di volte richiesto, poi torna normale', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 503, volte: 1 },
    })

    const primaChiamata = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?num_iscr_sito=UL0001',
      headers: intestazioni,
    })
    expect(primaChiamata.statusCode).toBe(503)

    const secondaChiamata = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?num_iscr_sito=UL0001',
      headers: intestazioni,
    })
    expect(secondaChiamata.statusCode).toBe(200)

    await app.close()
  })

  // Punto 8 della correzione: 429/423 devono essere pilotabili dal canale
  // di controllo, e il 429 deve portare l'header Retry-After dichiarato dal
  // contratto (formulari.yaml righe 176-180 e analoghi).
  it('pilota un 429 con header Retry-After', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 429, volte: 1 },
    })

    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?num_iscr_sito=UL0001',
      headers: intestazioni,
    })

    expect(risposta.statusCode).toBe(429)
    expect(risposta.headers['retry-after']).toBeDefined()
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it('pilota un 423 (ban del chiamante)', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 423, volte: 1 },
    })

    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?num_iscr_sito=UL0001',
      headers: intestazioni,
    })

    expect(risposta.statusCode).toBe(423)

    await app.close()
  })

  it('completa una transazione su richiesta e ne rende disponibile il risultato', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/',
      headers: intestazioni,
      payload: {},
    })
    const id = creazione.json().transazione_id

    await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: id, errore: false, validazione: [], esito: { accettato: true } },
    })

    const risultato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/result`,
      headers: intestazioni,
    })

    expect(risultato.statusCode).toBe(200)
    expect(risultato.json().esito).toEqual({ accettato: true })
    expect(risultato.json().errore).toBe(false)

    await app.close()
  })

  // Punto 7 della correzione: l'archivio deve poter essere popolato, non
  // deve restare vuoto per sempre.
  it('popola un formulario tramite il canale di controllo', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: { numero_fir: 'TSTB12345XY', stato: 'Emesso', produttore: 'ACME SRL' },
    })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toEqual({ salvato: true })

    await app.close()
  })

  it("un guasto attivo non deve compromettere /__salute (ci dipende l'healthcheck del container)", async () => {
    const app = creaApp()

    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 503, volte: 999 },
    })

    const salute = await app.inject({ method: 'GET', url: '/__salute' })

    expect(salute.statusCode).toBe(200)

    await app.close()
  })
})
