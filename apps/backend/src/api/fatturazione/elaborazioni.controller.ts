/**
 * Elaborazioni di fatturazione (4.4b1, §11-§12): avvio dell'anteprima, lista, dettaglio, ricalcolo,
 * scarto, esclusione dei documenti e richiesta della definitiva. Azienda SELEZIONATA
 * (`requireRequestTenantId`), mai dal corpo; `@Roles` esplicito su ogni rotta.
 *
 * Il controller non aggiunge ne toglie chiavi alle risposte dei servizi (Q21). Unica eccezione:
 * `ricalcola`, il cui servizio non restituisce nulla, risponde `{ id }` come `FatturazioneService`
 * del frontend. Gli errori di dominio (400/404/409 con `{ error, message, details? }`) escono dai
 * servizi e passano intatti.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ElaborazioniService } from '../../application/fatturazione/elaborazioni.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { DefinitivaDto, VersioneElaborazioneDto } from './dto/definitiva.dto'
import { DocumentoElaborazioneParamDto, ElaborazioneParamDto } from './dto/escludi.dto'
import {
  DocumentiElaborazioneQueryDto,
  ListaElaborazioniQueryDto,
} from './dto/lista-elaborazioni.dto'
import { NuovaElaborazioneDto } from './dto/nuova-elaborazione.dto'
import { RUOLI_AMMINISTRATORI, RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'

@ApiTags('fatturazione')
@ApiBearerAuth()
@Controller('elaborazioni-fatturazione')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ElaborazioniController {
  constructor(private readonly elaborazioni: ElaborazioniService) {}

  @Post()
  @HttpCode(202)
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: "Avvia l'anteprima (202): l'elaborazione nasce IN_CODA" })
  @ApiResponse({ status: 400, description: 'PERIODO_NON_VALIDO, DATA_FUTURA, CEDENTE_INCOMPLETO' })
  @ApiResponse({ status: 409, description: 'ELABORAZIONE_IN_CORSO' })
  avvia(@Req() req: any, @Body() dto: NuovaElaborazioneDto) {
    return this.elaborazioni.avvia(requireRequestTenantId(req), req.user.id, dto)
  }

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Elaborazioni paginate, dalla piu` recente' })
  lista(@Req() req: any, @Query() q: ListaElaborazioniQueryDto) {
    return this.elaborazioni.lista(requireRequestTenantId(req), {
      pagina: q.pagina,
      dimensione: q.dimensione,
      ...(q.stato !== undefined ? { stato: q.stato } : {}),
    })
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Stato, riepilogo ed errori generali di un`elaborazione' })
  @ApiResponse({ status: 404, description: 'ELABORAZIONE_NON_TROVATA' })
  dettaglio(@Req() req: any, @Param() p: ElaborazioneParamDto) {
    return this.elaborazioni.dettaglio(requireRequestTenantId(req), p.id)
  }

  @Get(':id/documenti')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: "Documenti (bozze) dell'elaborazione, paginati" })
  documenti(
    @Req() req: any,
    @Param() p: ElaborazioneParamDto,
    @Query() q: DocumentiElaborazioneQueryDto
  ) {
    return this.elaborazioni.documenti(requireRequestTenantId(req), p.id, {
      pagina: q.pagina,
      dimensione: q.dimensione,
      ...(q.conErrori !== undefined ? { conErrori: q.conErrori } : {}),
    })
  }

  @Post(':id/ricalcola')
  @HttpCode(202)
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Accoda il ricalcolo (202); la UI rilegge il dettaglio' })
  @ApiResponse({ status: 409, description: 'ELABORAZIONE_IN_CORSO, VERSIONE_SUPERATA, ...' })
  async ricalcola(
    @Req() req: any,
    @Param() p: ElaborazioneParamDto,
    @Body() dto: VersioneElaborazioneDto
  ) {
    await this.elaborazioni.ricalcola(requireRequestTenantId(req), req.user.id, p.id, dto.versione)
    return { id: p.id }
  }

  @Post(':id/scarta')
  @HttpCode(200)
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: "Scarta l'anteprima e ne cancella le bozze" })
  scarta(@Req() req: any, @Param() p: ElaborazioneParamDto, @Body() dto: VersioneElaborazioneDto) {
    return this.elaborazioni.scarta(requireRequestTenantId(req), req.user.id, p.id, dto.versione)
  }

  @Post(':id/documenti/:documentoId/escludi')
  @HttpCode(200)
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Esclude una bozza dalla definitiva' })
  escludi(@Req() req: any, @Param() p: DocumentoElaborazioneParamDto) {
    return this.elaborazioni.escludi(requireRequestTenantId(req), p.id, p.documentoId, true)
  }

  @Post(':id/documenti/:documentoId/riammetti')
  @HttpCode(200)
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Riammette una bozza esclusa' })
  riammetti(@Req() req: any, @Param() p: DocumentoElaborazioneParamDto) {
    return this.elaborazioni.escludi(requireRequestTenantId(req), p.id, p.documentoId, false)
  }

  @Post(':id/definitiva')
  @HttpCode(202)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({
    summary: 'Richiede la definitiva (202): numera, marca i legami FATTURATO, scrive i marcatori',
  })
  @ApiResponse({
    status: 409,
    description:
      'DEFINITIVE_NON_ATTIVE, ANTEPRIMA_SUPERATA, VERSIONE_SUPERATA, ELABORAZIONE_GIA_IN_DEFINITIVA, ' +
      'CEDENTE_INCOMPLETO, DATA_ANTERIORE_ULTIMA_FATTURA (details.ultimaData), NESSUN_DOCUMENTO_DEFINIBILE',
  })
  @ApiResponse({ status: 400, description: 'TROPPI_DOCUMENTI' })
  definitiva(@Req() req: any, @Param() p: ElaborazioneParamDto, @Body() dto: DefinitivaDto) {
    return this.elaborazioni.chiediDefinitiva(requireRequestTenantId(req), req.user.id, p.id, {
      impronta: dto.impronta,
      versione: dto.versione,
    })
  }
}
