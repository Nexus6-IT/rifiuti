-- Roles & Permissions System Migration
-- Phase 1-10: Complete RBAC + ABAC Implementation
-- Created: 2025-11-02

-- CreateEnum for ABAC Policy Effect
CREATE TYPE "abac_policy_effect" AS ENUM ('ALLOW', 'DENY');

-- CreateTable: roles
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

-- CreateTable: permissions
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

-- CreateTable: user_role_assignments
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

-- CreateTable: permission_policies
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

-- CreateTable: permission_audit_logs
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

-- CreateTable: role_change_history
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

-- CreateTable: resource_ownership
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

-- CreateTable: temporary_permission_grants
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

-- CreateTable: consultant_tenant_associations
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

-- CreateTable: permission_requests
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

-- CreateTable: role_permissions (junction table)
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable: abac_policies
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

-- CreateIndex: roles
CREATE INDEX "roles_tenant_id_is_system_role_idx" ON "roles"("tenant_id", "is_system_role");
CREATE INDEX "roles_tenant_id_idx" ON "roles"("tenant_id");
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");

-- CreateIndex: permissions
CREATE INDEX "permissions_module_idx" ON "permissions"("module");
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");
CREATE UNIQUE INDEX "permissions_resource_action_scope_key" ON "permissions"("resource", "action", "scope");

-- CreateIndex: user_role_assignments
CREATE INDEX "user_role_assignments_user_id_tenant_id_expires_at_idx" ON "user_role_assignments"("user_id", "tenant_id", "expires_at");
CREATE INDEX "user_role_assignments_tenant_id_idx" ON "user_role_assignments"("tenant_id");
CREATE INDEX "user_role_assignments_role_id_idx" ON "user_role_assignments"("role_id");
CREATE UNIQUE INDEX "user_role_assignments_user_id_role_id_tenant_id_key" ON "user_role_assignments"("user_id", "role_id", "tenant_id");

-- CreateIndex: permission_policies
CREATE INDEX "permission_policies_permission_id_idx" ON "permission_policies"("permission_id");
CREATE INDEX "permission_policies_is_active_evaluation_order_idx" ON "permission_policies"("is_active", "evaluation_order");

-- CreateIndex: permission_audit_logs
CREATE INDEX "permission_audit_logs_tenant_id_user_id_idx" ON "permission_audit_logs"("tenant_id", "user_id");
CREATE INDEX "permission_audit_logs_timestamp_idx" ON "permission_audit_logs"("timestamp");
CREATE INDEX "permission_audit_logs_resource_type_resource_id_idx" ON "permission_audit_logs"("resource_type", "resource_id");
CREATE INDEX "permission_audit_logs_decision_idx" ON "permission_audit_logs"("decision");

-- CreateIndex: role_change_history
CREATE INDEX "role_change_history_tenant_id_idx" ON "role_change_history"("tenant_id");
CREATE INDEX "role_change_history_role_id_idx" ON "role_change_history"("role_id");
CREATE INDEX "role_change_history_entityType_entity_id_idx" ON "role_change_history"("entityType", "entity_id");
CREATE INDEX "role_change_history_timestamp_idx" ON "role_change_history"("timestamp");

-- CreateIndex: resource_ownership
CREATE INDEX "resource_ownership_user_id_tenant_id_idx" ON "resource_ownership"("user_id", "tenant_id");
CREATE INDEX "resource_ownership_resource_id_tenant_id_idx" ON "resource_ownership"("resource_id", "tenant_id");
CREATE INDEX "resource_ownership_tenant_id_resourceType_is_active_idx" ON "resource_ownership"("tenant_id", "resourceType", "is_active");
CREATE INDEX "resource_ownership_tenant_id_is_active_expires_at_idx" ON "resource_ownership"("tenant_id", "is_active", "expires_at");
CREATE UNIQUE INDEX "resource_ownership_user_id_resourceType_resource_id_is_acti_key" ON "resource_ownership"("user_id", "resourceType", "resource_id", "is_active");

-- CreateIndex: temporary_permission_grants
CREATE INDEX "temporary_permission_grants_user_id_tenant_id_idx" ON "temporary_permission_grants"("user_id", "tenant_id");
CREATE INDEX "temporary_permission_grants_end_time_idx" ON "temporary_permission_grants"("end_time");

-- CreateIndex: consultant_tenant_associations
CREATE INDEX "consultant_tenant_associations_consultant_user_id_idx" ON "consultant_tenant_associations"("consultant_user_id");
CREATE INDEX "consultant_tenant_associations_tenant_id_idx" ON "consultant_tenant_associations"("tenant_id");
CREATE INDEX "consultant_tenant_associations_is_active_idx" ON "consultant_tenant_associations"("is_active");
CREATE UNIQUE INDEX "consultant_tenant_associations_consultant_user_id_tenant_id_key" ON "consultant_tenant_associations"("consultant_user_id", "tenant_id");

-- CreateIndex: permission_requests
CREATE INDEX "permission_requests_user_id_tenant_id_idx" ON "permission_requests"("user_id", "tenant_id");
CREATE INDEX "permission_requests_status_idx" ON "permission_requests"("status");

-- CreateIndex: role_permissions
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions"("role_id");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex: abac_policies
CREATE UNIQUE INDEX "abac_policies_name_key" ON "abac_policies"("name");
CREATE INDEX "abac_policies_resource_type_is_active_priority_idx" ON "abac_policies"("resource_type", "is_active", "priority");
CREATE INDEX "abac_policies_is_active_priority_idx" ON "abac_policies"("is_active", "priority");

-- AddForeignKey: user_role_assignments -> roles
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: permission_policies -> permissions
ALTER TABLE "permission_policies" ADD CONSTRAINT "permission_policies_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: role_change_history -> roles
ALTER TABLE "role_change_history" ADD CONSTRAINT "role_change_history_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: consultant_tenant_associations -> roles
ALTER TABLE "consultant_tenant_associations" ADD CONSTRAINT "consultant_tenant_associations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: permission_requests -> roles
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_requested_role_id_fkey" FOREIGN KEY ("requested_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: role_permissions -> roles
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: role_permissions -> permissions
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
