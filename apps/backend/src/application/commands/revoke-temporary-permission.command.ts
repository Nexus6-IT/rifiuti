/**
 * RevokeTemporaryPermissionCommand - T205
 * Revoke an approved (active) temporary permission grant
 */
export class RevokeTemporaryPermissionCommand {
  constructor(
    public readonly grantId: string,
    public readonly tenantId: string,
    public readonly revokedBy: string,
    public readonly reason: string,
  ) {}
}
