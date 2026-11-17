#!/usr/bin/env bash
# Copia di scripts/backup/sync-offsite.sh di Neat (tests/fixtures/neat nel repo infra-prod), identico salvo i default
# STACK_DIR/OFFSITE_PREFIX/LOG_FILE (rifiuti). Lo lancia infra-offsite-sync con le variabili di /etc/infra-backup/offsite-rifiuti.env.
# Gli insiemi si dichiarano in apps.yml (backup.offsite.sets): qui niente di specifico dell applicazione.
# sync-offsite.sh — copia CIFRATA dei backup locali su un object storage UE di un ALTRO
# provider (decisione D4: la copia notturna di database e file non sta sulla stessa VPS ne'
# presso lo stesso provider della produzione).
#
# ══ CIFRATURA (giro 2 di R08, default prudente in attesa di conferma del committente) ════
# TUTTO cio' che va offsite e' cifrato PRIMA dell'invio, a chiave PUBBLICA (age): dump,
# .globals.gz (hash delle password dei ruoli), .counts, redis, archivi dei file, copia del
# bucket MinIO, dump di Keycloak. Sulla VPS sta solo la chiave pubblica (AGE_RECIPIENT o
# AGE_RECIPIENTS_FILE); la privata la custodisce Graziano fuori dalla VPS: il server non puo'
# decifrare cio' che ha mandato. Senza `age` o senza destinatario lo script FALLISCE in modo
# esplicito PRIMA di qualunque operazione remota e non invia nulla in chiaro. L'unica deroga e'
# OFFSITE_ALLOW_PLAINTEXT=yes (solo collaudo, scritta nel log a ogni esecuzione).
# I file gia' cifrati (secrets-*.tar.age / .gpg) partono cosi' come sono.
# Le copie cifrate si preparano in OFFSITE_STAGE_DIR (default $BACKUPS_ROOT/.offsite-stage,
# 700, contiene solo testo cifrato) e si rigenerano solo quando il file locale e' piu' nuovo.
# Il marcatore di fine dump si verifica sul file in chiaro PRIMA di cifrare (sul remoto non
# si puo' leggere: manca la chiave); sul remoto si verifica la rilettura byte per byte
# (sha256 del file remoto = sha256 del file cifrato locale).
#
# ══ DUE TIPI DI INSIEME (formato cartella:nomeRemoto:giorni[:tipo]) ══════════════════════
# series (default)  backup a serie storica: dump, globals, counts, redis, archivi file,
#                   keycloak, segreti. Ritenzione remota PER ETA' (giorni), ma mai sotto
#                   OFFSITE_MIN_COPIES copie valide (default 7; un dump + i suoi gemelli sono
#                   UNA copia) e solo se esiste una copia piu' recente della ritenzione
#                   (se i backup si fermano, l'ultimo buono non viene potato).
# mirror            copia speculare dei file dei clienti (bucket MinIO): un PDF caricato 31
#                   giorni fa e' un dato VIVO, non un backup scaduto. NESSUNA potatura per
#                   eta' sugli oggetti correnti: <remoto>/<nome>/current non invecchia mai.
#                   Una cancellazione (o sovrascrittura) lato sorgente NON si propaga subito:
#                   rclone sync --backup-dir sposta la versione vecchia in
#                   <remoto>/<nome>/deleted/<ts>/ e solo quelle cartelle, dopo `giorni`
#                   (finestra di ritardo, default OFFSITE_MIRROR_GRACE_DAYS=30), vengono
#                   eliminate (l'eta' e' quella del <ts> nel nome, non la data del file).
#                   Guardia: se la sorgente e' vuota (remoto popolato) o si e' ridotta di oltre
#                   OFFSITE_MIRROR_MAX_SHRINK_PCT (default 20; solo con almeno
#                   OFFSITE_MIRROR_GUARD_MIN=20 oggetti sul remoto) il sync si ferma con errore.
#                   Consigliato in piu' il versioning/object lock lato provider.
#
# Insiemi di default (cartelle relative a BACKUPS_ROOT, default $STACK_DIR/backups):
#   postgres, postgres-weekly (90 gg), redis, files, keycloak, secrets (365 gg): series
#   minio/current: mirror
# Ridefinibili con OFFSITE_SETS="cartella:nomeRemoto:giorni[:tipo] ...". Cartella assente =
# avviso, tranne `postgres` = errore (su una VPS senza Postgres di Neat impostare OFFSITE_SETS).
#
# Per ogni insieme: 1) cifra in stage, 2) rclone copy/sync (mai cancellazioni immediate),
# 3) verifica (rclone check + rilettura sha256 del piu' recente), 4) potatura come sopra.
# Se un insieme fallisce lo script esce con 1 (dopo aver provato gli altri).
#
# ══ ELENCHI DEL REMOTO (giro 3) ══════════════════════════════════════════════════════════
# Ogni decisione che cancella o sposta (guardia dello specchio, potatura, scadenza di deleted/)
# si basa su un elenco del remoto. Un elenco FALLITO (rete a tratti, permesso mancante) non e'
# mai letto come "remoto vuoto": l'insieme si ferma con errore e nulla viene cancellato. Solo
# "directory non trovata" (uscita 3 di rclone: primo invio) vale come vuoto. Seconda barriera:
# rclone sync dello specchio gira con --max-delete pari al calo ammesso dalla guardia.
# Copie valide: nella serie conta come copia SOLO un gruppo che contiene il file principale
# (il dump, l'archivio...), non un gruppo fatto dei soli gemelli .globals.gz / .counts.
#
# ══ TEMPI (giro 3) ═══════════════════════════════════════════════════════════════════════
# Prima di tutto una prova di raggiungibilita' della destinazione (OFFSITE_PREFLIGHT_SECONDS,
# default 60): rete assente = errore leggibile ed uscita 1 subito, nessun insieme tentato.
# Ogni chiamata a rclone ha timeout di connessione e di I/O e pochi tentativi; tutte insieme
# non superano OFFSITE_TIMEOUT_SECONDS (default 1500: il giro delle 03:30 finisce prima del
# drill delle 04:00). Oltre, l'insieme in corso fallisce con "tempo massimo superato". Il primo
# invio completo di un bucket grande puo' richiedere piu' tempo: alzare il valore per quella
# notte (gli invii riprendono da dove si sono fermati: rclone non ricopia cio' che c'e' gia').
#
# Credenziali: passate a rclone SOLO via variabili d'ambiente (RCLONE_S3_*, RCLONE_B2_*), mai
# come argomenti (sarebbero visibili in `ps`).
#
# Variabili obbligatorie:
#   OFFSITE_BACKUP_BUCKET, OFFSITE_BACKUP_KEY, OFFSITE_BACKUP_SECRET
#   AGE_RECIPIENT (o AGE_RECIPIENTS_FILE)   [salvo OFFSITE_ALLOW_PLAINTEXT=yes]
# Opzionali:
#   OFFSITE_BACKUP_PROVIDER  s3 | b2 | spaces | local (default s3). `local` copia in una cartella
#                            (il BUCKET e' il percorso): serve alle prove, non alla produzione.
#   OFFSITE_BACKUP_REGION (default eu-south-1)   OFFSITE_BACKUP_ENDPOINT (S3 compatibili)
#   OFFSITE_PREFIX (default neat)   STACK_DIR (default /opt/neat-test)   BACKUPS_ROOT
#   LOCAL_BACKUP_DIR   modo storico: una sola cartella (series), sotto <prefisso>/<nome cartella>
#   OFFSITE_RETAIN_DAYS (30) / OFFSITE_RETAIN_WEEKLY_DAYS (90) / OFFSITE_RETAIN_SECRETS_DAYS (365)
#   OFFSITE_MIN_COPIES (7)   OFFSITE_MIRROR_MAX_SHRINK_PCT (20)
#   OFFSITE_MIRROR_GRACE_DAYS (30) giorni in cui un file dei clienti cancellato o sovrascritto
#                            resta recuperabile in <remoto>/minio/deleted/<ts>/; oltre e' perso anche
#                            offsite. Da decidere con il committente (vedi docs/runbooks/offsite-backup.md).
#   OFFSITE_TIMEOUT_SECONDS (1500)   OFFSITE_PREFLIGHT_SECONDS (60)   OFFSITE_CONTIMEOUT (15s)
#   OFFSITE_IO_TIMEOUT (120s)   OFFSITE_RETRIES (2)   OFFSITE_LOW_LEVEL_RETRIES (3)
#   OFFSITE_STAGE_DIR   SLACK_WEBHOOK   LOG_FILE (default /var/log/neat-offsite-sync.log)
#
# Richiede rclone e age. Chiave di accesso della VPS: ideale solo scrittura/lettura.

