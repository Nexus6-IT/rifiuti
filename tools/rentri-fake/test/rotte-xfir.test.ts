import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'
import { creaContainerXfir } from './aiuti/xfir'

const NUMERO_FIR_VALIDO = 'TSTB12345XY'

async function intestazioni(): Promise<{ authorization: string }> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', x5c: [certificatoBase64Der] } as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience('rentrigov.demo.api')
    .setIssuedAt()
    .setExpirationTime('300s')
    .setJti(randomUUID())
    .sign(chiave)

  return { authorization: `Bearer ${token}` }
}

// FEDELTA.md §5.2 punto 7: il validatore xFIR esisteva solo come libreria
// interna (src/xfir/*), mai raggiungibile via HTTP. formulari.yaml righe
// 5981-6047 (/xfir/valida) e 2681-2743 (/{numero_fir}/xfir) seguono lo
// stesso pattern NONBLOCK_PULL gia' usato per la creazione del FIR: 202,
// TransazioneModel (transazione_id uuid), header Location.
describe('Rotte xFIR', () => {
  it('POST /xfir/valida risponde 202 con TransazioneModel e header Location', async () => {
    const app = creaApp()
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml'] }],
    })

    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/xfir/valida',
      headers: await intestazioni(),
      payload: { xfir: contenuto.toString('base64') },
    })

    expect(risposta.statusCode).toBe(202)
    const corpo = risposta.json()
    expect(corpo.transazione_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(risposta.headers.location).toBe(`/formulari/v1.0/${corpo.transazione_id}/status`)

    await app.close()
  })

  it('POST /xfir/valida di un xFIR valido produce un esito senza errore, consultabile via /result', async () => {
    const app = creaApp()
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml'] }],
    })

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/xfir/valida',
      headers: await intestazioni(),
      payload: { xfir: contenuto.toString('base64') },
    })
    const id = creazione.json().transazione_id

    const risultato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/result`,
      headers: await intestazioni(),
    })

    expect(risultato.statusCode).toBe(200)
    expect(risultato.json().errore).toBe(false)

    await app.close()
  })

  it('POST /xfir/valida di un xFIR con riferimento pendente produce un esito con errore', async () => {
    const app = creaApp()
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml', 'fantasma.xml'] }],
    })

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/xfir/valida',
      headers: await intestazioni(),
      payload: { xfir: contenuto.toString('base64') },
    })
    const id = creazione.json().transazione_id

    const risultato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/result`,
      headers: await intestazioni(),
    })

    expect(risultato.statusCode).toBe(200)
    expect(risultato.json().errore).toBe(true)
    expect(risultato.json().validazione[0].codice_messaggio).toContain('fantasma.xml')

    await app.close()
  })

  it('POST /xfir/valida risponde 400 se il campo xfir e assente', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/xfir/valida',
      headers: await intestazioni(),
      payload: {},
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it('POST /xfir/valida richiede autenticazione (403 senza token)', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/xfir/valida',
      payload: { xfir: 'AAAA' },
    })

    expect(risposta.statusCode).toBe(403)

    await app.close()
  })

  it('POST /{numero_fir}/xfir risponde 202 con TransazioneModel e header Location', async () => {
    const app = creaApp()
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml'] }],
    })

    const risposta = await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}/xfir`,
      headers: await intestazioni(),
      payload: { num_iscr_sito: 'UL0001', xfir: contenuto.toString('base64') },
    })

    expect(risposta.statusCode).toBe(202)
    const corpo = risposta.json()
    expect(corpo.transazione_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    expect(risposta.headers.location).toBe(`/formulari/v1.0/${corpo.transazione_id}/status`)

    await app.close()
  })

  it('POST /{numero_fir}/xfir risponde 400 per un numero_fir mal formato', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/NON-UN-FIR-VALIDO!!/xfir',
      headers: await intestazioni(),
      payload: { num_iscr_sito: 'UL0001', xfir: 'AAAA' },
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it('POST /{numero_fir}/xfir risponde 400 se num_iscr_sito e assente', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}/xfir`,
      headers: await intestazioni(),
      payload: { xfir: 'AAAA' },
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })
})
