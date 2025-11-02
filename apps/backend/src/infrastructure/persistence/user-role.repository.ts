import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UserRoleRepository } from '../../domain/identity-access/user-role.repository.interface';
import { UserRole } from '../../domain/identity-access/user-role.entity';

/**
 * UserRoleRepository Prisma Implementation
 * Implements UserRoleRepository interface using Prisma ORM
 * Per plan.md: Tenant isolation + expiration tracking
 */
@Injectable()
export class PrismaUserRoleRepository implements UserRoleRepository {
  private readonly logger = new Logger(PrismaUserRoleRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(userRoleId: string, tenantId: string): Promise<UserRole | null> {
    const dbUserRole = await this.prisma.userRoleAssignment.findUnique({
      where: {
        id: userRoleId,
        tenantId,
      },
    });

    if (!dbUserRole) {
      return null;
    }

    return UserRole.fromPersistence({
      id: dbUserRole.id,
      userId: dbUserRole.userId,
      roleId: dbUserRole.roleId,
      tenantId: dbUserRole.tenantId,
      assignedBy: dbUserRole.assignedBy,
      assignedAt: dbUserRole.assignedAt,
      expiresAt: dbUserRole.expiresAt,
      facilityIds: dbUserRole.facilityIds as string[] | null,
      isDelegated: dbUserRole.isDelegated,
      delegationReason: dbUserRole.delegationReason,
    });
  }

  async findActiveByUserId(userId: string, tenantId: string): Promise<UserRole[]> {
    const now = new Date();

    const dbUserRoles = await this.prisma.userRoleAssignment.findMany({
      where: {
        userId,
        tenantId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: {
        assignedAt: 'desc',
      },
    });

    return dbUserRoles.map((dbUR: any) =>
      UserRole.fromPersistence({
        id: dbUR.id,
        userId: dbUR.userId,
        roleId: dbUR.roleId,
        tenantId: dbUR.tenantId,
        assignedBy: dbUR.assignedBy,
        assignedAt: dbUR.assignedAt,
        expiresAt: dbUR.expiresAt,
        facilityIds: dbUR.facilityIds as string[] | null,
        isDelegated: dbUR.isDelegated,
        delegationReason: dbUR.delegationReason,
      }),
    );
  }

  async findAllByUserId(userId: string, tenantId: string): Promise<UserRole[]> {
    const dbUserRoles = await this.prisma.userRoleAssignment.findMany({
      where: {
        userId,
        tenantId,
      },
      orderBy: {
        assignedAt: 'desc',
      },
    });

    return dbUserRoles.map((dbUR: any) =>
      UserRole.fromPersistence({
        id: dbUR.id,
        userId: dbUR.userId,
        roleId: dbUR.roleId,
        tenantId: dbUR.tenantId,
        assignedBy: dbUR.assignedBy,
        assignedAt: dbUR.assignedAt,
        expiresAt: dbUR.expiresAt,
        facilityIds: dbUR.facilityIds as string[] | null,
        isDelegated: dbUR.isDelegated,
        delegationReason: dbUR.delegationReason,
      }),
    );
  }

  async findByUserIdAndRoleId(
    userId: string,
    roleId: string,
    tenantId: string,
  ): Promise<UserRole | null> {
    const dbUserRole = await this.prisma.userRoleAssignment.findFirst({
      where: {
        userId,
        roleId,
        tenantId,
      },
    });

    if (!dbUserRole) {
      return null;
    }

    return UserRole.fromPersistence({
      id: dbUserRole.id,
      userId: dbUserRole.userId,
      roleId: dbUserRole.roleId,
      tenantId: dbUserRole.tenantId,
      assignedBy: dbUserRole.assignedBy,
      assignedAt: dbUserRole.assignedAt,
      expiresAt: dbUserRole.expiresAt,
      facilityIds: dbUserRole.facilityIds as string[] | null,
      isDelegated: dbUserRole.isDelegated,
      delegationReason: dbUserRole.delegationReason,
    });
  }

  async findByRoleId(
    roleId: string,
    tenantId: string,
    includeInactive: boolean = false,
  ): Promise<UserRole[]> {
    const now = new Date();

    const dbUserRoles = await this.prisma.userRoleAssignment.findMany({
      where: {
        roleId,
        tenantId,
        ...(includeInactive
          ? {}
          : {
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            }),
      },
      orderBy: {
        assignedAt: 'desc',
      },
    });

    return dbUserRoles.map((dbUR: any) =>
      UserRole.fromPersistence({
        id: dbUR.id,
        userId: dbUR.userId,
        roleId: dbUR.roleId,
        tenantId: dbUR.tenantId,
        assignedBy: dbUR.assignedBy,
        assignedAt: dbUR.assignedAt,
        expiresAt: dbUR.expiresAt,
        facilityIds: dbUR.facilityIds as string[] | null,
        isDelegated: dbUR.isDelegated,
        delegationReason: dbUR.delegationReason,
      }),
    );
  }

  async findByUserIdAndFacilityId(
    userId: string,
    facilityId: string,
    tenantId: string,
  ): Promise<UserRole[]> {
    const now = new Date();

    // Fetch all active roles for user and filter in-memory for facility scope
    // Note: Prisma JSON queries have limited type safety, using post-filter approach
    const dbUserRoles = await this.prisma.userRoleAssignment.findMany({
      where: {
        userId,
        tenantId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: {
        assignedAt: 'desc',
      },
    });

    // Filter for facility scope or tenant-wide roles
    const filtered = dbUserRoles.filter((role: any) => {
      if (!role.facilityIds) return true; // Tenant-wide role
      const ids = role.facilityIds as string[];
      return ids.includes(facilityId);
    });

    return filtered.map((dbUR: any) =>
      UserRole.fromPersistence({
        id: dbUR.id,
        userId: dbUR.userId,
        roleId: dbUR.roleId,
        tenantId: dbUR.tenantId,
        assignedBy: dbUR.assignedBy,
        assignedAt: dbUR.assignedAt,
        expiresAt: dbUR.expiresAt,
        facilityIds: dbUR.facilityIds as string[] | null,
        isDelegated: dbUR.isDelegated,
        delegationReason: dbUR.delegationReason,
      }),
    );
  }

  async findExpiringSoon(
    hoursAhead: number,
    tenantId?: string,
  ): Promise<UserRole[]> {
    const now = new Date();
    const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    const dbUserRoles = await this.prisma.userRoleAssignment.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        expiresAt: {
          gte: now,
          lte: future,
        },
      },
      orderBy: {
        expiresAt: 'asc',
      },
    });

    return dbUserRoles.map((dbUR: any) =>
      UserRole.fromPersistence({
        id: dbUR.id,
        userId: dbUR.userId,
        roleId: dbUR.roleId,
        tenantId: dbUR.tenantId,
        assignedBy: dbUR.assignedBy,
        assignedAt: dbUR.assignedAt,
        expiresAt: dbUR.expiresAt,
        facilityIds: dbUR.facilityIds as string[] | null,
        isDelegated: dbUR.isDelegated,
        delegationReason: dbUR.delegationReason,
      }),
    );
  }

