import { SCHEMA_COPIA_DIGITALE, DEFINIZIONI_COPIA_DIGITALE } from './schema-copia-digitale'
import { creaValidatoreContratto } from './validatore-contratto'

/**
 * Validazione del corpo di `POST /copia-digitale/caricamento/{numero_fir}`
 * contro `CopiaDigitaleModel` del contratto ufficiale (schema generato
 * verbatim, v. `npm run genera-schema:copia-digitale` e
 * `schema-copia-digitale.ts`).
 *
 * Stesso principio di `trasmissione-dati.ts`/`nuovo-formulario.ts`: le regole
 * vengono dal contratto, non da una lettura a mano.
 *
 * Restituisce il motivo del rifiuto, oppure `null` se il corpo e' accettabile.
 */
export const validaCopiaDigitale = creaValidatoreContratto(
  SCHEMA_COPIA_DIGITALE,
  DEFINIZIONI_COPIA_DIGITALE
)
