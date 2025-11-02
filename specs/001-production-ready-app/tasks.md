# Tasks: Production-Ready Web Application

**Feature**: 001-production-ready-app
**Branch**: `001-production-ready-app`
**Created**: 2025-10-30

**Input**: Design documents from `/specs/001-production-ready-app/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

## Format: `[ID] [P?] [Story?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, etc.)
- Include exact file paths in descriptions

## Path Conventions
- **Backend**: `apps/backend/src/` (domain, application, infrastructure, api)
- **Frontend**: `apps/frontend/src/app/` (core, shared, features)
- Tests follow constitution (TDD mandatory, tests before implementation)

---

## Phase 1: Setup (Project Infrastructure)

**Purpose**: Initialize monorepo structure and development environment

- [X] T001 Verify Node.js 20 LTS, PostgreSQL 16, Redis 7 installed
- [X] T002 Create apps/backend directory structure per plan.md
- [X] T003 Create apps/frontend directory structure per plan.md
- [X] T004 [P] Initialize NestJS backend with TypeScript 5.2+ in apps/backend
- [X] T005 [P] Initialize Angular 17 frontend with standalone components in apps/frontend
- [X] T006 [P] Configure ESLint + Prettier for backend
- [X] T007 [P] Configure ESLint + Prettier for frontend
- [X] T008 Setup docker-compose.yml with PostgreSQL 16 + Redis 7
- [X] T009 Create apps/backend/.env.example with all required variables
- [X] T010 [P] Install backend dependencies (NestJS 10.3, Prisma 5.8, passport-saml, BullMQ, Socket.IO, PDFKit, Winston)
- [X] T011 [P] Install frontend dependencies (Angular 17, PrimeNG 17, NgRx 17, Chart.js, Socket.IO client)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story implementation

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T012 Initialize Prisma schema in apps/backend/prisma/schema.prisma (multi-tenant base)
- [X] T013 Create shared schema: Tenant, User, CERCatalog tables in Prisma schema
- [X] T014 Implement schema-per-tenant strategy in Prisma (tenant isolation)
- [X] T015 Configure PostgreSQL Row-Level Security policies for multi-tenant
- [X] T016 Generate Prisma client and run initial migration
- [X] T017 Create seed script for CER catalog (900+ codes from ISPRA) in apps/backend/prisma/seed.ts
- [X] T018 [P] Implement base domain classes in apps/backend/src/core/domain/aggregate-root.ts
- [X] T019 [P] Implement domain errors in apps/backend/src/core/domain/errors.ts
- [X] T020 [P] Create User aggregate in apps/backend/src/domain/auth/entities/user.entity.ts with TDD
- [X] T021 [P] Create User entity tests in apps/backend/src/domain/auth/entities/user.entity.spec.ts
- [X] T022 [P] Create FIR aggregate in apps/backend/src/domain/fir/aggregates/fir.aggregate.ts with TDD
- [X] T023 [P] Create FIR aggregate tests in apps/backend/src/domain/fir/aggregates/fir.aggregate.spec.ts
- [X] T024 Setup JWT authentication strategy in apps/backend/src/auth/strategies/jwt.strategy.ts
- [X] T025 Create tenant context middleware in apps/backend/src/core/middleware/tenant-context.middleware.ts
- [X] T026 Create correlation ID interceptor in apps/backend/src/core/interceptors/logging.interceptor.ts
- [~] T027 [P] Configure Winston structured logging (logging exists, Winston may need verification)
- [X] T028 [P] Setup Redis connection in apps/backend/src/auth/services/redis.service.ts
- [X] T029 [P] Configure BullMQ queue infrastructure in apps/backend/src/infrastructure/queue/
- [X] T030 Create health check endpoint in apps/backend/src/infrastructure/monitoring/health-check.controller.ts
- [X] T031 [P] Setup Angular routing with lazy loading in apps/frontend/src/app/app.routes.ts
- [~] T032 [P] Create PrimeNG theme customization in apps/frontend/src/styles/ (needs verification)
- [~] T033 [P] Setup NgRx store structure in apps/frontend/src/app/core/state/ (needs verification)
- [X] T034 [P] Create HTTP interceptor for JWT in apps/frontend/src/app/core/interceptors/auth.interceptor.ts
- [X] T035 [P] Create tenant selector component in apps/frontend/src/app/core/layout/tenant-selector/

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - RENTRI Automatic Synchronization (Priority: P1) 🎯 MVP

