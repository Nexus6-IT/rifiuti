#!/usr/bin/env bash
# ==============================================================================
# ops/controllo-freschezza-backup.sh — allarme se il backup non parte piu'
# ==============================================================================
# backup-offsite.sh manda la mail quando FALLISCE; se invece il cron non parte
# (job rimosso, host spento, disco pieno prima dell'avvio) nessuno scrive nulla.
# Questo controllo guarda l'eta' dell'ultimo dump verificato e scrive solo ai
# cambi di stato: OK -> GUASTO (backup fermo) e GUASTO -> OK (ripristinato).
#
# Variabili (tutte sovrascrivibili):
#   WASTEFLOW_ENV_FILE     default /opt/rifiuti/.env (DB_NAME, BACKUP_ALERT_EMAIL)
#   BACKUP_STAGING_DIR     default /opt/rifiuti/backups
#   BACKUP_FRESCHEZZA_ORE  default 26
#   BACKUP_STATO_FILE      default /var/lib/wasteflow-backup/freschezza.stato
#   BACKUP_ALERT_EMAIL     default dal .env, poi root
#   ORA_EPOCH              solo test: sostituisce "date +%s"
# Esce 0 se OK, 1 se GUASTO.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/backup-verifica.sh
source "${SCRIPT_DIR}/lib/backup-verifica.sh"

WASTEFLOW_ENV_FILE="${WASTEFLOW_ENV_FILE:-/opt/rifiuti/.env}"
BACKUP_STAGING_DIR="${BACKUP_STAGING_DIR:-/opt/rifiuti/backups}"
BACKUP_FRESCHEZZA_ORE="${BACKUP_FRESCHEZZA_ORE:-26}"
BACKUP_STATO_FILE="${BACKUP_STATO_FILE:-/var/lib/wasteflow-backup/freschezza.stato}"
DB_NAME="$(leggi_env "${WASTEFLOW_ENV_FILE}" DB_NAME wasteflow_prod)"
DB_NAME="${DB_NAME:-wasteflow_prod}"
BACKUP_ALERT_EMAIL="${BACKUP_ALERT_EMAIL:-$(leggi_env "${WASTEFLOW_ENV_FILE}" BACKUP_ALERT_EMAIL root)}"
export BACKUP_ALERT_EMAIL

[[ "${BACKUP_FRESCHEZZA_ORE}" =~ ^[0-9]+$ ]] || {
  echo "ERRORE: BACKUP_FRESCHEZZA_ORE '${BACKUP_FRESCHEZZA_ORE}' non e' un intero" >&2
  exit 2
}

ORA="${ORA_EPOCH:-$(date +%s)}"

# mtime_epoch FILE — GNU stat, con ripiego BSD.
mtime_epoch() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"
}

# Ultimo dump verificato: i glob escludono da soli predeploy, .scartato,
# .non-verificato e .parziale (nessuno finisce in .sql.gz o .sql.gz.age).
PIU_RECENTE=0
TROVATO=0
for f in "${BACKUP_STAGING_DIR}/wasteflow_${DB_NAME}_"*.sql.gz \
  "${BACKUP_STAGING_DIR}/wasteflow_${DB_NAME}_"*.sql.gz.age; do
  [ -f "$f" ] || continue
  m="$(mtime_epoch "$f")"
  if [ "$TROVATO" -eq 0 ] || [ "$m" -gt "$PIU_RECENTE" ]; then
    PIU_RECENTE="$m"
    TROVATO=1
  fi
done

STATO_PRECEDENTE="OK"
if [ -r "${BACKUP_STATO_FILE}" ]; then
  STATO_PRECEDENTE="$(head -n 1 "${BACKUP_STATO_FILE}" | tr -d '\r')"
  [ "$STATO_PRECEDENTE" = "GUASTO" ] || STATO_PRECEDENTE="OK"
fi

STATO="GUASTO"
ORE=0
if [ "$TROVATO" -eq 1 ]; then
  ETA=$((ORA - PIU_RECENTE))
  [ "$ETA" -ge 0 ] || ETA=0
  ORE=$((ETA / 3600))
  if [ "$ETA" -le $((BACKUP_FRESCHEZZA_ORE * 3600)) ]; then
    STATO="OK"
  fi
fi

if [ "$STATO" = "GUASTO" ] && [ "$STATO_PRECEDENTE" = "OK" ]; then
  if [ "$TROVATO" -eq 1 ]; then
    OGGETTO="ATTENZIONE backup WasteFlow fermo da ${ORE} ore"
    DETTAGLIO="L'ultimo dump verificato ha ${ORE} ore (soglia ${BACKUP_FRESCHEZZA_ORE})."
  else
    OGGETTO="ATTENZIONE backup WasteFlow: nessun dump verificato"
    DETTAGLIO="Non c'e' nessun dump verificato per il database ${DB_NAME}."
  fi
  notifica_fallimento "$OGGETTO" "Host: $(hostname)
Cartella: ${BACKUP_STAGING_DIR}
${DETTAGLIO}
Controllare il cron del backup (/etc/cron.d/wasteflow-backup) e /var/log/wasteflow-backup.log."
elif [ "$STATO" = "OK" ] && [ "$STATO_PRECEDENTE" = "GUASTO" ]; then
  notifica_fallimento "Backup WasteFlow di nuovo regolare" "Host: $(hostname)
L'ultimo dump verificato ha ${ORE} ore (soglia ${BACKUP_FRESCHEZZA_ORE})."
fi

mkdir -p "$(dirname "${BACKUP_STATO_FILE}")"
printf '%s\n' "$STATO" > "${BACKUP_STATO_FILE}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] freschezza backup: ${STATO} (ultimo dump: ${ORE} ore)"
[ "$STATO" = "OK" ]
