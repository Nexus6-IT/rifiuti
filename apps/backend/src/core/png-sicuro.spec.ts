import { deflateSync } from 'zlib'
import { pngDiProva } from '../test-support/png-di-prova'
import {
  chunkPng,
  pngBomba,
  pngConIdat,
  pngFiltroNonValido,
  pngIdatNonZlib,
  pngInterlacciato,
} from '../test-support/png-malevoli'
import { leggiPngSicuro, ricodificaPng } from './png-sicuro'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('leggiPngSicuro', () => {
  it('accetta un PNG RGBA valido e ricodifica un PNG a sua volta valido', () => {
    const e = leggiPngSicuro(pngDiProva(300, 120))
    expect(e.ok).toBe(true)
    if (!e.ok) return
    expect(e.png.larghezza).toBe(300)
    const r = leggiPngSicuro(ricodificaPng(e.png))
    expect(r.ok).toBe(true)
  })

  it('accetta il PNG 1x1 reale', () => {
    expect(leggiPngSicuro(PNG_1X1).ok).toBe(true)
  })

  it('rifiuta IDAT che non e zlib', () => {
    expect(leggiPngSicuro(pngIdatNonZlib()).ok).toBe(false)
  })

  it('rifiuta un byte di filtro non valido', () => {
    expect(leggiPngSicuro(pngFiltroNonValido()).ok).toBe(false)
  })

  it('rifiuta una bomba di decompressione senza allocarla', () => {
    expect(leggiPngSicuro(pngBomba()).ok).toBe(false)
  })

  it('rifiuta lunghezza errata (corta e lunga)', () => {
    const corta = pngConIdat(deflateSync(Buffer.alloc(100)))
    expect(leggiPngSicuro(corta).ok).toBe(false)
    const lunga = pngConIdat(deflateSync(Buffer.alloc(300 * 120 * 4 + 120 + 1)))
    expect(leggiPngSicuro(lunga).ok).toBe(false)
  })

  it('rifiuta CRC alterato, dati dopo IEND, IDAT non contigui e troncamenti', () => {
    const ok = pngDiProva()
    const crcRotto = Buffer.from(ok)
    crcRotto[crcRotto.length - 20] ^= 0xff
    expect(leggiPngSicuro(crcRotto).ok).toBe(false)
    expect(leggiPngSicuro(Buffer.concat([ok, Buffer.from([0])])).ok).toBe(false)
    expect(leggiPngSicuro(ok.subarray(0, ok.length - 5)).ok).toBe(false)
    expect(leggiPngSicuro(ok.subarray(0, 20)).ok).toBe(false)
    const raw = deflateSync(Buffer.concat(Array.from({ length: 120 }, () => Buffer.alloc(1201))))
    const meta = Math.floor(raw.length / 2)
    const separati = Buffer.concat([
      ok.subarray(0, 33),
      chunkPng('IDAT', raw.subarray(0, meta)),
      chunkPng('tEXt', Buffer.from('a\0b')),
      chunkPng('IDAT', raw.subarray(meta)),
      chunkPng('IEND', Buffer.alloc(0)),
    ])
    expect(leggiPngSicuro(separati).ok).toBe(false)
  })

  it('accetta IDAT contigui concatenati', () => {
    const ok = pngDiProva(60, 30)
    const raw = deflateSync(Buffer.concat(Array.from({ length: 30 }, () => Buffer.alloc(241))))
    const meta = Math.floor(raw.length / 2)
    const spezzato = Buffer.concat([
      ok.subarray(0, 33),
      chunkPng('IDAT', raw.subarray(0, meta)),
      chunkPng('IDAT', raw.subarray(meta)),
      chunkPng('IEND', Buffer.alloc(0)),
    ])
    expect(leggiPngSicuro(spezzato).ok).toBe(true)
  })

  it('rifiuta combinazioni colore/profondita non valide e palette senza PLTE', () => {
    expect(leggiPngSicuro(pngConIdat(deflateSync(Buffer.alloc(10)), 3, 3, 8, 5)).ok).toBe(false)
    expect(leggiPngSicuro(pngConIdat(deflateSync(Buffer.alloc(100)), 3, 3, 8, 3)).ok).toBe(false)
    expect(leggiPngSicuro(pngConIdat(deflateSync(Buffer.alloc(10)), 3, 3, 3, 2)).ok).toBe(false)
  })

  it('rifiuta ogni PNG interlacciato (png-js perde l allineamento sulle passate vuote)', () => {
    for (const [w, h] of [
      [3, 3],
      [1, 8],
      [8, 8],
    ]) {
      expect(leggiPngSicuro(pngInterlacciato(w, h)).ok).toBe(false)
    }
  })
})
