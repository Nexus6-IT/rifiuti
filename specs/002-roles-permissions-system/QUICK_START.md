# Quick Start Guide: Implementing Roles & Permissions API

**For**: Backend developers implementing NestJS controllers and services
**Prerequisites**: Familiarity with NestJS, Prisma, Redis, JWT authentication

---

## 1. Project Structure Setup

```
apps/backend/src/
├── domain/
│   └── permissions/
│       ├── entities/
│       │   ├── role.entity.ts           # Role aggregate root
│       │   ├── permission.entity.ts     # Permission value object
│       │   └── user-role.entity.ts      # User-role assignment
│       └── value-objects/
│           └── permission-string.ts     # Type-safe permission format
│
├── application/
│   └── permissions/
│       ├── commands/
│       │   ├── create-role.command.ts
│       │   ├── assign-role.command.ts
│       │   └── revoke-role.command.ts
│       ├── queries/
│       │   ├── get-user-permissions.query.ts
│       │   └── check-permission.query.ts
│       └── use-cases/
│           ├── create-role.use-case.ts
│           └── assign-role.use-case.ts
│
├── infrastructure/
│   ├── persistence/
│   │   └── permissions/
│   │       ├── role.repository.ts
│   │       └── audit-log.repository.ts
│   └── caching/
│       ├── permission-cache.service.ts
│       └── cache-invalidation.subscriber.ts
│
└── api/
    └── permissions/
        ├── controllers/
        │   ├── roles.controller.ts
        │   ├── permissions.controller.ts
        │   └── audit.controller.ts
        └── dto/
            ├── create-role.dto.ts
            ├── assign-role.dto.ts
            └── permission-check.dto.ts
```

---

## 2. Prisma Schema (Add to existing schema)

