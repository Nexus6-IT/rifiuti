/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `AnnullamentoMovimentoModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-movimenti-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_ANNULLAMENTO_MOVIMENTO = {
  title: 'AnnullamentoMovimentoModel',
  required: [
    'annotazioni',
    'data_ora_registrazione',
    'numero_registrazione',
    'numero_registrazione_annullata',
  ],
  type: 'object',
  allOf: [
    {
      $ref: '#/components/schemas/OperazioneMovimentoBaseModel',
    },
  ],
  properties: {
    numero_registrazione: {
      title: 'AnnoProgressivoMovimentoModel',
      allOf: [
        {
          $ref: '#/components/schemas/AnnoProgressivoMovimentoModel',
        },
      ],
      description:
        'Numero registrazione della rettifica di annullamento tramite anno di riferimento e progressivo',
    },
    data_ora_registrazione: {
      type: 'string',
      description:
        'Data di registrazione (formato ISO 8601 UTC) dell\'annullamento come previsto nel modello di registro RENTRI.\nTrattandosi di una registrazione informatica, è consentito indicare l\'ora, anche se non obbligatoria.\n\n<b>Esempi:</b> solo data = "2024-01-01", data con ora = "2024-01-01T12:00:00Z"',
      format: 'date-time',
    },
    numero_registrazione_annullata: {
      oneOf: [
        {
          $ref: '#/components/schemas/AnnoProgressivoMovimentoModel',
        },
        {
          $ref: '#/components/schemas/IdentificativoMovimentoModel',
        },
      ],
      description: 'Numero registrazione della registrazione da annullare',
    },
    annotazioni: {
      maxLength: 500,
      minLength: 1,
      type: 'string',
      description: "Annotazioni contenenti il motivo dell'annullamento",
    },
  },
  description: 'Annullamento registrazione',
} as const

/** Schemi raggiunti da `AnnullamentoMovimentoModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_ANNULLAMENTO_MOVIMENTO = {
  IdentificativoMovimentoModel: {
    title: 'IdentificativoMovimentoModel',
    required: ['identificativo'],
    type: 'object',
    allOf: [
      {
        $ref: '#/components/schemas/IdentificativoMovimentoBaseModel',
      },
    ],
    properties: {
      identificativo: {
        minLength: 1,
        pattern: '^M[0-9A-Z]{19}$',
        type: 'string',
        description: 'Identificativo RENTRI',
      },
    },
    description:
      'Dati di identificazione della registrazione tramite identificativo rilasciato dal RENTRI',
  },
  IdentificativoMovimentoBaseModel: {
    type: 'object',
    description:
      'Dati di identificazione della registrazione tramite anno di riferimento e progressivo oppure identificativo rilasciato dal RENTRI',
  },
  AnnoProgressivoMovimentoModel: {
    title: 'AnnoProgressivoMovimentoModel',
    required: ['anno', 'progressivo'],
    type: 'object',
    allOf: [
      {
        $ref: '#/components/schemas/IdentificativoMovimentoBaseModel',
      },
    ],
    properties: {
      anno: {
        maximum: 2050,
        minimum: 1980,
        type: 'integer',
        description: 'Anno di riferimento della registrazione',
        format: 'int32',
      },
      progressivo: {
        maximum: 2147483647,
        minimum: 1,
        type: 'integer',
        description: 'Progressivo della registrazione',
        format: 'int32',
      },
    },
    description:
      'Dati di identificazione della registrazione tramite anno di riferimento e progressivo',
  },
  OperazioneMovimentoBaseModel: {
    type: 'object',
    description: 'Dati della registrazione',
  },
} as const
