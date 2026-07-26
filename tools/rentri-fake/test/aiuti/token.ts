import { randomUUID } from 'crypto'
import { importPKCS8, SignJWT } from 'jose'
import { creaCertificatoDiTest } from './certificati'

/**
 * Token JWT self-issued valido secondo ID_AUTH_REST_02, per il soggetto
 * accreditato di default (`operatore-test`). Condiviso dai test di
 * `codifiche`/`anagrafiche` (Task 1 R4): un jti diverso ad ogni chiamata,
 * mai riutilizzato (v. formulari.test.ts, stesso principio anti-replay).
 */
export async function tokenValido(): Promise<string> {
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

export async function intestazioniAutenticate(): Promise<{ authorization: string }> {
  return { authorization: `Bearer ${await tokenValido()}` }
}
