/**
 * Lettura SICURA di un PNG prima di darlo al motore PDF.
 *
 * Il motore (pdfkit/png-js) decodifica i pixel in una callback asincrona di zlib: un IDAT corrotto o
 * un byte di filtro non valido lanciano li' dentro, l'eccezione NON risale alla Promise e diventa
 * `uncaughtException` (cade il processo, per tutte le aziende). Quindi un PNG proveniente da fuori
 * si verifica QUI, in modo sincrono, e solo se passa lo si consegna al motore.
 *
 * Controlli: magic, sequenza dei chunk (IHDR primo, IEND ultimo e unico, niente dopo), CRC di ogni
 * chunk, IHDR coerente, PLTE per i PNG a palette, IDAT contigui concatenati, inflate con tetto
 * sull'uscita pari alla dimensione attesa (niente bombe di decompressione), lunghezza esatta e
 * byte di filtro di ogni riga in 0..4. Supporta tutti i tipi di colore, le profondita' e Adam7.
 */
import { deflateSync, inflateSync } from 'zlib'

const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** Tetto di sicurezza sui byte decompressi (indipendente dal chiamante). */
export const BYTE_DECOMPRESSI_MASSIMI = 64 * 1024 * 1024

export interface PngVerificato {
  larghezza: number
  altezza: number
  profonditaBit: number
  tipoColore: number
  interlacciato: boolean
  /** Scanline decompresse (filtri inclusi), di lunghezza esattamente pari all'attesa. */
  raw: Buffer
}

export type EsitoPngSicuro = { ok: true; png: PngVerificato } | { ok: false; motivo: string }

const CANALI: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const PROFONDITA_AMMESSE: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}
/** Adam7: [x0, y0, dx, dy]. */
const ADAM7: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
]

const TABELLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = TABELLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const no = (motivo: string): EsitoPngSicuro => ({ ok: false, motivo })

/** Righe (lunghezza in byte, senza il byte di filtro) di ogni passata, nell'ordine di lettura. */
function righe(w: number, h: number, bppBit: number, interlacciato: boolean): number[] {
  const passate = interlacciato ? ADAM7 : ([[0, 0, 1, 1]] as const)
  const out: number[] = []
  for (const [x0, y0, dx, dy] of passate) {
    const pw = Math.ceil((w - x0) / dx)
    const ph = Math.ceil((h - y0) / dy)
    if (pw <= 0 || ph <= 0) continue
    const lung = Math.ceil((pw * bppBit) / 8)
    for (let r = 0; r < ph; r++) out.push(lung)
  }
  return out
}

/** Dimensione attesa delle scanline decompresse, senza allocare (calcolo per passata). */
function dimensioneAttesa(w: number, h: number, bppBit: number, interlacciato: boolean): number {
  const passate = interlacciato ? ADAM7 : ([[0, 0, 1, 1]] as const)
  let tot = 0
  for (const [x0, y0, dx, dy] of passate) {
    const pw = Math.ceil((w - x0) / dx)
    const ph = Math.ceil((h - y0) / dy)
    if (pw <= 0 || ph <= 0) continue
    tot += ph * (1 + Math.ceil((pw * bppBit) / 8))
  }
  return tot
}

export function leggiPngSicuro(buf: Buffer): EsitoPngSicuro {
  if (buf.length < 8 + 25 + 12 || !buf.subarray(0, 8).equals(MAGIC)) return no('non è un PNG')
  let pos = 8
  let ihdr: Buffer | null = null
  let plte = false
  let iend = false
  let ultimoIdat = false
  const idat: Buffer[] = []
  let primo = true
  while (pos < buf.length) {
    if (iend) return no('dati dopo IEND')
    if (pos + 12 > buf.length) return no('chunk troncato')
    const len = buf.readUInt32BE(pos)
    if (len > 0x7fffffff || pos + 12 + len > buf.length) return no('chunk troncato')
    const tipo = buf.subarray(pos + 4, pos + 8).toString('latin1')
    const corpo = buf.subarray(pos + 4, pos + 8 + len)
    if (crc32(corpo) !== buf.readUInt32BE(pos + 8 + len)) return no('CRC non valido')
    const dati = buf.subarray(pos + 8, pos + 8 + len)
    if (primo) {
      if (tipo !== 'IHDR' || len !== 13) return no('IHDR mancante')
      ihdr = dati
      primo = false
    } else if (tipo === 'IHDR') {
      return no('IHDR duplicato')
    } else if (tipo === 'IDAT') {
      if (idat.length > 0 && !ultimoIdat) return no('IDAT non contigui')
      idat.push(dati)
      ultimoIdat = true
    } else {
      if (idat.length > 0) ultimoIdat = false
      if (tipo === 'PLTE') {
        if (plte || idat.length > 0 || len === 0 || len % 3 !== 0 || len > 768) {
          return no('PLTE non valida')
        }
        plte = true
      } else if (tipo === 'IEND') {
        if (len !== 0) return no('IEND non valido')
        iend = true
      }
    }
    pos += 12 + len
  }
  if (!iend || ihdr === null) return no('PNG incompleto')
  if (idat.length === 0) return no('IDAT mancante')

  const w = ihdr.readUInt32BE(0)
  const h = ihdr.readUInt32BE(4)
  const profondita = ihdr[8]
  const tipoColore = ihdr[9]
  if (w === 0 || h === 0 || w > 0x7fffffff || h > 0x7fffffff) return no('dimensioni non valide')
  if (!PROFONDITA_AMMESSE[tipoColore]?.includes(profondita)) return no('formato non valido')
  if (ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] > 1) return no('IHDR non valido')
  if (tipoColore === 3 && !plte) return no('palette mancante')
  const interlacciato = ihdr[12] === 1
  // png-js (usato da pdfkit) perde l'allineamento sulle passate Adam7 vuote (immagini strette) e
  // lancia in una callback: i PNG interlacciati, rari, non si accettano mai.
  if (interlacciato) return no('PNG interlacciato non supportato')
  const bppBit = CANALI[tipoColore] * profondita
  const attesa = dimensioneAttesa(w, h, bppBit, interlacciato)
  if (attesa > BYTE_DECOMPRESSI_MASSIMI) return no('immagine troppo grande')

  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: attesa })
  } catch {
    return no('dati immagine non validi')
  }
  if (raw.length !== attesa) return no('dati immagine di lunghezza errata')
  let off = 0
  for (const lung of righe(w, h, bppBit, interlacciato)) {
    if (raw[off] > 4) return no('filtro non valido')
    off += 1 + lung
  }
  return {
    ok: true,
    png: {
      larghezza: w,
      altezza: h,
      profonditaBit: profondita,
      tipoColore,
      interlacciato,
      raw,
    },
  }
}

function chunk(tipo: string, dati: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(dati.length)
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dati])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(corpo))
  return Buffer.concat([len, corpo, crc])
}

/**
 * Rigenera un PNG minimo (IHDR + un solo IDAT + IEND) da pixel gia' verificati: nessun byte del
 * file ricevuto arriva al motore PDF. Per i PNG a palette non e' utilizzabile (la PLTE si perde):
 * serve solo alle firme (colore 2 o 6).
 */
export function ricodificaPng(p: PngVerificato): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(p.larghezza, 0)
  ihdr.writeUInt32BE(p.altezza, 4)
  ihdr[8] = p.profonditaBit
  ihdr[9] = p.tipoColore
  ihdr[12] = p.interlacciato ? 1 : 0
  return Buffer.concat([
    MAGIC,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(p.raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
