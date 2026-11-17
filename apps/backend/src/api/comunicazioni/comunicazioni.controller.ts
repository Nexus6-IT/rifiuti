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
  UnprocessableEntityException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import {
  COMUNICAZIONI_ORSO_SERVICE,
  ComunicazioneConBloccantiError,
  ComunicazioneNonTrovataError,
  ComunicazioniOrsoPort,
} from '../../application/comunicazioni/comunicazioni-orso.port'
import {
  COMUNICAZIONI_TRACCIATO_SERVICE,
  ConfermaVerificaRichiestaError,
  FileNonCodificabileError,
  TracciatoNonDisponibileError,
  RichiestaComunicazioneNonValidaError,
  type ComunicazioniTracciatoPort,
} from '../../application/comunicazioni/comunicazioni-tracciato.port'
import { contentDisposition } from '../common/content-disposition'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { SegnaInviataDto } from './dto/dati-comunicazioni.dto'
import { AnteprimaOrsoQueryDto, ElencoComunicazioniQueryDto, GeneraOrsoDto } from './dto/orso.dto'
import { RUOLI_OPERATORE_COMUNICAZIONI } from './ruoli'

/**
 * Comunicazioni ai consorzi (4.9a): O.R.SO. L'azienda e' quella SELEZIONATA e i permessi seguono
 * il ruolo EFFETTIVO in quell'azienda, controllato prima del servizio. Lettura: ogni ruolo;
 * generare e segnare inviata: SUPER_ADMIN, ADMIN, OPERATOR.
 */
@ApiTags('comunicazioni')
@Controller('comunicazioni')
@RichiedeModulo('comunicazioni')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ComunicazioniController {
  constructor(
    @Inject(COMUNICAZIONI_ORSO_SERVICE) private readonly orso: ComunicazioniOrsoPort,
    @Inject(COMUNICAZIONI_TRACCIATO_SERVICE) private readonly tracciato: ComunicazioniTracciatoPort,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get('orso/anteprima')
  @ApiOperation({ summary: 'Anteprima O.R.SO. annuale di una sede, con avvisi' })
  async anteprima(@Req() req: any, @Query() q: AnteprimaOrsoQueryDto) {
    const tenantId = requireRequestTenantId(req)
    const anteprima = await this.comeHttp(() =>
      this.orso.anteprima(tenantId, q.unitaLocaleId, q.anno)
    )
    // Ruolo EFFETTIVO nell'azienda selezionata: il frontend non deve dedurlo dal ruolo globale.
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    return { ...anteprima, puoGenerare: RUOLI_OPERATORE_COMUNICAZIONI.includes(ruolo) }
  }

  @Post('orso')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Genera la comunicazione O.R.SO. (idempotente per hashDati)' })
  @ApiResponse({ status: 400, description: 'COMUNICAZIONE_CON_BLOCCANTI' })
  async genera(@Req() req: any, @Body() dto: GeneraOrsoDto) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediOperatore(req, tenantId)
    return this.comeHttp(() => this.orso.genera(tenantId, req.user.id, dto.unitaLocaleId, dto.anno))
  }

  @Get()
  @ApiOperation({ summary: 'Storico delle comunicazioni' })
  async elenca(@Req() req: any, @Query() q: ElencoComunicazioniQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return this.comeHttp(() => this.orso.elenca(tenantId, q))
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Scarica il file della comunicazione (tipo e codifica dal tracciato)' })
  async file(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    const f = await this.comeHttp(() => this.tracciato.file(tenantId, id))
    res.setHeader('Content-Type', f.contentType)
    res.setHeader('Content-Disposition', contentDisposition('attachment', f.nomeFile))
    res.send(f.contenuto)
  }

  @Get(':id/manifest')
  @ApiOperation({ summary: 'Manifest della comunicazione (affidabilita, hash, avvisi, inferenze)' })
  async manifest(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    const m = await this.comeHttp(() => this.tracciato.manifest(tenantId, id))
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', contentDisposition('attachment', m.nomeFile))
    res.send(m.testo)
  }

  @Post(':id/inviata')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Segna la comunicazione come inviata' })
  async inviata(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SegnaInviataDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediOperatore(req, tenantId)
    return this.comeHttp(async () => {
      // O.R.SO. ha il suo servizio (ricalcolo dell'hash per anno); gli altri tracciati il generico,
      // che per i tracciati ricavati da WinWaste chiede la conferma esplicita di verifica.
      if ((await this.tracciato.consorzioDi(tenantId, id)) === 'ORSO') {
        return this.orso.segnaInviata(tenantId, req.user.id, id)
      }
      return this.tracciato.segnaInviata(tenantId, req.user.id, id, dto?.confermaVerifica)
    })
  }

  private async richiediOperatore(req: any, tenantId: string): Promise<RuoloApplicativo> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (RUOLI_OPERATORE_COMUNICAZIONI.includes(ruolo)) return ruolo
    throw new ForbiddenException({
      message: "Il tuo ruolo nell'azienda selezionata non consente di generare comunicazioni.",
      error: 'COMUNICAZIONI_RISERVATE_OPERATORI',
    })
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
      if (err instanceof ConfermaVerificaRichiestaError) {
        throw new BadRequestException({
          message: err.message,
          error: 'CONFERMA_VERIFICA_RICHIESTA',
        })
      }
      if (err instanceof RichiestaComunicazioneNonValidaError) {
        throw new BadRequestException({
          message: err.message,
          error: 'RICHIESTA_COMUNICAZIONE_NON_VALIDA',
          details: { errori: err.errori },
        })
      }
      if (err instanceof FileNonCodificabileError || err instanceof TracciatoNonDisponibileError) {
        throw new UnprocessableEntityException({
          message: err.message,
          error:
            err instanceof FileNonCodificabileError
              ? 'FILE_NON_CODIFICABILE'
              : 'TRACCIATO_NON_DISPONIBILE',
        })
      }
      if (err instanceof ComunicazioneNonTrovataError) {
        throw new NotFoundException({ message: err.message, error: 'COMUNICAZIONE_NON_TROVATA' })
      }
      throw err
    }
  }
}
