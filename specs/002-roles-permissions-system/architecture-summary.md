# Architecture Summary: Roles and Permissions System

**Feature**: 002-roles-permissions-system
**Date**: 2025-10-31

---

## Quick Reference

This document provides a high-level overview of the key architectural decisions for the comprehensive roles and permissions system. For detailed implementation guidance, see `architecture.md`.

---

## Key Technical Decisions

### 1. Module Organization

**Decision**: Domain-Driven Design (DDD) with clean architecture layers.

```
domain/permission/          # Core business logic (entities, value objects, aggregates)
application/permission/     # Use cases (CQRS commands/queries)
infrastructure/persistence/ # Repositories, caching, audit
api/permission/            # REST controllers, DTOs
```

**Rationale**: Separates business logic from infrastructure concerns, enabling testability and future refactoring without breaking core domain logic.

---

### 2. Database Schema

**8 Core Entities**:

1. **Role**: Named permission collections (system + custom roles)
2. **Permission**: Atomic capabilities (`{resource}:{action}:{scope}`)
3. **UserRole**: User-role assignments with optional expiry and facility scoping
4. **RolePermission**: Junction table (Role ↔ Permission many-to-many)
5. **PermissionPolicy**: ABAC policies for fine-grained control
6. **PermissionAuditLog**: Immutable audit trail (10-year retention)
7. **RoleChangeHistory**: Versioned role/permission changes (enables historical reconstruction)
8. **ResourceOwnership**: Tracks ownership for "own" scope checks
9. **TemporaryPermissionGrant**: Time-bounded permission elevations
10. **ConsultantTenantAssociation**: Multi-tenant consultant access

**Multi-Tenancy Strategy**:
- **Primary**: Schema-per-tenant isolation (existing architecture)
- **Secondary**: PostgreSQL Row-Level Security (RLS) policies
- **Tertiary**: Application-level tenant context validation

**Performance Indexes**:
- `user_roles(userId, tenantId)`: Fast permission lookup
- `permission_audit_logs(tenantId, createdAt)`: Time-series audit queries
- `user_roles(expiresAt, isExpired)`: Background expiry job optimization

---

### 3. Permission Caching (Redis)

**Cache Strategy**: Multi-layer caching with 95%+ hit rate target.

**Key Structures**:
```typescript
// User's effective permissions (5-minute TTL)
perm:user:{userId}:tenant:{tenantId}

// Role's permissions (1-hour TTL)
perm:role:{roleId}:perms

// Specific permission check result (10-minute TTL)
perm:check:{userId}:{tenantId}:{permissionKey}:{resourceId?}

// Consultant's tenant list (1-hour TTL)
perm:consultant:{userId}:tenants
```

**Cache Integrity**: HMAC signatures prevent cache poisoning attacks.

**Invalidation Strategy**:
- **Pub/Sub**: Redis channels for distributed cache invalidation
- **Selective**: Invalidate only affected users/tenants (not global flush)
- **Stale-while-revalidate**: Serve stale data while refreshing in background

**Cache Warming**:
- Triggered on SPID login
- Pre-load common permissions based on primary role
- Background warming for high-traffic users

**Performance Targets**:
- Cache hit: <5ms
- Cache miss: <20ms (database query)
- 95%+ cache hit rate under normal load

---

### 4. Guard/Middleware Architecture

**Execution Order** (critical for security):

```typescript
1. JwtAuthGuard           // Authenticate user via JWT
2. TenantIsolationGuard   // Validate tenant context + set RLS variable
3. PermissionGuard        // Check permissions
4. StepUpAuthGuard        // (optional) Require recent re-authentication
```

**Decorator-Driven Authorization**:

```typescript
// Single permission
@RequirePermission('fir:create:facility')

// Resource-level check
@RequirePermission('fir:delete:own', { resourceParam: 'firId' })

// ANY permission
@RequireAnyPermission(['fir:sign:own', 'fir:sign:facility'])

// ALL permissions
@RequireAllPermissions(['report:export:tenant', 'fir:read:all'])
```

**TenantIsolationGuard Responsibilities**:
1. Extract tenant context (header > JWT > query param)
2. Verify consultant has access to tenant (if applicable)
3. Validate tenant is active and not suspended
4. Set PostgreSQL RLS variable: `SET LOCAL app.current_tenant_id = {tenantId}`
5. Attach tenant to request object

**PermissionGuard Responsibilities**:
1. Extract permission metadata from decorator
2. Load user's cached permissions
3. Evaluate ABAC policies (if configured)
4. Check resource-level ownership (if resourceParam specified)
5. Write async audit log (non-blocking)
6. Return decision: ALLOW, DENY, or CONDITIONAL_ALLOW

