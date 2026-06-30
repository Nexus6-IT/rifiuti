/**
 * UpdateCustomRoleCommand
 * CQRS Command for updating custom roles
 * T166: UpdateCustomRoleCommand per User Story 5
 *
 * Purpose: Allow modification of custom role properties and permissions
 *
 * Requirements from spec.md FR-011 acceptance scenario 4:
 * - "Modifies custom role permissions, changes take effect immediately for all users"
 * - Update name, description, or permissions
 * - Immediate cache invalidation
 *
 * Requirements from plan.md:
 * - Synchronous cache invalidation
 * - Broadcast to all app instances
 * - <100ms cache invalidation propagation
 */
export class UpdateCustomRoleCommand {
  constructor(
    public readonly roleId: string,
    public readonly tenantId: string,
    public readonly name?: string,
    public readonly description?: string,
    public readonly permissions?: string[],
    public readonly updatedBy?: string
  ) {}
}
