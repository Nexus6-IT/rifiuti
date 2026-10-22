#!/usr/bin/env bash
# ==============================================================================
# ops/test/backup-verifica.test.sh — test della libreria di verifica dei backup
# ==============================================================================
# Senza -e di proposito: ogni caso e' contato, un fallimento non ferma gli altri.
# Parte senza database sempre; la parte con PostgreSQL gira solo se PG_EXEC e' impostata
# (es. PG_EXEC="docker exec -i pg-backup-prova").
# ==============================================================================
set -uo pipefail

RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# shellcheck source=../lib/backup-verifica.sh
source "$RADICE/ops/lib/backup-verifica.sh"

RIUSCITI=0
FALLITI=0

# verifica NOME ESITO_ATTESO COMANDO... — confronta l'exit code con quello atteso
# (0 = deve riuscire, 1 = deve fallire con qualunque codice diverso da zero).
verifica() {
  local nome="$1" atteso="$2"
  shift 2
  "$@" >/dev/null 2>&1
  local esito=$?
  local ok=0
  if [ "$atteso" = "0" ]; then
    [ "$esito" -eq 0 ] && ok=1
  else
    [ "$esito" -ne 0 ] && ok=1
  fi
  if [ "$ok" -eq 1 ]; then
    echo "OK: $nome"
    RIUSCITI=$((RIUSCITI + 1))
  else
    echo "FALLITO: $nome (exit $esito, atteso $atteso)"
    FALLITI=$((FALLITI + 1))
  fi
}

# ---- Fixture -----------------------------------------------------------------
SQL_BASE=$'-- dump di prova\nCREATE TABLE t (id int);\nINSERT INTO t VALUES (1);\n'
printf '%s%s\n\n' "$SQL_BASE" "$MARCATORE_DUMP" | gzip > "$TMP/completo.sql.gz"
printf '%s' "$SQL_BASE" | gzip > "$TMP/troncato.sql.gz"
head -c 20 "$TMP/completo.sql.gz" > "$TMP/corrotto.sql.gz"
: > "$TMP/vuoto.sql.gz"

# ---- Test senza database -----------------------------------------------------
verifica "accetta un dump completo" 0 verifica_completezza_dump "$TMP/completo.sql.gz"
verifica "rifiuta un gzip valido senza marcatore finale" 1 verifica_completezza_dump "$TMP/troncato.sql.gz"
verifica "rifiuta un gzip corrotto" 1 verifica_completezza_dump "$TMP/corrotto.sql.gz"
verifica "rifiuta un file vuoto" 1 verifica_completezza_dump "$TMP/vuoto.sql.gz"

printf 'DB_NAME="wf_prod"\n' > "$TMP/env1"
verifica "leggi_env legge il valore e toglie le virgolette" 0 \
  test "$(leggi_env "$TMP/env1" DB_NAME)" = "wf_prod"

printf 'DB_USER=primo\nDB_USER=secondo\n' > "$TMP/env2"
verifica "leggi_env usa l'ultima occorrenza e il default" 0 \
  bash -c 'source "$1"; [ "$(leggi_env "$2" DB_USER)" = secondo ] && [ "$(leggi_env "$2" ASSENTE fallback)" = fallback ]' \
  _ "$RADICE/ops/lib/backup-verifica.sh" "$TMP/env2"

printf 'X=$(touch %s/eseguito)\n' "$TMP" > "$TMP/env3"
leggi_env "$TMP/env3" X >/dev/null 2>&1
verifica "leggi_env non esegue il file" 1 test -e "$TMP/eseguito"

printf 'DB_NAME=wf_prova\nDB_USER=wasteflow\n' > "$TMP/env-finto"
mkdir -p "$TMP/staging-pre"
PG_EXEC=false BACKUP_MODALITA=predeploy WASTEFLOW_ENV_FILE="$TMP/env-finto" \
  BACKUP_STAGING_DIR="$TMP/staging-pre" bash "$RADICE/ops/backup-offsite.sh" >/dev/null 2>&1
