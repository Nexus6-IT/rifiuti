import { RoleChangeHistory } from './role-change-history.entity'

/**
 * RoleChangeHistoryRepository Interface
 * Repository interface for role change history persistence
 * T141: RoleChangeHistoryRepository interface per User Story 4
 *
 * Purpose: Define contract for role change tracking and historical reconstruction
 *
 * Requirements from plan.md:
 * - Support historical permission reconstruction (US4 acceptance scenario 5)
 * - Track role changes over time for compliance
 * - <500ms P95 latency for queries with indexed lookups
 * - 10-year retention for ARPA compliance
 *
 * Requirements from spec.md:
 * - Filter by user, tenant, date range
 * - Reconstruct role at specific timestamp
 * - Track who made changes and why
 * - Support compliance audits
 */
export interface RoleChangeHistoryRepository {
  /**
   * Save a new role change record
   * Note: Role change history is immutable - no updates allowed
   */
  save(history: RoleChangeHistory): Promise<void>

  /**
   * Batch save multiple role changes (for performance)
   */
  saveBatch(histories: RoleChangeHistory[]): Promise<void>

  /**
   * Get all role changes for a user
   */
  findByUser(
    userId: string,
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
      orderBy?: 'asc' | 'desc'
    }
  ): Promise<RoleChangeHistory[]>

  /**
   * Get role changes for a tenant
   */
  findByTenant(
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
      orderBy?: 'asc' | 'desc'
    }
  ): Promise<RoleChangeHistory[]>

  /**
   * Get role changes within a date range
   */
  findByDateRange(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    options?: {
      userId?: string
      limit?: number
      offset?: number
    }
  ): Promise<RoleChangeHistory[]>

  /**
   * Get role changes made by a specific user (who made the change)
   */
  findByChangedBy(
    changedBy: string,
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<RoleChangeHistory[]>

  /**
   * Get the most recent role for a user
   * Used for current state queries
   */
  getLatestRoleForUser(userId: string, tenantId: string): Promise<RoleChangeHistory | null>

  /**
   * Get the role a user had at a specific timestamp
   * Critical for historical permission reconstruction (US4 acceptance scenario 5)
   *
   * Algorithm:
   * 1. Find all role changes for user before or at the target timestamp
   * 2. Return the most recent change's newRoleId
   * 3. Return null if no role existed at that time
   */
  getRoleAtTimestamp(userId: string, tenantId: string, timestamp: Date): Promise<string | null>

  /**
   * Get all role changes for a specific role (to track role usage)
   */
  findByRoleId(
    roleId: string,
    tenantId: string,
    options?: {
      limit?: number
      offset?: number
    }
  ): Promise<RoleChangeHistory[]>

  /**
   * Find role changes with filters
   */
  findWithFilters(filters: {
    tenantId: string
    userId?: string
    roleId?: string
    changedBy?: string
    startDate?: Date
    endDate?: Date
    changeType?: 'INITIAL' | 'CHANGE' | 'REVOCATION'
    page?: number
    pageSize?: number
  }): Promise<{
    changes: RoleChangeHistory[]
    total: number
    page?: number
    pageSize?: number
  }>

  /**
   * Count role changes matching filters
   */
  count(filters: {
    tenantId: string
    userId?: string
    roleId?: string
    changedBy?: string
    startDate?: Date
    endDate?: Date
  }): Promise<number>

  /**
   * Get role change statistics for dashboard
   */
  getStatistics(
    tenantId: string,
    options?: {
      startDate?: Date
      endDate?: Date
    }
  ): Promise<{
    totalChanges: number
    initialAssignments: number
    roleChanges: number
    revocations: number
    topChangedBy: Array<{ userId: string; count: number }>
    topAffectedUsers: Array<{ userId: string; count: number }>
  }>

  /**
   * Export role changes to CSV for ARPA inspection
   */
  exportToCsv(filters: {
    tenantId: string
    startDate?: Date
    endDate?: Date
    userId?: string
  }): Promise<string>

  /**
   * Get role change timeline for a user
   * Returns chronologically ordered list of all role changes
   */
  getUserRoleTimeline(
    userId: string,
    tenantId: string,
    options?: {
      startDate?: Date
      endDate?: Date
    }
  ): Promise<RoleChangeHistory[]>

  /**
   * Validate that all role changes are consistent
   * Checks that:
   * 1. No gaps in role history (if revoked, must be assigned again before next change)
   * 2. No overlapping effective dates
   * 3. All references to roles are valid
   */
  validateHistoryConsistency(
    userId: string,
    tenantId: string
  ): Promise<{
    isValid: boolean
    errors: Array<{
      historyId: string
      error: string
    }>
  }>

  /**
   * Archive old role changes (for 10-year retention management)
   * Moves changes older than specified date to archive storage
   */
  archiveChanges(
    tenantId: string,
    olderThan: Date
  ): Promise<{
    archivedCount: number
  }>

  /**
   * Get all users who had a specific role during a time period
   * Used for compliance queries like "who had admin access during incident?"
   */
  findUsersWithRoleDuringPeriod(
    roleId: string,
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<string[]>
}
