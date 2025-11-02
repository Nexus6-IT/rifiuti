# Roles & Permissions System - API Design Documentation

**Feature ID**: 002-roles-permissions-system
**Status**: Design Complete - Ready for Implementation
**Created**: 2025-10-31
**Technology Stack**: NestJS 10.3, Prisma 5.8, PostgreSQL 16, Redis 7, Angular 17

---

## Overview

This directory contains the complete REST API design for WasteFlow's comprehensive roles and permissions system. The system supports multi-tenant RBAC with consultant cross-tenant context switching, temporary permission elevation, and regulatory compliance audit trails.

### Key Capabilities

- **Multi-Tenant RBAC**: Role-based access control with tenant isolation
- **Consultant Multi-Tenancy**: Single consultant managing 50+ client tenants
- **Custom Roles**: Enterprise feature for granular permission matrices
- **Temporary Elevation**: Self-service permission requests with admin approval
- **Audit Compliance**: 10-year immutable audit trail per D.Lgs. 152/2006
- **High Performance**: <10ms permission checks at 99th percentile
- **Mobile-First**: Responsive UI with offline permission caching

---

## Documentation Files

### 1. **openapi.yaml** - Complete API Specification
**Purpose**: OpenAPI 3.0 specification for all endpoints
**Audience**: Full-stack developers, API consumers, DevOps

**Contents**:
- 45 REST endpoints across 7 functional areas
- Complete request/response schemas
- Authentication/authorization requirements
- Rate limiting specifications
- Error response formats
- Pagination patterns
- Webhook event definitions

**Key Sections**:
- Role Management: CRUD operations, assignment/revocation
- Permission Queries: Check permissions, get user capabilities
- Custom Roles: Enterprise permission matrix builder
- Temporary Grants: Self-service elevation workflow
- Audit Logs: Compliance queries, export, historical reconstruction
- Consultant Context: Multi-tenant switching, aggregated dashboard
- Permission Requests: Self-service request/approval workflow

**How to Use**:
```bash
# View in Swagger UI
npx @redocly/openapi-cli preview-docs openapi.yaml

# Generate TypeScript client
npx openapi-generator-cli generate -i openapi.yaml -g typescript-axios -o ./client

# Validate specification
npx @redocly/openapi-cli lint openapi.yaml
```

---

### 2. **API_DESIGN_NOTES.md** - Architectural Decisions & Rationale
**Purpose**: Deep-dive into design decisions, performance optimizations, security
**Audience**: Senior engineers, architects, security reviewers

**Contents**:
- **Key Architectural Decisions**: Versioning, permission format, rate limiting
- **Caching Strategy**: Multi-layer Redis + in-memory with cache poisoning prevention
- **Audit Logging**: Immutable append-only logs, partitioning, archival strategy
- **Security Considerations**: JWT structure, cross-tenant isolation, SPID re-auth
- **Performance Optimization**: Permission check hot path (<10ms), bulk operations
- **Implementation Roadmap**: 8-week phased delivery plan
- **Testing Strategy**: Unit, integration, E2E, performance test patterns
- **Monitoring & Observability**: Metrics, dashboards, alerting thresholds
- **Migration Strategy**: Zero-downtime migration from existing system

**Key Sections**:
- Permission Check Hot Path: How to achieve <10ms P99
- Consultant Multi-Tenant Context: JWT design for seamless switching
- Temporary Permission Grants: Workflow and auto-expiration
- Historical Permission Reconstruction: Compliance query implementation
- Security Hardening: Defense-in-depth layers
- FAQ & Troubleshooting: Common issues and solutions

---

### 3. **QUICK_START.md** - Developer Implementation Guide
**Purpose**: Hands-on guide for backend developers implementing the API
**Audience**: Backend developers (NestJS/Prisma experience)

**Contents**:
- **Project Structure**: File organization following DDD/CQRS patterns
- **Prisma Schema**: Complete database models with indexes
- **Domain Entities**: Role, Permission, UserRole aggregate examples
- **Use Case Implementation**: TDD example with unit tests
- **Controller Example**: REST endpoint with DTOs and validation
- **Permission Guard**: Custom NestJS guard for authorization
- **Cache Service**: Redis-backed permission caching with HMAC signatures
- **Common Patterns**: Code snippets for frequent scenarios
- **Testing Commands**: npm scripts and examples
- **Common Issues**: Debugging tips and solutions

**Quick Code Examples**:
```typescript
// Protect endpoint with permission
@Post()
@RequirePermission('fir:create')
async createFIR(@Body() dto: CreateFIRDto) { ... }

// Check permission programmatically
const canDelete = await this.permCheck.check(userId, tenantId, 'fir:delete:own');

// Invalidate cache after role change
await this.cache.invalidateUser(userId, tenantId);
```

