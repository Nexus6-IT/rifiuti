# Architecture Diagrams: Roles and Permissions System

**Feature**: 002-roles-permissions-system
**Date**: 2025-10-31

---

## 1. Permission Check Flow (Request Lifecycle)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Client Request (HTTP)                            │
│                    GET /fir/123?tenantId=abc                            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     1. JwtAuthGuard (NestJS)                            │
│  • Validate JWT signature                                               │
│  • Extract user payload (userId, tenantId, fiscalCode, roles)          │
│  • Attach to request.user                                               │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   2. TenantIsolationGuard                               │
│  • Extract tenant context (header/JWT/query)                            │
│  • Verify consultant access (if applicable)                             │
│  • Validate tenant is active                                            │
│  • Set PostgreSQL RLS: SET LOCAL app.current_tenant_id = {tenantId}   │
│  • Attach to request.tenantId                                           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      3. PermissionGuard                                 │
│  • Read decorator: @RequirePermission('fir:read:own')                   │
│  • Extract resourceId from params (if specified)                        │
│  • Call EvaluatePermissionUseCase                                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  Cache Check (Redis)   │
                    │  Key: perm:check:...   │
                    └────────┬───────┬───────┘
                             │       │
                    Cache Hit│       │Cache Miss
                             │       │
                             ▼       ▼
                    ┌────────────────────────┐
                    │   Return Cached Result │
                    │   (< 5ms)              │
                    └────────┬───────────────┘
                             │
                             │       ┌─────────────────────────────────┐
                             │       │  4. Database Query (Prisma)     │
                             │       │  • Load user roles              │
                             │       │  • Expand role permissions      │
                             │       │  • Check temporary grants       │
                             │       │  • Load ABAC policies           │
                             │       │  (< 20ms)                       │
                             │       └───────────┬─────────────────────┘
                             │                   │
                             │                   ▼
                             │       ┌─────────────────────────────────┐
                             │       │  5. ABAC Policy Evaluation      │
                             │       │  • Evaluate conditions          │
                             │       │  • Check resource ownership     │
                             │       │  • Apply facility scope         │
                             │       │  (< 5ms)                        │
                             │       └───────────┬─────────────────────┘
                             │                   │
                             │                   ▼
                             │       ┌─────────────────────────────────┐
                             │       │  6. Cache Result (Redis)        │
                             │       │  • Store decision (TTL: 10min)  │
                             │       │  • Sign with HMAC               │
                             │       └───────────┬─────────────────────┘
                             │                   │
                             └───────────────────┘
                                     │
                                     ▼
                        ┌────────────────────────┐
                        │  Decision: ALLOW/DENY  │
                        └────────┬───────────────┘
                                 │
                                 ├─── ALLOW ───────────────┐
                                 │                          │
                                 ▼                          ▼
                    ┌─────────────────────────┐  ┌─────────────────────┐
                    │  7. Async Audit Log     │  │  Controller Handler │
                    │  • Queue to BullMQ      │  │  • Execute business │
                    │  • Non-blocking write   │  │    logic            │
                    │  (< 1ms)                │  │  • Return response  │
                    └─────────────────────────┘  └─────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  8. Background Job      │
                    │  • Write to PostgreSQL  │
                    │  • Update crypto chain  │
                    │  (async, < 100ms)       │
                    └─────────────────────────┘
                                 │
                    DENY ────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  403 Forbidden Response │
                    │  • Required permission  │
                    │  • Current role         │
                    │  • Denial reason        │
                    │  • Admin contact        │
                    └─────────────────────────┘
```

---

## 2. Database Entity Relationships

```
┌───────────────────┐
│      Tenant       │
│ ─────────────────│
│ id (PK)           │
│ partitaIva        │
│ ragioneSociale    │
│ subscriptionTier  │
└─────────┬─────────┘
          │
          │ 1:N
          │
          ▼
