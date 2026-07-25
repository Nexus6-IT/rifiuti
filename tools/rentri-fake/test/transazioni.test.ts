import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

// Un jti diverso ad ogni chiamata (FEDELTA.md §5.2 punto 3, anti-replay): un
// token self-issued non va mai riutilizzato per piu' di una richiesta HTTP,
// quindi ogni chiamata a app.inject() deve avere le proprie intestazioni.
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
    .setJti(randomUUID())
    .sign(chiave)
}

async function intestazioni(): Promise<{ authorization: string }> {
  return { authorization: `Bearer ${await tokenValido()}` }
}

// Ciclo NONBLOCK_PULL come dichiarato dal contratto ufficiale:
// - POST / (Crea FIR): formulari.yaml righe 187-265 -> 202, TransazioneModel,
//   header Location.
// - GET /{transazione_id}/status: formulari.yaml righe 2847-2897 -> 200
//   senza corpo se non ancora elaborata, 303 + Location quando pronta.
// - GET /{transazione_id}/result: formulari.yaml righe 2801-2846 -> 400
//   problem+json se non ancora elaborata, altrimenti 200 EsitoFormularioModel.
describe('Asincronia NONBLOCK_PULL', () => {
  it('POST / crea il FIR: 202, TransazioneModel con transazione_id uuid, header Location', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/',
      headers: { authorization: `Bearer ${await tokenValido()}` },
      payload: { dati: 'qualsiasi' },
    })

    expect(risposta.statusCode).toBe(202)
    const corpo = risposta.json()
    expect(corpo).toHaveProperty('transazione_id')
    // TransazioneModel.transazione_id e' `format: uuid` (formulari.yaml
    // righe 10276-10278), non un contatore tipo TRX-000001.
    expect(corpo.transazione_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(risposta.headers.location).toBe(`/formulari/v1.0/${corpo.transazione_id}/status`)

    await app.close()
  })

  it('non esiste piu la rotta inventata POST /{numero_fir}/trasmissione', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/TSTB12345XY/trasmissione',
      headers: { authorization: `Bearer ${await tokenValido()}` },
      payload: {},
    })

    // Nessun path del contratto ha questa forma: deve tornare un 404 di
    // rotta, non un 202 come nella fake precedente.
    expect(risposta.statusCode).toBe(404)

    await app.close()
  })

  it('lo status e 200 senza corpo (e senza campo stato) finche non si completa', async () => {
    const app = creaApp()

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/',
      headers: await intestazioni(),
      payload: {},
    })
    const id = creazione.json().transazione_id

    const stato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/status`,
      headers: await intestazioni(),
    })

    expect(stato.statusCode).toBe(200)
    expect(stato.body).toBe('')
    expect(stato.headers.location).toBeUndefined()

    await app.close()
  })

  it('lo status risponde 303 con header Location verso /result quando la transazione e completata', async () => {
    const app = creaApp()

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/',
      headers: await intestazioni(),
      payload: {},
    })
    const id = creazione.json().transazione_id

    await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: id, errore: false, validazione: [] },
    })

    const stato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/status`,
      headers: await intestazioni(),
    })

    expect(stato.statusCode).toBe(303)
    expect(stato.headers.location).toBe(`/formulari/v1.0/${id}/result`)

    await app.close()
  })

  it('il risultato risponde 400 problem+json finche la transazione e in corso', async () => {
    const app = creaApp()

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/',
      headers: await intestazioni(),
      payload: {},
    })
    const id = creazione.json().transazione_id

    const risultato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/result`,
      headers: await intestazioni(),
    })

    expect(risultato.statusCode).toBe(400)
    expect(risultato.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it('il risultato completato espone EsitoFormularioModel con errore e validazione', async () => {
    const app = creaApp()

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/',
      headers: await intestazioni(),
      payload: {},
    })
    const id = creazione.json().transazione_id

    await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: {
        transazione_id: id,
        errore: true,
        validazione: [{ campo: 'numero_fir', tipo: 'Errore', codice_messaggio: 'FIR_DUPLICATO' }],
      },
    })

    const risultato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/result`,
      headers: await intestazioni(),
    })

    expect(risultato.statusCode).toBe(200)
    const corpo = risultato.json()
    expect(corpo.transazione_id).toBe(id)
    // Sono esattamente i campi con cui il client distingue un esito
    // negativo (formulari.yaml righe 9402-9409): la fake precedente non li
    // esponeva affatto.
    expect(corpo.errore).toBe(true)
    expect(corpo.validazione).toEqual([
      { campo: 'numero_fir', tipo: 'Errore', codice_messaggio: 'FIR_DUPLICATO' },
    ])

    await app.close()
  })

  it('status di una transazione inesistente risponde 404', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/00000000-0000-0000-0000-000000000000/status',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })

  it('result di una transazione inesistente risponde 404', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/00000000-0000-0000-0000-000000000000/result',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })
})
