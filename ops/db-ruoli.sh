#!/usr/bin/env bash
# ==============================================================================
# db-ruoli.sh — esegue apps/backend/prisma/sql/ruoli-db.sql nel container postgres
# ------------------------------------------------------------------------------
# Un solo punto d'ingresso per sviluppo, CI, deploy e restore. Va lanciato SEMPRE
# DOPO `prisma migrate deploy` (lo script SQL si ferma se _prisma_migrations non
# esiste) e come owner superuser.
#
# Uso:
#   PG_EXEC="<comando che esegue un processo nel container, con stdin>" \
#     bash ops/db-ruoli.sh [NOME_DATABASE]
#   bash ops/db-ruoli.sh --dev [NOME_DATABASE]   # container wasteflow-postgres, password di sviluppo
#
# Variabili (dall'ambiente, oppure dal file indicato da RUOLI_ENV_FILE per quelle
# non gia' impostate): DB_APP_PASSWORD, DB_SISTEMA_PASSWORD, e opzionali DB_APP_USER
# / DB_SISTEMA_USER (se presenti devono valere wasteflow_app / wasteflow_sistema,
# i nomi sono fissi nello script SQL).
#
# Esito:
#   - nessuna password ne' user      -> "ruoli DB non configurati: salto", exit 0;
#   - configurazione a meta'         -> errore, exit 1 (mai un salto silenzioso:
#                                       il compose avrebbe l'app sul ruolo senza password);
#   - psql fallisce                  -> exit != 0.
#
# PASSWORD FUORI DA OGNI argv: arrivano a psql come righe `\set` sullo STDIN,
# costruite con il printf BUILTIN di bash (nessun processo esterno, quindi niente
# /proc/<pid>/cmdline) e seguite dal file SQL. Non compaiono nel comando che
# stampa il runner. Niente `set -x`. Per questo sono ammessi solo i caratteri
# [A-Za-z0-9_.:,@%+=/-] (esadecimale consigliato): evita ogni problema di quoting.
#
# Il container fornisce POSTGRES_USER, POSTGRES_DB e (in CI) PGPORT.
# ==============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${RUOLI_DB_SQL:-${DIR}/../apps/backend/prisma/sql/ruoli-db.sql}"

DEV=0
if [[ "${1:-}" == "--dev" ]]; then
  DEV=1
  shift
fi
DATABASE="${1:-}"

# Carica da RUOLI_ENV_FILE le sole variabili che servono e non sono gia' in ambiente.
# Il file NON viene eseguito (niente `source`): una riga NOME=valore, apici esterni tolti.
carica_da_file() {
  local file="$1" nome valore
  [[ -r "${file}" ]] || return 0
  for nome in DB_APP_PASSWORD DB_SISTEMA_PASSWORD DB_APP_USER DB_SISTEMA_USER; do
    [[ -n "${!nome:-}" ]] && continue
    valore="$(sed -n "s/^${nome}=//p" "${file}" | tail -n 1 | tr -d '\r')"
    valore="${valore%\"}"; valore="${valore#\"}"; valore="${valore%\'}"; valore="${valore#\'}"
    printf -v "${nome}" '%s' "${valore}"
  done
}
[[ -n "${RUOLI_ENV_FILE:-}" ]] && carica_da_file "${RUOLI_ENV_FILE}"

if [[ "${DEV}" == "1" ]]; then
  # Password di sviluppo: pubbliche per costruzione (valgono solo in locale).
  DB_APP_PASSWORD="${DB_APP_PASSWORD:-wasteflow_app_dev}"
  DB_SISTEMA_PASSWORD="${DB_SISTEMA_PASSWORD:-wasteflow_sistema_dev}"
  PG_EXEC="${PG_EXEC:-docker exec -i wasteflow-postgres}"
fi

APP_PWD="${DB_APP_PASSWORD:-}"
SIS_PWD="${DB_SISTEMA_PASSWORD:-}"
APP_USER="${DB_APP_USER:-}"
SIS_USER="${DB_SISTEMA_USER:-}"

if [[ -z "${APP_PWD}" && -z "${SIS_PWD}" ]]; then
  if [[ -n "${APP_USER}" || -n "${SIS_USER}" ]]; then
    echo "ERRORE: DB_APP_USER/DB_SISTEMA_USER impostati ma nessuna password: configurazione ruoli DB incompleta" >&2
    exit 1
  fi
  echo "ruoli DB non configurati: salto"
  exit 0
fi
if [[ -z "${APP_PWD}" || -z "${SIS_PWD}" ]]; then
  echo "ERRORE: DB_APP_PASSWORD e DB_SISTEMA_PASSWORD vanno impostate insieme (ne manca una): configurazione ruoli DB incompleta" >&2
  exit 1
fi
if [[ -n "${APP_USER}" && "${APP_USER}" != "wasteflow_app" ]]; then
  echo "ERRORE: DB_APP_USER deve essere wasteflow_app (nome fisso in ruoli-db.sql), trovato '${APP_USER}'" >&2
  exit 1
fi
if [[ -n "${SIS_USER}" && "${SIS_USER}" != "wasteflow_sistema" ]]; then
  echo "ERRORE: DB_SISTEMA_USER deve essere wasteflow_sistema (nome fisso in ruoli-db.sql), trovato '${SIS_USER}'" >&2
  exit 1
fi
CARATTERI_AMMESSI='*[!A-Za-z0-9_.:,@%+=/-]*'
# shellcheck disable=SC2254 # il pattern in variabile e' voluto
case "${APP_PWD}${SIS_PWD}" in
  ${CARATTERI_AMMESSI})
    echo "ERRORE: le password dei ruoli DB contengono caratteri non ammessi (usare solo A-Za-z0-9 _ . : , @ % + = / -; meglio esadecimale)" >&2
    exit 1
    ;;
esac

[[ -n "${PG_EXEC:-}" ]] || { echo "ERRORE: PG_EXEC non impostato (oppure usare --dev)" >&2; exit 2; }
[[ -f "${SQL}" ]] || { echo "ERRORE: ${SQL} non trovato" >&2; exit 2; }

# Corpo eseguito nel container (apici singoli: nessuna espansione qui). $1 = nome
# del database, vuoto = POSTGRES_DB. VERBOSITY/SHOW_CONTEXT: un errore SQL non
# deve riportare nel log il testo dello statement; -o /dev/null: i
# `SELECT set_config(...)` dello script restituirebbero le password.
# shellcheck disable=SC2016
CORPO='
set -e
exec psql -U "$POSTGRES_USER" -d "${1:-$POSTGRES_DB}" -v ON_ERROR_STOP=1 \
  -v VERBOSITY=terse -v SHOW_CONTEXT=never -q -o /dev/null -f -
'

# Le righe \set e il file SQL viaggiano su un'unica pipe. printf e' un builtin:
# le password non finiscono in alcun argv.
# shellcheck disable=SC2086 # word splitting voluto, come PG_EXEC in restore.sh
{
  printf '\set app_password '"'"'%s'"'"'\n' "${APP_PWD}"
  printf '\set sistema_password '"'"'%s'"'"'\n' "${SIS_PWD}"
  cat "${SQL}"
} | ${PG_EXEC} sh -c "${CORPO}" sh "${DATABASE}"

echo "ruoli DB applicati (wasteflow_app, wasteflow_sistema)"
