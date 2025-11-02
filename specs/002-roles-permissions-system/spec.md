# Feature Specification: Comprehensive Roles and Permissions System

**Feature Branch**: `002-roles-permissions-system`
**Created**: 2025-10-31
**Status**: Draft
**Input**: User description: "usa l'agente di marketing, in collaborazione con tutti gli altri agenti, per definire ruoli, permessi e funzionalità aggiuntive, se non già previste, nell'applicativo"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Company Administrator Assigns Roles to Team Members (Priority: P1)

As a company administrator (waste producer, transporter, or treatment facility manager), I need to invite employees to my workspace with specific roles so that I can control who can create FIRs, who can view data, and maintain proper accountability for regulatory compliance.

**Why this priority**: Without tenant-scoped role assignment, the entire multi-tenant architecture and data security model collapses. This is foundational for regulatory compliance (D.Lgs. 152/2006 requires clear accountability chains) and operational security.

**Independent Test**: Can be fully tested by creating a test tenant, inviting users with different roles (Admin, Operator, Viewer), and verifying that each role has appropriate access to FIR creation, data viewing, and user management features.

**Acceptance Scenarios**:

1. **Given** Marco (Admin of "Officina Ferri") invites employee "Luca Bianchi" with role OPERATOR, **When** Luca logs in and attempts to create a FIR, **Then** system allows creation and logs action with Luca's credentials
2. **Given** Marco assigns VIEWER role to accountant "Maria Verdi", **When** Maria attempts to create or delete a FIR, **Then** system blocks the action with clear message explaining her role limitations and who to contact
3. **Given** user invitation expires after 48 hours, **When** recipient clicks expired invite link, **Then** system shows clear error message and offers option to request new invitation
4. **Given** Admin attempts to remove last user with ADMIN role from tenant, **When** trying to save change, **Then** system prevents action with message "At least one administrator is required per organization"

---

### User Story 2 - Environmental Consultant Manages Multiple Client Tenants (Priority: P1)

As an environmental consultant managing 35+ client companies, I need to switch between client contexts seamlessly and view aggregated compliance status across all clients so that I can proactively manage deadlines and prevent regulatory violations without constantly logging in/out.

**Why this priority**: This is the killer feature that enables the consultant business model - a key growth channel. Without multi-tenant context switching, consultants cannot scale beyond 10-15 clients, capping market expansion. Consultants are force multipliers bringing 35+ paying clients each.

**Independent Test**: Create test consultant user associated with 5 test tenant accounts. Verify consultant can switch contexts, see aggregated dashboard, and perform actions on behalf of clients while maintaining clear audit trails.

**Acceptance Scenarios**:

1. **Given** Elena (consultant) manages 35 client tenants, **When** she logs in, **Then** sees tenant selector dropdown in header showing all clients with her role clearly indicated per client
2. **Given** Elena views "All Clients" dashboard, **When** page loads, **Then** displays aggregated KPIs: total pending FIRs by client, upcoming MUD deadlines sorted by urgency, RENTRI sync failures color-coded by severity
3. **Given** Elena switches from "Officina Ferri" to "Metallurgica Rossi" tenant, **When** viewing FIR list, **Then** only Metallurgica Rossi's FIRs appear with zero cross-tenant data leakage verified by security testing
4. **Given** Elena performs action on behalf of client, **When** viewing audit log, **Then** entry clearly shows "Elena Rossi (Consultant at Studio Verde) acting as ADMIN for Officina Ferri performed [action]"
5. **Given** client "Officina Ferri" has MUD deadline in 15 days, **When** Elena views aggregated dashboard, **Then** sees prominent alert banner with direct link to MUD preparation for that client

---

### User Story 3 - Field Operator Discovers Permission Boundaries (Priority: P1)

As a field operator using the mobile app, I need to immediately understand what actions I can perform and receive clear guidance when attempting restricted actions so that I can complete my work efficiently without frustration or security concerns.

**Why this priority**: Field operators are the highest-volume users. Poor UX here results in: support ticket flood, workarounds that bypass security, and user frustration. Mobile-first design for permission clarity is essential for adoption.