ESITO_PRE=$?
verifica "predeploy: esce non zero se il dump fallisce" 0 test "$ESITO_PRE" -ne 0
verifica "predeploy: nessun .sql.gz al nome finale dopo il fallimento" 1 \
  bash -c 'ls "$1"/*.sql.gz >/dev/null 2>&1' _ "$TMP/staging-pre"

# esito_e_messaggio ESITO_ATTESO MESSAGGIO FUNZIONE ARGS... — la funzione della libreria
# esce con ESITO_ATTESO e (se MESSAGGIO non e' vuoto) scrive MESSAGGIO su stderr.
# Gira in una shell nuova: se la funzione non esiste l'esito e' 127 e il caso fallisce.
esito_e_messaggio() {
  bash -c 'source "$1"; atteso="$2"; msg="$3"; shift 3; "$@" 2> "$ERRFILE" >/dev/null; e=$?
    [ "$e" -eq "$atteso" ] && { [ -z "$msg" ] || grep -qF -- "$msg" "$ERRFILE"; }' \
    _ "$RADICE/ops/lib/backup-verifica.sh" "$@"
}
export ERRFILE="$TMP/err-lib"
printf '%s%s\n\n' "$SQL_BASE" "$MARCATORE_DUMP" > "$TMP/completo.sql"
printf '%s' "$SQL_BASE" > "$TMP/senza-marcatore.sql"
: > "$TMP/vuoto.sql"
verifica "verifica_completezza_sql accetta un .sql completo" 0 esito_e_messaggio 0 '' verifica_completezza_sql "$TMP/completo.sql"
verifica "verifica_completezza_sql rifiuta un .sql vuoto" 0 esito_e_messaggio 1 'file vuoto' verifica_completezza_sql "$TMP/vuoto.sql"
verifica "verifica_completezza_sql rifiuta un .sql senza marcatore" 0 \
  esito_e_messaggio 1 'marcatore finale assente' verifica_completezza_sql "$TMP/senza-marcatore.sql"
verifica "valida_fattore_spazio accetta 2" 0 esito_e_messaggio 0 '' valida_fattore_spazio X 2
verifica "valida_fattore_spazio rifiuta 0" 0 esito_e_messaggio 1 'X non valido' valida_fattore_spazio X 0
verifica "valida_fattore_spazio rifiuta un non numero" 0 esito_e_messaggio 1 'X non valido' valida_fattore_spazio X 2x
verifica "valida_fattore_spazio rifiuta 8 cifre" 0 esito_e_messaggio 1 'X non valido' valida_fattore_spazio X 12345678

# ---- restore.sh con il compose finto ---------------------------------------------
# esegui_restore NOME FILE [VAR=valore ...] — restore.sh con il compose finto (ogni
# chiamata finisce in $TMP/dc-NOME.log, nessun docker vero), stdout in $TMP/out-NOME,
# stderr in $TMP/err-NOME, esito in $TMP/esito-NOME. Il compose file punta a un file
# inesistente: se lo script ignorasse WASTEFLOW_DC, docker compose fallirebbe subito.
esegui_restore() {
  local nome="$1" file="$2"
  shift 2
  : > "$TMP/dc-$nome.log"
  env -u RIPRISTINO_TAG -u FINTO_DC_RUN_FALLISCE -u RIPRISTINO_FATTORE_SPAZIO \
    WASTEFLOW_DC="bash $RADICE/ops/test/finto-dc.sh" FINTO_DC_LOG="$TMP/dc-$nome.log" \
    WASTEFLOW_COMPOSE_FILE="$TMP/nessun-compose.yml" RIPRISTINO_CONFERMATO=YES BACKUP_DATI_DIR="$TMP" "$@" \
    bash "$RADICE/ops/restore.sh" "$file" > "$TMP/out-$nome" 2> "$TMP/err-$nome"
  echo $? > "$TMP/esito-$nome"
}
# esito_non_zero NOME — il ripristino NOME e' uscito con un codice diverso da zero.
esito_non_zero() { [ "$(cat "$TMP/esito-$1")" -ne 0 ]; }

