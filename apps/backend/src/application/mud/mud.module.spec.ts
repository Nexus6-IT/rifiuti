import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { MUDModule } from './mud.module'
import { MUDGeneratorService } from './mud-generator.service'
import { MudExportService } from './export/mud-export.service'
import { MudController } from '../../api/mud/mud.controller'

describe('MUDModule (DI wiring)', () => {
  it('risolve generator, export service e controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), MUDModule],
    }).compile()

    expect(moduleRef.get(MUDGeneratorService)).toBeDefined()
    expect(moduleRef.get(MudExportService)).toBeDefined()
    expect(moduleRef.get(MudController)).toBeDefined()

    await moduleRef.close()
  })
})
