/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `SignatureRequest` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/ca-rentri.yaml`.
 * L'allineamento e' imposto da `test/schema-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_CA_RENTRI_SIGN_HASH = {
  "required": [
    "credentials_id",
    "hashes",
    "sad",
    "sign_algo"
  ],
  "type": "object",
  "properties": {
    "credentials_id": {
      "maxLength": 9,
      "minLength": 9,
      "type": "string",
      "description": "Identificativo delle credenziali di firma."
    },
    "sad": {
      "minLength": 1,
      "type": "string",
      "description": "SAD (Signature Activation Data)."
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
      "pattern": "^2\\.16\\.840\\.1\\.101\\.3\\.4\\.2\\.1$",
      "type": "string",
      "description": "OID dell'algoritmo utilizzato per calcolare l'hash. Questo parametro deve essere omesso o ignorato se l'algoritmo hash è implicitamente specificato dal parametro SignAlgo.",
      "nullable": true
    },
    "sign_algo": {
      "minLength": 1,
      "pattern": "^1\\.2\\.840\\.10045\\.4\\.3\\.2$",
      "type": "string",
      "description": "OID dell'algoritmo da utilizzare per la firma. Deve essere uno dei valori consentiti dalle credenziali."
    },
    "sign_algo_params": {
      "type": "string",
      "description": "I parametri per l'algoritmo di firma, se richiesti dall'algoritmo di firma.",
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

/** Schemi raggiunti da `SignatureRequest` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_CA_RENTRI_SIGN_HASH = {} as const
