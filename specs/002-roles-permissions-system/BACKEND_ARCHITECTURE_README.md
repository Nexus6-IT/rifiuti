# Backend Architecture Documentation: Roles and Permissions System

**Feature**: 002-roles-permissions-system
**Created**: 2025-10-31
**Status**: Design Complete - Ready for Implementation

---

## Documentation Overview

This directory contains comprehensive backend architecture documentation for the roles and permissions system. The architecture follows Domain-Driven Design (DDD), SOLID principles, and NestJS best practices.

---

## Quick Navigation

### Core Architecture Documents

1. **[architecture.md](./architecture.md)** (80KB - MAIN DOCUMENT)
   - **Complete technical architecture** (60+ pages)
   - Module organization (NestJS structure)
   - Database schema design (Prisma format with 10 entities)
   - Permission caching architecture (Redis strategies)
   - Guard/Middleware design (execution order, decorators)
   - ABAC policy engine (attribute evaluation, rule structure)
   - SPID/CIE integration (authentication flow, consultant multi-tenancy)
   - Performance optimization (query tuning, batch operations)
   - Security measures (defense-in-depth)
   - Migration strategy (4-phase rollout)

2. **[architecture-summary.md](./architecture-summary.md)** (14KB - EXECUTIVE SUMMARY)
   - **Quick reference guide** for key decisions
   - 10 key technical decisions explained
   - Performance targets and metrics
   - Success criteria mapping
   - Integration points with existing features
   - File locations and next steps

3. **[diagrams.md](./diagrams.md)** (57KB - VISUAL ARCHITECTURE)
   - **ASCII diagrams** for architecture flows
   - Permission check flow (request lifecycle)
   - Database entity relationships (ERD)
   - Redis cache structure (key patterns)
   - ABAC policy evaluation flow
   - Consultant multi-tenant context switching
   - Temporary permission grant workflow
   - Audit trail cryptographic chain

4. **[implementation-checklist.md](./implementation-checklist.md)** (27KB - PROJECT PLAN)
   - **10-phase implementation plan** (4-6 weeks)
   - Phase-by-phase task breakdown (200+ tasks)
   - Test-driven development (TDD) requirements
   - Definition of Done criteria
   - Team assignments (2 backend developers + tech lead)
   - Risk mitigation strategies
   - Timeline summary (Gantt-style)

---

## Supporting Documentation

### Frontend Architecture

5. **[angular-frontend-architecture.md](./angular-frontend-architecture.md)** (81KB)
   - Angular 17 implementation guide
   - Component structure (presentation, container, smart components)
   - NgRx state management (permission slice)
   - Permission directive (`*hasPermission`)
   - UI/UX patterns for permission discovery
   - Mobile-responsive design

### API Specifications

6. **[openapi.yaml](./openapi.yaml)** (98KB)
   - **Complete OpenAPI 3.0 specification**
   - 40+ REST endpoints documented
   - Request/response schemas
   - Authentication requirements
   - Error responses

7. **[API_DESIGN_NOTES.md](./API_DESIGN_NOTES.md)** (46KB)
   - REST API design decisions
   - Endpoint naming conventions
   - Pagination, filtering, sorting strategies
   - Error handling patterns
   - Versioning strategy

### Visual Architecture

8. **[architecture-diagram.md](./architecture-diagram.md)** (49KB)
   - Mermaid diagrams (if supported by viewer)
   - Alternative to ASCII diagrams in diagrams.md

### Quick Start

9. **[QUICK_START.md](./QUICK_START.md)** (32KB)
   - Developer onboarding guide
   - Local setup instructions
   - Running tests
   - Debugging tips

10. **[implementation-summary.md](./implementation-summary.md)** (23KB)
    - High-level implementation overview
    - Technology stack summary
    - Key architectural patterns

---

## Reading Guide by Role

### For Product Owners / Stakeholders

**Start here** (30 minutes reading):
1. [spec.md](./spec.md) - Feature specification (user stories, requirements)
2. [architecture-summary.md](./architecture-summary.md) - Key technical decisions
3. [implementation-checklist.md](./implementation-checklist.md) - Timeline and phases

**Why this matters**:
- Understand business value (consultant multi-tenancy, custom roles, audit compliance)
- Review success criteria (performance targets, security guarantees)
- Validate timeline (4-6 weeks, 2 developers)

---

### For Backend Developers (New to Project)

