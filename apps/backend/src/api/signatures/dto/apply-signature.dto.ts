import { IsEnum, IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SignatureRole } from '../../../domain/fir/digital-signature.vo';

/**
 * Apply Signature Request DTO
 *
 * Request body for POST /fir/:id/sign endpoint.
 * User authenticates with SPID Level 2+ and applies digital signature.
 */
export class ApplySignatureDto {
  @ApiProperty({
    description: 'Signature role (Producer, Carrier, or Receiver)',
    enum: ['PRODUCER', 'CARRIER', 'RECEIVER'],
    example: 'PRODUCER',
  })
  @IsEnum(['PRODUCER', 'CARRIER', 'RECEIVER'], {
    message: 'Role must be PRODUCER, CARRIER, or RECEIVER',
  })
  @IsNotEmpty()
  role: SignatureRole;

  @ApiProperty({
    description: 'Optional private key (for testing). In production, retrieved from user session or HSM.',
    required: false,
  })
  @IsOptional()
  @IsString()
  privateKey?: string;

  @ApiProperty({
    description: 'Optional public key (for testing). In production, retrieved from SPID certificate.',
    required: false,
  })
  @IsOptional()
  @IsString()
  publicKey?: string;
}

/**
 * Apply Signature Response DTO
 *
 * Response body for POST /fir/:id/sign endpoint.
 */
export class ApplySignatureResponseDto {
  @ApiProperty({
    description: 'Success indicator',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Applied signature details',
  })
  signature: {
    role: SignatureRole;
    signerFiscalCode: string;
    signerName: string;
    signedAt: Date;
    signatureMethod: string;
  };

  @ApiProperty({
    description: 'New FIR status after signature',
    example: 'SIGNED_BY_PRODUCER',
  })
  firStatus: string;

  @ApiProperty({
    description: 'Whether FIR is completed (all three signatures applied)',
    example: false,
  })
  isCompleted: boolean;

  @ApiProperty({
    description: 'Success message',
    example: 'Signature applied successfully',
  })
  message?: string;
}
