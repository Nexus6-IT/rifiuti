import { deflateSync } from 'zlib'

const crc = (buf: Buffer): number => {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
export const chunkPng = (tipo: string, dati: Buffer): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(dati.length)
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(corpo))
  return Buffer.concat([len, corpo, c])
}
const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** PNG con CRC e struttura giusti ma contenuto IDAT scelto dal chiamante. */
export function pngConIdat(
  idat: Buffer,
  w = 300,
  h = 120,
  profondita = 8,
  tipoColore = 6,
  interlaccio = 0
): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = profondita
  ihdr[9] = tipoColore
  ihdr[12] = interlaccio
  return Buffer.concat([
    MAGIC,
    chunkPng('IHDR', ihdr),
    chunkPng('IDAT', idat),
    chunkPng('IEND', Buffer.alloc(0)),
  ])
}

/** IDAT che non e' un flusso zlib: oggi fa lanciare png-js dentro una callback (crash). */
export const pngIdatNonZlib = (): Buffer => pngConIdat(Buffer.alloc(200, 7))

/** IDAT zlib valido, lunghezza esatta, ma byte di filtro 9 alla prima riga. */
export function pngFiltroNonValido(w = 300, h = 120): Buffer {
  const riga = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 4)])
  const righe = Array.from({ length: h }, () => Buffer.from(riga))
  righe[0][0] = 9
  return pngConIdat(deflateSync(Buffer.concat(righe)), w, h)
}

/** Bomba: dichiara 300x120 ma l'IDAT decompresso e' molto piu' grande. */
export const pngBomba = (): Buffer => pngConIdat(deflateSync(Buffer.alloc(50_000_000)))

/** PNG Adam7 RGBA 8 bit valido secondo la specifica (passate vuote senza scanline). */
export function pngInterlacciato(w: number, h: number): Buffer {
  const passate = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ]
  const righe: Buffer[] = []
  for (const [x0, y0, dx, dy] of passate) {
    const pw = Math.ceil((w - x0) / dx)
    const ph = Math.ceil((h - y0) / dy)
    if (pw <= 0 || ph <= 0) continue
    for (let r = 0; r < ph; r++) righe.push(Buffer.alloc(1 + pw * 4))
  }
  return pngConIdat(deflateSync(Buffer.concat(righe)), w, h, 8, 6, 1)
}
