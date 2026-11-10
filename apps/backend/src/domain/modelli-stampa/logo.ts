/**
 * Unico controllo del logo dei modelli di stampa (4.7, T6). Prima c'erano due copie, una per il
 * PDF del FIR e una per la distinta, con firme PNG diverse (4 contro 8 byte): ora le usano tutti.
 *
 * Il logo si conserva come base64 PURO (colonna `logo_base64`, senza prefisso `data:`); pdfmake
 * vuole invece un data URL, che si ricava qui. Per tolleranza si accetta anche il data URL in
 * ingresso. Il formato si riconosce dai byte reali, mai dall'intestazione dichiarata dal client.
 */

/** Dimensione massima del logo, in byte decodificati. */
export const LOGO_DIMENSIONE_MASSIMA = 256 * 1024

export type TipoLogo = 'image/png' | 'image/jpeg'

export type EsitoLogo =
  | { ok: true; tipo: TipoLogo; base64: string; dataUrl: string }
  | { ok: false; motivo: string }

export const MSG_LOGO_FORMATO = 'il logo deve essere un PNG o JPEG in base64'
export const MSG_LOGO_NON_CORRISPONDE = 'il contenuto del logo non corrisponde al formato'
export const MSG_LOGO_TROPPO_GRANDE = 'il logo supera i 256 KiB'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const DATA_URL = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/i

function tipoDaByte(byte: Buffer): TipoLogo | null {
  if (byte.length >= PNG.length && byte.subarray(0, PNG.length).equals(PNG)) return 'image/png'
  if (byte.length >= 3 && byte[0] === 0xff && byte[1] === 0xd8 && byte[2] === 0xff) {
    return 'image/jpeg'
  }
  return null
}

/** Esamina un logo (base64 puro o data URL): formato dai magic bytes, dimensione, coerenza. */
export function esaminaLogo(valore: string): EsitoLogo {
  let dichiarato: string | null = null
  let base64 = valore
  const d = DATA_URL.exec(valore)
  if (d) {
    dichiarato = d[1].toLowerCase()
    base64 = d[2]
    if (dichiarato !== 'png' && dichiarato !== 'jpeg' && dichiarato !== 'jpg') {
      return { ok: false, motivo: MSG_LOGO_FORMATO }
    }
  }
  if (base64.length === 0 || base64.length % 4 !== 0 || !BASE64.test(base64)) {
    return { ok: false, motivo: MSG_LOGO_FORMATO }
  }
  const byte = Buffer.from(base64, 'base64')
  if (byte.length > LOGO_DIMENSIONE_MASSIMA) return { ok: false, motivo: MSG_LOGO_TROPPO_GRANDE }
  const tipo = tipoDaByte(byte)
  if (!tipo) return { ok: false, motivo: MSG_LOGO_NON_CORRISPONDE }
  if (dichiarato !== null && (dichiarato === 'png') !== (tipo === 'image/png')) {
    return { ok: false, motivo: MSG_LOGO_NON_CORRISPONDE }
  }
  return { ok: true, tipo, base64, dataUrl: `data:${tipo};base64,${base64}` }
}
