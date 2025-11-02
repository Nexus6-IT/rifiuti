/**
 * ReconstructHistoricalPermissionsQuery
 * CQRS Query for reconstructing user permissions at a specific point in time
 * T146: ReconstructHistoricalPermissionsQuery per User Story 4
 *
 * Purpose: Answer "what permissions did user X have on date Y?" for compliance
 *
 * Requirements from spec.md US4 Acceptance Scenario 5:
 * - Reconstruct historical permissions for any date
 * - Include role information
 * - Support ARPA compliance investigations
 * - Show what actions user could have taken at that time
 *
 * Requirements from plan.md:
 * - Use RoleChangeHistory to find role at timestamp
 * - Use Role permissions to reconstruct permission set
 * - <500ms P95 latency for reconstruction
 */
export class ReconstructHistoricalPermissionsQuery {
  constructor(
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly timestamp: Date,
  ) {}
}
