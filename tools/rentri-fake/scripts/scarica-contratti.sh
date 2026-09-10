#!/usr/bin/env bash
# Scarica gli OpenAPI ufficiali RENTRI e ne registra la provenienza.
# I documenti sono YAML anche se serviti con estensione .json.
set -euo pipefail

BASE="https://demoapi.rentri.gov.it/docs"
DEST="$(cd "$(dirname "$0")/../../../docs/contracts/rentri" && pwd)"
API_DISPONIBILI=(
  "formulari"
  "anagrafiche"
  "codifiche"
  "ca-rentri"
  "dati-registri"
  # Vidimazione virtuale dei formulari. Un audit del 25/07/2026 l'aveva
  # dichiarata inesistente e il codice che la usava fu cancellato: era una
  # conclusione sbagliata, l'API risponde 200. E' l'unica che restituisce
  # `qr_code_bytes`, cioe' il contenuto del QR del formulario stampato.
  "vidimazione-formulari"
)

mkdir -p "$DEST"
: > "$DEST/MANIFEST.md"
{
  echo "# Contratti ufficiali RENTRI"
  echo
  echo "Scaricati da \`$BASE\`. NON modificare a mano: rieseguire lo script. Accertamenti redatti a mano sui contratti sono in \`ACCERTAMENTI.md\` (non rigenerati da questo script)."
  echo
  echo "| API | URL | Versione | SHA-256 | Scaricato il |"
  echo "|-----|-----|----------|---------|--------------|"
} >> "$DEST/MANIFEST.md"

for api in "${API_DISPONIBILI[@]}"; do
  url="$BASE/$api/v1.0/openapi.json"
  echo "Scarico $api da $url"
  curl -sfS --max-time 60 "$url" -o "$DEST/$api.yaml"
  versione="$(grep -m1 '^  version:' "$DEST/$api.yaml" | sed 's/^  version: *//')"
  digest="$(sha256sum "$DEST/$api.yaml" | cut -d' ' -f1)"
  echo "| $api | $url | $versione | \`$digest\` | $(date -u +%Y-%m-%d) |" >> "$DEST/MANIFEST.md"
done

echo
echo "Contratti scaricati in $DEST"
