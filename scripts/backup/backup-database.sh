#!/usr/bin/env bash
# ==============================================================================
# scripts/backup/backup-database.sh — backup PostgreSQL di rifiuti sul server infra-prod
# ------------------------------------------------------------------------------
# Sottile adattatore di ops/backup-offsite.sh (dump verificato col marcatore finale e,
# di notte, ripristino di prova in un database temporaneo). Lo lancia il cron di
# infra-prod tramite infra-backup-run (<app>/database, <app>/database-weekly), che
# imposta STACK_DIR, CODE_DIR, ENV_FILE, COMPOSE_FILE e COMPOSE_PROJECT.
#
#   bash scripts/backup/backup-database.sh              # serie giornaliera: <root>/backups/postgres, 30 gg
#   SERIE=postgres-weekly RETENTION_DAYS=84 bash ...     # serie settimanale
#
# Non copia fuori dal server (OFFSITE_MODE=disabled): la copia cifrata e' di sync-offsite.sh.
# Esce con codice != 0 a ogni anomalia: il wrapper manda l'avviso critico.
# ==============================================================================
set -euo pipefail

STACK_DIR="${STACK_DIR:?STACK_DIR non impostata (va lanciato dal cron di infra-backup-rifiuti)}"
CODE_DIR="${CODE_DIR:-$STACK_DIR/site}"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-$CODE_DIR/docker-compose.infra-prod.yml}"
SERIE="${SERIE:-postgres}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-rifiuti-postgres-prod}"

export BACKUP_MODALITA=notturno
export BACKUP_STAGING_DIR="$STACK_DIR/backups/$SERIE"
export BACKUP_RETENTION_DAYS="${RETENTION_DAYS:-30}"
export WASTEFLOW_ENV_FILE="$ENV_FILE"
export WASTEFLOW_COMPOSE_FILE="$COMPOSE_FILE"
export PG_EXEC="${PG_EXEC:-docker exec -i $POSTGRES_CONTAINER}"
export OFFSITE_MODE=disabled
export ENCRYPT_BACKUP=false

exec bash "$CODE_DIR/ops/backup-offsite.sh"