set -euo pipefail

STACK_DIR="${STACK_DIR:-/opt/rifiuti}"
PROVIDER="${OFFSITE_BACKUP_PROVIDER:-s3}"
BUCKET="${OFFSITE_BACKUP_BUCKET:?OFFSITE_BACKUP_BUCKET env var is required}"
ACCESS_KEY="${OFFSITE_BACKUP_KEY:?OFFSITE_BACKUP_KEY env var is required}"
SECRET_KEY="${OFFSITE_BACKUP_SECRET:?OFFSITE_BACKUP_SECRET env var is required}"
REGION="${OFFSITE_BACKUP_REGION:-eu-south-1}"
ENDPOINT="${OFFSITE_BACKUP_ENDPOINT:-}"
PREFIX="${OFFSITE_PREFIX:-rifiuti}"
BACKUPS_ROOT="${BACKUPS_ROOT:-$STACK_DIR/backups}"
RETAIN_DAYS="${OFFSITE_RETAIN_DAYS:-30}"
RETAIN_WEEKLY_DAYS="${OFFSITE_RETAIN_WEEKLY_DAYS:-90}"
RETAIN_SECRETS_DAYS="${OFFSITE_RETAIN_SECRETS_DAYS:-365}"
MIN_COPIES="${OFFSITE_MIN_COPIES:-7}"
MIRROR_GRACE_DAYS="${OFFSITE_MIRROR_GRACE_DAYS:-30}"
MIRROR_MAX_SHRINK_PCT="${OFFSITE_MIRROR_MAX_SHRINK_PCT:-20}"
MIRROR_GUARD_MIN="${OFFSITE_MIRROR_GUARD_MIN:-20}"
STAGE_ROOT="${OFFSITE_STAGE_DIR:-$BACKUPS_ROOT/.offsite-stage}"
ALLOW_PLAINTEXT="${OFFSITE_ALLOW_PLAINTEXT:-no}"
TIMEOUT_SECONDS="${OFFSITE_TIMEOUT_SECONDS:-1500}"
PREFLIGHT_SECONDS="${OFFSITE_PREFLIGHT_SECONDS:-60}"
CONTIMEOUT="${OFFSITE_CONTIMEOUT:-15s}"
IO_TIMEOUT="${OFFSITE_IO_TIMEOUT:-120s}"
RETRIES="${OFFSITE_RETRIES:-2}"
LOW_LEVEL_RETRIES="${OFFSITE_LOW_LEVEL_RETRIES:-3}"
DEADLINE=$(( $(date +%s) + TIMEOUT_SECONDS ))
LOG_FILE="${LOG_FILE:-/var/log/infra-offsite-sync.log}"
SLACK_WEBHOOK="${SLACK_WEBHOOK:-}"

