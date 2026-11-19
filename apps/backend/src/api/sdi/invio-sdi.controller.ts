/**
 * Invio dei documenti allo SDI (4.5b). Azienda SELEZIONATA, mai dal corpo. Solo ADMIN/SUPER_ADMIN,
 * verificati sul ruolo EFFETTIVO nell'azienda scelta. Modulo commerciale `sdi`. L'accodamento
 * risponde 202: l'invio vero lo fa il job.
 */
import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { InvioSdiService } from '../../application/sdi/invio-sdi.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { DocumentoParamDto } from '../fatturazione/dto/lista-documenti.dto'
import { RUOLI_AMMINISTRATORI } from '../legami-movimento/ruoli'
import { RUOLI_AMMINISTRATIVI, richiediRuoloEffettivo } from '../me/richiedi-ruolo-effettivo'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { InvioSdiDto } from './dto/invio-sdi.dto'

@ApiTags('sdi')
@ApiBearerAuth()
@Controller('documenti-fattura')
@RichiedeModulo('sdi')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvioSdiController {
  constructor(
    private readonly invio: InvioSdiService,
    private readonly membership: RuoloEffettivoService
  ) {}

  private async amministratore(req: any): Promise<string> {
    const tenantId = requireRequestTenantId(req)
    await richiediRuoloEffettivo(this.membership, req.user, tenantId, RUOLI_AMMINISTRATIVI)
    return tenantId
  }

  @Post('invio-sdi')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Accoda i documenti per l`invio allo SDI (202 con accodate e saltate)' })
  @ApiResponse({
    status: 409,
    description: 'SDI_NON_CONFIGURATO, INVIO_SDI_NON_ATTIVO o INVII_SDI_SOSPESI',
  })
  @ApiResponse({ status: 400, description: 'TROPPI_DOCUMENTI, NESSUN_DOCUMENTO' })
  async invia(@Req() req: any, @Body() dto: InvioSdiDto) {
    return this.invio.accoda(await this.amministratore(req), req.user.id, {
      ids: dto.ids,
      confermaGiaEmesso: dto.confermaGiaEmesso,
    })
  }

  @Post(':id/invio-sdi/riprova')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Nuova trasmissione per un documento il cui invio e` finito in errore' })
  @ApiResponse({ status: 409, description: 'RIPROVA_NON_AMMESSA o le condizioni dell`invio' })
  async riprova(@Req() req: any, @Param() p: DocumentoParamDto) {
    return this.invio.riprova(await this.amministratore(req), req.user.id, p.id)
  }
}
