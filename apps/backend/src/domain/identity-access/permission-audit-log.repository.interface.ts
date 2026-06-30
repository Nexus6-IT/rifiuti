import { PermissionAuditLog } from './permission-audit-log.entity'

/**
 * PermissionAuditLogRepository Interface
 * Repository interface for audit log persistence
 * T140: PermissionAuditLogRepository interface per User Story 4
 *
 * Purpose: Define contract for audit log storage and retrieval
 *
 * Requirements from plan.md:
 * - Support monthly table partitioning for efficient queries
 * - <500ms P95 latency for queries with indexed lookups
 * - Support up to 1M audit logs per tenant
 * - Immutable storage (no updates, only inserts)
 *
 * Requirements from spec.md:
 * - Filter by user, date range, decision, resource type
 * - Pagination support
 * - Cryptographic chain validation
 * - 10-year retention
 */
export interface PermissionAuditLogRepository {
  /**
   * Save a new audit log entry
   * Note: Audit logs are immutable - no updates allowed
   */
  save(log: PermissionAuditLog): Promise<void>

  /**
   * Batch save multiple audit logs (for performance)
   */
  saveBatch(logs: PermissionAuditLog[]): Promise<void>

  /**
   * Get the latest audit log for a tenant (for chaining)
   */
  getLatestLog(tenantId: string): Promise<PermissionAuditLog | null>

  /**
   * Find audit logs with filters
   */
  findWithFilters(filters: {
    tenantId: string
    userId?: string
    startDate?: Date
    endDate?: Date
    decision?: 'ALLOW' | 'DENY'
    resourceType?: string
    resourceId?: string
    actionAttempted?: string
    page?: number
    pageSize?: number
  }): Promise<{
    logs: PermissionAuditLog[]
    total: number
    page?: number
    pageSize?: number
  }>

  /**
   * Find logs by tenant ID
   */
  findByTenant(
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]>

  /**
   * Find logs by user ID
   */
  findByUser(
    userId: string,
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]>

  /**
   * Find logs for specific resource
   */
  findByResource(
    resourceType: string,
    resourceId: string,
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]>

  /**
   * Find logs by date range
   */
  findByDateRange(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]>

  /**
   * Find logs by decision (ALLOW or DENY)
   */
  findByDecision(
    tenantId: string,
    decision: 'ALLOW' | 'DENY',
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<PermissionAuditLog[]>

  /**
   * Count logs matching filters
   */
  count(filters: {
    tenantId: string
    userId?: string
    startDate?: Date
    endDate?: Date
    decision?: 'ALLOW' | 'DENY'
    resourceType?: string
  }): Promise<number>

  /**
   * Validate chain integrity for a tenant
   * Verifies cryptographic chain from oldest to newest log
   */
  validateChainIntegrity(
    tenantId: string,
    options?: {
      startDate?: Date
      endDate?: Date
    }
  ): Promise<{
    isValid: boolean
    totalLogs: number
    firstInvalidLogId?: string
    error?: string
  }>

  /**
   * Get logs in chronological order for chain validation
   */
  getLogsInChronologicalOrder(
    tenantId: string,
    options?: {
      startDate?: Date
      endDate?: Date
      limit?: number
    }
  ): Promise<PermissionAuditLog[]>

  /**
   * Export logs to CSV format for ARPA inspection
   */
  exportToCsv(filters: {
    tenantId: string
    startDate?: Date
    endDate?: Date
    userId?: string
  }): Promise<string>

  /**
   * Archive old logs (for 10-year retention management)
   * Moves logs older than specified date to archive storage
   */
  archiveLogs(
    tenantId: string,
    olderThan: Date
  ): Promise<{
    archivedCount: number
  }>

  /**
   * Get audit statistics for dashboard
   */
  getStatistics(
    tenantId: string,
    options?: {
      startDate?: Date
      endDate?: Date
    }
  ): Promise<{
    totalLogs: number
    allowedCount: number
    deniedCount: number
    uniqueUsers: number
    topDeniedActions: Array<{ action: string; count: number }>
  }>
}
