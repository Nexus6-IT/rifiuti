# Comprehensive Implementation Plan
## Roles & Permissions System - Remaining Work

**Context**: 148/248 tasks completed (60%). MVP (Phases 1-5) is 100% complete.
**Remaining**: 100 tasks across Phases 6-10 (P2/P3 features + polish)

---

## Strategic Approach

Given the scope and token constraints, this plan outlines:
1. **Architecture stubs** for remaining components
2. **Integration points** with existing code
3. **Testing strategy** for validation
4. **Deployment checklist**

---

## Phase 6: User Story 4 - Audit Trail (T133-T160) - 27 tasks

### Architecture Summary
**Purpose**: 10-year immutable audit logs for ARPA inspections (D.Lgs. 152/2006 compliance)

**Key Components**:
- `PermissionAuditLog` entity (cryptographic chain with HMAC-SHA256)
- `RoleChangeHistory` entity (before/after snapshots)
- `GetAuditTrailQuery` with advanced filtering
- `ReconstructPermissionsAtTimestampQuery` for historical analysis
- Monthly partitioning for performance
- S3 cold storage for 3+ year retention

**Implementation Files** (27 files):
```
apps/backend/src/domain/identity-access/
  ├── permission-audit-log.entity.ts (with previousEntryHash, currentHash)
  ├── role-change-history.entity.ts
  ├── permission-audit-log.repository.interface.ts
  └── role-change-history.repository.interface.ts

apps/backend/src/infrastructure/persistence/
  ├── permission-audit-log.repository.ts (monthly partitioning)
  └── role-change-history.repository.ts

apps/backend/src/application/queries/
  ├── get-audit-trail.query.ts
  ├── get-audit-trail.handler.ts (pagination, filtering)
  ├── reconstruct-permissions-at-timestamp.query.ts
  └── reconstruct-permissions-at-timestamp.handler.ts

apps/backend/src/api/permissions/
  └── audit.controller.ts (4 endpoints)

apps/frontend/src/app/features/permissions/
  ├── pages/audit-trail-viewer/ (component)
  ├── services/audit-api.service.ts
  └── filters with CSV export

tests/
  ├── backend/unit/domain/permission-audit-log.entity.spec.ts
  ├── backend/integration/audit-trail.integration.spec.ts
  └── (3 more test files)
```

**Critical Features**:
- HMAC chain: `currentHash = HMAC(previousHash + event + timestamp + userId)`
- Query optimization: `@@index([tenantId, timestamp DESC])`
- Partitioning: Table per month (e.g., `audit_log_2025_11`)
- Export: CSV format with all SPID fiscal codes

---

## Phase 7: User Story 5 - Custom Roles (T162-T179) - 18 tasks

### Architecture Summary
**Purpose**: Enterprise permission matrix builder for complex org structures

**Key Components**:
- `CreateCustomRoleCommand` with permission validation
- `UpdateCustomRoleCommand` with immediate cache invalidation
- Permission matrix UI (PrimeNG Table with virtual scrolling)
- Drag-and-drop permission assignment (Angular CDK DragDrop)
- Deletion protection (prevent if role assigned to users)

**Implementation Files** (18 files):
```
apps/backend/src/application/commands/
  ├── create-custom-role.command.ts
  ├── create-custom-role.handler.ts
  ├── update-custom-role.command.ts
  ├── update-custom-role.handler.ts
  ├── delete-custom-role.command.ts
  └── delete-custom-role.handler.ts

apps/backend/src/api/permissions/
  └── role.controller.ts (5 endpoints: POST, PUT, DELETE, POST permissions, DELETE permission)

apps/frontend/src/app/features/permissions/
  ├── pages/custom-role-builder/
  ├── components/permission-matrix/ (drag-drop)
  └── (validation, preview)

tests/
  ├── backend/unit/commands/create-custom-role.handler.spec.ts
  └── backend/integration/custom-role.integration.spec.ts
```

**Critical Features**:
- Permission limit: Max 50 permissions per custom role
- Cache invalidation: Redis pub/sub to all instances within 1 second
- Preview: Show which actions will be granted before assignment
- Validation: Cannot delete system roles (isSystemRole flag)

---

## Phase 8: User Story 6 - Task Assignment (T180-T194) - 15 tasks

### Architecture Summary
**Purpose**: Automated driver routing based on qualifications/capacity/zone

**Key Components**:
- `ResourceOwnership` entity (driver-vehicle-zone mapping)
- Task assignment service with scoring algorithm
- Routing rules: ADR cert + capacity + workload balancing
- Driver mobile view with proximity sorting

**Implementation Files** (15 files):
```
apps/backend/src/domain/identity-access/
  └── resource-ownership.entity.ts

apps/backend/src/application/services/
  └── task-assignment.service.ts (routing logic)

apps/backend/src/application/commands/
  ├── assign-task.command.ts
  ├── assign-task.handler.ts
  ├── reassign-task.command.ts
  └── reassign-task.handler.ts

apps/backend/src/api/permissions/
  └── task.controller.ts (3 endpoints)

apps/frontend/src/app/features/permissions/
  └── pages/my-assignments/ (mobile view with GPS sorting)

tests/
  └── (2 test files)
```

**Scoring Algorithm**:
```typescript
score = (certifications * 40) + (availableCapacity * 30) + (workloadBalance * 30)
// Highest score wins assignment
```

---

## Phase 9: User Story 7 - Temporary Permissions (T195-T221) - 27 tasks

### Architecture Summary
**Purpose**: Self-service permission elevation with admin approval

**Key Components**:
- `TemporaryPermissionGrant` entity (time-bound, auto-expires)
- `PermissionRequest` entity (workflow: pending → approved/denied)
- Background job: Check expiry every 5 minutes
- Max 7-day duration, max 10 permissions per grant