log() {
  local level="$1" msg; shift
  msg="[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*"
  echo "$msg" | tee -a "$LOG_FILE" 2>/dev/null || echo "$msg"
  logger -t "rifiuti-offsite-sync" "$msg" 2>/dev/null || true
}
info()  { log INFO  "$@"; }
warn()  { log WARN  "$@"; }
error() { log ERROR "$@"; }

notify_slack() {
  local status="$1"; shift
  if [ -n "$SLACK_WEBHOOK" ]; then
    curl -s -X POST "$SLACK_WEBHOOK" -H 'Content-type: application/json' \
      -d "{\"text\":\":${status}: Neat Offsite Backup: $*\"}" || true
  fi
}

command -v rclone >/dev/null 2>&1 || { error "rclone non installato (https://rclone.org/install/)."; exit 1; }

# ── Cifratura: PRIMA di qualunque operazione remota ───────────────────────────
ENC=()
if [ "$ALLOW_PLAINTEXT" = "yes" ]; then
  warn "OFFSITE_ALLOW_PLAINTEXT=yes: i file partono IN CHIARO (deroga solo per il collaudo)."
else
  if ! command -v age >/dev/null 2>&1; then
    error "age non installato: senza cifratura NON si invia nulla offsite (apt install age)."; exit 1
  fi
  if [ -n "${AGE_RECIPIENT:-}" ]; then
    ENC=(age -r "$AGE_RECIPIENT")
  elif [ -n "${AGE_RECIPIENTS_FILE:-}" ] && [ -f "${AGE_RECIPIENTS_FILE:-}" ]; then
    ENC=(age -R "$AGE_RECIPIENTS_FILE")
  else
    error "Nessun destinatario di cifratura (AGE_RECIPIENT o AGE_RECIPIENTS_FILE): NON si invia nulla offsite in chiaro."; exit 1
  fi
  if ! echo prova | "${ENC[@]}" >/dev/null 2>&1; then
    error "Il destinatario age non e' valido: NON si invia nulla offsite."; exit 1
  fi
