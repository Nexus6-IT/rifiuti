#!/usr/bin/env bash
# ==============================================================================
# scripts/infra-prod/deploy.sh — deploy di rifiuti sul server infra-prod
# ------------------------------------------------------------------------------
# Uso (come utente di deploy `rifiuti`, nel clone <root>/site, gia' sul commit giusto):
#   bash scripts/infra-prod/deploy.sh sha-1a2b3c4
# Lo lancia .gitea/workflows/deploy-infra-prod.yml via SSH. NON usa root e NON tocca il
# deploy verso il VPS Contabo (deploy.yml). Se il deploy fallisce DOPO la
# scrittura del TAG, riporta il TAG precedente e rialza lo stack (ripristino automatico, senza
# pull: serve l'immagine precedente in cache locale) e scrive diagnostica e log in $STACK_DIR/deploy.log.
# Le migration sono forward-only e NON si annullano: vanno scritte in modo additivo.
# Passi: validazione .env -> TAG nel .env -> pull -> postgres/redis su -> backup predeploy
#        verificato -> migration (owner) -> ruoli DB -> up -> smoke test.
# Variabili (default): STACK_DIR=/opt/rifiuti, ENV_FILE=$STACK_DIR/.env.prod, DEPLOY_LOG=$STACK_DIR/deploy.log,
#   SMOKE_TENTATIVI=30, SMOKE_PAUSA=3
# ==============================================================================
set -euo pipefail

TAG="${1:-}"
[[ "$TAG" =~ ^sha-[0-9a-f]{7,}$ ]] || { echo "uso: deploy.sh sha-<7+ esadecimali> (mai latest)" >&2; exit 2; }

CODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="${STACK_DIR:-/opt/rifiuti}"
ENV_FILE="${ENV_FILE:-$STACK_DIR/.env.prod}"
COMPOSE_FILE="$CODE_DIR/docker-compose.infra-prod.yml"
API_PORT="${API_PORT:-3040}"
APP_PORT="${APP_PORT:-3041}"
DEPLOY_LOG="${DEPLOY_LOG:-$STACK_DIR/deploy.log}"
SMOKE_TENTATIVI="${SMOKE_TENTATIVI:-30}"
SMOKE_PAUSA="${SMOKE_PAUSA:-3}"

[ "$(id -u)" -ne 0 ] || { echo "ERRORE: il deploy non si lancia come root" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "ERRORE: $ENV_FILE non esiste" >&2; exit 1; }

bash "$CODE_DIR/scripts/infra-prod/validate-env.sh" --primo-avvio "$ENV_FILE"

