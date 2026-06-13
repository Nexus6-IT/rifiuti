import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { AnomalyModule } from './anomaly.module'
import { AnomalyDetectionService } from './anomaly-detection.service'
import { AnomalyController } from './anomaly.controller'

describe('AnomalyModule (DI wiring)', () => {
  it('risolve AnomalyDetectionService e AnomalyController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AnomalyModule],
    }).compile()

    expect(moduleRef.get(AnomalyDetectionService)).toBeDefined()
    expect(moduleRef.get(AnomalyController)).toBeDefined()

    await moduleRef.close()
  })
})
