/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `CopiaCartaceaConfermaModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-copie-allineate-al-contratto.test.ts`.
 */
export const SCHEMA_COPIA_CARTACEA_CONFERMA = {
  "required": [
    "identificativo"
  ],
  "type": "object",
  "properties": {
    "identificativo": {
      "minLength": 1,
      "type": "string",
      "description": "Identificativo univoco della copia del FIR cartaceo"
    },
    "num_iscr_sito": {
      "type": "string",
      "description": "Eventuale Numero iscrizione unità locale al quale associare la conferma della copia del FIR cartaceo",
      "nullable": true
    },
    "ruolo": {
      "allOf": [
        {
          "$ref": "#/components/schemas/RuoloConfermaCopiaCartacea"
        }
      ],
      "description": "Ruolo all'interno del FIR del soggetto per cui si effettua l'operazione di conferma di presa visione."
    },
    "respingi": {
      "type": "boolean",
      "description": "Effettua l'operazione di annullamento di una precedente conferma",
      "nullable": true
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `CopiaCartaceaConfermaModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_COPIA_CARTACEA_CONFERMA = {
  "RuoloConfermaCopiaCartacea": {
    "enum": [
      "Produttore",
      "Trasportatore",
      "Intermediario"
    ],
    "type": "string"
  }
} as const