---

### 5. ABAC Policy Engine

**Hybrid Approach**: RBAC (Role-Based) for 90% of cases, ABAC (Attribute-Based) for complex scenarios.

**Policy Evaluation Flow**:
1. Load active policies for permission (sorted by priority)
2. Evaluate policy conditions (ALL must match)
3. Return first matching policy's effect (ALLOW/DENY)
4. Default to DENY if no policy matches (fail-secure)

**Supported Attributes**:
- `user.*`: certifications, facility_ids, is_owner
- `resource.*`: facility_id, status, owner_id
- `time.*`: hour, day_of_week, is_business_hours
- `network.*`: ip_address, is_internal

**Supported Operators**:
- Comparison: `equals`, `not_equals`, `in`, `greater_than`, `less_than`
- Collection: `contains`, `not_contains`
- Pattern: `matches_regex`

**Example ABAC Policy** (JSON):
```json
{
  "name": "ADR Certification Required for Hazardous Waste",
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
```

**Phase 1 Scope**: Platform-provided policies only (no custom policy authoring by tenants).

---

### 6. SPID/CIE Integration

**Authentication vs Authorization**:
- **Authentication**: SPID/CIE validates identity (fiscal code, name)
- **Authorization**: Internal role/permission system controls access
- **Never trust SPID attributes for permissions** (separation of concerns)

**JWT Payload Extensions**:
```typescript
{
  sub: userId,
  tenantId: primaryTenantId,
  fiscalCode: spidFiscalCode,  // For audit trail
  roles: ['waste_operator', 'site_manager_milano'],
  isConsultant: true,
  iat: 1698765432,
  exp: 1698769032
}
```

**Consultant Multi-Tenant Workflow**:
1. User logs in via SPID (authenticated to primary tenant)
2. Frontend displays tenant selector (loaded from `ConsultantTenantAssociation`)
3. User clicks "Switch to Tenant B"
4. POST `/auth/switch-tenant` generates new JWT with Tenant B context
5. Frontend replaces JWT, all subsequent requests use Tenant B context
6. Permission cache warmed for new context

**Step-Up Authentication**:
- Required for: delete operations, system config changes, sensitive exports
- Mechanism: Redirect to SPID re-authentication flow
- Validity: 15 minutes (stored in Redis: `auth:stepup:{userId}`)
- Trigger: `@UseGuards(StepUpAuthGuard)` decorator

---

### 7. Audit Trail Architecture

**Immutability Guarantee**:
- Append-only table (no UPDATE/DELETE grants)
- Cryptographic chaining (each entry hashes previous entry)
- Tamper detection via chain validation

**Audit Log Contents**:
```typescript
{
  tenantId, userId, fiscalCode, userEmail,
  permissionKey, resourceType, resourceId,
  decision: 'ALLOW' | 'DENY' | 'CONDITIONAL_ALLOW',
  denialReason, evaluatedRoles, evaluatedPolicies,
  ipAddress, userAgent, requestPath, httpMethod,
  sessionId, evaluationMs, cacheHit,
  timestamp
}
```

**Performance Strategy**:
- **Async writing**: BullMQ queue (non-blocking)
- **Partitioning**: Monthly partitions after 10K entries
- **Archival**: Move 3+ year data to AWS S3 cold storage
- **Retention**: 10 years minimum (per D.Lgs. 152/2006)

**Query Performance**:
- 30-day range: <100ms (hot partition)
- 1-year range: <500ms (warm partitions)
- Historical reconstruction: <2s (cold storage query)

---

### 8. Performance Optimization

**Database Query Optimization**:
```sql
-- Single query for user permissions (with temporary grants)
SELECT DISTINCT p.permission_key
FROM permissions p
INNER JOIN role_permissions rp ON rp.permission_id = p.id
INNER JOIN user_roles ur ON ur.role_id = rp.role_id
WHERE ur.user_id = ? AND ur.tenant_id = ?
  AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
UNION
SELECT DISTINCT p.permission_key
FROM permissions p
INNER JOIN temporary_permission_grants tpg
  ON p.id = ANY(tpg.permission_ids)
WHERE tpg.user_id = ? AND tpg.status = 'ACTIVE'
```

**Batch Permission Checks** (avoid N+1):
```typescript
// Check 100 FIRs in single batch operation
const results = await batchCheckPermissions(
  userId,
  tenantId,
  'fir:delete:own',
  firIds  // Array of 100 IDs
);
// Returns Map<firId, boolean>
```

