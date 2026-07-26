import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

// Numero FIR conforme al pattern del contratto (formulari.yaml riga 299):
// 4-6 consonanti ammesse, cifre, 1-2 consonanti finali. Nessuna vocale.
const NUMERO_FIR_VALIDO = 'TSTB12345XY'

// Un jti diverso ad ogni chiamata (FEDELTA.md §5.2 punto 3, anti-replay):
// non va mai riutilizzato lo stesso token per piu' di una richiesta.
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

  // formulari.yaml riga 9794: identificativo_soggetto filtra sui FIR in cui
  // quel codice fiscale compare come soggetto, indipendentemente da chi ha
  // creato il FIR — non solo su quelli con visibilità acquisita dall'unità
  // locale chiamante (quel filtro e' num_iscr_sito, mutuamente esclusivo).
  it('filtra per identificativo_soggetto: un formulario di un altro soggetto non compare', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    await app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: {
        numero_fir: 'BCDFGH00004QR',
        stato: 'InserimentoQuantita',
        produttore: 'Produttore A',
        identificativo_soggetto: 'RSSMRA80A01H501U',
      },
    })
    await app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: {
        numero_fir: 'BCDFGH00005ST',
        stato: 'InserimentoQuantita',
        produttore: 'Produttore B',
        identificativo_soggetto: 'VRDGPP75B02H501X',
      },
    })

    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?identificativo_soggetto=RSSMRA80A01H501U',
      headers: intestazioni,
    })

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(corpo).toHaveLength(1)
    expect(corpo[0].numero_fir).toBe('BCDFGH00004QR')

    await app.close()
  })

  // Un formulario appena creato/popolato non ha ancora alcuna unità locale
  // che ne abbia acquisito la visibilità: il flag deve essere false, non
  // assente/undefined (il chiamante lo usa per decidere se proporre
  // l'acquisizione).
  it('un formulario senza acquisizioni ha visibilita_sito_acquisita=false', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    await app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: {
        numero_fir: 'BCDFGH00006TU',
        stato: 'InserimentoQuantita',
        produttore: 'Produttore C',
        identificativo_soggetto: 'BNCLGU70C03H501Y',
      },
    })

    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?identificativo_soggetto=BNCLGU70C03H501Y',
      headers: intestazioni,
    })

    expect(risposta.json()).toEqual([expect.objectContaining({ visibilita_sito_acquisita: false })])

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
