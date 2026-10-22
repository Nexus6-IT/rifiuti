#!/usr/bin/env bash
# ==============================================================================
# ops/restore.sh — Restore PostgreSQL per WasteFlow
# ==============================================================================
# Ripristina un dump (prodotto da backup-offsite.sh) senza mai eliminare il database
# di produzione:
#   1. verifica il dump (marcatore finale di pg_dump) prima di toccare qualunque cosa;
#   2. lo ripristina in un database NUOVO, in una sola transaction;
#   3. solo se il ripristino riesce scambia i nomi: il database di produzione diventa
#      <DB>_prima_del_ripristino_<AAAAMMGG_HHMMSS>_<pid> e il nuovo prende il suo nome;
#   4. esegue "prisma migrate deploy" con l'immagine RIPRISTINO_TAG.
# Il backend, se fermato, viene riavviato SEMPRE all'uscita (trap), anche in caso di
# errore. Il database precedente resta: va eliminato a mano dopo la verifica.
#
# USO:
#   RIPRISTINO_TAG=sha-1a2b3c4 bash /opt/rifiuti/site/ops/restore.sh \
#     /opt/rifiuti/backups/wasteflow_..._20260610.sql.gz
#
# Si ripristinano solo file .sql.gz verificati o .sql gia' decifrati/decompressi
# (mai .non-verificato, .scartato, .parziale, .age). Se il backup e' cifrato con age:
#   age -d -i ~/.ssh/id_ed25519_backup dump.sql.gz.age > dump.sql.gz
#
# Variabili:
#   RIPRISTINO_TAG (obbligatoria)  tag dell'immagine del backend coerente con il dump
#                                  (es. sha-1a2b3c4); esportata come TAG per il compose.
#   WASTEFLOW_ENV_FILE             default /opt/rifiuti/.env
#   WASTEFLOW_COMPOSE_FILE         default /opt/rifiuti/site/docker-compose.prod.yml
#   RIPRISTINO_CONFERMATO=YES      salta la conferma interattiva.
#   BACKUP_DATI_DIR                filesystem dei dati di Docker (default /var/lib/docker).
#   RIPRISTINO_FATTORE_SPAZIO      spazio libero richiesto = dimensione del DB x fattore (2).
#   WASTEFLOW_DC                   (solo test) prefisso di comando al posto del compose.
#   PG_EXEC                        (solo test) prefisso per psql, come in backup-offsite.sh.
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
# anche da "exec", "run", "stop" e "start".
DB_NAME="$(leggi_env "${ENV_FILE}" DB_NAME wasteflow_prod)"
DB_USER="$(leggi_env "${ENV_FILE}" DB_USER wasteflow)"
DB_NAME="${DB_NAME:-wasteflow_prod}"
DB_USER="${DB_USER:-wasteflow}"
if [[ -n "${WASTEFLOW_DC:-}" ]]; then
  # shellcheck disable=SC2206 # word splitting voluto, come PG_EXEC
  DC=(${WASTEFLOW_DC})
else
  DC=(docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")
fi
PG_EXEC="${PG_EXEC:-${DC[*]} exec -T postgres}"
BACKUP_DATI_DIR="${BACKUP_DATI_DIR:-/var/lib/docker}"
RIPRISTINO_FATTORE_SPAZIO="${RIPRISTINO_FATTORE_SPAZIO:-2}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "ERRORE: $*" >&2; exit 1; }

# psql_postgres SQL — esegue SQL sul database di servizio "postgres", fermandosi al primo errore.
psql_postgres() {
  pg_exec psql -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 -qAtc "$1"
}

# ---- 1. Argomento e formato ---------------------------------------------------
BACKUP_FILE="${1:-}"
[[ -z "${BACKUP_FILE}" ]] && die "Specificare il percorso del file di backup: $0 <file.sql.gz>"
case "${BACKUP_FILE}" in
  *.sql.gz | *.sql) ;;
  *) die "Formato non ammesso: ${BACKUP_FILE}. Si ripristinano solo file .sql.gz verificati o .sql già decifrati (mai .non-verificato, .scartato, .parziale, .age)." ;;
esac
[[ -f "${BACKUP_FILE}" ]] || die "File non trovato: ${BACKUP_FILE}"

# ---- 2. Verifica del dump (prima di toccare qualunque cosa) --------------------
if [[ "${BACKUP_FILE}" == *.sql.gz ]]; then
  MOTIVO="$(verifica_completezza_dump "${BACKUP_FILE}" 2>&1)" || die "Dump non utilizzabile: ${MOTIVO}"
