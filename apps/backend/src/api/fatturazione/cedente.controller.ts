/**
 * Dati del cedente per la fatturazione (4.4a, §4.9). Azienda SELEZIONATA
 * (`requireRequestTenantId`); `@Roles` esplicito su ogni rotta: lettura a tutti i ruoli, scrittura
 * solo ad ADMIN e SUPER_ADMIN (§12).
 */
import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CedenteService } from '../../application/fatturazione/cedente.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ImpostaCedenteDto } from './dto/cedente.dto'
import { RUOLI_AMMINISTRATORI, RUOLI_LETTURA } from './ruoli'

@ApiTags('fatturazione')
@ApiBearerAuth()
@Controller('cedente-fatturazione')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CedenteController {
  constructor(private readonly cedente: CedenteService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Legge i dati del cedente' })
  leggi(@Req() req: any) {
    return this.cedente.leggi(requireRequestTenantId(req))
  }

  @Put()
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({
    summary:
      'Imposta i dati del cedente (sostituzione completa: i campi facoltativi omessi o null si cancellano)',
  })
  @ApiResponse({ status: 404, description: 'Registro IVA non trovato' })
  @ApiResponse({ status: 409, description: 'VERSIONE_SUPERATA o OPERAZIONE_CONCORRENTE' })
  imposta(@Req() req: any, @Body() dto: ImpostaCedenteDto) {
    return this.cedente.imposta(requireRequestTenantId(req), req.user.id, dto)
  }
}
