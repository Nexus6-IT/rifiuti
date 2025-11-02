import { Injectable } from '@nestjs/common';
import { FIRRepository } from '../../domain/fir/fir.repository';
import { DigitalSignatureService } from './digital-signature.service';
import { LoggerService } from '../../core/logger/logger.service';
import { DomainException } from '../../domain/shared/domain-exception';
import { SignatureRole } from '../../domain/fir/digital-signature.vo';

/**
 * Verify Signatures Use Case
 *
 * Verifies all digital signatures on a FIR document:
 * 1. Load FIR with signatures
 * 2. Verify each signature cryptographically
 * 3. Check signature order and completeness
 * 4. Return verification report
 *
 * Public endpoint - no authentication required.
 * Supports QR code verification for regulatory compliance.
 */
@Injectable()
export class VerifySignaturesUseCase {
  constructor(
    private readonly firRepository: FIRRepository,
    private readonly signatureService: DigitalSignatureService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(VerifySignaturesUseCase.name);
  }

  /**
   * Execute signature verification
   *
   * @param params - Verification parameters
   * @returns Verification report with all signature details
   */
  async execute(params: {
    firId: string;
    tenantId?: string; // Optional for public verification
  }): Promise<{
    firId: string;
    firNumber: string;
    allValid: boolean;
    isCompleted: boolean;
    signatureCount: number;
    signatures: Array<{
      role: SignatureRole;
      signerFiscalCode: string;
      signerName: string;
      signedAt: Date;
      signatureMethod: string;
      certificateHash: string;
      documentHash: string;
      hasTimestamp: boolean;
      isValid: boolean;
      verifiedAt: Date;
    }>;
    documentHash: string;
    verifiedAt: Date;
  }> {
    this.logger.info(`Verifying signatures for FIR ${params.firId}`);

    // 1. Load FIR (without tenant filter for public verification)
    const fir = await this.firRepository.findByIdPublic(params.firId);
    if (!fir) {
      throw DomainException.notFound('FIR', params.firId);
    }

    // 2. Get signable document representation
    const firDocument = fir.toSignableDocument();
    const documentHash = this.signatureService.hashDocument(firDocument);

    // 3. Verify each signature
    const signatures = fir.getSignatures();
    const verificationResults = await Promise.all(
      signatures.map(async (signature: {
        getVerificationInfo: () => {
          role: SignatureRole;
          signerFiscalCode: string;
          signerName: string;
          signedAt: Date;
          signatureMethod: string;
          certificateHash: string;
          documentHash: string;
          hasTimestamp: boolean;
        };
        getDocumentHash: () => string;
        getSignatureValue: () => string;
        getPublicKey: () => string;
      }) => {
        const verificationInfo = signature.getVerificationInfo();

        // Verify cryptographic signature
        let isValid = false;
        try {
          isValid = await this.signatureService.verify(
            signature.getDocumentHash(),
            signature.getSignatureValue(),
            signature.getPublicKey(),
          );

          // Additional check: document hash must match current FIR state
          if (isValid && signature.getDocumentHash() !== documentHash) {
            this.logger.warn(
              `Document hash mismatch for ${verificationInfo.role} signature on FIR ${params.firId}`,
            );
            isValid = false;
          }
        } catch (error) {
          this.logger.error(
            `Signature verification failed for ${verificationInfo.role}`,
            error,
          );
          isValid = false;
        }

        return {
          role: verificationInfo.role,
          signerFiscalCode: verificationInfo.signerFiscalCode,
          signerName: verificationInfo.signerName,
          signedAt: verificationInfo.signedAt,
          signatureMethod: verificationInfo.signatureMethod,
          certificateHash: verificationInfo.certificateHash,
          documentHash: verificationInfo.documentHash,
          hasTimestamp: verificationInfo.hasTimestamp,
          isValid,
          verifiedAt: new Date(),
        };
      }),
    );

    // 4. Check if all signatures are valid
    const allValid = verificationResults.every((result) => result.isValid);

    // 5. Check if FIR is completed (all three signatures present)
    const isCompleted = fir.isImmutable();

    this.logger.info(
      `Signature verification completed for FIR ${params.firId}: ${verificationResults.length} signatures, all valid: ${allValid}`,
    );

    return {
      firId: fir.getId(),
      firNumber: fir.getFirNumber(),
      allValid,
      isCompleted,
      signatureCount: verificationResults.length,
      signatures: verificationResults,
      documentHash,
      verifiedAt: new Date(),
    };
  }

  /**
   * Verify single signature by role
   *
   * @param params - Verification parameters
   * @returns Verification result for specific role
   */
  async verifyByRole(params: {
    firId: string;
    role: SignatureRole;
    tenantId?: string;
  }): Promise<{
    isValid: boolean;
    signature?: {
      signerFiscalCode: string;
      signerName: string;
      signedAt: Date;
      verifiedAt: Date;
    };
    error?: string;
  }> {
    this.logger.debug(`Verifying ${params.role} signature for FIR ${params.firId}`);

    try {
      const verificationResult = await this.execute({
        firId: params.firId,
        tenantId: params.tenantId,
      });

      const signatureResult = verificationResult.signatures.find(
        (sig) => sig.role === params.role,
      );

      if (!signatureResult) {
        return {
          isValid: false,
          error: `No ${params.role} signature found`,
        };
      }

      return {
        isValid: signatureResult.isValid,
        signature: {
          signerFiscalCode: signatureResult.signerFiscalCode,
          signerName: signatureResult.signerName,
          signedAt: signatureResult.signedAt,
          verifiedAt: signatureResult.verifiedAt,
        },
      };
    } catch (error) {
      this.logger.error(`Verification failed for ${params.role} signature`, error);
      return {
        isValid: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate verification URL for QR code
   *
   * Creates public URL for signature verification.
   * Used in PDF exports and printed FIR documents.
   *
   * @param firId - FIR identifier
   * @returns Public verification URL
   */
  generateVerificationUrl(firId: string): string {
    // In production, use configured public domain
    const publicDomain = process.env.PUBLIC_DOMAIN || 'https://wasteflow.it';
    return `${publicDomain}/verify/${firId}`;
  }
}
