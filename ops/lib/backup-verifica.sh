# shellcheck shell=bash
# ==============================================================================
# ops/lib/backup-verifica.sh — funzioni di verifica per backup e restore
# ==============================================================================
# Da usare con "source". Nessuna funzione chiama exit e niente "set -e" qui:
# le funzioni che devono ripulire (ripristino_di_prova) controllano ogni esito
# con "if", perche' con "set -e" il fallimento di un passo salterebbe la pulizia
# (lezione Gitea del 16/09: uno script con set -e usciva prima della riga che
# riaccendeva il servizio). Gli script chiamanti hanno il loro "set -euo pipefail".
# ==============================================================================

MARCATORE_DUMP='-- PostgreSQL database dump complete'

# leggi_env FILE CHIAVE [DEFAULT]
# Stampa il valore dell'ultima riga "CHIAVE=" del file, senza virgolette esterne.
# Non esegue mai il file (niente source).
leggi_env() {
  local file="$1" chiave="$2" predefinito="${3:-}" riga valore
  if [ -r "$file" ]; then
    riga=$(grep -E "^${chiave}=" "$file" 2>/dev/null | tail -n 1) || riga=""
    if [ -n "$riga" ]; then
      valore="${riga#*=}"
      valore="${valore%$'\r'}"
      if [[ "$valore" == \"*\" && ${#valore} -ge 2 ]]; then
        valore="${valore:1:${#valore}-2}"
      elif [[ "$valore" == \'*\' && ${#valore} -ge 2 ]]; then
        valore="${valore:1:${#valore}-2}"
      fi
      printf '%s\n' "$valore"
      return 0
    fi
  fi
  printf '%s\n' "$predefinito"
  return 0
}

# pg_exec ARGS... — esegue "$PG_EXEC ARGS..." (PG_EXEC e' un prefisso di comando,
# il word splitting e' voluto).
pg_exec() {
  # shellcheck disable=SC2086
  $PG_EXEC "$@"
}

# verifica_completezza_dump FILE
# 0 se il gzip e' integro e una delle ultime 20 righe e' il marcatore finale di pg_dump.
verifica_completezza_dump() {
  local file="$1" coda
  if [ ! -s "$file" ]; then
    echo "file vuoto: $file" >&2
    return 1
  fi
  if ! gzip -t "$file" 2>/dev/null; then
    echo "gzip corrotto: $file" >&2
    return 1
  fi
  coda=$(gzip -dc "$file" 2>/dev/null | tail -n 20)
  if ! printf '%s\n' "$coda" | grep -qxF -- "$MARCATORE_DUMP"; then
    echo "marcatore finale assente: dump troncato ($file)" >&2
    return 1
  fi
  return 0
}

# ripristino_di_prova FILE DB_USER DB_SORGENTE
# Ripristina il dump in un database temporaneo, confronta con la sorgente e
# elimina SEMPRE il database temporaneo.
# Codici di ritorno: 0 = ripristino e confronti riusciti; 1 = ripristino o confronti
# falliti; 2 = ripristino e confronti riusciti ma eliminazione del database
# temporaneo fallita (il dump e' valido, il chiamante deve solo avvisare).
ripristino_di_prova() {
  local file="$1" utente="$2" sorgente="$3"
  local temp="wasteflow_verifica_$(date +%s)_$$"
  local esito=0 creato=0 pulizia_fallita=0
  local n_src n_cpy m_src m_cpy w_src w_cpy
  local stati

  if pg_exec psql -U "$utente" -d postgres -v ON_ERROR_STOP=1 -qAtc "CREATE DATABASE \"${temp}\""; then
    creato=1
  else
    echo "creazione del database temporaneo ${temp} fallita" >&2
    esito=1
  fi

  if [ "$esito" -eq 0 ]; then
    gzip -dc "$file" | pg_exec psql -U "$utente" -d "$temp" -v ON_ERROR_STOP=1 -q >/dev/null
    stati=("${PIPESTATUS[@]}")
    if [ "${stati[0]}" -ne 0 ] || [ "${stati[1]}" -ne 0 ]; then
      echo "ripristino di prova fallito (gzip=${stati[0]}, psql=${stati[1]})" >&2
      esito=1
    fi
  fi

  if [ "$esito" -eq 0 ]; then
    if n_src=$(_conta "$utente" "$sorgente" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") \
      && n_cpy=$(_conta "$utente" "$temp" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"); then
      if [ "$n_src" != "$n_cpy" ]; then
        echo "tabelle diverse: sorgente ${n_src}, copia ${n_cpy}" >&2
        esito=1
      fi
    else
      echo "conteggio tabelle non riuscito" >&2
      esito=1
    fi
  fi

  if [ "$esito" -eq 0 ]; then
    if m_src=$(_conta "$utente" "$sorgente" 'SELECT count(*) FROM _prisma_migrations') \
      && m_cpy=$(_conta "$utente" "$temp" 'SELECT count(*) FROM _prisma_migrations'); then
      if [ "$m_src" != "$m_cpy" ]; then
        echo "righe di _prisma_migrations diverse: sorgente ${m_src}, copia ${m_cpy}" >&2
        esito=1
      fi
    else
      echo "conteggio di _prisma_migrations non riuscito" >&2
      esito=1
    fi
  fi

  if [ "$esito" -eq 0 ]; then
    if w_src=$(_conta "$utente" "$sorgente" 'SELECT count(*) FROM waste_movements') \
      && w_cpy=$(_conta "$utente" "$temp" 'SELECT count(*) FROM waste_movements'); then
      # la sorgente puo' aver ricevuto scritture dopo il dump: la copia non deve superarla
      if [ "$w_cpy" -gt "$w_src" ]; then
        echo "waste_movements: la copia (${w_cpy}) supera la sorgente (${w_src})" >&2
        esito=1
      elif [ "$w_src" -gt 0 ] && [ "$w_cpy" -eq 0 ]; then
        echo "waste_movements: copia vuota ma la sorgente ha ${w_src} righe" >&2
        esito=1
      fi
    else
      echo "conteggio di waste_movements non riuscito" >&2
      esito=1
    fi
  fi

  # Pulizia: gira sempre. Si prova anche se la creazione e' fallita a meta'.
  if [ "$creato" -eq 1 ] || [ "$esito" -ne 0 ]; then
    if ! pg_exec psql -U "$utente" -d postgres -v ON_ERROR_STOP=1 -qAtc "DROP DATABASE IF EXISTS \"${temp}\" WITH (FORCE)" >/dev/null; then
      echo "ATTENZIONE: eliminazione del database temporaneo ${temp} fallita" >&2
      pulizia_fallita=1
    fi
  fi

  if [ "$esito" -eq 0 ] && [ "$pulizia_fallita" -eq 1 ]; then
    return 2
  fi
  return "$esito"
}

# _conta DB_USER DB SQL — stampa il numero restituito dalla query (uso interno).
_conta() {
  local out
  if ! out=$(pg_exec psql -U "$1" -d "$2" -v ON_ERROR_STOP=1 -Atc "$3" 2>/dev/null); then
    return 1
  fi
  out=$(printf '%s' "$out" | tr -d '[:space:]')
  case "$out" in
    ''|*[!0-9]*) return 1 ;;
  esac
  printf '%s\n' "$out"
}

# spazio_libero_byte DIR — byte liberi del filesystem di DIR.
spazio_libero_byte() {
  df -Pk "$1" | awk 'NR==2 {print $4 * 1024}'
}

# verifica_spazio_libero DIR BYTE_RICHIESTI
verifica_spazio_libero() {
  local dir="$1" richiesti="$2" liberi
  liberi=$(spazio_libero_byte "$dir")
  if [ -z "$liberi" ] || ! awk -v l="$liberi" -v r="$richiesti" 'BEGIN { exit !(l >= r) }'; then
    echo "spazio insufficiente in ${dir}: liberi ${liberi:-?}, richiesti ${richiesti}" >&2
    return 1
  fi
  return 0
}

# dimensione_db DB_USER DB — dimensione del database in byte.
dimensione_db() {
  local out
  out=$(pg_exec psql -U "$1" -d "$2" -Atc "SELECT pg_database_size(current_database())") || return 1
  printf '%s\n' "$(printf '%s' "$out" | tr -d '[:space:]')"
}

# notifica_fallimento OGGETTO TESTO
# Mail a ${BACKUP_ALERT_EMAIL:-root} via msmtp (sul VPS root e' inoltrato a Gmail
# da /etc/aliases); senza msmtp scrive su stderr. Ritorna sempre 0.
notifica_fallimento() {
  local oggetto="$1" testo="$2" dest="${BACKUP_ALERT_EMAIL:-root}"
  if command -v msmtp >/dev/null 2>&1; then
    if ! printf 'To: %s\nSubject: %s\nContent-Type: text/plain; charset=UTF-8\n\n%s\n' \
      "$dest" "$oggetto" "$testo" | msmtp -t >/dev/null 2>&1; then
      echo "ATTENZIONE: invio mail a ${dest} fallito: ${oggetto}" >&2
    fi
  else
    printf '%s\n%s\n' "$oggetto" "$testo" >&2
  fi
  return 0
}
