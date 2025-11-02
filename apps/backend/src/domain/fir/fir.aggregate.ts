import { AggregateRoot } from '../shared/aggregate-root';
import { DomainException } from '../shared/domain-exception';
import { DigitalSignature, SignatureRole } from './digital-signature.vo';
import { FIRSignedEvent, FIRCompletedEvent } from './events/fir-signed.event';

export class FIR extends AggregateRoot {
  private id: string;
  private firNumber: string;
  private tenantId: string;
  private producerPartitaIva: string;
  private cerCode: string;
  private quantity: number;
  private unit: string;
  private status: string = 'DRAFT';
  private signatures: DigitalSignature[] = [];

  private constructor(params: any) {
    super();
    this.id = params.id;
    this.firNumber = params.firNumber;
    this.tenantId = params.tenantId;
    this.producerPartitaIva = params.producerPartitaIva;
    this.cerCode = params.cerCode;
    this.quantity = params.quantity;
    this.unit = params.unit;
  }

  static create(params: any): FIR {
    return new FIR(params);
  }

  applySignature(signature: DigitalSignature, userFiscalCode: string, spidLevel: number): void {
    if (spidLevel < 2) {
      throw DomainException.businessRuleViolation('INSUFFICIENT_SPID_LEVEL', 'SPID Level 2 or higher required for signatures');
    }

    if (this.isImmutable()) {
      throw DomainException.businessRuleViolation('FIR_IMMUTABLE', 'Cannot modify completed FIR');
    }

    const role = signature.getRole();
    if (this.hasSignatureFor(role)) {
      throw DomainException.businessRuleViolation('DUPLICATE_SIGNATURE', `${role} already signed this FIR`);
    }

    if (role === 'CARRIER' && !this.hasSignatureFor('PRODUCER')) {
      throw DomainException.businessRuleViolation('INVALID_SIGNATURE_ORDER', 'Producer must sign first');
    }

    if (role === 'RECEIVER' && !this.hasSignatureFor('CARRIER')) {
      throw DomainException.businessRuleViolation('INVALID_SIGNATURE_ORDER', 'Carrier must sign before receiver');
    }

    this.signatures.push(signature);
    this.updateStatus();

    this.addDomainEvent(new FIRSignedEvent({
      aggregateId: this.id,
      firId: this.id,
      firNumber: this.firNumber,
      tenantId: this.tenantId,
      role,
      signerFiscalCode: signature.getSignerFiscalCode(),
      signerName: signature.getSignerName(),
      signatureMethod: signature.getSignatureMethod(),
      signedAt: signature.getSignedAt(),
      newStatus: this.status,
    }));

    if (this.isImmutable()) {
      this.addDomainEvent(new FIRCompletedEvent({
        aggregateId: this.id,
        firId: this.id,
        firNumber: this.firNumber,
        tenantId: this.tenantId,
        completedAt: new Date(),
        signatureCount: this.signatures.length,
      }));
    }
  }

  isImmutable(): boolean {
    return this.signatures.length === 3 && this.hasSignatureFor('PRODUCER') && this.hasSignatureFor('CARRIER') && this.hasSignatureFor('RECEIVER');
  }

  private hasSignatureFor(role: SignatureRole): boolean {
    return this.signatures.some(sig => sig.getRole() === role);
  }

  private updateStatus(): void {
    if (this.isImmutable()) {
      this.status = 'COMPLETED';
    } else if (this.hasSignatureFor('CARRIER')) {
      this.status = 'IN_TRANSIT';
    } else if (this.hasSignatureFor('PRODUCER')) {
      this.status = 'SIGNED_BY_PRODUCER';
    }
  }

  getId(): string { return this.id; }
  getTenantId(): string { return this.tenantId; }
  getFirNumber(): string { return this.firNumber; }
  getSignatures(): DigitalSignature[] { return [...this.signatures]; }
  getStatus(): string { return this.status; }

  /**
   * Generate a canonical representation of the FIR for digital signing
   * Returns a deterministic string that can be hashed and signed
   */
  toSignableDocument(): string {
    // Create a canonical JSON representation with sorted keys
    const document = {
      id: this.id,
      firNumber: this.firNumber,
      tenantId: this.tenantId,
      producerPartitaIva: this.producerPartitaIva,
      cerCode: this.cerCode,
      quantity: this.quantity,
      unit: this.unit,
      status: this.status,
    };

    // Return canonical JSON (deterministic string representation)
    return JSON.stringify(document, Object.keys(document).sort());
  }
}
