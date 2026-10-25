#!/usr/bin/env bash
# ==============================================================================
# ops/restore.sh — Restore PostgreSQL per WasteFlow
# ==============================================================================
# Ripristina un dump (prodotto da backup-offsite.sh) senza mai eliminare il database
# di produzione:
#   1. verifica il dump (marcatore finale di pg_dump) prima di toccare qualunque cosa;
#   2. lo ripristina in un database NUOVO, in una sola transaction;
#   3. solo se il ripristino riesce scambia i nomi: il database di produzione diventa
#      <DB>_prima_del_ripristino_<AAAAMMGG_HHMMSS>_<pid> e il nuovo prende il suo nome
#      (se il database di produzione non esiste, disaster recovery, il nuovo prende
#      semplicemente il nome);
#   4. esegue "prisma migrate deploy" con l'immagine RIPRISTINO_TAG;
#   5. ricrea il backend con l'immagine RIPRISTINO_TAG (up -d --no-deps backend).
# Se qualcosa fallisce PRIMA dello scambio, il trap riavvia il backend sul database di
# produzione invariato. Se fallisce il migrate, il backend resta FERMO: lo schema del
# database ripristinato non e' allineato e farlo ripartire nasconderebbe il guasto.
# Il database precedente resta: va eliminato a mano dopo la verifica.
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
#   RIPRISTINO_TAG (obbligatoria)  tag dell'immagine del backend che girera' dopo il
#                                  ripristino, con le migration coerenti con lo schema
#                                  del dump (es. sha-1a2b3c4); esportata come TAG, la
#                                  variabile dell'immagine nel compose.
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
# anche da "exec", "run", "stop", "start" e "up".
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

# ---- 4. Nomi, esistenza del database di produzione e spazio libero -------------
MOTIVO="$(valida_fattore_spazio RIPRISTINO_FATTORE_SPAZIO "${RIPRISTINO_FATTORE_SPAZIO}" 2>&1)" || die "${MOTIVO}"
# Il nome finisce fra virgolette nell'SQL: solo lettere, cifre e underscore.
[[ "${DB_NAME}" =~ ^[A-Za-z0-9_]+$ ]] || die "DB_NAME non valido: '${DB_NAME}' (solo lettere, cifre e underscore)"

ESISTE="$(_conta "${DB_USER}" postgres "SELECT count(*) FROM pg_database WHERE datname = '${DB_NAME}'")" \
  || die "PostgreSQL non raggiungibile: impossibile sapere se il database ${DB_NAME} esiste"
if [[ "${ESISTE}" -ge 1 ]]; then
  DIM="$(dimensione_db "${DB_USER}" "${DB_NAME}")" || die "Dimensione del database ${DB_NAME} non leggibile"
else
  # Disaster recovery: il database di produzione non c'e'. Lo spazio si stima dal dump.
  log "Il database ${DB_NAME} non esiste: il ripristinato prenderà direttamente il suo nome."
  if [[ "${BACKUP_FILE}" == *.sql.gz ]]; then
    DIM="$(gzip -dc "${BACKUP_FILE}" | wc -c | tr -d '[:space:]')" || die "Dimensione del dump non leggibile"
  else
    DIM="$(wc -c < "${BACKUP_FILE}" | tr -d '[:space:]')" || die "Dimensione del dump non leggibile"
  fi
fi
[[ "${DIM}" =~ ^[0-9]+$ ]] || die "Dimensione non valida: '${DIM}'"
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
  echo "Il backend resterà fermo durante il ripristino e ripartirà con l'immagine ${TAG}."
  if [[ "${ESISTE}" -ge 1 ]]; then
    echo "Il database attuale non viene eliminato: resterà come '${DB_PRECEDENTE}'."
  fi
  echo ""
  read -r -p "Confermare il ripristino? (digitare YES per procedere): " CONFIRM
  [[ "${CONFIRM}" == "YES" ]] || { log "Ripristino annullato."; exit 0; }
fi

