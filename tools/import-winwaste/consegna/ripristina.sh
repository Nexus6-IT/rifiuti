#!/usr/bin/env bash
# WasteFlow - consegna dei dati: ripristino di un .bak WinWaste in un SQL Server usa e getta.
#
#   ripristina.sh [--identita CHIAVE_AGE] [--estrai-in DIR] [--tieni] FILE.bak[.age]
#
# Cosa fa:
#   1. controlla il nome del file (WW<ditta><anno> o ww<ditta>MU<aa>, mai adminwwnet);
#   2. se il file e' cifrato (.age) lo decifra in una cartella di lavoro 0700 (serve --identita), poi
#      verifica l'impronta SHA-256 del .bak IN CHIARO contro SHA256SUMS (obbligatoria per i file .age:
#      se manca o non coincide, uscita 2);
#   3. avvia un container SQL Server su una rete Docker `--internal` (nessuna uscita verso Internet,
#      nessuna porta pubblicata: l'host lo raggiunge dall'IP del container), telemetria spenta, con la
#      password di sa generata a caso e passata da env-file 0600 (mai in riga di comando);
#   4. ripristina il backup (RESTORE FILELISTONLY + WITH MOVE + CHECKSUM);
#   5. crea il login `lettore` con il solo ruolo db_datareader;
#   6. con --estrai-in DIR lancia l'estrattore (tools/import-winwaste) verso lo staging;
#   7. a fine uso rimuove container e file di lavoro. Con --tieni li lascia e stampa come
#      eliminarli (serve per provare l'estrazione a mano).
# Non esegue nessun binario del cliente o di WinWaste: il .bak si ripristina, non si lancia.
# Uscite: 0 ok, 1 errore, 2 verifica del file fallita (impronta), 64 uso errato.
set -Eeuo pipefail
umask 077

# Tag fisso (mai `latest`); per un .bak di SQL Server piu' recente: WASTEFLOW_MSSQL_IMMAGINE=<immagine>.
IMMAGINE="${WASTEFLOW_MSSQL_IMMAGINE:-mcr.microsoft.com/mssql/server:2022-CU16-ubuntu-22.04}"
QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQLCMD='/opt/mssql-tools18/bin/sqlcmd -C -S localhost'

uso() {
  echo "uso: ripristina.sh [--identita CHIAVE_AGE] [--estrai-in DIR] [--tieni] FILE.bak[.age]" >&2
  exit 64
}

IDENTITA=""; ESTRAI_IN=""; TIENI=0; FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --identita) [ $# -ge 2 ] || uso; IDENTITA="$2"; shift 2 ;;
    --estrai-in) [ $# -ge 2 ] || uso; ESTRAI_IN="$2"; shift 2 ;;
    --tieni) TIENI=1; shift ;;
    -h|--help) uso ;;
    -*) echo "opzione sconosciuta: $1" >&2; uso ;;
    *) [ -z "$FILE" ] || uso; FILE="$1"; shift ;;
  esac
done
[ -n "$FILE" ] || uso
[ -f "$FILE" ] || { echo "file non trovato: $FILE" >&2; exit 64; }

BASE="$(basename "$FILE")"
SENZA_AGE="${BASE%.age}"
case "$SENZA_AGE" in *.bak) ;; *) echo "atteso un file .bak o .bak.age: $BASE" >&2; exit 64 ;; esac
if [[ ! "$SENZA_AGE" =~ ^([Ww][Ww][0-9]{8}|[Ww][Ww][0-9]{4}MU[0-9]{2})_[A-Za-z0-9._-]+\.bak$ ]]; then
  echo "database non ammesso dal nome del file ($BASE): attesi WWddddaaaa_*.bak o wwddddMUaa_*.bak" >&2
  exit 64