**Goal**: Automatically sync completed FIR documents to government RENTRI registry within 5 minutes

**Independent Test**: Create FIR, emit it, complete workflow, verify data appears in RENTRI test environment within 5 min

### Implementation for User Story 1

- [X] T036 [P] [US1] Create RENTRISyncLog aggregate in apps/backend/src/domain/rentri/rentri-sync-log.aggregate.ts with TDD
- [~] T037 [P] [US1] Create RENTRISyncLog entity tests (aggregate exists, tests need verification)
- [X] T038 [P] [US1] Create SyncStatus value object in apps/backend/src/domain/fir/rentri-sync-status.vo.ts
- [X] T039 [US1] Add RENTRISyncLog table to Prisma schema (FIR has RENTRI sync fields)
- [X] T040 [US1] Create Prisma migration for RENTRI sync tables
- [X] T041 [P] [US1] Implement RENTRI HTTP client in apps/backend/src/infrastructure/rentri/rentri-api.client.ts (OAuth2 + retry)
- [X] T042 [P] [US1] Create RENTRI client tests in apps/backend/src/infrastructure/rentri/rentri-api.client.spec.ts
- [X] T043 [US1] Implement SyncFIR use case in apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts
- [~] T044 [US1] Verify exponential backoff implementation (5min, 15min, 60min)
- [X] T045 [US1] Create BullMQ RENTRI sync queue in apps/backend/src/infrastructure/queue/rentri-sync.queue.ts
- [X] T046 [US1] Implement RENTRI sync job processor in apps/backend/src/infrastructure/queue/jobs/rentri-sync.job.ts
- [X] T047 [US1] Create FIRCompletedEvent handler in apps/backend/src/application/rentri/handlers/fir-consegnato.handler.ts
- [X] T048 [US1] Implement GetSyncStatus use case in apps/backend/src/application/rentri/get-sync-status.use-case.ts
- [~] T049 [US1] Implement GetFailedSyncsQuery for admin retry interface (needs verification)
- [X] T050 [US1] Create RENTRI sync API controller in apps/backend/src/api/rentri/rentri-sync.controller.ts
- [~] T051 [US1] Verify RENTRI sync endpoints (GET status, POST trigger, POST retry) per contracts
- [~] T052 [US1] Verify structured logging for all RENTRI operations (correlation IDs, tenant IDs)
- [X] T053 [US1] Create integration test for RENTRI sync flow in apps/backend/test/rentri-sync.e2e-spec.ts
- [X] T053A [P] [US1] Create RENTRI sync components in apps/frontend/src/app/features/fir/components/rentri-sync-*

**Checkpoint**: RENTRI sync fully functional - FIRs automatically sync to government registry

---

## Phase 4: User Story 2 - SPID/CIE Digital Authentication (Priority: P1) 🎯 MVP

**Goal**: Users login with government-issued SPID or CIE credentials for legally valid digital signatures

**Independent Test**: User clicks "Login with SPID", authenticates, redirected to dashboard with fiscal code loaded

### Implementation for User Story 2

- [X] T054 [P] [US2] Configure Keycloak SAML strategy in apps/backend/src/infrastructure/keycloak/keycloak-saml.strategy.ts
- [~] T055 [P] [US2] Verify SPID IdP metadata storage (Keycloak integration exists)
- [~] T056 [US2] Verify SP key pair generation in apps/backend/certs/ (certs directory exists)
- [~] T057 [US2] Verify SPID authentication guard (JWT auth guard exists in multiple locations)
- [X] T058 [US2] Create auth endpoints in apps/backend/src/api/auth/auth.controller.ts
- [X] T059 [US2] Implement UserRepository in apps/backend/src/infrastructure/persistence/user.repository.ts
- [X] T060 [US2] Create user from SPID attributes in apps/backend/src/domain/auth/spid-attributes.vo.ts
- [X] T061 [US2] Implement JWT token service in apps/backend/src/auth/services/jwt-tokens.service.ts
- [~] T062 [US2] Verify tenant switcher endpoint in auth controller
- [X] T063 [US2] Implement session management with Redis in apps/backend/src/auth/services/redis.service.ts
- [X] T064 [P] [US2] Create SPID login components in apps/frontend/src/app/features/auth/spid-login/
- [X] T065 [P] [US2] Create auth service in apps/frontend/src/app/core/services/auth.service.ts
- [X] T066 [P] [US2] Implement JWT storage and refresh logic (auth service + use cases exist)
- [X] T067 [US2] Create auth guard in apps/frontend/src/app/core/guards/auth.guard.ts
- [X] T068 [US2] Create tenant selector in apps/frontend/src/app/core/layout/tenant-selector/
- [~] T069 [US2] Verify SPID session management in NgRx store
- [X] T070 [US2] Create integration test for SPID flow in apps/backend/test/auth-spid.e2e-spec.ts

