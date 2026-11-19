/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `DatiSostaTecnicaModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-viaggio-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_SOSTA_TECNICA = {
  "required": [
    "data_ora_ripresa",
    "data_ora_sospensione",
    "luogo_stazionamento"
  ],
  "type": "object",
  "properties": {
    "luogo_stazionamento": {
      "maxLength": 1000,
      "minLength": 1,
      "type": "string"
    },
    "data_ora_sospensione": {
      "type": "string",
      "description": "Formato ISO 8601 UTC",
      "format": "date-time"
    },
    "data_ora_ripresa": {
      "type": "string",
      "description": "Formato ISO 8601 UTC",
      "format": "date-time"
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `DatiSostaTecnicaModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_SOSTA_TECNICA = {} as const
