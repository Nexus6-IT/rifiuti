import { Injectable } from '@nestjs/common';
import { createHash, generateKeyPairSync, sign, verify, KeyObject } from 'crypto';
import { LoggerService } from '../../core/logger/logger.service';

/**
 * Digital Signature Service
 *
 * Provides cryptographic operations for FIR digital signatures:
 * - ECDSA key pair generation (P-256 curve)
 * - SHA-256 document hashing
 * - ECDSA-SHA256 signature generation and verification
 * - RFC 3161 timestamp token generation
 * - Certificate hash generation
 *
 * Uses Node.js crypto module for Italian legal compliance (D.M. 59/2023)
 */
@Injectable()
export class DigitalSignatureService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(DigitalSignatureService.name);
  }

  /**
   * Generate ECDSA key pair using P-256 curve
   *
   * Returns PEM-formatted keys:
   * - Private key: EC PRIVATE KEY format
   * - Public key: PUBLIC KEY format
   */
  async generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
    this.logger.debug('Generating ECDSA key pair with P-256 curve');

    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1', // P-256 curve (also known as secp256r1)
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'sec1',
        format: 'pem',
      },
    });

    this.logger.debug('ECDSA key pair generated successfully');

    return {
      privateKey: privateKey as string,
      publicKey: publicKey as string,
    };
  }

  /**
   * Hash document using SHA-256
   *
   * Converts document object to canonical JSON and computes SHA-256 hash.
   * Returns hex-encoded hash (64 characters).
   *
   * @param document - FIR document or any object to hash
   * @returns SHA-256 hash as hex string
   */
  hashDocument(document: any): string {
    // Convert to canonical JSON (sorted keys for consistent hashing)
    const canonical = JSON.stringify(document, Object.keys(document).sort());

    const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');

    this.logger.debug(`Document hashed: ${hash.substring(0, 16)}...`);

    return hash;
  }

  /**
   * Sign document hash with private key using ECDSA-SHA256
   *
   * @param documentHash - SHA-256 hash of document (hex string)
   * @param privateKey - PEM-formatted EC private key
   * @returns Base64-encoded signature
   */
  async sign(documentHash: string, privateKey: string): Promise<string> {
    this.logger.debug('Signing document hash with ECDSA-SHA256');

    try {
      // Convert hex hash to buffer
      const hashBuffer = Buffer.from(documentHash, 'hex');

      // Sign using ECDSA with SHA-256
      const signature = sign('sha256', hashBuffer, {
        key: privateKey,
        format: 'pem',
      });

      // Encode as base64 for storage
      const signatureBase64 = signature.toString('base64');

      this.logger.debug('Document signed successfully');

      return signatureBase64;
    } catch (error) {
      this.logger.error('Failed to sign document', error);
      throw new Error(`Signature generation failed: ${error.message}`);
    }
  }

  /**
   * Verify signature against document hash using public key
   *
   * @param documentHash - SHA-256 hash of document (hex string)
   * @param signatureBase64 - Base64-encoded signature
   * @param publicKey - PEM-formatted public key
   * @returns true if signature is valid, false otherwise
   */
  async verify(
    documentHash: string,
    signatureBase64: string,
    publicKey: string,
  ): Promise<boolean> {
    this.logger.debug('Verifying signature with ECDSA-SHA256');

    try {
      // Convert hex hash to buffer
      const hashBuffer = Buffer.from(documentHash, 'hex');

      // Decode signature from base64
      const signatureBuffer = Buffer.from(signatureBase64, 'base64');

      // Verify using ECDSA with SHA-256
      const isValid = verify('sha256', hashBuffer, {
        key: publicKey,
        format: 'pem',
      }, signatureBuffer);

      this.logger.debug(`Signature verification result: ${isValid}`);

      return isValid;
    } catch (error) {
      this.logger.warn('Signature verification failed', error);
      return false;
    }
  }

  /**
   * Generate certificate hash from public key
   *
   * Creates SHA-256 hash of public key for trust chain verification.
   *
   * @param publicKey - PEM-formatted public key
   * @returns SHA-256 hash as hex string
   */
  generateCertificateHash(publicKey: string): string {
    const hash = createHash('sha256').update(publicKey, 'utf8').digest('hex');

    this.logger.debug(`Certificate hash generated: ${hash.substring(0, 16)}...`);

    return hash;
  }

  /**
   * Generate RFC 3161 timestamp token
   *
   * In production, this would call an external Time Stamping Authority (TSA)
   * to get a cryptographic timestamp token for non-repudiation.
   *
   * For now, returns a mock timestamp token with embedded timestamp.
   *
   * @param documentHash - SHA-256 hash of document
   * @returns RFC 3161 timestamp token (base64-encoded)
   */
  async generateTimestampToken(documentHash: string): Promise<string> {
    this.logger.debug('Generating RFC 3161 timestamp token');

    // In production:
    // 1. Create TSA request with documentHash
    // 2. Send HTTP POST to TSA endpoint (e.g., https://freetsa.org/tsr)
    // 3. Receive and validate TSA response
    // 4. Return timestamp token

    // Mock implementation for development
    const timestamp = new Date().toISOString();
    const tokenData = {
      version: 1,
      policy: '1.2.3.4.1', // OID for timestamp policy
      messageImprint: {
        hashAlgorithm: 'sha256',
        hashedMessage: documentHash,
      },
      serialNumber: Date.now(),
      genTime: timestamp,
      accuracy: { seconds: 1 },
      tsa: 'CN=WasteFlow TSA,O=WasteFlow,C=IT',
    };

    const token = Buffer.from(JSON.stringify(tokenData)).toString('base64');

    this.logger.debug(`Timestamp token generated at ${timestamp}`);

    return token;
  }

  /**
   * Generate signature value for signing operation
   *
   * Complete workflow:
   * 1. Generate key pair
   * 2. Hash document
   * 3. Sign hash
   * 4. Generate certificate hash
   * 5. Generate timestamp token
   *
   * @param document - FIR document to sign
   * @param privateKey - PEM-formatted private key
   * @param publicKey - PEM-formatted public key
   * @returns Complete signature data
   */
  async createSignature(
    document: any,
    privateKey: string,
    publicKey: string,
  ): Promise<{
    signatureValue: string;
    documentHash: string;
    certificateHash: string;
    timestampToken: string;
  }> {
    this.logger.info('Creating complete signature for document');

    // 1. Hash document
    const documentHash = this.hashDocument(document);

    // 2. Sign hash
    const signatureValue = await this.sign(documentHash, privateKey);

    // 3. Generate certificate hash
    const certificateHash = this.generateCertificateHash(publicKey);

    // 4. Generate timestamp token
    const timestampToken = await this.generateTimestampToken(documentHash);

    this.logger.info('Complete signature created successfully');

    return {
      signatureValue,
      documentHash,
      certificateHash,
      timestampToken,
    };
  }
}
