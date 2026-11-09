/**
 * Causali del registro cronologico (F2-5): catalogo di sistema + causali dell'azienda con
 * versioni. La lettura delle opzioni e' per qualunque ruolo; tutto il resto spetta
 * all'amministratore EFFETTIVO nell'azienda selezionata.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { giornoItaliano } from '../../core/time/anno-italiano'
import {
  CausaliRegistroService,
  type CausalePropriaVista,
  type GestioneCausali,
  type OpzioneCausale,
} from '../../application/registro/causali/causali-registro.service'
import type { VersoCausale } from '../../domain/waste-movement/catalogo-causali'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { RUOLI_PROGRESSIVO_INIZIALE } from './registro.controller'
import {
  ChiudiCausaleDto,
  CreaCausaleAziendaleDto,
  ListaCausaliQueryDto,
  ModificaCausaleAziendaleDto,
  NuovaVersioneCausaleDto,
  VersoCausaleDto,
} from './dtos/causali-registro.dto'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

@ApiTags('registro')
@Controller('registro/causali')
@RichiedeModulo('registro')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CausaliRegistroController {
  constructor(
    private readonly causali: CausaliRegistroService,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Causali selezionabili per un tipo di movimento a un giorno' })
  async opzioni(
    @Query() query: ListaCausaliQueryDto,
    @Req() req: any
  ): Promise<{ tipo: VersoCausale; data: string; causali: OpzioneCausale[] }> {
    const tenantId = requireRequestTenantId(req)
    const data = query.data ?? giornoItaliano(new Date())
    const causali = await this.causali.opzioni(tenantId, query.tipo as VersoCausale, data)
    return { tipo: query.tipo as VersoCausale, data, causali }
  }

  @Get('gestione')
  @ApiOperation({ summary: 'Vista di gestione delle causali (amministratori)' })
  async gestione(@Req() req: any): Promise<GestioneCausali> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.causali.gestione(tenantId)
  }

  @Put('sistema/:verso/:codice/disattivazione')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Disattiva una causale di sistema per l'azienda" })
  async disattiva(
    @Param('verso', new ParseEnumPipe(VersoCausaleDto)) verso: VersoCausaleDto,
    @Param('codice') codice: string,
    @Body() corpo: Record<string, unknown> | undefined,
    @Req() req: any
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    this.rifiutaFlagSuSistema(corpo)
    await this.causali.disattiva(tenantId, req.user.id, verso as VersoCausale, codice)
  }

  @Delete('sistema/:verso/:codice/disattivazione')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Riattiva una causale di sistema per l'azienda" })
  async riattiva(
    @Param('verso', new ParseEnumPipe(VersoCausaleDto)) verso: VersoCausaleDto,
    @Param('codice') codice: string,
    @Body() corpo: Record<string, unknown> | undefined,
    @Req() req: any
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    this.rifiutaFlagSuSistema(corpo)
    await this.causali.riattiva(tenantId, req.user.id, verso as VersoCausale, codice)
  }

  @Post('aziendali')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Crea una causale dell'azienda (prima versione)" })
  async crea(@Body() dto: CreaCausaleAziendaleDto, @Req() req: any): Promise<CausalePropriaVista> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.causali.crea(tenantId, req.user.id, {
      ...dto,
      verso: dto.verso as VersoCausale,
      ruoloMud: dto.ruoloMud,
    })
  }

  @Patch('aziendali/:id')
  @ApiOperation({ summary: 'Modifica una versione (assente = invariato, null = azzera)' })
  async modifica(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaCausaleAziendaleDto,
    @Req() req: any
  ): Promise<CausalePropriaVista> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.causali.modifica(tenantId, req.user.id, id, dto)
  }

  @Post('aziendali/:id/versioni')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea una nuova versione dall’ultima della causale' })
  async nuovaVersione(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NuovaVersioneCausaleDto,
    @Req() req: any
  ): Promise<CausalePropriaVista> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.causali.nuovaVersione(tenantId, req.user.id, id, dto)
  }

  @Put('aziendali/:id/chiusura')
  @ApiOperation({ summary: 'Imposta l’ultimo giorno di validità di una versione' })
  async chiudi(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChiudiCausaleDto,
    @Req() req: any
  ): Promise<CausalePropriaVista> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.causali.chiudi(tenantId, req.user.id, id, dto.validaAl)
  }

  @Delete('aziendali/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina una versione mai usata' })
  async elimina(@Param('id', ParseUUIDPipe) id: string, @Req() req: any): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    await this.causali.elimina(tenantId, req.user.id, id)
  }

  /** Decisione 14: il flag di una causale di sistema non si cambia per azienda. */
  private rifiutaFlagSuSistema(corpo: Record<string, unknown> | undefined): void {
    if (corpo && typeof corpo === 'object' && 'fatturabile' in corpo) {
      throw new BadRequestException(
        'Il flag fatturabile di una causale di sistema non si può cambiare: ' +
          'crea una causale propria con il flag acceso.'
      )
    }
  }

  /** La gestione spetta all'amministratore EFFETTIVO dell'azienda selezionata. */
  private async richiediAmministratore(req: any, tenantId: string): Promise<void> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (RUOLI_PROGRESSIVO_INIZIALE.includes(ruolo)) return
    throw new ForbiddenException({
      message: "Solo un amministratore dell'azienda può gestire le causali del registro.",
      error: 'REGISTRO_CAUSALI_RISERVATE_AMMINISTRATORI',
    })
  }
}
