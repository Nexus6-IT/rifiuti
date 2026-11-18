import { Controller, ForbiddenException, Get, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ConsentitoAutista } from '../../core/decorators/consentito-autista.decorator'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { GiroService } from '../../application/campo/giro.service'
import { GiroQueryDto } from './dto/campo.dto'
import { comeHttpCampo } from './errori-http'

/**
 * App campo (P1): rotte `/campo/*` dell'autista. Sono le uniche, con logout e profilo, che un
 * utente `AUTISTA` puo' usare (`@ConsentitoAutista`); a un utente d'ufficio rispondono 403, perche'
 * il giro e' sempre quello dell'autista collegato all'utente che chiede.
 */
@ApiTags('campo')
@Controller('campo')
@RichiedeModulo('campo')
@ConsentitoAutista('rotte dell’app campo')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CampoController {
  constructor(private readonly giroService: GiroService) {}

  @Get('giro')
  @ApiOperation({ summary: 'Ritiri programmati del giorno dell’autista collegato all’utente' })
  giro(@Req() req: any, @Query() q: GiroQueryDto) {
    if (req.user?.role !== 'AUTISTA') {
      throw new ForbiddenException({
        message: 'Il giro è riservato agli autisti.',
        error: 'GIRO_RISERVATO_AGLI_AUTISTI',
      })
    }
    const tenantId = requireRequestTenantId(req)
    return comeHttpCampo(() => this.giroService.giro(tenantId, req.user.id, q.data))
  }
}
