/**
 * Health Controller - TDD Tests
 */

import { Test, TestingModule } from '@nestjs/testing'
import { HealthController } from './health.controller'

describe('HealthController', () => {
  let controller: HealthController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile()

    controller = module.get<HealthController>(HealthController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  describe('check', () => {
    it('should return health status OK', () => {
      const result = controller.check()

      expect(result.status).toBe('ok')
      expect(result.timestamp).toBeDefined()
      expect(result.service).toBe('wasteflow-backend')
      expect(result.version).toBeDefined()
    })

    it('should return ISO timestamp', () => {
      const result = controller.check()
      const timestamp = new Date(result.timestamp)

      expect(timestamp).toBeInstanceOf(Date)
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now())
    })
  })
})