┌───────────────────┐         ┌───────────────────┐         ┌───────────────────┐
│       User        │         │       Role        │         │    Permission     │
│ ─────────────────│         │ ─────────────────│         │ ─────────────────│
│ id (PK)           │◄────┐   │ id (PK)           │         │ id (PK)           │
│ tenantId (FK)     │     │   │ tenantId (FK)     │         │ permissionKey (UK)│
│ fiscalCode        │     │   │ slug              │         │ resource          │
│ email             │     │   │ name              │         │ action            │
│ isConsultant      │     │   │ isSystemRole      │         │ scope             │
│ certifications[]  │     │   │ isActive          │         │ sensitivity       │
└───────┬───────────┘     │   └─────┬─────────────┘         └─────┬─────────────┘
        │                 │         │                             │
        │                 │         │ N:M                         │
        │                 │         │ (via RolePermission)        │
        │                 │         ▼                             ▼
        │                 │   ┌───────────────────────────────────────┐
        │                 │   │        RolePermission                 │
        │                 │   │ ─────────────────────────────────────│
        │                 │   │ id (PK)                               │
        │                 │   │ roleId (FK) → Role.id                │
        │                 │   │ permissionId (FK) → Permission.id    │
        │                 │   │ facilityIds[] (optional scope)        │
        │                 │   │ conditions (ABAC override)            │
        │                 │   └───────────────────────────────────────┘
        │                 │
        │ N:M             │
        │ (via UserRole)  │
        │                 │
        ▼                 │
┌───────────────────────────────┐
│         UserRole              │
│ ─────────────────────────────│
│ id (PK)                       │
│ userId (FK) → User.id         │
│ roleId (FK) → Role.id         │
│ tenantId (FK) → Tenant.id     │
│ assignedBy (FK) → User.id  ◄──┘
│ assignedAt                    │
│ expiresAt (nullable)          │
│ isExpired                     │
│ facilityIds[] (optional)      │
│ isDelegated                   │
└───────────────┬───────────────┘
                │
                │
                │
┌───────────────┴───────────────┐
│   PermissionAuditLog          │
│ ─────────────────────────────│
│ id (PK)                       │
│ tenantId (FK)                 │
│ userId (FK)                   │
│ fiscalCode                    │
│ permissionId (FK)             │
│ permissionKey                 │
│ decision (ALLOW/DENY)         │
│ resourceType                  │
│ resourceId                    │
│ evaluatedRoles[]              │
│ evaluatedPolicies[]           │
│ ipAddress                     │
│ timestamp                     │
│ evaluationMs                  │
│ cacheHit                      │
│ previousHash (crypto chain)   │
│ currentHash                   │
└───────────────────────────────┘


┌───────────────────────────────┐
│    PermissionPolicy           │
│ ─────────────────────────────│
│ id (PK)                       │
│ permissionId (FK)             │
│ name                          │
│ policyRules (JSON)            │
│ effect (ALLOW/DENY)           │
│ evaluationOrder               │
│ isActive                      │
│ version                       │
└───────────────────────────────┘


┌───────────────────────────────┐
│  TemporaryPermissionGrant     │
│ ─────────────────────────────│
│ id (PK)                       │
│ userId (FK) → User.id         │
│ tenantId (FK)                 │
│ permissionIds[] (FK)          │
│ startAt                       │
│ expiresAt                     │
│ status (PENDING/ACTIVE/...)   │
│ isRevoked                     │
│ grantedBy (FK) → User.id      │
│ approvedBy (FK) → User.id     │
│ justification                 │
└───────────────────────────────┘


┌───────────────────────────────┐
│   ResourceOwnership           │
│ ─────────────────────────────│
│ id (PK)                       │
│ tenantId (FK)                 │
│ resourceType                  │
│ resourceId (UUID)             │
│ ownerId (FK) → User.id        │
│ facilityId (FK)               │
│ transferredFrom (FK)          │
│ transferredAt                 │
└───────────────────────────────┘


