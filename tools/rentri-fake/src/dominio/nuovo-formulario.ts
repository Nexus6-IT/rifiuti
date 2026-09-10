import { SCHEMA_NUOVO_FORMULARIO } from './schema-nuovo-formulario'

/**
 * Validazione del corpo di `POST /formulari/v1.0/` contro
 * `NuovoFormularioModel` del contratto ufficiale.
 *
 * Le regole NON sono scritte qui: vengono lette dallo schema generato dal
 * contratto (`schema-nuovo-formulario.ts`). Un elenco di campi scritto a mano
 * sarebbe di nuovo «la nostra idea del contratto» — cioe' il meccanismo che ha
 * lasciato passare per mesi il segnaposto del backend.
 *
 * Restituisce il motivo del rifiuto, oppure `null` se il corpo e' accettabile.
 */

const schema = SCHEMA_NUOVO_FORMULARIO as unknown as {
  required: string[]
  properties: Record<string, { pattern?: string }>
  additionalProperties?: boolean
}

export function validaNuovoFormulario(corpo: unknown): string | null {
  const oggetto = (corpo ?? {}) as Record<string, unknown>

  for (const campo of schema.required) {
    if (oggetto[campo] === undefined || oggetto[campo] === null) {
      return `Campo obbligatorio mancante: '${campo}'.`
    }
  }

  for (const [campo, regola] of Object.entries(schema.properties)) {
    const valore = oggetto[campo]
    if (regola.pattern && typeof valore === 'string' && !new RegExp(regola.pattern).test(valore)) {
      return `Campo '${campo}' non rispetta il formato del contratto (${regola.pattern}).`
    }
  }

  if (schema.additionalProperties === false) {
    const ammessi = Object.keys(schema.properties)
    const estranei = Object.keys(oggetto).filter(campo => !ammessi.includes(campo))
    if (estranei.length > 0) {
      return `Campi non previsti dal modello (additionalProperties: false): ${estranei.join(', ')}.`
    }
  }

  return null
}
