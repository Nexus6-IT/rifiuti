import { Controller, Get, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { AnomalyDetectionService } from './anomaly-detection.service'

/**
 * Anomaly Controller — rilevamento anomalie nei FIR/movimenti del tenant.
 */
@ApiTags('anomaly')
@Controller('anomaly')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AnomalyController {
  constructor(private readonly anomalyService: AnomalyDetectionService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Anomalie rilevate su FIR e movimenti',
    description:
      'CER non in catalogo, quantità anomale, descrizioni mancanti, giacenze impossibili.',
  })
  @ApiResponse({ status: 200, description: 'Elenco anomalie' })
  async detect(@CurrentUser() user: CurrentUserPayload) {
    return this.anomalyService.detectAnomalies(user.tenantId)
  }
}
