/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `QuantitaRifiutoModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-viaggio-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_QUANTITA = {
  "required": [
    "quantita"
  ],
  "type": "object",
  "properties": {
    "quantita": {
      "allOf": [
        {
          "$ref": "#/components/schemas/QuantitaModel`1"
        }
      ],
      "description": "Quantità"
    },
    "verificato_in_partenza": {
      "type": "boolean",
      "description": "Verificato in partenza",
      "nullable": true
    },
    "numero_colli": {
      "maxLength": 50,
      "type": "string",
      "description": "Numero di colli. \nSpecificare un valore in caso non si imposti \"rinfusa\" a <i>true</i>",
      "nullable": true
    },
    "rinfusa": {
      "type": "boolean",
      "description": "Rinfusa. \nSe valorizzato a <i>true</i> indica che il rifiuto non è partizionato in colli.",
      "nullable": true
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `QuantitaRifiutoModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_QUANTITA = {
  "QuantitaModel`1": {
    "required": [
      "unita_misura",
      "valore"
    ],
    "type": "object",
    "properties": {
      "valore": {
        "type": "number",
        "description": "Quantità (parte intera: 10, parte decimale: 4) compresa tra 0.0000 e 9999999999.9999.",
        "format": "double"
      },
      "unita_misura": {
        "allOf": [
          {
            "$ref": "#/components/schemas/UnitaMisura"
          }
        ],
        "description": "Unità di misura della quantità\n\nVedi API di codifica: <i>GET /codifiche/v1.0/unita-misura</i><p>Valori ammessi:<ul style=\"margin:0\"><li><i>kg</i> - Chilogrammi</li><li><i>l</i> - Litri</li></ul></p>"
      }
    },
    "additionalProperties": false
  },
  "UnitaMisura": {
    "enum": [
      "kg",
      "l"
    ],
    "type": "string"
  }
} as const
