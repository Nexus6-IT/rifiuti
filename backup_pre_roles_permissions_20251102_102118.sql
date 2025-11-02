--
-- PostgreSQL database dump
--

\restrict 9nVOlY7XOUAGDrIoZhvgmyBAfN41oj4hA17dnabNGjAUfYtXeUackg8xCULSCHF

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: wasteflow
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO wasteflow;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: wasteflow
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: backup_frequency; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.backup_frequency AS ENUM (
    'HOURLY',
    'DAILY',
    'WEEKLY',
    'MONTHLY'
);


ALTER TYPE public.backup_frequency OWNER TO wasteflow;

--
-- Name: backup_status; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.backup_status AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'SUCCESS',
    'FAILED'
);


ALTER TYPE public.backup_status OWNER TO wasteflow;

--
-- Name: fir_status; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.fir_status AS ENUM (
    'DRAFT',
    'AWAITING_PRODUCER',
    'AWAITING_CARRIER',
    'AWAITING_RECEIVER',
    'COMPLETED',
    'SYNCED_TO_RENTRI',
    'CANCELLED'
);


ALTER TYPE public.fir_status OWNER TO wasteflow;

--
-- Name: mud_status; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.mud_status AS ENUM (
    'DRAFT',
    'REVIEWING',
    'SUBMITTED',
    'ARCHIVED'
);


ALTER TYPE public.mud_status OWNER TO wasteflow;

--
-- Name: notification_severity; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.notification_severity AS ENUM (
    'INFO',
    'WARNING',
    'ERROR'
);


ALTER TYPE public.notification_severity OWNER TO wasteflow;

--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.notification_type AS ENUM (
    'FIR_DEADLINE_APPROACHING',
    'RENTRI_SYNC_FAILED',
    'RENTRI_SYNC_SUCCESS',
    'MUD_DEADLINE_APPROACHING',
    'SUBSCRIPTION_EXPIRING',
    'SIGNATURE_REQUIRED',
    'SYSTEM_ERROR'
);


ALTER TYPE public.notification_type OWNER TO wasteflow;

--
-- Name: rentri_sync_status; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.rentri_sync_status AS ENUM (
    'PENDING',
    'SYNCING',
    'SYNCED',
    'FAILED',
    'PERMANENTLY_FAILED'
);


ALTER TYPE public.rentri_sync_status OWNER TO wasteflow;

--
-- Name: subscription_status; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.subscription_status AS ENUM (
    'TRIAL',
    'ACTIVE',
    'EXPIRED',
    'SUSPENDED'
);


ALTER TYPE public.subscription_status OWNER TO wasteflow;

--
-- Name: subscription_tier; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.subscription_tier AS ENUM (
    'TRIAL',
    'PROFESSIONAL',
    'ENTERPRISE'
);


ALTER TYPE public.subscription_tier OWNER TO wasteflow;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: wasteflow
--

CREATE TYPE public.user_role AS ENUM (
    'ADMIN',
    'OPERATOR',
    'VIEWER'
);


ALTER TYPE public.user_role OWNER TO wasteflow;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO wasteflow;

--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    fir_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    action character varying(100) NOT NULL,
    description text NOT NULL,
    metadata jsonb,
    correlation_id character varying(100),
    ip_address character varying(45),
    user_agent character varying(500)
);


ALTER TABLE public.activity_logs OWNER TO wasteflow;

--
-- Name: backup_histories; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.backup_histories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status public.backup_status NOT NULL,
    started_at timestamp(3) without time zone NOT NULL,
    completed_at timestamp(3) without time zone,
    duration_ms integer,
    s3_bucket character varying(255),
    s3_key character varying(500),
    file_size_mb numeric(10,2),
    error_message text,
    executed_by uuid
);


ALTER TABLE public.backup_histories OWNER TO wasteflow;

--
-- Name: backup_schedules; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.backup_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    frequency public.backup_frequency NOT NULL,
    retention_days integer DEFAULT 30 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    next_run_at timestamp(3) without time zone NOT NULL,
    last_run_at timestamp(3) without time zone,
    last_run_status public.backup_status,
    created_by uuid NOT NULL
);


ALTER TABLE public.backup_schedules OWNER TO wasteflow;

--
-- Name: cer_codes; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.cer_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    code character varying(10) NOT NULL,
    description text NOT NULL,
    is_pericoloso boolean DEFAULT false NOT NULL,
    category character varying(255) NOT NULL,
    subcategory character varying(255) NOT NULL
);


ALTER TABLE public.cer_codes OWNER TO wasteflow;

--
-- Name: company_templates; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.company_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    name character varying(100) NOT NULL,
    logo_url character varying(500),
    logo_base64 text,
    header_text character varying(500),
    footer_text character varying(500),
    primary_color character varying(7) DEFAULT '#3b82f6'::character varying NOT NULL,
    secondary_color character varying(7) DEFAULT '#1e40af'::character varying NOT NULL,
    font_family character varying(50) DEFAULT 'Roboto'::character varying NOT NULL,
    is_default boolean DEFAULT false NOT NULL
);


ALTER TABLE public.company_templates OWNER TO wasteflow;

--
-- Name: consultant_tenant_associations; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.consultant_tenant_associations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consultant_user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    role_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    added_by uuid NOT NULL,
    added_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone,
    is_active boolean DEFAULT true NOT NULL
);


ALTER TABLE public.consultant_tenant_associations OWNER TO wasteflow;

--
-- Name: destinatari; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.destinatari (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    ragione_sociale character varying(255) NOT NULL,
    partita_iva character varying(11) NOT NULL,
    numero_autorizzazione character varying(50) NOT NULL,
    via character varying(255) NOT NULL,
    civico character varying(20) NOT NULL,
    cap character varying(5) NOT NULL,
    comune character varying(100) NOT NULL,
    provincia character varying(2) NOT NULL,
    email character varying(255),
    telefono character varying(20),
    pec character varying(255)
);


ALTER TABLE public.destinatari OWNER TO wasteflow;

--
-- Name: fir_signatures; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.fir_signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fir_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    role character varying(50) NOT NULL,
    signed_at timestamp(3) without time zone NOT NULL,
    signature_method character varying(50) DEFAULT 'ECDSA-SHA256'::character varying NOT NULL,
    signature_value text NOT NULL,
    certificate_hash character varying(64) NOT NULL,
    document_hash character varying(64) NOT NULL,
    timestamp_token text
);


ALTER TABLE public.fir_signatures OWNER TO wasteflow;

--
-- Name: firs; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.firs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    fir_number character varying(50) NOT NULL,
    status public.fir_status DEFAULT 'DRAFT'::public.fir_status NOT NULL,
    workflow_version integer DEFAULT 1 NOT NULL,
    submitted_at timestamp(3) without time zone,
    completed_at timestamp(3) without time zone,
    cancelled_at timestamp(3) without time zone,
    cancellation_reason text,
    producer_user_id uuid NOT NULL,
    producer_partita_iva character varying(11) NOT NULL,
    producer_name character varying(255) NOT NULL,
    producer_address character varying(500) NOT NULL,
    producer_contact character varying(255),
    carrier_user_id uuid,
    carrier_partita_iva character varying(11) NOT NULL,
    carrier_name character varying(255) NOT NULL,
    carrier_vehicle_plate character varying(20) NOT NULL,
    carrier_contact character varying(255),
    receiver_user_id uuid,
    receiver_partita_iva character varying(11) NOT NULL,
    receiver_name character varying(255) NOT NULL,
    receiver_address character varying(500) NOT NULL,
    receiver_contact character varying(255),
    cer_code character varying(6) NOT NULL,
    waste_description character varying(500) NOT NULL,
    waste_category character varying(100) NOT NULL,
    quantity numeric(10,2) NOT NULL,
    unit character varying(10) DEFAULT 'KG'::character varying NOT NULL,
    transport_date timestamp(3) without time zone NOT NULL,
    estimated_arrival_date timestamp(3) without time zone,
    actual_arrival_date timestamp(3) without time zone,
    transport_notes text,
    rentri_sync_status public.rentri_sync_status DEFAULT 'PENDING'::public.rentri_sync_status NOT NULL,
    rentri_protocol_number character varying(100),
    rentri_synced_at timestamp(3) without time zone,
    rentri_sync_attempts integer DEFAULT 0 NOT NULL,
    rentri_last_sync_error text,
    rentri_next_retry_at timestamp(3) without time zone,
    attachment_urls jsonb
);


ALTER TABLE public.firs OWNER TO wasteflow;

--
-- Name: mud_reports; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.mud_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    year integer NOT NULL,
    status public.mud_status DEFAULT 'DRAFT'::public.mud_status NOT NULL,
    submitted_at timestamp(3) without time zone,
    submitted_by uuid,
    report_data jsonb NOT NULL,
    pdf_url character varying(500),
    xml_url character varying(500)
);


ALTER TABLE public.mud_reports OWNER TO wasteflow;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    type public.notification_type NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    severity public.notification_severity DEFAULT 'INFO'::public.notification_severity NOT NULL,
    related_entity_id uuid,
    related_entity_type character varying(50),
    action_url character varying(500),
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp(3) without time zone,
    expires_at timestamp(3) without time zone DEFAULT (now() + '30 days'::interval) NOT NULL
);


ALTER TABLE public.notifications OWNER TO wasteflow;

--
-- Name: permission_audit_logs; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.permission_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    spid_fiscal_code character varying(16) NOT NULL,
    action_attempted character varying(255) NOT NULL,
    resource_type character varying(50) NOT NULL,
    resource_id uuid,
    decision character varying(20) NOT NULL,
    evaluated_policies jsonb,
    context_attributes jsonb,
    "timestamp" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    session_id character varying(100) NOT NULL,
    previous_entry_hash character varying(64),
    current_hash character varying(64) NOT NULL
);


ALTER TABLE public.permission_audit_logs OWNER TO wasteflow;

--
-- Name: permission_policies; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.permission_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    "policyName" character varying(100) NOT NULL,
    policy_definition jsonb NOT NULL,
    evaluation_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.permission_policies OWNER TO wasteflow;

--
-- Name: permission_requests; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.permission_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    requested_role_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    requested_permissions jsonb,
    business_justification text NOT NULL,
    duration integer,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp(3) without time zone,
    denial_reason text
);


ALTER TABLE public.permission_requests OWNER TO wasteflow;

--
-- Name: permissions; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    resource character varying(50) NOT NULL,
    action character varying(50) NOT NULL,
    scope character varying(50) NOT NULL,
    description text NOT NULL,
    is_sensitive boolean DEFAULT false NOT NULL,
    module character varying(50) NOT NULL
);


ALTER TABLE public.permissions OWNER TO wasteflow;

--
-- Name: produttori; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.produttori (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    ragione_sociale character varying(255) NOT NULL,
    partita_iva character varying(11) NOT NULL,
    via character varying(255) NOT NULL,
    civico character varying(20) NOT NULL,
    cap character varying(5) NOT NULL,
    comune character varying(100) NOT NULL,
    provincia character varying(2) NOT NULL,
    email character varying(255),
    telefono character varying(20),
    pec character varying(255)
);


ALTER TABLE public.produttori OWNER TO wasteflow;

--
-- Name: resource_ownership; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.resource_ownership (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "resourceType" character varying(50) NOT NULL,
    resource_id uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    facility_id uuid
);


ALTER TABLE public.resource_ownership OWNER TO wasteflow;

--
-- Name: role_change_history; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.role_change_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    role_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "entityType" character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    change_type character varying(50) NOT NULL,
    changed_by uuid NOT NULL,
    old_value jsonb,
    new_value jsonb,
    reason text,
    "timestamp" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.role_change_history OWNER TO wasteflow;

--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    granted_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    granted_by uuid NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO wasteflow;

--
-- Name: roles; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    is_system_role boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL
);


ALTER TABLE public.roles OWNER TO wasteflow;

--
-- Name: temporary_permission_grants; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.temporary_permission_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    permissions jsonb NOT NULL,
    start_time timestamp(3) without time zone NOT NULL,
    end_time timestamp(3) without time zone NOT NULL,
    granted_by uuid NOT NULL,
    business_justification text NOT NULL,
    auto_revoked boolean DEFAULT false NOT NULL,
    revoked_at timestamp(3) without time zone
);


ALTER TABLE public.temporary_permission_grants OWNER TO wasteflow;

--
-- Name: tenants; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    partita_iva character varying(11) NOT NULL,
    ragione_sociale character varying(255) NOT NULL,
    pec character varying(255),
    address character varying(255) NOT NULL,
    city character varying(100) NOT NULL,
    province character varying(2) NOT NULL,
    postal_code character varying(5) NOT NULL,
    country character varying(2) DEFAULT 'IT'::character varying NOT NULL,
    subscription_tier public.subscription_tier DEFAULT 'TRIAL'::public.subscription_tier NOT NULL,
    subscription_status public.subscription_status DEFAULT 'TRIAL'::public.subscription_status NOT NULL,
    subscription_start timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    subscription_end timestamp(3) without time zone,
    fir_limit_per_month integer DEFAULT 100 NOT NULL,
    user_limit_total integer DEFAULT 5 NOT NULL
);


ALTER TABLE public.tenants OWNER TO wasteflow;

--
-- Name: trasportatori; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.trasportatori (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    ragione_sociale character varying(255) NOT NULL,
    partita_iva character varying(11) NOT NULL,
    numero_iscrizione character varying(50) NOT NULL,
    via character varying(255) NOT NULL,
    civico character varying(20) NOT NULL,
    cap character varying(5) NOT NULL,
    comune character varying(100) NOT NULL,
    provincia character varying(2) NOT NULL,
    email character varying(255),
    telefono character varying(20),
    pec character varying(255)
);


ALTER TABLE public.trasportatori OWNER TO wasteflow;

--
-- Name: user_role_assignments; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.user_role_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    assigned_by uuid NOT NULL,
    assigned_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone,
    facility_ids jsonb,
    is_delegated boolean DEFAULT false NOT NULL,
    delegation_reason text
);


ALTER TABLE public.user_role_assignments OWNER TO wasteflow;

--
-- Name: users; Type: TABLE; Schema: public; Owner: wasteflow
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    keycloak_id character varying(255) NOT NULL,
    fiscal_code character varying(16) NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(20),
    role public.user_role DEFAULT 'OPERATOR'::public.user_role NOT NULL,
    notification_preferences jsonb,
    signature_certificate text,
    signature_certificate_hash character varying(64),
    signature_valid_until timestamp(3) without time zone
);


ALTER TABLE public.users OWNER TO wasteflow;

--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
27e394ba-e91e-420e-aa73-8e75e64ae6b7	a17a3279db5dcbb35fcac7f08f309292e04d2234a6abb07ae4bf77edd3dfe6e1	2025-10-31 11:33:19.169144+00	20251014122424_base	\N	\N	2025-10-31 11:33:19.03681+00	1
5e896265-e876-4fad-ab90-6e44fea728e1	9eefc4d7984de8428f22b541a6a1a045a4590ccb4dfd9d4a5a08c330d8ed7198	\N	20251031000000_add_company_template	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251031000000_add_company_template\n\nDatabase error code: 42804\n\nDatabase error:\nERROR: foreign key constraint "company_templates_tenant_id_fkey" cannot be implemented\nDETAIL: Key columns "tenant_id" and "id" are of incompatible types: uuid and text.\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42804), message: "foreign key constraint \\"company_templates_tenant_id_fkey\\" cannot be implemented", detail: Some("Key columns \\"tenant_id\\" and \\"id\\" are of incompatible types: uuid and text."), hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("tablecmds.c"), line: Some(9520), routine: Some("ATAddForeignKeyConstraint") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251031000000_add_company_template"\n             at schema-engine\\connectors\\sql-schema-connector\\src\\apply_migration.rs:106\n   1: schema_core::commands::apply_migrations::Applying migration\n           with migration_name="20251031000000_add_company_template"\n             at schema-engine\\core\\src\\commands\\apply_migrations.rs:91\n   2: schema_core::state::ApplyMigrations\n             at schema-engine\\core\\src\\state.rs:226	\N	2025-10-31 11:33:19.171607+00	0
\.


