/**
 * Logica pura (nessuna rete) per riprovare il dev-login dopo un 429.
 *
 * Perché serve: ogni test fa un login nuovo e il token NON si può riusare fra
 * test (l'app impone una sola sessione attiva per utente: un nuovo login
 * invalida il precedente). Con più worker in parallelo il throttler globale
 * del backend (ThrottlerModule in app.module.ts: short 10/s, medium 100/min,
 * long 1000/15min per IP, nessun @Throttle sul dev-login) può rispondere 429.
 * Il rate limit resta com'è (è un controllo di sicurezza): il client attende
 * e riprova, entro un tetto complessivo.
 */

/** Tetto complessivo di attesa prima di arrendersi (ms). */
export const DEV_LOGIN_ATTESA_MAX_MS = 30_000
/** Backoff di base (ms) quando manca l'header di retry: 1s, 2s, 4s… */
export const DEV_LOGIN_BACKOFF_BASE_MS = 1_000
/** Margine aggiunto all'attesa indicata dal server (ms). */
const MARGINE_MS = 100

/**
 * Secondi indicati dal server: `Retry-After` oppure `Retry-After-<throttler>`
 * (il ThrottlerGuard v6 aggiunge il suffisso col nome del throttler che ha
 * bloccato). Prende il valore più alto fra quelli validi; null se assente.
 */
export function leggiRetryAfterSecondi(headers: Pick<Headers, 'forEach'>): number | null {
  let max: number | null = null
  headers.forEach((valore, nome) => {
    if (!/^retry-after(-.+)?$/i.test(nome)) return
    const secondi = Number(valore)
    if (Number.isFinite(secondi) && secondi >= 0 && (max === null || secondi > max)) {
      max = secondi
    }
  })
  return max
}

export type DecisioneRetry =
  | { riprova: true; attesaMs: number }
  | { riprova: false; motivo: string }

/**
 * Decide se riprovare dopo una risposta del dev-login.
 * @param status      status HTTP della risposta
 * @param tentativo   numero del tentativo appena fallito (1 = il primo)
 * @param attesaGiaFattaMs attesa totale già consumata dai retry precedenti
 * @param retryAfterSecondi valore dell'header di retry, se presente
 */
export function decidiRetryDevLogin(
  status: number,
  tentativo: number,
  attesaGiaFattaMs: number,
  retryAfterSecondi: number | null
): DecisioneRetry {
  if (status !== 429) return { riprova: false, motivo: 'status diverso da 429' }

  const attesaMs =
    retryAfterSecondi !== null
      ? Math.ceil(retryAfterSecondi * 1000) + MARGINE_MS
      : DEV_LOGIN_BACKOFF_BASE_MS * 2 ** (tentativo - 1)

  if (attesaGiaFattaMs + attesaMs > DEV_LOGIN_ATTESA_MAX_MS) {
    return { riprova: false, motivo: 'tetto di attesa superato' }
  }
  return { riprova: true, attesaMs }
}
