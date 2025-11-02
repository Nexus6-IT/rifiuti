# Tasks: Comprehensive Roles and Permissions System

**Input**: Design documents from `/specs/002-roles-permissions-system/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research/, contracts/

**Tests**: TDD is MANDATORY per constitution (100% domain coverage). Tests written FIRST for all domain entities and use cases.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions
- **Backend**: `apps/backend/src/` (NestJS monorepo)
- **Frontend**: `apps/frontend/src/app/` (Angular monorepo)
- **Tests**: `tests/backend/`, `tests/frontend/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure for permissions feature

- [X] T001 Create identity-access bounded context directories: apps/backend/src/domain/identity-access/
- [X] T002 [P] Create application layer directories: apps/backend/src/application/commands/, apps/backend/src/application/queries/
- [X] T003 [P] Create infrastructure directories: apps/backend/src/infrastructure/persistence/, apps/backend/src/infrastructure/cache/
- [X] T004 [P] Create API layer directories: apps/backend/src/api/permissions/
- [X] T005 [P] Create frontend feature directories: apps/frontend/src/app/features/permissions/pages/, apps/frontend/src/app/features/permissions/components/
- [X] T006 [P] Create test directories: tests/backend/unit/domain/identity-access/, tests/backend/integration/, tests/frontend/unit/features/permissions/
- [X] T007 Install backend dependencies: @nestjs/bull, bullmq, ioredis (if not already present per plan.md)
- [X] T008 [P] Install frontend dependencies: @ngrx/signals (if not already present per plan.md)
- [X] T009 [P] Configure ESLint rules for identity-access bounded context in .eslintrc.json
- [X] T010 [P] Update .gitignore with node_modules/, dist/, .env*, *.log per plan.md tech stack

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Database & Migrations

- [X] T011 Create Prisma migration for 10 new models per plan.md data model section: apps/backend/src/infrastructure/persistence/prisma/migrations/
- [X] T012 Add Role model to schema.prisma with fields: id, tenantId, name, description, isSystemRole, createdAt, updatedAt, createdBy
- [X] T013 [P] Add Permission model to schema.prisma with fields: id, resource, action, scope, description, isSensitive, module
- [X] T014 [P] Add UserRole model to schema.prisma with fields: id, userId, roleId, tenantId, assignedBy, assignedAt, expiresAt, facilityIds[], isDelegated, delegationReason
- [X] T015 [P] Add PermissionPolicy model to schema.prisma with fields: id, permissionId, policyName, policyDefinition, evaluationOrder, isActive, version
- [X] T016 [P] Add PermissionAuditLog model to schema.prisma with fields: id, tenantId, userId, spidFiscalCode, actionAttempted, resourceType, resourceId, decision, evaluatedPolicies, contextAttributes, timestamp, sessionId, previousEntryHash, currentHash
- [X] T017 [P] Add RoleChangeHistory model to schema.prisma with fields: id, tenantId, entityType, entityId, changeType, changedBy, oldValue, newValue, reason, timestamp
- [X] T018 [P] Add ResourceOwnership model to schema.prisma with fields: id, resourceType, resourceId, ownerUserId, facilityId, createdAt
- [X] T019 [P] Add TemporaryPermissionGrant model to schema.prisma with fields: id, userId, tenantId, permissions[], startTime, endTime, grantedBy, businessJustification, autoRevoked, revokedAt
- [X] T020 [P] Add ConsultantTenantAssociation model to schema.prisma with fields: id, consultantUserId, tenantId, roleId, addedBy, addedAt, expiresAt, isActive
- [X] T021 [P] Add PermissionRequest model to schema.prisma with fields: id, userId, tenantId, requestedRoleId, requestedPermissions[], businessJustification, duration, status, reviewedBy, reviewedAt, denialReason, createdAt
- [X] T022 Add RolePermission junction table to schema.prisma with fields: roleId, permissionId, grantedAt, grantedBy
- [X] T023 Add indexes to all models per plan.md: @@index([tenantId, isSystemRole]), @@index([userId, tenantId, expiresAt]), etc.
- [X] T024 Add RLS policies to schema.prisma per plan.md multi-tenancy section
- [X] T025 Run Prisma migration: npx prisma migrate dev --name add-permissions-system
- [X] T026 Create seed script for default permissions (50 permissions across 8 modules): apps/backend/src/infrastructure/persistence/prisma/seeds/permissions.seed.ts
- [X] T027 Create seed script for default roles (5 system roles): apps/backend/src/infrastructure/persistence/prisma/seeds/roles.seed.ts
- [X] T028 Run seed scripts: npx prisma db seed

### Caching Infrastructure

- [X] T029 Create Redis connection configuration in apps/backend/src/infrastructure/cache/redis.config.ts with cluster support per plan.md
- [X] T030 Implement permission cache service in apps/backend/src/infrastructure/cache/permission-cache.service.ts with HMAC signing per plan.md security
- [X] T031 [P] Implement role cache service in apps/backend/src/infrastructure/cache/role-cache.service.ts
- [X] T032 [P] Implement Redis pub/sub service for cache invalidation in apps/backend/src/infrastructure/cache/redis-pub-sub.service.ts
- [X] T033 Configure Redis namespaces per tenant in permission-cache.service.ts

### Background Jobs (BullMQ)

- [X] T034 Configure BullMQ queues in apps/backend/src/infrastructure/jobs/queues.config.ts: permission-expiration, audit-archival, cache-warming
- [X] T035 [P] Implement expire-temp-permissions job in apps/backend/src/infrastructure/jobs/expire-temp-permissions.job.ts (runs every 5 minutes per plan.md)
- [X] T036 [P] Implement archive-audit-logs job in apps/backend/src/infrastructure/jobs/archive-audit-logs.job.ts (monthly partitioning per plan.md)
- [X] T037 [P] Implement warm-permission-cache job in apps/backend/src/infrastructure/jobs/warm-permission-cache.job.ts

### Base Guards & Decorators

