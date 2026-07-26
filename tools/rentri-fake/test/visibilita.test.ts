import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

// Numero FIR e num_iscr_sito conformi ai pattern del contratto
// (formulari.yaml righe 299 e 684 rispettivamente).
const NUMERO_FIR_VALIDO = 'BCDFGH00003NP'
const NUM_ISCR_SITO_VALIDO = 'OP1234ABC123456-RM1234'
const ALTRO_NUM_ISCR_SITO_VALIDO = 'OP5678XYZ654321-MI5678'

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

/**
 * Acquisizione/rilascio della visibilità in ricerca (formulari.yaml righe
 * 657-703 e 2030-2075): a differenza di "Crea FIR" (l'unica marcata
 * "🔁[ASYNC]" nel contratto), queste due operazioni dichiarano solo `200`
 * immediato — nessun `202`/NONBLOCK_PULL. Un caso accettato e uno respinto
 * per ciascuna regola (numero_fir/num_iscr_sito mal formati, formulario
 * inesistente), coerente con lo stile delle altre suite della fake.
 */
describe('Acquisizione e rilascio della visibilità in ricerca', () => {
  it('rifiuta con 403 senza token', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}/acquisizione-visibilita/${NUM_ISCR_SITO_VALIDO}`,
    })

    expect(risposta.statusCode).toBe(403)
    expect(risposta.headers['content-type']).toContain('application/problem+json')
    await app.close()
  })

  it('rifiuta con 400 un numero_fir che non rispetta il pattern del contratto', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/NON-VALIDO!!/acquisizione-visibilita/${NUM_ISCR_SITO_VALIDO}`,
      headers: await intestazioni(),
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.headers['content-type']).toContain('application/problem+json')
    await app.close()
  })

  it('rifiuta con 400 un num_iscr_sito che non rispetta il pattern del contratto', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}/acquisizione-visibilita/non-valido`,
      headers: await intestazioni(),
    })

    expect(risposta.statusCode).toBe(400)
    expect(risposta.headers['content-type']).toContain('application/problem+json')
    await app.close()
  })

  it('risponde 404 per un formulario ben formato ma inesistente', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}/acquisizione-visibilita/${NUM_ISCR_SITO_VALIDO}`,
      headers: await intestazioni(),
    })

    expect(risposta.statusCode).toBe(404)
    await app.close()
  })

  it('acquisisce la visibilità con 200 sincrono (nessun corpo, nessuna transazione) e la riflette in GET /', async () => {
    const app = creaApp()
    await app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: {
        numero_fir: NUMERO_FIR_VALIDO,
        stato: 'InserimentoQuantita',
        produttore: 'Produttore di prova SRL',
        identificativo_soggetto: 'RSSMRA80A01H501U',
      },
    })

    const acquisizione = await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}/acquisizione-visibilita/${NUM_ISCR_SITO_VALIDO}`,
      headers: await intestazioni(),
    })
    expect(acquisizione.statusCode).toBe(200)
    expect(acquisizione.payload).toBe('')

    const ricerca = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?identificativo_soggetto=RSSMRA80A01H501U',
      headers: await intestazioni(),
    })
    expect(ricerca.statusCode).toBe(200)
    expect(ricerca.json()).toEqual([
      expect.objectContaining({
        numero_fir: NUMERO_FIR_VALIDO,
        visibilita_sito_acquisita: true,
      }),
    ])

    await app.close()
  })

  it('rilascia la visibilità precedentemente acquisita: la ricerca torna a visibilita_sito_acquisita=false', async () => {
    const app = creaApp()
    await app.inject({
      method: 'POST',
      url: '/__controllo/formulario',
      payload: {
        numero_fir: NUMERO_FIR_VALIDO,
        stato: 'InserimentoQuantita',
        produttore: 'Produttore di prova SRL',
        identificativo_soggetto: 'RSSMRA80A01H501U',
      },
    })
    await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}/acquisizione-visibilita/${NUM_ISCR_SITO_VALIDO}`,
      headers: await intestazioni(),
    })

    const rilascio = await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}/rilascio-visibilita/${NUM_ISCR_SITO_VALIDO}`,
      headers: await intestazioni(),
    })
    expect(rilascio.statusCode).toBe(200)

    const ricerca = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/?identificativo_soggetto=RSSMRA80A01H501U',
      headers: await intestazioni(),
    })
    expect(ricerca.json()).toEqual([expect.objectContaining({ visibilita_sito_acquisita: false })])

    await app.close()
  })

  it("rilascia con 404 su un formulario inesistente, come l'acquisizione", async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: `/formulari/v1.0/${NUMERO_FIR_VALIDO}/rilascio-visibilita/${ALTRO_NUM_ISCR_SITO_VALIDO}`,
      headers: await intestazioni(),
    })

    expect(risposta.statusCode).toBe(404)
    await app.close()
  })
})