**Independent Test**: Test with mobile device, log in as OPERATOR role, attempt various actions (allowed: create FIR, update status; denied: delete records, modify closed FIRs). Verify clear visual indicators and helpful error messages.

**Acceptance Scenarios**:

1. **Given** field operator Maria has OPERATOR role, **When** she opens mobile app, **Then** sees only permitted actions with disabled/hidden buttons for restricted features
2. **Given** Maria taps disabled "Delete FIR" button, **When** tooltip appears, **Then** message explains "Your role (Operator) does not permit deletion. Contact your administrator [name + email]"
3. **Given** Maria views "My Profile" → "My Permissions" tab, **When** page loads, **Then** displays visual categorized list of permitted actions organized by module (FIR Management, Reports, etc.)
4. **Given** Maria attempts to access Reports section (requires MANAGER role), **When** permission denied, **Then** full-screen error page explains required role, current role, why restriction exists (compliance), and offers "Request Access" button
5. **Given** Maria's permissions expire mid-session, **When** she attempts next action, **Then** receives immediate notification "Your permissions have changed. Please refresh to continue." with clear refresh action

---

### User Story 4 - Compliance Officer Reviews Permission Audit Trail (Priority: P2)

As a compliance officer, I need to generate complete audit reports showing who accessed what data, when, and with which permissions during specific time periods so that I can demonstrate compliance during ARPA inspections and satisfy D.Lgs. 152/2006 requirements for 10-year audit trails.

**Why this priority**: Italian waste management regulations require immutable audit trails proving data access accountability. This protects the organization from regulatory fines (€2,600-€93,000) and provides evidence during inspections.

**Independent Test**: Create test scenario with multiple users performing various actions over time period. Generate audit report for specific FIR or time range. Verify report includes all required elements (user, action, timestamp, permission check result, tenant context).

**Acceptance Scenarios**:

1. **Given** ARPA inspector requests audit trail for FIR #2025-001234, **When** compliance officer generates report, **Then** receives comprehensive log showing: creation timestamp with creator identity, all modifications with user credentials, digital signatures with SPID fiscal codes, RENTRI submission confirmation
2. **Given** compliance officer reviews security events, **When** viewing audit log filtered by "Permission Denied" events, **Then** sees each denial with: user who attempted action, required permission, user's actual role, timestamp with millisecond precision, request context (IP, device)
3. **Given** consultant Elena performed actions across multiple tenants, **When** generating audit report, **Then** entries distinguish between Elena's actions: "acting as ADMIN for Officina Ferri" vs "acting as VIEWER for Metallurgica Rossi"
4. **Given** regulatory requirement for 10-year retention, **When** audit data reaches 3 years age, **Then** system automatically archives to cold storage while maintaining searchable index
5. **Given** compliance officer needs historical permission reconstruction, **When** querying "Who could access X on date Y?", **Then** system reconstructs permission state at that point in time from versioned role assignment history

---

### User Story 5 - Administrator Creates Custom Role for Enterprise Structure (Priority: P2)

As an environmental manager at large enterprise with complex organizational structure (multiple sites, specialized teams), I need to create custom roles like "Site Manager Milano" with granular permissions so that I can map internal org structure without forcing unnatural role assignments.

**Why this priority**: Enterprise clients represent high-value revenue opportunities (€15K-€45K/year). Custom roles enable enterprise tier upsell (3-10x price increase vs standard tier) by supporting complex hierarchies that don't fit predefined roles.

**Independent Test**: Test with enterprise scenario - create custom role with specific permission matrix, assign to user scoped to single facility, verify user sees only their facility data and has defined permissions.

**Acceptance Scenarios**:

1. **Given** Sara (Super Admin for large waste producer) accesses role management, **When** clicking "Create Custom Role", **Then** sees permission matrix builder with modules (FIR, Registry, Analytics, User Management) and actions (create, read, update, delete, approve, sign)
2. **Given** Sara creates "Site Manager Milano" role with permissions: FIR (create/read/update), Registry (read/write), Analytics (read), Users (none), **When** assigning to Luca Moretti scoped to Milano facility, **Then** Luca sees only Milano site in tenant selector
3. **Given** Sara creates "Internal Auditor" role with read-only access across all entities, **When** assigning to auditor, **Then** user can export reports and view all FIRs but cannot modify any data or view sensitive financial information
4. **Given** custom role assigned to 50 users, **When** Sara modifies role permissions, **Then** all users' effective permissions update immediately with cache invalidation, and change is logged in audit trail
5. **Given** Sara attempts to delete custom role currently assigned to users, **When** confirming deletion, **Then** system prevents action and shows "This role is assigned to 12 users. Reassign them first before deleting."