--
-- Data for Name: activity_logs; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.activity_logs (id, tenant_id, user_id, fir_id, created_at, action, description, metadata, correlation_id, ip_address, user_agent) FROM stdin;
\.


--
-- Data for Name: backup_histories; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.backup_histories (id, schedule_id, created_at, status, started_at, completed_at, duration_ms, s3_bucket, s3_key, file_size_mb, error_message, executed_by) FROM stdin;
\.


--
-- Data for Name: backup_schedules; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.backup_schedules (id, created_at, updated_at, name, description, frequency, retention_days, is_active, next_run_at, last_run_at, last_run_status, created_by) FROM stdin;
\.


--
-- Data for Name: cer_codes; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.cer_codes (id, created_at, updated_at, code, description, is_pericoloso, category, subcategory) FROM stdin;
b02c68e3-1509-4a82-a76a-c25801a146f1	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 01 01	rifiuti prodotti dalle attività di estrazione di minerali metalliferi	f	01	01
d1a70d23-a25b-4f21-ac51-bb9933596cec	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 01 02	rifiuti prodotti dalle attività di estrazione di minerali non metalliferi	f	01	01
1e404b31-1c80-468a-8690-b3562fe71326	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 03 04*	sterili che generano acido prodotti dalla lavorazione di minerale solforoso	t	01	03
e34236f3-4793-4e58-9e2a-43190184100c	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 03 05*	altri sterili contenenti sostanze pericolose	t	01	03
e5199037-f992-46cf-8650-cced1fb36368	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 03 06	sterili diversi da quelli delle voci 01 03 04 e 01 03 05	f	01	03
6c323912-d947-4616-a0ac-7796579c2697	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 03 07*	altri rifiuti contenenti sostanze pericolose prodotti da trattamenti chimici e fisici di minerali metalliferi	t	01	03
19d9e13f-087f-4c19-af7d-0f56214aef95	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 03 08	polveri e residui diversi da quelli di cui alla voce 01 03 07	f	01	03
81596e33-2d6d-4149-9ede-81211e5a8e12	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 03 09	fanghi rossi derivanti dalla produzione di allumina non rientranti alla voce 01 03 07	f	01	03
0f741c64-9f2f-4160-a656-5f3fe41263d1	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 04 07*	rifiuti contenenti sostanze pericolose prodotti da trattamenti chimici e fisici di minerali non metalliferi	t	01	04
98438e0e-bb20-4004-8dd3-ee946fdb5312	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 04 08	scarti di ghiaia e pietrisco diversi da quelli di cui alla voce 01 04 07	f	01	04
835e93fe-d97a-4fbd-a117-dd24fbefdb1c	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 04 09	scarti di sabbia e argilla	f	01	04
b83e2bd1-1740-485d-82da-a3eba1930c6c	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 04 10	polveri e residui diversi da quelli di cui alla voce 01 04 07	f	01	04
5240ad37-789a-4a02-8956-7437abe14462	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 04 11	rifiuti della lavorazione di potassa e salgemma diversi da quelli di cui alla voce 01 04 07	f	01	04
84f64edc-50ca-4b3d-a2de-fb689dd56039	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 04 12	sterili ed altri residui del lavaggio e della pulitura di minerali diversi da quelli di cui alle voci 01 04 07 e 01 04 11	f	01	04
4ff04f7b-a602-403c-a124-61a7b61844d5	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 04 13	rifiuti prodotti dal taglio e dalla segagione della pietra diversi da quelli di cui alla voce 01 04 07	f	01	04
317abf1b-38b8-41d3-b7e0-7f57078c2d38	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 05 04	fanghi e rifiuti di perforazione di pozzi per acque dolci	f	01	05
4a757682-4117-4733-8792-1c2ea4793dd1	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 05 05*	fanghi e rifiuti di perforazione contenenti oli	t	01	05
88f08127-2c32-4ed8-a84f-fd5f4c1cd028	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 05 06*	fanghi di perforazione ed altri rifiuti di perforazione contenenti sostanze pericolose	t	01	05
467dda79-cc94-4851-bce5-63cd6c7aad9f	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 05 07	fanghi e rifiuti di perforazione contenenti barite diversi da quelli delle voci 01 05 05 e 01 05 06	f	01	05
59b5694d-0d19-4c70-a47e-d07b94f1efd9	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	01 05 08	fanghi e rifiuti di perforazione contenenti cloruri diversi da quelli delle voci 01 05 05 e 01 05 06	f	01	05
9cf2574c-53bf-4158-a99b-20a3b497fee5	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 01 01	fanghi prodotti da operazioni di lavaggio e pulizia	f	02	01
6486e1a0-9f20-457e-97e1-3be383c128e5	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 01 02	scarti di tessuti animali	f	02	01
d94bacf3-6474-4c74-ab6e-52820857bf8c	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 01 03	scarti di tessuti vegetali	f	02	01
0623f5c9-67d1-4ef3-b28b-5728295f7f86	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 01 04	rifiuti plastici (ad esclusione degli imballaggi)	f	02	01
41f5186a-2d45-4173-bcde-a98029538fa9	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 01 06	feci animali urine e letame (comprese le lettiere usate) effluenti raccolti separatamente e trattati fuori sito	f	02	01
bab6a395-9552-4fc1-9c8b-03fd70b95ba0	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 01 07	rifiuti derivanti dalla silvicoltura	f	02	01
734e4d1c-c9cb-4b16-8d9f-d98265862fab	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 01 08*	rifiuti agrochimici contenenti sostanze pericolose	t	02	01
cfb5bc98-0516-48db-abdf-9fc9367338c9	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 01 09	rifiuti agrochimici diversi da quelli della voce 02 01 08	f	02	01
5475ad0f-2669-424f-9f88-732bf2dc31c2	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 01 10	rifiuti metallici	f	02	01
7f334c3f-9084-4670-ac1a-d68a973d0a26	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 02 01	fanghi prodotti da operazioni di lavaggio e pulizia	f	02	02
b93071f7-cf23-45f5-a7ca-214c8c61576f	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 02 02	scarti di tessuti animali	f	02	02
d5f410c9-05ec-4db8-93c8-88558cf32fb6	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 02 03	scarti inutilizzabili per il consumo o la trasformazione	f	02	02
8363ce18-be08-4dc8-ba9e-87c91a482dcc	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 02 04	fanghi da trattamento in loco degli effluenti	f	02	02
f32b8433-66de-4894-91aa-0ef1399ab24c	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 03 01	fanghi prodotti da operazioni di lavaggio pulizia sbucciatura centrifugazione e separazione	f	02	03
8cca9063-5f2f-4222-a8bc-bffff657bd10	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 03 02	rifiuti legati all'impiego di conservanti	f	02	03
aa704ad0-29cf-4642-b994-e2f7a359737d	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 03 03	rifiuti prodotti dall'estrazione tramite solvente	f	02	03
2d319707-3c2f-4eb0-8776-dc30d86ac25a	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 03 04	scarti inutilizzabili per il consumo o la trasformazione	f	02	03
097ec8ef-1f9c-473b-906d-f29f688f66c7	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 03 05	fanghi da trattamento in loco degli effluenti	f	02	03
f9fa38e9-8495-47b6-9843-a1097192fb5d	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 04 01	terriccio residuo delle operazioni di pulizia e lavaggio delle barbabietole	f	02	04
787d9cfb-1669-42e8-9894-5483996aabf8	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 04 02	carbonato di calcio fuori specifica	f	02	04
8ddd9c1e-d203-42bf-8110-386ee8dfda8a	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 04 03	fanghi da trattamento in loco degli effluenti	f	02	04
3e89abbc-db54-4521-9317-c6a222af92df	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 05 01	scarti inutilizzabili per il consumo o la trasformazione	f	02	05
f2daaabf-454f-4bc7-bc02-e1d06e013333	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 05 02	fanghi da trattamento in loco degli effluenti	f	02	05
0a1f4393-8b56-499e-915f-ad3068c48a14	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 06 01	scarti inutilizzabili per il consumo o la trasformazione	f	02	06
72b14b3b-d377-4eee-bd2d-99ca3fb36cc8	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 06 02	rifiuti prodotti dall'impiego di conservanti	f	02	06
54397917-7adf-41e2-8251-b5f03bd529fd	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 06 03	fanghi da trattamento in loco degli effluenti	f	02	06
9c80ff5f-7f3c-45fa-b8c7-96af549b99a6	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 07 01	rifiuti prodotti dalle operazioni di lavaggio pulitura e macinazione della materia prima	f	02	07
fea46431-1d5d-4812-8157-d99b487f2068	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 07 02	rifiuti prodotti dalla distillazione di bevande alcoliche	f	02	07
9f4a2d54-cc35-420c-8ec0-198f0e6000ae	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 07 03	rifiuti prodotti dai trattamenti chimici	f	02	07
2eb8db18-eda0-4596-8f24-d5db7add1263	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 07 04	scarti inutilizzabili per il consumo o la trasformazione	f	02	07
57b408ee-b0f8-42a9-b3fe-dd5e472bfc64	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	02 07 05	fanghi da trattamento in loco degli effluenti	f	02	07
0ca099b9-1d54-4d13-8a29-fbf49e594c94	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 01 01	scarti di corteccia e sughero	f	03	01
b457ff51-2401-4251-a3ca-9021588a8f22	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 01 04*	segatura trucioli residui di taglio legno truciolato e piallacci contenenti sostanze pericolose	t	03	01
3faeae20-60f5-43a9-b619-55e18bad5ddb	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 01 05	segatura trucioli residui di taglio legno truciolato e piallacci diversi da quelli di cui alla voce 03 01 04	f	03	01
253ccfda-1d4d-4b06-8fa5-d501ccf6e474	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 01 99	rifiuti non specificati altrimenti	f	03	01
f51d862d-d76c-46a8-9a72-cc179e4bd6ab	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 02 01*	preservanti del legno contenenti composti organici non alogenati	t	03	02
b85e193f-4788-4669-a6ff-c4b545e8422e	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 02 02*	preservanti del legno contenenti composti organici clorurati	t	03	02
dbcc7f2d-31ca-4157-b64a-f0c7da4e9425	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 02 03*	preservanti del legno contenenti composti organometallici	t	03	02
1f042904-6045-421a-a032-ca205bca1171	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 02 04*	preservanti del legno contenenti composti inorganici	t	03	02
cbafc70e-6312-409c-9067-754026de1e7f	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 02 05*	altri preservanti del legno contenenti sostanze pericolose	t	03	02
25d1655d-4709-4b9c-bbaa-c262a24c2e63	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 02 99	preservanti del legno non specificati altrimenti	f	03	02
5f65b5e2-22a7-427b-81a7-ff73bf7785f2	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 03 01	scarti di corteccia e legno	f	03	03
d1c6e9ce-e9b4-4fcb-a73e-f6cae599fb30	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 03 02	fanghi di recupero dei bagni di macerazione (green liquor)	f	03	03
37a5a563-bb9d-4b8b-96d6-c36a314d33e1	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 03 05	fanghi prodotti dai processi di deinchiostrazione nel riciclaggio della carta	f	03	03
f65138e3-7c83-40bf-bb3a-b4098160583c	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 03 07	scarti della separazione meccanica nella produzione di polpa da rifiuti di carta e cartone	f	03	03
b5259fe6-b961-4752-9b5c-72415e8f4a45	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 03 08	scarti della selezione di carta e cartone destinati ad essere riciclati	f	03	03
6752cda7-f939-41c3-9ea3-c913801a898c	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 03 09	fanghi di scarto contenenti carbonato di calcio	f	03	03
27a2bd31-5060-4966-be8a-b0785ff0ff6b	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 03 10	scarti di fibre e fanghi contenenti fibre riempitivi e prodotti di rivestimento generati dai processi di separazione meccanica	f	03	03
1e37e672-618e-4f26-8521-5c06f62d4892	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	03 03 11	fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 03 03 10	f	03	03
663c374a-7584-4c70-a558-cd73b3ccdbe7	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 01 01*	acido solforico e acido solforoso	t	06	01
6b48c775-5cfb-4c1a-8698-a5706ecfcc68	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 01 02*	acido cloridrico	t	06	01
9fc11599-98be-47e6-8979-0a3ea1a46a25	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 01 03*	acido fluoridrico	t	06	01
bf638973-7891-4010-82c5-fdae76ce1b3e	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 01 04*	acido fosforico e fosforoso	t	06	01
6ec87de5-4eb1-4fbd-b33e-3b57b13a094d	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 01 05*	acido nitrico e acido nitroso	t	06	01
fbfa12fb-ffca-4336-86e5-4d71036b46b5	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 01 06*	altri acidi	t	06	01
79378ab2-7931-4137-861a-2e470da85745	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 02 01*	idrossido di calcio	t	06	02
db5e8d43-cc73-48ee-9218-e4b44ed38e6a	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 02 03*	idrossido di ammonio	t	06	02
1f436758-e60d-49f8-9a8e-66643a1ab4ef	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 02 04*	idrossido di sodio e di potassio	t	06	02
8df757a8-f703-4be8-9056-172e990efaab	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 02 05*	altre basi	t	06	02
8f128cfe-e2dc-42d9-8430-ed6534ec7eda	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 03 11*	sali e loro soluzioni contenenti cianuri	t	06	03
0117db25-c742-4afb-bb48-3e6c07c88b94	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 03 13*	sali e loro soluzioni contenenti metalli pesanti	t	06	03
e8643592-8c8c-4b01-a6fb-1217979653ff	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 03 14	sali e loro soluzioni diversi da quelli delle voci 06 03 11 e 06 03 13	f	06	03
e4614c8d-d964-4109-894b-e4a0e51a82e6	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 03 15*	ossidi metallici contenenti metalli pesanti	t	06	03
9cf09507-f57b-44b3-8aa6-f2a0c948a8bd	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 03 16	ossidi metallici diversi da quelli di cui alla voce 06 03 15	f	06	03
70d546d2-2140-49cf-a1a7-c5f8f1eb25ec	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 04 03*	rifiuti contenenti arsenico	t	06	04
8b0a0dea-4a0e-4e3e-98c3-800ce7c206fa	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 04 04*	rifiuti contenenti mercurio	t	06	04
a6c1e2c3-01b8-4004-ade7-9f83417b15d9	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 04 05*	rifiuti contenenti altri metalli pesanti	t	06	04
aac8493e-b588-4ffb-ac33-91b42e78fe53	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 05 02*	fanghi da trattamento in loco di effluenti contenenti sostanze pericolose	t	06	05
d2b54431-035b-46c0-9698-a35cc6e01223	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 05 03	fanghi da trattamento in loco di effluenti diversi da quelli di cui alla voce 06 05 02	f	06	05
66dcd456-1c1f-4071-85c0-5fb26c4b1e3e	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 06 02*	rifiuti contenenti solfuri pericolosi	t	06	06
adb08547-1726-4690-b013-57fc6458447f	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 06 03	rifiuti contenenti solfuri diversi da quelli di cui alla voce 06 06 02	f	06	06
f34fb577-2fc3-49b7-8eaf-523c8bf07c36	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 07 01*	rifiuti dei processi elettrolitici contenenti amianto	t	06	07
5a74cd9b-a369-4dc2-8b85-f338ca6eadd3	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 07 02*	carbone attivo dalla produzione di cloro	t	06	07
49474918-39ff-4ee6-932e-e1d924c339ca	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 07 03*	fanghi di solfato di bario contenenti mercurio	t	06	07
9ddf77b7-75a4-42f9-a7a7-e28f41bf89d8	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 07 04*	soluzioni e acidi ad esempio acido di contatto	t	06	07
c7206544-407f-44d4-ba33-cde806dd5c2d	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 08 02*	rifiuti contenenti clorosilani pericolosi	t	06	08
ffa1a4f7-44c0-4f79-8d98-7469df14605c	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 09 02	scorie fosforose	f	06	09
c4923cd4-ece3-4487-ae13-ac639d738753	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 09 03*	rifiuti prodotti da reazioni a base di calcio contenenti sostanze pericolose o contaminati da tali sostanze	t	06	09
41adfb50-9f72-4bfc-8616-9f73987400c5	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 09 04	rifiuti prodotti da reazioni a base di calcio diversi da quelli di cui alla voce 06 09 03	f	06	09
ccb55661-584a-4dd6-b84d-ab88618039ff	2025-10-31 11:42:06.97	2025-10-31 11:42:06.97	06 10 02*	rifiuti contenenti sostanze pericolose	t	06	10
cf88aea8-7647-47b5-80c3-2822c6364938	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	06 10 99	rifiuti non specificati altrimenti	f	06	10
d7426838-7165-4bda-adda-0d32bfff7c82	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	06 11 01	rifiuti prodotti dalla fabbricazione del titanio	f	06	11
0e82eb24-2d03-46a7-9d21-8b958cc13383	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	06 11 99	rifiuti non specificati altrimenti	f	06	11
bcea96e2-268f-4cd2-ad76-07b50643b132	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	06 13 01*	prodotti fitosanitari inorganici sostanze chimiche per il trattamento del legno ed altri biocidi	t	06	13
16956853-a237-4cbd-a286-545ad9f3b201	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	06 13 02*	carbone attivo esaurito (tranne 06 07 02)	t	06	13
33468c6c-78e3-40bf-936c-9c69da0a3a2e	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	06 13 03	nerofumo	f	06	13
1be0442e-aab0-412b-b7ae-e42a49cb1560	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	06 13 04*	rifiuti derivanti dai processi di lavorazione dell'amianto	t	06	13
f5dfe0a3-a20b-4f02-8fc9-8e736f97a202	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	06 13 05*	fuliggine	t	06	13
550a4304-43ab-4ef6-8124-e3fb5aa9ebd1	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 11*	pitture e vernici di scarto contenenti solventi organici o altre sostanze pericolose	t	08	01
1e3d6d89-1d06-49d5-8aa4-489db96c265b	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 12	pitture e vernici di scarto diverse da quelle di cui alla voce 08 01 11	f	08	01
9efffafd-e8b0-4f51-910c-db9b41c3cf19	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 13*	fanghi prodotti da pitture e vernici contenenti solventi organici o altre sostanze pericolose	t	08	01
b66f700b-269a-4cb9-8d9f-b6a75f5c9426	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 14	fanghi prodotti da pitture e vernici diversi da quelli di cui alla voce 08 01 13	f	08	01
3f45c478-040e-4378-ae29-0d7042af04ca	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 15*	fanghi acquosi contenenti pitture e vernici contenenti solventi organici o altre sostanze pericolose	t	08	01
80794e32-c898-4cb6-bd57-ec9ff12f6c62	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 16	fanghi acquosi contenenti pitture e vernici diversi da quelli di cui alla voce 08 01 15	f	08	01
abfbbfe1-47be-4924-8b31-138a4d0bf7e8	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 17*	fanghi prodotti dalla rimozione di pitture e vernici contenenti solventi organici o altre sostanze pericolose	t	08	01
a8d131b9-edfe-4159-8097-c82eed7fd5f2	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 18	fanghi prodotti dalla rimozione di pitture e vernici diversi da quelli di cui alla voce 08 01 17	f	08	01
1eee3415-c2c9-4adf-a825-69d7d516fc90	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 19*	sospensioni acquose contenenti pitture e vernici contenenti solventi organici o altre sostanze pericolose	t	08	01
db4ba270-af7c-4993-b58a-be742def2828	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 20	sospensioni acquose contenenti pitture e vernici diverse da quelle di cui alla voce 08 01 19	f	08	01
984d28aa-1c1a-41c0-883d-d1ade1146447	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 21*	rifiuti di vernici o di sverniciatori	t	08	01
acdbf9bf-f216-4f81-948d-f1bdd27cc915	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 01 99	rifiuti non specificati altrimenti	f	08	01
9d974c7e-b387-4cfb-bbc8-f2c3e2caba1a	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 02 01	polveri di scarto di rivestimenti	f	08	02
8c6ae18a-1019-485c-9ce7-2643d59327fd	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 02 02	fanghi acquosi contenenti materiali ceramici	f	08	02
9ebca3af-89d2-4a1a-aaf8-42f4a7f03aef	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 02 03	sospensioni acquose contenenti materiali ceramici	f	08	02
e35392bd-5e95-48da-aac2-5c0cef293c37	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 07	fanghi acquosi contenenti inchiostro	f	08	03
f8025214-c979-4f65-9bc7-64e22a8840cf	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 08	rifiuti liquidi acquosi contenenti inchiostro	f	08	03
ad92def9-eed4-4ff9-a5cf-3eb9838248dc	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 12*	scarti di inchiostro contenenti sostanze pericolose	t	08	03
ba942e0f-228b-4b61-9673-5906e99cc755	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 13	scarti di inchiostro diversi da quelli di cui alla voce 08 03 12	f	08	03
88ddf59a-bde3-4467-b983-7d807185ef55	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 14*	fanghi di inchiostro contenenti sostanze pericolose	t	08	03
a4d3e3f7-beae-41cf-ad40-4cf207e6b113	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 15	fanghi di inchiostro diversi da quelli di cui alla voce 08 03 14	f	08	03
1ffe621e-cad0-4c78-a2f6-0d8ada9d27af	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 16*	residui di soluzioni per incisione	t	08	03
b62ba4c7-406f-4831-8448-22ad3238acf9	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 17*	toner per stampa esauriti contenenti sostanze pericolose	t	08	03
0d18dcb3-9058-4c3a-a390-11a3a407c2ca	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 18	toner per stampa esauriti diversi da quelli di cui alla voce 08 03 17	f	08	03
f7e0cd50-fc9c-4023-bb09-d51dc43ceaea	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 03 19*	oli dispersi	t	08	03
4ce44d2b-a107-4c66-88fd-9c685b2fa0fc	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 04 09*	adesivi e sigillanti di scarto contenenti solventi organici o altre sostanze pericolose	t	08	04
dd5ff0e9-8c61-41c5-ba6d-05dbc3e6afe4	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 04 10	adesivi e sigillanti di scarto diversi da quelli di cui alla voce 08 04 09	f	08	04
902abb6c-5a3d-47e2-b688-6a9e1ae3ea28	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 04 11*	fanghi di adesivi e sigillanti contenenti solventi organici o altre sostanze pericolose	t	08	04
e2a7dab4-156b-48de-88f7-faf93b83c52e	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 04 12	fanghi di adesivi e sigillanti diversi da quelli di cui alla voce 08 04 11	f	08	04
7487db4e-20af-4263-b8a7-741f25fb0b72	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 04 13*	fanghi acquosi contenenti adesivi o sigillanti contenenti solventi organici o altre sostanze pericolose	t	08	04
c40c11a7-3013-46ef-b8e2-ec2dcfe2bef5	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 04 14	fanghi acquosi contenenti adesivi o sigillanti diversi da quelli di cui alla voce 08 04 13	f	08	04
a333cdd6-976d-456b-8fea-80b5aca21a74	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 04 15*	rifiuti liquidi acquosi contenenti adesivi o sigillanti contenenti solventi organici o altre sostanze pericolose	t	08	04
669eb889-120c-422b-a35e-bf306b08e2a7	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 04 16	rifiuti liquidi acquosi contenenti adesivi o sigillanti diversi da quelli di cui alla voce 08 04 15	f	08	04
6368f2c6-44db-4bad-ad1a-4cdb99d28926	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	08 04 17*	olio di resina	t	08	04
d161bdca-d7da-45b0-abd3-933edbb0b4a3	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 01	ceneri pesanti scorie e polveri di caldaia (tranne le polveri di caldaia di cui alla voce 10 01 04)	f	10	01
46ad1b4a-ba71-4a89-b1f7-9a998d8bfacc	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 02	ceneri leggere di carbone	f	10	01
f2424d6a-ab25-41a3-b00c-bf7d87908ddb	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 03	ceneri leggere di torba e di legno non trattato	f	10	01
9a9f4718-0b7f-4675-b33d-fe0715de7b77	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 04*	ceneri leggere di olio combustibile e polveri di caldaia	t	10	01
ebef1c8e-719d-4a21-adfc-20fcd8735f9a	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 05	rifiuti solidi prodotti da reazioni a base di calcio nei processi di desolforazione dei fumi	f	10	01
5e7bdf53-2924-4e16-8f44-9f769d52d9f5	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 07	rifiuti fangosi prodotti da reazioni a base di calcio nei processi di desolforazione dei fumi	f	10	01
d746bfbf-8685-4d95-bac0-042aa2eb1efc	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 09*	acido solforico	t	10	01
5d123307-54bc-468f-bbca-88a880868c6e	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 13*	ceneri leggere prodotte da idrocarburi emulsionati usati come carburante	t	10	01
6db5b9de-2b30-47ab-bb47-f17ab55f84ed	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 14*	ceneri pesanti scorie e polveri di caldaia prodotte dal coincenerimento contenenti sostanze pericolose	t	10	01
20fc2ee6-6491-4d84-9b0c-7cce58ae6f1a	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 15	ceneri pesanti scorie e polveri di caldaia prodotte dal coincenerimento diverse da quelle di cui alla voce 10 01 14	f	10	01
1584a4fd-3771-4fb6-abe1-6f5d7165b3ef	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 16*	ceneri leggere prodotte dal coincenerimento contenenti sostanze pericolose	t	10	01
0ec7584d-f8ac-4ce5-9275-758d13607e02	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 17	ceneri leggere prodotte dal coincenerimento diverse da quelle di cui alla voce 10 01 16	f	10	01
77a526f5-beb4-498a-800a-6ea624a2caa3	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 18*	rifiuti prodotti dalla depurazione dei fumi contenenti sostanze pericolose	t	10	01
a4cfbe54-10c3-4e62-bdbd-43df6b77161a	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 19	rifiuti prodotti dalla depurazione dei fumi diversi da quelli di cui alle voci 10 01 05 10 01 07 e 10 01 18	f	10	01
b3ff4bff-6dc4-4a05-98d6-5c8998ae607a	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 20*	fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose	t	10	01
8cb72e76-0b76-4ba6-ae40-b890daeaa4f2	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 21	fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 10 01 20	f	10	01
2a0cd91f-b605-485f-852e-3df2be945d8e	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 22*	fanghi acquosi da operazioni di pulizia caldaie contenenti sostanze pericolose	t	10	01
7fddaa5f-7dcc-4b5a-983a-2fbfaf1d5f42	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 23	fanghi acquosi da operazioni di pulizia caldaie diversi da quelli di cui alla voce 10 01 22	f	10	01
51e9f90a-6eb0-4629-8548-aac9bdbc39a6	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 24	sabbie dei reattori a letto fluidizzato	f	10	01
78318a1e-c4d7-4651-95ea-3bed87f76566	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 25	rifiuti dell'immagazzinamento e della preparazione del combustibile delle centrali termoelettriche a carbone	f	10	01
153cfea5-9afd-4a38-bcc2-1ecdf26c7120	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	10 01 26	rifiuti prodotti dal trattamento delle acque di raffreddamento	f	10	01
9adbaa16-5215-475f-849c-0d122ca50ed9	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 01	limatura e trucioli di materiali ferrosi	f	12	01
a154555c-5d6d-4e7e-bc59-bedc5d215a4a	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 02	polveri e particolato di materiali ferrosi	f	12	01
d8817ddd-8d03-461a-90cf-9435f97bbb08	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 03	limatura e trucioli di materiali non ferrosi	f	12	01
6687c607-9b63-4e5d-8e6b-26604845acc4	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 04	polveri e particolato di materiali non ferrosi	f	12	01
12c5c12a-1001-4bec-8d2e-4adcff2ba3ed	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 05	limatura e trucioli di materiali plastici	f	12	01
64b04de4-3ae1-4f5b-adeb-b796cbaec8a8	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 06*	oli minerali per macchinari contenenti alogeni (escluse le emulsioni e le soluzioni)	t	12	01
13ef9a8d-537a-4b47-ae43-ca5f0c054181	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 07*	oli minerali per macchinari non contenenti alogeni (escluse le emulsioni e le soluzioni)	t	12	01
f84ec4c1-d3ea-4f61-a418-5cc0e959fd19	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 08*	emulsioni e soluzioni per macchinari contenenti alogeni	t	12	01
8617a10e-9ebc-42d8-b382-13307b3799ca	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 09*	emulsioni e soluzioni per macchinari non contenenti alogeni	t	12	01
5269b5cd-9159-432e-a965-5011f5b39bd2	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 10*	oli sintetici per macchinari	t	12	01
9daa32db-535f-4573-9458-790dc3599626	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 12*	cere e grassi esauriti	t	12	01
76182cc3-49df-4595-a136-6ed30e8b7a18	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 13	rifiuti di saldatura	f	12	01
12ff282c-7679-45e0-a9b3-97fc0415275d	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 14*	fanghi di lavorazione contenenti sostanze pericolose	t	12	01
ed9c5865-a190-4d0f-8af8-fde9887fee96	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 15	fanghi di lavorazione diversi da quelli di cui alla voce 12 01 14	f	12	01
9e248972-bbd9-4bfa-812b-c381644ddf31	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 16*	materiale abrasivo di scarto contenente sostanze pericolose	t	12	01
80b504bd-9a8c-4010-b9c4-a3043daf284e	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 17	materiale abrasivo di scarto diverso da quello di cui alla voce 12 01 16	f	12	01
143c0dad-736c-49db-b1e4-bcd5f5a91f26	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 18*	fanghi metallici (fanghi di rettifica di affilatura e di lappatura) contenenti oli	t	12	01
069fd47d-a357-435b-9c30-310e490fd541	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 19*	oli per macchinari facilmente biodegradabili	t	12	01
73aabf69-a130-435c-81fe-a0ff5cf53edf	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 20*	materiale abrasivo di scarto contenente sostanze pericolose	t	12	01
8094ae32-f3ba-4845-a627-2ef678008b3a	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	12 01 21	materiale abrasivo di scarto diverso da quello di cui alla voce 12 01 20	f	12	01
5d323cbd-8e4d-459d-9f32-e108c162cbc3	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 01 01*	oli per circuiti idraulici contenenti PCB	t	13	01
27e89ebf-9ff1-4987-b593-6e9b22e95d13	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 01 04*	emulsioni clorurate	t	13	01
5a550e84-7285-4188-88d8-cb91c2ce9b4e	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 01 05*	emulsioni non clorurate	t	13	01
d58fc2f0-ae54-4076-9c13-d7b60f8770a6	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 01 09*	oli minerali per circuiti idraulici clorurati	t	13	01
cc399cf7-cdfe-47c7-8939-e58dcc08b941	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 01 10*	oli minerali per circuiti idraulici non clorurati	t	13	01
954ccca9-c23f-4f0b-879e-3f13fac8ca3e	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 01 11*	oli sintetici per circuiti idraulici	t	13	01
b1bec8ca-eea4-489d-9c9e-fc96695a6c42	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 01 12*	oli per circuiti idraulici facilmente biodegradabili	t	13	01
8b402506-0321-477f-971d-e6e3400414c1	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 01 13*	altri oli per circuiti idraulici	t	13	01
379d4e0f-6ade-4719-9bbd-4ea50300bf0c	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 02 04*	oli minerali per motori ingranaggi e lubrificazione clorurati	t	13	02
f2a0c06d-2967-4e5e-a0fc-d721f97b622b	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 02 05*	oli minerali per motori ingranaggi e lubrificazione non clorurati	t	13	02
97237287-337e-4124-a7b0-e5980723ad96	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 02 06*	oli sintetici per motori ingranaggi e lubrificazione	t	13	02
c4a3b914-2de3-409e-86a7-0e28f4ffa5ae	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 02 07*	oli per motori ingranaggi e lubrificazione facilmente biodegradabili	t	13	02
95fa004f-a975-400c-9cd0-c4922e63692d	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 02 08*	altri oli per motori ingranaggi e lubrificazione	t	13	02
2f991ad5-3f06-41ba-9495-2d325bc5c8c1	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 03 01*	oli isolanti e termoconduttori contenenti PCB	t	13	03
0985cbfd-3b07-4c73-a0e3-42e20d211287	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 03 06*	oli minerali isolanti e termoconduttori clorurati diversi da quelli di cui alla voce 13 03 01	t	13	03
beb54c61-b80b-4083-92a1-ee738fcfccf9	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 03 07*	oli minerali isolanti e termoconduttori non clorurati	t	13	03
36f2a8ec-a881-488e-9383-b0883f296434	2025-10-31 11:42:07.074	2025-10-31 11:42:07.074	13 03 08*	oli sintetici isolanti e termoconduttori	t	13	03
4e26ff3c-23cc-429a-8401-52372f67f2a3	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 03 09*	oli isolanti e termoconduttori facilmente biodegradabili	t	13	03
5055c593-23a6-4ecc-a510-4745bd2145ff	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 03 10*	altri oli isolanti e termoconduttori	t	13	03
f6870f1e-e514-42f7-b984-688c18e046e8	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 04 01*	oli di sentina della navigazione interna	t	13	04
e47a6bf4-72a0-4d6c-bd25-9649ddcc4887	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 04 02*	oli di sentina delle fognature dei moli	t	13	04
975632e4-6cc0-4cbc-b4bd-1a9557c886bf	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 04 03*	oli di sentina di un altro tipo di navigazione	t	13	04
87d3cf5d-4c0e-4034-b6d1-36562fe1722f	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 05 01*	rifiuti solidi delle camere a sabbia e di prodotti di separazione olio/acqua	t	13	05
6a3cc72d-3a80-4608-8d96-50b62737bbb5	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 05 02*	fanghi di prodotti di separazione olio/acqua	t	13	05
7acd43cc-28d9-4e32-929e-5ea6999f9c40	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 05 03*	fanghi da collettori	t	13	05
9e954ee4-1be8-4790-afda-448f471d59c4	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 05 06*	oli prodotti dalla separazione olio/acqua	t	13	05
5fac7494-9556-435a-bedb-2ba5b0958311	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 05 07*	acque oleose prodotte dalla separazione olio/acqua	t	13	05
c040445a-08b5-4737-a5c9-d4c9e6d80dd4	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 05 08*	miscugli di rifiuti delle camere a sabbia e dei prodotti di separazione olio/acqua	t	13	05
246d44a2-8209-46ff-9c9d-59de7d032e49	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 07 01*	olio combustibile e carburante diesel	t	13	07
f680d147-838a-438d-8154-025c304abd5c	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 07 02*	petrolio	t	13	07
150dcbbf-8a63-42ac-a7c2-317594b0899e	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 07 03*	altri carburanti (comprese le miscele)	t	13	07
cb6b7d0c-f454-4291-a157-8e17a1d9c50d	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 08 01*	fanghi ed emulsioni di dissalazione	t	13	08
c573b5f2-8826-486b-bdba-f50ce6c4d8bd	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 08 02*	altre emulsioni	t	13	08
edbedc84-ed73-4301-88d1-3fc82a937220	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	13 08 99*	rifiuti non specificati altrimenti	t	13	08
df0a33ba-7a4d-4bc7-bf21-959ce15d60c8	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	14 06 01*	clorofluorocarburi HCFC HFC	t	14	06
1b2dcb2c-c469-42eb-a4a3-f2fd04075393	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	14 06 02*	altri solventi e miscele di solventi alogenati	t	14	06
7bfe17e2-fcb3-429e-abec-5c967168f01c	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	14 06 03*	altri solventi e miscele di solventi	t	14	06
a52c13e0-749e-495a-8108-f8eb3f43db4a	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	14 06 04*	fanghi o rifiuti solidi contenenti solventi alogenati	t	14	06
0e513a78-361c-4538-8ae1-306d8305aa95	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	14 06 05*	fanghi o rifiuti solidi contenenti altri solventi	t	14	06
46062a80-0b40-4e0c-b0ba-64786d746d01	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 01	imballaggi di carta e cartone	f	15	01
abf36ceb-e563-4120-9a3a-8d6436fe1d3a	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 02	imballaggi di plastica	f	15	01
86d9adef-7295-4a22-8e01-52571b26a0ee	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 03	imballaggi di legno	f	15	01
c822f672-591c-44ac-b9fd-99253d3719ba	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 04	imballaggi metallici	f	15	01
c53da5d4-cb18-40dc-8e1d-875bf7ecf996	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 05	imballaggi compositi	f	15	01
7145f79a-6e53-48ec-8c04-f378eefcbc2b	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 06	imballaggi in materiali misti	f	15	01
56c70074-4e46-4635-8d29-bad84cacb9b0	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 07	imballaggi di vetro	f	15	01
d06112a9-c907-4675-a122-4a6567f0fbc9	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 09	imballaggi in materia tessile	f	15	01
32652451-d0d9-465b-990f-fcd002f2d1d9	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 10*	imballaggi contenenti residui di sostanze pericolose o contaminati da tali sostanze	t	15	01
1c7353de-a913-44dc-9604-e3ed9fd39bf4	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 01 11*	imballaggi metallici contenenti matrici solide porose pericolose (ad esempio amianto) compresi contenitori a pressione vuoti	t	15	01
08171ac2-f72a-4a57-af90-b4f2c2fe8258	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 02 02*	assorbenti stracci da pulizia (ad esempio strofinacci panni antipolvere) materiali filtranti e indumenti protettivi contaminati da sostanze pericolose	t	15	02
7174fa50-e34d-4d4a-9a8f-c098483f58b7	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	15 02 03	assorbenti stracci da pulizia materiali filtranti e indumenti protettivi diversi da quelli di cui alla voce 15 02 02	f	15	02
68070b6e-5042-4933-8276-16e5958eb8ab	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 03	pneumatici fuori uso	f	16	01
f1b662cc-09c4-4030-a9ea-e1e16d9d394f	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 04*	veicoli fuori uso	t	16	01
107df03c-c90e-4c35-860d-6cc43920bbb3	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 06	veicoli fuori uso non contenenti liquidi né altre componenti pericolose	f	16	01
21f95a83-9a71-4d48-b34e-9f4e100647b2	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 07*	filtri dell'olio	t	16	01
a6fa680a-6bf1-43dc-985b-312b76988aca	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 08*	componenti contenenti mercurio	t	16	01
58d46cfa-d32c-4b26-a13e-edc67cab1ebd	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 09*	componenti contenenti PCB	t	16	01
e87f45e3-7ae7-4b40-9a5d-6677654ad7d9	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 10*	componenti esplosivi (ad esempio air bag)	t	16	01
887b677a-633b-4668-b684-6b3481734f95	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 11*	pastiglie per freni contenenti amianto	t	16	01
1c31a50e-2133-4044-83b7-885b7052ace3	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 12	pastiglie per freni diverse da quelle di cui alla voce 16 01 11	f	16	01
51c7f751-35f5-41ca-b7bc-503c6e293331	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 13*	liquidi per freni	t	16	01
5afa9ba7-c3b8-44a3-9291-afe966a4edef	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 14*	liquidi antigelo contenenti sostanze pericolose	t	16	01
3140b47e-044c-4812-8f75-01dd35819c7e	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 15	liquidi antigelo diversi da quelli di cui alla voce 16 01 14	f	16	01
23d66b28-331c-4514-8950-f72439753060	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 16	serbatoi per gas liquefatto	f	16	01
02f55c32-f8e1-436f-9221-5cab926bc037	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 17	metalli ferrosi	f	16	01
5ffdf16c-5c10-4c71-a511-480963b81b14	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 18	metalli non ferrosi	f	16	01
dfd9ffc7-37d8-4116-a61e-6bdb63a62fc4	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 19	plastica	f	16	01
92e0aa1f-a992-4a08-a8d5-73eac68a29df	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 20	vetro	f	16	01
c79b6f4d-d6c1-4915-afca-e5319d23d0d0	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 21*	componenti pericolosi diversi da quelli di cui alle voci da 16 01 07 a 16 01 11 e da 16 01 13 a 16 01 14	t	16	01
7d651fc9-4d3a-4a21-b296-106220d393de	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 22	componenti non specificati altrimenti	f	16	01
92003c41-0342-4e17-8414-52bdfa96c6b7	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 01 99	rifiuti non specificati altrimenti	f	16	01
93dfd335-fa3f-4a6e-a2f4-c4c1d921e119	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 02 09*	trasformatori e condensatori contenenti PCB	t	16	02
38089872-bb94-43be-8bfe-b54db8188162	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 02 10*	apparecchiature fuori uso contenenti PCB o da essi contaminate diverse da quelle di cui alla voce 16 02 09	t	16	02
f9123de6-9f6d-4805-bb0d-809f3e956003	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 02 11*	apparecchiature fuori uso contenenti clorofluorocarburi HCFC HFC	t	16	02
3cac092d-d831-4830-b7dd-c7d65edb092f	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 02 12*	apparecchiature fuori uso contenenti amianto in fibre libere	t	16	02
8fc177d9-751e-455e-a169-92b6073d4372	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 02 13*	apparecchiature fuori uso contenenti componenti pericolosi diversi da quelli di cui alle voci da 16 02 09 a 16 02 12	t	16	02
12f2324d-2294-45cc-8387-3ae44a02dd1a	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 02 14	apparecchiature fuori uso diverse da quelle di cui alle voci da 16 02 09 a 16 02 13	f	16	02
9a671bee-be16-4cdf-9804-ab2a41bc6c8d	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 02 15*	componenti pericolosi rimossi da apparecchiature fuori uso	t	16	02
4c66a853-f645-4b45-8385-129a99c01238	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 02 16	componenti rimossi da apparecchiature fuori uso diversi da quelli di cui alla voce 16 02 15	f	16	02
af4fff2f-ba50-4b27-b049-d1a796509eee	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 03 03*	rifiuti inorganici contenenti sostanze pericolose	t	16	03
2b2ab2a1-91b3-4c91-b729-e55f24f9deb9	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 03 04	rifiuti inorganici diversi da quelli di cui alla voce 16 03 03	f	16	03
7f107c3e-08d9-4c26-a724-b89ef28b8ce6	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 03 05*	rifiuti organici contenenti sostanze pericolose	t	16	03
4fae11c4-e4b4-461a-a968-a9644fede73b	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 03 06	rifiuti organici diversi da quelli di cui alla voce 16 03 05	f	16	03
0e4d5951-d2c5-49b2-b587-adf58574cd0f	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 03 07*	mercurio metallico	t	16	03
85baf743-1fd6-432e-93e3-3397620bbf23	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 04 01*	munizioni di scarto	t	16	04
9a81739c-2cd1-42a0-9db1-e0fce9a9de28	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 04 02*	fuochi artificiali di scarto	t	16	04
f0a7bb38-475c-4f35-87bb-d77f92dc265e	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 04 03*	altri rifiuti esplosivi	t	16	04
ee81a05c-a174-4c37-81ac-9b54496bad7d	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 05 04*	gas in contenitori a pressione (compresi gli halon) contenenti sostanze pericolose	t	16	05
c3c9b98c-2118-44f9-b618-df3a723c371a	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 05 05	gas in contenitori a pressione diversi da quelli di cui alla voce 16 05 04	f	16	05
dd8b7213-2510-4ba2-8f84-079dbc30dcfd	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 05 06*	sostanze chimiche di laboratorio contenenti o costituite da sostanze pericolose comprese le miscele di sostanze chimiche di laboratorio	t	16	05
ca14899d-090a-466a-895f-a68a860096b8	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 05 07*	sostanze chimiche inorganiche di scarto contenenti o costituite da sostanze pericolose	t	16	05
2d4fa8a3-d405-4f0a-a2f2-1ff34b1d40e5	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 05 08*	sostanze chimiche organiche di scarto contenenti o costituite da sostanze pericolose	t	16	05
9c6b078c-95cf-4366-8332-466938e56453	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 05 09	sostanze chimiche di scarto diverse da quelle di cui alle voci 16 05 06 16 05 07 e 16 05 08	f	16	05
da1381f0-37a0-440b-8373-4031132b7f1c	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 06 01*	batterie al piombo	t	16	06
af8c698c-a329-4672-acf2-b6eab9454dc5	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 06 02*	batterie al nichel-cadmio	t	16	06
b3796f43-088b-4eb9-8f8e-78aeca83e67e	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 06 03*	batterie contenenti mercurio	t	16	06
c5dd9ebd-b035-453b-84af-157848fc9287	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 06 04	batterie alcaline (tranne 16 06 03)	f	16	06
9a9b9323-af94-4fe1-a734-41a5c9fcfead	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 06 05	altre batterie ed accumulatori	f	16	06
ab17bf2c-247c-4d4a-b107-e2afaa9230b0	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 06 06*	elettroliti di batterie ed accumulatori oggetto di raccolta differenziata	t	16	06
12fbef92-4aad-45dd-915e-57bbab7ad961	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 07 08*	rifiuti contenenti olio	t	16	07
1a80efc1-794f-4378-a80b-c018075d3d0d	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 07 09*	rifiuti contenenti altre sostanze pericolose	t	16	07
da732666-c468-4884-a403-7505e14f6854	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 07 99	rifiuti non specificati altrimenti	f	16	07
30f74a88-acf6-4f37-ad5b-233da5752f65	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 08 01	catalizzatori esauriti contenenti oro argento renio rodio palladio iridio o platino (tranne 16 08 07)	f	16	08
c34e5779-1072-41dc-9906-f6b9379b27bd	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 08 02*	catalizzatori esauriti contenenti metalli di transizione pericolosi o composti di metalli di transizione pericolosi	t	16	08
c48ecbb0-46c0-4178-9f55-f4b252cde4f5	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 08 03	catalizzatori esauriti contenenti metalli di transizione o composti di metalli di transizione non specificati altrimenti	f	16	08
1dfb1015-502f-4a8e-ba0e-6bc43d59f959	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 08 04	catalizzatori esauriti da cracking catalitico fluido (tranne 16 08 07)	f	16	08
39da947f-3137-42ad-a33a-3cd99e347d98	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 08 05*	catalizzatori esauriti contenenti acido fosforico	t	16	08
64e9a996-9ea6-4440-8ab3-f9800b186609	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 08 06*	liquidi esauriti usati come catalizzatori	t	16	08
afab2556-33c8-43eb-ab01-724fc4113797	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 08 07*	catalizzatori esauriti contaminati da sostanze pericolose	t	16	08
b4cb8dd1-22b9-4515-bc6b-ed4816e83138	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 09 01*	permanganati ad esempio permanganato di potassio	t	16	09
0729fc89-0d54-4ef8-b297-19f8433ef8b5	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 09 02*	cromati ad esempio cromato di potassio dicromato di potassio o di sodio	t	16	09
d14c0a9d-2f59-46f2-bf5d-78bcf952559e	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 09 03*	perossidi ad esempio perossido d'idrogeno	t	16	09
181a55c3-2daf-4886-8350-2d89cdef1f7e	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 09 04*	sostanze ossidanti non specificate altrimenti	t	16	09
ca16a57c-049a-4a1b-8fe9-46bf849a1fe1	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 10 01*	rifiuti liquidi acquosi contenenti sostanze pericolose	t	16	10
8544a633-02b1-4f29-abf6-39604596d411	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 10 02	rifiuti liquidi acquosi diversi da quelli di cui alla voce 16 10 01	f	16	10
e633b759-a895-48ef-b92b-592afde49a28	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 10 03*	concentrati acquosi contenenti sostanze pericolose	t	16	10
fda1cdbb-50b6-41db-b838-f36a4ecaf97f	2025-10-31 11:42:07.147	2025-10-31 11:42:07.147	16 10 04	concentrati acquosi diversi da quelli di cui alla voce 16 10 03	f	16	10
24f63e52-ac14-4f76-b4e1-61a8b4676a54	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	16 11 01*	rivestimenti e materiali refrattari a base di carbone provenienti da processi metallurgici contenenti sostanze pericolose	t	16	11
e787d63c-8f7e-4714-adb2-53754608498b	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	16 11 02	rivestimenti e materiali refrattari a base di carbone provenienti da processi metallurgici diversi da quelli di cui alla voce 16 11 01	f	16	11
178efef9-db40-42c9-866b-3c214d1b42cc	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	16 11 03*	altri rivestimenti e materiali refrattari provenienti da processi metallurgici contenenti sostanze pericolose	t	16	11
e5099e97-ad4f-4976-ad54-7f6c3ff49f47	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	16 11 04	altri rivestimenti e materiali refrattari provenienti da processi metallurgici diversi da quelli di cui alla voce 16 11 03	f	16	11
267954f9-ddd5-4d2b-9ebe-900c20c4b1e9	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	16 11 05*	rivestimenti e materiali refrattari provenienti da processi non metallurgici contenenti sostanze pericolose	t	16	11
7cbce387-0be8-4bb4-9703-11ea3ea26ded	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	16 11 06	rivestimenti e materiali refrattari provenienti da processi non metallurgici diversi da quelli di cui alla voce 16 11 05	f	16	11
3994df60-aa24-47c2-a5ce-79c1682646a4	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 01 01	cemento	f	17	01
3b21a809-6f53-4e81-aa02-539d73d9ee0b	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 01 02	mattoni	f	17	01
2d2609bd-5ab9-44af-9dd0-284b1897eab9	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 01 03	mattonelle e ceramiche	f	17	01
950ceada-edd2-4f00-b0c7-d7c1d071ec54	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 01 06*	miscugli o scorie di cemento mattoni mattonelle e ceramiche contenenti sostanze pericolose	t	17	01
b3b05b85-1c73-4795-9faf-0a4702c6264f	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 01 07	miscugli di cemento mattoni mattonelle e ceramiche diversi da quelli di cui alla voce 17 01 06	f	17	01
7a4325fc-4d78-4911-985d-4f35751e48a6	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 02 01	legno	f	17	02
f3905992-0981-46c2-9807-01c8d0f4160c	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 02 02	vetro	f	17	02
570d91ad-d04c-433f-a33a-38be58cf8448	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 02 03	plastica	f	17	02
ee080fda-36dc-402d-b66a-553f12a0655c	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 02 04*	vetro plastica e legno contenenti sostanze pericolose o da esse contaminati	t	17	02
c192b971-ed60-4b62-9adf-e846bbfc944f	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 03 01*	miscele bituminose contenenti catrame di carbone	t	17	03
4393a6b2-e9c3-444c-a054-0777c883ffc1	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 03 02	miscele bituminose diverse da quelle di cui alla voce 17 03 01	f	17	03
e1e1ec31-b15a-4a8d-b192-7340d28347ce	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 03 03*	catrame di carbone e prodotti contenenti catrame	t	17	03
0641328a-a8c0-4970-b832-3d3e7460d145	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 01	rame bronzo ottone	f	17	04
87c9aee1-896a-4bf9-8b29-472db23523b6	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 02	alluminio	f	17	04
e752130f-933d-436f-bbad-5488221e62d4	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 03	piombo	f	17	04
2a84f932-6196-4e3e-a048-0a2463f94670	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 04	zinco	f	17	04
031c6442-45ed-4b1b-901c-946d6aefae72	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 05	ferro e acciaio	f	17	04
452e6338-dead-48d4-9e5c-f61aa9ac7249	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 06	stagno	f	17	04
68ac0107-e31a-4378-ab4f-4ccf44186dcf	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 07	metalli misti	f	17	04
224f77d0-0084-478d-b8ce-aa1c2637e7f5	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 09*	rifiuti metallici contaminati da sostanze pericolose	t	17	04
41002164-9ffe-4289-97b6-a36e058a22aa	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 10*	cavi impregnati di olio di catrame di carbone o di altre sostanze pericolose	t	17	04
d6911de6-2e70-4ea0-9f36-683437b1fec9	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 04 11	cavi diversi da quelli di cui alla voce 17 04 10	f	17	04
b08eb14e-c662-4e4a-bf61-5823c8bc6dc8	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 05 03*	terra e rocce contenenti sostanze pericolose	t	17	05
6bfaef51-e433-4aee-b5fa-972c58c115bb	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 05 04	terra e rocce diverse da quelle di cui alla voce 17 05 03	f	17	05
717f9a12-60e2-47ad-81af-123cd9b57213	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 05 05*	fanghi di dragaggio contenenti sostanze pericolose	t	17	05
0d028579-d700-4259-b40f-7bac65e5eff9	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 05 06	fanghi di dragaggio diversi da quelli di cui alla voce 17 05 05	f	17	05
ebf3783b-9026-46a5-9254-6155a4d7905e	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 05 07*	pietrisco per massicciate ferroviarie contenente sostanze pericolose	t	17	05
ea06fe36-acc1-4f62-a881-51d7d409ca14	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 05 08	pietrisco per massicciate ferroviarie diverso da quello di cui alla voce 17 05 07	f	17	05
72e78f20-0abe-4d55-aa8e-6dc3fb4e1458	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 06 01*	materiali isolanti contenenti amianto	t	17	06
a98265e0-6f92-426f-ad1b-ec96dbcc9f19	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 06 03*	altri materiali isolanti contenenti o costituiti da sostanze pericolose	t	17	06
7195447b-1520-4b94-902e-1c1cadd5babc	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 06 04	materiali isolanti diversi da quelli di cui alle voci 17 06 01 e 17 06 03	f	17	06
66fa785b-5ad0-4b26-a91f-3aefa0d5ce51	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 06 05*	materiali da costruzione contenenti amianto	t	17	06
d224df3e-d0ce-466a-80c6-f81ea837b332	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 08 01*	materiali da costruzione a base di gesso contaminati da sostanze pericolose	t	17	08
bdaef0e7-a4f4-45ba-83cd-63a246e40bda	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 08 02	materiali da costruzione a base di gesso diversi da quelli di cui alla voce 17 08 01	f	17	08
f4bc76ed-411b-41b1-bc5e-1af90dcdb842	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 09 01*	rifiuti dell'attività di costruzione e demolizione contenenti mercurio	t	17	09
10cd0263-9515-423c-b379-e5dbcd50844d	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 09 02*	rifiuti dell'attività di costruzione e demolizione contenenti PCB (ad esempio sigillanti contenenti PCB resine contenenti PCB unità vetrate isolanti contenenti PCB condensatori contenenti PCB)	t	17	09
fae9402f-edc9-46ce-9228-1067bbb304fe	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 09 03*	altri rifiuti dell'attività di costruzione e demolizione (compresi rifiuti misti) contenenti sostanze pericolose	t	17	09
8dcb74d4-b669-4df7-a110-cc1253c21580	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	17 09 04	rifiuti misti dell'attività di costruzione e demolizione diversi da quelli di cui alle voci 17 09 01 17 09 02 e 17 09 03	f	17	09
4a6f6b73-4de4-4dc8-a2d0-7908f56c935f	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 01 01	oggetti da taglio (diversi da 18 01 03)	f	18	01
e463f4eb-b3cb-48ff-80c9-e4c580630052	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 01 02*	parti anatomiche ed organi incluse le sacche per il plasma e le riserve di sangue (tranne 18 01 03)	t	18	01
c9375972-757e-4401-9a1f-f14d0a4d3d50	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 01 03*	rifiuti che devono essere raccolti e smaltiti applicando precauzioni particolari per evitare infezioni	t	18	01
ea548788-61b2-4ca1-9740-dacd93127d8f	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 01 04	rifiuti che non devono essere raccolti e smaltiti applicando precauzioni particolari per evitare infezioni (ad es. bende garze gessi lenzuola monouso indumenti monouso assorbenti igienici)	f	18	01
75733abd-2ef7-48bb-bb87-7047d280ceb6	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 01 06*	sostanze chimiche pericolose o contenenti sostanze pericolose	t	18	01
78eeefaf-e893-497d-ae3a-5ecc3d603ac4	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 01 07	sostanze chimiche diverse da quelle di cui alla voce 18 01 06	f	18	01
834aa538-0b27-4b4a-9769-8ccddfb685fc	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 01 08*	medicinali citotossici e citostatici	t	18	01
a1b6d231-2fee-4714-8ef8-cf9935cc4b3d	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 01 09	medicinali diversi da quelli di cui alla voce 18 01 08	f	18	01
eafe31c7-c0cc-41ce-ae7d-ada812faf7ff	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 01 10*	rifiuti di amalgama prodotti da interventi odontoiatrici	t	18	01
06362a5a-2b60-4568-bcac-e3c973d87b75	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 02 01	oggetti da taglio (diversi da 18 02 02)	f	18	02
c4f6f126-3cc8-4e26-80d7-3e24fd3b28a2	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 02 02*	rifiuti che devono essere raccolti e smaltiti applicando precauzioni particolari per evitare infezioni	t	18	02
6d0f7987-5921-47bc-847d-1e7f95666f6c	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 02 03	rifiuti che non devono essere raccolti e smaltiti applicando precauzioni particolari per evitare infezioni	f	18	02
14ac10b1-6d69-4ca5-b4db-59f74df62ed9	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 02 05*	sostanze chimiche pericolose o contenenti sostanze pericolose	t	18	02
95173835-576d-4769-a986-197fae46ebb6	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 02 06	sostanze chimiche diverse da quelle di cui alla voce 18 02 05	f	18	02
8fe47696-8ab0-4642-9057-f3b16387fc99	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 02 07*	medicinali citotossici e citostatici	t	18	02
784802bd-0de9-4677-a32d-6c15720d0556	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	18 02 08	medicinali diversi da quelli di cui alla voce 18 02 07	f	18	02
761f2964-6833-499c-ad81-0630bb20c4dd	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 02	materiali ferrosi estratti da ceneri pesanti	f	19	01
99f81f29-76cb-4c37-8655-ec1297d7654e	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 05*	residui di filtrazione prodotti dal trattamento dei fumi	t	19	01
64437ebd-d534-4954-a8c5-c8d03ff85667	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 06*	rifiuti liquidi acquosi prodotti dal trattamento dei fumi e altri rifiuti liquidi acquosi	t	19	01
6e9358f6-f544-4627-9c4a-c14cfe041f47	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 07*	rifiuti solidi prodotti dal trattamento dei fumi	t	19	01
b6d40e19-981b-42dc-befb-dfda67f38c40	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 10*	carbone attivo esaurito prodotto dal trattamento dei fumi	t	19	01
2158093f-f120-4ac3-905b-823d4ec04071	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 11*	ceneri pesanti e scorie contenenti sostanze pericolose	t	19	01
cb7f56aa-cdce-408e-beb3-77f84fe93d2b	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 12	ceneri pesanti e scorie diverse da quelle di cui alla voce 19 01 11	f	19	01
034bb3a8-ee1f-4f5e-a2da-cf693507facd	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 13*	ceneri leggere contenenti sostanze pericolose	t	19	01
266110cc-85b7-4cfb-a8d0-a2b8fb4eb62e	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 14	ceneri leggere diverse da quelle di cui alla voce 19 01 13	f	19	01
8de260be-da19-4bfc-8438-56308dedb9e1	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 15*	polveri di caldaia contenenti sostanze pericolose	t	19	01
36242572-5d0d-4d4d-8673-be437654a1e2	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 16	polveri di caldaia diverse da quelle di cui alla voce 19 01 15	f	19	01
e069b0f2-6bf1-4fa8-9efa-161256d6d72c	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 17*	rifiuti della pirolisi contenenti sostanze pericolose	t	19	01
4bcd930c-1c56-4221-866b-1e3966cee6d2	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 18	rifiuti della pirolisi diversi da quelli di cui alla voce 19 01 17	f	19	01
a380a733-8207-44c9-bde0-a61d72abac25	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 01 19	sabbie dei reattori a letto fluidizzato	f	19	01
25118234-09a6-44d0-92f8-e37e7e2f045a	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 03	rifiuti premiscelati composti esclusivamente da rifiuti non pericolosi	f	19	02
82cafef0-5e78-499b-8a73-731b361829fa	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 04*	rifiuti premiscelati contenenti almeno un rifiuto pericoloso	t	19	02
41d3c88b-303f-4131-9370-5a8b61209083	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 05*	fanghi prodotti da trattamenti chimico-fisici contenenti sostanze pericolose	t	19	02
98acf560-1b75-468d-9318-61b3a2a994bf	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 06	fanghi prodotti da trattamenti chimico-fisici diversi da quelli di cui alla voce 19 02 05	f	19	02
73d5529b-8b7d-40ba-9c79-92382e197d38	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 07*	oli e concentrati prodotti da processi di separazione	t	19	02
b8fc7301-b0e2-4043-9a7c-196c0613adb0	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 08*	rifiuti combustibili liquidi contenenti sostanze pericolose	t	19	02
402c03e9-f7bb-4233-89d6-c93cdd53a7ff	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 09*	rifiuti combustibili solidi contenenti sostanze pericolose	t	19	02
84be5ba0-53c7-4df9-8005-a0b625331c0a	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 10	rifiuti combustibili diversi da quelli di cui alle voci 19 02 08 e 19 02 09	f	19	02
fe09dc3c-22c8-4459-a512-cfe62cbe7647	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 11*	altri rifiuti contenenti sostanze pericolose	t	19	02
0a447930-cb1c-49fd-96ac-7137ca23bbad	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 02 99	rifiuti non specificati altrimenti	f	19	02
fae3a1c5-d23e-40e4-ac9f-d6acb5b4a9c6	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 03 04*	rifiuti contrassegnati come pericolosi parzialmente stabilizzati	t	19	03
e796edd9-0f10-40bc-b0a7-552f2a635169	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 03 05	rifiuti stabilizzati diversi da quelli di cui alla voce 19 03 04	f	19	03
f3ff47c2-2f11-440d-b14c-52fff1d8ee33	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 03 06*	rifiuti contrassegnati come pericolosi solidificati	t	19	03
8150abbc-eb0c-4ff6-af1a-bc4c8974367f	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 03 07	rifiuti solidificati diversi da quelli di cui alla voce 19 03 06	f	19	03
ad4c76dc-310b-41d3-8aea-fe450b5b5ab4	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 04 01	rifiuti vetrificati	f	19	04
e0911038-5ec7-4982-8666-3b7d21df9a60	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 04 02*	ceneri leggere e altri rifiuti dal trattamento dei fumi	t	19	04
9158acf8-f681-43b8-97ea-3127d37d9d0f	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 04 03*	fase solida non vetrificata	t	19	04
8e6660bd-5936-4e70-8980-b1cc2a87c8fe	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 04 04	rifiuti liquidi acquosi prodotti dalla tempra di rifiuti vetrificati	f	19	04
2484256e-bbff-402d-adb7-e649311f6ac0	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 05 01	parte di rifiuti urbani e simili non compostata	f	19	05
ca4a1629-af05-4f97-b66e-1a8129e4857e	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 05 02	parte di rifiuti animali e vegetali non compostata	f	19	05
a2795b30-d93e-41b3-9b99-7452b751682d	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 05 03	compost fuori specifica	f	19	05
1948cbea-3c69-4c02-aa96-0f9435643ec4	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 05 99	rifiuti non specificati altrimenti	f	19	05
330f14b5-5f6e-4ed4-ab62-4952b6456054	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 06 03	liquidi prodotti dal trattamento anaerobico di rifiuti urbani	f	19	06
dcaa06c1-ebb9-4829-9671-972b3ea2d227	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 06 04	digestato prodotto dal trattamento anaerobico di rifiuti urbani	f	19	06
fd9266f5-7105-4d55-9c05-f3e95855e87c	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 06 05	liquidi prodotti dal trattamento anaerobico di rifiuti di origine animale o vegetale	f	19	06
f3c9f543-b7cc-4d5a-8462-bea2abde31ae	2025-10-31 11:42:07.225	2025-10-31 11:42:07.225	19 06 06	digestato prodotto dal trattamento anaerobico di rifiuti di origine animale o vegetale	f	19	06
585187d8-d127-415f-a215-234567b9c58a	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 06 99	rifiuti non specificati altrimenti	f	19	06
0a549e04-4ad9-4e1e-9079-a84939d90af9	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 07 02*	percolato di discarica contenente sostanze pericolose	t	19	07
062678ba-f5d6-4516-a289-7469a5bc3499	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 07 03	percolato di discarica diverso da quello di cui alla voce 19 07 02	f	19	07
0dc3b2bd-a3ac-4103-bb37-2b6dbc061560	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 01	residui di vagliatura	f	19	08
42fa56d3-062a-4258-9e10-fa6ee2967fcc	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 02	rifiuti da dissabbiamento	f	19	08
8469e638-6e5d-4244-9fc0-20f49aeb13e2	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 05	fanghi prodotti dal trattamento delle acque reflue urbane	f	19	08
6e43770e-a531-44ee-89f1-65270034ed08	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 06*	resine a scambio ionico saturate o esaurite	t	19	08
dc962add-d99a-484c-9bc0-dc14f4e5890b	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 07*	soluzioni e fanghi di rigenerazione delle resine a scambio ionico	t	19	08
566205f1-8324-4d8f-8c2d-95a9de6dcd5e	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 08*	rifiuti prodotti da sistemi a membrana contenenti metalli pesanti	t	19	08
cd046ad1-464f-4b2c-9ec1-2844918d8851	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 09	miscele di oli e grassi prodotte dalla separazione olio/acqua contenenti esclusivamente oli e grassi commestibili	f	19	08
05e1646a-a1f9-4244-b224-fe3ab7fa5bf6	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 10*	miscele di oli e grassi prodotte dalla separazione olio/acqua diverse da quelle di cui alla voce 19 08 09	t	19	08
42b83d63-35b0-4a4e-b9f2-ea46da7d3c33	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 11*	fanghi prodotti dal trattamento biologico delle acque reflue industriali contenenti sostanze pericolose	t	19	08
704b471b-f0bf-4e4c-9a0b-b52ec335bc92	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 12	fanghi prodotti dal trattamento biologico delle acque reflue industriali diversi da quelli di cui alla voce 19 08 11	f	19	08
b7c4d851-0f8d-486b-b5f5-aacbe2a08f4f	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 13*	fanghi contenenti sostanze pericolose prodotti da altri trattamenti delle acque reflue industriali	t	19	08
35a64d50-f2a0-4f62-9020-8c2154c1f763	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 14	fanghi prodotti da altri trattamenti delle acque reflue industriali diversi da quelli di cui alla voce 19 08 13	f	19	08
4c37f394-e337-40f6-841e-9af0483060e9	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 08 99	rifiuti non specificati altrimenti	f	19	08
f38d61d7-eab6-4f82-a2e6-5fa3cea0fbb0	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 09 01	rifiuti solidi prodotti dai processi di filtrazione e vaglio primari	f	19	09
16c3d66c-2d5c-4269-a29d-ccc49421964d	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 09 02	fanghi prodotti dai processi di chiarificazione dell'acqua	f	19	09
1dff3a19-372f-47bb-bc68-c9c32ce73215	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 09 03	fanghi prodotti dai processi di decarbonatazione	f	19	09
1fcc4384-ea3f-498d-abef-c8586c361771	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 09 04	carbone attivo esaurito	f	19	09
21f4d5f8-751d-4335-8eea-e3525a2abd5a	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 09 05	resine a scambio ionico saturate o esaurite	f	19	09
fa5c951e-2d5e-4fb7-9f4f-4fbee1e07204	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 09 06	soluzioni e fanghi di rigenerazione delle resine a scambio ionico	f	19	09
894d2565-f879-4b57-97a3-40cf7632f67d	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 09 99	rifiuti non specificati altrimenti	f	19	09
8997e67f-2fbb-4d27-8317-e93a7101cf53	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 10 01	rifiuti di ferro e acciaio	f	19	10
ae348191-e938-494a-b07a-47ab443f16bc	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 10 02	rifiuti di metalli non ferrosi	f	19	10
5328bdbf-9023-490d-9004-0cd6ae441587	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 10 03*	frazioni leggere e polveri contenenti sostanze pericolose	t	19	10
dcb54605-6b10-43da-83ad-cbacb26dae89	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 10 04	frazioni leggere e polveri diversi da quelli di cui alla voce 19 10 03	f	19	10
5895458a-92c2-42f2-a7d9-3445cd43c2b8	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 10 05*	altre frazioni contenenti sostanze pericolose	t	19	10
882f07ed-e00c-4908-84bc-bfdecd07d95d	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 10 06	altre frazioni diverse da quelle di cui alla voce 19 10 05	f	19	10
12be5e10-90f2-47b4-b4fa-5df49540725d	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 11 01*	filtri di argilla esauriti	t	19	11
ee74227d-bbbf-4a54-8579-7e38d7c2c339	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 11 02*	catrami acidi	t	19	11
027a9f6f-869e-4f54-8e87-2077e484ebac	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 11 03*	rifiuti liquidi acquosi	t	19	11
c65b5a4b-a494-4c68-83a1-87c2bfdd673e	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 11 04*	rifiuti prodotti dalla purificazione di carburanti mediante basi	t	19	11
5cc168cb-5853-4cca-b883-4dbd90d45be6	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 11 05*	fanghi prodotti dal trattamento in loco degli effluenti contenenti sostanze pericolose	t	19	11
5d8a72c1-a132-498e-a6db-7a6c2357bd6d	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 11 06	fanghi prodotti dal trattamento in loco degli effluenti diversi da quelli di cui alla voce 19 11 05	f	19	11
2e5ee57e-d941-4a5e-a8e0-06c4bc384993	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 11 07*	rifiuti prodotti dalla depurazione dei fumi	t	19	11
ca6fe707-2148-4ae6-9163-ef7a26d2206f	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 11 99	rifiuti non specificati altrimenti	f	19	11
cc151fd8-3d29-41cd-a7c0-fd71b23ea8c8	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 01	carta e cartone	f	19	12
4b6ce7fa-213d-47fb-bc3c-35362d437aaf	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 02	metalli ferrosi	f	19	12
1b8890cc-3a06-4ae0-8837-74f142d5ab59	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 03	metalli non ferrosi	f	19	12
c48784f8-a519-47d9-bd78-8531113314d2	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 04	plastica e gomma	f	19	12
224d7438-31a0-4300-b995-023cbdafe9f0	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 05	vetro	f	19	12
996b7cad-15df-465a-b89d-5aff4b3d6f41	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 06*	legno contenente sostanze pericolose	t	19	12
1937dd6c-671e-42a4-b82d-4816bacc0b99	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 07	legno diverso da quello di cui alla voce 19 12 06	f	19	12
026b2725-f188-4a78-8537-90c89679f7f8	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 08	prodotti tessili	f	19	12
6e9db607-f9be-4e38-908b-a8225059a08d	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 09	minerali (ad esempio sabbia pietrame)	f	19	12
7cbdb7c5-78f5-4877-b964-c6ab017753fb	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 10	rifiuti combustibili (combustibile da rifiuti)	f	19	12
6a1e96cd-c68b-40df-9a82-3da44d3197aa	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 11*	altri rifiuti (compresi materiali misti) prodotti dal trattamento meccanico dei rifiuti contenenti sostanze pericolose	t	19	12
9511eea0-e4c5-43d0-966c-f4be247cb7b6	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 12 12	altri rifiuti (compresi materiali misti) prodotti dal trattamento meccanico dei rifiuti diversi da quelli di cui alla voce 19 12 11	f	19	12
1afcc985-620e-4a82-b185-2b613cc43e4f	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 13 01*	rifiuti solidi prodotti da operazioni di bonifica dei terreni contenenti sostanze pericolose	t	19	13
608d431b-6d90-4e6a-bce7-376b587ad209	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 13 02	rifiuti solidi prodotti da operazioni di bonifica dei terreni diversi da quelli di cui alla voce 19 13 01	f	19	13
96c0bd3a-e8c4-4fff-a8eb-16be50c70479	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 13 03*	fanghi prodotti da operazioni di bonifica dei terreni contenenti sostanze pericolose	t	19	13
2e8499de-5c02-4e90-bae7-da2c056d2a14	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 13 04	fanghi prodotti da operazioni di bonifica dei terreni diversi da quelli di cui alla voce 19 13 03	f	19	13
3b9fe92f-23d7-4c3e-b65b-97b28198d482	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 13 05*	fanghi prodotti da operazioni di bonifica delle acque di falda contenenti sostanze pericolose	t	19	13
d54d3f98-0ad0-40af-b193-8853e92c155c	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 13 06	fanghi prodotti da operazioni di bonifica delle acque di falda diversi da quelli di cui alla voce 19 13 05	f	19	13
f4d080ef-ecfb-4326-8f34-d5dda8e7e634	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 13 07*	rifiuti liquidi acquosi e concentrati acquosi prodotti da operazioni di bonifica delle acque di falda contenenti sostanze pericolose	t	19	13
82017dfa-4e82-461a-9c9b-f0f85b09e2d3	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	19 13 08	rifiuti liquidi acquosi e concentrati acquosi prodotti da operazioni di bonifica delle acque di falda diversi da quelli di cui alla voce 19 13 07	f	19	13
95574e81-ec5b-42bb-b50e-3def221702c4	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 01	carta e cartone	f	20	01
d645bea2-53d1-4701-9c2c-c8af46ce7eae	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 02	vetro	f	20	01
37388f24-af35-4330-aa98-707824db671a	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 08	rifiuti biodegradabili di cucine e mense	f	20	01
ca0e55d1-2aef-4bb1-9a6d-0a505f855069	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 10	abbigliamento	f	20	01
34659c96-0ac5-4f35-bcbe-da389abebab3	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 11	prodotti tessili	f	20	01
1868d11d-2712-4f22-b014-d914b56cf281	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 13*	solventi	t	20	01
2d4946ef-5c93-4bd0-94ad-2dc9e3579caf	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 14*	acidi	t	20	01
b0f732fc-5c5a-4d34-b898-f2bb21e9f492	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 15*	sostanze alcaline	t	20	01
e9820a79-febb-4352-99ca-230cda7157d7	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 17*	prodotti fotochimici	t	20	01
defccf88-bd24-40d1-9aa3-21a17b31117f	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 19*	pesticidi	t	20	01
512955dd-bc89-4474-9ba6-46db38bb7753	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 21*	tubi fluorescenti ed altri rifiuti contenenti mercurio	t	20	01
516628e2-4a3a-4b3e-8e99-6b6934fe4993	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 23*	apparecchiature fuori uso contenenti clorofluorocarburi	t	20	01
a1cd24bf-a0e2-4bed-98c5-3b31831ed50e	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 25	oli e grassi commestibili	f	20	01
ee4bbc9d-1520-4f9a-857f-acacf610e703	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 26*	oli e grassi diversi da quelli di cui alla voce 20 01 25	t	20	01
f11fd20a-02f8-473e-84fd-4e7a546f6454	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 27*	vernici inchiostri adesivi e resine contenenti sostanze pericolose	t	20	01
2863cc27-d51c-4431-90f8-498b930ac228	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 28	vernici inchiostri adesivi e resine diversi da quelli di cui alla voce 20 01 27	f	20	01
c16c395b-c53e-45ca-b394-81a65b73de48	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 29*	detergenti contenenti sostanze pericolose	t	20	01
323efc31-e5a9-41ae-af9e-79c204d22c4a	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 30	detergenti diversi da quelli di cui alla voce 20 01 29	f	20	01
1dc8b092-b55d-4001-95c8-89aa860e2ee2	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 31*	medicinali citotossici e citostatici	t	20	01
4b183ab7-5f04-400a-9450-acd7a27581dd	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 32	medicinali diversi da quelli di cui alla voce 20 01 31	f	20	01
0f19509c-7778-41b5-a2d1-204eb4955a70	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 33*	batterie e accumulatori di cui alle voci 16 06 01 16 06 02 o 16 06 03 nonché batterie e accumulatori non suddivisi contenenti tali batterie	t	20	01
d0b3e588-0e3f-4bd4-ade3-48bf480a1223	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 34	batterie e accumulatori diversi da quelli di cui alla voce 20 01 33	f	20	01
fa7679ef-9cd8-49e6-98a6-6e1942aa0ba6	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 35*	apparecchiature elettriche ed elettroniche fuori uso diverse da quelle di cui alle voci 20 01 21 e 20 01 23 contenenti componenti pericolosi	t	20	01
9b2b3cf8-4394-4fe0-b1cf-6c0febd5dcd5	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 36	apparecchiature elettriche ed elettroniche fuori uso diverse da quelle di cui alle voci 20 01 21 20 01 23 e 20 01 35	f	20	01
5565ce32-33f8-4f6a-88a2-8404df1538f4	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 37*	legno contenente sostanze pericolose	t	20	01
f828d38f-1fa8-44c9-b046-eb109e77e0b2	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 38	legno diverso da quello di cui alla voce 20 01 37	f	20	01
e4312284-4ee6-4956-badb-18bf0daccf66	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 39	plastica	f	20	01
30cc0bd8-afd3-46ae-9458-a34687517b66	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 40	metallo	f	20	01
a7c168c6-2618-4411-81e6-1666d221154f	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 41	rifiuti prodotti dalla pulizia di camini e ciminiere	f	20	01
b5589177-e9d4-4942-98da-a2390b1209d1	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 01 99	altre frazioni non specificate altrimenti	f	20	01
417bb0c5-2642-4a73-a9b6-63068b180530	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 02 01	rifiuti biodegradabili	f	20	02
b223d93b-3842-486c-8c07-2b66d0b503de	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 02 02	terra e roccia	f	20	02
f78dbb03-807d-41ae-96d6-dff94e31bc1d	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 02 03	altri rifiuti non biodegradabili	f	20	02
18a2b843-0eb9-45be-b73d-9a054162ec74	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 03 01	rifiuti urbani non differenziati	f	20	03
d1a922ff-4f0c-4171-af3b-6c34d4fd0871	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 03 02	rifiuti dei mercati	f	20	03
f7ab36cd-a32f-4d0b-89f0-e75fa85cc497	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 03 03	residui della pulizia stradale	f	20	03
092dd4da-2bed-4a31-aaed-4d18bc88800a	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 03 04	fanghi delle fosse settiche	f	20	03
2f842483-e33c-4084-8c8f-de2ca15d26f7	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 03 06	rifiuti della pulizia delle fognature	f	20	03
4331bed3-9e73-49b8-ab23-bfaeec02aae3	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 03 07	rifiuti ingombranti	f	20	03
462c5438-b1cc-478d-a6a4-74515eb81cc0	2025-10-31 11:42:07.304	2025-10-31 11:42:07.304	20 03 99	rifiuti urbani non specificati altrimenti	f	20	03
\.


