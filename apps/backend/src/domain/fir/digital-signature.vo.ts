import { DomainException } from '../shared/domain-exception'
import { FiscalCode } from '../shared/fiscal-code.vo'

/**
 * Digital Signature Value Object
 *
 * Represents a cryptographic digital signature on a FIR document.
 * Uses ECDSA-SHA256 or RSA-SHA256 for Italian legal compliance.
 *
 * Business Rules:
 * - Immutable once created
 * - Must include valid Italian fiscal code
 * - Requires certificate hash for trust chain
 * - Timestamp token for non-repudiation
 * - Public key for verification
 *
 * Signature Roles:
 * - PRODUCER: Waste generator
 * - CARRIER: Transport company
 * - RECEIVER: Waste destination facility
 *
 * Italian Requirements: D.M. 59/2023
 */
export class DigitalSignature {
  private readonly signerFiscalCode: string
  private readonly signerName: string
  private readonly role: SignatureRole
  private readonly signatureValue: string // Base64 encoded signature
  private readonly signatureMethod: SignatureMethod
  private readonly certificateHash: string // SHA-256 hash of certificate
  private readonly documentHash: string // SHA-256 hash of signed document
  private readonly timestampToken?: string // RFC 3161 timestamp
  private readonly publicKey: string // PEM format public key
  private readonly signedAt: Date

  private constructor(
    signerFiscalCode: string,
    signerName: string,
    role: SignatureRole,
    signatureValue: string,
    signatureMethod: SignatureMethod,
    certificateHash: string,
    documentHash: string,
    publicKey: string,
    timestampToken?: string,
    signedAt?: Date
  ) {
    this.signerFiscalCode = signerFiscalCode
    this.signerName = signerName
    this.role = role
    this.signatureValue = signatureValue
    this.signatureMethod = signatureMethod
    this.certificateHash = certificateHash
    this.documentHash = documentHash
    this.publicKey = publicKey
    this.timestampToken = timestampToken
    this.signedAt = signedAt || new Date()

    // Make object truly immutable at runtime
    Object.freeze(this)
  }

  /**
   * Create digital signature with validation
   */
  static create(params: {
    signerFiscalCode: string
    signerName: string
    role: SignatureRole
    signatureValue: string
    signatureMethod: SignatureMethod
    certificateHash: string
    documentHash: string
    publicKey: string
    timestampToken?: string
    signedAt?: Date
  }): DigitalSignature {
    // Validate fiscal code
    if (!params.signerFiscalCode || !FiscalCode.isValid(params.signerFiscalCode)) {
      throw DomainException.validationFailed(
        'INVALID_SIGNER_FISCAL_CODE',
        `Invalid Italian fiscal code for signer: ${params.signerFiscalCode}`
      )
    }

    // Validate signer name
    if (!params.signerName || params.signerName.trim() === '') {
      throw DomainException.validationFailed('MISSING_SIGNER_NAME', 'Signer name is required')
    }

    // Validate role
    if (!this.isValidRole(params.role)) {
      throw DomainException.validationFailed(
        'INVALID_SIGNATURE_ROLE',
        `Invalid signature role: ${params.role}. Must be PRODUCER, CARRIER, or RECEIVER`
      )
    }

    // Validate signature value
    if (!params.signatureValue || params.signatureValue.trim() === '') {
      throw DomainException.validationFailed(
        'MISSING_SIGNATURE_VALUE',
        'Signature value is required'
      )
    }

    // Validate signature method
    if (!this.isValidSignatureMethod(params.signatureMethod)) {
      throw DomainException.validationFailed(
        'INVALID_SIGNATURE_METHOD',
        `Invalid signature method: ${params.signatureMethod}. Must be ECDSA-SHA256 or RSA-SHA256`
      )
    }

    // Validate certificate hash
    if (!params.certificateHash || params.certificateHash.trim() === '') {
      throw DomainException.validationFailed(
        'MISSING_CERTIFICATE_HASH',
        'Certificate hash is required'
      )
    }

    // Validate document hash
    if (!params.documentHash || params.documentHash.trim() === '') {
      throw DomainException.validationFailed(
        'MISSING_DOCUMENT_HASH',
        'Document hash is required for signature'
      )
    }

    // Validate public key
    if (!params.publicKey || params.publicKey.trim() === '') {
      throw DomainException.validationFailed(
        'MISSING_PUBLIC_KEY',
        'Public key is required for signature verification'
      )
    }

    return new DigitalSignature(
      params.signerFiscalCode.trim().toUpperCase(),
      params.signerName.trim(),
      params.role,
      params.signatureValue.trim(),
      params.signatureMethod,
      params.certificateHash.trim(),
      params.documentHash.trim(),
      params.publicKey.trim(),
      params.timestampToken?.trim(),
      params.signedAt
    )
  }

