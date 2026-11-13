import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler'
import { FINESTRA_LIMITE_AGENTE_MS, ThrottlerAgenteGuard } from './throttler-agente.guard'

class Pannello {
  letture() {
    return undefined
  }
}

function contesto(req: Record<string, unknown>, res: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => Pannello.prototype.letture,
    getClass: () => Pannello,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getType: () => 'http',
  } as unknown as ExecutionContext
}

describe('ThrottlerAgenteGuard', () => {
  let guard: ThrottlerAgenteGuard
  let storage: ThrottlerStorageService
  let intestazioni: Record<string, unknown>
  const res = () => ({
    header: (k: string, v: unknown) => {
      intestazioni[k] = v
    },
  })
  const riga = (agenteId: string | undefined, ip = '10.0.0.1') => ({
    ip,
    agentePesa: agenteId ? { id: agenteId, tenantId: 't' } : undefined,
    headers: {},
  })

  beforeEach(async () => {
    intestazioni = {}
    storage = new ThrottlerStorageService()
    // Opzioni del modulo globale (short/medium/long): il guard dell'agente le ignora.
    guard = new ThrottlerAgenteGuard(
      [
        { name: 'short', ttl: 1000, limit: 10 },
        { name: 'medium', ttl: 60_000, limit: 100 },
      ],
      storage,
      new Reflector()
    )
    await guard.onModuleInit()
  })

  afterEach(() => storage.onApplicationShutdown())

  it('il tracker e legato all’agente, non all’IP', async () => {
    const t = await (guard as unknown as { getTracker(r: unknown): Promise<string> }).getTracker(
      riga('a1')
    )
    expect(t).toBe('agente:a1')
  })

  it('due agenti dietro lo stesso IP hanno contatori separati', async () => {
    // 60 richieste dell'agente a1 (limite di default), la 61a e respinta; a2 passa ancora
    for (let i = 0; i < 60; i++) {
      await expect(guard.canActivate(contesto(riga('a1'), res()))).resolves.toBe(true)
    }
    await expect(guard.canActivate(contesto(riga('a1'), res()))).rejects.toBeInstanceOf(
      ThrottlerException
    )
    await expect(guard.canActivate(contesto(riga('a2'), res()))).resolves.toBe(true)
  })

  it('un 429 porta l’intestazione Retry-After', async () => {
    for (let i = 0; i < 60; i++) await guard.canActivate(contesto(riga('a1'), res()))
    await expect(guard.canActivate(contesto(riga('a1'), res()))).rejects.toBeInstanceOf(
      ThrottlerException
    )
    expect(intestazioni).toHaveProperty('Retry-After')
  })

  it('il limite si fissa per rotta con @LimiteAgente e vale per agente', async () => {
    class ConLimite {
      battito() {
        return undefined
      }
    }
    const { LimiteAgente } = await import('./throttler-agente.guard')
    const descrittore = Object.getOwnPropertyDescriptor(ConLimite.prototype, 'battito')!
    LimiteAgente(3)(ConLimite.prototype, 'battito', descrittore)
    const ctx = (r: Record<string, unknown>) =>
      ({
        getHandler: () => ConLimite.prototype.battito,
        getClass: () => ConLimite,
        switchToHttp: () => ({ getRequest: () => r, getResponse: () => res() }),
        getType: () => 'http',
      }) as unknown as ExecutionContext
    for (let i = 0; i < 3; i++) await expect(guard.canActivate(ctx(riga('a1')))).resolves.toBe(true)
    await expect(guard.canActivate(ctx(riga('a1')))).rejects.toBeInstanceOf(ThrottlerException)
    await expect(guard.canActivate(ctx(riga('a2')))).resolves.toBe(true)
  })

  it('anche se il controller salta short/medium/long (SkipThrottle), il limite dell’agente resta', async () => {
    // Il `@SkipThrottle({short,medium,long})` del controller toglie il guard globale (per IP) ma non questo.
    const riflettore = new Reflector()
    jest
      .spyOn(riflettore, 'getAllAndOverride')
      .mockImplementation((chiave: unknown) =>
        typeof chiave === 'string' && /SKIP(short|medium|long)$/.test(chiave) ? true : undefined
      )
    const g = new ThrottlerAgenteGuard(
      [{ name: 'short', ttl: 1000, limit: 10 }],
      storage,
      riflettore
    )
    await g.onModuleInit()
    for (let i = 0; i < 60; i++) await g.canActivate(contesto(riga('a9'), res()))
    await expect(g.canActivate(contesto(riga('a9'), res()))).rejects.toBeInstanceOf(
      ThrottlerException
    )
  })

  it('senza agente (guard in ordine sbagliato) il contatore e per IP, non condiviso', async () => {
    const t = await (guard as unknown as { getTracker(r: unknown): Promise<string> }).getTracker(
      riga(undefined, '1.2.3.4')
    )
    expect(t).toBe('ip:1.2.3.4')
  })

  it('la finestra e di un minuto', () => {
    expect(FINESTRA_LIMITE_AGENTE_MS).toBe(60_000)
  })
})
