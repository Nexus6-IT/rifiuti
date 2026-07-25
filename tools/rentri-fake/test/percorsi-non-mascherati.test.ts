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

// formulari.yaml righe 4450 (/count) e 4578 (/status): path ufficiali del
// contratto, distinti da /{numero_fir}. La fake precedente li lasciava
// catturare dal segmento generico `:identificativo`, che rispondeva 404
// "Formulario non trovato" — un errore di dominio del tutto plausibile che
// mascherava l'assenza della rotta. Punto 6 della correzione: registrarli
// esplicitamente con una risposta riconoscibile (501), mai un 404 di dominio.
describe('/count e /status non sono piu mascherati dal segmento generico', () => {
  it('GET /count risponde 501 riconoscibile, non 404 "Formulario non trovato"', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/count',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(501)
    const corpo = risposta.json()
    expect(corpo.title).not.toBe('Formulario non trovato')

    await app.close()
  })

  it('GET /status risponde 501 riconoscibile, non 404 "Formulario non trovato"', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/status',
    })

    expect(risposta.statusCode).toBe(501)
    const corpo = risposta.json()
    expect(corpo.title).not.toBe('Formulario non trovato')

    await app.close()
  })
})
