import { Injectable } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'

/** Finestra del limite del webhook SDI: un minuto. */
export const FINESTRA_LIMITE_WEBHOOK_SDI_MS = 60_000
/** Richieste al minuto per IP del chiamante. Un provider manda pochi eventi al secondo: il tetto e' largo ma finito. */
export const LIMITE_WEBHOOK_SDI = 300

/** `@LimiteWebhookSdi()` sulla rotta del webhook. */
export const LimiteWebhookSdi = (): MethodDecorator & ClassDecorator =>
  Throttle({ default: { limit: LIMITE_WEBHOOK_SDI, ttl: FINESTRA_LIMITE_WEBHOOK_SDI_MS } })

/**
 * Limite di frequenza della rotta pubblica del webhook SDI, per IP (dietro nginx `req.ip` e' l'IP del
 * chiamante: `trust proxy` e' impostato in `main.ts`). Come `ThrottlerAgenteGuard` usa un solo
 * limitatore, `default`, che il `ThrottlerGuard` globale non conosce: il controller dichiara
 * `@SkipThrottle({ short, medium, long })` per escludere il globale. Il token NON e' la chiave del
 * contatore: un attaccante che prova token a caso creerebbe una voce in memoria per ciascuno.
 * Lo storage e' in memoria: con piu' processi `backend` va spostato su Redis.
 */
@Injectable()
export class ThrottlerWebhookSdiGuard extends ThrottlerGuard {
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit()
    this.throttlers = [
      { name: 'default', ttl: FINESTRA_LIMITE_WEBHOOK_SDI_MS, limit: LIMITE_WEBHOOK_SDI },
    ]
  }

  // firma imposta dalla classe base (`Record<string, any>`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    return `sdi-webhook:${(req as { ip?: string }).ip ?? 'ignoto'}`
  }
}
