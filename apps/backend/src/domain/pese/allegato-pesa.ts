export type TipoFileAllegato = 'image/jpeg' | 'image/png' | 'application/pdf'

export const DIMENSIONE_MASSIMA_ALLEGATO = 4 * 1024 * 1024

const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

function inizia(b: Buffer, firma: number[]): boolean {
  return b.length >= firma.length && firma.every((v, i) => b[i] === v)
}

/** Tipo del file dai primi byte (mai dal nome o dal tipo dichiarato dal client). */
export function riconosciTipoFile(b: Buffer): TipoFileAllegato | null {
  if (inizia(b, JPEG)) return 'image/jpeg'
  if (inizia(b, PNG)) return 'image/png'
  if (inizia(b, PDF)) return 'application/pdf'
  return null
}
