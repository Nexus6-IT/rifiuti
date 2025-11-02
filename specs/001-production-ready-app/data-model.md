# Data Model: Production-Ready Web Application

**Feature**: 001-production-ready-app | **Date**: 2025-10-30

This document defines all entities, value objects, and relationships for the production-ready WasteFlow application.

## Entity Overview

### New Entities (from spec.md Key Entities section)
1. **RENTRISyncLog** - RENTRI synchronization tracking
2. **DigitalSignature** - FIR digital signature records
3. **Notification** - User notification/alert system
4. **TenantSubscription** - Tenant service levels and billing
5. **BackupLog** - Automated backup execution records
6. **MUDReport** - MUD report generation tracking
7. **AuditLog** - Enhanced audit trail (existing, to be enhanced)

### Existing Entities (from README.md)
- **User** - User accounts with SPID/CIE auth
- **Tenant** - Multi-tenant organizations
- **FIR** - Formulario Identificazione Rifiuti (aggregate root)
- **CERCatalog** - Waste classification codes (shared reference data)

---

## 1. RENTRISyncLog Entity

**Purpose**: Track all synchronization attempts with RENTRI government registry for compliance auditing.

**Domain**: `apps/backend/src/domain/rentri/entities/rentri-sync-log.entity.ts`

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, required | Unique sync log identifier |
| `tenantId` | UUID | FK, required, indexed | Owning tenant (multi-tenant isolation) |
| `firId` | UUID | FK, nullable, indexed | Associated FIR (if sync type is FIR) |
| `registryEntryId` | UUID | FK, nullable | Associated registry entry (if sync type is REGISTRY) |
| `syncType` | Enum | required | Type: `FIR` \| `REGISTRY_CARICO` \| `REGISTRY_SCARICO` |
| `status` | Enum | required, indexed | Status: `PENDING` \| `SYNCED` \| `ERROR` \| `RETRYING` |
| `attemptNumber` | Integer | required, default: 1 | Current retry attempt (max 3 per FR-003) |
| `requestPayload` | JSONB | required | RENTRI API request body (for audit) |
| `responsePayload` | JSONB | nullable | RENTRI API response body |
| `responseStatus` | Integer | nullable | HTTP status code (200, 400, 500, etc.) |
| `errorMessage` | Text | nullable | Human-readable error description |
| `errorCode` | String | nullable | RENTRI-specific error code |
| `syncedAt` | Timestamp | nullable | Successful sync timestamp |
| `nextRetryAt` | Timestamp | nullable | Scheduled retry time (exponential backoff) |
| `createdAt` | Timestamp | required, default: now() | Record creation timestamp |
| `updatedAt` | Timestamp | required, auto-update | Last modification timestamp |

### Relationships

- **BelongsTo** `Tenant` (tenantId)
- **BelongsTo** `FIR` (firId, optional)
- **BelongsTo** `RegistryEntry` (registryEntryId, optional)

### Business Rules (Domain Methods)

```typescript
class RENTRISyncLog extends Entity {
  // Mark sync as successful
  markSynced(responsePayload: any): void {
    if (this.status === SyncStatus.SYNCED) {
      throw new DomainError('Sync already marked as successful');
    }
    this.status = SyncStatus.SYNCED;
    this.responsePayload = responsePayload;
    this.syncedAt = new Date();
  }

  // Record sync failure and calculate next retry
  markFailed(errorMessage: string, errorCode?: string): void {
    this.status = this.attemptNumber < 3 ? SyncStatus.RETRYING : SyncStatus.ERROR;
    this.errorMessage = errorMessage;
    this.errorCode = errorCode;
    this.attemptNumber += 1;

    // Exponential backoff: 5min, 15min, 60min (per FR-003)
    const delays = [5, 15, 60];
    if (this.attemptNumber <= 3) {
      this.nextRetryAt = new Date(Date.now() + delays[this.attemptNumber - 1] * 60 * 1000);
    }
  }

  // Check if retry is due
  isRetryDue(): boolean {
    return this.status === SyncStatus.RETRYING &&
           this.nextRetryAt &&
           new Date() >= this.nextRetryAt;
  }
}
```

