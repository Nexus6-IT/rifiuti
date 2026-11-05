import { Prisma } from '@prisma/client'

/**
 * Stati del ciclo di vita FIR (colonna `status`) che non entrano nell'andamento mensile ne' nella
 * previsione: una bozza mai emessa (DRAFT, AWAITING_PRODUCER) e un formulario annullato non sono
 * documenti compiuti. Una sola costante, cosi' le barre di `GET /dashboard/andamento` e la
 * previsione di `GET /dashboard` contano la stessa popolazione.
 *
 * Inserita nell'SQL come frammento letterale via `Prisma.raw` (un parametro ordinario legherebbe
 * l'intera stringa come UN valore): sono costanti di questo file, non dati esterni.
 */
export const STATI_ESCLUSI_SQL = Prisma.raw("'DRAFT', 'AWAITING_PRODUCER', 'CANCELLED'")
