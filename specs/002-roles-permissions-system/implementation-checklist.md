# Implementation Checklist: Roles and Permissions System

**Feature**: 002-roles-permissions-system
**Date**: 2025-10-31
**Estimated Duration**: 4-6 weeks (2 developers, TDD approach)

---

## Phase 1: Foundation (Week 1)

### Database Schema

- [ ] **1.1** Extend `prisma/schema.prisma` with 10 new models
  - [ ] Role
  - [ ] Permission
  - [ ] UserRole
  - [ ] RolePermission
  - [ ] PermissionPolicy
  - [ ] PermissionAuditLog
  - [ ] RoleChangeHistory
  - [ ] ResourceOwnership
  - [ ] TemporaryPermissionGrant
  - [ ] ConsultantTenantAssociation

- [ ] **1.2** Add indexes for performance (15 key indexes identified)
  - [ ] `user_roles(userId, tenantId)` - Permission lookup
  - [ ] `user_roles(expiresAt, isExpired)` - Expiry checks
  - [ ] `permission_audit_logs(tenantId, createdAt)` - Audit queries
  - [ ] All other indexes from architecture.md

- [ ] **1.3** Generate Prisma migration
  ```bash
  npx prisma migrate dev --name add_permission_system
  ```

- [ ] **1.4** Create seed data script (`prisma/seeds/permission-seeder.ts`)
  - [ ] Define 6 system roles (system_admin, compliance_officer, etc.)
  - [ ] Define 50+ atomic permissions (fir:create:own, fir:read:facility, etc.)
  - [ ] Assign permissions to system roles
  - [ ] Verify seed script is idempotent (can run multiple times)

- [ ] **1.5** Run seed script
  ```bash
  npx prisma db seed
  ```

- [ ] **1.6** Verify database schema
  - [ ] All tables created with correct columns
  - [ ] All indexes present (check with `EXPLAIN ANALYZE`)
  - [ ] RLS policies created and enabled
  - [ ] Seed data inserted (6 roles, 50+ permissions)

**Deliverables**:
- Migration file: `prisma/migrations/YYYYMMDDHHMMSS_add_permission_system/migration.sql`
- Seed script: `prisma/seeds/permission-seeder.ts`
- Schema validation report

---

## Phase 2: Domain Layer (Week 1-2)

### Domain Entities (TDD - 100% coverage required)

- [ ] **2.1** Create domain entities (`apps/backend/src/domain/permission/entities/`)
  - [ ] `role.entity.ts` - Role aggregate root
    - [ ] Properties: id, slug, name, isSystemRole, isActive
    - [ ] Methods: `canBeDeleted()`, `hasPermission()`, `addPermission()`
    - [ ] Tests: 15+ test cases

  - [ ] `permission.entity.ts` - Permission entity
    - [ ] Properties: permissionKey, resource, action, scope, sensitivity
    - [ ] Methods: `matchesScope()`, `requiresStepUp()`
    - [ ] Tests: 10+ test cases

  - [ ] `user-role.entity.ts` - UserRole junction entity
    - [ ] Properties: userId, roleId, tenantId, expiresAt, facilityIds
    - [ ] Methods: `isExpired()`, `hasFacilityAccess()`, `canBeRevoked()`
    - [ ] Tests: 12+ test cases

  - [ ] `permission-policy.entity.ts` - ABAC policy entity
    - [ ] Properties: policyRules, effect, evaluationOrder
    - [ ] Methods: `isActive()`, `validateRules()`, `getRollbackVersion()`
    - [ ] Tests: 8+ test cases

- [ ] **2.2** Create value objects (`apps/backend/src/domain/permission/value-objects/`)
  - [ ] `permission-scope.vo.ts` - Scope enum (own, facility, tenant, all)
  - [ ] `policy-rule.vo.ts` - ABAC rule structure
  - [ ] `permission-grant.vo.ts` - Temporary grant details
  - [ ] `tenant-context.vo.ts` - Multi-tenant context
  - [ ] Tests: 20+ test cases across all VOs

- [ ] **2.3** Create repository interfaces (`apps/backend/src/domain/permission/repositories/`)
  - [ ] `role.repository.ts` - Role operations interface
  - [ ] `permission.repository.ts` - Permission operations interface
  - [ ] `audit.repository.ts` - Audit log operations interface
  - [ ] No implementations yet (interfaces only)

