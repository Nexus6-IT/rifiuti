#!/usr/bin/env bash
# ==============================================================================
# ops/restore.sh — Restore PostgreSQL per WasteFlow
# ==============================================================================
# Ripristina un dump SQL.gz (prodotto da backup-offsite.sh) nel database
# PostgreSQL del container compose. DISTRUTTIVO: sovrascrive il DB esistente.
#
# ATTENZIONE: questo script elimina e ricrea il database. Eseguire solo in un
# contesto di ripristino pianificato o di disaster recovery.
#
# USO:
#   bash /opt/rifiuti/ops/restore.sh /opt/rifiuti/backups/wasteflow_..._20260610.sql.gz
#
# Se il backup è cifrato con age, decifrarlo prima:
#   age -d -i ~/.ssh/id_ed25519_backup dump.sql.gz.age | gunzip > dump.sql
#   bash /opt/rifiuti/ops/restore.sh dump.sql   # (già decompresso)
# ==============================================================================

set -euo pipefail

# ---- Configurazione -----------------------------------------------------------
DB_NAME="${DB_NAME:-wasteflow_prod}"
DB_USER="${DB_USER:-wasteflow}"
DB_PASSWORD="${DB_PASSWORD:?Imposta DB_PASSWORD}"
COMPOSE_PROJECT="rifiuti"
COMPOSE_FILE="/opt/rifiuti/docker-compose.prod.yml"
ENV_FILE="/opt/rifiuti/.env"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "ERRORE: $*"; exit 1; }

# ---- Argomento obbligatorio ---------------------------------------------------
BACKUP_FILE="${1:-}"
[[ -z "${BACKUP_FILE}" ]] && die "Specificare il percorso del file di backup: $0 <file.sql.gz>"
[[ -f "${BACKUP_FILE}" ]] || die "File non trovato: ${BACKUP_FILE}"

# ---- Conferma interattiva (sicurezza extra) -----------------------------------
echo ""
echo "ATTENZIONE: questa operazione DISTRUGGERÀ il database '${DB_NAME}' e lo"
echo "ripristinerà dal file: ${BACKUP_FILE}"
echo ""
read -r -p "Confermare il ripristino? (digitare YES per procedere): " CONFIRM
[[ "${CONFIRM}" == "YES" ]] || { log "Ripristino annullato."; exit 0; }

# ---- Stop dell'applicazione (evita scritture durante il restore) -------------
log "Arresto del backend prima del ripristino..."
docker compose -p "${COMPOSE_PROJECT}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  stop backend || true

# ---- Drop e ricreare il database ---------------------------------------------
log "Eliminazione e ricreazione del database '${DB_NAME}'..."
docker compose -p "${COMPOSE_PROJECT}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  exec -T postgres \
  psql -U "${DB_USER}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();"

docker compose -p "${COMPOSE_PROJECT}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  exec -T postgres \
  psql -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"

docker compose -p "${COMPOSE_PROJECT}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  exec -T postgres \
  psql -U "${DB_USER}" -d postgres -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"

log "Database ricreato."

# ---- Ripristino del dump -----------------------------------------------------
log "Ripristino dump da ${BACKUP_FILE}..."

if [[ "${BACKUP_FILE}" == *.gz ]]; then
  gunzip -c "${BACKUP_FILE}" | docker compose -p "${COMPOSE_PROJECT}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    exec -T postgres \
    psql -U "${DB_USER}" -d "${DB_NAME}"
else
  # File SQL già decompresso
  docker compose -p "${COMPOSE_PROJECT}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    exec -T postgres \
    psql -U "${DB_USER}" -d "${DB_NAME}" < "${BACKUP_FILE}"
fi

log "Dump ripristinato."

# ---- Migrazione prisma (garantisce schema aggiornato post-restore) -----------
log "Esecuzione prisma migrate deploy per allineare lo schema..."
docker compose -p "${COMPOSE_PROJECT}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  run --rm backend \
  npx prisma migrate deploy || log "ATTENZIONE: prisma migrate deploy fallito — verificare manualmente."

# ---- Riavvio del backend -----------------------------------------------------
log "Avvio del backend..."
docker compose -p "${COMPOSE_PROJECT}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  start backend

log "Ripristino completato. Verificare l'applicazione su https://rifiuti.ignicraft.com"
echo ""
echo "Verifica rapida:"
echo "  curl -s https://rifiuti.ignicraft.com/api/v1/health | jq .status"