### Indexes

```sql
CREATE INDEX idx_rentri_sync_log_tenant_status ON rentri_sync_log(tenant_id, status);
CREATE INDEX idx_rentri_sync_log_fir ON rentri_sync_log(fir_id) WHERE fir_id IS NOT NULL;
CREATE INDEX idx_rentri_sync_log_next_retry ON rentri_sync_log(next_retry_at) WHERE status = 'RETRYING';
```

---

## 2. DigitalSignature Entity

**Purpose**: Store cryptographic signatures for FIR documents with SPID-authenticated signers.

**Domain**: `apps/backend/src/domain/signatures/entities/digital-signature.entity.ts`

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, required | Unique signature identifier |
| `firId` | UUID | FK, required, indexed | Associated FIR document |
| `signerUserId` | UUID | FK, required | User who signed (SPID-authenticated) |
| `signerRole` | Enum | required | Role: `PRODUCER` \| `TRANSPORTER` \| `DESTINATION` |
| `signerFiscalCode` | String(16) | required | Italian fiscal code from SPID |
| `signatureHash` | Text | required | Base64-encoded ECDSA-SHA256 signature |
| `algorithm` | String | required, default: 'ECDSA-SHA256' | Signature algorithm |
| `firDataHash` | String(64) | required | SHA-256 hash of FIR data at signing time |
| `timestamp` | Timestamp | required, indexed | Signature creation timestamp (legal timestamp) |
| `spidLevel` | Enum | required | SPID level: `LEVEL_1` \| `LEVEL_2` \| `LEVEL_3` |
| `spidSessionId` | String | required | SPID session ID for traceability |
| `ipAddress` | String | required | Signer IP address (audit trail) |
| `userAgent` | Text | nullable | Signer browser/device info |
| `verificationUrl` | String | required | Public URL for signature verification |
| `isValid` | Boolean | required, default: true | Signature validity (false if revoked) |
| `revokedAt` | Timestamp | nullable | Revocation timestamp (if applicable) |
| `revokedReason` | Text | nullable | Revocation justification |

### Relationships

- **BelongsTo** `FIR` (firId)
- **BelongsTo** `User` (signerUserId)

### Business Rules

```typescript
class DigitalSignature extends Entity {
  // Verify signature against current FIR data
  verify(currentFIR: FIR, publicKey: crypto.KeyObject): boolean {
    if (!this.isValid) {
      return false; // Revoked signature
    }

    // Reconstruct data-to-sign
    const dataToSign = [
      this.firId,
      this.firDataHash,
      this.signerFiscalCode,
      this.timestamp.toISOString(),
      this.spidSessionId,
    ].join('|');

    // Verify cryptographic signature
    return crypto.verify(
      'sha256',
      Buffer.from(dataToSign),
      publicKey,
      Buffer.from(this.signatureHash, 'base64')
    );
  }

  // Revoke signature (e.g., if signer identity compromised)
  revoke(reason: string): void {
    if (!this.isValid) {
      throw new DomainError('Signature already revoked');
    }
    this.isValid = false;
    this.revokedAt = new Date();
    this.revokedReason = reason;
  }
}
```

### Indexes

```sql
CREATE INDEX idx_digital_signature_fir ON digital_signature(fir_id);
CREATE INDEX idx_digital_signature_signer ON digital_signature(signer_user_id);
CREATE INDEX idx_digital_signature_timestamp ON digital_signature(timestamp DESC);
```

---

## 3. Notification Entity

**Purpose**: User notification/alert system for deadlines, errors, and system events.

