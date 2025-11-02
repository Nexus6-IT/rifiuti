-- PostgreSQL Initialization Script
-- Creates keycloak database for authentication
-- Note: wasteflow_dev is created automatically by POSTGRES_DB env var

-- Create keycloak database
CREATE DATABASE keycloak;

-- Grant all privileges to wasteflow user
GRANT ALL PRIVILEGES ON DATABASE keycloak TO wasteflow;
