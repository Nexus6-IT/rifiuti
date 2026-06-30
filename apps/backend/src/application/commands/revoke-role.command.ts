/**
 * RevokeRoleCommand
 * Command to revoke a role assignment from a user
 * Per plan.md FR-009: Role revocation with last admin protection
 *
 * Implements CQRS pattern - commands change state
 */
export class RevokeRoleCommand {
  constructor(
    public readonly userRoleId: string, // ID of UserRoleAssignment to revoke
    public readonly tenantId: string,
    public readonly revokedBy: string,
    public readonly reason?: string // Optional reason for audit trail
  ) {
    // Validate required fields
    if (!userRoleId || userRoleId.trim() === '') {
      throw new Error('User role assignment ID is required')
    }

    if (!tenantId || tenantId.trim() === '') {
      throw new Error('Tenant ID is required')
    }

    if (!revokedBy || revokedBy.trim() === '') {
      throw new Error('Revoked by user ID is required')
    }
  }
}