else
  MOTIVO="$(verifica_completezza_sql "${BACKUP_FILE}" 2>&1)" || die "Dump non utilizzabile: ${MOTIVO}"
fi

# ---- 3. Tag dell'immagine del backend -----------------------------------------
[[ -n "${RIPRISTINO_TAG:-}" ]] \
  || die "RIPRISTINO_TAG obbligatoria: il tag dell'immagine del backend coerente con il dump (es. sha-1a2b3c4)"
export TAG="${RIPRISTINO_TAG}"

# ---- 4. Spazio libero ---------------------------------------------------------
MOTIVO="$(valida_fattore_spazio RIPRISTINO_FATTORE_SPAZIO "${RIPRISTINO_FATTORE_SPAZIO}" 2>&1)" || die "${MOTIVO}"
DIM="$(dimensione_db "${DB_USER}" "${DB_NAME}")" || die "Dimensione del database ${DB_NAME} non leggibile"
[[ "${DIM}" =~ ^[0-9]+$ ]] || die "Dimensione del database ${DB_NAME} non valida: '${DIM}'"
RICHIESTI="$(awk -v d="$DIM" -v f="$RIPRISTINO_FATTORE_SPAZIO" 'BEGIN{printf "%.0f", d*f}')"
MOTIVO="$(verifica_spazio_libero "${BACKUP_DATI_DIR}" "${RICHIESTI}" 2>&1)" || die "${MOTIVO}"

DB_TEMP="${DB_NAME}_ripristino_$(date +%s)_$$"
DB_PRECEDENTE="${DB_NAME}_prima_del_ripristino_$(date +%Y%m%d_%H%M%S)_$$"
# PostgreSQL tronca in silenzio i nomi oltre 63 byte: i confronti per nome fallirebbero.
for nome in "${DB_TEMP}" "${DB_PRECEDENTE}"; do
  [[ "${#nome}" -le 63 ]] || die "Nome di database troppo lungo (oltre 63 caratteri): ${nome}"
done

# ---- 5. Conferma, poi stop del backend sotto trap -----------------------------
if [[ "${RIPRISTINO_CONFERMATO:-}" != "YES" ]]; then
  echo ""
  echo "ATTENZIONE: il database '${DB_NAME}' sarà sostituito dal contenuto di:"
  echo "  ${BACKUP_FILE}"
  echo "Il backend resterà fermo durante il ripristino. Il database attuale non viene"
  echo "eliminato: resterà come '${DB_PRECEDENTE}'."
  echo ""
  read -r -p "Confermare il ripristino? (digitare YES per procedere): " CONFIRM
  [[ "${CONFIRM}" == "YES" ]] || { log "Ripristino annullato."; exit 0; }
fi

BACKEND_FERMATO=0
STATO_PRODUZIONE="intatto"

# ripristino_alla_fine — trap di uscita: riavvia il backend se e' stato fermato e,
# se l'esito non e' 0, dice in che stato e' rimasto il database di produzione.
ripristino_alla_fine() {
  local esito=$?
  trap - EXIT
  if [[ "${BACKEND_FERMATO}" -eq 1 ]]; then
    log "Avvio del backend..."
    if ! "${DC[@]}" start backend; then
      log "ATTENZIONE: avvio del backend fallito, avviarlo a mano: ${DC[*]} start backend"
    fi
  fi
  if [[ "${esito}" -ne 0 ]]; then
    log "Ripristino NON riuscito (esito ${esito}): il database di produzione è ${STATO_PRODUZIONE}." >&2
  fi
  exit "${esito}"
}
trap ripristino_alla_fine EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

log "Arresto del backend prima del ripristino..."
# Segnato prima dello stop: se lo script si interrompe durante lo stop, il trap lo
# riavvia comunque ("start" su un container gia' acceso non fa nulla).
BACKEND_FERMATO=1
"${DC[@]}" stop backend || die "Arresto del backend fallito"

# elimina_temporaneo — elimina il database temporaneo; un fallimento si segnala soltanto.
elimina_temporaneo() {
  if ! psql_postgres "DROP DATABASE IF EXISTS \"${DB_TEMP}\" WITH (FORCE)" >/dev/null; then
    log "ATTENZIONE: eliminazione del database temporaneo ${DB_TEMP} fallita: eliminarlo a mano" >&2
  fi
}

