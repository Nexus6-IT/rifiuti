/**
 * GetAuditTrailQuery
 * CQRS Query for retrieving audit trail with filters
 * T144: GetAuditTrailQuery per User Story 4
 *
 * Purpose: Query audit logs with comprehensive filtering for compliance officers
 *
 * Requirements from spec.md FR-018:
 * - Filter by user, date range, decision, resource type
 * - Pagination support
 * - Support ARPA compliance inspections
 *
 * Requirements from plan.md:
 * - <500ms P95 latency for queries
 * - Support up to 1M audit logs per tenant
 */
export class GetAuditTrailQuery {
  constructor(
    public readonly tenantId: string,
    public readonly filters?: {
      userId?: string;
      startDate?: Date;
      endDate?: Date;
      decision?: 'ALLOW' | 'DENY';
      resourceType?: string;
      resourceId?: string;
      actionAttempted?: string;
    },
    public readonly pagination?: {
      page?: number;
      pageSize?: number;
    },
  ) {}
}