```prisma
// prisma/schema.prisma

model Role {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  name          String
  description   String
  isSystemRole  Boolean  @default(false) @map("is_system_role")
  facilityScoped Boolean @default(false) @map("facility_scoped")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  createdBy     String?  @map("created_by")

  // Relations
  userRoles       UserRole[]
  rolePermissions RolePermission[]

  @@unique([tenantId, name])
  @@index([tenantId, isSystemRole])
  @@map("roles")
}

model Permission {
  id          String @id @default(uuid())
  resource    String // 'fir', 'registry', 'report', etc.
  action      String // 'create', 'read', 'update', 'delete', etc.
  scope       String // 'own', 'facility', 'all'
  description String
  sensitive   Boolean @default(false) // High-risk permission flag

  permissionString String @unique @map("permission_string") // Computed: resource:action:scope

  // Relations
  rolePermissions RolePermission[]

  @@unique([resource, action, scope])
  @@index([permissionString])
  @@map("permissions")
}

model RolePermission {
  id           String   @id @default(uuid())
  roleId       String   @map("role_id")
  permissionId String   @map("permission_id")
  grantedAt    DateTime @default(now()) @map("granted_at")

  // Relations
  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@unique([roleId, permissionId])
  @@map("role_permissions")
}

model UserRole {
  id           String    @id @default(uuid())
  userId       String    @map("user_id")
  roleId       String    @map("role_id")
  tenantId     String    @map("tenant_id")
  facilityIds  String[]  @map("facility_ids") // Empty array = all facilities
  assignedAt   DateTime  @default(now()) @map("assigned_at")
  assignedBy   String    @map("assigned_by")
  expiresAt    DateTime? @map("expires_at")
  isDelegated  Boolean   @default(false) @map("is_delegated")
  delegationReason String? @map("delegation_reason")
  deletedAt    DateTime? @map("deleted_at") // Soft delete

  // Relations
  user       User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       Role @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@unique([userId, roleId, tenantId])
  @@index([userId, tenantId, expiresAt])
  @@index([roleId, tenantId])
  @@map("user_roles")
}

model TemporaryPermissionGrant {
  id             String   @id @default(uuid())
  userId         String   @map("user_id")
  tenantId       String   @map("tenant_id")
  permissions    String[] // Array of permission strings
  justification  String   @db.Text
  status         String   // 'pending', 'approved', 'denied', 'expired', 'revoked'
  requestedAt    DateTime @default(now()) @map("requested_at")
  reviewedAt     DateTime? @map("reviewed_at")
  reviewedBy     String?   @map("reviewed_by")
  startTime      DateTime? @map("start_time")
  endTime        DateTime? @map("end_time")
  revokedAt      DateTime? @map("revoked_at")
  adminNotes     String?   @map("admin_notes")
  denialReason   String?   @map("denial_reason")
  revocationReason String? @map("revocation_reason")

  @@index([userId, tenantId, status])
  @@index([status, endTime]) // For expiration job
  @@map("temporary_permission_grants")
}

model PermissionAuditLog {
  id                String   @id @default(uuid())
  tenantId          String   @map("tenant_id")
  userId            String   @map("user_id")
  userName          String   @map("user_name")
  fiscalCode        String   @map("fiscal_code")
  action            String
  resourceType      String?  @map("resource_type")
  resourceId        String?  @map("resource_id")
  decision          String   // 'ALLOW' or 'DENY'
  reason            String   @db.Text
  evaluatedPolicies String[] @map("evaluated_policies")
  contextAttributes Json     @map("context_attributes")
  consultantContext Json?    @map("consultant_context")
  timestamp         DateTime @default(now())
  evaluationTimeMs  Float    @map("evaluation_time_ms")

  @@index([tenantId, userId, timestamp(sort: Desc)])
  @@index([resourceType, resourceId, timestamp(sort: Desc)])
  @@index([fiscalCode, timestamp(sort: Desc)])
  @@index([decision, timestamp(sort: Desc)])
  @@map("permission_audit_log")
}

model RoleChangeHistory {
  id             String   @id @default(uuid())
  entityType     String   @map("entity_type") // 'Role', 'UserRole', 'RolePermission'
  entityId       String   @map("entity_id")
  changeType     String   @map("change_type") // 'CREATE', 'UPDATE', 'DELETE', 'ASSIGN', 'REVOKE'
  changedBy      String   @map("changed_by")
  changedByName  String   @map("changed_by_name")
  changedByFiscalCode String @map("changed_by_fiscal_code")
  reason         String?  @db.Text
  beforeSnapshot Json?    @map("before_snapshot")
  afterSnapshot  Json?    @map("after_snapshot")
  timestamp      DateTime @default(now())
  affectedUsers  String[] @map("affected_users")

  @@index([entityType, entityId, timestamp(sort: Desc)])
  @@index([changeType, timestamp(sort: Desc)])
  @@index([changedBy, timestamp(sort: Desc)])
  @@map("role_change_history")
}
```

**Run migration**:
```bash
npx prisma migrate dev --name add-roles-permissions-system
npx prisma generate
```

---

## 3. Core Domain Entity Example