**Checkpoint**: SPID/CIE authentication working - users can login with government credentials

---

## Phase 5: User Story 3 - FIR Digital Signature Workflow (Priority: P1) 🎯 MVP

**Goal**: Producer, transporter, destination digitally sign FIR at each stage with legally valid signatures

**Independent Test**: Producer emits FIR with signature, transporter signs at pickup, destination signs at delivery - all signatures cryptographically verifiable

### Implementation for User Story 3

- [X] T071 [P] [US3] Create DigitalSignature value object in apps/backend/src/domain/fir/digital-signature.vo.ts with TDD
- [X] T072 [P] [US3] Create DigitalSignature tests in apps/backend/src/domain/fir/digital-signature.vo.spec.ts
- [~] T073 [P] [US3] Verify SignatureHash value object (signature infrastructure exists)
- [X] T074 [US3] Add FIRSignature table to Prisma schema with indexes
- [X] T075 [US3] Prisma migration for signatures completed
- [X] T076 [US3] Implement DigitalSignatureService in apps/backend/src/application/signatures/digital-signature.service.ts
- [~] T077 [US3] Verify ECDSA P-256 key pair generation and storage
- [X] T078 [US3] Implement ApplySignature use case in apps/backend/src/application/signatures/apply-signature.use-case.ts
- [X] T079 [US3] Implement VerifySignatures use case in apps/backend/src/application/signatures/verify-signatures.use-case.ts
- [X] T080 [US3] FIR state machine enforced in FIR aggregate (DRAFT→AWAITING_*→COMPLETED→SYNCED)
- [~] T081 [US3] Verify signature verification command (verify use case exists)
- [X] T082 [US3] Create signature API endpoints in apps/backend/src/api/signatures/signatures.controller.ts
- [~] T083 [US3] Verify POST /fir/{id}/sign endpoint implementation
- [~] T084 [US3] Verify GET /signatures/{id}/verify public verification endpoint
- [X] T085 [US3] QR code service in apps/frontend/src/app/core/services/qrcode.service.ts
- [X] T086 [P] [US3] Create signature dialog in apps/frontend/src/app/features/fir/signature-dialog/
- [~] T087 [P] [US3] Verify FIR workflow wizard implementation
- [~] T088 [US3] Verify signature capture UI with touch support
- [X] T089 [US3] Create signature status component in apps/frontend/src/app/features/fir/signature-status/
- [X] T090 [US3] Add signature verification page in apps/frontend/src/app/features/verify/verify-signatures/
- [X] T091 [US3] Create integration test for signature workflow in apps/backend/test/fir-signatures.e2e-spec.ts
- [X] T092 [US3] Signature audit handler in apps/backend/src/application/signatures/signature-audit.handler.ts

**Checkpoint**: Digital signatures working - FIRs legally signed at all workflow stages

---

## Phase 6: User Story 4 - Analytics Dashboard with KPIs (Priority: P2)

**Goal**: Environmental manager views real-time waste KPIs on responsive dashboard (desktop + mobile)

**Independent Test**: User opens dashboard, sees 6 KPI cards updating in real-time as new FIRs are created

### Implementation for User Story 4

