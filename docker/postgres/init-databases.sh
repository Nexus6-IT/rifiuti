#!/bin/bash
set -e

# PostgreSQL Multi-Database Initialization Script
# Creates multiple databases for WasteFlow development

echo "🔧 Creating additional databases..."

# Create keycloak database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create keycloak database for authentication
    CREATE DATABASE keycloak;
    GRANT ALL PRIVILEGES ON DATABASE keycloak TO $POSTGRES_USER;
EOSQL

echo "✅ Database 'keycloak' created successfully"

echo "📊 Available databases:"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "\l"
