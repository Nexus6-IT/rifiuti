-- Rollback for Roles & Permissions System Migration
-- WARNING: This will delete all roles, permissions, and audit data
-- Backup database before running!

-- Drop Foreign Keys First (in reverse order)
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_permission_id_fkey";
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "role_permissions_role_id_fkey";
ALTER TABLE "permission_requests" DROP CONSTRAINT IF EXISTS "permission_requests_requested_role_id_fkey";
ALTER TABLE "consultant_tenant_associations" DROP CONSTRAINT IF EXISTS "consultant_tenant_associations_role_id_fkey";
ALTER TABLE "role_change_history" DROP CONSTRAINT IF EXISTS "role_change_history_role_id_fkey";
ALTER TABLE "permission_policies" DROP CONSTRAINT IF EXISTS "permission_policies_permission_id_fkey";
ALTER TABLE "user_role_assignments" DROP CONSTRAINT IF EXISTS "user_role_assignments_role_id_fkey";

-- Drop Tables (in reverse dependency order)
DROP TABLE IF EXISTS "abac_policies";
DROP TABLE IF EXISTS "role_permissions";
DROP TABLE IF EXISTS "permission_requests";
DROP TABLE IF EXISTS "consultant_tenant_associations";
DROP TABLE IF EXISTS "temporary_permission_grants";
DROP TABLE IF EXISTS "resource_ownership";
DROP TABLE IF EXISTS "role_change_history";
DROP TABLE IF EXISTS "permission_audit_logs";
DROP TABLE IF EXISTS "permission_policies";
DROP TABLE IF EXISTS "user_role_assignments";
DROP TABLE IF EXISTS "permissions";
DROP TABLE IF EXISTS "roles";

-- Drop Enum
DROP TYPE IF EXISTS "abac_policy_effect";

-- Note: This rollback script does NOT restore any data.
-- To restore data, you must restore from a database backup taken before migration.
