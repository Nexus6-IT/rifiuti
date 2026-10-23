/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `CredentialsAuthorizeRequest` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/ca-rentri.yaml`.
 * L'allineamento e' imposto da `test/schema-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_CA_RENTRI_AUTHORIZE = {
  "required": [
    "credentials_id",
    "description",
    "hash_algo",
    "hashes",
    "num_signatures"
  ],
  "type": "object",
  "properties": {
    "credentials_id": {
      "maxLength": 9,
      "minLength": 9,
      "type": "string",
      "description": "Identificativo delle credenziali di firma."
    },
    "num_signatures": {
      "type": "integer",
      "format": "int32"
    },
    "hashes": {
      "maxItems": 1,
      "minItems": 1,
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "Elenco dei codici hash da firmare in formato base 64. Attualmente è consentito l'invio di un solo codice hash."
    },
    "hash_algo": {
      "minLength": 1,
      "pattern": "^2\\.16\\.840\\.1\\.101\\.3\\.4\\.2\\.1$",
      "type": "string",
      "description": "OID dell'algoritmo utilizzato per calcolare l'hash fisso a 2.16.840.1.101.3.4.2.1 (SHA256)"
    },
    "description": {
      "maxLength": 1000,
      "minLength": 1,
      "pattern": "^[A-Za-zÀ-ÖØ-öø-ÿ0-9\\s\\.,;:!?\\-\\(\\)/€%&@]*$",
      "type": "string",
      "description": "Descrizione dell'operazione associata alla richiesta di autorizzazione."
    },
    "auth_data": {
      "maxItems": 1,
      "minItems": 1,
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/AuthObjectData"
      },
      "description": "Metodo di autenticazione abbinato alle credenziali.",
      "nullable": true
    },
    "client_data": {
      "type": "string",
      "description": "Dati arbitrari dell'applicazione di firma.",
      "nullable": true
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `CredentialsAuthorizeRequest` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_CA_RENTRI_AUTHORIZE = {
  "AuthObjectData": {
    "type": "object",
    "properties": {
      "id": {
        "pattern": "(?i)^mobile$",
        "type": "string",
        "description": "Identificativo del metodo di autenticazione. Attualmente è supportato solo il valore \"mobile\".",
        "nullable": true
      },
      "value": {
        "type": "string",
        "description": "Utilizzato per indicare il valore del fattore di autenticazione. Inutilizzato per il metodo \"mobile\".",
        "nullable": true
      }
    },
    "additionalProperties": false
  }
} as const