- [~] T093 [P] [US4] Verify DashboardKPIs DTO in dashboard controller
- [X] T094 [P] [US4] Implement GetDashboard use case in apps/backend/src/application/analytics/get-dashboard.use-case.ts
- [X] T095 [US4] Create analytics service in apps/backend/src/application/analytics/analytics.service.ts
- [~] T096 [US4] Verify GetWasteByCERQuery implementation in analytics service
- [~] T097 [US4] Verify GetCostTrendQuery implementation in analytics service
- [X] T098 [US4] Create dashboard API controller in apps/backend/src/api/dashboard/dashboard.controller.ts
- [~] T099 [US4] Verify GET /dashboard/kpis endpoint with caching
- [~] T100 [US4] Verify GET /dashboard/charts/waste-by-cer endpoint
- [~] T101 [US4] Verify GET /dashboard/charts/cost-trend endpoint
- [ ] T102 [US4] Implement WebSocket gateway (needs verification)
- [ ] T103 [US4] Create tenant-scoped Socket.IO rooms for data isolation
- [ ] T104 [US4] Implement real-time KPI broadcasting on FIR events
- [ ] T105 [US4] Add Redis pub/sub for horizontal scaling
- [~] T106 [P] [US4] Verify KPI cards component implementation
- [~] T107 [P] [US4] Verify waste chart component implementation
- [~] T108 [P] [US4] Verify cost trend chart component implementation
- [X] T109 [US4] Create dashboard pages in apps/frontend/src/app/features/dashboard/
- [ ] T110 [US4] Setup WebSocket connection service (needs verification)
- [ ] T111 [US4] Implement real-time KPI updates in NgRx store
- [~] T112 [US4] Verify responsive layout (PrimeNG Grid)
- [~] T113 [US4] Verify date range filter for dashboard metrics
- [~] T114 [US4] Verify site filter for multi-site users
- [~] T115 [US4] Verify drill-down functionality
- [ ] T116 [US4] Create integration test for dashboard real-time updates

**Checkpoint**: Dashboard fully functional with real-time updates and responsive design

---

## Phase 7: User Story 5 - Deadline & Alert Notifications (Priority: P2)

**Goal**: Users receive automatic alerts for critical deadlines (MUD filing, vidimazione, authorization renewals)

**Independent Test**: System sends email 30 days before MUD deadline, again at 15 days, urgent at 7 days

### Implementation for User Story 5

- [X] T117 [P] [US5] Create Notification entity in apps/backend/src/domain/notification/notification.entity.ts
- [~] T118 [P] [US5] Verify Notification entity tests
- [X] T119 [P] [US5] NotificationType enum in Prisma schema
- [X] T120 [P] [US5] NotificationSeverity enum in Prisma schema
- [X] T121 [US5] Add Notification table to Prisma schema with user_id + read_at indexes
- [X] T122 [US5] Prisma migration for notifications completed
- [~] T123 [US5] Verify CreateNotificationCommand in notification service
- [~] T124 [US5] Verify GetUserNotificationsQuery implementation
- [~] T125 [US5] Create notification delivery queue (needs BullMQ setup)
- [X] T126 [US5] Email service in apps/backend/src/infrastructure/email/email.service.ts
- [X] T127 [US5] TemplateService in apps/backend/src/infrastructure/email/template.service.ts with Handlebars rendering
- [X] T128 [US5] MUD deadline reminder template in apps/backend/src/infrastructure/email/templates/mud-deadline-reminder.hbs
- [X] T129 [US5] Vidimazione reminder template in apps/backend/src/infrastructure/email/templates/vidimazione-reminder.hbs
- [X] T130 [US5] Authorization expiration template in apps/backend/src/infrastructure/email/templates/authorization-expiration.hbs
- [X] T131 [US5] DeadlineCheckerService with @Cron jobs in apps/backend/src/application/notifications/deadline-checker.service.ts
- [X] T132 [US5] NotificationEscalationService in apps/backend/src/application/notifications/notification-escalation.service.ts
- [X] T133 [US5] Create notification API controller in apps/backend/src/api/notifications/notifications.controller.ts
- [~] T134 [US5] Verify GET /notifications endpoints
- [~] T135 [US5] Verify GET /notifications/unread/count endpoint
- [~] T136 [US5] Verify PATCH /notifications/{id}/read endpoint
- [~] T137 [US5] Verify DELETE /notifications/{id} endpoint
- [~] T138 [US5] Verify notification preferences endpoints
- [X] T139 [P] [US5] Create notification bell in apps/frontend/src/app/core/layout/notification-bell/
- [X] T140 [P] [US5] Create notifications page in apps/frontend/src/app/features/notifications/notifications-page/
- [ ] T141 [US5] Verify notifications in NgRx store
- [ ] T142 [US5] Create notification preferences page (needs verification)
- [ ] T143 [US5] Add notification sound/vibration
- [ ] T144 [US5] Create integration test for notification flow

