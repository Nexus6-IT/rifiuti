import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { RegistroModule } from '../../api/registro/registro.module'
import { RegistryModule } from '../../api/registry/registry.module'
import { RentriSyncModule } from '../../application/rentri/rentri-sync.module'
import { RuoloEffettivoModule } from '../../api/me/ruolo-effettivo.module'
import { RolesGuard } from './roles.guard'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'

/**
 * Wiring DI di `RolesGuard`: il guard dipende da `RuoloEffettivoService`, e un modulo che lo
 * usa senza poterlo risolvere impedisce l'avvio del backend (difetto della F2-1, visto solo in
 * CI). Compila moduli reali che usano il guard, con `RuoloEffettivoModule` globale come in
 * `AppModule`, e risolve il guard.
 */
describe('RolesGuard (DI wiring)', () => {
  it.each([
    ['RegistryModule (non importa RuoloEffettivoModule: serve il globale)', RegistryModule],
    ['RegistroModule', RegistroModule],
    ['RentriSyncModule', RentriSyncModule],
  ])('%s risolve RolesGuard con la DI di Nest', async (_nome, modulo) => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        RuoloEffettivoModule,
        modulo,
      ],
    }).compile()

    expect(moduleRef.get(RolesGuard, { strict: false })).toBeDefined()
    expect(moduleRef.get(RuoloEffettivoService, { strict: false })).toBeDefined()

    await moduleRef.close()
  })
})
