import { ApiProperty } from '@nestjs/swagger'
import { SignatureRole } from '../../../domain/fir/digital-signature.vo'

/**
 * Verify Signatures Response DTO
 *
 * Response body for GET /fir/:id/verify endpoint.
 * Public endpoint - no authentication required.
 */
export class VerifySignaturesResponseDto {
  @ApiProperty({
    description: 'FIR identifier',
    example: 'fir-123',
  })
  firId: string

  @ApiProperty({
    description: 'FIR number',
    example: 'FIR-2025-001',
  })
  firNumber: string

  @ApiProperty({
    description: 'Whether all signatures are cryptographically valid',
    example: true,
  })
  allValid: boolean

  @ApiProperty({
    description: 'Whether FIR is completed (all three signatures present)',
    example: true,
  })
  isCompleted: boolean

  @ApiProperty({
    description: 'Number of signatures',
    example: 3,
  })
  signatureCount: number

  @ApiProperty({
    description: 'Individual signature verification results',
    type: 'array',
    items: {
      type: 'object',
    },
  })
  signatures: Array<SignatureVerificationDto>

  @ApiProperty({
    description: 'Current document hash (SHA-256)',
    example: 'a1b2c3d4...',
  })
  documentHash: string

  @ApiProperty({
    description: 'Verification timestamp',
    example: '2025-01-15T10:30:00Z',
  })
  verifiedAt: Date
}

/**
 * Individual Signature Verification DTO
 */
export class SignatureVerificationDto {
  @ApiProperty({
    description: 'Signature role',
    enum: ['PRODUCER', 'CARRIER', 'RECEIVER'],
    example: 'PRODUCER',
  })
  role: SignatureRole

  @ApiProperty({
    description: 'Signer Italian fiscal code',
    example: 'RSSMRA80A01H501U',
  })
  signerFiscalCode: string

  @ApiProperty({
    description: 'Signer full name',
    example: 'Mario Rossi',
  })
  signerName: string

  @ApiProperty({
    description: 'Signature timestamp',
    example: '2025-01-15T09:00:00Z',
  })
  signedAt: Date

  @ApiProperty({
    description: 'Signature method',
    example: 'ECDSA-SHA256',
  })
  signatureMethod: string

  @ApiProperty({
    description: 'Certificate hash (SHA-256)',
    example: 'cert-hash-1',
  })
  certificateHash: string

  @ApiProperty({
    description: 'Document hash at time of signing',
    example: 'doc-hash-1',
  })
  documentHash: string

  @ApiProperty({
    description: 'Whether RFC 3161 timestamp token is present',
    example: true,
  })
  hasTimestamp: boolean

  @ApiProperty({
    description: 'Whether signature is cryptographically valid',
    example: true,
  })
  isValid: boolean

  @ApiProperty({
    description: 'Verification timestamp',
    example: '2025-01-15T10:30:00Z',
  })
  verifiedAt: Date
}
