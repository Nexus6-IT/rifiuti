import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { AutistiService } from '../../application/campo/autisti.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { richiediRuoloEffettivo } from '../me/richiedi-ruolo-effettivo'
import { RUOLI_SCRITTURA_RITIRI } from '../ritiri/ruoli-ritiri'
import { AutistaDto } from './dto/autista.dto'
import { ElencoAutistiQueryDto } from './dto/campo.dto'
import { comeHttpCampo } from './errori-http'

/**
 * Anagrafica degli autisti (app campo, P1). Azienda SELEZIONATA, scrittura sul ruolo EFFETTIVO
 * (SUPER_ADMIN, ADMIN, OPERATOR come i ritiri), lettura di tutti i ruoli d'ufficio. Si legge anche
 * con il solo modulo `ritiri` (scelta dell'autista nel ritiro). Un utente `AUTISTA` non entra:
 * `RuoloAutistaInterceptor` lo respinge prima.
 */
@ApiTags('autisti')
@Controller('autisti')
@RichiedeModulo('ritiri', 'campo')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AutistiController {
  constructor(
    private readonly autisti: AutistiService,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Autisti dell’azienda (`attivi=true` per i soli attivi)' })
  async elenca(@Req() req: any, @Query() query: ElencoAutistiQueryDto) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    const righe = await comeHttpCampo(() =>
      this.autisti.elenca(tenantId, { soloAttivi: query.attivi === 'true' })
    )
    // `puoOperare` lo dice il backend (come per le pese): il frontend non deduce i permessi.
    return { righe, puoOperare: RUOLI_SCRITTURA_RITIRI.includes(ruolo) }
  }

  @Post()
  @ApiOperation({ summary: 'Crea un autista (operatori)' })
  @ApiResponse({ status: 409, description: 'AUTISTA_DUPLICATO' })
  async crea(@Req() req: any, @Body() dto: AutistaDto) {
    const tenantId = requireRequestTenantId(req)
    await richiediRuoloEffettivo(this.membership, req.user, tenantId, RUOLI_SCRITTURA_RITIRI)
    return comeHttpCampo(() => this.autisti.crea(tenantId, req.user.id, dto))
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aggiorna o disattiva un autista (operatori)' })
  async aggiorna(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AutistaDto) {
    const tenantId = requireRequestTenantId(req)
    await richiediRuoloEffettivo(this.membership, req.user, tenantId, RUOLI_SCRITTURA_RITIRI)
    return comeHttpCampo(() => this.autisti.aggiorna(tenantId, id, dto))
  }
}
