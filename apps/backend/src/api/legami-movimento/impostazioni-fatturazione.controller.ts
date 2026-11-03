/**
 * «Fatturazione da» dell'azienda (4.3, decisione 11, §4.9). Azienda SELEZIONATA
 * (`requireRequestTenantId`); `@Roles` esplicito su ogni rotta: lettura a tutti i ruoli, scrittura
 * solo ad ADMIN e SUPER_ADMIN (§9).
 */
import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ImpostazioniFatturazioneService } from '../../application/legami-movimento/impostazioni-fatturazione.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ImpostaFatturazioneDto } from './dto/impostazione-fatturazione.dto'
import { RUOLI_LETTURA, RUOLI_VARIAZIONI } from './ruoli'

@ApiTags('legami-movimento')
@ApiBearerAuth()
@Controller('impostazioni-fatturazione')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImpostazioniFatturazioneController {
  constructor(private readonly impostazioni: ImpostazioniFatturazioneService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Legge «fatturazione da» dell’azienda' })
  leggi(@Req() req: any) {
    return this.impostazioni.leggi(requireRequestTenantId(req))
  }

  @Put()
  @Roles(...RUOLI_VARIAZIONI)
  @ApiOperation({ summary: 'Imposta o spegne «fatturazione da»' })
  @ApiResponse({ status: 400, description: 'Data non valida (details.errori sul campo)' })
  @ApiResponse({
    status: 409,
    description:
      'CONFERMA_RICHIESTA (details.movimentiToccati), VERSIONE_SUPERATA o OPERAZIONE_CONCORRENTE',
  })
  imposta(@Req() req: any, @Body() dto: ImpostaFatturazioneDto) {
    return this.impostazioni.imposta(requireRequestTenantId(req), req.user.id, dto)
  }
}