--
-- Data for Name: company_templates; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.company_templates (id, tenant_id, created_at, updated_at, name, logo_url, logo_base64, header_text, footer_text, primary_color, secondary_color, font_family, is_default) FROM stdin;
\.


--
-- Data for Name: consultant_tenant_associations; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.consultant_tenant_associations (id, consultant_user_id, tenant_id, role_id, created_at, updated_at, added_by, added_at, expires_at, is_active) FROM stdin;
\.


--
-- Data for Name: destinatari; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.destinatari (id, tenant_id, created_at, updated_at, ragione_sociale, partita_iva, numero_autorizzazione, via, civico, cap, comune, provincia, email, telefono, pec) FROM stdin;
\.


--
-- Data for Name: fir_signatures; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.fir_signatures (id, fir_id, user_id, created_at, role, signed_at, signature_method, signature_value, certificate_hash, document_hash, timestamp_token) FROM stdin;
\.


--
-- Data for Name: firs; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.firs (id, tenant_id, created_at, updated_at, fir_number, status, workflow_version, submitted_at, completed_at, cancelled_at, cancellation_reason, producer_user_id, producer_partita_iva, producer_name, producer_address, producer_contact, carrier_user_id, carrier_partita_iva, carrier_name, carrier_vehicle_plate, carrier_contact, receiver_user_id, receiver_partita_iva, receiver_name, receiver_address, receiver_contact, cer_code, waste_description, waste_category, quantity, unit, transport_date, estimated_arrival_date, actual_arrival_date, transport_notes, rentri_sync_status, rentri_protocol_number, rentri_synced_at, rentri_sync_attempts, rentri_last_sync_error, rentri_next_retry_at, attachment_urls) FROM stdin;
\.


