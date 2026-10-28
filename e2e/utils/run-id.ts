/**
 * Prefisso di run — garantisce che ogni dato creato dalla suite E2E sia
 * riconoscibile e univoco per l'esecuzione corrente, così il teardown
 * (vedi fixtures/risorse.ts + scripts/verifica-residuo.ts) può ripulire
 * senza rischiare di toccare dati di un'altra run o dati reali.
 *
 * Il valore è memoizzato per processo (una sola generazione), ma condiviso
 * fra i worker Playwright di UNA STESSA esecuzione tramite la variabile
 * d'ambiente E2E_RUN_ID: playwright.config.ts la forza a essere generata
 * PRIMA che i worker vengano avviati (che ereditano l'ambiente del
 * processo padre al fork), così tutti i worker — e il globalTeardown, che
 * gira nello stesso processo di config — vedono lo stesso prefisso.
 */

let cached: string | null = null

export function runId(): string {
  if (cached) return cached

  const fromEnv = process.env.E2E_RUN_ID?.trim()
  if (fromEnv) {
    cached = fromEnv
    return cached
  }

  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 8)
  cached = `run-${timestamp}-${random}`
  process.env.E2E_RUN_ID = cached
  return cached
}

/** Antepone il prefisso della run corrente a un nome di risorsa. */
export function conPrefisso(nome: string): string {
  return `${runId()}-${nome}`
}

/** True se il valore porta il prefisso della run corrente (vedi conPrefisso). */
export function haPrefissoDiRun(valore: string): boolean {
  return valore.startsWith(`${runId()}-`)
}

/**
 * Come `conPrefisso`, ma con un suffisso casuale a lunghezza fissa: due
 * chiamate con lo stesso nome danno nomi diversi e nessuno è sottostringa
 * dell'altro. Serve quando il nome è l'unico modo per ritrovare la risorsa
 * nella UI (es. una voce di dropdown scelta per testo): con nomi uguali la
 * ricerca prenderebbe la risorsa di un altro test della stessa run.
 */
export function conPrefissoUnico(nome: string): string {
  const suffisso = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${conPrefisso(nome)}-${suffisso}`
}
