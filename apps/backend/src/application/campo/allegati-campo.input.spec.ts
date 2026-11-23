import { randomBytes } from 'crypto'
import { impronta, MAX_BYTE_FOTO_CAMPO, validaFotoCampo } from './allegati-campo.input'
import {
  FotoCampoNonValidaError,
  FotoCampoTipoNonAmmessoError,
  FotoCampoTroppoGrandeError,
} from './errori-campo'

const ID = '11111111-1111-4111-8111-111111111111'
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(50)])
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  randomBytes(50),
])

describe('validaFotoCampo', () => {
  it('accetta JPEG e PNG e porta in minuscolo id e impronta', () => {
    expect(
      validaFotoCampo({
        id: ID.toUpperCase(),
        sha256: impronta(jpeg).toUpperCase(),
        contenuto: jpeg,
      })
    ).toMatchObject({
      id: ID,
      sha256: impronta(jpeg),
      mimeType: 'image/jpeg',
    })
    expect(validaFotoCampo({ id: ID, sha256: impronta(png), contenuto: png }).mimeType).toBe(
      'image/png'
    )
  })

  it.each([
    ['senza file', { id: ID, sha256: impronta(jpeg) }],
    ['file vuoto', { id: ID, sha256: impronta(jpeg), contenuto: Buffer.alloc(0) }],
    ['id non uuid', { id: 'x', sha256: impronta(jpeg), contenuto: jpeg }],
    ['impronta corta', { id: ID, sha256: 'abc', contenuto: jpeg }],
  ])('400: %s', (_n, grezzo) => {
    expect(() => validaFotoCampo(grezzo)).toThrow(FotoCampoNonValidaError)
  })

  it('413 oltre il tetto, 415 se non e JPEG o PNG (conta il contenuto, non il nome)', () => {
    const grande = Buffer.concat([jpeg, Buffer.alloc(MAX_BYTE_FOTO_CAMPO)])
    expect(() => validaFotoCampo({ id: ID, sha256: impronta(grande), contenuto: grande })).toThrow(
      FotoCampoTroppoGrandeError
    )
    const pdf = Buffer.from('%PDF-1.4 xxxx')
    expect(() => validaFotoCampo({ id: ID, sha256: impronta(pdf), contenuto: pdf })).toThrow(
      FotoCampoTipoNonAmmessoError
    )
    const exe = Buffer.from('MZ\x90\x00 eseguibile')
    expect(() => validaFotoCampo({ id: ID, sha256: impronta(exe), contenuto: exe })).toThrow(
      FotoCampoTipoNonAmmessoError
    )
  })
})
