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
      // TODO: Model 'auditLog' does not exist in Prisma schema - use 'activityLog' instead
      // Create audit log entry using activityLog model
      // Note: ActivityLog uses createdAt (auto-generated), not occurredAt
      await this.prisma.activityLog.create({
        data: {
          tenantId: event.payload.tenantId,
          userId: event.payload.signerFiscalCode, // TODO: This should be the actual user ID, not fiscal code
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
      // TODO: Model 'auditLog' does not exist - using activityLog
      // Create audit log entry
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

    // TODO: Model 'rENTRISyncQueue' does not exist in Prisma schema
    // This functionality should be implemented using BullMQ or a similar queue system
    // For now, log the event
    this.logger.info(
      `TODO: RENTRI sync should be queued for FIR ${event.payload.firId}`,
      {
        firId: event.payload.firId,
        firNumber: event.payload.firNumber,
        completedAt: event.payload.completedAt,
        signatureCount: event.payload.signatureCount,
      },
    );

    /* Original implementation - restore when queue system is implemented:
    try {
      await this.prisma.rENTRISyncQueue.create({
        data: {
          tenantId: event.payload.tenantId,
          firId: event.payload.firId,
          status: 'PENDING',
          priority: 'NORMAL',
          scheduledFor: new Date(),
          metadata: {
            triggeredBy: 'FIR_COMPLETED_EVENT',
            completedAt: event.payload.completedAt,
            signatureCount: event.payload.signatureCount,
          },
        },
      });

      this.logger.info(
        `RENTRI sync queued for FIR ${event.payload.firId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue RENTRI sync for FIR ${event.payload.firId}`,
        error,
      );
      await this.createSyncFailureAlert(event, error);
    }
    */
  }

  /**
   * Create alert for RENTRI sync failure
   *
   * If automatic sync queueing fails, create alert for manual review.
   * TODO: Model 'alert' does not exist in Prisma schema - implement alert system
   */
  private async createSyncFailureAlert(
    event: FIRCompletedEvent,
    error: any,
  ): Promise<void> {
    // TODO: Model 'alert' does not exist in Prisma schema
    // Consider creating a notification or using activityLog instead
    this.logger.error(
      `TODO: Alert should be created for RENTRI sync failure on FIR ${event.payload.firNumber}`,
      error instanceof Error ? error : undefined,
      {
        tenantId: event.payload.tenantId,
        firId: event.payload.firId,
        firNumber: event.payload.firNumber,
      },
    );

    /* Original implementation - restore when alert model is added:
    try {
      await this.prisma.alert.create({
        data: {
          tenantId: event.payload.tenantId,
          severity: 'HIGH',
          type: 'RENTRI_SYNC_QUEUE_FAILED',
          title: `Failed to queue RENTRI sync for FIR ${event.payload.firNumber}`,
          message: `FIR ${event.payload.firId} is completed but failed to queue for RENTRI sync. Manual intervention required.`,
          entityType: 'FIR',
          entityId: event.payload.firId,
          details: {
            firId: event.payload.firId,
            firNumber: event.payload.firNumber,
            error: error.message,
            stack: error.stack,
          },
          isResolved: false,
        },
      });

      this.logger.warn(
        `Alert created for RENTRI sync failure: FIR ${event.payload.firId}`,
      );
    } catch (alertError) {
      this.logger.error(
        `Failed to create alert for RENTRI sync failure: ${event.payload.firId}`,
        alertError,
      );
    }
    */
  }

  /**
   * Query audit logs for FIR signature history
   *
   * Returns chronological audit trail for regulatory compliance.
   * TODO: Using activityLog instead of auditLog
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
    // TODO: Using activityLog instead of auditLog model
    // ActivityLog schema doesn't have entityType/entityId, uses firId directly
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