fi

# ── Remote rclone: configurazione per variabili d'ambiente (mai argv) ─────────
case "$PROVIDER" in
  s3)
    REMOTE_BASE=":s3:${BUCKET}"
    if [ -n "$ENDPOINT" ]; then export RCLONE_S3_PROVIDER=Other RCLONE_S3_ENDPOINT="$ENDPOINT"; else export RCLONE_S3_PROVIDER=AWS; fi
    export RCLONE_S3_REGION="$REGION"
    export RCLONE_S3_ACCESS_KEY_ID="$ACCESS_KEY" RCLONE_S3_SECRET_ACCESS_KEY="$SECRET_KEY"
    ;;
  spaces)
    REMOTE_BASE=":s3:${BUCKET}"
    export RCLONE_S3_PROVIDER=DigitalOcean RCLONE_S3_REGION="$REGION" RCLONE_S3_ENDPOINT="${ENDPOINT:-https://${REGION}.digitaloceanspaces.com}"
    export RCLONE_S3_ACCESS_KEY_ID="$ACCESS_KEY" RCLONE_S3_SECRET_ACCESS_KEY="$SECRET_KEY"
    ;;
  b2)
    REMOTE_BASE=":b2:${BUCKET}"
    export RCLONE_B2_ACCOUNT="$ACCESS_KEY" RCLONE_B2_KEY="$SECRET_KEY"
    ;;
  local)
    REMOTE_BASE=":local:${BUCKET}"
    ;;
  *)
    error "OFFSITE_BACKUP_PROVIDER sconosciuto: '$PROVIDER' (ammessi: s3, b2, spaces, local)"; exit 1 ;;
esac
unset ACCESS_KEY SECRET_KEY

# ── Insiemi da copiare: cartella:nomeRemoto:giorni[:tipo] ─────────────────────
if [ -n "${LOCAL_BACKUP_DIR:-}" ]; then
  SETS="${LOCAL_BACKUP_DIR}:$(basename "$LOCAL_BACKUP_DIR"):${RETAIN_DAYS}"
else
  SETS="${OFFSITE_SETS:-postgres:postgres:${RETAIN_DAYS} postgres-weekly:postgres-weekly:${RETAIN_WEEKLY_DAYS} redis:redis:${RETAIN_DAYS} files:files:${RETAIN_DAYS} minio/current:minio:${MIRROR_GRACE_DAYS}:mirror keycloak:keycloak:${RETAIN_DAYS} secrets:secrets:${RETAIN_SECRETS_DAYS}}"
fi

umask 077
RC_ERR="$(mktemp)"
trap 'rm -f "$RC_ERR"' EXIT

# ── rclone con limiti di tempo ────────────────────────────────────────────────
# Ogni chiamata ha il tempo che resta fino a DEADLINE (timeout complessivo del giro), timeout di
# connessione e di I/O e pochi tentativi: con la rete assente nessuna chiamata resta appesa.
rc() {
  local left=$(( DEADLINE - $(date +%s) )) r=0
  if [ "$left" -le 0 ]; then error "tempo massimo complessivo (${TIMEOUT_SECONDS}s, OFFSITE_TIMEOUT_SECONDS) superato: 'rclone $1' non eseguito"; return 124; fi
  timeout --kill-after=15 "$left" rclone --contimeout "$CONTIMEOUT" --timeout "$IO_TIMEOUT" \
    --retries "$RETRIES" --low-level-retries "$LOW_LEVEL_RETRIES" "$@" || r=$?
  if [ "$r" -eq 124 ] || [ "$r" -eq 137 ]; then error "rclone $1 interrotto: tempo massimo complessivo (${TIMEOUT_SECONDS}s, OFFSITE_TIMEOUT_SECONDS) superato"; fi
  return "$r"
}