**Checkpoint**: Notification system working - users receive timely alerts for all critical deadlines

---

## Phase 8: User Story 6 - Enhanced PDF Export (Priority: P2)

**Goal**: Export FIR as professional PDF with company letterhead, signatures, QR codes for authority inspections

**Independent Test**: Export completed FIR to PDF, verify contains logo, 3 signatures, QR code, formatted for A4 printing

### Implementation for User Story 6

- [X] T145 [P] [US6] CompanyTemplate entity in apps/backend/src/domain/pdf/entities/company-template.entity.ts
- [X] T146 [US6] CompanyTemplate table added to Prisma schema with tenant relation
- [X] T147 [US6] Prisma migration 20251031000000_add_company_template applied successfully
- [X] T148 [US6] Implement PDFService in apps/backend/src/infrastructure/pdf/pdf.service.ts
- [~] T149 [US6] Verify FIR PDF template implementation
- [~] T150 [US6] Verify company logo rendering
- [~] T151 [US6] Verify waste details table rendering
- [~] T152 [US6] Verify signatures section rendering
- [~] T153 [US6] Verify QR code in footer
- [~] T154 [US6] Verify page numbers
- [ ] T155 [US6] Implement batch PDF export (needs verification)
- [ ] T156 [US6] Add attachments support (needs verification)
- [ ] T157 [US6] Create PDF generation queue (needs verification)
- [ ] T158 [US6] Implement PDF caching in S3
- [X] T159 [US6] Create PDF API controller in apps/backend/src/api/pdf/pdf.controller.ts
- [~] T160 [US6] Verify POST /fir/{id}/export-pdf endpoint
- [~] T161 [US6] Verify POST /fir/export-batch endpoint
- [~] T162 [US6] Verify template upload endpoint
- [~] T163 [P] [US6] Verify PDF export button in FIR detail page
- [ ] T164 [P] [US6] Add batch export UI (needs verification)
- [ ] T165 [US6] Create template upload page in admin section
- [ ] T166 [US6] Create integration test for PDF generation

**Checkpoint**: PDF export working - FIRs exported as professional documents for inspections

---

## Phase 9: User Story 7 - Multi-Tenant Consultant Dashboard (Priority: P2)

**Goal**: Consultant manages 50+ clients from one login, switches contexts, views aggregate reports

**Independent Test**: Consultant logs in, sees client list, switches tenant, data updates, views aggregate dashboard

### Implementation for User Story 7

- [~] T167 [P] [US7] Tenant subscription fields embedded in Tenant model (Prisma schema)
- [~] T168 [P] [US7] Verify TenantSubscription domain logic
- [X] T169 [US7] Tenant subscription fields in Prisma schema (subscription_tier, subscription_status, limits)
- [X] T170 [US7] Prisma migration includes subscription fields
- [~] T171 [US7] Verify tenant provisioning command
- [X] T172 [US7] Tenant context middleware in apps/backend/src/core/middleware/tenant-context.middleware.ts
- [~] T173 [US7] Verify GetUserTenantsQuery
- [~] T174 [US7] Verify GetAggregateDashboardQuery
- [X] T175 [US7] Tenant-scoped filtering in repositories (Prisma RLS extension exists)
- [~] T176 [US7] Verify tenant API endpoints
- [~] T177 [US7] Verify GET /tenants endpoint
- [~] T178 [US7] Verify POST /tenants endpoint
- [~] T179 [US7] Verify POST /tenants/{id}/invite endpoint
- [X] T180 [P] [US7] Tenant selector in apps/frontend/src/app/core/layout/tenant-selector/
- [ ] T181 [P] [US7] Create aggregate dashboard view (all clients mode)
- [ ] T182 [US7] Add tenant branding (logo, colors) to reports
- [ ] T183 [US7] Create client management page in admin section
- [ ] T184 [US7] Add tenant user management (invite, roles, remove)
- [ ] T185 [US7] Create integration test for multi-tenant isolation
- [ ] T186 [US7] Security test: Verify zero cross-tenant data leakage

