/**
 * CreateCustomRoleCommand
 * CQRS Command for creating custom roles
 * T164: CreateCustomRoleCommand per User Story 5
 *
 * Purpose: Enable enterprise clients to create custom roles with granular permissions
 *
 * Requirements from spec.md FR-011:
 * - Create custom role with name, description, permissions
 * - Validate permission format (resource:action:scope)
 * - Enterprise-only feature
 * - Track who created the role
 *
 * Requirements from plan.md:
 * - Support up to 100 permissions per role
 * - Validate uniqueness per tenant
 * - Audit all role creation events
 */
export class CreateCustomRoleCommand {
  constructor(
    public readonly tenantId: string,
    public readonly name: string,
    public readonly description: string,
    public readonly permissions: string[],
    public readonly createdBy: string,
  ) {}
}
