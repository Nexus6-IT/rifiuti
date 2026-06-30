/**
 * RequestTemporaryPermissionCommand
 * T199: Command for User Story 7 - Temporary Permission Requests
 *
 * Purpose: Submit a request for temporary elevated permissions
 *
 * Requirements from spec.md FR-033:
 * - User requests specific permissions
 * - Sets time bounds (max 7 days)
 * - Provides justification for audit
 * - Enters pending status awaiting approval
 */
export class RequestTemporaryPermissionCommand {
  constructor(
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly permissions: string[],
    public readonly startTime: Date,
    public readonly endTime: Date,
    public readonly justification: string
  ) {}
}
