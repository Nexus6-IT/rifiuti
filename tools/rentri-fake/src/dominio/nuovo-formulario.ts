import Ajv, { ErrorObject } from 'ajv'
import {
  SCHEMA_NUOVO_FORMULARIO,
  DEFINIZIONI_NUOVO_FORMULARIO,
} from './schema-nuovo-formulario'

/**
 * Validazione del corpo di `POST /formulari/v1.0/` contro
 * `NuovoFormularioModel` del contratto ufficiale, modelli annidati compresi.
 *
 * Le regole NON sono scritte qui: vengono dallo schema generato dal contratto
 * (`schema-nuovo-formulario.ts`, verbatim). Un validatore scritto a mano
 * sarebbe di nuovo «la nostra idea del contratto» — cioe' il meccanismo che ha
 * lasciato passare per mesi il segnaposto del backend.
 *
 * Restituisce il motivo del rifiuto, oppure `null` se il corpo e' accettabile.
 */

const PREFISSO_OPENAPI = '#/components/schemas/'

/**
 * OpenAPI 3.0 non e' JSON Schema: `nullable: true` non esiste come parola
 * chiave e i `$ref` puntano a `components/schemas`. La traduzione sta qui e
 * non nello script di generazione, cosi' il modulo generato resta confrontabile
 * campo per campo col contratto.
 */
/**
 * Espressioni regolari del contratto che JavaScript non sa compilare, e che
 * quindi NON vengono applicate. Esportate per poterle dichiarare invece di
 * lasciarle sparire in silenzio: e' una divergenza permissiva del finto.
 *
 * Il caso noto e' `^(?!.*(?i)it).*$` su `nazione_id` di `CittaEsteraModel`:
 * usa il flag inline `(?i)` della sintassi .NET, che JavaScript non supporta.
 * Riscriverla a mano significherebbe reinterpretare il contratto — cioe' la
 * cosa che questo modulo esiste per evitare.
 */
export const PATTERN_NON_APPLICABILI: string[] = []

function compilabile(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u')
    return true
  } catch {
    return false
  }
}

function aJsonSchema(nodo: unknown): unknown {
  if (Array.isArray(nodo)) return nodo.map(aJsonSchema)
  if (nodo === null || typeof nodo !== 'object') return nodo

  const origine = nodo as Record<string, unknown>
  const risultato: Record<string, unknown> = {}

  for (const [chiave, valore] of Object.entries(origine)) {
    if (chiave === '$ref' && typeof valore === 'string' && valore.startsWith(PREFISSO_OPENAPI)) {
      risultato.$ref = `#/$defs/${valore.slice(PREFISSO_OPENAPI.length)}`
    } else if (chiave === 'nullable') {
      // gestito sotto, insieme a `type`
    } else if (chiave === 'pattern' && typeof valore === 'string' && !compilabile(valore)) {
      if (!PATTERN_NON_APPLICABILI.includes(valore)) PATTERN_NON_APPLICABILI.push(valore)
    } else {
      risultato[chiave] = aJsonSchema(valore)
    }
  }

  // `nullable: true` in OpenAPI significa «oppure null»: in JSON Schema si
  // esprime allargando il `type`. Senza questo, ogni campo dichiarato
  // nullable dal contratto verrebbe rifiutato quando vale null — una
  // divergenza in direzione RESTRITTIVA, che e' altrettanto dannosa.
  if (origine.nullable === true && typeof origine.type === 'string') {
    risultato.type = [origine.type, 'null']
  }

  return risultato
}

const schemaCompleto = {
  ...(aJsonSchema(SCHEMA_NUOVO_FORMULARIO) as Record<string, unknown>),
  $defs: aJsonSchema(DEFINIZIONI_NUOVO_FORMULARIO),
}

// `strict: false`: il contratto porta parole chiave di documentazione OpenAPI
// (`example`, `title`, `description`) che ajv in modalita' stretta rifiuta.
// Ignorarle e' corretto: non sono vincoli.
//
// `validateFormats: false`: i `format` del contratto sono quelli di OpenAPI
// (`int32`, `double`, `date-time`), che ajv non conosce e comunque non
// applicherebbe senza `ajv-formats`. Dichiararlo qui invece di lasciare che
// ajv emetta un avviso per ognuno: il finto NON verifica i formati, ed e' una
// divergenza permissiva (annotata in FEDELTA.md §7).
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false })
const valida = ajv.compile(schemaCompleto)

/** Il messaggio di ajv, con il percorso del campo reso leggibile. */
function descrivi(errore: ErrorObject): string {
  const percorso = errore.instancePath.replace(/^\//, '').replace(/\//g, '.')
  const campoMancante = (errore.params as { missingProperty?: string }).missingProperty
  const campoDiTroppo = (errore.params as { additionalProperty?: string }).additionalProperty

  if (campoMancante) {
    const dove = percorso ? `${percorso}.` : ''
    return `Campo obbligatorio mancante: '${dove}${campoMancante}'.`
  }
  if (campoDiTroppo) {
    const dove = percorso ? `${percorso}.` : ''
    return `Campo non previsto dal modello: '${dove}${campoDiTroppo}'.`
  }
  return `Campo '${percorso || '(radice)'}' ${errore.message}.`
}

export function validaNuovoFormulario(corpo: unknown): string | null {
  if (valida(corpo ?? {})) return null

  const errori = valida.errors ?? []
  // `oneOf` produce un errore per ogni alternativa fallita piu' uno
  // riassuntivo: mostrarli tutti sarebbe illeggibile, mostrarne uno solo
  // nasconderebbe la causa. Si riportano i primi, deduplicati.
  const messaggi = [...new Set(errori.map(descrivi))].slice(0, 5)
  return messaggi.join(' ')
}
