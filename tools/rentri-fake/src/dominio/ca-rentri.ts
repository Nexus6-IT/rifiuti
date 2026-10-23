import {
  SCHEMA_CA_RENTRI_AUTHORIZE,
  DEFINIZIONI_CA_RENTRI_AUTHORIZE,
} from './schema-ca-rentri-authorize'
import {
  SCHEMA_CA_RENTRI_SIGN_HASH,
  DEFINIZIONI_CA_RENTRI_SIGN_HASH,
} from './schema-ca-rentri-sign-hash'
import { creaValidatoreContratto } from './validatore-contratto'

/**
 * Validazione dei corpi di `POST /credentials/authorize` e
 * `POST /signatures/sign-hash` contro `CredentialsAuthorizeRequest` e
 * `SignatureRequest` di `ca-rentri.yaml` (schemi generati verbatim, v.
 * `npm run genera-schema:ca-rentri-authorize` / `...-sign-hash`).
 *
 * Restituiscono il motivo del rifiuto, oppure `null` se il corpo e' accettabile.
 */
export const validaCredentialsAuthorize = creaValidatoreContratto(
  SCHEMA_CA_RENTRI_AUTHORIZE,
  DEFINIZIONI_CA_RENTRI_AUTHORIZE
)

export const validaSignHash = creaValidatoreContratto(
  SCHEMA_CA_RENTRI_SIGN_HASH,
  DEFINIZIONI_CA_RENTRI_SIGN_HASH
)
