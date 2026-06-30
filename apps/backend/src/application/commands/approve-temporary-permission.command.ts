/**
 * ApproveTemporaryPermissionCommand - T201
 */
export class ApproveTemporaryPermissionCommand {
  constructor(
    public readonly grantId: string,
    public readonly tenantId: string,
    public readonly approvedBy: string,
    public readonly reason: string
  ) {}
}
