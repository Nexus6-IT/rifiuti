import { Injectable } from '@nestjs/common';
import { DomainException } from '../../domain/shared/domain-exception';
import { FIRRepository } from '../../domain/fir/fir.repository';
import { DigitalSignature, SignatureRole } from '../../domain/fir/digital-signature.vo';
import { DigitalSignatureService } from './digital-signature.service';
import { LoggerService } from '../../core/logger/logger.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Apply Signature Use Case
 *
 * Orchestrates the digital signature application workflow:
 * 1. Validate user authentication and SPID level
 * 2. Load FIR aggregate
 * 3. Generate cryptographic signature
 * 4. Apply signature to FIR (enforces business rules)
 * 5. Persist FIR with signature
 * 6. Emit domain events for audit logging
 *
 * Business Rules:
 * - User must be authenticated with SPID Level 2+
 * - Authentication must be recent (<15 minutes for signatures)
 * - Signatures must be applied in order: Producer → Carrier → Receiver
 * - Each role can only sign once
 * - FIR becomes immutable after all three signatures
 */
@Injectable()
export class ApplySignatureUseCase {
  constructor(
    private readonly firRepository: FIRRepository,
    private readonly signatureService: DigitalSignatureService,
    private readonly logger: LoggerService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.logger.setContext(ApplySignatureUseCase.name);
  }

  /**
   * Execute signature application
   *
   * @param params - Signature parameters
   * @returns Applied signature details
   */
  async execute(params: {
    firId: string;
    tenantId: string;
    role: SignatureRole;
    signerFiscalCode: string;
    signerName: string;
    spidLevel: number;
    authenticatedAt: Date;
    privateKey: string; // User's private key (from secure storage or SPID certificate)
    publicKey: string; // User's public key
  }): Promise<{
    success: boolean;
    signature: {
      role: SignatureRole;
      signerFiscalCode: string;
      signerName: string;
      signedAt: Date;
      signatureMethod: string;
    };
    firStatus: string;
    isCompleted: boolean;
  }> {
    this.logger.info(
      `Applying ${params.role} signature to FIR ${params.firId} by ${params.signerFiscalCode}`,
    );

    // 1. Validate SPID level
    if (params.spidLevel < 2) {
      throw DomainException.businessRuleViolation(
        'INSUFFICIENT_SPID_LEVEL',
        'SPID Level 2 or higher required for digital signatures',
      );
    }

    // 2. Validate authentication recency (15 minutes for signatures)
    const authAgeMinutes =
      (Date.now() - params.authenticatedAt.getTime()) / 1000 / 60;
    if (authAgeMinutes > 15) {
      throw DomainException.businessRuleViolation(
        'AUTHENTICATION_EXPIRED',
        'Authentication expired. Please re-authenticate to sign documents (SPID authentication must be <15 minutes old)',
      );
    }

    // 3. Load FIR aggregate
    const fir = await this.firRepository.findById(params.firId);
    if (!fir) {
      throw DomainException.notFound('FIR', params.firId);
    }

    // 3a. Verify tenant isolation
    if (fir.getTenantId && fir.getTenantId() !== params.tenantId) {
      throw DomainException.notFound('FIR', params.firId); // Don't leak existence of FIR to other tenants
    }

    // 4. Generate cryptographic signature
    const firDocument = fir.toSignableDocument(); // Get canonical representation for signing
    const signatureData = await this.signatureService.createSignature(
      firDocument,
      params.privateKey,
      params.publicKey,
    );

    // 5. Create DigitalSignature value object
    const signature = DigitalSignature.create({
      signerFiscalCode: params.signerFiscalCode,
      signerName: params.signerName,
      role: params.role,
      signatureValue: signatureData.signatureValue,
      signatureMethod: 'ECDSA-SHA256',
      certificateHash: signatureData.certificateHash,
      documentHash: signatureData.documentHash,
      publicKey: params.publicKey,
      timestampToken: signatureData.timestampToken,
    });

    // 6. Apply signature to FIR aggregate (enforces business rules)
    fir.applySignature(signature, params.signerFiscalCode, params.spidLevel);

    // 7. Persist FIR with signature
    await this.firRepository.save(fir);

    // 8. Emit domain events
    const events = fir.getDomainEvents();
    for (const event of events) {
      this.eventEmitter.emit(event.eventType, event);
    }
    fir.clearDomainEvents();

    this.logger.info(
      `${params.role} signature applied successfully to FIR ${params.firId}. New status: ${fir.getStatus()}`,
    );

    return {
      success: true,
      signature: {
        role: params.role,
        signerFiscalCode: params.signerFiscalCode,
        signerName: params.signerName,
        signedAt: signature.getSignedAt(),
        signatureMethod: signature.getSignatureMethod(),
      },
      firStatus: fir.getStatus(),
      isCompleted: fir.isImmutable(),
    };
  }

  /**
   * Generate signing key pair for user
   *
   * In production, this would:
   * - Retrieve user's certificate from SPID provider
   * - Extract public key from certificate
   * - Securely store private key in HSM or user's secure storage
   *
   * For development/testing, generates ephemeral key pair.
   */
  async generateUserKeyPair(userId: string): Promise<{
    privateKey: string;
    publicKey: string;
  }> {
    this.logger.debug(`Generating key pair for user ${userId}`);

    // In production, would integrate with:
    // - SPID certificate provider
    // - Hardware Security Module (HSM)
    // - User's secure key storage

    const keyPair = await this.signatureService.generateKeyPair();

    // Store keys securely (in production, use HSM or encrypted storage)
    // For now, return directly for testing

    return keyPair;
  }
}