```typescript
// apps/backend/src/domain/permissions/entities/role.entity.ts

import { AggregateRoot } from '@nestjs/cqrs';
import { PermissionString } from '../value-objects/permission-string';

export class Role extends AggregateRoot {
  constructor(
    public readonly id: string,
    public readonly tenantId: string,
    public name: string,
    public description: string,
    public readonly isSystemRole: boolean,
    public permissions: PermissionString[],
    public readonly createdAt: Date,
    public updatedAt: Date
  ) {
    super();
  }

  static createSystem(
    name: string,
    description: string,
    permissions: string[],
    tenantId: string
  ): Role {
    const permissionObjects = permissions.map(p => PermissionString.create(p));
    return new Role(
      crypto.randomUUID(),
      tenantId,
      name,
      description,
      true, // isSystemRole
      permissionObjects,
      new Date(),
      new Date()
    );
  }

  static createCustom(
    name: string,
    description: string,
    permissions: string[],
    tenantId: string,
    createdBy: string
  ): Role {
    // Validation
    if (name.length < 3) {
      throw new Error('Role name must be at least 3 characters');
    }
    if (permissions.length === 0) {
      throw new Error('Role must have at least one permission');
    }

    const permissionObjects = permissions.map(p => PermissionString.create(p));

    const role = new Role(
      crypto.randomUUID(),
      tenantId,
      name,
      description,
      false, // isSystemRole
      permissionObjects,
      new Date(),
      new Date()
    );

    // Domain event
    role.apply(new RoleCreatedEvent(role.id, role.name, tenantId, createdBy));

    return role;
  }

  updatePermissions(newPermissions: string[], changedBy: string): void {
    if (this.isSystemRole) {
      throw new Error('Cannot modify system role permissions');
    }

    const oldPermissions = this.permissions.map(p => p.toString());
    this.permissions = newPermissions.map(p => PermissionString.create(p));
    this.updatedAt = new Date();

    // Domain event for cache invalidation
    this.apply(new RolePermissionsChangedEvent(
      this.id,
      this.tenantId,
      oldPermissions,
      newPermissions,
      changedBy
    ));
  }

  rename(newName: string): void {
    if (this.isSystemRole) {
      throw new Error('Cannot modify system role');
    }
    this.name = newName;
    this.updatedAt = new Date();
  }

  hasPermission(permission: string): boolean {
    return this.permissions.some(p => p.toString() === permission);
  }
}
```

```typescript
// apps/backend/src/domain/permissions/value-objects/permission-string.ts

export class PermissionString {
  private static readonly REGEX = /^[a-z_]+:(create|read|update|delete|approve|sign|export):(own|facility|all)$/;

  constructor(
    public readonly resource: string,
    public readonly action: string,
    public readonly scope: string
  ) {}

  static create(permissionString: string): PermissionString {
    if (!this.REGEX.test(permissionString)) {
      throw new Error(`Invalid permission format: ${permissionString}`);
    }

    const [resource, action, scope] = permissionString.split(':');
    return new PermissionString(resource, action, scope);
  }

  toString(): string {
    return `${this.resource}:${this.action}:${this.scope}`;
  }

  equals(other: PermissionString): boolean {
    return this.toString() === other.toString();
  }

  // Check if this permission implies another (e.g., 'all' scope implies 'facility')
  implies(other: PermissionString): boolean {
    if (this.resource !== other.resource || this.action !== other.action) {
      return false;
    }

    // Scope hierarchy: all > facility > own
    const scopeHierarchy = { own: 1, facility: 2, all: 3 };
    return scopeHierarchy[this.scope] >= scopeHierarchy[other.scope];
  }
}
```

---

## 4. Use Case Example (TDD)

