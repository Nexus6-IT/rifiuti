# Feature Specification: Production-Ready Web Application

**Feature Branch**: `001-production-ready-app`
**Created**: 2025-10-18
**Status**: Draft
**Input**: User description: "Complete production-ready web application with RENTRI integration, SPID authentication, digital signatures, advanced analytics dashboard, notifications system, and full multi-tenant support using PrimeNG responsive design"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - RENTRI Automatic Synchronization (Priority: P1)

An environmental manager at an Italian manufacturing company needs to ensure all waste movements are automatically reported to the government RENTRI registry without manual data entry, avoiding legal penalties for late or incorrect submissions.

**Why this priority**: Legal compliance requirement for Italian waste producers. Missing or late RENTRI submissions result in fines ranging from €2,600 to €93,000. This is the core value proposition that differentiates the platform from manual processes.

**Independent Test**: Create a FIR, emit it, complete the workflow, and verify that the FIR data appears in RENTRI test environment within 5 minutes with correct format and all mandatory fields populated.

**Acceptance Scenarios**:

1. **Given** a FIR in CONSEGNATO state, **When** the system performs its scheduled RENTRI sync, **Then** the FIR data is transmitted to RENTRI API with success response and sync status updated to "SYNCED"
2. **Given** a RENTRI sync failure due to network error, **When** the retry mechanism activates, **Then** the system retries up to 3 times with exponential backoff and logs the error
3. **Given** a FIR with validation errors, **When** attempting RENTRI sync, **Then** the system shows specific validation messages and marks status as "ERROR" with actionable error description
4. **Given** registry entries (carico/scarico), **When** daily sync runs, **Then** all entries from the previous day are transmitted to RENTRI in batch
5. **Given** RENTRI is unavailable, **When** sync fails repeatedly, **Then** administrator receives alert notification and failed items are queued for manual review

---

### User Story 2 - SPID/CIE Digital Authentication (Priority: P1)