┌───────────────────────────────┐
│ ConsultantTenantAssociation   │
│ ─────────────────────────────│
│ id (PK)                       │
│ consultantUserId (FK)         │
│ clientTenantId (FK)           │
│ roleId (FK)                   │
│ isActive                      │
│ invitedBy (FK)                │
│ acceptedAt                    │
└───────────────────────────────┘
```

---

## 3. Redis Cache Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                          Redis Cache                             │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Key: perm:user:{userId}:tenant:{tenantId}                       │
│  TTL: 5 minutes                                                   │
│  Type: String (JSON)                                              │
│  ─────────────────────────────────────────────────────────────  │
│  {                                                                │
│    "userId": "uuid",                                              │
│    "tenantId": "uuid",                                            │
│    "permissions": [                                               │
│      "fir:create:facility",                                       │
│      "fir:read:facility",                                         │
│      "fir:update:own"                                             │
│    ],                                                             │
│    "roles": ["waste_operator", "site_manager"],                  │
│    "facilityIds": ["facility-1", "facility-2"],                  │
│    "temporaryGrants": [                                           │
│      {                                                            │
│        "grantId": "grant-123",                                    │
│        "permissionKeys": ["report:export:tenant"],                │
│        "expiresAt": 1698769032                                    │
│      }                                                            │
│    ],                                                             │
│    "consultantMode": false,                                       │
│    "cachedAt": 1698765432,                                        │
│    "signature": "hmac_sha256_signature"                           │
│  }                                                                │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│  Key: perm:role:{roleId}:perms                                   │
│  TTL: 1 hour                                                      │
│  Type: Set                                                        │
│  ─────────────────────────────────────────────────────────────  │
│  SET {                                                            │
│    "fir:create:facility",                                         │
│    "fir:read:facility",                                           │
│    "fir:update:facility",                                         │
│    "facility:read:tenant"                                         │
│  }                                                                │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│  Key: perm:check:{userId}:{tenantId}:{permissionKey}:{resourceId}│
│  TTL: 10 minutes                                                  │
│  Type: String (JSON)                                              │
│  ─────────────────────────────────────────────────────────────  │
│  {                                                                │
│    "decision": "ALLOW",                                           │
│    "evaluatedAt": 1698765432,                                     │
│    "ttl": 600,                                                    │
│    "matchedPolicy": "Site Manager Facility Scope",                │
│    "signature": "hmac_sha256_signature"                           │
│  }                                                                │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│  Key: perm:consultant:{userId}:tenants                           │
│  TTL: 1 hour                                                      │
│  Type: String (JSON Array)                                        │
│  ─────────────────────────────────────────────────────────────  │
│  [                                                                │
│    {                                                              │
│      "tenantId": "tenant-1",                                      │
│      "tenantName": "Officina Ferri SRL",                          │
│      "roleSlug": "consultant_admin",                              │
│      "isActive": true                                             │
│    },                                                             │
│    {                                                              │
│      "tenantId": "tenant-2",                                      │
│      "tenantName": "Metallurgica Rossi SPA",                      │
│      "roleSlug": "consultant_viewer",                             │
│      "isActive": true                                             │
│    }                                                              │
│  ]                                                                │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│  Pub/Sub Channel: cache:invalidate                               │
│  ─────────────────────────────────────────────────────────────  │
│  {                                                                │
│    "type": "user_permissions",                                    │
│    "userId": "uuid",                                              │
│    "tenantId": "uuid",                                            │
│    "reason": "role_assigned",                                     │
│    "timestamp": 1698765432                                        │
│  }                                                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. ABAC Policy Evaluation Flow

```
┌────────────────────────────────────────────────────────────────┐
│  Permission Check Request                                       │
│  User: user-123, Permission: fir:create:facility, Resource: N/A │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────────┐
│  1. Load Active ABAC Policies for Permission                   │
│     SELECT * FROM permission_policies                          │
│     WHERE permission_id = ? AND is_active = true               │
│     ORDER BY evaluation_order ASC                              │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
          ┌──────────────────────────────┐
          │  Policy 1: Priority 10       │
          │  "ADR Certification Required"│
          └────────────┬─────────────────┘
                       │
                       ▼
          ┌────────────────────────────────────────┐
          │  Evaluate Conditions (ALL must match)  │
          │  ────────────────────────────────────  │
          │  Condition 1:                          │
          │    attribute: user.certifications      │
          │    operator: contains                  │
          │    value: "ADR"                        │
          │                                        │
          │  Context:                              │
          │    user.certifications = ["ADR", "HAZMAT"] │
          │                                        │
          │  Result: MATCH ✓                       │
          └────────────┬───────────────────────────┘
                       │
                       ▼
          ┌────────────────────────────────────────┐
          │  Condition 2:                          │
          │    attribute: resource.cer_code        │
          │    operator: matches_regex             │
          │    value: "^\d{2} \d{2} \d{2}\*$"      │
          │                                        │
          │  Context:                              │
          │    resource.cer_code = "15 01 10*"     │
          │                                        │
          │  Result: MATCH ✓                       │
          └────────────┬───────────────────────────┘
                       │
                       │ ALL conditions matched
                       ▼
          ┌────────────────────────────────────────┐
          │  Policy Effect: ALLOW                  │
          │  Output Conditions: None               │
          │                                        │
          │  DECISION: ALLOW                       │
          └────────────┬───────────────────────────┘
                       │
                       ▼
          ┌────────────────────────────────────────┐
          │  Return Result                         │
          │  {                                      │
          │    decision: 'ALLOW',                  │
          │    matchedPolicy: 'ADR Certification', │
          │    evaluatedPolicies: ['policy-1']     │
          │  }                                      │
          └────────────────────────────────────────┘