```typescript
// apps/backend/src/application/permissions/use-cases/assign-role.use-case.ts

import { Injectable } from '@nestjs/common';
import { Result } from '../../../shared/result';
import { RoleRepository } from '../../../infrastructure/persistence/permissions/role.repository';
import { UserRepository } from '../../../infrastructure/persistence/users/user.repository';
import { PermissionCacheService } from '../../../infrastructure/caching/permission-cache.service';
import { AuditLogService } from '../../audit/audit-log.service';

export class AssignRoleCommand {
  constructor(
    public readonly userId: string,
    public readonly roleId: string,
    public readonly tenantId: string,
    public readonly assignedBy: string,
    public readonly facilityIds?: string[],
    public readonly expiresAt?: Date,
    public readonly reason?: string
  ) {}
}

@Injectable()
export class AssignRoleUseCase {
  constructor(
    private readonly roleRepo: RoleRepository,
    private readonly userRepo: UserRepository,
    private readonly cache: PermissionCacheService,
    private readonly auditLog: AuditLogService
  ) {}

  async execute(command: AssignRoleCommand): Promise<Result<UserRoleAssignment>> {
    // 1. Validate user exists
    const user = await this.userRepo.findById(command.userId);
    if (!user) {
      return Result.fail('User not found');
    }

    // 2. Validate role exists and belongs to tenant
    const role = await this.roleRepo.findById(command.roleId);
    if (!role || role.tenantId !== command.tenantId) {
      return Result.fail('Role not found');
    }

    // 3. Check if already assigned
    const existingAssignment = await this.roleRepo.findUserRole(
      command.userId,
      command.roleId,
      command.tenantId
    );
    if (existingAssignment && !existingAssignment.deletedAt) {
      return Result.fail('Role already assigned to user');
    }

    // 4. Prevent self-assignment of elevated roles (security check)
    if (command.userId === command.assignedBy && this.isElevatedRole(role)) {
      await this.auditLog.logSecurityEvent({
        type: 'SELF_ASSIGNMENT_ATTEMPT',
        userId: command.userId,
        roleId: command.roleId,
        tenantId: command.tenantId
      });
      return Result.fail('Cannot assign elevated roles to yourself');
    }

    // 5. Create user role assignment
    const assignment = await this.roleRepo.createUserRole({
      userId: command.userId,
      roleId: command.roleId,
      tenantId: command.tenantId,
      facilityIds: command.facilityIds || [],
      assignedBy: command.assignedBy,
      expiresAt: command.expiresAt,
      assignedAt: new Date()
    });

    // 6. Invalidate user's permission cache
    await this.cache.invalidateUser(command.userId, command.tenantId);

    // 7. Log audit trail
    await this.auditLog.logRoleChange({
      entityType: 'UserRole',
      entityId: assignment.id,
      changeType: 'ASSIGN',
      changedBy: command.assignedBy,
      reason: command.reason,
      afterSnapshot: assignment,
      affectedUsers: [command.userId]
    });

    return Result.ok(assignment);
  }

  private isElevatedRole(role: Role): boolean {
    const elevatedRoles = ['ADMIN', 'SUPER_ADMIN'];
    return elevatedRoles.includes(role.name);
  }
}
```

**Unit Test**:
```typescript
// apps/backend/src/application/permissions/use-cases/__tests__/assign-role.use-case.spec.ts

describe('AssignRoleUseCase', () => {
  let useCase: AssignRoleUseCase;
  let roleRepo: jest.Mocked<RoleRepository>;
  let userRepo: jest.Mocked<UserRepository>;
  let cache: jest.Mocked<PermissionCacheService>;
  let auditLog: jest.Mocked<AuditLogService>;

  beforeEach(() => {
    roleRepo = createMock<RoleRepository>();
    userRepo = createMock<UserRepository>();
    cache = createMock<PermissionCacheService>();
    auditLog = createMock<AuditLogService>();

    useCase = new AssignRoleUseCase(roleRepo, userRepo, cache, auditLog);
  });

  it('should assign role and invalidate cache', async () => {
    // Arrange
    const userId = 'user-123';
    const roleId = 'role-operator';
    const tenantId = 'tenant-456';
    const assignedBy = 'admin-789';

    userRepo.findById.mockResolvedValue({ id: userId, tenantId });
    roleRepo.findById.mockResolvedValue({
      id: roleId,
      name: 'OPERATOR',
      tenantId,
      isSystemRole: true,
      permissions: ['fir:create:facility']
    });
    roleRepo.findUserRole.mockResolvedValue(null);
    roleRepo.createUserRole.mockResolvedValue({
      id: 'assignment-001',
      userId,
      roleId,
      tenantId,
      assignedBy,
      assignedAt: new Date()
    });

    const command = new AssignRoleCommand(userId, roleId, tenantId, assignedBy);

    // Act
    const result = await useCase.execute(command);

    // Assert
    expect(result.isSuccess).toBe(true);
    expect(cache.invalidateUser).toHaveBeenCalledWith(userId, tenantId);
    expect(auditLog.logRoleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType: 'ASSIGN',
        changedBy: assignedBy,
        affectedUsers: [userId]
      })
    );
  });

  it('should prevent self-assignment of admin role', async () => {
    // Arrange
    const userId = 'user-123';
    const roleId = 'role-admin';
    const tenantId = 'tenant-456';

    userRepo.findById.mockResolvedValue({ id: userId, tenantId });
    roleRepo.findById.mockResolvedValue({
      id: roleId,
      name: 'ADMIN',
      tenantId,
      isSystemRole: true,
      permissions: ['*:*:all']
    });

    const command = new AssignRoleCommand(
      userId,
      roleId,
      tenantId,
      userId // Self-assignment!
    );

    // Act
    const result = await useCase.execute(command);

    // Assert
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Cannot assign elevated roles to yourself');
    expect(auditLog.logSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SELF_ASSIGNMENT_ATTEMPT' })
    );
  });
});
```

