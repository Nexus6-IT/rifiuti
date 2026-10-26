import { Controller, Get, Query, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { GiacenzeService } from './giacenze.service'
import { GiacenzeQueryDto } from './giacenze-query.dto'

/**
 * Giacenze Controller — giacenze per CER e alert di deposito temporaneo.
 */
@ApiTags('giacenze')
@Controller('giacenze')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GiacenzeController {
  constructor(private readonly giacenzeService: GiacenzeService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Giacenze correnti per CER (carico - scarico)' })
  @ApiResponse({ status: 200, description: 'Elenco giacenze per CER' })
  async getGiacenze(@Req() req: any, @Query() query: GiacenzeQueryDto) {
    // Azienda selezionata (X-Tenant-ID), non il tenant del token: con la RLS l'altra darebbe vuoto.
    return this.giacenzeService.getGiacenze(requireRequestTenantId(req), query.registroId)
  }

  @Get('deposito-temporaneo/alerts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Alert di superamento limiti deposito temporaneo',
    description:
      'Segnala i CER in giacenza oltre la soglia temporale e/o quantitativa. ' +
      'Soglie configurabili (vedi deposito-temporaneo.config) — il limite legale è volumetrico.',
  })
  @ApiResponse({ status: 200, description: 'Alert deposito temporaneo' })
  async getDepositoTemporaneoAlerts(@Req() req: any, @Query() query: GiacenzeQueryDto) {
    return this.giacenzeService.getDepositoTemporaneoAlerts(
      requireRequestTenantId(req),
      undefined,
      undefined,
      query.registroId
    )
  }
}
