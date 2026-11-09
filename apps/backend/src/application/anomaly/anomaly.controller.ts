import { Controller, Get, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { AnomalyDetectionService } from './anomaly-detection.service'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

/**
 * Anomaly Controller — rilevamento anomalie nei FIR/movimenti del tenant.
 */
@ApiTags('anomaly')
@Controller('anomaly')
@RichiedeModulo('anomalie')
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
  async detect(@Req() req: any) {
    return this.anomalyService.detectAnomalies(requireRequestTenantId(req))
  }
}
