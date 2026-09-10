/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `CopiaCartaceaModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_COPIA_CARTACEA = {
  "required": [
    "data_emissione",
    "file_content",
    "mime",
    "nome_file",
    "numero_fir",
    "produttore"
  ],
  "type": "object",
  "properties": {
    "file_content": {
      "type": "string",
      "description": "Contenuto del file che rappresenta la copia cartacea del formulario codificato in base64",
      "format": "byte"
    },
    "nome_file": {
      "minLength": 1,
      "type": "string",
      "description": "Nome del file"
    },
    "mime": {
      "minLength": 1,
      "type": "string",
      "description": "Tipo MIME del file da caricare.\nValori ammessi: \n<ul><li><i>application/pdf</i></li><li><i>image/jpeg</i></li><li><i>image/png</i></li></ul>"
    },
    "numero_fir": {
      "minLength": 1,
      "pattern": "^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$",
      "type": "string",
      "description": "Numero del FIR cartaceo, rilasciato al momento della vidimazione"
    },
    "data_emissione": {
      "type": "string",
      "description": "Data emissione del formulario cartaceo (formato ISO 8601 UTC)\nÈ necessario specificare una data antecedente o uguale alla data corrente",
      "format": "date-time"
    },
    "produttore": {
      "allOf": [
        {
          "$ref": "#/components/schemas/CopiaCartaceaSoggettoInfo"
        }
      ],
      "description": "Dati del produttore a cui si rende disponibile la copia cartacea"
    },
    "trasportatori": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/CopiaCartaceaSoggettoInfo"
      },
      "nullable": true
    },
    "intermediari": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/CopiaCartaceaSoggettoInfo"
      },
      "nullable": true
    },
    "note": {
      "maxLength": 500,
      "type": "string",
      "description": "Eventuali note riguardanti la copia cartacea",
      "nullable": true
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `CopiaCartaceaModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_COPIA_CARTACEA = {
  "CopiaCartaceaSoggettoInfo": {
    "required": [
      "codice_fiscale",
      "denominazione"
    ],
    "type": "object",
    "properties": {
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>\n\n<i>Questo campo viene utilizzato esclusivamente per validare i dati di input in base alla nazione di appartenenza (non viene memorizzato e quindi restituito in output).</i>",
        "nullable": true
      },
      "identificativo": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto\n⚠️ Deprecato: utilizzare \"codice_fiscale\"",
        "nullable": true,
        "deprecated": true
      },
      "codice_fiscale": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto. \nIn base alla nazione (\"nazione_id\") verranno effettuate le seguenti validazioni:\n- IT: validazioni formale per codice fiscale personale (16 caratteri) o formato partita IVA (11 cifre decimali)\n- UE: da 5 a 20 caratteri con successiva validazione formale specifica per il paese UE\n- Extra UE: da 5 a 20 caratteri"
      },
      "denominazione": {
        "maxLength": 1024,
        "minLength": 1,
        "type": "string",
        "description": "Denominazione del soggetto"
      },
      "num_iscr_sito": {
        "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
        "type": "string",
        "description": "Numero iscrizione unità locale. \nIl parametro è opzionale e deve essere fornito al trasportatore dal soggetto.",
        "nullable": true
      }
    },
    "additionalProperties": false
  }
} as const