**Checkpoint**: Multi-tenant system working - consultants manage multiple clients seamlessly

---

## Phase 10: User Story 8 - MUD Annual Report Generation (Priority: P3)

**Goal**: Automatically generate annual MUD report from year's waste data, export as PDF/XML

**Independent Test**: User selects year 2025, clicks "Generate MUD", system aggregates FIR data, populates form, exports

### Implementation for User Story 8

- [~] T187 [P] [US8] MUDReport entity exists (needs domain verification)
- [~] T188 [P] [US8] Verify MUDReport entity tests
- [X] T189 [US8] MUDReport table in Prisma schema
- [X] T190 [US8] Prisma migration for MUD reports completed
- [~] T191 [US8] Verify GenerateMUD command in MUD module
- [X] T192 [US8] MUD generator service in apps/backend/src/application/mud/mud-generator.service.ts
- [~] T193 [US8] Verify MUD validation logic
- [ ] T194 [US8] Create MUD PDF template (needs verification)
- [ ] T195 [US8] Create MUD XML export (needs verification)
- [~] T196 [US8] Verify ExportMUD command
- [ ] T197 [US8] Add MUD readiness indicator (% completeness calculation)
- [X] T198 [US8] Create MUD API controller in apps/backend/src/api/mud/mud.controller.ts
- [~] T199 [US8] Verify POST /mud/generate endpoint
- [~] T200 [US8] Verify GET /mud/{year} endpoint
- [~] T201 [US8] Verify POST /mud/{id}/export endpoint
- [~] T202 [US8] Verify POST /mud/{id}/submit endpoint
- [ ] T203 [P] [US8] Create MUD generation wizard (needs verification)
- [ ] T204 [P] [US8] Add year selector and readiness indicator
- [ ] T205 [US8] Create MUD preview page with validation errors
- [ ] T206 [US8] Add export buttons (PDF, XML)
- [ ] T207 [US8] Create integration test for MUD generation

**Checkpoint**: MUD reporting working - users generate annual reports in minutes vs hours

---

## Phase 11: User Story 9 - System Monitoring & Error Alerts (Priority: P4)

**Goal**: Administrator sees real-time system health, error rates, RENTRI sync failures, proactive alerts

**Independent Test**: Admin logs in, sees metrics dashboard with response times, error rates, receives email when error rate exceeds 5%

### Implementation for User Story 9

- [ ] T208 [P] [US9] Implement MetricsCollector service (needs verification)
- [ ] T209 [P] [US9] Add Prometheus metrics exporter
- [ ] T210 [US9] Create CloudWatch Metrics integration
- [X] T211 [US9] Health check controller in apps/backend/src/infrastructure/monitoring/health-check.controller.ts
- [~] T212 [US9] Verify error log service with search/filtering
- [ ] T213 [US9] Implement alert thresholds
- [ ] T214 [US9] Create alert notification integration
- [~] T215 [US9] Verify monitoring API endpoints
- [~] T216 [US9] Verify GET /admin/monitoring/metrics endpoint
- [~] T217 [US9] Verify GET /admin/monitoring/health endpoint
- [~] T218 [US9] Verify GET /admin/errors endpoint
- [ ] T219 [P] [US9] Create monitoring dashboard page (needs verification)
- [ ] T220 [P] [US9] Add metrics charts
- [ ] T221 [US9] Add health status indicators
- [ ] T222 [US9] Add error log table with filtering
- [ ] T223 [US9] Create Grafana dashboard JSON config
- [ ] T224 [US9] Create integration test for monitoring endpoints

**Checkpoint**: Monitoring system working - admins have full visibility into system health

---

## Phase 12: User Story 10 - Automated Backup & Data Recovery (Priority: P4)

**Goal**: Automated daily backups with 30-day retention, point-in-time restore capability

**Independent Test**: Admin triggers manual backup, verifies S3 file encrypted, performs test restore to staging

### Implementation for User Story 10