# Casi negativi senza database: PG_EXEC=false e un database di nome fittizio. Ognuno deve
# uscire con il suo messaggio e senza aver mai fermato il backend.
printf 'DB_NAME=prova_restore_fittizio\nDB_USER=wasteflow\n' > "$TMP/env-restore-finto"
cp "$TMP/completo.sql.gz" "$TMP/x.sql.gz.non-verificato"
esegui_restore nonver "$TMP/x.sql.gz.non-verificato" PG_EXEC=false RIPRISTINO_TAG=sha-prova \
  WASTEFLOW_ENV_FILE="$TMP/env-restore-finto"
verifica "restore: rifiuta un .non-verificato" 0 esito_non_zero nonver
verifica "restore: .non-verificato, messaggio Formato non ammesso" 0 grep -q 'Formato non ammesso' "$TMP/err-nonver"
verifica "restore: .non-verificato senza fermare il backend" 1 grep -q 'stop backend' "$TMP/dc-nonver.log"

esegui_restore tronc "$TMP/troncato.sql.gz" PG_EXEC=false RIPRISTINO_TAG=sha-prova \
  WASTEFLOW_ENV_FILE="$TMP/env-restore-finto"
verifica "restore: dump troncato rifiutato" 0 esito_non_zero tronc
verifica "restore: dump troncato, messaggio Dump non utilizzabile" 0 \
  grep -q 'Dump non utilizzabile: marcatore finale assente' "$TMP/err-tronc"
verifica "restore: dump troncato, nessuno stop" 1 grep -q 'stop backend' "$TMP/dc-tronc.log"

esegui_restore sqlko "$TMP/senza-marcatore.sql" PG_EXEC=false RIPRISTINO_TAG=sha-prova \
  WASTEFLOW_ENV_FILE="$TMP/env-restore-finto"
verifica "restore: .sql senza marcatore rifiutato" 0 esito_non_zero sqlko
verifica "restore: .sql senza marcatore, messaggio Dump non utilizzabile" 0 grep -q 'Dump non utilizzabile' "$TMP/err-sqlko"
verifica "restore: .sql senza marcatore, nessuno stop" 1 grep -q 'stop backend' "$TMP/dc-sqlko.log"

esegui_restore notag "$TMP/completo.sql.gz" PG_EXEC=false WASTEFLOW_ENV_FILE="$TMP/env-restore-finto"
verifica "restore: senza RIPRISTINO_TAG non parte" 0 esito_non_zero notag
verifica "restore: senza RIPRISTINO_TAG, messaggio" 0 grep -q 'RIPRISTINO_TAG obbligatoria' "$TMP/err-notag"
verifica "restore: senza RIPRISTINO_TAG, nessuno stop" 1 grep -q 'stop backend' "$TMP/dc-notag.log"

esegui_restore fattore "$TMP/completo.sql.gz" PG_EXEC=false RIPRISTINO_TAG=sha-prova RIPRISTINO_FATTORE_SPAZIO=0 \
  WASTEFLOW_ENV_FILE="$TMP/env-restore-finto"
verifica "restore: fattore di spazio non valido, messaggio" 0 grep -q 'RIPRISTINO_FATTORE_SPAZIO non valido' "$TMP/err-fattore"
verifica "restore: fattore di spazio non valido, nessuno stop" 1 grep -q 'stop backend' "$TMP/dc-fattore.log"

verifica "verifica_spazio_libero accetta 1 byte" 0 verifica_spazio_libero "$TMP" 1
verifica "verifica_spazio_libero rifiuta un'enormita'" 1 verifica_spazio_libero "$TMP" 999999999999999999

