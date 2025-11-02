#!/bin/bash

set -e

echo "=== WasteFlow Keycloak Realm Setup ==="
echo ""

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"

echo "Waiting for Keycloak to be ready..."
until curl -sf "$KEYCLOAK_URL/health/ready" > /dev/null; do
  echo "Keycloak is unavailable - sleeping"
  sleep 5
done

echo "Keycloak is ready!"
echo ""

# Get admin access token
echo "Getting admin access token..."
TOKEN=$(curl -s -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$ADMIN_USER" \
  -d "password=$ADMIN_PASSWORD" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get access token"
  exit 1
fi

echo "Access token obtained!"
echo ""

# Create WasteFlow realm
echo "Creating wasteflow realm..."
curl -s -X POST "$KEYCLOAK_URL/admin/realms" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "realm": "wasteflow",
    "enabled": true,
    "displayName": "WasteFlow",
    "displayNameHtml": "<strong>WasteFlow</strong> - Italian Waste Management",
    "sslRequired": "external",
    "registrationAllowed": false,
    "loginWithEmailAllowed": true,
    "duplicateEmailsAllowed": false,
    "resetPasswordAllowed": true,
    "editUsernameAllowed": false,
    "bruteForceProtected": true
  }' || echo "Realm may already exist"

echo "Realm created!"
echo ""

# Create backend client
echo "Creating wasteflow-backend client..."
curl -s -X POST "$KEYCLOAK_URL/admin/realms/wasteflow/clients" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "wasteflow-backend",
    "name": "WasteFlow Backend API",
    "enabled": true,
    "protocol": "openid-connect",
    "publicClient": false,
    "standardFlowEnabled": true,
    "directAccessGrantsEnabled": true,
    "serviceAccountsEnabled": true,
    "redirectUris": ["http://localhost:3000/*"],
    "webOrigins": ["http://localhost:3000"],
    "attributes": {
      "saml.assertion.signature": "false",
      "saml.client.signature": "false"
    }
  }' || echo "Backend client may already exist"

echo "Backend client created!"
echo ""

# Create frontend client
echo "Creating wasteflow-frontend client..."
curl -s -X POST "$KEYCLOAK_URL/admin/realms/wasteflow/clients" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "wasteflow-frontend",
    "name": "WasteFlow Frontend SPA",
    "enabled": true,
    "protocol": "openid-connect",
    "publicClient": true,
    "standardFlowEnabled": true,
    "implicitFlowEnabled": false,
    "directAccessGrantsEnabled": false,
    "redirectUris": ["http://localhost:4200/*"],
    "webOrigins": ["http://localhost:4200"],
    "attributes": {
      "pkce.code.challenge.method": "S256"
    }
  }' || echo "Frontend client may already exist"

echo "Frontend client created!"
echo ""

# Create demo user
echo "Creating demo user..."
curl -s -X POST "$KEYCLOAK_URL/admin/realms/wasteflow/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "RSSMRA80A01H501U",
    "email": "demo@wasteflow.it",
    "firstName": "Mario",
    "lastName": "Rossi",
    "enabled": true,
    "emailVerified": true,
    "attributes": {
      "fiscalNumber": ["RSSMRA80A01H501U"],
      "spidLevel": ["2"]
    }
  }' || echo "Demo user may already exist"

# Get user ID
USER_ID=$(curl -s -X GET "$KEYCLOAK_URL/admin/realms/wasteflow/users?username=RSSMRA80A01H501U" \
  -H "Authorization: Bearer $TOKEN" \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$USER_ID" ]; then
  echo "Setting demo user password..."
  curl -s -X PUT "$KEYCLOAK_URL/admin/realms/wasteflow/users/$USER_ID/reset-password" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "type": "password",
      "value": "Demo123!",
      "temporary": false
    }'
  echo "Password set!"
fi

echo ""
echo "=== Keycloak Realm Setup Complete! ==="
echo ""
echo "Access Keycloak at: $KEYCLOAK_URL"
echo "Admin credentials: admin / admin"
echo "Demo user: RSSMRA80A01H501U / Demo123!"
echo ""