- [X] T038 Implement @RequirePermission decorator in apps/backend/src/api/decorators/require-permission.decorator.ts with format: resource:action:scope
- [X] T039 [P] Implement @CurrentTenant decorator in apps/backend/src/api/decorators/current-tenant.decorator.ts
- [X] T040 [P] Implement @AuditAction decorator in apps/backend/src/api/decorators/audit-action.decorator.ts
- [X] T041 Implement PermissionGuard in apps/backend/src/api/guards/permission.guard.ts with cache lookup and ABAC policy evaluation per plan.md
- [X] T042 [P] Implement TenantIsolationGuard in apps/backend/src/api/guards/tenant-isolation.guard.ts with JWT validation per plan.md
- [X] T043 [P] Implement SpidStepUpGuard in apps/backend/src/api/guards/spid-step-up.guard.ts for <15 minute re-auth per spec.md FR-027: tracks last SPID login timestamp, triggers re-auth modal for high-risk operations (delete FIR, approve user, digital signature)
- [X] T043.1 [P] Create SpidReauthInterceptor in apps/backend/src/api/interceptors/spid-reauth.interceptor.ts to check SPID session freshness on protected endpoints
- [X] T043.2 Integration test for SPID re-auth flow in tests/backend/integration/spid-reauth.integration.spec.ts: verify re-auth required after 15 minutes, verify high-risk operations blocked without fresh SPID session per spec.md FR-027
- [X] T043.3 [P] Create spid-reauth-modal frontend component in apps/frontend/src/app/features/auth/components/spid-reauth-modal/spid-reauth-modal.component.ts: modal dialog triggered when backend returns 428 Precondition Required status with SPID re-authentication challenge

### Frontend State Management

- [X] T044 Create PermissionStore (NgRx SignalStore) in apps/frontend/src/app/core/state/permission.store.ts per plan.md
- [X] T045 [P] Create RoleStore (NgRx SignalStore) in apps/frontend/src/app/core/state/role.store.ts
- [X] T046 [P] Create TempPermissionStore (NgRx SignalStore) in apps/frontend/src/app/core/state/temp-permission.store.ts
- [X] T047 Create hasPermission structural directive in apps/frontend/src/app/features/permissions/directives/has-permission.directive.ts
- [X] T048 [P] Create requirePermission attribute directive in apps/frontend/src/app/features/permissions/directives/require-permission.directive.ts
- [X] T049 [P] Create permissionTooltip directive in apps/frontend/src/app/features/permissions/directives/permission-tooltip.directive.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Company Administrator Assigns Roles to Team Members (Priority: P1) 🎯 MVP

**Goal**: Enable tenant admins to invite users with specific roles (Admin, Operator, Viewer) and enforce role-based access control

**Independent Test**: Create test tenant, invite users with different roles, verify each role has appropriate access (Admin can manage users, Operator can create FIRs, Viewer is read-only)

### Tests for User Story 1 (TDD MANDATORY) ⚠️

**NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T050 [P] [US1] Unit test for Role entity in tests/backend/unit/domain/identity-access/role.entity.spec.ts: test business rules (cannot delete system role, name uniqueness per tenant)
- [X] T051 [P] [US1] Unit test for Permission entity in tests/backend/unit/domain/identity-access/permission.entity.spec.ts: test format validation (resource:action:scope)
- [X] T052 [P] [US1] Unit test for UserRole entity in tests/backend/unit/domain/identity-access/user-role.entity.spec.ts: test expiration logic, facility scoping
- [X] T053 [P] [US1] Unit test for AssignRoleCommand handler in tests/backend/unit/application/commands/assign-role.handler.spec.ts: test last admin protection, audit logging
- [X] T054 [P] [US1] Unit test for GetUserPermissionsQuery handler in tests/backend/unit/application/queries/get-user-permissions.handler.spec.ts: test permission union from multiple roles
- [X] T055 [P] [US1] Integration test for role assignment in tests/backend/integration/role-assignment.integration.spec.ts: test full flow from API to database with cache invalidation
- [X] T056 [P] [US1] Integration test for multi-tenant isolation in tests/backend/integration/multi-tenant-isolation.integration.spec.ts: verify zero cross-tenant leakage per plan.md security

### Domain Entities for User Story 1

- [X] T057 [P] [US1] Create Role domain entity in apps/backend/src/domain/identity-access/role.entity.ts with business rules from tests T050
- [X] T058 [P] [US1] Create Permission domain entity in apps/backend/src/domain/identity-access/permission.entity.ts with business rules from tests T051
- [X] T059 [P] [US1] Create UserRole domain entity in apps/backend/src/domain/identity-access/user-role.entity.ts with business rules from tests T052
- [X] T060 [P] [US1] Create PermissionScope value object in apps/backend/src/domain/identity-access/value-objects/permission-scope.vo.ts
- [X] T061 [P] [US1] Create TenantContext value object in apps/backend/src/domain/identity-access/value-objects/tenant-context.vo.ts
- [X] T062 [P] [US1] Create UserRoleAssignedEvent domain event in apps/backend/src/domain/events/user-role-assigned.event.ts
- [X] T063 [P] [US1] Create PermissionGrantedEvent domain event in apps/backend/src/domain/events/permission-granted.event.ts

### Application Layer for User Story 1

- [X] T064 [US1] Implement RoleRepository interface in apps/backend/src/domain/identity-access/role.repository.interface.ts
- [X] T065 [P] [US1] Implement PermissionRepository interface in apps/backend/src/domain/identity-access/permission.repository.interface.ts
- [X] T066 [P] [US1] Implement UserRoleRepository interface in apps/backend/src/domain/identity-access/user-role.repository.interface.ts
- [X] T067 [US1] Implement RoleRepository (Prisma) in apps/backend/src/infrastructure/persistence/role.repository.ts with tenant filtering and caching
- [X] T068 [P] [US1] Implement PermissionRepository (Prisma) in apps/backend/src/infrastructure/persistence/permission.repository.ts
- [X] T069 [P] [US1] Implement UserRoleRepository (Prisma) in apps/backend/src/infrastructure/persistence/user-role.repository.ts
- [X] T070 [US1] Implement AssignRoleCommand in apps/backend/src/application/commands/assign-role.command.ts with validation per tests T053
- [X] T071 [US1] Implement AssignRoleCommandHandler in apps/backend/src/application/commands/handlers/assign-role.handler.ts (depends on T064-T069)
- [X] T072 [P] [US1] Implement RevokeRoleCommand in apps/backend/src/application/commands/revoke-role.command.ts
- [X] T073 [P] [US1] Implement RevokeRoleCommandHandler in apps/backend/src/application/commands/handlers/revoke-role.handler.ts
- [X] T074 [US1] Implement GetUserPermissionsQuery in apps/backend/src/application/queries/get-user-permissions.query.ts per tests T054
- [X] T075 [US1] Implement GetUserPermissionsQueryHandler in apps/backend/src/application/queries/handlers/get-user-permissions.handler.ts with cache integration

### API Layer for User Story 1

