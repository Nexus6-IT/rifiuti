import { LoggerService } from '../../core/logger/logger.service'
import { MetricsService } from '../../core/metrics/metrics.service'

/**
 * Meccanismi di resilienza condivisi verso RENTRI (403/429/423/5xx),
 * estratti da {@link RENTRIApiClient} (`rentri-api.client.ts`) perché
 * servono, identici, anche al client delle codifiche
 * (`codifiche/rentri-codifiche.client.ts`): stessa politica, stesso
 * `ProblemDetails`, stesso backoff — invece di duplicare la logica in due
 * posti, entrambi i client compongono queste funzioni.
 *
 * Politica (contratto ufficiale, `ProblemDetails` su ogni risposta di
 * errore):
 * - **403** "Operazione non consentita" → credenziale non valida o
 *   operazione vietata: MAI ritentare.
 * - **429** → rispetta `Retry-After` se presente, altrimenti backoff
 *   esponenziale.
 * - **423** (risorsa bloccata) e **5xx** → backoff esponenziale.
 */

/** Errore che rappresenta una risposta di errore RENTRI dopo l'eventuale esaurimento dei tentativi di resilienza. */
export class RentriApiError extends Error {
  constructor(
    readonly status: number,
    readonly problemTitle: string | undefined,
    readonly problemDetail: string | undefined,
    readonly retryable: boolean
  ) {
    super(
      retryable
        ? `RENTRI ha risposto ${status} (${problemTitle ?? 'errore transitorio'}): tentativi di resilienza esauriti`
        : `RENTRI ha rifiutato la richiesta (${status}): ${problemTitle ?? 'operazione non consentita'}`
    )
    this.name = 'RentriApiError'
  }
}

/**
 * Estrae `title`/`detail` da un corpo `application/problem+json`
 * (`ProblemDetails`, contratto ufficiale). Sono gli UNICI campi del corpo di
 * errore che i client riportano nei log: il contenuto grezzo della risposta
 * non va mai esposto al tenant.
 */
export function estraiProblemDetailsRentri(data: unknown): { title?: string; detail?: string } {
  if (data && typeof data === 'object') {
    const problema = data as { title?: unknown; detail?: unknown }
    return {
      title: typeof problema.title === 'string' ? problema.title : undefined,
      detail: typeof problema.detail === 'string' ? problema.detail : undefined,
    }
  }
  return {}
}

/** Parametri del backoff esponenziale usato quando l'ente non indica `Retry-After`. */
export interface BackoffConfig {
  /** Base (ms) del backoff esponenziale. */
  baseMs: number
  /** Tetto (ms) del backoff esponenziale, per non attendere indefinitamente. */
  maxMs: number
}

/**
 * Calcola l'attesa (ms) prima del prossimo tentativo: rispetta l'header
 * `Retry-After` (in secondi) se presente e valido, altrimenti applica un
 * backoff esponenziale (`baseMs * 2^(tentativo-1)`, tetto `maxMs`).
 */
export function calcolaAttesaRetryMs(
  tentativo: number,
  retryAfterHeader: string | undefined,
  backoff: BackoffConfig
): number {
  if (retryAfterHeader !== undefined) {
    const secondi = Number(retryAfterHeader)
    if (!Number.isNaN(secondi) && secondi >= 0) {
      return secondi * 1000
    }
  }
  return Math.min(backoff.baseMs * 2 ** (tentativo - 1), backoff.maxMs)
}

/** Forma minima di risposta che le funzioni di classificazione hanno bisogno di leggere. */
export interface RispostaErroreRentri {
  status: number
  headers?: Record<string, unknown>
  data?: unknown
}

/**
 * Classifica una risposta di errore RENTRI e, se transitoria, attende prima
 * del prossimo tentativo (v. commento di testata per la politica completa).
 * Restituisce `'ritenta'` se il chiamante deve rieseguire la richiesta;
 * solleva {@link RentriApiError} sul fallimento definitivo (403, o
 * transitorio con tentativi esauriti).
 */
export async function gestisciRispostaErroreRentri(
  risposta: RispostaErroreRentri,
  contesto: string,
  tentativo: number,
  maxTentativi: number,
  logger: LoggerService,
  metrics: MetricsService,
  attendi: (ms: number) => Promise<void>,
  backoff: BackoffConfig
): Promise<'ritenta'> {
  const { status } = risposta
  const problema = estraiProblemDetailsRentri(risposta.data)

  if (status === 403) {
    logger.warn(
      `RENTRI ha rifiutato la richiesta a ${contesto} (403): credenziale non valida o operazione non consentita, nessun nuovo tentativo`,
      { title: problema.title, detail: problema.detail }
    )
    metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'FORBIDDEN' })
    throw new RentriApiError(403, problema.title, problema.detail, false)
  }

  const ritentabile = status === 429 || status === 423 || status >= 500

  if (!ritentabile) {
    throw new Error(`Risposta inattesa da ${contesto}: HTTP ${status}`)
  }

  if (tentativo >= maxTentativi) {
    logger.error(
      `RENTRI continua a rispondere ${status} a ${contesto}: esauriti i ${maxTentativi} tentativi`,
      undefined,
      { title: problema.title, detail: problema.detail }
    )
    metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'HTTP' })
    throw new RentriApiError(status, problema.title, problema.detail, true)
  }

  const retryAfter = risposta.headers?.['retry-after'] ?? risposta.headers?.['Retry-After']
  const attesaMs = calcolaAttesaRetryMs(tentativo, retryAfter as string | undefined, backoff)

  logger.warn(
    `RENTRI ha risposto ${status} a ${contesto}: nuovo tentativo (${tentativo}/${maxTentativi}) dopo ${attesaMs}ms`,
    { title: problema.title, detail: problema.detail }
  )
  metrics.rentriApiErrors.inc({ endpoint: contesto, error_type: 'HTTP' })
  await attendi(attesaMs)
  return 'ritenta'
}

/** Attesa non bloccante, condivisa tra i client (polling/retry). */
export function attendiMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