- [ ] **2.4** Create domain services (`apps/backend/src/domain/permission/services/`)
  - [ ] `permission-evaluation.service.ts` - Core evaluation logic
    - [ ] Method: `evaluatePermission(user, permission, context)`
    - [ ] Method: `checkResourceOwnership(user, resource)`
    - [ ] Method: `applyFacilityScope(user, permission)`
    - [ ] Tests: 30+ test cases (critical business logic)

**Deliverables**:
- 8 domain entities with 100% test coverage
- 4 value objects with validation logic
- 3 repository interfaces
- 1 domain service with comprehensive tests
- Test coverage report: `npm run test:cov` (should show 100% for domain layer)

---

## Phase 3: Application Layer (Week 2-3)

### CQRS Commands

- [ ] **3.1** Create commands (`apps/backend/src/application/permission/commands/`)
  - [ ] `assign-role.command.ts` + handler
    - [ ] Validation: User exists, role exists, no duplicate assignment
    - [ ] Business rules: Prevent last admin removal, check facility scope
    - [ ] Audit: Log role assignment
    - [ ] Tests: 15+ scenarios

  - [ ] `create-custom-role.command.ts` + handler
    - [ ] Validation: Unique slug per tenant, valid permissions
    - [ ] Tests: 10+ scenarios

  - [ ] `grant-temporary-permission.command.ts` + handler
    - [ ] Validation: Justification length, valid duration
    - [ ] Tests: 8+ scenarios

  - [ ] `revoke-permission.command.ts` + handler
    - [ ] Tests: 8+ scenarios

  - [ ] `approve-permission-request.command.ts` + handler
    - [ ] Tests: 10+ scenarios

### CQRS Queries

- [ ] **3.2** Create queries (`apps/backend/src/application/permission/queries/`)
  - [ ] `get-user-permissions.query.ts` + handler
    - [ ] Fetch user's effective permissions (roles + temporary grants)
    - [ ] Tests: 12+ scenarios

  - [ ] `get-effective-permissions.query.ts` + handler
    - [ ] Expand roles to permission keys
    - [ ] Apply facility scoping
    - [ ] Tests: 15+ scenarios

  - [ ] `get-permission-audit.query.ts` + handler
    - [ ] Filter by user, resource, time range
    - [ ] Pagination support
    - [ ] Tests: 10+ scenarios

  - [ ] `reconstruct-historical-permissions.query.ts` + handler
    - [ ] Query: "Who could access X at time Y?"
    - [ ] Use RoleChangeHistory to reconstruct state
    - [ ] Tests: 8+ scenarios (complex temporal logic)

### Use Cases

- [ ] **3.3** Create use cases (`apps/backend/src/application/permission/use-cases/`)
  - [ ] `assign-role.use-case.ts`
    - [ ] Orchestrate: Validate, assign, invalidate cache, log
    - [ ] Tests: 20+ integration scenarios

  - [ ] `evaluate-permission.use-case.ts` (CRITICAL)
    - [ ] Check cache → Query DB → Evaluate ABAC → Cache result
    - [ ] Performance: <10ms target (99th percentile)
    - [ ] Tests: 40+ scenarios (cache hit, cache miss, ABAC, ownership)

  - [ ] `request-temporary-access.use-case.ts`
    - [ ] Create grant request, notify admins
    - [ ] Tests: 12+ scenarios

  - [ ] `switch-tenant-context.use-case.ts`
    - [ ] Verify consultant access, load roles, warm cache, generate JWT
    - [ ] Tests: 15+ scenarios (consultant-specific flows)

**Deliverables**:
- 5 commands with handlers (100% coverage)
- 4 queries with handlers (100% coverage)
- 4 use cases (100% coverage)
- Integration tests: Commands → Domain → Repository
- Test execution time: <30s for entire application layer

---

## Phase 4: Infrastructure Layer (Week 3)

### Repositories (Prisma)

