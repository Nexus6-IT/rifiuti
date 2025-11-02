<!--
  SYNC IMPACT REPORT
  ==================
  Version Change: 1.0.0 → 1.1.0
  Change Type: MINOR (New principles added from Master Development Plan analysis)

  Principles Modified:
  - III. Library-First Architecture → Enhanced to include API-First strategy (marketplace ecosystem)

  Principles Added:
  - VIII. Mobile-First Development (offline-first field operations)
  - IX. Multi-Tenancy Architecture (core business model)

  New Sections Added:
  - Performance Standards (measurable SLA targets)

  Templates Requiring Updates:
  ✅ plan-template.md - Constitution Check section includes new principles
  ✅ spec-template.md - User stories align with mobile-first and multi-tenancy
  ✅ tasks-template.md - Task ordering reflects mobile and tenant isolation

  Follow-up TODOs:
  - Consider adding mobile-specific testing requirements to QA workflows
  - Document multi-tenancy testing patterns in integration test guidelines

  Last Updated: 2025-10-30
  Rationale: Master Development Plan (MASTER_DEVELOPMENT_PLAN.md) analysis revealed three critical
            architectural principles missing from v1.0.0 that are foundational to the 2025-2027
            product vision: Mobile-first as competitive differentiator, Multi-tenancy as business
            model foundation, and API-first for ecosystem/marketplace strategy.
-->

# WasteFlow Constitution

## Core Principles

### I. Test-Driven Development (NON-NEGOTIABLE)

Test-Driven Development is the **mandatory** foundation of all WasteFlow development. No exceptions.

**Rules**:
- Tests MUST be written BEFORE implementation code
- Red-Green-Refactor cycle MUST be strictly enforced:
  1. **RED**: Write a failing test that defines the desired behavior
  2. **GREEN**: Write the minimum code to make the test pass
  3. **REFACTOR**: Improve code quality while keeping tests green
- All code changes MUST have corresponding tests written first
- Tests MUST fail initially to prove they test the intended behavior
- User approval of test scenarios is REQUIRED before implementation begins

**Rationale**: TDD ensures code correctness, prevents regressions, enables confident refactoring, and serves as living documentation. For a compliance-critical platform managing legal waste documentation (FIR, RENTRI), bugs are unacceptable and can result in legal penalties for customers.

### II. Domain-Driven Design

All domain logic MUST follow Domain-Driven Design principles to maintain a clear, testable, and maintainable business logic layer.

**Rules**:
- Domain layer MUST be isolated from infrastructure concerns
- Use Aggregates for entities with business rules (e.g., `FIR`, `User`, `Tenant`)
- Use Value Objects for immutable domain concepts (e.g., `Email`, `Quantita`, `CERCode`)
- Domain Events MUST capture significant business occurrences (e.g., `FIREmessoEvent`, `UserCreatedEvent`)
- Repositories MUST abstract data persistence
- Use Cases contain application logic and orchestrate domain objects
- Domain layer MUST achieve 100% test coverage

**Rationale**: DDD ensures business logic remains testable, framework-agnostic, and aligned with domain expert language. The waste management domain has complex legal and regulatory rules that must be modeled precisely.

### III. Library-First & API-First Architecture

Features MUST be developed as standalone, reusable libraries with well-defined public APIs before integration into applications.

**Rules**:
- Every feature starts as a self-contained library
- Libraries MUST be independently testable without application context
- Libraries MUST be documented with clear purpose and usage examples
- Libraries expose functionality via well-defined interfaces
- No organizational-only libraries (every library must have clear functional purpose)
- Libraries MUST support both programmatic API and CLI interfaces where applicable
- **Public APIs** MUST follow OpenAPI 3.0 specification with versioning
- **API-first development**: Design API contracts before implementation
- **Webhook support**: Event-driven integrations for ecosystem partners
- **SDK availability**: Provide JavaScript and Python SDKs for public API

**Rationale**: Library-first architecture enables reusability across web, mobile, and future interfaces; simplifies testing; and enforces clear boundaries between components. API-first strategy enables ecosystem building (ERP integrations, marketplace, third-party apps) which is a critical competitive moat per Master Development Plan Phase 4-5.

### IV. Integration Testing

Focus integration tests on contracts, communication boundaries, and cross-service interactions.

**Rules**:
- Integration tests are REQUIRED for:
  - New library contract tests
  - Contract changes between components
  - External service communication (RENTRI API, SPID, S3)
  - Shared schema validation
  - Database interactions via repositories
  - Multi-tenant data isolation (tenant boundary tests)
- Integration tests MUST verify actual behavior, not mocks
- Use test databases and containerized dependencies for integration tests
- Integration tests run in CI before deployment

**Rationale**: Unit tests verify isolated behavior; integration tests ensure components work together correctly. RENTRI synchronization, SPID authentication, and multi-tenant data isolation are critical integration points that must be tested.