# elenca <percorso remoto> [flag lsf...]: stampa l'elenco; ritorna 1 se l'elenco FALLISCE.
# "directory non trovata" (uscita 3) = vuoto; ogni altro errore NON e' un remoto vuoto.
elenca() {
  local out r=0
  out=$(rc lsf "$@" 2>"$RC_ERR") || r=$?
  if [ "$r" -eq 0 ]; then [ -z "$out" ] || printf '%s\n' "$out"; return 0; fi
  if [ "$r" -eq 3 ]; then return 0; fi
  error "elenco del remoto '$1' FALLITO (rclone uscita $r): $(grep -v '^$' "$RC_ERR" | tail -1)"
  return 1
}

check_marker() {
  if ! gunzip -c "$1" 2>/dev/null | tail -c 4096 | grep -q -- "$2"; then
    error "'$1' senza il marcatore di fine dump '$2': file troncato, NON viene inviato."
    return 1
  fi
}

# ── Cifratura di un file (o copia se gia' cifrato / deroga in chiaro) ─────────
# stage_file <sorgente> <destinazione-senza-estensione-age> -> stampa il percorso prodotto
stage_file() {
  local src="$1" base="$2" out plain=no
  case "$src" in
    *.age|*.gpg) plain=copy ;;
    *) [ "$ALLOW_PLAINTEXT" = "yes" ] && plain=copy ;;
  esac
  if [ "$plain" = copy ]; then out="$base"; else out="$base.age"; fi
  mkdir -p "$(dirname "$out")"
  if [ -f "$out" ] && [ ! "$src" -nt "$out" ]; then echo "$out"; return 0; fi
  # Prima di cifrare: un dump deve avere il marcatore di fine dump (un gzip puo' essere troncato).
  case "$src" in
    *.sql.gz)     check_marker "$src" '-- PostgreSQL database dump complete' || return 1 ;;
    *.globals.gz) check_marker "$src" '-- PostgreSQL database cluster dump complete' || return 1 ;;
  esac
  if [ "$plain" = copy ]; then
    cp -p "$src" "$out.tmp"
  else
    "${ENC[@]}" -o "$out.tmp" < "$src" || { rm -f "$out.tmp"; return 1; }
  fi
  touch -r "$src" "$out.tmp"
  mv "$out.tmp" "$out"
  echo "$out"
}

