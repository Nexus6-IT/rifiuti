-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "subscription_tier" AS ENUM ('TRIAL', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "fir_status" AS ENUM ('DRAFT', 'AWAITING_PRODUCER', 'AWAITING_CARRIER', 'AWAITING_RECEIVER', 'COMPLETED', 'SYNCED_TO_RENTRI', 'CANCELLED');

-- CreateEnum
CREATE TYPE "rentri_sync_status" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'PERMANENTLY_FAILED');

-- CreateEnum
CREATE TYPE "mud_status" AS ENUM ('DRAFT', 'REVIEWING', 'SUBMITTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('FIR_DEADLINE_APPROACHING', 'RENTRI_SYNC_FAILED', 'RENTRI_SYNC_SUCCESS', 'MUD_DEADLINE_APPROACHING', 'SUBSCRIPTION_EXPIRING', 'SIGNATURE_REQUIRED', 'SYSTEM_ERROR');

-- CreateEnum
CREATE TYPE "notification_severity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "backup_frequency" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "backup_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "abac_policy_effect" AS ENUM ('ALLOW', 'DENY');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "partita_iva" VARCHAR(11) NOT NULL,
    "ragione_sociale" VARCHAR(255) NOT NULL,
    "pec" VARCHAR(255),
    "address" VARCHAR(255) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "province" VARCHAR(2) NOT NULL,
    "postal_code" VARCHAR(5) NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT 'IT',
    "subscription_tier" "subscription_tier" NOT NULL DEFAULT 'TRIAL',
    "subscription_status" "subscription_status" NOT NULL DEFAULT 'TRIAL',
    "subscription_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscription_end" TIMESTAMP(3),
    "fir_limit_per_month" INTEGER NOT NULL DEFAULT 100,
    "user_limit_total" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "keycloak_id" VARCHAR(255) NOT NULL,
    "fiscal_code" VARCHAR(16) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(20),
    "role" "user_role" NOT NULL DEFAULT 'OPERATOR',
    "notification_preferences" JSONB,
    "signature_certificate" TEXT,
    "signature_certificate_hash" VARCHAR(64),
    "signature_valid_until" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "fir_number" VARCHAR(50) NOT NULL,
    "status" "fir_status" NOT NULL DEFAULT 'DRAFT',
    "workflow_version" INTEGER NOT NULL DEFAULT 1,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "producer_user_id" UUID NOT NULL,
    "producer_partita_iva" VARCHAR(11) NOT NULL,
    "producer_name" VARCHAR(255) NOT NULL,
    "producer_address" VARCHAR(500) NOT NULL,
    "producer_contact" VARCHAR(255),
    "carrier_user_id" UUID,
    "carrier_partita_iva" VARCHAR(11) NOT NULL,
    "carrier_name" VARCHAR(255) NOT NULL,
    "carrier_vehicle_plate" VARCHAR(20) NOT NULL,
    "carrier_contact" VARCHAR(255),
    "receiver_user_id" UUID,
    "receiver_partita_iva" VARCHAR(11) NOT NULL,
    "receiver_name" VARCHAR(255) NOT NULL,
    "receiver_address" VARCHAR(500) NOT NULL,
    "receiver_contact" VARCHAR(255),
    "cer_code" VARCHAR(6) NOT NULL,
    "waste_description" VARCHAR(500) NOT NULL,
    "waste_category" VARCHAR(100) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unit" VARCHAR(10) NOT NULL DEFAULT 'KG',
    "transport_date" TIMESTAMP(3) NOT NULL,
    "estimated_arrival_date" TIMESTAMP(3),
    "actual_arrival_date" TIMESTAMP(3),
    "transport_notes" TEXT,
    "rentri_sync_status" "rentri_sync_status" NOT NULL DEFAULT 'PENDING',
    "rentri_protocol_number" VARCHAR(100),
    "rentri_synced_at" TIMESTAMP(3),
    "rentri_sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "rentri_last_sync_error" TEXT,
    "rentri_next_retry_at" TIMESTAMP(3),
    "attachment_urls" JSONB,

    CONSTRAINT "firs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fir_signatures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fir_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" VARCHAR(50) NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "signature_method" VARCHAR(50) NOT NULL DEFAULT 'ECDSA-SHA256',
    "signature_value" TEXT NOT NULL,
    "certificate_hash" VARCHAR(64) NOT NULL,
    "document_hash" VARCHAR(64) NOT NULL,
    "timestamp_token" TEXT,

    CONSTRAINT "fir_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mud_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "mud_status" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "submitted_by" UUID,
    "report_data" JSONB NOT NULL,
    "pdf_url" VARCHAR(500),
    "xml_url" VARCHAR(500),

    CONSTRAINT "mud_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "logo_url" VARCHAR(500),
    "logo_base64" TEXT,
    "header_text" VARCHAR(500),
    "footer_text" VARCHAR(500),
    "primary_color" VARCHAR(7) NOT NULL DEFAULT '#3b82f6',
    "secondary_color" VARCHAR(7) NOT NULL DEFAULT '#1e40af',
    "font_family" VARCHAR(50) NOT NULL DEFAULT 'Roboto',
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "company_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "type" "notification_type" NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "notification_severity" NOT NULL DEFAULT 'INFO',
    "related_entity_id" UUID,
    "related_entity_type" VARCHAR(50),
    "action_url" VARCHAR(500),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL DEFAULT now() + interval '30 days',

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "fir_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "correlation_id" VARCHAR(100),
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "frequency" "backup_frequency" NOT NULL,
    "retention_days" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "last_run_status" "backup_status",
    "created_by" UUID NOT NULL,

    CONSTRAINT "backup_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "backup_status" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "s3_bucket" VARCHAR(255),
    "s3_key" VARCHAR(500),
    "file_size_mb" DECIMAL(10,2),
    "error_message" TEXT,
    "executed_by" UUID,

    CONSTRAINT "backup_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cer_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "description" TEXT NOT NULL,
    "is_pericoloso" BOOLEAN NOT NULL DEFAULT false,
    "category" VARCHAR(255) NOT NULL,
    "subcategory" VARCHAR(255) NOT NULL,

    CONSTRAINT "cer_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produttori" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ragione_sociale" VARCHAR(255) NOT NULL,
    "partita_iva" VARCHAR(11) NOT NULL,
    "via" VARCHAR(255) NOT NULL,
    "civico" VARCHAR(20) NOT NULL,
    "cap" VARCHAR(5) NOT NULL,
    "comune" VARCHAR(100) NOT NULL,
    "provincia" VARCHAR(2) NOT NULL,
    "email" VARCHAR(255),
    "telefono" VARCHAR(20),
    "pec" VARCHAR(255),

    CONSTRAINT "produttori_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trasportatori" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ragione_sociale" VARCHAR(255) NOT NULL,
    "partita_iva" VARCHAR(11) NOT NULL,
    "numero_iscrizione" VARCHAR(50) NOT NULL,
    "via" VARCHAR(255) NOT NULL,
    "civico" VARCHAR(20) NOT NULL,
    "cap" VARCHAR(5) NOT NULL,
    "comune" VARCHAR(100) NOT NULL,
    "provincia" VARCHAR(2) NOT NULL,
    "email" VARCHAR(255),
    "telefono" VARCHAR(20),
    "pec" VARCHAR(255),

    CONSTRAINT "trasportatori_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destinatari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ragione_sociale" VARCHAR(255) NOT NULL,
    "partita_iva" VARCHAR(11) NOT NULL,
    "numero_autorizzazione" VARCHAR(50) NOT NULL,
    "via" VARCHAR(255) NOT NULL,
    "civico" VARCHAR(20) NOT NULL,
    "cap" VARCHAR(5) NOT NULL,
    "comune" VARCHAR(100) NOT NULL,
    "provincia" VARCHAR(2) NOT NULL,
    "email" VARCHAR(255),
    "telefono" VARCHAR(20),
    "pec" VARCHAR(255),

    CONSTRAINT "destinatari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_system_role" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resource" VARCHAR(50) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "scope" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "module" VARCHAR(50) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "facility_ids" JSONB,
    "is_delegated" BOOLEAN NOT NULL DEFAULT false,
    "delegation_reason" TEXT,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "policyName" VARCHAR(100) NOT NULL,
    "policy_definition" JSONB NOT NULL,
    "evaluation_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "permission_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "spid_fiscal_code" VARCHAR(16) NOT NULL,
    "action_attempted" VARCHAR(255) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" UUID,
    "decision" VARCHAR(20) NOT NULL,
    "evaluated_policies" JSONB,
    "context_attributes" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "session_id" VARCHAR(100) NOT NULL,
    "previous_entry_hash" VARCHAR(64),
    "current_hash" VARCHAR(64) NOT NULL,

    CONSTRAINT "permission_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_change_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "role_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "change_type" VARCHAR(50) NOT NULL,
    "changed_by" UUID NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_change_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_ownership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "resourceType" VARCHAR(50) NOT NULL,
    "resource_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMP(3),
    "revocation_reason" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "facility_id" UUID,

    CONSTRAINT "resource_ownership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temporary_permission_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "permissions" JSONB NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "granted_by" UUID NOT NULL,
    "business_justification" TEXT NOT NULL,
    "auto_revoked" BOOLEAN NOT NULL DEFAULT false,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "temporary_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultant_tenant_associations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consultant_user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "added_by" UUID NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "consultant_tenant_associations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requested_role_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "requested_permissions" JSONB,
    "business_justification" TEXT NOT NULL,
    "duration" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "denial_reason" TEXT,

    CONSTRAINT "permission_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "abac_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "effect" "abac_policy_effect" NOT NULL DEFAULT 'ALLOW',
    "conditions" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "created_by" UUID NOT NULL,

    CONSTRAINT "abac_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_partita_iva_key" ON "tenants"("partita_iva");

-- CreateIndex
CREATE UNIQUE INDEX "users_keycloak_id_key" ON "users"("keycloak_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "users_keycloak_id_idx" ON "users"("keycloak_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_fiscal_code_key" ON "users"("tenant_id", "fiscal_code");

-- CreateIndex
CREATE INDEX "firs_tenant_id_idx" ON "firs"("tenant_id");

-- CreateIndex
CREATE INDEX "firs_status_idx" ON "firs"("status");

-- CreateIndex
CREATE INDEX "firs_rentri_sync_status_idx" ON "firs"("rentri_sync_status");

-- CreateIndex
CREATE INDEX "firs_transport_date_idx" ON "firs"("transport_date");

-- CreateIndex
CREATE INDEX "firs_cer_code_idx" ON "firs"("cer_code");

-- CreateIndex
CREATE UNIQUE INDEX "firs_tenant_id_fir_number_key" ON "firs"("tenant_id", "fir_number");

-- CreateIndex
CREATE INDEX "fir_signatures_fir_id_idx" ON "fir_signatures"("fir_id");

-- CreateIndex
CREATE INDEX "fir_signatures_user_id_idx" ON "fir_signatures"("user_id");

-- CreateIndex
CREATE INDEX "mud_reports_tenant_id_idx" ON "mud_reports"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "mud_reports_tenant_id_year_key" ON "mud_reports"("tenant_id", "year");

-- CreateIndex
CREATE INDEX "company_templates_tenant_id_idx" ON "company_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "company_templates_tenant_id_is_default_idx" ON "company_templates"("tenant_id", "is_default");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_idx" ON "notifications"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "notifications_is_read_idx" ON "notifications"("is_read");

-- CreateIndex
CREATE INDEX "activity_logs_tenant_id_idx" ON "activity_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "activity_logs_fir_id_idx" ON "activity_logs"("fir_id");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "activity_logs_correlation_id_idx" ON "activity_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "backup_histories_schedule_id_idx" ON "backup_histories"("schedule_id");

-- CreateIndex
CREATE INDEX "backup_histories_status_idx" ON "backup_histories"("status");

-- CreateIndex
CREATE INDEX "backup_histories_created_at_idx" ON "backup_histories"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cer_codes_code_key" ON "cer_codes"("code");

-- CreateIndex
CREATE INDEX "cer_codes_code_idx" ON "cer_codes"("code");

-- CreateIndex
CREATE INDEX "cer_codes_category_idx" ON "cer_codes"("category");

-- CreateIndex
CREATE INDEX "produttori_tenant_id_idx" ON "produttori"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "produttori_tenant_id_partita_iva_key" ON "produttori"("tenant_id", "partita_iva");

-- CreateIndex
CREATE INDEX "trasportatori_tenant_id_idx" ON "trasportatori"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "trasportatori_tenant_id_partita_iva_key" ON "trasportatori"("tenant_id", "partita_iva");

-- CreateIndex
CREATE INDEX "destinatari_tenant_id_idx" ON "destinatari"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "destinatari_tenant_id_partita_iva_key" ON "destinatari"("tenant_id", "partita_iva");

-- CreateIndex
CREATE INDEX "roles_tenant_id_is_system_role_idx" ON "roles"("tenant_id", "is_system_role");

-- CreateIndex
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_resource_action_scope_key" ON "permissions"("resource", "action", "scope");

-- CreateIndex
CREATE INDEX "user_role_assignments_user_id_tenant_id_expires_at_idx" ON "user_role_assignments"("user_id", "tenant_id", "expires_at");

-- CreateIndex
CREATE INDEX "user_role_assignments_tenant_id_idx" ON "user_role_assignments"("tenant_id");

-- CreateIndex
CREATE INDEX "user_role_assignments_role_id_idx" ON "user_role_assignments"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_assignments_user_id_role_id_tenant_id_key" ON "user_role_assignments"("user_id", "role_id", "tenant_id");

-- CreateIndex
CREATE INDEX "permission_policies_permission_id_idx" ON "permission_policies"("permission_id");

-- CreateIndex
CREATE INDEX "permission_policies_is_active_evaluation_order_idx" ON "permission_policies"("is_active", "evaluation_order");

-- CreateIndex
CREATE INDEX "permission_audit_logs_tenant_id_user_id_idx" ON "permission_audit_logs"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "permission_audit_logs_timestamp_idx" ON "permission_audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "permission_audit_logs_resource_type_resource_id_idx" ON "permission_audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "permission_audit_logs_decision_idx" ON "permission_audit_logs"("decision");

-- CreateIndex
CREATE INDEX "role_change_history_tenant_id_idx" ON "role_change_history"("tenant_id");

-- CreateIndex
CREATE INDEX "role_change_history_role_id_idx" ON "role_change_history"("role_id");

-- CreateIndex
CREATE INDEX "role_change_history_entityType_entity_id_idx" ON "role_change_history"("entityType", "entity_id");

-- CreateIndex
CREATE INDEX "role_change_history_timestamp_idx" ON "role_change_history"("timestamp");

-- CreateIndex
CREATE INDEX "resource_ownership_user_id_tenant_id_idx" ON "resource_ownership"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "resource_ownership_resource_id_tenant_id_idx" ON "resource_ownership"("resource_id", "tenant_id");

-- CreateIndex
CREATE INDEX "resource_ownership_tenant_id_resourceType_is_active_idx" ON "resource_ownership"("tenant_id", "resourceType", "is_active");

-- CreateIndex
CREATE INDEX "resource_ownership_tenant_id_is_active_expires_at_idx" ON "resource_ownership"("tenant_id", "is_active", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "resource_ownership_user_id_resourceType_resource_id_is_acti_key" ON "resource_ownership"("user_id", "resourceType", "resource_id", "is_active");

-- CreateIndex
CREATE INDEX "temporary_permission_grants_user_id_tenant_id_idx" ON "temporary_permission_grants"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "temporary_permission_grants_end_time_idx" ON "temporary_permission_grants"("end_time");

-- CreateIndex
CREATE INDEX "consultant_tenant_associations_consultant_user_id_idx" ON "consultant_tenant_associations"("consultant_user_id");

-- CreateIndex
CREATE INDEX "consultant_tenant_associations_tenant_id_idx" ON "consultant_tenant_associations"("tenant_id");

-- CreateIndex
CREATE INDEX "consultant_tenant_associations_is_active_idx" ON "consultant_tenant_associations"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "consultant_tenant_associations_consultant_user_id_tenant_id_key" ON "consultant_tenant_associations"("consultant_user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "permission_requests_user_id_tenant_id_idx" ON "permission_requests"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "permission_requests_status_idx" ON "permission_requests"("status");

-- CreateIndex
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions"("role_id");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "abac_policies_name_key" ON "abac_policies"("name");

-- CreateIndex
CREATE INDEX "abac_policies_resource_type_is_active_priority_idx" ON "abac_policies"("resource_type", "is_active", "priority");

-- CreateIndex
CREATE INDEX "abac_policies_is_active_priority_idx" ON "abac_policies"("is_active", "priority");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firs" ADD CONSTRAINT "firs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firs" ADD CONSTRAINT "firs_producer_user_id_fkey" FOREIGN KEY ("producer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firs" ADD CONSTRAINT "firs_carrier_user_id_fkey" FOREIGN KEY ("carrier_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firs" ADD CONSTRAINT "firs_receiver_user_id_fkey" FOREIGN KEY ("receiver_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fir_signatures" ADD CONSTRAINT "fir_signatures_fir_id_fkey" FOREIGN KEY ("fir_id") REFERENCES "firs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fir_signatures" ADD CONSTRAINT "fir_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mud_reports" ADD CONSTRAINT "mud_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_templates" ADD CONSTRAINT "company_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_fir_id_fkey" FOREIGN KEY ("fir_id") REFERENCES "firs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_histories" ADD CONSTRAINT "backup_histories_executed_by_fkey" FOREIGN KEY ("executed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_histories" ADD CONSTRAINT "backup_histories_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "backup_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produttori" ADD CONSTRAINT "produttori_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trasportatori" ADD CONSTRAINT "trasportatori_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destinatari" ADD CONSTRAINT "destinatari_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_policies" ADD CONSTRAINT "permission_policies_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_change_history" ADD CONSTRAINT "role_change_history_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultant_tenant_associations" ADD CONSTRAINT "consultant_tenant_associations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_requested_role_id_fkey" FOREIGN KEY ("requested_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