  /**
   * Ricostituisce un DigitalSignature da dati persistiti (DB).
   * Bypassa le validazioni — i dati sono già trusted (provenienza DB).
   * Usato da SignatureFIRRepository per ricostruire le firme esistenti.
   */
  static reconstitute(params: {
    signerFiscalCode: string
    signerName: string
    role: SignatureRole
    signatureValue: string
    signatureMethod: SignatureMethod
    certificateHash: string
    documentHash: string
    publicKey?: string
    timestampToken?: string
    signedAt?: Date
  }): DigitalSignature {
    return new DigitalSignature(
      params.signerFiscalCode || 'ZZZZZZZ00A00A000A',
      params.signerName || 'Sconosciuto',
      params.role,
      params.signatureValue,
      params.signatureMethod,
      params.certificateHash,
      params.documentHash,
      params.publicKey || '',
      params.timestampToken,
      params.signedAt
    )
  }

  /**
   * Verify signature against document hash
   *
   * In production, this would use Node.js crypto module to verify ECDSA signature
   * For now, simplified verification
   */
  verify(documentHash: string): boolean {
    // Check if document hash matches
    if (documentHash !== this.documentHash) {
      return false
    }

    // In real implementation:
    // 1. Parse public key (PEM format)
    // 2. Decode signature value (Base64)
    // 3. Use crypto.verify() with ECDSA or RSA
    // 4. Return verification result

    // For tests, simple check
    return !!(this.signatureValue && this.signatureValue.length > 0)
  }

  /**
   * Get verification information
   */
  getVerificationInfo(): SignatureVerificationInfo {
    return {
      signerFiscalCode: this.signerFiscalCode,
      signerName: this.signerName,
      role: this.role,
      signedAt: this.signedAt,
      signatureMethod: this.signatureMethod,
      certificateHash: this.certificateHash,
      documentHash: this.documentHash,
      hasTimestamp: !!this.timestampToken,
    }
  }

  /**
   * Serialize to plain object
   */
  toPlainObject(): {
    signerFiscalCode: string
    signerName: string
    role: SignatureRole
    signatureValue: string
    signatureMethod: SignatureMethod
    certificateHash: string
    documentHash: string
    timestampToken?: string
    publicKey: string
    signedAt: Date
  } {
    return {
      signerFiscalCode: this.signerFiscalCode,
      signerName: this.signerName,
      role: this.role,
      signatureValue: this.signatureValue,
      signatureMethod: this.signatureMethod,
      certificateHash: this.certificateHash,
      documentHash: this.documentHash,
      timestampToken: this.timestampToken,
      publicKey: this.publicKey,
      signedAt: this.signedAt,
    }
  }

  // Getters
  getSignerFiscalCode(): string {
    return this.signerFiscalCode
  }

  getSignerName(): string {
    return this.signerName
  }

  getRole(): SignatureRole {
    return this.role
  }

  getSignatureValue(): string {
    return this.signatureValue
  }

  getSignatureMethod(): SignatureMethod {
    return this.signatureMethod
  }

  getCertificateHash(): string {
    return this.certificateHash
  }

  getDocumentHash(): string {
    return this.documentHash
  }

  getTimestampToken(): string | undefined {
    return this.timestampToken
  }

  getPublicKey(): string {
    return this.publicKey
  }

  getSignedAt(): Date {
    return this.signedAt
  }

  // Validation helpers
  private static isValidRole(role: string): role is SignatureRole {
    return ['PRODUCER', 'CARRIER', 'RECEIVER'].includes(role)
  }

  private static isValidSignatureMethod(method: string): method is SignatureMethod {
    return ['ECDSA-SHA256', 'RSA-SHA256'].includes(method)
  }
}

/**
 * Type Definitions
 */

export type SignatureRole = 'PRODUCER' | 'CARRIER' | 'RECEIVER'

export type SignatureMethod = 'ECDSA-SHA256' | 'RSA-SHA256'

export interface SignatureVerificationInfo {
  signerFiscalCode: string
  signerName: string
  role: SignatureRole
  signedAt: Date
  signatureMethod: SignatureMethod
  certificateHash: string
  documentHash: string
  hasTimestamp: boolean
}
