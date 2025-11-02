# API Design Notes: Roles & Permissions System

**Feature**: 002-roles-permissions-system
**Document**: API Design Rationale & Implementation Guidance
**Version**: 1.0
**Last Updated**: 2025-10-31

## Executive Summary

This document provides architectural context, design rationale, and implementation guidance for the Roles & Permissions REST API specified in `openapi.yaml`.

The API is designed to support:
- Multi-tenant RBAC with consultant cross-tenant context switching
- High-frequency permission checks (<10ms at 99th percentile)
- Regulatory compliance audit trails (10+ year retention per D.Lgs. 152/2006)
- Enterprise custom role management
- Self-service permission request workflows
- Temporary permission elevation with auto-expiration

---

## Key Architectural Decisions

### 1. API Versioning Strategy

**Decision**: URL-based versioning (`/v1/roles`)

**Rationale**:
- Clear version in every request URL
- Supports parallel major versions during migration periods
- Standard practice for enterprise APIs
- Easy to route at gateway/proxy layer

**Alternative Considered**: Header-based versioning (`Accept: application/vnd.wasteflow.v1+json`)
**Rejected Because**: More complex client implementation, harder to debug, less visible in logs

---

### 2. Permission String Format

**Decision**: Colon-delimited format `{resource}:{action}:{scope}`

**Examples**:
- `fir:create:facility` - Create FIRs for assigned facilities only
- `fir:read:all` - Read all FIRs in tenant
- `registry:write:own` - Write only own registry entries

**Rationale**:
- Human-readable and URL-safe
- Hierarchical structure supports partial matching
- Standard pattern (AWS IAM, Auth0, Keycloak)
- Easy to validate with regex: `^[a-z_]+:(create|read|update|delete|approve|sign|export):(own|facility|all)$`

**Scope Semantics**:
- `own`: User can only access resources they created
- `facility`: User can access resources for their assigned facilities
- `all`: User can access all tenant resources (admin-level)

---

### 3. Rate Limiting Strategy

**Tiered Approach**:

| Endpoint Category | Rate Limit | Rationale |
|------------------|------------|-----------|
| Permission checks | 1000/min | High-frequency caching, critical for UI responsiveness |
| Standard CRUD | 100/min | Normal admin operations |
| Audit queries | 20/min | Expensive database operations (10-year retention) |
| Bulk operations | 10/min | Resource-intensive async jobs |
| Exports | 5/min | Heavy I/O, long-running jobs |

**Implementation**:
- Redis-backed sliding window algorithm
- Rate limit headers in all responses (X-RateLimit-*)
- 429 responses include `Retry-After` header
- Tenant-level overrides for Enterprise tier

**Code Reference**:
```typescript
// apps/backend/src/infrastructure/rate-limiting/
// - redis-rate-limiter.service.ts (sliding window)
// - rate-limit.decorator.ts (@RateLimit(100, 'minute'))
// - rate-limit.guard.ts (NestJS guard)
```

---

### 4. Pagination Pattern

**Decision**: Offset-based pagination with standard query parameters

**Parameters**:
- `page`: Page number (1-indexed, default: 1)
- `limit`: Items per page (1-100, default: 10)
- `sortBy`: Field to sort by (default: createdAt)
- `sortOrder`: asc/desc (default: desc)

**Response Structure**:
```json
{
  "items": [...],
  "total": 250,
  "page": 1,
  "limit": 10,
  "totalPages": 25
}
```

**Rationale**:
- Simple client implementation
- Sufficient for admin UIs (typically <10k roles/users)
- Avoids cursor complexity for infrequent pagination

**Alternative Considered**: Cursor-based pagination
**Rejected Because**: Offset-based sufficient for admin workloads; cursor adds complexity without clear benefit for this domain

**Performance Note**:
- Prisma `skip/take` with `totalCount` in single transaction
- Indexed on common sort fields (createdAt, name)
- Warn if page > 50 (suggest filtering)

---

### 5. Error Response Format

**Standard Structure**:
```json
{
  "error": "MACHINE_READABLE_CODE",
  "message": "Human-readable message (Italian)",
  "statusCode": 400,
  "timestamp": "2025-10-31T14:30:00.000Z",
  "path": "/v1/roles",
  "details": {
    "additionalContext": "..."
  }
}
```

**Error Code Categories**:

| HTTP Code | Error Type | Examples |
|-----------|-----------|----------|
| 400 | Validation | `VALIDATION_ERROR`, `ROLE_IN_USE`, `LAST_ADMIN_PROTECTION` |
| 401 | Authentication | `UNAUTHORIZED`, `TOKEN_EXPIRED` |
| 403 | Authorization | `FORBIDDEN`, `PERMISSION_DENIED`, `TIER_REQUIRED` |
| 404 | Not Found | `NOT_FOUND`, `ROLE_NOT_FOUND` |
| 409 | Conflict | `ROLE_ALREADY_EXISTS`, `ALREADY_ASSIGNED` |
| 429 | Rate Limit | `RATE_LIMIT_EXCEEDED` |
| 500 | Server Error | `INTERNAL_ERROR`, `DATABASE_ERROR` |

**Validation Errors Include**:
- `validationErrors` array with field-level details
- Each error: `{field, message, value, constraint}`

**Permission Denied Errors Include**:
- `currentRole`: User's current role
- `requiredPermission`: Permission needed
- `contactAdministrators`: Array of admin contacts for help
- `alternativeActions`: Suggested actions user can take

**Italian Localization**:
All user-facing messages in Italian (formal tone for public sector)

**Code Reference**:
```typescript
// apps/backend/src/core/filters/
// - http-exception.filter.ts (global exception handler)
// - permission-denied.exception.ts (custom 403)
```

---

### 6. Caching Strategy

