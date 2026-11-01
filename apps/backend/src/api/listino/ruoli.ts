// Ruoli ammessi sulle rotte del listino (R11): lettura e scrittura sono quelle del pezzo clienti
// (4.1), riesportate cosi' i controller del listino non importano da un controller a caso.
// Le variazioni di prezzo (Task 10) sono riservate ad amministratori.
export { RUOLI_LETTURA, RUOLI_SCRITTURA } from '../clienti/ruoli'
export const RUOLI_VARIAZIONI = ['SUPER_ADMIN', 'ADMIN'] as const
