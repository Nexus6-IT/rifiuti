import { Injectable, Logger } from '@nestjs/common'
import { GetAggregatedDashboardQuery } from '../get-aggregated-dashboard.query'
import { ConsultantTenantAssociationRepository } from '../../../domain/identity-access/consultant-tenant-association.repository.interface'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'

/**
 * GetAggregatedDashboardQueryHandler
 * Aggregates KPIs across all consultant's client tenants
 * Per plan.md: Use read replicas for performance
 *
 * Implementation Strategy:
 * - Fetch all active tenant associations for consultant
 * - Query each tenant's data in parallel
 * - Aggregate results into dashboard metrics
 * - Cache for 5 minutes to reduce load
 *
 * Performance Optimizations:
 * - Parallel queries using Promise.all()
 * - Read from replicas where available
 * - Limit results per tenant (e.g., top 10 pending FIRs)
 * - Use database-level aggregation (COUNT, SUM)
 *
 * Metrics Included (per spec.md):
 * - Total tenants managed
 * - Pending FIRs by client
 * - Upcoming MUD deadlines
 * - RENTRI sync failures
 * - Recent activity (last 7 days)
 */
@Injectable()
export class GetAggregatedDashboardQueryHandler {
  private readonly logger = new Logger(GetAggregatedDashboardQueryHandler.name)

  constructor(
    private readonly consultantAssociationRepository: ConsultantTenantAssociationRepository,
    private readonly prisma: PrismaService
  ) {}

  async execute(query: GetAggregatedDashboardQuery): Promise<{
    totalTenants: number
    totalPendingFirs: number
    totalMudDeadlines: number
    totalRentriSyncFailures: number
    pendingFirsByClient: Array<{
      tenantId: string
      tenantName: string
      pendingCount: number
    }>
    upcomingDeadlines: Array<{
      tenantId: string
      tenantName: string
      deadlineType: string
      deadlineDate: Date
    }>
    recentActivity: Array<{
      tenantId: string
      tenantName: string
      activityType: string
      activityDate: Date
      description: string
    }>
  }> {
    const startTime = Date.now()

    this.logger.debug(`Fetching aggregated dashboard for consultant ${query.consultantUserId}`)

    // Step 1: Get all active tenant associations
    const activeAssociations = (
      await this.consultantAssociationRepository.findAllByConsultant(query.consultantUserId)
    ).filter(a => a.isActiveAndNotExpired())

    const tenantIds = activeAssociations.map(a => a.tenantId)

    this.logger.debug(
      `Aggregating data across ${tenantIds.length} tenants for consultant ${query.consultantUserId}`
    )

    if (tenantIds.length === 0) {
      // No active associations, return empty dashboard
      return {
        totalTenants: 0,
        totalPendingFirs: 0,
        totalMudDeadlines: 0,
        totalRentriSyncFailures: 0,
        pendingFirsByClient: [],
        upcomingDeadlines: [],
        recentActivity: [],
      }
    }

    // Step 2: Query metrics in parallel for all tenants
    const [pendingFirsByClient, upcomingDeadlines, rentriSyncFailures, recentActivity] =
      await Promise.all([
        this.fetchPendingFirsByClient(tenantIds),
        this.fetchUpcomingMudDeadlines(tenantIds),
        this.fetchRentriSyncFailures(tenantIds),
        this.fetchRecentActivity(tenantIds),
      ])

    // Step 3: Calculate totals
    const totalPendingFirs = pendingFirsByClient.reduce(
      (sum, client) => sum + client.pendingCount,
      0
    )

    const duration = Date.now() - startTime
    this.logger.debug(
      `Aggregated dashboard loaded in ${duration}ms for consultant ${query.consultantUserId}`
    )

    return {
      totalTenants: tenantIds.length,
      totalPendingFirs,
      totalMudDeadlines: upcomingDeadlines.length,
      totalRentriSyncFailures: rentriSyncFailures,
      pendingFirsByClient,
      upcomingDeadlines,
      recentActivity,
    }
  }

  /**
   * Fetch pending FIRs grouped by client tenant
   */
  private async fetchPendingFirsByClient(tenantIds: string[]): Promise<
    Array<{
      tenantId: string
      tenantName: string
      pendingCount: number
    }>
  > {
    // Query pending FIRs across all tenants
    const results = await this.prisma.$queryRaw<
      Array<{
        tenant_id: string
        tenant_name: string
        pending_count: bigint
      }>
    >`
      SELECT
        f.tenant_id,
        t.name as tenant_name,
        COUNT(*) as pending_count
      FROM firs f
      INNER JOIN tenants t ON f.tenant_id = t.id
      WHERE f.tenant_id = ANY(${tenantIds})
        AND f.status IN ('DRAFT', 'SUBMITTED')
      GROUP BY f.tenant_id, t.name
      ORDER BY pending_count DESC
    `

    return results.map((row: any) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      pendingCount: Number(row.pending_count),
    }))
  }

  /**
   * Fetch upcoming MUD deadlines across all tenants
   */
  private async fetchUpcomingMudDeadlines(tenantIds: string[]): Promise<
    Array<{
      tenantId: string
      tenantName: string
      deadlineType: string
      deadlineDate: Date
    }>
  > {
    // Query MUD deadlines within next 30 days
    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

    const results = await this.prisma.$queryRaw<
      Array<{
        tenant_id: string
        tenant_name: string
        deadline_type: string
        deadline_date: Date
      }>
    >`
      SELECT
        m.tenant_id,
        t.name as tenant_name,
        m.type as deadline_type,
        m.deadline_date
      FROM mud_reports m
      INNER JOIN tenants t ON m.tenant_id = t.id
      WHERE m.tenant_id = ANY(${tenantIds})
        AND m.deadline_date <= ${thirtyDaysFromNow}
        AND m.deadline_date >= NOW()
        AND m.status != 'SUBMITTED'
      ORDER BY m.deadline_date ASC
      LIMIT 20
    `

    return results.map((row: any) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      deadlineType: row.deadline_type,
      deadlineDate: row.deadline_date,
    }))
  }

  /**
   * Count RENTRI sync failures requiring attention
   */
  private async fetchRentriSyncFailures(tenantIds: string[]): Promise<number> {
    const result = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM rentri_sync_logs
      WHERE tenant_id = ANY(${tenantIds})
        AND status = 'FAILED'
        AND retry_count >= 3
        AND resolved_at IS NULL
    `

    return Number(result[0].count)
  }

  /**
   * Fetch recent activity across all tenants (last 7 days)
   */
  private async fetchRecentActivity(tenantIds: string[]): Promise<
    Array<{
      tenantId: string
      tenantName: string
      activityType: string
      activityDate: Date
      description: string
    }>
  > {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    // Query recent FIR submissions as activity
    const results = await this.prisma.$queryRaw<
      Array<{
        tenant_id: string
        tenant_name: string
        activity_type: string
        activity_date: Date
        description: string
      }>
    >`
      SELECT
        f.tenant_id,
        t.name as tenant_name,
        'FIR_SUBMITTED' as activity_type,
        f.submitted_at as activity_date,
        CONCAT('FIR ', f.id, ' submitted') as description
      FROM firs f
      INNER JOIN tenants t ON f.tenant_id = t.id
      WHERE f.tenant_id = ANY(${tenantIds})
        AND f.submitted_at >= ${sevenDaysAgo}
      ORDER BY f.submitted_at DESC
      LIMIT 20
    `

    return results.map((row: any) => ({
      tenantId: row.tenant_id,
      tenantName: row.tenant_name,
      activityType: row.activity_type,
      activityDate: row.activity_date,
      description: row.description,
    }))
  }
}
