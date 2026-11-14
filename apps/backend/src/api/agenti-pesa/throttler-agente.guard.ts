import { Injectable } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import type { RichiestaConAgente } from './agente-richiesta'

/** Finestra dei limiti dell'agente: un minuto. */
export const FINESTRA_LIMITE_AGENTE_MS = 60_000

/** Richieste al minuto per rotta dell'agente (D10). */
export const LIMITI_AGENTE = { letture: 60, battito: 10, configurazione: 10 } as const

/** `@LimiteAgente(60)` su una rotta: N richieste al minuto PER AGENTE. */
export const LimiteAgente = (limite: number): MethodDecorator & ClassDecorator =>
  Throttle({ default: { limit: limite, ttl: FINESTRA_LIMITE_AGENTE_MS } })

/**
 * Limite di frequenza PER AGENTE (D10), da usare DOPO `AgentePesaGuard`:
 * `@UseGuards(AgentePesaGuard, ThrottlerAgenteGuard)`. Dietro nginx `req.ip` e' l'indirizzo del
 * proxy, quindi un limite per IP sarebbe globale: il contatore e' legato all'id dell'agente.
 *
 * Usa un solo limitatore, `default`, che il `ThrottlerGuard` globale (`short`/`medium`/`long`) non
 * conosce: il controller dell'agente dichiara `@SkipThrottle({ short: true, medium: true, long: true })`
 * per escludere il globale (per IP) e `@LimiteAgente(n)` sulle rotte per fissare il proprio limite.
 * Con `Throttle({ default })` l'intestazione di un 429 e' `Retry-After`. Lo storage e' in memoria:
 * con piu' processi `backend` va spostato su Redis (rischio R6).
 */
@Injectable()
export class ThrottlerAgenteGuard extends ThrottlerGuard {
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit()
    this.throttlers = [
      { name: 'default', ttl: FINESTRA_LIMITE_AGENTE_MS, limit: LIMITI_AGENTE.letture },
    ]
  }

  // firma imposta dalla classe base (`Record<string, any>`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const r = req as Pick<RichiestaConAgente, 'agentePesa' | 'ip'>
    // Senza agente (guard in ordine sbagliato) si ripiega sull'IP: mai un contatore condiviso fra tutti.
    return r.agentePesa ? `agente:${r.agentePesa.id}` : `ip:${r.ip ?? 'ignoto'}`
  }
}