- [ ] **4.1** Implement repositories (`apps/backend/src/infrastructure/persistence/repositories/`)
  - [ ] `prisma-role.repository.ts`
    - [ ] Implements domain `RoleRepository` interface
    - [ ] Methods: `findById`, `findBySlug`, `create`, `update`, `delete`
    - [ ] Tests: 15+ scenarios (use in-memory DB for speed)

  - [ ] `prisma-permission.repository.ts`
    - [ ] Methods: `findByKey`, `expandRolePermissions`, `getUserEffectivePermissions`
    - [ ] Optimized query: Single roundtrip with joins
    - [ ] Tests: 12+ scenarios

  - [ ] `prisma-audit.repository.ts`
    - [ ] Methods: `create`, `findByUser`, `findByResource`, `findByTimeRange`
    - [ ] Append-only (no update/delete)
    - [ ] Tests: 10+ scenarios

### Caching Layer

- [ ] **4.2** Implement caching (`apps/backend/src/infrastructure/caching/`)
  - [ ] `permission-cache.service.ts`
    - [ ] Methods: `getCachedPermissions`, `cachePermissions`, `invalidate`
    - [ ] HMAC signing for integrity
    - [ ] Tests: 20+ scenarios (hit, miss, poisoning detection)

  - [ ] `cache-invalidation.service.ts`
    - [ ] Pub/Sub listener for invalidation events
    - [ ] Selective invalidation (user, role, tenant)
    - [ ] Tests: 15+ scenarios

  - [ ] `cache-warming.service.ts`
    - [ ] Proactive cache warming on login
    - [ ] Background warming for high-traffic users
    - [ ] Tests: 10+ scenarios

### Audit System

- [ ] **4.3** Implement audit (`apps/backend/src/infrastructure/audit/`)
  - [ ] `audit-writer.service.ts`
    - [ ] Async writing via BullMQ
    - [ ] Cryptographic chaining
    - [ ] Tests: 12+ scenarios

  - [ ] `audit-archival.service.ts`
    - [ ] Move 3+ year data to cold storage
    - [ ] Scheduled job (daily at 2 AM)
    - [ ] Tests: 8+ scenarios

**Deliverables**:
- 3 Prisma repositories (100% coverage)
- 3 caching services (100% coverage)
- 2 audit services (100% coverage)
- Performance benchmarks: Permission query <20ms, cache hit <5ms
- Redis connection pooling configured

---

## Phase 5: API Layer (Week 4)

### Guards

- [ ] **5.1** Implement guards (`apps/backend/src/api/guards/`)
  - [ ] `permission.guard.ts` (CRITICAL)
    - [ ] Read `@RequirePermission()` metadata
    - [ ] Call `EvaluatePermissionUseCase`
    - [ ] Handle ALLOW/DENY/CONDITIONAL_ALLOW
    - [ ] Async audit logging (non-blocking)
    - [ ] Tests: 30+ scenarios (various permission patterns)

  - [ ] `tenant-isolation.guard.ts`
    - [ ] Extract tenant context
    - [ ] Verify consultant access
    - [ ] Set PostgreSQL RLS variable
    - [ ] Tests: 20+ scenarios

  - [ ] `step-up-auth.guard.ts`
    - [ ] Check last authentication time (Redis)
    - [ ] Require re-auth if >15 minutes
    - [ ] Tests: 10+ scenarios

### Decorators

- [ ] **5.2** Create decorators (`apps/backend/src/api/permission/decorators/`)
  - [ ] `@RequirePermission(key, options?)`
  - [ ] `@RequireAnyPermission(keys[])`
  - [ ] `@RequireAllPermissions(keys[])`
  - [ ] Tests: Decorator metadata extraction

### Controllers

- [ ] **5.3** Create controllers (`apps/backend/src/api/permission/`)
  - [ ] `permission.controller.ts`
    - [ ] `GET /permissions/me` - User's permissions
    - [ ] `POST /permissions/check` - Batch permission check
    - [ ] Tests: 15+ E2E scenarios

  - [ ] `role.controller.ts`
    - [ ] `GET /roles` - List roles
    - [ ] `POST /roles` - Create custom role
    - [ ] `PUT /roles/:id` - Update role
    - [ ] `DELETE /roles/:id` - Delete role
    - [ ] Tests: 20+ E2E scenarios

  - [ ] `audit.controller.ts`
    - [ ] `GET /audit/permissions` - Query audit logs
    - [ ] `GET /audit/reconstruct` - Historical reconstruction
    - [ ] Tests: 12+ E2E scenarios

  - [ ] `user-role.controller.ts`
    - [ ] `POST /users/:id/roles` - Assign role
    - [ ] `DELETE /users/:id/roles/:roleId` - Revoke role
    - [ ] `POST /users/me/request-access` - Request temporary permission
    - [ ] Tests: 18+ E2E scenarios

