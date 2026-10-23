#!/usr/bin/env bash
# Rigenera le fixture di prova EC (dati NON segreti) in test/fixture/ec/.
# Uso: bash tools/rentri-fake/scripts/genera-fixture-ec.sh
#
# Cifratura dei .p12: OpenSSL 3 usa di default AES-256-CBC + PBKDF2 + MAC SHA-256,
# che node-forge 1.3.x non apre. Si forzano quindi PBE-SHA1-3DES (keypbe/certpbe) e
# MAC SHA1, i parametri che node-forge sa leggere (stesso livello di sicurezza
# della fixture RSA dei test, e' solo materiale di prova).
set -euo pipefail
export MSYS_NO_PATHCONV=1
OUT="$(cd "$(dirname "$0")/.." && pwd)/test/fixture/ec"
mkdir -p "$OUT"
cd "$OUT"
PASS="prova-ec"
DAYS=3650
P12OPTS=(-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1)

# CA di prova RSA 2048 autofirmata.
openssl genrsa -out ca-prova.key 2048 2>/dev/null
openssl req -x509 -new -key ca-prova.key -sha256 -days $DAYS -subj "/CN=CA di prova RENTRI" -out ca-prova.crt

emetti() { # $1=nome $2=curva $3=CN
  openssl ecparam -name "$2" -genkey -noout -out "$1.key"
  openssl req -new -key "$1.key" -subj "/CN=$3" -out "$1.csr"
  openssl x509 -req -in "$1.csr" -CA ca-prova.crt -CAkey ca-prova.key -CAcreateserial \
    -sha256 -days $DAYS -out "$1.crt" 2>/dev/null
  rm -f "$1.csr"
}

emetti operatore-test-ec prime256v1 operatore-test-ec
emetti operatore-test-ec384 secp384r1 operatore-test-ec384

# .p12 con passphrase, senza password, P-384 (per il test di rifiuto).
openssl pkcs12 -export "${P12OPTS[@]}" -inkey operatore-test-ec.key -in operatore-test-ec.crt \
  -certfile ca-prova.crt -passout "pass:$PASS" -out operatore-test-ec.p12
openssl pkcs12 -export "${P12OPTS[@]}" -inkey operatore-test-ec.key -in operatore-test-ec.crt \
  -certfile ca-prova.crt -passout pass: -out operatore-test-ec-senza-password.p12
openssl pkcs12 -export "${P12OPTS[@]}" -inkey operatore-test-ec384.key -in operatore-test-ec384.crt \
  -certfile ca-prova.crt -passout "pass:$PASS" -out operatore-test-ec384.p12

rm -f ca-prova.srl
echo "Fixture generate in $OUT"
