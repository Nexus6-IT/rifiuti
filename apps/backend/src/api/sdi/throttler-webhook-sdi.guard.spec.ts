import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler'
import { LIMITE_WEBHOOK_SDI, ThrottlerWebhookSdiGuard } from './throttler-webhook-sdi.guard'

class Rotta {
  ricevi() {
    return undefined
  }
}

const contesto = (req: Record<string, unknown>): ExecutionContext =>
  ({
    getHandler: () => Rotta.prototype.ricevi,
    getClass: () => Rotta,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ header: () => undefined }),
    }),
    getType: () => 'http',
  }) as unknown as ExecutionContext

describe('ThrottlerWebhookSdiGuard', () => {
  let guard: ThrottlerWebhookSdiGuard
  let storage: ThrottlerStorageService

  beforeEach(async () => {
    storage = new ThrottlerStorageService()
    guard = new ThrottlerWebhookSdiGuard(
      [{ name: 'short', ttl: 1000, limit: 10 }],
      storage,
      new Reflector()
    )
    await guard.onModuleInit()
  })
  afterEach(() => storage.onApplicationShutdown())

  it('il tracker e l’IP: il token non crea voci in memoria', async () => {
    const t = await (guard as unknown as { getTracker(r: unknown): Promise<string> }).getTracker({
      ip: '10.0.0.1',
      params: { token: 'x' },
    })
    expect(t).toBe('sdi-webhook:10.0.0.1')
  })

  it('oltre il limite dello stesso IP: ThrottlerException; un altro IP passa', async () => {
    const richiesta = (ip: string) => ({ ip, headers: {} })
    for (let i = 0; i < LIMITE_WEBHOOK_SDI; i++) {
      await expect(guard.canActivate(contesto(richiesta('10.0.0.1')))).resolves.toBe(true)
    }
    await expect(guard.canActivate(contesto(richiesta('10.0.0.1')))).rejects.toBeInstanceOf(
      ThrottlerException
    )
    await expect(guard.canActivate(contesto(richiesta('10.0.0.2')))).resolves.toBe(true)
  })
})
