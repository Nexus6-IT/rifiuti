import { SCHEMA_COPIA_CARTACEA, DEFINIZIONI_COPIA_CARTACEA } from './schema-copia-cartacea'
import { creaValidatoreContratto } from './validatore-contratto'

/**
 * Validazione del corpo di `POST /copia-cartacea/caricamento/{num_iscr_sito}`
 * contro `CopiaCartaceaModel` del contratto ufficiale (schema generato
 * verbatim, v. `npm run genera-schema:copia-cartacea` e
 * `schema-copia-cartacea.ts`).
 *
 * Restituisce il motivo del rifiuto, oppure `null` se il corpo e' accettabile.
 */
export const validaCopiaCartacea = creaValidatoreContratto(
  SCHEMA_COPIA_CARTACEA,
  DEFINIZIONI_COPIA_CARTACEA
)