**Domain**: `apps/backend/src/domain/notifications/entities/notification.entity.ts`

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, required | Unique notification identifier |
| `tenantId` | UUID | FK, required, indexed | Owning tenant |
| `userId` | UUID | FK, required, indexed | Recipient user |
| `type` | Enum | required | Type: `DEADLINE` \| `ERROR` \| `INFO` \| `WARNING` |
| `severity` | Enum | required | Severity: `LOW` \| `MEDIUM` \| `HIGH` \| `CRITICAL` |
| `title` | String(255) | required | Notification title (short) |
| `message` | Text | required | Full notification message |
| `actionUrl` | String | nullable | Deep link to related resource (e.g., FIR detail) |
| `actionLabel` | String(50) | nullable | Button label (e.g., "View FIR", "Resolve") |
| `relatedEntityType` | String | nullable | Entity type: `FIR`, `MUD`, `RENTRI_SYNC`, etc. |
| `relatedEntityId` | UUID | nullable | Entity ID for context |
| `deliveryChannels` | JSONB | required | Channels: `{ email: true, inApp: true, push: false }` |
| `emailSentAt` | Timestamp | nullable | Email delivery timestamp |
| `readAt` | Timestamp | nullable, indexed | In-app read timestamp |
| `dismissedAt` | Timestamp | nullable | User dismissal timestamp |
| `expiresAt` | Timestamp | nullable | Auto-expire timestamp (e.g., deadline passed) |
| `createdAt` | Timestamp | required, default: now() | Creation timestamp |

### Relationships

- **BelongsTo** `Tenant` (tenantId)
- **BelongsTo** `User` (userId)

### Business Rules

```typescript
class Notification extends Entity {
  // Mark notification as read
  markRead(): void {
    if (this.readAt) {
      return; // Already read, no-op
    }
    this.readAt = new Date();
  }

  // Dismiss notification (hide from UI)
  dismiss(): void {
    if (this.dismissedAt) {
      return;
    }
    this.dismissedAt = new Date();
  }

  // Check if notification is expired
  isExpired(): boolean {
    return this.expiresAt && new Date() > this.expiresAt;
  }

  // Check if notification is overdue (deadline passed without action)
  isOverdue(): boolean {
    return this.type === NotificationType.DEADLINE &&
           this.expiresAt &&
           new Date() > this.expiresAt &&
           !this.dismissedAt;
  }

  // Escalate severity (e.g., deadline approaching → overdue)
  escalate(): void {
    if (this.severity === Severity.CRITICAL) {
      return; // Already max severity
    }
    const severities = [Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL];
    const currentIndex = severities.indexOf(this.severity);
    this.severity = severities[currentIndex + 1];
  }
}
```

### Indexes

```sql
CREATE INDEX idx_notification_user_unread ON notification(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notification_tenant_type ON notification(tenant_id, type);
CREATE INDEX idx_notification_expires_at ON notification(expires_at) WHERE expires_at IS NOT NULL;
```

---

## 4. TenantSubscription Entity

**Purpose**: Manage tenant service levels, billing, feature flags, and usage limits.

**Domain**: `apps/backend/src/domain/tenants/entities/tenant-subscription.entity.ts`

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, required | Subscription identifier |
| `tenantId` | UUID | FK, required, unique | One subscription per tenant |
| `tier` | Enum | required | Tier: `FREE` \| `PRO` \| `BUSINESS` \| `ENTERPRISE` |
| `status` | Enum | required | Status: `ACTIVE` \| `SUSPENDED` \| `CANCELLED` \| `TRIAL` |
| `firLimitMonthly` | Integer | required | FIR quota per month (10, 100, 500, unlimited) |
| `firUsedThisMonth` | Integer | required, default: 0 | FIRs used in current billing month |
| `storageQuotaGB` | Decimal | required | Storage limit in GB |
| `storageUsedGB` | Decimal | required, default: 0 | Current storage usage |
| `features` | JSONB | required | Feature flags: `{ api: true, mobile: false, mud: true, ... }` |
| `billingCycle` | Enum | required | Cycle: `MONTHLY` \| `ANNUAL` |
| `monthlyPriceEUR` | Decimal | required | Monthly cost in EUR |
| `trialEndsAt` | Timestamp | nullable | Trial expiration (if status = TRIAL) |
| `currentPeriodStart` | Timestamp | required | Current billing period start |
| `currentPeriodEnd` | Timestamp | required | Current billing period end |
| `cancelledAt` | Timestamp | nullable | Cancellation timestamp |
| `cancellationReason` | Text | nullable | Reason for cancellation |
| `createdAt` | Timestamp | required | Subscription start |
| `updatedAt` | Timestamp | required | Last modification |

