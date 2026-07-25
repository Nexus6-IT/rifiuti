import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import {
  creaCertificatoDiTest,
  creaCertificatoAutofirmato,
  creaCertificatoAltraCa,
  creaCertificatoScaduto,
} from './aiuti/certificati'
import { verificaJwt, RegistroReplayMemoria } from '../src/auth/jwt-verifier'
import { accreditaSoggetto } from '../src/auth/soggetti-accreditati'

const AUDIENCE = 'rentrigov.demo.api'

async function creaToken(opzioni: {
  audience?: string
  scadenzaSecondiDaOra?: number
  includiX5c?: boolean
  certificato?: { chiavePrivataPem: string; certificatoBase64Der: string }
  soggetto?: string
  jti?: string | null
  iat?: boolean
  exp?: boolean
  alg?: string
}): Promise<string> {
  const { chiavePrivataPem, certificatoBase64Der } =
    opzioni.certificato ?? creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  const intestazione: Record<string, unknown> = { alg: opzioni.alg ?? 'RS256' }
  if (opzioni.includiX5c !== false) {
    intestazione.x5c = [certificatoBase64Der]
  }

  let costruttore = new SignJWT({})
    .setProtectedHeader(intestazione as never)
    .setIssuer(opzioni.soggetto ?? 'operatore-test')
    .setSubject(opzioni.soggetto ?? 'operatore-test')
    .setAudience(opzioni.audience ?? AUDIENCE)

  if (opzioni.exp !== false) {
    costruttore = costruttore.setExpirationTime(`${opzioni.scadenzaSecondiDaOra ?? 300}s`)
  }
  if (opzioni.iat !== false) {
    costruttore = costruttore.setIssuedAt()
  }
  if (opzioni.jti !== null) {
    costruttore = costruttore.setJti(opzioni.jti ?? randomUUID())
  }

  return costruttore.sign(chiave)
}

describe('Verifica JWT ID_AUTH_REST_02', () => {
  it('accetta un JWT self-issued valido con x5c corretto (certificato emesso dalla CA di prova)', async () => {
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
    accreditaSoggetto('altro-operatore')
    const parti = token.split('.')
    const intestazioneManomessa = Buffer.from(
      JSON.stringify({ alg: 'RS256', x5c: [altro.certificatoBase64Der] })
    ).toString('base64url')
    const manomesso = `${intestazioneManomessa}.${parti[1]}.${parti[2]}`

    const esito = await verificaJwt(`Bearer ${manomesso}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  // --- FEDELTA.md §5.2 punto 1: catena del certificato ---------------------

  it('RIFIUTA un certificato autofirmato al volo, non emesso dalla CA di prova', async () => {
    const certificato = creaCertificatoAutofirmato()
    accreditaSoggetto('operatore-inventato')
    const token = await creaToken({ certificato, soggetto: 'operatore-inventato' })

    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('RIFIUTA un certificato emesso da un\'altra CA (non autofirmato, ancora di fiducia sbagliata)', async () => {
    const certificato = creaCertificatoAltraCa()
    accreditaSoggetto('operatore-altra-ca')
    const token = await creaToken({ certificato, soggetto: 'operatore-altra-ca' })

    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('RIFIUTA un certificato emesso dalla CA di prova ma scaduto da 300 giorni', async () => {
    const certificato = creaCertificatoScaduto('operatore-scaduto', 300)
    accreditaSoggetto('operatore-scaduto')
    const token = await creaToken({ certificato, soggetto: 'operatore-scaduto' })

    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('accetta un certificato emesso dalla CA di prova per un soggetto accreditato', async () => {
    const certificato = creaCertificatoDiTest('operatore-buono')
    accreditaSoggetto('operatore-buono')
    const token = await creaToken({ certificato, soggetto: 'operatore-buono' })

    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({ valido: true, soggetto: 'operatore-buono' })
  })

  // --- FEDELTA.md §5.2 punto 2: algoritmo vincolato -------------------------

  it('RIFIUTA alg: none (controllo esplicito, non effetto collaterale del parsing)', async () => {
    const { certificatoBase64Der } = creaCertificatoDiTest()
    const intestazione = Buffer.from(
      JSON.stringify({ alg: 'none', x5c: [certificatoBase64Der] })
    ).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'operatore-test',
        iss: 'operatore-test',
        aud: AUDIENCE,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: randomUUID(),
      })
    ).toString('base64url')
    const token = `${intestazione}.${payload}.`

    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('RIFIUTA un token firmato con PS256 (algoritmo diverso da RS256)', async () => {
    const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
    const chiave = await importPKCS8(chiavePrivataPem, 'PS256')

    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'PS256', x5c: [certificatoBase64Der] } as never)
      .setIssuer('operatore-test')
      .setSubject('operatore-test')
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('300s')
      .setJti(randomUUID())
      .sign(chiave)

    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  // --- FEDELTA.md §5.2 punto 3: claim ModI e anti-replay --------------------

  it('RIFIUTA un token privo di iat/exp/jti (oggi perpetuo e rigiocabile)', async () => {
    const token = await creaToken({ iat: false, exp: false, jti: null })

    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('RIFIUTA un token con finestra iat/exp piu ampia di 5 minuti', async () => {
    const token = await creaToken({ scadenzaSecondiDaOra: 3600 })
    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('RIFIUTA il riutilizzo dello stesso jti (anti-replay)', async () => {
    const registroReplay = new RegistroReplayMemoria()
    const jti = randomUUID()
    const token = await creaToken({ jti })

    const primo = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE, registroReplay })
    const secondo = await verificaJwt(`Bearer ${token}`, {
      audienceAttesa: AUDIENCE,
      registroReplay,
    })

    expect(primo.valido).toBe(true)
    expect(secondo.valido).toBe(false)
  })

  it('accetta due token distinti (jti diversi) con lo stesso registro replay', async () => {
    const registroReplay = new RegistroReplayMemoria()
    const primoToken = await creaToken({})
    const secondoToken = await creaToken({})

    const primo = await verificaJwt(`Bearer ${primoToken}`, {
      audienceAttesa: AUDIENCE,
      registroReplay,
    })
    const secondo = await verificaJwt(`Bearer ${secondoToken}`, {
      audienceAttesa: AUDIENCE,
      registroReplay,
    })

    expect(primo.valido).toBe(true)
    expect(secondo.valido).toBe(true)
  })

  // --- FEDELTA.md §5.2 punto 4: elenco dei soggetti accreditati -------------

  it("RIFIUTA un soggetto non presente nell'elenco degli accreditati", async () => {
    const certificato = creaCertificatoDiTest('soggetto-non-accreditato')
    const token = await creaToken({ certificato, soggetto: 'soggetto-non-accreditato' })

    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({
      valido: false,
      motivo: "soggetto 'soggetto-non-accreditato' non accreditato presso RENTRI",
    })
  })
})
