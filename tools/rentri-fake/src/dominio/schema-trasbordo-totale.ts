/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `DatiTrasbordoTotaleModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-viaggio-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_TRASBORDO_TOTALE = {
  "required": [
    "presa_in_carico",
    "trasportatore"
  ],
  "type": "object",
  "properties": {
    "trasportatore": {
      "oneOf": [
        {
          "$ref": "#/components/schemas/DatiTrasportatoreFormularioModel"
        },
        {
          "$ref": "#/components/schemas/DatiTrasportatoreFormularioSitoModel"
        }
      ],
      "description": "Dati trasportatore"
    },
    "presa_in_carico": {
      "title": "DatiTrasportoTerrestreModel",
      "allOf": [
        {
          "$ref": "#/components/schemas/DatiTrasportoTerrestreModel"
        }
      ],
      "description": "Dati del trasporto terrestre"
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `DatiTrasbordoTotaleModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_TRASBORDO_TOTALE = {
  "DatiTrasportoTerrestreModel": {
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
  },
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
  },
  "DatiTrasportatoreFormularioSitoModel": {
    "title": "DatiTrasportatoreFormularioSitoModel",
    "required": [
      "num_iscr_sito"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportatoreFormularioBaseModel"
      }
    ],
    "properties": {
      "num_iscr_sito": {
        "minLength": 1,
        "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
        "type": "string",
        "description": "Numero di iscrizione al RENTRI"
      }
    },
    "description": "Dati trasportatore"
  },
  "DatiTrasportatoreFormularioBaseModel": {
    "required": [
      "tipo_trasporto"
    ],
    "type": "object",
    "properties": {
      "tipo_trasporto": {
        "allOf": [
          {
            "$ref": "#/components/schemas/TipoTrasporto"
          }
        ]
      },
      "numero_iscrizione_albo": {
        "maxLength": 10,
        "pattern": "^([A-Za-z]{2})/([0-9]{6})$",
        "type": "string",
        "description": "Iscrizione Albo",
        "nullable": true
      }
    },
    "description": "Dati trasportatore"
  },
  "TipoTrasporto": {
    "enum": [
      "Terrestre",
      "Ferroviario",
      "Marittimo"
    ],
    "type": "string"
  },
  "DatiTrasportatoreFormularioModel": {
    "title": "DatiTrasportatoreFormularioModel",
    "required": [
      "codice_fiscale",
      "denominazione"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportatoreFormularioBaseModel"
      }
    ],
    "properties": {
      "denominazione": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Denominazione del soggetto"
      },
      "codice_fiscale": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto.\nIn base alla nazione (\"nazione_id\") verranno effettuate le seguenti validazioni:\n- IT: validazioni formale per codice fiscale personale (16 caratteri) o formato partita IVA (11 cifre decimali)\n- UE: da 5 a 20 caratteri con successiva validazione formale specifica per il paese UE\n- Extra UE: da 5 a 20 caratteri"
      },
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>",
        "nullable": true
      }
    },
    "description": "Dati trasportatore"
  }
} as const