### Relationships

- **BelongsTo** `Tenant` (tenantId, one-to-one)

### Business Rules

```typescript
class TenantSubscription extends Entity {
  // Check if FIR creation is allowed
  canCreateFIR(): boolean {
    if (this.status !== SubscriptionStatus.ACTIVE) {
      throw new DomainError('Subscription not active');
    }
    if (this.tier === SubscriptionTier.ENTERPRISE) {
      return true; // Unlimited
    }
    return this.firUsedThisMonth < this.firLimitMonthly;
  }

  // Increment FIR usage counter
  incrementFIRUsage(): void {
    this.firUsedThisMonth += 1;
    if (this.firUsedThisMonth >= this.firLimitMonthly) {
      // Trigger notification: quota exceeded
    }
  }

  // Reset monthly counters (cron job on billing cycle)
  resetMonthlyUsage(): void {
    this.firUsedThisMonth = 0;
    this.currentPeriodStart = this.currentPeriodEnd;
    this.currentPeriodEnd = new Date(this.currentPeriodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  // Check feature availability
  hasFeature(feature: string): boolean {
    return this.features[feature] === true;
  }

  // Upgrade tier
  upgrade(newTier: SubscriptionTier, newPrice: number): void {
    const tiers = [SubscriptionTier.FREE, SubscriptionTier.PRO, SubscriptionTier.BUSINESS, SubscriptionTier.ENTERPRISE];
    if (tiers.indexOf(newTier) <= tiers.indexOf(this.tier)) {
      throw new DomainError('New tier must be higher than current');
    }
    this.tier = newTier;
    this.monthlyPriceEUR = newPrice;
    this.updateFeatureFlags(newTier);
  }
}
```

### Indexes

```sql
CREATE UNIQUE INDEX idx_tenant_subscription_tenant ON tenant_subscription(tenant_id);
CREATE INDEX idx_tenant_subscription_status ON tenant_subscription(status);
CREATE INDEX idx_tenant_subscription_trial_end ON tenant_subscription(trial_ends_at) WHERE trial_ends_at IS NOT NULL;
```

---

## 5. BackupLog Entity

**Purpose**: Track automated PostgreSQL backup executions for compliance and disaster recovery.

**Domain**: `apps/backend/src/domain/operations/entities/backup-log.entity.ts`

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, required | Backup log identifier |
| `backupType` | Enum | required | Type: `FULL` \| `INCREMENTAL` \| `MANUAL` |
| `status` | Enum | required | Status: `STARTED` \| `COMPLETED` \| `FAILED` |
| `s3Bucket` | String | required | S3 bucket name |
| `s3Key` | String | required | S3 object key (path) |
| `fileSizeBytes` | BigInteger | nullable | Backup file size |
| `checksumSHA256` | String(64) | required | SHA-256 checksum for integrity |
| `encryptionAlgorithm` | String | required, default: 'AES-256' | Encryption method (per FR-060) |
| `startedAt` | Timestamp | required | Backup start timestamp |
| `completedAt` | Timestamp | nullable | Backup completion timestamp |
| `durationSeconds` | Integer | nullable | Total backup duration |
| `errorMessage` | Text | nullable | Error details (if status = FAILED) |
| `retentionDays` | Integer | required, default: 30 | Days to retain backup (per FR-061) |
| `expiresAt` | Timestamp | required | Auto-deletion timestamp |
| `triggeredBy` | Enum | required | Trigger: `CRON` \| `MANUAL` \| `API` |
| `initiatorUserId` | UUID | FK, nullable | User ID (if triggered manually) |
| `createdAt` | Timestamp | required | Record creation |