- [X] T076 [US1] Implement POST /api/v1/user-roles/assign endpoint in apps/backend/src/api/permissions/user-role.controller.ts with @RequirePermission('user:manage')
- [X] T077 [P] [US1] Implement DELETE /api/v1/user-roles/:id endpoint in apps/backend/src/api/permissions/user-role.controller.ts
- [X] T078 [P] [US1] Implement GET /api/v1/user-roles/user/:userId endpoint in apps/backend/src/api/permissions/user-role.controller.ts
- [X] T079 [P] [US1] Implement GET /api/v1/permissions/my-permissions endpoint in apps/backend/src/api/permissions/permission.controller.ts
- [X] T080 [US1] Implement GET /api/v1/roles endpoint in apps/backend/src/api/permissions/role.controller.ts (list system + custom roles for tenant)
- [X] T081 [P] [US1] Implement GET /api/v1/roles/:id endpoint in apps/backend/src/api/permissions/role.controller.ts
- [X] T082 [US1] Add PermissionGuard to existing FIR controllers per plan.md integration section (verify permission checks work on existing endpoints)
- [X] T083 [US1] Add error handling for permission denials in apps/backend/src/api/filters/permission-exception.filter.ts with contextual messages per spec.md FR-009

### Frontend for User Story 1

- [X] T084 [P] [US1] Create role-management page component in apps/frontend/src/app/features/permissions/pages/role-management/role-management.component.ts
- [X] T085 [P] [US1] Create user-role-assignment page component in apps/frontend/src/app/features/permissions/pages/user-role-assignment/user-role-assignment.component.ts (full PrimeNG implementation with DataTable, dialogs, and toast notifications)
- [X] T086 [P] [US1] Create permission-discovery page component in apps/frontend/src/app/features/permissions/pages/permission-discovery/permission-discovery.component.ts (My Permissions view per spec.md)
- [X] T087 [P] [US1] Create role-card presentational component in apps/frontend/src/app/features/permissions/components/role-card/role-card.component.ts with PrimeNG Card (full implementation with visual indicators, stats, and actions)
- [X] T088 [P] [US1] Create permission-badge component in apps/frontend/src/app/features/permissions/components/permission-badge/permission-badge.component.ts (visual indicator: ✓ allowed, ○ view-only, ✗ denied with auto-detection via PermissionStore)
- [X] T089 [US1] Implement permission-api.service.ts in apps/frontend/src/app/features/permissions/services/permission-api.service.ts with API calls to backend endpoints
- [X] T090 [P] [US1] Implement role-api.service.ts in apps/frontend/src/app/features/permissions/services/role-api.service.ts
- [X] T091 [US1] Connect PermissionStore to permission-api.service in apps/frontend/src/app/core/state/permission.store.ts (load on login, cache with 5-minute TTL per plan.md)
- [X] T092 [P] [US1] Connect RoleStore to role-api.service in apps/frontend/src/app/core/state/role.store.ts
- [X] T093 [US1] Add *appHasPermission directive usage to existing FIR components (show/hide UI elements based on permissions per plan.md integration)
- [X] T094 [US1] Style permission denied error page in apps/frontend/src/app/features/permissions/pages/permission-denied/permission-denied.component.ts per research UX requirements (full implementation with gradient design, detailed error info, and action buttons)

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently. Admin can assign roles, users see appropriate UI, permission checks enforce access control.

---

## Phase 4: User Story 2 - Environmental Consultant Manages Multiple Client Tenants (Priority: P1)

**Goal**: Enable consultants to manage 50+ client tenants with seamless context switching and aggregated dashboard

**Independent Test**: Create consultant user associated with 5 test tenants, verify context switching works (<2s per plan.md), see aggregated KPIs, perform actions on behalf of clients with clear audit trails

### Tests for User Story 2 (TDD MANDATORY) ⚠️

- [X] T095 [P] [US2] Unit test for ConsultantTenantAssociation entity in tests/backend/unit/domain/identity-access/consultant-tenant-association.entity.spec.ts
- [X] T096 [P] [US2] Unit test for SwitchTenantContextCommand handler in tests/backend/unit/application/commands/switch-tenant-context.handler.spec.ts: test JWT regeneration, cache invalidation
- [X] T097 [P] [US2] Unit test for GetConsultantTenantsQuery handler in tests/backend/unit/application/queries/get-consultant-tenants.handler.spec.ts
- [X] T098 [P] [US2] Integration test for consultant context switching in tests/backend/integration/consultant-multi-tenant.integration.spec.ts: verify zero cross-tenant data leakage when switching
- [X] T099 [P] [US2] E2E test for consultant workflow in tests/backend/e2e/consultant-workflow.e2e.spec.ts: login, switch tenant, perform action, verify audit trail shows "acting as [role] for [tenant]"

### Domain Entities for User Story 2

- [X] T100 [P] [US2] Create ConsultantTenantAssociation entity in apps/backend/src/domain/identity-access/consultant-tenant-association.entity.ts with business rules from tests T095
- [X] T101 [P] [US2] Create TenantContextSwitchedEvent domain event in apps/backend/src/domain/events/tenant-context-switched.event.ts

### Application Layer for User Story 2

- [X] T102 [US2] Implement ConsultantTenantAssociationRepository interface in apps/backend/src/domain/identity-access/consultant-tenant-association.repository.interface.ts
- [X] T103 [US2] Implement ConsultantTenantAssociationRepository (Prisma) in apps/backend/src/infrastructure/persistence/consultant-tenant-association.repository.ts
- [X] T104 [US2] Implement SwitchTenantContextCommand in apps/backend/src/application/commands/switch-tenant-context.command.ts per tests T096
- [X] T105 [US2] Implement SwitchTenantContextCommandHandler in apps/backend/src/application/commands/handlers/switch-tenant-context.handler.ts (JWT regeneration + cache warming per plan.md <2s target)
- [X] T106 [P] [US2] Implement GetConsultantTenantsQuery in apps/backend/src/application/queries/get-consultant-tenants.query.ts per tests T097
- [X] T107 [P] [US2] Implement GetConsultantTenantsQueryHandler in apps/backend/src/application/queries/handlers/get-consultant-tenants.handler.ts
- [X] T108 [P] [US2] Implement GetAggregatedDashboardQuery in apps/backend/src/application/queries/get-aggregated-dashboard.query.ts (cross-tenant KPIs per spec.md acceptance scenario 2)
- [X] T109 [P] [US2] Implement GetAggregatedDashboardQueryHandler in apps/backend/src/application/queries/handlers/get-aggregated-dashboard.handler.ts with read replica queries per plan.md performance

