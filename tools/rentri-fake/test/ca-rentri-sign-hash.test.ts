import { randomUUID } from 'crypto'
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
    .setJti(randomUUID())
    .sign(chiave)
}

/**
 * Il vecchio percorso `/credentials/sign-hash` non esiste nel contratto
 * ufficiale (ca-rentri.yaml): la firma remota e' solo su `/signatures/sign-hash`.
 * La fake non deve piu' rispondere sul percorso inventato, altrimenti un client
 * sbagliato passerebbe i test contro una rotta che il vero RENTRI non espone.
 */
describe('ca-rentri: percorso della firma remota', () => {
  it('POST /ca-rentri/v1.0/credentials/sign-hash risponde 404', async () => {
    const app = creaApp()

    const risposta = await app.inject({
      method: 'POST',
      url: '/ca-rentri/v1.0/credentials/sign-hash',
      headers: { authorization: `Bearer ${await tokenValido()}` },
      payload: { credentials_id: 'c', sad: 's', hashes: ['h'], sign_algo: '1.2.840.10045.4.3.2' },
    })

    expect(risposta.statusCode).toBe(404)
  })
})
