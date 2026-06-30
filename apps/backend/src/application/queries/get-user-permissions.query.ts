/**
 * GetUserPermissionsQuery
 * Query to retrieve user's effective permissions
 * Per plan.md FR-001: Permission lookup with cache-first strategy
 *
 * Implements CQRS pattern - queries return data without side effects
 */
export class GetUserPermissionsQuery {
  constructor(
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly includeTempPermissions: boolean = false
  ) {
    // Validate required fields
    if (!userId || userId.trim() === '') {
      throw new Error('User ID is required')
    }

    if (!tenantId || tenantId.trim() === '') {
      throw new Error('Tenant ID is required')
    }
  }
}