---

### User Story 6 - Fleet Manager Automates Task Assignment by Role (Priority: P2)

As a transporter fleet manager, I need to automatically route incoming FIR pickup requests to specific drivers based on their vehicle authorization, geographic zone, and certifications so that dispatching is compliant, efficient, and reduces manual coordination effort by 80%.

**Why this priority**: Transporters have complex dispatch requirements (ADR certification for hazardous waste, vehicle capacity matching, geographic routing). Manual dispatching takes 2 hours/day for 40-60 pickups. Automation saves 400 hours/year per fleet manager (€12K value) and reduces dispatch errors from 12% to <2%.

**Independent Test**: Configure routing rules (e.g., hazardous waste CER codes require ADR certification + specific vehicle type). Create test FIR with those requirements. Verify system auto-assigns to qualified driver and driver sees assignment in mobile app.

**Acceptance Scenarios**:

1. **Given** producer creates FIR for hazardous waste (CER 15 01 10*) pickup in Milano Nord zone, **When** system evaluates routing rules, **Then** assigns to driver Marco Bianchi who has ADR certification, operates Milano zone, and has vehicle capacity available
2. **Given** driver opens mobile app, **When** viewing "My Assignments", **Then** sees only FIRs assigned to them (not entire fleet) sorted by priority: urgent pickups first, then by proximity to current GPS location
3. **Given** driver cannot complete assigned pickup (vehicle breakdown), **When** marking FIR as "Unable to Complete", **Then** system auto-reassigns to next available qualified driver and notifies producer of reassignment with new ETA
4. **Given** fleet manager configures load balancing rule, **When** multiple drivers qualify for assignment, **Then** system distributes evenly across available drivers to prevent overloading single driver
5. **Given** audit of driver activities, **When** reviewing assignment history, **Then** shows original auto-assignment logic applied, any manual override decisions, completion time vs estimated time, driver feedback

---

### User Story 7 - User Requests Temporary Permission Elevation (Priority: P3)

As an employee who occasionally needs elevated permissions (during ARPA inspection when admin unavailable, preparing annual MUD report), I need to request temporary access with business justification so that admins can quickly approve without permanent role changes.

**Why this priority**: Real-world scenarios require temporary escalation. Alternative (sharing admin password) violates audit requirements. Self-service reduces admin burden from 3 hours/week to <1 hour/week on access management while maintaining security and accountability.

**Independent Test**: Log in as OPERATOR, attempt restricted action (e.g., export sensitive report). Click "Request Access" button, submit justification. Admin receives notification, approves with 8-hour time limit. Verify operator gains temporary permission, then auto-revoked after expiry.

**Acceptance Scenarios**:

1. **Given** operator Maria attempts to export MUD report (requires REPORTER permission), **When** permission denied, **Then** UI shows "Request Temporary Access" button with pre-filled context: permission needed, current action attempted
2. **Given** Maria submits access request with justification "Preparing MUD 2025 for external accountant, deadline tomorrow" and duration 24 hours, **When** admin Marco receives notification, **Then** sees request details with one-click Approve/Deny buttons
3. **Given** admin approves temporary elevation, **When** approval processed, **Then** Maria receives in-app notification + email confirmation "Permission granted for 24 hours - Expires at 2025-11-01 14:30"
4. **Given** temporary permission expires, **When** 24-hour window ends, **Then** system automatically revokes access, logs revocation event, and sends notification to both user and granting admin
5. **Given** security audit reviews temporary elevations, **When** filtering audit log, **Then** temporary grants clearly flagged with: granting admin, business justification, start/end timestamps, all actions performed during elevation window

---

### Edge Cases

