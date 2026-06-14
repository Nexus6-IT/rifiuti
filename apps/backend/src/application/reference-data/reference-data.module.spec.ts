import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { ReferenceDataModule } from './reference-data.module'
import { ReferenceDataService } from './reference-data.service'
import { ReferenceDataSeederService } from './reference-data-seeder.service'
import { ReferenceDataController } from './reference-data.controller'

describe('ReferenceDataModule (DI wiring)', () => {
  it('risolve service, seeder e controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ReferenceDataModule],
    }).compile()

    expect(moduleRef.get(ReferenceDataService)).toBeDefined()
    expect(moduleRef.get(ReferenceDataSeederService)).toBeDefined()
    expect(moduleRef.get(ReferenceDataController)).toBeDefined()

    await moduleRef.close()
  })
})
