/**
 * Health Check Controller
 * Used by AWS ALB for health checks
 */

import { Controller, Get } from '@nestjs/common'

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'wasteflow-backend',
      version: '0.1.0',
    }
  }
}
