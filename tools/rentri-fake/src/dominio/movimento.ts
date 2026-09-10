import { SCHEMA_MOVIMENTO, DEFINIZIONI_MOVIMENTO } from './schema-movimento'
import {
  SCHEMA_ANNULLAMENTO_MOVIMENTO,
  DEFINIZIONI_ANNULLAMENTO_MOVIMENTO,
} from './schema-annullamento-movimento'
import { SCHEMA_VALIDA_REGISTRO, DEFINIZIONI_VALIDA_REGISTRO } from './schema-valida-registro'
import { creaValidatoreContratto } from './validatore-contratto'

/**
 * `POST /operatore/{identificativo_registro}/movimenti` (dati-registri.yaml
 * righe 473-597) accetta un array (1-1000 elementi) di `MovimentoModel` o
 * `AnnullamentoMovimentoModel` (`oneOf`) — non uno schema con nome proprio nel
 * contratto, ma un array inline. Le due radici sono generate separatamente
 * (`npm run genera-schema:movimento` / `:annullamento-movimento`, verbatim dal
 * contratto) e qui composte in un unico validatore: l'involucro array/oneOf
 * e' scritto a mano (non e' un modello del contratto da poter copiare), le
 * regole dei due modelli restano quelle generate.
 */
const RADICE_ELENCO_MOVIMENTI = {
  type: 'array',
  minItems: 1,
  maxItems: 1000,
  items: {
    oneOf: [
      { $ref: '#/components/schemas/MovimentoModel' },
      { $ref: '#/components/schemas/AnnullamentoMovimentoModel' },
    ],
  },
} as const

const DEFINIZIONI_ELENCO_MOVIMENTI = {
  MovimentoModel: SCHEMA_MOVIMENTO,
  ...DEFINIZIONI_MOVIMENTO,
  AnnullamentoMovimentoModel: SCHEMA_ANNULLAMENTO_MOVIMENTO,
  ...DEFINIZIONI_ANNULLAMENTO_MOVIMENTO,
}

/** Motivo del rifiuto, o `null` se il corpo e' un elenco di registrazioni accettabile. */
export const validaElencoMovimenti = creaValidatoreContratto(
  RADICE_ELENCO_MOVIMENTI,
  DEFINIZIONI_ELENCO_MOVIMENTI
)

/**
 * `POST /operatore/{identificativo_registro}/valida` (dati-registri.yaml
 * righe 1063-1071): corpo `ValidaRegistroRequest`, schema generato verbatim
 * (`npm run genera-schema:valida-registro`).
 */
export const validaRichiestaValidaRegistro = creaValidatoreContratto(
  SCHEMA_VALIDA_REGISTRO,
  DEFINIZIONI_VALIDA_REGISTRO
)