verifica "restore.sh: sintassi valida" 0 bash -n "$RADICE/ops/restore.sh"
verifica "restore.sh usa il compose del deploy" 0 grep -q '/opt/rifiuti/site/docker-compose.prod.yml' "$RADICE/ops/restore.sh"
verifica "restore.sh non fa source del .env" 1 grep -Eq '^[^#]*(source|\. )[^#]*\.env' "$RADICE/ops/restore.sh"
verifica "restore.sh non richiede DB_PASSWORD" 1 grep -q 'DB_PASSWORD:?' "$RADICE/ops/restore.sh"
verifica "backup-offsite.sh usa il compose del deploy" 0 grep -q '/opt/rifiuti/site/docker-compose.prod.yml' "$RADICE/ops/backup-offsite.sh"

# Ogni invocazione di "docker compose" (righe logiche, con le continuazioni unite)
# deve passare --env-file: il compose di produzione richiede variabili obbligatorie
# e le interpola anche per "exec" (altrimenti backup e restore si rompono).
compose_senza_env_file() {
  awk '
    { riga = $0; sub(/^[ \t]+/, "", riga) }
    riga ~ /^#/ { next }
    { buf = buf " " riga }
    /\\[ \t]*$/ { sub(/\\[ \t]*$/, "", buf); next }
    { if (buf ~ /docker compose/ && buf !~ /--env-file/) { print buf; bad = 1 } buf = "" }
    END { exit bad }
  ' "$1"
}
for f in ops/backup-offsite.sh ops/restore.sh ops/lib/backup-verifica.sh; do
  verifica "$f: ogni docker compose ha --env-file" 0 compose_senza_env_file "$RADICE/$f"
done

# ---- Test con PostgreSQL finto (stub) ----------------------------------------
# Lo stub risponde ai soli comandi usati da backup-offsite.sh. Variabili:
#   FAKE_DROP_FAIL=1  il DROP DATABASE esce con errore
#   FAKE_DUMP_FAIL=1  pg_dump scrive un po' di output e poi esce con errore
cat > "$TMP/fakepg.sh" <<'STUB'
#!/usr/bin/env bash
tutti="$*"
case "$tutti" in
  pg_dump*)
    printf -- '-- dump finto\nCREATE TABLE t (id int);\n'
    if [ "${FAKE_DUMP_FAIL:-0}" = "1" ]; then exit 1; fi
    printf -- '-- PostgreSQL database dump complete\n\n'
    ;;
  *pg_database_size*) echo 1000 ;;
  *"DROP DATABASE"*) if [ "${FAKE_DROP_FAIL:-0}" = "1" ]; then echo "drop negato" >&2; exit 1; fi ;;
  *"CREATE DATABASE"*) ;;
  *"SELECT count"*) echo 3 ;;
  *) cat >/dev/null ;;
esac
exit 0
STUB
mkdir -p "$TMP/bin"
cat > "$TMP/bin/msmtp" <<'STUB'
#!/usr/bin/env bash
cat >> "$MAIL_FILE"
STUB
chmod +x "$TMP/fakepg.sh" "$TMP/bin/msmtp"
printf 'DB_NAME=wf_stub\nDB_USER=wasteflow\n' > "$TMP/env-stub"

# esegui_stub STAGING [VAR=valore ...] — backup notturno con lo stub; l'output va in
# $TMP/out-STAGING e le mail (msmtp finto) in $TMP/mail-STAGING. La cartella di staging
# viene creata dallo script stesso, salvo che esista gia'.
esegui_stub() {
  local staging="$1"
  shift
  : > "$TMP/mail-$staging"
  env PATH="$TMP/bin:$PATH" MAIL_FILE="$TMP/mail-$staging" PG_EXEC="bash $TMP/fakepg.sh" \
    BACKUP_MODALITA=notturno BACKUP_ALERT_EMAIL=prova@example.com BACKUP_DATI_DIR="$TMP" \
    WASTEFLOW_ENV_FILE="$TMP/env-stub" BACKUP_STAGING_DIR="$TMP/$staging" "$@" \
    bash "$RADICE/ops/backup-offsite.sh" > "$TMP/out-$staging" 2>&1
}

