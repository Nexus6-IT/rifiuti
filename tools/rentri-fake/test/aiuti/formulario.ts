/**
 * Corpo di `POST /formulari/v1.0/` valido secondo `NuovoFormularioModel`.
 *
 * Esiste in un solo posto di proposito: quando la validazione del finto si
 * stringe, i test che vogliono solo un formulario creato (asincronia, canale
 * di controllo, visibilita') non devono essere corretti uno per uno. Chi
 * verifica il RIFIUTO parte da qui e toglie o guasta il campo in esame, cosi'
 * il test dice esattamente quale regola sta esercitando.
 *
 * I valori rispettano i vincoli del contratto ufficiale
 * (`docs/contracts/rentri/formulari.yaml`): il pattern di `num_iscr_sito`, i
 * campi obbligatori di `DatiPartenzaModel` (destinatario, rifiuto, almeno un
 * trasportatore) e quelli di `DatiRifiutoModel`.
 */
export function corpoNuovoFormularioValido(): Record<string, unknown> {
  return {
    num_iscr_sito: 'OP1234ABC000001-AB0001',
    dati_partenza: {
      destinatario: { num_iscr_sito: 'OP1234ABC000002-AB0002' },
      trasportatori: [{ num_iscr_sito: 'OP1234ABC000003-AB0003' }],
      rifiuto: {
        codice_eer: '150106',
        provenienza: 'Speciale',
        stato_fisico: 'Solido',
      },
    },
  }
}
