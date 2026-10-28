import { readFileSync } from 'fs'
import { join } from 'path'
import { load } from 'js-yaml'
import { creaApp } from '../src/app'
import { creaValidatoreContratto } from '../src/dominio/validatore-contratto'
import { tokenValido } from './aiuti/token'

const schemi = (
  load(
    readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'contracts', 'rentri', 'ca-rentri.yaml'),
      'utf8'
    )
  ) as { components: { schemas: Record<string, Record<string, unknown>> } }
).components.schemas

/**
 * Guardia sulla RISPOSTA: il corpo restituito dal finto deve rispettare
 * `CredentialsInfoResponse` del contratto (`additionalProperties: false`
 * anche su `CertData`). Senza questa guardia il finto potrebbe aggiungere
 * campi che l'ente non manda e il client li leggerebbe senza accorgersene.
 */
const rispettaCredentialsInfoResponse = creaValidatoreContratto(
  schemi.CredentialsInfoResponse,
  schemi
)

/**
 * `GET /credentials/info` risponde con `CredentialsInfoResponse`
 * (ca-rentri.yaml:2779): il certificato sta in `cert.certificates[]`
 * (`CertData`, :2346), scelto dal parametro `certificates` (:2682).
 */
describe('ca-rentri: credentials/info', () => {
  async function info(query: string, app = creaApp()) {
    return app.inject({
      method: 'GET',
      url: `/ca-rentri/v1.0/credentials/info?${query}`,
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })
  }

  it('credentials/info risponde con CertData', async () => {
    const risposta = await info('credentials_id=CRED00001&cert_info=true&certificates=Single')

    expect(risposta.statusCode).toBe(200)
    const corpo = risposta.json()
    expect(corpo.certificato).toBeUndefined()
    expect(corpo.cert.status).toBe('Valid')
    expect(corpo.cert.certificates).toHaveLength(1)
    expect(typeof corpo.cert.certificates[0]).toBe('string')
  })

  it('certificates=None → nessun certificato', async () => {
    const risposta = await info('credentials_id=CRED00001&cert_info=true&certificates=None')

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json().cert.certificates).toEqual([])
  })

  it("certificates=Chain → catena con il certificato dell'ente finale per primo", async () => {
    // stessa app: il certificato di firma e' generato per istanza
    const app = creaApp()
    const single = (
      await info('credentials_id=CRED00001&cert_info=true&certificates=Single', app)
    ).json().cert.certificates[0]
    const risposta = await info('credentials_id=CRED00001&cert_info=true&certificates=Chain', app)

    const catena = risposta.json().cert.certificates
    expect(catena.length).toBeGreaterThan(1)
    expect(catena[0]).toBe(single)
  })

  it('senza cert_info il blocco cert e i certificati sono omessi', async () => {
    const risposta = await info('credentials_id=CRED00001&certificates=Chain')

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json().cert).toBeUndefined()
  })

  it('senza credentials_id risponde 400 con il titolo del parametro non specificato', async () => {
    const risposta = await info('cert_info=true')

    expect(risposta.statusCode).toBe(400)
    expect(risposta.json().title).toBe('Parametro richiesto non specificato')
  })

  it('credentials_id di lunghezza diversa da 9 risponde 400 con un titolo proprio', async () => {
    for (const credenziale of ['CRED0001', 'CRED000012']) {
      const risposta = await info(`credentials_id=${credenziale}&cert_info=true`)

      expect(risposta.statusCode).toBe(400)
      expect(risposta.json().title).toBe('Parametro non valido')
      expect(risposta.json().detail).toContain('credentials_id')
    }
  })

  it('certificates con valore fuori enum risponde 400 con un titolo proprio', async () => {
    const risposta = await info('credentials_id=CRED00001&certificates=Tutti')

    expect(risposta.statusCode).toBe(400)
    expect(risposta.json().title).toBe('Modello dati non valido')
  })

  it('i tre 400 hanno titoli distinti', async () => {
    const titoli = [
      (await info('cert_info=true')).json().title,
      (await info('credentials_id=CRED0001')).json().title,
      (await info('credentials_id=CRED00001&certificates=Tutti')).json().title,
    ]

    expect(new Set(titoli).size).toBe(3)
  })

  it('la risposta rispetta CredentialsInfoResponse in tutte le varianti', async () => {
    const app = creaApp()
    for (const query of [
      'credentials_id=CRED00001',
      'credentials_id=CRED00001&cert_info=true',
      'credentials_id=CRED00001&cert_info=true&certificates=None',
      'credentials_id=CRED00001&cert_info=true&certificates=Single',
      'credentials_id=CRED00001&cert_info=true&certificates=Chain',
    ]) {
      const risposta = await info(query, app)

      expect(risposta.statusCode).toBe(200)
      expect({ query, motivo: rispettaCredentialsInfoResponse(risposta.json()) }).toEqual({
        query,
        motivo: null,
      })
    }
  })

  it('la guardia di risposta rifiuta un campo che il contratto non prevede', () => {
    expect(
      rispettaCredentialsInfoResponse({ description: 'x', cert: { status: 'Valid', extra: 1 } })
    ).toContain('extra')
    expect(rispettaCredentialsInfoResponse({ certificato: 'x' })).toContain('certificato')
  })
})
