-- Seed Script: Default Roles and Permissions
-- Phase 1-10 Implementation: Roles & Permissions System
-- Created: 2025-11-02
--
-- This script seeds the 5 system roles and platform-defined permissions
-- Per FR-004: ADMIN, OPERATOR, VIEWER, CONSULTANT, COMPLIANCE_OFFICER
--
-- IMPORTANT: This script is idempotent (safe to run multiple times)
-- It uses ON CONFLICT DO NOTHING to prevent duplicates

-- ============================================================================
-- PART 1: SEED PERMISSIONS (Platform-Defined)
-- ============================================================================
-- Format: {resource}:{action}:{scope}
-- Scope hierarchy: own < facility < all

INSERT INTO permissions (id, resource, action, scope, description, is_sensitive, module, created_at, updated_at)
VALUES
    -- FIR Permissions
    (gen_random_uuid(), 'fir', 'create', 'own', 'Create FIRs as producer', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'create', 'facility', 'Create FIRs for facility', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'create', 'all', 'Create FIRs across all facilities', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    (gen_random_uuid(), 'fir', 'read', 'own', 'View own FIRs', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'read', 'facility', 'View FIRs for assigned facility', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'read', 'all', 'View all tenant FIRs', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    (gen_random_uuid(), 'fir', 'update', 'own', 'Update own FIRs (draft only)', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'update', 'facility', 'Update FIRs for facility', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'update', 'all', 'Update any FIR', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    (gen_random_uuid(), 'fir', 'delete', 'own', 'Delete own draft FIRs', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'delete', 'facility', 'Delete facility FIRs (drafts)', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'delete', 'all', 'Delete any FIR (admin only)', true, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    (gen_random_uuid(), 'fir', 'sign', 'own', 'Digitally sign own FIRs', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'sign', 'facility', 'Sign FIRs for facility', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'fir', 'sign', 'all', 'Sign any FIR', false, 'FIR Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- Registry Permissions (Produttori, Trasportatori, Destinatari)
    (gen_random_uuid(), 'registry', 'create', 'facility', 'Create registry entries for facility', false, 'Registry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'registry', 'create', 'all', 'Create registry entries tenant-wide', false, 'Registry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'registry', 'read', 'facility', 'View registry for facility', false, 'Registry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'registry', 'read', 'all', 'View all registry entries', false, 'Registry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'registry', 'update', 'facility', 'Update registry for facility', false, 'Registry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'registry', 'update', 'all', 'Update any registry entry', false, 'Registry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'registry', 'delete', 'all', 'Delete registry entries (admin only)', true, 'Registry', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- Report Permissions
    (gen_random_uuid(), 'report', 'read', 'facility', 'View facility reports', false, 'Reports', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'report', 'read', 'all', 'View all reports', false, 'Reports', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'report', 'export', 'facility', 'Export facility reports', false, 'Reports', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'report', 'export', 'all', 'Export all reports', true, 'Reports', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- MUD Reporting Permissions
    (gen_random_uuid(), 'mud', 'create', 'all', 'Create MUD reports', false, 'MUD Reporting', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'mud', 'read', 'all', 'View MUD reports', false, 'MUD Reporting', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'mud', 'update', 'all', 'Update MUD reports', false, 'MUD Reporting', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'mud', 'submit', 'all', 'Submit MUD reports', true, 'MUD Reporting', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- User Management Permissions
    (gen_random_uuid(), 'user', 'create', 'all', 'Invite new users to tenant', true, 'User Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'user', 'read', 'all', 'View user list', false, 'User Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'user', 'update', 'all', 'Update user profiles', true, 'User Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'user', 'delete', 'all', 'Remove users from tenant', true, 'User Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'user', 'assign_role', 'all', 'Assign roles to users', true, 'User Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- Role Management Permissions
    (gen_random_uuid(), 'role', 'create', 'all', 'Create custom roles', true, 'Role Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'role', 'read', 'all', 'View roles and permissions', false, 'Role Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'role', 'update', 'all', 'Modify custom roles', true, 'Role Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'role', 'delete', 'all', 'Delete custom roles', true, 'Role Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- Audit Trail Permissions
    (gen_random_uuid(), 'audit', 'read', 'own', 'View own audit trail', false, 'Audit & Compliance', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'audit', 'read', 'facility', 'View facility audit trail', false, 'Audit & Compliance', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'audit', 'read', 'all', 'View all audit logs', true, 'Audit & Compliance', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'audit', 'export', 'all', 'Export audit reports for compliance', true, 'Audit & Compliance', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- Task Assignment Permissions
    (gen_random_uuid(), 'task', 'read', 'own', 'View assigned tasks', false, 'Task Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task', 'read', 'facility', 'View facility tasks', false, 'Task Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task', 'read', 'all', 'View all tasks', false, 'Task Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task', 'assign', 'facility', 'Assign tasks for facility', false, 'Task Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'task', 'assign', 'all', 'Assign any task', false, 'Task Management', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- Analytics Permissions
    (gen_random_uuid(), 'analytics', 'read', 'facility', 'View facility analytics', false, 'Analytics', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'analytics', 'read', 'all', 'View tenant analytics dashboard', false, 'Analytics', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'analytics', 'export', 'all', 'Export analytics data', false, 'Analytics', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- Notification Permissions
    (gen_random_uuid(), 'notification', 'read', 'own', 'View own notifications', false, 'Notifications', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'notification', 'create', 'all', 'Send notifications to users', false, 'Notifications', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- Temporary Permission Permissions
    (gen_random_uuid(), 'temp_permission', 'request', 'own', 'Request temporary permission elevation', false, 'Permissions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'temp_permission', 'approve', 'all', 'Approve temporary permission requests', true, 'Permissions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

    -- ABAC Policy Permissions
    (gen_random_uuid(), 'abac_policy', 'create', 'all', 'Create ABAC policies', true, 'Permissions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'abac_policy', 'read', 'all', 'View ABAC policies', false, 'Permissions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'abac_policy', 'update', 'all', 'Update ABAC policies', true, 'Permissions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'abac_policy', 'delete', 'all', 'Delete ABAC policies', true, 'Permissions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (resource, action, scope) DO NOTHING;

-- ============================================================================
-- PART 2: CREATE SYSTEM ROLES (Per FR-004)
-- ============================================================================
-- Note: Using a fixed UUID for system roles for consistency
-- tenant_id will be set when seeding per-tenant data

-- These are TEMPLATE roles that will be copied to each tenant during tenant creation
-- The actual tenant-specific roles will be created by the tenant provisioning workflow

-- Create a helper function to seed roles for a specific tenant
-- This function will be called by the tenant provisioning workflow

-- Example usage (to be called from application code or tenant setup):
-- SELECT seed_default_roles_for_tenant('tenant-uuid-here', 'admin-user-uuid-here');

CREATE OR REPLACE FUNCTION seed_default_roles_for_tenant(
    p_tenant_id UUID,
    p_created_by_user_id UUID
)
RETURNS TABLE(role_name VARCHAR, role_id UUID) AS $$
DECLARE
    v_admin_role_id UUID;
    v_operator_role_id UUID;
    v_viewer_role_id UUID;
    v_consultant_role_id UUID;
    v_compliance_officer_role_id UUID;
BEGIN
    -- Create ADMIN role
    INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), p_tenant_id, 'ADMIN', 'Full administrative access to tenant', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id INTO v_admin_role_id;

    -- Create OPERATOR role
    INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), p_tenant_id, 'OPERATOR', 'Standard operational access for facility-scoped FIR management', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id INTO v_operator_role_id;

    -- Create VIEWER role
    INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), p_tenant_id, 'VIEWER', 'Read-only access to facility data', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id INTO v_viewer_role_id;

    -- Create CONSULTANT role
    INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), p_tenant_id, 'CONSULTANT', 'Environmental consultant managing multiple client tenants', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id INTO v_consultant_role_id;

    -- Create COMPLIANCE_OFFICER role
    INSERT INTO roles (id, tenant_id, name, description, is_system_role, created_by, created_at, updated_at)
    VALUES (gen_random_uuid(), p_tenant_id, 'COMPLIANCE_OFFICER', 'Audit and compliance specialist with full read access and report generation', true, p_created_by_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id INTO v_compliance_officer_role_id;

    -- Assign permissions to ADMIN role (all permissions with 'all' scope)
    INSERT INTO role_permissions (role_id, permission_id, granted_by, granted_at)
    SELECT v_admin_role_id, p.id, p_created_by_user_id, CURRENT_TIMESTAMP
    FROM permissions p
    WHERE p.scope = 'all';

    -- Assign permissions to OPERATOR role (facility-scoped FIR management)
    INSERT INTO role_permissions (role_id, permission_id, granted_by, granted_at)
    SELECT v_operator_role_id, p.id, p_created_by_user_id, CURRENT_TIMESTAMP
    FROM permissions p
    WHERE (p.resource = 'fir' AND p.scope IN ('own', 'facility') AND p.action IN ('create', 'read', 'update', 'sign'))
       OR (p.resource = 'registry' AND p.scope = 'facility' AND p.action IN ('read', 'update'))
       OR (p.resource = 'task' AND p.scope IN ('own', 'facility'))
       OR (p.resource = 'notification' AND p.scope = 'own')
       OR (p.resource = 'temp_permission' AND p.action = 'request');

    -- Assign permissions to VIEWER role (read-only access)
    INSERT INTO role_permissions (role_id, permission_id, granted_by, granted_at)
    SELECT v_viewer_role_id, p.id, p_created_by_user_id, CURRENT_TIMESTAMP
    FROM permissions p
    WHERE p.action = 'read' AND p.scope IN ('own', 'facility');

    -- Assign permissions to CONSULTANT role (cross-tenant visibility, administrative)
    INSERT INTO role_permissions (role_id, permission_id, granted_by, granted_at)
    SELECT v_consultant_role_id, p.id, p_created_by_user_id, CURRENT_TIMESTAMP
    FROM permissions p
    WHERE p.scope = 'all' AND p.is_sensitive = false;

    -- Assign permissions to COMPLIANCE_OFFICER role (audit focus)
    INSERT INTO role_permissions (role_id, permission_id, granted_by, granted_at)
    SELECT v_compliance_officer_role_id, p.id, p_created_by_user_id, CURRENT_TIMESTAMP
    FROM permissions p
    WHERE (p.action = 'read' AND p.scope = 'all')
       OR (p.resource = 'audit' AND p.action IN ('read', 'export'))
       OR (p.resource = 'report' AND p.action IN ('read', 'export'));

    -- Return created roles
    RETURN QUERY
    SELECT r.name::VARCHAR, r.id
    FROM roles r
    WHERE r.id IN (v_admin_role_id, v_operator_role_id, v_viewer_role_id, v_consultant_role_id, v_compliance_officer_role_id)
    ORDER BY r.name;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PART 3: DOCUMENTATION
-- ============================================================================
COMMENT ON FUNCTION seed_default_roles_for_tenant IS
'Seeds the 5 default system roles (ADMIN, OPERATOR, VIEWER, CONSULTANT, COMPLIANCE_OFFICER) for a specific tenant.
This function should be called by the tenant provisioning workflow when a new tenant is created.
Returns the created role names and IDs.

Example usage:
SELECT * FROM seed_default_roles_for_tenant(''00000000-0000-0000-0000-000000000001''::UUID, ''admin-user-id''::UUID);';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- To verify permissions were created:
-- SELECT COUNT(*) FROM permissions; -- Should show 60+ permissions

-- To verify role creation function exists:
-- SELECT proname FROM pg_proc WHERE proname = 'seed_default_roles_for_tenant';

-- To create roles for your first tenant (replace UUIDs):
-- SELECT * FROM seed_default_roles_for_tenant('your-tenant-id'::UUID, 'your-admin-user-id'::UUID);