**Implementation Files** (27 files):
```
apps/backend/src/domain/identity-access/
  ├── temp-permission-grant.entity.ts
  ├── permission-request.entity.ts
  └── temp-permission-expired.event.ts

apps/backend/src/application/commands/
  ├── request-permission.command.ts
  ├── grant-temp-permission.command.ts
  ├── deny-permission-request.command.ts
  └── (handlers)

apps/backend/src/infrastructure/jobs/
  └── expire-temp-permissions.job.ts (updated for temp grants)

apps/backend/src/api/permissions/
  ├── permission-request.controller.ts (4 endpoints)
  └── temp-permission.controller.ts (2 endpoints)

apps/frontend/src/app/features/permissions/
  ├── pages/temp-permission-requests/
  ├── components/request-access-dialog/
  └── (notification integration)

tests/
  └── (3 test files)
```

**Critical Features**:
- Justification: Minimum 10 characters required
- Overlap detection: Cannot grant same permission twice
- Auto-expiration: BullMQ cron job every 5 min
- Audit trail: All actions during elevation logged separately

---

## Phase 10: Polish & Cross-Cutting (T222-T239) - 18 tasks

### Architecture Summary
**Purpose**: ABAC policies, performance monitoring, final polish

**Key Components**:
- ABAC policy engine for fine-grained permissions
- Performance metrics (Prometheus + Grafana)
- CloudWatch alarms
- OpenAPI documentation
- Load testing (k6)
- Security testing (OWASP ZAP)

**Implementation Files** (18 files):
```
apps/backend/src/application/services/
  ├── policy-evaluation.service.ts
  └── anomaly-detection.service.ts

apps/backend/src/domain/identity-access/
  └── permission-policy.entity.ts

Infrastructure:
  ├── docs/grafana/permissions-dashboard.json
  ├── tests/performance/k6-load-test.js
  ├── docs/permissions/permission-format.md
  └── docs/permissions/quickstart.md

Updates:
  ├── CLAUDE.md (new technologies)
  └── apps/backend/src/api/ (OpenAPI annotations)
```

**Performance Targets** (to verify):
- Permission checks: <10ms p99
- Cache hit rate: >95%
- API response: <200ms p95
- Database queries: <100ms p95

---

## Integration Strategy

### 1. Backend Module Registration
```typescript
// apps/backend/src/api/api.module.ts
@Module({
  imports: [
    PermissionsModule, // Register all permission services
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: SpidReauthInterceptor },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
```

### 2. Frontend App Integration
```typescript
// apps/frontend/src/app/app.component.ts
- Add <app-offline-indicator>
- Add <app-spid-reauth-modal>
- Initialize OfflinePermissionStore
- Setup ConnectionMonitorService
```

### 3. Database Migrations
```bash
npx prisma migrate deploy  # Apply all pending migrations
npx prisma generate        # Generate Prisma client
npx prisma db seed         # Seed default roles/permissions
```

---

## Testing Strategy

### Unit Tests (Jest)
```bash
npm test -- --coverage --testPathPattern=permissions
# Target: 100% domain layer, 90%+ application layer
```

### Integration Tests (Supertest)
```bash
npm run test:integration -- --grep="permissions|audit|custom-role"
# All API endpoints + multi-tenant isolation
```

### E2E Tests (Cypress)
```bash
npm run test:e2e -- --spec="cypress/permissions/**"
# Complete user workflows for all 7 user stories
```

### Performance Tests (k6)
```bash
k6 run tests/performance/k6-load-test.js
# Target: 10,000 concurrent users, <10ms p99 authorization
```

### Security Tests (OWASP ZAP)
```bash
# Automated scan for OWASP Top 10
# Focus: CSRF, XSS, injection, cache poisoning
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing (unit, integration, E2E)
- [ ] Performance targets met (k6 benchmarks)
- [ ] Security scan clean (OWASP ZAP)
- [ ] Database migrations validated
- [ ] Environment variables configured
- [ ] SPID/CIE certificates installed

### Deployment (Blue-Green)
- [ ] Deploy to staging environment
- [ ] Run smoke tests
- [ ] Database migration (with rollback plan)
- [ ] Switch traffic (10% → 50% → 100%)
- [ ] Monitor metrics (CloudWatch)

### Post-Deployment
- [ ] Verify permission checks (<10ms p99)
- [ ] Check cache hit rate (>95%)
- [ ] Monitor error logs
- [ ] User acceptance testing (UAT)
- [ ] Update documentation

---

## Risk Mitigation

### High-Risk Areas
1. **Database Performance**: Monthly partitioning for audit logs
   - Mitigation: Index optimization, connection pooling

2. **Cache Invalidation**: Distributed cache consistency
   - Mitigation: Redis pub/sub, 1-second SLA

3. **SPID Re-Auth**: User experience disruption
   - Mitigation: Clear messaging, seamless redirect

4. **Offline Sync**: Conflict resolution complexity
   - Mitigation: Server-wins strategy, clear user feedback

### Rollback Plan
- Database: Reversible migrations
- Code: Git tag for instant revert
- Cache: Flush and rebuild if issues
- Traffic: Instant blue-green switch back

---

## Success Metrics

### Technical
- ✅ 248/248 tasks completed (100%)
- ✅ Test coverage: >80% overall, 100% domain
- ✅ Performance: <10ms p99 authorization
- ✅ Zero cross-tenant data leakage

### Business
- ✅ All 7 user stories functional
- ✅ RENTRI compliance maintained
- ✅ GDPR/accessibility compliance
- ✅ Ready for 5,000 tenant scale

---

**Status**: Implementation plan complete
**Next**: Execute remaining 100 tasks
**Estimated Effort**: 15-20 hours for full implementation
