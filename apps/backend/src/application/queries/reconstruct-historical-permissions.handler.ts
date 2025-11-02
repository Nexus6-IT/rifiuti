import { Injectable, Logger } from '@nestjs/common';
import { QueryHandler, IQueryHandler } from '@nestjs/cqrs';
import { ReconstructHistoricalPermissionsQuery } from './reconstruct-historical-permissions.query';
import { RoleChangeHistoryRepository } from '../../domain/identity-access/role-change-history.repository.interface';
import { RoleRepository } from '../../domain/identity-access/role.repository.interface';

/**
 * ReconstructHistoricalPermissionsHandler
 * Query handler for reconstructing historical permissions
 * T147: ReconstructHistoricalPermissionsHandler per User Story 4
 *
 * Purpose: Reconstruct user permissions at specific timestamp for compliance
 *
 * Algorithm:
 * 1. Query RoleChangeHistory to find what role user had at timestamp
 * 2. Load that role's permissions from Role entity
 * 3. Return reconstructed permission set with metadata
 *
 * Requirements from plan.md:
 * - <500ms P95 latency for reconstruction
 * - Support "what could user do on date X?" queries
 * - Critical for ARPA compliance investigations
 *
 * Requirements from spec.md US4 Acceptance Scenario 5:
 * - Return role ID, role name, permissions, effective date
 * - Handle cases where user had no role at that time
 * - Include audit context
 */
@QueryHandler(ReconstructHistoricalPermissionsQuery)
@Injectable()
export class ReconstructHistoricalPermissionsHandler
  implements IQueryHandler<ReconstructHistoricalPermissionsQuery>
{
  private readonly logger = new Logger(ReconstructHistoricalPermissionsHandler.name);

  constructor(
    private readonly roleChangeHistoryRepository: RoleChangeHistoryRepository,
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
    reconstructionMetadata: {
      queryTimeMs: number;
      roleChangeFound: boolean;
      roleFound: boolean;
    };
  }> {
    const startTime = performance.now();

    try {
      this.logger.log(
        `Reconstructing permissions for user ${query.userId} at ${query.timestamp.toISOString()}`,
      );

      // Step 1: Find what role the user had at the specified timestamp
      const roleId = await this.roleChangeHistoryRepository.getRoleAtTimestamp(
        query.userId,
        query.tenantId,
        query.timestamp,
      );

      if (!roleId) {
        // User had no role at that time
        const endTime = performance.now();
        const queryTimeMs = endTime - startTime;

        this.logger.log(
          `User ${query.userId} had no role at ${query.timestamp.toISOString()} (${queryTimeMs.toFixed(2)}ms)`,
        );

        return {
          userId: query.userId,
          tenantId: query.tenantId,
          timestamp: query.timestamp,
          roleId: null,
          roleName: null,
          permissions: [],
          hadAccess: false,
          reconstructionMetadata: {
            queryTimeMs,
            roleChangeFound: false,
            roleFound: false,
          },
        };
      }

      // Step 2: Load the role to get its permissions
      const role = await this.roleRepository.findById(roleId, query.tenantId);

      if (!role) {
        // Role was deleted or not found
        const endTime = performance.now();
        const queryTimeMs = endTime - startTime;

        this.logger.warn(
          `Role ${roleId} not found for user ${query.userId} at ${query.timestamp.toISOString()}`,
        );

        return {
          userId: query.userId,
          tenantId: query.tenantId,
          timestamp: query.timestamp,
          roleId,
          roleName: null,
          permissions: [],
          hadAccess: false,
          reconstructionMetadata: {
            queryTimeMs,
            roleChangeFound: true,
            roleFound: false,
          },
        };
      }

      // Step 3: Return reconstructed permissions
      const endTime = performance.now();
      const queryTimeMs = endTime - startTime;

      // Check if query exceeded performance target
      if (queryTimeMs > 500) {
        this.logger.warn(
          `Historical permission reconstruction exceeded 500ms target: ${queryTimeMs.toFixed(2)}ms`,
        );
      } else {
        this.logger.log(
          `Historical permission reconstruction completed in ${queryTimeMs.toFixed(2)}ms`,
        );
      }

      return {
        userId: query.userId,
        tenantId: query.tenantId,
        timestamp: query.timestamp,
        roleId: role.id,
        roleName: role.name,
        permissions: [], // TODO: role.permissions
        hadAccess: true,
        reconstructionMetadata: {
          queryTimeMs,
          roleChangeFound: true,
          roleFound: true,
        },
      };
    } catch (error) {
      const endTime = performance.now();
      const queryTimeMs = endTime - startTime;

      this.logger.error(
        `Failed to reconstruct historical permissions after ${queryTimeMs.toFixed(2)}ms: ${error.message}`,
        error.stack,
      );

      throw new Error(`Failed to reconstruct historical permissions: ${error.message}`);
    }
  }
}
