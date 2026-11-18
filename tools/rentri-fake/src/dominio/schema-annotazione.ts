/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `DatiAnnotazioneModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-viaggio-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_ANNOTAZIONE = {
  "required": [
    "annotazione",
    "identificativo_soggetto"
  ],
  "type": "object",
  "properties": {
    "annotazione": {
      "maxLength": 10000,
      "minLength": 1,
      "type": "string",
      "description": "Contenuto dell'annotazione"
    },
    "identificativo_soggetto": {
      "minLength": 1,
      "type": "string",
      "description": "Il codice fiscale del soggetto per cui viene richiesta l'aggiunta dell'annotazione al formulario. \nDeve coincidere con quello di uno dei soggetti coinvolti nel formulario.\nL'identità con cui viene eseguita l'operazione deve avere visibilità su (o coincidere con) questo soggetto."
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `DatiAnnotazioneModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_ANNOTAZIONE = {} as const