### API Layer for User Story 2

- [X] T110 [US2] Implement GET /api/v1/consultant/tenants endpoint in apps/backend/src/api/permissions/consultant.controller.ts
- [X] T111 [P] [US2] Implement POST /api/v1/consultant/switch-tenant endpoint in apps/backend/src/api/permissions/consultant.controller.ts with JWT generation
- [X] T112 [P] [US2] Implement GET /api/v1/consultant/dashboard endpoint in apps/backend/src/api/permissions/consultant.controller.ts (aggregated KPIs)
- [X] T113 [P] [US2] Implement POST /api/v1/consultant/associate endpoint in apps/backend/src/api/permissions/consultant.controller.ts
- [X] T114 [P] [US2] Implement DELETE /api/v1/consultant/associations/:id endpoint in apps/backend/src/api/permissions/consultant.controller.ts

### Frontend for User Story 2

- [X] T115 [P] [US2] Create consultant-dashboard page component in apps/frontend/src/app/features/permissions/pages/consultant-dashboard/consultant-dashboard.component.ts
- [X] T116 [P] [US2] Create tenant-selector component in apps/frontend/src/app/features/permissions/components/tenant-selector/tenant-selector.component.ts (header dropdown per spec.md acceptance scenario 1)
- [X] T117 [US2] Implement tenant-switch.service.ts in apps/frontend/src/app/features/permissions/services/tenant-switch.service.ts with JWT refresh and state update
- [X] T118 [US2] Update PermissionStore to handle tenant context switch (invalidate cache, reload permissions for new tenant)
- [X] T119 [US2] Add tenant-selector to app header in apps/frontend/src/app/core/layout/header/header.component.ts (visible only for consultants)
- [X] T120 [US2] Create aggregated KPI widgets in consultant-dashboard component: pending FIRs by client, MUD deadlines, RENTRI sync failures per spec.md acceptance scenario 2
- [X] T121 [US2] Style tenant selector with role badge per UX requirements in research/angular-frontend-architecture.md

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently. Consultants can switch contexts, see aggregated data, perform actions with audit trail clarity.

---

## Phase 5: User Story 3 - Field Operator Discovers Permission Boundaries (Priority: P1)

**Goal**: Mobile-first permission discovery with clear visual indicators and helpful error messages

**Independent Test**: Test on mobile device, log in as OPERATOR, attempt various actions (create FIR allowed, delete denied), verify clear visual indicators and contextual error messages per spec.md acceptance scenarios

### Tests for User Story 3 (TDD MANDATORY) ⚠️

- [X] T122 [P] [US3] Unit test for permission-format.pipe in tests/frontend/unit/features/permissions/pipes/permission-format.pipe.spec.ts
- [X] T123 [P] [US3] Unit test for hasPermission directive in tests/frontend/unit/features/permissions/directives/has-permission.directive.spec.ts
- [X] T124 [P] [US3] E2E test for mobile permission discovery in tests/frontend/e2e/cypress/permissions/mobile-permission-discovery.cy.ts: verify touch targets 56px per plan.md

### Frontend for User Story 3

- [X] T125 [P] [US3] Create permission-format.pipe.ts in apps/frontend/src/app/features/permissions/pipes/permission-format.pipe.ts (format "fir:create:facility" → "Create FIRs for assigned facilities")
- [X] T126 [P] [US3] Create role-description.pipe.ts in apps/frontend/src/app/features/permissions/pipes/role-description.pipe.ts
- [X] T127 [US3] Enhance permission-discovery page with mobile-responsive layout using Angular CDK BreakpointObserver per plan.md: desktop=grid, mobile=accordion
- [X] T128 [US3] Add visual permission state indicators to permission-badge component: ✓ allowed (green), ○ view-only (blue), ✗ denied (gray) with icons per research UX requirements
- [X] T129 [US3] Implement permission-tooltip directive logic to show contextual help on disabled buttons per spec.md acceptance scenario 2
- [X] T130 [US3] Style permission denied error page with mobile-first layout: full-screen takeover, 56px touch targets, haptic feedback per plan.md mobile-first requirements
- [X] T131 [US3] Add "Request Access" button to permission denied page connected to request workflow (US7 integration point)
- [X] T132 [US3] Test 56px touch targets on role cards and permission matrix on mobile devices per plan.md

### Mobile Offline Support for User Story 3 (spec.md FR-040-042)

- [X] T132.1 [P] [US3] Create OfflinePermissionStore in apps/frontend/src/app/core/state/offline-permission.store.ts with IndexedDB persistence for 24-hour local cache per spec.md FR-040
- [X] T132.2 [P] [US3] Implement ConnectionMonitorService in apps/frontend/src/app/core/services/connection-monitor.service.ts to detect online/offline state changes and trigger sync
- [X] T132.3 [US3] Implement PermissionSyncQueue in apps/frontend/src/app/core/services/permission-sync-queue.service.ts to queue permission changes made offline and sync on reconnect per spec.md FR-042
- [X] T132.4 [US3] Create offline-indicator component in apps/frontend/src/app/core/layout/offline-indicator/offline-indicator.component.ts showing "Last synced" timestamp per spec.md FR-040
- [X] T132.5 [US3] Implement high-risk operation blocker in OfflineHighRiskGuard: block sensitive actions (delete FIR, approve user, digital signature) when offline with clear "Requires internet connection" message per spec.md FR-041
- [X] T132.6 Integration test for offline permission flow in tests/frontend/e2e/cypress/permissions/offline-permissions.cy.ts: verify permissions work offline for 24 hours, verify high-risk operations blocked, verify sync on reconnect

**Checkpoint**: All P1 user stories (1, 2, 3) should now be independently functional. MVP is complete! Can deploy/demo at this point.

---

## Phase 6: User Story 4 - Compliance Officer Reviews Permission Audit Trail (Priority: P2)

**Goal**: Generate immutable audit reports for ARPA inspections with 10-year retention

**Independent Test**: Create scenario with multiple users performing actions, generate audit report for specific FIR or time range, verify report includes all required elements per spec.md acceptance scenarios (user, action, timestamp, SPID fiscal code, decision)

### Tests for User Story 4 (TDD MANDATORY) ⚠️

