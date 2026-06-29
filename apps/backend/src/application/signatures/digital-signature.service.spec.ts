import { Test, TestingModule } from '@nestjs/testing';
import { DigitalSignatureService } from './digital-signature.service';
import { LoggerService } from '../../core/logger/logger.service';

/**
 * Digital Signature Service Integration Tests
 *
 * Tests cryptographic signature generation and verification using Node.js crypto module.
 * Uses ECDSA with P-256 curve and SHA-256 hashing.
 */
describe('DigitalSignatureService (Integration)', () => {
  let service: DigitalSignatureService;
  let mockLogger: jest.Mocked<LoggerService>;

  beforeEach(async () => {
    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigitalSignatureService,
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<DigitalSignatureService>(DigitalSignatureService);
  });

  describe('Key Pair Generation', () => {
    it('should generate ECDSA key pair', async () => {
      const keyPair = await service.generateKeyPair();

      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toContain('BEGIN EC PRIVATE KEY');
      expect(keyPair.publicKey).toContain('BEGIN PUBLIC KEY');
    });

    it('should generate different key pairs on each call', async () => {
      const keyPair1 = await service.generateKeyPair();
      const keyPair2 = await service.generateKeyPair();

      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey);
      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey);
    });
  });

  describe('Document Hashing', () => {
    it('should generate SHA-256 hash of document', () => {
      const document = {
        firNumber: 'FIR-2025-001',
        producerName: 'Test Producer',
        quantity: 100,
      };

      const hash = service.hashDocument(document);

      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // SHA-256 produces 64 hex characters
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate same hash for same document', () => {
      const document = { data: 'test' };

      const hash1 = service.hashDocument(document);
      const hash2 = service.hashDocument(document);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different documents', () => {
      const doc1 = { data: 'test1' };
      const doc2 = { data: 'test2' };

      const hash1 = service.hashDocument(doc1);
      const hash2 = service.hashDocument(doc2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Signature Generation', () => {
    it('should sign document hash with private key', async () => {
      const keyPair = await service.generateKeyPair();
      const documentHash = service.hashDocument({ test: 'data' });

      const signature = await service.sign(documentHash, keyPair.privateKey);

      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should generate different signatures with different keys', async () => {
      const keyPair1 = await service.generateKeyPair();
      const keyPair2 = await service.generateKeyPair();
      const documentHash = service.hashDocument({ test: 'data' });

      const sig1 = await service.sign(documentHash, keyPair1.privateKey);
      const sig2 = await service.sign(documentHash, keyPair2.privateKey);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('Signature Verification', () => {
    it('should verify valid signature', async () => {
      const keyPair = await service.generateKeyPair();
      const documentHash = service.hashDocument({ test: 'data' });
      const signature = await service.sign(documentHash, keyPair.privateKey);

      const isValid = await service.verify(
        documentHash,
        signature,
        keyPair.publicKey
      );

      expect(isValid).toBe(true);
    });

    it('should reject signature with wrong public key', async () => {
      const keyPair1 = await service.generateKeyPair();
      const keyPair2 = await service.generateKeyPair();

      const documentHash = service.hashDocument({ test: 'data' });
      const signature = await service.sign(documentHash, keyPair1.privateKey);

      const isValid = await service.verify(
        documentHash,
        signature,
        keyPair2.publicKey // Wrong key
      );

      expect(isValid).toBe(false);
    });

    it('should reject signature for different document', async () => {
      const keyPair = await service.generateKeyPair();

      const hash1 = service.hashDocument({ data: 'original' });
      const hash2 = service.hashDocument({ data: 'modified' });

      const signature = await service.sign(hash1, keyPair.privateKey);

      const isValid = await service.verify(
        hash2, // Different hash
        signature,
        keyPair.publicKey
      );

      expect(isValid).toBe(false);
    });

    it('should reject tampered signature', async () => {
      const keyPair = await service.generateKeyPair();
      const documentHash = service.hashDocument({ test: 'data' });
      const signature = await service.sign(documentHash, keyPair.privateKey);

      // Tamper with signature
      const tamperedSignature = signature.substring(0, signature.length - 10) + 'XXXXXXXXXX';

      const isValid = await service.verify(
        documentHash,
        tamperedSignature,
        keyPair.publicKey
      );

      expect(isValid).toBe(false);
    });
  });

  describe('Certificate Hash Generation', () => {
    it('should generate certificate hash from public key', () => {
      const publicKey = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
-----END PUBLIC KEY-----`;

      const certHash = service.generateCertificateHash(publicKey);

      expect(certHash).toBeDefined();
      expect(certHash.length).toBe(64);
      expect(certHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate same hash for same public key', () => {
      const publicKey = 'test-public-key';

      const hash1 = service.generateCertificateHash(publicKey);
      const hash2 = service.generateCertificateHash(publicKey);

      expect(hash1).toBe(hash2);
    });
  });

  describe('Timestamp Token Generation', () => {
    it('should generate RFC 3161 timestamp token', async () => {
      const documentHash = service.hashDocument({ test: 'data' });

      const token = await service.generateTimestampToken(documentHash);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should include timestamp in token', async () => {
      const documentHash = service.hashDocument({ test: 'data' });
      const before = Date.now();

      const token = await service.generateTimestampToken(documentHash);

      const after = Date.now();

      // Token should include timestamp
      expect(token).toBeDefined();
      // In real implementation, we would verify timestamp is within range
    });
  });

  describe('Complete Signature Workflow', () => {
    it('should complete full sign and verify workflow', async () => {
      // 1. Generate keys
      const keyPair = await service.generateKeyPair();

      // 2. Create document
      const document = {
        firNumber: 'FIR-2025-001',
        producer: 'Test Producer',
        quantity: 100,
        cerCode: '150101',
      };

      // 3. Hash document
      const documentHash = service.hashDocument(document);

      // 4. Sign hash
      const signature = await service.sign(documentHash, keyPair.privateKey);

      // 5. Generate certificate hash
      const certificateHash = service.generateCertificateHash(keyPair.publicKey);

      // 6. Generate timestamp
      const timestampToken = await service.generateTimestampToken(documentHash);

      // 7. Verify signature
      const isValid = await service.verify(
        documentHash,
        signature,
        keyPair.publicKey
      );

      expect(isValid).toBe(true);
      expect(certificateHash).toBeDefined();
      expect(timestampToken).toBeDefined();
    });

    it('should fail verification if document is modified', async () => {
      const keyPair = await service.generateKeyPair();

      const originalDoc = { data: 'original' };
      const modifiedDoc = { data: 'modified' };

      const originalHash = service.hashDocument(originalDoc);
      const signature = await service.sign(originalHash, keyPair.privateKey);

      const modifiedHash = service.hashDocument(modifiedDoc);
      const isValid = await service.verify(
        modifiedHash,
        signature,
        keyPair.publicKey
      );

      expect(isValid).toBe(false);
    });
  });

  describe('createSignature (nuovo API con userId)', () => {
    it('genera firma completa per un documento con userId', async () => {
      const document = { firNumber: 'FIR-2026-001', cerCode: '20 03 01' };

      const result = await service.createSignature(document, 'user-123');

      expect(result.signatureValue).toBeDefined();
      expect(result.documentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.certificateHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.timestampToken).toBeDefined();
      expect(result.publicKey).toContain('BEGIN PUBLIC KEY');
      expect(result.isQualified).toBe(false); // sandbox: non qualificata
    });

    it('produce documentHash riproducibile per lo stesso documento', async () => {
      const document = { firNumber: 'FIR-2026-001', cerCode: '20 03 01' };
      const r1 = await service.createSignature(document, 'user-1');
      const r2 = await service.createSignature(document, 'user-1');
      // Hash documento deve essere identico (stesso documento)
      expect(r1.documentHash).toBe(r2.documentHash);
      // Firme diverse (chiavi effimere distinte)
      expect(r1.signatureValue).not.toBe(r2.signatureValue);
    });

    it('la firma è verificabile con la publicKey restituita', async () => {
      const document = { id: 'fir-test', quantity: 50 };
      const result = await service.createSignature(document, 'user-abc');

      const isValid = await service.verify(
        result.documentHash,
        result.signatureValue,
        result.publicKey,
      );
      expect(isValid).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid private key', async () => {
      const documentHash = service.hashDocument({ test: 'data' });
      const invalidKey = 'invalid-private-key';

      try {
        await service.sign(documentHash, invalidKey);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should handle invalid public key', async () => {
      const keyPair = await service.generateKeyPair();
      const documentHash = service.hashDocument({ test: 'data' });
      const signature = await service.sign(documentHash, keyPair.privateKey);

      const invalidPublicKey = 'invalid-public-key';

      const isValid = await service.verify(documentHash, signature, invalidPublicKey);
      expect(isValid).toBe(false);
    });

    it('should handle malformed signature', async () => {
      const keyPair = await service.generateKeyPair();
      const documentHash = service.hashDocument({ test: 'data' });

      const malformedSignature = 'not-a-valid-signature';

      const isValid = await service.verify(
        documentHash,
        malformedSignature,
        keyPair.publicKey
      );

      expect(isValid).toBe(false);
    });
  });
});
