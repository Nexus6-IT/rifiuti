/**
 * AssignRoleCommand
 * Command to assign a role to a user
 * Per plan.md FR-008: Role assignment with validation and audit
 *
 * Implements CQRS pattern - commands change state
 */
export class AssignRoleCommand {
  constructor(
    public readonly userId: string,
    public readonly roleId: string,
    public readonly tenantId: string,
    public readonly assignedBy: string,
    public readonly expiresAt?: Date | null,
    public readonly facilityIds?: string[] | null,
    public readonly isDelegated?: boolean,
    public readonly delegationReason?: string | null,
    public readonly replaceExisting?: boolean // If true, revoke existing roles first
  ) {
    // Validate required fields
    if (!userId || userId.trim() === '') {
      throw new Error('User ID is required')
    }

    if (!roleId || roleId.trim() === '') {
      throw new Error('Role ID is required')
    }

    if (!tenantId || tenantId.trim() === '') {
      throw new Error('Tenant ID is required')
    }

    if (!assignedBy || assignedBy.trim() === '') {
      throw new Error('Assigned by user ID is required')
    }

    // Validate expiration date
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new Error('Expiration date must be in the future')
    }

    // Validate delegation reason if delegated
    if (isDelegated && (!delegationReason || delegationReason.trim() === '')) {
      throw new Error('Delegation reason is required for delegated roles')
    }
  }
}
