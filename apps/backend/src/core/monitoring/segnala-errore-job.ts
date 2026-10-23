import * as Sentry from '@sentry/node'

/**
 * Segnala a Bugsink l'errore di un job schedulato (@Cron).
 *
 * Senza SENTRY_DSN l'SDK non è inizializzato e la chiamata non fa nulla. Un Bugsink
 * irraggiungibile non deve mai far cadere il job: ogni eccezione viene inghiottita.
 * `job` è il nome del metodo schedulato; `tag` aggiunge dettagli (es. `tenantId`).
 */
export function segnalaErroreJob(
  job: string,
  errore: unknown,
  tag: Record<string, string> = {}
): void {
  try {
    Sentry.captureException(errore instanceof Error ? errore : new Error(String(errore)), {
      tags: { job, ...tag },
    })
  } catch {
    // Bugsink irraggiungibile: il job non deve cambiare esito
  }
}