- **What happens when user has conflicting roles?** System applies union of permissions (most permissive wins). Audit log records which specific role granted each permission. Alternative paranoid mode (configurable): deny access if conflict detected.

- **What happens when tenant administrator locks themselves out?** System prevents last admin from revoking own admin role via database constraint. If override needed, platform super admin can restore via master database.

- **How does system handle permission expiration mid-session?** Background job checks expirations every 5 minutes, publishes cache invalidation. Next API request receives 403 error, frontend shows "Permissions expired" message with clear next steps.

- **What happens during bulk role assignment (1000+ users)?** Async job processes assignments in chunks of 100 users. Cache invalidation batched. Admin UI shows progress bar with estimated completion time.

- **How is cross-tenant data leakage prevented?** Multi-layered defense: schema-per-tenant isolation, PostgreSQL Row-Level Security filters by tenant_id, permission cache keys include tenant_id hash, API responses scrubbed of cross-tenant data even if query accidentally fetches it.

- **What happens when SPID fiscal code changes (legal name change)?** Admin manually links old user record to new SPID fiscal code. User.previous_fiscal_codes array maintains history for audit trail continuity.

- **How are permission denials during offline operation handled?** Permissions cached locally for 24 hours with clear "Last synced" indicator. High-risk operations blocked in offline mode. Permission changes sync immediately on reconnect.

## Requirements *(mandatory)*

### Functional Requirements

**Core Permission Management**

- **FR-001**: System MUST support tenant-scoped role assignment where each user has specific role per tenant (Admin, Operator, Viewer, Consultant, Custom roles)
- **FR-002**: System MUST allow consultants to associate with multiple tenant accounts and seamlessly switch context between clients within single session
- **FR-003**: System MUST provide aggregated cross-tenant dashboard for consultants showing critical alerts, pending FIRs, upcoming deadlines across all managed clients
- **FR-004**: System MUST support five predefined system roles: ADMIN (full administrative access), OPERATOR (standard operational access for facility-scoped FIR management), VIEWER (read-only access), CONSULTANT (environmental consultant managing multiple client tenants), COMPLIANCE_OFFICER (audit and compliance specialist with full read access and report generation)
- **FR-005**: System MUST allow Super Admin users to create custom roles with granular permission matrix (per module and action)
- **FR-006**: System MUST enforce permission checks on every API request at multiple layers (module-level, resource-level, attribute-based policies)
- **FR-007**: System MUST support facility-scoped roles where users can only access data for assigned facilities within their tenant

**Permission Discovery & User Experience**

- **FR-008**: System MUST provide "My Permissions" interface where users can view all capabilities granted by their current role(s)
- **FR-009**: System MUST display clear, contextual error messages when permission denied, explaining: current role, required permission, who to contact, alternative actions
- **FR-010**: System MUST visually indicate permitted vs restricted actions in UI using consistent design system (color, icons, disabled states)
- **FR-011**: System MUST support permission preview before role assignment, showing administrator which capabilities will be granted
- **FR-012**: System MUST provide mobile-optimized permission discovery interface with touch-friendly role cards and accordion-style permission lists
- **FR-013**: System MUST implement "View as User" feature allowing administrators to preview interface as specific user would see it

**Temporary & Dynamic Permissions**

- **FR-014**: System MUST support temporary permission elevation with mandatory business justification, time bounds (start/end), and automatic expiration
- **FR-015**: System MUST allow users to request temporary access to restricted features via self-service workflow with admin approval required
- **FR-016**: System MUST automatically revoke expired permissions via background job (check every 5 minutes) and notify affected users
- **FR-017**: System MUST support delegation where users can temporarily grant subset of their permissions to other users with audit trail

**Audit & Compliance**

- **FR-018**: System MUST log all permission checks (granted and denied) in immutable audit trail with: user identity, SPID fiscal code, action attempted, resource accessed, decision result, timestamp with milliseconds, tenant context, IP address
- **FR-019**: System MUST retain audit logs per tenant configuration (minimum 10 years per D.Lgs. 152/2006) with automatic archival to cold storage
- **FR-020**: System MUST provide audit report generation showing complete access history for specific resource or user during time period
- **FR-021**: System MUST support historical permission reconstruction query: "Who could access resource X at timestamp Y?" by maintaining versioned role assignment history
- **FR-022**: System MUST log all role/permission changes with: changed by user, reason (mandatory for sensitive changes), before/after snapshots, timestamp
- **FR-023**: System MUST clearly distinguish consultant actions in audit trail: "Consultant [Name] acting as [Role] for [Tenant] performed [Action]"

