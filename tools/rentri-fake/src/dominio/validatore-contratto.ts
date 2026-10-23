import Ajv, { ErrorObject } from 'ajv'

/**
 * Meccanismo condiviso per validare un corpo di richiesta contro uno schema
 * copiato verbatim dal contratto ufficiale (v. `scripts/genera-schema.js`).
 *
 * Estratto da `nuovo-formulario.ts` (che lo usava per `NuovoFormularioModel`)
 * quando è servito un secondo validatore dello stesso tipo
 * (`DatiTrasmissioneFormularioModel`, `trasmissione-dati.ts`): la traduzione
 * OpenAPI -> JSON Schema e la resa leggibile degli errori ajv non dipendono
 * dal modello specifico, duplicarle avrebbe rischiato una deriva fra le due
 * copie.
 */

const PREFISSO_OPENAPI = '#/components/schemas/'

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

/**
 * OpenAPI 3.0 non e' JSON Schema: `nullable: true` non esiste come parola
 * chiave e i `$ref` puntano a `components/schemas`. La traduzione sta qui e
 * non nello script di generazione, cosi' il modulo generato resta confrontabile
 * campo per campo col contratto.
 */
export function aJsonSchema(nodo: unknown): unknown {
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

/**
 * Compila `radice` + `definizioni` (verbatim dal contratto, v.
 * `scripts/genera-schema.js`) in un validatore ajv e restituisce una funzione
 * `corpo -> motivo del rifiuto | null`.
 *
 * `strict: false`: il contratto porta parole chiave di documentazione OpenAPI
 * (`example`, `title`, `description`) che ajv in modalita' stretta rifiuta.
 * Ignorarle e' corretto: non sono vincoli.
 *
 * `validateFormats: false`: i `format` del contratto sono quelli di OpenAPI
 * (`int32`, `double`, `date-time`), che ajv non conosce e comunque non
 * applicherebbe senza `ajv-formats`. Dichiararlo qui invece di lasciare che
 * ajv emetta un avviso per ognuno: il finto NON verifica i formati, ed e' una
 * divergenza permissiva (annotata in FEDELTA.md §7).
 */
export function creaValidatoreContratto(
  radice: Record<string, unknown>,
  definizioni: Record<string, unknown>
): (corpo: unknown) => string | null {
  const schemaCompleto = {
    ...(aJsonSchema(radice) as Record<string, unknown>),
    $defs: aJsonSchema(definizioni),
  }

  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false })
  const valida = ajv.compile(schemaCompleto)

  return (corpo: unknown): string | null => {
    if (valida(corpo ?? {})) return null

    const errori = valida.errors ?? []
    // `oneOf` produce un errore per ogni alternativa fallita piu' uno
    // riassuntivo: mostrarli tutti sarebbe illeggibile, mostrarne uno solo
    // nasconderebbe la causa. Si riportano i primi, deduplicati.
    const messaggi = [...new Set(errori.map(descrivi))].slice(0, 5)
    return messaggi.join(' ')
  }
}
