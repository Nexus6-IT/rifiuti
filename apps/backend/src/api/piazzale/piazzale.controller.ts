import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ArriviPiazzaleService } from '../../application/piazzale/arrivi-piazzale.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { FIRResponseDto } from '../fir/dtos/fir-response.dto'
import { richiediRuoloEffettivo } from '../me/richiedi-ruolo-effettivo'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const LUNGHEZZA_MASSIMA_RICERCA = 50

/** Piazzale: la modalità tablet con cui l'impianto di destino conferma peso ed esito dei FIR in arrivo. */
@Controller('piazzale')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags('piazzale')
@ApiBearerAuth()
export class PiazzaleController {
  constructor(
    private readonly arriviPiazzale: ArriviPiazzaleService,
    private readonly ruoloEffettivo: RuoloEffettivoService
  ) {}

  @Get('arrivi')
  @ApiOperation({ summary: "FIR in arrivo al piazzale dell'azienda selezionata" })
  async arrivi(@Query('cerca') cerca: string | undefined, @Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    if (cerca !== undefined && cerca.length > LUNGHEZZA_MASSIMA_RICERCA) {
      throw new BadRequestException(
        `La ricerca accetta al massimo ${LUNGHEZZA_MASSIMA_RICERCA} caratteri.`
      )
    }

    const { azienda, codiciAziendaConfigurati, arrivi } = await this.arriviPiazzale.elenca(
      tenantId,
      cerca
    )
    return {
      azienda,
      codiciAziendaConfigurati,
      arrivi: arrivi.map(fir => FIRResponseDto.fromDomain(fir)),
    }
  }
}
