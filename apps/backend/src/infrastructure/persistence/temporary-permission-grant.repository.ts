import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TemporaryPermissionGrant } from '../../domain/identity-access/temporary-permission-grant.entity';
import { TemporaryPermissionGrantRepository } from '../../domain/identity-access/temporary-permission-grant.repository.interface';

/**
 * Prisma Repository for TemporaryPermissionGrant
 * T204: Repository implementation for User Story 7 - Temporary Permission Requests
 *
 * Purpose: Persist and retrieve temporary permission grants with Prisma
 *
 * Requirements from spec.md FR-033-036:
 * - Fast lookups for active grants (<5ms)
 * - Find pending grants for admin approval
 * - Support tenant isolation via RLS
 * - Track approval workflow
 *
 * Requirements from plan.md:
 * - Indexed queries for performance
 * - Monthly partitioning for audit trail
 * - Prevent overlapping grants
 */
@Injectable()
export class PrismaTemporaryPermissionGrantRepository implements TemporaryPermissionGrantRepository {
  private readonly logger = new Logger(PrismaTemporaryPermissionGrantRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save or update temporary permission grant
   */
  async save(grant: TemporaryPermissionGrant): Promise<TemporaryPermissionGrant> {
    const data = grant.toPersistence();

    const persisted = await this.prisma.temporaryPermissionGrant.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        userId: data.userId,
        tenantId: data.tenantId,
        permissions: data.permissions,
        startTime: data.startTime,
        endTime: data.endTime,
        grantedBy: data.requestedBy, // Map requestedBy to grantedBy for schema compatibility
        businessJustification: data.justification,
        autoRevoked: data.status === 'revoked',
        revokedAt: data.revokedAt,
        createdAt: data.requestedAt,
      },
      update: {
        permissions: data.permissions,
        startTime: data.startTime,
        endTime: data.endTime,
        autoRevoked: data.status === 'revoked',
        revokedAt: data.revokedAt,
        updatedAt: new Date(),
      },
    });

    return this.toDomain(persisted);
  }

  /**
   * Find grant by ID
   */
  async findById(id: string, tenantId: string): Promise<TemporaryPermissionGrant | null> {
    const grant = await this.prisma.temporaryPermissionGrant.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    return grant ? this.toDomain(grant) : null;
  }

  /**
   * Find all pending grants for a tenant
   * Used by admins to see what needs approval
   */
  async findPendingByTenant(tenantId: string): Promise<TemporaryPermissionGrant[]> {
    const now = new Date();

    // Grants are "pending" if they're not yet started, not revoked, and not expired
    const grants = await this.prisma.temporaryPermissionGrant.findMany({
      where: {
        tenantId,
        startTime: {
          gt: now,
        },
        autoRevoked: false,
        endTime: {
          gt: now,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return grants.map((g: any) => this.toDomain(g));
  }

  /**
   * Find all active grants for a user
   * Used for permission checking
   */
  async findActiveByUser(userId: string, tenantId: string): Promise<TemporaryPermissionGrant[]> {
    const now = new Date();

    const grants = await this.prisma.temporaryPermissionGrant.findMany({
      where: {
        userId,
        tenantId,
        startTime: {
          lte: now,
        },
        endTime: {
          gte: now,
        },
        autoRevoked: false,
      },
    });

    return grants.map((g: any) => this.toDomain(g)).filter((g: any) => g.isActive());
  }

  /**
   * Find all grants for a user (any status)
   * Used for history/audit purposes
   */
  async findAllByUser(
    userId: string,
    tenantId: string,
    limit: number = 50,
  ): Promise<TemporaryPermissionGrant[]> {
    const grants = await this.prisma.temporaryPermissionGrant.findMany({
      where: {
        userId,
        tenantId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });

    return grants.map((g: any) => this.toDomain(g));
  }

  /**
   * Find grants expiring within a timeframe
   * Used for expiration notifications
   */
  async findExpiringGrants(tenantId: string, withinHours: number): Promise<TemporaryPermissionGrant[]> {
    const now = new Date();
    const expiryThreshold = new Date(now.getTime() + withinHours * 60 * 60 * 1000);

    const grants = await this.prisma.temporaryPermissionGrant.findMany({
      where: {
        tenantId,
        endTime: {
          gte: now,
          lte: expiryThreshold,
        },
        autoRevoked: false,
      },
    });

    return grants.map((g: any) => this.toDomain(g));
  }

  /**
   * Check if user has overlapping active grant
   * Prevents multiple grants for same permissions
   */
  async hasOverlappingGrant(
    userId: string,
    tenantId: string,
    permissions: string[],
    startTime: Date,
    endTime: Date,
  ): Promise<boolean> {
    // Find grants that overlap with the requested time period
    const overlapping = await this.prisma.temporaryPermissionGrant.findMany({
      where: {
        userId,
        tenantId,
        autoRevoked: false,
        OR: [
          {
            // Existing grant starts during requested period
            startTime: {
              gte: startTime,
              lt: endTime,
            },
          },
          {
            // Existing grant ends during requested period
            endTime: {
              gt: startTime,
              lte: endTime,
            },
          },
          {
            // Existing grant completely encompasses requested period
            AND: [
              {
                startTime: {
                  lte: startTime,
                },
              },
              {
                endTime: {
                  gte: endTime,
                },
              },
            ],
          },
        ],
      },
    });

    // Check if any overlapping grant has matching permissions
    for (const grant of overlapping) {
      const grantPermissions = grant.permissions as string[];
      const hasMatchingPermission = permissions.some((p) => grantPermissions.includes(p));
      if (hasMatchingPermission) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get grant statistics for tenant
   * Used for dashboard/reporting
   */
  async getGrantStatistics(tenantId: string): Promise<{
    pending: number;
    approved: number;
    rejected: number;
    active: number;
    expired: number;
  }> {
    const now = new Date();

    const [pending, active, expired, total] = await Promise.all([
      // Pending: future start time, not revoked
      this.prisma.temporaryPermissionGrant.count({
        where: {
          tenantId,
          startTime: { gt: now },
          autoRevoked: false,
        },
      }),
      // Active: started but not ended, not revoked
      this.prisma.temporaryPermissionGrant.count({
        where: {
          tenantId,
          startTime: { lte: now },
          endTime: { gte: now },
          autoRevoked: false,
        },
      }),
      // Expired: end time passed
      this.prisma.temporaryPermissionGrant.count({
        where: {
          tenantId,
          endTime: { lt: now },
        },
      }),
      // Total count
      this.prisma.temporaryPermissionGrant.count({
        where: {
          tenantId,
        },
      }),
    ]);

    const revoked = await this.prisma.temporaryPermissionGrant.count({
      where: {
        tenantId,
        autoRevoked: true,
      },
    });

    return {
      pending,
      approved: active, // Active grants are effectively approved
      rejected: 0, // Schema doesn't track rejections separately
      active,
      expired: expired - revoked, // Subtract revoked from expired
    };
  }

  /**
   * Delete a grant (hard delete)
   * Only used for cleanup
   */
  async delete(id: string, tenantId: string): Promise<void> {
    await this.prisma.temporaryPermissionGrant.delete({
      where: {
        id,
        tenantId,
      },
    });
  }

  /**
   * Find grants that need expiration (past endTime, not auto-revoked)
   * Used by background job
   */
  async findGrantsNeedingExpiration(tenantId?: string): Promise<TemporaryPermissionGrant[]> {
    const now = new Date();

    const where: any = {
      endTime: {
        lt: now,
      },
      autoRevoked: false,
    };

    if (tenantId) {
      where.tenantId = tenantId;
    }

    const grants = await this.prisma.temporaryPermissionGrant.findMany({
      where,
      take: 1000, // Process max 1000 per run
    });

    return grants.map((g: any) => this.toDomain(g));
  }

  /**
   * Convert Prisma model to domain entity
   */
  private toDomain(prismaGrant: any): TemporaryPermissionGrant {
    const permissions = Array.isArray(prismaGrant.permissions)
      ? prismaGrant.permissions
      : JSON.parse(prismaGrant.permissions as string);

    // Determine status based on schema fields
    let status: 'pending' | 'approved' | 'rejected' | 'revoked' = 'approved';
    const now = new Date();

    if (prismaGrant.autoRevoked) {
      status = 'revoked';
    } else if (prismaGrant.startTime > now) {
      status = 'pending';
    } else {
      status = 'approved';
    }

    return TemporaryPermissionGrant.fromPersistence({
      id: prismaGrant.id,
      userId: prismaGrant.userId,
      tenantId: prismaGrant.tenantId,
      permissions,
      startTime: prismaGrant.startTime,
      endTime: prismaGrant.endTime,
      justification: prismaGrant.businessJustification,
      requestedBy: prismaGrant.grantedBy, // Map grantedBy back to requestedBy
      requestedAt: prismaGrant.createdAt,
      status,
      approvedBy: status === 'approved' || status === 'revoked' ? prismaGrant.grantedBy : null,
      approvedAt: status === 'approved' || status === 'revoked' ? prismaGrant.createdAt : null,
      approvalReason: status === 'approved' ? 'Auto-approved from migration' : null,
      revokedBy: status === 'revoked' ? prismaGrant.grantedBy : null,
      revokedAt: prismaGrant.revokedAt,
      revocationReason: status === 'revoked' ? 'Auto-revoked by system' : null,
    });
  }
}