A waste producer needs to login using their government-issued SPID or CIE credentials so that any digital signatures they apply to FIR documents are legally valid under Italian law (CAD - Codice dell'Amministrazione Digitale).

**Why this priority**: Legal requirement for digital signature validity. Without SPID/CIE, digital signatures on FIR documents are not legally recognized, making the platform unusable for compliance purposes.

**Independent Test**: User clicks "Login with SPID", selects their identity provider, authenticates with SPID credentials, and is redirected back to the dashboard with their fiscal code and personal information correctly loaded.

**Acceptance Scenarios**:

1. **Given** a new user, **When** they click "Login with SPID" and complete authentication, **Then** their user account is created with fiscal code, email, name from SPID attributes
2. **Given** an existing user, **When** they login with CIE, **Then** they are authenticated and their session contains authentication level (SPID Level 2 or higher)
3. **Given** a SPID authentication failure, **When** user cancels or authentication times out, **Then** user sees friendly error message and can retry
4. **Given** a user with multiple tenant associations, **When** they login, **Then** they select their active tenant from a dropdown
5. **Given** a session expires, **When** user tries to perform an action, **Then** they are prompted to re-authenticate without losing their work

---

### User Story 3 - FIR Digital Signature Workflow (Priority: P1)

A waste producer, transporter, and destination facility need to digitally sign FIR documents at each stage of the waste transfer process, creating a legally valid audit trail that satisfies regulatory inspections.

**Why this priority**: Legal requirement under D.M. 59/2023. Paper FIR is being phased out; digital signatures are mandatory for legal validity. Without this, customers cannot legally transport waste.

**Independent Test**: Producer emits a FIR with signature, transporter accepts and signs at pickup, destination confirms delivery with signature. Each signature is cryptographically verifiable and includes timestamp and signer identity.

**Acceptance Scenarios**:

1. **Given** a FIR in BOZZA state, **When** producer clicks "Emetti e Firma", **Then** producer is prompted for SPID OTP, signature is applied with timestamp, and FIR moves to EMESSO state
2. **Given** a FIR in EMESSO state, **When** transporter scans QR code on mobile and confirms pickup, **Then** transporter signature is applied and FIR moves to IN_TRANSITO
3. **Given** a FIR in IN_TRANSITO state, **When** destination weighs waste and confirms quantity within tolerance, **Then** destination signature is applied and FIR moves to CONSEGNATO
4. **Given** a completed FIR, **When** user exports to PDF, **Then** PDF includes visual representation of all three signatures with timestamps and signer fiscal codes
5. **Given** quantity discrepancy >10%, **When** destination attempts to sign, **Then** system blocks signature and requires documented justification before allowing completion

---

### User Story 4 - Analytics Dashboard with KPIs (Priority: P2)

An environmental manager needs to view real-time analytics and KPIs about waste production, costs, and compliance metrics on a responsive dashboard accessible from desktop and mobile devices to make data-driven decisions and respond quickly to issues.

**Why this priority**: Competitive feature present in all major platforms (WinWaste, Rifiutoo). Provides visibility into operations and helps identify cost-saving opportunities. Improves user engagement and retention.

**Independent Test**: User opens dashboard and sees tiles showing total waste by month, cost trends, FIR status breakdown, RENTRI sync health, and upcoming deadlines - all updating in real-time as new data is entered.

**Acceptance Scenarios**:

1. **Given** user accesses dashboard, **When** page loads, **Then** dashboard shows 6 KPI cards: total waste (kg) this month, active FIRs, pending RENTRI syncs, waste by category chart, cost trend chart, upcoming deadlines
2. **Given** user has multiple production sites, **When** they select a filter, **Then** all dashboard metrics update to show only that site's data
3. **Given** new FIR is created, **When** dashboard is open, **Then** "Active FIRs" KPI updates within 5 seconds without page refresh
4. **Given** user on mobile device, **When** viewing dashboard, **Then** cards stack vertically, charts are touch-scrollable, and all data is readable
5. **Given** user clicks on a KPI card, **When** drilling down, **Then** detailed data table appears with filtering and export options
6. **Given** date range selector, **When** user selects custom period, **Then** all charts and KPIs recalculate for that period

---

### User Story 5 - Deadline & Alert Notifications (Priority: P2)

An environmental consultant managing multiple client companies needs to receive automatic alerts for critical deadlines (MUD filing, registry vidimazione, authorization renewals) to prevent compliance violations and maintain service quality.

**Why this priority**: Competing platforms (Rifiutoo) highlight this as key feature. Prevents costly compliance failures. Reduces manual calendar tracking and improves customer satisfaction.

**Independent Test**: System automatically sends email notification 30 days before MUD filing deadline, again at 15 days, and urgent alert at 7 days. User can acknowledge alert and mark as handled.

**Acceptance Scenarios**:

1. **Given** MUD filing deadline approaching (April 30), **When** 30 days before deadline, **Then** all users with ADMIN role receive email notification with MUD preparation link
2. **Given** registry requires annual vidimazione, **When** vidimazione is due within 60 days, **Then** system shows banner alert on dashboard with link to vidimazione process
3. **Given** transporter authorization expires in 15 days, **When** viewing that transporter in registry, **Then** red expiration warning badge appears with days remaining
4. **Given** user configures notification preferences, **When** selecting "email + in-app", **Then** alerts appear both in notification bell icon and via email
5. **Given** multiple clients with different deadline dates, **When** consultant views unified alerts dashboard, **Then** all client alerts are shown sorted by urgency with client name labels
6. **Given** user dismisses an alert, **When** deadline passes without action, **Then** alert reappears as "OVERDUE" with escalated priority

---

### User Story 6 - Enhanced PDF Export with Legal Headers (Priority: P2)

A waste producer needs to export FIR documents as professional PDF files with company letterhead, all required legal information, QR codes for verification, and support for multiple paper sizes to provide to authorities during inspections.

**Why this priority**: Legal requirement - authorities inspect physical/digital FIR documents. Current basic export exists but lacks professional formatting and all mandatory fields. Competitive platforms offer polished exports.

**Independent Test**: Export a completed FIR to PDF, verify it contains company logo, all three signatures, QR verification code, progressive numbering, waste details, and is formatted for A4 printing with headers/footers.

**Acceptance Scenarios**:

1. **Given** a completed FIR, **When** user clicks "Esporta PDF", **Then** PDF is generated with company header, FIR progressive number, all parties' details, waste description, and signatures section
2. **Given** PDF export, **When** viewing document, **Then** QR code in footer encodes FIR verification URL for scanning by authorities
3. **Given** multi-page FIR details, **When** exporting, **Then** each page has header with company name and progressive number, footer with page numbers
4. **Given** user needs batch export, **When** selecting multiple FIRs, **Then** single PDF with separate pages for each FIR is generated
5. **Given** FIR with attachments (photos, analysis certificates), **When** exporting "complete package", **Then** PDF includes attachments as appendix pages
6. **Given** company has custom letterhead template, **When** administrator uploads template, **Then** all future PDF exports use that template

---

### User Story 7 - Multi-Tenant Consultant Dashboard (Priority: P3)

An environmental consulting firm managing 50+ client companies needs a unified dashboard showing all clients' waste operations, ability to switch between client contexts, and aggregate reporting across portfolio to efficiently manage multiple accounts from one login.

**Why this priority**: Key business model enabler for B2B2B strategy. Consultants are force multipliers who bring many clients. Schema exists but UI and workflow need implementation.

**Independent Test**: Consultant logs in, sees list of all client companies, selects one, performs operations in that context, then switches to another client without re-logging. Can also view aggregate dashboard showing all clients' KPIs.

**Acceptance Scenarios**:

1. **Given** consultant user with access to multiple tenants, **When** they login, **Then** they see tenant selector dropdown in header with all accessible companies
2. **Given** consultant switches tenant, **When** selecting different company, **Then** all dashboard data, FIR lists, and registry entries update to show that tenant's data
3. **Given** consultant needs overview, **When** selecting "All Clients" mode, **Then** aggregate dashboard shows combined metrics across all managed tenants
4. **Given** consultant creates FIR, **When** in client context, **Then** FIR is associated with current active tenant and not visible when switched to other tenants
5. **Given** consultant needs client-specific report, **When** generating report, **Then** client company branding and name appear in report header
6. **Given** tenant-level user permissions, **When** consultant invites client staff, **Then** staff can only access their own company's data, not other clients

---

### User Story 8 - MUD Annual Report Generation (Priority: P3)

A waste producer needs to automatically generate the annual MUD (Modello Unico Dichiarazione Ambientale) report from their year's waste data to satisfy the yearly compliance obligation without manual data re-entry from spreadsheets.

**Why this priority**: Mandatory annual obligation for all waste producers (deadline April 30). Current market solutions (Rifiutoo) highlight "quick MUD filing" as key feature. Reduces hours of manual work to minutes.

**Independent Test**: User selects year 2025, clicks "Generate MUD", system aggregates all FIR and registry data, populates MUD form sections automatically, user reviews and exports as PDF or XML for submission.

**Acceptance Scenarios**:

1. **Given** calendar year end (Dec 31), **When** user accesses MUD module in January, **Then** system shows "MUD 2025 ready to generate" with data completeness indicator
2. **Given** user clicks "Generate MUD", **When** processing, **Then** system aggregates all CER codes used, quantities by destination type (R/D operations), and transporter details
3. **Given** generated MUD draft, **When** user reviews, **Then** all form sections are pre-filled with data from FIRs and registries, with sources cited for verification
4. **Given** missing or inconsistent data, **When** MUD validation runs, **Then** system highlights gaps and prompts user to resolve before finalizing
5. **Given** completed MUD, **When** user exports, **Then** both human-readable PDF and machine-readable XML formats are generated
6. **Given** multi-site company, **When** generating MUD, **Then** user can choose to generate separate MUD per site or consolidated for entire organization

---

### User Story 9 - System Monitoring & Error Alerts (Priority: P4)

A platform administrator needs real-time visibility into system health, error rates, RENTRI sync failures, and performance metrics through a monitoring dashboard to proactively address issues before they impact users.

**Why this priority**: Production requirement for SaaS operations. Enables proactive problem resolution, reduces downtime, and builds customer trust. Required for meeting SLA commitments.

**Independent Test**: Administrator logs into admin panel, sees metrics for response times, error rates, queued RENTRI syncs, database health. Receives email when error rate exceeds threshold.

**Acceptance Scenarios**:

1. **Given** administrator accesses monitoring dashboard, **When** page loads, **Then** displays: API response time (p95), error rate last hour, RENTRI queue depth, database connection pool status, active users
2. **Given** RENTRI API becomes unavailable, **When** multiple syncs fail, **Then** system sends alert email to admins and marks RENTRI service status as "degraded"
3. **Given** API response time exceeds 2 seconds, **When** threshold is crossed, **Then** performance alert is triggered and slow requests are logged for investigation
4. **Given** administrator views error logs, **When** filtering by type, **Then** can see grouped errors with stack traces, affected users, and frequency
5. **Given** scheduled health check, **When** running every 5 minutes, **Then** verifies database connectivity, Redis availability, external API accessibility
6. **Given** critical error (database down), **When** detected, **Then** system enters maintenance mode with user-friendly message and notifies admins immediately

---

### User Story 10 - Automated Backup & Data Recovery (Priority: P4)

A platform administrator needs automated daily backups of all database data with ability to restore to any point in time within 30 days to protect against data loss and satisfy data retention compliance requirements.

**Why this priority**: Data protection requirement for production systems. GDPR compliance requires ability to restore deleted user data within retention period. Business continuity requirement.

**Independent Test**: Administrator triggers manual backup, verifies backup file is created in S3 with encryption. Performs test restore to staging environment and verifies data integrity.

**Acceptance Scenarios**:

1. **Given** daily scheduled backup, **When** backup runs at 2 AM, **Then** full PostgreSQL dump is created, compressed, encrypted, and uploaded to S3 with timestamp
2. **Given** backup retention policy, **When** backups older than 30 days exist, **Then** automated cleanup removes old backups keeping only last 30 days
3. **Given** administrator needs to restore, **When** selecting restore point, **Then** system shows available backups by date with size and integrity status
4. **Given** restore operation, **When** initiated, **Then** system downloads backup from S3, validates checksum, and prompts for confirmation before overwriting
5. **Given** backup failure, **When** backup job fails, **Then** administrator receives alert email with error details and retry attempt is scheduled
6. **Given** GDPR deletion request, **When** user data is deleted, **Then** deletion is logged in audit trail and separate compliance export is created before removal

---

### Edge Cases

- What happens when RENTRI API is down for extended period (>24 hours)?
  - **Resolution**: After 3 retry attempts fail (total 80 min), system sends alert to administrators and affected tenant users. Failed syncs remain queued with status "BLOCKED_EXTERNAL". Admin dashboard shows RENTRI service status as "DEGRADED". Users can export FIRs as PDF with disclaimer: "Pending RENTRI sync - valid for internal use only". Manual retry available when RENTRI restored. SLA uptime commitments disclosed as "dependent on RENTRI availability".
- How does system handle FIR signed by user whose SPID session expired mid-signature?
- What if user's device loses connectivity during signature process?
- How are FIR amendments handled after RENTRI sync is completed?
- What happens when transporter quantity measurement differs >10% from producer declaration?
- How does system handle timezone differences for multi-region consultants?
  - **Resolution**: All timestamps stored in database as UTC. User profile includes timezone preference setting (defaults to Europe/Rome for Italian users). All displayed timestamps converted to user's configured timezone. Tenant-level timezone setting for scheduled jobs (RENTRI sync, deadline checks) respects tenant's primary business location. Consultant switching between client tenants sees times adjusted to each tenant's timezone automatically.
- What if a tenant reaches data storage limits?
- How are orphaned FIRs handled when a tenant is deleted?
- What happens during SPID provider maintenance windows?
- How does mobile signature workflow handle different screen sizes and orientations?
- What if MUD data spans tenants that were merged mid-year?

## Requirements *(mandatory)*

### Functional Requirements

**RENTRI Integration:**
- **FR-001**: System MUST synchronize completed FIR documents to RENTRI API within 5 minutes of reaching CONSEGNATO state
- **FR-002**: System MUST synchronize registry entries (carico/scarico) to RENTRI daily in batch at 2:00 AM UTC (converted to tenant-configured timezone)
- **FR-003**: System MUST retry failed RENTRI syncs up to 3 times with exponential backoff (5min, 15min, 60min)
- **FR-004**: System MUST store RENTRI sync status (PENDING, SYNCED, ERROR) and error messages for each document
- **FR-005**: System MUST log all RENTRI API requests and responses for compliance auditing
- **FR-006**: System MUST validate FIR data against RENTRI schema before sync attempt
- **FR-007**: System MUST provide admin interface to view failed syncs and trigger manual retry

**Authentication & Authorization:**
- **FR-008**: System MUST support SPID authentication using SAML 2.0 protocol with at least 5 major identity providers (Poste, Infocert, Aruba, Tim, Sielte)
- **FR-009**: System MUST support CIE (Carta Identità Elettronica) authentication
- **FR-010**: System MUST extract and store fiscal code, email, first name, last name from SPID/CIE attributes
- **FR-011**: System MUST maintain SPID authentication level (Level 2 required minimum for signatures)
- **FR-012**: System MUST provide fallback LOCAL authentication for development/testing environments only
- **FR-013**: System MUST enforce session timeout after 30 minutes of inactivity
- **FR-014**: System MUST support multi-tenant user associations with role-based access per tenant

**Digital Signatures:**
- **FR-015**: System MUST capture digital signatures with cryptographic hash of FIR data + SPID fiscal code + timestamp
- **FR-016**: System MUST require SPID re-authentication (OTP) for signature operations
- **FR-017**: System MUST store three separate signatures per FIR: producer, transporter, destination
- **FR-018**: System MUST enforce signature sequence: only producer can sign BOZZA→EMESSO, only transporter can sign EMESSO→IN_TRANSITO, only destination can sign IN_TRANSITO→CONSEGNATO
- **FR-019**: System MUST prevent FIR modification after first signature is applied
- **FR-020**: System MUST generate QR code containing signature verification URL for each signed FIR
- **FR-021**: System MUST provide public verification endpoint that confirms signature authenticity without authentication

**Dashboard & Analytics:**
- **FR-022**: System MUST display KPI tiles showing: total waste current month (kg), active FIRs by status, pending RENTRI syncs count, cost trends
- **FR-023**: System MUST provide waste by CER category chart (pie or bar chart) with drill-down capability
- **FR-024**: System MUST show cost trend line chart for last 12 months
- **FR-025**: System MUST update dashboard metrics in real-time when new data is entered (via WebSocket or polling)
- **FR-026**: System MUST support dashboard filtering by: date range, site/location, CER category, waste type (pericoloso/non-pericoloso)
- **FR-027**: System MUST render responsively on mobile devices with stacked card layout

**Notifications & Alerts:**
- **FR-028**: System MUST send notification alerts at 30, 15, and 7 days before MUD filing deadline (April 30)
- **FR-029**: System MUST alert when registry vidimazione is due within 60 days
- **FR-030**: System MUST warn when transporter/destination authorizations expire within 30 days
- **FR-031**: System MUST support notification channels: in-app (bell icon), email, and push (future)
- **FR-032**: System MUST allow users to configure notification preferences per alert type
- **FR-033**: System MUST show unread notification count badge on header bell icon
- **FR-034**: System MUST support notification dismissal and mark-as-read functionality
- **FR-035**: System MUST escalate overdue alerts (deadline passed without action) with higher visual priority

**PDF Export:**
- **FR-036**: System MUST generate PDF export of FIR with company letterhead, progressive number, all party details, waste information, signatures
- **FR-037**: System MUST include QR code in PDF footer for signature verification
- **FR-038**: System MUST support batch PDF export (multiple FIRs in single document)
- **FR-039**: System MUST include page numbers and headers/footers on all pages
- **FR-040**: System MUST support custom company letterhead template upload
- **FR-041**: System MUST attach referenced documents (photos, certificates) as PDF appendix when requested

**Multi-Tenant:**
- **FR-042**: System MUST provide tenant selector dropdown in header for users with multiple tenant access
- **FR-043**: System MUST filter all data queries by active tenant ID using Row-Level Security
- **FR-044**: System MUST support "All Clients" aggregate view for consultant users showing combined metrics: total waste (sum across all tenants), FIR counts by status (per-tenant breakdown), RENTRI sync health (aggregated success rate %), cost trends (sum), and per-tenant drill-down capability
- **FR-045**: System MUST display active tenant name in header and all reports
- **FR-046**: System MUST prevent cross-tenant data leakage through API or UI
- **FR-047**: System MUST support tenant-scoped user invitation and role assignment

**MUD Reporting:**
- **FR-048**: System MUST aggregate annual waste data by CER code and generate MUD draft
- **FR-049**: System MUST calculate total quantities by destination operation type (R codes, D codes)
- **FR-050**: System MUST validate MUD completeness and highlight missing or inconsistent data
- **FR-051**: System MUST export MUD in both PDF (human-readable) and XML (machine-readable) formats
- **FR-052**: System MUST support multi-site MUD generation (separate per site or consolidated)
- **FR-053**: System MUST show MUD readiness indicator (% data complete) before generation

**Monitoring & Operations:**
- **FR-054**: System MUST expose admin monitoring dashboard showing: API response times (p50, p95, p99), error rates, RENTRI queue depth
- **FR-055**: System MUST send alert emails when error rate exceeds 5% over 15-minute window
- **FR-056**: System MUST perform health checks every 5 minutes verifying: database connectivity, Redis availability, RENTRI API accessibility
- **FR-057**: System MUST log all errors with stack traces to centralized logging system
- **FR-058**: System MUST provide error log search and filtering UI for administrators with filters: severity level, date range, tenant ID, error code, correlation ID, and full-text search

**Backup & Recovery:**
- **FR-059**: System MUST perform automated full PostgreSQL backup daily at 2 AM
- **FR-060**: System MUST encrypt backup files using AES-256 before upload to S3
- **FR-061**: System MUST retain backups for 30 days and automatically delete older backups
- **FR-062**: System MUST send alert email if backup fails
- **FR-063**: System MUST provide restore interface allowing selection of backup point and validation before restore
- **FR-064**: System MUST verify backup integrity using checksums

### Key Entities

- **RENTRISyncLog**: Records each synchronization attempt with timestamp, status, request/response payload, error details
- **DigitalSignature**: Stores signature hash, signer fiscal code, timestamp, SPID level, IP address for each FIR signature
- **Notification**: Alert records with type, severity, recipient, delivery status, acknowledgment timestamp
- **TenantSubscription**: Tenant service level, data limits, feature flags, billing information
- **BackupLog**: Backup execution records with timestamp, file location, size, checksum, status
- **MUDReport**: Generated MUD drafts with year, tenant, completion status, validation results, export formats
- **AuditLog**: (Already exists) Enhanced with RENTRI operations, signature events, tenant switches

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Compliance & Legal:**
- **SC-001**: 99.5% of FIR documents successfully synchronized to RENTRI within 5 minutes of completion
- **SC-002**: Zero SPID authentication failures due to platform errors (provider outages excluded)
- **SC-003**: 100% of signed FIRs pass digital signature verification check
- **SC-004**: MUD report generation completes in under 30 seconds for tenants with <10,000 FIRs per year

**User Experience:**
- **SC-005**: Users can complete full FIR workflow (create, emit, transport, deliver) in under 5 minutes on mobile device
- **SC-006**: Dashboard loads all KPIs and charts in under 2 seconds on desktop, under 4 seconds on mobile
- **SC-007**: 90% of users successfully navigate SPID authentication on first attempt
- **SC-008**: Users receive critical deadline notifications at least 7 days before due date 100% of the time
- **SC-009**: PDF export generates professional FIR document in under 3 seconds

**Performance & Reliability:**
- **SC-010**: System handles 1,000 concurrent users without response time degradation
- **SC-011**: API response times maintain p95 < 500ms for all endpoints
- **SC-012**: System achieves 99.9% uptime (excluding planned maintenance)
- **SC-013**: Failed RENTRI syncs are retried and resolved within 2 hours in 95% of cases
- **SC-014**: Tenant data isolation prevents cross-tenant data leakage in 100% of security tests

**Business Outcomes:**
- **SC-015**: Multi-tenant consultants can manage 50+ client tenants from single login without performance issues
- **SC-016**: Automated backups succeed 100% of scheduled runs with integrity validation
- **SC-017**: Users reduce MUD preparation time from 8 hours (manual) to under 1 hour (automated)
- **SC-018**: Platform processes 10,000+ FIRs per month across all tenants
- **SC-019**: Error monitoring system detects and alerts on critical issues within 5 minutes of occurrence

**Adoption & Satisfaction:**
- **SC-020**: 80% of users successfully complete their first FIR end-to-end without support intervention
- **SC-021**: 90% of SPID authentication sessions complete successfully (measured by conversion rate)
- **SC-022**: Users access dashboard at least weekly to monitor operations
- **SC-023**: PDF exports are used in 100% of regulatory inspections without requiring manual corrections
