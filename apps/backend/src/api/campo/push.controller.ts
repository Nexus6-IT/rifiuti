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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ConsentitoAutista } from '../../core/decorators/consentito-autista.decorator'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { PushCampoService } from '../../application/campo/push-campo.service'
import { PushEndpointDto, PushPreferenzeDto } from './dto/campo.dto'
import { comeHttpCampo } from './errori-http'

/**
 * Web push dell'app campo (P7). Le rotte lavorano SEMPRE sull'utente del token e sull'azienda del
 * token: niente id utente nel corpo. Funzione spenta (chiavi VAPID assenti): la configurazione dice
 * `disponibile: false` e la sottoscrizione risponde 503 `PUSH_NON_DISPONIBILE`.
 */
@ApiTags('campo')
@Controller('push')
@RichiedeModulo('campo')
@ConsentitoAutista('notifiche dell’app campo')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PushController {
  constructor(private readonly push: PushCampoService) {}

  @Get('configurazione')
  @ApiOperation({ summary: 'Le notifiche sono disponibili? Chiave pubblica per il browser' })
  configurazione() {
    const chiavePubblica = this.push.chiavePubblica()
    return { disponibile: chiavePubblica !== null, chiavePubblica }
  }

  @Put('sottoscrizione')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Registra (o sposta su di me) il dispositivo per le notifiche' })
  @ApiResponse({ status: 503, description: 'PUSH_NON_DISPONIBILE' })
  async sottoscrivi(@Req() req: any, @Body() dto: PushEndpointDto): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await comeHttpCampo(() => this.push.sottoscrivi(tenantId, req.user.id, dto.endpoint))
  }

  /** POST e non DELETE con corpo: alcuni proxy scartano il corpo di un DELETE. Idempotente. */
  @Post('sottoscrizione/annulla')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Toglie il mio dispositivo dalle notifiche (logout)' })
  async annulla(@Req() req: any, @Body() dto: PushEndpointDto): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await comeHttpCampo(() => this.push.annulla(tenantId, req.user.id, dto.endpoint))
  }

  @Get('preferenze')
  @ApiOperation({ summary: 'Le mie preferenze di notifica' })
  preferenze(@Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    return comeHttpCampo(() => this.push.preferenze(tenantId, req.user.id))
  }

  @Put('preferenze')
  @ApiOperation({ summary: 'Cambia le mie preferenze di notifica' })
  impostaPreferenze(@Req() req: any, @Body() dto: PushPreferenzeDto) {
    const tenantId = requireRequestTenantId(req)
    return comeHttpCampo(() => this.push.impostaPreferenze(tenantId, req.user.id, dto))
  }
}