- [X] T133 [P] [US4] Unit test for PermissionAuditLog entity in tests/backend/unit/domain/identity-access/permission-audit-log.entity.spec.ts: test cryptographic chaining (SHA-256 hash validation per plan.md)
- [X] T134 [P] [US4] Unit test for RoleChangeHistory entity in tests/backend/unit/domain/identity-access/role-change-history.entity.spec.ts
- [X] T135 [P] [US4] Unit test for GetAuditTrailQuery handler in tests/backend/unit/application/queries/get-audit-trail.handler.spec.ts
- [X] T136 [P] [US4] Integration test for audit log cryptographic chain in tests/backend/integration/audit-log-integrity.integration.spec.ts: verify chain validation detects tampering

### Domain Entities for User Story 4

- [X] T137 [P] [US4] Create PermissionAuditLog entity in apps/backend/src/domain/identity-access/permission-audit-log.entity.ts with cryptographic chaining logic per tests T133
- [X] T138 [P] [US4] Create RoleChangeHistory entity in apps/backend/src/domain/identity-access/role-change-history.entity.ts per tests T134
- [X] T139 [P] [US4] Create AuditMetadata value object in apps/backend/src/domain/identity-access/value-objects/audit-metadata.vo.ts

### Application Layer for User Story 4

- [X] T140 [US4] Implement PermissionAuditLogRepository interface in apps/backend/src/domain/identity-access/permission-audit-log.repository.interface.ts
- [X] T141 [P] [US4] Implement RoleChangeHistoryRepository interface in apps/backend/src/domain/identity-access/role-change-history.repository.interface.ts
- [X] T142 [US4] Implement PermissionAuditLogRepository (Prisma) in apps/backend/src/infrastructure/persistence/permission-audit-log.repository.ts with monthly partitioning per plan.md
- [X] T143 [P] [US4] Implement RoleChangeHistoryRepository (Prisma) in apps/backend/src/infrastructure/persistence/role-change-history.repository.ts
- [X] T144 [US4] Implement GetAuditTrailQuery in apps/backend/src/application/queries/get-audit-trail.query.ts with filtering per tests T135
- [X] T145 [US4] Implement GetAuditTrailQueryHandler in apps/backend/src/application/queries/handlers/get-audit-trail.handler.ts with indexed queries per plan.md <500ms P95
- [X] T146 [P] [US4] Implement ReconstructHistoricalPermissionsQuery in apps/backend/src/application/queries/reconstruct-historical-permissions.query.ts per spec.md acceptance scenario 5
- [X] T147 [P] [US4] Implement ReconstructHistoricalPermissionsQueryHandler in apps/backend/src/application/queries/handlers/reconstruct-historical-permissions.handler.ts
- [X] T148 [US4] Update AssignRoleCommandHandler (T071) to log audit events asynchronously via BullMQ per plan.md <1ms overhead
- [X] T149 [US4] Update PermissionGuard (T041) to log all permission checks (granted AND denied) to audit log per spec.md FR-018

### API Layer for User Story 4

- [X] T150 [US4] Implement GET /api/v1/audit/permissions endpoint in apps/backend/src/api/permissions/audit.controller.ts with pagination and filtering
- [X] T151 [P] [US4] Implement GET /api/v1/audit/permissions/:userId endpoint in apps/backend/src/api/permissions/audit.controller.ts
- [X] T152 [P] [US4] Implement GET /api/v1/audit/permissions/resource/:resourceType/:resourceId endpoint in apps/backend/src/api/permissions/audit.controller.ts
- [X] T153 [P] [US4] Implement GET /api/v1/audit/permissions/export endpoint in apps/backend/src/api/permissions/audit.controller.ts (CSV export for ARPA inspection per spec.md)
- [X] T154 [P] [US4] Implement GET /api/v1/audit/permissions/role-changes endpoint in apps/backend/src/api/permissions/audit.controller.ts
- [X] T155 [P] [US4] Implement POST /api/v1/audit/reconstruct-permissions endpoint in apps/backend/src/api/permissions/audit.controller.ts

### Frontend for User Story 4

- [X] T156 [P] [US4] Create audit-trail-viewer page component in apps/frontend/src/app/features/permissions/pages/audit-trail-viewer/audit-trail-viewer.component.ts
- [X] T157 [P] [US4] Create audit-timeline component in apps/frontend/src/app/features/permissions/components/audit-timeline/audit-timeline.component.ts (chronological display per research UX requirements)
- [X] T158 [P] [US4] Create audit-timestamp.pipe.ts in apps/frontend/src/app/features/permissions/pipes/audit-timestamp.pipe.ts (format with millisecond precision per spec.md FR-018)
- [X] T159 [US4] Implement audit-api.service.ts in apps/frontend/src/app/features/permissions/services/audit-api.service.ts
- [X] T160 [US4] Add filters to audit-trail-viewer: user, date range, decision (ALLOW/DENY), resource type per spec.md acceptance scenario 2
- [X] T161 [US4] Add CSV export button to audit-trail-viewer with download functionality

**Checkpoint**: User Stories 1-4 complete. Audit trail functional for compliance reviews.

---

## Phase 7: User Story 5 - Administrator Creates Custom Role for Enterprise Structure (Priority: P2)

**Goal**: Enable enterprise clients to create custom roles with granular permission matrix

**Independent Test**: Create custom role with specific permissions, assign to user scoped to facility, verify user sees only facility data and has defined permissions per spec.md acceptance scenarios

### Tests for User Story 5 (TDD MANDATORY) ⚠️

- [X] T162 [P] [US5] Unit test for CreateCustomRoleCommand handler in tests/backend/unit/application/commands/create-custom-role.handler.spec.ts: test permission matrix validation
- [X] T163 [P] [US5] Integration test for custom role creation in tests/backend/integration/custom-role.integration.spec.ts: verify cache invalidation when role modified per spec.md acceptance scenario 4

### Application Layer for User Story 5

- [X] T164 [US5] Implement CreateCustomRoleCommand in apps/backend/src/application/commands/create-custom-role.command.ts per tests T162
- [X] T165 [US5] Implement CreateCustomRoleCommandHandler in apps/backend/src/application/commands/handlers/create-custom-role.handler.ts with permission matrix validation
- [X] T166 [P] [US5] Implement UpdateCustomRoleCommand in apps/backend/src/application/commands/update-custom-role.command.ts
- [X] T167 [P] [US5] Implement UpdateCustomRoleCommandHandler in apps/backend/src/application/commands/handlers/update-custom-role.handler.ts with immediate cache invalidation per spec.md acceptance scenario 4
- [X] T168 [P] [US5] Implement DeleteCustomRoleCommand in apps/backend/src/application/commands/delete-custom-role.command.ts
- [X] T169 [P] [US5] Implement DeleteCustomRoleCommandHandler in apps/backend/src/application/commands/handlers/delete-custom-role.handler.ts with protection per spec.md acceptance scenario 5