# ── Potatura per eta' di un insieme a serie storica ──────────────────────────
# Gruppi per "stem" (nome fino al primo punto): dump + globals + counts = una copia. Una copia e'
# VALIDA solo se il gruppo contiene il file principale (qualunque file che non sia un gemello
# .globals.gz / .counts, cifrato o no): un gruppo di soli gemelli non conta per il minimo.
# Cancella solo i gruppi piu' vecchi di <giorni>, mai le <MIN_COPIES> copie valide piu' recenti,
# e solo se esiste una copia valida piu' giovane della ritenzione. Elenco fallito = errore.
is_gemello() { case "$1" in *.globals.gz|*.globals.gz.age|*.counts|*.counts.age) return 0 ;; esac; return 1; }
prune_series() {
  local remote="$1" days="$2" name="$3"
  local now cutoff mt fn stem ep elenco
  now=$(date +%s); cutoff=$(( now - days * 86400 ))
  elenco=$(elenca "$remote" --files-only --format "tp" --separator "|") \
    || { error "[$name] potatura NON eseguita: elenco del remoto fallito"; return 1; }
  declare -A gtime=() gfiles=() gvalid=()
  while IFS='|' read -r mt fn; do
    [ -n "$fn" ] || continue
    stem="${fn%%.*}"
    ep=$(date -d "$mt" +%s 2>/dev/null || echo 0)
    if [ "${gtime[$stem]:-0}" -lt "$ep" ]; then gtime[$stem]=$ep; fi
    gfiles[$stem]+="$fn"$'\n'
    is_gemello "$fn" || gvalid[$stem]=1
  done <<< "$elenco"
  local nvalid=${#gvalid[@]} ngruppi=${#gtime[@]}
  if [ "$nvalid" -le "$MIN_COPIES" ]; then
    info "[$name] potatura: $nvalid copie valide sul remoto ($ngruppi gruppi; minimo $MIN_COPIES): nulla da potare"; return 0
  fi
  local newest=0 s
  for s in "${!gvalid[@]}"; do if [ "${gtime[$s]}" -gt "$newest" ]; then newest="${gtime[$s]}"; fi; done
  if [ "$newest" -lt "$cutoff" ]; then
    warn "[$name] potatura SALTATA: nessuna copia valida piu' recente di ${days} giorni sul remoto (i backup si sono fermati?): non si tocca l'ultima copia buona"
    return 0
  fi
  # copie valide da tenere comunque: le MIN_COPIES piu' recenti
  declare -A tieni=()
  local rank=0
  while read -r _ s; do
    rank=$((rank + 1)); [ "$rank" -le "$MIN_COPIES" ] && tieni[$s]=1
  done < <(for s in "${!gvalid[@]}"; do echo "${gtime[$s]} $s"; done | sort -rn)
  local f deleted=0 errori=0
  for s in "${!gtime[@]}"; do
    [ -n "${tieni[$s]:-}" ] && continue
    [ "${gtime[$s]}" -ge "$cutoff" ] && continue
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if rc deletefile "$remote/$f" >/dev/null 2>&1; then deleted=$((deleted + 1)); else warn "[$name] potatura: '$f' non eliminato"; errori=$((errori + 1)); fi
    done <<< "${gfiles[$s]}"
  done
  info "[$name] potatura per eta' (>${days} gg, minimo $MIN_COPIES copie valide su $nvalid): $deleted file eliminati"
  [ "$errori" -eq 0 ]
}

sha_remote() {
  local out
  out=$(rc cat "$1" 2>/dev/null | sha256sum) || return 1
  echo "${out%% *}"
}

# ── Insieme a serie storica ──────────────────────────────────────────────────
sync_series() {
  local dir="$1" name="$2" days="$3"
  local remote="${REMOTE_BASE}/${PREFIX}/${name}" stage="$STAGE_ROOT/$name"
  info "[$name] $dir -> ${PROVIDER}://${BUCKET}/${PREFIX}/${name} (serie storica, ritenzione ${days} giorni, minimo ${MIN_COPIES} copie)"
  mkdir -p "$stage"; chmod 700 "$STAGE_ROOT" "$stage"

  local f base out produced=0 keep
  keep=$(mktemp)
  for f in "$dir"/*; do
    [ -f "$f" ] || continue
    case "$f" in *.partial|*.tmp|*.parziale|*.scartato|*.non-verificato) continue ;; esac
    base="$stage/$(basename "$f")"
    out=$(stage_file "$f" "$base") || { error "[$name] cifratura/verifica di '$f' fallita"; rm -f "$keep"; return 1; }
    echo "$out" >> "$keep"; produced=$((produced + 1))
  done
  # la stage rispecchia il locale (la rotazione locale si propaga alla stage, non al remoto)
  for f in "$stage"/*; do
    if [ -f "$f" ] && ! grep -qxF "$f" "$keep"; then rm -f "$f"; fi
  done
  rm -f "$keep"
  if [ "$produced" -eq 0 ]; then warn "[$name] nessun file da copiare in $dir"; return 0; fi

  rc copy "$stage" "$remote" --transfers 4 --checkers 8 --log-level INFO --log-file "$LOG_FILE" \
    || { error "[$name] rclone copy fallito"; return 1; }
  rc check "$stage" "$remote" --one-way --size-only >/dev/null 2>&1 \
    || { error "[$name] verifica rclone check FALLITA: il remoto non coincide con il locale"; return 1; }
  info "[$name] verifica dimensioni ok"

  # Rilettura del file PIU' RECENTE (e dei suoi gemelli): sha256 remoto = sha256 locale.
  local latest l lstem a b
  latest=$(cd "$stage" && { ls -t ./* 2>/dev/null || true; } | head -1 | sed 's#^\./##')
  if [ -n "$latest" ]; then
    lstem="${latest%%.*}"
    for l in "$stage/$lstem".*; do
      [ -f "$l" ] || continue
      a=$(sha256sum < "$l" | cut -d' ' -f1)
      b=$(sha_remote "$remote/$(basename "$l")") || { error "[$name] Verifica di lettura FALLITA: '$(basename "$l")' non riletto dal remoto"; return 1; }
      if [ "$a" != "$b" ]; then error "[$name] Verifica di lettura FALLITA: '$(basename "$l")' riletto dal remoto ha un hash diverso"; return 1; fi
    done
    info "[$name] verifica di lettura ok: $lstem.* riletti dal remoto con hash identico"
  fi

  prune_series "$remote" "$days" "$name"
}

# ── Insieme a specchio (file dei clienti) ────────────────────────────────────
sync_mirror() {
  local dir="$1" name="$2" grace="$3"
  local remote="${REMOTE_BASE}/${PREFIX}/${name}" stage="$STAGE_ROOT/$name"
  local cur="$remote/current" del="$remote/deleted"
  info "[$name] $dir -> ${PROVIDER}://${BUCKET}/${PREFIX}/${name}/current (specchio: nessuna potatura per eta'; cancellazioni in deleted/ per ${grace} giorni)"
  mkdir -p "$stage"; chmod 700 "$STAGE_ROOT" "$stage"

  # stage = specchio cifrato del locale (stessa struttura, estensione .age)
  local f rel
  while IFS= read -r -d '' f; do
    rel="${f#"$dir"/}"
    stage_file "$f" "$stage/$rel" >/dev/null || { error "[$name] cifratura di '$rel' fallita"; return 1; }
  done < <(find "$dir" -type f ! -name '*.partial' ! -name '*.tmp' -print0)
  # toglie dalla stage cio' che e' sparito dal locale (al remoto arriva SOLO come "deleted/")
  while IFS= read -r -d '' f; do
    rel="${f#"$stage"/}"
    if [ "$ALLOW_PLAINTEXT" = "yes" ]; then
      [ -e "$dir/$rel" ] || rm -f "$f"
    else
      case "$rel" in
        *.age) [ -e "$dir/$rel" ] || [ -e "$dir/${rel%.age}" ] || rm -f "$f" ;;
        *) [ -e "$dir/$rel" ] || rm -f "$f" ;;
      esac
    fi
  done < <(find "$stage" -type f -print0)
  find "$stage" -mindepth 1 -type d -empty -delete 2>/dev/null || true

  local n_local n_remote
  n_local=$(find "$stage" -type f | wc -l | tr -d ' ')
  local elenco
  elenco=$(elenca "$cur" -R --files-only) \
    || { error "[$name] GUARDIA non valutabile (elenco del remoto fallito): sync NON eseguito, nulla spostato"; return 1; }
  n_remote=$(printf '%s' "$elenco" | grep -c . || true)
  # Guardia: sorgente vuota con remoto popolato, oppure calo oltre la soglia (solo da
  # MIRROR_GUARD_MIN oggetti in su: con pochi file una cancellazione legittima sarebbe un "calo").
  if [ "$n_remote" -gt 0 ] && { [ "$n_local" -eq 0 ] || { [ "$n_remote" -ge "$MIRROR_GUARD_MIN" ] && [ $(( n_local * 100 )) -lt $(( n_remote * (100 - MIRROR_MAX_SHRINK_PCT) )) ]; }; }; then
    error "[$name] GUARDIA: la sorgente ha $n_local file, il remoto $n_remote (calo oltre il ${MIRROR_MAX_SHRINK_PCT}%): sync NON eseguito (bucket svuotato per errore?). Verificare, poi eventualmente alzare OFFSITE_MIRROR_MAX_SHRINK_PCT."
    return 1
  fi
  if [ "$n_local" -eq 0 ] && [ "$n_remote" -eq 0 ]; then warn "[$name] sorgente e remoto vuoti"; return 0; fi

  local ts maxdel; ts=$(date +%Y%m%d-%H%M%S)
  # Seconda barriera: rclone stesso non sposta in deleted/ piu' oggetti di quanti la guardia ammetta.
  if [ "$n_remote" -ge "$MIRROR_GUARD_MIN" ]; then maxdel=$(( n_remote * MIRROR_MAX_SHRINK_PCT / 100 )); else maxdel="$n_remote"; fi
  # sync con --backup-dir: cio' che sparisce o cambia finisce in deleted/<ts>/, non viene perso.
  rc sync "$stage" "$cur" --backup-dir "$del/$ts" --max-delete "$maxdel" --transfers 4 --checkers 8 --log-level INFO --log-file "$LOG_FILE" \
    || { error "[$name] rclone sync fallito (o piu' di $maxdel cancellazioni: --max-delete)"; return 1; }
  rc check "$stage" "$cur" --size-only >/dev/null 2>&1 \
    || { error "[$name] verifica rclone check FALLITA: il remoto non coincide con il locale"; return 1; }
  info "[$name] verifica ok: $n_local oggetti"

  # Finestra di ritardo: SOLO le cartelle deleted/<ts> (eta' dal nome), mai current/.
  local cutoff d dn removed=0 dirs
  cutoff=$(date -d "-${grace} days" +%Y%m%d-%H%M%S)
  dirs=$(elenca "$del" --dirs-only) || { error "[$name] scadenza di deleted/ NON eseguita: elenco fallito"; return 1; }
  while IFS= read -r d; do
    dn="${d%/}"
    [[ "$dn" =~ ^[0-9]{8}-[0-9]{6}$ ]] || continue
    if [[ "$dn" < "$cutoff" ]]; then
      if rc purge "$del/$dn" >/dev/null 2>&1; then removed=$((removed + 1)); else warn "[$name] deleted/$dn non eliminato"; fi
    fi
  done <<< "$dirs"
  info "[$name] finestra di ritardo ${grace} giorni: $removed cartelle deleted/ scadute eliminate (current/ non si pota per eta')"
}

main() {
  info "=== Neat ERP Offsite Backup Sync (cifrato: $([ "$ALLOW_PLAINTEXT" = "yes" ] && echo NO-deroga-collaudo || echo age)) ==="
  local start_time failed=0 made=0
  start_time=$(date +%s)
  mkdir -p "$STAGE_ROOT"; chmod 700 "$STAGE_ROOT"

  # Raggiungibilita' della destinazione PRIMA di qualunque insieme: rete assente = uscita subito.
  local pf=0 save_deadline="$DEADLINE"
  DEADLINE=$(( $(date +%s) + PREFLIGHT_SECONDS ))
  rc lsf "$REMOTE_BASE" --max-depth 1 >/dev/null 2>"$RC_ERR" || pf=$?
  DEADLINE="$save_deadline"
  if [ "$pf" -ne 0 ] && ! { [ "$pf" -eq 3 ] && [ "$PROVIDER" = local ]; }; then
    error "Destinazione offsite NON raggiungibile o elenco negato (${PROVIDER}://${BUCKET}, rclone uscita $pf, limite ${PREFLIGHT_SECONDS}s): $(grep -v '^$' "$RC_ERR" | tail -1)"
    error "=== Offsite sync CON ERRORI: destinazione non raggiungibile, nessun insieme tentato, $(( $(date +%s) - start_time ))s ==="
    notify_slack "x" "Offsite sync: destinazione non raggiungibile"
    exit 1
  fi

  local entry dir name days kind path rest
  for entry in $SETS; do
    path="${entry%%:*}"; rest="${entry#*:}"; name="${rest%%:*}"; rest="${rest#*:}"
    days="${rest%%:*}"; kind="series"
    if [[ "$rest" == *:* ]]; then kind="${rest#*:}"; fi
    case "$path" in /*) dir="$path" ;; *) dir="$BACKUPS_ROOT/$path" ;; esac
    if [ ! -d "$dir" ]; then
      if [ "$name" = "postgres" ]; then
        error "[postgres] cartella '$dir' assente: senza i dump non c'e' nulla da copiare (su una VPS senza Postgres di Neat impostare OFFSITE_SETS)."
        failed=$((failed + 1))
      else
        warn "[$name] cartella '$dir' assente, saltata"
      fi
      continue
    fi
    case "$kind" in
      series) if sync_series "$dir" "$name" "$days"; then made=$((made + 1)); else failed=$((failed + 1)); fi ;;
      mirror) if sync_mirror "$dir" "$name" "$days"; then made=$((made + 1)); else failed=$((failed + 1)); fi ;;
      *) error "[$name] tipo insieme sconosciuto '$kind' (series|mirror)"; failed=$((failed + 1)) ;;
    esac
  done

  local elapsed=$(( $(date +%s) - start_time ))
  if [ "$failed" -gt 0 ]; then
    error "=== Offsite sync CON ERRORI: $failed insiemi falliti, $made ok, ${elapsed}s ==="
    notify_slack "x" "Offsite sync con errori ($failed insiemi falliti)"
    exit 1
  fi
  info "=== Offsite sync completato: $made insiemi in ${elapsed}s ==="
  notify_slack "white_check_mark" "Offsite sync completato in ${elapsed}s (${PROVIDER}://${BUCKET})"
}

main "$@"