fi
DB="${SENZA_AGE%%_*}"
# L'estrattore vuole WW maiuscolo negli archivi annuali (il modello si chiama ww00002014).
[[ "$DB" =~ ^[Ww][Ww][0-9]{8}$ ]] && DB="WW${DB:2}"

# --- cartella di lavoro 0700, pulizia a fine uso ---
BASE_TMP="${WASTEFLOW_CONSEGNA_TMP:-${TMPDIR:-/tmp}}"
LAVORO="$(mktemp -d "$BASE_TMP/consegna-lavoro-XXXXXXXX")"
chmod 700 "$LAVORO"
CONTAINER=""; RETE=""
pulisci() {
  local codice=$?
  if [ "$TIENI" = "1" ] && [ "$codice" = "0" ]; then
    echo
    echo "Container e file di lavoro lasciati accesi (--tieni)."
    echo "  cartella di lavoro: $LAVORO (password in sa.env e lettore.pwd, 0600)"
    echo "  per eliminare tutto: docker rm -f -v ${CONTAINER:-<container>}; docker network rm ${RETE:-<rete>}; rm -rf '$LAVORO'"
    return
  fi
  [ -n "$CONTAINER" ] && docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
  [ -n "$RETE" ] && docker network rm "$RETE" >/dev/null 2>&1 || true
  rm -rf "$LAVORO"
}
trap pulisci EXIT

# --- decifratura ---
BAK="$FILE"
if [ "$SENZA_AGE" != "$BASE" ]; then
  [ -n "$IDENTITA" ] || { echo "file cifrato: serve --identita <chiave age>" >&2; exit 64; }
  command -v age >/dev/null || { echo "age non installato" >&2; exit 1; }
  BAK="$LAVORO/$SENZA_AGE"
  age -d -i "$IDENTITA" -o "$BAK" "$FILE"
fi

# --- impronta del .bak in chiaro (SHA256SUMS e' calcolato dall'IT sui .bak prima della cifratura) ---
SOMME="$(dirname "$FILE")/SHA256SUMS"
CIFRATO=0; [ "$SENZA_AGE" != "$BASE" ] && CIFRATO=1
ATTESA=""
[ -f "$SOMME" ] && ATTESA="$(awk -v f="$SENZA_AGE" '{ n=$2; sub(/^\*/, "", n); if (n == f) { print $1; exit } }' "$SOMME")"
if [ -n "$ATTESA" ]; then
  EFFETTIVA="$(sha256sum "$BAK" | awk '{print $1}')"
  if [ "${ATTESA,,}" != "$EFFETTIVA" ]; then
    echo "impronta SHA-256 diversa da quella dichiarata in SHA256SUMS per $SENZA_AGE: file alterato o incompleto" >&2
    exit 2
  fi
  echo "impronta verificata: $SENZA_AGE"
elif [ "$CIFRATO" = "1" ]; then
  echo "impronta mancante: per i file cifrati SHA256SUMS (con la riga di $SENZA_AGE) e' obbligatorio" >&2
  exit 2
else
  echo "attenzione: impronta di $SENZA_AGE non verificata (SHA256SUMS assente o senza la riga)" >&2
fi

genera() { head -c 24 /dev/urandom | base64 | tr -d '/+=\n' | head -c 28; }
SA_PWD="$(genera)aA1!"
LETTORE_PWD="$(genera)bB2!"
printf 'MSSQL_SA_PASSWORD=%s\nACCEPT_EULA=Y\nMSSQL_PID=Developer\nMSSQL_TELEMETRY_ENABLED=FALSE\nMSSQL_MEMORY_LIMIT_MB=1536\n' "$SA_PWD" > "$LAVORO/sa.env"
printf '%s' "$LETTORE_PWD" > "$LAVORO/lettore.pwd"
chmod 600 "$LAVORO/sa.env" "$LAVORO/lettore.pwd"

