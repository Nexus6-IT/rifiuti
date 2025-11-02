# Backend Architecture: Comprehensive Roles and Permissions System

**Feature**: 002-roles-permissions-system
**Author**: Backend Architecture Team
**Date**: 2025-10-31
**Status**: Design Document

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Module Organization](#module-organization)
3. [Database Schema Design](#database-schema-design)
4. [Permission Caching Architecture](#permission-caching-architecture)
5. [Guard and Middleware Design](#guard-and-middleware-design)
6. [ABAC Policy Engine](#abac-policy-engine)
7. [Integration with SPID/CIE Authentication](#integration-with-spidcie-authentication)
8. [Performance Optimization Strategy](#performance-optimization-strategy)
9. [Security Considerations](#security-considerations)
10. [Migration Strategy](#migration-strategy)

---

## Executive Summary

This document outlines the technical architecture for implementing a production-grade, multi-tenant roles and permissions system for WasteFlow. The design follows Domain-Driven Design (DDD) principles, SOLID principles, and NestJS best practices while maintaining compatibility with existing SPID/CIE authentication infrastructure.

**Key Design Decisions**:
- **Schema-per-tenant + RLS**: Multi-layered tenant isolation using both PostgreSQL Row-Level Security and application-level filtering
- **Hybrid RBAC/ABAC**: Role-Based Access Control (RBAC) for standard cases, Attribute-Based Access Control (ABAC) for complex policies
- **Redis-powered caching**: Permission cache with <10ms evaluation time, 95%+ hit rate target
- **Decorator-driven authorization**: Clean, declarative permission checks using `@RequirePermission()` decorators
- **Immutable audit trail**: Event-sourced permission changes with cryptographic integrity verification
- **Consultant multi-tenancy**: Special handling for users associated with multiple tenants

---

## Module Organization

### NestJS Module Structure

```
apps/backend/src/
├── domain/
│   ├── permission/                          # Permission Domain (Core Business Logic)
│   │   ├── entities/
│   │   │   ├── role.entity.ts               # Role aggregate root
│   │   │   ├── permission.entity.ts         # Permission entity
│   │   │   ├── user-role.entity.ts          # UserRole junction entity
│   │   │   ├── permission-policy.entity.ts  # ABAC policy entity
│   │   │   └── resource-ownership.entity.ts # Ownership tracking entity
│   │   ├── value-objects/
│   │   │   ├── permission-scope.vo.ts       # Scope (own, facility, tenant, all)
│   │   │   ├── policy-rule.vo.ts            # ABAC rule structure
│   │   │   ├── permission-grant.vo.ts       # Temporary grant value object
│   │   │   └── tenant-context.vo.ts         # Multi-tenant context
│   │   ├── aggregates/
│   │   │   └── role.aggregate.ts            # Role with permissions
│   │   ├── repositories/
│   │   │   ├── role.repository.ts           # Role repository interface
│   │   │   ├── permission.repository.ts     # Permission repository interface
│   │   │   └── audit.repository.ts          # Audit repository interface
│   │   └── services/
│   │       └── permission-evaluation.service.ts # Core permission evaluation logic
│   └── auth/
│       └── entities/
│           └── user.entity.ts               # Extended with permission fields
│
├── application/
│   ├── permission/                          # Application layer (CQRS)
│   │   ├── commands/
│   │   │   ├── assign-role.command.ts       # Assign role to user
│   │   │   ├── create-custom-role.command.ts
│   │   │   ├── grant-temporary-permission.command.ts
│   │   │   ├── revoke-permission.command.ts
│   │   │   └── approve-permission-request.command.ts
│   │   ├── queries/
│   │   │   ├── get-user-permissions.query.ts
│   │   │   ├── get-effective-permissions.query.ts
│   │   │   ├── get-permission-audit.query.ts
│   │   │   └── reconstruct-historical-permissions.query.ts
│   │   ├── use-cases/
│   │   │   ├── assign-role.use-case.ts
│   │   │   ├── evaluate-permission.use-case.ts
│   │   │   ├── request-temporary-access.use-case.ts
│   │   │   └── switch-tenant-context.use-case.ts
│   │   └── dto/
│   │       ├── assign-role.dto.ts
│   │       ├── permission-check-result.dto.ts
│   │       └── effective-permissions.dto.ts
│   └── policy/                              # Policy evaluation engine
│       ├── evaluators/
│       │   ├── policy-evaluator.interface.ts
│       │   ├── attribute-evaluator.ts       # ABAC attribute evaluation
│       │   ├── facility-scope-evaluator.ts  # Facility-scoped checks
│       │   └── ownership-evaluator.ts       # Resource ownership checks
│       └── rules/
│           ├── time-based-rule.ts           # Time-based access rules
│           ├── ip-whitelist-rule.ts         # IP-based restrictions
│           └── certification-rule.ts        # Certification requirements
│
├── infrastructure/
│   ├── persistence/
│   │   ├── repositories/
│   │   │   ├── prisma-role.repository.ts
│   │   │   ├── prisma-permission.repository.ts
│   │   │   └── prisma-audit.repository.ts
│   │   └── seeders/
│   │       └── permission-seeder.ts         # Seed system permissions
│   ├── caching/
│   │   ├── permission-cache.service.ts      # Redis caching layer
│   │   ├── cache-invalidation.service.ts    # Pub/sub invalidation
│   │   └── cache-warming.service.ts         # Proactive cache warming
│   └── audit/
│       ├── audit-writer.service.ts          # Async audit log writer
│       └── audit-archival.service.ts        # Cold storage archival
│
├── api/
│   ├── permission/
│   │   ├── permission.controller.ts         # Permission management endpoints
│   │   ├── role.controller.ts               # Role CRUD endpoints
│   │   ├── audit.controller.ts              # Audit log queries
│   │   └── dto/
│   │       ├── create-role.dto.ts
│   │       ├── assign-role.dto.ts
│   │       ├── permission-request.dto.ts
│   │       └── audit-query.dto.ts
│   └── guards/
│       ├── permission.guard.ts              # Main permission guard
│       ├── tenant-isolation.guard.ts        # Tenant context validation
│       └── step-up-auth.guard.ts            # Re-authentication for sensitive ops
│
└── permission/                              # Permission Module (DI container)
    └── permission.module.ts
```

### Module Dependencies

```typescript
// permission.module.ts - Main DI container
@Module({
  imports: [
    PrismaModule,           // Database access
    AuthModule,             // SPID/CIE authentication
    RedisModule,            // Caching infrastructure
    BullModule,             // Background jobs (expiry checks, archival)
    SocketModule,           // Real-time permission change notifications
  ],
  providers: [
    // Domain services
    PermissionEvaluationService,

    // Repositories
    RoleRepository,
    PermissionRepository,
    AuditRepository,

    // Application services
    AssignRoleUseCase,
    EvaluatePermissionUseCase,
    RequestTemporaryAccessUseCase,
    SwitchTenantContextUseCase,

    // Infrastructure services
    PermissionCacheService,
    CacheInvalidationService,
    AuditWriterService,

    // Policy engine
    PolicyEvaluator,
    AttributeEvaluator,
    FacilityScopeEvaluator,
    OwnershipEvaluator,

    // Guards
    PermissionGuard,
    TenantIsolationGuard,
    StepUpAuthGuard,
  ],
  exports: [
    PermissionGuard,
    TenantIsolationGuard,
    PermissionCacheService,
    EvaluatePermissionUseCase,
  ],
})
export class PermissionModule {}
```

### Circular Dependency Resolution

**Challenge**: Permission module needs User entity, Auth module needs Permission guards.

**Solution**: Use forwardRef() and interface-based dependency injection:

```typescript
// AuthModule exports minimal user service interface
export interface IUserService {
  findById(id: string): Promise<UserEntity>;
  getTenantContext(userId: string): Promise<TenantContext>;
}

// PermissionModule imports IUserService, not concrete AuthModule
```

---

## Database Schema Design

### Prisma Schema Extensions

```prisma
// ============================================================================
// ROLES AND PERMISSIONS SYSTEM
// ============================================================================

/// System-defined and custom roles
model Role {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String?  @map("tenant_id") @db.Uuid  // NULL for system roles
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Core attributes
  name          String  @db.VarChar(100)
  slug          String  @db.VarChar(100)  // e.g., "system_admin", "site_manager_milano"
  description   String? @db.Text

  // System protection
  isSystemRole  Boolean @default(false) @map("is_system_role")  // Prevents deletion
  isActive      Boolean @default(true) @map("is_active")

  // Audit
  createdBy     String?  @map("created_by") @db.Uuid

  // Relationships
  tenant          Tenant?           @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  userRoles       UserRole[]
  rolePermissions RolePermission[]
  changeHistory   RoleChangeHistory[]

  @@unique([tenantId, slug])  // Unique slug per tenant (system roles have NULL tenant)
  @@index([tenantId])
  @@index([isSystemRole])
  @@map("roles")
}

/// Atomic permissions (platform-defined)
model Permission {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Permission structure: {resource}:{action}:{scope}
  resource    String  @db.VarChar(50)  // fir, facility, report, user, tenant, mud
  action      String  @db.VarChar(50)  // create, read, update, delete, approve, sign, export
  scope       String  @db.VarChar(50)  // own, facility, tenant, all

  // Full permission key
  permissionKey String @unique @map("permission_key") @db.VarChar(150)  // "fir:create:facility"

  // Metadata
  description   String  @db.Text
  sensitivity   PermissionSensitivity @default(STANDARD)  // Controls audit verbosity
  requiresStepUp Boolean @default(false) @map("requires_step_up")  // Re-auth needed

  // Relationships
  rolePermissions RolePermission[]
  policies        PermissionPolicy[]
  auditLogs       PermissionAuditLog[]

  @@index([resource])
  @@index([sensitivity])
  @@map("permissions")
}

enum PermissionSensitivity {
  STANDARD      // Normal operations
  SENSITIVE     // Financial data, exports
  CRITICAL      // Delete, system config changes

  @@map("permission_sensitivity")
}

/// Junction table: Role <-> Permission (many-to-many)
model RolePermission {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  roleId       String   @map("role_id") @db.Uuid
  permissionId String   @map("permission_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at")

  // Optional constraints (override permission defaults)
  facilityIds  String[] @map("facility_ids") @db.Uuid[]  // Restrict to specific facilities
  conditions   Json?     // ABAC conditions override

  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@unique([roleId, permissionId])
  @@index([roleId])
  @@index([permissionId])
  @@map("role_permissions")
}

/// User role assignments (multi-tenant aware)
model UserRole {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  roleId    String   @map("role_id") @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid  // Explicit tenant context
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Assignment metadata
  assignedBy  String   @map("assigned_by") @db.Uuid  // Who granted this role
  assignedAt  DateTime @default(now()) @map("assigned_at")

  // Expiration (for temporary grants)
  expiresAt   DateTime? @map("expires_at")
  isExpired   Boolean   @default(false) @map("is_expired")  // Denormalized for query performance

  // Facility scoping (optional)
  facilityIds String[] @map("facility_ids") @db.Uuid[]  // Empty array = all facilities

  // Delegation tracking
  isDelegated      Boolean  @default(false) @map("is_delegated")
  delegationReason String?  @map("delegation_reason") @db.Text

  // Relationships
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)
  tenant     Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  assigner   User     @relation("AssignedByUser", fields: [assignedBy], references: [id])

  @@unique([userId, roleId, tenantId])  // User can have same role once per tenant
  @@index([userId, tenantId])           // Fast lookup: user's roles in tenant
  @@index([tenantId])
  @@index([expiresAt, isExpired])       // Background job: find expired grants
  @@map("user_roles")
}

/// ABAC policies for fine-grained access control
model PermissionPolicy {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  permissionId String   @map("permission_id") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  // Policy metadata
  name            String  @db.VarChar(100)
  description     String? @db.Text
  evaluationOrder Int     @default(100) @map("evaluation_order")  // Lower = higher priority
  isActive        Boolean @default(true) @map("is_active")

  // Policy rules (JSON-encoded)
  // Example: { "conditions": [{"attribute": "user.certifications", "operator": "contains", "value": "ADR"}] }
  policyRules     Json    @map("policy_rules")

  // Effect
  effect          PolicyEffect @default(ALLOW)

  // Version tracking (for rollback)
  version         Int     @default(1)
  previousVersion String? @map("previous_version") @db.Uuid

  permission      Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)

  @@index([permissionId])
  @@index([isActive, evaluationOrder])
  @@map("permission_policies")
}

enum PolicyEffect {
  ALLOW
  DENY

  @@map("policy_effect")
}

/// Immutable audit log for all permission checks
model PermissionAuditLog {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")  // Immutable, no updatedAt

  // User context
  userId         String  @map("user_id") @db.Uuid
  fiscalCode     String  @map("fiscal_code") @db.VarChar(16)  // SPID fiscal code
  userEmail      String  @map("user_email") @db.VarChar(255)

  // Permission check details
  permissionId   String  @map("permission_id") @db.Uuid
  permissionKey  String  @map("permission_key") @db.VarChar(150)

  // Resource context
  resourceType   String  @map("resource_type") @db.VarChar(50)
  resourceId     String? @map("resource_id") @db.Uuid

  // Decision
  decision       PermissionDecision
  denialReason   String? @map("denial_reason") @db.Text
  evaluatedRoles String[] @map("evaluated_roles") @db.VarChar(100)[]  // Roles checked
  evaluatedPolicies String[] @map("evaluated_policies") @db.Uuid[]    // Policies evaluated

  // Request context
  ipAddress      String? @map("ip_address") @db.VarChar(45)
  userAgent      String? @map("user_agent") @db.VarChar(500)
  requestPath    String? @map("request_path") @db.VarChar(500)
  httpMethod     String? @map("http_method") @db.VarChar(10)

  // Session context
  sessionId      String? @map("session_id") @db.VarChar(100)
  tenantContextId String? @map("tenant_context_id") @db.Uuid  // For consultant multi-tenant

  // Performance tracking
  evaluationMs   Int     @map("evaluation_ms")  // Milliseconds to evaluate
  cacheHit       Boolean @default(false) @map("cache_hit")

  tenant     Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user       User       @relation(fields: [userId], references: [id])
  permission Permission @relation(fields: [permissionId], references: [id])

  @@index([tenantId, createdAt])        // Tenant audit queries
  @@index([userId, createdAt])          // User activity timeline
  @@index([resourceType, resourceId])   // Resource access history
  @@index([decision])                   // Filter denied attempts
  @@index([createdAt])                  // Time-series archival
  @@map("permission_audit_logs")
}

enum PermissionDecision {
  ALLOW
  DENY
  CONDITIONAL_ALLOW  // Allowed with constraints

  @@map("permission_decision")
}

/// Role and permission change history (for reconstruction)
model RoleChangeHistory {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String?  @map("tenant_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  // Change metadata
  entityType   RoleChangeEntityType @map("entity_type")
  entityId     String               @map("entity_id") @db.Uuid
  changeType   RoleChangeType       @map("change_type")

  // Audit
  changedBy    String  @map("changed_by") @db.Uuid
  reason       String? @db.Text  // Mandatory for sensitive changes

  // State snapshots (JSON)
  beforeState  Json?   @map("before_state")
  afterState   Json    @map("after_state")

  // Relationships
  tenant    Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  changedByUser User @relation(fields: [changedBy], references: [id])

  @@index([tenantId, createdAt])
  @@index([entityType, entityId])
  @@index([changedBy])
  @@map("role_change_history")
}

enum RoleChangeEntityType {
  ROLE
  PERMISSION
  USER_ROLE
  ROLE_PERMISSION
  POLICY

  @@map("role_change_entity_type")
}

enum RoleChangeType {
  CREATE
  UPDATE
  DELETE
  ASSIGN
  REVOKE
  EXPIRE

  @@map("role_change_type")
}

/// Resource ownership tracking (for ABAC "own" scope)
model ResourceOwnership {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Resource identification
  resourceType String @map("resource_type") @db.VarChar(50)  // fir, report, facility
  resourceId   String @map("resource_id") @db.Uuid

  // Ownership
  ownerId      String  @map("owner_id") @db.Uuid
  facilityId   String? @map("facility_id") @db.Uuid  // Associated facility

  // Transfer tracking
  transferredFrom String?   @map("transferred_from") @db.Uuid
  transferredAt   DateTime? @map("transferred_at")
  transferReason  String?   @map("transfer_reason") @db.Text

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  owner  User   @relation(fields: [ownerId], references: [id])

  @@unique([resourceType, resourceId])  // One owner per resource
  @@index([tenantId, ownerId])
  @@index([resourceType, resourceId])
  @@map("resource_ownership")
}

/// Temporary permission grants (time-bounded elevation)
model TemporaryPermissionGrant {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Grantee
  userId       String @map("user_id") @db.Uuid

  // Permissions granted
  permissionIds String[] @map("permission_ids") @db.Uuid[]

  // Time bounds
  startAt      DateTime  @map("start_at")
  expiresAt    DateTime  @map("expires_at")

  // Status
  status       GrantStatus @default(PENDING)
  isRevoked    Boolean     @default(false) @map("is_revoked")
  revokedAt    DateTime?   @map("revoked_at")
  revokedBy    String?     @map("revoked_by") @db.Uuid
  revokeReason String?     @map("revoke_reason") @db.Text

  // Approval workflow
  grantedBy    String   @map("granted_by") @db.Uuid
  approvedBy   String?  @map("approved_by") @db.Uuid
  approvedAt   DateTime? @map("approved_at")

  // Business justification
  justification String  @db.Text
  requestContext Json?  @map("request_context")  // What action triggered request

  tenant    Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  user      User   @relation("GrantedToUser", fields: [userId], references: [id])
  granter   User   @relation("GrantedByUser", fields: [grantedBy], references: [id])
  approver  User?  @relation("ApprovedByUser", fields: [approvedBy], references: [id])

  @@index([userId, expiresAt])          // Find active grants
  @@index([tenantId, status])
  @@index([expiresAt, isRevoked])       // Background job: auto-revoke
  @@map("temporary_permission_grants")
}

enum GrantStatus {
  PENDING
  APPROVED
  ACTIVE
  EXPIRED
  REVOKED

  @@map("grant_status")
}

/// Consultant tenant associations (many-to-many)
model ConsultantTenantAssociation {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  consultantUserId String  @map("consultant_user_id") @db.Uuid
  clientTenantId   String  @map("client_tenant_id") @db.Uuid
  roleId           String  @map("role_id") @db.Uuid  // Role in this client's tenant

  // Association metadata
  isActive         Boolean  @default(true) @map("is_active")
  invitedBy        String   @map("invited_by") @db.Uuid
  acceptedAt       DateTime? @map("accepted_at")

  consultant  User   @relation("ConsultantUser", fields: [consultantUserId], references: [id])
  clientTenant Tenant @relation(fields: [clientTenantId], references: [id], onDelete: Cascade)
  role        Role   @relation(fields: [roleId], references: [id])

  @@unique([consultantUserId, clientTenantId])
  @@index([consultantUserId])
  @@index([clientTenantId])
  @@map("consultant_tenant_associations")
}

// ============================================================================
// EXTENSIONS TO EXISTING MODELS
// ============================================================================

model User {
  // ... existing fields ...

  // Permission-related additions
  certifications     String[] @default([])  // ADR, waste operator license, etc.
  isConsultant       Boolean  @default(false) @map("is_consultant")
  previousFiscalCodes String[] @default([]) @map("previous_fiscal_codes")  // Legal name changes

  // Relationships
  userRoles          UserRole[]
  assignedRoles      UserRole[] @relation("AssignedByUser")
  auditLogs          PermissionAuditLog[]
  roleChanges        RoleChangeHistory[]
  ownedResources     ResourceOwnership[]
  receivedGrants     TemporaryPermissionGrant[] @relation("GrantedToUser")
  issuedGrants       TemporaryPermissionGrant[] @relation("GrantedByUser")
  approvedGrants     TemporaryPermissionGrant[] @relation("ApprovedByUser")
  consultantFor      ConsultantTenantAssociation[] @relation("ConsultantUser")
}

model Tenant {
  // ... existing fields ...

  // Permission audit retention policy
  auditRetentionYears Int @default(10) @map("audit_retention_years")

  // Relationships
  roles                     Role[]
  userRoles                 UserRole[]
  auditLogs                 PermissionAuditLog[]
  roleChangeHistory         RoleChangeHistory[]
  resourceOwnerships        ResourceOwnership[]
  temporaryGrants           TemporaryPermissionGrant[]
  consultantAssociations    ConsultantTenantAssociation[]
}
```

### Database Indexes Strategy

**Performance Targets**:
- Permission lookup: <5ms (cache hit) / <20ms (cache miss)
- Audit log query: <100ms for 30-day range, <500ms for 1-year range
- Role assignment: <50ms

**Index Rationale**:

1. **UserRole indexes**:
   - `@@index([userId, tenantId])`: Fast permission resolution for specific user/tenant
   - `@@index([expiresAt, isExpired])`: Background job efficiency for expiry checks

2. **PermissionAuditLog indexes**:
   - `@@index([tenantId, createdAt])`: Time-series queries by tenant
   - `@@index([userId, createdAt])`: User activity timeline
   - Partitioning strategy: Monthly partitions after 10,000 audit entries

3. **RolePermission indexes**:
   - `@@unique([roleId, permissionId])`: Prevent duplicate assignments
   - Clustered index on `roleId` for efficient permission expansion

### PostgreSQL Row-Level Security (RLS) Policies

```sql
-- Enable RLS on permission tables
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_ownership ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own roles in their tenant context
CREATE POLICY user_roles_isolation ON user_roles
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Policy: Audit logs scoped to tenant
CREATE POLICY audit_isolation ON permission_audit_logs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Policy: Consultants can see roles across associated tenants
CREATE POLICY consultant_multi_tenant ON user_roles
  USING (
    tenant_id = current_setting('app.current_tenant_id')::uuid
    OR
    user_id IN (
      SELECT consultant_user_id
      FROM consultant_tenant_associations
      WHERE client_tenant_id = tenant_id AND is_active = true
    )
  );
```

**Implementation Note**: Set `app.current_tenant_id` session variable on every request via middleware:

```typescript
// Set tenant context for RLS
await prisma.$executeRaw`SET LOCAL app.current_tenant_id = ${tenantId}::uuid`;
```

---

## Permission Caching Architecture

### Redis Key Structure

**Design Goal**: Sub-10ms permission checks with 95%+ cache hit rate.

```typescript
// Cache key patterns
const CACHE_KEYS = {
  // User's effective permissions in tenant (5-minute TTL)
  userPermissions: (userId: string, tenantId: string) =>
    `perm:user:${userId}:tenant:${tenantId}`,

  // User's roles in tenant (15-minute TTL)
  userRoles: (userId: string, tenantId: string) =>
    `perm:roles:${userId}:tenant:${tenantId}`,

  // Role's permissions (1-hour TTL, invalidated on role change)
  rolePermissions: (roleId: string) =>
    `perm:role:${roleId}:perms`,

  // Specific permission check result (10-minute TTL)
  permissionCheck: (userId: string, tenantId: string, permissionKey: string, resourceId?: string) =>
    `perm:check:${userId}:${tenantId}:${permissionKey}${resourceId ? `:${resourceId}` : ''}`,

  // Consultant's tenant list (1-hour TTL)
  consultantTenants: (userId: string) =>
    `perm:consultant:${userId}:tenants`,

  // HMAC signature for cache integrity (prevents poisoning)
  cacheSignature: (key: string, payload: string) =>
    crypto.createHmac('sha256', process.env.CACHE_HMAC_SECRET)
      .update(`${key}:${payload}`)
      .digest('hex'),
};
```

### Cache Data Structures

```typescript
// User permissions cache (Redis Hash)
interface UserPermissionsCache {
  userId: string;
  tenantId: string;
  permissions: string[];                    // Array of permission keys
  roles: string[];                          // Array of role slugs
  facilityIds: string[];                    // Facility scope restrictions
  temporaryGrants: TemporaryGrantCache[];   // Active temporary elevations
  consultantMode: boolean;                  // Is this a consultant context?
  cachedAt: number;                         // Unix timestamp
  signature: string;                        // HMAC for integrity
}

interface TemporaryGrantCache {
  grantId: string;
  permissionKeys: string[];
  expiresAt: number;  // Unix timestamp
}

// Permission check cache (Redis String with JSON)
interface PermissionCheckCache {
  userId: string;
  tenantId: string;
  permissionKey: string;
  resourceId?: string;
  decision: 'ALLOW' | 'DENY' | 'CONDITIONAL_ALLOW';
  evaluatedAt: number;
  ttl: number;
  signature: string;
}
```

### Cache Warming Strategy

**Proactive Warming**: Pre-populate cache for likely permission checks.

```typescript
@Injectable()
export class CacheWarmingService {
  constructor(
    private readonly redis: RedisService,
    private readonly permissionRepo: PermissionRepository,
  ) {}

  /**
   * Warm cache on user login
   * Triggered by SPID authentication callback
   */
  async warmUserPermissions(userId: string, tenantId: string): Promise<void> {
    // 1. Load user's roles
    const roles = await this.permissionRepo.getUserRoles(userId, tenantId);

    // 2. Expand roles to permissions
    const permissions = await this.permissionRepo.expandRolePermissions(roles);

    // 3. Store in Redis with TTL
    const cacheData: UserPermissionsCache = {
      userId,
      tenantId,
      permissions: permissions.map(p => p.permissionKey),
      roles: roles.map(r => r.slug),
      facilityIds: this.extractFacilityIds(roles),
      temporaryGrants: await this.loadActiveGrants(userId),
      consultantMode: await this.isConsultant(userId),
      cachedAt: Date.now(),
      signature: '', // Set after serialization
    };

    // Sign payload
    const payload = JSON.stringify(cacheData);
    cacheData.signature = CACHE_KEYS.cacheSignature(
      CACHE_KEYS.userPermissions(userId, tenantId),
      payload
    );

    // Store with TTL
    await this.redis.setex(
      CACHE_KEYS.userPermissions(userId, tenantId),
      300, // 5 minutes
      JSON.stringify(cacheData)
    );
  }

  /**
   * Warm common permission checks
   * Based on user's primary role
   */
  async warmCommonChecks(userId: string, tenantId: string, primaryRole: string): Promise<void> {
    const commonPermissions = this.getCommonPermissionsForRole(primaryRole);

    for (const permKey of commonPermissions) {
      // Pre-evaluate and cache
      await this.evaluateAndCache(userId, tenantId, permKey);
    }
  }

  private getCommonPermissionsForRole(role: string): string[] {
    const rolePermissionMap = {
      'operator': ['fir:create:own', 'fir:read:facility', 'fir:update:own'],
      'manager': ['fir:read:all', 'report:export:tenant', 'user:read:tenant'],
      'admin': ['user:create:tenant', 'user:update:tenant', 'role:assign:tenant'],
    };

    return rolePermissionMap[role] || [];
  }
}
```

### Cache Invalidation Strategy

**Challenge**: Ensure cache consistency when permissions change without excessive invalidations.

**Solution**: Pub/Sub-based selective invalidation with fallback to stale-while-revalidate pattern.

```typescript
@Injectable()
export class CacheInvalidationService {
  constructor(
    private readonly redis: RedisService,
    private readonly eventBus: EventEmitter2,
  ) {
    // Subscribe to permission change events
    this.eventBus.on('permission.role_assigned', this.onRoleAssigned.bind(this));
    this.eventBus.on('permission.role_revoked', this.onRoleRevoked.bind(this));
    this.eventBus.on('permission.role_modified', this.onRoleModified.bind(this));
    this.eventBus.on('permission.grant_expired', this.onGrantExpired.bind(this));
  }

  /**
   * Invalidate user's permission cache when role assigned
   */
  async onRoleAssigned(event: { userId: string; tenantId: string; roleId: string }): Promise<void> {
    const { userId, tenantId } = event;

    // Invalidate user cache
    await this.redis.del(CACHE_KEYS.userPermissions(userId, tenantId));
    await this.redis.del(CACHE_KEYS.userRoles(userId, tenantId));

    // Invalidate all permission checks for this user/tenant
    await this.invalidateUserPermissionChecks(userId, tenantId);

    // Publish invalidation event for distributed systems
    await this.redis.publish('cache:invalidate', JSON.stringify({
      type: 'user_permissions',
      userId,
      tenantId,
      timestamp: Date.now(),
    }));

    // Log invalidation
    console.log(`[Cache] Invalidated permissions for user ${userId} in tenant ${tenantId}`);
  }

  /**
   * Invalidate role cache when role permissions modified
   */
  async onRoleModified(event: { roleId: string }): Promise<void> {
    const { roleId } = event;

    // Invalidate role permission cache
    await this.redis.del(CACHE_KEYS.rolePermissions(roleId));

    // Find all users with this role and invalidate
    const affectedUsers = await this.findUsersWithRole(roleId);

    for (const { userId, tenantId } of affectedUsers) {
      await this.redis.del(CACHE_KEYS.userPermissions(userId, tenantId));
    }

    // Publish for distributed invalidation
    await this.redis.publish('cache:invalidate', JSON.stringify({
      type: 'role_modified',
      roleId,
      affectedUserCount: affectedUsers.length,
      timestamp: Date.now(),
    }));
  }

  /**
   * Pattern-based invalidation (use sparingly, expensive)
   */
  async invalidateUserPermissionChecks(userId: string, tenantId: string): Promise<void> {
    const pattern = `perm:check:${userId}:${tenantId}:*`;
    const keys = await this.redis.keys(pattern);

    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
```

### Cache Hit Rate Optimization

**Monitoring**: Track cache performance metrics.

```typescript
@Injectable()
export class PermissionCacheService {
  private cacheHits = 0;
  private cacheMisses = 0;

  async getCachedPermissions(userId: string, tenantId: string): Promise<UserPermissionsCache | null> {
    const key = CACHE_KEYS.userPermissions(userId, tenantId);
    const cached = await this.redis.get(key);

    if (!cached) {
      this.cacheMisses++;
      return null;
    }

    // Verify signature
    const data = JSON.parse(cached);
    const expectedSignature = CACHE_KEYS.cacheSignature(key, cached);

    if (data.signature !== expectedSignature) {
      // Cache poisoning detected!
      console.error(`[Security] Cache signature mismatch for key ${key}`);
      await this.redis.del(key);
      this.cacheMisses++;
      return null;
    }

    this.cacheHits++;
    return data;
  }

  /**
   * Calculate cache hit rate (for monitoring)
   */
  getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total === 0 ? 0 : (this.cacheHits / total) * 100;
  }
}
```

### Stale-While-Revalidate Pattern

**Challenge**: Avoid cache stampede when popular cache entries expire.

**Solution**: Serve stale data while asynchronously refreshing in background.

```typescript
async getPermissionsWithRevalidation(
  userId: string,
  tenantId: string
): Promise<UserPermissionsCache> {
  const cached = await this.getCachedPermissions(userId, tenantId);

  if (cached) {
    const age = Date.now() - cached.cachedAt;
    const staleTTL = 240000; // 4 minutes (80% of 5-minute cache TTL)

    if (age > staleTTL) {
      // Data is stale but still usable
      // Trigger background refresh without blocking
      this.refreshInBackground(userId, tenantId).catch(err =>
        console.error('Background refresh failed', err)
      );
    }

    return cached;
  }

  // Cache miss - fetch from database
  return await this.loadAndCachePermissions(userId, tenantId);
}

private async refreshInBackground(userId: string, tenantId: string): Promise<void> {
  await this.loadAndCachePermissions(userId, tenantId);
}
```

---

## Guard and Middleware Design

### Permission Guard Architecture

**Design Goal**: Declarative permission checks with minimal boilerplate.

```typescript
// ============================================================================
// CUSTOM DECORATORS
// ============================================================================

/**
 * @RequirePermission decorator - Declarative permission enforcement
 *
 * Usage:
 * @RequirePermission('fir:create:facility')
 * @RequirePermission('fir:delete:own', { resourceParam: 'firId' })
 * @RequirePermission('report:export:tenant', { sensitivity: 'CRITICAL' })
 */
export const RequirePermission = (
  permissionKey: string,
  options?: PermissionCheckOptions
): MethodDecorator => {
  return SetMetadata(PERMISSION_KEY, { permissionKey, options });
};

export interface PermissionCheckOptions {
  // Resource ID parameter name (for resource-level checks)
  resourceParam?: string;

  // Override sensitivity (triggers step-up auth if CRITICAL)
  sensitivity?: PermissionSensitivity;

  // ABAC context evaluation
  evaluateContext?: boolean;

  // Allow permission check to fail silently (for optional features)
  optional?: boolean;
}

/**
 * @RequireAnyPermission - Allow if user has ANY of the listed permissions
 */
export const RequireAnyPermission = (
  permissionKeys: string[]
): MethodDecorator => {
  return SetMetadata(PERMISSION_ANY_KEY, permissionKeys);
};

/**
 * @RequireAllPermissions - Require ALL listed permissions
 */
export const RequireAllPermissions = (
  permissionKeys: string[]
): MethodDecorator => {
  return SetMetadata(PERMISSION_ALL_KEY, permissionKeys);
};

// ============================================================================
// PERMISSION GUARD
// ============================================================================

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly evaluatePermissionUseCase: EvaluatePermissionUseCase,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Extract permission metadata from decorator
    const permissionMeta = this.reflector.getAllAndOverride<PermissionMetadata>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()]
    );

    // If no permission required, allow
    if (!permissionMeta) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;  // Populated by JwtAuthGuard
    const tenantId = request.tenantId;  // Populated by TenantIsolationGuard

    if (!user || !tenantId) {
      throw new UnauthorizedException('Authentication required');
    }

    // Extract resource ID from request params if specified
    const resourceId = permissionMeta.options?.resourceParam
      ? request.params[permissionMeta.options.resourceParam]
      : undefined;

    // Build evaluation context
    const context = this.buildEvaluationContext(request, user, resourceId);

    // Evaluate permission
    const result = await this.evaluatePermissionUseCase.execute({
      userId: user.id,
      tenantId,
      permissionKey: permissionMeta.permissionKey,
      resourceId,
      context,
    });

    // Write audit log (async, non-blocking)
    this.auditWriter.logPermissionCheck(
      user,
      tenantId,
      permissionMeta.permissionKey,
      result,
      context
    ).catch(err => console.error('Audit log write failed', err));

    // Handle result
    if (result.decision === 'ALLOW') {
      return true;
    }

    if (result.decision === 'CONDITIONAL_ALLOW') {
      // Attach conditions to request for downstream use
      request.permissionConditions = result.conditions;
      return true;
    }

    // Denied - throw descriptive error
    throw new ForbiddenException({
      message: 'Permission denied',
      requiredPermission: permissionMeta.permissionKey,
      currentRole: user.role,
      reason: result.denialReason,
      contactAdmin: await this.getAdminContact(tenantId),
    });
  }

  private buildEvaluationContext(
    request: any,
    user: any,
    resourceId?: string
  ): PermissionEvaluationContext {
    return {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestPath: request.path,
      httpMethod: request.method,
      sessionId: request.sessionId,
      resourceId,
      userCertifications: user.certifications || [],
      timestamp: new Date(),
    };
  }

  private async getAdminContact(tenantId: string): Promise<string> {
    // Find tenant admins to contact
    // Implementation omitted for brevity
    return 'admin@example.com';
  }
}

// ============================================================================
// TENANT ISOLATION GUARD
// ============================================================================

/**
 * TenantIsolationGuard - Validates and sets tenant context
 * Runs BEFORE PermissionGuard
 */
@Injectable()
export class TenantIsolationGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Extract tenant ID from request
    // Priority: Header > JWT claim > Query param
    let tenantId = request.headers['x-tenant-id']
      || user.tenantId
      || request.query.tenantId;

    // Consultant multi-tenant context
    if (user.isConsultant && tenantId) {
      // Verify consultant has access to this tenant
      const hasAccess = await this.verifyConsultantAccess(user.id, tenantId);
      if (!hasAccess) {
        throw new ForbiddenException('No access to this tenant');
      }
    }

    // Validate tenant exists and is active
    const tenant = await this.getTenantCached(tenantId);
    if (!tenant || tenant.subscriptionStatus === 'SUSPENDED') {
      throw new ForbiddenException('Tenant not accessible');
    }

    // Set tenant context on request
    request.tenantId = tenantId;
    request.tenant = tenant;

    // Set PostgreSQL RLS context
    await this.prisma.$executeRawUnsafe(
      `SET LOCAL app.current_tenant_id = '${tenantId}'`
    );

    return true;
  }

  private async verifyConsultantAccess(
    consultantId: string,
    tenantId: string
  ): Promise<boolean> {
    const cacheKey = `consultant:${consultantId}:tenants`;
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      const tenantIds = JSON.parse(cached);
      return tenantIds.includes(tenantId);
    }

    // Cache miss - query database
    const associations = await this.prisma.consultantTenantAssociation.findMany({
      where: { consultantUserId: consultantId, isActive: true },
      select: { clientTenantId: true },
    });

    const tenantIds = associations.map(a => a.clientTenantId);

    // Cache for 1 hour
    await this.redis.setex(cacheKey, 3600, JSON.stringify(tenantIds));

    return tenantIds.includes(tenantId);
  }

  private async getTenantCached(tenantId: string): Promise<Tenant | null> {
    // Implementation: Cache tenant details
    return this.prisma.tenant.findUnique({ where: { id: tenantId } });
  }
}

// ============================================================================
// STEP-UP AUTHENTICATION GUARD
// ============================================================================

/**
 * StepUpAuthGuard - Require re-authentication for sensitive operations
 * Runs BEFORE PermissionGuard
 */
@Injectable()
export class StepUpAuthGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Check if user recently re-authenticated
    const lastAuthTime = await this.getLastAuthTime(user.id);
    const reauthRequired = Date.now() - lastAuthTime > 15 * 60 * 1000; // 15 minutes

    if (reauthRequired) {
      throw new UnauthorizedException({
        code: 'STEP_UP_REQUIRED',
        message: 'Recent authentication required for this operation',
        redirectTo: '/auth/step-up',
      });
    }

    return true;
  }

  private async getLastAuthTime(userId: string): Promise<number> {
    const key = `auth:stepup:${userId}`;
    const cached = await this.redis.get(key);
    return cached ? parseInt(cached) : 0;
  }
}
```

### Controller Usage Examples

```typescript
// ============================================================================
// FIR CONTROLLER - Permission examples
// ============================================================================

@Controller('fir')
@UseGuards(JwtAuthGuard, TenantIsolationGuard, PermissionGuard)
export class FIRController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Create FIR - Requires fir:create:facility permission
   */
  @Post()
  @RequirePermission('fir:create:facility')
  async createFIR(@Body() dto: CreateFIRDto, @Req() request): Promise<FIRResponseDto> {
    const command = new CreateFIRCommand({
      ...dto,
      userId: request.user.id,
      tenantId: request.tenantId,
    });

    return this.commandBus.execute(command);
  }

  /**
   * Get FIR by ID - Requires fir:read with resource-level check
   */
  @Get(':firId')
  @RequirePermission('fir:read:facility', { resourceParam: 'firId' })
  async getFIR(@Param('firId') firId: string): Promise<FIRResponseDto> {
    // Permission already checked by guard
    // Resource-level authorization verified (user can access this specific FIR)
    return this.queryBus.execute(new GetFIRByIdQuery(firId));
  }

  /**
   * Delete FIR - Requires critical permission with step-up auth
   */
  @Delete(':firId')
  @UseGuards(StepUpAuthGuard)  // Require recent re-authentication
  @RequirePermission('fir:delete:own', {
    resourceParam: 'firId',
    sensitivity: 'CRITICAL',
  })
  async deleteFIR(@Param('firId') firId: string): Promise<void> {
    return this.commandBus.execute(new DeleteFIRCommand(firId));
  }

  /**
   * Sign FIR - Requires multiple permissions (ANY match)
   */
  @Post(':firId/sign')
  @RequireAnyPermission([
    'fir:sign:own',
    'fir:sign:facility',
    'fir:sign:tenant',
  ])
  async signFIR(
    @Param('firId') firId: string,
    @Body() dto: SignFIRDto
  ): Promise<FIRResponseDto> {
    // Additional business logic: verify digital certificate
    return this.commandBus.execute(new SignFIRCommand(firId, dto));
  }

  /**
   * Export report - Requires ALL permissions
   */
  @Get('export/report')
  @RequireAllPermissions([
    'report:export:tenant',
    'fir:read:all',
  ])
  async exportReport(@Query() dto: ExportReportDto): Promise<StreamableFile> {
    // Generate and return report
    return this.queryBus.execute(new ExportReportQuery(dto));
  }
}

// ============================================================================
// USER MANAGEMENT CONTROLLER - Role assignment
// ============================================================================

@Controller('users')
@UseGuards(JwtAuthGuard, TenantIsolationGuard, PermissionGuard)
export class UserController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Assign role to user - Admin only
   */
  @Post(':userId/roles')
  @RequirePermission('user:assign_role:tenant')
  async assignRole(
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
    @Req() request
  ): Promise<void> {
    // Prevent self-assignment of elevated roles (security)
    if (userId === request.user.id && dto.roleId !== request.user.currentRoleId) {
      throw new ForbiddenException('Cannot self-assign different role');
    }

    return this.commandBus.execute(new AssignRoleCommand({
      userId,
      roleId: dto.roleId,
      tenantId: request.tenantId,
      assignedBy: request.user.id,
      facilityIds: dto.facilityIds,
    }));
  }

  /**
   * Request temporary permission elevation
   */
  @Post('me/request-access')
  async requestTemporaryAccess(
    @Body() dto: RequestAccessDto,
    @Req() request
  ): Promise<{ requestId: string }> {
    // No permission check - all users can request
    return this.commandBus.execute(new RequestTemporaryAccessCommand({
      userId: request.user.id,
      tenantId: request.tenantId,
      permissionKeys: dto.permissionKeys,
      justification: dto.justification,
      duration: dto.durationHours,
    }));
  }
}
```

### Guard Execution Order

**Critical**: Guards execute in reverse order of registration.

```typescript
// Global guards (applied to all routes)
app.useGlobalGuards(
  new JwtAuthGuard(reflector),           // 1st: Authenticate user
  new TenantIsolationGuard(prisma, redis), // 2nd: Validate tenant context
  new PermissionGuard(evaluator, audit),   // 3rd: Check permissions
);

// Route-specific guards (override order)
@UseGuards(StepUpAuthGuard, PermissionGuard)  // Step-up before permission check
```

---

## ABAC Policy Engine

### Policy Evaluation Architecture

**Design Goal**: Flexible attribute-based policies without custom code changes.

```typescript
// ============================================================================
// POLICY EVALUATOR - Core engine
// ============================================================================

@Injectable()
export class PolicyEvaluator {
  constructor(
    private readonly policyRepo: PermissionPolicyRepository,
    private readonly attributeEvaluator: AttributeEvaluator,
  ) {}

  /**
   * Evaluate ABAC policies for permission
   * Returns ALLOW, DENY, or CONDITIONAL_ALLOW
   */
  async evaluatePolicies(
    permission: Permission,
    context: PermissionEvaluationContext
  ): Promise<PolicyEvaluationResult> {
    // Load active policies for this permission
    const policies = await this.policyRepo.findActiveByPermission(
      permission.id,
      { orderBy: 'evaluationOrder' }
    );

    if (policies.length === 0) {
      // No policies = default ALLOW (RBAC-only mode)
      return { decision: 'ALLOW', evaluatedPolicies: [] };
    }

    // Evaluate policies in order until first match
    for (const policy of policies) {
      const result = await this.evaluatePolicy(policy, context);

      if (result.matched) {
        return {
          decision: policy.effect === 'ALLOW' ? 'ALLOW' : 'DENY',
          evaluatedPolicies: [policy.id],
          matchedPolicy: policy.name,
          conditions: result.conditions,
        };
      }
    }

    // No policy matched = default DENY (fail-secure)
    return {
      decision: 'DENY',
      evaluatedPolicies: policies.map(p => p.id),
      denialReason: 'No policy matched',
    };
  }

  /**
   * Evaluate single policy
   */
  private async evaluatePolicy(
    policy: PermissionPolicy,
    context: PermissionEvaluationContext
  ): Promise<{ matched: boolean; conditions?: any }> {
    const rules = policy.policyRules as PolicyRuleSet;

    // Evaluate all conditions (AND logic)
    for (const condition of rules.conditions) {
      const matched = await this.attributeEvaluator.evaluateCondition(
        condition,
        context
      );

      if (!matched) {
        return { matched: false };
      }
    }

    // All conditions matched
    return {
      matched: true,
      conditions: rules.outputConditions,  // Conditions to apply if allowed
    };
  }
}

// ============================================================================
// ATTRIBUTE EVALUATOR - Condition evaluation
// ============================================================================

@Injectable()
export class AttributeEvaluator {
  constructor(
    private readonly ownershipService: OwnershipEvaluator,
    private readonly facilityScopeService: FacilityScopeEvaluator,
  ) {}

  /**
   * Evaluate single ABAC condition
   */
  async evaluateCondition(
    condition: PolicyCondition,
    context: PermissionEvaluationContext
  ): Promise<boolean> {
    const { attribute, operator, value } = condition;

    // Extract attribute value from context
    const actualValue = await this.getAttributeValue(attribute, context);

    // Apply operator
    return this.applyOperator(actualValue, operator, value);
  }

  /**
   * Extract attribute value from context
   * Supports nested attributes: user.certifications, resource.owner_id
   */
  private async getAttributeValue(
    attribute: string,
    context: PermissionEvaluationContext
  ): Promise<any> {
    const parts = attribute.split('.');

    switch (parts[0]) {
      case 'user':
        return this.getUserAttribute(parts.slice(1), context);

      case 'resource':
        return this.getResourceAttribute(parts.slice(1), context);

      case 'time':
        return this.getTimeAttribute(parts.slice(1), context);

      case 'network':
        return this.getNetworkAttribute(parts.slice(1), context);

      default:
        throw new Error(`Unknown attribute namespace: ${parts[0]}`);
    }
  }

  private getUserAttribute(path: string[], context: PermissionEvaluationContext): any {
    const attribute = path[0];

    switch (attribute) {
      case 'certifications':
        return context.userCertifications;

      case 'facility_ids':
        return context.userFacilityIds;

      case 'is_owner':
        return this.ownershipService.isOwner(
          context.userId,
          context.resourceId
        );

      default:
        return null;
    }
  }

  private getResourceAttribute(path: string[], context: PermissionEvaluationContext): any {
    // Fetch resource attributes dynamically
    // Example: resource.facility_id, resource.status
    return this.ownershipService.getResourceAttribute(
      context.resourceId,
      path[0]
    );
  }

  private getTimeAttribute(path: string[], context: PermissionEvaluationContext): any {
    const now = context.timestamp;

    switch (path[0]) {
      case 'hour':
        return now.getHours();
      case 'day_of_week':
        return now.getDay();
      case 'is_business_hours':
        return this.isBusinessHours(now);
      default:
        return null;
    }
  }

  private getNetworkAttribute(path: string[], context: PermissionEvaluationContext): any {
    switch (path[0]) {
      case 'ip_address':
        return context.ipAddress;
      case 'is_internal':
        return this.isInternalIP(context.ipAddress);
      default:
        return null;
    }
  }

  /**
   * Apply comparison operator
   */
  private applyOperator(actualValue: any, operator: string, expectedValue: any): boolean {
    switch (operator) {
      case 'equals':
        return actualValue === expectedValue;

      case 'not_equals':
        return actualValue !== expectedValue;

      case 'contains':
        return Array.isArray(actualValue) && actualValue.includes(expectedValue);

      case 'not_contains':
        return Array.isArray(actualValue) && !actualValue.includes(expectedValue);

      case 'in':
        return Array.isArray(expectedValue) && expectedValue.includes(actualValue);

      case 'greater_than':
        return actualValue > expectedValue;

      case 'less_than':
        return actualValue < expectedValue;

      case 'matches_regex':
        return new RegExp(expectedValue).test(actualValue);

      default:
        throw new Error(`Unknown operator: ${operator}`);
    }
  }

  private isBusinessHours(date: Date): boolean {
    const hour = date.getHours();
    const day = date.getDay();
    return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
  }

  private isInternalIP(ip: string): boolean {
    // Check if IP is in internal network ranges
    return ip.startsWith('192.168.') || ip.startsWith('10.');
  }
}
```

### Policy Rule Structure

```typescript
// Policy rule JSON structure
interface PolicyRuleSet {
  conditions: PolicyCondition[];       // ALL must match (AND logic)
  outputConditions?: OutputCondition[]; // Conditions applied if allowed
}

interface PolicyCondition {
  attribute: string;    // Dotted path: user.certifications, resource.facility_id
  operator: PolicyOperator;
  value: any;           // Expected value
}

type PolicyOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'in'
  | 'greater_than'
  | 'less_than'
  | 'matches_regex';

interface OutputCondition {
  type: 'filter' | 'transform' | 'limit';
  params: Record<string, any>;
}
```

### Example ABAC Policies

```json
// Policy: ADR certification required for hazardous waste
{
  "name": "Hazardous Waste Handler Certification",
  "permissionId": "fir:create:facility",
  "effect": "ALLOW",
  "evaluationOrder": 10,
  "policyRules": {
    "conditions": [
      {
        "attribute": "user.certifications",
        "operator": "contains",
        "value": "ADR"
      },
      {
        "attribute": "resource.cer_code",
        "operator": "matches_regex",
        "value": "^\\d{2} \\d{2} \\d{2}\\*$"
      }
    ]
  }
}

// Policy: Business hours only for exports
{
  "name": "Export During Business Hours",
  "permissionId": "report:export:tenant",
  "effect": "ALLOW",
  "evaluationOrder": 5,
  "policyRules": {
    "conditions": [
      {
        "attribute": "time.is_business_hours",
        "operator": "equals",
        "value": true
      }
    ]
  }
}

// Policy: Internal network required for sensitive data
{
  "name": "Internal Network Only",
  "permissionId": "user:view_sensitive:tenant",
  "effect": "ALLOW",
  "evaluationOrder": 1,
  "policyRules": {
    "conditions": [
      {
        "attribute": "network.is_internal",
        "operator": "equals",
        "value": true
      }
    ]
  }
}

// Policy: Facility-scoped access
{
  "name": "Facility Manager Scope",
  "permissionId": "fir:read:facility",
  "effect": "ALLOW",
  "evaluationOrder": 20,
  "policyRules": {
    "conditions": [
      {
        "attribute": "user.facility_ids",
        "operator": "contains",
        "value": "{{resource.facility_id}}"
      }
    ],
    "outputConditions": [
      {
        "type": "filter",
        "params": {
          "facility_id": "{{user.facility_ids}}"
        }
      }
    ]
  }
}
```

---

## Integration with SPID/CIE Authentication

### Authentication Flow Integration

```typescript
// ============================================================================
// SPID STRATEGY - Extended with permission loading
// ============================================================================

@Injectable()
export class SpidStrategy extends Strategy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtTokensService,
    private readonly cacheWarming: CacheWarmingService,
  ) {
    super(/* SPID config */);
  }

  async validate(profile: SpidProfile): Promise<any> {
    const fiscalCode = profile.fiscalNumber;

    // Find or create user
    let user = await this.prisma.user.findFirst({
      where: { fiscalCode },
      include: { tenant: true },
    });

    if (!user) {
      // First login - create user with minimal permissions
      user = await this.createNewUser(profile);
    }

    // Load user's roles and permissions
    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId: user.id,
        tenantId: user.tenantId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: { role: true },
    });

    // Warm permission cache (async, non-blocking)
    this.cacheWarming.warmUserPermissions(user.id, user.tenantId)
      .catch(err => console.error('Cache warming failed', err));

    // Generate JWT with permission claims
    const tokens = await this.jwtService.generateTokens({
      userId: user.id,
      tenantId: user.tenantId,
      fiscalCode: user.fiscalCode,
      email: user.email,
      roles: userRoles.map(ur => ur.role.slug),
      isConsultant: user.isConsultant,
    });

    return {
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  private async createNewUser(profile: SpidProfile): Promise<User> {
    // Create user with default "Pending Approval" role
    const defaultRole = await this.prisma.role.findFirst({
      where: { slug: 'pending_approval', isSystemRole: true },
    });

    const user = await this.prisma.user.create({
      data: {
        fiscalCode: profile.fiscalNumber,
        firstName: profile.name,
        lastName: profile.familyName,
        email: profile.email,
        tenantId: await this.assignTenant(profile),
        role: 'VIEWER',  // Legacy field
      },
    });

    // Assign default role
    await this.prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: defaultRole.id,
        tenantId: user.tenantId,
        assignedBy: 'SYSTEM',
      },
    });

    return user;
  }
}

// ============================================================================
// JWT PAYLOAD - Extended with permission claims
// ============================================================================

interface JwtPayload {
  sub: string;           // User ID
  tenantId: string;      // Primary tenant
  fiscalCode: string;    // SPID fiscal code
  email: string;
  roles: string[];       // Role slugs
  isConsultant: boolean;
  iat: number;
  exp: number;
}
```

### Consultant Multi-Tenant Context Switching

```typescript
// ============================================================================
// TENANT CONTEXT SWITCH ENDPOINT
// ============================================================================

@Controller('auth')
export class AuthController {
  constructor(
    private readonly switchTenantUseCase: SwitchTenantContextUseCase,
    private readonly jwtService: JwtTokensService,
  ) {}

  /**
   * Switch active tenant context (consultants only)
   */
  @Post('switch-tenant')
  @UseGuards(JwtAuthGuard)
  async switchTenant(
    @Body() dto: SwitchTenantDto,
    @Req() request
  ): Promise<{ accessToken: string }> {
    const user = request.user;

    if (!user.isConsultant) {
      throw new ForbiddenException('Only consultants can switch tenants');
    }

    // Verify access and load roles for new tenant
    const newContext = await this.switchTenantUseCase.execute({
      userId: user.id,
      targetTenantId: dto.tenantId,
    });

    // Generate new JWT with updated tenant context
    const accessToken = await this.jwtService.generateAccessToken({
      userId: user.id,
      tenantId: dto.tenantId,
      fiscalCode: user.fiscalCode,
      email: user.email,
      roles: newContext.roles,
      isConsultant: true,
    });

    return { accessToken };
  }
}

// ============================================================================
// SWITCH TENANT USE CASE
// ============================================================================

@Injectable()
export class SwitchTenantContextUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheWarming: CacheWarmingService,
  ) {}

  async execute(command: SwitchTenantCommand): Promise<TenantContextResult> {
    const { userId, targetTenantId } = command;

    // Verify consultant has access to target tenant
    const association = await this.prisma.consultantTenantAssociation.findUnique({
      where: {
        consultantUserId_clientTenantId: {
          consultantUserId: userId,
          clientTenantId: targetTenantId,
        },
      },
      include: { role: true },
    });

    if (!association || !association.isActive) {
      throw new ForbiddenException('No access to this tenant');
    }

    // Load roles for new context
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, tenantId: targetTenantId },
      include: { role: true },
    });

    // Warm cache for new context
    await this.cacheWarming.warmUserPermissions(userId, targetTenantId);

    return {
      tenantId: targetTenantId,
      roles: userRoles.map(ur => ur.role.slug),
    };
  }
}
```

### Step-Up Re-Authentication

```typescript
// ============================================================================
// STEP-UP AUTH ENDPOINT
// ============================================================================

@Controller('auth')
export class AuthController {
  /**
   * Step-up re-authentication via SPID
   * Required for sensitive operations (delete, system config)
   */
  @Get('step-up')
  @UseGuards(JwtAuthGuard)
  async initiateStepUp(@Req() request, @Res() response): Promise<void> {
    // Redirect to SPID re-authentication
    // Store return URL in session
    request.session.stepUpReturnUrl = request.headers.referer;

    return response.redirect('/auth/spid?step_up=true');
  }

  /**
   * Step-up callback
   */
  @Get('step-up/callback')
  async handleStepUpCallback(@Req() request, @Res() response): Promise<void> {
    const user = request.user;

    // Mark re-authentication in Redis (15-minute TTL)
    await this.redis.setex(
      `auth:stepup:${user.id}`,
      900, // 15 minutes
      Date.now().toString()
    );

    // Redirect back to original page
    const returnUrl = request.session.stepUpReturnUrl || '/dashboard';
    return response.redirect(returnUrl);
  }
}
```

---

## Performance Optimization Strategy

### Query Optimization

**Database Queries**: Target <20ms for permission checks (cache miss).

```typescript
// Optimized permission query (single DB roundtrip)
async getUserEffectivePermissions(
  userId: string,
  tenantId: string
): Promise<string[]> {
  // Single query with joins
  const result = await this.prisma.$queryRaw<{ permission_key: string }[]>`
    SELECT DISTINCT p.permission_key
    FROM permissions p
    INNER JOIN role_permissions rp ON rp.permission_id = p.id
    INNER JOIN user_roles ur ON ur.role_id = rp.role_id
    WHERE ur.user_id = ${userId}::uuid
      AND ur.tenant_id = ${tenantId}::uuid
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND ur.is_expired = false

    UNION

    -- Temporary grants
    SELECT DISTINCT p.permission_key
    FROM permissions p
    INNER JOIN temporary_permission_grants tpg
      ON p.id = ANY(tpg.permission_ids)
    WHERE tpg.user_id = ${userId}::uuid
      AND tpg.tenant_id = ${tenantId}::uuid
      AND tpg.status = 'ACTIVE'
      AND tpg.start_at <= NOW()
      AND tpg.expires_at > NOW()
      AND tpg.is_revoked = false
  `;

  return result.map(r => r.permission_key);
}
```

### Batch Permission Checks

**Challenge**: Avoid N+1 queries when checking permissions for list views.

```typescript
/**
 * Batch permission check for list of resources
 * Example: Check if user can delete each FIR in list
 */
async batchCheckPermissions(
  userId: string,
  tenantId: string,
  permissionKey: string,
  resourceIds: string[]
): Promise<Map<string, boolean>> {
  // Load user permissions once
  const userPermissions = await this.getCachedPermissions(userId, tenantId);

  // Check if user has permission at all
  if (!userPermissions.permissions.includes(permissionKey)) {
    // User lacks permission entirely - all denied
    return new Map(resourceIds.map(id => [id, false]));
  }

  // Extract scope from permission key
  const scope = permissionKey.split(':')[2];

  if (scope === 'all') {
    // User can access all resources
    return new Map(resourceIds.map(id => [id, true]));
  }

  if (scope === 'own') {
    // Batch check ownership
    const ownerships = await this.prisma.resourceOwnership.findMany({
      where: {
        resourceId: { in: resourceIds },
        ownerId: userId,
      },
      select: { resourceId: true },
    });

    const ownedIds = new Set(ownerships.map(o => o.resourceId));
    return new Map(resourceIds.map(id => [id, ownedIds.has(id)]));
  }

  if (scope === 'facility') {
    // Batch check facility membership
    const facilityIds = userPermissions.facilityIds;

    const resources = await this.prisma.fIR.findMany({
      where: { id: { in: resourceIds } },
      select: { id: true, facilityId: true },
    });

    return new Map(
      resources.map(r => [
        r.id,
        facilityIds.includes(r.facilityId),
      ])
    );
  }

  // Fallback: check individually
  return new Map(resourceIds.map(id => [id, false]));
}
```

### Audit Log Performance

**Challenge**: Audit logging must not block request processing.

**Solution**: Async audit writer with BullMQ queue.

```typescript
@Injectable()
export class AuditWriterService {
  constructor(
    @InjectQueue('audit-logs') private auditQueue: Queue,
  ) {}

  /**
   * Log permission check asynchronously
   * Returns immediately without waiting for DB write
   */
  async logPermissionCheck(
    user: User,
    tenantId: string,
    permissionKey: string,
    result: PermissionCheckResult,
    context: PermissionEvaluationContext
  ): Promise<void> {
    // Add to queue (non-blocking)
    await this.auditQueue.add('permission-check', {
      tenantId,
      userId: user.id,
      fiscalCode: user.fiscalCode,
      userEmail: user.email,
      permissionKey,
      decision: result.decision,
      denialReason: result.denialReason,
      evaluatedRoles: result.evaluatedRoles,
      evaluatedPolicies: result.evaluatedPolicies,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestPath: context.requestPath,
      httpMethod: context.httpMethod,
      sessionId: context.sessionId,
      evaluationMs: result.evaluationTimeMs,
      cacheHit: result.cacheHit,
      timestamp: new Date(),
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }
}

// Audit log consumer (background processor)
@Processor('audit-logs')
export class AuditLogProcessor {
  constructor(private readonly prisma: PrismaService) {}

  @Process('permission-check')
  async processAuditLog(job: Job<AuditLogData>): Promise<void> {
    await this.prisma.permissionAuditLog.create({
      data: job.data,
    });
  }
}
```

---

## Security Considerations

### Cache Poisoning Prevention

**Threat**: Attacker modifies cached permissions to gain unauthorized access.

**Mitigation**: HMAC signature verification.

```typescript
// Sign cache entries with HMAC
const payload = JSON.stringify(permissionsData);
const signature = crypto
  .createHmac('sha256', process.env.CACHE_HMAC_SECRET)
  .update(`${cacheKey}:${payload}`)
  .digest('hex');

await redis.setex(cacheKey, ttl, JSON.stringify({ ...permissionsData, signature }));

// Verify on retrieval
const cached = JSON.parse(await redis.get(cacheKey));
const expectedSig = crypto
  .createHmac('sha256', process.env.CACHE_HMAC_SECRET)
  .update(`${cacheKey}:${JSON.stringify(omit(cached, 'signature'))}`)
  .digest('hex');

if (cached.signature !== expectedSig) {
  throw new SecurityException('Cache integrity violation');
}
```

### SQL Injection Prevention

**All permission queries use parameterized queries via Prisma**:

```typescript
// SAFE: Prisma parameterizes automatically
await prisma.userRole.findMany({
  where: { userId, tenantId },
});

// UNSAFE: Direct SQL injection risk (never do this)
await prisma.$queryRawUnsafe(`
  SELECT * FROM user_roles WHERE user_id = '${userId}'
`);
```

### Privilege Escalation Prevention

**Prevent self-assignment of elevated roles**:

```typescript
// In AssignRoleUseCase
if (command.userId === command.assignedBy && !command.bypassSelfCheck) {
  // User trying to assign role to themselves
  const currentRoles = await this.getUserRoles(command.assignedBy, command.tenantId);
  const newRole = await this.getRole(command.roleId);

  if (newRole.permissions.length > currentRoles[0].permissions.length) {
    throw new ForbiddenException('Cannot self-assign elevated role');
  }
}
```

### Audit Trail Immutability

**Prevent tampering with audit logs**:

1. **Database constraint**: No UPDATE or DELETE permissions on audit tables
2. **Cryptographic chaining**: Each audit entry includes hash of previous entry

```typescript
// Append-only audit log with cryptographic integrity
async createAuditEntry(data: AuditLogData): Promise<void> {
  // Get previous entry hash
  const prevHash = await this.getLastAuditHash(data.tenantId);

  // Calculate new entry hash
  const currentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(data) + prevHash)
    .digest('hex');

  // Insert with chain hash
  await this.prisma.permissionAuditLog.create({
    data: {
      ...data,
      previousHash: prevHash,
      currentHash,
    },
  });
}
```

---

## Migration Strategy

### Phase 1: Database Schema Migration

```bash
# Generate Prisma migration
npx prisma migrate dev --name add_permission_system

# Seed system permissions and roles
npx prisma db seed
```

**Seeder Script** (`prisma/seed-permissions.ts`):

```typescript
async function seedPermissions() {
  // Create system roles
  const systemRoles = [
    {
      slug: 'system_admin',
      name: 'System Administrator',
      isSystemRole: true,
    },
    {
      slug: 'compliance_officer',
      name: 'Compliance Officer',
      isSystemRole: true,
    },
    // ... more roles
  ];

  for (const roleData of systemRoles) {
    await prisma.role.upsert({
      where: { tenantId_slug: { tenantId: null, slug: roleData.slug } },
      update: {},
      create: roleData,
    });
  }

  // Create system permissions
  const permissions = [
    { resource: 'fir', action: 'create', scope: 'own' },
    { resource: 'fir', action: 'create', scope: 'facility' },
    { resource: 'fir', action: 'read', scope: 'own' },
    // ... 50+ permissions
  ];

  for (const perm of permissions) {
    const permKey = `${perm.resource}:${perm.action}:${perm.scope}`;
    await prisma.permission.upsert({
      where: { permissionKey: permKey },
      update: {},
      create: {
        ...perm,
        permissionKey: permKey,
        description: `${perm.action} ${perm.resource} with ${perm.scope} scope`,
      },
    });
  }

  // Assign permissions to roles
  const adminRole = await prisma.role.findUnique({
    where: { tenantId_slug: { tenantId: null, slug: 'system_admin' } },
  });

  const allPermissions = await prisma.permission.findMany();

  for (const permission of allPermissions) {
    await prisma.rolePermission.create({
      data: {
        roleId: adminRole.id,
        permissionId: permission.id,
      },
    });
  }
}
```

### Phase 2: Migrate Existing User Roles

**Map legacy `UserRole` enum to new role system**:

```typescript
async function migrateLegacyRoles() {
  // Legacy enum: ADMIN, OPERATOR, VIEWER
  // New system: Role-based with permissions

  const roleMapping = {
    ADMIN: 'system_admin',
    OPERATOR: 'waste_operator',
    VIEWER: 'auditor',
  };

  const users = await prisma.user.findMany();

  for (const user of users) {
    const newRoleSlug = roleMapping[user.role];
    const newRole = await prisma.role.findFirst({
      where: { slug: newRoleSlug, isSystemRole: true },
    });

    // Create UserRole assignment
    await prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: newRole.id,
        tenantId: user.tenantId,
        assignedBy: 'SYSTEM', // Migration script
      },
    });
  }
}
```

### Phase 3: Update Controllers

**Replace legacy `@Roles()` decorator with `@RequirePermission()`**:

```typescript
// BEFORE (legacy)
@Get()
@Roles('ADMIN', 'OPERATOR')
async listFIRs() { ... }

// AFTER (new permission system)
@Get()
@RequirePermission('fir:read:facility')
async listFIRs() { ... }
```

### Phase 4: Background Jobs

**Deploy permission expiry checker**:

```typescript
// Background job: Check and expire permissions every 5 minutes
@Processor('permission-expiry')
export class PermissionExpiryProcessor {
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkExpiredPermissions(): Promise<void> {
    // Find expired UserRole assignments
    const expired = await this.prisma.userRole.findMany({
      where: {
        expiresAt: { lte: new Date() },
        isExpired: false,
      },
    });

    for (const ur of expired) {
      // Mark as expired
      await this.prisma.userRole.update({
        where: { id: ur.id },
        data: { isExpired: true },
      });

      // Invalidate cache
      await this.cacheInvalidation.onRoleRevoked({
        userId: ur.userId,
        tenantId: ur.tenantId,
        roleId: ur.roleId,
      });

      // Log expiration
      await this.auditWriter.logRoleChange({
        entityType: 'USER_ROLE',
        entityId: ur.id,
        changeType: 'EXPIRE',
        changedBy: 'SYSTEM',
        reason: 'Automatic expiration',
      });
    }
  }
}
```

---

## Summary

This architecture provides:

1. **Multi-tenant isolation**: Schema-per-tenant + RLS + application-level filtering
2. **High performance**: Sub-10ms permission checks via Redis caching (95%+ hit rate)
3. **Flexible authorization**: Hybrid RBAC/ABAC supporting simple and complex policies
4. **Audit compliance**: Immutable, cryptographically-chained audit trail (10-year retention)
5. **Consultant support**: Seamless multi-tenant context switching with clear audit trails
6. **Developer experience**: Declarative `@RequirePermission()` decorators with minimal boilerplate
7. **Security**: Defense-in-depth with cache signing, RLS policies, step-up auth, and privilege escalation prevention
8. **Scalability**: Async audit logging, batch permission checks, proactive cache warming

**Next Steps**:
1. Review and approve architecture
2. Generate Prisma migration
3. Implement domain entities (DDD)
4. Build permission evaluation engine (TDD)
5. Create NestJS guards and decorators
6. Migrate legacy roles
7. Deploy with phased rollout

---

**Document Version**: 1.0
**Last Updated**: 2025-10-31
**Review Status**: Pending Approval
