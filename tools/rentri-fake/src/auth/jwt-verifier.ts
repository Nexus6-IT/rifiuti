import { importX509, jwtVerify } from 'jose'

export interface OpzioniVerifica {
  audienceAttesa: string
  adesso?: Date
}

export type EsitoVerifica = { valido: true; soggetto: string } | { valido: false; motivo: string }

/**
 * Verifica un JWT self-issued secondo il pattern AgID ID_AUTH_REST_02 in
 * direct trust: la chiave pubblica NON viene da un registro, ma dal
 * certificato che il chiamante allega nell'header x5c. Verifichiamo quindi
 * che la firma corrisponda a quel certificato e che le claim siano coerenti.
 */
export async function verificaJwt(
  authorization: string | undefined,
  opzioni: OpzioniVerifica
): Promise<EsitoVerifica> {
  if (!authorization) {
    return { valido: false, motivo: 'header Authorization assente' }
  }

  const [schema, token] = authorization.split(' ')
  if (schema !== 'Bearer' || !token) {
    return { valido: false, motivo: 'schema di autorizzazione non Bearer' }
  }

  let intestazione: { x5c?: string[] }
  try {
    intestazione = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'))
  } catch {
    return { valido: false, motivo: 'intestazione JWT illeggibile' }
  }

  const x5c = intestazione.x5c
  if (!x5c || x5c.length === 0) {
    return { valido: false, motivo: 'header x5c assente' }
  }

  const pem = `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`

  try {
    const chiavePubblica = await importX509(pem, 'RS256')
    const { payload } = await jwtVerify(token, chiavePubblica, {
      audience: opzioni.audienceAttesa,
      currentDate: opzioni.adesso,
    })

    if (!payload.sub) {
      return { valido: false, motivo: 'claim sub assente' }
    }

    return { valido: true, soggetto: String(payload.sub) }
  } catch (errore) {
    return { valido: false, motivo: `verifica fallita: ${(errore as Error).message}` }
  }
}
