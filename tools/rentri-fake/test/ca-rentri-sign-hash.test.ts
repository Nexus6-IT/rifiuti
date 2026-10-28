import { creaApp } from '../src/app'
import { tokenValido } from './aiuti/token'

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
      payload: { credentials_id: 'CRED00001', sad: 's', hashes: ['h'], sign_algo: '1.2.840.10045.4.3.2' },
    })

    expect(risposta.statusCode).toBe(404)
  })
})
