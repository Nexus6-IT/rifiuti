import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { EventiCampoService } from '../../application/campo/eventi-campo.service'
import { EsitiCampoQueryDto } from './dto/campo.dto'
import { comeHttpCampo } from './errori-http'

/**
 * «Esiti dal campo» per l'ufficio (app campo, P4): sola lettura degli eventi inviati dagli autisti,
 * con i «da riconciliare». Azienda SELEZIONATA, tutti i ruoli d'ufficio. Un utente `AUTISTA` non
 * entra: la rotta non e' `@ConsentitoAutista`, quindi `RuoloAutistaInterceptor` la respinge.
 */
@ApiTags('campo')
@Controller('esiti-campo')
@RichiedeModulo('campo')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EsitiCampoController {
  constructor(private readonly eventi: EventiCampoService) {}

  @Get()
  @ApiOperation({
    summary: 'Esiti inviati dagli autisti (`esito=DA_RICONCILIARE` per i conflitti)',
  })
  elenca(@Req() req: any, @Query() q: EsitiCampoQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return comeHttpCampo(() => this.eventi.elenca(tenantId, { esito: q.esito, pagina: q.pagina }))
  }
}
