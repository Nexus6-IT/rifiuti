import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

// Numero FIR conforme al pattern del contratto (formulari.yaml riga 299):
// 4-6 consonanti ammesse, cifre, 1-2 consonanti finali. Nessuna vocale.
const NUMERO_FIR_VALIDO = 'TSTB12345XY'

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

describe('Rotte formulari', () => {
  // Il contratto non documenta mai 401 (formulari.yaml, es. righe 164-166:
  // solo 403 "Operazione non consentita"). La fake corretta usa 403.
  it('rifiuta con 403 la lista senza token', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?num_iscr_sito=UL0001',
    })

    expect(risposta.statusCode).toBe(403)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  // formulari.yaml righe 29-45: uno tra num_iscr_sito e
  // identificativo_soggetto e' obbligatorio, altrimenti 400.
  it('rifiuta con 400 la lista priva sia di num_iscr_sito sia di identificativo_soggetto', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it('restituisce la lista con num_iscr_sito valorizzato, con gli header Paging-*', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?num_iscr_sito=UL0001',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(200)
    expect(Array.isArray(risposta.json())).toBe(true)
    // Header dichiarati sulla risposta 200 (formulari.yaml righe 134-157).
    expect(risposta.headers['paging-page']).toBeDefined()
    expect(risposta.headers['paging-pagesize']).toBeDefined()
    expect(risposta.headers['paging-pagecount']).toBeDefined()
    expect(risposta.headers['paging-totalrecordcount']).toBeDefined()

    await app.close()
  })

  it('restituisce la lista anche con solo identificativo_soggetto valorizzato', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?identificativo_soggetto=CF01234567890',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(200)

    await app.close()
  })

  // formulari.yaml riga 299: pattern del numero_fir. Un valore mal formato
  // e' un 400 di validazione, non un 404 di dominio.
  it('rifiuta con 400 un numero_fir che non rispetta il pattern del contratto', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/NON-UN-FIR-VALIDO!!',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  it('risponde 404 per un numero_fir ben formato ma inesistente', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}`,
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(404)
    expect(risposta.headers['content-type']).toContain('application/problem+json')

    await app.close()
  })

  // Punto 7 della correzione: l'archivio deve poter essere popolato dal
  // canale di controllo, altrimenti nessuno scenario di lettura positiva e'
  // verificabile.
  it('risponde 200 con il formulario per un numero_fir popolato via canale di controllo', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    await app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: { numero_fir: NUMERO_FIR_VALIDO, stato: 'Emesso', produttore: 'ACME SRL' },
    })

    const risposta = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}`,
      headers: intestazioni,
    })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toMatchObject({ numero_fir: NUMERO_FIR_VALIDO })

    await app.close()
  })
})
