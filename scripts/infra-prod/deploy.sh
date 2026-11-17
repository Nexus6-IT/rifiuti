#!/usr/bin/env bash
# ==============================================================================
# scripts/infra-prod/deploy.sh — deploy di rifiuti sul server infra-prod
# ------------------------------------------------------------------------------
# Uso (come utente di deploy `rifiuti`, nel clone <root>/site, gia' sul commit giusto):
#   bash scripts/infra-prod/deploy.sh sha-1a2b3c4
# Lo lancia .gitea/workflows/deploy-infra-prod.yml via SSH. NON usa root e NON tocca il
# deploy verso il VPS Contabo (deploy.yml). Rollback = rilanciare con il tag precedente
# (workflow_dispatch): le migration sono forward-only, vanno scritte in modo additivo.
# Passi: validazione .env -> TAG nel .env -> pull -> postgres/redis su -> backup predeploy
#        verificato -> migration (owner) -> ruoli DB -> up -> smoke test.
# Variabili (default): STACK_DIR=/opt/rifiuti, ENV_FILE=$STACK_DIR/.env.prod
# ==============================================================================
set -euo pipefail

TAG="${1:-}"
[[ "$TAG" =~ ^sha-[0-9a-f]{7,}$ ]] || { echo "uso: deploy.sh sha-<7+ esadecimali> (mai latest)" >&2; exit 2; }

CODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="${STACK_DIR:-/opt/rifiuti}"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env.prod}"
COMPOSE_FILE="$CODE_DIR/docker-compose.infra-prod.yml"
API_PORT="${API_PORT:-3040}"
APP_PORT="${APP_PORT:-3041}"

[ "$(id -u)" -ne 0 ] || { echo "ERRORE: il deploy non si lancia come root" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERRORE: $ENV_FILE non esiste" >&2; exit 1; }

bash "$CODE_DIR/scripts/infra-prod/validate-env.sh" --primo-avvio "$ENV_FILE"

# TAG: sostituzione atomica che conserva proprietario e permessi (600).
TAG_PRECEDENTE="$(grep -E '^TAG=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
tmp="$(mktemp "$ENV_FILE.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
{ grep -vE '^TAG=' "$ENV_FILE" || true; echo "TAG=$TAG"; } > "$tmp"
chmod 600 "$tmp"; mv -f "$tmp" "$ENV_FILE"
echo "TAG $TAG_PRECEDENTE -> $TAG"

bash "$CODE_DIR/scripts/infra-prod/validate-env.sh" "$ENV_FILE"

COMPOSE=(docker compose -p rifiuti --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

# Solo le nostre immagini: postgres/redis si aggiornano con un intervento deciso, backup prima.
"${COMPOSE[@]}" pull backend frontend
"${COMPOSE[@]}" up -d --wait postgres redis

# Backup verificato prima delle migration: se fallisce, set -e ferma tutto e la produzione
# resta sulla versione precedente (dentro <root>/backups/postgres: scrivibile dall'utente di deploy).
BACKUP_MODALITA=predeploy BACKUP_STAGING_DIR="$STACK_DIR/backups/postgres" \
  WASTEFLOW_ENV_FILE="$ENV_FILE" WASTEFLOW_COMPOSE_FILE="$COMPOSE_FILE" \
  PG_EXEC="docker exec -i rifiuti-postgres-prod" bash "$CODE_DIR/ops/backup-offsite.sh"

# Migration Prisma SEMPRE come owner (DATABASE_URL_MIGRAZIONI); le virgolette singole fanno
# espandere la variabile dentro il container.
"${COMPOSE[@]}" run --rm --no-deps backend sh -c 'DATABASE_URL="$DATABASE_URL_MIGRAZIONI" npx prisma migrate deploy'

# Ruoli DB, DOPO le migration. Senza password nel .env stampa "salto"; a meta' si ferma.
RUOLI_ENV_FILE="$ENV_FILE" PG_EXEC="docker exec -i rifiuti-postgres-prod" bash "$CODE_DIR/ops/db-ruoli.sh"

"${COMPOSE[@]}" up -d --remove-orphans

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$API_PORT/api/v1/health/db" >/dev/null \
     && curl -fsS "http://127.0.0.1:$APP_PORT/" >/dev/null; then
    echo "Deploy OK (tag $TAG)"
    exit 0
  fi
  sleep 3
done
echo "Smoke test fallito dopo 30 tentativi (tag precedente: ${TAG_PRECEDENTE:-nessuno})" >&2
"${COMPOSE[@]}" ps >&2 || true
"${COMPOSE[@]}" logs --since 5m backend >&2 || true
exit 1
