// Errori delle azioni di massa del listino (copie, provvigioni e sconti, variazioni, ISTAT).
// Un 400 porta i messaggi in `error.errori` o `error.details.errori` (R60: elementi `{campo,
// messaggio}` o stringhe) oppure in `message` (stringa o array); un 409 è una versione superata
// o un'anteprima superata: il messaggio si mostra con "Ricarica" o "rifai l'anteprima".

export interface ErroriAzione {
  messaggi: string[]
  conflitto: boolean
  /** Codice del backend (`error.error`): `VARIAZIONE_SUPERATA`, `OPERAZIONE_CONCORRENTE`, ... */
  codice: string | null
  /** Messaggi con il campo di provenienza (null = riguardano più campi o l'azione intera). */
  campi: { campo: string | null; messaggio: string }[]
}

export const VARIAZIONE_SUPERATA = 'VARIAZIONE_SUPERATA'
export const OPERAZIONE_CONCORRENTE = 'OPERAZIONE_CONCORRENTE'

export const MESSAGGIO_CONCORRENTE =
  'Un’altra operazione stava toccando gli stessi dati: riprova, l’anteprima è ancora valida.'

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
  const base = { conflitto, codice }
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
