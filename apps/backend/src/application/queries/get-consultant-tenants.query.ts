/**
 * GetConsultantTenantsQuery
 * Query to retrieve all tenants accessible by a consultant
 * Per spec.md: Consultant can manage 50+ client tenants
 *
 * Query Structure:
 * - consultantUserId: User ID of consultant
 *
 * Returns:
 * - Array of tenant associations with tenant details
 * - Only active and non-expired associations
 * - Ordered by most recently added
 * - Includes role information for each tenant
 *
 * Use Cases:
 * - Display tenant selector dropdown in UI
 * - Show "My Clients" dashboard page
 * - Validate available tenants before context switch
 */
export class GetConsultantTenantsQuery {
  constructor(public readonly consultantUserId: string) {
    if (!consultantUserId || consultantUserId.trim() === '') {
      throw new Error('Consultant user ID is required')
    }
  }
}
