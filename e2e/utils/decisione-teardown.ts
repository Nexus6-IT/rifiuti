/**
 * Decisione del globalTeardown (scripts/verifica-residuo.ts), come funzione
 * pura per poterla fissare con un test senza server.
 *
 * - `niente`: nulla registrato e nessun database raggiungibile (DATABASE_URL non
 *   impostata): nessun login, nessuna verifica.
 * - `solo-verifica`: nulla registrato ma DATABASE_URL impostata (es. passata 1
 *   della CI, che non ha `/auth/dev/login`): nessun login né pulizia, ma la
 *   verifica di residuo zero (sola query DB) gira comunque e fallisce se trova
 *   record col prefisso della run.
 * - `procedi`: c'è qualcosa da pulire e l'admin è autenticabile (credenziali
 *   reali o dev-login): pulizia e verifica di residuo zero.
 * - `errore`: c'è qualcosa da pulire ma non si può autenticare l'admin. Non è
 *   un warning: i dati creati resterebbero e la verifica di residuo zero
 *   non girerebbe mai.
 */
export type DecisioneTeardown = 'niente' | 'solo-verifica' | 'procedi' | 'errore'

export function decidiTeardown(stato: {
  registrate: number
  adminAutenticabile: boolean
  databaseDisponibile: boolean
}): DecisioneTeardown {
  if (stato.registrate === 0) return stato.databaseDisponibile ? 'solo-verifica' : 'niente'
  return stato.adminAutenticabile ? 'procedi' : 'errore'
}
