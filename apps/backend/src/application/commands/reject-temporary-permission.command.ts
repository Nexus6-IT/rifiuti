/** T203: Reject command */
export class RejectTemporaryPermissionCommand {
  constructor(
    public readonly grantId: string,
    public readonly tenantId: string,
    public readonly rejectedBy: string,
    public readonly reason: string
  ) {}
}