# Stato letto dal trap:
#   RIAVVIA_SE_ERRORE  1 = in caso di errore riavviare il backend (database di produzione invariato)
#   TEMP_DA_ELIMINARE  1 = in caso di errore eliminare il database temporaneo
#   STATO_PRODUZIONE   come e' rimasto il database di produzione, per l'ultima riga del log
RIAVVIA_SE_ERRORE=0
TEMP_DA_ELIMINARE=0
STATO_PRODUZIONE="intatto"

# elimina_temporaneo — elimina il database temporaneo; un fallimento si segnala soltanto.
elimina_temporaneo() {
  if ! psql_postgres "DROP DATABASE IF EXISTS \"${DB_TEMP}\" WITH (FORCE)" >/dev/null; then
    log "ATTENZIONE: eliminazione del database temporaneo ${DB_TEMP} fallita: eliminarlo a mano" >&2
  fi
}

# ripristino_alla_fine — trap di uscita. Con esito diverso da 0: elimina il temporaneo se
# non contiene l'unica copia dei dati, riavvia il backend solo se il database di produzione
# e' invariato e dice in che stato e' rimasto il database di produzione.
ripristino_alla_fine() {
  local esito=$?
  trap - EXIT
  if [[ "${esito}" -ne 0 ]]; then
    if [[ "${TEMP_DA_ELIMINARE}" -eq 1 ]]; then
      elimina_temporaneo
    fi
    if [[ "${RIAVVIA_SE_ERRORE}" -eq 1 ]]; then
      log "Riavvio del backend sul database di produzione invariato..."
      if ! "${DC[@]}" start backend; then
        log "ATTENZIONE: avvio del backend fallito, avviarlo a mano: ${DC[*]} start backend" >&2
      fi
    fi
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
RIAVVIA_SE_ERRORE=1
"${DC[@]}" stop backend || die "Arresto del backend fallito"

# ---- 6. Ripristino in un database nuovo ----------------------------------------
log "Creazione del database temporaneo ${DB_TEMP}..."
TEMP_DA_ELIMINARE=1
psql_postgres "CREATE DATABASE \"${DB_TEMP}\" OWNER \"${DB_USER}\"" >/dev/null \
  || die "Creazione del database temporaneo ${DB_TEMP} fallita"

# Il dump contiene GRANT ai ruoli applicativi (pg_dump non usa --no-privileges),
# ma i ruoli sono dell'intero cluster e non stanno nel dump: su un cluster nuovo
# il caricamento si fermerebbe con "role does not exist". Si creano quindi,
# NOLOGIN e senza password, se mancano (no-op se ci sono). Per app e sistema LOGIN,
# password e diritti li da' poi il passo 9b (ops/db-ruoli.sh); wasteflow_lettura e
# rifiuti_testing restano NOLOGIN senza password e il 9b non li tocca: rifiuti_testing e'
# il ruolo esterno di sola lettura di testing-umano (nel dump ci sono GRANT e default
# privileges verso di lui); LOGIN, password e GRANT wasteflow_lettura TO rifiuti_testing
# si rifanno a mano. RESTORE_RUOLI serve ai test.
RUOLI_BASE="${RESTORE_RUOLI:-wasteflow_app wasteflow_sistema wasteflow_lettura rifiuti_testing}"
for RUOLO in ${RUOLI_BASE}; do
  psql_postgres "DO \$r\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUOLO}') THEN CREATE ROLE \"${RUOLO}\" NOLOGIN; END IF; END \$r\$" >/dev/null \
    || die "Creazione del ruolo ${RUOLO} fallita: nessuna modifica al database ${DB_NAME}"
done

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
  die "Ripristino del dump fallito (gunzip=${STATI[0]}, psql=${STATI[1]}): nessuna modifica al database ${DB_NAME}"
fi

# ---- 7. Controlli sul database ripristinato ------------------------------------
N_TABELLE="$(_conta "${DB_USER}" "${DB_TEMP}" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")" \
  || N_TABELLE=0