- [~] T225 [P] [US10] BackupLog entity (BackupSchedule and BackupHistory exist in Prisma)
- [~] T226 [P] [US10] Verify BackupLog entity tests
- [X] T227 [US10] BackupSchedule and BackupHistory tables in Prisma schema
- [X] T228 [US10] Prisma migration for backup tables completed
- [X] T229 [US10] BackupService in apps/backend/src/infrastructure/backup/backup.service.ts
- [~] T230 [US10] Verify pg_dump PostgreSQL backup command execution
- [~] T231 [US10] Verify AES-256 encryption for backup files
- [~] T232 [US10] Verify S3 upload with versioning
- [~] T233 [US10] Verify SHA-256 checksum calculation
- [~] T234 [US10] Verify backup retention policy (30 days)
- [ ] T235 [US10] Create backup queue (needs verification)
- [ ] T236 [US10] Add cron job for daily backups
- [~] T237 [US10] Verify restore service implementation
- [ ] T238 [US10] Add backup failure alert (email to admins)
- [X] T239 [US10] Backup API controller in apps/backend/src/api/backup/backup.controller.ts
- [~] T240 [US10] Verify GET /admin/backups endpoint
- [~] T241 [US10] Verify POST /admin/backups/trigger endpoint
- [~] T242 [US10] Verify POST /admin/backups/{id}/restore endpoint
- [ ] T243 [P] [US10] Create backups page (needs verification)
- [ ] T244 [P] [US10] Add backup list table with download links
- [ ] T245 [US10] Add restore UI with confirmation dialog
- [ ] T246 [US10] Add GDPR deletion logging
- [ ] T247 [US10] Create integration test for backup/restore flow

**Checkpoint**: Backup system working - data protected with automated backups and restore capability

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements affecting multiple user stories

- [~] T248 [P] Verify Swagger/OpenAPI documentation (controllers exist, needs verification)
- [ ] T249 [P] Create API client SDK generation (TypeScript) from OpenAPI spec
- [ ] T250 Code cleanup: Remove console.log, unused imports, debug code
- [~] T251 Performance optimization: Verify database query indexes per data-model.md
- [ ] T252 Performance optimization: Enable Prisma query logging in dev
- [ ] T253 Performance optimization: Add Redis caching for dashboard KPIs (30s TTL)
- [X] T254 [P] Security hardening: Add rate limiting per tier (ThrottlerModule with 3-tier limits)
- [X] T255 [P] Security hardening: Add CORS configuration for production domains
- [X] T256 [P] Security hardening: Add helmet.js security headers
- [~] T257 [P] Verify README.md with quickstart instructions
- [~] T258 [P] Verify Docker production Dockerfile (Dockerfile exists)
- [~] T259 [P] Verify docker-compose.prod.yml (docker-compose.yml exists)
- [ ] T260 Run full test suite (unit + integration + E2E)
- [ ] T261 Run Lighthouse audit (target: ≥90 score)
- [ ] T262 Run load test with k6 (target: 1000 concurrent users, p95 <500ms)
- [ ] T263 Run OWASP ZAP security scan
- [ ] T264 Validate constitution compliance (all principles satisfied)
- [ ] T265 Run quickstart.md validation (verify setup instructions work)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - **BLOCKS all user stories**
- **User Stories (Phase 3-12)**: All depend on Foundational phase completion
  - User stories CAN proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3 → P4)
- **Polish (Phase 13)**: Depends on desired user stories being complete

### User Story Dependencies

**Independent Stories** (can start after Foundational):
- US1 (RENTRI Sync) - No dependencies on other stories ✅
- US2 (SPID Auth) - No dependencies on other stories ✅
- US3 (Digital Signatures) - Depends on US2 (requires SPID session)
- US4 (Dashboard) - Depends on US1 (displays RENTRI sync status)
- US5 (Notifications) - No dependencies on other stories ✅
- US6 (PDF Export) - Depends on US3 (includes signatures)
- US7 (Multi-Tenant) - No dependencies on other stories ✅
- US8 (MUD Reports) - Depends on US1 (aggregates FIR data)
- US9 (Monitoring) - No dependencies on other stories ✅
- US10 (Backups) - No dependencies on other stories ✅

