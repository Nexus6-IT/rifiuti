import { Injectable, Logger } from '@nestjs/common'
import { GetConsultantTenantsQuery } from '../get-consultant-tenants.query'
import { ConsultantTenantAssociationRepository } from '../../../domain/identity-access/consultant-tenant-association.repository.interface'

/**
 * GetConsultantTenantsQueryHandler
 * Retrieves all accessible tenants for a consultant
 * Per spec.md: Support 50+ client tenants with fast response
 *
 * Implementation:
 * - Fetch all associations for consultant from repository
 * - Filter to active and non-expired only
 * - Order by most recently added (newest first)
 * - Include role and expiration information
 * - Return count for UI display
 *
 * Performance:
 * - Uses indexed query on consultantUserId
 * - No joins needed (denormalized data)
 * - Fast even with 50+ associations
 */
@Injectable()
export class GetConsultantTenantsQueryHandler {
  private readonly logger = new Logger(GetConsultantTenantsQueryHandler.name)

  constructor(
    private readonly consultantAssociationRepository: ConsultantTenantAssociationRepository
  ) {}

  async execute(query: GetConsultantTenantsQuery): Promise<{
    tenants: Array<{
      tenantId: string
      roleId: string
      addedAt: Date
      expiresAt: Date | null
      daysUntilExpiration: number | null
      isExpiringSoon: boolean
    }>
    totalActiveAssociations: number
  }> {
    this.logger.debug(`Fetching accessible tenants for consultant ${query.consultantUserId}`)

    // Fetch all associations for consultant
    const allAssociations = await this.consultantAssociationRepository.findAllByConsultant(
      query.consultantUserId
    )

    // Filter to active and non-expired associations
    const activeAssociations = allAssociations.filter(association =>
      association.isActiveAndNotExpired()
    )

    this.logger.debug(
      `Found ${activeAssociations.length} active associations for consultant ${query.consultantUserId} out of ${allAssociations.length} total`
    )

    // Sort by most recently added (already sorted by repository, but ensure order)
    const sortedAssociations = activeAssociations.sort(
      (a, b) => b.addedAt.getTime() - a.addedAt.getTime()
    )

    // Map to response format
    const tenants = sortedAssociations.map(association => ({
      tenantId: association.tenantId,
      roleId: association.roleId,
      addedAt: association.addedAt,
      expiresAt: association.expiresAt,
      daysUntilExpiration: association.getDaysUntilExpiration(),
      isExpiringSoon: association.isExpiringSoon(),
    }))

    return {
      tenants,
      totalActiveAssociations: activeAssociations.length,
    }
  }
}