**Multi-Layer Caching**:

1. **Redis Permission Cache** (Primary)
   - Key format: `perm:${tenantId}:${userId}:v${cacheVersion}`
   - TTL: 5 minutes (hot path)
   - Invalidated on: role changes, permission grants, policy updates
   - Signed with HMAC-SHA256 to prevent cache poisoning

2. **Redis Role Definition Cache**
   - Key format: `role:${tenantId}:${roleId}`
   - TTL: 30 minutes (rarely change)
   - Invalidated on: role permission modifications

3. **In-Memory LRU Cache** (Secondary)
   - Size: 10,000 entries per backend instance
   - TTL: 1 minute (stale reads acceptable)
   - Used only if Redis unavailable (graceful degradation)

**Cache Invalidation**:
- Pub/Sub pattern via Redis
- All backend instances subscribe to `permission_invalidation` channel
- Payload: `{tenantId, userId?, roleId?, type: 'USER' | 'ROLE' | 'TENANT'}`
- Invalidation latency: <100ms across cluster

**Cache Hit Rates** (Success Criteria):
- Permission checks: >95% hit rate
- Role definitions: >98% hit rate

**Code Reference**:
```typescript
// apps/backend/src/infrastructure/caching/
// - redis-cache.service.ts (Redis operations)
// - permission-cache.service.ts (business logic)
// - cache-invalidation.subscriber.ts (pub/sub)
```

---

### 7. Audit Logging Strategy

**Immutable Append-Only Log**:
- Every permission check (granted AND denied) logged
- PostgreSQL table: `permission_audit_log`
- Partitioned by month for performance
- Retention: 10+ years per D.Lgs. 152/2006

**Log Entry Schema**:
```typescript
{
  id: uuid,
  tenantId: uuid,
  userId: uuid,
  userName: string,
  fiscalCode: string,        // SPID correlation
  action: string,             // e.g., "fir:delete"
  resourceType: string,       // e.g., "fir"
  resourceId: uuid?,
  decision: 'ALLOW' | 'DENY',
  reason: string,
  evaluatedPolicies: string[],
  contextAttributes: {        // JSON
    ipAddress: string,
    userAgent: string,
    deviceType: string,
    sessionId: uuid,
    facilityId?: uuid
  },
  consultantContext?: {       // JSON
    isConsultant: boolean,
    consultantFirm: string,
    actingForTenant: uuid
  },
  timestamp: timestamptz,     // millisecond precision
  evaluationTimeMs: float
}
```

**Performance Considerations**:
- Async write via BullMQ (non-blocking)
- Batched inserts (100 entries per batch)
- Write lag: <1 second at 99th percentile
- Indexed on: `(tenantId, userId, timestamp)`, `(resourceType, resourceId, timestamp)`, `fiscalCode`, `decision`

**Archival Strategy**:
- Active data: 3 years in hot PostgreSQL storage
- Archived data: 4-10 years in AWS S3 (Parquet format)
- Searchable index maintained in PostgreSQL with S3 pointers
- Retrieval time: <10 seconds for archived data

**ARPA Inspection Support**:
- Pre-built queries for common compliance requests
- Export to CSV/PDF within 10 minutes
- No engineering intervention required

**Code Reference**:
```typescript
// apps/backend/src/domain/audit/
// - permission-audit-log.entity.ts (DDD entity)
// apps/backend/src/application/audit/
// - log-permission-check.use-case.ts (write)
// - query-audit-log.use-case.ts (read)
// - archive-old-logs.job.ts (BullMQ background job)
```

---

### 8. Consultant Multi-Tenant Context Switching

**Challenge**:
Consultant manages 35+ client tenants, needs seamless switching without logout/login

**Solution**:
Tenant-aware JWT with switchable context

**JWT Claims**:
```json
{
  "sub": "user-uuid-consultant",
  "fiscalCode": "RSSMRA85M01H501X",
  "role": "consultant",
  "tenantId": "current-active-tenant-uuid",
  "tenantAssociations": [
    {
      "tenantId": "tenant-1-uuid",
      "roleName": "ADMIN",
      "permissions": ["..."]
    },
    {
      "tenantId": "tenant-2-uuid",
      "roleName": "VIEWER",
      "permissions": ["..."]
    }
  ],
  "iat": 1698765432,
  "exp": 1698769032
}
```

**Context Switch Flow**:
1. Consultant calls `POST /consultant/switch-tenant` with target `tenantId`
2. Backend validates consultant has association with target tenant
3. Issues new JWT with updated `tenantId` in claims
4. Frontend stores new token, reloads app state
5. All subsequent API calls scoped to new tenant

**Performance Target**: <2 seconds at 95th percentile (SC-002)

**Security Considerations**:
- Audit log clearly distinguishes consultant actions: "Consultant [Name] acting as [Role] for [Tenant] performed [Action]"
- Each tenant association separately validated on login
- Cannot switch to tenant without explicit association
- Rate limited: 100 switches/minute (prevent abuse)

**Aggregated Dashboard**:
- `GET /consultant/dashboard` returns cross-tenant KPIs
- Backend fans out queries to all associated tenants (parallel)
- Response cached 5 minutes per consultant
- Critical alerts color-coded by urgency
- Deep links to switch context + navigate to resource

**Code Reference**:
```typescript
// apps/backend/src/application/consultant/
// - switch-tenant-context.use-case.ts
// - get-aggregated-dashboard.use-case.ts
// apps/backend/src/core/auth/
// - consultant-context.guard.ts (validates tenant association)
```

---

### 9. Temporary Permission Grants

**Self-Service Elevation Workflow**:

1. **User Requests**:
   - Attempts restricted action (e.g., export MUD report)
   - Permission denied with "Request Access" button
   - Submits justification + requested duration