[[ "${N_TABELLE}" -ge 1 ]] \
  || die "Il database ripristinato non ha tabelle in public: nessuna modifica al database ${DB_NAME}"
_conta "${DB_USER}" "${DB_TEMP}" 'SELECT count(*) FROM _prisma_migrations' >/dev/null \
  || die "Il database ripristinato non ha una _prisma_migrations leggibile: nessuna modifica al database ${DB_NAME}"
log "Database ripristinato: ${N_TABELLE} tabelle in public."

# ---- 8. Scambio dei nomi ------------------------------------------------------
# Da qui il database di produzione puo' cambiare: niente riavvio automatico e niente
# eliminazione del temporaneo finche' lo stato non e' di nuovo noto.
RIAVVIA_SE_ERRORE=0
TEMP_DA_ELIMINARE=0
if [[ "${ESISTE}" -ge 1 ]]; then
  STATO_PRODUZIONE="in uno stato da verificare (scambio dei nomi interrotto): controllare i database ${DB_NAME}, ${DB_PRECEDENTE} e ${DB_TEMP}; il backend resta fermo"
  log "Scambio: ${DB_NAME} -> ${DB_PRECEDENTE}, ${DB_TEMP} -> ${DB_NAME}..."
  psql_postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()" >/dev/null \
    || log "ATTENZIONE: chiusura delle sessioni su ${DB_NAME} non riuscita, provo comunque la rinomina"
  if ! psql_postgres "ALTER DATABASE \"${DB_NAME}\" RENAME TO \"${DB_PRECEDENTE}\"" >/dev/null; then
    STATO_PRODUZIONE="intatto"
    RIAVVIA_SE_ERRORE=1
    TEMP_DA_ELIMINARE=1
    die "Rinomina di ${DB_NAME} in ${DB_PRECEDENTE} fallita (sessioni ancora aperte?)"
  fi
  if ! psql_postgres "ALTER DATABASE \"${DB_TEMP}\" RENAME TO \"${DB_NAME}\"" >/dev/null; then
    if psql_postgres "ALTER DATABASE \"${DB_PRECEDENTE}\" RENAME TO \"${DB_NAME}\"" >/dev/null; then
      STATO_PRODUZIONE="intatto"
      RIAVVIA_SE_ERRORE=1
      TEMP_DA_ELIMINARE=1
      die "Rinomina di ${DB_TEMP} in ${DB_NAME} fallita: ${DB_PRECEDENTE} riportato al nome ${DB_NAME}"
    fi
    STATO_PRODUZIONE="ASSENTE: il precedente è ${DB_PRECEDENTE} e il ripristinato ${DB_TEMP}; rinominare a mano ${DB_PRECEDENTE} in ${DB_NAME}; il backend resta fermo"
    die "Rinomina di ${DB_TEMP} in ${DB_NAME} fallita e rinomina all'indietro non riuscita"
  fi
  PRECEDENTE_TESTO="il precedente è ${DB_PRECEDENTE}"
else
  STATO_PRODUZIONE="in uno stato da verificare (rinomina interrotta): controllare i database ${DB_NAME} e ${DB_TEMP}; il backend resta fermo"
  log "Rinomina: ${DB_TEMP} -> ${DB_NAME}..."
  if ! psql_postgres "ALTER DATABASE \"${DB_TEMP}\" RENAME TO \"${DB_NAME}\"" >/dev/null; then
    STATO_PRODUZIONE="assente come prima"
    RIAVVIA_SE_ERRORE=1
    TEMP_DA_ELIMINARE=1
    die "Rinomina di ${DB_TEMP} in ${DB_NAME} fallita"
  fi
  PRECEDENTE_TESTO="non c'era un database precedente"
fi

