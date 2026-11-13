import { Injectable } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler'

export const FINESTRA_INGRESSO_MS = 60_000
/**
 * Tetto per rotta, uguale per tutti i chiamanti, PRIMA dell'autenticazione (review B1-B3, I2).
 * Il limite per agente scatta solo dopo `AgentePesaGuard`: token ignoti o revocati, che costano una
 * query col client di sistema, non verrebbero mai contati. Il tracker e' costante perche' dietro
 * nginx senza `trust proxy` `req.ip` e' quello del proxy. 600/min = 10 al secondo per rotta, molto
 * sopra l'uso reale (60/min per agente su `letture`) e molto sotto un attacco di carico.
 */
export const LIMITE_INGRESSO_PER_ROTTA = 600

/** `@UseGuards(ThrottlerIngressoGuard, AgentePesaGuard, ThrottlerAgenteGuard)`: sempre per primo. */
@Injectable()
export class ThrottlerIngressoGuard extends ThrottlerGuard {
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit()
    this.throttlers = [
      {
        name: 'ingressoRotta',
        ttl: FINESTRA_INGRESSO_MS,
        limit: LIMITE_INGRESSO_PER_ROTTA,
        getTracker: () => 'rotta',
      },
    ]
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail
  ): Promise<void> {
    context.switchToHttp().getResponse().header('Retry-After', detail.timeToBlockExpire)
    await super.throwThrottlingException(context, detail)
  }
}
