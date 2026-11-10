import { LOGO_DIMENSIONE_MASSIMA, esaminaLogo } from './logo'

const PNG = Buffer.from('89504e470d0a1a0a0000000d', 'hex')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const b64 = (b: Buffer) => b.toString('base64')

describe('esaminaLogo (unico controllo dei magic bytes)', () => {
  it('accetta base64 puro PNG e JPEG e ne ricava il data URL', () => {
    const png = esaminaLogo(b64(PNG))
    expect(png).toEqual({
      ok: true,
      tipo: 'image/png',
      base64: b64(PNG),
      dataUrl: `data:image/png;base64,${b64(PNG)}`,
    })
    expect(esaminaLogo(b64(JPEG))).toMatchObject({ ok: true, tipo: 'image/jpeg' })
  })

  it('accetta anche il data URL e lo riporta a base64 puro', () => {
    const r = esaminaLogo(`data:image/png;base64,${b64(PNG)}`)
    expect(r).toMatchObject({ ok: true, base64: b64(PNG) })
  })

  it('rifiuta il data URL il cui tipo dichiarato non corrisponde ai byte', () => {
    const r = esaminaLogo(`data:image/jpeg;base64,${b64(PNG)}`)
    expect(r).toMatchObject({ ok: false })
  })

  it('rifiuta byte che non sono PNG o JPEG (anche con intestazione PNG parziale)', () => {
    expect(esaminaLogo(b64(Buffer.from('questo non e un png')))).toMatchObject({ ok: false })
    expect(esaminaLogo(b64(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])))).toMatchObject({
      ok: false,
    })
    expect(esaminaLogo('data:image/svg+xml;base64,PHN2Zz4=')).toMatchObject({ ok: false })
  })

  it('rifiuta base64 non valido e vuoto', () => {
    expect(esaminaLogo('***')).toMatchObject({ ok: false })
    expect(esaminaLogo('')).toMatchObject({ ok: false })
  })

  it('rifiuta oltre 256 KiB di byte', () => {
    const grande = Buffer.concat([PNG, Buffer.alloc(LOGO_DIMENSIONE_MASSIMA)])
    expect(esaminaLogo(b64(grande))).toMatchObject({ ok: false })
    const limite = Buffer.concat([PNG, Buffer.alloc(LOGO_DIMENSIONE_MASSIMA - PNG.length)])
    expect(esaminaLogo(b64(limite))).toMatchObject({ ok: true })
  })
})