---

### 4. **spec.md** - Feature Specification (Reference)
**Purpose**: Original product requirements and user stories
**Audience**: Product managers, QA, business stakeholders

**Contents**:
- 7 detailed user stories with acceptance scenarios
- Edge cases and business rules
- 47 functional requirements
- Key entities and relationships
- 24 success criteria with measurable KPIs
- Dependencies and assumptions
- Out-of-scope features

**Referenced By**: All design documents trace back to requirements in spec.md

---

## Architecture Overview

### System Context

```
┌─────────────────┐      JWT (SPID)      ┌──────────────────────┐
│   Angular 17    │◄────────────────────►│   NestJS Backend     │
│   Frontend      │      REST API        │   (Multi-Tenant)     │
└─────────────────┘                      └──────────────────────┘
                                                    │
                                    ┌───────────────┼───────────────┐
                                    │               │               │
                            ┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
                            │ PostgreSQL 16│ │  Redis 7   │ │  BullMQ    │
                            │ (Schema/TID) │ │ (Cache)    │ │ (Jobs)     │
                            └──────────────┘ └────────────┘ └────────────┘
                                    │
                            ┌───────▼──────┐
                            │   AWS S3     │
                            │ (Audit Arch.)│
                            └──────────────┘
```

### Permission Check Flow (Hot Path)

```
1. API Request → JWT Auth Guard (validate token)
2. Permission Guard → Extract required permission from @RequirePermission()
3. Permission Check Service:
   ├─ Cache Lookup (Redis) → 95% hit rate, ~2ms
   │  ├─ Verify HMAC signature (prevent poisoning)
   │  └─ Return cached permissions
   ├─ Cache Miss → Fallback to database
   │  ├─ Query user roles + permissions (indexed, ~15ms)
   │  ├─ Write to Redis cache (5 min TTL)
   │  └─ Return permissions
4. Audit Logger (async) → BullMQ job → PostgreSQL
5. Response to client
```

**Performance Target**: <10ms at P99 (99th percentile)

### Multi-Tenant Isolation (Defense-in-Depth)

```
Layer 1: Schema-per-Tenant
└─ PostgreSQL schema separation: tenant_<uuid>
   └─ Connection pool tagged with tenant_id

Layer 2: Row-Level Security (RLS)
└─ PostgreSQL policies enforce tenant_id filter
   └─ Applied even if application bug bypasses schema

Layer 3: API Response Scrubbing
└─ Global NestJS interceptor validates responses
   └─ Strips cross-tenant data if accidentally fetched
```

---

## Key Design Principles

### 1. Permission Format: `resource:action:scope`

**Examples**:
- `fir:create:facility` - Create FIRs for assigned facilities
- `fir:read:all` - Read all FIRs in tenant (admin)
- `registry:write:own` - Write only own registry entries

**Scopes**:
- `own`: User's created resources
- `facility`: User's assigned facilities
- `all`: All tenant resources

### 2. Multi-Layer Caching

```
Request → Redis Cache (5 min TTL, 95% hit rate)
          ↓ miss
       → In-Memory LRU (1 min TTL, 3% hit rate)
          ↓ miss
       → Database Query (indexed, 2% queries)
```

### 3. Audit Logging Strategy

- **Every permission check logged** (granted AND denied)
- **Immutable append-only** (no updates/deletes)
- **Partitioned by month** (performance at scale)
- **10+ year retention** (3 years hot, 7+ years S3 cold storage)
- **SPID fiscal code** correlation for regulatory traceability

### 4. Consultant Multi-Tenancy

**JWT Structure**:
```json
{
  "sub": "consultant-user-uuid",
  "fiscalCode": "RSSMRA85M01H501X",
  "tenantId": "current-active-tenant-uuid",
  "tenantAssociations": [
    {"tenantId": "tenant-1", "roleName": "ADMIN", "permissions": [...]},
    {"tenantId": "tenant-2", "roleName": "VIEWER", "permissions": [...]}
  ]
}
```

**Context Switch**: `POST /consultant/switch-tenant` → New JWT with updated `tenantId`

### 5. Rate Limiting (Tiered)

| Endpoint Type | Limit | Rationale |
|--------------|-------|-----------|
| Permission checks | 1000/min | High-frequency, cached |
| Standard CRUD | 100/min | Normal admin ops |
| Audit queries | 20/min | Expensive DB operations |
| Bulk operations | 10/min | Resource-intensive async |
| Exports | 5/min | Heavy I/O |

---

## Success Criteria (KPIs)

