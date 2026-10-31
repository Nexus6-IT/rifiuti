import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { AbbinamentiModule } from './abbinamenti.module'
import { AbbinamentiService } from './abbinamenti.service'
import { AbbinamentiController } from './abbinamenti.controller'
import { RegistriService } from '../registro/registri.service'

describe('AbbinamentiModule (DI wiring)', () => {
  it('risolve servizio, controller e RegistriService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AbbinamentiModule],
    }).compile()
    expect(moduleRef.get(AbbinamentiService)).toBeDefined()
    expect(moduleRef.get(AbbinamentiController)).toBeDefined()
    expect(moduleRef.get(RegistriService, { strict: false })).toBeDefined()
    await moduleRef.close()
  })
})