### DTOs

- [ ] **5.4** Create DTOs (`apps/backend/src/api/permission/dto/`)
  - [ ] `create-role.dto.ts` - Validation with class-validator
  - [ ] `assign-role.dto.ts`
  - [ ] `permission-request.dto.ts`
  - [ ] `audit-query.dto.ts`
  - [ ] Tests: Validation scenarios (invalid inputs)

**Deliverables**:
- 3 guards with comprehensive tests
- 3 custom decorators
- 4 controllers with E2E tests
- 8 DTOs with validation
- OpenAPI/Swagger documentation generated

---

## Phase 6: Policy Engine (Week 4)

### ABAC Evaluators

- [ ] **6.1** Implement policy engine (`apps/backend/src/application/policy/evaluators/`)
  - [ ] `policy-evaluator.ts`
    - [ ] Load policies, evaluate in order, return decision
    - [ ] Tests: 25+ scenarios (various policy combinations)

  - [ ] `attribute-evaluator.ts`
    - [ ] Extract attributes from context (user.*, resource.*, time.*, network.*)
    - [ ] Apply operators (equals, contains, matches_regex, etc.)
    - [ ] Tests: 40+ scenarios (all operators, all attributes)

  - [ ] `facility-scope-evaluator.ts`
    - [ ] Check facility membership
    - [ ] Filter query results by facility scope
    - [ ] Tests: 15+ scenarios

  - [ ] `ownership-evaluator.ts`
    - [ ] Check resource ownership
    - [ ] Handle ownership transfers
    - [ ] Tests: 12+ scenarios

### Policy Rules

- [ ] **6.2** Create sample policies (`apps/backend/src/application/policy/rules/`)
  - [ ] `time-based-rule.ts` - Business hours restriction
  - [ ] `ip-whitelist-rule.ts` - Internal network requirement
  - [ ] `certification-rule.ts` - ADR certification for hazardous waste
  - [ ] Tests: Policy-specific scenarios

**Deliverables**:
- 4 policy evaluators (100% coverage)
- 3 sample policy rules
- Policy JSON schema validation
- Performance benchmark: Policy evaluation <5ms

---

## Phase 7: Integration (Week 5)

### SPID/CIE Integration

- [ ] **7.1** Extend authentication (`apps/backend/src/auth/`)
  - [ ] Modify `spid.strategy.ts`
    - [ ] Load user roles after SPID login
    - [ ] Warm permission cache
    - [ ] Extend JWT payload with roles
    - [ ] Tests: 10+ scenarios

  - [ ] Create `switch-tenant.controller.ts`
    - [ ] `POST /auth/switch-tenant` - Consultant tenant switch
    - [ ] Generate new JWT with updated tenant context
    - [ ] Tests: 12+ scenarios

  - [ ] Create `step-up.controller.ts`
    - [ ] `GET /auth/step-up` - Initiate re-authentication
    - [ ] `GET /auth/step-up/callback` - Handle SPID callback
    - [ ] Tests: 8+ scenarios

### Existing Controller Migration

- [ ] **7.2** Migrate existing controllers to use `@RequirePermission()`
  - [ ] `fir.controller.ts` (20+ endpoints)
    - [ ] Replace `@Roles('ADMIN')` with `@RequirePermission('fir:create:facility')`
    - [ ] Add resource-level checks where applicable
    - [ ] Tests: Verify all endpoints still work

  - [ ] `user.controller.ts` (10+ endpoints)
    - [ ] Apply permission decorators
    - [ ] Tests: Verify access control

  - [ ] `notification.controller.ts` (5+ endpoints)
    - [ ] Apply permission decorators

  - [ ] Other controllers (case-by-case)

### Background Jobs