2. **Admin Approval**:
   - All tenant admins notified (email + in-app)
   - One-click approve/deny from notification
   - Optional admin notes attached to decision

3. **Grant Active**:
   - Permission granted immediately on approval
   - User notified with expiration timestamp
   - All actions logged with grant ID in context

4. **Auto-Expiration**:
   - Background job checks expirations every 5 minutes
   - Expired grants auto-revoked
   - User + granting admin notified
   - Permission cache invalidated

**Business Rules**:
- Maximum duration: 168 hours (7 days)
- Default duration: 8 hours
- Justification minimum: 10 characters
- Cannot grant permissions beyond granter's own permissions
- Can be manually revoked early by any admin

**Audit Trail**:
- All actions performed during elevation window clearly flagged
- Grant ID attached to audit log entries
- Reconstruction: "User had permission at time T because of temporary grant #123"

**Success Metric** (SC-021):
70% of temporary permission requests approved within 30 minutes

**Code Reference**:
```typescript
// apps/backend/src/domain/permissions/
// - temporary-permission-grant.entity.ts
// apps/backend/src/application/permissions/
// - request-temporary-permission.use-case.ts
// - approve-temporary-grant.use-case.ts
// - check-expired-grants.job.ts (BullMQ)
```

---

### 10. Historical Permission Reconstruction

**Compliance Requirement**:
ARPA inspectors may ask: "Who could access FIR #2025-001234 on February 15, 2025 at 14:30?"

**Solution**: Versioned Role Assignment History

**Data Model**:
- Every role assignment/revocation creates immutable history record
- Every role permission modification creates snapshot
- `RoleChangeHistory` table stores before/after state

**Reconstruction Algorithm**:
1. Query: Find all `UserRole` assignments active at timestamp T
2. For each assignment, find role definition at timestamp T (via change history)
3. Evaluate ABAC policies against historical resource state
4. Return: List of users with permission at that point in time

**Query Endpoint**:
```
POST /audit/permissions/reconstruct
{
  "resourceType": "fir",
  "resourceId": "fir-uuid-001234",
  "timestamp": "2025-02-15T14:30:00.000Z",
  "action": "read"
}
```

**Response**:
```json
{
  "usersWithAccess": [
    {
      "userId": "user-1",
      "userName": "Marco Rossi",
      "fiscalCode": "RSSMRC80A01H501Z",
      "roles": ["ADMIN"],
      "grantingPermissions": ["fir:read:all"]
    },
    {
      "userId": "user-2",
      "userName": "Elena Consultant",
      "fiscalCode": "CNSLNE85M01H501X",
      "roles": ["CONSULTANT"],
      "grantingPermissions": ["fir:read:all"],
      "consultantContext": "Acting for Officina Ferri"
    }
  ],
  "confidence": "HIGH"
}
```

**Performance**:
- Indexed on `(timestamp, tenantId)` for fast lookups
- Typical query time: <500ms for 5-year history
- Rate limited: 10 requests/minute (expensive operation)

**Code Reference**:
```typescript
// apps/backend/src/application/audit/
// - reconstruct-historical-permissions.use-case.ts
// - role-change-history.repository.ts
```

---

## Security Considerations

### 1. JWT Token Security

**Structure**:
- Algorithm: RS256 (asymmetric)
- Issuer: `wasteflow.it`
- Audience: `wasteflow-api`
- Expiration: 1 hour (short-lived)
- Refresh token: 7 days (rotation on use)

**Claims Validation**:
- `sub`: User UUID (validated against database)
- `tenantId`: Current tenant context (validated on every request)
- `fiscalCode`: SPID fiscal code (never null for production users)
- `iat`: Issued at (reject if future timestamp)
- `exp`: Expiration (reject if expired)

**Guard Implementation**:
```typescript
@UseGuards(JwtAuthGuard, TenantContextGuard)
@RequirePermission('roles:create')
async createRole(@Body() dto: CreateRoleDto, @CurrentUser() user) {
  // TenantContextGuard ensures JWT tenantId matches route/body tenantId
  // RequirePermission decorator checks user permissions
}
```

**Token Storage**:
- Frontend: `localStorage` for SPA (XSS risk mitigated by CSP)
- Mobile: Secure keychain (iOS Keychain, Android Keystore)
- Never logged or transmitted in query parameters

### 2. Permission Cache Poisoning Prevention

**Attack Vector**:
Attacker modifies cached permissions to grant unauthorized access

**Mitigation**:
```typescript
interface CachedPermissions {
  userId: string;
  tenantId: string;
  permissions: string[];
  timestamp: number;
  signature: string; // HMAC-SHA256(userId|tenantId|permissions|timestamp, secret)
}
```

**Validation**:
- Every cache read verifies HMAC signature
- Invalid signature = cache miss, re-fetch from database
- Signature key rotated quarterly

### 3. Cross-Tenant Data Leakage Prevention

**Defense-in-Depth Layers**:

1. **Schema-per-Tenant** (Primary)
   - Each tenant: separate PostgreSQL schema
   - Connection pool tagged with `tenant_id`
   - Query router ensures correct schema

2. **Row-Level Security** (Secondary)
   - PostgreSQL RLS policies enforce `tenant_id` filter
   - Applies even if application bug bypasses schema check
   - Example policy:
     ```sql
     CREATE POLICY tenant_isolation ON fir
       USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
     ```

3. **API Response Scrubbing** (Tertiary)
   - Global NestJS interceptor validates all responses
   - Strips any cross-tenant data if accidentally fetched
   - Logs security events for investigation

4. **Automated Testing**
   - Penetration tests attempt cross-tenant access
   - Success Criteria (SC-010): Zero cross-tenant leakage incidents

### 4. Self-Assignment Prevention

**Risk**:
User attempts to grant themselves elevated role

