import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RoleRepository } from '../../domain/identity-access/role.repository.interface';
import { Role } from '../../domain/identity-access/role.entity';
import { RoleCacheService } from '../cache/role-cache.service';

/**
 * RoleRepository Prisma Implementation
 * Implements RoleRepository interface using Prisma ORM
 * Per plan.md: Tenant isolation + caching
 */
@Injectable()
export class PrismaRoleRepository implements RoleRepository {
  private readonly logger = new Logger(PrismaRoleRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roleCache: RoleCacheService,
  ) {}

  async findById(roleId: string, tenantId: string): Promise<Role | null> {
    // Check cache first
    const cached = await this.roleCache.getRole(roleId);
    if (cached) {
      this.logger.debug(`Cache hit for role ${roleId}`);
      return cached;
    }

    // Query database
    const dbRole = await this.prisma.role.findUnique({
      where: {
        id: roleId,
        tenantId, // Tenant isolation
      },
    });

    if (!dbRole) {
      return null;
    }

    // Map to domain entity
    const role = Role.fromPersistence({
      id: dbRole.id,
      tenantId: dbRole.tenantId,
      name: dbRole.name,
      description: dbRole.description,
      isSystemRole: dbRole.isSystemRole,
      createdBy: dbRole.createdBy,
      createdAt: dbRole.createdAt,
      updatedAt: dbRole.updatedAt,
    });

    // Cache for future lookups
    await this.roleCache.setRole(role.id, role);

    return role;
  }

  async findByName(roleName: string, tenantId: string): Promise<Role | null> {
    const dbRole = await this.prisma.role.findUnique({
      where: {
        tenantId_name: {
          tenantId,
          name: roleName.toUpperCase(),
        },
      },
    });

    if (!dbRole) {
      return null;
    }

    return Role.fromPersistence({
      id: dbRole.id,
      tenantId: dbRole.tenantId,
      name: dbRole.name,
      description: dbRole.description,
      isSystemRole: dbRole.isSystemRole,
      createdBy: dbRole.createdBy,
      createdAt: dbRole.createdAt,
      updatedAt: dbRole.updatedAt,
    });
  }

  async findByTenant(
    tenantId: string,
    includeDeleted: boolean = false,
  ): Promise<Role[]> {
    const dbRoles = await this.prisma.role.findMany({
      where: {
        tenantId,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return dbRoles.map((dbRole: any) =>
      Role.fromPersistence({
        id: dbRole.id,
        tenantId: dbRole.tenantId,
        name: dbRole.name,
        description: dbRole.description,
        isSystemRole: dbRole.isSystemRole,
        createdBy: dbRole.createdBy,
        createdAt: dbRole.createdAt,
        updatedAt: dbRole.updatedAt,
      }),
    );
  }

  async findSystemRoles(tenantId: string): Promise<Role[]> {
    const dbRoles = await this.prisma.role.findMany({
      where: {
        tenantId,
        isSystemRole: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return dbRoles.map((dbRole: any) =>
      Role.fromPersistence({
        id: dbRole.id,
        tenantId: dbRole.tenantId,
        name: dbRole.name,
        description: dbRole.description,
        isSystemRole: dbRole.isSystemRole,
        createdBy: dbRole.createdBy,
        createdAt: dbRole.createdAt,
        updatedAt: dbRole.updatedAt,
      }),
    );
  }

  async findCustomRoles(
    tenantId: string,
    includeDeleted: boolean = false,
  ): Promise<Role[]> {
    const dbRoles = await this.prisma.role.findMany({
      where: {
        tenantId,
        isSystemRole: false,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return dbRoles.map((dbRole: any) =>
      Role.fromPersistence({
        id: dbRole.id,
        tenantId: dbRole.tenantId,
        name: dbRole.name,
        description: dbRole.description,
        isSystemRole: dbRole.isSystemRole,
        createdBy: dbRole.createdBy,
        createdAt: dbRole.createdAt,
        updatedAt: dbRole.updatedAt,
      }),
    );
  }

  async save(role: Role): Promise<Role> {
    const persistence = role.toPersistence();

    const dbRole = await this.prisma.role.upsert({
      where: {
        id: persistence.id,
      },
      create: {
        id: persistence.id,
        tenantId: persistence.tenantId,
        name: persistence.name,
        description: persistence.description,
        isSystemRole: persistence.isSystemRole,
        createdBy: persistence.createdBy,
        createdAt: persistence.createdAt,
        updatedAt: persistence.updatedAt,
      },
      update: {
        description: persistence.description,
        updatedAt: persistence.updatedAt,
      },
    });

    const savedRole = Role.fromPersistence({
      id: dbRole.id,
      tenantId: dbRole.tenantId,
      name: dbRole.name,
      description: dbRole.description,
      isSystemRole: dbRole.isSystemRole,
      createdBy: dbRole.createdBy,
      createdAt: dbRole.createdAt,
      updatedAt: dbRole.updatedAt,
    });

    // Update cache
    await this.roleCache.setRole(savedRole.tenantId, savedRole);

    this.logger.log(`Saved role ${savedRole.name} (${savedRole.id})`);

    return savedRole;
  }

  async delete(roleId: string, tenantId: string): Promise<void> {
    // Hard delete (schema doesn't support soft delete)
    await this.prisma.role.delete({
      where: {
        id: roleId,
        tenantId,
      },
    });

    // Invalidate cache
    await this.roleCache.invalidateRole(roleId);

    this.logger.log(`Deleted role ${roleId}`);
  }

  async nameExists(
    roleName: string,
    tenantId: string,
    excludeRoleId?: string,
  ): Promise<boolean> {
    const count = await this.prisma.role.count({
      where: {
        tenantId,
        name: roleName.toUpperCase(),
        ...(excludeRoleId ? { id: { not: excludeRoleId } } : {}),
      },
    });

    return count > 0;
  }

  async countActiveUsers(roleId: string, tenantId: string): Promise<number> {
    const now = new Date();

    const count = await this.prisma.userRoleAssignment.count({
      where: {
        roleId,
        tenantId,
        OR: [
          { expiresAt: null }, // No expiration
          { expiresAt: { gt: now } }, // Not expired
        ],
      },
    });

    return count;
  }
}