**Integration with SPID/CIE Authentication**

- **FR-024**: System MUST authenticate users via SPID/CIE federation but maintain separate authorization (never trust SPID attributes for permissions)
- **FR-025**: System MUST create user account on first SPID login with default minimal role (Pending Approval or View-only) requiring admin activation
- **FR-026**: System MUST correlate all audit entries with SPID fiscal code for regulatory traceability
- **FR-027**: System MUST require step-up re-authentication via SPID/CIE for high-risk operations (delete FIR, approve user, digital signature) if more than 15 minutes have elapsed since last SPID authentication. Timer measures time since last successful SPID login and does NOT reset on regular API calls. High-risk operations trigger modal prompting user to re-authenticate via SPID before proceeding.
- **FR-028**: System MUST validate digital signature permission by checking both role permission and valid digital certificate before allowing FIR signing

**Automated Task Assignment**

- **FR-029**: System MUST support role-based task routing rules that automatically assign FIRs to users based on: role capabilities, facility scope, geographic zone, certifications (e.g., ADR for hazardous waste)
- **FR-030**: System MUST evaluate routing rules in priority order and assign to first matching qualified user or distribute evenly if multiple matches
- **FR-031**: System MUST allow reassignment of tasks with audit trail showing original assignment logic and override reason
- **FR-032**: System MUST filter user's task views by assigned resources only (drivers see only their assigned pickups, not entire fleet)

**Security & Multi-Tenancy**

- **FR-033**: System MUST enforce tenant isolation via schema-per-tenant architecture plus PostgreSQL Row-Level Security (RLS) as defense-in-depth
- **FR-034**: System MUST prevent last user with admin role from removing own admin permission via database constraint check
- **FR-035**: System MUST cache user permissions with tenant-specific keys and invalidate cache within 1 second (p95) of role or permission changes via Redis pub/sub pattern to ensure consistent authorization decisions across distributed instances
- **FR-036**: System MUST sign permission cache entries with HMAC to prevent cache poisoning attacks
- **FR-037**: System MUST validate tenant context matches JWT claim on every request and log mismatches as security events
- **FR-038**: System MUST prevent self-assignment of elevated roles and flag such attempts as potential security incidents

**Mobile & Offline Support**

- **FR-039**: System MUST provide mobile-responsive permission interfaces with minimum 48px touch targets and optimized layouts for portrait/landscape orientations
- **FR-040**: System MUST cache user permissions locally for 24 hours with clear "Last synced" indicator and sync immediately on reconnect
- **FR-041**: System MUST block high-risk operations in offline mode and show clear "Requires internet connection" message
- **FR-042**: System MUST handle permission changes during offline operation by prompting user to sync before continuing after reconnect

**Accessibility & Internationalization**

- **FR-043**: System MUST meet WCAG 2.1 Level AA compliance for all permission interfaces (required for Italian public sector)
- **FR-044**: System MUST support keyboard-only navigation with visible focus indicators (2px outline, 4.5:1 contrast)
- **FR-045**: System MUST provide screen reader support with proper ARIA labels, landmarks, and live region announcements for permission changes
- **FR-046**: System MUST ensure minimum 4.5:1 color contrast for permission states and never rely on color alone (use icons + text)
- **FR-047**: System MUST support Italian (it-IT) as primary language with formal tone appropriate for public sector users

### Key Entities

**Role**
- Represents named collection of permissions within tenant
- Attributes: unique name per tenant, description, is_system_role flag (prevents deletion), list of associated permissions
- Relationships: Many-to-many with User (via UserRole), many-to-many with Permission (via RolePermission)
- Business Rules: System roles cannot be modified or deleted, custom roles only deletable if no users assigned