# Finding 1: DROP fallito dopo un ripristino riuscito -> dump accettato, avviso nel log e mail.
esegui_stub staging-drop FAKE_DROP_FAIL=1 OFFSITE_MODE=disabled
ESITO_DROP=$?
verifica "DROP fallito: il backup esce 0 (dump accettato)" 0 test "$ESITO_DROP" -eq 0
verifica "DROP fallito: un dump al nome finale" 0 \
  bash -c 'n=$(ls "$1"/wasteflow_wf_stub_*.sql.gz 2>/dev/null | wc -l); [ "$n" -eq 1 ]' _ "$TMP/staging-drop"
verifica "DROP fallito: l'avviso e' nel log" 0 grep -q 'ATTENZIONE.*eliminazione del database temporaneo' "$TMP/out-staging-drop"
verifica "DROP fallito: parte la mail di avviso" 0 grep -q 'database temporaneo non eliminato' "$TMP/mail-staging-drop"

esegui_stub staging-ok OFFSITE_MODE=disabled
verifica "senza errori: nessuna mail" 0 test ! -s "$TMP/mail-staging-ok"

# Finding 2: permessi (significativi solo su filesystem POSIX).
( umask 077; : > "$TMP/prova-permessi" )
if [ "$(stat -c %a "$TMP/prova-permessi" 2>/dev/null)" = "600" ]; then
  verifica "dump in staging solo per il proprietario (600)" 0 \
    bash -c 'for f in "$1"/wasteflow_wf_stub_*.sql.gz; do [ "$(stat -c %a "$f")" = "600" ] || exit 1; done' _ "$TMP/staging-ok"
  verifica "cartella di staging creata dallo script: 700" 0 test "$(stat -c %a "$TMP/staging-ok")" = "700"
else
  echo "SALTATI: permessi dei dump (filesystem senza permessi POSIX, es. Git Bash su NTFS)"
fi

# Finding 3: OFFSITE_MODE di default disabled, letto dal .env, l'ambiente vince.
esegui_stub staging-def
verifica "OFFSITE_MODE assente ovunque: default disabled" 0 grep -q 'Copia off-site disabilitata' "$TMP/out-staging-def"
printf 'DB_NAME=wf_stub\nDB_USER=wasteflow\nOFFSITE_MODE=rsync\n' > "$TMP/env-rsync"
env -u OFFSITE_MODE PATH="$TMP/bin:$PATH" MAIL_FILE="$TMP/m" PG_EXEC="bash $TMP/fakepg.sh" BACKUP_MODALITA=notturno \
  BACKUP_DATI_DIR="$TMP" WASTEFLOW_ENV_FILE="$TMP/env-rsync" BACKUP_STAGING_DIR="$TMP/staging-rsync" \
  bash "$RADICE/ops/backup-offsite.sh" > "$TMP/out-rsync" 2>&1
verifica "OFFSITE_MODE=rsync nel .env viene letto (senza RSYNC_TARGET fallisce)" 0 grep -q 'RSYNC_TARGET non impostato' "$TMP/out-rsync"
env PATH="$TMP/bin:$PATH" MAIL_FILE="$TMP/m" PG_EXEC="bash $TMP/fakepg.sh" BACKUP_MODALITA=notturno OFFSITE_MODE=disabled \
  BACKUP_DATI_DIR="$TMP" WASTEFLOW_ENV_FILE="$TMP/env-rsync" BACKUP_STAGING_DIR="$TMP/staging-envvince" \
  bash "$RADICE/ops/backup-offsite.sh" > "$TMP/out-envvince" 2>&1
