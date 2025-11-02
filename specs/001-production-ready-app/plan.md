# Implementation Plan: Production-Ready Web Application

**Branch**: `001-production-ready-app` | **Date**: 2025-10-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-production-ready-app/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

WasteFlow production-ready web application implementing complete RENTRI integration, SPID/CIE authentication with digital signatures, real-time analytics dashboard, notification system, enhanced PDF export, multi-tenant consultant features, MUD reporting, and operational monitoring with automated backups. Technical approach: NestJS backend with Prisma ORM on PostgreSQL 16 (multi-tenant schema-per-tenant), Angular 17 frontend with PrimeNG components, Redis for caching and BullMQ queues, AWS infrastructure (ECS Fargate, RDS, ElastiCache, S3), SPID SAML 2.0 integration, digital signatures using ECDSA-SHA256, WebSocket for real-time dashboard updates.

## Technical Context

**Language/Version**: TypeScript 5.2+ (Backend: Node.js 20 LTS, Frontend: Angular 17)
**Primary Dependencies**:
- Backend: NestJS 10.3, Prisma 5.8, BullMQ, passport-saml, node-forge (signatures), PDFKit (exports)
- Frontend: Angular 17 (standalone components), PrimeNG 17, NgRx 17 (state), Chart.js, Leaflet
**Storage**: PostgreSQL 16 (multi-tenant with Row-Level Security), Redis 7 (cache + queue), AWS S3 (backups + documents)
**Testing**: Jest (backend unit/integration), Playwright (E2E), Supertest (API), Jasmine/Karma (frontend unit)
**Target Platform**: AWS Cloud (ECS Fargate containers), Linux Docker images, modern browsers (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
**Project Type**: Web application (full-stack monorepo with separate backend/frontend apps)
**Performance Goals**:
- API: 1000 concurrent users, p95 <500ms, p99 <1000ms
- Dashboard: <2s page load (desktop), <4s (mobile)
- RENTRI sync: <5s end-to-end per FIR
- PDF generation: <3s per document
**Constraints**:
- 99.9% uptime SLA (max 43 min downtime/month)
- Multi-tenant data isolation (no cross-tenant leaks)
- GDPR compliance (encryption at rest/transit, audit logs 7 years)
- SPID Level 2 minimum for legal signatures
- Mobile responsive (PrimeNG adaptive components)
**Scale/Scope**:
- 5,000 tenants by M24 (Master Plan target)
- 10,000+ FIRs/month across platform
- 50+ client tenants per consultant user
- 30-day backup retention with point-in-time restore

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Constitution Version**: 1.1.0 (2025-10-30)

### I. Test-Driven Development (NON-NEGOTIABLE) ✅ PASS
- **Requirement**: Tests MUST be written BEFORE implementation code
- **Status**: PASS - Existing codebase shows TDD approach (100% domain coverage per README.md)
- **Plan**: Continue TDD for all new features (RENTRI sync, signatures, notifications, etc.)
- **Verification**: Pre-commit hooks enforce test coverage ≥80% lines, ≥75% branches

### II. Domain-Driven Design ✅ PASS
- **Requirement**: Domain layer isolated, 100% test coverage
- **Status**: PASS - Domain layer exists (`User`, `FIR` aggregates, value objects per README)
- **Plan**: Add new aggregates (`RENTRISyncLog`, `DigitalSignature`, `Notification`, `MUDReport`)
- **Verification**: Domain entities in `apps/backend/src/domain/`, zero infrastructure dependencies

### III. Library-First & API-First Architecture ✅ PASS
- **Requirement**: Features as standalone libraries, OpenAPI 3.0, webhooks, SDKs
- **Status**: PASS - Architecture supports library extraction, Swagger docs at `/api/docs`
- **Plan**: RENTRI client as library, signature service as library, notification service as library
- **Verification**: Each service independently testable, OpenAPI spec published

### IV. Integration Testing ✅ PASS
- **Requirement**: Contract tests for boundaries, multi-tenant isolation tests
- **Status**: PASS - Test infrastructure exists (Jest, Supertest per README)
- **Plan**: Add integration tests for:
  - RENTRI API contract (mock server)
  - SPID SAML flow (test IdP)
  - Multi-tenant RLS enforcement
  - WebSocket real-time updates
- **Verification**: `apps/backend/test/` contains integration test suites

### V. Observability & Monitoring ✅ PASS
- **Requirement**: Structured logging, correlation IDs, tenant-scoped metrics, SLA monitoring
- **Status**: PASS - Plan includes monitoring dashboard (User Story 9), health checks (FR-054 to FR-058)
- **Plan**: Implement:
  - Structured Winston logger with correlation IDs
  - CloudWatch metrics + Grafana dashboards
  - Alert thresholds (error rate >5%, response time >500ms p95)
  - Tenant-scoped metrics (per-tenant usage, error rates)
- **Verification**: Admin monitoring dashboard functional (FR-054), alert emails configured (FR-055)

### VI. Versioning & Breaking Changes ✅ PASS
- **Requirement**: Semantic versioning, 6-month deprecation for public APIs
- **Status**: PASS - API versioning planned (`/api/v1/...`), Prisma migrations reversible
- **Plan**: Version all public endpoints, maintain changelog, migration guides for breaking changes
- **Verification**: API routes prefixed with `/api/v1/`, migration rollback tested

### VII. Simplicity & YAGNI ✅ PASS
- **Requirement**: MVP-first, P1 stories before P2/P3, justify complexity
- **Status**: PASS - Spec prioritizes user stories (P1: RENTRI/SPID/signatures, P2: analytics/notifications, P3: MUD/multi-tenant)
- **Plan**: Implement in priority order, avoid premature abstractions
- **Verification**: Complexity Tracking table documents any violations with justification

### VIII. Mobile-First Development ⚠️ PARTIAL
- **Requirement**: Offline-first, 60fps, touch-optimized (60x60px glove targets), field-tested
- **Status**: PARTIAL - Spec mentions "mobile responsive" (FR-027) but not offline-first or native app
- **Plan**:
  - **Phase 1 (Current)**: Responsive web via PrimeNG adaptive components
  - **Phase 2 (Future)**: Flutter mobile app per Master Plan Phase 3 (M7-M9)
- **Gap**: No offline-first capability in current spec (deferred to mobile app phase)
- **Justification**: MVP focuses on web dashboard first; mobile native app planned for Sprint 5 per README roadmap
- **Verification**: PrimeNG breakpoints tested on mobile browsers, touch targets ≥48px

### IX. Multi-Tenancy Architecture ✅ PASS
- **Requirement**: Schema-per-tenant, tenant context propagation, RLS enforcement, tenant-aware testing
- **Status**: PASS - Spec explicitly requires multi-tenant (User Story 7, FR-042 to FR-047)
- **Plan**: Implement:
  - Schema-per-tenant via Prisma namespaces
  - Tenant ID in JWT claims, propagated via NestJS interceptor
  - PostgreSQL Row-Level Security policies
  - Tenant isolation integration tests
- **Verification**: Zero cross-tenant data leakage in security tests (SC-014), consultant can manage 50+ clients (SC-015)

### Performance Standards ✅ PASS
- **Requirement**: 99.9% uptime, p95 <500ms, Lighthouse ≥90
- **Status**: PASS - Performance goals defined in Technical Context, success criteria (SC-010 to SC-013)
- **Plan**: Load testing with k6, CloudWatch monitoring, Lighthouse CI checks
- **Verification**: SC-011 (p95 <500ms), SC-012 (99.9% uptime), SC-006 (dashboard <2s)

### Security & Compliance ✅ PASS
- **Requirement**: SPID/CIE auth, multi-tenant RLS, GDPR compliance, AES-256 encryption, 7-year audit logs
- **Status**: PASS - SPID/CIE required (User Story 2, FR-008 to FR-014), GDPR compliance (FR-064), encryption (FR-060)
- **Plan**:
  - SPID SAML 2.0 via passport-saml
  - AES-256 backup encryption before S3 upload
  - 7-year audit log retention
  - Annual penetration testing
- **Verification**: SC-002 (zero SPID failures), SC-014 (100% tenant isolation), FR-005 (RENTRI audit logs)

### Development Workflow ✅ PASS
- **Requirement**: CI checks (tests, coverage, linting, security), 2 approvals, 2x/week deploys, MTTR <2h
- **Status**: PASS - README describes workflow (ESLint, Prettier, test coverage thresholds)
- **Plan**: GitHub Actions CI/CD, Snyk security scans, Husky pre-commit hooks
- **Verification**: README.md documents quality gates, CI fail if coverage <80%

---

**Constitution Check Result**: **PASS with 1 PARTIAL (Mobile-First deferred to Phase 2)**

**Complexity Tracking**: See table below for Mobile-First justification.

## Project Structure

### Documentation (this feature)

```
specs/001-production-ready-app/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (RENTRI API, SPID providers, signature algorithms)
├── data-model.md        # Phase 1 output (RENTRISyncLog, DigitalSignature, Notification entities)
├── quickstart.md        # Phase 1 output (local dev setup, RENTRI sandbox, SPID test IdP)
├── contracts/           # Phase 1 output (OpenAPI specs for RENTRI, SPID, dashboard APIs)
│   ├── rentri-api.yaml
│   ├── spid-auth.yaml
│   ├── dashboard-api.yaml
│   ├── notifications-api.yaml
│   └── admin-api.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

**Structure Decision**: Web application (Option 2) - Monorepo with separate backend (NestJS) and frontend (Angular) apps as documented in existing README.md.

```
rifiuti/  (repository root)
├── apps/
│   ├── backend/                      # NestJS Backend API
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # Multi-tenant schema with RLS
│   │   │   └── migrations/           # Versioned database migrations
│   │   ├── src/
│   │   │   ├── domain/               # DDD Domain Layer (100% coverage)
│   │   │   │   ├── auth/
│   │   │   │   │   ├── entities/     # User aggregate
│   │   │   │   │   └── value-objects/ # Email, FiscalCode
│   │   │   │   ├── fir/
│   │   │   │   │   ├── aggregates/   # FIR aggregate
│   │   │   │   │   └── value-objects/ # Quantita, CERCode
│   │   │   │   ├── rentri/           # NEW: RENTRI domain
│   │   │   │   │   ├── entities/     # RENTRISyncLog, SyncAttempt
│   │   │   │   │   └── value-objects/ # SyncStatus
│   │   │   │   ├── signatures/       # NEW: Digital signatures domain
│   │   │   │   │   ├── entities/     # DigitalSignature
│   │   │   │   │   └── value-objects/ # SignatureHash, SPIDLevel
│   │   │   │   ├── notifications/    # NEW: Notifications domain
│   │   │   │   │   ├── entities/     # Notification, Alert
│   │   │   │   │   └── value-objects/ # NotificationType, Severity
│   │   │   │   └── reporting/        # NEW: MUD reporting domain
│   │   │   │       ├── entities/     # MUDReport, ReportSection
│   │   │   │       └── value-objects/ # ReportYear, WasteAggregate
│   │   │   ├── application/          # Use Cases (CQRS commands/queries)
│   │   │   │   ├── rentri/
│   │   │   │   │   ├── commands/     # SyncFIRCommand, RetryFailedSyncsCommand
│   │   │   │   │   └── queries/      # GetSyncStatusQuery, GetFailedSyncsQuery
│   │   │   │   ├── signatures/
│   │   │   │   │   ├── commands/     # SignFIRCommand, VerifySignatureCommand
│   │   │   │   │   └── queries/      # GetSignatureHistoryQuery
│   │   │   │   ├── notifications/
│   │   │   │   │   ├── commands/     # CreateNotificationCommand, DismissNotificationCommand
│   │   │   │   │   └── queries/      # GetUserNotificationsQuery
│   │   │   │   └── reporting/
│   │   │   │       ├── commands/     # GenerateMUDCommand, ExportMUDCommand
│   │   │   │       └── queries/      # GetMUDDataQuery, GetReportStatusQuery
│   │   │   ├── infrastructure/       # Infrastructure Layer
│   │   │   │   ├── persistence/
│   │   │   │   │   ├── prisma/       # Prisma repositories
│   │   │   │   │   └── redis/        # Redis cache client
│   │   │   │   ├── external/
│   │   │   │   │   ├── rentri-client.ts  # RENTRI API HTTP client
│   │   │   │   │   ├── spid-saml.ts      # SPID SAML provider
│   │   │   │   │   └── s3-storage.ts     # AWS S3 client (backups/PDFs)
│   │   │   │   ├── queues/
│   │   │   │   │   ├── rentri-sync.queue.ts    # BullMQ RENTRI sync jobs
│   │   │   │   │   ├── notifications.queue.ts  # Notification delivery jobs
│   │   │   │   │   └── backups.queue.ts        # Automated backup jobs
│   │   │   │   └── logging/
│   │   │   │       └── winston-logger.ts       # Structured logging
│   │   │   ├── api/                  # Controllers & DTOs (REST API)
│   │   │   │   ├── health/           # Health check endpoints
│   │   │   │   ├── auth/             # SPID/CIE authentication
│   │   │   │   ├── fir/              # FIR CRUD + signature
│   │   │   │   ├── dashboard/        # Dashboard KPIs + analytics
│   │   │   │   ├── notifications/    # Notification endpoints
│   │   │   │   ├── reporting/        # MUD generation + export
│   │   │   │   └── admin/            # Monitoring + backups
│   │   │   ├── core/                 # Shared utilities
│   │   │   │   ├── domain/
│   │   │   │   │   ├── aggregate-root.ts
│   │   │   │   │   └── errors.ts
│   │   │   │   ├── decorators/
│   │   │   │   │   ├── current-user.decorator.ts
│   │   │   │   │   └── current-tenant.decorator.ts
│   │   │   │   └── interceptors/
│   │   │   │       ├── tenant-context.interceptor.ts
│   │   │   │       └── logging.interceptor.ts
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── test/                     # E2E tests (Supertest + Playwright)
│   │   │   ├── rentri-integration.e2e-spec.ts
│   │   │   ├── spid-auth.e2e-spec.ts
│   │   │   ├── multi-tenant-isolation.e2e-spec.ts
│   │   │   └── dashboard-realtime.e2e-spec.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── frontend/                     # Angular 17 Frontend
│       ├── src/
│       │   ├── app/
│       │   │   ├── core/             # Singleton services, guards
│       │   │   │   ├── auth/         # SPID auth service, guards
│       │   │   │   ├── tenant/       # Tenant context service
│       │   │   │   └── api/          # HTTP interceptors
│       │   │   ├── shared/           # Shared components, pipes, directives
│       │   │   │   ├── components/   # Reusable UI components
│       │   │   │   ├── design-system/ # PrimeNG theme customization
│       │   │   │   └── models/       # TypeScript interfaces (from OpenAPI)
│       │   │   ├── features/         # Feature modules (lazy-loaded)
│       │   │   │   ├── dashboard/
│       │   │   │   │   ├── components/
│       │   │   │   │   │   ├── kpi-cards/
│       │   │   │   │   │   ├── waste-chart/
│       │   │   │   │   │   └── cost-trend-chart/
│       │   │   │   │   ├── pages/
│       │   │   │   │   │   └── dashboard.page.ts
│       │   │   │   │   └── state/    # NgRx feature store
│       │   │   │   ├── fir/
│       │   │   │   │   ├── components/
│       │   │   │   │   │   ├── fir-wizard/
│       │   │   │   │   │   └── signature-modal/
│       │   │   │   │   └── pages/
│       │   │   │   ├── notifications/
│       │   │   │   │   ├── components/
│       │   │   │   │   │   ├── notification-bell/
│       │   │   │   │   │   └── alerts-list/
│       │   │   │   │   └── state/
│       │   │   │   ├── reporting/    # MUD module
│       │   │   │   │   ├── components/
│       │   │   │   │   └── pages/
│       │   │   │   └── admin/        # Monitoring + backups
│       │   │   │       ├── components/
│       │   │   │       └── pages/
│       │   │   ├── app.component.ts
│       │   │   └── app.routes.ts     # Standalone component routing
│       │   ├── assets/
│       │   ├── styles/               # Global SCSS + PrimeNG theme
│       │   └── environments/
│       ├── package.json
│       └── angular.json
│
├── libs/                             # Shared libraries (future extraction)
│   ├── rentri-client/                # Standalone RENTRI API library
│   ├── signature-service/            # Digital signature library
│   └── notification-engine/          # Notification library
│
├── docs/                             # Project documentation
│   ├── architecture/
│   ├── api/                          # OpenAPI specs (generated)
│   └── deployment/
│
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Test + lint + coverage
│       ├── cd-staging.yml            # Deploy to staging
│       └── cd-production.yml         # Deploy to production
│
├── package.json                      # Root package.json (workspaces)
├── .eslintrc.json
├── .prettierrc
├── docker-compose.yml                # Local dev environment (PostgreSQL + Redis)
└── README.md
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| **VIII. Mobile-First Development** - Offline-first capability deferred | MVP focuses on web dashboard for desktop users (environmental managers, consultants). Offline-first requires significant architecture (local SQLite, sync queue, conflict resolution) that adds 4-6 weeks to timeline. | Pure web-first approach allows faster MVP delivery (M3 per README roadmap). Mobile native app with offline-first planned for Sprint 5 (M7-M9 per Master Plan Phase 3). Responsive web via PrimeNG satisfies "mobile accessible" requirement without full offline capability. Business priority: prove RENTRI sync + SPID auth value first, then add mobile native. |

