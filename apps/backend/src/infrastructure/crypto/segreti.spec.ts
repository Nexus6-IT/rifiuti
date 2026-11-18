import { cifraSegreto, decifraSegreto } from './segreti'

describe('segreti (AES-256-GCM, formato iv:tag:ct)', () => {
  const chiave = 'chiave-di-prova-lunga'

  it('round-trip e formato a tre parti', () => {
    const c = cifraSegreto('{"token":"abc"}', chiave, 'SDI_CREDENTIAL_ENC_KEY')
    expect(c.split(':')).toHaveLength(3)
    expect(c).not.toContain('abc')
    expect(decifraSegreto(c, chiave, 'SDI_CREDENTIAL_ENC_KEY')).toBe('{"token":"abc"}')
  })

  it('IV casuale: due cifrature dello stesso testo differiscono', () => {
    expect(cifraSegreto('x', chiave, 'K')).not.toBe(cifraSegreto('x', chiave, 'K'))
  })

  it('tag alterato rifiutato', () => {
    const [iv, tag, ct] = cifraSegreto('dati', chiave, 'K').split(':')
    const tagAlterato = Buffer.alloc(16, 1).toString('base64')
    expect(tagAlterato).not.toBe(tag)
    expect(() => decifraSegreto(`${iv}:${tagAlterato}:${ct}`, chiave, 'K')).toThrow()
  })

  it('chiave sbagliata rifiutata', () => {
    expect(() => decifraSegreto(cifraSegreto('dati', chiave, 'K'), 'altra', 'K')).toThrow()
  })

  it('chiave vuota: errore che nomina la variabile', () => {
    expect(() => cifraSegreto('x', '', 'SDI_CREDENTIAL_ENC_KEY')).toThrow('SDI_CREDENTIAL_ENC_KEY')
    expect(() => decifraSegreto('a:b:c', '', 'SDI_CREDENTIAL_ENC_KEY')).toThrow(
      'SDI_CREDENTIAL_ENC_KEY'
    )
  })

  it('payload malformato rifiutato', () => {
    expect(() => decifraSegreto('solo-una-parte', chiave, 'K')).toThrow(
      'payload cifrato non valido'
    )
  })
})
