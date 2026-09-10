/**
 * Base45 (RFC 9285, ex draft-faltstrom-base45): codifica scelta dall'ente
 * per il contenuto del QR di un formulario vidimato — non e' una nostra
 * scelta, e' quella richiesta dalla regola tecnica RENTRI (v.
 * `docs/audits/rentri-vidimazione-e-qr-2026-09-10.md`): "e' sempre richiesto
 * esporre il QR ottenuto codificando in Base45 l'array di byte
 * dell'attributo `qr_code_bytes`".
 *
 * Implementata a mano (algoritmo breve e ben definito, nessuna libreria
 * npm): tre caratteri per ogni coppia di byte, due caratteri per l'eventuale
 * byte dispari finale — esattamente come l'RFC descrive l'algoritmo "encode
 * base 45" (§4). Non e' un caso che l'alfabeto Base45 sia un sottoinsieme
 * del set "alfanumerico" dei QR Code (ISO/IEC 18004 §7.4.4): un testo Base45
 * si codifica nel QR senza dover ricadere sulla modalita' "byte", piu'
 * ingombrante.
 */

/** Alfabeto Base45, RFC 9285 §4: 45 caratteri, indice = valore. */
const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

const VALORE_DI: Record<string, number> = {}
for (let i = 0; i < ALFABETO.length; i++) {
  VALORE_DI[ALFABETO[i]] = i
}

/**
 * Codifica `bytes` in una stringa Base45.
 *
 * Per ogni coppia di byte `[b0, b1]`: `x = b0*256 + b1`, poi si estraggono
 * tre cifre base-45 in ordine little-endian (`c = x % 45`, `d = (x/45) % 45`,
 * `e = x / (45*45)`) e si emette `ALFABETO[c] + ALFABETO[d] + ALFABETO[e]`.
 * Un byte finale spaiato (lunghezza dispari) usa `x = b0` e produce solo due
 * caratteri (`c = x % 45`, `d = x / 45`) — RFC 9285 §4, casi "n=2"/"n=1".
 */
export function codificaBase45(bytes: Buffer | Uint8Array): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  let risultato = ''

  for (let i = 0; i < buf.length; i += 2) {
    if (i + 1 < buf.length) {
      const x = buf[i] * 256 + buf[i + 1]
      const c = x % 45
      const d = Math.floor(x / 45) % 45
      const e = Math.floor(x / (45 * 45))
      risultato += ALFABETO[c] + ALFABETO[d] + ALFABETO[e]
    } else {
      const x = buf[i]
      const c = x % 45
      const d = Math.floor(x / 45)
      risultato += ALFABETO[c] + ALFABETO[d]
    }
  }

  return risultato
}

/**
 * Decodifica una stringa Base45 nei byte originali. Inversa di
 * {@link codificaBase45}: gruppi di 3 caratteri -> 2 byte, un eventuale
 * gruppo finale di 2 caratteri -> 1 byte. Un gruppo di lunghezza diversa da
 * 2 o 3 (o un valore a 3 cifre che eccede 0xFFFF) e' Base45 non valido — RFC
 * 9285 §5 impone di rifiutarlo, non di troncarlo in silenzio.
 */
export function decodificaBase45(testo: string): Buffer {
  const byte: number[] = []

  for (let i = 0; i < testo.length; i += 3) {
    const gruppo = testo.slice(i, i + 3)
    if (gruppo.length < 2) {
      throw new Error(`Base45 non valido: lunghezza residua ${gruppo.length} (attesi 2 o 3).`)
    }

    const valori = [...gruppo].map(carattere => {
      const valore = VALORE_DI[carattere]
      if (valore === undefined) {
        throw new Error(`Base45 non valido: carattere '${carattere}' fuori alfabeto.`)
      }
      return valore
    })

    if (gruppo.length === 3) {
      const x = valori[0] + valori[1] * 45 + valori[2] * 45 * 45
      if (x > 0xffff) {
        throw new Error(`Base45 non valido: gruppo '${gruppo}' eccede 0xFFFF (${x}).`)
      }
      byte.push(Math.floor(x / 256), x % 256)
    } else {
      const x = valori[0] + valori[1] * 45
      if (x > 0xff) {
        throw new Error(`Base45 non valido: gruppo finale '${gruppo}' eccede 0xFF (${x}).`)
      }
      byte.push(x)
    }
  }

  return Buffer.from(byte)
}