---

## 5. Controller Example

```typescript
// apps/backend/src/api/permissions/controllers/roles.controller.ts

import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RequirePermission } from '../../../core/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../../core/decorators/current-user.decorator';
import { AssignRoleUseCase, AssignRoleCommand } from '../../../application/permissions/use-cases/assign-role.use-case';
import { CreateRoleDto, RoleResponseDto, AssignRoleDto } from '../dto';

@ApiTags('roles')
@Controller('roles')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RolesController {
  constructor(
    private readonly assignRoleUseCase: AssignRoleUseCase
  ) {}

  @Post(':roleId/assign')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('role:assign')
  @ApiOperation({ summary: 'Assign role to user' })
  @ApiResponse({ status: 201, description: 'Role assigned successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Permission denied' })
  async assignRole(
    @Param('roleId') roleId: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<RoleResponseDto> {
    const command = new AssignRoleCommand(
      dto.userId,
      roleId,
      user.tenantId,
      user.id,
      dto.facilityIds,
      dto.expiresAt,
      dto.reason
    );

    const result = await this.assignRoleUseCase.execute(command);

    if (result.isFailure) {
      throw new BadRequestException(result.error);
    }

    return RoleResponseDto.fromDomain(result.value);
  }
}
```

**DTO**:
```typescript
// apps/backend/src/api/permissions/dto/assign-role.dto.ts

import { IsString, IsUUID, IsOptional, IsArray, IsDate, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AssignRoleDto {
  @ApiProperty({ description: 'User ID to assign role to' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ description: 'Facility scope restriction' })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  facilityIds?: string[];

  @ApiPropertyOptional({ description: 'Role expiration timestamp' })
  @IsDate()
  @Type(() => Date)
  @IsOptional()
  expiresAt?: Date;

  @ApiProperty({ description: 'Reason for assignment (audit)', minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
```

---

## 6. Permission Guard Implementation

```typescript
// apps/backend/src/core/guards/permission.guard.ts

import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionCheckService } from '../../application/permissions/permission-check.service';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionCheck: PermissionCheckService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required permission from decorator
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredPermission) {
      return true; // No permission required
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user; // Set by JwtAuthGuard

    // Check permission
    const hasPermission = await this.permissionCheck.check(
      user.id,
      user.tenantId,
      requiredPermission,
      {
        resourceId: request.params.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent']
      }
    );

    if (!hasPermission.allowed) {
      throw new ForbiddenException({
        error: 'PERMISSION_DENIED',
        message: 'Non hai il permesso necessario per eseguire questa azione',
        details: {
          requiredPermission,
          currentRole: user.role,
          reason: hasPermission.reason,
          contactAdministrators: await this.getAdministrators(user.tenantId)
        }
      });
    }

    return true;
  }

  private async getAdministrators(tenantId: string) {
    // Return list of admins for help contact
    // Implement based on your user repository
    return [];
  }
}
```

**Decorator**:
```typescript
// apps/backend/src/core/decorators/require-permission.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission);
```

