import { Injectable } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler'

export const FINESTRA_ABBINAMENTO_MS = 60_000
/** Tentativi al minuto per IP (D10). */
export const LIMITE_ABBINAMENTO_PER_IP = 10
/** Tentativi al minuto per l'intera rotta (D10): rete di sicurezza se `trust proxy` fosse mal configurato. */
export const LIMITE_ABBINAMENTO_GLOBALE = 30

/**
 * Limite di frequenza di `POST /agenti-pesa/abbinamento` (D10): per IP **e** globale della rotta.
 * Il codice ha 60 bit e vive 15 minuti: con 30 tentativi al minuto la forza bruta non e' praticabile.
 * Sostituisce il limite globale per IP (il controller dichiara `@SkipThrottle` di short/medium/long).
 * Lo storage e' in memoria: con piu' processi `backend` va spostato su Redis (rischio R6).
 */
@Injectable()
export class ThrottlerAbbinamentoGuard extends ThrottlerGuard {
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit()
    this.throttlers = [
      {
        name: 'abbinamentoIp',
        ttl: FINESTRA_ABBINAMENTO_MS,
        limit: LIMITE_ABBINAMENTO_PER_IP,
        getTracker: (req: Record<string, unknown>) =>
          `ip:${(req.ip as string | undefined) ?? 'ignoto'}`,
      },
      {
        name: 'abbinamentoGlobale',
        ttl: FINESTRA_ABBINAMENTO_MS,
        limit: LIMITE_ABBINAMENTO_GLOBALE,
        getTracker: () => 'rotta',
      },
    ]
  }

  /** Un solo `Retry-After`, senza il suffisso del nome del limitatore (lo legge l'agente). */
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail
  ): Promise<void> {
    context.switchToHttp().getResponse().header('Retry-After', detail.timeToBlockExpire)
    await super.throwThrottlingException(context, detail)
  }
}
