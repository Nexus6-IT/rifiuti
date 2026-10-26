/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `DatiTrasmissioneFormularioModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-trasmissione-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_TRASMISSIONE_DATI = {
  "required": [
    "dati_partenza"
  ],
  "type": "object",
  "properties": {
    "dati_partenza": {
      "allOf": [
        {
          "$ref": "#/components/schemas/DatiTrasmissionePartenzaModel"
        }
      ]
    },
    "dati_trasporto": {
      "type": "array",
      "items": {
        "title": "DatiTrasportoTrasmissioneBaseModel",
        "oneOf": [
          {
            "$ref": "#/components/schemas/DatiTrasportoFerroviarioTrasmissioneModel"
          },
          {
            "$ref": "#/components/schemas/DatiTrasportoTerrestreTrasmissioneModel"
          },
          {
            "$ref": "#/components/schemas/DatiTrasportoMarittimoTrasmissioneModel"
          }
        ]
      },
      "nullable": true
    },
    "dati_accettazione": {
      "allOf": [
        {
          "$ref": "#/components/schemas/DatiAccettazioneModel"
        }
      ],
      "description": "Dati accettazione",
      "nullable": true
    },
    "dati_annotazioni": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/DatiAnnotazioneModel"
      },
      "nullable": true
    },
    "dati_trasbordo_totale": {
      "allOf": [
        {
          "$ref": "#/components/schemas/DatiTrasbordoTotaleTrasmissioneModel"
        }
      ],
      "nullable": true
    },
    "dati_trasbordi_parziali": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/DatiTrasbordoParzialeTrasmissioneModel"
      },
      "nullable": true
    },
    "dati_soste_tecniche": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/DatiSostaTecnicaTrasmissioneModel"
      },
      "nullable": true
    },
    "dati_destinazioni_successive": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/DatiDestinazioniSuccessiveTrasmissioniModel"
      },
      "nullable": true
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `DatiTrasmissioneFormularioModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_TRASMISSIONE_DATI = {
  "DatiDestinazioniSuccessiveTrasmissioniModel": {
    "type": "object",
    "properties": {
      "destinatario": {
        "title": "DatiDestinatarioFormularioModel",
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiDestinatarioFormularioModel"
          }
        ],
        "description": "Dati destinatario",
        "nullable": true
      },
      "accettazione": {
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiAccettazioneModel"
          }
        ],
        "description": "Dati accettazione",
        "nullable": true
      }
    },
    "additionalProperties": false
  },
  "DatiAccettazioneModel": {
    "required": [
      "data_ora_arrivo",
      "tipo_accettazione"
    ],
    "type": "object",
    "properties": {
      "tipo_accettazione": {
        "allOf": [
          {
            "$ref": "#/components/schemas/TipiAccettazione"
          }
        ],
        "description": "Tipo accettazione<p>Valori ammessi:<ul style=\"margin:0\"><li><i>A</i> - Accettato per intero</li><li><i>P</i> - Accettato parzialmente</li><li><i>R</i> - Respinto</li></ul></p>"
      },
      "quantita_accettata": {
        "allOf": [
          {
            "$ref": "#/components/schemas/QuantitaKgModel"
          }
        ],
        "description": "Quantità accettata in kg, richiesta per tipo accettazione A o P",
        "nullable": true
      },
      "causale_respingimento": {
        "allOf": [
          {
            "$ref": "#/components/schemas/CausaliRespingimento"
          }
        ],
        "description": "Causale di respingimento, richiesta per tipo accettazione R o P<p>Valori ammessi:<ul style=\"margin:0\"><li><i>NC</i> - Non Conformità, a titolo esemplificativo e non esaustivo, si riporta: rifiuti diverso da quello descritto dal formulario o da quanto dichiarato ai fini della pratica di conferimento all'impianto, rifiuto confezionato in modo non conforme da quanto previsto per la specifica destinazione o dalle norme applicabili, di stato fisico diverso da quello previsto)</li><li><i>IR</i> - Irricevibile, (a titolo esemplificativo e non esaustivo, si riporta: rifiuto non previsto dall'autorizzazione / iscrizione dell'impianto di destino, mancanza dei requisiti per l'ammissibilità all'impianto quali caratterizzazione di base, analisi di classificazione o di ammissibilità…)</li><li><i>A</i> - Indicare motivazione. A titolo esemplificativo e non esaustivo, si riporta: esaurimento volumetria disponibile per conferimento rifiuto, chiusura impianto per manutenzione straordinaria, ecc.</li></ul></p>",
        "nullable": true
      },
      "motivo_respingimento": {
        "maxLength": 1000,
        "type": "string",
        "description": "Motivo di respingimento, richiesto per tipo accettazione R o P",
        "nullable": true
      },
      "data_ora_arrivo": {
        "type": "string",
        "description": "Data ora arrivo (formato ISO 8601 UTC)",
        "format": "date-time"
      },
      "attesa_verifica_analitica": {
        "type": "boolean",
        "description": "Da valorizzare a true se il destinatario sottopone il rifiuto ad analisi",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "description": "Dati accettazione"
  },
  "CausaliRespingimento": {
    "enum": [
      "NC",
      "IR",
      "A"
    ],
    "type": "string"
  },
  "QuantitaKgModel": {
    "required": [
      "valore"
    ],
    "type": "object",
    "properties": {
      "valore": {
        "type": "number",
        "description": "Quantità (parte intera: 10, parte decimale: 4) compresa tra 0.0000 e 9999999999.9999.",
        "format": "double"
      }
    },
    "additionalProperties": false
  },
  "TipiAccettazione": {
    "enum": [
      "A",
      "P",
      "R"
    ],
    "type": "string"
  },
  "DatiDestinatarioFormularioModel": {
    "title": "DatiDestinatarioFormularioModel",
    "required": [
      "codice_fiscale",
      "denominazione",
      "indirizzo"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiDestinatarioFormularioBaseModel"
      }
    ],
    "properties": {
      "denominazione": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Denominazione del soggetto"
      },
      "codice_fiscale": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto.\nIn base alla nazione (\"nazione_id\") verranno effettuate le seguenti validazioni:\n- IT: validazioni formale per codice fiscale personale (16 caratteri) o formato partita IVA (11 cifre decimali)\n- UE: da 5 a 20 caratteri con successiva validazione formale specifica per il paese UE\n- Extra UE: da 5 a 20 caratteri"
      },
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>",
        "nullable": true
      },
      "indirizzo": {
        "allOf": [
          {
            "$ref": "#/components/schemas/IndirizzoModel"
          }
        ],
        "description": "Indirizzo"
      }
    },
    "description": "Dati destinatario"
  },
  "IndirizzoModel": {
    "required": [
      "citta",
      "indirizzo"
    ],
    "type": "object",
    "properties": {
      "citta": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/ComuneModel"
          },
          {
            "$ref": "#/components/schemas/CittaEsteraModel"
          }
        ],
        "description": "Città estera o comune Italiano"
      },
      "indirizzo": {
        "maxLength": 100,
        "minLength": 1,
        "type": "string",
        "description": "Indirizzo"
      },
      "civico": {
        "maxLength": 20,
        "type": "string",
        "description": "Civico",
        "nullable": true
      },
      "cap": {
        "maxLength": 20,
        "type": "string",
        "description": "CAP (se indirizzo italiano 5 cifre, altrimenti da 2 a 20 caratteri)",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "description": "Indirizzo"
  },
  "CittaEsteraModel": {
    "title": "CittaEsteraModel",
    "required": [
      "nazione_id",
      "nome_citta"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/CittaBaseModel"
      }
    ],
    "properties": {
      "nazione_id": {
        "maxLength": 2,
        "minLength": 1,
        "pattern": "^(?!.*(?i)it).*$",
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>"
      },
      "nome_citta": {
        "maxLength": 100,
        "minLength": 1,
        "type": "string",
        "description": "Città estera"
      }
    },
    "description": "Città estera"
  },
  "CittaBaseModel": {
    "type": "object",
    "description": "Città estera o comune Italiano"
  },
  "ComuneModel": {
    "title": "ComuneModel",
    "required": [
      "comune_id"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/CittaBaseModel"
      }
    ],
    "properties": {
      "comune_id": {
        "maxLength": 6,
        "minLength": 1,
        "type": "string",
        "description": "Comune ISTAT del comune.\n\nNon vengono accettati codici non corrispondenti a codici ISTAT di comuni italiani.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/comuni</i>\n\nSono ammesse esclusivamente le codifiche attive oppure le codifiche non attive, purché la relativa data di fine validità in RENTRI \n(restituita dall'API di codifica) sia coerente con i dati trasmessi \n(esempio antecedente o uguale alla DataOraRegistrazione per le registrazioni relative ad un registro, o alla DataEmissione per i formulari)."
      }
    },
    "description": "Comune Italiano"
  },
  "DatiDestinatarioFormularioBaseModel": {
    "type": "object",
    "properties": {
      "autorizzazione": {
        "allOf": [
          {
            "$ref": "#/components/schemas/AutorizzazioneModel"
          }
        ],
        "description": "Autorizzazione.\n\nIl valore è sempre necessario tranne quando l'unità locale del destinatario coincide con quella del produttore ed il rifiuto è stato prodotto fuori dall'unità locale.",
        "nullable": true
      },
      "attivita": {
        "allOf": [
          {
            "$ref": "#/components/schemas/OperazioniRecuperoSmaltimento"
          }
        ],
        "description": "Attività di recupero o smaltimento a destinazione.\n\nIl valore è sempre necessario tranne quando l'unità locale del destinatario coincide con quella del produttore ed il rifiuto è stato prodotto fuori dall'unità locale.<p>Valori ammessi:<ul style=\"margin:0\"><li><i>R1</i> - Utilizzazione principale come combustibile o come altro mezzo per produrre energia</li><li><i>R2</i> - Rigenerazione/recupero di solventi</li><li><i>R3</i> - Riciclo/recupero delle sostanze organiche non utilizzate come solventi</li><li><i>R4</i> - Riciclo/recupero dei metalli e dei composti metallici</li><li><i>R5</i> - Riciclo/recupero di altre sostanze inorganiche</li><li><i>R6</i> - Rigenerazione degli acidi o delle basi</li><li><i>R7</i> - Recupero dei prodotti che servono a captare gli inquinanti</li><li><i>R8</i> - Recupero dei prodotti provenienti dai catalizzatori</li><li><i>R9</i> - Rigenerazione o altri reimpieghi degli oli</li><li><i>R10</i> - Spandimento sul suolo a beneficio dell'agricoltura o dell'ecologia</li><li><i>R11</i> - Utilizzazione di rifiuti ottenuti da una delle operazioni indicate da R1 a R10</li><li><i>R12</i> - Scambio di rifiuti per sottoporli a una delle operazioni indicate da R1 a R11</li><li><i>R13</i> - Messa in riserva di rifiuti per sottoporli a una delle operazioni indicate nei punti da R1 a R12</li><li><i>D1</i> - Deposito sul o nel suolo</li><li><i>D2</i> - Trattamento in ambiente terrestre</li><li><i>D3</i> - Iniezioni in profondità</li><li><i>D4</i> - Lagunaggio</li><li><i>D5</i> - Messa in discarica specialmente allestita</li><li><i>D6</i> - Scarico dei rifiuti solidi nell'ambiente idrico eccetto l'immersione</li><li><i>D7</i> - Immersione, compreso il seppellimento nel sottosuolo marino</li><li><i>D8</i> - Trattamento biologico non specificato altrove nel presente allegato</li><li><i>D9</i> - Trattamento fisico-chimico non specificato altrove nel presente allegato</li><li><i>D10</i> - Incenerimento a terra</li><li><i>D11</i> - Incenerimento in mare</li><li><i>D12</i> - Deposito permanente</li><li><i>D13</i> - Raggruppamento preliminare prima di una delle operazioni di cui ai punti da D1 a D12</li><li><i>D14</i> - Ricondizionamento preliminare prima di una delle operazioni di cui ai punti da D1 a D13</li><li><i>D15</i> - Deposito preliminare prima di una delle operazioni di cui ai punti da D1 a D14</li></ul></p>",
        "nullable": true
      },
      "numero_iscrizione_albo": {
        "maxLength": 10,
        "pattern": "^([A-Za-z]{2})/([0-9]{6})$",
        "type": "string",
        "description": "Iscrizione Albo",
        "nullable": true
      }
    },
    "description": "Dati destinatario"
  },
  "OperazioniRecuperoSmaltimento": {
    "enum": [
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
      "R7",
      "R8",
      "R9",
      "R10",
      "R11",
      "R12",
      "R13",
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
      "D6",
      "D7",
      "D8",
      "D9",
      "D10",
      "D11",
      "D12",
      "D13",
      "D14",
      "D15"
    ],
    "type": "string"
  },
  "AutorizzazioneModel": {
    "type": "object",
    "properties": {
      "numero": {
        "maxLength": 50,
        "type": "string",
        "description": "Numero di autorizzazione",
        "nullable": true
      },
      "tipo": {
        "allOf": [
          {
            "$ref": "#/components/schemas/TipiAutorizzazione"
          }
        ],
        "description": "Tipo autorizzazione<p>Valori ammessi:<ul style=\"margin:0\"><li><i>RecSmalArt208</i> - Autorizzazione unica per i nuovi impianti di recupero/smaltimento - art. 208 decreto legislativo 3 aprile 2006, n. 152.</li><li><i>RecSmalImpMobiliArt208</i> - Autorizzazione all'esercizio di operazioni di recupero e/o smaltimento dei rifiuti con impianti mobili - art.208, comma 15 del decreto legislativo 3 aprile 2006, n. 152.</li><li><i>RicercaSperimentazione</i> - Autorizzazione alla realizzazione di impianti di ricerca e sperimentazione - art. 211 del decreto legislativo 3 aprile 2006, n. 152.</li><li><i>AIA</i> - Autorizzazione Integrata Ambientale - artt. 29-ter e 213 del decreto legislativo 3 aprile 2006, n. 152.</li><li><i>RecProcSemplificata</i> - Operazioni di recupero mediante Comunicazione in \"Procedura Semplificata\" - artt.214 e 216 del decreto legislativo 3 aprile 2006, n. 152e autorizzazione unica ambientale (AUA) - Decreto Presidente Repubblica n. 59 del 13 marzo 2013.</li><li><i>OpBonifica</i> - Provvedimenti che autorizzano le operazioni di bonifica, ai sensi del comma 7 dell’art. 242 del decreto legislativo 3 aprile 2006, n. 152.</li><li><i>Straordinario</i> - Autorizzazioni “straordinarie” art. 191 del decreto legislativo 3 aprile 2006, n. 152 (attività svolte in regime di ordinanza contingibile e urgente)</li><li><i>ComTrattamentoAcqueReflue</i> - Comunicazione al trattamento di rifiuti e materiali in impianti di trattamento di acque reflue urbane - art. 110 c.3 del D.Lgs. 152/2006</li><li><i>AutTrattamentoAcqueReflue</i> - Autorizzazione  al trattamento di rifiuti liquidi in impianti di trattamento di acque reflue urbane - artt. 110 c.2 con provvedimento secondo artt. 208 oppure 29-ter e 213 del D.Lgs. 152/2006</li></ul></p>",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "description": "Autorizzazione"
  },
  "TipiAutorizzazione": {
    "enum": [
      "RecSmalArt208",
      "RecSmalImpMobiliArt208",
      "RicercaSperimentazione",
      "AIA",
      "RecProcSemplificata",
      "OpBonifica",
      "Straordinario",
      "ComTrattamentoAcqueReflue",
      "AutTrattamentoAcqueReflue"
    ],
    "type": "string"
  },
  "DatiSostaTecnicaTrasmissioneModel": {
    "required": [
      "data_ora_ripresa",
      "data_ora_sospensione",
      "luogo_stazionamento",
      "trasportatore_id"
    ],
    "type": "object",
    "properties": {
      "trasportatore_id": {
        "maximum": 255,
        "minimum": 1,
        "type": "integer",
        "description": "Id del trasportatore definito all'interno dei dati che vengono trasmessi",
        "format": "int32"
      },
      "luogo_stazionamento": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string"
      },
      "data_ora_sospensione": {
        "type": "string",
        "description": "Formato ISO 8601 UTC",
        "format": "date-time"
      },
      "data_ora_ripresa": {
        "type": "string",
        "description": "Formato ISO 8601 UTC",
        "format": "date-time"
      }
    },
    "additionalProperties": false
  },
  "DatiTrasbordoParzialeTrasmissioneModel": {
    "required": [
      "causale",
      "numero_fir",
      "quantita_residua",
      "trasportatore",
      "trasportatore_id"
    ],
    "type": "object",
    "properties": {
      "trasportatore_id": {
        "maximum": 255,
        "minimum": 1,
        "type": "integer",
        "description": "Id del trasportatore definito all'interno dei dati che vengono trasmessi",
        "format": "int32"
      },
      "trasportatore": {
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiTrasportatoreTrasbordoModel"
          }
        ],
        "description": "Dati trasportatore per il trasbordo parziale"
      },
      "numero_fir": {
        "minLength": 1,
        "pattern": "^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$",
        "type": "string",
        "description": "Numero FIR del formulario in cui viene trasbordato parzialmente il rifiuto"
      },
      "quantita_residua": {
        "allOf": [
          {
            "$ref": "#/components/schemas/QuantitaModel`1"
          }
        ],
        "description": "Quantità residua del rifiuto nel formulario di origine"
      },
      "causale": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Causale del trasbordo parziale"
      }
    },
    "additionalProperties": false
  },
  "QuantitaModel`1": {
    "required": [
      "unita_misura",
      "valore"
    ],
    "type": "object",
    "properties": {
      "valore": {
        "type": "number",
        "description": "Quantità (parte intera: 10, parte decimale: 4) compresa tra 0.0000 e 9999999999.9999.",
        "format": "double"
      },
      "unita_misura": {
        "allOf": [
          {
            "$ref": "#/components/schemas/UnitaMisura"
          }
        ],
        "description": "Unità di misura della quantità\n\nVedi API di codifica: <i>GET /codifiche/v1.0/unita-misura</i><p>Valori ammessi:<ul style=\"margin:0\"><li><i>kg</i> - Chilogrammi</li><li><i>l</i> - Litri</li></ul></p>"
      }
    },
    "additionalProperties": false
  },
  "UnitaMisura": {
    "enum": [
      "kg",
      "l"
    ],
    "type": "string"
  },
  "DatiTrasportatoreTrasbordoModel": {
    "required": [
      "codice_fiscale",
      "denominazione"
    ],
    "type": "object",
    "properties": {
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>",
        "nullable": true
      },
      "denominazione": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Denominazione del soggetto"
      },
      "codice_fiscale": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto.\nIn base alla nazione (\"nazione_id\") verranno effettuate le seguenti validazioni:\n- IT: validazioni formale per codice fiscale personale (16 caratteri) o formato partita IVA (11 cifre decimali)\n- UE: da 5 a 20 caratteri con successiva validazione formale specifica per il paese UE\n- Extra UE: da 5 a 20 caratteri"
      },
      "numero_iscrizione_albo": {
        "maxLength": 10,
        "pattern": "^([A-Za-z]{2})/([0-9]{6})$",
        "type": "string",
        "description": "Iscrizione Albo",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "description": "Dati trasportatore per il trasbordo parziale"
  },
  "DatiTrasbordoTotaleTrasmissioneModel": {
    "required": [
      "presa_in_carico",
      "trasportatore",
      "trasportatore_id"
    ],
    "type": "object",
    "properties": {
      "trasportatore_id": {
        "maximum": 255,
        "minimum": 1,
        "type": "integer",
        "description": "Id del trasportatore definito all'interno dei dati che vengono trasmessi a cui è riferito il trasbordo",
        "format": "int32"
      },
      "id_trasportatore_trasbordo": {
        "type": "integer",
        "description": "Id del trasportatore definito all'interno dei dati che vengono trasmessi a cui è riferito il trasbordo\r\n\r\n \r\n⚠️ Deprecato: utilizzare \"trasportatore_id\"",
        "format": "int32",
        "nullable": true,
        "deprecated": true
      },
      "trasportatore": {
        "title": "DatiTrasportatoreTrasmissioneModel",
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiTrasportatoreTrasmissioneModel"
          }
        ]
      },
      "presa_in_carico": {
        "title": "DatiTrasportoTrasmissioneBaseModel",
        "oneOf": [
          {
            "$ref": "#/components/schemas/DatiTrasportoTerrestreTrasmissioneModel"
          }
        ]
      }
    },
    "additionalProperties": false
  },
  "DatiTrasportoTerrestreTrasmissioneModel": {
    "title": "DatiTrasportoTerrestreTrasmissioneModel",
    "required": [
      "conducente"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportoTrasmissioneBaseModel"
      }
    ],
    "properties": {
      "conducente": {
        "allOf": [
          {
            "$ref": "#/components/schemas/ConducenteModel"
          }
        ],
        "description": "Conducente"
      },
      "targa_automezzo": {
        "maxLength": 10,
        "type": "string",
        "nullable": true
      },
      "targa_rimorchio": {
        "maxLength": 10,
        "type": "string",
        "nullable": true
      },
      "percorso": {
        "maxLength": 1000,
        "type": "string",
        "nullable": true
      },
      "presa_in_carico_rimorchio_precedente": {
        "type": "boolean",
        "description": "Significativo solo per i trasporti successivi al primo",
        "nullable": true
      }
    }
  },
  "ConducenteModel": {
    "required": [
      "cognome",
      "nome"
    ],
    "type": "object",
    "properties": {
      "nome": {
        "maxLength": 50,
        "minLength": 1,
        "type": "string",
        "description": "Nome"
      },
      "cognome": {
        "maxLength": 50,
        "minLength": 1,
        "type": "string",
        "description": "Cognome"
      }
    },
    "additionalProperties": false,
    "description": "Conducente"
  },
  "DatiTrasportoTrasmissioneBaseModel": {
    "title": "DatiTrasportoTrasmissioneBaseModel",
    "required": [
      "trasportatore_id"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportoBaseModel"
      }
    ],
    "properties": {
      "trasportatore_id": {
        "maximum": 255,
        "minimum": 1,
        "type": "integer",
        "description": "Id del trasportatore definito all'interno dei dati che vengono trasmessi",
        "format": "int32"
      }
    }
  },
  "DatiTrasportoBaseModel": {
    "required": [
      "data_ora_inizio_trasporto"
    ],
    "type": "object",
    "properties": {
      "data_ora_inizio_trasporto": {
        "type": "string",
        "description": "Data e ora inizio trasporto (formato ISO 8601 UTC)",
        "format": "date-time"
      },
      "annotazioni": {
        "maxLength": 10000,
        "type": "string",
        "description": "Annotazioni",
        "nullable": true
      }
    },
    "description": "Dati del trasporto base"
  },
  "DatiTrasportatoreTrasmissioneModel": {
    "title": "DatiTrasportatoreTrasmissioneModel",
    "required": [
      "codice_fiscale",
      "denominazione",
      "tipo_trasporto",
      "trasportatore_id"
    ],
    "type": "object",
    "properties": {
      "denominazione": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Denominazione del soggetto"
      },
      "codice_fiscale": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto.\nIn base alla nazione (\"nazione_id\") verranno effettuate le seguenti validazioni:\n- IT: validazioni formale per codice fiscale personale (16 caratteri) o formato partita IVA (11 cifre decimali)\n- UE: da 5 a 20 caratteri con successiva validazione formale specifica per il paese UE\n- Extra UE: da 5 a 20 caratteri"
      },
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>",
        "nullable": true
      },
      "trasportatore_id": {
        "maximum": 255,
        "minimum": 1,
        "type": "integer",
        "description": "Id del trasportatore all'interno dei dati che vengono trasmessi",
        "format": "int32"
      },
      "num_iscr_sito": {
        "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
        "type": "string",
        "nullable": true
      },
      "tipo_trasporto": {
        "allOf": [
          {
            "$ref": "#/components/schemas/TipoTrasporto"
          }
        ]
      },
      "numero_iscrizione_albo": {
        "maxLength": 10,
        "pattern": "^([A-Za-z]{2})/([0-9]{6})$",
        "type": "string",
        "description": "Iscrizione Albo",
        "nullable": true
      }
    }
  },
  "TipoTrasporto": {
    "enum": [
      "Terrestre",
      "Ferroviario",
      "Marittimo"
    ],
    "type": "string"
  },
  "DatiAnnotazioneModel": {
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
  },
  "DatiTrasportoMarittimoTrasmissioneModel": {
    "title": "DatiTrasportoMarittimoTrasmissioneModel",
    "required": [
      "nave"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportoTrasmissioneBaseModel"
      }
    ],
    "properties": {
      "nave": {
        "maxLength": 50,
        "minLength": 1,
        "type": "string"
      },
      "imdg": {
        "type": "boolean",
        "nullable": true
      }
    }
  },
  "DatiTrasportoFerroviarioTrasmissioneModel": {
    "title": "DatiTrasportoFerroviarioTrasmissioneModel",
    "required": [
      "treno"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportoTrasmissioneBaseModel"
      }
    ],
    "properties": {
      "treno": {
        "maxLength": 50,
        "minLength": 1,
        "type": "string"
      },
      "tratta": {
        "maxLength": 50,
        "type": "string",
        "nullable": true
      },
      "rid": {
        "type": "boolean",
        "nullable": true
      }
    }
  },
  "DatiTrasmissionePartenzaModel": {
    "required": [
      "data_emissione",
      "destinatario",
      "numero_fir",
      "rifiuto",
      "trasportatori"
    ],
    "type": "object",
    "properties": {
      "numero_fir": {
        "minLength": 1,
        "pattern": "^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$",
        "type": "string"
      },
      "produttore": {
        "title": "DatiProduttoreTrasmissioneModel",
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiProduttoreTrasmissioneModel"
          }
        ],
        "nullable": true
      },
      "trasbordo_parziale_origine": {
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiTrasbordoParzialeOrigineModel"
          }
        ],
        "nullable": true
      },
      "destinatario": {
        "title": "DatiDestinatarioTrasmissioneModel",
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiDestinatarioTrasmissioneModel"
          }
        ]
      },
      "trasportatori": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/DatiTrasportatoreTrasmissioneModel"
        }
      },
      "rifiuto": {
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiRifiutoTrasmissioneModel"
          }
        ]
      },
      "data_emissione": {
        "type": "string",
        "format": "date-time"
      },
      "intermediari": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/DatiIntermediariFormularioModel"
        },
        "description": "Intermediari",
        "nullable": true
      },
      "annotazioni": {
        "maxLength": 10000,
        "type": "string",
        "description": "Annotazioni",
        "nullable": true
      }
    },
    "additionalProperties": false
  },
  "DatiIntermediariFormularioModel": {
    "required": [
      "codice_fiscale",
      "denominazione"
    ],
    "type": "object",
    "properties": {
      "denominazione": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Denominazione del soggetto"
      },
      "codice_fiscale": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto.\nIn base alla nazione (\"nazione_id\") verranno effettuate le seguenti validazioni:\n- IT: validazioni formale per codice fiscale personale (16 caratteri) o formato partita IVA (11 cifre decimali)\n- UE: da 5 a 20 caratteri con successiva validazione formale specifica per il paese UE\n- Extra UE: da 5 a 20 caratteri"
      },
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>",
        "nullable": true
      },
      "numero_iscrizione_albo": {
        "maxLength": 10,
        "pattern": "^([A-Za-z]{2})/([0-9]{6})$",
        "type": "string",
        "description": "Iscrizione Albo",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "description": "Dati intermediario"
  },
  "DatiRifiutoTrasmissioneModel": {
    "required": [
      "codice_eer",
      "provenienza",
      "stato_fisico"
    ],
    "type": "object",
    "properties": {
      "analisi_classificazione": {
        "allOf": [
          {
            "$ref": "#/components/schemas/AnalisiClassificazioneTrasmissioneModel"
          }
        ],
        "description": "Analisi/Classificazione",
        "nullable": true
      },
      "codice_eer": {
        "maxLength": 8,
        "minLength": 1,
        "type": "string",
        "description": "Codice EER"
      },
      "descrizione": {
        "maxLength": 500,
        "type": "string",
        "description": "Descrizione del rifiuto, richiesta se il Codice EER specificato è di tipo .99",
        "nullable": true
      },
      "provenienza": {
        "allOf": [
          {
            "$ref": "#/components/schemas/ProvenienzaRifiuto"
          }
        ],
        "description": "Provenienza<p>Valori ammessi:<ul style=\"margin:0\"><li><i>U</i> - Urbano</li><li><i>S</i> - Speciale</li></ul></p>"
      },
      "caratteristiche_chimico_fisiche": {
        "maxLength": 500,
        "type": "string",
        "description": "Caratteristiche chimico fisiche del rifiuto",
        "nullable": true
      },
      "caratteristiche_pericolo": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/CaratteristichePericolo"
        },
        "description": "Classificazione di pericolo (HP), richiesta se e solo se il Codice EER si riferisce ad un rifiuto pericoloso<p>Valori ammessi:<ul style=\"margin:0\"><li><i>HP01</i> - Esplosivo</li><li><i>HP02</i> - Comburente</li><li><i>HP03</i> - Infiammabile</li><li><i>HP04</i> - Irritante - Irritazione cutanea e lesioni oculari</li><li><i>HP05</i> - Tossicità specifica per organi bersaglio (STOT)/Tossicità in caso di respirazione</li><li><i>HP06</i> - Tossicità acuta</li><li><i>HP07</i> - Cancerogeno</li><li><i>HP08</i> - Corrosivo</li><li><i>HP09</i> - Infettivo</li><li><i>HP10</i> - Tossico per la riproduzione</li><li><i>HP11</i> - Mutageno</li><li><i>HP12</i> - Liberazione di gas a tossicità acuta</li><li><i>HP13</i> - Sensibilizzante</li><li><i>HP14</i> - Ecotossico</li><li><i>HP15</i> - Rifiuto che non possiede direttamente una delle caratteristiche di pericolo già menzionate, ma può manifestarla successivamente</li></ul></p>",
        "nullable": true
      },
      "stato_fisico": {
        "allOf": [
          {
            "$ref": "#/components/schemas/StatiFisici"
          }
        ],
        "description": "Stato fisico<p>Valori ammessi:<ul style=\"margin:0\"><li><i>SP</i> - In polvere o pulverulento</li><li><i>S</i> - Solido</li><li><i>FP</i> - Fangoso</li><li><i>L</i> - Liquido</li><li><i>VS</i> - Vischioso sciropposo</li></ul></p>"
      },
      "quantita": {
        "allOf": [
          {
            "$ref": "#/components/schemas/QuantitaModel`1"
          }
        ],
        "description": "Quantità",
        "nullable": true
      },
      "verificato_in_partenza": {
        "type": "boolean",
        "description": "Verificato in partenza",
        "nullable": true
      },
      "trasporto_adr": {
        "type": "boolean",
        "description": "Trasporto ADR",
        "nullable": true
      },
      "dati_adr": {
        "allOf": [
          {
            "$ref": "#/components/schemas/NormativaADRModel"
          }
        ],
        "description": "Dati ADR.\n\nIl dato non deve essere indicato se la proprietà \"trasporto_adr\" è diversa da true.",
        "nullable": true
      },
      "numero_colli": {
        "maxLength": 50,
        "type": "string",
        "description": "Numero di colli. \nSpecificare un valore in caso non si imposti \"rinfusa\" a <i>true</i>",
        "nullable": true
      },
      "rinfusa": {
        "type": "boolean",
        "description": "Rinfusa. \nSe valorizzato a <i>true</i> indica che il rifiuto non è partizionato in colli.",
        "nullable": true
      }
    },
    "additionalProperties": false
  },
  "NormativaADRModel": {
    "type": "object",
    "properties": {
      "numero_onu": {
        "maxLength": 20,
        "type": "string",
        "description": "Numero ONU",
        "nullable": true
      },
      "classe": {
        "maxLength": 20,
        "type": "string",
        "nullable": true
      },
      "note": {
        "maxLength": 500,
        "type": "string",
        "description": "Note ADR",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "description": "Normativa ADR"
  },
  "StatiFisici": {
    "enum": [
      "SP",
      "S",
      "FP",
      "L",
      "VS"
    ],
    "type": "string"
  },
  "CaratteristichePericolo": {
    "enum": [
      "HP01",
      "HP02",
      "HP03",
      "HP04",
      "HP05",
      "HP06",
      "HP07",
      "HP08",
      "HP09",
      "HP10",
      "HP11",
      "HP12",
      "HP13",
      "HP14",
      "HP15"
    ],
    "type": "string"
  },
  "ProvenienzaRifiuto": {
    "enum": [
      "U",
      "S"
    ],
    "type": "string"
  },
  "AnalisiClassificazioneTrasmissioneModel": {
    "required": [
      "numero",
      "tipo"
    ],
    "type": "object",
    "properties": {
      "data": {
        "type": "string",
        "format": "date-time",
        "nullable": true
      },
      "tipo": {
        "allOf": [
          {
            "$ref": "#/components/schemas/TipoAnalisiClassificazione"
          }
        ],
        "description": "<p>Valori ammessi:<ul style=\"margin:0\"><li><i>Analisi</i> - Analisi/rapporto di prova</li><li><i>Classificazione</i> - Classificazione</li></ul></p>"
      },
      "numero": {
        "maxLength": 50,
        "minLength": 1,
        "type": "string"
      }
    },
    "additionalProperties": false
  },
  "TipoAnalisiClassificazione": {
    "enum": [
      "Analisi",
      "Classificazione"
    ],
    "type": "string"
  },
  "DatiDestinatarioTrasmissioneModel": {
    "title": "DatiDestinatarioTrasmissioneModel",
    "required": [
      "codice_fiscale",
      "denominazione",
      "indirizzo"
    ],
    "type": "object",
    "properties": {
      "denominazione": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Denominazione del soggetto"
      },
      "codice_fiscale": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto.\nIn base alla nazione (\"nazione_id\") verranno effettuate le seguenti validazioni:\n- IT: validazioni formale per codice fiscale personale (16 caratteri) o formato partita IVA (11 cifre decimali)\n- UE: da 5 a 20 caratteri con successiva validazione formale specifica per il paese UE\n- Extra UE: da 5 a 20 caratteri"
      },
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>",
        "nullable": true
      },
      "indirizzo": {
        "allOf": [
          {
            "$ref": "#/components/schemas/IndirizzoModel"
          }
        ],
        "description": "Indirizzo"
      },
      "num_iscr_sito": {
        "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
        "type": "string",
        "nullable": true
      },
      "autorizzazione": {
        "allOf": [
          {
            "$ref": "#/components/schemas/AutorizzazioneModel"
          }
        ],
        "description": "Autorizzazione.\n\nIl valore è sempre necessario tranne quando l'unità locale del destinatario coincide con quella del produttore ed il rifiuto è stato prodotto fuori dall'unità locale.",
        "nullable": true
      },
      "attivita": {
        "allOf": [
          {
            "$ref": "#/components/schemas/OperazioniRecuperoSmaltimento"
          }
        ],
        "description": "Attività di recupero o smaltimento a destinazione.\n\nIl valore è sempre necessario tranne quando l'unità locale del destinatario coincide con quella del produttore ed il rifiuto è stato prodotto fuori dall'unità locale.<p>Valori ammessi:<ul style=\"margin:0\"><li><i>R1</i> - Utilizzazione principale come combustibile o come altro mezzo per produrre energia</li><li><i>R2</i> - Rigenerazione/recupero di solventi</li><li><i>R3</i> - Riciclo/recupero delle sostanze organiche non utilizzate come solventi</li><li><i>R4</i> - Riciclo/recupero dei metalli e dei composti metallici</li><li><i>R5</i> - Riciclo/recupero di altre sostanze inorganiche</li><li><i>R6</i> - Rigenerazione degli acidi o delle basi</li><li><i>R7</i> - Recupero dei prodotti che servono a captare gli inquinanti</li><li><i>R8</i> - Recupero dei prodotti provenienti dai catalizzatori</li><li><i>R9</i> - Rigenerazione o altri reimpieghi degli oli</li><li><i>R10</i> - Spandimento sul suolo a beneficio dell'agricoltura o dell'ecologia</li><li><i>R11</i> - Utilizzazione di rifiuti ottenuti da una delle operazioni indicate da R1 a R10</li><li><i>R12</i> - Scambio di rifiuti per sottoporli a una delle operazioni indicate da R1 a R11</li><li><i>R13</i> - Messa in riserva di rifiuti per sottoporli a una delle operazioni indicate nei punti da R1 a R12</li><li><i>D1</i> - Deposito sul o nel suolo</li><li><i>D2</i> - Trattamento in ambiente terrestre</li><li><i>D3</i> - Iniezioni in profondità</li><li><i>D4</i> - Lagunaggio</li><li><i>D5</i> - Messa in discarica specialmente allestita</li><li><i>D6</i> - Scarico dei rifiuti solidi nell'ambiente idrico eccetto l'immersione</li><li><i>D7</i> - Immersione, compreso il seppellimento nel sottosuolo marino</li><li><i>D8</i> - Trattamento biologico non specificato altrove nel presente allegato</li><li><i>D9</i> - Trattamento fisico-chimico non specificato altrove nel presente allegato</li><li><i>D10</i> - Incenerimento a terra</li><li><i>D11</i> - Incenerimento in mare</li><li><i>D12</i> - Deposito permanente</li><li><i>D13</i> - Raggruppamento preliminare prima di una delle operazioni di cui ai punti da D1 a D12</li><li><i>D14</i> - Ricondizionamento preliminare prima di una delle operazioni di cui ai punti da D1 a D13</li><li><i>D15</i> - Deposito preliminare prima di una delle operazioni di cui ai punti da D1 a D14</li></ul></p>",
        "nullable": true
      },
      "numero_iscrizione_albo": {
        "maxLength": 10,
        "pattern": "^([A-Za-z]{2})/([0-9]{6})$",
        "type": "string",
        "description": "Iscrizione Albo",
        "nullable": true
      }
    }
  },
  "DatiTrasbordoParzialeOrigineModel": {
    "required": [
      "causale",
      "numero_fir_origine",
      "produttore_originario"
    ],
    "type": "object",
    "properties": {
      "numero_fir_origine": {
        "minLength": 1,
        "pattern": "^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$",
        "type": "string",
        "description": "Numero FIR del formulario che ha subito il trasbordo parziale da cui prende origine il nuovo formulario"
      },
      "produttore_originario": {
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiProduttoreOriginarioModel"
          }
        ],
        "description": "Dati del produttore del rifiuto originario come compariva nel formulario di origine"
      },
      "causale": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Causale del trasbordo parziale"
      }
    },
    "additionalProperties": false
  },
  "DatiProduttoreOriginarioModel": {
    "required": [
      "codice_fiscale",
      "denominazione"
    ],
    "type": "object",
    "properties": {
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>",
        "nullable": true
      },
      "denominazione": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Denominazione del soggetto"
      },
      "codice_fiscale": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto.\nIn base alla nazione (\"nazione_id\") verranno effettuate le seguenti validazioni:\n- IT: validazioni formale per codice fiscale personale (16 caratteri) o formato partita IVA (11 cifre decimali)\n- UE: da 5 a 20 caratteri con successiva validazione formale specifica per il paese UE\n- Extra UE: da 5 a 20 caratteri"
      }
    },
    "additionalProperties": false
  },
  "DatiProduttoreTrasmissioneModel": {
    "title": "DatiProduttoreTrasmissioneModel",
    "required": [
      "codice_fiscale",
      "denominazione",
      "indirizzo"
    ],
    "type": "object",
    "properties": {
      "denominazione": {
        "maxLength": 1000,
        "minLength": 1,
        "type": "string",
        "description": "Denominazione del soggetto"
      },
      "codice_fiscale": {
        "maxLength": 20,
        "minLength": 5,
        "type": "string",
        "description": "Codice fiscale del soggetto.\nIn base alla nazione (\"nazione_id\") verranno effettuate le seguenti validazioni:\n- IT: validazioni formale per codice fiscale personale (16 caratteri) o formato partita IVA (11 cifre decimali)\n- UE: da 5 a 20 caratteri con successiva validazione formale specifica per il paese UE\n- Extra UE: da 5 a 20 caratteri"
      },
      "nazione_id": {
        "maxLength": 2,
        "type": "string",
        "description": "Codice ISO 3166-1 alpha-2 della nazione, in caso di \"IT\" è possibile omettere.\n\nVengono accettati solo codici previsti dallo standard ISO 3166-1 alpha-2.\n\nVedi API di codifica: <i>GET /codifiche/v1.0/nazioni</i>",
        "nullable": true
      },
      "indirizzo": {
        "allOf": [
          {
            "$ref": "#/components/schemas/IndirizzoModel"
          }
        ],
        "description": "Indirizzo"
      },
      "num_iscr_sito": {
        "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
        "type": "string",
        "nullable": true
      },
      "luogo_produzione": {
        "allOf": [
          {
            "$ref": "#/components/schemas/IndirizzoModel"
          }
        ],
        "description": "Luogo di produzione se diverso da indirizzo",
        "nullable": true
      },
      "autorizzazione": {
        "allOf": [
          {
            "$ref": "#/components/schemas/AutorizzazioneModel"
          }
        ],
        "description": "Autorizzazione",
        "nullable": true
      },
      "detentore": {
        "type": "boolean",
        "description": "Specifica se il dato del produttore è riferito al detentore del rifiuto",
        "nullable": true
      },
      "numero_iscrizione_albo": {
        "maxLength": 10,
        "pattern": "^([A-Za-z]{2})/([0-9]{6})$",
        "type": "string",
        "description": "Iscrizione Albo",
        "nullable": true
      }
    }
  }
} as const