### V. Observability & Monitoring

All components MUST support comprehensive observability for debugging, monitoring, and compliance auditing.

**Rules**:
- Structured logging is REQUIRED for all business operations
- Logs MUST include correlation IDs for request tracing
- All FIR state transitions MUST be logged with timestamps and actor IDs
- RENTRI synchronization operations MUST be logged with success/failure status
- Error logs MUST include sufficient context for debugging
- Logs MUST NOT contain sensitive personal data (GDPR compliance)
- Application metrics MUST be exposed for monitoring (response times, queue depths, error rates)
- **Tenant-scoped metrics**: Track per-tenant usage, performance, and errors
- **SLA monitoring**: Real-time dashboards for 99.9% uptime target

**Rationale**: Observability enables rapid incident response, compliance auditing, and debugging production issues. Waste management operations are legally auditable and require complete traceability. Multi-tenant architecture requires tenant-scoped monitoring for customer SLAs.

### VI. Versioning & Breaking Changes

API and library versioning MUST follow semantic versioning with clear migration paths for breaking changes.

**Rules**:
- Use MAJOR.MINOR.PATCH versioning format
- MAJOR: Breaking changes (incompatible API changes, removed features)
- MINOR: New features, backward-compatible additions
- PATCH: Bug fixes, clarifications, non-functional improvements
- Breaking changes REQUIRE migration guides and deprecation notices
- Maintain backward compatibility for at least one MAJOR version where possible
- Database migrations MUST be reversible
- **API versioning**: Use URL versioning (e.g., `/api/v1/fir`, `/api/v2/fir`)
- **Deprecation period**: Minimum 6 months notice for public API breaking changes

**Rationale**: WasteFlow serves multiple tenants who depend on API stability. Breaking changes without migration support disrupt customer operations and compliance workflows. Public API ecosystem partners require stability guarantees.

### VII. Simplicity & YAGNI

Start with the simplest solution that solves the problem. Add complexity only when requirements demand it.