verifica "l'ambiente vince sul .env" 0 grep -q 'Copia off-site disabilitata' "$TMP/out-envvince"

# Finding 4: pg_dump fallito -> .parziale rinominato in .scartato; parziali vecchi ruotati.
esegui_stub staging-dumpko FAKE_DUMP_FAIL=1 OFFSITE_MODE=disabled
ESITO_DUMPKO=$?
verifica "pg_dump fallito: esce non zero" 0 test "$ESITO_DUMPKO" -ne 0
verifica "pg_dump fallito: nessun .parziale rimasto" 1 \
  bash -c 'ls "$1"/*.parziale >/dev/null 2>&1' _ "$TMP/staging-dumpko"
verifica "pg_dump fallito: un .scartato" 0 \
  bash -c 'ls "$1"/*.sql.gz.scartato >/dev/null 2>&1' _ "$TMP/staging-dumpko"

mkdir -p "$TMP/staging-rot"
: > "$TMP/staging-rot/wasteflow_wf_stub_20200101_000000.sql.gz.parziale"
: > "$TMP/staging-rot/wasteflow_wf_stub_20990101_000000.sql.gz.parziale"
touch -d '10 days ago' "$TMP/staging-rot/wasteflow_wf_stub_20200101_000000.sql.gz.parziale"
esegui_stub staging-rot OFFSITE_MODE=disabled
verifica "rotazione: .parziale vecchio eliminato" 1 test -e "$TMP/staging-rot/wasteflow_wf_stub_20200101_000000.sql.gz.parziale"
verifica "rotazione: .parziale recente conservato" 0 test -e "$TMP/staging-rot/wasteflow_wf_stub_20990101_000000.sql.gz.parziale"

# ---- Test con database -------------------------------------------------------
if [ -z "${PG_EXEC:-}" ]; then
  echo "salto i test con PostgreSQL: PG_EXEC non impostata"
