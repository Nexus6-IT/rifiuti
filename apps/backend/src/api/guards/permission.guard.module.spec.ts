import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { PermissionsModule } from '../permissions/permissions.module'
import { PermissionGuard } from './permission.guard'

// Nessuna connessione reale a Redis: il test verifica solo la risoluzione delle dipendenze, e un
// client vivo terrebbe aperto il processo di Jest.
jest.mock('ioredis')

/**
 * Wiring DI di `PermissionGuard`: dipende da `RuoloEffettivoService` (oltre a cache, code e
 * repository). Un modulo che lo usa senza poterlo risolvere impedisce l'avvio del backend
 * (difetto della F2-1, visto solo in CI). Compila il modulo reale che lo fornisce
 * (`PermissionsModule`), con `RuoloEffettivoModule` globale come in `AppModule`, e risolve il
 * guard. Affianca `auth/guards/roles.guard.module.spec.ts`.
 */
describe('PermissionGuard (DI wiring)', () => {
  it('PermissionsModule risolve PermissionGuard con la DI di Nest', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RuoloEffettivoModule,
        EventEmitterModule.forRoot(),
        PermissionsModule,
      ],
    }).compile()

    expect(moduleRef.get(PermissionGuard, { strict: false })).toBeDefined()
    expect(moduleRef.get(RuoloEffettivoService, { strict: false })).toBeDefined()

    // Senza `init` gli hook di chiusura di alcuni provider (Pub/Sub) lanciano: non e' quello che
    // si verifica qui.
    await moduleRef.close().catch(() => undefined)
  })
})
