import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { PermissionRepository } from '../../domain/identity-access/permission.repository.interface';
import { Permission } from '../../domain/identity-access/permission.entity';

/**
 * PermissionRepository Prisma Implementation
 * Implements PermissionRepository interface using Prisma ORM
 * Per plan.md: Permissions are tenant-agnostic (shared across all tenants)
 */
@Injectable()
export class PrismaPermissionRepository implements PermissionRepository {
  private readonly logger = new Logger(PrismaPermissionRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(permissionId: string): Promise<Permission | null> {
    const dbPermission = await this.prisma.permission.findUnique({
      where: { id: permissionId },
    });

    if (!dbPermission) {
      return null;
    }

    return Permission.fromPersistence({
      id: dbPermission.id,
      resource: dbPermission.resource,
      action: dbPermission.action,
      scope: dbPermission.scope,
      description: dbPermission.description || '',
      isSensitive: dbPermission.isSensitive,
      module: dbPermission.module,
      createdAt: dbPermission.createdAt,
      updatedAt: dbPermission.updatedAt,
    });
  }

  async findByString(permissionString: string): Promise<Permission | null> {
    const parts = permissionString.split(':');
    if (parts.length !== 3) {
      return null;
    }

    const [resource, action, scope] = parts;

    const dbPermission = await this.prisma.permission.findFirst({
      where: {
        resource,
        action,
        scope,
      },
    });

    if (!dbPermission) {
      return null;
    }

    return Permission.fromPersistence({
      id: dbPermission.id,
      resource: dbPermission.resource,
      action: dbPermission.action,
      scope: dbPermission.scope,
      description: dbPermission.description || '',
      isSensitive: dbPermission.isSensitive,
      module: dbPermission.module,
      createdAt: dbPermission.createdAt,
      updatedAt: dbPermission.updatedAt,
    });
  }

  async findByModule(module: string): Promise<Permission[]> {
    const dbPermissions = await this.prisma.permission.findMany({
      where: { module },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }, { scope: 'asc' }],
    });

    return dbPermissions.map((dbPerm: any) =>
      Permission.fromPersistence({
        id: dbPerm.id,
        resource: dbPerm.resource,
        action: dbPerm.action,
        scope: dbPerm.scope,
        description: dbPerm.description || '',
        isSensitive: dbPerm.isSensitive,
        module: dbPerm.module,
        createdAt: dbPerm.createdAt,
        updatedAt: dbPerm.updatedAt,
      }),
    );
  }

  async findAll(): Promise<Permission[]> {
    const dbPermissions = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
    });

    return dbPermissions.map((dbPerm: any) =>
      Permission.fromPersistence({
        id: dbPerm.id,
        resource: dbPerm.resource,
        action: dbPerm.action,
        scope: dbPerm.scope,
        description: dbPerm.description || '',
        isSensitive: dbPerm.isSensitive,
        module: dbPerm.module,
        createdAt: dbPerm.createdAt,
        updatedAt: dbPerm.updatedAt,
      }),
    );
  }

  async findByIds(permissionIds: string[]): Promise<Permission[]> {
    const dbPermissions = await this.prisma.permission.findMany({
      where: {
        id: { in: permissionIds },
      },
    });

    return dbPermissions.map((dbPerm: any) =>
      Permission.fromPersistence({
        id: dbPerm.id,
        resource: dbPerm.resource,
        action: dbPerm.action,
        scope: dbPerm.scope,
        description: dbPerm.description || '',
        isSensitive: dbPerm.isSensitive,
        module: dbPerm.module,
        createdAt: dbPerm.createdAt,
        updatedAt: dbPerm.updatedAt,
      }),
    );
  }

  async findByRole(roleId: string): Promise<Permission[]> {
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    });

    return rolePermissions.map((rp: any) =>
      Permission.fromPersistence({
        id: rp.permission.id,
        resource: rp.permission.resource,
        action: rp.permission.action,
        scope: rp.permission.scope,
        description: rp.permission.description || '',
        isSensitive: rp.permission.isSensitive,
        module: rp.permission.module,
        createdAt: rp.permission.createdAt,
        updatedAt: rp.permission.updatedAt,
      }),
    );
  }

  async findSensitive(): Promise<Permission[]> {
    const dbPermissions = await this.prisma.permission.findMany({
      where: { isSensitive: true },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });

    return dbPermissions.map((dbPerm: any) =>
      Permission.fromPersistence({
        id: dbPerm.id,
        resource: dbPerm.resource,
        action: dbPerm.action,
        scope: dbPerm.scope,
        description: dbPerm.description || '',
        isSensitive: dbPerm.isSensitive,
        module: dbPerm.module,
        createdAt: dbPerm.createdAt,
        updatedAt: dbPerm.updatedAt,
      }),
    );
  }

  async save(permission: Permission): Promise<Permission> {
    const persistence = permission.toPersistence();

    const dbPermission = await this.prisma.permission.upsert({
      where: { id: persistence.id },
      create: {
        id: persistence.id,
        resource: persistence.resource,
        action: persistence.action,
        scope: persistence.scope,
        description: persistence.description,
        isSensitive: persistence.isSensitive,
        module: persistence.module,
        createdAt: persistence.createdAt,
        updatedAt: persistence.updatedAt,
      },
      update: {
        description: persistence.description,
        updatedAt: persistence.updatedAt,
      },
    });

    this.logger.log(
      `Saved permission ${dbPermission.resource}:${dbPermission.action}:${dbPermission.scope}`,
    );

    return Permission.fromPersistence({
      id: dbPermission.id,
      resource: dbPermission.resource,
      action: dbPermission.action,
      scope: dbPermission.scope,
      description: dbPermission.description || '',
      isSensitive: dbPermission.isSensitive,
      module: dbPermission.module,
      createdAt: dbPermission.createdAt,
      updatedAt: dbPermission.updatedAt,
    });
  }

  async bulkCreate(permissions: Permission[]): Promise<Permission[]> {
    const data = permissions.map((perm) => perm.toPersistence());

    await this.prisma.permission.createMany({
      data,
      skipDuplicates: true,
    });

    this.logger.log(`Bulk created ${permissions.length} permissions`);

    return permissions;
  }

  async exists(permissionString: string): Promise<boolean> {
    const parts = permissionString.split(':');
    if (parts.length !== 3) {
      return false;
    }

    const [resource, action, scope] = parts;

    const count = await this.prisma.permission.count({
      where: {
        resource,
        action,
        scope,
      },
    });

    return count > 0;
  }
}