### API Layer for User Story 5

- [X] T170 [US5] Implement POST /api/v1/roles endpoint in apps/backend/src/api/permissions/role.controller.ts (create custom role, enterprise only per spec.md)
- [X] T171 [P] [US5] Implement PUT /api/v1/roles/:id endpoint in apps/backend/src/api/permissions/role.controller.ts
- [X] T172 [P] [US5] Implement DELETE /api/v1/roles/:id endpoint in apps/backend/src/api/permissions/role.controller.ts
- [X] T173 [P] [US5] Implement POST /api/v1/roles/:id/permissions endpoint in apps/backend/src/api/permissions/role.controller.ts
- [X] T174 [P] [US5] Implement DELETE /api/v1/roles/:id/permissions/:permissionId endpoint in apps/backend/src/api/permissions/role.controller.ts

### Frontend for User Story 5

- [X] T175 [P] [US5] Create custom-role-builder page component in apps/frontend/src/app/features/permissions/pages/custom-role-builder/custom-role-builder.component.ts
- [X] T176 [P] [US5] Create permission-matrix component in apps/frontend/src/app/features/permissions/components/permission-matrix/permission-matrix.component.ts with PrimeNG Table and virtual scrolling per plan.md
- [X] T177 [US5] Implement role-preview component showing granted actions before role assignment per spec.md FR-028
- [X] T178 [US5] Add custom role CRUD methods to role-api.service.ts (createCustomRole, updateCustomRole, deleteCustomRole, addPermissionsToRole, removePermissionFromRole)
- [X] T179 [US5] Add custom role management routes to permissions module routing in app.routes.ts

**Checkpoint**: Custom roles functional for enterprise clients. Can upsell enterprise tier.

---

## Phase 8: User Story 6 - Fleet Manager Automates Task Assignment by Role (Priority: P2)

**Goal**: Automatically route FIR pickup requests to drivers based on certifications, zone, capacity

**Independent Test**: Configure routing rules (hazardous waste requires ADR cert), create test FIR, verify auto-assigns to qualified driver per spec.md acceptance scenarios

### Tests for User Story 6 (TDD MANDATORY) ⚠️

- [X] T180 [P] [US6] Unit test for ResourceOwnership entity in tests/backend/unit/domain/identity-access/resource-ownership.entity.spec.ts
- [X] T181 [P] [US6] Unit test for task assignment routing logic in tests/backend/unit/application/services/task-assignment.service.spec.ts
- [X] T182 [P] [US6] Integration test for task assignment in tests/backend/integration/task-assignment.integration.spec.ts

### Domain Entities for User Story 6

- [X] T183 [P] [US6] Create ResourceOwnership entity in apps/backend/src/domain/identity-access/resource-ownership.entity.ts per tests T180

### Application Layer for User Story 6

- [X] T184 [US6] Implement ResourceOwnershipRepository interface in apps/backend/src/domain/identity-access/resource-ownership.repository.interface.ts
- [X] T185 [US6] Implement ResourceOwnershipRepository (Prisma) in apps/backend/src/infrastructure/persistence/prisma-resource-ownership.repository.ts
- [X] T186 [US6] Implement task assignment routing service in apps/backend/src/application/services/task-assignment.service.ts with rule engine per spec.md FR-029-032
- [X] T187 [US6] Create AssignTaskCommand in apps/backend/src/application/commands/assign-task.command.ts
- [X] T188 [US6] Create AssignTaskCommandHandler in apps/backend/src/application/commands/handlers/assign-task.handler.ts with routing logic
- [X] T189 [P] [US6] Create ReassignTaskCommand in apps/backend/src/application/commands/reassign-task.command.ts
- [X] T190 [P] [US6] Create ReassignTaskCommandHandler in apps/backend/src/application/commands/handlers/reassign-task.handler.ts

### API Layer for User Story 6

- [X] T191 [US6] Implement POST /api/v1/tasks/:firId/assign endpoint in apps/backend/src/api/task-assignment/task-assignment.controller.ts (auto-assignment on FIR creation)
- [X] T192 [P] [US6] Implement PUT /api/v1/tasks/:firId/reassign endpoint in apps/backend/src/api/task-assignment/task-assignment.controller.ts
- [X] T193 [P] [US6] Implement GET /api/v1/tasks/my-assignments endpoint in apps/backend/src/api/task-assignment/task-assignment.controller.ts (driver view filtered by assigned resources per spec.md FR-032)

### Frontend for User Story 6

- [X] T193 [P] [US6] Create my-assignments mobile view in apps/frontend/src/app/features/permissions/pages/my-assignments/my-assignments.component.ts with proximity sorting per spec.md acceptance scenario 2
- [X] T194 [US6] Add API methods to TaskAssignmentApiService (assignTask, reassignTask, getMyAssignments, getQualifiedDrivers) per spec.md FR-032

**Checkpoint**: Task assignment automation functional for transporters.

---

## Phase 9: User Story 7 - User Requests Temporary Permission Elevation (Priority: P3)

**Goal**: Self-service temporary permission requests with admin approval and auto-expiration

**Independent Test**: Log in as OPERATOR, attempt restricted action, submit access request, admin approves with time limit, verify permission granted then auto-revoked per spec.md acceptance scenarios

### Tests for User Story 7 (TDD MANDATORY) ⚠️

- [X] T195 [P] [US7] Unit test for TemporaryPermissionGrant entity in tests/backend/unit/domain/identity-access/temp-permission-grant.entity.spec.ts: test auto-expiration logic ✅ COMPLETED
- [X] T196 [P] [US7] Unit test for PermissionRequest entity in tests/backend/unit/domain/identity-access/permission-request.entity.spec.ts ✅ COMPLETED (Simplified: PermissionRequest logic integrated into TemporaryPermissionGrant entity using status field)
- [X] T197 [P] [US7] Unit test for GrantTempPermissionCommand handler in tests/backend/unit/application/commands/grant-temp-permission.handler.spec.ts ✅ COMPLETED

### Domain Entities for User Story 7

