import { deflateSync } from 'zlib'

const crc = (buf: Buffer): number => {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
const chunk = (tipo: string, dati: Buffer): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(dati.length)
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dati])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(corpo))
  return Buffer.concat([len, corpo, c])
}
/** PNG RGBA 8 bit valido, tutto trasparente (nessun tratto): basta per la verifica strutturale. */
export function pngDiProva(w = 300, h = 120): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const riga = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 4)])
  const raw = Buffer.concat(Array.from({ length: h }, () => riga))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

