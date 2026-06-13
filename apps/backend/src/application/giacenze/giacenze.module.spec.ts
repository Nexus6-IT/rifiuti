import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { GiacenzeModule } from './giacenze.module'
import { GiacenzeService } from './giacenze.service'
import { GiacenzeController } from './giacenze.controller'

describe('GiacenzeModule (DI wiring)', () => {
  it('risolve GiacenzeService e GiacenzeController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), GiacenzeModule],
    }).compile()

    expect(moduleRef.get(GiacenzeService)).toBeDefined()
    expect(moduleRef.get(GiacenzeController)).toBeDefined()

    await moduleRef.close()
  })
})
