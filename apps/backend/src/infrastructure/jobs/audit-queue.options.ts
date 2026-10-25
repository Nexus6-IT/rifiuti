/**
 * Opzioni comuni dei job della coda `audit-logging`.
 *
 * `removeOnFail` come nella coda RENTRI: un job fallito resta 7 giorni per
 * l'analisi e poi viene eliminato, invece di restare in Redis per sempre.
 */
export const AUDIT_QUEUE_JOB_OPTIONS = {
  removeOnFail: { age: 604800 },
}
