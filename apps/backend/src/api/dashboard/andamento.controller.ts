import { Controller, Get, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import {
  RaccogliAndamentoMensileUseCase,
  AndamentoMensileResult,
} from '../../application/dashboard/raccogli-andamento-mensile.use-case'

/**
 * Andamento Controller
 *
 * GET /dashboard/andamento — formulari creati per mese negli ultimi dodici
 * mesi per il tenant corrente (Task 4 del piano cruscotto): un conteggio
 * dice dove sei, questa serie dice dove stai andando.
 *
 * Etichetta "creati", non "emessi" (ruling PO, giro di revisione 1): v.
 * `RaccogliAndamentoMensileUseCase` sul perché non esiste ancora un campo
 * "data di emissione" persistito.
 *
 * Isolato per tenant (contesto autenticato, mai un parametro del chiamante).
 */
@ApiTags('Dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AndamentoController {
  constructor(private readonly raccogliAndamentoMensileUseCase: RaccogliAndamentoMensileUseCase) {}

  /**
   * Get Andamento
   *
   * GET /dashboard/andamento
   */
  @Get('andamento')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Formulari creati per mese negli ultimi dodici mesi',
    description: `
      Serie mensile (12 mesi, il più recente è il mese corrente) dei
      formulari creati dal tenant corrente, per il grafico "Andamento" del
      cruscotto.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Serie di 12 mesi, dal più vecchio al più recente, con il conteggio di ciascuno',
  })
  @ApiResponse({
    status: 401,
    description: 'Non autenticato',
  })
  async getAndamento(@Req() req: any): Promise<AndamentoMensileResult> {
    const tenantId = requireRequestTenantId(req)

    return await this.raccogliAndamentoMensileUseCase.raccogli(tenantId)
  }
}
