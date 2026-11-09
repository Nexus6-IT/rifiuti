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
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { RUOLI_AMMINISTRATIVI, richiediRuoloEffettivo } from '../me/richiedi-ruolo-effettivo'
import { ImpostaDefinitiveDto, ImpostaFatturazioneDto } from './dto/impostazione-fatturazione.dto'
import { RUOLI_LETTURA, RUOLI_AMMINISTRATORI } from './ruoli'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

@ApiTags('legami-movimento')
@ApiBearerAuth()
@Controller('impostazioni-fatturazione')
@RichiedeModulo('contratti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImpostazioniFatturazioneController {
  constructor(
    private readonly impostazioni: ImpostazioniFatturazioneService,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Legge «fatturazione da» dell’azienda' })
  leggi(@Req() req: any) {
    return this.impostazioni.leggi(requireRequestTenantId(req))
  }

  @Put()
  @Roles(...RUOLI_AMMINISTRATORI)
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

  /**
   * Interruttore delle definitive (4.4c, decisione 13). Oltre a `@Roles` (ruolo del token) si
   * controlla il ruolo EFFETTIVO nell'azienda selezionata: un consulente ADMIN del proprio studio
   * non accende le definitive dell'azienda di un cliente dove e' solo CONSULTANT.
   */
  @Put('definitive')
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Accende o spegne le definitive dell’azienda' })
  @ApiResponse({ status: 409, description: 'VERSIONE_SUPERATA o OPERAZIONE_CONCORRENTE' })
  async impostaDefinitive(@Req() req: any, @Body() dto: ImpostaDefinitiveDto) {
    const tenantId = requireRequestTenantId(req)
    await richiediRuoloEffettivo(this.membership, req.user, tenantId, RUOLI_AMMINISTRATIVI)
    return this.impostazioni.impostaDefinitive(tenantId, req.user.id, dto)
  }
}
