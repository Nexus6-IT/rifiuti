import type { ThrottlerOptions } from '@nestjs/throttler'

/**
 * Limiti di frequenza globali dell'API (T254), per IP. Sono l'UNICA configurazione di
 * `ThrottlerModule.forRoot`: nessun altro modulo deve chiamarlo, perche' un secondo `forRoot`
 * sostituirebbe queste opzioni in tutta l'applicazione (il modulo e' globale).
 */
export const LIMITI_GLOBALI: ThrottlerOptions[] = [
  { name: 'short', ttl: 1000, limit: 10 }, // 10 richieste al secondo
  { name: 'medium', ttl: 60_000, limit: 100 }, // 100 richieste al minuto
  { name: 'long', ttl: 900_000, limit: 1000 }, // 1000 richieste ogni 15 minuti
]