**Permission**
- Represents atomic capability to perform action on resource
- Attributes: resource type (fir, facility, report, user, etc.), action (create, read, update, delete, approve, sign), scope (own, facility, all), sensitivity flag
- Relationships: Many-to-many with Role (via RolePermission), one-to-many with PermissionPolicy
- Business Rules: Permissions are platform-defined (not user-creatable), format follows pattern {resource}:{action}:{scope}

**UserRole**
- Junction entity assigning users to roles with optional constraints
- Attributes: user reference, role reference, assigned_by user, timestamps (assigned_at, expires_at), facility_ids array (for facility-scoped roles), is_delegated flag, delegation_reason
- Relationships: References User entity, references Role entity
- Business Rules: Users can have multiple roles (union of permissions applies), expired assignments auto-revoked, facility scope enforces additional filtering

**PermissionPolicy**
- Represents attribute-based access control (ABAC) rules for fine-grained decisions
- Attributes: policy name, policy definition (structured rules in JSON), evaluation order, is_active flag, associated permission
- Relationships: Many-to-one with Permission
- Business Rules: Policies evaluated in order until first ALLOW, policy syntax validated on creation, changes versioned for rollback

**PermissionAuditLog**
- Immutable record of all authorization events
- Attributes: tenant context, user identity, SPID fiscal code, action attempted, resource type/ID, decision (ALLOW/DENY), evaluated policies, context attributes (IP, device, timestamp with milliseconds), session ID
- Relationships: References User and Tenant
- Business Rules: Append-only (no updates/deletes), partitioned by month, retained per tenant's compliance requirement (10+ years)

**RoleChangeHistory**
- Tracks all role and permission modifications for audit purposes
- Attributes: entity type (Role, UserRole, RolePermission), entity ID, change type (CREATE, UPDATE, DELETE, ASSIGN, REVOKE), changed_by user, before/after snapshots (JSON), reason text, timestamp
- Relationships: References User who made change
- Business Rules: Immutable, sensitive changes trigger admin alerts, enables historical permission reconstruction

**ResourceOwnership** (for ABAC policies)
- Tracks ownership for resource-level access control
- Attributes: resource type, resource ID, owner user, facility association, created timestamp
- Relationships: References User and Facility entities
- Business Rules: Ownership transfer requires manager approval, used in "own" scope permission checks

**TemporaryPermissionGrant**
- Represents time-bound permission elevations
- Attributes: user granted to, permission list, start/end timestamps, granting user, business justification, auto-revoked flag
- Relationships: References granting and receiving User
- Business Rules: Minimum 10 character justification required, background job checks expiry every 5 minutes, logs all actions performed during elevation window

## Success Criteria *(mandatory)*

### Measurable Outcomes

**User Productivity & Satisfaction**

- **SC-001**: Consultants manage average 50+ client tenants (vs baseline 35 max) measured by actual tenant associations per consultant account
- **SC-002**: Tenant context switch completes in under 2 seconds including JWT regeneration and UI reload, measured at 95th percentile
- **SC-003**: 90% of users complete onboarding permission quiz correctly without training, indicating clear role capability understanding
- **SC-004**: Permission-related support tickets reduce to less than 5 per week (vs baseline 15-20), measured via support ticket tagging
- **SC-005**: Users rate permission clarity at 4+ out of 5 in quarterly satisfaction survey ("I understand what I can and cannot do")
- **SC-006**: Role assignment by administrator completes in under 30 seconds from user invite to email sent

**Technical Performance**

- **SC-007**: Permission check authorization decision completes in under 10 milliseconds at 99th percentile under peak load (10,000 requests/second)
- **SC-008**: Permission cache hit rate exceeds 95%, measured via Redis cache statistics
- **SC-009**: Audit log write lag remains under 1 second at 99th percentile, ensuring real-time compliance logging
- **SC-010**: Zero cross-tenant data leakage incidents detected in automated penetration testing and quarterly security audits
- **SC-011**: System handles bulk role assignment of 1,000 users in under 5 minutes with progress tracking
- **SC-012**: Mobile app permission discovery interface loads in under 2 seconds on 3G connection

**Security & Compliance**