--
-- Data for Name: mud_reports; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.mud_reports (id, tenant_id, created_at, updated_at, year, status, submitted_at, submitted_by, report_data, pdf_url, xml_url) FROM stdin;
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.notifications (id, tenant_id, user_id, created_at, updated_at, type, title, message, severity, related_entity_id, related_entity_type, action_url, is_read, read_at, expires_at) FROM stdin;
\.


--
-- Data for Name: permission_audit_logs; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.permission_audit_logs (id, tenant_id, user_id, created_at, spid_fiscal_code, action_attempted, resource_type, resource_id, decision, evaluated_policies, context_attributes, "timestamp", session_id, previous_entry_hash, current_hash) FROM stdin;
\.


--
-- Data for Name: permission_policies; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.permission_policies (id, permission_id, created_at, updated_at, "policyName", policy_definition, evaluation_order, is_active, version) FROM stdin;
\.


--
-- Data for Name: permission_requests; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.permission_requests (id, user_id, tenant_id, requested_role_id, created_at, updated_at, requested_permissions, business_justification, duration, status, reviewed_by, reviewed_at, denial_reason) FROM stdin;
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.permissions (id, created_at, updated_at, resource, action, scope, description, is_sensitive, module) FROM stdin;
94da2155-78e9-41c5-9078-170cac9860bd	2025-10-31 11:42:07.386	2025-10-31 11:42:07.386	fir	create	own	Create FIR documents owned by user	f	FIR
1c90f1d7-cec9-4d8d-85de-2c0f85708375	2025-10-31 11:42:07.392	2025-10-31 11:42:07.392	fir	create	facility	Create FIR documents for assigned facilities	f	FIR
2d4df757-0420-4aaf-80aa-61b06954f938	2025-10-31 11:42:07.394	2025-10-31 11:42:07.394	fir	create	all	Create FIR documents for entire tenant	t	FIR
626477c0-9577-4c89-acaf-91b72c2f1e24	2025-10-31 11:42:07.396	2025-10-31 11:42:07.396	fir	read	own	View own FIR documents	f	FIR
2e2086e2-213c-43a7-b3ab-81b82a05401f	2025-10-31 11:42:07.398	2025-10-31 11:42:07.398	fir	read	facility	View FIR documents for assigned facilities	f	FIR
e6d81338-ef3a-4b17-a626-bc112e04e175	2025-10-31 11:42:07.401	2025-10-31 11:42:07.401	fir	read	all	View all FIR documents in tenant	f	FIR
fea08911-2024-4249-9794-3e3e8c8f8ade	2025-10-31 11:42:07.403	2025-10-31 11:42:07.403	fir	update	own	Update own FIR documents	f	FIR
57a92fbf-5282-4186-8f79-0e814cd3b2ba	2025-10-31 11:42:07.405	2025-10-31 11:42:07.405	fir	update	facility	Update FIR documents for assigned facilities	f	FIR
61729b5c-6780-429f-b63e-7473a2c59a1d	2025-10-31 11:42:07.407	2025-10-31 11:42:07.407	fir	update	all	Update any FIR document in tenant	t	FIR
f94cef47-2b2c-4836-b95d-4b00bdc8e577	2025-10-31 11:42:07.409	2025-10-31 11:42:07.409	fir	delete	own	Delete own draft FIR documents	f	FIR
804707ad-45e6-4918-b5c2-7cfde8a16c81	2025-10-31 11:42:07.412	2025-10-31 11:42:07.412	fir	delete	facility	Delete FIR documents for assigned facilities	t	FIR
54cf5a29-6708-418d-92bb-bf468df71768	2025-10-31 11:42:07.414	2025-10-31 11:42:07.414	fir	delete	all	Delete any FIR document in tenant	t	FIR
d635616c-50e4-490b-9d90-f4eacf59761b	2025-10-31 11:42:07.416	2025-10-31 11:42:07.416	fir	sign	own	Digitally sign FIR documents	t	FIR
b4a4b8d3-93c4-444a-a5d3-a245ae585358	2025-10-31 11:42:07.418	2025-10-31 11:42:07.418	fir	export	all	Export FIR documents to PDF/XML	f	FIR
573cae8e-1c89-4f84-9158-6f5786c36a72	2025-10-31 11:42:07.419	2025-10-31 11:42:07.419	facility	create	all	Create new facilities	f	Facility
2dac5cdc-de9a-4e00-a138-ea72757d9eb0	2025-10-31 11:42:07.421	2025-10-31 11:42:07.421	facility	read	all	View facility information	f	Facility
120d3120-4514-493a-8702-d5f49b7a22dc	2025-10-31 11:42:07.423	2025-10-31 11:42:07.423	facility	update	all	Update facility information	f	Facility
12422083-793f-4d9b-a3d6-28a162ca9e47	2025-10-31 11:42:07.425	2025-10-31 11:42:07.425	facility	delete	all	Delete facilities	t	Facility
e5bc4a9a-19df-47d8-a7a1-68f6d0f7f842	2025-10-31 11:42:07.427	2025-10-31 11:42:07.427	facility	manage-registry	all	Manage facility waste registry	f	Facility
d140b75a-33fd-4147-ba95-4c35622a5919	2025-10-31 11:42:07.43	2025-10-31 11:42:07.43	facility	assign-users	all	Assign users to facilities	t	Facility
974bcb08-576e-423f-b43d-bc42edfc919a	2025-10-31 11:42:07.432	2025-10-31 11:42:07.432	facility	view-analytics	all	View facility analytics and reports	f	Facility
833918b2-80cd-4a37-9b1c-b084c1b2ce69	2025-10-31 11:42:07.434	2025-10-31 11:42:07.434	facility	configure	all	Configure facility settings	t	Facility
ac7a02ed-bb2c-4f57-a26b-a26c63a97888	2025-10-31 11:42:07.436	2025-10-31 11:42:07.436	user	create	all	Create new users in tenant	t	User
43152521-ba85-4844-acc7-e672b22b8c27	2025-10-31 11:42:07.438	2025-10-31 11:42:07.438	user	read	all	View user information	f	User
5f163423-bac8-49f9-bb0b-ff1687b9618c	2025-10-31 11:42:07.441	2025-10-31 11:42:07.441	user	update	all	Update user information	t	User
557348bf-ed19-4e53-ad75-392a5c39cc5e	2025-10-31 11:42:07.443	2025-10-31 11:42:07.443	user	delete	all	Delete users from tenant	t	User
51dd9407-8992-4766-95b6-bb456debca61	2025-10-31 11:42:07.445	2025-10-31 11:42:07.445	user	manage-roles	all	Assign and revoke user roles	t	User
21b6dbfc-e962-45d4-9d3d-d3c439f9a5c9	2025-10-31 11:42:07.447	2025-10-31 11:42:07.447	user	view-activity	all	View user activity logs	f	User
7a213ec9-e788-4138-8206-e530d0d48570	2025-10-31 11:42:07.449	2025-10-31 11:42:07.449	user	impersonate	all	Impersonate users for support	t	User
aa81c559-2402-4324-8a1a-7154835b7ac1	2025-10-31 11:42:07.451	2025-10-31 11:42:07.451	report	create	all	Create custom reports	f	Report
fbd3a81b-3f83-4054-901d-80406933d907	2025-10-31 11:42:07.453	2025-10-31 11:42:07.453	report	read	all	View reports	f	Report
1b3d5b36-2201-46ce-841c-08fc285690b0	2025-10-31 11:42:07.455	2025-10-31 11:42:07.455	report	export	all	Export reports to PDF/Excel	f	Report
7c70dcdc-5484-4f49-a0cd-02a3941dca50	2025-10-31 11:42:07.456	2025-10-31 11:42:07.456	report	schedule	all	Schedule automated reports	f	Report
3a75642a-747b-4cbc-af37-06b32673ab04	2025-10-31 11:42:07.458	2025-10-31 11:42:07.458	report	share	all	Share reports with external parties	t	Report
c453d7da-4155-4f68-9051-767bf51545a6	2025-10-31 11:42:07.46	2025-10-31 11:42:07.46	analytics	view-dashboard	all	View analytics dashboard	f	Analytics
1272969e-bb5f-4a45-ae56-545d1c23ba34	2025-10-31 11:42:07.462	2025-10-31 11:42:07.462	analytics	view-kpis	all	View key performance indicators	f	Analytics
07f5b5ca-7474-4615-8655-bc33cf4cb055	2025-10-31 11:42:07.464	2025-10-31 11:42:07.464	analytics	export-data	all	Export analytics data	t	Analytics
08e315bd-c666-430e-a4db-d9521186636e	2025-10-31 11:42:07.466	2025-10-31 11:42:07.466	analytics	configure-metrics	all	Configure custom metrics	f	Analytics
829a2ce5-cf06-4b91-901b-474d6708787d	2025-10-31 11:42:07.468	2025-10-31 11:42:07.468	notification	read	own	View own notifications	f	Notification
92743456-cf6d-41be-aa74-7b20ee3947e0	2025-10-31 11:42:07.471	2025-10-31 11:42:07.471	notification	manage	all	Manage notification settings	f	Notification
9b099e85-ff41-4f31-ae15-0a04a927380a	2025-10-31 11:42:07.473	2025-10-31 11:42:07.473	notification	send	all	Send notifications to users	t	Notification
49350129-507b-4348-9088-c339ba16f0ae	2025-10-31 11:42:07.475	2025-10-31 11:42:07.475	admin	view-audit-log	all	View system audit logs	t	Admin
d31cfa34-7ce1-48d2-af48-de7f9fe6b028	2025-10-31 11:42:07.477	2025-10-31 11:42:07.477	admin	manage-roles	all	Create and manage custom roles	t	Admin
70c2f345-e7e2-45ba-9d82-2f5ab9bafcf1	2025-10-31 11:42:07.479	2025-10-31 11:42:07.479	admin	manage-permissions	all	Manage permission policies	t	Admin
0574da26-f98f-4484-9a54-69cf84fa9310	2025-10-31 11:42:07.481	2025-10-31 11:42:07.481	admin	configure-tenant	all	Configure tenant settings	t	Admin
c6acee5f-2fd6-4115-9ea8-bfde631cd9eb	2025-10-31 11:42:07.483	2025-10-31 11:42:07.483	admin	manage-subscriptions	all	Manage tenant subscriptions	t	Admin
78ee1373-fd24-4573-9407-f34a8383917c	2025-10-31 11:42:07.485	2025-10-31 11:42:07.485	admin	view-system-health	all	View system health and monitoring	f	Admin
384e58dc-b1e3-411a-ba8f-03d0bc77d466	2025-10-31 11:42:07.493	2025-10-31 11:42:07.493	system	manage-integrations	all	Manage RENTRI and external integrations	t	System
61d4c76f-1ce1-48c5-ad34-a323fe2c2ee5	2025-10-31 11:42:07.496	2025-10-31 11:42:07.496	system	manage-backups	all	Manage backup schedules	t	System
1d96b1d2-fe1a-4e46-a24e-9e41ff73f60e	2025-10-31 11:42:07.499	2025-10-31 11:42:07.499	system	view-logs	all	View system logs	f	System
\.