**Mitigation**:
```typescript
// Backend validation
if (dto.userId === currentUser.id && isElevatedRole(dto.roleId)) {
  throw new ForbiddenException({
    error: 'SELF_ASSIGNMENT_PROHIBITED',
    message: 'Cannot assign elevated roles to yourself. Contact another administrator.',
    details: {
      securityIncident: true, // Flags for review
      attemptedRole: dto.roleId
    }
  });
}
```

**Audit**:
- All self-assignment attempts logged as security events
- Administrators receive alert for investigation

### 5. SPID Re-Authentication for Sensitive Operations

**High-Risk Operations**:
- Deleting users
- Approving FIRs
- Applying digital signatures
- Exporting sensitive reports

**Step-Up Authentication**:
```typescript
@UseGuards(SpidReAuthGuard)
@RequirePermission('users:delete')
async deleteUser(@Param('id') id: string) {
  // SpidReAuthGuard checks:
  // - SPID authentication within last 15 minutes
  // - If older, returns 403 with reAuthRequired: true
  // - Frontend redirects to SPID re-authentication
}
```

**User Experience**:
- Clear message: "This action requires recent authentication"
- One-click re-auth via SPID (no full logout)
- Session extended on successful re-auth

---

## Performance Optimization Strategies

### 1. Permission Check Hot Path

**Target**: <10ms at 99th percentile (SC-007)

**Optimization Stack**:

1. **Redis Cache Hit** (95%+ of requests)
   - Lookup: `GET perm:${tenantId}:${userId}:v${ver}`
   - Verify HMAC signature
   - Return cached permissions
   - Latency: ~2ms

2. **In-Memory Cache Hit** (3% of requests, Redis miss)
   - LRU cache in Node.js heap
   - No network overhead
   - Latency: ~0.5ms

3. **Database Query** (2% of requests, total cache miss)
   - Optimized query with joins:
     ```sql
     SELECT DISTINCT p.permission_string
     FROM user_roles ur
     JOIN role_permissions rp ON ur.role_id = rp.role_id
     JOIN permissions p ON rp.permission_id = p.id
     WHERE ur.user_id = $1
       AND ur.tenant_id = $2
       AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
     ```
   - Indexed on `(user_id, tenant_id, expires_at)`
   - Latency: ~15ms
   - Result written to both caches

**Monitoring**:
- P50, P95, P99 latency tracked via OpenTelemetry
- Alert if P99 > 20ms for 5 minutes

### 2. Bulk Role Assignment Performance

**Challenge**:
Assigning role to 1000 users

**Solution**:
Async job with chunked processing

**Implementation**:
```typescript
// BullMQ job
async processBulkRoleAssignment(job: Job<BulkAssignmentData>) {
  const { userIds, roleId, tenantId } = job.data;
  const CHUNK_SIZE = 100;

  for (let i = 0; i < userIds.length; i += CHUNK_SIZE) {
    const chunk = userIds.slice(i, i + CHUNK_SIZE);

    // Database: batch insert
    await this.prisma.userRole.createMany({
      data: chunk.map(userId => ({
        userId,
        roleId,
        tenantId,
        assignedBy: job.data.adminId,
        assignedAt: new Date()
      }))
    });

    // Redis: batch invalidate
    await this.cache.invalidateMany(
      chunk.map(userId => `perm:${tenantId}:${userId}:*`)
    );

    // Progress update
    await job.updateProgress((i + CHUNK_SIZE) / userIds.length * 100);
  }
}
```

**Performance Target** (SC-011):
1000 users in <5 minutes = 200 users/minute = 3.3 users/second

**Monitoring**:
- Job progress visible in admin UI
- Completion notification sent to admin

### 3. Audit Log Query Optimization

**Challenge**:
10+ years of audit logs = billions of records

**Solution**:
PostgreSQL table partitioning + smart indexing

**Partitioning Strategy**:
```sql
-- Parent table
CREATE TABLE permission_audit_log (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  fiscal_code TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  context_attributes JSONB,
  consultant_context JSONB,
  evaluation_time_ms FLOAT
) PARTITION BY RANGE (timestamp);

-- Monthly partitions
CREATE TABLE permission_audit_log_2025_10
  PARTITION OF permission_audit_log
  FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

-- Indexes on each partition
CREATE INDEX idx_audit_tenant_user_ts
  ON permission_audit_log (tenant_id, user_id, timestamp DESC);
CREATE INDEX idx_audit_resource
  ON permission_audit_log (resource_type, resource_id, timestamp DESC);
CREATE INDEX idx_audit_fiscal_code
  ON permission_audit_log (fiscal_code, timestamp DESC);
CREATE INDEX idx_audit_decision
  ON permission_audit_log (decision, timestamp DESC)
  WHERE decision = 'DENY'; -- Partial index for security analysis
```

**Query Optimization**:
- Date range mandatory in all queries (partition pruning)
- Composite indexes cover common query patterns
- EXPLAIN ANALYZE reviewed for all audit queries

**Archival**:
- Partitions older than 3 years detached and archived to S3
- `pg_dump` to Parquet format (columnar, compressed)
- Searchable metadata index remains in PostgreSQL

---

## Implementation Roadmap

### Phase 1: Core RBAC Foundation (Weeks 1-2)

**Backend**:
- [ ] Prisma schema: Role, Permission, UserRole, RolePermission entities
- [ ] Domain entities (DDD): Role aggregate, UserRole value object
- [ ] Use cases: CreateRole, AssignRole, RevokeRole (TDD)
- [ ] Repository implementations with tenant isolation
- [ ] NestJS controllers: `/roles`, `/users/{id}/roles`
- [ ] JWT guard integration with permission checks