**Rules**:
- YAGNI (You Aren't Gonna Need It) principle applies to all design decisions
- Prefer simple, direct implementations over abstract, extensible architectures
- Justify complexity in Complexity Tracking (see Governance section)
- Avoid premature optimization
- Prefer composition over inheritance
- Avoid introducing patterns or abstractions without concrete current need
- **MVP-first approach**: Implement P1 user stories before P2/P3 features
- **Progressive enhancement**: Ship minimal viable features, iterate based on feedback

**Rationale**: Complexity increases maintenance cost, onboarding time, and bug surface area. Simple code is easier to test, understand, and modify. Complexity must earn its place by solving real problems. Master Development Plan emphasizes MVP → PMF → Growth → Scale progression.

### VIII. Mobile-First Development

Mobile applications MUST be treated as first-class citizens with offline-first architecture and native performance.

**Rules**:
- **Offline-first design**: All critical workflows MUST function without network connectivity
- **Progressive sync**: Queue operations locally, sync when online with conflict resolution
- **Touch-optimized UX**: Minimum 48x48px touch targets (60x60px for glove-friendly operations)
- **Native performance**: Target 60fps animations, <100ms input response
- **Platform conventions**: Follow iOS Human Interface Guidelines and Material Design
- **Field-tested**: Test mobile apps in actual field conditions (offline, poor connectivity, sunlight, gloves)
- **Mobile-specific features**: GPS tracking, QR scanning, camera capture, digital signatures
- **Responsive web**: PWA for citizen app, native Flutter for collector app

**Rationale**: Field operations (waste collectors, drivers) require mobile-first design with offline capabilities. Mobile app is a critical competitive differentiator per Master Development Plan. 50% mobile adoption target by M12, 70% by M24. Poor mobile UX results in feature abandonment and customer churn.

### IX. Multi-Tenancy Architecture

Multi-tenancy MUST be designed at the architectural level, not retrofitted, with complete data isolation and tenant-scoped operations.

**Rules**:
- **Schema-per-tenant strategy**: Each tenant has isolated PostgreSQL schema for GDPR compliance
- **Tenant context propagation**: All requests carry tenant ID from authentication through to database
- **Tenant isolation enforcement**: Row-Level Security (RLS) policies prevent cross-tenant data access
- **Tenant-scoped operations**: Repositories, queries, and business logic MUST filter by tenant ID
- **Performance isolation**: Resource quotas and rate limiting per tenant
- **Tenant-aware testing**: Integration tests MUST verify multi-tenant isolation
- **Billing per tenant**: Track usage, limits, and features by tenant for SaaS pricing tiers
- **Tenant onboarding**: Automated provisioning of tenant schema and seed data

**Rationale**: Multi-tenancy is the core business model (consultants managing N clients, B2B SaaS tiers). Data isolation is legally required for GDPR compliance. Cross-tenant data leaks are catastrophic security breaches. Schema-per-tenant provides backup/restore granularity and performance isolation. Master Development Plan targets 5,000 tenants by M24.

## Performance Standards

WasteFlow targets enterprise customers with strict SLA requirements. Performance is non-negotiable.

**Targets**:
- **API uptime**: 99.9% (max 43 minutes downtime/month)
- **API response time**: p95 <500ms, p99 <1000ms
- **Page load time**: <2s (First Contentful Paint)
- **Time to Interactive**: <3s
- **Mobile app responsiveness**: <100ms input response, 60fps animations
- **Lighthouse score**: ≥90 (Performance, Accessibility, Best Practices, SEO)
- **Database query performance**: <100ms p95 for OLTP queries
- **RENTRI sync latency**: <5s end-to-end for FIR submission

**Monitoring**:
- Real-time performance dashboards (Grafana + CloudWatch)
- Automated alerts for SLA violations
- Weekly performance reviews with stakeholder reporting
- Load testing before production deployment (target: 1000 concurrent users)

**Rationale**: Enterprise customers require predictable performance for compliance operations. Slow performance results in user frustration, feature abandonment, and churn. Performance targets align with Master Development Plan M12 objectives and competitive positioning against legacy systems.

## Security & Compliance

WasteFlow handles legally significant documents and personal data. Security and compliance are non-negotiable.

**Rules**:
- All authentication MUST use SPID/CIE for legally valid digital signatures
- Multi-tenant data isolation MUST be enforced at database level (Row-Level Security)
- Personal data handling MUST comply with GDPR (data minimization, right to erasure, audit logs)
- FIR documents MUST be immutable after emission (no deletion, only annulment with audit trail)
- All RENTRI synchronization MUST maintain audit logs for compliance verification
- Secrets MUST NOT be committed to version control
- Database credentials and API keys MUST be managed via environment variables or secure vaults
- **Encryption**: AES-256 at rest, TLS 1.3 in transit
- **Audit logging**: 7 years retention for compliance (legal requirement)
- **Penetration testing**: Annual third-party security audits
- **OWASP Top 10 coverage**: Automated security scans in CI/CD pipeline

**Rationale**: Non-compliance with GDPR results in severe fines (up to €20M or 4% annual revenue). Invalid FIR documents or RENTRI submissions expose customers to legal penalties. Security breaches compromise customer trust and legal documents. Multi-tenant data leaks are catastrophic.

## Development Workflow

Code quality gates ensure consistency and prevent regressions.

**Rules**:
- All PRs MUST pass CI checks:
  - All tests passing (unit + integration + E2E)
  - Test coverage ≥80% lines, ≥75% branches (Domain layer requires 100%)
  - Linting and formatting (ESLint + Prettier)
  - Security scans (Snyk, Trivy)
- Code reviews REQUIRE 2 approvals before merge
- TDD compliance MUST be verified in code reviews (tests written before implementation)
- Breaking changes REQUIRE explicit approval and migration plan
- Main branch MUST always be deployable
- Feature branches MUST be short-lived (max 3 days before merge or rebase)
- **Deployment frequency**: 2x/week to production (continuous delivery)
- **MTTR target**: <2 hours (Mean Time To Recovery)

**Rationale**: Automated quality gates prevent bugs from reaching production. Code reviews distribute knowledge and catch design issues. Short-lived branches reduce merge conflicts and integration risk. Continuous delivery enables rapid iteration and bug fixes.

## Governance

**Amendment Procedure**:
- Constitution amendments REQUIRE documentation of rationale and impact
- Proposed amendments MUST be reviewed by tech lead and product owner
- MAJOR amendments (principle removal, redefinition) require team consensus
- All amendments MUST update dependent templates (plan-template.md, spec-template.md, tasks-template.md)

**Versioning Policy**:
- MAJOR: Backward incompatible governance changes, principle removal/redefinition
- MINOR: New principles added, materially expanded guidance
- PATCH: Clarifications, wording improvements, typo fixes

**Compliance Verification**:
- All PRs and code reviews MUST verify compliance with constitution principles
- Constitution violations REQUIRE justification in Complexity Tracking table
- Use `.specify/memory/constitution.md` for constitutional guidance during development
- Annual constitution review to ensure alignment with project evolution
- **Quarterly principle review**: Assess adherence and identify systemic violations

**Complexity Justification**:
When constitution principles are violated (e.g., skipping tests, adding unjustified abstraction), violations MUST be documented in plan.md Complexity Tracking table with:
- What principle was violated
- Why the violation was necessary
- What simpler alternatives were rejected and why

**Version**: 1.1.0 | **Ratified**: 2025-10-18 | **Last Amended**: 2025-10-30