- [ ] **7.3** Create background jobs (`apps/backend/src/permission/jobs/`)
  - [ ] `permission-expiry.processor.ts`
    - [ ] Check expired grants every 5 minutes
    - [ ] Auto-revoke and notify users
    - [ ] Tests: Expiry scenarios

  - [ ] `cache-warmer.processor.ts`
    - [ ] Warm cache for high-traffic users
    - [ ] Triggered on schedule and login
    - [ ] Tests: Warming effectiveness

  - [ ] `audit-archival.processor.ts`
    - [ ] Move old audit logs to cold storage
    - [ ] Daily at 2 AM
    - [ ] Tests: Archival scenarios

**Deliverables**:
- Extended SPID strategy with permission loading
- Consultant tenant switching endpoint
- 25+ existing endpoints migrated to new permission system
- 3 background jobs configured and tested
- No regressions in existing functionality

---

## Phase 8: Testing & Performance (Week 5-6)

### Load Testing

- [ ] **8.1** Performance benchmarks
  - [ ] Permission check latency: Target <10ms at 99th percentile
    - [ ] Setup: Artillery or k6 load test
    - [ ] Scenario: 10,000 requests/second
    - [ ] Measure: p50, p95, p99 latencies

  - [ ] Cache hit rate: Target >95%
    - [ ] Monitor Redis statistics
    - [ ] Measure: (cache hits / total requests) * 100

  - [ ] Database query time: Target <20ms (cache miss)
    - [ ] Use `EXPLAIN ANALYZE` on critical queries
    - [ ] Optimize slow queries with additional indexes

  - [ ] Audit log write lag: Target <1s at 99th percentile
    - [ ] Measure: Time from request to DB write
    - [ ] Verify BullMQ queue processing time

### Security Testing

- [ ] **8.2** Security audit
  - [ ] Cross-tenant data leakage test
    - [ ] Attempt to access Tenant B data while authenticated to Tenant A
    - [ ] Verify RLS policies block unauthorized access

  - [ ] Cache poisoning test
    - [ ] Attempt to modify cached permissions
    - [ ] Verify HMAC signature detection

  - [ ] Privilege escalation test
    - [ ] Attempt self-assignment of admin role
    - [ ] Verify guard blocks unauthorized role changes

  - [ ] SQL injection test
    - [ ] Test all endpoints with malicious inputs
    - [ ] Verify Prisma parameterization prevents injection

  - [ ] Audit trail integrity test
    - [ ] Verify cryptographic chain validation
    - [ ] Attempt to tamper with audit logs

### Integration Testing

- [ ] **8.3** End-to-end scenarios
  - [ ] User Story 1: Company admin assigns roles
    - [ ] Create tenant, invite users, assign roles, verify access

  - [ ] User Story 2: Consultant manages multiple tenants
    - [ ] Create consultant, associate with 5 tenants, switch contexts

  - [ ] User Story 3: Field operator discovers permissions
    - [ ] Login as operator, attempt restricted actions, verify clear errors

  - [ ] User Story 4: Compliance officer reviews audit
    - [ ] Generate audit report, verify completeness

  - [ ] User Story 5: Admin creates custom role
    - [ ] Create custom role, assign permissions, assign to users

  - [ ] User Story 6: Fleet manager automates assignments
    - [ ] Configure routing rules, create FIR, verify auto-assignment

  - [ ] User Story 7: User requests temporary permission
    - [ ] Request access, admin approves, verify grant, verify expiration

**Deliverables**:
- Load test reports (Artillery/k6 results)
- Performance benchmarks dashboard
- Security audit report (zero critical findings)
- 7 E2E test scenarios passing
- Test coverage: >95% overall, 100% domain layer

---

## Phase 9: Migration & Deployment (Week 6)

### Data Migration

- [ ] **9.1** Migrate existing users to new role system
  - [ ] Create migration script (`scripts/migrate-legacy-roles.ts`)
    - [ ] Map ADMIN → system_admin
    - [ ] Map OPERATOR → waste_operator
    - [ ] Map VIEWER → auditor

  - [ ] Run migration in staging environment
    - [ ] Verify all users assigned correct roles
    - [ ] Verify existing permissions still work

  - [ ] Create rollback script (restore legacy roles if needed)

### Deployment Strategy

