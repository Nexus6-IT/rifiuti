/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia di `NuovoFormularioModel` dal contratto ufficiale
 * `docs/contracts/rentri/formulari.yaml`. L'allineamento e' imposto da
 * `test/schema-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_NUOVO_FORMULARIO = {
  "required": [
    "dati_partenza",
    "num_iscr_sito"
  ],
  "type": "object",
  "properties": {
    "num_iscr_sito": {
      "minLength": 1,
      "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
      "type": "string",
      "description": "Numero iscrizione unità locale di riferimento a cui il formulario verrà associato.\n\nL'unità locale deve appartenere al produttore o al primo trasportatore."
    },
    "dati_partenza": {
      "allOf": [
        {
          "$ref": "#/components/schemas/DatiPartenzaModel"
        }
      ],
      "description": "Dati iniziali del formulario"
    },
    "dati_trasporto_partenza": {
      "oneOf": [
        {
          "$ref": "#/components/schemas/DatiTrasportoTerrestreModel"
        },
        {
          "$ref": "#/components/schemas/DatiTrasportoMarittimoModel"
        },
        {
          "$ref": "#/components/schemas/DatiTrasportoFerroviarioModel"
        }
      ],
      "description": "Dati del trasporto iniziale",
      "nullable": true
    }
  },
  "additionalProperties": false,
  "description": "Formulario"
} as const
