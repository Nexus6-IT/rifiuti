/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `DatiDestinatarioFormularioModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-viaggio-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_DESTINATARIO = {
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
} as const

/** Schemi raggiunti da `DatiDestinatarioFormularioModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_DESTINATARIO = {
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
  }
} as const