else
  DB_USER="${PG_TEST_USER:-wasteflow}"
  DB="${PG_TEST_DB:-wasteflow_ci}"
  export PG_EXEC

  pg_exec pg_dump -U "$DB_USER" "$DB" | gzip > "$TMP/reale.sql.gz"
  verifica "dump reale completo e ripristino di prova riuscito" 0 \
    bash -c 'source "$1"; verifica_completezza_dump "$2" && ripristino_di_prova "$2" "$3" "$4"' \
    _ "$RADICE/ops/lib/backup-verifica.sh" "$TMP/reale.sql.gz" "$DB_USER" "$DB"

  # copia con un comando che fallisce, inserito prima del marcatore
  gzip -dc "$TMP/reale.sql.gz" | grep -vF -- "$MARCATORE_DUMP" > "$TMP/rotto.sql"
  printf 'SELECT * FROM tabella_che_non_esiste;\n%s\n' "$MARCATORE_DUMP" >> "$TMP/rotto.sql"
  gzip -c "$TMP/rotto.sql" > "$TMP/rotto.sql.gz"
  verifica "ripristino fallito: ritorna 1" 1 ripristino_di_prova "$TMP/rotto.sql.gz" "$DB_USER" "$DB"
  verifica "ripristino fallito: il database temporaneo viene eliminato" 0 \
    test "$(pg_exec psql -U "$DB_USER" -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'wasteflow_verifica_%'" | tr -d '[:space:]')" = "0"

  printf 'DB_NAME=%s\nDB_USER=%s\n' "$DB" "$DB_USER" > "$TMP/env-db"
  mkdir -p "$TMP/staging-notte"
  BACKUP_MODALITA=notturno OFFSITE_MODE=disabled BACKUP_ALERT_EMAIL=nessuno BACKUP_DATI_DIR="$TMP" \
    WASTEFLOW_ENV_FILE="$TMP/env-db" BACKUP_STAGING_DIR="$TMP/staging-notte" \
    bash "$RADICE/ops/backup-offsite.sh" >/dev/null 2>&1
  ESITO_NOTTE=$?
  verifica "notturno con PG_EXEC reale: exit 0" 0 test "$ESITO_NOTTE" -eq 0
  verifica "notturno: un file verificato e nessun .parziale" 0 \
    bash -c 'n=$(ls "$1"/wasteflow_"$2"_*.sql.gz 2>/dev/null | wc -l); [ "$n" -eq 1 ] && ! ls "$1"/*.parziale >/dev/null 2>&1' \
    _ "$TMP/staging-notte" "$DB"

  mkdir -p "$TMP/staging-spazio"
  BACKUP_MODALITA=notturno OFFSITE_MODE=disabled BACKUP_ALERT_EMAIL=nessuno BACKUP_DATI_DIR="$TMP" \
    BACKUP_FATTORE_SPAZIO_RIPRISTINO=1000000000000 \
    WASTEFLOW_ENV_FILE="$TMP/env-db" BACKUP_STAGING_DIR="$TMP/staging-spazio" \
    bash "$RADICE/ops/backup-offsite.sh" >/dev/null 2>&1
  ESITO_SPAZIO=$?
  verifica "notturno senza spazio: esce non zero" 0 test "$ESITO_SPAZIO" -ne 0
  verifica "notturno senza spazio: nessun file al nome finale, uno .non-verificato" 0 \
    bash -c '! ls "$1"/wasteflow_"$2"_*.sql.gz >/dev/null 2>&1 && ls "$1"/*.non-verificato >/dev/null 2>&1' \
    _ "$TMP/staging-spazio" "$DB"
  verifica "notturno senza spazio: nessun database wasteflow_verifica_%" 0 \
    test "$(pg_exec psql -U "$DB_USER" -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'wasteflow_verifica_%'" | tr -d '[:space:]')" = "0"

  # ---- restore.sh su un database di prova creato qui (mai wasteflow_ci) ----------
  # sql_pg DB SQL — esegue SQL sul database DB e stampa il risultato senza spazi.
  sql_pg() { pg_exec psql -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 -Atc "$2" 2>/dev/null | tr -d '[:space:]'; }
  # elenco_prova_restore — i nomi dei database prova_restore%, uno per riga.
  elenco_prova_restore() {
    pg_exec psql -U "$DB_USER" -d postgres -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'prova\\_restore%'" 2>/dev/null | tr -d '\r'
  }
  # elimina_prova_restore — elimina ogni database prova_restore% (creati solo da questi casi).
  elimina_prova_restore() {
    local d
    for d in $(elenco_prova_restore); do
      pg_exec psql -U "$DB_USER" -d postgres -qAtc "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE)" >/dev/null 2>&1
    done
  }
  elimina_prova_restore
  pg_exec psql -U "$DB_USER" -d postgres -qAtc 'CREATE DATABASE prova_restore' >/dev/null
  pg_exec psql -U "$DB_USER" -d prova_restore -v ON_ERROR_STOP=1 -q >/dev/null <<'SQL'
