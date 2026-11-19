/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `DatiTrasbordoParzialeModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-viaggio-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_TRASBORDO_PARZIALE = {
  "required": [
    "causale",
    "numero_fir",
    "quantita_residua",
    "trasportatore"
  ],
  "type": "object",
  "properties": {
    "numero_fir": {
      "minLength": 1,
      "pattern": "^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$",
      "type": "string",
      "description": "Numero FIR del formulario in cui viene trasbordato parzialmente il rifiuto"
    },
    "trasportatore": {
      "allOf": [
        {
          "$ref": "#/components/schemas/DatiTrasportatoreTrasbordoModel"
        }
      ],
      "description": "Trasportatore che prende in carico il rifiuto parzialmente trasbordato"
    },
    "quantita_residua": {
      "allOf": [
        {
          "$ref": "#/components/schemas/QuantitaModel`1"
        }
      ],
      "description": "Quantità residua del rifiuto nel formulario di origine"
    },
    "causale": {
      "maxLength": 1000,
      "minLength": 1,
      "type": "string",
      "description": "Causale del trasbordo parziale"
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `DatiTrasbordoParzialeModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_TRASBORDO_PARZIALE = {
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
  },
  "DatiTrasportatoreTrasbordoModel": {
    "required": [
      "codice_fiscale",
      "denominazione"
    ],
    "type": "object",
    "properties": {
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>",
        "nullable": true
      },
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
      "numero_iscrizione_albo": {
        "maxLength": 10,
        "pattern": "^([A-Za-z]{2})/([0-9]{6})$",
        "type": "string",
        "description": "Iscrizione Albo",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "description": "Dati trasportatore per il trasbordo parziale"
  }
} as const
