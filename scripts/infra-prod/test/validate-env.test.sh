#!/usr/bin/env bash
# Test di validate-env.sh: un .env valido passa, ogni difetto noto lo fa fallire.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
F="$T/env"; fail=0
h() { openssl rand -hex 16 2>/dev/null || echo 0123456789abcdef0123456789abcdef; }
base() { cat <<E
TAG=sha-1a2b3c4
DB_PASSWORD=$(h)
REDIS_PASSWORD=$(h)
DB_APP_USER=wasteflow_app
DB_APP_PASSWORD=$(h)
DB_SISTEMA_PASSWORD=$(h)
JWT_SECRET=$(h)$(h)
JWT_REFRESH_SECRET=$(h)$(h)
PERMISSION_CACHE_HMAC_SECRET=$(h)$(h)
METRICS_TOKEN=$(h)$(h)
DB_NAME=wasteflow_prod
DB_USER=wasteflow
DATABASE_NAME=wasteflow_prod
DATABASE_USER=wasteflow
RENTRI_CREDENTIAL_ENC_KEY=$(h)$(h)
SIGNATURE_PROVIDER=sandbox
TSA_PROVIDER=mock
ALLOWED_ORIGINS=https://app.example.org,https://auth.example.org
FRONTEND_URL=https://app.example.org
PUBLIC_URL=https://app.example.org
KEYCLOAK_URL=https://auth.example.org
KEYCLOAK_REALM=rifiuti
KEYCLOAK_CLIENT_SECRET=s3gretoS3gretoS3greto
SPID_IDP_ENTRY_POINT=https://auth.example.org/realms/rifiuti/protocol/saml
SPID_CALLBACK_URL=https://app.example.org/api/v1/auth/spid/callback
SPID_IDP_CERT=MIIC
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
SMTP_USER=a@example.org
SMTP_PASSWORD=pwd
EMAIL_FROM=a@example.org
ACCESS_REQUEST_NOTIFY_EMAIL=b@example.org
E
}
prova() { # nome atteso(0|1) [filtro sed]
  base > "$F"; chmod 600 "$F"
  [ -n "${3:-}" ] && sed -i -E "$3" "$F"
  bash "$DIR/validate-env.sh" "$F" >/dev/null 2>&1; rc=$?
  if [ "$rc" -ne "$2" ]; then echo "FALLITO: $1 (uscita $rc, attesa $2)"; fail=1; else echo "ok: $1"; fi
}
prova "valido" 0
prova "manca JWT_SECRET" 1 '/^JWT_SECRET=/d'
prova "segnaposto" 1 's/^DB_PASSWORD=.*/DB_PASSWORD=CAMBIA_openssl_rand_hex_32/'
prova "TAG latest" 1 's/^TAG=.*/TAG=latest/'
prova "ruoli DB a meta" 1 '/^DB_SISTEMA_PASSWORD=/d'
prova "realm ignicraft" 1 's/^KEYCLOAK_REALM=.*/KEYCLOAK_REALM=ignicraft/'
prova "URL http" 1 's#^PUBLIC_URL=.*#PUBLIC_URL=http://x#'
prova "password con carattere vietato" 1 's/^REDIS_PASSWORD=.*/REDIS_PASSWORD=abc@def@ghi@jkl@mno/'
prova "Keycloak di sviluppo in KEYCLOAK_URL" 1 's#^KEYCLOAK_URL=.*#KEYCLOAK_URL=https://auth.ignicraft.com#'
prova "realm ignicraft nell'URL SAML" 1 's#^SPID_IDP_ENTRY_POINT=.*#SPID_IDP_ENTRY_POINT=https://auth.example.org/realms/ignicraft/protocol/saml#'
prova "URL SAML su un altro server" 1 's#^SPID_IDP_ENTRY_POINT=.*#SPID_IDP_ENTRY_POINT=https://altro.example.org/realms/rifiuti/protocol/saml#'
prova "CORS con asterisco" 1 's#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=*,https://app.example.org,https://auth.example.org#'
prova "CORS senza il Keycloak" 1 's#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=https://app.example.org#'
prova "CORS http" 1 's#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=http://app.example.org,https://auth.example.org#'
prova "segreti uguali" 1 's/^JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=aabbccddeeff00112233445566778899/;s/^JWT_SECRET=.*/JWT_SECRET=aabbccddeeff00112233445566778899/'
prova "segreto di 32 'a'" 1 's/^JWT_SECRET=.*/JWT_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'
prova "KEYCLOAK_CLIENT_SECRET corto" 1 's/^KEYCLOAK_CLIENT_SECRET=.*/KEYCLOAK_CLIENT_SECRET=x/'
prova "METRICS_TOKEN mancante" 1 '/^METRICS_TOKEN=/d'
prova "DB_USER diverso da DATABASE_USER" 1 's/^DB_USER=.*/DB_USER=altro/'
prova "TAG sha-0000000" 1 's/^TAG=.*/TAG=sha-0000000/'
prova "EMAIL_FROM con nome e angolari e' valido" 0 's/^EMAIL_FROM=.*/EMAIL_FROM=WasteFlow <noreply@example.org>/'
prova "segnaposto <dominio" 1 's#^PUBLIC_URL=.*#PUBLIC_URL=https://<dominio-app>#'
base > "$F"; chmod 644 "$F"; bash "$DIR/validate-env.sh" "$F" >/dev/null 2>&1 && { echo "FALLITO: permessi 644"; fail=1; } || echo "ok: permessi 644"
exit $fail
