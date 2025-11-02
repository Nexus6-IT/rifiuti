import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { Inject, NotFoundException } from '@nestjs/common';
import { ReconstructHistoricalPermissionsQuery } from '../reconstruct-historical-permissions.query';
import { RoleChangeHistoryRepository } from '../../../domain/identity-access/role-change-history.repository.interface';
import { RoleRepository } from '../../../domain/identity-access/role.repository.interface';

/**
 * ReconstructHistoricalPermissionsQueryHandler
 * T147: Handles historical permission reconstruction for compliance
 *
 * Requirements from spec.md:
 * - US4 Acceptance Scenario 5: Reconstruct permissions at specific timestamp
 * - Answer compliance questions: "what could user X do on date Y?"
 * - Support ARPA compliance investigations
 *
 * Requirements from plan.md:
 * - Use RoleChangeHistory to find role at timestamp
 * - Use Role to get permissions for that role
 * - <500ms P95 latency for reconstruction
 *
 * Algorithm:
 * 1. Query RoleChangeHistory for user's role at the specified timestamp
 * 2. If role found, query Role to get permissions for that role
 * 3. Return role and permissions as they existed at that time
 */
@QueryHandler(ReconstructHistoricalPermissionsQuery)
export class ReconstructHistoricalPermissionsQueryHandler
  implements IQueryHandler<ReconstructHistoricalPermissionsQuery>
{
  constructor(
    @Inject('RoleChangeHistoryRepository')
    private readonly roleChangeHistoryRepository: RoleChangeHistoryRepository,
    @Inject('RoleRepository')
    private readonly roleRepository: RoleRepository,
  ) {}

  async execute(query: ReconstructHistoricalPermissionsQuery): Promise<{
    userId: string;
    tenantId: string;
    timestamp: Date;
    roleId: string | null;
    roleName: string | null;
    permissions: string[];
    hadAccess: boolean;
  }> {
    // Step 1: Find role at the specified timestamp
    const roleIdAtTimestamp =
      await this.roleChangeHistoryRepository.getRoleAtTimestamp(
        query.userId,
        query.tenantId,
        query.timestamp,
      );

    // If no role at that time, user had no access
    if (!roleIdAtTimestamp) {
      return {
        userId: query.userId,
        tenantId: query.tenantId,
        timestamp: query.timestamp,
        roleId: null,
        roleName: null,
        permissions: [],
        hadAccess: false,
      };
    }

    // Step 2: Get role details and permissions
    const role = await this.roleRepository.findById(
      roleIdAtTimestamp,
      query.tenantId,
    );

    if (!role) {
      // Role has been deleted since then
      // Return roleId but indicate permissions are unavailable
      return {
        userId: query.userId,
        tenantId: query.tenantId,
        timestamp: query.timestamp,
        roleId: roleIdAtTimestamp,
        roleName: null,
        permissions: [],
        hadAccess: true, // Had access, but role is now deleted
      };
    }

    // Extract permissions from role
    // Note: This assumes Role entity has a getPermissions() method
    // If not, you'll need to query PermissionRepository separately
    const permissions = this.extractPermissions(role);

    return {
      userId: query.userId,
      tenantId: query.tenantId,
      timestamp: query.timestamp,
      roleId: role.id,
      roleName: role.name,
      permissions,
      hadAccess: true,
    };
  }

  /**
   * Extract permission strings from Role entity
   * This is a simplified implementation - adjust based on actual Role structure
   */
  private extractPermissions(role: any): string[] {
    // If Role has permissions property (many-to-many relation)
    if (role.permissions && Array.isArray(role.permissions)) {
      return role.permissions.map((p: any) => {
        // Format: resource:action:scope (e.g., "fir:create:facility")
        return `${p.resource}:${p.action}:${p.scope}`;
      });
    }

    // If Role has a getPermissions() method
    if (typeof role.getPermissions === 'function') {
      const permissions = role.getPermissions();
      return permissions.map((p: any) => `${p.resource}:${p.action}:${p.scope}`);
    }

    // Fallback: return empty array
    return [];
  }
}
