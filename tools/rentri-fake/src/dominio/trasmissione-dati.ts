import { SCHEMA_TRASMISSIONE_DATI, DEFINIZIONI_TRASMISSIONE_DATI } from './schema-trasmissione-dati'
import { creaValidatoreContratto } from './validatore-contratto'

/**
 * Validazione del corpo di `POST /trasmissioni/operatore/{num_iscr_sito}`
 * contro `DatiTrasmissioneFormularioModel` del contratto ufficiale, modelli
 * annidati compresi (schema generato verbatim, v.
 * `npm run genera-schema:trasmissione-dati` e `schema-trasmissione-dati.ts`).
 *
 * Stesso principio di `nuovo-formulario.ts` (`validaNuovoFormulario`): le
 * regole vengono dal contratto, non da una lettura a mano — un validatore
 * scritto a mano e' esattamente il meccanismo che ha lasciato passare per
 * mesi il segnaposto del backend.
 *
 * Restituisce il motivo del rifiuto, oppure `null` se il corpo e' accettabile.
 */
export const validaTrasmissioneDati = creaValidatoreContratto(
  SCHEMA_TRASMISSIONE_DATI,
  DEFINIZIONI_TRASMISSIONE_DATI
)
