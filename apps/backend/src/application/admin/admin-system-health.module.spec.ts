import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { BullModule } from '@nestjs/bullmq'
import { ScheduleModule } from '@nestjs/schedule'
import type { Queue } from 'bullmq'

import { AdminSystemHealthModule } from './admin-system-health.module'
import { SystemHealthController } from '../../api/admin/system-health.controller'
import { SystemHealthService, CODE_SYSTEM_HEALTH } from './system-health/system-health.service'
import { JobActionsService } from './system-health/job-actions.service'
import { EvidenzeDbService } from './system-health/evidenze-db.service'
import { CODE_ATTESE } from './system-health/probes/code.probe'

/**
 * DI smoke test per AdminSystemHealthModule — stesso metodo di
 * `permissions.module.spec.ts`: `.compile()` risolve l'intero grafo senza
 * invocare `onModuleInit`, quindi non apre connessioni reali a Redis o
 * Postgres. Serve a intercettare qui, non al primo avvio in produzione,
 * l'errore di cablaggio piu' probabile di questo modulo: i job rilanciabili
 * arrivano da altri moduli e devono essere ESPORTATI da quelli (v. commento
 * nel modulo: riprovvederli qui raddoppierebbe i `@Cron`).
 */
describe('AdminSystemHealthModule (DI wiring)', () => {
  // Il grafo include AuthModule (RedisService) e le code BullMQ: entrambi
  // aprono una connessione ioredis reale nel costruttore, non in
  // onModuleInit. Senza chiuderle il client resta a riprovare la connessione
  // all'infinito (retryStrategy sempre attivo) e il processo jest non esce
  // mai da solo — da qui il tracciamento per chiuderle in afterEach.
  const moduliCreati: Array<{ close(): Promise<void> }> = []

  async function compila() {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        EventEmitterModule.forRoot(),
        ScheduleModule.forRoot(),
        // In produzione la connessione root e' quella globale registrata da
        // PermissionsModule; qui il modulo e' isolato, quindi la si fornisce.
        BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }),
        AdminSystemHealthModule,
      ],
    }).compile()
    moduliCreati.push(moduleRef)
    return moduleRef
  }

  afterEach(async () => {
    await Promise.all(moduliCreati.splice(0).map(moduleRef => moduleRef.close()))
  })

  it('risolve controller e servizi della pagina', async () => {
    const moduleRef = await compila()

    expect(moduleRef.get(SystemHealthController)).toBeDefined()
    expect(moduleRef.get(SystemHealthService)).toBeDefined()
    expect(moduleRef.get(EvidenzeDbService)).toBeDefined()
  })

  it('risolve i job rilanciabili, che arrivano dai moduli che li esportano', async () => {
    const moduleRef = await compila()
    const azioni = moduleRef.get(JobActionsService)

    expect(azioni.chiaviDisponibili()).toEqual([
      'rentri-riconciliazione',
      'rentri-certificato-scadenza',
      'codifiche-rentri',
      'dati-riferimento',
      'scadenzario-autorizzazioni',
    ])
  })

  it('costruisce il dizionario delle code con una voce per ogni coda attesa', async () => {
    const moduleRef = await compila()
    const code = moduleRef.get<Map<string, Queue>>(CODE_SYSTEM_HEALTH)

    expect([...code.keys()]).toEqual(CODE_ATTESE.map(c => c.nome))
    expect([...code.values()].every(Boolean)).toBe(true)
  })
})
