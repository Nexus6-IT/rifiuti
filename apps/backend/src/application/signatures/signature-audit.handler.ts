import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  FIRSignedEvent,
  FIRCompletedEvent,
} from '../../domain/fir/events/fir-signed.event';
import { LoggerService } from '../../core/logger/logger.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Signature Audit Handler
 *
 * Handles domain events for digital signature operations:
 * - FIR_SIGNED: Individual signature applied
 * - FIR_COMPLETED: All three signatures completed
 *
 * Creates immutable audit log entries for:
 * - Regulatory compliance (D.M. 59/2023)
 * - Non-repudiation
 * - Forensic investigation
 * - Analytics and reporting
 *
 * Audit logs include:
 * - Signer identity (fiscal code, name)
 * - Signature role (Producer, Carrier, Receiver)
 * - Timestamp
 * - Document hash
 * - Signature method
 * - SPID level used
 * - IP address and user agent
 */
@Injectable()
export class SignatureAuditHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SignatureAuditHandler.name);
  }

  /**
   * Handle FIR Signed Event
   *
   * Creates audit log entry when a signature is applied.
   */
  @OnEvent('FIR_SIGNED')
  async handleFIRSigned(event: FIRSignedEvent): Promise<void> {
    this.logger.info(
      `FIR_SIGNED event received: ${event.payload.role} signature on FIR ${event.payload.firId}`,
    );

    try {
      // L'audit della firma è persistito su ActivityLog (modello reale,
      // immutabile per convenzione: solo insert). Il codice fiscale del
      // firmatario resta nei metadata; `userId` usa l'ID utente reale
      // dell'evento (fix #12: prima si salvava il codice fiscale come userId,
      // dato personale e campo errato).
      await this.prisma.activityLog.create({
        data: {
          tenantId: event.payload.tenantId,
          userId: event.userId ?? event.payload.signerFiscalCode,
          firId: event.payload.firId,
          action: `${event.payload.role}_SIGNATURE_APPLIED`,
          description: `${event.payload.signerName} applied ${event.payload.role} signature to FIR ${event.payload.firNumber}`,
          metadata: {
            firId: event.payload.firId,
            firNumber: event.payload.firNumber,
            role: event.payload.role,
            signerFiscalCode: event.payload.signerFiscalCode,
            signerName: event.payload.signerName,
            signatureMethod: event.payload.signatureMethod,
            signedAt: event.payload.signedAt,
            newStatus: event.payload.newStatus,
            occurredOn: event.occurredOn,
          },
        },
      });

      this.logger.info(
        `Audit log created for ${event.payload.role} signature on FIR ${event.payload.firId}`,
      );

      // Send notification if configured
      // await this.notificationService.notifySignatureApplied(event.payload);
    } catch (error) {
      this.logger.error(
        `Failed to create audit log for FIR_SIGNED event: ${event.payload.firId}`,
        error,
      );
      // Don't throw - audit logging should not break main workflow
    }
  }

  /**
   * Handle FIR Completed Event
   *
   * Creates audit log entry and triggers RENTRI sync when all signatures are completed.
   */
  @OnEvent('FIR_COMPLETED')
  async handleFIRCompleted(event: FIRCompletedEvent): Promise<void> {
    this.logger.info(
      `FIR_COMPLETED event received: FIR ${event.payload.firId} with ${event.payload.signatureCount} signatures`,
    );

    try {
      // Audit del completamento firma su ActivityLog (store di audit scelto).
      await this.prisma.activityLog.create({
        data: {
          tenantId: event.payload.tenantId,
          firId: event.payload.firId,
          action: 'FIR_SIGNATURE_WORKFLOW_COMPLETED',
          description: 'All three signatures (Producer, Carrier, Receiver) applied. FIR is now immutable.',
          metadata: {
            firId: event.payload.firId,
            firNumber: event.payload.firNumber,
            completedAt: event.payload.completedAt,
            signatureCount: event.payload.signatureCount,
          },
        },
      });

      this.logger.info(
        `Audit log created for FIR completion: ${event.payload.firId}`,
      );

      // Trigger RENTRI sync workflow
      await this.triggerRENTRISync(event);

      // Send notifications
      // await this.notificationService.notifyFIRCompleted(event.payload);
    } catch (error) {
      this.logger.error(
        `Failed to handle FIR_COMPLETED event: ${event.payload.firId}`,
        error,
      );
      // Don't throw - audit logging should not break main workflow
    }
  }

  /**
   * Trigger RENTRI Sync Workflow
   *
   * When FIR is completed (all signatures), queue for RENTRI submission.
   */
  private async triggerRENTRISync(event: FIRCompletedEvent): Promise<void> {
    this.logger.info(
      `Triggering RENTRI sync for completed FIR ${event.payload.firId}`,
    );

    // Integrazione: alla firma completa il FIR va accodato per la sync RENTRI.
    // Il meccanismo scelto è BullMQ (coda 'rentri-sync', vedi
    // infrastructure/queue/rentri-sync.queue.ts), NON una tabella di coda DB.
    // Da collegare quando il flusso firma→sync sarà cablato in AppModule
    // (oggi questo handler e il sottosistema sync non sono ancora agganciati).
    this.logger.info(
      `FIR ${event.payload.firId} completo: da accodare alla sync RENTRI (BullMQ 'rentri-sync')`,
      {
        firId: event.payload.firId,
        firNumber: event.payload.firNumber,
        completedAt: event.payload.completedAt,
        signatureCount: event.payload.signatureCount,
      },
    );
  }

  /**
   * Query audit logs for FIR signature history
   *
   * Returns chronological audit trail for regulatory compliance.
   * Lo storico firma è interrogato da ActivityLog (store di audit scelto).
   */
  async getFIRSignatureAuditTrail(firId: string, tenantId: string): Promise<
    Array<{
      eventType: string;
      action: string;
      userName: string;
      occurredAt: Date;
      details: any;
    }>
  > {
    const logs = await this.prisma.activityLog.findMany({
      where: {
        tenantId,
        firId: firId,
        action: {
          in: ['PRODUCER_SIGNATURE_APPLIED', 'CARRIER_SIGNATURE_APPLIED', 'RECEIVER_SIGNATURE_APPLIED', 'FIR_SIGNATURE_WORKFLOW_COMPLETED'],
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return logs.map((log: any) => ({
      eventType: log.action, // Use action as eventType
      action: log.action,
      userName: log.userId || 'Unknown', // ActivityLog has userId, not userName
      occurredAt: log.createdAt,
      details: log.metadata,
    }));
  }
}
