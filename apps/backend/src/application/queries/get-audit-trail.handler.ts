import { Injectable, Logger } from '@nestjs/common';
import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { GetAuditTrailQuery } from './get-audit-trail.query';
import { PermissionAuditLogRepository } from '../../domain/identity-access/permission-audit-log.repository.interface';
import { PermissionAuditLog } from '../../domain/identity-access/permission-audit-log.entity';

/**
 * GetAuditTrailHandler
 * Query handler for retrieving audit trail
 * T145: GetAuditTrailHandler per User Story 4
 *
 * Purpose: Execute audit trail queries with performance monitoring
 *
 * Requirements from plan.md:
 * - <500ms P95 latency for queries
 * - Use indexed queries for fast retrieval
 * - Support pagination
 * - Log slow queries for monitoring
 *
 * Requirements from spec.md:
 * - Return audit logs with all context
 * - Support filtering by multiple criteria
 * - Include pagination metadata
 */
@QueryHandler(GetAuditTrailQuery)
@Injectable()
export class GetAuditTrailHandler implements IQueryHandler<GetAuditTrailQuery> {
  private readonly logger = new Logger(GetAuditTrailHandler.name);

  constructor(
    private readonly auditLogRepository: PermissionAuditLogRepository,
  ) {}

  async execute(query: GetAuditTrailQuery): Promise<{
    logs: PermissionAuditLog[];
    total: number;
    page?: number;
    pageSize?: number;
    performanceMetrics?: {
      queryTimeMs: number;
      exceededTarget: boolean;
    };
  }> {
    const startTime = performance.now();

    try {
      this.logger.log(`Executing GetAuditTrailQuery for tenant ${query.tenantId}`);

      // Execute query with filters
      const result = await this.auditLogRepository.findWithFilters({
        tenantId: query.tenantId,
        userId: query.filters?.userId,
        startDate: query.filters?.startDate,
        endDate: query.filters?.endDate,
        decision: query.filters?.decision,
        resourceType: query.filters?.resourceType,
        resourceId: query.filters?.resourceId,
        actionAttempted: query.filters?.actionAttempted,
        page: query.pagination?.page,
        pageSize: query.pagination?.pageSize,
      });

      const endTime = performance.now();
      const queryTimeMs = endTime - startTime;

      // Check if query exceeded performance target
      const exceededTarget = queryTimeMs > 500;

      if (exceededTarget) {
        this.logger.warn(
          `Audit trail query exceeded 500ms target: ${queryTimeMs.toFixed(2)}ms for tenant ${query.tenantId}`,
        );
      } else {
        this.logger.log(
          `Audit trail query completed in ${queryTimeMs.toFixed(2)}ms for tenant ${query.tenantId}`,
        );
      }

      return {
        logs: result.logs,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        performanceMetrics: {
          queryTimeMs,
          exceededTarget,
        },
      };
    } catch (error) {
      const endTime = performance.now();
      const queryTimeMs = endTime - startTime;

      this.logger.error(
        `Failed to execute GetAuditTrailQuery after ${queryTimeMs.toFixed(2)}ms: ${error.message}`,
        error.stack,
      );

      throw new Error(`Failed to retrieve audit trail: ${error.message}`);
    }
  }
}
