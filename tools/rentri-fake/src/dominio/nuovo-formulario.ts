import { SCHEMA_NUOVO_FORMULARIO, DEFINIZIONI_NUOVO_FORMULARIO } from './schema-nuovo-formulario'
import { creaValidatoreContratto } from './validatore-contratto'

/**
 * Validazione del corpo di `POST /formulari/v1.0/` contro
 * `NuovoFormularioModel` del contratto ufficiale, modelli annidati compresi.
 *
 * Le regole NON sono scritte qui: vengono dallo schema generato dal contratto
 * (`schema-nuovo-formulario.ts`, verbatim), compilato da
 * `creaValidatoreContratto` (`validatore-contratto.ts`, condiviso con
 * `trasmissione-dati.ts`). Un validatore scritto a mano sarebbe di nuovo «la
 * nostra idea del contratto» — cioe' il meccanismo che ha lasciato passare
 * per mesi il segnaposto del backend.
 *
 * Restituisce il motivo del rifiuto, oppure `null` se il corpo e' accettabile.
 */
export const validaNuovoFormulario = creaValidatoreContratto(
  SCHEMA_NUOVO_FORMULARIO,
  DEFINIZIONI_NUOVO_FORMULARIO
)
