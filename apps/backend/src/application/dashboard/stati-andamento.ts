/**
 * Stati del ciclo di vita FIR (colonna `status`) che non entrano nell'andamento mensile ne' nella
 * previsione: una bozza mai emessa (DRAFT, AWAITING_PRODUCER) e un formulario annullato non sono
 * documenti compiuti. Una sola costante, cosi' le barre di `GET /dashboard/andamento` e la
 * previsione di `GET /dashboard` contano la stessa popolazione.
 *
 * Si usa come parametro legato: ``status::text <> ALL(${STATI_ESCLUSI}::text[])``.
 */
export const STATI_ESCLUSI: string[] = ['DRAFT', 'AWAITING_PRODUCER', 'CANCELLED']
