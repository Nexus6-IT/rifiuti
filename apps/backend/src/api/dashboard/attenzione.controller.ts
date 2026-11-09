import { Controller, Get, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import {
  RaccogliAttenzioneUseCase,
  AttenzioneResult,
  ordinaVociPerGravita,
} from '../../application/dashboard/raccogli-attenzione.use-case'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { RaccogliIndicatoriAzioneUseCase } from '../../application/dashboard/raccogli-indicatori-azione.use-case'

/**
 * Attenzione Controller
 *
 * GET /dashboard/attenzione — raccoglie in un'unica chiamata le cose che
 * richiedono attenzione oggi per il tenant (certificato RENTRI in scadenza,
 * autorizzazioni impianto in scadenza o scadute, formulari da trasmettere,
 * numeri vidimati pronti, ...), già ordinate per gravità e già scritte in
 * italiano pronto da mostrare.
 *
 * Fonde le voci di due use case (`RaccogliAttenzioneUseCase` e
 * `RaccogliIndicatoriAzioneUseCase`, Task 3 del piano cruscotto — separati
 * per restare sotto la soglia di 150 righe indicata dal piano) in un'unica
 * lista ordinata: per il frontend resta un'unica chiamata, un'unica fascia.
 *
 * Tutte le rotte sono autenticate e isolate per tenant.
 */
@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AttenzioneController {
  constructor(
    private readonly raccogliAttenzioneUseCase: RaccogliAttenzioneUseCase,
    private readonly raccogliIndicatoriAzioneUseCase: RaccogliIndicatoriAzioneUseCase,
    private readonly moduliAttivi: ModuliAttiviService
  ) {}

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

    // Una sola lettura dei moduli per richiesta, condivisa dai due use case.
    const moduli = new Set(await this.moduliAttivi.moduliAttivi(tenantId))
    const [attenzione, indicatori] = await Promise.all([
      this.raccogliAttenzioneUseCase.raccogli(tenantId, moduli),
      this.raccogliIndicatoriAzioneUseCase.raccogli(tenantId, moduli),
    ])

    return { voci: ordinaVociPerGravita([...attenzione.voci, ...indicatori.voci]) }
  }
}
