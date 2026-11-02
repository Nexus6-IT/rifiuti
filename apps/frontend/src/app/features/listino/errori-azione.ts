// Errori delle azioni di massa del listino (copie, provvigioni e sconti, variazioni, ISTAT).
// Un 400 porta i messaggi in `error.errori` o `error.details.errori` (R60: elementi `{campo,
// messaggio}` o stringhe) oppure in `message` (stringa o array).
//
// Un 409 può essere di tre nature (`naturaConflitto`):
// - `rilettura`: versione superata (`*_NEL_FRATTEMPO`), listino non più modificabile, anteprima
//   superata: i dati scritti non servono più, il messaggio si mostra con "Ricarica";
// - `concorrente`: un'altra operazione teneva gli stessi dati (`OPERAZIONE_CONCORRENTE`): il form
//   resta e si riprova con lo stesso pulsante, senza "Ricarica";
// - `dato`: lo causa quanto è stato scritto (duplicati, minimo già presente...): il messaggio sta
//   in cima al form e il form resta, senza "Ricarica".

export interface ErroriAzione {
  messaggi: string[]
  conflitto: boolean
  /** Natura del 409 (null se non è un 409). */
  natura: NaturaConflitto | null
  /** Vero se serve rileggere i dati: l'unico caso in cui si offre "Ricarica". */
  rilettura: boolean
  /** Codice del backend (`error.error`): `VARIAZIONE_SUPERATA`, `OPERAZIONE_CONCORRENTE`, ... */
  codice: string | null
  /** Messaggi con il campo di provenienza (null = riguardano più campi o l'azione intera). */
  campi: { campo: string | null; messaggio: string }[]
}

export const VARIAZIONE_SUPERATA = 'VARIAZIONE_SUPERATA'
export const OPERAZIONE_CONCORRENTE = 'OPERAZIONE_CONCORRENTE'

/** L'unico testo di `OPERAZIONE_CONCORRENTE` per tutti i dialog del listino (e delle azioni). */
export const MESSAGGIO_CONCORRENTE =
  'Un’altra operazione stava toccando gli stessi dati: riprova fra un momento.'

export type NaturaConflitto = 'rilettura' | 'concorrente' | 'dato'

/** Codice del backend (`error.error`) di un errore HTTP, se c'è. */
export const codiceErrore = (err: unknown): string | null => {
  const c = (err as { error?: { error?: unknown } } | null)?.error?.error
  return typeof c === 'string' ? c : null
}

/**
 * Natura di un 409 (null se l'errore non è un 409). Senza codice non si sa che cosa lo ha
 * causato: si tratta come `rilettura`, la scelta prudente.
 */
export function naturaConflitto(err: unknown): NaturaConflitto | null {
  if ((err as { status?: number } | null)?.status !== 409) return null
  const codice = codiceErrore(err)
  if (codice === OPERAZIONE_CONCORRENTE) return 'concorrente'
  if (
    codice === null ||
    codice === VARIAZIONE_SUPERATA ||
    codice.endsWith('_NEL_FRATTEMPO') ||
    codice.endsWith('_NON_MODIFICABILE')
  )
    return 'rilettura'
  return 'dato'
}

/** 409 di un'operazione concorrente: si riprova con la stessa anteprima. */
export const eConcorrente = (e: ErroriAzione): boolean =>
  e.conflitto && e.codice === OPERAZIONE_CONCORRENTE

const testoDi = (x: unknown): string | null => {
  if (typeof x === 'string') return x.trim() || null
  const m = (x as { messaggio?: unknown } | null)?.messaggio
  return typeof m === 'string' && m.trim() ? m : null
}

export function leggiErroriAzione(err: unknown, ripiego: string): ErroriAzione {
  const e = err as {
    status?: number
    error?: {
      error?: unknown
      errori?: unknown
      details?: { errori?: unknown }
      message?: unknown
    }
  } | null
  const conflitto = e?.status === 409
  const codice = typeof e?.error?.error === 'string' ? e.error.error : null
  const natura = naturaConflitto(err)
  const base = { conflitto, codice, natura, rilettura: natura === 'rilettura' }
  if (natura === 'concorrente') {
    return {
      ...base,
      messaggi: [MESSAGGIO_CONCORRENTE],
      campi: [{ campo: null, messaggio: MESSAGGIO_CONCORRENTE }],
    }
  }
  const strutturati = e?.error?.errori ?? e?.error?.details?.errori
  if (Array.isArray(strutturati)) {
    const campi = strutturati
      .map(x => ({
        campo:
          typeof (x as { campo?: unknown })?.campo === 'string'
            ? (x as { campo: string }).campo
            : null,
        messaggio: testoDi(x),
      }))
      .filter((x): x is { campo: string | null; messaggio: string } => x.messaggio !== null)
    if (campi.length > 0) return { ...base, messaggi: campi.map(c => c.messaggio), campi }
  }
  const m = e?.error?.message
  const testi = Array.isArray(m)
    ? m.map(testoDi).filter((t): t is string => t !== null)
    : typeof m === 'string' && m.trim()
      ? [m]
      : []
  const messaggi = testi.length > 0 ? testi : [ripiego]
  return { ...base, messaggi, campi: messaggi.map(messaggio => ({ campo: null, messaggio })) }
}
