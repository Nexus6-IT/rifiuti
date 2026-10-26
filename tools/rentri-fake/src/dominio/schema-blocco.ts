/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `BloccoModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/vidimazione-formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-vidimazione-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_BLOCCO = {
  "type": "object",
  "properties": {
    "disattivo": {
      "type": "boolean",
      "description": "Stato di attivazione del blocco virtuale"
    },
    "identificativo_soggetto": {
      "maxLength": 255,
      "type": "string",
      "description": "Codice fiscale del soggetto a cui è associato il blocco",
      "nullable": true
    },
    "denominazione_soggetto": {
      "type": "string",
      "description": "Denominazione del soggetto a cui è associato il blocco",
      "nullable": true
    },
    "codice_blocco": {
      "type": "string",
      "description": "Codice del blocco virtuale",
      "nullable": true
    },
    "descrizione": {
      "type": "string",
      "description": "Descrizione del blocco virtuale",
      "nullable": true
    },
    "codice_fiscale_utente": {
      "type": "string",
      "description": "Codice fiscale dell'utente che ha creato il blocco",
      "nullable": true
    },
    "data_creazione": {
      "type": "string",
      "description": "Formato ISO 8601 UTC",
      "format": "date-time",
      "nullable": true
    },
    "numero_fir_vidimati": {
      "type": "integer",
      "description": "Contatore dei FIR vidimati sul blocco virtuale",
      "format": "int32"
    },
    "data_ultimo_utilizzo": {
      "type": "string",
      "description": "Formato ISO 8601 UTC",
      "format": "date-time",
      "nullable": true
    },
    "num_iscr_sito": {
      "type": "string",
      "description": "Numero di iscrizione dell'unità locale a cui è associato il blocco virtuale",
      "nullable": true
    },
    "indirizzo": {
      "type": "string",
      "description": "Indirizzo dell'unità locale a cui è associato il blocco virtuale",
      "nullable": true
    },
    "civico": {
      "type": "string",
      "description": "Numero civico dell'indirizzo dell'unità locale a cui è associato il blocco virtuale",
      "nullable": true
    },
    "comune_id": {
      "type": "string",
      "description": "Codice ISTAT del comune dell'unità locale a cui è associato il blocco virtuale",
      "nullable": true
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `BloccoModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_BLOCCO = {} as const
