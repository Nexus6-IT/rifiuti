import { ConsultantTenantAssociation } from './consultant-tenant-association.entity'

/**
 * ConsultantTenantAssociationRepository Interface
 * Repository pattern for consultant-tenant associations
 * Per DDD: Domain layer defines interface, infrastructure implements
 *
 * Responsibilities:
 * - Persist and retrieve consultant-tenant associations
 * - Query associations by consultant or tenant
 * - Find active associations for context switching
 * - Support 50+ client tenant queries per consultant (performance critical)
 */
export interface ConsultantTenantAssociationRepository {
  /**
   * Save new or update existing association
   * @param association - ConsultantTenantAssociation entity
   * @returns Saved association
   */
  save(association: ConsultantTenantAssociation): Promise<ConsultantTenantAssociation>

  /**
   * Find association by ID
   * @param id - Association ID
   * @returns Association or null if not found
   */
  findById(id: string): Promise<ConsultantTenantAssociation | null>

  /**
   * Find all associations for a consultant
   * Per spec.md: Consultant can manage 50+ client tenants
   * @param consultantUserId - Consultant user ID
   * @returns Array of associations (active and inactive)
   */
  findAllByConsultant(consultantUserId: string): Promise<ConsultantTenantAssociation[]>

  /**
   * Find active association for consultant and specific tenant
   * Used for context switching validation
   * @param consultantUserId - Consultant user ID
   * @param tenantId - Target tenant ID
   * @returns Active association or null if not found/inactive
   */
  findActiveByConsultantAndTenant(
    consultantUserId: string,
    tenantId: string
  ): Promise<ConsultantTenantAssociation | null>

  /**
   * Find all consultants associated with a tenant
   * Used by tenant admin to view consultant access list
   * @param tenantId - Tenant ID
   * @returns Array of associations
   */
  findAllByTenant(tenantId: string): Promise<ConsultantTenantAssociation[]>

  /**
   * Deactivate association
   * Per spec.md: Admin can revoke consultant access
   * @param id - Association ID
   * @returns Updated association
   */
  deactivate(id: string): Promise<ConsultantTenantAssociation>

  /**
   * Reactivate association
   * @param id - Association ID
   * @returns Updated association
   */
  reactivate(id: string): Promise<ConsultantTenantAssociation>

  /**
   * Delete association (soft delete)
   * @param id - Association ID
   */
  delete(id: string): Promise<void>

  /**
   * Count active associations for consultant
   * Used for dashboard metrics
   * @param consultantUserId - Consultant user ID
   * @returns Count of active associations
   */
  countActiveByConsultant(consultantUserId: string): Promise<number>

  /**
   * Find associations expiring soon
   * Per spec.md: Warn consultants/admins of expiring access
   * @param daysThreshold - Warning threshold (default 30 days)
   * @returns Array of associations expiring within threshold
   */
  findExpiringSoon(daysThreshold?: number): Promise<ConsultantTenantAssociation[]>
}