**Apply globally**:
```typescript
// apps/backend/src/app.module.ts

import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from './core/guards/permission.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: PermissionGuard
    }
  ]
})
export class AppModule {}
```

---

## 7. Permission Cache Service

```typescript
// apps/backend/src/infrastructure/caching/permission-cache.service.ts

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';

interface CachedPermissions {
  userId: string;
  tenantId: string;
  permissions: string[];
  timestamp: number;
  signature: string;
}

@Injectable()
export class PermissionCacheService implements OnModuleInit {
  private redis: Redis;
  private redisSubscriber: Redis;
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly SECRET: string;

  constructor(private config: ConfigService) {
    this.SECRET = config.get('PERMISSION_CACHE_SECRET');
  }

  async onModuleInit() {
    this.redis = new Redis(this.config.get('REDIS_URL'));
    this.redisSubscriber = new Redis(this.config.get('REDIS_URL'));

    // Subscribe to invalidation events
    await this.redisSubscriber.subscribe('permission_invalidation');
    this.redisSubscriber.on('message', (channel, message) => {
      if (channel === 'permission_invalidation') {
        const data = JSON.parse(message);
        this.handleInvalidation(data);
      }
    });
  }

  async get(userId: string, tenantId: string): Promise<string[] | null> {
    const key = this.getCacheKey(userId, tenantId);
    const cached = await this.redis.get(key);

    if (!cached) {
      return null;
    }

    const data: CachedPermissions = JSON.parse(cached);

    // Verify signature (prevent cache poisoning)
    if (!this.verifySignature(data)) {
      await this.redis.del(key); // Remove poisoned entry
      return null;
    }

    return data.permissions;
  }

  async set(userId: string, tenantId: string, permissions: string[]): Promise<void> {
    const key = this.getCacheKey(userId, tenantId);
    const data: CachedPermissions = {
      userId,
      tenantId,
      permissions,
      timestamp: Date.now(),
      signature: this.generateSignature(userId, tenantId, permissions)
    };

    await this.redis.setex(key, this.CACHE_TTL, JSON.stringify(data));
  }

  async invalidateUser(userId: string, tenantId: string): Promise<void> {
    const key = this.getCacheKey(userId, tenantId);
    await this.redis.del(key);

    // Publish invalidation event to all backend instances
    await this.redis.publish(
      'permission_invalidation',
      JSON.stringify({ type: 'USER', userId, tenantId })
    );
  }

  async invalidateTenant(tenantId: string): Promise<void> {
    // Scan and delete all keys for tenant (expensive, use sparingly)
    const pattern = `perm:${tenantId}:*`;
    const stream = this.redis.scanStream({ match: pattern });

    stream.on('data', async (keys: string[]) => {
      if (keys.length) {
        await this.redis.del(...keys);
      }
    });

    await new Promise((resolve) => stream.on('end', resolve));

    // Publish invalidation event
    await this.redis.publish(
      'permission_invalidation',
      JSON.stringify({ type: 'TENANT', tenantId })
    );
  }

  private getCacheKey(userId: string, tenantId: string): string {
    return `perm:${tenantId}:${userId}:v1`;
  }

  private generateSignature(userId: string, tenantId: string, permissions: string[]): string {
    const data = `${userId}|${tenantId}|${permissions.join(',')}`;
    return createHmac('sha256', this.SECRET).update(data).digest('hex');
  }

  private verifySignature(data: CachedPermissions): boolean {
    const expectedSignature = this.generateSignature(
      data.userId,
      data.tenantId,
      data.permissions
    );
    return data.signature === expectedSignature;
  }

  private handleInvalidation(data: { type: string; userId?: string; tenantId: string }) {
    // Handle cross-instance cache invalidation
    // This ensures all backend instances stay in sync
    if (data.type === 'USER' && data.userId) {
      const key = this.getCacheKey(data.userId, data.tenantId);
      this.redis.del(key); // Don't await in event handler
    }
  }
}
```

---

## 8. Common Patterns Cheat Sheet