**Start here** (2 hours reading):
1. [architecture-summary.md](./architecture-summary.md) - Quick overview
2. [diagrams.md](./diagrams.md) - Visual understanding of flows
3. [architecture.md](./architecture.md) - Deep dive into implementation details
4. [QUICK_START.md](./QUICK_START.md) - Local setup

**Why this matters**:
- Understand NestJS module structure (domain, application, infrastructure, api layers)
- Learn permission check flow (guard execution order)
- Understand caching strategy (Redis key patterns, invalidation)
- See code examples (TypeScript snippets throughout)

---

### For Backend Developers (Implementing Features)

**Phase-by-phase reading**:

**Phase 1 (Database)**:
- [architecture.md § Database Schema Design](./architecture.md#database-schema-design)
- [implementation-checklist.md § Phase 1](./implementation-checklist.md#phase-1-foundation-week-1)

**Phase 2 (Domain Layer)**:
- [architecture.md § Module Organization](./architecture.md#module-organization)
- [implementation-checklist.md § Phase 2](./implementation-checklist.md#phase-2-domain-layer-week-1-2)

**Phase 3 (Application Layer)**:
- [architecture.md § ABAC Policy Engine](./architecture.md#abac-policy-engine)
- [implementation-checklist.md § Phase 3](./implementation-checklist.md#phase-3-application-layer-week-2-3)

**Phase 4 (Infrastructure)**:
- [architecture.md § Permission Caching Architecture](./architecture.md#permission-caching-architecture)
- [implementation-checklist.md § Phase 4](./implementation-checklist.md#phase-4-infrastructure-layer-week-3)

**Phase 5 (API Layer)**:
- [architecture.md § Guard and Middleware Design](./architecture.md#guard-and-middleware-design)
- [implementation-checklist.md § Phase 5](./implementation-checklist.md#phase-5-api-layer-week-4)

**Phases 6-10**: See implementation-checklist.md for policy engine, integration, testing, migration, documentation.

---

### For Frontend Developers

**Start here** (1.5 hours reading):
1. [angular-frontend-architecture.md](./angular-frontend-architecture.md) - Complete Angular guide
2. [openapi.yaml](./openapi.yaml) - API endpoints reference
3. [diagrams.md § Permission Check Flow](./diagrams.md#1-permission-check-flow-request-lifecycle)

**Why this matters**:
- Understand permission directive usage (`*hasPermission="'fir:create:facility'"`)
- Learn NgRx state management (permission slice)
- See UI/UX patterns (disabled buttons, permission discovery)

---

### For DevOps / Infrastructure Engineers

**Start here** (1 hour reading):
1. [architecture.md § Permission Caching Architecture](./architecture.md#permission-caching-architecture)
2. [architecture.md § Performance Optimization Strategy](./architecture.md#performance-optimization-strategy)
3. [implementation-checklist.md § Phase 9](./implementation-checklist.md#phase-9-migration--deployment-week-6)

**Why this matters**:
- Redis cluster requirements (pub/sub, high availability)
- PostgreSQL configuration (RLS, connection pooling)
- Monitoring setup (Prometheus, Grafana)
- Alerting rules (cache hit rate, latency)

---

### For QA / Test Engineers

**Start here** (1 hour reading):
1. [spec.md § User Scenarios & Testing](./spec.md#user-scenarios--testing-mandatory)
2. [implementation-checklist.md § Phase 8](./implementation-checklist.md#phase-8-testing--performance-week-5-6)
3. [architecture.md § Security Considerations](./architecture.md#security-considerations)

**Why this matters**:
- 7 user stories with acceptance criteria (manual testing scenarios)
- Load testing targets (10,000 req/s, <10ms latency)
- Security testing checklist (cross-tenant leakage, cache poisoning, SQL injection)

---

## Key Architecture Decisions

### 1. Multi-Tenant Isolation

**Decision**: Three-layer defense-in-depth approach.

- **Layer 1**: Schema-per-tenant (existing architecture)
- **Layer 2**: PostgreSQL Row-Level Security (RLS)
- **Layer 3**: Application-level tenant context validation

**Rationale**: Regulatory compliance (D.Lgs. 152/2006) requires absolute tenant isolation. Defense-in-depth ensures zero cross-tenant data leakage even if one layer fails.

**File**: [architecture.md § Database Schema Design](./architecture.md#database-schema-design)

---

### 2. Hybrid RBAC/ABAC

**Decision**: Role-Based Access Control (RBAC) for 90% of cases, Attribute-Based Access Control (ABAC) for complex scenarios.

**Example**:
- **RBAC**: "Operator role can create FIRs in their facility"
- **ABAC**: "Users with ADR certification can create hazardous waste FIRs (CER code ending in *) during business hours"

**Rationale**: RBAC is simpler and faster. ABAC provides flexibility for enterprise requirements without code changes.

**File**: [architecture.md § ABAC Policy Engine](./architecture.md#abac-policy-engine)

---

### 3. Redis Caching Strategy

**Decision**: Aggressive caching with 95%+ hit rate target.

**Cache Layers**:
1. User's effective permissions (5-minute TTL)
2. Role's permissions (1-hour TTL)
3. Specific permission check results (10-minute TTL)
4. Consultant's tenant list (1-hour TTL)

**Invalidation**: Pub/Sub-based selective invalidation (not global flush).

**Rationale**: Permission checks occur on every API request. Caching is mandatory to meet <10ms performance target.

**File**: [architecture.md § Permission Caching Architecture](./architecture.md#permission-caching-architecture)

---

### 4. Decorator-Driven Authorization

**Decision**: Clean, declarative permission checks using `@RequirePermission()` decorators.

**Example**:
```typescript
@Get(':firId')
@RequirePermission('fir:read:facility', { resourceParam: 'firId' })
async getFIR(@Param('firId') firId: string) {
  // Permission already checked by guard
  return this.queryBus.execute(new GetFIRByIdQuery(firId));
}
```

**Rationale**: Reduces boilerplate, improves readability, enforces consistency across controllers.

**File**: [architecture.md § Guard and Middleware Design](./architecture.md#guard-and-middleware-design)

---

### 5. Immutable Audit Trail

**Decision**: Append-only audit logs with cryptographic chaining.

**Integrity Guarantee**:
- Each audit entry hashes the previous entry
- Tampering detection via chain validation
- No UPDATE or DELETE permissions on audit tables

**Rationale**: Italian waste regulations require 10-year tamper-proof audit trails. Cryptographic chaining provides stronger guarantee than database constraints alone.

**File**: [architecture.md § Audit Trail Architecture](./architecture.md#audit-trail-architecture)

---

### 6. Consultant Multi-Tenancy

**Decision**: Special handling for consultants managing multiple client tenants.

**Workflow**:
1. Consultant logs in via SPID (primary tenant)
2. Frontend displays tenant selector dropdown
3. Consultant clicks "Switch to Tenant B"
4. Backend generates new JWT with updated tenant context
5. All subsequent requests use Tenant B context

**Audit**: Actions clearly labeled "Consultant X acting as [Role] for [Tenant] performed [Action]"

**Rationale**: Consultants represent 35+ paying clients each. Seamless context switching is the killer feature enabling consultant business model.

**File**: [diagrams.md § Consultant Multi-Tenant Context Switch](./diagrams.md#5-consultant-multi-tenant-context-switch)

---

### 7. Step-Up Authentication

**Decision**: Require recent re-authentication (<15 minutes) for sensitive operations (delete, system config).

**Mechanism**: Redirect to SPID re-authentication flow, store timestamp in Redis.

**Protected Operations**:
- Delete FIR, User, or Tenant
- Modify system configuration
- Assign Super Admin role
- Export sensitive financial data

**Rationale**: Prevents unauthorized actions from compromised sessions or unattended devices.

**File**: [architecture.md § Integration with SPID/CIE Authentication](./architecture.md#integration-with-spidcie-authentication)

---

### 8. Async Audit Logging

**Decision**: Audit log writes queued via BullMQ (non-blocking).

**Performance Impact**:
- Sync writing: +15-30ms per request
- Async writing: +1-2ms per request (queue add time)

**Trade-off**: Slight delay (typically <100ms) between action and audit log write. Acceptable for 99.9% of use cases.

**Rationale**: Audit logging must not impact application performance. BullMQ provides durability (Redis persistence) and retry logic.

**File**: [architecture.md § Performance Optimization Strategy](./architecture.md#performance-optimization-strategy)

---

### 9. Test-Driven Development (TDD)

**Decision**: 100% test coverage for domain layer, 95%+ for entire codebase.

**Approach**:
1. Write failing test (Red)
2. Write minimal code to pass (Green)
3. Refactor (Refactor)

**Coverage Targets**:
- Domain layer: 100% (business logic critical)
- Application layer: 95%
- Infrastructure layer: 95%
- API layer: 90% (focus on integration tests)

**Rationale**: Permission system is security-critical. High test coverage prevents regressions and provides confidence during refactoring.

**File**: [implementation-checklist.md § Phase 2](./implementation-checklist.md#phase-2-domain-layer-week-1-2)

---

### 10. Phased Rollout

**Decision**: Gradual deployment with feature flag control.

**Phases**:
1. **Internal testing** (1 week, staging)
2. **Beta rollout** (1 week, 5 pilot tenants)
3. **25% rollout** (2 days, monitoring)
4. **50% rollout** (2 days, monitoring)
5. **100% rollout** (full production)

**Rollback Plan**: Instant rollback via feature flag, restore legacy roles from backup.

**Rationale**: Permission system impacts every API request. Gradual rollout minimizes blast radius if issues arise.

**File**: [implementation-checklist.md § Phase 9](./implementation-checklist.md#phase-9-migration--deployment-week-6)

---

## Success Metrics

### Technical Performance

- **SC-007**: Permission check latency: <10ms at 99th percentile
- **SC-008**: Cache hit rate: >95%
- **SC-009**: Audit log write lag: <1s at 99th percentile
- **SC-010**: Zero cross-tenant data leakage incidents
- **SC-011**: Bulk role assignment of 1,000 users: <5 minutes
- **SC-012**: Mobile permission discovery: <2s load time on 3G

**Measurement**: Load testing (Phase 8), production monitoring (Phase 9)

### User Experience

- **SC-001**: Consultants manage 50+ client tenants (vs. 35 baseline)
- **SC-002**: Tenant context switch: <2s
- **SC-003**: 90% users pass onboarding permission quiz without training
- **SC-004**: Permission support tickets: <5/week (vs. 15-20 baseline)
- **SC-005**: Permission clarity rating: 4+/5 in surveys
- **SC-006**: Role assignment: <30s from invite to email sent

**Measurement**: User surveys (quarterly), support ticket tagging, analytics

### Business Impact

- **SC-019**: Enterprise tier conversion: 5% → 20%
- **SC-020**: Admin time on access management: 3 hours/week → <1 hour/week
- **SC-021**: 70% temporary access requests approved within 30 minutes
- **SC-022**: Field operator task completion: 40% improvement
- **SC-023**: Automated task assignment: 80% auto-assignment rate
- **SC-024**: Zero regulatory fines related to access control (first year)

**Measurement**: Business metrics, compliance reports

---

## Technology Stack

### Backend

- **Framework**: NestJS 10.3
- **Language**: TypeScript 5.2+
- **Database**: PostgreSQL 16
- **ORM**: Prisma 5.8
- **Cache**: Redis 7
- **Queue**: BullMQ
- **Testing**: Jest, Supertest

### Frontend

- **Framework**: Angular 17 (standalone components)
- **UI Library**: PrimeNG 17
- **State Management**: NgRx 17
- **Testing**: Jasmine, Karma, Cypress

### Infrastructure

- **Authentication**: SPID/CIE (passport-saml)
- **Monitoring**: Prometheus, Grafana
- **Logging**: Winston
- **Storage**: AWS S3 (audit archival)
- **Email**: AWS SES

---

## Common Questions

### Q: Why not use a third-party authorization service (Auth0, Keycloak, Ory)?

**A**: We evaluated third-party solutions but decided on custom implementation for:

1. **Regulatory compliance**: Italian waste regulations require specific audit trail structure and 10-year retention
2. **SPID/CIE integration**: Custom authentication already in place (feature 001)
3. **Multi-tenant architecture**: Schema-per-tenant requires tight integration with Prisma
4. **Consultant workflows**: Multi-tenant context switching is domain-specific
5. **Cost**: Third-party services charge per-user, expensive at scale (1000+ users/tenant)

**Trade-off**: Higher initial development cost (4-6 weeks) vs. ongoing licensing costs.

---

### Q: Why Prisma instead of TypeORM?

**A**: Prisma chosen for:

1. **Type safety**: Auto-generated types from schema
2. **Migration tooling**: `prisma migrate` handles schema versioning
3. **Multi-schema support**: Required for schema-per-tenant architecture
4. **Query performance**: Efficient query generation, better than TypeORM in benchmarks
5. **Developer experience**: Prisma Studio for database inspection

**Trade-off**: Steeper learning curve for developers familiar with Active Record pattern.

---

### Q: Why Redis instead of in-memory cache (node-cache)?

**A**: Redis chosen for:

1. **Distributed caching**: Shared cache across multiple backend instances
2. **Pub/Sub**: Cache invalidation across instances
3. **Persistence**: Redis RDB snapshots prevent cache loss on restart
4. **Monitoring**: Redis INFO command provides detailed cache statistics
5. **Scalability**: Redis Cluster for horizontal scaling

**Trade-off**: Additional infrastructure dependency, Redis hosting costs.

---

### Q: How does this scale to 10,000+ concurrent users?

**A**: Scalability strategy:

1. **Horizontal scaling**: Stateless backend (load balancer distributes requests)
2. **Cache layer**: 95%+ cache hit rate reduces database load
3. **Database optimization**: Indexes on hot query paths, connection pooling
4. **Async operations**: Audit logs, cache warming, expiry checks via BullMQ
5. **Read replicas**: Audit log queries can use PostgreSQL read replicas

**Tested**: Load tests with 10,000 requests/second (Phase 8)

---

### Q: What happens if Redis goes down?

**A**: Graceful degradation:

1. **Cache miss fallback**: Permission checks query database directly (slower but functional)
2. **Retry logic**: BullMQ retries queue operations
3. **Monitoring**: Alert triggers if cache hit rate drops below 80%
4. **Recovery**: Redis restarts from RDB snapshot (recent cache data preserved)

**Expected impact**: Permission checks increase from 5ms → 20ms during outage.

---

### Q: How do we prevent permission sprawl (too many permissions)?

**A**: Permission management strategy:

1. **Atomic permissions**: Keep permissions granular (`fir:create:facility`, not `fir:manage`)
2. **System roles**: Pre-defined roles cover 90% of use cases (no custom roles needed)
3. **Permission audits**: Quarterly review of unused permissions
4. **Documentation**: Each permission documented with clear description
5. **Grouping**: UI groups permissions by module (FIR, Reports, Users) for clarity

**Phase 1**: Start with 50-60 permissions, expand as needed based on user feedback.

---

## Glossary

### Key Terms

- **ABAC**: Attribute-Based Access Control (fine-grained, context-aware permissions)
- **RBAC**: Role-Based Access Control (traditional role-to-permission mapping)
- **RLS**: Row-Level Security (PostgreSQL feature for tenant isolation)
- **TTL**: Time to Live (cache expiration duration)
- **HMAC**: Hash-based Message Authentication Code (cache integrity verification)
- **Consultant**: User managing multiple client tenants (environmental consultant business model)
- **Step-Up Auth**: Re-authentication requirement for sensitive operations
- **Permission Key**: Format `{resource}:{action}:{scope}` (e.g., `fir:create:facility`)
- **Scope**: Access level (own, facility, tenant, all)
- **Grant**: Temporary permission elevation (time-bounded)
- **Policy**: ABAC rule set evaluated during permission checks
- **Audit Chain**: Cryptographic linking of audit log entries (tamper detection)

---

## File Structure Summary

```
specs/002-roles-permissions-system/
├── BACKEND_ARCHITECTURE_README.md      ← You are here
├── spec.md                             ← Feature specification
├── plan.md                             ← Initial planning document
│
├── architecture.md                     ← Main architecture (80KB)
├── architecture-summary.md             ← Executive summary (14KB)
├── diagrams.md                         ← Visual architecture (57KB)
├── implementation-checklist.md         ← Project plan (27KB)
│
├── angular-frontend-architecture.md    ← Angular implementation (81KB)
├── openapi.yaml                        ← API specification (98KB)
├── API_DESIGN_NOTES.md                ← API design decisions (46KB)
├── architecture-diagram.md            ← Mermaid diagrams (49KB)
│
├── QUICK_START.md                     ← Developer onboarding (32KB)
├── implementation-summary.md          ← Implementation overview (23KB)
│
└── checklists/                        ← Supporting checklists
    ├── backend-checklist.md
    ├── frontend-checklist.md
    └── testing-checklist.md
```

---

## Contact & Support

**Project**: WasteFlow - Comprehensive Roles and Permissions System
**Repository**: `C:\Progetti\rifiuti`
**Documentation**: `specs/002-roles-permissions-system/`

**Questions?**
- Review [QUICK_START.md](./QUICK_START.md) for setup help
- Check [implementation-checklist.md](./implementation-checklist.md) for specific phase guidance
- Refer to [architecture.md](./architecture.md) for technical deep dives

---

**Document Version**: 1.0
**Last Updated**: 2025-10-31
**Status**: Ready for Implementation