COMPOSE=(docker compose -p rifiuti --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

# TAG: sostituzione atomica che conserva proprietario e permessi (600).
TAG_PRECEDENTE="$(grep -E '^TAG=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
# Il segnaposto dell'esempio (sha-0000000) non e' un tag mai rilasciato: nessun ripristino possibile.
[[ "$TAG_PRECEDENTE" =~ ^sha-0+$ ]] && TAG_PRECEDENTE=""
tmp=""
TAG_SCRITTO=0

registra() { # messaggio su stderr e nel log persistente (se scrivibile)
  local riga; riga="$(date -Is) deploy $TAG: $*"
  echo "$riga" >&2
  { echo "$riga" >> "$DEPLOY_LOG"; } 2>/dev/null || true
}
scrivi_tag() { # sostituzione atomica: temporaneo nella stessa cartella, verificato, poi mv (600)
  tmp="$(mktemp "$ENV_FILE.XXXXXX")" || { tmp=""; return 1; }
  # I passi sono legati con && perche' nel ripristino set -e e' spento: a disco pieno un
  # temporaneo troncato NON deve mai sostituire .env.prod.
  # grep esce 1 se non resta nessuna riga (legittimo), 2 se errore (anche di scrittura): solo 1 e' ammesso.
  if { grep -vE '^TAG=' "$ENV_FILE" || [ $? -eq 1 ]; echo "TAG=$1"; } > "$tmp" \
     && [ -s "$tmp" ] \
     && [ "$(grep -cvE '^TAG=' "$tmp")" -eq "$(grep -cvE '^TAG=' "$ENV_FILE" || true)" ] && grep -qxF "TAG=$1" "$tmp" \
     && chmod 600 "$tmp" && mv -f "$tmp" "$ENV_FILE"; then
    tmp=""
  else
    rm -f "$tmp"; tmp=""; return 1
  fi
}
# Ad ogni uscita con errore dopo la scrittura del TAG: diagnostica e ripristino. Va in trap EXIT
# (e non in un `if !`) perche' dentro un `if` set -e e' sospeso e un passo fallito non fermerebbe nulla.
alla_fine() {
  local rc=$?
  [ -z "$tmp" ] || rm -f "$tmp"
  if [ "$rc" -ne 0 ] && [ "$TAG_SCRITTO" -eq 1 ]; then
    set +e
    registra "FALLITO (uscita $rc); stato dei container e log recenti qui sotto"
    { "${COMPOSE[@]}" ps; "${COMPOSE[@]}" logs --since 10m --tail 100 backend frontend; } 2>&1 | tee -a "$DEPLOY_LOG" >&2
    if [ -n "$TAG_PRECEDENTE" ] && [ "$TAG_PRECEDENTE" != "$TAG" ]; then
      registra "ripristino del tag precedente $TAG_PRECEDENTE (le migration gia' applicate restano)"
      if ! scrivi_tag "$TAG_PRECEDENTE"; then
        registra "RIPRISTINO FALLITO: TAG non riscritto in $ENV_FILE (disco pieno?), file originale intatto; intervento manuale"
      elif "${COMPOSE[@]}" up -d --remove-orphans >> "$DEPLOY_LOG" 2>&1; then
        registra "ripristino riuscito: in esecuzione $TAG_PRECEDENTE"
      else
        registra "RIPRISTINO FALLITO: intervento manuale (produzione potenzialmente ferma)"
      fi
    else
      registra "nessun tag precedente da ripristinare"
    fi
  fi
  exit "$rc"
}
trap alla_fine EXIT

scrivi_tag "$TAG"; TAG_SCRITTO=1
echo "TAG ${TAG_PRECEDENTE:-nessuno} -> $TAG"

bash "$CODE_DIR/scripts/infra-prod/validate-env.sh" "$ENV_FILE"


# Solo le nostre immagini: postgres/redis si aggiornano con un intervento deciso, backup prima.
"${COMPOSE[@]}" pull backend frontend
"${COMPOSE[@]}" up -d --wait postgres redis

# Backup verificato prima delle migration: se fallisce, set -e ferma tutto e la produzione
# resta sulla versione precedente (dentro <root>/backups/postgres: scrivibile dall'utente di deploy).
BACKUP_MODALITA=predeploy BACKUP_STAGING_DIR="$STACK_DIR/backups/postgres" \
  WASTEFLOW_ENV_FILE="$ENV_FILE" WASTEFLOW_COMPOSE_FILE="$COMPOSE_FILE" \
  PG_EXEC="docker exec -i rifiuti-postgres-prod" bash "$CODE_DIR/scripts/backup/backup-offsite.sh"

# Migration Prisma SEMPRE come owner (DATABASE_URL_MIGRAZIONI); le virgolette singole fanno
# espandere la variabile dentro il container.
"${COMPOSE[@]}" run --rm --no-deps backend sh -c 'DATABASE_URL="$DATABASE_URL_MIGRAZIONI" npx prisma migrate deploy'

# Ruoli DB, DOPO le migration. Senza password nel .env stampa "salto"; a meta' si ferma.
RUOLI_ENV_FILE="$ENV_FILE" PG_EXEC="docker exec -i rifiuti-postgres-prod" bash "$CODE_DIR/ops/db-ruoli.sh"

"${COMPOSE[@]}" up -d --remove-orphans

for i in $(seq 1 "$SMOKE_TENTATIVI"); do
  if curl -fsS --max-time 10 "http://127.0.0.1:$API_PORT/api/v1/health/db" >/dev/null \
     && curl -fsS --max-time 10 "http://127.0.0.1:$APP_PORT/" >/dev/null; then
    registra "Deploy OK (precedente: ${TAG_PRECEDENTE:-nessuno})"
    echo "Deploy OK (tag $TAG)"
    TAG_SCRITTO=0
    exit 0
  fi
  sleep "$SMOKE_PAUSA"
done
echo "Smoke test fallito dopo $SMOKE_TENTATIVI tentativi" >&2
exit 1
