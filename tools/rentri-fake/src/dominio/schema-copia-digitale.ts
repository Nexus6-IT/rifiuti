/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `CopiaDigitaleModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-copie-allineate-al-contratto.test.ts`.
 */
export const SCHEMA_COPIA_DIGITALE = {
  "required": [
    "num_iscr_sito",
    "xfir"
  ],
  "type": "object",
  "properties": {
    "num_iscr_sito": {
      "minLength": 1,
      "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
      "type": "string"
    },
    "note": {
      "maxLength": 500,
      "type": "string",
      "nullable": true
    },
    "xfir": {
      "type": "string",
      "description": "Contenuto del file xFIR",
      "format": "byte"
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `CopiaDigitaleModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_COPIA_DIGITALE = {} as const