CREATE TABLE t_prova (id int);
INSERT INTO t_prova VALUES (1);
CREATE TABLE _prisma_migrations (id text);
INSERT INTO _prisma_migrations VALUES ('m1');
SQL
  printf 'DB_NAME=prova_restore\nDB_USER=%s\n' "$DB_USER" > "$TMP/env-restore"
  pg_exec pg_dump -U "$DB_USER" prova_restore | gzip > "$TMP/prova_restore.sql.gz"
  gzip -dc "$TMP/prova_restore.sql.gz" > "$TMP/prova_restore.sql"

  printf 'CREATE TABLE a(id int);\nSELEC 1;\n%s\n' "$MARCATORE_DUMP" | gzip > "$TMP/istruzione-rotta.sql.gz"
  esegui_restore rotta "$TMP/istruzione-rotta.sql.gz" RIPRISTINO_TAG=sha-prova WASTEFLOW_ENV_FILE="$TMP/env-restore"
  verifica "restore: istruzione rotta, esce non zero" 0 esito_non_zero rotta
  verifica "restore: istruzione rotta, produzione intatta" 0 test "$(sql_pg prova_restore 'SELECT count(*) FROM t_prova')" = "1"
  verifica "restore: istruzione rotta, nessun database temporaneo" 0 \
    test "$(sql_pg postgres "SELECT count(*) FROM pg_database WHERE datname LIKE 'prova_restore_ripristino_%'")" = "0"
  verifica "restore: istruzione rotta, backend fermato e riavviato" 0 \
    bash -c 'grep -q "stop backend" "$1" && grep -q "start backend" "$1"' _ "$TMP/dc-rotta.log"
  verifica "restore: istruzione rotta, messaggio produzione intatta" 0 \
    grep -q 'Ripristino NON riuscito (esito 1): il database di produzione è intatto' "$TMP/err-rotta"

  esegui_restore valido "$TMP/prova_restore.sql.gz" RIPRISTINO_TAG=sha-prova WASTEFLOW_ENV_FILE="$TMP/env-restore"
  verifica "restore: dump valido, esce 0" 0 test "$(cat "$TMP/esito-valido")" -eq 0
  verifica "restore: dump valido, il precedente resta come prova_restore_prima_del_ripristino_*" 0 \
    test "$(sql_pg postgres "SELECT count(*) FROM pg_database WHERE datname LIKE 'prova_restore_prima_del_ripristino_%'")" = "1"
  verifica "restore: dump valido, il ripristinato ha i dati" 0 test "$(sql_pg prova_restore 'SELECT count(*) FROM t_prova')" = "1"
  verifica "restore: dump valido, nessun database temporaneo" 0 \
    test "$(sql_pg postgres "SELECT count(*) FROM pg_database WHERE datname LIKE 'prova_restore_ripristino_%'")" = "0"
  verifica "restore: dump valido, migrate con il tag" 0 \
    grep -q 'TAG=sha-prova run --rm backend npx prisma migrate deploy' "$TMP/dc-valido.log"
  verifica "restore: dump valido, backend riavviato" 0 grep -q 'start backend' "$TMP/dc-valido.log"

  esegui_restore validosql "$TMP/prova_restore.sql" RIPRISTINO_TAG=sha-prova WASTEFLOW_ENV_FILE="$TMP/env-restore"
  verifica "restore: .sql decompresso valido, esce 0" 0 test "$(cat "$TMP/esito-validosql")" -eq 0
  verifica "restore: .sql decompresso, due database precedenti distinti" 0 \
    test "$(sql_pg postgres "SELECT count(*) FROM pg_database WHERE datname LIKE 'prova_restore_prima_del_ripristino_%'")" = "2"

  esegui_restore migrateko "$TMP/prova_restore.sql.gz" RIPRISTINO_TAG=sha-prova FINTO_DC_RUN_FALLISCE=1 \
    WASTEFLOW_ENV_FILE="$TMP/env-restore"
  verifica "restore: migrate fallito esce non zero" 0 esito_non_zero migrateko
  verifica "restore: migrate fallito, il migrate e' stato eseguito" 0 grep -q 'run --rm backend' "$TMP/dc-migrateko.log"
  verifica "restore: migrate fallito, messaggio" 0 grep -q "prisma migrate deploy fallito con l'immagine sha-prova" "$TMP/err-migrateko"
  verifica "restore: migrate fallito riavvia il backend" 0 grep -q 'start backend' "$TMP/dc-migrateko.log"

  elimina_prova_restore
  verifica "restore: nessun database prova_restore% residuo" 0 test -z "$(elenco_prova_restore)"
fi

echo "Test riusciti: $RIUSCITI, falliti: $FALLITI"
[ "$FALLITI" -eq 0 ] || exit 1
