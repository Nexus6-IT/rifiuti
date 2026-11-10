import {
  LOGO_DIMENSIONE_MASSIMA,
  MSG_LOGO_TIPO,
  MSG_LOGO_TROPPO_GRANDE,
  convertiLogo,
  logoComeDataUrl,
  tipoLogo,
} from './logo-modello'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]

describe('logo-modello', () => {
  it('riconosce PNG e JPEG dai magic bytes e rifiuta il resto', () => {
    expect(tipoLogo(Uint8Array.from(PNG))).toBe('image/png')
    expect(tipoLogo(Uint8Array.from(JPEG))).toBe('image/jpeg')
    expect(tipoLogo(Uint8Array.from([0x47, 0x49, 0x46, 0x38]))).toBeNull()
    expect(tipoLogo(new Uint8Array(0))).toBeNull()
  })

  it('converte in base64 un logo valido', () => {
    const e = convertiLogo(Uint8Array.from(PNG))
    expect(e).toEqual({ base64: btoa(String.fromCharCode(...PNG)) })
  })

  it('rifiuta un tipo diverso con messaggio italiano', () => {
    expect(convertiLogo(Uint8Array.from([1, 2, 3]))).toEqual({ errore: MSG_LOGO_TIPO })
  })

  it('accetta esattamente 256 KiB e rifiuta un byte in più', () => {
    const ok = new Uint8Array(LOGO_DIMENSIONE_MASSIMA)
    ok.set(PNG)
    expect('base64' in convertiLogo(ok)).toBeTrue()
    const troppo = new Uint8Array(LOGO_DIMENSIONE_MASSIMA + 1)
    troppo.set(PNG)
    expect(convertiLogo(troppo)).toEqual({ errore: MSG_LOGO_TROPPO_GRANDE })
  })

  it('data URL: col tipo giusto, null se vuoto o non immagine', () => {
    const b64 = btoa(String.fromCharCode(...JPEG))
    expect(logoComeDataUrl(b64)).toBe(`data:image/jpeg;base64,${b64}`)
    expect(logoComeDataUrl(null)).toBeNull()
    expect(logoComeDataUrl(btoa('testo qualunque'))).toBeNull()
    expect(logoComeDataUrl('%%%')).toBeNull()
  })
})