# ---- 9. Migration con l'immagine coerente con il dump --------------------------
STATO_PRODUZIONE="quello ripristinato, con lo schema NON allineato; ${PRECEDENTE_TESTO}; il backend resta FERMO"
log "Esecuzione di prisma migrate deploy con l'immagine ${TAG}..."
# Come in deploy.yml: SEMPRE come owner (DATABASE_URL_MIGRAZIONI), perche' l'URL
# dell'applicazione puo' puntare a un ruolo senza diritti DDL. Le virgolette
# singole fanno espandere la variabile dentro il container, non qui.
"${DC[@]}" run --rm backend sh -c 'DATABASE_URL="$DATABASE_URL_MIGRAZIONI" npx prisma migrate deploy' \
  || die "prisma migrate deploy fallito con l'immagine ${TAG}: il database ripristinato resta in uso con lo schema non allineato, ${PRECEDENTE_TESTO}. Il backend resta FERMO. Correggere la causa, poi rilanciare con TAG=${TAG}: '${DC[*]} run --rm backend sh -c \"DATABASE_URL=\\\"\\\$DATABASE_URL_MIGRAZIONI\\\" npx prisma migrate deploy\"' e '${DC[*]} up -d --no-deps backend'; per tornare al database precedente, rinominarlo in ${DB_NAME} a backend fermo."

# ---- 9b. Ruoli DB (dopo le migration) ------------------------------------------
# Il dump porta con se' i GRANT (pg_dump senza --no-privileges), ma l'ambiente
# puo' avere ruoli disallineati: si rieseguono i ruoli, script idempotente. Se
# le password non sono nel .env lo script stampa che salta e prosegue; se ne
# manca una sola, si ferma con errore.
log "Ruoli DB (ops/db-ruoli.sh)..."
# Le password si leggono dal .env del server senza eseguirlo (RUOLI_ENV_FILE) e
# arrivano a psql sullo stdin: mai in un argv. DB_NAME e' il database appena
# rinominato.
RUOLI_ENV_FILE="${ENV_FILE}" PG_EXEC="${PG_EXEC}" bash "$(dirname "$0")/db-ruoli.sh" "${DB_NAME}" \
  || die "Creazione dei ruoli DB fallita: il database ripristinato resta in uso, il backend resta FERMO. Rilanciare 'bash ops/db-ruoli.sh' con PG_EXEC=\"${PG_EXEC}\" e poi '${DC[*]} up -d --no-deps backend'."

# ---- 10. Backend ricreato con l'immagine RIPRISTINO_TAG -------------------------
STATO_PRODUZIONE="quello ripristinato, con lo schema allineato; ${PRECEDENTE_TESTO}; il backend non è partito con l'immagine ${TAG}"
log "Avvio del backend con l'immagine ${TAG}..."
"${DC[@]}" up -d --no-deps backend \
  || die "Avvio del backend con l'immagine ${TAG} fallito: avviarlo a mano con TAG=${TAG} '${DC[*]} up -d --no-deps backend'"
IMMAGINE="$("${DC[@]}" ps --format '{{.Image}}' backend 2>/dev/null | tr -d '\r' | head -n 1)" || IMMAGINE=""
if [[ -n "${IMMAGINE}" && "${IMMAGINE}" != *":${TAG}" ]]; then
  die "Il backend gira con l'immagine ${IMMAGINE}, non con il tag ${TAG}"
fi
if [[ -z "${IMMAGINE}" ]]; then
  # Non è un errore (il backend è stato ricreato), ma il controllo del tag non c'è stato.
  log "ATTENZIONE: immagine del backend non rilevata da '${DC[*]} ps': verificare a mano che giri il tag ${TAG}."
fi
log "Backend avviato con l'immagine: ${IMMAGINE:-non rilevata (atteso tag ${TAG})}"

if [[ "${ESISTE}" -ge 1 ]]; then
  log "Ripristino completato con l'immagine ${TAG}. Il database precedente è ${DB_PRECEDENTE}: eliminarlo a mano dopo la verifica (DROP DATABASE \"${DB_PRECEDENTE}\")."
else
  log "Ripristino completato con l'immagine ${TAG}. Non c'era un database precedente da conservare."
fi
echo ""
echo "Verifica rapida:"
echo "  curl -s https://rifiuti.ignicraft.com/api/v1/health | jq .status"
