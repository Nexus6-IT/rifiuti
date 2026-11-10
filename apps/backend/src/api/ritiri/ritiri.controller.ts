import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { RitiriService } from '../../application/ritiri/ritiri.service'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import {
  ElencoRitiriQueryDto,
  GeneraFirDto,
  ModificaRitiroDto,
  MotivoRitiroDto,
  NuovoRitiroDto,
  RiprogrammaRitiroDto,
} from './dto/ritiri.dto'
import { comeHttpRitiri } from './errori-http'
import { GENERA_FIR_DA_RITIRI, type GeneraFirDaRitiriPorta } from './genera-fir.porta'
import { RUOLI_SCRITTURA_RITIRI } from './ruoli-ritiri'

/**
 * Ritiri programmati (4.7). L'azienda e' quella SELEZIONATA (`requireRequestTenantId`) e la scrittura
 * segue il ruolo EFFETTIVO in quell'azienda (P7 §5): SUPER_ADMIN, ADMIN, OPERATOR; la lettura e' di
 * tutti i ruoli. Le rotte sono quelle usate dal frontend (`ritiri.service.ts`).
 */
@ApiTags('ritiri')
@Controller('ritiri')
@RichiedeModulo('ritiri')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RitiriController {
  constructor(
    private readonly ritiri: RitiriService,
    @Inject(GENERA_FIR_DA_RITIRI) private readonly generaFir: GeneraFirDaRitiriPorta,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Elenco dei ritiri con stato visibile (filtri opzionali)' })
  elenca(@Req() req: any, @Query() filtri: ElencoRitiriQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return comeHttpRitiri(() => this.ritiri.elenca(tenantId, filtri))
  }

  // Rotta fissa prima di `:id` solo per leggibilita': il metodo e i segmenti sono diversi.
  @Post('genera-fir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bozze di FIR dai ritiri indicati (da 1 a 100); nessuna emissione ne trasmissione',
  })
  async generaFirDaRitiri(@Req() req: any, @Body() dto: GeneraFirDto) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    // Il frontend legge `esiti` (una riga per ritiro, nell'ordine di generazione).
    return comeHttpRitiri(async () => {
      const { righe } = await this.generaFir.genera(tenantId, req.user.id, dto.ritiroIds)
      return { esiti: righe }
    })
  }

  @Get(':id')
  @ApiOperation({ summary: 'Dettaglio di un ritiro, con i FIR annullati generati prima' })
  @ApiResponse({ status: 404, description: 'Ritiro non trovato.' })
  dettaglio(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return comeHttpRitiri(() => this.ritiri.dettaglio(tenantId, id))
  }

  @Post()
  @ApiOperation({ summary: 'Crea un ritiro, o una serie se c’è la ripetizione (max 52)' })
  async crea(@Req() req: any, @Body() dto: NuovoRitiroDto) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    return comeHttpRitiri(() => this.ritiri.crea(tenantId, req.user.id, dto))
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Modifica un ritiro programmato (lock ottimistico su `versione`)' })
  @ApiResponse({ status: 409, description: 'RITIRO_MODIFICATO, RITIRO_CON_FIR' })
  async modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaRitiroDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    return comeHttpRitiri(() => this.ritiri.modifica(tenantId, id, dto))
  }

  @Post(':id/annulla')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Annulla un ritiro (motivo obbligatorio; 409 se ha un FIR attivo)' })
  async annulla(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MotivoRitiroDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    return comeHttpRitiri(() =>
      this.ritiri.annulla(tenantId, req.user.id, id, dto.motivo, dto.versione)
    )
  }

  @Post(':id/non-eseguito')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Segna un ritiro come non eseguito (motivo obbligatorio)' })
  async nonEseguito(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MotivoRitiroDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    return comeHttpRitiri(() => this.ritiri.nonEseguito(tenantId, id, dto.motivo, dto.versione))
  }

  @Post(':id/riprogramma')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Riporta a PROGRAMMATO un ritiro non eseguito, con una data nuova' })
  async riprogramma(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RiprogrammaRitiroDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    return comeHttpRitiri(() =>
      this.ritiri.riprogramma(tenantId, id, dto.dataPrevista, dto.versione)
    )
  }

  /** Ruolo EFFETTIVO nell'azienda selezionata, verificato prima del servizio. */
  private async richiediScrittura(req: any, tenantId: string): Promise<RuoloApplicativo> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (RUOLI_SCRITTURA_RITIRI.includes(ruolo)) return ruolo
    throw new ForbiddenException({
      message: "Il tuo ruolo nell'azienda selezionata non consente di modificare i ritiri.",
      error: 'RITIRI_RISERVATI_OPERATORI',
    })
  }
}
