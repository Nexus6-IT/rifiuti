import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RoleChangeHistory } from '../../domain/identity-access/role-change-history.entity';
import { RoleChangeHistoryRepository } from '../../domain/identity-access/role-change-history.repository.interface';

/**
 * RoleChangeHistoryRepository Implementation (Prisma)
 * T143: Implements role change history persistence with PostgreSQL
 *
 * Requirements from spec.md:
 * - 10-year retention for ARPA compliance
 * - Track who made changes and why
 * - Historical permission reconstruction (US4 acceptance scenario 5)
 * - Support compliance audits
 *
 * Requirements from plan.md:
 * - Immutable storage (no updates, only inserts)
 * - <500ms P95 query latency with indexed lookups
 * - Support role timeline reconstruction
 *
 * Note: Prisma schema uses JSON fields (oldValue/newValue) with entityType
 * to track changes for multiple entity types (Role, UserRole, Permission).
 * This repository adapts between the domain entity (oldRoleId/newRoleId)
 * and the Prisma schema (oldValue/newValue JSON).
 */
@Injectable()
export class PrismaRoleChangeHistoryRepository
  implements RoleChangeHistoryRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async save(history: RoleChangeHistory): Promise<void> {
    const data = history.toPersistence();

    // Map domain entity to Prisma schema
    // Domain uses oldRoleId/newRoleId, Prisma uses oldValue/newValue JSON
    const changeType = history.isInitialAssignment()
      ? 'ASSIGNED'
      : history.isRevocation()
        ? 'REVOKED'
        : 'UPDATED';

    await this.prisma.roleChangeHistory.create({
      data: {
        id: data.id,
        tenantId: data.tenantId,
        roleId: data.newRoleId, // Store the new role ID
        entityType: 'UserRole',
        entityId: data.userId, // The user whose role changed
        changeType,
        changedBy: data.changedBy,
        oldValue: (data.oldRoleId ? { roleId: data.oldRoleId } : null) as any,
        newValue: (data.newRoleId ? { roleId: data.newRoleId } : null) as any,
        reason: data.reason,
        timestamp: data.timestamp,
      },
    });
  }

  async saveBatch(histories: RoleChangeHistory[]): Promise<void> {
    const data = histories.map((history) => {
      const persistence = history.toPersistence();
      const changeType = history.isInitialAssignment()
        ? 'ASSIGNED'
        : history.isRevocation()
          ? 'REVOKED'
          : 'UPDATED';

      return {
        id: persistence.id,
        tenantId: persistence.tenantId,
        roleId: persistence.newRoleId,
        entityType: 'UserRole',
        entityId: persistence.userId,
        changeType,
        changedBy: persistence.changedBy,
        oldValue: (persistence.oldRoleId
          ? { roleId: persistence.oldRoleId }
          : null) as any,
        newValue: (persistence.newRoleId
          ? { roleId: persistence.newRoleId }
          : null) as any,
        reason: persistence.reason,
        timestamp: persistence.timestamp,
      };
    });

    await this.prisma.roleChangeHistory.createMany({
      data,
    });
  }

  async findByUser(
    userId: string,
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: 'asc' | 'desc';
    },
  ): Promise<RoleChangeHistory[]> {
    const results = await this.prisma.roleChangeHistory.findMany({
      where: {
        tenantId,
        entityType: 'UserRole',
        entityId: userId,
      },
      orderBy: { timestamp: options?.orderBy || 'desc' },
      skip: options?.offset,
      take: options?.limit,
    });

    return results.map((result) => this.mapToDomain(result));
  }

  async findByTenant(
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
      orderBy?: 'asc' | 'desc';
    },
  ): Promise<RoleChangeHistory[]> {
    const results = await this.prisma.roleChangeHistory.findMany({
      where: {
        tenantId,
        entityType: 'UserRole',
      },
      orderBy: { timestamp: options?.orderBy || 'desc' },
      skip: options?.offset,
      take: options?.limit,
    });

    return results.map((result) => this.mapToDomain(result));
  }

  async findByDateRange(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    options?: {
      userId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<RoleChangeHistory[]> {
    const where: any = {
      tenantId,
      entityType: 'UserRole',
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    };

    if (options?.userId) {
      where.entityId = options.userId;
    }

    const results = await this.prisma.roleChangeHistory.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip: options?.offset,
      take: options?.limit,
    });

    return results.map((result) => this.mapToDomain(result));
  }

  async findByChangedBy(
    changedBy: string,
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<RoleChangeHistory[]> {
    const results = await this.prisma.roleChangeHistory.findMany({
      where: {
        tenantId,
        entityType: 'UserRole',
        changedBy,
      },
      orderBy: { timestamp: 'desc' },
      skip: options?.offset,
      take: options?.limit,
    });

    return results.map((result) => this.mapToDomain(result));
  }

  async getLatestRoleForUser(
    userId: string,
    tenantId: string,
  ): Promise<RoleChangeHistory | null> {
    const result = await this.prisma.roleChangeHistory.findFirst({
      where: {
        tenantId,
        entityType: 'UserRole',
        entityId: userId,
      },
      orderBy: { timestamp: 'desc' },
    });

    if (!result) return null;

    return this.mapToDomain(result);
  }

  async getRoleAtTimestamp(
    userId: string,
    tenantId: string,
    timestamp: Date,
  ): Promise<string | null> {
    // Find the most recent role change before or at the timestamp
    const result = await this.prisma.roleChangeHistory.findFirst({
      where: {
        tenantId,
        entityType: 'UserRole',
        entityId: userId,
        timestamp: {
          lte: timestamp,
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    if (!result) return null;

    // Extract roleId from newValue JSON
    const newValue = result.newValue as any;
    return newValue?.roleId || null;
  }

  async findByRoleId(
    roleId: string,
    tenantId: string,
    options?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<RoleChangeHistory[]> {
    const results = await this.prisma.roleChangeHistory.findMany({
      where: {
        tenantId,
        entityType: 'UserRole',
        roleId,
      },
      orderBy: { timestamp: 'desc' },
      skip: options?.offset,
      take: options?.limit,
    });

    return results.map((result) => this.mapToDomain(result));
  }

  async findWithFilters(filters: {
    tenantId: string;
    userId?: string;
    roleId?: string;
    changedBy?: string;
    startDate?: Date;
    endDate?: Date;
    changeType?: 'INITIAL' | 'CHANGE' | 'REVOCATION';
    page?: number;
    pageSize?: number;
  }): Promise<{
    changes: RoleChangeHistory[];
    total: number;
    page?: number;
    pageSize?: number;
  }> {
    const where: any = {
      tenantId: filters.tenantId,
      entityType: 'UserRole',
    };

    if (filters.userId) {
      where.entityId = filters.userId;
    }

    if (filters.roleId) {
      where.roleId = filters.roleId;
    }

    if (filters.changedBy) {
      where.changedBy = filters.changedBy;
    }

    if (filters.changeType) {
      // Map domain change type to Prisma change type
      const changeTypeMap = {
        INITIAL: 'ASSIGNED',
        CHANGE: 'UPDATED',
        REVOCATION: 'REVOKED',
      };
      where.changeType = changeTypeMap[filters.changeType];
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) {
        where.timestamp.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.timestamp.lte = filters.endDate;
      }
    }

    const page = filters.page || 1;
    const pageSize = filters.pageSize || 100;
    const skip = (page - 1) * pageSize;

    const [results, total] = await Promise.all([
      this.prisma.roleChangeHistory.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.roleChangeHistory.count({ where }),
    ]);

    const changes = results.map((result) => this.mapToDomain(result));

    return {
      changes,
      total,
      page,
      pageSize,
    };
  }

  async count(filters: {
    tenantId: string;
    userId?: string;
    roleId?: string;
    changedBy?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<number> {
    const where: any = {
      tenantId: filters.tenantId,
      entityType: 'UserRole',
    };

    if (filters.userId) {
      where.entityId = filters.userId;
    }

    if (filters.roleId) {
      where.roleId = filters.roleId;
    }

    if (filters.changedBy) {
      where.changedBy = filters.changedBy;
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) {
        where.timestamp.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.timestamp.lte = filters.endDate;
      }
    }

    return this.prisma.roleChangeHistory.count({ where });
  }

  async getStatistics(
    tenantId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<{
    totalChanges: number;
    initialAssignments: number;
    roleChanges: number;
    revocations: number;
    topChangedBy: Array<{ userId: string; count: number }>;
    topAffectedUsers: Array<{ userId: string; count: number }>;
  }> {
    const where: any = {
      tenantId,
      entityType: 'UserRole',
    };

    if (options?.startDate || options?.endDate) {
      where.timestamp = {};
      if (options.startDate) {
        where.timestamp.gte = options.startDate;
      }
      if (options.endDate) {
        where.timestamp.lte = options.endDate;
      }
    }

    const [
      totalChanges,
      initialAssignments,
      roleChanges,
      revocations,
      topChangedByResults,
      topAffectedUsersResults,
    ] = await Promise.all([
      this.prisma.roleChangeHistory.count({ where }),
      this.prisma.roleChangeHistory.count({
        where: { ...where, changeType: 'ASSIGNED' },
      }),
      this.prisma.roleChangeHistory.count({
        where: { ...where, changeType: 'UPDATED' },
      }),
      this.prisma.roleChangeHistory.count({
        where: { ...where, changeType: 'REVOKED' },
      }),
      this.prisma.roleChangeHistory.groupBy({
        by: ['changedBy'],
        where,
        _count: true,
        orderBy: {
          _count: {
            changedBy: 'desc',
          },
        },
        take: 10,
      }),
      this.prisma.roleChangeHistory.groupBy({
        by: ['entityId'],
        where,
        _count: true,
        orderBy: {
          _count: {
            entityId: 'desc',
          },
        },
        take: 10,
      }),
    ]);

    const topChangedBy = topChangedByResults.map((item) => ({
      userId: item.changedBy,
      count: item._count,
    }));

    const topAffectedUsers = topAffectedUsersResults.map((item) => ({
      userId: item.entityId,
      count: item._count,
    }));

    return {
      totalChanges,
      initialAssignments,
      roleChanges,
      revocations,
      topChangedBy,
      topAffectedUsers,
    };
  }

  async exportToCsv(filters: {
    tenantId: string;
    startDate?: Date;
    endDate?: Date;
    userId?: string;
  }): Promise<string> {
    const where: any = {
      tenantId: filters.tenantId,
      entityType: 'UserRole',
    };

    if (filters.userId) {
      where.entityId = filters.userId;
    }

    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) {
        where.timestamp.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.timestamp.lte = filters.endDate;
      }
    }

    const results = await this.prisma.roleChangeHistory.findMany({
      where,
      orderBy: { timestamp: 'asc' },
    });

    // CSV header
    const headers = [
      'ID',
      'Timestamp',
      'User ID',
      'Old Role ID',
      'New Role ID',
      'Changed By',
      'Change Type',
      'Reason',
    ];

    // CSV rows
    const rows = results.map((result) => {
      const oldValue = result.oldValue as any;
      const newValue = result.newValue as any;

      return [
        result.id,
        result.timestamp.toISOString(),
        result.entityId,
        oldValue?.roleId || '',
        newValue?.roleId || '',
        result.changedBy,
        result.changeType,
        result.reason || '',
      ];
    });

    // Format as CSV
    const csvLines = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
      ),
    ];

    return csvLines.join('\n');
  }

  async getUserRoleTimeline(
    userId: string,
    tenantId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<RoleChangeHistory[]> {
    const where: any = {
      tenantId,
      entityType: 'UserRole',
      entityId: userId,
    };

    if (options?.startDate || options?.endDate) {
      where.timestamp = {};
      if (options.startDate) {
        where.timestamp.gte = options.startDate;
      }
      if (options.endDate) {
        where.timestamp.lte = options.endDate;
      }
    }

    const results = await this.prisma.roleChangeHistory.findMany({
      where,
      orderBy: { timestamp: 'asc' }, // Chronological order
    });

    return results.map((result) => this.mapToDomain(result));
  }

  async validateHistoryConsistency(
    userId: string,
    tenantId: string,
  ): Promise<{
    isValid: boolean;
    errors: Array<{
      historyId: string;
      error: string;
    }>;
  }> {
    const timeline = await this.getUserRoleTimeline(userId, tenantId);

    if (timeline.length === 0) {
      return { isValid: true, errors: [] };
    }

    const errors: Array<{ historyId: string; error: string }> = [];

    // Check first entry is an initial assignment
    if (!timeline[0].isInitialAssignment()) {
      errors.push({
        historyId: timeline[0].id,
        error: 'First entry should be an initial assignment',
      });
    }

    // Check for gaps and overlaps
    for (let i = 1; i < timeline.length; i++) {
      const current = timeline[i];
      const previous = timeline[i - 1];

      // Current oldRoleId should match previous newRoleId
      if (current.oldRoleId !== previous.newRoleId) {
        errors.push({
          historyId: current.id,
          error: `Role mismatch: previous role was ${previous.newRoleId}, but current old role is ${current.oldRoleId}`,
        });
      }

      // Timestamps should be in order
      if (current.timestamp <= previous.timestamp) {
        errors.push({
          historyId: current.id,
          error: `Timestamp out of order: ${current.timestamp} <= ${previous.timestamp}`,
        });
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  async archiveChanges(
    tenantId: string,
    olderThan: Date,
  ): Promise<{
    archivedCount: number;
  }> {
    // In a real implementation, this would move changes to S3 cold storage
    // For now, we just count the changes that would be archived
    const count = await this.prisma.roleChangeHistory.count({
      where: {
        tenantId,
        entityType: 'UserRole',
        timestamp: {
          lt: olderThan,
        },
      },
    });

    // TODO: Implement actual archival to S3
    // await this.s3Service.archiveRoleChanges(...)

    return {
      archivedCount: count,
    };
  }

  async findUsersWithRoleDuringPeriod(
    roleId: string,
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<string[]> {
    // Find all role changes within the period for the specific role
    const results = await this.prisma.roleChangeHistory.findMany({
      where: {
        tenantId,
        entityType: 'UserRole',
        roleId,
        timestamp: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        entityId: true,
      },
      distinct: ['entityId'],
    });

    return results.map((result) => result.entityId);
  }

  /**
   * Helper method to map Prisma result to domain entity
   */
  private mapToDomain(result: any): RoleChangeHistory {
    const oldValue = result.oldValue as any;
    const newValue = result.newValue as any;

    return RoleChangeHistory.fromPersistence({
      id: result.id,
      userId: result.entityId,
      tenantId: result.tenantId,
      oldRoleId: oldValue?.roleId || null,
      newRoleId: newValue?.roleId || null,
      changedBy: result.changedBy,
      reason: result.reason || '',
      timestamp: result.timestamp,
      effectiveDate: result.timestamp, // Use timestamp as effectiveDate
      metadata: {},
    });
  }
}
