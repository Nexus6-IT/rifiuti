/**
 * AssignTaskCommand
 * T186: Command for User Story 6 - Task Assignment Automation
 *
 * Purpose: Automatically or manually assign a FIR pickup task to a driver
 *
 * Requirements from spec.md FR-029-032:
 * - Support automatic assignment (find best qualified driver)
 * - Support manual assignment (override with specific driver)
 * - Validate driver qualifications
 * - Track assignment audit trail
 */
export class AssignTaskCommand {
  constructor(
    public readonly firId: string,
    public readonly tenantId: string,
    public readonly assignedBy: string,
    public readonly driverId?: string, // If provided, manual assignment; otherwise automatic
    public readonly reason?: string // Optional reason for manual assignment
  ) {}
}
