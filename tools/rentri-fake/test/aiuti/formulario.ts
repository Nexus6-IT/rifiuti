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
 * (`docs/contracts/rentri/formulari.yaml`), compresi quelli che una lettura
 * distratta sbaglia: `provenienza` e `stato_fisico` sono CODICI (`S`, non
 * «Speciale»/«Solido») e ogni trasportatore deve portare `tipo_trasporto`,
 * che arriva dal modello base tramite `allOf` e non si vede guardando solo la
 * variante «Sito». La prima stesura di questo aiuto sbagliava entrambe le
 * cose ed e' stato il validatore a dirlo — che e' esattamente il lavoro per
 * cui esiste.
 */
export function corpoNuovoFormularioValido(): Record<string, unknown> {
  return {
    num_iscr_sito: 'OP1234ABC000001-AB0001',
    dati_partenza: {
      destinatario: { num_iscr_sito: 'OP1234ABC000002-AB0002' },
      trasportatori: [
        { num_iscr_sito: 'OP1234ABC000003-AB0003', tipo_trasporto: 'Terrestre' },
      ],
      rifiuto: {
        codice_eer: '150106',
        provenienza: 'S',
        stato_fisico: 'S',
      },
    },
  }
}