**Cache Hit Rate Monitoring**:
```typescript
// Exposed as Prometheus metrics
permission_cache_hit_rate{tenant_id="abc"} 0.97
permission_cache_hit_total{tenant_id="abc"} 15234
permission_cache_miss_total{tenant_id="abc"} 471
```

---

### 9. Security Measures

**Defense-in-Depth**:

1. **Cache Poisoning Prevention**: HMAC signatures on all cached data
2. **SQL Injection**: Prisma parameterized queries only (no raw SQL)
3. **Privilege Escalation**: Block self-assignment of elevated roles
4. **Tenant Isolation**: RLS + app-level filtering + validation middleware
5. **Audit Integrity**: Cryptographic chaining + append-only constraints
6. **Step-Up Auth**: Re-authentication for sensitive operations

**Security Auditing**:
```typescript
// Log suspicious activities
if (deniedAttempt && sensitiveResource) {
  await securityAlert.notify({
    type: 'PERMISSION_VIOLATION',
    userId, tenantId, resourceId,
    attemptedPermission: permissionKey,
    userRole: currentRole,
    ipAddress, timestamp
  });
}
```

---

### 10. Migration Strategy

**4-Phase Rollout**:

**Phase 1**: Database schema migration
- Run Prisma migration: `npx prisma migrate dev --name add_permission_system`
- Seed system permissions and roles: `npx prisma db seed`

**Phase 2**: Migrate existing users
- Map legacy `UserRole` enum (ADMIN/OPERATOR/VIEWER) to new role system
- Create `UserRole` assignments for all existing users
- Keep legacy `role` field temporarily for backward compatibility

**Phase 3**: Update controllers
- Replace `@Roles('ADMIN')` with `@RequirePermission('user:manage:tenant')`
- Deploy gradually: feature-by-feature (not big-bang)
- Monitor permission denial rate (expect spike, then normalize)

**Phase 4**: Background jobs
- Deploy expiry checker (every 5 minutes)
- Deploy audit archival (daily at 2 AM)
- Deploy cache warming (on user login)

**Rollback Plan**: Keep legacy role system active for 2 weeks, enable instant rollback via feature flag.

---

## Integration Points

### Existing Features

**Feature 001 (Production-Ready App)**:
- **SPID/CIE Auth**: Extend JWT payload with role claims
- **RENTRI Integration**: Permission check before sync operations
- **Digital Signatures**: Verify `fir:sign` permission + valid certificate
- **Analytics Dashboard**: Filter widgets based on user permissions
- **Notifications**: Send permission change alerts via existing system
- **Backups**: Protect backup operations with `backup:execute:system` permission

**Database**:
- Extend `User` model with `certifications`, `isConsultant`, `previousFiscalCodes`
- Extend `Tenant` model with `auditRetentionYears`

**Redis**:
- Reuse existing Redis cluster for permission caching
- Add pub/sub channels: `cache:invalidate`, `permission:changed`

**BullMQ**:
- Add queues: `audit-logs`, `permission-expiry`, `cache-warming`

---

## Success Metrics

**Technical Performance**:
- Permission check latency: <10ms at 99th percentile
- Cache hit rate: >95%
- Audit log write lag: <1s at 99th percentile
- Database query time (cache miss): <20ms

**Security**:
- Zero cross-tenant data leakage incidents
- Zero cache poisoning attacks
- 100% audit trail integrity verification pass rate

**User Experience**:
- Tenant context switch: <2s
- Permission-related support tickets: <5/week
- Permission clarity rating: 4+/5

---

## File Locations

**Schema**: `apps/backend/prisma/schema.prisma`
**Modules**: `apps/backend/src/permission/`
**Guards**: `apps/backend/src/api/guards/`
**Seeders**: `apps/backend/prisma/seeds/permission-seeder.ts`
**Tests**: `apps/backend/src/permission/**/*.spec.ts`

---

## Next Steps

1. **Architecture Review**: Stakeholder approval on design decisions
2. **Prisma Schema**: Generate migration files
3. **TDD Implementation**: Start with domain entities (Role, Permission)
4. **Cache Layer**: Implement Redis caching service
5. **Guard Implementation**: Build PermissionGuard with decorator support
6. **Policy Engine**: Implement ABAC evaluator
7. **Testing**: Achieve 100% test coverage for domain layer
8. **Migration**: Migrate legacy roles to new system
9. **Documentation**: API docs for permission management endpoints
10. **Deployment**: Phased rollout with monitoring

---

**Document Version**: 1.0
**Full Architecture**: See `architecture.md` (60+ pages)