| ID | Metric | Target | Measurement |
|----|--------|--------|-------------|
| SC-001 | Consultants manage clients | 50+ tenants/consultant | Tenant associations |
| SC-002 | Context switch latency | <2s at P95 | API response time |
| SC-007 | Permission check latency | <10ms at P99 | OpenTelemetry |
| SC-008 | Cache hit rate | >95% | Redis statistics |
| SC-010 | Cross-tenant leakage | 0 incidents | Penetration testing |
| SC-013 | Permission checks logged | 100% | Code coverage |
| SC-016 | ARPA audit export time | <10 minutes | Manual test |
| SC-019 | Enterprise conversion | 5% → 20% | Sales metrics |
| SC-020 | Admin time on access mgmt | <1 hour/week | User survey |
| SC-021 | Temp grant approval time | 70% <30 min | Audit log analysis |

---

## Security Highlights

### 1. JWT Token Security
- **Algorithm**: RS256 (asymmetric)
- **Expiration**: 1 hour access token, 7-day refresh token
- **Claims**: userId, tenantId, fiscalCode, roles, permissions
- **Validation**: Signature, expiration, tenant context match

### 2. Cache Poisoning Prevention
- HMAC-SHA256 signature on all cached permissions
- Invalid signature → cache miss, re-fetch from database
- Signature key rotated quarterly

### 3. Self-Assignment Protection
- Elevated roles cannot be self-assigned
- Attempts logged as security events
- Admin receives alert for investigation

### 4. SPID Re-Authentication
- High-risk operations (delete, approve, sign) require fresh SPID auth
- Session age checked: must be <15 minutes old
- Clear UX: "This action requires recent authentication"

### 5. Cross-Tenant Isolation
- 3-layer defense: schema separation, RLS, response scrubbing
- Automated penetration testing
- Zero tolerance for leakage incidents

---

## Implementation Roadmap

### Phase 1: Core RBAC Foundation (Weeks 1-2)
- Prisma schema: Role, Permission, UserRole entities
- Domain entities (DDD): Role aggregate, permission value objects
- Use cases: CreateRole, AssignRole, RevokeRole (TDD)
- NestJS controllers: `/roles`, `/users/{id}/roles`
- JWT guard integration

### Phase 2: Permission Caching & Performance (Week 3)
- Redis permission cache with HMAC signatures
- Cache invalidation pub/sub
- In-memory LRU fallback cache
- Performance benchmarking (<10ms P99)

### Phase 3: Audit Logging (Week 4)
- PermissionAuditLog entity with monthly partitioning
- Async audit writer (BullMQ)
- Audit query API with advanced filters
- Export to CSV functionality

### Phase 4: Custom Roles (Enterprise) (Week 5)
- Custom role creation use case
- Permission matrix validation
- Enterprise tier gating
- Frontend permission matrix builder UI

### Phase 5: Consultant Multi-Tenant (Week 6)
- Tenant association data model
- Switch tenant context use case
- Aggregated dashboard (fan-out queries)
- JWT regeneration with new tenant claim

### Phase 6: Temporary Permissions (Week 7)
- TemporaryPermissionGrant entity
- Request/approve/deny workflow
- Auto-expiration background job (every 5 min)
- Notification integration

### Phase 7: Mobile Optimization (Week 8)
- Mobile-responsive role cards (PrimeNG)
- Touch-friendly permission matrix (48px targets)
- Offline permission caching (24h TTL)
- WCAG 2.1 AA compliance

### Phase 8: Security Hardening & Launch (Weeks 9-10)
- Penetration testing (cross-tenant isolation)
- SPID re-authentication for sensitive operations
- Load testing: 10,000 requests/second
- Runbook: cache clear, audit export procedures

---

## Technology Stack

### Backend
- **Framework**: NestJS 10.3 (TypeScript 5.2+)
- **ORM**: Prisma 5.8 (PostgreSQL 16)
- **Cache**: Redis 7 (ioredis client)
- **Jobs**: BullMQ (background tasks)
- **Auth**: JWT with RS256 (passport-jwt)
- **Testing**: Jest (TDD, 100% coverage target)
- **Monitoring**: OpenTelemetry + Grafana

### Frontend
- **Framework**: Angular 17 (standalone components)
- **UI Library**: PrimeNG 17
- **State**: NgRx 17
- **HTTP**: Angular HttpClient with interceptors

### Infrastructure
- **Database**: PostgreSQL 16 (schema-per-tenant + RLS)
- **Cache**: Redis 7 (cluster mode)
- **Storage**: AWS S3 (audit archival)
- **Email**: AWS SES (notifications)
- **Monitoring**: Prometheus + Grafana
- **Logging**: Winston → CloudWatch

---

## Getting Started

### For Backend Developers
1. Read `QUICK_START.md` for implementation guide
2. Review `openapi.yaml` for endpoint contracts
3. Study `API_DESIGN_NOTES.md` for architectural context
4. Reference existing `fir.controller.ts` for patterns
5. Start with Phase 1 implementation (Core RBAC)

