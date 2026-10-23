/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `MovimentoModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_MOVIMENTO = {
  title: 'MovimentoModel',
  required: ['riferimenti'],
  type: 'object',
  properties: {
    riferimenti: {
      allOf: [
        {
          $ref: '#/components/schemas/DatiRiferimentiModel',
        },
      ],
      description: 'Riferimenti operazione',
    },
    rifiuto: {
      allOf: [
        {
          $ref: '#/components/schemas/DatiRifiutoModel',
        },
      ],
      description:
        'Identificazione del rifiuto.\n\nRichiesto solamente se causale_operazione è diversa da "M".',
      nullable: true,
    },
    materiali: {
      allOf: [
        {
          $ref: '#/components/schemas/DatiMaterialiModel',
        },
      ],
      description:
        'Materiali (solo impianti).\n\nRichiesto solamente se causale_operazione è uguale a "M".',
      nullable: true,
    },
    integrazione_fir: {
      allOf: [
        {
          $ref: '#/components/schemas/DatiIntegrazioneFirModel',
        },
      ],
      description:
        'Integrazione FIR - Registro C/S.\n\nNon deve essere indicato se causale_operazione è diversa da "aT", "TR", "T*", "T*AT".',
      nullable: true,
    },
    esito: {
      allOf: [
        {
          $ref: '#/components/schemas/DatiEsitoModel',
        },
      ],
      description:
        'Esito conferimento.\n\nNon deve essere indicato se causale_operazione è diversa da "aT", "T*AT".',
      nullable: true,
    },
    produttore: {
      allOf: [
        {
          $ref: '#/components/schemas/DatiProduttoreModel',
        },
      ],
      description: 'Produttore del rifiuto',
      nullable: true,
    },
    trasportatore: {
      allOf: [
        {
          $ref: '#/components/schemas/DatiTrasportatoreModel',
        },
      ],
      description: 'Trasportatore',
      nullable: true,
    },
    destinatario: {
      allOf: [
        {
          $ref: '#/components/schemas/DatiDestinatarioModel',
        },
      ],
      description: 'Destinatario',
      nullable: true,
    },
    intermediario: {
      allOf: [
        {
          $ref: '#/components/schemas/DatiIntermediarioModel',
        },
      ],
      description: 'Intermediario\r\n \r\n⚠️ Deprecato: utilizzare "intermediari"',
      nullable: true,
      deprecated: true,
    },
    intermediari: {
      type: 'array',
      items: {
        $ref: '#/components/schemas/DatiIntermediarioModel',
      },
      description: 'Intermediari',
      nullable: true,
    },
    annotazioni: {
      maxLength: 500,
      type: 'string',
      description: 'Annotazioni generiche',
      nullable: true,
    },
  },
  description: 'Dati della registrazione',
} as const

/** Schemi raggiunti da `MovimentoModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_MOVIMENTO = {
  DatiIntermediarioModel: {
    required: ['codice_fiscale', 'denominazione'],
    type: 'object',
    properties: {
      denominazione: {
        maxLength: 255,
        minLength: 1,
        type: 'string',
        description: 'Denominazione del soggetto',
      },
      codice_fiscale: {
        maxLength: 20,
        minLength: 5,
        type: 'string',
        description: 'Codice fiscale',
      },
      nazione_id: {
        type: 'string',
        description:
          'Codice ISO 3166-1 alpha-2 della nazione, in caso di "IT" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>\n\n<i>Questo campo viene utilizzato esclusivamente per validare i dati di input in base alla nazione di appartenenza (non viene memorizzato e quindi restituito in output).</i>',
        nullable: true,
        deprecated: true,
      },
      num_iscrizione_albo: {
        pattern: '^([A-Za-z]{2})/([0-9]{6})$',
        type: 'string',
        description: "Numero di iscrizione all'Albo Nazionale Gestori Ambientali",
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Intermediario',
  },
  DatiDestinatarioModel: {
    required: ['codice_fiscale', 'denominazione'],
    type: 'object',
    properties: {
      denominazione: {
        maxLength: 255,
        minLength: 1,
        type: 'string',
        description: 'Denominazione del soggetto',
      },
      codice_fiscale: {
        maxLength: 20,
        minLength: 5,
        type: 'string',
        description: 'Codice fiscale',
      },
      nazione_id: {
        type: 'string',
        description:
          'Codice ISO 3166-1 alpha-2 della nazione, in caso di "IT" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>\n\n<i>Questo campo viene utilizzato esclusivamente per validare i dati di input in base alla nazione di appartenenza (non viene memorizzato e quindi restituito in output).</i>',
        nullable: true,
      },
      num_autorizzazione: {
        maxLength: 50,
        type: 'string',
        description:
          'Numero autorizzazione.\nNon obbligatorio nel caso di destinatario estero, richiesto in caso contrario',
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Destinatario',
  },
  DatiTrasportatoreModel: {
    required: ['codice_fiscale', 'denominazione'],
    type: 'object',
    properties: {
      denominazione: {
        maxLength: 255,
        minLength: 1,
        type: 'string',
        description: 'Denominazione del soggetto',
      },
      codice_fiscale: {
        maxLength: 20,
        minLength: 5,
        type: 'string',
        description: 'Codice fiscale',
      },
      nazione_id: {
        type: 'string',
        description:
          'Codice ISO 3166-1 alpha-2 della nazione, in caso di "IT" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>\n\n<i>Questo campo viene utilizzato esclusivamente per validare i dati di input in base alla nazione di appartenenza (non viene memorizzato e quindi restituito in output).</i>',
        nullable: true,
        deprecated: true,
      },
      num_iscrizione_albo: {
        pattern: '^([A-Za-z]{2})/([0-9]{6})$',
        type: 'string',
        description: "Numero di iscrizione all'Albo Nazionale Gestori Ambientali",
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Trasportatore',
  },
  DatiProduttoreModel: {
    required: ['indirizzo'],
    type: 'object',
    properties: {
      denominazione: {
        maxLength: 255,
        type: 'string',
        description: 'Denominazione del soggetto',
        nullable: true,
      },
      codice_fiscale: {
        maxLength: 20,
        minLength: 5,
        type: 'string',
        description: 'Codice fiscale',
        nullable: true,
      },
      nazione_id: {
        type: 'string',
        description:
          'Codice ISO 3166-1 alpha-2 della nazione, in caso di "IT" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>\n\n<i>Questo campo viene utilizzato esclusivamente per validare i dati di input in base alla nazione di appartenenza (non viene memorizzato e quindi restituito in output).</i>',
        nullable: true,
        deprecated: true,
      },
      indirizzo: {
        allOf: [
          {
            $ref: '#/components/schemas/IndirizzoModel',
          },
        ],
        description: 'Indirizzo',
      },
    },
    additionalProperties: false,
    description: 'Produttore',
  },
  IndirizzoModel: {
    required: ['citta', 'indirizzo'],
    type: 'object',
    properties: {
      citta: {
        oneOf: [
          {
            $ref: '#/components/schemas/ComuneModel',
          },
          {
            $ref: '#/components/schemas/CittaEsteraModel',
          },
        ],
        description: 'Città estera o comune Italiano',
      },
      indirizzo: {
        maxLength: 100,
        minLength: 1,
        type: 'string',
        description: 'Indirizzo',
      },
      civico: {
        maxLength: 20,
        type: 'string',
        description: 'Civico',
        nullable: true,
      },
      cap: {
        maxLength: 20,
        type: 'string',
        description: 'CAP (se indirizzo italiano 5 cifre, altrimenti da 2 a 20 caratteri)',
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Indirizzo',
  },
  CittaEsteraModel: {
    title: 'CittaEsteraModel',
    required: ['nazione_id', 'nome_citta'],
    type: 'object',
    allOf: [
      {
        $ref: '#/components/schemas/CittaBaseModel',
      },
    ],
    properties: {
      nazione_id: {
        maxLength: 2,
        minLength: 1,
        pattern: '^(?!.*(?i)it).*$',
        type: 'string',
        description:
          'Codice ISO 3166-1 alpha-2 della nazione, in caso di "IT" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>',
      },
      nome_citta: {
        maxLength: 100,
        minLength: 1,
        type: 'string',
        description: 'Città estera',
      },
    },
    description: 'Città estera',
  },
  CittaBaseModel: {
    type: 'object',
    description: 'Città estera o comune Italiano',
  },
  ComuneModel: {
    title: 'ComuneModel',
    required: ['comune_id'],
    type: 'object',
    allOf: [
      {
        $ref: '#/components/schemas/CittaBaseModel',
      },
    ],
    properties: {
      comune_id: {
        maxLength: 6,
        minLength: 1,
        type: 'string',
        description:
          "Comune ISTAT del comune.\n\nNon vengono accettati codici non corrispondenti a codici ISTAT di comuni italiani.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/comuni</i>\n\nSono ammesse esclusivamente le codifiche attive oppure le codifiche non attive, purché la relativa data di fine validità in RENTRI \n(restituita dall'API di codifica) sia coerente con i dati trasmessi \n(esempio antecedente o uguale alla DataOraRegistrazione per le registrazioni relative ad un registro, o alla DataEmissione per i formulari).",
      },
    },
    description: 'Comune Italiano',
  },
  DatiEsitoModel: {
    type: 'object',
    properties: {
      data_fine_trasporto: {
        type: 'string',
        description: 'Data di fine trasporto (formato ISO 8601 UTC)',
        format: 'date-time',
        nullable: true,
      },
      peso_verificato_destino: {
        type: 'number',
        description:
          'Peso verificato a destino (parte intera: 10, parte decimale: 4) compreso tra 0.0000 e 9999999999.9999.',
        format: 'double',
        nullable: true,
      },
      respingimento: {
        allOf: [
          {
            $ref: '#/components/schemas/DatiRespingimentoModel',
          },
        ],
        description: 'Dati sul respingimento',
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Esito conferimento',
  },
  DatiRespingimentoModel: {
    required: ['tipo'],
    type: 'object',
    properties: {
      tipo: {
        allOf: [
          {
            $ref: '#/components/schemas/TipiRespingimento',
          },
        ],
        description:
          'Tipologia di respingimento\n\nVedi API di codifica: <i>GET /codifiche/v1.0/tipi-respingimento</i><p>Valori ammessi:<ul style="margin:0"><li><i>T</i> - Totale</li><li><i>P</i> - Parziale</li></ul></p>',
      },
      quantita: {
        allOf: [
          {
            $ref: '#/components/schemas/UnitaMisuraQuantitaModel',
          },
        ],
        description: 'Quantità respinta',
        nullable: true,
      },
      causale: {
        allOf: [
          {
            $ref: '#/components/schemas/CausaliRespingimento',
          },
        ],
        description:
          "Causale del respingimento\n\nVedi API di codifica: <i>GET /codifiche/v1.0/causali-respingimento</i><p>Valori ammessi:<ul style=\"margin:0\"><li><i>NC</i> - Non Conformità, a titolo esemplificativo e non esaustivo, si riporta: rifiuti diverso da quello descritto dal formulario o da quanto dichiarato ai fini della pratica di conferimento all'impianto, rifiuto confezionato in modo non conforme da quanto previsto per la specifica destinazione o dalle norme applicabili, di stato fisico diverso da quello previsto)</li><li><i>IR</i> - Irricevibile, (a titolo esemplificativo e non esaustivo, si riporta: rifiuto non previsto dall'autorizzazione / iscrizione dell'impianto di destino, mancanza dei requisiti per l'ammissibilità all'impianto quali caratterizzazione di base, analisi di classificazione o di ammissibilità…)</li><li><i>A</i> - Indicare motivazione. A titolo esemplificativo e non esaustivo, si riporta: esaurimento volumetria disponibile per conferimento rifiuto, chiusura impianto per manutenzione straordinaria, ecc.</li></ul></p>",
        nullable: true,
      },
      causale_altro: {
        maxLength: 50,
        type: 'string',
        description:
          'Altra tipologia di causale non prevista.\n\nRichiesto solamente se causale è uguale a "A".',
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Respingimento',
  },
  CausaliRespingimento: {
    enum: ['NC', 'IR', 'A'],
    type: 'string',
  },
  UnitaMisuraQuantitaModel: {
    required: ['unita_misura', 'valore'],
    type: 'object',
    properties: {
      valore: {
        type: 'number',
        description:
          'Quantità (parte intera: 10, parte decimale: 4) compresa tra 0.0000 e 9999999999.9999.',
        format: 'double',
      },
      unita_misura: {
        allOf: [
          {
            $ref: '#/components/schemas/UnitaMisura',
          },
        ],
        description:
          'Unità di misura della quantità\n\nVedi API di codifica: <i>GET /codifiche/v1.0/unita-misura</i><p>Valori ammessi:<ul style="margin:0"><li><i>kg</i> - Chilogrammi</li><li><i>l</i> - Litri</li></ul></p>',
      },
    },
    additionalProperties: false,
  },
  UnitaMisura: {
    enum: ['kg', 'l'],
    type: 'string',
  },
  TipiRespingimento: {
    enum: ['T', 'P'],
    type: 'string',
  },
  DatiIntegrazioneFirModel: {
    type: 'object',
    properties: {
      numero_fir: {
        maxLength: 20,
        type: 'string',
        description:
          'Numero del FIR, oppure in caso di trasporto transfrontaliero, il numero di notifica e numero di serie della spedizione, ove previsto.',
        nullable: true,
      },
      trasporto_transfrontaliero: {
        type: 'boolean',
        description: 'Trasporto transfrontaliero',
        nullable: true,
      },
      tipo_trasporto_transfrontaliero: {
        allOf: [
          {
            $ref: '#/components/schemas/TipiTrasportoTransfrontaliero',
          },
        ],
        description:
          'Tipo trasporto transfrontaliero.\n\nRichiesto solamente se trasporto_transfrontaliero è uguale a true.\nVedi API di codifica: <i>GET /codifiche/v1.0/tipi-trasporto-transfrontaliero</i><p>Valori ammessi:<ul style="margin:0"><li><i>DM</i> - Documento di movimento (Allegato I-B - al Regolamento 1013/06)</li><li><i>DA</i> - Documento di accompagnamento (Allegato VII - al Regolamento 1013/06)</li></ul></p>',
        nullable: true,
      },
      data_inizio_trasporto: {
        type: 'string',
        description: 'Data inizio trasporto (formato ISO 8601 UTC)',
        format: 'date-time',
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Integrazione FIR - Registro C/S',
  },
  TipiTrasportoTransfrontaliero: {
    enum: ['DM', 'DA'],
    type: 'string',
  },
  DatiMaterialiModel: {
    required: ['materiale'],
    type: 'object',
    properties: {
      materiale: {
        allOf: [
          {
            $ref: '#/components/schemas/Materiali',
          },
        ],
        description:
          'Materiale\n\nVedi API di codifica: <i>GET /codifiche/v1.0/materiali</i><p>Valori ammessi:<ul style="margin:0"><li><i>ACV</i> - 1 - Ammendante compostato verde</li><li><i>ACM</i> - 2 - Ammendante compostato misto</li><li><i>AA</i> - 3 - Altri Ammendanti</li><li><i>DIG</i> - 4 - Digestato</li><li><i>AGG</i> - 5 - Aggregati riciclati</li><li><i>RA</i> - 6 - Rottami di alluminio</li><li><i>RV</i> - 7 - Rottami di vetro</li><li><i>RFA</i> - 8 - Rottami di ferro e acciaio</li><li><i>RR</i> - 9 - Rottami di rame</li><li><i>CC</i> - 10 - Carta e cartone</li><li><i>PLA</i> - 11 - Plastica</li><li><i>LS</i> - 12 - Legno e sughero</li><li><i>CSS</i> - 13 - CSS – combustibile</li><li><i>TE</i> - 14 - Tessili</li><li><i>GOM</i> - 15\t- Gomma</li><li><i>CU</i> - 16 - Cuoio</li><li><i>MC</i> - 17 - Materiali ceramici</li><li><i>CF</i> - 18 - Correttivi da Fanghi</li><li><i>AF</i> - 19 - Altri Fertilizzanti</li><li><i>GCB</i> - 20 - Granulato di Conglomerato bituminoso</li><li><i>ASS</i> - 21 - Materiali secondari derivanti dal recupero di prodotti assorbenti per la persona</li><li><i>GMV</i> - 22 - Gomma vulcanizzata da PFU</li><li><i>A</i> - 23 - Altro</li></ul></p>',
      },
      descrizione_materiale: {
        maxLength: 50,
        type: 'string',
        description: 'Descrizione materiale',
        nullable: true,
      },
      quantita: {
        allOf: [
          {
            $ref: '#/components/schemas/UnitaMisuraPesoQuantitaModel',
          },
        ],
        description: 'Quantità',
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Materiali (solo Impianti)',
  },
  UnitaMisuraPesoQuantitaModel: {
    required: ['unita_misura', 'valore'],
    type: 'object',
    properties: {
      valore: {
        type: 'number',
        description:
          'Quantità (parte intera: 10, parte decimale: 4) compresa tra 0.0000 e 9999999999.9999.',
        format: 'double',
      },
      unita_misura: {
        allOf: [
          {
            $ref: '#/components/schemas/UnitaMisuraPeso',
          },
        ],
        description:
          'Unità di misura della quantità\n\nVedi API di codifica: <i>GET /codifiche/v1.0/unita-misura</i><p>Valori ammessi:<ul style="margin:0"><li><i>kg</i> - Chilogrammi</li></ul></p>',
      },
    },
    additionalProperties: false,
  },
  UnitaMisuraPeso: {
    enum: ['kg'],
    type: 'string',
  },
  Materiali: {
    enum: [
      'ACV',
      'ACM',
      'AA',
      'DIG',
      'AGG',
      'RA',
      'RV',
      'RFA',
      'RR',
      'CC',
      'PLA',
      'LS',
      'CSS',
      'TE',
      'GOM',
      'CU',
      'MC',
      'CF',
      'AF',
      'GCB',
      'ASS',
      'GMV',
      'A',
    ],
    type: 'string',
  },
  DatiRifiutoModel: {
    required: ['codice_eer', 'quantita', 'stato_fisico'],
    type: 'object',
    properties: {
      codice_eer: {
        minLength: 1,
        type: 'string',
        description:
          'Codice EER.\n\nCodice numerico di 6 caratteri che identifica il rifiuto in base alla Lista Europea dei Rifiuti (European Waste List - EWL), \nvengono accettati solo codici EER validi e presenti nella lista ufficiale, senza alcun carattere separatore.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/codici-eer</i>',
      },
      descrizione_eer: {
        maxLength: 250,
        type: 'string',
        description:
          'Descrizione del rifiuto, richiesta se il Codice EER specificato è di tipo .99',
        nullable: true,
      },
      provenienza: {
        allOf: [
          {
            $ref: '#/components/schemas/ProvenienzaRifiuto',
          },
        ],
        description:
          'Provenienza\n\nVedi API di codifica: <i>GET /codifiche/v1.0/provenienza</i><p>Valori ammessi:<ul style="margin:0"><li><i>U</i> - Urbano</li><li><i>S</i> - Speciale</li></ul></p>',
        nullable: true,
      },
      caratteristiche_pericolo: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/CaratteristichePericolo',
        },
        description:
          'Caratteristiche di pericolo (HP)\n\nVedi API di codifica: <i>GET /codifiche/v1.0/caratteristiche-pericolo</i><p>Valori ammessi:<ul style="margin:0"><li><i>HP01</i> - Esplosivo</li><li><i>HP02</i> - Comburente</li><li><i>HP03</i> - Infiammabile</li><li><i>HP04</i> - Irritante - Irritazione cutanea e lesioni oculari</li><li><i>HP05</i> - Tossicità specifica per organi bersaglio (STOT)/Tossicità in caso di aspirazione</li><li><i>HP06</i> - Tossicità acuta</li><li><i>HP07</i> - Cancerogeno</li><li><i>HP08</i> - Corrosivo</li><li><i>HP09</i> - Infettivo</li><li><i>HP10</i> - Tossico per la riproduzione</li><li><i>HP11</i> - Mutageno</li><li><i>HP12</i> - Liberazione di gas a tossicità acuta</li><li><i>HP13</i> - Sensibilizzante</li><li><i>HP14</i> - Ecotossico</li><li><i>HP15</i> - Rifiuto che non possiede direttamente una delle caratteristiche di pericolo summenzionate ma può manifestarla successivamente</li></ul></p>',
        nullable: true,
      },
      stato_fisico: {
        allOf: [
          {
            $ref: '#/components/schemas/StatiFisici',
          },
        ],
        description:
          'Stato fisico\n\nVedi API di codifica: <i>GET /codifiche/v1.0/stati-fisici</i><p>Valori ammessi:<ul style="margin:0"><li><i>SP</i> - In polvere o pulverulento</li><li><i>S</i> - Solido</li><li><i>FP</i> - Fangoso</li><li><i>L</i> - Liquido</li><li><i>VS</i> - Vischioso sciropposo</li></ul></p>',
      },
      quantita: {
        allOf: [
          {
            $ref: '#/components/schemas/UnitaMisuraQuantitaModel',
          },
        ],
        description: 'Quantità',
      },
      destinato_attivita: {
        allOf: [
          {
            $ref: '#/components/schemas/DestinazioniRifiuto',
          },
        ],
        description:
          "Destinato a\n\nVedi API di codifica: <i>GET /codifiche/v1.0/attivita-rs</i><p>Valori ammessi:<ul style=\"margin:0\"><li><i>R1</i> - Utilizzazione principalmente come combustibile o come altro mezzo per produrre energia</li><li><i>R2</i> - Rigenerazione/recupero di solventi</li><li><i>R3</i> - Riciclaggio/recupero delle sostanze organiche non utilizzate come solventi (comprese le operazioni di compostaggio e altre trasformazioni biologiche)</li><li><i>R4</i> - Riciclaggio/recupero dei metalli e dei composti metallici</li><li><i>R5</i> - Riciclaggio/recupero di altre sostanze inorganiche</li><li><i>R6</i> - Rigenerazione degli acidi o delle basi</li><li><i>R7</i> - Recupero dei prodotti che servono a ridurre l'inquinamento</li><li><i>R8</i> - Recupero dei prodotti provenienti dai catalizzatori</li><li><i>R9</i> - Rigenerazione o altri reimpieghi degli oli</li><li><i>R10</i> - Trattamento in ambiente terrestre a beneficio dell'agricoltura o dell'ecologia</li><li><i>R11</i> - Utilizzazione di rifiuti ottenuti da una delle operazioni indicate da R1 a R10</li><li><i>R12</i> - Scambio di rifiuti per sottoporli a una delle operazioni indicate da R1 a R11</li><li><i>R13</i> - Messa in riserva di rifiuti per sottoporli a una delle operazioni indicate nei punti da R1 a R12 (escluso il deposito temporaneo, prima della raccolta, nel luogo in cui sono prodotti)</li><li><i>D1</i> - Deposito sul o nel suolo (ad esempio discarica)</li><li><i>D2</i> - Trattamento in ambiente terrestre (ad esempio biodegradazione di rifiuti liquidi o fanghi nei suoli)</li><li><i>D3</i> - Iniezioni in profondità (ad esempio iniezioni dei rifiuti pompabili in pozzi, in cupole saline o faglie geologiche naturali)</li><li><i>D4</i> - Lagunaggio (ad esempio scarico di rifiuti liquidi o di fanghi in pozzi, stagni o lagune, ecc.)</li><li><i>D5</i> - Messa in discarica specialmente allestita (ad esempio sistematizzazione in alveoli stagni, separati, ricoperti o isolati gli uni dagli altri e dall'ambiente)</li><li><i>D6</i> - Scarico dei rifiuti solidi nell'ambiente idrico eccetto l'immersione</li><li><i>D7</i> - Immersione, compreso il seppellimento nel sottosuolo marino</li><li><i>D8</i> - Trattamento biologico non specificato altrove nel presente allegato, che dia origine a composti o a miscugli che vengono eliminati secondo uno dei procedimenti elencati nei punti da D1 a D12</li><li><i>D9</i> - Trattamento fisico-chimico non specificato altrove nel presente allegato, che dia origine a composti o a miscugli eliminati secondo uno dei procedimenti elencati nei punti da D1 a D12 (ad esempio evaporazione, essiccazione, calcinazione, ecc.)</li><li><i>D10</i> - Incenerimento a terra</li><li><i>D11</i> - Incenerimento in mare</li><li><i>D12</i> - Deposito permanente (ad esempio sistemazione di contenitori in una miniera)</li><li><i>D13</i> - Raggruppamento preliminare prima di una delle operazioni di cui ai punti da D1 a D12</li><li><i>D14</i> - Ricondizionamento preliminare prima di una delle operazioni di cui ai punti da D1 a D13</li><li><i>D15</i> - Deposito preliminare prima di una delle operazioni di cui ai punti da D1 a D14 (escluso il deposito temporaneo, prima della raccolta, nel luogo in cui sono prodotti)</li><li><i>CR</i> - Centro di raccolta</li></ul></p>",
        nullable: true,
      },
      categorie_aee: {
        type: 'array',
        items: {
          $ref: '#/components/schemas/CategorieAee',
        },
        description:
          'Categoria AEE\n\nVedi API di codifica: <i>GET /codifiche/v1.0/categorie-raee</i><p>Valori ammessi:<ul style="margin:0"><li><i>Cat1</i> - Apparecchiature per lo scambio di temperatura.</li><li><i>Cat2</i> - Schermi, monitor ed apparecchiature dotate di schermi con una superficie superiore a 100 cm2.</li><li><i>Cat3</i> - Lampade.</li><li><i>Cat4</i> - Apparecchiature di grandi dimensioni (con almeno una dimensione esterna superiore a 50 cm). Questa categoria non include le apparecchiature appartenenti alle categorie 1, 2 e 3.</li><li><i>Cat5</i> - Apparecchiature di piccole dimensioni (con nessuna dimensione esterna superiore a 50 cm). Questa categoria non include le apparecchiature appartenenti alle categorie 1, 2, 3 e 6.</li><li><i>Cat6</i> - Piccole apparecchiature informatiche e per telecomunicazioni (con nessuna dimensione esterna superiore a 50 cm).</li><li><i>PF</i> - Pannelli fotovoltaici</li></ul></p>',
        nullable: true,
      },
      veicolo_fuori_uso: {
        type: 'boolean',
        description: 'Veicoli fuori uso',
        nullable: true,
      },
      veicolo_fuori_uso_reg_pubblica_sicurezza: {
        allOf: [
          {
            $ref: '#/components/schemas/VeicoloFuoriUsoRegPubblicaSicurezzaModel',
          },
        ],
        description:
          'Registro pubblica sicurezza.\n\nRichiesto solamente se veicolo_fuori_uso è uguale a true.',
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Identificazione del rifiuto',
  },
  VeicoloFuoriUsoRegPubblicaSicurezzaModel: {
    required: ['numero'],
    type: 'object',
    properties: {
      numero: {
        maxLength: 50,
        minLength: 1,
        type: 'string',
        description: 'Numero reg. pubblica sicurezza',
      },
      data: {
        type: 'string',
        description: 'Data reg. pubblica sicurezza (formato ISO 8601 UTC)',
        format: 'date-time',
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Registro pubblica sicurezza',
  },
  CategorieAee: {
    enum: ['Cat1', 'Cat2', 'Cat3', 'Cat4', 'Cat5', 'Cat6', 'PF'],
    type: 'string',
  },
  DestinazioniRifiuto: {
    enum: [
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
      'R6',
      'R7',
      'R8',
      'R9',
      'R10',
      'R11',
      'R12',
      'R13',
      'D1',
      'D2',
      'D3',
      'D4',
      'D5',
      'D6',
      'D7',
      'D8',
      'D9',
      'D10',
      'D11',
      'D12',
      'D13',
      'D14',
      'D15',
      'CR',
    ],
    type: 'string',
  },
  StatiFisici: {
    enum: ['SP', 'S', 'FP', 'L', 'VS'],
    type: 'string',
  },
  CaratteristichePericolo: {
    enum: [
      'HP01',
      'HP02',
      'HP03',
      'HP04',
      'HP05',
      'HP06',
      'HP07',
      'HP08',
      'HP09',
      'HP10',
      'HP11',
      'HP12',
      'HP13',
      'HP14',
      'HP15',
    ],
    type: 'string',
  },
  ProvenienzaRifiuto: {
    enum: ['U', 'S'],
    type: 'string',
  },
  DatiRiferimentiModel: {
    required: ['data_ora_registrazione', 'numero_registrazione'],
    type: 'object',
    properties: {
      numero_registrazione: {
        title: 'AnnoProgressivoMovimentoModel',
        allOf: [
          {
            $ref: '#/components/schemas/AnnoProgressivoMovimentoModel',
          },
        ],
        description: 'Numero registrazione della registrazione tramite anno e progressivo',
      },
      data_ora_registrazione: {
        type: 'string',
        description:
          'Data di registrazione (formato ISO 8601 UTC) come previsto nel modello di registro RENTRI.\nIn caso di rettifica, è la data di registrazione della registrazione di rettifica.\n\nTrattandosi di una registrazione informatica, è consentito indicare l\'ora, anche se non obbligatoria.\n\n<b>Esempi:</b> solo data = "2024-01-01", data con ora = "2024-01-01T12:00:00Z"',
        format: 'date-time',
      },
      causale_operazione: {
        allOf: [
          {
            $ref: '#/components/schemas/CausaliOperazione',
          },
        ],
        description:
          'Causale dell\'operazione.\n\nNon richiesto solo nel caso di stoccaggio istantaneo (o giacenza).\n\nVedi API di codifica: <i>GET /codifiche/v1.0/causali-operazione</i><p>Valori ammessi:<ul style="margin:0"><li><i>DT</i> - Prodotto o detenuto nell\'unità locale</li><li><i>NP</i> - Nuovo produttore</li><li><i>T*</i> - Ricevuto da terzi</li><li><i>RE</i> - Prodotto al di fuori dell’unità locale</li><li><i>I</i> - Scarico interno</li><li><i>aT</i> - Scarico a terzi</li><li><i>M</i> - Scarico per produzione di materiali</li><li><i>TR</i> - Intermediario</li><li><i>T*aT</i> - Carico e scarico</li></ul></p>',
        nullable: true,
      },
      stoccaggio_istantaneo: {
        type: 'string',
        description:
          'Data dello stoccaggio istantaneo (formato ISO 8601 UTC) (o giacenza), se valorizzata possono essere compilati solamente i dati relativi al rifiuto e non al materiale.',
        format: 'date-time',
        nullable: true,
      },
      numero_registrazione_rettifica: {
        oneOf: [
          {
            $ref: '#/components/schemas/AnnoProgressivoMovimentoModel',
          },
          {
            $ref: '#/components/schemas/IdentificativoMovimentoModel',
          },
        ],
        description: 'Numero registrazione della registrazione rettificata',
        nullable: true,
      },
      riferimento_operazione: {
        type: 'array',
        items: {
          oneOf: [
            {
              $ref: '#/components/schemas/AnnoProgressivoMovimentoModel',
            },
            {
              $ref: '#/components/schemas/IdentificativoMovimentoModel',
            },
          ],
          description:
            'Dati di identificazione della registrazione tramite anno di riferimento e progressivo oppure identificativo rilasciato dal RENTRI',
        },
        description:
          'Registrazioni associate.\n\nNel caso di registrazioni specificate tramite anno e progressivo, possono essere indicate anche registrazioni che non siano già state trasmesse al RENTRI.',
        nullable: true,
      },
    },
    additionalProperties: false,
    description: 'Riferimenti operazione',
  },
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
  CausaliOperazione: {
    enum: ['DT', 'NP', 'T*', 'RE', 'I', 'aT', 'M', 'TR', 'T*aT'],
    type: 'string',
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
} as const
