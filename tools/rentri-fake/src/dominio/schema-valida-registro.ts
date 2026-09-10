/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `ValidaRegistroRequest` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_VALIDA_REGISTRO = {
  required: ['file_content', 'mime', 'nome_file'],
  type: 'object',
  properties: {
    file_content: {
      type: 'string',
      description:
        'Contenuto in Base64 del file XML, o del file ZIP contenente il file XML, del registro cronologico di carico e scarico digitale.\nDimensione massima consentita del file 10 MB.',
      format: 'byte',
    },
    nome_file: {
      minLength: 1,
      type: 'string',
      description:
        "Nome completo del file da validare, comprensivo di estensione obbligatoria. L'estensione deve essere coerente con il contenuto inviato nel campo file_content: \n.xml per il file del registro in formato XML standard, .zip se il file XML è stato compresso. \nRichieste prive di estensione o con estensioni non supportate verranno scartate dal sistema.",
    },
    mime: {
      minLength: 1,
      type: 'string',
      description: 'Tipo MIME del file da caricare',
    },
  },
  additionalProperties: false,
  description:
    'Richiesta per la validazione strutturale del registro cronologico di carico e scarico digitale in formato XML',
} as const

/** Schemi raggiunti da `ValidaRegistroRequest` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_VALIDA_REGISTRO = {} as const
