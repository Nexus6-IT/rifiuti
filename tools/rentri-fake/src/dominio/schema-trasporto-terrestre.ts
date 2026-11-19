/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `DatiTrasportoTerrestreModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-viaggio-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_TRASPORTO_TERRESTRE = {
  "title": "DatiTrasportoTerrestreModel",
  "required": [
    "conducente"
  ],
  "type": "object",
  "allOf": [
    {
      "$ref": "#/components/schemas/DatiTrasportoBaseModel"
    }
  ],
  "properties": {
    "conducente": {
      "allOf": [
        {
          "$ref": "#/components/schemas/ConducenteModel"
        }
      ],
      "description": "Conducente"
    },
    "targa_automezzo": {
      "maxLength": 10,
      "type": "string",
      "description": "Targa automezzo. \nIl dato è necessario se non si indica una targa per il rimorchio",
      "nullable": true
    },
    "targa_rimorchio": {
      "maxLength": 10,
      "type": "string",
      "description": "Targa rimorchio",
      "nullable": true
    },
    "percorso": {
      "maxLength": 250,
      "type": "string",
      "description": "Percorso (se diverso dal più breve)",
      "nullable": true
    },
    "presa_in_carico_rimorchio_precedente": {
      "type": "boolean",
      "description": "Significativo solo per i trasporti successivi al primo",
      "nullable": true
    }
  },
  "description": "Dati del trasporto terrestre"
} as const

/** Schemi raggiunti da `DatiTrasportoTerrestreModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_TRASPORTO_TERRESTRE = {
  "ConducenteModel": {
    "required": [
      "cognome",
      "nome"
    ],
    "type": "object",
    "properties": {
      "nome": {
        "maxLength": 50,
        "minLength": 1,
        "type": "string",
        "description": "Nome"
      },
      "cognome": {
        "maxLength": 50,
        "minLength": 1,
        "type": "string",
        "description": "Cognome"
      }
    },
    "additionalProperties": false,
    "description": "Conducente"
  },
  "DatiTrasportoBaseModel": {
    "required": [
      "data_ora_inizio_trasporto"
    ],
    "type": "object",
    "properties": {
      "data_ora_inizio_trasporto": {
        "type": "string",
        "description": "Data e ora inizio trasporto (formato ISO 8601 UTC)",
        "format": "date-time"
      },
      "annotazioni": {
        "maxLength": 10000,
        "type": "string",
        "description": "Annotazioni",
        "nullable": true
      }
    },
    "description": "Dati del trasporto base"
  }
} as const
