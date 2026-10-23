/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `NuovoFormularioModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_NUOVO_FORMULARIO = {
  "required": [
    "dati_partenza",
    "num_iscr_sito"
  ],
  "type": "object",
  "properties": {
    "num_iscr_sito": {
      "minLength": 1,
      "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
      "type": "string",
      "description": "Numero iscrizione unità locale di riferimento a cui il formulario verrà associato.\n\nL'unità locale deve appartenere al produttore o al primo trasportatore."
    },
    "dati_partenza": {
      "allOf": [
        {
          "$ref": "#/components/schemas/DatiPartenzaModel"
        }
      ],
      "description": "Dati iniziali del formulario"
    },
    "dati_trasporto_partenza": {
      "oneOf": [
        {
          "$ref": "#/components/schemas/DatiTrasportoTerrestreModel"
        },
        {
          "$ref": "#/components/schemas/DatiTrasportoMarittimoModel"
        },
        {
          "$ref": "#/components/schemas/DatiTrasportoFerroviarioModel"
        }
      ],
      "description": "Dati del trasporto iniziale",
      "nullable": true
    }
  },
  "additionalProperties": false,
  "description": "Formulario"
} as const

/** Schemi raggiunti da `NuovoFormularioModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_NUOVO_FORMULARIO = {
  "DatiTrasportoFerroviarioModel": {
    "title": "DatiTrasportoFerroviarioModel",
    "required": [
      "treno"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportoBaseModel"
      }
    ],
    "properties": {
      "treno": {
        "maxLength": 50,
        "minLength": 1,
        "type": "string"
      },
      "rid": {
        "type": "boolean",
        "nullable": true
      },
      "tratta": {
        "maxLength": 50,
        "type": "string",
        "nullable": true
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
  "DatiTrasportoMarittimoModel": {
    "title": "DatiTrasportoMarittimoModel",
    "required": [
      "nave"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportoBaseModel"
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
  "DatiTrasportoTerrestreModel": {
    "title": "DatiTrasportoTerrestreModel",
    "required": [
      "conducente"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportoBaseModel"
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
        "description": "Targa automezzo. \nIl dato è necessario se non si indica una targa per il rimorchio",
        "nullable": true
      },
      "targa_rimorchio": {
        "maxLength": 10,
        "type": "string",
        "description": "Targa rimorchio",
        "nullable": true
      },
      "percorso": {
        "maxLength": 250,
        "type": "string",
        "description": "Percorso (se diverso dal più breve)",
        "nullable": true
      },
      "presa_in_carico_rimorchio_precedente": {
        "type": "boolean",
        "description": "Significativo solo per i trasporti successivi al primo",
        "nullable": true
      }
    },
    "description": "Dati del trasporto terrestre"
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
  "DatiPartenzaModel": {
    "required": [
      "destinatario",
      "rifiuto",
      "trasportatori"
    ],
    "type": "object",
    "properties": {
      "numero_fir": {
        "pattern": "^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$",
        "type": "string",
        "description": "Numero di vidimazione da attribuire al nuovo FIR digitale.\nQualora non venga specificato, il sistema ne assegnerà uno automaticamente.",
        "nullable": true
      },
      "produttore": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/DatiProduttoreFormularioModel"
          },
          {
            "$ref": "#/components/schemas/DatiProduttoreFormularioSitoModel"
          }
        ],
        "description": "Produttore",
        "nullable": true
      },
      "destinatario": {
        "oneOf": [
          {
            "$ref": "#/components/schemas/DatiDestinatarioFormularioModel"
          },
          {
            "$ref": "#/components/schemas/DatiDestinatarioFormularioSitoModel"
          }
        ],
        "description": "Destinatario"
      },
      "trasportatori": {
        "minItems": 1,
        "type": "array",
        "items": {
          "oneOf": [
            {
              "$ref": "#/components/schemas/DatiTrasportatoreFormularioModel"
            },
            {
              "$ref": "#/components/schemas/DatiTrasportatoreFormularioSitoModel"
            }
          ],
          "description": "Dati trasportatore"
        },
        "description": "Trasportatori"
      },
      "intermediari": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/DatiIntermediariFormularioModel"
        },
        "description": "Intermediari",
        "nullable": true
      },
      "rifiuto": {
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiRifiutoModel"
          }
        ],
        "description": "Caratteristiche del rifiuto"
      },
      "trasbordo_parziale_origine": {
        "allOf": [
          {
            "$ref": "#/components/schemas/DatiTrasbordoParzialeOrigineModel"
          }
        ],
        "description": "Dati relativi al trasbordo parziale da cui prende origine il formulario.\nIl dato deve essere valorizzato solo se il formulario prende origine da un trasbordo parziale.\nSe il dato viene valorizzato, la proprietà \"produttore\" non deve essere valorizzata.",
        "nullable": true
      },
      "annotazioni": {
        "maxLength": 10000,
        "type": "string",
        "description": "Annotazioni",
        "nullable": true
      }
    },
    "additionalProperties": false,
    "description": "Dati di partenza del formulario"
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
  "DatiRifiutoModel": {
    "required": [
      "codice_eer",
      "provenienza",
      "stato_fisico"
    ],
    "type": "object",
    "properties": {
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
      "analisi_classificazione": {
        "allOf": [
          {
            "$ref": "#/components/schemas/AnalisiClassificazioneModel"
          }
        ],
        "description": "Analisi/Classificazione",
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
    "additionalProperties": false,
    "description": "Identificazione del rifiuto"
  },
  "AnalisiClassificazioneModel": {
    "required": [
      "numero",
      "tipo"
    ],
    "type": "object",
    "properties": {
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
      },
      "data": {
        "type": "string",
        "description": "Data di analisi classificazione (compresa tra 1980-01-01 e 2050-12-31)",
        "format": "date-time",
        "nullable": true
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
  "DatiTrasportatoreFormularioSitoModel": {
    "title": "DatiTrasportatoreFormularioSitoModel",
    "required": [
      "num_iscr_sito"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportatoreFormularioBaseModel"
      }
    ],
    "properties": {
      "num_iscr_sito": {
        "minLength": 1,
        "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
        "type": "string",
        "description": "Numero di iscrizione al RENTRI"
      }
    },
    "description": "Dati trasportatore"
  },
  "DatiTrasportatoreFormularioBaseModel": {
    "required": [
      "tipo_trasporto"
    ],
    "type": "object",
    "properties": {
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
    },
    "description": "Dati trasportatore"
  },
  "TipoTrasporto": {
    "enum": [
      "Terrestre",
      "Ferroviario",
      "Marittimo"
    ],
    "type": "string"
  },
  "DatiTrasportatoreFormularioModel": {
    "title": "DatiTrasportatoreFormularioModel",
    "required": [
      "codice_fiscale",
      "denominazione"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiTrasportatoreFormularioBaseModel"
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
      }
    },
    "description": "Dati trasportatore"
  },
  "DatiDestinatarioFormularioSitoModel": {
    "title": "DatiDestinatarioFormularioSitoModel",
    "required": [
      "num_iscr_sito"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiDestinatarioFormularioBaseModel"
      }
    ],
    "properties": {
      "num_iscr_sito": {
        "minLength": 1,
        "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
        "type": "string",
        "description": "Numero di iscrizione al RENTRI"
      }
    },
    "description": "Dati destinatario"
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
  "DatiProduttoreFormularioSitoModel": {
    "title": "DatiProduttoreFormularioSitoModel",
    "required": [
      "num_iscr_sito"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiProduttoreFormularioBaseModel"
      }
    ],
    "properties": {
      "num_iscr_sito": {
        "minLength": 1,
        "pattern": "^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$",
        "type": "string",
        "description": "Numero di iscrizione al RENTRI"
      }
    },
    "description": "Dati produttore"
  },
  "DatiProduttoreFormularioBaseModel": {
    "type": "object",
    "properties": {
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
    },
    "description": "Dati produttore"
  },
  "DatiProduttoreFormularioModel": {
    "title": "DatiProduttoreFormularioModel",
    "required": [
      "codice_fiscale",
      "denominazione",
      "indirizzo"
    ],
    "type": "object",
    "allOf": [
      {
        "$ref": "#/components/schemas/DatiProduttoreFormularioBaseModel"
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
    "description": "Dati produttore"
  }
} as const
