// Errori delle azioni di massa del listino (copie, provvigioni e sconti, variazioni, ISTAT).
// Un 400 porta i messaggi in `error.errori` o `error.details.errori` (R60: elementi `{campo,
// messaggio}` o stringhe) oppure in `message` (stringa o array); un 409 è una versione superata
// o un'anteprima superata: il messaggio si mostra con "Ricarica" o "rifai l'anteprima".

export interface ErroriAzione {
  messaggi: string[]
  conflitto: boolean
}

const testoDi = (x: unknown): string | null => {
  if (typeof x === 'string') return x.trim() || null
  const m = (x as { messaggio?: unknown } | null)?.messaggio
  return typeof m === 'string' && m.trim() ? m : null
}

export function leggiErroriAzione(err: unknown, ripiego: string): ErroriAzione {
  const e = err as {
    status?: number
    error?: { errori?: unknown; details?: { errori?: unknown }; message?: unknown }
  } | null
  const conflitto = e?.status === 409
  const strutturati = e?.error?.errori ?? e?.error?.details?.errori
  if (Array.isArray(strutturati)) {
    const testi = strutturati.map(testoDi).filter((t): t is string => t !== null)
    if (testi.length > 0) return { messaggi: testi, conflitto }
  }
  const m = e?.error?.message
  if (Array.isArray(m)) {
    const testi = m.map(testoDi).filter((t): t is string => t !== null)
    if (testi.length > 0) return { messaggi: testi, conflitto }
  }
  if (typeof m === 'string' && m.trim()) return { messaggi: [m], conflitto }
  return { messaggi: [ripiego], conflitto }
}
