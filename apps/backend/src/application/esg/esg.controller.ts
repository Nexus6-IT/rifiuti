import { Controller, Get, Query, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { EsgService } from './esg.service'

/**
 * ESG Controller — report ambientale (CO₂ evitata, % recupero) dal dato RENTRI.
 */
@ApiTags('esg')
@Controller('esg')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EsgController {
  constructor(private readonly esgService: EsgService) {}

  @Get('report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Report ESG ambientale del tenant',
    description:
      'Indicatori derivati dai FIR: tasso di recupero, kg deviati da discarica e CO₂ evitata stimata. ' +
      'I fattori CO₂ sono indicativi (vedi emission-factors).',
  })
  @ApiResponse({ status: 200, description: 'Report ESG' })
  async getReport(
    @Req() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.esgService.getEnvironmentalReport(requireRequestTenantId(req), {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    })
  }
}