**Recommended Sequence**:
1. US2 (SPID Auth) - Foundation for US3
2. US1 (RENTRI Sync) - Core value prop, enables US4/US8
3. US3 (Digital Signatures) - Requires US2
4. US4 (Dashboard) - Depends on US1
5. US5, US7, US9, US10 (Parallel - no interdependencies)
6. US6 (PDF Export) - Depends on US3
7. US8 (MUD Reports) - Depends on US1

### Within Each User Story

- Domain entities → Application services → API controllers → Frontend components
- Tests before implementation (TDD mandatory per constitution)
- Integration tests after core implementation complete

### Parallel Opportunities

**Within Setup Phase**:
- T004, T005 (backend + frontend init)
- T006, T007 (linting configs)
- T010, T011 (dependency installation)

**Within Foundational Phase**:
- T018, T019, T027, T028, T029 (infrastructure services)
- T020-T023 (domain entities with tests)
- T031-T035 (frontend core setup)

**Across User Stories** (if team capacity allows):
- US2 + US5 + US7 + US9 + US10 (5 parallel streams after Foundational)
- Then US1 + US3 (2 parallel streams)
- Then US4 + US6 + US8 (3 parallel streams)

---

## Implementation Strategy

### MVP First (P1 Stories Only)

1. Complete Phase 1: Setup (T001-T011)
2. Complete Phase 2: Foundational (T012-T035) - **CRITICAL CHECKPOINT**
3. Complete US2: SPID Auth (T054-T070)
4. Complete US1: RENTRI Sync (T036-T053)
5. Complete US3: Digital Signatures (T071-T092)
6. **STOP and VALIDATE**: Test P1 stories end-to-end
7. Deploy MVP to staging

**MVP Scope**: 93 tasks (T001-T053A in Phases 1-5)

### Incremental Delivery (Full Feature Set)

1. MVP (P1) → Test → Deploy
2. Add US4 (Dashboard) → Test → Deploy
3. Add US5 (Notifications) → Test → Deploy
4. Add US6 (PDF Export) → Test → Deploy
5. Add US7 (Multi-Tenant) → Test → Deploy
6. Add US8 (MUD Reports) → Test → Deploy
7. Add US9 + US10 (Monitoring + Backups) → Test → Deploy
8. Phase 13 (Polish) → Final test → Production

**Full Scope**: 266 tasks total

### Parallel Team Strategy

With 5 developers after Foundational phase:
- **Dev A**: US2 (SPID Auth) → US3 (Signatures) → US6 (PDF)
- **Dev B**: US1 (RENTRI Sync) → US4 (Dashboard) → US8 (MUD)
- **Dev C**: US5 (Notifications)
- **Dev D**: US7 (Multi-Tenant)
- **Dev E**: US9 (Monitoring) → US10 (Backups)

---

## Task Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| **Phase 1: Setup** | 11 | Project initialization |
| **Phase 2: Foundational** | 24 | Blocking prerequisites |
| **Phase 3: US1 (RENTRI)** | 19 | P1 - RENTRI sync |
| **Phase 4: US2 (SPID)** | 17 | P1 - Authentication |
| **Phase 5: US3 (Signatures)** | 22 | P1 - Digital signatures |
| **Phase 6: US4 (Dashboard)** | 24 | P2 - Analytics |
| **Phase 7: US5 (Notifications)** | 28 | P2 - Alerts |
| **Phase 8: US6 (PDF)** | 22 | P2 - PDF export |
| **Phase 9: US7 (Multi-Tenant)** | 20 | P2 - Consultants |
| **Phase 10: US8 (MUD)** | 21 | P3 - Annual reporting |
| **Phase 11: US9 (Monitoring)** | 17 | P4 - System health |
| **Phase 12: US10 (Backups)** | 23 | P4 - Data protection |
| **Phase 13: Polish** | 18 | Cross-cutting concerns |
| **TOTAL** | **266** | **All features** |

**MVP (P1 only)**: 93 tasks (Phases 1-5 including T053A)
**Production-Ready (all features)**: 266 tasks

---

## Notes

- All tasks follow checklist format: `- [ ] [ID] [P?] [Story?] Description with file path`
- [P] = Parallelizable (different files, no dependencies)
- [US#] = User story label for traceability
- TDD mandatory per constitution - tests before implementation
- Each user story independently completable and testable
- Stop at any checkpoint to validate story completion
- Commit after each task or logical group