- [X] T198 [P] [US7] Create TemporaryPermissionGrant entity in apps/backend/src/domain/identity-access/temp-permission-grant.entity.ts per tests T195 ✅ COMPLETED
- [X] T199 [P] [US7] Create PermissionRequest entity in apps/backend/src/domain/identity-access/permission-request.entity.ts per tests T196 ✅ COMPLETED (Simplified design: integrated into TemporaryPermissionGrant with status workflow)
- [X] T200 [P] [US7] Create TempPermissionExpiredEvent domain event in apps/backend/src/domain/events/temp-permission-expired.event.ts ✅ COMPLETED

### Application Layer for User Story 7

- [X] T201 [US7] Implement TemporaryPermissionGrantRepository interface in apps/backend/src/domain/identity-access/temp-permission-grant.repository.interface.ts ✅ COMPLETED
- [X] T202 [P] [US7] Implement PermissionRequestRepository interface in apps/backend/src/domain/identity-access/permission-request.repository.interface.ts ✅ COMPLETED (N/A - simplified design)
- [X] T203 [US7] Implement TemporaryPermissionGrantRepository (Prisma) in apps/backend/src/infrastructure/persistence/temp-permission-grant.repository.ts ✅ COMPLETED
- [X] T204 [P] [US7] Implement PermissionRequestRepository (Prisma) in apps/backend/src/infrastructure/persistence/permission-request.repository.ts ✅ COMPLETED (N/A - simplified design)
- [X] T205 [US7] Implement RequestPermissionCommand in apps/backend/src/application/commands/request-permission.command.ts ✅ COMPLETED
- [X] T206 [US7] Implement RequestPermissionCommandHandler in apps/backend/src/application/commands/handlers/request-permission.handler.ts ✅ COMPLETED
- [X] T207 [P] [US7] Implement GrantTempPermissionCommand in apps/backend/src/application/commands/grant-temp-permission.command.ts per tests T197 ✅ COMPLETED
- [X] T208 [P] [US7] Implement GrantTempPermissionCommandHandler in apps/backend/src/application/commands/handlers/grant-temp-permission.handler.ts with notification ✅ COMPLETED
- [X] T209 [P] [US7] Implement DenyPermissionRequestCommand in apps/backend/src/application/commands/deny-permission-request.command.ts ✅ COMPLETED
- [X] T210 [P] [US7] Implement DenyPermissionRequestCommandHandler in apps/backend/src/application/commands/handlers/deny-permission-request.handler.ts ✅ COMPLETED
- [X] T211 [US7] Update expire-temp-permissions job (T035) to check expiry every 5 minutes and auto-revoke per spec.md FR-016 ✅ COMPLETED

### API Layer for User Story 7

- [X] T212 [US7] Implement POST /api/v1/permission-requests endpoint in apps/backend/src/api/permissions/permission-request.controller.ts ✅ COMPLETED
- [X] T213 [P] [US7] Implement GET /api/v1/permission-requests endpoint in apps/backend/src/api/permissions/permission-request.controller.ts (admin view of pending requests) ✅ COMPLETED
- [X] T214 [P] [US7] Implement GET /api/v1/permission-requests/my-requests endpoint in apps/backend/src/api/permissions/permission-request.controller.ts ✅ COMPLETED
- [X] T215 [P] [US7] Implement PUT /api/v1/permission-requests/:id/review endpoint in apps/backend/src/api/permissions/permission-request.controller.ts (approve/deny) ✅ COMPLETED
- [X] T216 [P] [US7] Implement GET /api/v1/temporary-grants endpoint in apps/backend/src/api/permissions/temp-permission.controller.ts ✅ COMPLETED
- [X] T217 [P] [US7] Implement DELETE /api/v1/temporary-grants/:id endpoint in apps/backend/src/api/permissions/temp-permission.controller.ts (early revocation) ✅ COMPLETED

### Frontend for User Story 7

- [X] T218 [P] [US7] Create temp-permission-requests page component in apps/frontend/src/app/features/permissions/pages/temp-permission-requests/temp-permission-requests.component.ts ✅ COMPLETED
- [X] T219 [P] [US7] Create request-access dialog component in apps/frontend/src/app/features/permissions/components/request-access-dialog/request-access-dialog.component.ts (triggered from permission denied page T131) ✅ COMPLETED
- [X] T220 [US7] Add TempPermissionStore integration to request workflow ✅ COMPLETED
- [X] T221 [US7] Add notification display for approval/denial in apps/frontend/src/app/core/layout/notification-panel/notification-panel.component.ts ✅ COMPLETED

**Checkpoint**: All user stories complete! Full feature functional.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories, performance optimization, documentation

- [X] T222 [P] Implement ABAC policy engine for fine-grained permissions in apps/backend/src/application/services/policy-evaluation.service.ts per plan.md Decision 1
- [X] T223 [P] Create PermissionPolicy entity in apps/backend/src/domain/identity-access/permission-policy.entity.ts
- [X] T224 [P] Implement policy evaluators for "own" scope per plan.md (e.g., can edit FIR only if user created it)
- [X] T225 [P] Add performance monitoring metrics to PermissionGuard: permission_check_duration_ms histogram per plan.md observability section
- [X] T226 [P] Add cache hit rate monitoring: permission_cache_hit_rate gauge with >95% target per plan.md
- [X] T227 [P] Create Grafana dashboard JSON for permission system in docs/grafana/permissions-dashboard.json per plan.md monitoring setup
- [X] T228 [P] Configure CloudWatch alarms: p99 > 50ms, cache hit rate < 90%, uptime < 99.9% per plan.md
- [X] T229 [P] Implement anomaly detection in apps/backend/src/application/services/anomaly-detection.service.ts (bulk denials, unusual access patterns per spec.md out-of-scope but mentioned as future)
- [X] T230 [P] Add OpenAPI documentation annotations to all permission endpoints in controller files
- [X] T231 [P] Generate TypeScript client from OpenAPI spec: npx @openapitools/openapi-generator-cli generate -i contracts/openapi.yaml -g typescript-angular -o apps/frontend/src/app/api-client/
- [X] T232 [P] Update CLAUDE.md with new technologies: Role-based access control, Redis caching, BullMQ background jobs per agent context update
- [X] T233 [P] Run accessibility audit with axe-core on permission UI components per plan.md WCAG 2.1 AA requirement
- [X] T234 [P] Run load test with k6: 10,000 concurrent users, verify <10ms P99 authorization per plan.md performance targets
- [X] T235 [P] Run security penetration test with OWASP ZAP: verify zero cross-tenant leakage, cache poisoning prevention per plan.md security
- [X] T236 [P] Document permission format in docs/permissions/permission-format.md: resource:action:scope with examples
- [X] T237 [P] Create quickstart guide for developers in docs/permissions/quickstart.md (already exists in specs/002-roles-permissions-system/quickstart.md, copy to docs/)
- [X] T238 Code cleanup: Remove console.log statements, add TODO comments for future enhancements
- [X] T239 Final E2E test: Complete workflow from admin invite → user login → permission check → audit report per plan.md success criteria

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-9)**: All depend on Foundational phase completion
  - US1, US2, US3 (P1) can proceed in parallel (if staffed) - these are MVP
  - US4, US5, US6 (P2) depend on P1 completion (build on foundation)
  - US7 (P3) depends on US1 (extends basic permission system)
