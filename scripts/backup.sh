#!/bin/bash

# WasteFlow Database Backup Script
# Runs daily via cron to backup PostgreSQL database

set -e  # Exit on error

# Configuration
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups"
BACKUP_FILE="wasteflow-backup-${DATE}.sql"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

# Database credentials (from environment)
DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-wasteflow_prod}"
DB_USER="${DB_USER:-wasteflow}"

# S3 Configuration (optional)
S3_BUCKET="${S3_BUCKET:-}"
AWS_REGION="${AWS_REGION:-eu-south-1}"

# Logging
LOG_FILE="/var/log/wasteflow-backup.log"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "${LOG_FILE}"
}

log "========================================="
log "Starting WasteFlow database backup"
log "========================================="

# Check if backup directory exists
if [ ! -d "${BACKUP_DIR}" ]; then
    log "Creating backup directory: ${BACKUP_DIR}"
    mkdir -p "${BACKUP_DIR}"
fi

# Create backup using pg_dump
log "Creating backup: ${BACKUP_FILE}"
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" \
    -F c -b -v -f "${BACKUP_PATH}" 2>&1 | tee -a "${LOG_FILE}"

# Check if backup was successful
if [ $? -eq 0 ]; then
    BACKUP_SIZE=$(du -h "${BACKUP_PATH}" | cut -f1)
    log "✓ Backup created successfully: ${BACKUP_FILE} (${BACKUP_SIZE})"
else
    log "✗ Backup failed!"
    exit 1
fi

# Upload to S3 (if configured)
if [ -n "${S3_BUCKET}" ]; then
    log "Uploading backup to S3: s3://${S3_BUCKET}/${BACKUP_FILE}"

    if command -v aws &> /dev/null; then
        aws s3 cp "${BACKUP_PATH}" "s3://${S3_BUCKET}/backups/${BACKUP_FILE}" \
            --region "${AWS_REGION}" 2>&1 | tee -a "${LOG_FILE}"

        if [ $? -eq 0 ]; then
            log "✓ Backup uploaded to S3 successfully"
        else
            log "✗ S3 upload failed (backup still available locally)"
        fi
    else
        log "⚠ AWS CLI not found, skipping S3 upload"
    fi
fi

# Cleanup old backups (keep last 30 days)
log "Cleaning up old backups (older than 30 days)..."
find "${BACKUP_DIR}" -name "wasteflow-backup-*.sql" -type f -mtime +30 -delete 2>&1 | tee -a "${LOG_FILE}"
OLD_COUNT=$(find "${BACKUP_DIR}" -name "wasteflow-backup-*.sql" -type f -mtime +30 | wc -l)
log "✓ Cleaned up ${OLD_COUNT} old backup(s)"

# Verify backup integrity
log "Verifying backup integrity..."
pg_restore --list "${BACKUP_PATH}" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    log "✓ Backup integrity verified"
else
    log "✗ Backup integrity check failed!"
    exit 1
fi

# Summary
TOTAL_BACKUPS=$(find "${BACKUP_DIR}" -name "wasteflow-backup-*.sql" -type f | wc -l)
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)

log "========================================="
log "Backup Summary:"
log "  - Total backups: ${TOTAL_BACKUPS}"
log "  - Total size: ${TOTAL_SIZE}"
log "  - Latest backup: ${BACKUP_FILE} (${BACKUP_SIZE})"
log "========================================="
log "Backup completed successfully"
log "========================================="

exit 0
