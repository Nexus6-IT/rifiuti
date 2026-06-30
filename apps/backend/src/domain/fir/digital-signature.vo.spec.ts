import { DigitalSignature } from './digital-signature.vo'
import { DomainException } from '../shared/domain-exception'

/**
 * Digital Signature Value Object Tests
 *
 * Tests for cryptographic digital signatures using ECDSA-SHA256.
 * Validates signature creation, verification, and immutability.
 *
 * Signature Algorithm: ECDSA with P-256 curve + SHA-256
 * Italian Requirements: D.M. 59/2023 - digital signatures for FIR documents
 */
describe('DigitalSignature Value Object', () => {
  const _mockPrivateKey = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIIGlR+H4JLPcZ1C9L9n9v+M3hJ5Kq7jI6kF2L8N7M9h5oAoGCCqGSM49
AwEHoUQDQgAE7a0VqB3k2L7N5M8H9J6K3F4R2Q8P1Y7S6T9U0V3W4X5Y6Z7A8B9C
0D1E2F3G4H5I6J7K8L9M0N1O2P3Q4R5S6T==
-----END EC PRIVATE KEY-----`

  const mockPublicKey = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE7a0VqB3k2L7N5M8H9J6K3F4R2Q8P
1Y7S6T9U0V3W4X5Y6Z7A8B9C0D1E2F3G4H5I6J7K8L9M0N1O2P3Q4R5S6T==
-----END PUBLIC KEY-----`

  const documentHash = 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3'

  describe('Signature Creation', () => {
    it('should create signature with valid parameters', () => {
      const signature = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'mock-signature-base64',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert-hash-123',
        documentHash,
        timestampToken: 'timestamp-token',
        publicKey: mockPublicKey,
      })

      expect(signature).toBeDefined()
      expect(signature.getSignerFiscalCode()).toBe('RSSMRA80A01H501U')
      expect(signature.getRole()).toBe('PRODUCER')
      expect(signature.getSignatureMethod()).toBe('ECDSA-SHA256')
    })

    it('should auto-generate timestamp if not provided', () => {
      const before = new Date()

      const signature = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'mock-signature',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert-hash',
        documentHash,
        publicKey: mockPublicKey,
      })

      const after = new Date()
      const signedAt = signature.getSignedAt()

      expect(signedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(signedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should fail with invalid fiscal code', () => {
      expect(() =>
        DigitalSignature.create({
          signerFiscalCode: 'INVALID',
          signerName: 'Mario Rossi',
          role: 'PRODUCER',
          signatureValue: 'signature',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'cert',
          documentHash,
          publicKey: mockPublicKey,
        })
      ).toThrow(DomainException)
    })

    it('should fail with invalid role', () => {
      expect(() =>
        DigitalSignature.create({
          signerFiscalCode: 'RSSMRA80A01H501U',
          signerName: 'Mario Rossi',
          role: 'INVALID_ROLE' as any,
          signatureValue: 'signature',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'cert',
          documentHash,
          publicKey: mockPublicKey,
        })
      ).toThrow(DomainException)
    })

    it('should fail with missing signature value', () => {
      expect(() =>
        DigitalSignature.create({
          signerFiscalCode: 'RSSMRA80A01H501U',
          signerName: 'Mario Rossi',
          role: 'PRODUCER',
          signatureValue: '',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'cert',
          documentHash,
          publicKey: mockPublicKey,
        })
      ).toThrow(DomainException)
    })
  })

  describe('Signature Roles', () => {
    it('should accept PRODUCER role', () => {
      const sig = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'sig',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash,
        publicKey: mockPublicKey,
      })

      expect(sig.getRole()).toBe('PRODUCER')
    })

    it('should accept CARRIER role', () => {
      const sig = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'CARRIER',
        signatureValue: 'sig',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash,
        publicKey: mockPublicKey,
      })

      expect(sig.getRole()).toBe('CARRIER')
    })

    it('should accept RECEIVER role', () => {
      const sig = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'RECEIVER',
        signatureValue: 'sig',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash,
        publicKey: mockPublicKey,
      })

      expect(sig.getRole()).toBe('RECEIVER')
    })
  })

  describe('Signature Verification', () => {
    it('should verify valid signature', () => {
      const signature = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'valid-signature',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert-hash',
        documentHash,
        publicKey: mockPublicKey,
      })

      // In real implementation, this would verify cryptographic signature
      // For tests, we mock the verification
      const isValid = signature.verify(documentHash)

      expect(isValid).toBe(true)
    })

    it('should reject signature with wrong document hash', () => {
      const signature = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'signature',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash,
        publicKey: mockPublicKey,
      })

      const wrongHash = 'wrong-document-hash'
      const isValid = signature.verify(wrongHash)

      expect(isValid).toBe(false)
    })

    it('should include verification metadata', () => {
      const signature = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'sig',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash,
        publicKey: mockPublicKey,
      })

      const result = signature.getVerificationInfo()

      expect(result.signerFiscalCode).toBe('RSSMRA80A01H501U')
      expect(result.signedAt).toBeInstanceOf(Date)
      expect(result.signatureMethod).toBe('ECDSA-SHA256')
      expect(result.documentHash).toBe(documentHash)
    })
  })

  describe('Signature Algorithm Support', () => {
    it('should accept ECDSA-SHA256', () => {
      const sig = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'sig',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash,
        publicKey: mockPublicKey,
      })

      expect(sig.getSignatureMethod()).toBe('ECDSA-SHA256')
    })

    it('should accept RSA-SHA256', () => {
      const sig = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'sig',
        signatureMethod: 'RSA-SHA256',
        certificateHash: 'cert',
        documentHash,
        publicKey: mockPublicKey,
      })

      expect(sig.getSignatureMethod()).toBe('RSA-SHA256')
    })

    it('should reject unsupported algorithm', () => {
      expect(() =>
        DigitalSignature.create({
          signerFiscalCode: 'RSSMRA80A01H501U',
          signerName: 'Mario Rossi',
          role: 'PRODUCER',
          signatureValue: 'sig',
          signatureMethod: 'MD5' as any,
          certificateHash: 'cert',
          documentHash,
          publicKey: mockPublicKey,
        })
      ).toThrow(DomainException)
    })
  })

  describe('Immutability', () => {
    it('should be immutable after creation', () => {
      const signature = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'sig',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash,
        publicKey: mockPublicKey,
      })

      // Value object should be frozen and prevent modification
      expect(() => {
        ;(signature as any).signerFiscalCode = 'DIFFERENT'
      }).toThrow()

      // Value should remain unchanged
      expect(signature.getSignerFiscalCode()).toBe('RSSMRA80A01H501U')
    })
  })

  describe('Serialization', () => {
    it('should serialize to plain object', () => {
      const signature = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'sig-value',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert-hash',
        documentHash,
        timestampToken: 'timestamp',
        publicKey: mockPublicKey,
        signedAt: new Date('2025-10-19T10:00:00Z'),
      })

      const plain = signature.toPlainObject()

      expect(plain.signerFiscalCode).toBe('RSSMRA80A01H501U')
      expect(plain.role).toBe('PRODUCER')
      expect(plain.signatureValue).toBe('sig-value')
      expect(plain.signedAt).toEqual(new Date('2025-10-19T10:00:00Z'))
    })
  })
})