### Pattern 1: Check Permission in Code
```typescript
@Injectable()
export class SomeService {
  constructor(private permCheck: PermissionCheckService) {}

  async doSomething(userId: string, tenantId: string) {
    const canDelete = await this.permCheck.check(
      userId,
      tenantId,
      'fir:delete:own'
    );

    if (!canDelete.allowed) {
      throw new ForbiddenException('Cannot delete FIR');
    }

    // Proceed with deletion
  }
}
```

### Pattern 2: Protect Controller Endpoint
```typescript
@Post()
@RequirePermission('fir:create')
async createFIR(@Body() dto: CreateFIRDto) {
  // Permission automatically checked by guard
}
```

### Pattern 3: Conditional UI Rendering (Frontend)
```typescript
// Angular component
async ngOnInit() {
  this.canCreateFIR = await this.permissionService.check('fir:create:facility');
}
```

```html
<!-- Template -->
<button *ngIf="canCreateFIR" (click)="createFIR()">
  Crea FIR
</button>
```

### Pattern 4: Invalidate Cache After Role Change
```typescript
async assignRole(userId: string, roleId: string) {
  await this.roleRepo.createUserRole(...);

  // IMPORTANT: Invalidate cache immediately
  await this.cache.invalidateUser(userId, tenantId);

  // Publish event for other instances
  await this.eventBus.publish(new RoleAssignedEvent(userId, roleId));
}
```

### Pattern 5: Batch Permission Check
```typescript
const results = await this.permCheck.batchCheck(userId, tenantId, [
  'fir:create',
  'fir:delete',
  'report:export'
]);

// results = {
//   'fir:create': { allowed: true, ... },
//   'fir:delete': { allowed: false, ... },
//   'report:export': { allowed: true, ... }
// }
```

---

## 9. Testing Commands

```bash
# Run unit tests
npm test -- permissions

# Run integration tests
npm run test:int -- roles

# Run E2E tests
npm run test:e2e -- permission-workflows

# Test specific use case
npm test -- assign-role.use-case

# Coverage report
npm run test:cov -- permissions

# Watch mode during development
npm run test:watch -- permissions
```

---

## 10. Common Issues & Solutions

### Issue: Cache not invalidating after role change

**Solution**: Ensure pub/sub is working
```bash
# Test Redis pub/sub
redis-cli
> SUBSCRIBE permission_invalidation
# In another terminal
redis-cli
> PUBLISH permission_invalidation '{"type":"USER","userId":"123","tenantId":"456"}'
```

### Issue: Permission check taking >50ms

**Solution**: Check cache hit rate
```typescript
// Add instrumentation
const startTime = Date.now();
const cached = await this.cache.get(userId, tenantId);
console.log(`Cache lookup: ${Date.now() - startTime}ms, hit: ${cached !== null}`);
```

### Issue: Self-assignment protection not working

**Solution**: Verify assignedBy matches JWT user
```typescript
// In controller, ensure we use JWT user ID
const command = new AssignRoleCommand(
  dto.userId,
  roleId,
  user.tenantId,
  user.id, // THIS must be from JWT, not request body
  dto.facilityIds
);
```

---

## 11. Next Steps

1. **Implement basic CRUD**: Start with `CreateRoleUseCase`, `AssignRoleUseCase`
2. **Add permission checking**: Implement `PermissionCheckService` with Redis cache
3. **Build controllers**: REST endpoints following OpenAPI spec
4. **Add audit logging**: Async background job via BullMQ
5. **Frontend integration**: Angular service + NgRx state management
6. **Load testing**: k6 scripts for performance validation

**Key Files to Review**:
- `openapi.yaml` - Complete API specification
- `API_DESIGN_NOTES.md` - Architectural decisions and rationale
- Existing `fir.controller.ts` - Pattern reference

**Questions?** Ask in #backend-dev Slack channel

---

**Last Updated**: 2025-10-31
**Maintainer**: Platform Engineering Team