┌───────────────────────── Alternative Flow ──────────────────────┐
│  If Policy 1 conditions do NOT match:                           │
│                                                                  │
│  ▼ Move to Policy 2 (Priority 20)                               │
│  ▼ Evaluate conditions...                                        │
│  ▼ If no policies match → DECISION: DENY (fail-secure)          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Consultant Multi-Tenant Context Switch

```
┌──────────────────────────────────────────────────────────────────┐
│  Consultant User: elena@studio-verde.it                          │
│  Current Context: Tenant A (Officina Ferri)                      │
│  JWT: { tenantId: "tenant-a", roles: ["admin"] }                 │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ User clicks "Switch to Tenant B"
                         │ (Metallurgica Rossi)
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Frontend: POST /auth/switch-tenant                              │
│  Body: { tenantId: "tenant-b" }                                  │
│  Headers: Authorization: Bearer {jwt_for_tenant_a}               │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Backend: SwitchTenantUseCase                                    │
│  ──────────────────────────────────────────────────────────────  │
│  1. Validate JWT (user authenticated)                            │
│  2. Verify user.isConsultant = true                              │
│  3. Query ConsultantTenantAssociation:                           │
│       WHERE consultantUserId = user.id                           │
│         AND clientTenantId = "tenant-b"                          │
│         AND isActive = true                                      │
│  4. If not found → 403 Forbidden                                 │
│  5. Load user's roles in Tenant B:                               │
│       SELECT roles FROM user_roles                               │
│       WHERE userId = user.id AND tenantId = "tenant-b"           │
│  6. Warm permission cache for Tenant B context                   │
│  7. Generate new JWT with tenantId = "tenant-b"                  │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Response: { accessToken: "new_jwt_for_tenant_b" }               │
│  ──────────────────────────────────────────────────────────────  │
│  JWT Payload:                                                     │
│  {                                                                │
│    sub: "user-123",                                               │
│    tenantId: "tenant-b",          ← Updated                      │
│    fiscalCode: "RSSLNE80A01H501U",                                │
│    roles: ["viewer"],              ← Different role in Tenant B  │
│    isConsultant: true,                                            │
│    iat: 1698765432,                                               │
│    exp: 1698769032                                                │
│  }                                                                │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Frontend: Store new JWT                                         │
│  • Replace localStorage.accessToken                              │
│  • Update Redux/NgRx tenant context state                        │
│  • Reload current view with Tenant B data                        │
│  • Update UI header: "Metallurgica Rossi (Viewer)"               │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│  Subsequent Requests (Tenant B context)                          │
│  ──────────────────────────────────────────────────────────────  │
│  GET /fir/list                                                    │
│  Headers: Authorization: Bearer {jwt_for_tenant_b}               │
│           X-Tenant-Id: tenant-b                                  │
│                                                                  │
│  → TenantIsolationGuard validates tenantId matches JWT claim     │
│  → PermissionGuard checks permissions in Tenant B context        │
│  → Response includes only Tenant B data (RLS enforced)           │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│  Audit Trail Entry                                                │
│  ──────────────────────────────────────────────────────────────  │
│  {                                                                │
│    userId: "user-123",                                            │
│    fiscalCode: "RSSLNE80A01H501U",                                │
│    userEmail: "elena@studio-verde.it",                            │
│    tenantId: "tenant-b",                                          │
│    action: "fir:read:facility",                                   │
│    description: "Elena Rossi (Consultant at Studio Verde)        │
│                 acting as VIEWER for Metallurgica Rossi           │
│                 performed READ on FIR-2025-001234",               │
│    tenantContextId: "tenant-b",                                   │
│    timestamp: "2025-10-31T14:30:00Z"                              │
│  }                                                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. Temporary Permission Grant Workflow

```
┌──────────────────────────────────────────────────────────────────┐
│  Operator Maria (Role: OPERATOR)                                 │
│  Attempts: Export MUD Report (Requires: report:export:tenant)    │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  PermissionGuard: DENY                                           │
│  • User lacks required permission                                │
│  • Show error with "Request Access" button                       │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ User clicks "Request Access"
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  POST /users/me/request-access                                   │
│  Body: {                                                          │
│    permissionKeys: ["report:export:tenant"],                     │
│    justification: "Preparing MUD 2025 for accountant",           │
│    durationHours: 24                                              │
│  }                                                                │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  RequestTemporaryAccessUseCase                                   │
│  ──────────────────────────────────────────────────────────────  │
│  1. Validate justification length (min 10 chars)                 │
│  2. Verify requested permissions exist                           │
│  3. Create TemporaryPermissionGrant:                             │
│       status: PENDING                                             │
│       startAt: now                                                │
│       expiresAt: now + 24 hours                                   │
│       grantedBy: self                                             │
│       approvedBy: null (awaiting approval)                        │
│  4. Notify admins via notification system                        │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Admin Marco receives notification                               │
│  "Maria Verdi requests temporary access to report:export:tenant" │
│  • Justification: "Preparing MUD 2025 for accountant"            │
│  • Duration: 24 hours                                             │
│  • [Approve] [Deny] buttons                                      │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ Admin clicks "Approve"
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  POST /permission/grants/{grantId}/approve                       │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  ApprovePermissionRequestUseCase                                 │
│  ──────────────────────────────────────────────────────────────  │
│  1. Update grant:                                                 │
│       status: ACTIVE                                              │
│       approvedBy: admin.id                                        │
│       approvedAt: now                                             │
│  2. Invalidate user's permission cache                           │
│  3. Notify user: "Permission granted for 24 hours"               │
│  4. Log to audit: "Admin Marco approved temp grant for Maria"    │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Maria receives notification                                     │
│  "Access granted for report:export:tenant"                       │
│  "Expires: 2025-11-01 14:30"                                     │
│                                                                  │
│  Maria can now export MUD report (permission check passes)       │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ 24 hours later...
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Background Job: PermissionExpiryProcessor (runs every 5 min)   │
│  ──────────────────────────────────────────────────────────────  │
│  1. Find grants where expiresAt < now AND isRevoked = false     │
│  2. Update grant:                                                 │
│       status: EXPIRED                                             │
│       isRevoked: true                                             │
│       revokedAt: now                                              │
│  3. Invalidate user's permission cache                           │
│  4. Notify user: "Temporary access expired"                      │
│  5. Notify admin: "Temporary grant for Maria expired"            │
│  6. Log to audit: "System auto-revoked temp grant (expired)"    │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│  Next permission check for Maria                                 │
│  • Cache invalidated → Database query                            │
│  • Temporary grant status = EXPIRED → Not included               │
│  • Permission check: DENY (back to baseline)                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 7. Audit Trail Cryptographic Chain

