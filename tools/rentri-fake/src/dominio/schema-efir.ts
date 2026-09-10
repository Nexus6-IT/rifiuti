/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `EfirModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_EFIR = {
  "type": "object",
  "properties": {
    "utente_richiesta": {
      "type": "string",
      "description": "Codice fiscale dell'utente che ha richiesto la vidimazione del FIR",
      "nullable": true
    },
    "denominazione_utente_richiesta": {
      "type": "string",
      "description": "Denominazione dell'utente che ha richiesto la vidimazione del FIR",
      "nullable": true
    },
    "utente_annullamento": {
      "type": "string",
      "description": "Autore dell'eventuale annullamento del FIR",
      "nullable": true
    },
    "origine": {
      "allOf": [
        {
          "$ref": "#/components/schemas/Origine"
        }
      ],
      "description": "Indica se il FIR sia stato generato attraverso il sistema di interoperabilità (API) o attraverso il portale",
      "nullable": true
    },
    "xml": {
      "type": "string",
      "description": "Xml firmato del FIR in fase di vidimazione. Il dato è eventualmente restituito dalla richiesta dei dati di vidimazione FIR.",
      "nullable": true
    },
    "progressivo": {
      "type": "integer",
      "description": "Numero progressivo del FIR all'interno del blocco di appartenenza",
      "format": "int32"
    },
    "numero_fir": {
      "type": "string",
      "description": "Codice seriale del FIR contenente la concatenazione del codice di blocco, il progressivo ed il checksum",
      "nullable": true
    },
    "qr_code_bytes": {
      "type": "string",
      "description": "Array di byte contenuto nel codice QR Code che consente di verificare la validità del FIR.\nL'array di byte viene restituito codificato in Base64 dall'endpoint in una proprietà JSON di tipo stringa.\nIl formato del contenuto del QR Code è conforme allo standard CBOR Object Signing and Encryption (COSE), RFC 8152.",
      "format": "byte",
      "nullable": true
    },
    "check_sum": {
      "type": "string",
      "description": "Caratteri alfanumerici utilizzati come codice univoco associato in sede di vidimazione al numero FIR",
      "nullable": true
    },
    "data_richiesta": {
      "type": "string",
      "description": "Data e ora in cui è stata effettuata la richiesta di vidimazione del FIR (formato ISO 8601 UTC)",
      "format": "date-time"
    },
    "denominazione_soggetto": {
      "type": "string",
      "description": "Ragione sociale del soggetto per conto del quale è stato vidimato il FIR",
      "nullable": true
    },
    "codice_fiscale_soggetto": {
      "type": "string",
      "description": "Codice fiscale del soggetto per conto del quale è stato vidimato il FIR",
      "nullable": true
    },
    "num_iscr_sito": {
      "type": "string",
      "description": "Numero di iscrizione dell'unità locale del soggetto per conto del quale è stato vidimato il FIR",
      "nullable": true
    },
    "codice_blocco": {
      "type": "string",
      "description": "Codice del blocco a cui appartiene il FIR",
      "nullable": true
    },
    "cciaa_nome": {
      "type": "string",
      "description": "Nome della CCIAA di competenza del FIR",
      "nullable": true
    },
    "is_annullato": {
      "type": "boolean",
      "description": "Stato di annullamento del FIR",
      "nullable": true
    },
    "data_annullamento": {
      "type": "string",
      "description": "Data dell'eventuale annullamento del FIR (formato ISO 8601 UTC)",
      "format": "date-time",
      "nullable": true
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `EfirModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_EFIR = {
  "Origine": {
    "enum": [
      "Portale",
      "Api"
    ],
    "type": "string"
  }
} as const
