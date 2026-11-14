/**
 * Limiti di frequenza con i DUE moduli insieme: la configurazione globale di `AppModule`
 * (`LIMITI_GLOBALI`, short/medium/long) e l'ingresso dell'agente (`AgentiPesaIngressoModule`).
 * Un secondo `ThrottlerModule.forRoot` nell'ingresso sostituiva i limiti di TUTTA l'API (review
 * finale 4.8b, I1): questo spec lo avrebbe intercettato, perche' compila entrambi i moduli.
 */
import { Controller, Get, Module, Post, type INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { ModuliAttiviModule } from '../../application/admin/moduli-attivi.module'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { BattitoAgenteService } from '../../application/pese/agenti/battito-agente.service'
import { RisoluzioneAgenteService } from '../../application/pese/agenti/risoluzione-agente.service'
import { hashSegreto } from '../../domain/pese/agenti/credenziali-agente'
import { LIMITI_GLOBALI } from '../../core/http/limiti-globali'
import { valoreTrustProxy } from '../../core/http/trust-proxy'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { AgentiPesaIngressoModule } from './agenti-pesa-ingresso.module'

const TOKEN = `wfpa_${'A'.repeat(43)}`

/** Come `access-request.controller.ts`: limite specifico `medium` a 5 al minuto. */
@Controller('prova')
class ProvaController {
  @Get('ordinaria')
  ordinaria() {
    return { ok: true }
  }

  @Post('stretta')
  @Throttle({ medium: { ttl: 60_000, limit: 5 } })
  stretta() {
    return { ok: true }
  }
}

@Module({ controllers: [ProvaController] })
class ProvaModule {}

@Module({
  providers: [{ provide: ModuliAttiviService, useValue: { moduliAttivi: async () => ['pese'] } }],
  exports: [ModuliAttiviService],
})
class ModuliAttiviFinto {}

@Module({ providers: [{ provide: PrismaService, useValue: {} }], exports: [PrismaService] })
class PrismaFinto {}

describe('limiti di frequenza: globali e ingresso agente insieme', () => {
  let app: INestApplication

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(LIMITI_GLOBALI), ProvaModule, AgentiPesaIngressoModule],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideModule(ModuliAttiviModule)
      .useModule(ModuliAttiviFinto)
      .overrideModule(PrismaModule)
      .useModule(PrismaFinto)
      .overrideProvider(BattitoAgenteService)
      .useValue({
        registra: async () => ({ oraServer: 'x', simulazioneAmmessa: false, revocato: false }),
      })
      .overrideProvider(RisoluzioneAgenteService)
      .useValue({
        daToken: async (h: string) =>
          h === hashSegreto(TOKEN) ? { id: 'ag-1', tenantId: 't-1', stato: 'ATTIVO' } : null,
      })
      .compile()
    app = moduleRef.createNestApplication()
    app.getHttpAdapter().getInstance().set('trust proxy', valoreTrustProxy(undefined))
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())

  it('una rotta ordinaria ha i limiti globali short/medium/long', async () => {
    const r = await http().get('/prova/ordinaria').expect(200)
    expect(r.headers['x-ratelimit-limit-short']).toBe('10')
    expect(r.headers['x-ratelimit-limit-medium']).toBe('100')
    expect(r.headers['x-ratelimit-limit-long']).toBe('1000')
  })

  it('il limite specifico medium=5 (richiesta di accesso) resta attivo', async () => {
    for (let i = 0; i < 5; i++) await http().post('/prova/stretta').expect(201)
    await http().post('/prova/stretta').expect(429)
  })

  it('il globale short (10/s) resta attivo sulle rotte ordinarie', async () => {
    for (let i = 0; i < 10; i++) await http().get('/prova/ordinaria').expect(200)
    await http().get('/prova/ordinaria').expect(429)
  })

  it('l’ingresso agente: battito 10/min per agente e senza i limiti globali', async () => {
    const battito = () =>
      http().post('/agenti-pesa/battito').set('Authorization', `Bearer ${TOKEN}`).send({})
    const prima = await battito()
    expect(prima.headers['x-ratelimit-limit-short']).toBeUndefined()
    expect(prima.headers['x-ratelimit-limit-medium']).toBeUndefined()
    // il limite dell'agente è il proprio: dopo 10 battiti validi o meno, l'11° è 429
    for (let i = 0; i < 9; i++) await battito()
    const oltre = await battito()
    expect(oltre.status).toBe(429)
    expect(oltre.headers['retry-after']).toBeDefined()
  })

  it('l’ingresso agente non altera i limiti globali dopo che il suo limite è scattato', async () => {
    const r = await http().get('/prova/ordinaria').expect(200)
    expect(r.headers['x-ratelimit-limit-medium']).toBe('100')
  })
})