- **Polish (Phase 10)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories (foundation for all)
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Integrates with US1 but independently testable
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Uses US1 permissions but independently testable
- **User Story 4 (P2)**: Depends on US1 (extends audit trail from role assignments)
- **User Story 5 (P2)**: Depends on US1 (builds on role system)
- **User Story 6 (P2)**: Depends on US1 (uses permissions for task routing)
- **User Story 7 (P3)**: Depends on US1 (temporary elevation of existing permissions)

### Within Each User Story

- Tests (TDD MANDATORY) MUST be written and FAIL before implementation
- Domain entities before repositories
- Repositories before use case handlers
- Use case handlers before API controllers
- Backend API before frontend integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (T002-T010)
- All Foundational database models marked [P] can run in parallel (T013-T021)
- All Foundational cache/job tasks marked [P] can run in parallel (T031-T037)
- All Foundational guards/decorators marked [P] can run in parallel (T039-T043, T045-T049)
- Once Foundational phase completes, US1/US2/US3 can start in parallel (if team capacity allows) - these are P1 MVP
- All tests for a user story marked [P] can run in parallel
- Domain entities within a story marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all unit tests for User Story 1 together (TDD - write these first!):
T050: "Unit test for Role entity"
T051: "Unit test for Permission entity"
T052: "Unit test for UserRole entity"
T053: "Unit test for AssignRoleCommand handler"
T054: "Unit test for GetUserPermissionsQuery handler"

# Launch all domain entities for User Story 1 together (after tests fail):
T057: "Create Role domain entity"
T058: "Create Permission domain entity"
T059: "Create UserRole domain entity"
T060: "Create PermissionScope value object"
T061: "Create TenantContext value object"

# Sequential: repositories depend on entities (T064-T066 interfaces, then T067-T069 implementations)
# Sequential: handlers depend on repositories (T070-T075)
# Sequential: controllers depend on handlers (T076-T083)
# Parallel: frontend components can start once API endpoints exist (T084-T088)
```

---

## Implementation Strategy

### MVP First (User Stories 1, 2, 3 Only) 🎯

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (role assignment)
4. Complete Phase 4: User Story 2 (consultant multi-tenant)
5. Complete Phase 5: User Story 3 (mobile UX)
6. **STOP and VALIDATE**: Test all P1 stories independently
7. Deploy/demo MVP

**Estimated Effort**: 6 weeks (Phases 1-5), 2 backend + 1 frontend developer

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready (Weeks 1-2)
2. Add User Story 1 → Test independently → Deploy/Demo (Week 3)
3. Add User Story 2 → Test independently → Deploy/Demo (Week 4)
4. Add User Story 3 → Test independently → Deploy/Demo (Week 5)
5. Add User Story 4 → Test independently → Deploy/Demo (Week 6)
6. Add User Story 5 → Test independently → Deploy/Demo (Week 7)
7. Add User Story 6 → Test independently → Deploy/Demo (Week 8)
8. Add User Story 7 → Test independently → Deploy/Demo (Week 9)
9. Polish & optimize → Final release (Week 10)

### Parallel Team Strategy

With multiple developers (2 backend + 1 frontend per plan.md):

1. Team completes Setup + Foundational together (Weeks 1-2)
2. Once Foundational is done:
   - Backend Dev A: User Story 1 domain + application layers
   - Backend Dev B: User Story 2 domain + application layers
   - Frontend Dev: Setup frontend foundation (stores, directives)
3. Week 3-4:
   - Backend Dev A: US1 API + integration with frontend
   - Backend Dev B: US2 API + integration with frontend
   - Frontend Dev: US1 + US2 UI components
4. Week 5:
   - All devs: US3 (mobile UX) together (frontend-heavy)
5. Weeks 6-9: P2 and P3 stories in sequence
6. Week 10: Polish

---

## Notes

- [P] tasks = different files, no dependencies - can run in parallel
- [Story] label (US1, US2, etc.) maps task to specific user story for traceability
- Each user story should be independently completable and testable per plan.md MVP-first approach
- TDD is MANDATORY per constitution: tests must FAIL before implementation
- Run tests after each task group: npm test (backend), ng test (frontend)
- Verify cache invalidation works after permission changes (T033, T118)
- Commit after each completed user story checkpoint
- Stop at any checkpoint to validate story independently per plan.md progressive enhancement
- Performance target: <10ms P99 authorization checks per plan.md - verify with k6 load test (T234)
- Security target: Zero cross-tenant leakage per plan.md - verify with integration tests (T056, T098)
- Accessibility target: WCAG 2.1 AA per plan.md - verify with axe-core audit (T233)

## Summary

- **Total Tasks**: 239
- **MVP Tasks** (P1 - US1, US2, US3): T001-T132 (132 tasks, ~6 weeks)
- **Full Feature Tasks** (P1 + P2 + P3): T001-T221 (221 tasks, ~10 weeks)
- **Polish Tasks**: T222-T239 (18 tasks, ~2 weeks)
- **Parallel Opportunities**: 89 tasks marked [P] - can execute concurrently with proper team coordination
- **TDD Tests**: 26 test task groups (T050-T055, T095-T099, T122-T124, T133-T136, T162-T163, T180-T181, T195-T197)
- **Estimated Effort**: 12 weeks total (MVP in 6 weeks) with 2-3 developers per plan.md

**Constitution Compliance**:
- ✅ TDD: All domain entities and use cases have tests written FIRST (100% coverage target)
- ✅ DDD: Clear bounded context (IdentityAndAccess), aggregates, value objects, domain events
- ✅ Multi-Tenancy: Schema-per-tenant, RLS, cache isolation enforced throughout
- ✅ Mobile-First: 56px touch targets, responsive layouts, offline caching
- ✅ Performance: <10ms P99 authorization, >95% cache hit rate targets
- ✅ Observability: Structured logging, metrics, Grafana dashboards
