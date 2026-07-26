import { X509Certificate, verify as verificaCrypto } from 'node:crypto'

/**
 * Verifica locale della firma restituita dalla firma remota RENTRI
 * (R3 Task 3) — funzione pura, nessuna I/O, nessuna dipendenza esterna
 * (solo `node:crypto`).
 *
 * ## Cosa fa
 *
 * 1. Costruisce la chiave pubblica dal certificato X.509 letto da
 *    `GET /ca-rentri/v1.0/credentials/info`.
 * 2. Verifica che `firmaBase64` sia una firma valida su `digestToSignBase64`
 *    con quella chiave pubblica.
 *
 * ## Il suo limite, dichiarato — NON è una verifica crittografica completa
 *
 * L'algoritmo di firma dichiarato da `ca-rentri` (`sign_algo`
 * `1.2.840.10045.4.3.2`) è ECDSA su un digest **già calcolato**:
 * `digest_to_sign`, prodotto da `POST /{numero_fir}/hash`, è di per sé un
 * hash SHA-256. L'operazione crittografica reale eseguita dall'HSM RENTRI è
 * quindi presumibilmente una firma ECDSA «prehash» — nessun secondo hashing
 * dell'input.
 *
 * L'API pubblica di Node (`crypto.verify`/`crypto.createVerify`) **non offre,
 * per le chiavi EC, un modo di verificare una firma ECDSA senza ri-hashare
 * l'input**: `algorithm: null` salta l'hashing solo per Ed25519/Ed448.
 * Implementare l'operazione EC a basso livello richiederebbe una libreria
 * che non è tra le dipendenze già installate (e questo task non può
 * aggiungerne).
 *
 * Questa funzione esegue quindi la verifica disponibile con l'API standard
 * (che ri-hasha `digest_to_sign` con SHA-256 prima di verificare): un
 * controllo **indicativo**, non equivalente alla verifica prehash corretta.
 * Un esito `false` NON dimostra che la firma sia invalida, e un esito `true`
 * non dimostra la conformità all'algoritmo dichiarato dall'ente.
 *
 * ## Perché non è un gate fail-closed
 *
 * Proprio per il limite sopra, il chiamante
 * (`CompletaOperazioneConFirmaUseCase`) la invoca SEMPRE e ne registra
 * l'esito, ma un esito negativo produce un **warning, mai un blocco**:
 * l'autorità sull'esito dell'operazione resta l'ente, che lo conferma con
 * `POST /{numero_fir}/acquisizione-firma`. Bloccare su questo controllo
 * significherebbe far fallire operazioni legittime per un limite della
 * nostra libreria, non per un problema della firma.
 *
 * Restituisce `false` anche se il certificato è illeggibile o gli input non
 * sono base64 validi: qualunque anomalia è un esito negativo del controllo,
 * mai un'eccezione che interrompe il ciclo (per lo stesso motivo di cui
 * sopra — questo controllo non deve poter far fallire l'operazione).
 */
export function verificaFirmaLocale(
  certificatoBase64: string,
  digestToSignBase64: string,
  firmaBase64: string
): boolean {
  try {
    const certificato = new X509Certificate(Buffer.from(certificatoBase64, 'base64'))
    return verificaCrypto(
      'sha256',
      Buffer.from(digestToSignBase64, 'base64'),
      certificato.publicKey,
      Buffer.from(firmaBase64, 'base64')
    )
  } catch {
    return false
  }
}