**Frontend**:
- [ ] Role management UI (PrimeNG DataTable)
- [ ] User role assignment modal
- [ ] Permission preview before assignment

**Success Criteria**:
- Admin can create system roles (Admin, Operator, Viewer)
- Admin can assign roles to users within tenant
- Roles enforce permission checks on FIR operations
- All tests passing (100% coverage)

### Phase 2: Permission Caching & Performance (Week 3)

**Backend**:
- [ ] Redis permission cache implementation
- [ ] Cache invalidation pub/sub
- [ ] In-memory LRU fallback cache
- [ ] HMAC signature generation/verification
- [ ] Performance benchmarking (target: <10ms P99)

**Monitoring**:
- [ ] OpenTelemetry instrumentation
- [ ] Grafana dashboard: cache hit rate, P99 latency
- [ ] Alerts: P99 > 20ms, cache hit rate < 90%

**Success Criteria**:
- Permission checks: <10ms at P99 (SC-007)
- Cache hit rate: >95% (SC-008)

### Phase 3: Audit Logging (Week 4)

**Backend**:
- [ ] PermissionAuditLog entity with partitioning
- [ ] Async audit writer (BullMQ)
- [ ] Audit query use cases
- [ ] Export to CSV functionality
- [ ] Historical permission reconstruction

**Frontend**:
- [ ] Audit log viewer with advanced filters
- [ ] Export button with progress indicator
- [ ] Compliance officer dashboard

**Success Criteria**:
- All permission checks logged (SC-013)
- Audit log write lag: <1 second P99 (SC-009)
- ARPA inspection request fulfilled in <10 minutes (SC-016)

### Phase 4: Custom Roles (Enterprise) (Week 5)

**Backend**:
- [ ] Custom role creation use case
- [ ] Permission matrix validation
- [ ] Role update/delete with safety checks
- [ ] Enterprise tier gating

**Frontend**:
- [ ] Permission matrix builder UI (checkboxes by module)
- [ ] Role preview showing effective permissions
- [ ] Drag-and-drop permission organization

**Success Criteria**:
- Super Admin can create custom roles (FR-005)
- Custom roles enforce same permission checks as system roles
- Enterprise tier conversion: 5% → 20% (SC-019)

### Phase 5: Consultant Multi-Tenant (Week 6)

**Backend**:
- [ ] Tenant association data model
- [ ] Switch tenant context use case
- [ ] Aggregated dashboard query (fan-out to multiple tenants)
- [ ] JWT regeneration with new tenant claim

**Frontend**:
- [ ] Tenant selector dropdown (header)
- [ ] Aggregated dashboard showing all clients
- [ ] Client alert cards sorted by urgency

**Success Criteria**:
- Consultants manage 50+ tenants (SC-001)
- Context switch: <2 seconds P95 (SC-002)
- Audit trail clearly shows consultant actions (FR-023)

### Phase 6: Temporary Permissions (Week 7)

**Backend**:
- [ ] TemporaryPermissionGrant entity
- [ ] Request/approve/deny use cases
- [ ] Auto-expiration background job (every 5 minutes)
- [ ] Notification integration

**Frontend**:
- [ ] "Request Access" button on permission denied
- [ ] Admin approval notification with one-click approve/deny
- [ ] Temporary grant countdown timer in UI

**Success Criteria**:
- 70% approved within 30 minutes (SC-021)
- Auto-revocation on expiration (FR-016)
- Admin time on access management: <1 hour/week (SC-020)

### Phase 7: Mobile Optimization (Week 8)

**Frontend (Angular)**:
- [ ] Mobile-responsive role cards (PrimeNG responsive utilities)
- [ ] Touch-friendly permission matrix (48px targets)
- [ ] Offline permission caching (24-hour TTL)
- [ ] "Last synced" indicator

**Testing**:
- [ ] Browserstack mobile device testing (iOS, Android)
- [ ] 3G network throttling tests

**Success Criteria**:
- Permission discovery loads: <2 seconds on 3G (SC-012)
- WCAG 2.1 AA compliance (SC-017)
- Field operator task completion: 40% faster (SC-022)

### Phase 8: Security Hardening & Launch (Week 9-10)

**Security**:
- [ ] Penetration testing (cross-tenant isolation)
- [ ] SPID re-authentication for sensitive operations
- [ ] Self-assignment prevention
- [ ] Cache poisoning protection (HMAC signatures)

**Documentation**:
- [ ] API documentation (OpenAPI → Redoc)
- [ ] Admin user guide (role management)
- [ ] Compliance guide (ARPA inspection procedures)

**Launch Preparation**:
- [ ] Load testing: 10,000 requests/second (SC-007)
- [ ] Failover testing: Redis down, PostgreSQL replica lag
- [ ] Runbook: Permission cache clear, audit export procedures

**Success Criteria**:
- Zero cross-tenant leakage in pentest (SC-010)
- Zero regulatory fines in first year (SC-024)
- Support tickets: <5/week (SC-004)

---

## Testing Strategy

### Unit Tests (TDD Mandatory)

**Domain Layer** (100% coverage required):
```typescript
// apps/backend/src/domain/permissions/__tests__/role.entity.spec.ts
describe('Role Entity', () => {
  it('should create system role with immutable flag', () => {
    const role = Role.createSystem('ADMIN', [...permissions]);
    expect(role.isSystemRole).toBe(true);
    expect(() => role.rename('NewName')).toThrow('Cannot modify system role');
  });

  it('should create custom role with validation', () => {
    const role = Role.createCustom('Site Manager', [...permissions]);
    expect(role.isSystemRole).toBe(false);
    expect(role.permissions.length).toBeGreaterThan(0);
  });
});
```

