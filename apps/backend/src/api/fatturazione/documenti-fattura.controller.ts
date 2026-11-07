/**
 * Documenti di fattura in lettura, annullo e storno (4.4b1, §11-§12). Azienda SELEZIONATA, mai dal
 * corpo. 4.4b2 (Task 25b): XML, «segna come emesso» ed export (CSV e `XML_ZIP`); il PDF (Task 28) e` `GET :id/pdf`, a tutti i ruoli di lettura. Il download e` uno `StreamableFile` con `Content-Disposition: attachment`; `XML_ZIP`
 * aggiunge `X-Documenti-Saltati` (esposto dal CORS in `main.ts`). Le risposte dei servizi
 * passano intatte; gli errori di dominio (`ANNULLO_NON_AMMESSO` e `STORNO_NON_AMMESSO` con
 * `details.motivo`, `STORNO_GIA_PRESENTE`, `VERSIONE_SUPERATA`, ...) escono dai servizi.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common'
import type { Response } from 'express'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AnnulloStornoService } from '../../application/fatturazione/annullo-storno.service'
import { DocumentiFatturaService } from '../../application/fatturazione/documenti-fattura.service'
import { ExportService } from '../../application/fatturazione/export.service'
import { PdfCortesiaService } from '../../application/fatturazione/pdf-cortesia'
import { XmlDocumentoService } from '../../application/fatturazione/xml-documento.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { RUOLI_AMMINISTRATIVI, richiediRuoloEffettivo } from '../me/richiedi-ruolo-effettivo'
import { AnnullaDto } from './dto/annulla.dto'
import { ConfermaEmissioneDto, SegnaEmessoDto } from './dto/emissione.dto'
import { EsportaDto } from './dto/export.dto'
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
    private readonly annullo: AnnulloStornoService,
    private readonly xml: XmlDocumentoService,
    private readonly esportazione: ExportService,
    private readonly membership: RuoloEffettivoService,
    private readonly pdfCortesia: PdfCortesiaService
  ) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Documenti paginati: registro, anno, stato, cliente, date' })
  lista(@Req() req: any, @Query() q: ListaDocumentiQueryDto) {
    const { pagina, dimensione, ...filtri } = q
    // Solo i filtri presenti: una chiave `undefined` non deve arrivare al servizio.
    const presenti = Object.fromEntries(
      Object.entries(filtri).filter(([, v]) => v !== undefined)
    ) as Omit<ListaDocumentiQueryDto, 'pagina' | 'dimensione'>
    return this.documenti.lista(requireRequestTenantId(req), { pagina, dimensione, ...presenti })
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un documento con righe, riepiloghi IVA e rate' })
  @ApiResponse({ status: 404, description: 'DOCUMENTO_NON_TROVATO' })
  dettaglio(@Req() req: any, @Param() p: DocumentoParamDto) {
    return this.documenti.dettaglio(requireRequestTenantId(req), p.id)
  }

  @Get(':id/pdf')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({
    summary: 'Copia di cortesia in PDF (dati salvati, mai l`XML); le bozze hanno la filigrana',
  })
  @ApiResponse({ status: 404, description: 'DOCUMENTO_NON_TROVATO, PDF_NON_DISPONIBILE' })
  async pdf(
    @Req() req: any,
    @Param() p: DocumentoParamDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const file = await this.pdfCortesia.pdf(requireRequestTenantId(req), p.id)
    return scarica(res, file.contenuto, 'application/pdf', file.nomeFile)
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

  @Post(':id/emesso')
  @HttpCode(200)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Segna il documento come emesso, senza generare l`XML' })
  @ApiResponse({ status: 409, description: 'EMISSIONE_NON_AMMESSA, VERSIONE_SUPERATA' })
  segnaEmesso(@Req() req: any, @Param() p: DocumentoParamDto, @Body() dto: SegnaEmessoDto) {
    return this.xml.segnaEmesso(requireRequestTenantId(req), req.user.id, p.id, dto.versione)
  }

  @Post(':id/xml')
  @HttpCode(200)
  @Roles(...RUOLI_AMMINISTRATORI)
  @ApiOperation({ summary: 'Scarica l`XML FatturaPA; con conferma rende il documento emesso' })
  @ApiResponse({
    status: 409,
    description: 'XML_NON_DISPONIBILE (annullato o bozza), PROGRESSIVO_FILE_ESAURITO',
  })
  @ApiResponse({ status: 422, description: 'XML_NON_VALIDO' })
  async scaricaXml(
    @Req() req: any,
    @Param() p: DocumentoParamDto,
    @Body() dto: ConfermaEmissioneDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const file = await this.xml.xml(requireRequestTenantId(req), req.user.id, p.id, {
      confermaEmissione: dto.confermaEmissione,
    })
    return scarica(res, file.contenuto, 'application/xml; charset=utf-8', file.nomeFile)
  }

  /**
   * Il CSV e` a tutti i ruoli di lettura e non cambia lo stato (`confermaEmissione` ignorata).
   * `XML_ZIP` e gli adattatori rendono i documenti emessi: servono ADMIN o SUPER_ADMIN, verificati
   * sul ruolo EFFETTIVO nell'azienda selezionata. `@Roles` (RolesGuard) lo usa gia` quando arriva
   * l'header dell'azienda, ma qui la rotta e` aperta a tutti i ruoli di lettura: la scelta dipende
   * dal `formato` nel corpo, che un decoratore non vede. Il controllo nel metodo vale anche senza
   * header e non dipende dal modo in cui il guard ricava l'azienda.
   */
  @Post('export')
  @HttpCode(200)
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Esporta i documenti selezionati (CSV, XML_ZIP o adattatore)' })
  @ApiResponse({ status: 400, description: 'TROPPI_DOCUMENTI, FILTRO_NON_VALIDO' })
  @ApiResponse({ status: 422, description: 'XML_NON_VALIDO' })
  async esporta(
    @Req() req: any,
    @Body() dto: EsportaDto,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const tenantId = requireRequestTenantId(req)
    const eCsv = dto.formato === FORMATO_CSV
    if (!eCsv)
      await richiediRuoloEffettivo(this.membership, req.user, tenantId, RUOLI_AMMINISTRATIVI)
    const esito = await this.esportazione.esporta(tenantId, req.user.id, {
      formato: dto.formato,
      selezione: dto.selezione,
      confermaEmissione: eCsv ? false : (dto.confermaEmissione ?? false),
    })
    if (dto.formato === FORMATO_XML_ZIP) res.setHeader('X-Documenti-Saltati', String(esito.saltati))
    return scarica(res, esito.contenuto, esito.contentType, esito.nomeFile)
  }
}

const FORMATO_CSV = 'CSV'
const FORMATO_XML_ZIP = 'XML_ZIP'

/** Risposta di download: byte del servizio, tipo, lunghezza e `attachment` col nome del file. */
function scarica(res: Response, contenuto: Buffer, tipo: string, nomeFile: string): StreamableFile {
  // Il nome viene dal servizio: via virgolette e caratteri di controllo dall'header.
  const nome = nomeFile.replace(/["\\\r\n]/g, '_')
  res.setHeader('Cache-Control', 'no-store')
  return new StreamableFile(contenuto, {
    type: tipo,
    length: contenuto.length,
    disposition: `attachment; filename="${nome}"`,
  })
}
