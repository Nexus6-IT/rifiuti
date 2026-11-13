import {
  Body,
  Controller,
  ForbiddenException,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { AgentiPesaService } from '../../application/pese/agenti/agenti-pesa.service'
import { LetturePesaService } from '../../application/pese/agenti/letture-pesa.service'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { MotivoDto } from './dto/accesso.dto'
import { AssegnaAgenteDto, CreaAgenteDto, ElencoLettureQueryDto } from './dto/agente-pesa.dto'
import { comeHttpPese } from './errori-http'
import { RUOLI_OPERATORE_PESA, RUOLI_RESPONSABILE_PESA } from './ruoli-pesa'

/**
 * Agenti di pesa e letture dello strumento (4.8b, D15). JWT, azienda SELEZIONATA, ruolo EFFETTIVO:
 * la gestione (crea, codice, revoca, assegnazione) e' degli amministratori; l'elenco degli agenti e'
 * aperto a chi ha accesso all'azienda (nome host e IP solo agli amministratori, N4); le letture
 * le vede chi opera sulle pese.
 */
@ApiTags('pese')
@Controller('pese')
@RichiedeModulo('pese')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AgentiPesaController {
  constructor(
    private readonly agenti: AgentiPesaService,
    private readonly letture: LetturePesaService,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get('agenti')
  @ApiOperation({ summary: 'Agenti di pesa dell’azienda, con stato e strumenti' })
  async elenca(@Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    const puoGestire = RUOLI_RESPONSABILE_PESA.includes(ruolo)
    const righe = await comeHttpPese(() =>
      this.agenti.elenca(tenantId, { vediDatiTecnici: puoGestire })
    )
    return { righe, puoGestire }
  }

  @Post('agenti')
  @ApiOperation({
    summary: 'Crea un agente: restituisce il codice di abbinamento UNA volta (amministratori)',
  })
  async crea(@Req() req: any, @Body() dto: CreaAgenteDto) {
    const tenantId = requireRequestTenantId(req)
    await this.richiedi(req, tenantId, RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI')
    return comeHttpPese(() => this.agenti.crea(tenantId, req.user.id, dto))
  }

  @Post('agenti/:id/codice')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Nuovo codice di abbinamento, solo per un agente in attesa (amministratori)',
  })
  async nuovoCodice(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    await this.richiedi(req, tenantId, RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI')
    return comeHttpPese(() => this.agenti.nuovoCodice(tenantId, req.user.id, id))
  }

  @Post('agenti/:id/revoca')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoca un agente, con motivo (amministratori)' })
  async revoca(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MotivoDto) {
    const tenantId = requireRequestTenantId(req)
    await this.richiedi(req, tenantId, RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI')
    return comeHttpPese(() => this.agenti.revoca(tenantId, req.user.id, id, dto.motivo))
  }

  @Put('strumenti/:id/agente')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assegna uno strumento a un agente, o lo libera con null (amministratori)',
  })
  async assegna(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssegnaAgenteDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiedi(req, tenantId, RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI')
    return comeHttpPese(() => this.agenti.assegnaStrumento(tenantId, req.user.id, id, dto.agenteId))
  }

  @Get('letture')
  @ApiOperation({
    summary: 'Letture arrivate dagli agenti (più recenti prima, al massimo 50)',
    description: 'Default: ultime 24 ore e solo non usate. Operatori.',
  })
  async elencaLetture(@Req() req: any, @Query() q: ElencoLettureQueryDto) {
    const tenantId = requireRequestTenantId(req)
    await this.richiedi(req, tenantId, RUOLI_OPERATORE_PESA, 'OPERATORI')
    const righe = await comeHttpPese(() =>
      this.letture.elenca(tenantId, {
        registroId: q.registroId,
        strumentoId: q.strumentoId,
        libere: q.libere,
        dal: q.dal ? new Date(q.dal) : undefined,
      })
    )
    return { righe }
  }

  private async richiedi(
    req: any,
    tenantId: string,
    ammessi: readonly RuoloApplicativo[],
    chi: 'OPERATORI' | 'AMMINISTRATORI'
  ): Promise<RuoloApplicativo> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (ammessi.includes(ruolo)) return ruolo
    throw new ForbiddenException({
      message:
        chi === 'AMMINISTRATORI'
          ? "Solo un amministratore dell'azienda può eseguire questa operazione sulle pese."
          : "Il tuo ruolo nell'azienda selezionata non consente di operare sulle pese.",
      error: `PESE_RISERVATE_${chi}`,
    })
  }
}