**Application Layer** (all use cases):
```typescript
// apps/backend/src/application/permissions/__tests__/assign-role.use-case.spec.ts
describe('AssignRoleUseCase', () => {
  it('should assign role and invalidate cache', async () => {
    const command = new AssignRoleCommand(userId, roleId, tenantId, adminId);
    const result = await useCase.execute(command);

    expect(result.isSuccess).toBe(true);
    expect(cacheService.invalidate).toHaveBeenCalledWith(`perm:${tenantId}:${userId}`);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ROLE_ASSIGNED',
      userId,
      roleId
    }));
  });

  it('should prevent last admin removal', async () => {
    // Setup: only 1 admin remains
    const result = await useCase.execute(revokeLastAdminCommand);

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('At least one administrator');
  });
});
```

### Integration Tests (API Endpoints)

```typescript
// apps/backend/src/api/roles/__tests__/roles.controller.int.spec.ts
describe('RolesController (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    // Setup test database with tenant isolation
    app = await createTestApp();
    prisma = app.get(PrismaService);
    adminToken = await getTestAuthToken('ADMIN');
  });

  it('POST /roles - creates custom role', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Site Manager',
        description: 'Manages Milano facility',
        permissions: ['fir:create:facility', 'fir:read:all']
      })
      .expect(201);

    expect(response.body.id).toBeDefined();
    expect(response.body.name).toBe('Site Manager');

    // Verify database
    const role = await prisma.role.findUnique({ where: { id: response.body.id } });
    expect(role).toBeDefined();
  });

  it('POST /roles - returns 403 for non-admin user', async () => {
    const operatorToken = await getTestAuthToken('OPERATOR');

    await request(app.getHttpServer())
      .post('/v1/roles')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Test', description: 'Test', permissions: ['fir:read:own'] })
      .expect(403);
  });
});
```

### E2E Tests (Critical User Journeys)

```typescript
// apps/backend/test/e2e/permission-workflows.e2e-spec.ts
describe('Permission Workflows (E2E)', () => {
  it('User Story 1: Admin assigns role to employee', async () => {
    // 1. Admin invites user
    const inviteResponse = await adminClient.post('/users/invite', {
      email: 'luca.bianchi@example.com',
      roleId: operatorRoleId
    });
    expect(inviteResponse.status).toBe(201);

    // 2. User accepts invite (simulated)
    const userId = inviteResponse.body.userId;

    // 3. User logs in
    const userToken = await loginUser(userId);

    // 4. User attempts to create FIR
    const firResponse = await userClient(userToken).post('/fir', firPayload);
    expect(firResponse.status).toBe(201);

    // 5. Audit log contains correct entry
    const auditLogs = await adminClient.get(`/audit/permissions?userId=${userId}`);
    expect(auditLogs.body.items).toContainEqual(
      expect.objectContaining({
        action: 'fir:create',
        decision: 'ALLOW',
        reason: expect.stringContaining('OPERATOR role')
      })
    );
  });

  it('User Story 2: Consultant switches tenant context', async () => {
    // Setup: Consultant associated with 2 tenants
    const consultant = await createConsultant([tenant1.id, tenant2.id]);
    const consultantToken = await loginConsultant(consultant.id);

    // 1. Consultant views dashboard (tenant 1 active)
    const dashboard1 = await consultantClient(consultantToken).get('/fir');
    const tenant1FirIds = dashboard1.body.items.map(f => f.id);

    // 2. Consultant switches to tenant 2
    const switchResponse = await consultantClient(consultantToken)
      .post('/consultant/switch-tenant', { tenantId: tenant2.id });
    expect(switchResponse.status).toBe(200);
    const newToken = switchResponse.body.accessToken;

    // 3. Consultant views dashboard (tenant 2 active)
    const dashboard2 = await consultantClient(newToken).get('/fir');
    const tenant2FirIds = dashboard2.body.items.map(f => f.id);

    // 4. Verify zero cross-tenant data leakage
    expect(tenant1FirIds).not.toEqual(expect.arrayContaining(tenant2FirIds));
  });
});
```

### Performance Tests (Apache JMeter / k6)

```javascript
// performance/permission-check-load-test.js (k6 script)
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up to 100 users
    { duration: '5m', target: 100 },   // Stay at 100 users
    { duration: '2m', target: 1000 },  // Ramp up to 1000 users
    { duration: '5m', target: 1000 },  // Stay at 1000 users (10K req/s)
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(99)<10'],    // 99% of requests < 10ms
    http_req_failed: ['rate<0.01'],     // Error rate < 1%
  },
};

export default function () {
  const url = 'https://api.wasteflow.it/v1/permissions/check';
  const payload = JSON.stringify({
    permission: 'fir:create:facility',
    resourceId: null,
    context: {}
  });
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${__ENV.TEST_TOKEN}`,
    },
  };

  const res = http.post(url, payload, params);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 10ms': (r) => r.timings.duration < 10,
    'permission allowed': (r) => JSON.parse(r.body).allowed === true,
  });

  sleep(0.1); // 10 requests/second per virtual user
}
```

**Success Criteria**:
- P99 latency: <10ms (SC-007)
- Throughput: 10,000 requests/second
- Error rate: <0.1%

---

## Monitoring & Observability

### Key Metrics (OpenTelemetry)

**Application Metrics**:
- `permission_check_duration_ms` (histogram, P50/P95/P99)
- `permission_cache_hit_rate` (gauge, target >95%)
- `role_assignment_total` (counter, by role type)
- `audit_log_write_lag_ms` (histogram, target <1000ms)
- `consultant_context_switches_total` (counter)
- `temporary_grants_pending` (gauge)

**Business Metrics**:
- `permission_denied_by_action` (counter, detect usability issues)
- `support_tickets_permission_related` (external, target <5/week)
- `time_to_approve_permission_request_minutes` (histogram, target <30min)

### Dashboards (Grafana)

**1. Performance Dashboard**:
- Permission check latency (P50, P95, P99) - line chart
- Cache hit rate - gauge with threshold alerts
- Request rate by endpoint - line chart
- Error rate by endpoint - line chart

**2. Security Dashboard**:
- Permission denied attempts by user - top 10 bar chart
- Cross-tenant access attempts - counter (target: 0)
- Self-assignment attempts - counter with alerts
- Failed authentication attempts - line chart

**3. Business KPI Dashboard**:
- Active consultants managing >50 clients - gauge
- Permission request approval time (avg) - gauge
- Support tickets (permission-related) - line chart
- Custom roles created per month - bar chart

### Alerts (PagerDuty)

**Critical (P1 - immediate page)**:
- Permission check P99 > 50ms for 5 minutes
- Cross-tenant data leakage detected
- Audit log write failures > 1% for 2 minutes
- Redis cache unavailable

**High (P2 - page during business hours)**:
- Permission check P99 > 20ms for 15 minutes
- Cache hit rate < 85% for 10 minutes
- Temporary grant expiration job failed

**Medium (P3 - ticket only)**:
- Support tickets > 10/week
- Custom role creation failures > 5/day
- Consultant dashboard load time > 5 seconds

---

## Migration Strategy (Existing Production System)

### Assumptions
- Current system: Basic role assignments exist (Admin, User)
- User table: ~5,000 users across 200 tenants
- FIR records: ~50,000 records

### Migration Steps

**Phase 1: Schema Migration (Zero Downtime)**
```sql
-- 1. Create new tables (while old system running)
CREATE TABLE roles (...);
CREATE TABLE permissions (...);
CREATE TABLE user_roles (...);
-- ... etc

