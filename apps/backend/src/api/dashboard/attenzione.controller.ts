import { Controller, Get, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import {
  RaccogliAttenzioneUseCase,
  AttenzioneResult,
} from '../../application/dashboard/raccogli-attenzione.use-case'

/**
 * Attenzione Controller
 *
 * GET /dashboard/attenzione — raccoglie in un'unica chiamata le cose che
 * richiedono attenzione oggi per il tenant (certificato RENTRI in scadenza,
 * autorizzazioni impianto in scadenza o scadute, ...), già ordinate per
 * gravità e già scritte in italiano pronto da mostrare.
 *
 * Tutte le rotte sono autenticate e isolate per tenant.
 */
@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AttenzioneController {
  constructor(private readonly raccogliAttenzioneUseCase: RaccogliAttenzioneUseCase) {}

  /**
   * Get Attenzione
   *
   * GET /dashboard/attenzione
   */
  @Get('attenzione')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cose che richiedono attenzione oggi',
    description: `
      Raccoglie in un'unica chiamata le voci che richiedono attenzione per
      il tenant corrente, ordinate per gravità (i critici per primi):
      certificato RENTRI in scadenza o non leggibile, autorizzazioni
      impianto in scadenza o scadute.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Elenco delle voci che richiedono attenzione, già ordinato per gravità',
  })
  @ApiResponse({
    status: 401,
    description: 'Non autenticato',
  })
  async getAttenzione(@Req() req: any): Promise<AttenzioneResult> {
    const tenantId = requireRequestTenantId(req)

    return await this.raccogliAttenzioneUseCase.raccogli(tenantId)
  }
}
