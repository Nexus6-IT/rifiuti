/**
 * GENERATO da `scripts/genera-schema.js` — NON modificare a mano.
 *
 * Copia verbatim di `CreateRegistroRequest` e della chiusura transitiva dei suoi
 * `$ref`, dal contratto ufficiale `docs/contracts/rentri/anagrafiche.yaml`.
 * L'allineamento e' imposto da `test/schema-registri-allineato-al-contratto.test.ts`.
 */
export const SCHEMA_CREA_REGISTRO = {
  "required": [
    "attivita",
    "num_iscr_sito"
  ],
  "type": "object",
  "properties": {
    "num_iscr_sito": {
      "minLength": 1,
      "type": "string",
      "description": "Numero iscrizione unità locale rilasciato all'iscrizione. \n\nPer recuperare i numeri di iscrizione attribuiti alle unità locali è possibile utilizzare /anagrafiche/v1.0/operatore/{num_iscr}/siti."
    },
    "attivita": {
      "minItems": 1,
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/Attivita"
      },
      "description": "Attività legate al registro.\n\nDeve contenere almeno un'attività coerente con quelle previste dall'unità locale indicata in num_iscr_sito, secondo quanto dichiarato in fase di iscrizione o a seguito dell'ultima variazione.<p>Valori ammessi:<ul style=\"margin:0\"><li><i>CentroRaccolta</i> - Centro di raccolta</li><li><i>Produzione</i> - Produzione di rifiuti</li><li><i>Recupero</i> - Recupero di rifiuti</li><li><i>Smaltimento</i> - Smaltimento di rifiuti</li><li><i>Trasporto</i> - Trasporto di rifiuti</li><li><i>IntermediazioneSenzaDetenzione</i> - Intermediazione e commercio di rifiuti senza detenzione</li></ul></p>"
    },
    "descrizione": {
      "maxLength": 250,
      "type": "string",
      "description": "Descrizione del registro",
      "nullable": true
    },
    "attivita_rec_smalt": {
      "type": "array",
      "items": {
        "$ref": "#/components/schemas/OperazioniRecuperoSmaltimento"
      },
      "description": "Attività recupero smaltimento.\n\nRichiesto solamente se attivita contiene \"Recupero\" e/o \"Smaltimento\". In tal caso deve contenere i codici di recupero/smaltimento \nche sono stati dichiarati per l'unità locale in fase di iscrizione o a seguito dell'ultima variazione.<p>Valori ammessi:<ul style=\"margin:0\"><li><i>R1</i> - Utilizzazione principale come combustibile o come altro mezzo per produrre energia</li><li><i>R2</i> - Rigenerazione/recupero di solventi</li><li><i>R3</i> - Riciclo/recupero delle sostanze organiche non utilizzate come solventi</li><li><i>R4</i> - Riciclo/recupero dei metalli e dei composti metallici</li><li><i>R5</i> - Riciclo/recupero di altre sostanze inorganiche</li><li><i>R6</i> - Rigenerazione degli acidi o delle basi</li><li><i>R7</i> - Recupero dei prodotti che servono a captare gli inquinanti</li><li><i>R8</i> - Recupero dei prodotti provenienti dai catalizzatori</li><li><i>R9</i> - Rigenerazione o altri reimpieghi degli oli</li><li><i>R10</i> - Spandimento sul suolo a beneficio dell'agricoltura o dell'ecologia</li><li><i>R11</i> - Utilizzazione di rifiuti ottenuti da una delle operazioni indicate da R1 a R10</li><li><i>R12</i> - Scambio di rifiuti per sottoporli a una delle operazioni indicate da R1 a R11</li><li><i>R13</i> - Messa in riserva di rifiuti per sottoporli a una delle operazioni indicate nei punti da R1 a R12</li><li><i>D1</i> - Deposito sul o nel suolo</li><li><i>D2</i> - Trattamento in ambiente terrestre</li><li><i>D3</i> - Iniezioni in profondità</li><li><i>D4</i> - Lagunaggio</li><li><i>D5</i> - Messa in discarica specialmente allestita</li><li><i>D6</i> - Scarico dei rifiuti solidi nell'ambiente idrico eccetto l'immersione</li><li><i>D7</i> - Immersione, compreso il seppellimento nel sottosuolo marino</li><li><i>D8</i> - Trattamento biologico non specificato altrove nel presente allegato</li><li><i>D9</i> - Trattamento fisico-chimico non specificato altrove nel presente allegato</li><li><i>D10</i> - Incenerimento a terra</li><li><i>D11</i> - Incenerimento in mare</li><li><i>D12</i> - Deposito permanente</li><li><i>D13</i> - Raggruppamento preliminare prima di una delle operazioni di cui ai punti da D1 a D12</li><li><i>D14</i> - Ricondizionamento preliminare prima di una delle operazioni di cui ai punti da D1 a D13</li><li><i>D15</i> - Deposito preliminare prima di una delle operazioni di cui ai punti da D1 a D14</li></ul></p>",
      "nullable": true
    }
  },
  "additionalProperties": false
} as const

/** Schemi raggiunti da `CreateRegistroRequest` tramite `$ref`, verbatim dal contratto. */
export const DEFINIZIONI_CREA_REGISTRO = {
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
  "Attivita": {
    "enum": [
      "CentroRaccolta",
      "Produzione",
      "Recupero",
      "Smaltimento",
      "Trasporto",
      "IntermediazioneSenzaDetenzione"
    ],
    "type": "string"
  }
} as const