--
-- Data for Name: produttori; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.produttori (id, tenant_id, created_at, updated_at, ragione_sociale, partita_iva, via, civico, cap, comune, provincia, email, telefono, pec) FROM stdin;
\.


--
-- Data for Name: resource_ownership; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.resource_ownership (id, created_at, "resourceType", resource_id, owner_user_id, facility_id) FROM stdin;
\.


--
-- Data for Name: role_change_history; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.role_change_history (id, tenant_id, role_id, created_at, "entityType", entity_id, change_type, changed_by, old_value, new_value, reason, "timestamp") FROM stdin;
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.role_permissions (role_id, permission_id, granted_at, granted_by) FROM stdin;
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.roles (id, tenant_id, created_at, updated_at, name, description, is_system_role, created_by) FROM stdin;
\.


--
-- Data for Name: temporary_permission_grants; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.temporary_permission_grants (id, user_id, tenant_id, created_at, updated_at, permissions, start_time, end_time, granted_by, business_justification, auto_revoked, revoked_at) FROM stdin;
\.


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.tenants (id, created_at, updated_at, partita_iva, ragione_sociale, pec, address, city, province, postal_code, country, subscription_tier, subscription_status, subscription_start, subscription_end, fir_limit_per_month, user_limit_total) FROM stdin;
\.