-- 2. Backfill system roles
INSERT INTO roles (id, name, description, is_system_role, tenant_id)
VALUES
  (uuid_generate_v4(), 'ADMIN', 'Administrator', true, tenant_id),
  (uuid_generate_v4(), 'OPERATOR', 'Operator', true, tenant_id),
  (uuid_generate_v4(), 'VIEWER', 'Viewer', true, tenant_id)
FROM tenants;

-- 3. Migrate existing user roles
INSERT INTO user_roles (user_id, role_id, tenant_id, assigned_at, assigned_by)
SELECT
  u.id,
  r.id,
  u.tenant_id,
  COALESCE(u.created_at, NOW()),
  (SELECT id FROM users WHERE role = 'ADMIN' AND tenant_id = u.tenant_id LIMIT 1)
FROM users u
JOIN roles r ON r.name = CASE
  WHEN u.is_admin THEN 'ADMIN'
  ELSE 'OPERATOR'
END
WHERE r.tenant_id = u.tenant_id;
```

**Phase 2: Gradual Rollout (Feature Flags)**
```typescript
// Feature flag: gradual tenant migration
if (await featureFlags.isEnabled('new_permission_system', tenantId)) {
  // Use new permission system
  return await permissionService.checkPermission(user, permission);
} else {
  // Fallback to legacy role check
  return user.role === 'ADMIN';
}
```

**Rollout Schedule**:
- Week 1: Internal testing tenant (5 users)
- Week 2: 10 pilot tenants (50 users total)
- Week 3: 50 tenants (500 users)
- Week 4: All remaining tenants

**Rollback Plan**:
- Feature flag toggle (immediate)
- Old permission tables preserved for 30 days
- Database transaction log backup before migration

**Phase 3: Audit Log Backfill**
```typescript
// Background job: backfill audit logs from existing FIR history
for (const fir of allFirs) {
  // Infer permission checks from FIR state transitions
  if (fir.status === 'COMPLETED' && fir.signedBy) {
    await auditLog.create({
      action: 'fir:sign',
      userId: fir.signedBy,
      resourceId: fir.id,
      decision: 'ALLOW',
      reason: 'Historical backfill from FIR completion',
      timestamp: fir.completedAt
    });
  }
}
```

**Phase 4: Legacy Cleanup (30 days after migration)**
```sql
-- Drop old columns
ALTER TABLE users DROP COLUMN is_admin;
ALTER TABLE users DROP COLUMN permissions_json;

-- Archive old audit tables
CREATE TABLE legacy_audit_archive AS SELECT * FROM old_audit_logs;
DROP TABLE old_audit_logs;
```

---

## FAQ & Troubleshooting

### Q: What happens if Redis cache goes down?

**A**: Graceful degradation to in-memory cache + database

1. Permission checks fallback to in-memory LRU cache (1-minute stale reads)
2. If LRU cache miss, query database directly
3. Response time degrades from ~2ms → ~15ms (still acceptable)
4. Health check endpoint returns 503 to load balancer
5. Alert triggered: "Redis unavailable - degraded performance"
6. Auto-recovery: Redis reconnection every 30 seconds

**Code**:
```typescript
async checkPermission(user, permission) {
  try {
    return await this.redisCache.get(`perm:${user.tenantId}:${user.id}`);
  } catch (redisError) {
    logger.warn('Redis unavailable, fallback to LRU', { error: redisError });
    return this.inMemoryCache.get(cacheKey) ?? this.queryDatabase(user);
  }
}
```

### Q: How do I clear permission cache for specific user?

**A**: Two methods depending on urgency

**Option 1: API Endpoint** (Admin UI)
```bash
DELETE /v1/admin/cache/permissions?userId=<uuid>&tenantId=<uuid>
Authorization: Bearer <admin-token>
```

**Option 2: Redis CLI** (Emergency)
```bash
redis-cli DEL "perm:<tenantId>:<userId>:*"
redis-cli PUBLISH permission_invalidation '{"tenantId": "...", "userId": "..."}'
```

**Option 3: Full Tenant Cache Clear** (Nuclear)
```bash
redis-cli --scan --pattern "perm:<tenantId>:*" | xargs redis-cli DEL
```

### Q: User reports "Permission denied" but should have access. How do I debug?

**A**: Debug checklist

1. **Check user's current roles**:
   ```bash
   GET /v1/users/<userId>/roles
   ```
   Verify assigned roles, expiration timestamps, facility scope

2. **Check role's permissions**:
   ```bash
   GET /v1/roles/<roleId>/permissions
   ```
   Verify role includes required permission

3. **Check permission cache**:
   ```bash
   redis-cli GET "perm:<tenantId>:<userId>:v1"
   ```
   Verify cached permissions include required permission

4. **Check audit log**:
   ```bash
   GET /v1/audit/permissions?userId=<userId>&dateFrom=<now-1h>&decision=DENY
   ```
   Find specific denial with reason

5. **Force cache refresh**:
   ```bash
   DELETE /v1/admin/cache/permissions?userId=<uuid>
   ```
   User retry action

6. **Check tenant context**:
   Verify JWT `tenantId` claim matches resource's tenant

7. **Check facility scope**:
   If facility-scoped role, verify user assigned to resource's facility

### Q: How do I generate compliance report for ARPA inspection?

**A**: Pre-built report templates

```bash
# Audit trail for specific FIR
POST /v1/audit/permissions/export
{
  "filters": {
    "resourceType": "fir",
    "resourceId": "fir-uuid-001234",
    "dateFrom": "2024-01-01T00:00:00Z",
    "dateTo": "2025-12-31T23:59:59Z"
  },
  "format": "csv"
}

