import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import {
  COMUNICAZIONI_ORR_SERVICE,
  type ComunicazioniOrrPort,
} from '../../application/comunicazioni/comunicazioni-orr.port'
import {
  ComunicazioneConBloccantiError,
  ComunicazioneNonTrovataError,
} from '../../application/comunicazioni/comunicazioni-orso.port'
import { RichiestaComunicazioneNonValidaError } from '../../application/comunicazioni/comunicazioni-tracciato.port'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { ElencoOrrQueryDto, RichiestaOrrDto } from './dto/orr.dto'
import { RUOLI_OPERATORE_COMUNICAZIONI } from './ruoli'

/**
 * O.R.R. Campania (4.9f): anteprima e generazione di uno o piu' file (uno per attivita'), storico.
 * Il download del file, il manifest e «segna inviata» sono quelli generici di `/comunicazioni/:id/...`.
 * Lettura: ogni ruolo; generare: SUPER_ADMIN, ADMIN, OPERATOR (ruolo EFFETTIVO nell'azienda scelta).
 */
@ApiTags('comunicazioni')
@Controller('comunicazioni/orr')
@RichiedeModulo('comunicazioni')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrrController {
  constructor(
    @Inject(COMUNICAZIONI_ORR_SERVICE) private readonly orr: ComunicazioniOrrPort,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get('anteprima')
  @ApiOperation({
    summary: 'Anteprima O.R.R.: un file per attività con movimenti, avvisi e link alla correzione',
  })
  async anteprima(@Req() req: any, @Query() q: RichiestaOrrDto) {
    const tenantId = requireRequestTenantId(req)
    const anteprima = await this.comeHttp(() => this.orr.anteprima(tenantId, q))
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    return { ...anteprima, puoGenerare: RUOLI_OPERATORE_COMUNICAZIONI.includes(ruolo) }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Genera i file O.R.R. (idempotente per file); con un bloccante non ne genera nessuno',
  })
  @ApiResponse({ status: 400, description: 'COMUNICAZIONE_CON_BLOCCANTI' })
  async genera(@Req() req: any, @Body() dto: RichiestaOrrDto) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (!RUOLI_OPERATORE_COMUNICAZIONI.includes(ruolo)) {
      throw new ForbiddenException({
        message: "Il tuo ruolo nell'azienda selezionata non consente di generare comunicazioni.",
        error: 'COMUNICAZIONI_RISERVATE_OPERATORI',
      })
    }
    const file = await this.comeHttp(() => this.orr.genera(tenantId, req.user.id, dto))
    return { file }
  }

  @Get()
  @ApiOperation({ summary: 'Storico dei file O.R.R.' })
  async elenca(@Req() req: any, @Query() q: ElencoOrrQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return this.comeHttp(() => this.orr.elenca(tenantId, q))
  }

  private async comeHttp<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof ComunicazioneConBloccantiError) {
        throw new BadRequestException({
          message: err.message,
          error: 'COMUNICAZIONE_CON_BLOCCANTI',
          details: { avvisi: err.avvisi },
        })
      }
      if (err instanceof RichiestaComunicazioneNonValidaError) {
        throw new BadRequestException({
          message: err.message,
          error: 'RICHIESTA_COMUNICAZIONE_NON_VALIDA',
          details: { errori: err.errori },
        })
      }
      if (err instanceof ComunicazioneNonTrovataError) {
        throw new NotFoundException({ message: err.message, error: 'COMUNICAZIONE_NON_TROVATA' })
      }
      throw err
    }
  }
}