- [ ] **9.2** Phased rollout
  - [ ] Phase 1: Internal testing (1 week)
    - [ ] Deploy to staging
    - [ ] Test with internal users
    - [ ] Monitor performance metrics

  - [ ] Phase 2: Beta rollout (1 week)
    - [ ] Deploy to production with feature flag OFF
    - [ ] Enable for 5 pilot tenants
    - [ ] Monitor: permission denial rate, cache hit rate, errors

  - [ ] Phase 3: Full rollout (gradual)
    - [ ] Enable for 25% of tenants
    - [ ] Monitor for 2 days
    - [ ] Enable for 50% of tenants
    - [ ] Monitor for 2 days
    - [ ] Enable for 100% of tenants

### Monitoring & Alerting

- [ ] **9.3** Set up monitoring
  - [ ] Prometheus metrics
    - [ ] `permission_check_latency_ms` (histogram)
    - [ ] `permission_cache_hit_rate` (gauge)
    - [ ] `permission_denied_total` (counter)
    - [ ] `audit_log_write_lag_ms` (histogram)

  - [ ] Grafana dashboards
    - [ ] Permission system overview
    - [ ] Cache performance
    - [ ] Audit log health

  - [ ] Alerting rules
    - [ ] Alert: Cache hit rate <90% for 10 minutes
    - [ ] Alert: Permission check latency >50ms at p99
    - [ ] Alert: Audit log write lag >5s
    - [ ] Alert: Cross-tenant access attempt detected

**Deliverables**:
- Migration scripts (with rollback)
- Feature flag configuration
- Phased rollout plan
- Monitoring dashboards (Grafana)
- Alerting rules (Prometheus Alertmanager)
- Deployment runbook

---

## Phase 10: Documentation & Training (Week 6)

### API Documentation

- [ ] **10.1** Generate OpenAPI/Swagger docs
  - [ ] Document all permission endpoints
  - [ ] Include request/response examples
  - [ ] Add authentication requirements
  - [ ] Publish at `/api/docs`

### Developer Documentation

- [ ] **10.2** Create developer guides
  - [ ] "Adding a new permission" guide
  - [ ] "Creating custom ABAC policies" guide
  - [ ] "Debugging permission denials" guide
  - [ ] "Performance tuning" guide

### User Documentation

- [ ] **10.3** Create user-facing docs
  - [ ] Admin guide: "Managing roles and permissions"
  - [ ] Consultant guide: "Switching between client tenants"
  - [ ] User guide: "Understanding your permissions"
  - [ ] FAQ: Common permission-related questions

### Training Materials

- [ ] **10.4** Create training content
  - [ ] Video: "Introduction to the permission system" (5 min)
  - [ ] Video: "Assigning roles as an admin" (3 min)
  - [ ] Video: "Requesting temporary access" (2 min)
  - [ ] Slides: Permission system overview (15 slides)

**Deliverables**:
- OpenAPI documentation (auto-generated)
- 4 developer guides
- 4 user guides
- 3 training videos
- Training slide deck

---

## Success Criteria Validation

### Technical Performance (SC-007 to SC-012)

- [ ] **Validate**: Permission check latency <10ms at 99th percentile
  - [ ] Method: Load test with 10,000 req/s
  - [ ] Target: p99 <10ms
  - [ ] Current: ___ ms (measure after Phase 8)

- [ ] **Validate**: Cache hit rate >95%
  - [ ] Method: Monitor Redis statistics for 1 week
  - [ ] Target: >95%
  - [ ] Current: ___% (measure after Phase 8)

- [ ] **Validate**: Audit log write lag <1s at 99th percentile
  - [ ] Method: Monitor BullMQ queue latency
  - [ ] Target: p99 <1s
  - [ ] Current: ___ ms (measure after Phase 8)

- [ ] **Validate**: Zero cross-tenant data leakage
  - [ ] Method: Automated penetration testing
  - [ ] Target: 0 incidents
  - [ ] Current: ___ incidents (measure after Phase 8)

### User Experience (SC-001 to SC-006)

- [ ] **Validate**: Tenant context switch <2s
  - [ ] Method: Frontend timer
  - [ ] Target: <2s
  - [ ] Current: ___ s (measure after Phase 9)

- [ ] **Validate**: Permission-related support tickets <5/week
  - [ ] Method: Track support ticket tags
  - [ ] Target: <5/week
  - [ ] Baseline: 15-20/week
  - [ ] Current: ___ /week (measure 4 weeks after Phase 9)

---

