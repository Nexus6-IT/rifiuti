/**
 * DeleteCustomRoleCommand
 * CQRS Command for deleting custom roles
 * T168: DeleteCustomRoleCommand per User Story 5
 *
 * Purpose: Allow deletion of custom roles with safety checks
 *
 * Requirements from spec.md FR-011 acceptance scenario 5:
 * - "Attempts to delete role assigned to users, prevented with error message"
 * - Cannot delete system roles
 * - Cannot delete role if assigned to users
 *
 * Requirements from plan.md:
 * - Check for active user assignments
 * - Audit all role deletion events
 * - Cache invalidation on successful deletion
 */
export class DeleteCustomRoleCommand {
  constructor(
    public readonly roleId: string,
    public readonly tenantId: string,
    public readonly deletedBy: string,
  ) {}
}