  async findExpiredNotRevoked(): Promise<UserRole[]> {
    const now = new Date();

    const dbUserRoles = await this.prisma.userRoleAssignment.findMany({
      where: {
        expiresAt: {
          lt: now,
        },
      },
      orderBy: {
        expiresAt: 'asc',
      },
    });

    return dbUserRoles.map((dbUR: any) =>
      UserRole.fromPersistence({
        id: dbUR.id,
        userId: dbUR.userId,
        roleId: dbUR.roleId,
        tenantId: dbUR.tenantId,
        assignedBy: dbUR.assignedBy,
        assignedAt: dbUR.assignedAt,
        expiresAt: dbUR.expiresAt,
        facilityIds: dbUR.facilityIds as string[] | null,
        isDelegated: dbUR.isDelegated,
        delegationReason: dbUR.delegationReason,
      }),
    );
  }

  async countActiveAdmins(roleId: string, tenantId: string): Promise<number> {
    const now = new Date();

    const count = await this.prisma.userRoleAssignment.count({
      where: {
        roleId,
        tenantId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });

    return count;
  }

  async save(userRole: UserRole): Promise<UserRole> {
    const persistence = userRole.toPersistence();

    const dbUserRole = await this.prisma.userRoleAssignment.upsert({
      where: {
        id: persistence.id,
      },
      create: {
        id: persistence.id,
        userId: persistence.userId,
        roleId: persistence.roleId,
        tenantId: persistence.tenantId,
        assignedBy: persistence.assignedBy,
        assignedAt: persistence.assignedAt,
        expiresAt: persistence.expiresAt,
        facilityIds: persistence.facilityIds as any,
        isDelegated: persistence.isDelegated,
        delegationReason: persistence.delegationReason,
      },
      update: {
        expiresAt: persistence.expiresAt,
        facilityIds: persistence.facilityIds as any,
      },
    });

    this.logger.log(
      `Saved user role assignment ${dbUserRole.id} (user: ${dbUserRole.userId}, role: ${dbUserRole.roleId})`,
    );

    return UserRole.fromPersistence({
      id: dbUserRole.id,
      userId: dbUserRole.userId,
      roleId: dbUserRole.roleId,
      tenantId: dbUserRole.tenantId,
      assignedBy: dbUserRole.assignedBy,
      assignedAt: dbUserRole.assignedAt,
      expiresAt: dbUserRole.expiresAt,
      facilityIds: dbUserRole.facilityIds as string[] | null,
      isDelegated: dbUserRole.isDelegated,
      delegationReason: dbUserRole.delegationReason,
    });
  }

  async revoke(userRoleId: string, tenantId: string): Promise<void> {
    // For now, we'll use expiresAt as a proxy for revocation
    // Set expiresAt to current time
    await this.prisma.userRoleAssignment.update({
      where: {
        id: userRoleId,
        tenantId,
      },
      data: {
        expiresAt: new Date(),
      },
    });

    this.logger.log(`Revoked user role assignment ${userRoleId}`);
  }

  async delete(userRoleId: string, tenantId: string): Promise<void> {
    await this.prisma.userRoleAssignment.delete({
      where: {
        id: userRoleId,
        tenantId,
      },
    });

    this.logger.log(`Deleted user role assignment ${userRoleId}`);
  }

  async revokeAllForUser(userId: string, tenantId: string): Promise<number> {
    const result = await this.prisma.userRoleAssignment.updateMany({
      where: {
        userId,
        tenantId,
      },
      data: {
        expiresAt: new Date(),
      },
    });

    this.logger.log(`Revoked ${result.count} role assignments for user ${userId}`);

    return result.count;
  }
}