--
-- Data for Name: trasportatori; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.trasportatori (id, tenant_id, created_at, updated_at, ragione_sociale, partita_iva, numero_iscrizione, via, civico, cap, comune, provincia, email, telefono, pec) FROM stdin;
\.


--
-- Data for Name: user_role_assignments; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.user_role_assignments (id, user_id, role_id, tenant_id, created_at, updated_at, assigned_by, assigned_at, expires_at, facility_ids, is_delegated, delegation_reason) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: wasteflow
--

COPY public.users (id, tenant_id, created_at, updated_at, keycloak_id, fiscal_code, first_name, last_name, email, phone, role, notification_preferences, signature_certificate, signature_certificate_hash, signature_valid_until) FROM stdin;
\.


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: backup_histories backup_histories_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.backup_histories
    ADD CONSTRAINT backup_histories_pkey PRIMARY KEY (id);


--
-- Name: backup_schedules backup_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.backup_schedules
    ADD CONSTRAINT backup_schedules_pkey PRIMARY KEY (id);


--
-- Name: cer_codes cer_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.cer_codes
    ADD CONSTRAINT cer_codes_pkey PRIMARY KEY (id);


--
-- Name: company_templates company_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.company_templates
    ADD CONSTRAINT company_templates_pkey PRIMARY KEY (id);


