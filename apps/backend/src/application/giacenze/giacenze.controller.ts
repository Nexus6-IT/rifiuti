import { Controller, Get, UseGuards, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { GiacenzeService } from './giacenze.service'

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
  async getGiacenze(@CurrentUser() user: CurrentUserPayload) {
    return this.giacenzeService.getGiacenze(user.tenantId)
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
  async getDepositoTemporaneoAlerts(@CurrentUser() user: CurrentUserPayload) {
    return this.giacenzeService.getDepositoTemporaneoAlerts(user.tenantId)
  }
}
