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
#   bash /opt/rifiuti/site/ops/restore.sh /opt/rifiuti/backups/wasteflow_..._20260610.sql.gz
#
# Variabili: WASTEFLOW_ENV_FILE (default /opt/rifiuti/.env),
#            WASTEFLOW_COMPOSE_FILE (default /opt/rifiuti/site/docker-compose.prod.yml),
#            RIPRISTINO_CONFERMATO=YES salta la conferma interattiva.
#
# Se il backup è cifrato con age, decifrarlo prima:
#   age -d -i ~/.ssh/id_ed25519_backup dump.sql.gz.age | gunzip > dump.sql
#   bash /opt/rifiuti/site/ops/restore.sh dump.sql   # (già decompresso)
# ==============================================================================

set -euo pipefail

# shellcheck source=lib/backup-verifica.sh
source "$(dirname "$0")/lib/backup-verifica.sh"

# ---- Configurazione -----------------------------------------------------------
ENV_FILE="${WASTEFLOW_ENV_FILE:-/opt/rifiuti/.env}"
COMPOSE_FILE="${WASTEFLOW_COMPOSE_FILE:-/opt/rifiuti/site/docker-compose.prod.yml}"
COMPOSE_PROJECT="rifiuti"
# Il .env si legge con leggi_env (mai eseguito). Ogni "docker compose" passa
# --env-file: il compose di produzione ha variabili obbligatorie interpolate
# anche da "exec", "run" e "stop".
DB_NAME="$(leggi_env "${ENV_FILE}" DB_NAME wasteflow_prod)"
DB_USER="$(leggi_env "${ENV_FILE}" DB_USER wasteflow)"
DB_NAME="${DB_NAME:-wasteflow_prod}"
DB_USER="${DB_USER:-wasteflow}"
DC=(docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "ERRORE: $*"; exit 1; }

# ---- Argomento obbligatorio ---------------------------------------------------
BACKUP_FILE="${1:-}"
[[ -z "${BACKUP_FILE}" ]] && die "Specificare il percorso del file di backup: $0 <file.sql.gz>"
[[ -f "${BACKUP_FILE}" ]] || die "File non trovato: ${BACKUP_FILE}"

# ---- Conferma interattiva (sicurezza extra) -----------------------------------
if [[ "${RIPRISTINO_CONFERMATO:-}" != "YES" ]]; then
  echo ""
  echo "ATTENZIONE: questa operazione DISTRUGGERÀ il database '${DB_NAME}' e lo"
  echo "ripristinerà dal file: ${BACKUP_FILE}"
  echo ""
  read -r -p "Confermare il ripristino? (digitare YES per procedere): " CONFIRM
  [[ "${CONFIRM}" == "YES" ]] || { log "Ripristino annullato."; exit 0; }
fi

# ---- Stop dell'applicazione (evita scritture durante il restore) -------------
log "Arresto del backend prima del ripristino..."
"${DC[@]}" stop backend || true

# ---- Drop e ricreare il database ---------------------------------------------
log "Eliminazione e ricreazione del database '${DB_NAME}'..."
"${DC[@]}" exec -T postgres \
  psql -U "${DB_USER}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();"

"${DC[@]}" exec -T postgres \
  psql -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"

"${DC[@]}" exec -T postgres \
  psql -U "${DB_USER}" -d postgres -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"

log "Database ricreato."

# ---- Ripristino del dump -----------------------------------------------------
log "Ripristino dump da ${BACKUP_FILE}..."

if [[ "${BACKUP_FILE}" == *.gz ]]; then
  gunzip -c "${BACKUP_FILE}" | "${DC[@]}" exec -T postgres \
    psql -U "${DB_USER}" -d "${DB_NAME}"
else
  # File SQL già decompresso
  "${DC[@]}" exec -T postgres \
    psql -U "${DB_USER}" -d "${DB_NAME}" < "${BACKUP_FILE}"
fi

log "Dump ripristinato."

# ---- Migrazione prisma (garantisce schema aggiornato post-restore) -----------
log "Esecuzione prisma migrate deploy per allineare lo schema..."
"${DC[@]}" run --rm backend \
  npx prisma migrate deploy || log "ATTENZIONE: prisma migrate deploy fallito — verificare manualmente."

# ---- Riavvio del backend -----------------------------------------------------
log "Avvio del backend..."
"${DC[@]}" start backend

log "Ripristino completato. Verificare l'applicazione su https://rifiuti.ignicraft.com"
echo ""
echo "Verifica rapida:"
echo "  curl -s https://rifiuti.ignicraft.com/api/v1/health | jq .status"
