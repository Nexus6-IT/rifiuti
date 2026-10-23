import {
  SCHEMA_COPIA_CARTACEA_CONFERMA,
  DEFINIZIONI_COPIA_CARTACEA_CONFERMA,
} from './schema-copia-cartacea-conferma'
import { creaValidatoreContratto } from './validatore-contratto'

/**
 * Validazione del corpo di `PUT /copia-cartacea/conferma/{identificativo_soggetto}`
 * contro `CopiaCartaceaConfermaModel` del contratto ufficiale (schema
 * generato verbatim, v. `npm run genera-schema:copia-cartacea-conferma`).
 *
 * La copia digitale NON ha un validatore analogo: la sua conferma
 * (`PUT /copia-digitale/conferma/{num_iscr_sito}/{identificativo}`) non ha
 * corpo, solo parametri di path/query (`ruolo`, `respingi`) — v.
 * formulari.yaml righe 4391-4451.
 *
 * Restituisce il motivo del rifiuto, oppure `null` se il corpo e' accettabile.
 */
export const validaCopiaCartaceaConferma = creaValidatoreContratto(
  SCHEMA_COPIA_CARTACEA_CONFERMA,
  DEFINIZIONI_COPIA_CARTACEA_CONFERMA
)
