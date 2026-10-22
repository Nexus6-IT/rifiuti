#!/usr/bin/env bash
# ==============================================================================
# ops/backup-offsite.sh — Backup PostgreSQL verificato per WasteFlow
# ==============================================================================
# Produce un dump gzip del database, lo ACCETTA solo se e' completo (marcatore
# finale di pg_dump) e, di notte, solo se un ripristino di prova in un database
# temporaneo riesce. Poi cifra (opzionale) e copia off-site. Se qualcosa non va,
# di notte parte una mail a root (inoltrata a Gmail da /etc/aliases).
#
# Stati dei file in BACKUP_STAGING_DIR:
#   *.sql.gz.parziale       dump in corso (o interrotto)
#   *.sql.gz.scartato       dump incompleto o con ripristino di prova fallito
#   *.sql.gz.non-verificato dump completo ma senza spazio per il ripristino di prova
#   *.sql.gz                dump verificato (nome finale)
#
# Variabili (ambiente, altrimenti valori del file .env letto SENZA eseguirlo):
#   BACKUP_MODALITA=notturno|predeploy   (default notturno)
#   WASTEFLOW_ENV_FILE                   (default /opt/rifiuti/.env)
#   WASTEFLOW_COMPOSE_FILE               (default /opt/rifiuti/site/docker-compose.prod.yml)
#   BACKUP_STAGING_DIR                   (default /opt/rifiuti/backups)
#   PG_EXEC                              prefisso di comando per raggiungere Postgres
#   BACKUP_DATI_DIR                      (default /var/lib/docker) dove vive il database
#   BACKUP_FATTORE_SPAZIO_DUMP (2), BACKUP_FATTORE_SPAZIO_RIPRISTINO (3)
#   OFFSITE_MODE (rsync|rclone|disabled), RSYNC_TARGET, RSYNC_SSH_KEY, RCLONE_REMOTE,
#   ENCRYPT_BACKUP, AGE_RECIPIENT, BACKUP_RETENTION_DAYS, BACKUP_ALERT_EMAIL
#
# USO MANUALE:
#   bash /opt/rifiuti/site/ops/backup-offsite.sh
#
# CRON (ogni notte alle 03:30, nessun "source" del .env):
#   (OFFSITE_MODE si legge dal .env, default disabled: non metterlo nella riga cron)
#   30 3 * * * root bash /opt/rifiuti/site/ops/backup-offsite.sh >> /var/log/wasteflow-backup.log 2>&1
#
# Prima di un deploy: BACKUP_MODALITA=predeploy (niente restore di prova, niente
# mail, niente copia off-site: l'esito lo segnala il job di deploy).
# ==============================================================================

set -euo pipefail
# I dump contengono dati personali: file e cartelle creati solo per il proprietario.
umask 077

# shellcheck source=lib/backup-verifica.sh
source "$(dirname "$0")/lib/backup-verifica.sh"

# ---- Configurazione -----------------------------------------------------------
BACKUP_MODALITA="${BACKUP_MODALITA:-notturno}"
case "${BACKUP_MODALITA}" in
  notturno|predeploy) ;;
  *) echo "ERRORE: BACKUP_MODALITA '${BACKUP_MODALITA}' non valida (notturno|predeploy)" >&2; exit 1 ;;
esac

WASTEFLOW_ENV_FILE="${WASTEFLOW_ENV_FILE:-/opt/rifiuti/.env}"
WASTEFLOW_COMPOSE_FILE="${WASTEFLOW_COMPOSE_FILE:-/opt/rifiuti/site/docker-compose.prod.yml}"
# Ogni "docker compose" passa --env-file: il compose di produzione ha variabili
# obbligatorie (${VAR:?...}) interpolate anche da "exec".
PG_EXEC="${PG_EXEC:-docker compose -p rifiuti --env-file ${WASTEFLOW_ENV_FILE} -f ${WASTEFLOW_COMPOSE_FILE} exec -T postgres}"
BACKUP_STAGING_DIR="${BACKUP_STAGING_DIR:-/opt/rifiuti/backups}"
BACKUP_DATI_DIR="${BACKUP_DATI_DIR:-/var/lib/docker}"
BACKUP_FATTORE_SPAZIO_DUMP="${BACKUP_FATTORE_SPAZIO_DUMP:-2}"
BACKUP_FATTORE_SPAZIO_RIPRISTINO="${BACKUP_FATTORE_SPAZIO_RIPRISTINO:-3}"