# Response: Job ID for download
{
  "jobId": "export-job-uuid",
  "statusUrl": "/v1/jobs/export-job-uuid/status"
}

# Poll for completion
GET /v1/jobs/export-job-uuid/status
{
  "status": "COMPLETED",
  "result": {
    "downloadUrl": "https://exports.wasteflow.it/audit-001234.csv",
    "expiresAt": "2025-11-07T14:30:00Z"
  }
}
```

**CSV includes**:
- Timestamp (millisecond precision)
- User name + SPID fiscal code
- Action attempted
- Resource accessed
- Decision (ALLOW/DENY)
- IP address
- Digital signature verification (if applicable)

### Q: Consultant reports slow tenant switching (>5 seconds). How do I optimize?

**A**: Performance debugging steps

1. **Check JWT generation time**:
   ```typescript
   // Add timing instrumentation
   const startTime = Date.now();
   const newToken = await this.jwtService.sign(payload);
   logger.info('JWT generation time', { durationMs: Date.now() - startTime });
   // Target: <50ms
   ```

2. **Check tenant permission query**:
   ```sql
   EXPLAIN ANALYZE
   SELECT ...
   FROM user_roles
   WHERE user_id = $1 AND tenant_id = $2;
   -- Verify index usage
   ```

3. **Check frontend reload time**:
   - Network tab: API calls after context switch
   - Lazy load modules, don't re-fetch static data

4. **Optimize aggregated dashboard query**:
   - Cache consultant dashboard for 5 minutes
   - Parallelize tenant queries (Promise.all)
   - Limit to top 20 clients by activity

5. **Success Criteria**: <2 seconds at P95 (SC-002)

### Q: How do I restore accidentally deleted role?

**A**: Role soft-deletion for 30 days

```sql
-- Roles are soft-deleted (deleted_at timestamp)
SELECT * FROM roles WHERE id = '<role-uuid>' AND deleted_at IS NOT NULL;

-- Restore role (admin only)
UPDATE roles SET deleted_at = NULL WHERE id = '<role-uuid>';

-- Restore user assignments
UPDATE user_roles SET deleted_at = NULL
WHERE role_id = '<role-uuid>' AND deleted_at IS NOT NULL;

-- Invalidate caches for affected users
```

**Prevention**: Custom roles require confirmation dialog with impact summary

---

## Contact & Support

**API Support**:
- Email: api-support@wasteflow.it
- Slack: #api-platform (internal)
- On-call: PagerDuty rotation

**Documentation**:
- OpenAPI Spec: https://api.wasteflow.it/docs
- Developer Portal: https://developers.wasteflow.it
- Postman Collection: https://postman.com/wasteflow/collections

**Security Issues**:
- Email: security@wasteflow.it (PGP key available)
- Bug Bounty: https://wasteflow.it/security/bug-bounty

---

## Appendix: Permission Naming Conventions

### Resource Types
- `fir` - Formulario Identificazione Rifiuti
- `registry` - Registry entries (producers, transporters, facilities)
- `report` - Analytics reports
- `mud` - MUD (annual reporting)
- `user` - User management
- `role` - Role management
- `facility` - Facility management
- `signature` - Digital signatures
- `backup` - Backup operations
- `notification` - Notification management
- `rentri` - RENTRI sync operations

### Actions
- `create` - Create new resource
- `read` - View resource
- `update` - Modify existing resource
- `delete` - Remove resource
- `approve` - Approve workflow (FIR completion)
- `sign` - Apply digital signature
- `export` - Export to external format (CSV, PDF)

### Scopes
- `own` - Only resources created by user
- `facility` - Resources for user's assigned facilities
- `all` - All resources in tenant (admin-level)

### Examples
```typescript
// Operator creating FIRs for their facility
'fir:create:facility'

// Manager viewing all FIRs in tenant
'fir:read:all'

// Auditor exporting reports (read-only)
'report:export:all'

// User managing only their own notifications
'notification:update:own'

// Admin managing all users
'user:create:all'
'user:delete:all'
```

---

**Document Version**: 1.0
**Last Reviewed**: 2025-10-31
**Next Review**: 2025-12-01
**Owner**: Platform Engineering Team
