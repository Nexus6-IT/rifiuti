import { createPrivateKey } from 'node:crypto'

/**
 * La chiave del certificato non è RSA né EC P-256: RENTRI (come WinWaste in
 * produzione) usa solo RS256 ed ES256, quindi qualunque altro tipo o curva
 * viene rifiutato al caricamento invece di fallire alla prima firma.
 */
export class TipoChiaveNonSupportatoError extends Error {
  constructor(tipo: string) {
    super(`Tipo di chiave non supportato da RENTRI: ${tipo}`)
    this.name = 'TipoChiaveNonSupportatoError'
  }
}

/**
 * Ricava l'algoritmo JOSE dalla chiave privata (Decisione 2 del pezzo 4):
 * RSA → RS256, EC P-256 → ES256. Non è più una scelta dell'utente, perché una
 * scelta in contrasto con la chiave produrrebbe firme che RENTRI rifiuta.
 */
export function algoritmoDaChiave(privateKeyPem: string): 'RS256' | 'ES256' {
  let tipo: string | undefined
  let curva: string | undefined
  try {
    const chiave = createPrivateKey(privateKeyPem)
    tipo = chiave.asymmetricKeyType
    curva = chiave.asymmetricKeyDetails?.namedCurve
  } catch {
    // Chiave illeggibile: il messaggio non deve rivelare nulla del contenuto.
    throw new TipoChiaveNonSupportatoError('chiave privata illeggibile')
  }

  if (tipo === 'rsa') return 'RS256'
  if (tipo === 'ec') {
    // Node espone la curva P-256 con il nome OpenSSL `prime256v1`.
    if (curva === 'prime256v1') return 'ES256'
    throw new TipoChiaveNonSupportatoError(`EC ${curva ?? 'curva sconosciuta'}`)
  }
  throw new TipoChiaveNonSupportatoError(tipo ?? 'sconosciuto')
}