```
┌──────────────────────────────────────────────────────────────────┐
│  Audit Entry #1 (First entry for tenant)                         │
│  ──────────────────────────────────────────────────────────────  │
│  {                                                                │
│    id: "entry-1",                                                 │
│    tenantId: "tenant-a",                                          │
│    userId: "user-123",                                            │
│    action: "fir:create:facility",                                │
│    decision: "ALLOW",                                             │
│    timestamp: "2025-10-31T10:00:00Z",                             │
│    previousHash: "0000000000000000" (genesis)                    │
│    currentHash: SHA256(entry-1 data + previousHash)              │
│                = "a1b2c3d4..."                                    │
│  }                                                                │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         │ Chain continues...
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Audit Entry #2                                                   │
│  ──────────────────────────────────────────────────────────────  │
│  {                                                                │
│    id: "entry-2",                                                 │
│    tenantId: "tenant-a",                                          │
│    userId: "user-456",                                            │
│    action: "fir:delete:facility",                                │
│    decision: "DENY",                                              │
│    timestamp: "2025-10-31T10:15:00Z",                             │
│    previousHash: "a1b2c3d4..." (from entry-1)                    │
│    currentHash: SHA256(entry-2 data + "a1b2c3d4...")             │
│                = "e5f6g7h8..."                                    │
│  }                                                                │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Audit Entry #3                                                   │
│  ──────────────────────────────────────────────────────────────  │
│  {                                                                │
│    id: "entry-3",                                                 │
│    previousHash: "e5f6g7h8..." (from entry-2)                    │
│    currentHash: SHA256(entry-3 data + "e5f6g7h8...")             │
│                = "i9j0k1l2..."                                    │
│  }                                                                │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
                    ... continues ...


┌──────────────────────────────────────────────────────────────────┐
│  Integrity Verification (during audit query or inspection)       │
│  ──────────────────────────────────────────────────────────────  │
│  1. Fetch all entries for tenant in chronological order          │
│  2. For each entry:                                               │
│       a. Recalculate hash: SHA256(entry data + previousHash)     │
│       b. Compare with stored currentHash                          │
│       c. If mismatch → TAMPERING DETECTED                        │
│  3. Verify chain continuity:                                      │
│       entry[i].currentHash === entry[i+1].previousHash            │
│  4. Report integrity status: VALID or COMPROMISED                │
└──────────────────────────────────────────────────────────────────┘


┌───────────── Tampering Detection Example ────────────────────────┐
│  Attacker attempts to modify Entry #2:                           │
│  • Changes decision from "DENY" to "ALLOW"                        │
│  • Entry #2 currentHash no longer matches recalculated hash      │
│  • Entry #3 previousHash no longer matches Entry #2 currentHash  │
│                                                                  │
│  Result: Chain broken → Audit log marked COMPROMISED             │
│          Security alert triggered                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Legend

```
┌──────────────────┐
│  Process Block   │  ← Processing step or component
└──────────────────┘

→  →  →  →  →  →  →  ← Flow direction

┌──────────────────┐
│  Decision        │  ← Conditional branch point
└─────┬───────┬────┘
      │       │
    YES       NO

[Entity]  ← Database entity
FK        ← Foreign key
PK        ← Primary key
UK        ← Unique key
1:N       ← One-to-many relationship
N:M       ← Many-to-many relationship

TTL       ← Time to live (cache expiration)
HMAC      ← Hash-based message authentication code
RLS       ← Row-level security (PostgreSQL)
ABAC      ← Attribute-based access control
RBAC      ← Role-based access control
```

---

**Document Version**: 1.0
**Last Updated**: 2025-10-31
