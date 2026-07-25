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

describe('Rotte formulari', () => {
  it('rifiuta con 401 la lista senza token', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/formulari/v1.0/' })

    expect(risposta.statusCode).toBe(401)

    await app.close()
  })

  it('restituisce la lista con un token valido', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(200)
    expect(Array.isArray(risposta.json())).toBe(true)

    await app.close()
  })

  it('risponde 404 per un formulario inesistente', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/FIR-INESISTENTE',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })
})
