import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { EsgModule } from './esg.module'
import { EsgService } from './esg.service'
import { EsgController } from './esg.controller'

/**
 * DI smoke test per EsgModule (cablato in AppModule). `.compile()` risolve il
 * grafo DI senza lifecycle hooks → nessuna connessione reale.
 */
describe('EsgModule (DI wiring)', () => {
  it('risolve EsgService e EsgController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), EsgModule],
    }).compile()

    expect(moduleRef.get(EsgService)).toBeDefined()
    expect(moduleRef.get(EsgController)).toBeDefined()

    await moduleRef.close()
  })
})
