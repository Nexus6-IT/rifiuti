import { DIMENSIONE_MASSIMA_ALLEGATO, riconosciTipoFile } from './allegato-pesa'

describe('riconosciTipoFile', () => {
  it('JPEG, PNG e PDF dal contenuto', () => {
    expect(riconosciTipoFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg')
    expect(
      riconosciTipoFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))
    ).toBe('image/png')
    expect(riconosciTipoFile(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf')
  })

  it('eseguibile, html, vuoto e troncati → null', () => {
    expect(riconosciTipoFile(Buffer.from('MZ\x90\x00'))).toBeNull()
    expect(riconosciTipoFile(Buffer.from('<html><body>'))).toBeNull()
    expect(riconosciTipoFile(Buffer.alloc(0))).toBeNull()
    expect(riconosciTipoFile(Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(riconosciTipoFile(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(riconosciTipoFile(Buffer.from('%PDF'))).toBeNull()
  })

  it('il limite è 4 MiB', () => {
    expect(DIMENSIONE_MASSIMA_ALLEGATO).toBe(4 * 1024 * 1024)
  })
})