DB_NAME="$(leggi_env "${WASTEFLOW_ENV_FILE}" DB_NAME wasteflow_prod)"
DB_USER="$(leggi_env "${WASTEFLOW_ENV_FILE}" DB_USER wasteflow)"
DB_NAME="${DB_NAME:-wasteflow_prod}"
DB_USER="${DB_USER:-wasteflow}"

# Valore dall'ambiente se impostato, altrimenti dal .env, altrimenti default.
OFFSITE_MODE="${OFFSITE_MODE:-$(leggi_env "${WASTEFLOW_ENV_FILE}" OFFSITE_MODE disabled)}"
RSYNC_TARGET="${RSYNC_TARGET:-$(leggi_env "${WASTEFLOW_ENV_FILE}" RSYNC_TARGET '')}"
RSYNC_SSH_KEY="${RSYNC_SSH_KEY:-$(leggi_env "${WASTEFLOW_ENV_FILE}" RSYNC_SSH_KEY /root/.ssh/id_ed25519_backup)}"
RCLONE_REMOTE="${RCLONE_REMOTE:-$(leggi_env "${WASTEFLOW_ENV_FILE}" RCLONE_REMOTE '')}"
ENCRYPT_BACKUP="${ENCRYPT_BACKUP:-$(leggi_env "${WASTEFLOW_ENV_FILE}" ENCRYPT_BACKUP false)}"
AGE_RECIPIENT="${AGE_RECIPIENT:-$(leggi_env "${WASTEFLOW_ENV_FILE}" AGE_RECIPIENT '')}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-$(leggi_env "${WASTEFLOW_ENV_FILE}" BACKUP_RETENTION_DAYS 30)}"
BACKUP_ALERT_EMAIL="${BACKUP_ALERT_EMAIL:-$(leggi_env "${WASTEFLOW_ENV_FILE}" BACKUP_ALERT_EMAIL root)}"
export BACKUP_ALERT_EMAIL PG_EXEC

# ---- Funzioni e trap ----------------------------------------------------------
LOG_TMP="$(mktemp)"
FILE_IN_CORSO=""
MAIL_GIA_INVIATA=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_TMP}"; }
die() { log "ERRORE: $*"; exit 1; }

# Un solo trap su EXIT (con "set -e" un trap ERR + EXIT manderebbe due mail).
alla_fine() {
  local esito=$?
  trap - EXIT
  if [[ ${esito} -ne 0 && "${BACKUP_MODALITA}" == "notturno" && ${MAIL_GIA_INVIATA} -eq 0 ]]; then
    notifica_fallimento "ATTENZIONE backup WasteFlow fallito" \
"Host: $(hostname)
Modalita': ${BACKUP_MODALITA}
Database: ${DB_NAME}
File: ${FILE_IN_CORSO:-nessuno}
Esito: ${esito}

Ultime righe del log:
$(tail -n 30 "${LOG_TMP}")"
  fi
  rm -f "${LOG_TMP}"
  exit "${esito}"
}
trap alla_fine EXIT

# ---- Inizio ------------------------------------------------------------------
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
if [[ "${BACKUP_MODALITA}" == "predeploy" ]]; then
  PREFISSO="wasteflow_predeploy_${DB_NAME}_"
else
  PREFISSO="wasteflow_${DB_NAME}_"
fi
BACKUP_FILE="${PREFISSO}${TIMESTAMP}.sql.gz"
STAGING_PATH="${BACKUP_STAGING_DIR}/${BACKUP_FILE}"
PARZIALE="${STAGING_PATH}.parziale"
FILE_IN_CORSO="${STAGING_PATH}"

# La cartella deve esistere prima del controllo dello spazio (df su un percorso
# inesistente fallirebbe e il primo backup pre-deploy si fermerebbe).
mkdir -p "${BACKUP_STAGING_DIR}"

log "Avvio backup '${BACKUP_MODALITA}' del DB '${DB_NAME}'"

DIM=$(dimensione_db "${DB_USER}" "${DB_NAME}") || die "impossibile leggere la dimensione del database (Postgres non raggiungibile?)"
[[ "${DIM}" =~ ^[0-9]+$ ]] || die "dimensione del database non valida: '${DIM}'"

if ! ERR=$(verifica_spazio_libero "${BACKUP_STAGING_DIR}" $((DIM * BACKUP_FATTORE_SPAZIO_DUMP)) 2>&1); then
  die "${ERR}"
fi

if ! pg_exec pg_dump -U "${DB_USER}" "${DB_NAME}" | gzip > "${PARZIALE}"; then
  # Il parziale contiene dati personali: non deve restare con un nome che nessuna rotazione tocca.
  if [[ -e "${PARZIALE}" ]]; then mv -f "${PARZIALE}" "${STAGING_PATH}.scartato"; fi
  die "pg_dump fallito (parziale conservato come ${STAGING_PATH}.scartato)"
