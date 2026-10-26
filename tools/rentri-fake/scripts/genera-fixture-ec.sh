#!/usr/bin/env bash
# Rigenera le fixture di prova EC (dati NON segreti) in test/fixture/ec/.
# Uso: bash tools/rentri-fake/scripts/genera-fixture-ec.sh [--rigenera]
#
# Senza opzioni NON tocca i file che esistono gia' (CA, chiavi, certificati,
# .p12): crea solo quelli mancanti, cosi' un rilancio non invalida le fixture
# committate ne' i test che ne dipendono. Con --rigenera rifa' tutto da zero
# (nuova CA e nuove chiavi: poi vanno ricommittate tutte le fixture insieme).
# Gli errori di openssl NON sono nascosti: lo script si ferma al primo.
# Variabile OUT_DIR: scrive altrove (utile per provare lo script senza sporcare
# le fixture committate).
#
# Cifratura dei .p12: node-forge 1.3.x apre sia i .p12 coi default di OpenSSL 3
# (PBES2/PBKDF2/AES-256-CBC, MAC SHA-256: il formato piu' probabile in produzione)
# sia quelli "legacy" (PBE-SHA1-3DES + MAC SHA1) sia quelli col keyBag in chiaro.
# Le fixture coprono tutte e tre le varianti; i p12 "principali" usano il formato
# legacy, quelli -openssl3 e -keybag-in-chiaro* le altre due.
set -euo pipefail
export MSYS_NO_PATHCONV=1
RIGENERA=0
case "${1:-}" in
  "") ;;
  --rigenera) RIGENERA=1 ;;
  *) echo "Opzione sconosciuta: $1 (ammessa solo --rigenera)" >&2; exit 2 ;;
esac
OUT="${OUT_DIR:-$(cd "$(dirname "$0")/.." && pwd)/test/fixture/ec}"
mkdir -p "$OUT"
cd "$OUT"

# Vero se il file va (ri)creato: manca, oppure e' stato chiesto --rigenera.
da_creare() { [ "$RIGENERA" = 1 ] || [ ! -e "$1" ]; }
PASS="prova-ec"
DAYS=3650
P12OPTS=(-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1)

# CA di prova RSA 2048 autofirmata.
if da_creare ca-prova.key || da_creare ca-prova.crt; then
  openssl genrsa -out ca-prova.key 2048
  openssl req -x509 -new -key ca-prova.key -sha256 -days $DAYS -subj "/CN=CA di prova RENTRI" -out ca-prova.crt
  # Una CA nuova invalida tutto cio' che era firmato dalla vecchia: rifa' il resto.
  RIGENERA=1
fi

# Esegue il comando solo se il .p12 di destinazione (ultimo argomento) va creato.
p12() {
  local destinazione="${!#}"
  if da_creare "$destinazione"; then "$@"; fi
}

emetti() { # $1=nome $2=curva $3=CN
  if ! da_creare "$1.key" && ! da_creare "$1.crt"; then return 0; fi
  openssl ecparam -name "$2" -genkey -noout -out "$1.key"
  openssl req -new -key "$1.key" -subj "/CN=$3" -out "$1.csr"
  openssl x509 -req -in "$1.csr" -CA ca-prova.crt -CAkey ca-prova.key -CAcreateserial \
    -sha256 -days $DAYS -out "$1.crt"
  rm -f "$1.csr"
}

emetti operatore-test-ec prime256v1 operatore-test-ec
emetti operatore-test-ec384 secp384r1 operatore-test-ec384

# .p12 con passphrase, senza password, P-384 (per il test di rifiuto).
p12 openssl pkcs12 -export "${P12OPTS[@]}" -inkey operatore-test-ec.key -in operatore-test-ec.crt \
  -certfile ca-prova.crt -passout "pass:$PASS" -out operatore-test-ec.p12
p12 openssl pkcs12 -export "${P12OPTS[@]}" -inkey operatore-test-ec.key -in operatore-test-ec.crt \
  -certfile ca-prova.crt -passout pass: -out operatore-test-ec-senza-password.p12
p12 openssl pkcs12 -export "${P12OPTS[@]}" -inkey operatore-test-ec384.key -in operatore-test-ec384.crt \
  -certfile ca-prova.crt -passout "pass:$PASS" -out operatore-test-ec384.p12

# Varianti di formato dello stesso certificato EC P-256: default OpenSSL 3 e
# keyBag/certBag non cifrati (con MAC e senza MAC).
p12 openssl pkcs12 -export -inkey operatore-test-ec.key -in operatore-test-ec.crt   -certfile ca-prova.crt -passout "pass:$PASS" -out operatore-test-ec-openssl3.p12
p12 openssl pkcs12 -export -keypbe NONE -certpbe NONE -inkey operatore-test-ec.key -in operatore-test-ec.crt   -certfile ca-prova.crt -passout "pass:$PASS" -out operatore-test-ec-keybag-in-chiaro.p12
p12 openssl pkcs12 -export -keypbe NONE -certpbe NONE -nomac -inkey operatore-test-ec.key -in operatore-test-ec.crt   -certfile ca-prova.crt -passout pass: -out operatore-test-ec-keybag-in-chiaro-senza-mac.p12

rm -f ca-prova.srl
echo "Fixture generate in $OUT"
