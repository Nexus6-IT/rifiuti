import { encryptSecret, decryptSecret } from './rentri-crypto.util'

describe('rentri-crypto.util (AES-256-GCM)', () => {
  const secret = 'super-secret-enc-key'

  it('cifra e decifra round-trip', () => {
    const plain = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----'
    const enc = encryptSecret(plain, secret)
    expect(enc).not.toContain('BEGIN PRIVATE KEY')
    expect(enc.split(':')).toHaveLength(3)
    expect(decryptSecret(enc, secret)).toBe(plain)
  })

  it('produce ciphertext diversi per stesso input (IV casuale)', () => {
    expect(encryptSecret('x', secret)).not.toBe(encryptSecret('x', secret))
  })

  it('fallisce a decifrare con secret errato', () => {
    const enc = encryptSecret('dati', secret)
    expect(() => decryptSecret(enc, 'altro-secret')).toThrow()
  })

  it('rileva la manomissione del ciphertext (auth tag GCM)', () => {
    const enc = encryptSecret('dati', secret)
    const [iv, tag] = enc.split(':')
    const tampered = `${iv}:${tag}:${Buffer.from('manomesso').toString('base64')}`
    expect(() => decryptSecret(tampered, secret)).toThrow()
  })

  it('lancia se manca il secret', () => {
    expect(() => encryptSecret('x', '')).toThrow('RENTRI_CREDENTIAL_ENC_KEY')
  })
})