- **SC-013**: 100% of compliance-critical actions protected by permission checks, verified via automated static code analysis
- **SC-014**: Audit trail integrity maintained at 100% with cryptographic chain validation passing for all entries
- **SC-015**: Zero production incidents from permission misconfiguration after phased rollout completion
- **SC-016**: ARPA inspection audit trail request fulfilled in under 10 minutes without engineering involvement
- **SC-017**: System successfully passes Italian public sector accessibility audit with zero critical WCAG 2.1 violations
- **SC-018**: False positive rate for anomaly detection remains below 10% (alerts that are actually legitimate behavior)

**Business Impact**

- **SC-019**: Enterprise tier conversion rate increases from 5% to 20% of trial users after custom role feature launch
- **SC-020**: Administrator time spent on access management reduces from 3 hours/week to under 1 hour/week per tenant
- **SC-021**: 70% of temporary permission requests approved within 30 minutes (vs 4-hour baseline for email-based requests)
- **SC-022**: Field operator task completion time improves by 40% due to clear permission indicators and reduced confusion
- **SC-023**: Automated task assignment achieves 80% auto-assignment rate without manual dispatcher intervention
- **SC-024**: Zero regulatory fines related to access control or audit trail deficiencies in first year post-launch

### Assumptions

- SPID/CIE authentication infrastructure already operational and integrated with existing authentication module
- PostgreSQL Row-Level Security (RLS) already configured for tenant isolation in current schema-per-tenant architecture
- Redis cluster available for high-availability permission caching with pub/sub support
- BullMQ background job system operational for async tasks (permission expiration checks, audit archival)
- Existing User entity can be extended with additional fields (SPID fiscal code, certification level, digital certificate reference)
- Frontend Angular application already uses NgRx for state management, can extend with permission state slice
- Mobile app development capacity available for responsive permission UI components
- Legal/compliance review completed for 10-year audit retention and consultant multi-tenant access model
- Italian localization resources available for all permission-related UI text and error messages
- AWS S3 or equivalent cold storage available for audit log archival (3+ years)

### Dependencies

- SPID/CIE authentication module must provide fiscal code claim in SAML assertion for audit correlation
- Existing tenant provisioning workflow must be extended to seed default role set on new tenant creation
- NestJS Guards framework must support new @RequirePermission() decorator with ABAC policy evaluation
- Prisma schema must support new entities (Role, Permission, UserRole, PermissionPolicy, PermissionAuditLog, etc.)
- Angular PrimeNG components (Table, Dialog, Card) must be available for permission matrix UI builder
- Notification system must support real-time delivery for permission change alerts and temporary grant expiry
- Digital signature validation service must expose API for checking certificate validity during permission evaluation
- RENTRI integration module must accept user context for permission-aware sync operations
- Analytics dashboard must query permission service to filter widgets based on user capabilities
- MUD reporting module must enforce Reporter role permission before allowing sensitive data export

## Out of Scope

- **Automated Task Assignment (User Story 6)**: Role-based task routing rules for automatic FIR assignment to qualified users based on certifications, geographic zones, and vehicle capacity. Deferred to Phase 2 (post-MVP) due to complexity of routing logic and integration with fleet management systems. Manual task assignment via UI remains available. Related requirements: FR-029, FR-030, FR-031, FR-032. Business justification: Delivers 80% of permission system value without routing complexity. Can be added after P1-P3 user stories validated with real users.
- External identity provider integrations beyond SPID/CIE (e.g., Azure AD, Google Workspace) - future enhancement
- Machine learning-based anomaly detection (Phase 1 uses rule-based detection, ML in future phase)
- Offline mobile app with local permission enforcement (permissions cached but high-risk operations require connectivity)
- Custom ABAC policy authoring by tenant administrators (Phase 1 uses platform-provided policies only)
- Real-time permission revocation via WebSocket push notifications (current: 5-minute background job polling)
- Blockchain-based immutable audit trail (cryptographic chaining provides similar guarantee without blockchain complexity)
- Multi-factor authentication (MFA) for step-up authentication (Phase 1 uses SPID re-authentication only)
- Geofencing-based permission enforcement (e.g., field operator can only update FIR when physically at collection site)
- Voice-activated permission queries for mobile users ("Hey app, what can I do?")
- Permission analytics dashboard showing usage patterns, frequently denied actions, optimization recommendations
