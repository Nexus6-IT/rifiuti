import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SpidLevelGuard } from '../auth/guards/spid-level.guard';
import { ApplySignatureUseCase } from '../../application/signatures/apply-signature.use-case';
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case';
import {
  ApplySignatureDto,
  ApplySignatureResponseDto,
} from './dto/apply-signature.dto';
import { VerifySignaturesResponseDto } from './dto/verify-signatures.dto';

/**
 * Signatures Controller
 *
 * API endpoints for FIR digital signature operations:
 * - POST /fir/:id/sign - Apply digital signature (requires SPID Level 2+)
 * - GET /fir/:id/verify - Verify all signatures (public endpoint)
 *
 * Digital signatures enforce three-stage workflow:
 * 1. Producer signs at waste emission
 * 2. Carrier signs at pickup
 * 3. Receiver signs at delivery
 *
 * Uses ECDSA-SHA256 for Italian regulatory compliance (D.M. 59/2023).
 */
@ApiTags('Signatures')
@Controller('fir/:firId')
export class SignaturesController {
  constructor(
    private readonly applySignatureUseCase: ApplySignatureUseCase,
    private readonly verifySignaturesUseCase: VerifySignaturesUseCase,
  ) {}

  /**
   * Apply Digital Signature to FIR
   *
   * POST /fir/:firId/sign
   *
   * Requires:
   * - SPID Level 2+ authentication
   * - Recent authentication (<15 minutes)
   * - Correct signature order (Producer → Carrier → Receiver)
   *
   * Returns:
   * - Applied signature details
   * - New FIR status
   * - Completion indicator
   */
  @Post('sign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, SpidLevelGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Apply digital signature to FIR',
    description: `
      Apply cryptographic digital signature to FIR document.

      **Requirements:**
      - SPID Level 2 or higher
      - Authentication within last 15 minutes
      - Signature order: Producer → Carrier → Receiver

      **Business Rules:**
      - Each role can only sign once
      - FIR becomes immutable after all three signatures
      - Triggers RENTRI sync when completed
    `,
  })
  @ApiParam({
    name: 'firId',
    description: 'FIR identifier',
    example: 'fir-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Signature applied successfully',
    type: ApplySignatureResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid signature order or duplicate signature',
  })
  @ApiResponse({
    status: 401,
    description: 'Not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Insufficient SPID level or authentication expired',
  })
  @ApiResponse({
    status: 404,
    description: 'FIR not found',
  })
  async applySignature(
    @Param('firId') firId: string,
    @Body() dto: ApplySignatureDto,
    @Req() req: any,
  ): Promise<ApplySignatureResponseDto> {
    // Extract user info from JWT token
    const user = req.user;
    const tenantId = user.tenantId;
    const signerFiscalCode = user.fiscalCode;
    const signerName = `${user.firstName} ${user.lastName}`;
    const spidLevel = user.spidLevel || 0;
    const authenticatedAt = new Date(user.authenticatedAt);

    // Generate or retrieve user's key pair
    // In production, retrieve from HSM or user's secure storage
    let privateKey = dto.privateKey;
    let publicKey = dto.publicKey;

    if (!privateKey || !publicKey) {
      // For development/testing, generate ephemeral keys
      const keyPair = await this.applySignatureUseCase.generateUserKeyPair(
        user.userId,
      );
      privateKey = keyPair.privateKey;
      publicKey = keyPair.publicKey;
    }

    // Execute use case
    const result = await this.applySignatureUseCase.execute({
      firId,
      tenantId,
      role: dto.role,
      signerFiscalCode,
      signerName,
      spidLevel,
      authenticatedAt,
      privateKey,
      publicKey,
    });

    return {
      ...result,
      message: `${dto.role} signature applied successfully`,
    };
  }

  /**
   * Verify FIR Signatures
   *
   * GET /fir/:firId/verify
   *
   * Public endpoint - no authentication required.
   * Verifies all digital signatures cryptographically.
   *
   * Used for:
   * - Regulatory compliance verification
   * - QR code scanning
   * - Third-party validation
   *
   * Returns:
   * - Verification status for each signature
   * - Overall validity indicator
   * - Completion status
   */
  @Get('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify all FIR signatures (public)',
    description: `
      Verify all digital signatures on FIR document.

      **Public endpoint** - no authentication required.

      Verifies:
      - Cryptographic signature validity (ECDSA)
      - Document hash integrity
      - Signature order and completeness
      - Timestamp token presence

      Used for QR code verification and regulatory compliance.
    `,
  })
  @ApiParam({
    name: 'firId',
    description: 'FIR identifier',
    example: 'fir-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification completed',
    type: VerifySignaturesResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'FIR not found',
  })
  async verifySignatures(
    @Param('firId') firId: string,
  ): Promise<VerifySignaturesResponseDto> {
    // Public verification - no tenant filter
    const result = await this.verifySignaturesUseCase.execute({
      firId,
    });

    return result;
  }

  /**
   * Get verification URL for QR code
   *
   * GET /fir/:firId/verify-url
   *
   * Returns public URL for signature verification.
   * Used when generating QR codes for PDF exports.
   */
  @Get('verify-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get public verification URL',
    description: 'Returns public URL for FIR signature verification (for QR code generation)',
  })
  @ApiParam({
    name: 'firId',
    description: 'FIR identifier',
    example: 'fir-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification URL returned',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          example: 'https://wasteflow.it/verify/fir-123',
        },
      },
    },
  })
  async getVerificationUrl(
    @Param('firId') firId: string,
  ): Promise<{ url: string }> {
    const url = this.verifySignaturesUseCase.generateVerificationUrl(firId);
    return { url };
  }
}