### Relationships

- **BelongsTo** `User` (initiatorUserId, optional)

### Business Rules

```typescript
class BackupLog extends Entity {
  // Mark backup as completed successfully
  markCompleted(fileSizeBytes: number, checksumSHA256: string): void {
    if (this.status === BackupStatus.COMPLETED) {
      throw new DomainError('Backup already completed');
    }
    this.status = BackupStatus.COMPLETED;
    this.completedAt = new Date();
    this.fileSizeBytes = fileSizeBytes;
    this.checksumSHA256 = checksumSHA256;
    this.durationSeconds = Math.floor((this.completedAt.getTime() - this.startedAt.getTime()) / 1000);
  }

  // Mark backup as failed
  markFailed(errorMessage: string): void {
    this.status = BackupStatus.FAILED;
    this.completedAt = new Date();
    this.errorMessage = errorMessage;
    // Trigger alert email (per FR-062)
  }

  // Check if backup is expired (for cleanup)
  isExpired(): boolean {
    return new Date() >= this.expiresAt;
  }

  // Validate backup integrity
  async validateIntegrity(s3Client: S3Client): Promise<boolean> {
    const object = await s3Client.getObject({ Bucket: this.s3Bucket, Key: this.s3Key });
    const computedChecksum = crypto.createHash('sha256').update(object.Body).digest('hex');
    return computedChecksum === this.checksumSHA256;
  }
}
```

### Indexes

```sql
CREATE INDEX idx_backup_log_status ON backup_log(status);
CREATE INDEX idx_backup_log_expires_at ON backup_log(expires_at);
CREATE INDEX idx_backup_log_started_at ON backup_log(started_at DESC);
```

---

## 6. MUDReport Entity

**Purpose**: Track MUD (Modello Unico Dichiarazione Ambientale) annual report generation status.

**Domain**: `apps/backend/src/domain/reporting/entities/mud-report.entity.ts`

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, required | Report identifier |
| `tenantId` | UUID | FK, required, indexed | Owning tenant |
| `reportYear` | Integer | required | Calendar year (e.g., 2025) |
| `status` | Enum | required | Status: `DRAFT` \| `VALIDATING` \| `COMPLETED` \| `SUBMITTED` |
| `completenessPercent` | Integer | required, default: 0 | Data completeness (0-100%) |
| `validationErrors` | JSONB | nullable | Array of validation issues |
| `aggregatedData` | JSONB | required | Summary: `{ cerCodes: [...], totalKg: 12345, ... }` |
| `pdfUrl` | String | nullable | S3 URL for generated PDF |
| `xmlUrl` | String | nullable | S3 URL for machine-readable XML |
| `generatedBy` | UUID | FK, required | User who generated report |
| `generatedAt` | Timestamp | nullable | Generation timestamp |
| `submittedAt` | Timestamp | nullable | Submission to authorities timestamp |
| `submissionConfirmation` | String | nullable | Government receipt number |
| `expiresAt` | Timestamp | required | Report deadline (April 30) |
| `createdAt` | Timestamp | required | Draft creation |
| `updatedAt` | Timestamp | required | Last modification |

### Relationships

- **BelongsTo** `Tenant` (tenantId)
- **BelongsTo** `User` (generatedBy)

### Business Rules

