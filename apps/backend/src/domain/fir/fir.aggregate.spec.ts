import { FIR } from './fir.aggregate'
import { DigitalSignature } from './digital-signature.vo'
import { DomainException } from '../shared/domain-exception'

/**
 * FIR Aggregate Tests - Digital Signature Workflow
 *
 * Tests for three-stage signature workflow:
 * 1. Producer signs at emission
 * 2. Carrier signs at pickup
 * 3. Receiver signs at delivery
 *
 * Business Rules:
 * - Signatures must be applied in correct order
 * - Each role can only sign once
 * - FIR becomes immutable after all signatures
 * - User must have SPID Level 2+ to sign
 */
describe('FIR Aggregate - Digital Signatures', () => {
  const mockPublicKey = 'mock-public-key-base64'

  describe('applySignature() Business Rules', () => {
    it('should accept producer signature first', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      const producerSignature = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        role: 'PRODUCER',
        signatureValue: 'producer-signature',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert-hash-1',
        documentHash: 'doc-hash',
        publicKey: mockPublicKey,
      })

      fir.applySignature(producerSignature, 'RSSMRA80A01H501U', 2)

      expect(fir.getSignatures().length).toBe(1)
      expect(fir.getSignatures()[0].getRole()).toBe('PRODUCER')
      expect(fir.getStatus()).toBe('SIGNED_BY_PRODUCER')
    })

    it('should accept carrier signature after producer', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      // Producer signs first
      const producerSig = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Producer',
        role: 'PRODUCER',
        signatureValue: 'sig1',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert1',
        documentHash: 'hash',
        publicKey: mockPublicKey,
      })
      fir.applySignature(producerSig, 'RSSMRA80A01H501U', 2)

      // Carrier signs second
      const carrierSig = DigitalSignature.create({
        signerFiscalCode: 'VRDGPP85M12H501Z',
        signerName: 'Carrier',
        role: 'CARRIER',
        signatureValue: 'sig2',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert2',
        documentHash: 'hash',
        publicKey: mockPublicKey,
      })
      fir.applySignature(carrierSig, 'VRDGPP85M12H501Z', 2)

      expect(fir.getSignatures().length).toBe(2)
      expect(fir.getStatus()).toBe('IN_TRANSIT')
    })

    it('should complete workflow with receiver signature', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      // Three-stage signing
      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'RSSMRA80A01H501U',
          signerName: 'Producer',
          role: 'PRODUCER',
          signatureValue: 'sig1',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'cert1',
          documentHash: 'hash',
          publicKey: mockPublicKey,
        }),
        'RSSMRA80A01H501U',
        2
      )

      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'VRDGPP85M01H501Z',
          signerName: 'Carrier',
          role: 'CARRIER',
          signatureValue: 'sig2',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'cert2',
          documentHash: 'hash',
          publicKey: mockPublicKey,
        }),
        'VRDGPP85M01H501Z',
        2
      )

      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'MRNMRC88E41H501W',
          signerName: 'Receiver',
          role: 'RECEIVER',
          signatureValue: 'sig3',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'cert3',
          documentHash: 'hash',
          publicKey: mockPublicKey,
        }),
        'MRNMRC88E41H501W',
        2
      )

      expect(fir.getSignatures().length).toBe(3)
      expect(fir.getStatus()).toBe('COMPLETED')
      expect(fir.isImmutable()).toBe(true)
    })

    it('should reject carrier signature before producer', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      const carrierSig = DigitalSignature.create({
        signerFiscalCode: 'VRDGPP85M01H501Z',
        signerName: 'Carrier',
        role: 'CARRIER',
        signatureValue: 'sig',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash: 'hash',
        publicKey: mockPublicKey,
      })

      expect(() => {
        fir.applySignature(carrierSig, 'VRDGPP85M01H501Z', 2)
      }).toThrow(DomainException)
      expect(() => {
        fir.applySignature(carrierSig, 'VRDGPP85M01H501Z', 2)
      }).toThrow(/Producer must sign first/)
    })

    it('should reject receiver signature before carrier', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      // Producer signs
      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'RSSMRA80A01H501U',
          signerName: 'Producer',
          role: 'PRODUCER',
          signatureValue: 'sig1',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'cert1',
          documentHash: 'hash',
          publicKey: mockPublicKey,
        }),
        'RSSMRA80A01H501U',
        2
      )

      // Try to apply receiver signature without carrier
      const receiverSig = DigitalSignature.create({
        signerFiscalCode: 'MRNMRC88E41H501W',
        signerName: 'Receiver',
        role: 'RECEIVER',
        signatureValue: 'sig',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash: 'hash',
        publicKey: mockPublicKey,
      })

      expect(() => {
        fir.applySignature(receiverSig, 'MRNMRC88E41H501W', 2)
      }).toThrow(DomainException)
      expect(() => {
        fir.applySignature(receiverSig, 'MRNMRC88E41H501W', 2)
      }).toThrow(/Carrier must sign before receiver/)
    })

    it('should reject duplicate signature from same role', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      // Producer signs once
      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'RSSMRA80A01H501U',
          signerName: 'Producer',
          role: 'PRODUCER',
          signatureValue: 'sig1',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'cert1',
          documentHash: 'hash',
          publicKey: mockPublicKey,
        }),
        'RSSMRA80A01H501U',
        2
      )

      // Try to sign again
      expect(() => {
        fir.applySignature(
          DigitalSignature.create({
            signerFiscalCode: 'RSSMRA80A01H501U',
            signerName: 'Producer',
            role: 'PRODUCER',
            signatureValue: 'sig2',
            signatureMethod: 'ECDSA-SHA256',
            certificateHash: 'cert2',
            documentHash: 'hash',
            publicKey: mockPublicKey,
          }),
          'RSSMRA80A01H501U',
          2
        )
      }).toThrow(DomainException)
      expect(() => {
        fir.applySignature(
          DigitalSignature.create({
            signerFiscalCode: 'RSSMRA80A01H501U',
            signerName: 'Producer',
            role: 'PRODUCER',
            signatureValue: 'sig2',
            signatureMethod: 'ECDSA-SHA256',
            certificateHash: 'cert2',
            documentHash: 'hash',
            publicKey: mockPublicKey,
          }),
          'RSSMRA80A01H501U',
          2
        )
      }).toThrow(/already signed/)
    })

    it('should reject signature with insufficient SPID level', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      const signature = DigitalSignature.create({
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Producer',
        role: 'PRODUCER',
        signatureValue: 'sig',
        signatureMethod: 'ECDSA-SHA256',
        certificateHash: 'cert',
        documentHash: 'hash',
        publicKey: mockPublicKey,
      })

      expect(() => {
        fir.applySignature(signature, 'RSSMRA80A01H501U', 1) // Level 1 insufficient
      }).toThrow(DomainException)
      expect(() => {
        fir.applySignature(signature, 'RSSMRA80A01H501U', 1)
      }).toThrow(/SPID Level 2 or higher required/)
    })

    it('should reject signature when FIR is immutable', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      // Complete all signatures
      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'BNCGNN90R01F205K',
          signerName: 'P',
          role: 'PRODUCER',
          signatureValue: '1',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'c1',
          documentHash: 'h',
          publicKey: mockPublicKey,
        }),
        'BNCGNN90R01F205K',
        2
      )

      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'RSSMRA80A01H501U',
          signerName: 'C',
          role: 'CARRIER',
          signatureValue: '2',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'c2',
          documentHash: 'h',
          publicKey: mockPublicKey,
        }),
        'RSSMRA80A01H501U',
        2
      )

      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'VRDGPP85M12F839X',
          signerName: 'R',
          role: 'RECEIVER',
          signatureValue: '3',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'c3',
          documentHash: 'h',
          publicKey: mockPublicKey,
        }),
        'VRDGPP85M12F839X',
        2
      )

      // FIR is now immutable
      expect(fir.isImmutable()).toBe(true)

      // Try to modify (should fail)
      expect(() => {
        fir.applySignature(
          DigitalSignature.create({
            signerFiscalCode: 'X',
            signerName: 'X',
            role: 'PRODUCER',
            signatureValue: 'x',
            signatureMethod: 'ECDSA-SHA256',
            certificateHash: 'x',
            documentHash: 'h',
            publicKey: mockPublicKey,
          }),
          'X',
          2
        )
      }).toThrow(DomainException)
    })
  })

  describe('isImmutable() Method', () => {
    it('should return false for FIR with no signatures', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      expect(fir.isImmutable()).toBe(false)
    })

    it('should return false for FIR with partial signatures', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'BNCGNN90R01F205K',
          signerName: 'P',
          role: 'PRODUCER',
          signatureValue: '1',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'c',
          documentHash: 'h',
          publicKey: mockPublicKey,
        }),
        'BNCGNN90R01F205K',
        2
      )

      expect(fir.isImmutable()).toBe(false)
    })

    it('should return true for FIR with all signatures', () => {
      const fir = FIR.create({
        id: 'fir-123',
        firNumber: 'FIR-2025-001',
        tenantId: 'tenant-123',
        producerPartitaIva: '12345678901',
        cerCode: '150101',
        quantity: 100,
        unit: 'KG',
      })

      // Apply all three signatures
      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'FRNLCA75D01L736P',
          signerName: 'P',
          role: 'PRODUCER',
          signatureValue: '1',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'c',
          documentHash: 'h',
          publicKey: mockPublicKey,
        }),
        'FRNLCA75D01L736P',
        2
      )

      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'RSSMRA80A01H501U',
          signerName: 'C',
          role: 'CARRIER',
          signatureValue: '2',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'c',
          documentHash: 'h',
          publicKey: mockPublicKey,
        }),
        'RSSMRA80A01H501U',
        2
      )

      fir.applySignature(
        DigitalSignature.create({
          signerFiscalCode: 'VRDGPP85M12F839X',
          signerName: 'R',
          role: 'RECEIVER',
          signatureValue: '3',
          signatureMethod: 'ECDSA-SHA256',
          certificateHash: 'c',
          documentHash: 'h',
          publicKey: mockPublicKey,
        }),
        'VRDGPP85M12F839X',
        2
      )

      expect(fir.isImmutable()).toBe(true)
    })
  })
})
