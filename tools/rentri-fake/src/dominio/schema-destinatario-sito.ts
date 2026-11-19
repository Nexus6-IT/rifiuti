/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `DatiDestinatarioFormularioSitoModel` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/formulari.yaml`.
 * L'allineamento e' imposto da `test/schema-viaggio-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_DESTINATARIO_SITO = {
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
} as const

/** Schemi raggiunti da `DatiDestinatarioFormularioSitoModel` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_DESTINATARIO_SITO = {
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