```typescript
class MUDReport extends Entity {
  // Calculate data completeness
  calculateCompleteness(firData: FIR[], registryData: RegistryEntry[]): number {
    // Check required fields for MUD:
    // - All CER codes used
    // - Quantities by destination type (R/D operations)
    // - Transporter details
    const required = ['cerCodes', 'destinationTypes', 'transporters'];
    const complete = required.filter(field => this.aggregatedData[field]).length;
    this.completenessPercent = Math.floor((complete / required.length) * 100);
    return this.completenessPercent;
  }

  // Validate MUD data
  validate(): void {
    this.status = MUDReportStatus.VALIDATING;
    const errors = [];

    if (!this.aggregatedData.cerCodes || this.aggregatedData.cerCodes.length === 0) {
      errors.push({ field: 'cerCodes', message: 'No CER codes found for year' });
    }

    if (this.completenessPercent < 100) {
      errors.push({ field: 'completeness', message: `Data only ${this.completenessPercent}% complete` });
    }

    this.validationErrors = errors.length > 0 ? errors : null;
    this.status = errors.length === 0 ? MUDReportStatus.COMPLETED : MUDReportStatus.DRAFT;
  }

  // Mark as submitted to authorities
  markSubmitted(confirmationNumber: string): void {
    if (this.status !== MUDReportStatus.COMPLETED) {
      throw new DomainError('Cannot submit incomplete MUD report');
    }
    this.status = MUDReportStatus.SUBMITTED;
    this.submittedAt = new Date();
    this.submissionConfirmation = confirmationNumber;
  }

  // Check if deadline is approaching
  isDeadlineApproaching(daysThreshold: number): boolean {
    const daysRemaining = Math.floor((this.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return daysRemaining <= daysThreshold && daysRemaining > 0;
  }
}
```

### Indexes

```sql
CREATE INDEX idx_mud_report_tenant_year ON mud_report(tenant_id, report_year);
CREATE INDEX idx_mud_report_status ON mud_report(status);
CREATE INDEX idx_mud_report_expires_at ON mud_report(expires_at);
```

---

## 7. AuditLog Entity (Enhanced)

**Purpose**: Enhanced audit trail for compliance (RENTRI ops, signatures, tenant switches).

**Existing**: `apps/backend/src/domain/audit/entities/audit-log.entity.ts` (to be enhanced)

### New Fields (additions to existing schema)

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `operationType` | Enum | required | NEW: `RENTRI_SYNC` \| `DIGITAL_SIGNATURE` \| `TENANT_SWITCH` \| ... |
| `spidSessionId` | String | nullable | NEW: SPID session for signature operations |
| `rentriSyncLogId` | UUID | FK, nullable | NEW: Link to RENTRI sync log |
| `digitalSignatureId` | UUID | FK, nullable | NEW: Link to digital signature |

### Enhanced Indexes

```sql
CREATE INDEX idx_audit_log_operation_type ON audit_log(operation_type);
CREATE INDEX idx_audit_log_rentri_sync ON audit_log(rentri_sync_log_id) WHERE rentri_sync_log_id IS NOT NULL;
CREATE INDEX idx_audit_log_signature ON audit_log(digital_signature_id) WHERE digital_signature_id IS NOT NULL;
```

---

## Entity Relationship Diagram (ERD)

```
┌─────────────┐         ┌─────────────────┐         ┌──────────────┐
│   Tenant    │◄────────│ TenantSubscription│       │    User      │
│             │ 1     1 │                 │       │              │
└──────┬──────┘         └─────────────────┘       └───────┬──────┘
       │ 1                                                 │ 1
       │                                                   │
       │ *                                                 │ *
┌──────▼──────┐         ┌─────────────────┐         ┌────▼──────────┐
│     FIR     │◄────────│ RENTRISyncLog   │         │ Notification  │
│             │ 1     * │                 │         │               │
└──────┬──────┘         └─────────────────┘         └───────────────┘
       │ 1
       │
       │ 3
┌──────▼────────────┐
│ DigitalSignature  │
│ (Producer,        │
│  Transporter,     │
│  Destination)     │
└───────────────────┘

┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│  MUDReport  │         │  BackupLog   │         │  AuditLog    │
│             │         │              │         │              │
└─────────────┘         └──────────────┘         └──────────────┘

┌─────────────┐
│ CERCatalog  │
│ (shared ref)│
└─────────────┘
```

---

## Summary

**7 New Entities** defined with:
- Complete field specifications
- Business rule methods (domain logic)
- Database indexes for performance
- Multi-tenant isolation (all have `tenantId` except shared CERCatalog)
- Compliance requirements (GDPR, audit trails, 7-year retention)

**Next Phase**: Generate OpenAPI contracts in `/contracts/` directory.