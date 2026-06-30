/**
 * GetAggregatedDashboardQuery
 * Query to retrieve aggregated KPIs across all consultant's client tenants
 * Per spec.md: Consultant sees aggregated dashboard with cross-tenant metrics
 *
 * Query Structure:
 * - consultantUserId: User ID of consultant
 *
 * Returns:
 * - Total tenant count
 * - Pending FIRs by client (per spec.md acceptance scenario)
 * - Upcoming MUD deadlines across all clients
 * - RENTRI sync failures requiring attention
 * - Recent activity across all tenants
 *
 * Performance:
 * - Uses read replicas per plan.md
 * - Parallel queries to multiple tenant databases
 * - Cached for 5 minutes (dashboard data doesn't need real-time)
 *
 * Use Cases:
 * - Consultant dashboard page showing all clients
 * - Quick overview of issues requiring attention
 * - Prioritize work across multiple clients
 */
export class GetAggregatedDashboardQuery {
  constructor(public readonly consultantUserId: string) {
    if (!consultantUserId || consultantUserId.trim() === '') {
      throw new Error('Consultant user ID is required')
    }
  }
}
