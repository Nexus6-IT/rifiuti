/**
 * ReassignTaskCommand
 * T188: Command for User Story 6 - Task Assignment Automation
 *
 * Purpose: Reassign a FIR pickup task from one driver to another
 *
 * Requirements from spec.md FR-029-032:
 * - Support reassignment for operational needs
 * - Require reason for audit trail
 * - Validate new driver qualifications
 * - Notify both old and new drivers
 *
 * Requirements from plan.md:
 * - Track reassignment history
 * - Prevent reassignment loops
 * - Update workload calculations immediately
 */
export class ReassignTaskCommand {
  constructor(
    public readonly firId: string,
    public readonly newDriverId: string,
    public readonly tenantId: string,
    public readonly reassignedBy: string,
    public readonly reason: string, // Required for audit trail
  ) {}
}