### For Frontend Developers
1. Review `openapi.yaml` endpoints
2. Generate TypeScript client: `npx openapi-generator-cli generate -i openapi.yaml -g typescript-axios`
3. Implement Angular service wrapping API client
4. Add NgRx state management for permissions
5. Build UI components (role cards, permission matrix)

### For QA Engineers
1. Review `spec.md` for acceptance scenarios
2. Use `openapi.yaml` for API test case generation
3. Implement E2E tests covering 7 user stories
4. Performance testing: k6 scripts for <10ms P99 target
5. Security testing: cross-tenant isolation validation

### For DevOps/SRE
1. Review `API_DESIGN_NOTES.md` monitoring section
2. Set up Grafana dashboards (performance, security, business KPIs)
3. Configure PagerDuty alerts (critical: P99 >50ms, cross-tenant leakage)
4. Implement Redis cluster for high availability
5. Set up PostgreSQL partitioning strategy (monthly)

---

## Testing the API

### Interactive API Documentation
```bash
# Start Swagger UI
npx @redocly/openapi-cli preview-docs openapi.yaml
# Open browser: http://localhost:8080
```

### Generate Postman Collection
```bash
# Convert OpenAPI to Postman
npx openapi-to-postmanv2 -s openapi.yaml -o wasteflow-permissions.postman.json
# Import into Postman
```

### Example cURL Requests

**Get User Permissions**:
```bash
curl -X GET https://api.wasteflow.it/v1/permissions/my-permissions \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json"
```

**Check Permission**:
```bash
curl -X POST https://api.wasteflow.it/v1/permissions/check \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "permission": "fir:create:facility",
    "resourceId": null,
    "context": {}
  }'
```

**Assign Role**:
```bash
curl -X POST https://api.wasteflow.it/v1/users/{userId}/roles \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "role-uuid-operator",
    "facilityIds": [],
    "reason": "New employee onboarding"
  }'
```

---

## Monitoring & Alerts

### Key Metrics to Track

**Performance**:
- `permission_check_duration_ms` (histogram) → Alert if P99 >20ms
- `permission_cache_hit_rate` (gauge) → Alert if <90%
- `audit_log_write_lag_ms` (histogram) → Alert if P99 >2000ms

**Security**:
- `permission_denied_by_action` (counter) → Monitor for patterns
- `cross_tenant_access_attempts` (counter) → Alert if >0
- `self_assignment_attempts` (counter) → Alert immediately

**Business**:
- `consultant_context_switches_total` (counter)
- `temporary_grants_pending` (gauge)
- `support_tickets_permission_related` (external) → Target <5/week

### Grafana Dashboards
1. **Performance Dashboard**: Latency, cache hit rate, request rate
2. **Security Dashboard**: Denied attempts, anomalies, auth failures
3. **Business KPI Dashboard**: Active consultants, approval times, tickets

---

## Troubleshooting

### Common Issues

**Issue**: Permission checks slow (>50ms)
**Solution**: Check Redis connectivity, cache hit rate, database indexes

**Issue**: Cache not invalidating after role change
**Solution**: Verify Redis pub/sub working, check subscription logs

**Issue**: Cross-tenant data appearing
**Solution**: Check JWT tenantId claim, verify RLS policies, review response scrubbing

**Issue**: Temporary grant not expiring
**Solution**: Verify BullMQ job running every 5 minutes, check job logs

**Debug Commands**:
```bash
# Check Redis cache
redis-cli GET "perm:<tenantId>:<userId>:v1"

# Clear user cache
redis-cli DEL "perm:<tenantId>:<userId>:*"

# Check permission check audit logs
curl -X GET "https://api.wasteflow.it/v1/audit/permissions?userId=<uuid>&dateFrom=<1h-ago>"
```

---

## Additional Resources

- **OpenAPI Spec Viewer**: https://api.wasteflow.it/docs
- **Developer Portal**: https://developers.wasteflow.it
- **Slack Support**: #api-platform (internal)
- **Bug Reports**: GitHub Issues
- **Security Issues**: security@wasteflow.it

---

## Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-10-31 | 1.0 | Initial API design complete | Platform Engineering |

---

## Next Steps

1. **Review**: Schedule design review with team (backend, frontend, security, QA)
2. **Approval**: Get sign-off from Product and Engineering leads
3. **Kick-off**: Start Phase 1 implementation (Weeks 1-2)
4. **Spike**: Performance testing spike for <10ms P99 validation
5. **Sync**: Weekly progress reviews with stakeholders

---

**Questions?** Contact Platform Engineering Team
**Email**: platform-eng@wasteflow.it
**Slack**: #backend-dev

---

**Last Updated**: 2025-10-31
**Status**: ✅ Design Complete - Ready for Implementation
