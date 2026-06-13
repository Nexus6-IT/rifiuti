import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { ContractModule } from './contract.module'
import { ContractService } from './contract.service'
import { ContractController } from './contract.controller'

describe('ContractModule (DI wiring)', () => {
  it('risolve ContractService e ContractController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), ContractModule],
    }).compile()

    expect(moduleRef.get(ContractService)).toBeDefined()
    expect(moduleRef.get(ContractController)).toBeDefined()

    await moduleRef.close()
  })
})
