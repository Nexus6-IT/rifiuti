/**
 * Sandbox Signature Provider — Unit Test
 *
 * Verifica che il provider sandbox:
 * 1. Generi firma ECDSA valida e verificabile
 * 2. Non esponga mai la chiave privata nell'output
 * 3. Produca hash documento riproducibili
 * 4. Restituisca isQualified=false (non è firma qualificata)
 * 5. Verifichi correttamente firme valide e invalide
 */

import { SandboxSignatureProvider } from './sandbox-signature.provider'
import { LoggerService } from '../../../core/logger/logger.service'

describe('SandboxSignatureProvider', () => {
  let provider: SandboxSignatureProvider
  let mockLogger: jest.Mocked<LoggerService>

  beforeEach(() => {
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any

    provider = new SandboxSignatureProvider(mockLogger)
  })

  describe('sign()', () => {
    it('genera un risultato di firma valido', async () => {
      const document = { firNumber: 'FIR-2026-001', cerCode: '20 03 01', quantity: 100 }

      const result = await provider.sign(document, 'user-test-123')

      expect(result.signatureValue).toBeDefined()
      expect(result.signatureValue.length).toBeGreaterThan(0)
      expect(result.documentHash).toMatch(/^[a-f0-9]{64}$/)
      expect(result.certificateHash).toMatch(/^[a-f0-9]{64}$/)
      expect(result.publicKey).toContain('BEGIN PUBLIC KEY')
    })

    it('restituisce providerType=SANDBOX e isQualified=false', async () => {
      const result = await provider.sign({ data: 'test' }, 'user-1')

      expect(result.providerType).toBe('SANDBOX')
      expect(result.isQualified).toBe(false)
    })

    it("NON espone la chiave privata nell'output", async () => {
      const result = await provider.sign({ data: 'test' }, 'user-1')

      // L'output non deve contenere alcuna chiave privata
      const json = JSON.stringify(result)
      expect(json).not.toContain('PRIVATE KEY')
      expect(json).not.toContain('privateKey')
    })

    it('produce documentHash identico per lo stesso documento', async () => {
      const document = { id: 'fir-abc', qty: 50 }
      const r1 = await provider.sign(document, 'user-1')
      const r2 = await provider.sign(document, 'user-1')

      expect(r1.documentHash).toBe(r2.documentHash)
    })

    it('produce firme diverse per la stessa doc (chiavi effimere)', async () => {
      const document = { id: 'fir-abc' }
      const r1 = await provider.sign(document, 'user-1')
      const r2 = await provider.sign(document, 'user-1')

      // Chiavi effimere diverse → firme diverse
      expect(r1.signatureValue).not.toBe(r2.signatureValue)
      expect(r1.publicKey).not.toBe(r2.publicKey)
    })

    it('accetta documenti in formato stringa JSON canonica', async () => {
      const docString = '{"data":"test","id":"fir-001"}'
      const result = await provider.sign(docString, 'user-1')

      expect(result.documentHash).toBeDefined()
      expect(result.signatureValue).toBeDefined()
    })
  })

  describe('verify()', () => {
    it('verifica correttamente una firma valida', async () => {
      const document = { firNumber: 'FIR-2026-001', quantity: 200 }
      const { documentHash, signatureValue, publicKey } = await provider.sign(document, 'user-1')

      const isValid = await provider.verify(documentHash, signatureValue, publicKey)
      expect(isValid).toBe(true)
    })

    it('rigetta firma con chiave pubblica errata', async () => {
      const document = { data: 'test' }
      const r1 = await provider.sign(document, 'user-1')
      const r2 = await provider.sign(document, 'user-2')

      // Firma di r1 verificata con chiave pubblica di r2 → invalida
      const isValid = await provider.verify(r1.documentHash, r1.signatureValue, r2.publicKey)
      expect(isValid).toBe(false)
    })

    it('rigetta firma per documento modificato', async () => {
      const original = { data: 'originale' }
      const modified = { data: 'modificato' }

      const {
        signatureValue,
        publicKey,
        documentHash: originalHash,
      } = await provider.sign(original, 'user-1')
      const modifiedHash = provider.hashDocument(modified)

      expect(originalHash).not.toBe(modifiedHash)

      const isValid = await provider.verify(modifiedHash, signatureValue, publicKey)
      expect(isValid).toBe(false)
    })

    it('rigetta firma manomessa', async () => {
      const document = { data: 'test' }
      const { documentHash, signatureValue, publicKey } = await provider.sign(document, 'user-1')

      const tampered = signatureValue.substring(0, signatureValue.length - 10) + 'XXXXXXXXXX'
      const isValid = await provider.verify(documentHash, tampered, publicKey)
      expect(isValid).toBe(false)
    })

    it('restituisce false per chiave pubblica non valida', async () => {
      const document = { data: 'test' }
      const { documentHash, signatureValue } = await provider.sign(document, 'user-1')

      const isValid = await provider.verify(documentHash, signatureValue, 'chiave-non-valida')
      expect(isValid).toBe(false)
    })
  })

  describe('hashDocument()', () => {
    it('genera hash SHA-256 (64 hex chars)', () => {
      const hash = provider.hashDocument({ firNumber: 'FIR-001', qty: 100 })
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('hash identico per documenti con stessa struttura', () => {
      const doc = { a: 1, b: 'test' }
      expect(provider.hashDocument(doc)).toBe(provider.hashDocument(doc))
    })

    it('hash diverso per documenti diversi', () => {
      const h1 = provider.hashDocument({ data: 'doc1' })
      const h2 = provider.hashDocument({ data: 'doc2' })
      expect(h1).not.toBe(h2)
    })
  })

  describe('metadati provider', () => {
    it('getProviderType restituisce SANDBOX', () => {
      expect(provider.getProviderType()).toBe('SANDBOX')
    })

    it('isQualified restituisce false', () => {
      expect(provider.isQualified()).toBe(false)
    })
  })
})