--
-- Name: consultant_tenant_associations consultant_tenant_associations_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.consultant_tenant_associations
    ADD CONSTRAINT consultant_tenant_associations_pkey PRIMARY KEY (id);


--
-- Name: destinatari destinatari_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.destinatari
    ADD CONSTRAINT destinatari_pkey PRIMARY KEY (id);


--
-- Name: fir_signatures fir_signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.fir_signatures
    ADD CONSTRAINT fir_signatures_pkey PRIMARY KEY (id);


--
-- Name: firs firs_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.firs
    ADD CONSTRAINT firs_pkey PRIMARY KEY (id);


--
-- Name: mud_reports mud_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.mud_reports
    ADD CONSTRAINT mud_reports_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: permission_audit_logs permission_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.permission_audit_logs
    ADD CONSTRAINT permission_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: permission_policies permission_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.permission_policies
    ADD CONSTRAINT permission_policies_pkey PRIMARY KEY (id);


--
-- Name: permission_requests permission_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.permission_requests
    ADD CONSTRAINT permission_requests_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: produttori produttori_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.produttori
    ADD CONSTRAINT produttori_pkey PRIMARY KEY (id);


--
-- Name: resource_ownership resource_ownership_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.resource_ownership
    ADD CONSTRAINT resource_ownership_pkey PRIMARY KEY (id);