NOME="wasteflow-mssql-consegna-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
RETE="$NOME-rete"
CONTAINER="$NOME"
# Rete --internal: il container non ha nessuna uscita verso Internet (nemmeno per la telemetria) e non
# pubblica porte; l'host Linux raggiunge l'IP del container sul bridge.
docker network create --internal "$RETE" >/dev/null
docker run -d --name "$NOME" --network "$RETE" --memory=2g --env-file="$LAVORO/sa.env" "$IMMAGINE" >/dev/null
IP="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$RETE\").IPAddress}}" "$NOME")"
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "indirizzo del container non trovato" >&2; exit 1; }

# sqlcmd dentro il container: la password di sa viene dall'ambiente del container, non dagli argomenti.
dentro() { docker exec "$CONTAINER" sh -c "SQLCMDPASSWORD=\"\$MSSQL_SA_PASSWORD\" $SQLCMD -U sa $1"; }
dentro_stdin() { docker exec -i "$CONTAINER" sh -c "SQLCMDPASSWORD=\"\$MSSQL_SA_PASSWORD\" $SQLCMD -U sa -b -i /dev/stdin"; }

echo "attendo l'avvio di SQL Server..."
pronto=0
for _ in $(seq 1 90); do
  if dentro '-Q "SELECT 1" -b' >/dev/null 2>&1; then pronto=1; break; fi
  sleep 2
done
[ "$pronto" = "1" ] || { echo "SQL Server non e partito entro 3 minuti" >&2; exit 1; }

docker exec "$CONTAINER" mkdir -p /var/opt/mssql/backup
DEST="/var/opt/mssql/backup/$SENZA_AGE"
docker cp "$BAK" "$CONTAINER:$DEST"
docker exec -u 0 "$CONTAINER" sh -c "chown mssql '$DEST' && chmod 400 '$DEST'"

# --- RESTORE con MOVE dei file logici ---
ELENCO="$(dentro "-h -1 -W -s '|' -b -Q \"SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$DEST'\"")"
MOVE=""
while IFS='|' read -r logico _fisico tipo _resto; do
  [ -n "${logico:-}" ] || continue
  case "$tipo" in D) est="mdf" ;; L) est="ldf" ;; *) continue ;; esac
  [[ "$logico" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "nome logico di file non ammesso nel backup" >&2; exit 1; }
  MOVE="$MOVE, MOVE N'$logico' TO N'/var/opt/mssql/data/${logico}.${est}'"
done <<< "$ELENCO"
[ -n "$MOVE" ] || { echo "nessun file dati trovato nel backup" >&2; exit 1; }

printf '%s\n' "RESTORE DATABASE [$DB] FROM DISK = N'$DEST' WITH CHECKSUM, STATS = 10${MOVE};" | dentro_stdin

# --- login di sola lettura ---
printf '%s\n' \
  "CREATE LOGIN [lettore] WITH PASSWORD = N'$LETTORE_PWD', CHECK_POLICY = OFF;" \
  "GO" \
  "USE [$DB];" \
  "CREATE USER [lettore] FOR LOGIN [lettore];" \
  "ALTER ROLE db_datareader ADD MEMBER [lettore];" | dentro_stdin

echo "ripristinato: $DB su $IP:1433 (rete interna) (login lettore, sola lettura)"

if [ -n "$ESTRAI_IN" ]; then
  ( cd "$QUI/.." && WASTEFLOW_MSSQL_PASSWORD="$(cat "$LAVORO/lettore.pwd")" \
      npm run estrai -- --server "$IP" --porta 1433 --database "$DB" \
      --utente lettore --out "$ESTRAI_IN" --fidati-del-certificato )
fi

if [ "$TIENI" = "1" ]; then
  echo "per estrarre a mano: cd tools/import-winwaste && WASTEFLOW_MSSQL_PASSWORD=\"\$(cat '$LAVORO/lettore.pwd')\" npm run estrai -- --server $IP --porta 1433 --database $DB --utente lettore --out <cartella> --fidati-del-certificato"
fi
