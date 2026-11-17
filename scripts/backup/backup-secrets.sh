#!/usr/bin/env bash
# ==============================================================================
# scripts/backup/backup-secrets.sh — copia CIFRATA (age) del file .env di produzione
# ------------------------------------------------------------------------------
# Il .env contiene RENTRI_CREDENTIAL_ENC_KEY (senza, i certificati RENTRI cifrati nel
# database non si leggono piu'), JWT_SECRET e le password dei ruoli DB. Va lanciato con
# `infra-backup-with-env` (carica il .env e imposta AGE_RECIPIENTS_FILE, entrambe le
# chiavi pubbliche). Senza destinatari si ferma: mai una copia in chiaro.
# Scrive <root>/backups/secrets/secrets-<data>.tar.age (700/600); tiene gli ultimi 400 giorni.
# ==============================================================================
set -euo pipefail
umask 077

STACK_DIR="${STACK_DIR:?STACK_DIR non impostata}"
ENV_FILE="${ENV_FILE:?ENV_FILE non impostata}"
DEST="${BACKUP_DIR:-$STACK_DIR/backups/secrets}"
RICHIEDENTI="${AGE_RECIPIENTS_FILE:-}"

command -v age >/dev/null 2>&1 || { echo "ERRORE: age non installato" >&2; exit 1; }
[ -n "$RICHIEDENTI" ] && [ -s "$RICHIEDENTI" ] || { echo "ERRORE: AGE_RECIPIENTS_FILE mancante o vuoto: nessuna copia in chiaro" >&2; exit 1; }
[ -r "$ENV_FILE" ] || { echo "ERRORE: $ENV_FILE non leggibile" >&2; exit 1; }

mkdir -p "$DEST"
out="$DEST/secrets-$(date +%Y%m%d_%H%M%S).tar.age"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT
tar -C "$(dirname "$ENV_FILE")" -cf - "$(basename "$ENV_FILE")" | age -R "$RICHIEDENTI" -o "$tmp"
[ -s "$tmp" ] && head -c 22 "$tmp" | grep -q 'age-encryption.org' || { echo "ERRORE: file cifrato non valido" >&2; exit 1; }
mv -f "$tmp" "$out"
find "$DEST" -name 'secrets-*.tar.age' -mtime +400 -delete
echo "[$(date '+%F %T')] segreti cifrati: $out"
