import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import {
  ESTRATTO_CONSORZI_SERVICE,
  MARCATURA_CONSORZI_SERVICE,
  MarcaturaNonValidaError,
  MovimentoNonTrovatoError,
  RegolaConsorzioNonTrovataError,
  type EstrattoConsorziPort,
  type MarcaturaConsorziPort,
} from '../../application/comunicazioni/marcatura-consorzi.port'
import { contentDisposition } from '../common/content-disposition'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import {
  EstrattoConsorzioQueryDto,
  MovimentiConsorziQueryDto,
  OverrideMovimentoDto,
  RegolaConsorzioDto,
} from './dto/consorzi.dto'
import { RUOLI_AMMINISTRATORE_COMUNICAZIONI } from './ruoli'

enum ConsorzioParam {
  CONOU = 'CONOU',
  COBAT = 'COBAT',
  COREPLA = 'COREPLA',
}

/**
 * Marcatura dei movimenti per consorzio (4.9b): regole per azienda, correzione sul singolo
 * movimento ed estratto CSV. Lettura (regole, etichette, estratto): ogni ruolo dell'azienda
 * selezionata; scrittura: SUPER_ADMIN e ADMIN, sul ruolo EFFETTIVO in quell'azienda.
 */
@ApiTags('comunicazioni')
@Controller('comunicazioni/consorzi')
@RichiedeModulo('comunicazioni')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MarcaturaConsorziController {
  constructor(
    @Inject(MARCATURA_CONSORZI_SERVICE) private readonly marcatura: MarcaturaConsorziPort,
    @Inject(ESTRATTO_CONSORZI_SERVICE) private readonly estratto: EstrattoConsorziPort,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get('regole')
  @ApiOperation({ summary: 'Regole dei consorzi: dell’azienda e di sistema' })
  async regole(@Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    const regole = await this.comeHttp(() => this.marcatura.elencaRegole(tenantId))
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    return { regole, puoModificare: RUOLI_AMMINISTRATORE_COMUNICAZIONI.includes(ruolo) }
  }

  @Post('regole')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea una regola per l’azienda' })
  async creaRegola(@Req() req: any, @Body() dto: RegolaConsorzioDto) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.comeHttp(() => this.marcatura.creaRegola(tenantId, req.user.id, dto))
  }

  @Put('regole/:id')
  @ApiOperation({ summary: 'Modifica una regola dell’azienda' })
  async modificaRegola(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegolaConsorzioDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.comeHttp(() => this.marcatura.modificaRegola(tenantId, id, dto))
  }

  @Delete('regole/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina una regola dell’azienda' })
  async eliminaRegola(@Req() req: any, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    await this.comeHttp(() => this.marcatura.eliminaRegola(tenantId, id))
  }

  @Get('movimenti')
  @ApiOperation({ summary: 'Consorzi di un elenco di movimenti (etichetta nel registro)' })
  async movimenti(@Req() req: any, @Query() q: MovimentiConsorziQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return this.comeHttp(() => this.marcatura.consorziDeiMovimenti(tenantId, q.ids))
  }

  @Put('movimenti/:id/:consorzio')
  @ApiOperation({ summary: 'Marca o esclude a mano un movimento per un consorzio' })
  async impostaOverride(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('consorzio', new ParseEnumPipe(ConsorzioParam)) consorzio: ConsorzioParam,
    @Body() dto: OverrideMovimentoDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.comeHttp(() =>
      this.marcatura.impostaOverride(tenantId, req.user.id, id, consorzio, dto.escluso)
    )
  }

  @Delete('movimenti/:id/:consorzio')
  @ApiOperation({ summary: 'Toglie la correzione manuale: il movimento torna alle regole' })
  async rimuoviOverride(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('consorzio', new ParseEnumPipe(ConsorzioParam)) consorzio: ConsorzioParam
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.comeHttp(() => this.marcatura.rimuoviOverride(tenantId, id, consorzio))
  }

  @Get('estratto')
  @ApiOperation({ summary: 'Estratto CSV dei movimenti marcati per un consorzio e un periodo' })
  async estrattoCsv(
    @Req() req: any,
    @Query() q: EstrattoConsorzioQueryDto,
    @Res() res: Response
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    const f = await this.comeHttp(() =>
      this.estratto.estratto(tenantId, {
        consorzio: q.consorzio,
        da: q.da,
        a: q.a,
        unitaLocaleId: q.unitaLocaleId,
      })
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', contentDisposition('attachment', f.nomeFile))
    res.setHeader('X-Righe', String(f.righe))
    res.send(f.csv)
  }

  private async richiediAmministratore(req: any, tenantId: string): Promise<void> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (RUOLI_AMMINISTRATORE_COMUNICAZIONI.includes(ruolo)) return
    throw new ForbiddenException({
      message:
        "Il tuo ruolo nell'azienda selezionata non consente di modificare le marcature dei consorzi.",
      error: 'CONSORZI_RISERVATI_AMMINISTRATORI',
    })
  }

  private async comeHttp<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof MarcaturaNonValidaError) {
        throw new BadRequestException({ message: err.message, error: 'MARCATURA_NON_VALIDA' })
      }
      if (err instanceof RegolaConsorzioNonTrovataError) {
        throw new NotFoundException({ message: err.message, error: 'REGOLA_NON_TROVATA' })
      }
      if (err instanceof MovimentoNonTrovatoError) {
        throw new NotFoundException({ message: err.message, error: 'MOVIMENTO_NON_TROVATO' })
      }
      throw err
    }
  }
}