## Risk Mitigation

### High-Risk Items

1. **Performance degradation**
   - **Risk**: Permission checks add latency to every request
   - **Mitigation**: Aggressive caching (95%+ hit rate), async audit logging
   - **Contingency**: Feature flag rollback, cache TTL tuning

2. **Cache stampede**
   - **Risk**: Cache expiration causes DB overload
   - **Mitigation**: Stale-while-revalidate pattern, cache warming
   - **Contingency**: Increase cache TTL temporarily

3. **Data migration issues**
   - **Risk**: Legacy role mapping incorrect, users lose access
   - **Mitigation**: Dry-run migration, rollback script, pilot testing
   - **Contingency**: Rollback to legacy roles, manual assignment

4. **ABAC policy complexity**
   - **Risk**: Policies too complex, evaluation time exceeds 5ms
   - **Mitigation**: Phase 1 uses RBAC only, ABAC in Phase 2
   - **Contingency**: Disable complex policies, simplify rules

---

## Definition of Done

Each phase is considered "done" when:

- [ ] All tasks completed and checked off
- [ ] Test coverage >95% (100% for domain layer)
- [ ] Code review approved by 2 developers
- [ ] Documentation updated
- [ ] Performance benchmarks meet targets
- [ ] Security audit passed (if applicable)
- [ ] Deployed to staging and tested
- [ ] Product owner sign-off

---

## Team Assignments

**Backend Developer 1** (Domain expert):
- Phase 2: Domain layer (entities, value objects, domain services)
- Phase 3: Application layer (commands, queries, use cases)
- Phase 6: Policy engine (ABAC evaluators)

**Backend Developer 2** (Infrastructure expert):
- Phase 1: Database schema, migrations, seeders
- Phase 4: Infrastructure layer (repositories, caching, audit)
- Phase 5: API layer (guards, controllers)

**Both Developers**:
- Phase 7: Integration (pair programming)
- Phase 8: Testing & performance (load testing, security audit)
- Phase 9: Migration & deployment

**Tech Lead**:
- Architecture review (before Phase 1)
- Code reviews (ongoing)
- Performance optimization (Phase 8)
- Deployment oversight (Phase 9)

---

## Timeline Summary

```
Week 1: Foundation + Domain Layer
├─ Day 1-2: Database schema, migration, seed
├─ Day 3-4: Domain entities (Role, Permission, UserRole)
└─ Day 5: Domain value objects, repository interfaces

Week 2: Application Layer
├─ Day 1-2: Commands (assign, create, grant, revoke)
├─ Day 3-4: Queries (get permissions, audit, reconstruction)
└─ Day 5: Use cases (assign, evaluate, request, switch)

Week 3: Infrastructure Layer
├─ Day 1-2: Prisma repositories
├─ Day 3-4: Caching layer (Redis)
└─ Day 5: Audit system (async writer, archival)

Week 4: API Layer + Policy Engine
├─ Day 1-2: Guards (Permission, TenantIsolation, StepUp)
├─ Day 3: Controllers (Permission, Role, Audit, UserRole)
└─ Day 4-5: ABAC policy engine (evaluators, rules)

Week 5: Integration + Testing
├─ Day 1-2: SPID integration, controller migration
├─ Day 3: Background jobs
└─ Day 4-5: Load testing, security audit, E2E scenarios

Week 6: Migration + Deployment + Documentation
├─ Day 1: Data migration scripts
├─ Day 2-3: Phased rollout (staging → beta → production)
└─ Day 4-5: Documentation, training materials
```

---

## Next Steps

1. **Immediate** (Today):
   - [ ] Review architecture documents with team
   - [ ] Get stakeholder approval on design decisions
   - [ ] Set up project board (GitHub Projects or Jira)
   - [ ] Create feature branch: `feat/002-roles-permissions-system`

2. **This Week**:
   - [ ] Start Phase 1: Database schema
   - [ ] Generate Prisma migration
   - [ ] Create seed script
   - [ ] Begin domain layer development (TDD)

3. **Weekly Meetings**:
   - [ ] Monday: Sprint planning (review checklist)
   - [ ] Wednesday: Mid-week sync (blocker resolution)
   - [ ] Friday: Demo + retrospective (completed work)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-31
**Maintained By**: Backend Team
