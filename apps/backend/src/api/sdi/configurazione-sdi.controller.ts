/**
 * Configurazione SDI dell'azienda (4.5a). Azienda SELEZIONATA (`requireRequestTenantId`); `@Roles`
 * esplicito su ogni rotta: lettura a tutti i ruoli, scrittura solo ad ADMIN e SUPER_ADMIN, con
 * controllo del ruolo EFFETTIVO nell'azienda scelta. Le credenziali non escono mai: il token del
 * webhook si vede una volta sola (creazione e rigenerazione).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ConfigurazioneSdiService } from '../../application/sdi/configurazione-sdi.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { RUOLI_AMMINISTRATIVI, richiediRuoloEffettivo } from '../me/richiedi-ruolo-effettivo'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { RUOLI_AMMINISTRATORI, RUOLI_LETTURA } from '../legami-movimento/ruoli'
import {
  ImpostaConfigurazioneSdiDto,
  ImpostaInvioAttivoSdiDto,
  ImpostaPassoOnboardingSdiDto,
  VersioneSdiDto,
} from './dto/configurazione-sdi.dto'

@ApiTags('sdi')
@ApiBearerAuth()
@Controller('sdi/configurazione')
@RichiedeModulo('sdi')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConfigurazioneSdiController {
  constructor(
    private readonly configurazione: ConfigurazioneSdiService,
    private readonly membership: RuoloEffettivoService
  ) {}

  private async amministratore(req: any): Promise<string> {
    const tenantId = requireRequestTenantId(req)
    await richiediRuoloEffettivo(this.membership, req.user, tenantId, RUOLI_AMMINISTRATIVI)
    return tenantId
  }

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Legge la configurazione SDI dell’azienda (senza segreti)' })
  leggi(@Req() req: any) {
    return this.configurazione.leggi(requireRequestTenantId(req))
  }

  @Put()
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Crea o aggiorna la configurazione SDI' })
  @ApiResponse({
    status: 400,
    description: 'CONFIGURAZIONE_SDI_NON_VALIDA o PROVIDER_NON_DISPONIBILE',
  })
  @ApiResponse({ status: 409, description: 'VERSIONE_SUPERATA o OPERAZIONE_CONCORRENTE' })
  async imposta(@Req() req: any, @Body() dto: ImpostaConfigurazioneSdiDto) {
    return this.configurazione.imposta(await this.amministratore(req), req.user.id, dto)
  }

  @Post('verifica')
  @HttpCode(HttpStatus.OK)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Verifica la connessione con il provider (nessun invio)' })
  @ApiResponse({ status: 409, description: 'SDI_NON_CONFIGURATO o VERSIONE_SUPERATA' })
  async verifica(@Req() req: any) {
    return this.configurazione.verifica(await this.amministratore(req), req.user.id)
  }

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Rigenera il token del webhook (mostrato una sola volta)' })
  async rigeneraToken(@Req() req: any, @Body() dto: VersioneSdiDto) {
    return this.configurazione.rigeneraToken(
      await this.amministratore(req),
      req.user.id,
      dto.versione
    )
  }

  @Put('invio-attivo')
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Accende o spegne l’invio allo SDI (esige una verifica riuscita)' })
  @ApiResponse({
    status: 409,
    description: 'SDI_NON_VERIFICATO, SDI_NON_CONFIGURATO o VERSIONE_SUPERATA',
  })
  async impostaInvioAttivo(@Req() req: any, @Body() dto: ImpostaInvioAttivoSdiDto) {
    return this.configurazione.impostaInvioAttivo(await this.amministratore(req), req.user.id, dto)
  }

  @Put('onboarding')
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Spunta o toglie un passo di onboarding' })
  async impostaPassoOnboarding(@Req() req: any, @Body() dto: ImpostaPassoOnboardingSdiDto) {
    return this.configurazione.impostaPassoOnboarding(
      await this.amministratore(req),
      req.user.id,
      dto
    )
  }
}
