import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Inject } from '@nestjs/common';
import { GetAuditTrailQuery } from '../get-audit-trail.query';
import { PermissionAuditLogRepository } from '../../../domain/identity-access/permission-audit-log.repository.interface';
import { PermissionAuditLog } from '../../../domain/identity-access/permission-audit-log.entity';

/**
 * GetAuditTrailQueryHandler
 * T145: Handles audit trail retrieval with filtering and pagination
 *
 * Requirements from spec.md:
 * - US4 Acceptance Scenario 1: Compliance officer retrieves audit trail for FIR 789
 * - US4 Acceptance Scenario 2: Compliance officer filters by user and date range
 * - <500ms P95 latency with indexed lookups
 *
 * Requirements from plan.md:
 * - Use repository with monthly partitioning
 * - Support 1M+ audit logs per tenant
 * - Return paginated results
 */
@QueryHandler(GetAuditTrailQuery)
export class GetAuditTrailQueryHandler
  implements IQueryHandler<GetAuditTrailQuery>
{
  constructor(
    @Inject('PermissionAuditLogRepository')
    private readonly auditLogRepository: PermissionAuditLogRepository,
  ) {}

  async execute(query: GetAuditTrailQuery): Promise<{
    logs: Array<{
      id: string;
      timestamp: Date;
      userId: string;
      spidFiscalCode: string;
      actionAttempted: string;
      resourceType: string;
      resourceId: string | null;
      decision: 'ALLOW' | 'DENY';
      evaluatedPolicies: any;
      contextAttributes: any;
      sessionId: string;
      hash: string;
      previousHash: string | null;
    }>;
    total: number;
    page?: number;
    pageSize?: number;
  }> {
    // Build filters
    const filters: any = {
      tenantId: query.tenantId,
    };

    if (query.filters?.userId) {
      filters.userId = query.filters.userId;
    }

    if (query.filters?.startDate) {
      filters.startDate = query.filters.startDate;
    }

    if (query.filters?.endDate) {
      filters.endDate = query.filters.endDate;
    }

    if (query.filters?.decision) {
      filters.decision = query.filters.decision;
    }

    if (query.filters?.resourceType) {
      filters.resourceType = query.filters.resourceType;
    }

    if (query.filters?.resourceId) {
      filters.resourceId = query.filters.resourceId;
    }

    if (query.filters?.actionAttempted) {
      filters.actionAttempted = query.filters.actionAttempted;
    }

    // Add pagination
    if (query.pagination?.page !== undefined) {
      filters.page = query.pagination.page;
    }

    if (query.pagination?.pageSize !== undefined) {
      filters.pageSize = query.pagination.pageSize;
    }

    // Query repository
    const result = await this.auditLogRepository.findWithFilters(filters);

    // Map domain entities to DTOs
    const logs = result.logs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp,
      userId: log.userId,
      spidFiscalCode: log.spidFiscalCode ?? '',
      actionAttempted: log.actionAttempted,
      resourceType: log.resourceType ?? '',
      resourceId: log.resourceId ?? null,
      decision: log.decision,
      evaluatedPolicies: (log as any).evaluatedPolicies || {},
      contextAttributes: (log as any).contextAttributes || {},
      sessionId: log.sessionId ?? '',
      hash: log.hash ?? '',
      previousHash: log.previousHash ?? null,
    }));

    return {
      logs,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }
}