--
-- Name: role_change_history role_change_history_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.role_change_history
    ADD CONSTRAINT role_change_history_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: temporary_permission_grants temporary_permission_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.temporary_permission_grants
    ADD CONSTRAINT temporary_permission_grants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: trasportatori trasportatori_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.trasportatori
    ADD CONSTRAINT trasportatori_pkey PRIMARY KEY (id);


--
-- Name: user_role_assignments user_role_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: activity_logs_correlation_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX activity_logs_correlation_id_idx ON public.activity_logs USING btree (correlation_id);


--
-- Name: activity_logs_created_at_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX activity_logs_created_at_idx ON public.activity_logs USING btree (created_at);


--
-- Name: activity_logs_fir_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX activity_logs_fir_id_idx ON public.activity_logs USING btree (fir_id);


--
-- Name: activity_logs_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX activity_logs_tenant_id_idx ON public.activity_logs USING btree (tenant_id);


--
-- Name: activity_logs_user_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX activity_logs_user_id_idx ON public.activity_logs USING btree (user_id);


--
-- Name: backup_histories_created_at_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX backup_histories_created_at_idx ON public.backup_histories USING btree (created_at);


--
-- Name: backup_histories_schedule_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX backup_histories_schedule_id_idx ON public.backup_histories USING btree (schedule_id);


--
-- Name: backup_histories_status_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX backup_histories_status_idx ON public.backup_histories USING btree (status);


--
-- Name: cer_codes_category_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX cer_codes_category_idx ON public.cer_codes USING btree (category);


--
-- Name: cer_codes_code_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX cer_codes_code_idx ON public.cer_codes USING btree (code);


--
-- Name: cer_codes_code_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX cer_codes_code_key ON public.cer_codes USING btree (code);


--
-- Name: company_templates_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX company_templates_tenant_id_idx ON public.company_templates USING btree (tenant_id);


--
-- Name: company_templates_tenant_id_is_default_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX company_templates_tenant_id_is_default_idx ON public.company_templates USING btree (tenant_id, is_default);


--
-- Name: consultant_tenant_associations_consultant_user_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX consultant_tenant_associations_consultant_user_id_idx ON public.consultant_tenant_associations USING btree (consultant_user_id);


--
-- Name: consultant_tenant_associations_consultant_user_id_tenant_id_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX consultant_tenant_associations_consultant_user_id_tenant_id_key ON public.consultant_tenant_associations USING btree (consultant_user_id, tenant_id);


--
-- Name: consultant_tenant_associations_is_active_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX consultant_tenant_associations_is_active_idx ON public.consultant_tenant_associations USING btree (is_active);


--
-- Name: consultant_tenant_associations_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX consultant_tenant_associations_tenant_id_idx ON public.consultant_tenant_associations USING btree (tenant_id);


--
-- Name: destinatari_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX destinatari_tenant_id_idx ON public.destinatari USING btree (tenant_id);


--
-- Name: destinatari_tenant_id_partita_iva_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX destinatari_tenant_id_partita_iva_key ON public.destinatari USING btree (tenant_id, partita_iva);


--
-- Name: fir_signatures_fir_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX fir_signatures_fir_id_idx ON public.fir_signatures USING btree (fir_id);


--
-- Name: fir_signatures_user_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX fir_signatures_user_id_idx ON public.fir_signatures USING btree (user_id);


--
-- Name: firs_cer_code_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX firs_cer_code_idx ON public.firs USING btree (cer_code);


--
-- Name: firs_rentri_sync_status_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX firs_rentri_sync_status_idx ON public.firs USING btree (rentri_sync_status);


--
-- Name: firs_status_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX firs_status_idx ON public.firs USING btree (status);


--
-- Name: firs_tenant_id_fir_number_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX firs_tenant_id_fir_number_key ON public.firs USING btree (tenant_id, fir_number);


--
-- Name: firs_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX firs_tenant_id_idx ON public.firs USING btree (tenant_id);


--
-- Name: firs_transport_date_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX firs_transport_date_idx ON public.firs USING btree (transport_date);


--
-- Name: mud_reports_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX mud_reports_tenant_id_idx ON public.mud_reports USING btree (tenant_id);


--
-- Name: mud_reports_tenant_id_year_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX mud_reports_tenant_id_year_key ON public.mud_reports USING btree (tenant_id, year);


--
-- Name: notifications_is_read_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX notifications_is_read_idx ON public.notifications USING btree (is_read);


--
-- Name: notifications_tenant_id_user_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX notifications_tenant_id_user_id_idx ON public.notifications USING btree (tenant_id, user_id);


--
-- Name: permission_audit_logs_decision_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permission_audit_logs_decision_idx ON public.permission_audit_logs USING btree (decision);


--
-- Name: permission_audit_logs_resource_type_resource_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permission_audit_logs_resource_type_resource_id_idx ON public.permission_audit_logs USING btree (resource_type, resource_id);


--
-- Name: permission_audit_logs_tenant_id_user_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permission_audit_logs_tenant_id_user_id_idx ON public.permission_audit_logs USING btree (tenant_id, user_id);


--
-- Name: permission_audit_logs_timestamp_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permission_audit_logs_timestamp_idx ON public.permission_audit_logs USING btree ("timestamp");


--
-- Name: permission_policies_is_active_evaluation_order_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permission_policies_is_active_evaluation_order_idx ON public.permission_policies USING btree (is_active, evaluation_order);


--
-- Name: permission_policies_permission_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permission_policies_permission_id_idx ON public.permission_policies USING btree (permission_id);


--
-- Name: permission_requests_status_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permission_requests_status_idx ON public.permission_requests USING btree (status);


--
-- Name: permission_requests_user_id_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permission_requests_user_id_tenant_id_idx ON public.permission_requests USING btree (user_id, tenant_id);


--
-- Name: permissions_module_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permissions_module_idx ON public.permissions USING btree (module);


--
-- Name: permissions_resource_action_scope_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX permissions_resource_action_scope_key ON public.permissions USING btree (resource, action, scope);


--
-- Name: permissions_resource_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX permissions_resource_idx ON public.permissions USING btree (resource);


--
-- Name: produttori_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX produttori_tenant_id_idx ON public.produttori USING btree (tenant_id);


--
-- Name: produttori_tenant_id_partita_iva_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX produttori_tenant_id_partita_iva_key ON public.produttori USING btree (tenant_id, partita_iva);


--
-- Name: resource_ownership_facility_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX resource_ownership_facility_id_idx ON public.resource_ownership USING btree (facility_id);


--
-- Name: resource_ownership_owner_user_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX resource_ownership_owner_user_id_idx ON public.resource_ownership USING btree (owner_user_id);


--
-- Name: resource_ownership_resourceType_resource_id_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX "resource_ownership_resourceType_resource_id_key" ON public.resource_ownership USING btree ("resourceType", resource_id);


--
-- Name: role_change_history_entityType_entity_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX "role_change_history_entityType_entity_id_idx" ON public.role_change_history USING btree ("entityType", entity_id);


--
-- Name: role_change_history_role_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX role_change_history_role_id_idx ON public.role_change_history USING btree (role_id);


--
-- Name: role_change_history_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX role_change_history_tenant_id_idx ON public.role_change_history USING btree (tenant_id);


--
-- Name: role_change_history_timestamp_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX role_change_history_timestamp_idx ON public.role_change_history USING btree ("timestamp");


--
-- Name: role_permissions_permission_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX role_permissions_permission_id_idx ON public.role_permissions USING btree (permission_id);


--
-- Name: role_permissions_role_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX role_permissions_role_id_idx ON public.role_permissions USING btree (role_id);


--
-- Name: roles_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX roles_tenant_id_idx ON public.roles USING btree (tenant_id);


--
-- Name: roles_tenant_id_is_system_role_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX roles_tenant_id_is_system_role_idx ON public.roles USING btree (tenant_id, is_system_role);


--
-- Name: roles_tenant_id_name_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX roles_tenant_id_name_key ON public.roles USING btree (tenant_id, name);


--
-- Name: temporary_permission_grants_end_time_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX temporary_permission_grants_end_time_idx ON public.temporary_permission_grants USING btree (end_time);


--
-- Name: temporary_permission_grants_user_id_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX temporary_permission_grants_user_id_tenant_id_idx ON public.temporary_permission_grants USING btree (user_id, tenant_id);


--
-- Name: tenants_partita_iva_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX tenants_partita_iva_key ON public.tenants USING btree (partita_iva);


--
-- Name: trasportatori_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX trasportatori_tenant_id_idx ON public.trasportatori USING btree (tenant_id);


--
-- Name: trasportatori_tenant_id_partita_iva_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX trasportatori_tenant_id_partita_iva_key ON public.trasportatori USING btree (tenant_id, partita_iva);


--
-- Name: user_role_assignments_role_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX user_role_assignments_role_id_idx ON public.user_role_assignments USING btree (role_id);


--
-- Name: user_role_assignments_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX user_role_assignments_tenant_id_idx ON public.user_role_assignments USING btree (tenant_id);


--
-- Name: user_role_assignments_user_id_role_id_tenant_id_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX user_role_assignments_user_id_role_id_tenant_id_key ON public.user_role_assignments USING btree (user_id, role_id, tenant_id);


--
-- Name: user_role_assignments_user_id_tenant_id_expires_at_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX user_role_assignments_user_id_tenant_id_expires_at_idx ON public.user_role_assignments USING btree (user_id, tenant_id, expires_at);


--
-- Name: users_keycloak_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX users_keycloak_id_idx ON public.users USING btree (keycloak_id);


--
-- Name: users_keycloak_id_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX users_keycloak_id_key ON public.users USING btree (keycloak_id);


--
-- Name: users_tenant_id_fiscal_code_key; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE UNIQUE INDEX users_tenant_id_fiscal_code_key ON public.users USING btree (tenant_id, fiscal_code);


--
-- Name: users_tenant_id_idx; Type: INDEX; Schema: public; Owner: wasteflow
--

CREATE INDEX users_tenant_id_idx ON public.users USING btree (tenant_id);


--
-- Name: activity_logs activity_logs_fir_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_fir_id_fkey FOREIGN KEY (fir_id) REFERENCES public.firs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: backup_histories backup_histories_executed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.backup_histories
    ADD CONSTRAINT backup_histories_executed_by_fkey FOREIGN KEY (executed_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: backup_histories backup_histories_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.backup_histories
    ADD CONSTRAINT backup_histories_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.backup_schedules(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: backup_schedules backup_schedules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.backup_schedules
    ADD CONSTRAINT backup_schedules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: company_templates company_templates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.company_templates
    ADD CONSTRAINT company_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: consultant_tenant_associations consultant_tenant_associations_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.consultant_tenant_associations
    ADD CONSTRAINT consultant_tenant_associations_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: destinatari destinatari_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.destinatari
    ADD CONSTRAINT destinatari_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fir_signatures fir_signatures_fir_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.fir_signatures
    ADD CONSTRAINT fir_signatures_fir_id_fkey FOREIGN KEY (fir_id) REFERENCES public.firs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: fir_signatures fir_signatures_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.fir_signatures
    ADD CONSTRAINT fir_signatures_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: firs firs_carrier_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.firs
    ADD CONSTRAINT firs_carrier_user_id_fkey FOREIGN KEY (carrier_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: firs firs_producer_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.firs
    ADD CONSTRAINT firs_producer_user_id_fkey FOREIGN KEY (producer_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: firs firs_receiver_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.firs
    ADD CONSTRAINT firs_receiver_user_id_fkey FOREIGN KEY (receiver_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: firs firs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.firs
    ADD CONSTRAINT firs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: mud_reports mud_reports_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.mud_reports
    ADD CONSTRAINT mud_reports_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: permission_policies permission_policies_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.permission_policies
    ADD CONSTRAINT permission_policies_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: permission_requests permission_requests_requested_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.permission_requests
    ADD CONSTRAINT permission_requests_requested_role_id_fkey FOREIGN KEY (requested_role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: produttori produttori_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.produttori
    ADD CONSTRAINT produttori_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: role_change_history role_change_history_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.role_change_history
    ADD CONSTRAINT role_change_history_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: trasportatori trasportatori_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.trasportatori
    ADD CONSTRAINT trasportatori_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_role_assignments user_role_assignments_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.user_role_assignments
    ADD CONSTRAINT user_role_assignments_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: wasteflow
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: wasteflow
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict 9nVOlY7XOUAGDrIoZhvgmyBAfN41oj4hA17dnabNGjAUfYtXeUackg8xCULSCHF

