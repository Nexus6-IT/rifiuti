/**
 * SwitchTenantContextCommand
 * Command to switch consultant's active tenant context
 * Per plan.md: Context switch must complete in <2 seconds
 *
 * Command Structure:
 * - consultantUserId: User ID of consultant performing switch
 * - sourceTenantId: Current tenant (for audit trail)
 * - targetTenantId: Tenant to switch to
 *
 * Validation Rules:
 * - Consultant must have active association with target tenant
 * - Source and target cannot be the same
 * - Association must not be expired
 *
 * Side Effects:
 * - JWT regenerated with new tenant context
 * - Permission cache invalidated for user
 * - Role cache warmed for target tenant
 * - Audit trail logged
 * - TenantContextSwitchedEvent published
 */
export class SwitchTenantContextCommand {
  constructor(
    public readonly consultantUserId: string,
    public readonly sourceTenantId: string,
    public readonly targetTenantId: string,
  ) {
    // Validation: All fields required
    if (!consultantUserId || consultantUserId.trim() === '') {
      throw new Error('Consultant user ID is required');
    }

    if (!sourceTenantId || sourceTenantId.trim() === '') {
      throw new Error('Source tenant ID is required');
    }

    if (!targetTenantId || targetTenantId.trim() === '') {
      throw new Error('Target tenant ID is required');
    }

    // Validation: Cannot switch to same tenant
    if (sourceTenantId === targetTenantId) {
      throw new Error('Cannot switch to current tenant');
    }
  }
}
