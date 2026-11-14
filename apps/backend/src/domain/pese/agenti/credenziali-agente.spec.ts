import { generateKeyPairSync } from 'crypto'
import {
  ALFABETO_CODICE,
  formattaCodice,
  generaCodice,
  generaToken,
  hashSegreto,
  improntaChiave,
  chiavePubblicaDaBase64,
  normalizzaCodice,
} from './credenziali-agente'

function chiaveRawBase64(): string {
  const { publicKey } = generateKeyPairSync('ed25519')
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return der.subarray(der.length - 32).toString('base64')
}

describe('codice di abbinamento', () => {
  it('ha 12 caratteri dell’alfabeto senza I, L, O, U', () => {
    for (let i = 0; i < 200; i++) {
      const c = generaCodice()
      expect(c).toHaveLength(12)
      for (const ch of c) expect(ALFABETO_CODICE).toContain(ch)
    }
    expect(ALFABETO_CODICE).toHaveLength(32)
    expect(ALFABETO_CODICE).not.toMatch(/[ILOU]/)
  })

  it('due codici consecutivi sono diversi', () => {
    expect(generaCodice()).not.toBe(generaCodice())
  })

  it('si mostra a gruppi XXXX-XXXX-XXXX', () => {
    expect(formattaCodice('ABCDEFGHJK23')).toBe('ABCD-EFGH-JK23')
  })

  it('normalizza spazi, trattini, maiuscole e caratteri ambigui (O→0, I/L→1)', () => {
    expect(normalizzaCodice('abcd-efgh-jk0o')).toBe('ABCDEFGHJK00')
    expect(normalizzaCodice(' ab1l efgh-jk2i ')).toBe('AB11EFGHJK21')
  })

  it('un codice generato sopravvive alla formattazione e alla normalizzazione', () => {
    const c = generaCodice()
    expect(normalizzaCodice(formattaCodice(c))).toBe(c)
  })

  it('rifiuta lunghezza o caratteri sbagliati', () => {
    expect(normalizzaCodice('ABC')).toBeNull()
    expect(normalizzaCodice('ABCDEFGHJK234')).toBeNull()
    expect(normalizzaCodice('ABCDEFGHJK2U')).toBeNull() // U non è nell'alfabeto
    expect(normalizzaCodice('ABCDEFGHJK2*')).toBeNull()
    expect(normalizzaCodice('')).toBeNull()
  })
})

describe('token', () => {
  it('ha prefisso wfpa_ e 43 caratteri base64url, e due token sono diversi', () => {
    const a = generaToken()
    expect(a).toMatch(/^wfpa_[A-Za-z0-9_-]{43}$/)
    expect(generaToken()).not.toBe(a)
  })
})

describe('hashSegreto', () => {
  it('è lo SHA-256 esadecimale (vettore noto)', () => {
    expect(hashSegreto('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})

describe('chiave pubblica', () => {
  it('ricostruisce una chiave Ed25519 da 32 byte in base64', () => {
    const k = chiavePubblicaDaBase64(chiaveRawBase64())
    expect(k).not.toBeNull()
    expect(k?.asymmetricKeyType).toBe('ed25519')
  })

  it('rifiuta base64 non valido o lunghezza diversa da 32 byte', () => {
    expect(chiavePubblicaDaBase64('non-base64!!')).toBeNull()
    expect(chiavePubblicaDaBase64(Buffer.alloc(31).toString('base64'))).toBeNull()
    expect(chiavePubblicaDaBase64(Buffer.alloc(33).toString('base64'))).toBeNull()
    expect(chiavePubblicaDaBase64('')).toBeNull()
  })

  it('l’impronta è lo SHA-256 esadecimale dei 32 byte, 64 caratteri', () => {
    const raw = chiaveRawBase64()
    const imp = improntaChiave(raw)
    expect(imp).toMatch(/^[0-9a-f]{64}$/)
    expect(improntaChiave(raw)).toBe(imp)
    expect(improntaChiave(chiaveRawBase64())).not.toBe(imp)
  })
})
