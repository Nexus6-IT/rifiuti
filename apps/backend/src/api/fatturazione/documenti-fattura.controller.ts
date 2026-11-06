/**
 * Documenti di fattura in lettura, annullo e storno (4.4b1, §11-§12). Azienda SELEZIONATA, mai dal
 * corpo. `POST /:id/emesso`, XML, PDF ed export sono del Task 25b (4.4b2). Le risposte dei servizi
 * passano intatte; gli errori di dominio (`ANNULLO_NON_AMMESSO` e `STORNO_NON_AMMESSO` con
 * `details.motivo`, `STORNO_GIA_PRESENTE`, `VERSIONE_SUPERATA`, ...) escono dai servizi.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AnnulloStornoService } from '../../application/fatturazione/annullo-storno.service'
import { DocumentiFatturaService } from '../../application/fatturazione/documenti-fattura.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { AnnullaDto } from './dto/annulla.dto'
import { DocumentoParamDto, ListaDocumentiQueryDto } from './dto/lista-documenti.dto'
import { StornoDto } from './dto/storno.dto'
import { RUOLI_AMMINISTRATORI, RUOLI_LETTURA } from './ruoli'

@ApiTags('fatturazione')
@ApiBearerAuth()
@Controller('documenti-fattura')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentiFatturaController {
  constructor(
    private readonly documenti: DocumentiFatturaService,
    private readonly annullo: AnnulloStornoService
  ) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Documenti paginati: registro, anno, stato, cliente, date' })
  lista(@Req() req: any, @Query() q: ListaDocumentiQueryDto) {
    const { pagina, dimensione, ...filtri } = q
    const definiti = Object.fromEntries(Object.entries(filtri).filter(([, v]) => v !== undefined))
    return this.documenti.lista(requireRequestTenantId(req), { pagina, dimensione, ...definiti })
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un documento con righe, riepiloghi IVA e rate' })
  @ApiResponse({ status: 404, description: 'DOCUMENTO_NON_TROVATO' })
  dettaglio(@Req() req: any, @Param() p: DocumentoParamDto) {
    return this.documenti.dettaglio(requireRequestTenantId(req), p.id)
  }

  @Post(':id/annulla')
  @HttpCode(200)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: "Annulla l'ultimo numero del registro, se non e` emesso" })
  @ApiResponse({
    status: 409,
    description: 'ANNULLO_NON_AMMESSO (details.motivo), VERSIONE_SUPERATA',
  })
  annulla(@Req() req: any, @Param() p: DocumentoParamDto, @Body() dto: AnnullaDto) {
    return this.annullo.annulla(requireRequestTenantId(req), req.user.id, p.id, {
      motivo: dto.motivo,
      versione: dto.versione,
    })
  }

  @Post(':id/storno')
  @HttpCode(200)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Emette la nota di credito di storno' })
  @ApiResponse({
    status: 409,
    description:
      'STORNO_NON_AMMESSO (details.motivo), STORNO_GIA_PRESENTE, DATA_ANTERIORE_ULTIMA_FATTURA, VERSIONE_SUPERATA',
  })
  storno(@Req() req: any, @Param() p: DocumentoParamDto, @Body() dto: StornoDto) {
    return this.annullo.storna(requireRequestTenantId(req), req.user.id, p.id, {
      motivo: dto.motivo,
      dataDocumento: dto.dataDocumento,
      rifatturabile: dto.rifatturabile,
      versione: dto.versione,
    })
  }
}
