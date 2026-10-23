/**
 * Corpo di `POST /trasmissioni/operatore/{num_iscr_sito}` valido secondo
 * `DatiTrasmissioneFormularioModel` (validato da
 * `src/dominio/trasmissione-dati.ts`, schema generato dal contratto
 * ufficiale — v. `npm run genera-schema:trasmissione-dati`).
 *
 * Esiste in un solo posto per lo stesso motivo di
 * `test/aiuti/formulario.ts` (`corpoNuovoFormularioValido`): chi verifica il
 * RIFIUTO parte da qui e toglie/guasta il campo in esame, cosi' il test dice
 * esattamente quale regola sta esercitando; chi vuole solo una trasmissione
 * registrata non deve conoscere l'intero `DatiTrasmissionePartenzaModel`.
 *
 * `DatiTrasmissioneFormularioModel` NON e' `NuovoFormularioModel`: pur
 * condividendo `destinatario`/`trasportatori`/`rifiuto`, qui `destinatario`
 * e ogni `trasportatore` richiedono `codice_fiscale`/`denominazione`
 * (`indirizzo` solo per `destinatario`) — un dettaglio che una lettura
 * distratta del corpo di creazione FIR (`corpoNuovoFormularioValido`, che si
 * accontenta di `num_iscr_sito`) farebbe rifiutare qui con 400.
 */
export function corpoTrasmissioneDatiValido(): Record<string, unknown> {
  return {
    dati_partenza: {
      numero_fir: 'TSTB12345XY',
      data_emissione: '2026-09-01T10:00:00Z',
      destinatario: {
        codice_fiscale: 'RSSMRA80A01F205X',
        denominazione: 'Destinatario Ambiente S.r.l.',
        indirizzo: {
          citta: { comune_id: '015146' },
          indirizzo: 'Via Ripamonti',
          civico: '88',
        },
      },
      trasportatori: [
        {
          codice_fiscale: 'RSSMRA80A01F205X',
          denominazione: 'Trasportatore Ecologico S.r.l.',
          tipo_trasporto: 'Terrestre',
          trasportatore_id: 1,
        },
      ],
      rifiuto: {
        codice_eer: '150106',
        provenienza: 'S',
        stato_fisico: 'S',
      },
    },
  }
}