# ---- 6. Ripristino in un database nuovo ----------------------------------------
log "Creazione del database temporaneo ${DB_TEMP}..."
psql_postgres "CREATE DATABASE \"${DB_TEMP}\" OWNER \"${DB_USER}\"" >/dev/null \
  || { elimina_temporaneo; die "Creazione del database temporaneo ${DB_TEMP} fallita"; }

log "Ripristino del dump ${BACKUP_FILE} in ${DB_TEMP} (una sola transaction)..."
set +e
if [[ "${BACKUP_FILE}" == *.sql.gz ]]; then
  gunzip -c "${BACKUP_FILE}" | pg_exec psql -U "${DB_USER}" -d "${DB_TEMP}" -v ON_ERROR_STOP=1 -1 -q >/dev/null
  STATI=("${PIPESTATUS[@]}")
else
  pg_exec psql -U "${DB_USER}" -d "${DB_TEMP}" -v ON_ERROR_STOP=1 -1 -q < "${BACKUP_FILE}" >/dev/null
  STATI=(0 "$?")
fi
set -e
if [[ "${STATI[0]}" -ne 0 || "${STATI[1]}" -ne 0 ]]; then
  elimina_temporaneo
  die "Ripristino del dump fallito (gunzip=${STATI[0]}, psql=${STATI[1]}): nessuna modifica al database ${DB_NAME}"
fi

# ---- 7. Controlli sul database ripristinato ------------------------------------
N_TABELLE="$(_conta "${DB_USER}" "${DB_TEMP}" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")" \
  || N_TABELLE=0
if [[ "${N_TABELLE}" -lt 1 ]]; then
  elimina_temporaneo
  die "Il database ripristinato non ha tabelle in public: nessuna modifica al database ${DB_NAME}"
fi
if ! _conta "${DB_USER}" "${DB_TEMP}" 'SELECT count(*) FROM _prisma_migrations' >/dev/null; then
  elimina_temporaneo
  die "Il database ripristinato non ha una _prisma_migrations leggibile: nessuna modifica al database ${DB_NAME}"
fi
log "Database ripristinato: ${N_TABELLE} tabelle in public."

# ---- 8. Scambio dei nomi ------------------------------------------------------
log "Scambio: ${DB_NAME} -> ${DB_PRECEDENTE}, ${DB_TEMP} -> ${DB_NAME}..."
psql_postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()" >/dev/null \
  || log "ATTENZIONE: chiusura delle sessioni su ${DB_NAME} non riuscita, provo comunque la rinomina"
if ! psql_postgres "ALTER DATABASE \"${DB_NAME}\" RENAME TO \"${DB_PRECEDENTE}\"" >/dev/null; then
  elimina_temporaneo
  die "Rinomina di ${DB_NAME} in ${DB_PRECEDENTE} fallita (sessioni ancora aperte?)"
fi
if ! psql_postgres "ALTER DATABASE \"${DB_TEMP}\" RENAME TO \"${DB_NAME}\"" >/dev/null; then
  if psql_postgres "ALTER DATABASE \"${DB_PRECEDENTE}\" RENAME TO \"${DB_NAME}\"" >/dev/null; then
    elimina_temporaneo
    die "Rinomina di ${DB_TEMP} in ${DB_NAME} fallita: ${DB_PRECEDENTE} riportato al nome ${DB_NAME}"
  fi
  STATO_PRODUZIONE="ASSENTE: il precedente è ${DB_PRECEDENTE} e il ripristinato ${DB_TEMP}; rinominare a mano ${DB_PRECEDENTE} in ${DB_NAME}"
  die "Rinomina di ${DB_TEMP} in ${DB_NAME} fallita e rinomina all'indietro non riuscita"
fi
STATO_PRODUZIONE="quello ripristinato; il precedente è ${DB_PRECEDENTE}"

# ---- 9. Migration con l'immagine coerente con il dump --------------------------
log "Esecuzione di prisma migrate deploy con l'immagine ${TAG}..."
"${DC[@]}" run --rm backend npx prisma migrate deploy \
  || die "prisma migrate deploy fallito con l'immagine ${TAG}: il database ripristinato resta in uso, il precedente è ${DB_PRECEDENTE}"

# ---- 10. Fine (il backend lo riavvia il trap) ---------------------------------
log "Ripristino completato con l'immagine ${TAG}. Il database precedente è ${DB_PRECEDENTE}: eliminarlo a mano dopo la verifica (DROP DATABASE \"${DB_PRECEDENTE}\")."
echo ""
echo "Verifica rapida, dopo il riavvio del backend:"
echo "  curl -s https://rifiuti.ignicraft.com/api/v1/health | jq .status"