fi

if ! ERR=$(verifica_completezza_dump "${PARZIALE}" 2>&1); then
  mv -f "${PARZIALE}" "${STAGING_PATH}.scartato"
  die "dump scartato (${STAGING_PATH}.scartato): ${ERR}"
fi
log "Dump completo (marcatore finale presente)"

if [[ "${BACKUP_MODALITA}" == "notturno" ]]; then
  if ! ERR=$(verifica_spazio_libero "${BACKUP_DATI_DIR}" $((DIM * BACKUP_FATTORE_SPAZIO_RIPRISTINO)) 2>&1); then
    mv -f "${PARZIALE}" "${STAGING_PATH}.non-verificato"
    notifica_fallimento "ATTENZIONE backup WasteFlow non verificato: spazio insufficiente" \
"Host: $(hostname)
Il dump e' completo ma non e' stato provato un ripristino: ${ERR}
File conservato come: ${STAGING_PATH}.non-verificato"
    MAIL_GIA_INVIATA=1
    die "ripristino di prova non eseguito: ${ERR}"
  fi
  log "Ripristino di prova in un database temporaneo..."
  RC_RIPRISTINO=0
  ERR=$(ripristino_di_prova "${PARZIALE}" "${DB_USER}" "${DB_NAME}" 2>&1) || RC_RIPRISTINO=$?
  if [[ ${RC_RIPRISTINO} -eq 2 ]]; then
    # Ripristino riuscito ma database temporaneo rimasto: il dump e' valido e si accetta,
    # il problema pero' deve restare visibile (log + mail), altrimenti i database si accumulano.
    log "ATTENZIONE: ${ERR}"
    notifica_fallimento "ATTENZIONE backup WasteFlow: database temporaneo non eliminato" \
"Host: $(hostname)
Il ripristino di prova e' riuscito e il dump e' stato accettato, ma il database temporaneo
non e' stato eliminato. Va rimosso a mano (DROP DATABASE wasteflow_verifica_...).

${ERR}"
  elif [[ ${RC_RIPRISTINO} -ne 0 ]]; then
    mv -f "${PARZIALE}" "${STAGING_PATH}.scartato"
    die "ripristino di prova fallito, dump scartato (${STAGING_PATH}.scartato): ${ERR}"
  fi
  log "Ripristino di prova riuscito"
fi

mv -f "${PARZIALE}" "${STAGING_PATH}"
BACKUP_SIZE=$(du -sh "${STAGING_PATH}" | cut -f1)

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

# Copia off-site (mai nel pre-deploy)
if [[ "${BACKUP_MODALITA}" == "predeploy" ]]; then
  log "Pre-deploy: copia off-site saltata."
else
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
      log "Copia off-site disabilitata (OFFSITE_MODE=disabled). Il backup e' solo locale."
      ;;
    *)
      die "OFFSITE_MODE '${OFFSITE_MODE}' non valido (rsync|rclone|disabled)"
      ;;
  esac
fi

# Rotazione locale
if [[ "${BACKUP_MODALITA}" == "predeploy" ]]; then
  log "Rotazione pre-deploy: tengo i 10 piu' recenti"
  # Elenco dei verificati dal piu' recente; gli ultimi oltre il decimo si eliminano.
  # "|| true": grep senza righe esce 1 e con pipefail/set -e fermerebbe lo script.
  { ls -1t "${BACKUP_STAGING_DIR}"/wasteflow_predeploy_"${DB_NAME}"_*.sql.gz* 2>/dev/null || true; } \
    | { grep -Ev '\.(scartato|non-verificato|parziale)$' || true; } \
    | tail -n +11 \
    | while read -r vecchio; do rm -f -- "${vecchio}"; done
else
  log "Rotazione backup locali (retention: ${RETENTION_DAYS} giorni)"
  find "${BACKUP_STAGING_DIR}" \
    \( -name "wasteflow_${DB_NAME}_*.sql.gz" -o -name "wasteflow_${DB_NAME}_*.sql.gz.age" \) \
    -mtime "+${RETENTION_DAYS}" -delete
  find "${BACKUP_STAGING_DIR}" \
    \( -name "wasteflow_*.sql.gz.scartato" -o -name "wasteflow_*.sql.gz.non-verificato" -o -name "wasteflow_*.sql.gz.parziale" \) \
    -mtime +7 -delete
fi

log "Backup verificato: ${UPLOAD_FILE} (${BACKUP_SIZE})"
