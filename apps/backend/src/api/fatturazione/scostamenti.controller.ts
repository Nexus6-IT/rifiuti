/**
 * Scostamenti dopo la fattura e presa d'atto (4.4b1, §5.7, §11-§12). Il controller non ha prefisso:
 * `GET /scostamenti-fattura` e `POST /legami-movimento/:id/presa-atto-scostamento`. La presa
 * d'atto e` degli amministratori (Q31); il 403 per OPERATOR e VIEWER sta qui, non nel servizio.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ScostamentiService } from '../../application/fatturazione/scostamenti.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ListaScostamentiQueryDto } from './dto/lista-scostamenti.dto'
import { LegameParamDto, PresaAttoDto } from './dto/presa-atto.dto'
import { RUOLI_AMMINISTRATORI, RUOLI_LETTURA } from './ruoli'

@ApiTags('fatturazione')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScostamentiController {
  constructor(private readonly scostamenti: ScostamentiService) {}

  @Get('scostamenti-fattura')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Legami fatturati con uno scostamento ancora aperto' })
  lista(@Req() req: any, @Query() q: ListaScostamentiQueryDto) {
    return this.scostamenti.lista(requireRequestTenantId(req), {
      pagina: q.pagina,
      dimensione: q.dimensione,
      ...(q.clienteId !== undefined ? { clienteId: q.clienteId } : {}),
    })
  }

  @Post('legami-movimento/:id/presa-atto-scostamento')
  @HttpCode(200)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Chiude lo scostamento senza documento (decisione 1)' })
  @ApiResponse({
    status: 409,
    description: 'SCOSTAMENTO_NON_APERTO, VERSIONE_SUPERATA, OPERAZIONE_CONCORRENTE',
  })
  presaAtto(@Req() req: any, @Param() p: LegameParamDto, @Body() dto: PresaAttoDto) {
    return this.scostamenti.presaAtto(requireRequestTenantId(req), req.user.id, p.id, {
      nota: dto.nota,
      versione: dto.versione,
    })
  }
}
