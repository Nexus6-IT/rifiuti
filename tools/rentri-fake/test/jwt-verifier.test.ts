import { importPKCS8, SignJWT } from 'jose'
import { creaCertificatoDiTest } from './aiuti/certificati'
import { verificaJwt } from '../src/auth/jwt-verifier'

const AUDIENCE = 'rentrigov.demo.api'

async function creaToken(opzioni: {
  audience?: string
  scadenzaSecondiDaOra?: number
  includiX5c?: boolean
}): Promise<string> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  const intestazione: Record<string, unknown> = { alg: 'RS256' }
  if (opzioni.includiX5c !== false) {
    intestazione.x5c = [certificatoBase64Der]
  }

  return new SignJWT({})
    .setProtectedHeader(intestazione as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience(opzioni.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${opzioni.scadenzaSecondiDaOra ?? 300}s`)
    .sign(chiave)
}

describe('Verifica JWT ID_AUTH_REST_02', () => {
  it('accetta un JWT self-issued valido con x5c corretto', async () => {
    const token = await creaToken({})
    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({ valido: true, soggetto: 'operatore-test' })
  })

  it('rifiuta un token con audience errata', async () => {
    const token = await creaToken({ audience: 'audience-sbagliata' })
    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('rifiuta un token privo di header x5c', async () => {
    const token = await creaToken({ includiX5c: false })
    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({ valido: false, motivo: 'header x5c assente' })
  })

  it('rifiuta un token scaduto', async () => {
    const token = await creaToken({ scadenzaSecondiDaOra: -10 })
    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('rifiuta un header Authorization assente', async () => {
    const esito = await verificaJwt(undefined, { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({ valido: false, motivo: 'header Authorization assente' })
  })

  it('rifiuta uno schema diverso da Bearer', async () => {
    const esito = await verificaJwt('Basic dXNlcjpwYXNz', { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({ valido: false, motivo: 'schema di autorizzazione non Bearer' })
  })

  it('rifiuta un token la cui firma non corrisponde alla chiave in x5c', async () => {
    const token = await creaToken({})
    const altro = creaCertificatoDiTest('altro-operatore')
    const parti = token.split('.')
    const intestazioneManomessa = Buffer.from(
      JSON.stringify({ alg: 'RS256', x5c: [altro.certificatoBase64Der] })
    ).toString('base64url')
    const manomesso = `${intestazioneManomessa}.${parti[1]}.${parti[2]}`

    const esito = await verificaJwt(`Bearer ${manomesso}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })
})
