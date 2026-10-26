/**
 * Decisione del globalTeardown (scripts/verifica-residuo.ts), come funzione
 * pura per poterla fissare con un test senza server.
 *
 * - `niente`: in questa run non è stato registrato nulla (es. passata 1 della
 *   CI, che non ha `/auth/dev/login` e non crea risorse): nessun login,
 *   nessuna verifica.
 * - `procedi`: c'è qualcosa da pulire e l'admin è autenticabile (credenziali
 *   reali o dev-login): pulizia e verifica di residuo zero.
 * - `errore`: c'è qualcosa da pulire ma non si può autenticare l'admin. Non è
 *   un warning: i dati creati resterebbero e la verifica di residuo zero
 *   non girerebbe mai.
 */
export type DecisioneTeardown = 'niente' | 'procedi' | 'errore'

export function decidiTeardown(stato: {
  registrate: number
  adminAutenticabile: boolean
}): DecisioneTeardown {
  if (stato.registrate === 0) return 'niente'
  return stato.adminAutenticabile ? 'procedi' : 'errore'
}
