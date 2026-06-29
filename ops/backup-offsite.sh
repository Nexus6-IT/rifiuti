#!/usr/bin/env bash
# ==============================================================================
# ops/backup-offsite.sh — Backup PostgreSQL off-site per WasteFlow
# ==============================================================================
# Eseguire sul VPS come root DOPO aver impostato le variabili d'ambiente.
# Scarica un dump gzip del DB Postgres, lo cifra con age/gpg (opzionale) e lo
# copia su una destinazione remota via rsync+SSH o rclone (S3/Cloudflare R2).
#
# REQUISITI sul VPS:
#   - docker compose -p rifiuti avviato (servizio postgres attivo)
#   - rsync installato (apt install rsync) O rclone configurato
#   - Variabili d'ambiente impostate nel file /opt/rifiuti/.env o esportate
#
# USO MANUALE:
#   source /opt/rifiuti/.env && bash /opt/rifiuti/ops/backup-offsite.sh
#
# CRON SUGGERITO (ogni notte alle 03:30, rotazione 30 gg):
#   30 3 * * * root source /opt/rifiuti/.env && bash /opt/rifiuti/ops/backup-offsite.sh >> /var/log/wasteflow-backup.log 2>&1
# ==============================================================================

set -euo pipefail

# ---- Configurazione -----------------------------------------------------------
DB_NAME="${DB_NAME:-wasteflow_prod}"
DB_USER="${DB_USER:-wasteflow}"
DB_PASSWORD="${DB_PASSWORD:?Imposta DB_PASSWORD}"
COMPOSE_PROJECT="rifiuti"
COMPOSE_FILE="/opt/rifiuti/docker-compose.prod.yml"
ENV_FILE="/opt/rifiuti/.env"

# Directory locale di staging (temporanea sul VPS)
BACKUP_STAGING_DIR="/opt/rifiuti/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Destinazione off-site: scegli UNA delle seguenti modalità
OFFSITE_MODE="${OFFSITE_MODE:-rsync}"  # rsync | rclone | disabled

# --- rsync: copia su server SSH remoto
RSYNC_TARGET="${RSYNC_TARGET:-}"  # es. backup@remote.host:/backups/wasteflow/
RSYNC_SSH_KEY="${RSYNC_SSH_KEY:-/root/.ssh/id_ed25519_backup}"

# --- rclone: S3 / Cloudflare R2 / altro provider
RCLONE_REMOTE="${RCLONE_REMOTE:-}"    # es. r2:wasteflow-backups
# rclone deve essere configurato con `rclone config` prima dell'uso

# Cifratura opzionale con age (https://age-encryption.org/)
ENCRYPT_BACKUP="${ENCRYPT_BACKUP:-false}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"    # chiave pubblica age del destinatario

# ---- Funzioni ----------------------------------------------------------------
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "ERRORE: $*"; exit 1; }

# ---- Inizio ------------------------------------------------------------------
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_FILE="wasteflow_${DB_NAME}_${TIMESTAMP}.sql.gz"
STAGING_PATH="${BACKUP_STAGING_DIR}/${BACKUP_FILE}"

mkdir -p "${BACKUP_STAGING_DIR}"

log "Avvio backup DB '${DB_NAME}' (progetto compose: ${COMPOSE_PROJECT})"

# Dump PostgreSQL tramite docker compose exec (senza esporre la porta sul VPS)
docker compose -p "${COMPOSE_PROJECT}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  exec -T postgres \
  pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${STAGING_PATH}"

BACKUP_SIZE=$(du -sh "${STAGING_PATH}" | cut -f1)
log "Dump completato: ${STAGING_PATH} (${BACKUP_SIZE})"

# Cifratura opzionale con age
UPLOAD_FILE="${STAGING_PATH}"
if [[ "${ENCRYPT_BACKUP}" == "true" ]]; then
  [[ -z "${AGE_RECIPIENT}" ]] && die "AGE_RECIPIENT non impostato ma ENCRYPT_BACKUP=true"
  command -v age >/dev/null 2>&1 || die "age non trovato (apt install age)"
  AGE_FILE="${STAGING_PATH}.age"
  age -r "${AGE_RECIPIENT}" -o "${AGE_FILE}" "${STAGING_PATH}"
  rm -f "${STAGING_PATH}"
  UPLOAD_FILE="${AGE_FILE}"
  log "Backup cifrato: ${AGE_FILE}"
fi

# Copia off-site
case "${OFFSITE_MODE}" in
  rsync)
    [[ -z "${RSYNC_TARGET}" ]] && die "RSYNC_TARGET non impostato"
    log "Invio via rsync a ${RSYNC_TARGET}"
    rsync -az --no-perms \
      -e "ssh -i ${RSYNC_SSH_KEY} -o StrictHostKeyChecking=accept-new" \
      "${UPLOAD_FILE}" "${RSYNC_TARGET}"
    log "rsync completato"
    ;;
  rclone)
    [[ -z "${RCLONE_REMOTE}" ]] && die "RCLONE_REMOTE non impostato"
    command -v rclone >/dev/null 2>&1 || die "rclone non trovato"
    log "Invio via rclone a ${RCLONE_REMOTE}"
    rclone copy "${UPLOAD_FILE}" "${RCLONE_REMOTE}"
    log "rclone completato"
    ;;
  disabled)
    log "Copia off-site disabilitata (OFFSITE_MODE=disabled). Il backup è solo locale."
    ;;
  *)
    die "OFFSITE_MODE '${OFFSITE_MODE}' non valido (rsync|rclone|disabled)"
    ;;
esac

# Rotazione locale: elimina backup più vecchi di RETENTION_DAYS giorni
log "Rotazione backup locali (retention: ${RETENTION_DAYS} giorni)"
find "${BACKUP_STAGING_DIR}" \
  -name "wasteflow_${DB_NAME}_*.sql.gz*" \
  -mtime "+${RETENTION_DAYS}" \
  -delete

log "Backup off-site completato con successo."
