/** Dimensione massima del logo accettata dal backend: 256 KiB. */
export const LOGO_DIMENSIONE_MASSIMA = 256 * 1024

export type TipoLogo = 'image/png' | 'image/jpeg'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]

const parte = (b: Uint8Array, firma: number[]) => firma.every((v, i) => b[i] === v)

/** Tipo del logo dai magic bytes (mai dall'estensione), `null` se non e' PNG o JPEG. */
export function tipoLogo(byte: Uint8Array): TipoLogo | null {
  if (parte(byte, PNG)) return 'image/png'
  if (parte(byte, JPEG)) return 'image/jpeg'
  return null
}

export const MSG_LOGO_TIPO = 'Il logo deve essere un file PNG o JPEG.'
export const MSG_LOGO_TROPPO_GRANDE = 'Il logo supera i 256 KB.'

export type EsitoLogo = { base64: string } | { errore: string }

/** Controlla dimensione e tipo e converte in base64. Funzione pura, senza accesso al file. */
export function convertiLogo(byte: Uint8Array): EsitoLogo {
  if (byte.length > LOGO_DIMENSIONE_MASSIMA) return { errore: MSG_LOGO_TROPPO_GRANDE }
  if (!tipoLogo(byte)) return { errore: MSG_LOGO_TIPO }
  let binario = ''
  for (let i = 0; i < byte.length; i += 0x8000) {
    binario += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  }
  return { base64: btoa(binario) }
}

/** `data:` URL per l'anteprima, `null` se il base64 non e' un PNG o JPEG. */
export function logoComeDataUrl(base64: string | null): string | null {
  if (!base64) return null
  try {
    const tipo = tipoLogo(Uint8Array.from(atob(base64.slice(0, 16)), c => c.charCodeAt(0)))
    return tipo ? `data:${tipo};base64,${base64}` : null
  } catch {
    return null
  }
}
